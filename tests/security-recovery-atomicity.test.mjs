import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";

// An isolated, credential-free Firebase REST simulation. Key material is generated
// ephemerally IN THIS PROCESS only, never checked in or printed. It exercises the
// actual Worker HTTP recovery handlers, Firestore JSON preconditions, the canonical
// Durable Object coordinator and the replay behavior under synchronized reads.
const TEST_UID = "staging-recovery-admin";
const BASE = "https://lan-portfolio-staging.lagmayr2.workers.dev";
const FIREBASE_ID = "lan-portfolio-staging";
const INITIAL_VERSION = Date.parse("2026-10-09T00:00:00.000Z");
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" }
});
const encodeFields = record => Object.fromEntries(Object.entries(record).map(([key, value]) =>
  [key, typeof value === "boolean" ? { booleanValue: value }
    : Array.isArray(value) ? { arrayValue: { values: value.map(v => ({ stringValue: v })) } }
    : { stringValue: String(value) }]));
const decodeField = value => value?.stringValue ?? value?.booleanValue ??
  (value?.arrayValue?.values || []).map(v => v.stringValue);

async function fixture({ resetFailures = 0, completionWriteFailures = 0 } = {}) {
  const privateKey = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey.privateKey));
  const pem = "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(der).toString("base64") +
    "\n-----END PRIVATE KEY-----";
  const oldKey = "STAGING-ONLY-FAKE-MASTER-KEY-FOR-ATOMIC-TEST";
  const pepper = "ephemeral-pepper-" + crypto.randomUUID();
  const macKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = async value => Buffer.from(new Uint8Array(
    await crypto.subtle.sign("HMAC", macKey, new TextEncoder().encode(value.trim()))
  )).toString("base64url");

  let recovery = {
    uid: TEST_UID, active: true, masterKeyHash: await hash(oldKey),
    backupCodeHashes: [], createdAt: new Date().toISOString()
  };
  let version = 1, claims = 0, resets = 0, recoveryReads = 0;
  let failedAuditWrites = 0, atomicCompletionAuditWrites = 0;
  let synchronizeReads = false, resolveReads;
  const readGate = new Promise(resolve => { resolveReads = resolve; });
  const doObjects = new Map(), waitUntil = [];
  const env = {
    FIREBASE_PROJECT_ID: FIREBASE_ID,
    FIREBASE_WEB_API_KEY: "test-only-web-key",
    FIREBASE_SERVICE_ACCOUNT_EMAIL: "staging-test-only@example.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
    SECURITY_RECOVERY_PEPPER: pepper,
    SECURITY_COORDINATOR: {
      idFromName(name) { return name; },
      get(id) {
        if (!doObjects.has(id)) {
          const entries = new Map();
          const obj = new SecurityCoordinator({
            storage: { kv: {
              get: key => entries.get(key),
              put: (key, value) => entries.set(key, structuredClone(value)),
              delete: key => entries.delete(key)
            } }
          });
          doObjects.set(id, {
            fetch(url, init) { return obj.fetch(new Request(url, init)); }
          });
        }
        return doObjects.get(id);
      }
    }
  };
  const existingFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = url.pathname;
    if (url.hostname === "oauth2.googleapis.com" && path === "/token") {
      return response({ access_token: "ephemeral-mock-oauth-token", expires_in: 3600 });
    }
    if (path.endsWith("/accounts:signInWithPassword")) {
      return response({
        error: { message: "MFA_REQUIRED", details: [{
          mfaPendingCredential: "staging-test-only-pending",
          mfaInfo: [{ uid: TEST_UID, mfaEnrollmentId: "test-totp" }]
        }] }
      }, 400);
    }
    if (path.endsWith("/accounts:update")) {
      if (resetFailures-- > 0) return response({ error: { message: "test-only-reset-interrupted" } }, 503);
      resets += 1;
      return response({ localId: TEST_UID });
    }
    if (path.endsWith("/documents/authorizedAdministrators/" + TEST_UID)) {
      return response({ fields: { active: { booleanValue: true } } });
    }
    if (path.endsWith("/documents/adminSecurityRecovery/" + TEST_UID) && (!init.method || init.method === "GET")) {
      // Capture the old value and version FIRST, then hold concurrent requests.
      // This deterministically forces every contender to race on the same
      // Firestore updateTime instead of depending on timing.
      const doc = {
        fields: encodeFields(recovery),
        updateTime: new Date(INITIAL_VERSION + version * 1000).toISOString()
      };
      if (synchronizeReads) {
        recoveryReads += 1;
        if (recoveryReads === 5) resolveReads();
        await readGate;
      }
      return response(doc);
    }
    if (path.endsWith("/documents:runQuery")) return response([]);
    if (path.endsWith("/documents:commit")) {
      const writes = JSON.parse(init.body).writes || [];
      const hasRecoveryCompletion = writes.some(x =>
        x.update?.name?.includes("/adminSecurityRecovery/" + TEST_UID) &&
        x.update?.fields?.active?.booleanValue === true
      );
      const hasSecurityEvent = writes.some(x =>
        x.update?.name?.includes("/adminSecurityEvents/")
      );
      if (hasRecoveryCompletion && completionWriteFailures-- > 0) {
        return response({ error: { status: "UNAVAILABLE", message: "test-only-Firestore-interruption" } }, 503);
      }
      if (hasRecoveryCompletion && hasSecurityEvent) atomicCompletionAuditWrites++;
      if (hasSecurityEvent && !hasRecoveryCompletion && failedAuditWrites > 0) {
        failedAuditWrites--;
        return response({ error:{ message:"test-only-activity-outage" } },503);
      }
      for (const write of writes) {
        if (!write.update?.name?.includes("/adminSecurityRecovery/" + TEST_UID)) continue;
        const expected = write.currentDocument?.updateTime;
        const current = new Date(INITIAL_VERSION + version * 1000).toISOString();
        if (expected && expected !== current) {
          // Firestore REST can map FAILED_PRECONDITION to HTTP 400.
          return response({ error: { status: "FAILED_PRECONDITION", message: "stale write" } }, 400);
        }
        const update = Object.fromEntries(Object.entries(write.update.fields || {})
          .map(([key, value]) => [key, decodeField(value)]));
        if (write.updateMask) {
          for (const field of write.updateMask.fieldPaths) recovery[field] = update[field];
        } else {
          recovery = update;
        }
        if (update.active === false) claims += 1;
        version += 1;
      }
      return response({ writeResults: writes.map(() => ({ updateTime: new Date(INITIAL_VERSION + version * 1000).toISOString() })) });
    }
    throw new Error("Unexpected external service request: " + url.hostname + path);
  };
  return {
    oldKey, hash,
    setResetFailures(n) { resetFailures = n; },
    setCompletionWriteFailures(n) { completionWriteFailures = n; },
    failNextSeparateAuditWrite() { failedAuditWrites = 1; },
    get atomicCompletionAuditWrites() { return atomicCompletionAuditWrites; },
    enableSimultaneousReads() { synchronizeReads = true; },
    snapshot() { return { ...recovery, claims, resets, reads: recoveryReads }; },
    async post(path, body, ip = "198.51.100.10") {
      const res = await worker.fetch(new Request(BASE + path, {
        method: "POST",
        headers: {
          Origin: "https://lan-portfolio-staging.web.app",
          "CF-Connecting-IP": ip, "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }), env, { waitUntil(p) { waitUntil.push(p); } });
      return { status: res.status, body: await res.json() };
    },
    async flush() { await Promise.allSettled(waitUntil.splice(0)); },
    restore() { globalThis.fetch = existingFetch; }
  };
}

test("concurrent Master Recovery Key uses are atomically claimed once, without replay", async () => {
  const f = await fixture();
  try {
    f.enableSimultaneousReads();
    const creds = { email: "staging-admin@example.invalid", password: "test-password",
      recoveryKey: f.oldKey };
    const attempts = await Promise.all(Array.from({ length: 5 },
      () => f.post("/security/recovery/start", creds)));
    assert.ok(f.snapshot().reads >= 5, "all requests must have raced on the original Firestore snapshot");
    assert.equal(attempts.filter(x => x.status === 200).length, 1,
      "only the winning request may receive a recovery session");
    assert.equal(attempts.filter(x => x.body.code === "security-recovery-key-already-used").length, 4,
      "losers must fail with the stable replay conflict code");
    assert.equal(f.snapshot().claims, 1, "old key must be marked used exactly once");
    assert.equal(f.snapshot().active, false);
    assert.equal(f.snapshot().resets, 1, "only one successful claim may clear Firebase MFA");
    const authorized = attempts.find(x => x.status === 200);
    assert.ok(authorized.body.recoverySessionId);
    await f.flush();

    const finished = await f.post("/security/recovery/complete", {
      recoverySessionId: authorized.body.recoverySessionId
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.body.state, "bootstrap-required");
    assert.ok(finished.body.masterKey);
    assert.notEqual(finished.body.masterKey, f.oldKey);
    assert.equal(f.snapshot().masterKeyHash, await f.hash(finished.body.masterKey));
    assert.equal(f.snapshot().active, true);
    const replayComplete = await f.post("/security/recovery/complete", {
      recoverySessionId: authorized.body.recoverySessionId
    });
    assert.equal(replayComplete.status, 400);
    assert.equal(replayComplete.body.code, "security-challenge-invalid");

    const replayOldKey = await f.post("/security/recovery/start", creds, "198.51.100.44");
    assert.equal(replayOldKey.status, 401);
    assert.equal(replayOldKey.body.code, "security-recovery-key-invalid");
  } finally {
    f.restore();
  }
});


test("interrupted Firebase reset can resume only with password and the original Master Key", async () => {
  const f = await fixture({ resetFailures: 1 });
  try {
    const creds = { email: "staging-admin@example.invalid", password: "test-password",
      recoveryKey: f.oldKey };
    const interrupted = await f.post("/security/recovery/start", creds);
    assert.equal(interrupted.status, 503);
    assert.equal(interrupted.body.code, "security-recovery-interrupted");
    assert.equal(interrupted.body.recoverySessionId, undefined, "incomplete reset cannot grant recovery");
    assert.equal(f.snapshot().active, false);
    assert.equal(f.snapshot().recoveryResetsComplete, false);
    assert.equal(f.snapshot().masterKeyHash, await f.hash(f.oldKey));

    const wrong = await f.post("/security/recovery/start", { ...creds, recoveryKey: "wrong-master-key" },
      "198.51.100.34");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.recoverySessionId, undefined);

    const resumed = await f.post("/security/recovery/start", creds, "198.51.100.35");
    assert.equal(resumed.status, 200);
    assert.ok(resumed.body.recoverySessionId);
    assert.equal(f.snapshot().active, false);
    assert.equal(f.snapshot().recoveryResetsComplete, true);
    assert.equal(f.snapshot().resets, 1);

    const finished = await f.post("/security/recovery/complete", {
      recoverySessionId: resumed.body.recoverySessionId
    });
    assert.equal(finished.status, 200);
    assert.equal(f.snapshot().active, true);
    assert.notEqual(finished.body.masterKey, f.oldKey);

    const replay = await f.post("/security/recovery/start", creds, "198.51.100.36");
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, "security-recovery-key-invalid");
  } finally { f.restore(); }
});


test("security Activity outage after recovery must not cause loss of the freshly issued Master Key",async()=>{
  const f=await fixture();
  try{
    const start=await f.post("/security/recovery/start",{
      email:"staging-admin@example.invalid",password:"test-password",recoveryKey:f.oldKey
    });
    assert.equal(start.status,200);
    f.failNextSeparateAuditWrite();
    const finish=await f.post("/security/recovery/complete",{
      recoverySessionId:start.body.recoverySessionId
    });
    assert.equal(finish.status,200,"never commit a replacement key then lose its one-time display");
    assert.ok(finish.body.masterKey);
    assert.equal(f.snapshot().masterKeyHash,await f.hash(finish.body.masterKey));
    assert.equal(f.atomicCompletionAuditWrites,1,
      "replacement key and Security Activity audit event must use one Firestore commit");
  }finally{f.restore();}
});

test("Firestore interruption during recovery completion preserves the pending challenge for authenticated retry", async () => {
  const f = await fixture({ completionWriteFailures: 1 });
  try {
    const started = await f.post("/security/recovery/start", {
      email: "staging-admin@example.invalid", password: "test-password", recoveryKey: f.oldKey
    });
    assert.equal(started.status, 200);
    const id = started.body.recoverySessionId;
    const failed = await f.post("/security/recovery/complete", { recoverySessionId: id });
    assert.equal(failed.status, 502);
    assert.equal(failed.body.masterKey, undefined);
    assert.equal(f.snapshot().active, false, "failed commit must not turn on a new key");
    const retried = await f.post("/security/recovery/complete", { recoverySessionId: id });
    assert.equal(retried.status, 200);
    assert.ok(retried.body.masterKey);
    assert.equal(f.snapshot().masterKeyHash, await f.hash(retried.body.masterKey));
    assert.equal(f.snapshot().active, true);
    const replay = await f.post("/security/recovery/complete", { recoverySessionId: id });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.code, "security-challenge-invalid");
  } finally { f.restore(); }
});

test("invalid recovery replacement email cannot consume the one-time challenge", async () => {
  const f = await fixture();
  try {
    const started = await f.post("/security/recovery/start", {
      email: "staging-admin@example.invalid", password: "test-password", recoveryKey: f.oldKey
    });
    assert.equal(started.status, 200);
    const id = started.body.recoverySessionId;
    const invalid = await f.post("/security/recovery/complete", {
      recoverySessionId: id, newEmail: "invalid-address"
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "security-recovery-email-invalid");
    assert.equal(f.snapshot().active, false);
    const retried = await f.post("/security/recovery/complete", { recoverySessionId: id });
    assert.equal(retried.status, 200);
    assert.ok(retried.body.masterKey);
  } finally { f.restore(); }
});
