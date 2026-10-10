import test from "node:test";
import assert from "node:assert/strict";
import { inspectStagingWorkerHealth, waitForStagingWorkerHealth, STAGING_HEALTH_URL } from "../scripts/check-staging-worker-health.mjs";

const canonical = {
  ok: true,
  service: "lan-cloudinary-telemetry",
  firebaseConfigured: true,
  securityCoordinatorConfigured: true,
  storageOAuthConfigured: true,
  messagePushConfigured: true,
  messageSecurityConfigured: false
};
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" }
});

test("staging health gate only checks the fixed staging Worker URL, without credentials", async () => {
  let destination = "", options;
  const result = await inspectStagingWorkerHealth({
    fetchImpl: async (url, init) => {
      destination = url;
      options = init;
      return jsonResponse(canonical);
    }
  });
  assert.equal(destination, STAGING_HEALTH_URL);
  assert.match(destination, /^https:\/\/lan-portfolio-staging\.lagmayr2\.workers\.dev\/health$/);
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(result.canonicalWorkerResponding, true);
  assert.equal(result.atomicSecurityCoordinatorBindingPresent, true);
  assert.equal(result.serverCredentialPresenceReported, false);
  assert.equal(result.runtimeSecurityVerified, false);
});

test("rejects placeholder Hello World Worker", async () => {
  await assert.rejects(
    inspectStagingWorkerHealth({ fetchImpl: async () => new Response("Hello World!", { status: 200, headers: { "Content-Type": "text/plain" } }) }),
    /canonical staging Worker JSON/
  );
});

test("rejects incorrect or unconfigured Worker without leaking response data", async () => {
  await assert.rejects(
    inspectStagingWorkerHealth({ fetchImpl: async () => jsonResponse({ ...canonical, service: "other-worker" }) }),
    /canonical Worker identity/
  );
  await assert.rejects(
    inspectStagingWorkerHealth({ fetchImpl: async () => jsonResponse({ ...canonical, firebaseConfigured: false }) }),
    /Firebase project configuration/
  );
  await assert.rejects(
    inspectStagingWorkerHealth({ fetchImpl: async () => jsonResponse({ ...canonical, securityCoordinatorConfigured: false }) }),
    /atomic Security Coordinator binding/
  );
  await assert.rejects(
    inspectStagingWorkerHealth({ fetchImpl: async () => jsonResponse({ ...canonical, messagePushConfigured: false }) }),
    /staging KV bindings/
  );
  await assert.rejects(
    inspectStagingWorkerHealth({ fetchImpl: async () => jsonResponse({ error: "sensitive-echo" }, 503) }),
    /HTTP 503/
  );
});

test("health success must not be mistaken for validated TOTP, trusted devices, or backend credentials", async () => {
  const result = await inspectStagingWorkerHealth({ fetchImpl: async () => jsonResponse({ ...canonical, messageSecurityConfigured: true }) });
  assert.equal(result.serverCredentialPresenceReported, true);
  assert.equal(result.runtimeSecurityVerified, false);
  assert.equal(Object.hasOwn(result, "secret"), false);
});

test("bounded staging readiness retries stale non-JSON edge responses before accepting canonical JSON", async () => {
  const destinations = [];
  let sleeps = 0;
  const fetchImpl = async (url) => {
    destinations.push(url);
    if (destinations.length <= 2) return new Response("Hello World!", { status: 200, headers: { "Content-Type": "text/plain" } });
    return jsonResponse({ ...canonical, messageSecurityConfigured: true });
  };
  const result = await waitForStagingWorkerHealth({ fetchImpl, sleepImpl: async () => { sleeps++; } });
  assert.deepEqual(destinations, [STAGING_HEALTH_URL, STAGING_HEALTH_URL, STAGING_HEALTH_URL]);
  assert.equal(sleeps, 2);
  assert.equal(result.canonicalWorkerResponding, true);
  assert.equal(result.serverCredentialPresenceReported, true);
  assert.equal(result.runtimeSecurityVerified, false);
});

test("bounded staging readiness fails closed when all responses are stale", async () => {
  let calls = 0, sleeps = 0;
  await assert.rejects(
    waitForStagingWorkerHealth({
      fetchImpl: async () => {
        calls++;
        return new Response("Hello World!", { status: 200, headers: { "Content-Type": "text/plain" } });
      },
      sleepImpl: async () => { sleeps++; }
    }),
    /canonical staging Worker JSON/
  );
  assert.equal(calls, 10);
  assert.equal(sleeps, 9);
});

test("staging readiness never retries missing security bindings or credentials into success", async () => {
  let calls = 0, sleeps = 0;
  await assert.rejects(
    waitForStagingWorkerHealth({
      fetchImpl: async () => {
        calls++;
        return jsonResponse({ ...canonical, securityCoordinatorConfigured: false });
      },
      sleepImpl: async () => { sleeps++; }
    }),
    /atomic Security Coordinator binding/
  );
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test("staging readiness rejects unauthorized response immediately", async () => {
  let calls = 0, sleeps = 0;
  await assert.rejects(
    waitForStagingWorkerHealth({
      fetchImpl: async () => {
        calls++;
        return jsonResponse({ error: "unauthorized" }, 403);
      },
      sleepImpl: async () => { sleeps++; }
    }),
    /HTTP 403/
  );
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test("staging readiness retries mismatched Worker identity only until canonical service responds", async () => {
  let calls = 0;
  const result = await waitForStagingWorkerHealth({
    fetchImpl: async () => {
      calls++;
      return jsonResponse(calls === 1 ? { ...canonical, service: "old-placeholder" } : canonical);
    },
    sleepImpl: async () => {}
  });
  assert.equal(calls, 2);
  assert.equal(result.canonicalWorkerResponding, true);
});
