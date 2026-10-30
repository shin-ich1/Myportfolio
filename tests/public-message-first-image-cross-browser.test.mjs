import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const warmStart = app.indexOf("function publicMessagePuzzleWarmupFresh()");
const warmEnd = app.indexOf("\nasync function takePublicMessagePuzzleWarmup()", warmStart);
const puzzleStart = app.indexOf("async function loadPublicMessagePuzzleChallenge()");
const puzzleEnd = app.indexOf("\nasync function openPublicMessagePuzzleVerification(", puzzleStart);
const cleanupStart = app.indexOf("function destroyPublicMessagePuzzleVerification()");
const cleanupEnd = app.indexOf("\nfunction publicMessagePuzzleImageUrl(", cleanupStart);
const puzzleOwner = app.slice(puzzleStart, puzzleEnd);
const cleanupOwner = app.slice(cleanupStart, cleanupEnd);

test("Puzzle image preloading starts even while mobile/other-browser Turnstile script is still loading", async () => {
  assert.ok(warmStart >= 0 && warmEnd > warmStart, "Expected one canonical puzzle warmup owner");
  const createWarm = new Function(
    "createPrivateMessageChallenge", "loadPublicMessageTurnstileApi", "preloadPublicMessagePuzzleImage",
    "let publicMessagePuzzleWarmupPromise = null; let publicMessagePuzzleWarmup = null;\n" +
    "const PUBLIC_MESSAGE_PUZZLE_WARMUP_MAX_AGE_MS = 120000;\n" +
    app.slice(warmStart, warmEnd) + "\nreturn warmPublicMessagePuzzleChallenge;"
  );
  let releaseTurnstile;
  const turnstileBlocked = new Promise(resolve => { releaseTurnstile = resolve; });
  let imagePreloads = 0;
  const warm = createWarm(
    async () => ({ challengeId: "fake-challenge", siteKey: "test-key", image: { url: "https://example.invalid/puzzle.jpg" } }),
    () => turnstileBlocked,
    async () => { imagePreloads++; }
  );
  const pending = warm();
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(imagePreloads, 1,
      "Preparing the puzzle image must not be blocked on Cloudflare's external script");
  } finally {
    releaseTurnstile({ render() {} });
    await pending;
  }
});

test("Puzzle geometry supports browsers without ResizeObserver and cleans up its fallback", () => {
  assert.ok(puzzleOwner, "Expected canonical Public puzzle controller");
  assert.match(puzzleOwner, /typeof ResizeObserver === "function"/);
  assert.match(puzzleOwner, /addEventListener\("resize", syncPublicMessagePuzzleGeometry/);
  assert.match(app, /removeEventListener\("resize", syncPublicMessagePuzzleGeometry/);
  assert.match(cleanupOwner, /stopPublicMessagePuzzleGeometryWatch\(\)/);
});

test("Turnstile has bounded completion and a reusable retry after errors", () => {
  assert.match(puzzleOwner, /window\.setTimeout\([^]*?Secure browser verification took too long/);
  assert.match(puzzleOwner, /window\.clearTimeout\(turnstileWatchdog\)/);
  assert.match(puzzleOwner, /turnstile\.reset\?\.\(publicMessageTurnstileWidgetId\)/);
  assert.match(cleanupOwner, /publicMessageTurnstileCancel\?\.\(\)/);
  // All protections are retained; a browser failure must never mint an unchecked proof.
  assert.match(puzzleOwner, /verifyPrivateMessageChallenge\(/);
  assert.match(puzzleOwner, /sendPendingPublicMessage\(verified\.verificationToken\)/);
});


test("Compact Turnstile is selected in narrow/mobile puzzle while wide desktop retains flexible mode", () => {
  assert.match(puzzleOwner, /slot\.parentElement\.getBoundingClientRect\(\)\.width/);
  assert.doesNotMatch(puzzleOwner, /slot\.getBoundingClientRect\(\)\.width\s*<\s*300/);
  const choice = puzzleOwner.match(/size:\s*(isPublicDocumentFlowMode\(\)\s*\|\|\s*slot\.parentElement\.getBoundingClientRect\(\)\.width\s*<\s*300\s*\?\s*"compact"\s*:\s*"flexible")/);
  assert.ok(choice, "Responsive widget must reuse canonical document flow and measured visible parent; not hidden empty slot");
  const decide = new Function("isPublicDocumentFlowMode", "slot", "return (" + choice[1] + ");");
  const size = (mobile, width) => decide(() => mobile, {
    getBoundingClientRect: () => ({ width: 0 }),
    parentElement: { getBoundingClientRect: () => ({ width }) }
  });
  assert.equal(size(true, 328), "compact");
  assert.equal(size(false, 260), "compact");
  assert.equal(size(false, 370), "flexible");
});

test("No alternate mobile-only puzzle, disabled verification, or backend proof bypass", () => {
  const worker = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
  assert.match(puzzleOwner, /verifyPrivateMessageChallenge\(/);
  assert.match(puzzleOwner, /sendPendingPublicMessage\(verified\.verificationToken\)/);
  assert.match(worker, /String\(result\.action \|\| ""\) !== PRIVATE_MESSAGE_ACTION/);
  assert.match(worker, /String\(result\.hostname \|\| ""\)\.toLowerCase\(\) !== config\.host/);
});

test("Turnstile loader is bounded on browsers where the third-party script never completes", () => {
  const start = app.indexOf("function loadPublicMessageTurnstileApi()");
  const end = app.indexOf("\nfunction preloadPublicMessagePuzzleImage(", start);
  assert.ok(start >= 0 && end > start);
  const owner = app.slice(start, end);
  assert.match(owner, /window\.setTimeout\(/, "A stalled third-party script needs a watchdog");
  assert.match(owner, /window\.clearTimeout\(/, "Watchdog must be canceled on success or failure");
  assert.match(owner, /script\.remove\(/, "Failed script must be replaceable on retry");
  assert.match(owner, /publicMessageTurnstileScriptPromise = null/, "Retry uses existing single script Promise owner");
});

test("Mobile widget's adaptive mode comes from the existing imported owner", () => {
  assert.match(app, /import\s*\{\s*initPublicAdaptiveMode,\s*isPublicDocumentFlowMode\s*\}\s*from\s*["']\.\/public-adaptive\.js["']/);
  const adaptive = readFileSync(new URL("../public-adaptive.js", import.meta.url), "utf8");
  assert.match(adaptive, /export function isPublicDocumentFlowMode\(\)/);
});
