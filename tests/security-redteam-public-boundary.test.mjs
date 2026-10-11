import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";

// No live URL is contacted. Every external Firebase response is intercepted;
// this exercises the canonical Worker HTTP handler after disposable, mock
// human-verification proofs are issued to distinct simulated browsers.
const ORIGIN = "https://lan-portfolio-staging.web.app";
const BASE = "https://lan-portfolio-staging.lagmayr2.workers.dev";
const FIRESTORE_PREFIX =
  "projects/lan-portfolio-staging/databases/(default)/documents/privateMessageThreads/";
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" }
});
const digestId = async text => Buffer.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
)).toString("base64url").slice(0, 32);

async function fixture({ rejectOneCommit = false } = {}) {
  const key = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    Buffer.from(await crypto.subtle.exportKey("pkcs8", key.privateKey)).toString("base64") +
    "\n-----END PRIVATE KEY-----";
  const durableObjects = new Map();
  const docs = new Map();
  let commits = 0, failures = 0;
  const env = {
    FIREBASE_PROJECT_ID: "lan-portfolio-staging",
    FIREBASE_SERVICE_ACCOUNT_EMAIL: "isolated-messenger@example.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
    SECURITY_COORDINATOR: {
      idFromName(name) { return name; },
      get(name) {
        if (!durableObjects.has(name)) {
          const cells = new Map();
          const obj = new SecurityCoordinator({ storage: { kv: {
            get: k => cells.get(k),
            put: (k, v) => cells.set(k, structuredClone(v)),
            delete: k => cells.delete(k)
          } } });
          durableObjects.set(name, {
            fetch(url, init) { return obj.fetch(new Request(url, init)); }
          });
        }
        return durableObjects.get(name);
      }
    },
    PORTFOLIO_MESSAGES: {
      async get() { return null; },
      async put() {},
      async delete() {},
      async list() { return { list_complete: true, keys: [] }; }
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token")
      return reply({ access_token: "isolated-fake-oauth-token", expires_in: 3600 });
    if (url.hostname === "firestore.googleapis.com" &&
        url.pathname.endsWith("/documents:commit")) {
      const writes = JSON.parse(init.body).writes;
      assert.equal(writes.length, 2, "A new message requires one atomic two-write commit");
      for (const write of writes) {
        assert.ok(write.update?.name.startsWith(FIRESTORE_PREFIX),
          "Only isolated private message documents may be written");
        assert.equal(write.currentDocument?.exists, false,
          "Do not silently overwrite an existing private conversation or message");
      }
      if (rejectOneCommit) {
        rejectOneCommit = false;
        failures++;
        return reply({ error: { status: "UNAVAILABLE", message: "Simulated Firestore interruption" } }, 503);
      }
      if (writes.some(write => docs.has(write.update.name)))
        return reply({ error: { status: "ALREADY_EXISTS" } }, 409);
      for (const write of writes) docs.set(write.update.name, structuredClone(write.update.fields));
      commits++;
      return reply({ writeResults: writes.map(() => ({})) });
    }
    throw Error("Unexpected real network request: " + url.hostname + url.pathname);
  };
  async function issueProof(person) {
    const token = crypto.randomUUID().replaceAll("-", "");
    const proofId = await digestId(token);
    const browserBinding = await digestId(person.ip + "|" + person.agent);
    const obj = env.SECURITY_COORDINATOR.get(
      env.SECURITY_COORDINATOR.idFromName("security-challenge:message-proof:" + proofId));
    const issued = await obj.fetch("https://security-coordinator.internal/operation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "challenge-put", scope: "message-proof", id: proofId,
        record: { scope: "message-proof", origin: ORIGIN, binding: browserBinding,
          expiresAt: Date.now() + 90000 }
      })
    });
    assert.equal(issued.status, 200, "Disposable verification proof must be issued");
    return token;
  }
  async function send(person, verificationToken) {
    const response = await worker.fetch(new Request(BASE + "/messages/public/thread", {
      method: "POST",
      headers: {
        Origin: ORIGIN, "Content-Type": "application/json",
        "CF-Connecting-IP": person.ip, "User-Agent": person.agent
      },
      body: JSON.stringify({ name: person.name, message: person.message, verificationToken, ...(person.extra || {}) })
    }), env, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  }
  return {
    docs, issueProof, send,
    get commits() { return commits; },
    get failures() { return failures; },
    restore() { globalThis.fetch = originalFetch; }
  };
}

const visitor = (i, ip = "198.51.100." + String(i + 1)) => ({
  ip, agent: "Isolated stress visitor " + i,
  name: "Visitor " + i,
  message: "Distinct isolated test message #" + i
});


test("Public input cannot inject Admin-owned message fields", async () => {
  const f = await fixture();
  try {
    const attacks = [
      { message: "<img src=x onerror=alert(1)>" },
      { message: "<svg onload=alert(1)>" },
      { message: '{"role":"admin","isAdmin":true}' },
      { message: "A".repeat(3000) },
      { extra: { role: "admin", isAdmin: true } },
      { extra: { status: "approved", adminUnread: false } },
      { extra: { lanSecurityVerified: true, lanTrustLevel: "trusted" } },
      { extra: { ownerUid: "admin", recoveryApproved: true } },
      { extra: JSON.parse('{"__proto__":{"polluted":true}}') },
      { extra: { constructor: { prototype: { isAdmin: true } } } },
      { extra: { website: "bot-filled-honeypot" } },
      { extra: { verificationToken: "forged-proof" } }
    ];

    const attempts = Array.from({ length: 48 }, (_, i) => {
      const attack = attacks[i % attacks.length];
      return {
        ...visitor(i),
        message: attack.message || "Adversarial payload " + i,
        extra: attack.extra || {}
      };
    });

    const proofs = await Promise.all(
      attempts.map(person => f.issueProof(person))
    );

    const responses = await Promise.all(
      attempts.map((person, i) => f.send(person, proofs[i]))
    );

    let accepted = 0, rejected = 0;

    for (const response of responses) {
      if (response.status === 201) {
        assert.equal(response.body.ok, true);
        accepted++;
      } else {
        assert.ok(
          response.status >= 400 && response.status < 500,
          "Unexpected response: " + JSON.stringify(response)
        );
        rejected++;
      }
    }

    assert.ok(accepted > 0, "No request reached the database");
    assert.equal(f.commits, accepted);
    assert.equal(f.docs.size, accepted * 2);
    assert.equal(({}).polluted, undefined);

    for (const [path, fields] of f.docs) {
      assert.equal(fields.isAdmin, undefined);
      assert.equal(fields.lanSecurityVerified, undefined);
      assert.equal(fields.ownerUid, undefined);

      if (path.includes("/messages/")) {
        assert.equal(fields.role?.stringValue, "visitor");
      } else {
        assert.equal(fields.status?.stringValue, "open");
        assert.equal(fields.adminUnread?.booleanValue, true);
      }
    }

    console.log("ATTACK ATTEMPTS:", responses.length);
    console.log("SAFE NORMAL WRITES:", accepted);
    console.log("REJECTED INPUTS:", rejected);
    console.log("UNAUTHORIZED ADMIN FIELDS: 0");
  } finally {
    f.restore();
  }
});