/**
 * Canonical atomic coordinator for Admin Security Gateway one-use challenges,
 * trusted-device QR approval and sensitive endpoint rate limits.
 *
 * Cloudflare SQLite-backed Durable Objects provide a synchronous, strongly
 * consistent KV API. The validation + mutation below deliberately contains
 * NO await between kv.get, kv.put or kv.delete, so concurrent requests for one
 * object cannot consume the same challenge or lose rate-limit increments.
 *
 * Only bound Worker code can invoke this class. Never expose a public route.
 */
const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const reject = (code, status, message, retryAt = "") => json({ code, error: message, retryAt }, status);
const validScope = value => typeof value === "string" && /^[a-z][a-z0-9-]{1,48}$/.test(value);
const validChallengeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{20,90}$/.test(value);
const matchingKey = (left, right) => ["kty", "crv", "x", "y"]
  .every(field => Boolean(left?.[field]) && String(left[field]) === String(right?.[field]));

export class SecurityCoordinator {
  constructor(ctx) {
    this.ctx = ctx;
    // A SQLite-backed DO's kv interface is synchronous; async KV is NOT safe
    // for a read/modify/write without a transaction.
    if (!ctx?.storage?.kv?.get || !ctx?.storage?.kv?.put || !ctx?.storage?.kv?.delete) {
      throw new Error("SQLite Durable Object storage is required.");
    }
  }

  async scheduleExpiry(expiresAt) {
    if (typeof this.ctx.storage.setAlarm === "function") {
      await this.ctx.storage.setAlarm(expiresAt + 1000);
    }
  }

  async alarm() {
    const record = this.ctx.storage.kv.get("record");
    if (!record) return;
    if (Number(record.expiresAt) <= Date.now()) {
      this.ctx.storage.kv.delete("record");
    } else {
      await this.scheduleExpiry(Number(record.expiresAt));
    }
  }

  async fetch(request) {
    if (request.method !== "POST") return reject("method-not-allowed", 405, "Method not allowed.");
    let command;
    try { command = await request.json(); }
    catch { return reject("security-coordinator-invalid", 400, "Invalid security request."); }
    if (!command || typeof command !== "object") {
      return reject("security-coordinator-invalid", 400, "Invalid security request.");
    }
    const { op, scope, id } = command;
    const kv = this.ctx.storage.kv;
    const now = Date.now();
    // The object ID is selected by the invoking Worker from the scope and
    // challenge ID (or rate identity). An object owns exactly one "record".
    if (op === "challenge-put") {
      if (!validScope(scope) || !validChallengeId(id) ||
          command.record?.scope !== scope ||
          !Number.isFinite(Number(command.record?.expiresAt)) ||
          Number(command.record.expiresAt) <= now) {
        return reject("security-challenge-invalid", 400, "Invalid or expired security challenge.");
      }
      if (kv.get("record")) return reject("security-challenge-exists", 409, "Security challenge already exists.");
      kv.put("record", structuredClone(command.record));
      await this.scheduleExpiry(Number(command.record.expiresAt));
      return json({ ok: true });
    }
    if (op === "challenge-read" || op === "challenge-consume" ||
        op === "challenge-approve" || op === "enrollment-consume") {
      if (!validScope(scope) || !validChallengeId(id)) {
        return reject("security-challenge-invalid", 400, "Invalid security challenge.");
      }
      const record = kv.get("record");
      if (!record) return reject("security-challenge-invalid", 400, "Security challenge is invalid, expired, or already used.");
      if (Number(record.expiresAt) <= now) {
        kv.delete("record");
        return reject("security-challenge-expired", 400, "Security challenge has expired.");
      }
      if (record.scope !== scope) {
        return reject("security-challenge-invalid", 400, "Invalid security challenge scope.");
      }
      if (op === "challenge-consume") {
        // All checks and deletion execute in one synchronous turn.
        kv.delete("record");
        return json({ ok: true, record });
      }
      if (scope !== "device-enroll" ||
          typeof command.uid !== "string" || !command.uid ||
          record.uid !== command.uid) {
        return reject("security-enrollment-invalid", 403, "Enrollment challenge does not belong to this administrator.");
      }
      if (op === "challenge-read") return json({ ok: true, record });
      if (op === "challenge-approve") {
        if (!command.approvedByDeviceId || typeof command.approvedByDeviceId !== "string") {
          return reject("security-enrollment-invalid", 400, "Trusted device approval is required.");
        }
        if (record.approved === true) {
          return reject("security-enrollment-already-approved", 409, "Enrollment was already approved.");
        }
        const updated = {
          ...record, approved: true, approvedByDeviceId: command.approvedByDeviceId,
          approvedAt: now
        };
        kv.put("record", updated);
        return json({ ok: true, state: "approved" });
      }
      if (!command.deviceId ||
          String(record.requestingDeviceId || "") !== String(command.deviceId) ||
          !matchingKey(record.publicKeyJwk, command.publicKeyJwk)) {
        return reject("security-enrollment-device-mismatch", 403, "Enrollment does not match this device.");
      }
      if (command.requiresApproval === true && record.approved !== true) {
        return reject("security-enrollment-approval-required", 403, "Trusted device approval is required.");
      }
      kv.delete("record");
      return json({ ok: true, record });
    }
    if (op === "rate-clear") {
      kv.delete("record");
      return json({ ok: true });
    }
    if (op === "rate-hit") {
      const category = command.category;
      const policy = command.policy || {};
      const limit = Number(policy.limit), windowMs = Number(policy.windowSeconds) * 1000;
      const cooldownMs = Number(policy.cooldownSeconds || 0) * 1000;
      if (!["security", "service"].includes(category) ||
          !Number.isInteger(limit) || limit < 1 || limit > 10000 ||
          !Number.isFinite(windowMs) || windowMs < 1000 || windowMs > 86400000 ||
          !Number.isFinite(cooldownMs) || cooldownMs < 0 || cooldownMs > 86400000) {
        return reject("security-coordinator-policy", 503, "Security rate-limit configuration is invalid.");
      }
      const at = Number.isFinite(Number(command.now)) ? Number(command.now) : now;
      const previous = kv.get("record");
      const validWindow = previous && Number(previous.resetAt) > at;
      const state = validWindow
        ? { ...previous }
        : { count: 0, windowStart: at, resetAt: at + windowMs, blockedUntil: 0 };
      if (category === "security" && Number(state.blockedUntil) > at) {
        return reject("security-rate-limited", 429,
          "Too many security attempts. Try again after the cooldown.",
          new Date(state.blockedUntil).toISOString());
      }
      if (category === "service" && Number(state.count) >= limit) {
        return reject("service-rate-limited", 429,
          "Too many service requests. Try again after the rate-limit window.",
          new Date(state.resetAt).toISOString());
      }
      state.count += 1;
      if (category === "security" && state.count > limit) {
        state.blockedUntil = at + cooldownMs;
      }
      state.expiresAt = Math.max(state.resetAt, state.blockedUntil || 0) + 60000;
      kv.put("record", state);
      await this.scheduleExpiry(state.expiresAt);
      if (category === "security" && state.blockedUntil > at) {
        return reject("security-rate-limited", 429,
          "Too many security attempts. Temporary cooldown is active.",
          new Date(state.blockedUntil).toISOString());
      }
      return json({ ok: true });
    }
    return reject("security-coordinator-invalid", 400, "Unsupported security operation.");
  }
}
