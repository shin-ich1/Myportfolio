import test from "node:test";
import assert from "node:assert/strict";
import { SecurityCoordinator } from "../telemetry-worker/src/security-coordinator.js";

// SQLite-backed DO exposes a synchronous, strongly consistent KV API.
// This fixture models one DO instance and a single JS turn for each state update.
const fixture = () => {
  const records = new Map();
  const ctx = {
    storage: {
      kv: {
        get(key) { return records.get(key); },
        put(key, value) { records.set(key, structuredClone(value)); },
        delete(key) { return records.delete(key); }
      }
    }
  };
  const obj = new SecurityCoordinator(ctx);
  const command = async (op, extra = {}) => {
    const response = await obj.fetch(new Request("https://internal.coordinator/" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, ...extra })
    }));
    return { status: response.status, body: await response.json() };
  };
  return { command, records };
};

const challenge = (scope, id = "T".repeat(32), data = {}) =>
  ({ scope, id, record: { scope, expiresAt: Date.now() + 300000, uid: "admin-uid", ...data } });

test("atomic security challenge can only be consumed once under 40 concurrent requests", async () => {
  const { command } = fixture();
  const body = challenge("totp-login");
  assert.equal((await command("challenge-put", body)).status, 200);
  const results = await Promise.all(Array.from({ length: 40 }, () => command("challenge-consume", {
    scope: body.scope, id: body.id
  })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.body.code === "security-challenge-invalid").length, 39);
});

test("expired challenges and incorrect scopes cannot be redeemed", async () => {
  const { command } = fixture();
  const body = challenge("step-up", "S".repeat(32), { expiresAt: Date.now() - 5 });
  await command("challenge-put", body);
  const expired = await command("challenge-consume", { scope: "step-up", id: body.id });
  assert.equal(expired.status, 400);
  const missing = await command("challenge-consume", { scope: "totp-login", id: body.id });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "security-challenge-invalid");
});

test("device enrollment requires matching admin, device, key and approval when already trusted", async () => {
  const { command } = fixture();
  const key = { kty: "EC", crv: "P-256", x: "X", y: "Y" };
  const body = challenge("device-enroll", "E".repeat(32), {
    requestingDeviceId: "new-device", publicKeyJwk: key, approved: false
  });
  await command("challenge-put", body);
  const attempt = (extra = {}) => command("enrollment-consume", {
    scope: body.scope, id: body.id, uid: "admin-uid", deviceId: "new-device",
    publicKeyJwk: key, requiresApproval: true, ...extra
  });
  assert.equal((await attempt()).body.code, "security-enrollment-approval-required");
  assert.equal((await attempt({ uid: "other-user" })).status, 403);
  assert.equal((await attempt({ deviceId: "wrong-device" })).status, 403);
  assert.equal((await attempt({ publicKeyJwk: { ...key, x: "tampered" } })).status, 403);
  assert.equal((await command("challenge-approve", {
    scope: "device-enroll", id: body.id, uid: "admin-uid", approvedByDeviceId: "trusted-device"
  })).status, 200);
  assert.equal((await command("challenge-approve", {
    scope: "device-enroll", id: body.id, uid: "admin-uid", approvedByDeviceId: "trusted-device"
  })).status, 409);
  const parallel = await Promise.all(Array.from({ length: 30 }, () => attempt()));
  assert.equal(parallel.filter(result => result.status === 200).length, 1);
  assert.equal(parallel.filter(result => result.status === 400).length, 29);
});

test("incorrect owner cannot inspect or approve enrollment challenge", async () => {
  const { command } = fixture();
  const body = challenge("device-enroll", "A".repeat(32), { approved: false });
  await command("challenge-put", body);
  assert.equal((await command("challenge-read", { scope: body.scope, id: body.id, uid: "other" })).status, 403);
  assert.equal((await command("challenge-approve", { scope: body.scope, id: body.id, uid: "other", approvedByDeviceId: "trusted" })).status, 403);
  assert.equal((await command("challenge-read", { scope: body.scope, id: body.id, uid: "admin-uid" })).body.record.approved, false);
});

test("security rate limiter rejects all concurrent attempts above limit", async () => {
  const { command } = fixture();
  const policy = { limit: 7, windowSeconds: 900, cooldownSeconds: 900 };
  const now = Date.now();
  const trials = await Promise.all(Array.from({ length: 65 }, () => command("rate-hit", {
    category: "security", policy, now
  })));
  assert.equal(trials.filter(x => x.status === 200).length, 7);
  assert.equal(trials.filter(x => x.status === 429).length, 58);
  assert.equal(trials.at(-1).body.code, "security-rate-limited");
});

test("service rate limiter rejects concurrent calls after limit, then resets next window", async () => {
  const { command } = fixture();
  const policy = { limit: 4, windowSeconds: 60 };
  const now = Date.now();
  const first = await Promise.all(Array.from({ length: 45 }, () => command("rate-hit", {
    category: "service", policy, now
  })));
  assert.equal(first.filter(x => x.status === 200).length, 4);
  assert.equal(first.filter(x => x.status === 429).length, 41);
  const later = await command("rate-hit", { category: "service", policy, now: now + 61000 });
  assert.equal(later.status, 200);
});

test("missing coordinator binding must never fall back to non-atomic KV", async () => {
  const worker = (await import("../telemetry-worker/src/index.js")).default;
  const response = await worker.fetch(new Request("https://lan-portfolio-staging.lagmayr2.workers.dev/security/login/password", {
    method: "POST",
    headers: { Origin: "https://lan-portfolio-staging.web.app", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "not-a-secret" })
  }), { FIREBASE_PROJECT_ID: "lan-portfolio-staging", SECURITY_STATE: {
    get() { throw new Error("old KV owner must not be read"); },
    put() { throw new Error("old KV owner must not write"); },
    delete() { throw new Error("old KV owner must not delete"); }
  } }, { waitUntil() {} });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.code, "security-coordinator-not-configured");
});
