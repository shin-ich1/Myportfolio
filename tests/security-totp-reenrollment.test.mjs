import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";

// Credential-free Identity Platform TOTP simulation. All Firebase responses,
// one-time challenges and keys exist only in this test process.
const HOST = "https://lan-portfolio-staging.lagmayr2.workers.dev";
const UID = "staging-totp-bootstrap-admin";
const mockJson = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" }
});
async function fixture() {
  const keypair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", keypair.privateKey))
    .toString("base64").match(/.{1,64}/g).join("\n");
  const objects = new Map(), audit = [];
  const env = {
    FIREBASE_PROJECT_ID: "lan-portfolio-staging",
    FIREBASE_WEB_API_KEY: "staging-test-public-key",
    FIREBASE_SERVICE_ACCOUNT_EMAIL: "test-only@staging.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\n" + privateKey + "\n-----END PRIVATE KEY-----",
    SECURITY_COORDINATOR: {
      idFromName(name) { return name; },
      get(id) {
        if (!objects.has(id)) {
          const kv = new Map();
          const object = new SecurityCoordinator({ storage: { kv: {
            get: name => kv.get(name),
            put: (name, value) => kv.set(name, structuredClone(value)),
            delete: name => kv.delete(name)
          } } });
          objects.set(id, { fetch(url, init) { return object.fetch(new Request(url, init)); } });
        }
        return objects.get(id);
      }
    }
  };
  let finalizeError = "INVALID_TOTP_CODE";
  let sessions = 0, starts = 0, finalizes = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = url.pathname;
    if (url.hostname === "oauth2.googleapis.com" && path === "/token")
      return mockJson({ access_token: "only-for-test", expires_in: 3600 });
    if (path.endsWith("/accounts:signInWithPassword"))
      return mockJson({ localId: UID, email: "admin@example.invalid", idToken: "password-token" });
    if (path.endsWith("/accounts:lookup"))
      return mockJson({ users: [{ localId: UID, email: "admin@example.invalid", emailVerified: true }] });
    if (path.endsWith("/accounts/mfaEnrollment:start")) {
      starts++;
      return mockJson({ totpSessionInfo: {
        sharedSecretKey: "JBSWY3DPEHPK3PXP", sessionInfo: "firebase-totp-session-" + starts,
        verificationCodeLength: 6, hashingAlgorithm: "SHA1", periodSec: 30
      } });
    }
    if (path.endsWith("/accounts/mfaEnrollment:finalize")) {
      finalizes++;
      if (finalizeError)
        return mockJson({ error: { message: finalizeError } }, finalizeError === "BACKEND_ERROR" ? 503 : 400);
      return mockJson({ idToken: "enrolled-totp-token", refreshToken: "unused-in-test" });
    }
    if (path.includes("/documents/authorizedAdministrators/" + UID))
      return mockJson({ fields: { active: { booleanValue: true } } });
    if (path.includes("/documents/") && (!init.method || init.method === "GET"))
      return mockJson({ error: { message: "NOT_FOUND" } }, 404);
    if (path.endsWith("/documents:commit")) {
      for (const write of JSON.parse(init.body).writes || []) {
        const name = String(write.update?.name || "");
        if (name.includes("/adminSecuritySessions/")) sessions++;
        if (name.includes("/adminSecurityEvents/")) audit.push(write);
      }
      return mockJson({ writeResults: [] });
    }
    if (path.endsWith("/documents:runQuery")) return mockJson([]);
    throw new Error("Unexpected mocked Firebase route: " + path);
  };
  return {
    setFirebaseFailure(message) { finalizeError = message; },
    get stats() { return { starts, finalizes, sessions, audit: audit.length }; },
    restore() { globalThis.fetch = originalFetch; },
    async post(path, body) {
      const response = await worker.fetch(new Request(HOST + path, {
        method: "POST", headers: {
          Origin: "https://lan-portfolio-staging.web.app",
          "CF-Connecting-IP": "192.0.2.65", "Content-Type": "application/json"
        }, body: JSON.stringify(body)
      }), env, { waitUntil() {} });
      return { status: response.status, body: await response.json() };
    },
    async start() {
      return this.post("/security/totp/enrollment/start",
        { email: "admin@example.invalid", password: "test-password" });
    },
    async complete(challengeId, code = "123456") {
      return this.post("/security/totp/enrollment/complete",
        { challengeId, code, displayName: "LΛN Admin" });
    }
  };
}

