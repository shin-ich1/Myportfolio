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
    if (op === "puzzle-image-read" || op === "puzzle-check" || op === "puzzle-finalize") {
      if (scope !== "message-puzzle" || !validChallengeId(id)) {
        return reject("message-puzzle-invalid", 400, "Verification puzzle is invalid.");
      }
      const record = kv.get("record");
      if (!record || record.scope !== "message-puzzle" ||
          Number(record.expiresAt) <= now) {
        if (record && Number(record.expiresAt) <= now) kv.delete("record");
        return reject("message-puzzle-expired", 410, "Verification puzzle expired. Load a new puzzle.");
      }
      if (op === "puzzle-image-read") {
        // Public image URL is an opaque capability. Never disclose the
        // solution, binding, Turnstile nonce or other private challenge state.
        return json({ ok: true, image: record.image, expiresAt: record.expiresAt });
      }
      if (op === "puzzle-finalize") {
        if (!record.verificationNonce ||
            String(record.verificationNonce) !== String(command.verificationNonce || "")) {
          return reject("message-puzzle-invalid", 403, "Puzzle verification is not authorized.");
        }
        kv.delete("record");
        return json({ ok: true });
      }
      if (record.origin !== command.origin || record.binding !== command.binding) {
        return reject("message-puzzle-binding", 403, "Puzzle does not belong to this browser session.");
      }
      if (record.verificationNonce) {
        return reject("message-puzzle-in-progress", 409, "Puzzle verification is already in progress.");
      }
      const answer = Number(command.answer);
      const tolerance = Number(command.tolerance);
      const maxAttempts = Number(command.maxAttempts);
      if (!Number.isFinite(answer) || answer < 0 || answer > 100 ||
          !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10 ||
          !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
        return reject("message-puzzle-answer", 400, "Complete the puzzle first.");
      }
      if (Math.abs(answer - Number(record.targetPercent)) <= tolerance) {
        const nonce = String(command.verificationNonce || "");
        if (!validChallengeId(nonce)) {
          return reject("message-puzzle-invalid", 400, "Puzzle verification nonce is invalid.");
        }
        kv.put("record", { ...record, verificationNonce: nonce });
        return json({ ok: true, outcome: "pending", verificationNonce: nonce });
      }
      const attempts = (Number(record.attempts) || 0) + 1;
      if (attempts >= maxAttempts) {
        kv.delete("record");
        return json({ ok: false, outcome: "replace", code: "message-puzzle-reset-required" });
      }
      const geometry = command.nextGeometry || {};
      if (!Number.isInteger(geometry.targetPercent) ||
          !Number.isInteger(geometry.topPercent) ||
          !Number.isInteger(geometry.pieceScalePercent) ||
          geometry.targetPercent < 0 || geometry.targetPercent > 100 ||
          geometry.topPercent < 0 || geometry.topPercent > 100 ||
          geometry.pieceScalePercent < 1 || geometry.pieceScalePercent > 100) {
        return reject("message-puzzle-invalid", 503, "Next puzzle geometry is invalid.");
      }
      kv.put("record", { ...record, ...geometry, attempts });
      return json({
        ok: false, outcome: "retry", code: "message-puzzle-retry",
        challenge: geometry, attempts, attemptsRemaining: maxAttempts - attempts
      });
    }
    if (op === "recovery-prepare") {
      if (!["recovery", "recovery-rotate"].includes(scope) || !validChallengeId(id)) {
        return reject("security-challenge-invalid", 400, "Invalid recovery session.");
      }
      const record = kv.get("record");
      if (!record || record.scope !== scope ||
          Number(record.expiresAt) <= now) {
        if (record && Number(record.expiresAt) <= now) kv.delete("record");
        return reject("security-challenge-invalid", 400, "Recovery session has expired.");
      }
      if (Number(record.preparationCount || 0) >= 3) {
        return reject("security-recovery-prepare-limit", 429,
          "Recovery Kit preparation limit reached. Complete recovery with your saved kit.");
      }
      const prepared = command.prepared;
      const validHash = hash => typeof hash === "string" &&
        /^[A-Za-z0-9_-]{40,90}$/.test(hash);
      if (!prepared || !validChallengeId(prepared.preparedKitId) ||
          !validHash(prepared.masterKeyHash) ||
          !Array.isArray(prepared.backupCodeHashes) ||
          prepared.backupCodeHashes.length !== 8 ||
          !prepared.backupCodeHashes.every(validHash)) {
        return reject("security-recovery-kit-invalid", 400, "Prepared Recovery Kit is invalid.");
      }
      kv.put("record", {
        ...record,prepared:structuredClone(prepared),
        preparationCount:Number(record.preparationCount || 0)+1
      });
      return json({ ok:true,preparedKitId:prepared.preparedKitId });
    }
    if (op === "recovery-read") {
      if (!["recovery", "recovery-rotate"].includes(scope) || !validChallengeId(id)) {
        return reject("security-challenge-invalid", 400, "Invalid recovery session.");
      }
      const record = kv.get("record");
      if (!record || record.scope !== scope ||
          Number(record.expiresAt) <= now) {
        if (record && Number(record.expiresAt) <= now) kv.delete("record");
        return reject("security-challenge-invalid", 400, "Recovery session has expired.");
      }
      // Read does not consume the challenge. The Firestore CAS on the
      // authoritative Recovery record commits its one-time effect.
      return json({ ok: true, record });
    }
    if (["upload-read", "upload-claim", "upload-release", "upload-consume"].includes(op)) {
      if (scope !== "drive-upload" || !validChallengeId(id)) {
        return reject("google-drive-upload-pending", 409, "Upload identity is invalid.");
      }
      const record = kv.get("record");
      if (!record || record.scope !== "drive-upload" ||
          Number(record.expiresAt) <= now) {
        if (record && Number(record.expiresAt) <= now) kv.delete("record");
        return reject("google-drive-upload-pending", 409,
          "Google Drive upload confirmation expired or was already completed.");
      }
      if (!command.profileId || record.profileId !== command.profileId) {
        return reject("google-drive-upload-profile", 403,
          "Pending upload does not belong to the requested storage profile.");
      }
      if (op === "upload-read") {
        return json({ ok: true, record });
      }
      if (op === "upload-claim") {
        if (!validChallengeId(command.claimId)) {
          return reject("google-drive-upload-pending", 400, "Upload claim is invalid.");
        }
        if (record.claimId && Number(record.leaseUntil) > now) {
          return reject("google-drive-upload-in-progress", 409,
            "Another upload confirmation is in progress.");
        }
        // A lease survives cross-request concurrency and Worker termination.
        // Expired leases can be recovered without allowing parallel confirms.
        const leaseUntil = Math.min(Number(record.expiresAt), now + 30 * 60 * 1000);
        kv.put("record", { ...record, claimId: command.claimId, leaseUntil });
        return json({ ok: true, claimId: command.claimId, record });
      }
      if (!validChallengeId(command.claimId) || !record.claimId ||
          record.claimId !== command.claimId) {
        return reject("google-drive-upload-claim-invalid", 403,
          "Pending upload lease was not authorized.");
      }
      if (op === "upload-release") {
        kv.put("record", { ...record, claimId: "", leaseUntil: 0 });
        return json({ ok: true });
      }
      if (op === "upload-consume") {
        kv.delete("record");
        return json({ ok: true });
      }
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
      if (!["security", "service", "message"].includes(category) ||
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
        : { count: 0, windowStart: at, resetAt: at + windowMs, blockedUntil: 0, lastAt: 0 };
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
      if (category === "message") {
        if (cooldownMs > 0 && Number(state.lastAt) > 0 && at - Number(state.lastAt) < cooldownMs) {
          return reject("message-rate-cooldown", 429,
            "Please wait a moment before sending another message.",
            new Date(Number(state.lastAt) + cooldownMs).toISOString());
        }
        if (state.count >= limit) {
          return reject("message-rate-window", 429,
            "Too many messages were sent. Please try again later.",
            new Date(state.resetAt).toISOString());
        }
      }
      state.lastAt = at;
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
