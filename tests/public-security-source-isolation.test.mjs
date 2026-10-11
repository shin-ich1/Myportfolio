import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Immutable deployed PR12 staging baseline. This does not alter the stricter
// production/main frozen Public SHA contract.
const root = new URL("../", import.meta.url);
const base = "bf79dbba411a0e516c005f57b517443d8a90c81b";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const oldSource = path => git("show", `${base}:${path}`);
const current = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

function withoutComposerOwner(source) {
  const start = source.indexOf("async function openPublicMessageComposer() {");
  const end = source.indexOf("\nasync function submitPublicMessage(", start);
  assert.ok(start > 0 && end > start, "Single canonical Public conversation opener is mandatory");
  assert.equal(source.indexOf("async function openPublicMessageComposer() {", start + 1), -1);
  return (source.slice(0, start) + "[CANONICAL-CONVERSATION-OPENER]" + source.slice(end))
    // The old standalone getDoc consumer import was deleted after migration.
    .replace(/^  getPrivateVisitorThread,\n/m, "");
}

function withoutSubscriptionOwner(source) {
  const start = source.indexOf("export function subscribePrivateVisitorThread(");
  const end = source.indexOf("\nexport async function sendPrivateVisitorMessage(", start);
  assert.ok(start >= 0 && end > start, "Single canonical Firestore subscription owner is mandatory");
  assert.equal(source.indexOf("export function subscribePrivateVisitorThread(", start + 1), -1);
  return source.slice(0, start) + "[CANONICAL-VISITOR-SUBSCRIPTION]" + source.slice(end);
}

test("Only canonical conversation startup code may differ in Public app.js", () => {
  assert.equal(git("rev-parse", `${base}:app.js`).trim(), "361d81c7890ab1c00ac579039d8e1329feb86c11");
  assert.equal(withoutComposerOwner(current("app.js")), withoutComposerOwner(oldSource("app.js")));
});

test("Only existing authorized snapshot subscription owner may differ in message-service.js", () => {
  assert.equal(git("rev-parse", `${base}:message-service.js`).trim(), "764a353722a63067b0335f80c17c09fbbfc00a06");
  assert.equal(withoutSubscriptionOwner(current("message-service.js")), withoutSubscriptionOwner(oldSource("message-service.js")));
});

test("CSS and server-side security Worker remain byte-for-byte frozen", () => {
  assert.equal(git("rev-parse", `${base}:styles.css`).trim(), "0b051406a79279b6801ef71adeefa88dcaa46cba");
  assert.equal(current("styles.css"), oldSource("styles.css"));
  assert.equal(current("telemetry-worker/src/index.js"), oldSource("telemetry-worker/src/index.js"));
});

test("Staging changes are restricted to canonical Messenger owner, tests, and staging CI", () => {
  const allowed = new Set([
    ".github/workflows/admin-performance-regression.yml",
    ".github/workflows/pr11-staging-hosting.yml",
    "app.js",
    "message-service.js",
    "tests/pr11-staging-hosting-gate.test.mjs",
    "tests/public-messenger-conversation-lifecycle.test.mjs",
    "tests/public-security-source-isolation.test.mjs"
  ]);
  const changed = git("diff", "--name-only", base, "HEAD").trim().split("\n").filter(Boolean);
  assert.ok(changed.includes("app.js") && changed.includes("message-service.js"), "Both existing canonical owners must be reviewed");
  assert.ok(changed.every(path => allowed.has(path)), "Unreviewed source changed: " + changed.filter(path => !allowed.has(path)).join(", "));
});
