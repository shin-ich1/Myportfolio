import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestHarness } from "wrangler";

// Real local workerd + SQLite Durable Object, using the generated isolated
// staging configuration. No Firebase/GCP credentials, API calls, or deployment.
const harness = createTestHarness({
  workers: [{
    configPath: new URL("../wrangler.staging.jsonc", import.meta.url),
    secrets: {}
  }]
});

before(async () => {
  await harness.listen();
});
after(async () => {
  await harness.close();
});

const send = async (stub, op, payload) => {
  const result = await stub.fetch("https://security-coordinator.internal/operation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...payload })
  });
  return { status: result.status, body: await result.json() };
};

test("workerd runs canonical SQLite coordinator; 50 concurrent one-time requests yield exactly one success", async () => {
  const env = await harness.getWorker().getEnv();
  const namespace = env.SECURITY_COORDINATOR;
  assert.equal(typeof namespace.idFromName, "function");
  const id = "R".repeat(32);
  const stub = namespace.get(namespace.idFromName("security-challenge:totp-login:" + id));
  const request = { scope: "totp-login", id };
  const created = await send(stub, "challenge-put", {
    ...request,
    record: { ...request, expiresAt: Date.now() + 60000, uid: "nonexistent-test-admin" }
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const outcomes = await Promise.all(Array.from({ length: 50 }, () =>
    send(stub, "challenge-consume", request)
  ));
  assert.equal(outcomes.filter(x => x.status === 200).length, 1);
  assert.equal(outcomes.filter(x => x.status === 400).length, 49);
});

test("workerd SQLite rate limiter strictly caps parallel attempts", async () => {
  const env = await harness.getWorker().getEnv();
  const namespace = env.SECURITY_COORDINATOR;
  const stub = namespace.get(namespace.idFromName("security-rate:workerd-staging-test"));
  const now = Date.now();
  const results = await Promise.all(Array.from({ length: 36 }, () => send(stub, "rate-hit", {
    category: "security",
    policy: { limit: 4, windowSeconds: 600, cooldownSeconds: 600 },
    now
  })));
  assert.equal(results.filter(x => x.status === 200).length, 4);
  assert.equal(results.filter(x => x.status === 429).length, 32);
  assert.ok(results.slice(4).every(x => x.body.code === "security-rate-limited"));
});
