import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../firebase.json", import.meta.url)), "utf8"));
const ignore = config.hosting?.ignore ?? [];

test("Firebase Hosting explicitly excludes Git contents, not just hidden directory names", () => {
  assert.equal(config.hosting?.public, ".", "Keep the current published site source until deployment migration is approved");
  assert.ok(ignore.includes("**/.git/**"), "Git metadata children must be explicitly excluded from root Hosting upload");
  assert.ok(ignore.includes("**/.firebase/**"), "Firebase local cache contents must never be deployed");
  assert.ok(ignore.includes("**/.github/**"), "Repository workflow contents must never be deployed");
});

test("Firebase Hosting excludes test and development-only directories", () => {
  assert.ok(ignore.includes("tests/**"), "Regression tests must not be served publicly");
  assert.ok(ignore.includes("**/node_modules/**"), "Dependencies are not public assets");
  assert.ok(ignore.includes("telemetry-worker/**"), "Worker server code must stay off Hosting");
  assert.ok(ignore.includes("scripts/**"), "Admin/deploy scripts must stay off Hosting");
});

test("Hosting retains existing public routing and deployment headers", () => {
  assert.deepEqual(config.hosting?.rewrites, [{source: "**", destination: "/index.html"}]);
  assert.ok(config.hosting.headers?.some(x => x.source === "**/*.js"));
});