test("Firebase invalid TOTP code has a distinct safe error, consumes its challenge, and fresh QR can finish enrollment", async () => {
  const f = await fixture();
  try {
    const first = await f.start();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.match(first.body.totpUri, /^otpauth:\/\/totp\//);
    assert.ok(first.body.challengeId);
    const invalid = await f.complete(first.body.challengeId);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "security-totp-enrollment-code-invalid");
    assert.equal(invalid.body.masterKey, undefined);
    assert.equal(invalid.body.sharedSecretKey, undefined);
    const replay = await f.complete(first.body.challengeId);
    assert.equal(replay.status, 400);
    assert.equal(replay.body.code, "security-challenge-invalid");
    f.setFirebaseFailure("");
    const fresh = await f.start();
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.notEqual(fresh.body.challengeId, first.body.challengeId);
    const enrolled = await f.complete(fresh.body.challengeId);
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    assert.ok(enrolled.body.session?.sessionId);
    assert.ok(enrolled.body.customToken);
    assert.equal(f.stats.sessions, 1);
    assert.equal(f.stats.finalizes, 2, "stale challenge must not reach Firebase again");
  } finally { f.restore(); }
});

test("Firebase infrastructure failure must not masquerade as an incorrect authenticator code or disclose provider details", async () => {
  const f = await fixture();
  try {
    f.setFirebaseFailure("BACKEND_ERROR");
    const prepared = await f.start();
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const failure = await f.complete(prepared.body.challengeId);
    assert.equal(failure.status, 502);
    assert.equal(failure.body.code, "security-totp-enrollment-provider-failed");
    assert.doesNotMatch(JSON.stringify(failure.body), /BACKEND_ERROR|password-token|firebase-totp-session/);
    assert.equal(f.stats.sessions, 0);
  } finally { f.restore(); }
});

test("post-recovery Firebase ID-token invalidation reports enrollment-session expiry without granting access", async () => {
  const f = await fixture();
  try {
    f.setFirebaseFailure("INVALID_ID_TOKEN");
    const prepared = await f.start();
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const failure = await f.complete(prepared.body.challengeId);
    assert.equal(failure.status, 401);
    assert.equal(failure.body.code, "security-totp-enrollment-session-expired");
    assert.equal(f.stats.sessions, 0);
    assert.equal((await f.complete(prepared.body.challengeId)).body.code, "security-challenge-invalid");
    f.setFirebaseFailure("");
    const renewed = await f.start();
    assert.equal(renewed.status, 200);
    assert.notEqual(renewed.body.challengeId, prepared.body.challengeId);
    assert.equal((await f.complete(renewed.body.challengeId)).status, 200);
  } finally { f.restore(); }
});

test("canonical Admin login controller renews the consumed QR, clears its old code, and never silently reuses it", async () => {
  const { readFileSync } = await import("node:fs");
  const login = readFileSync(new URL("../admin/js/admin.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
  assert.equal((login.match(/async function renewTotpEnrollmentChallenge\(/g) || []).length, 1,
    "one canonical login-controller retry owner");
  assert.match(login, /pendingEnrollmentChallenge\s*=\s*'';\s*const fresh=await beginTotpEnrollment\(pendingBootstrapPassword\)/);
  assert.match(login, /pendingEnrollmentChallenge=fresh\.challengeId/);
  assert.match(login, /renderQr\(enrollmentQr,fresh\.totpUri\)/);
  assert.match(login, /enrollmentCode\.value=''/);
  assert.match(login, /if\(!await renewTotpEnrollmentChallenge\(error\)\)/);
  assert.doesNotMatch(workerSource, /uid:first\.uid,idToken:first\.idToken,sessionInfo,secret/,
    "ephemeral Firebase TOTP secret must not be copied into coordinator state");
});
