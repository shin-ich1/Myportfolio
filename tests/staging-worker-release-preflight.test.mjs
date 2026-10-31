import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const staging = JSON.parse(readFileSync(new URL("../telemetry-worker/wrangler.staging.jsonc", import.meta.url), "utf8"));
const production = JSON.parse(readFileSync(new URL("../telemetry-worker/wrangler.jsonc", import.meta.url), "utf8"));

test("Staging Worker release preflight must never target LIVE Worker, Firebase or KV namespaces", () => {
  assert.equal(staging.name, "lan-portfolio-staging");
  assert.notEqual(staging.name, production.name);
  assert.equal(staging.main, "src/index.js", "Use canonical Worker module, not a competing copy");
  assert.equal(staging.vars.FIREBASE_PROJECT_ID, "lan-portfolio-staging");
  assert.notEqual(staging.vars.FIREBASE_PROJECT_ID, production.vars.FIREBASE_PROJECT_ID);
  assert.deepEqual(Object.keys(staging.vars), ["FIREBASE_PROJECT_ID"],
    "Dashboard secrets/Turnstile site key must not be replaced by Wrangler vars");
  const expected = new Map([
    ["PORTFOLIO_MESSAGES", "2802de517de743a6b4b2d1620b097bf7"],
    ["STORAGE_OAUTH", "8cdeb79f52944659a71101381f041152"]
  ]);
  const got = new Map(staging.kv_namespaces.map(item => [item.binding, item.id]));
  assert.equal(got.size, expected.size);
  assert.deepEqual([...got].sort(), [...expected].sort(),
    "Preserve the staging namespace identifiers recorded in the historical staging manifest");
  for (const pair of production.kv_namespaces) {
    assert.ok(![...got.values()].includes(pair.id), "Must not bind production KV namespaces");
  }
  assert.deepEqual(staging.durable_objects.bindings,
    [{ name: "SECURITY_COORDINATOR", class_name: "SecurityCoordinator" }]);
  assert.deepEqual(staging.exports,
    { SecurityCoordinator: { type: "durable-object", storage: "sqlite" } });
});

test("Staging deployment must retain existing Turnstile secrets and Worker policy", () => {
  assert.equal(staging.keep_vars, true, "Preserve dashboard-managed plain vars across Wrangler deployments");
  assert.equal(staging.preview_urls, false, "Do not unexpectedly enable Cloudflare public preview URLs");
  assert.deepEqual(staging.observability, { enabled: true, logs: { enabled: true } });
  assert.equal(staging.compatibility_date, "2026-08-15");
  const serialized = JSON.stringify(staging);
  assert.ok(!serialized.includes("rolando-portfolio-3f1a3"));
  assert.ok(!serialized.includes("lan-cloudinary-telemetry"));
  assert.ok(!serialized.includes("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY"));
  assert.ok(!serialized.includes("TURNSTILE_SECRET_KEY"));
  assert.ok(!serialized.includes("TURNSTILE_SITE_KEY"));
});
