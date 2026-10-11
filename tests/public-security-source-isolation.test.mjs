import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const base = "0516c69aa52deca0e459e1c4d2baf7b62093bc59";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const oldSource = path => git("show", `${base}:${path}`);
const current = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

function withoutVerifierImplementation(source) {
  const start = source.indexOf("async function loadPublicMessagePuzzleChallenge() {");
  const end = source.indexOf("\nasync function openPublicMessagePuzzleVerification(", start);
  assert.ok(start >= 0 && end > start, "One canonical Public verification owner is required");
  assert.equal(source.indexOf("async function loadPublicMessagePuzzleChallenge() {", start + 1), -1);
  return source.slice(0, start) + "[CANONICAL-PUBLIC-MESSAGE-VERIFIER]" + source.slice(end);
}

function withoutTurnstileSlotRule(source) {
  const matches = source.match(/\.public-message-turnstile-slot\{[^}]*\}/g);
  assert.equal(matches?.length, 1, "Only the canonical widget slot CSS may be changed");
  return source.replace(/\.public-message-turnstile-slot\{[^}]*\}/, "[CANONICAL-TURNSTILE-SLOT]");
}

test("Staging security revision preserves audited Public application outside one verifier owner", () => {
  assert.equal(git("rev-parse", `${base}:app.js`).trim(), "36e3309406322038d353d7f74ac739ffb8b73ec0");
  assert.equal(withoutVerifierImplementation(current("app.js")), withoutVerifierImplementation(oldSource("app.js")));
});

test("Public styles are unchanged apart from the canonical Cloudflare widget slot rule", () => {
  assert.equal(git("rev-parse", `${base}:styles.css`).trim(), "ec2f4078616f7435a5c9cc1a646fa44eb9db5f4c");
  assert.equal(withoutTurnstileSlotRule(current("styles.css")), withoutTurnstileSlotRule(oldSource("styles.css")));
});

test("Only the five approved code, test and canonical CI ownership files differ from staging release", () => {
  const allowed = new Set([
    ".github/workflows/admin-performance-regression.yml",
    "app.js",
    "styles.css",
    "tests/public-turnstile-lifecycle-regression.test.mjs",
    "tests/public-turnstile-mobile-regression.test.mjs",
    "tests/public-security-source-isolation.test.mjs"
  ]);
  const changed = git("diff", "--name-only", base, "HEAD").trim().split("\n").filter(Boolean);
  assert.ok(changed.includes("app.js") && changed.includes("styles.css"), "The security-only Public change must be explicit");
  assert.ok(changed.every(path => allowed.has(path)), "Unreviewed source changes are prohibited: " + changed.filter(path => !allowed.has(path)).join(", "));
});
