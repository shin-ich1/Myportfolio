import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Production's audited main remains the canonical Public baseline. A release
// exception is limited to the two already-reviewed public message functions,
// its single Firestore subscription, and the existing Turnstile slot rule.
const main = "2cc642e1190469dbe8ee77f130413dae09f1ab6d";
const repo = new URL("../", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trimEnd();
const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const original = path => execFileSync("git", ["show", main + ":" + path], { cwd: repo, encoding: "utf8" });
const withoutFunction = (sourceText, start, stop, label) => {
  const i = sourceText.indexOf(start);
  const j = sourceText.indexOf(stop, i);
  assert.ok(i >= 0 && j > i, "Exactly one canonical " + label + " owner required");
  assert.equal(sourceText.indexOf(start, i + 1), -1);
  return sourceText.slice(0, i) + "[AUDITED " + label + "]" + sourceText.slice(j);
};
// Normalize only the explicitly reviewed start-form retry UX additions; the
// exact full-file SHA above still forbids any other unreviewed source drift.
const withoutImageFailureRetryUX = sourceText => {
  let text = sourceText;
  const patches = [
    ["let publicMessageRetryTimerId = null;\nlet publicMessageRetryUntil = 0;\n", ""],
    ["  stopPublicMessageRetryCountdown();\n  publicMessagePuzzleChallenge = null;", "  publicMessagePuzzleChallenge = null;"],
    ["  if (publicMessageRetryUntil > Date.now()) return;\n", ""]
  ];
  for (const [before, after] of patches) {
    assert.equal(text.split(before).length, 2, "Exactly one approved retry-UX change required");
    text = text.replace(before, after);
  }
  const begin = text.indexOf("function stopPublicMessageRetryCountdown() {");
  const end = text.indexOf("function closePublicMessagePuzzleVerification(", begin);
  assert.ok(begin > 0 && end > begin, "Exactly one canonical retry timer must precede puzzle close");
  assert.equal(text.indexOf("function stopPublicMessageRetryCountdown() {", begin + 1), -1);
  return text.slice(0, begin) + text.slice(end);
};
const withoutPublicOwners = text => {
  let result = text.replace(/^  getPrivateVisitorThread,\n/m, ""); // obsolete consumer removed
  result = withoutFunction(result, "async function loadPublicMessagePuzzleChallenge() {", "\nasync function openPublicMessagePuzzleVerification(", "Turnstile verifier");
  result = withoutFunction(result, "async function openPublicMessageComposer() {", "\nasync function submitPublicMessage(", "visitor composer");
  return result;
};
const withoutThreadOwner = text => withoutFunction(text, "export function subscribePrivateVisitorThread(", "\nexport async function sendPrivateVisitorMessage(", "visitor Firestore subscriber");
const withoutTurnstileSlot = text => {
  assert.equal((text.match(/\.public-message-turnstile-slot\{/g) || []).length, 1);
  return text.replace(/\.public-message-turnstile-slot\{[^}]*\}/, "[AUDITED EXISTING TURNSTILE CSS SLOT]");
};

test("Audited Public app is frozen outside two canonical message owners and obsolete import", () => {
  assert.equal(git("rev-parse", main + ":app.js"), "f156424e6adf216da6660648dc634319e340aa4a");
  // Exact reviewed app.js fingerprint updated for the single authorized expired-puzzle
  // controller correction; no Public code outside the canonical owner changed.
  assert.equal(git("hash-object", "app.js"), "6b4c27a79a4e1d66a3549c09fa719f14059cacad");
  assert.equal(withoutPublicOwners(withoutImageFailureRetryUX(source("app.js"))), withoutPublicOwners(original("app.js")));
});
test("Only reviewed Turnstile slot and puzzle grid row may differ from audited Public styles", () => {
  assert.equal(git("rev-parse", main + ":styles.css"), "ec2f4078616f7435a5c9cc1a646fa44eb9db5f4c");
  assert.equal(git("hash-object", "styles.css"), "c501127a56458d3fb35eaf760e0b6f050af3c965");
  const patch = "grid-auto-rows:max-content;";
  let reviewed = withoutTurnstileSlot(source("styles.css"));
  assert.equal(reviewed.split(patch).length, 2, "Exactly one reviewed canonical grid-row correction");
  const owner = ".public-message-puzzle-card{--public-puzzle-progress:0%;display:grid;";
  assert.ok(reviewed.includes(owner + patch), "Grid-row correction must be at canonical puzzle card owner");
  reviewed = reviewed.replace(owner + patch, owner);
  const scopedChanges = [
    ["overflow:auto;scrollbar-width:none}.public-message-puzzle-card::-webkit-scrollbar{display:none}",
      "overflow:auto}"],
    [".public-message-puzzle-foot{position:absolute;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}",
      ".public-message-puzzle-foot{display:grid;min-width:0}"]
  ];
  for (const [before, after] of scopedChanges) {
    assert.equal(reviewed.split(before).length, 2, "Exactly one reviewed hidden-status/scrollbar owner");
    reviewed = reviewed.replace(before, after);
  }
  assert.equal(reviewed, withoutTurnstileSlot(original("styles.css")));
});
test("Public messaging Firestore module preserves all other canonical functions", () => {
  assert.equal(git("rev-parse", main + ":message-service.js"), "764a353722a63067b0335f80c17c09fbbfc00a06");
  assert.equal(git("hash-object", "message-service.js"), "fbbe71500e856d0c553edf689bc2c293fbbc5079");
  assert.equal(withoutThreadOwner(source("message-service.js")), withoutThreadOwner(original("message-service.js")));
});
test("Public messaging security still requires server-verified one-time Cloudflare and slider proof", () => {
  const app=source("app.js"),worker=source("telemetry-worker/src/index.js");
  assert.match(app,/const turnstileToken = await runTurnstile\(\)/);
  assert.match(app,/verifyPrivateMessageChallenge\(\{[\s\S]*?answer:[\s\S]*?turnstileToken/);
  assert.match(worker,/async function verifyTurnstile\(request, env, token\)/);
  assert.match(worker,/result\?\.success !== true/);
  assert.match(worker,/String\(result\.hostname \|\| ""\)\.toLowerCase\(\) !== config\.host/);
  assert.match(worker,/String\(result\.action \|\| ""\) !== PRIVATE_MESSAGE_ACTION/);
});
