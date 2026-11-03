import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
function owner(start, stop) {
  const a = app.indexOf(start);
  const b = app.indexOf(stop, a + start.length);
  assert.ok(a >= 0 && b > a, "Missing canonical Public Message owner: " + start);
  assert.equal(app.indexOf(start, a + 1), -1, "Duplicate Public Message owner: " + start);
  return app.slice(a, b);
}
const warmup = owner("function publicMessagePuzzleWarmupFresh()", "\nasync function takePublicMessagePuzzleWarmup()");
const puzzle = owner("async function loadPublicMessagePuzzleChallenge()", "\nasync function openPublicMessagePuzzleVerification(");

function prepareWithBlockedTurnstile() {
  let unblock;
  const script = new Promise((resolve) => { unblock = resolve; });
  let preloads = 0;
  let apiStarts = 0;
  const factory = new Function(
    "createPrivateMessageChallenge", "loadPublicMessageTurnstileApi", "preloadPublicMessagePuzzleImage",
    "let publicMessagePuzzleWarmupPromise = null; let publicMessagePuzzleWarmup = null;\n" +
    "const PUBLIC_MESSAGE_PUZZLE_WARMUP_MAX_AGE_MS = 120000;\n" +
    warmup + "\nreturn warmPublicMessagePuzzleChallenge;"
  );
  const warm = factory(
    async () => ({ challengeId: "fake-challenge", siteKey: "fake-site-key", image: { url: "https://example.invalid/test.jpg" } }),
    () => { apiStarts++; return script; },
    async () => { preloads++; }
  );
  return { warm, unblock, get preloads() { return preloads; }, get apiStarts() { return apiStarts; } };
}

test("Puzzle image preloads without waiting for the third-party Turnstile JavaScript", async () => {
  const h = prepareWithBlockedTurnstile();
  const pending = h.warm();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.preloads, 1, "Image work must start while the Cloudflare script is pending");
  } finally {
    h.unblock({ render() {} });
    await pending;
  }
});

test("A prepared image is independent of Turnstile script readiness; verification remains mandatory", async () => {
  assert.match(warmup, /preloadPublicMessagePuzzleImage\(challenge\)/);
  assert.doesNotMatch(warmup, /await Promise\.all\(\[createPrivateMessageChallenge\(\), loadPublicMessageTurnstileApi\(\)\]\)/);
  assert.match(puzzle, /await loadPublicMessagePuzzleImage\(image, pieceImage, scene, challenge\)/);
  assert.match(puzzle, /await loadPublicMessageTurnstileApi\(\)/, "Verification must still load before any proof");
  assert.match(puzzle, /execution:\s*"render"/, "Preserve newer render-time verification flow");
  assert.match(puzzle, /await runTurnstile\(\)/, "Correct alignment must still require browser proof");
  assert.match(puzzle, /verifyPrivateMessageChallenge\(\{/, "Worker still verifies every answer");
  assert.match(puzzle, /sendPendingPublicMessage\(verified\.verificationToken\)/, "Only a verified proof sends");
});

function geometryHarness(resizeObserver) {
  const watch = owner("function stopPublicMessagePuzzleGeometryWatch()", "\nfunction destroyPublicMessagePuzzleVerification()");
  const calls = { added: [], removed: [], observed: [], disconnected: 0 };
  const window = {
    addEventListener: (event, fn) => calls.added.push({ event, fn }),
    removeEventListener: (event, fn) => calls.removed.push({ event, fn })
  };
  function ResizeObserver(fn) {
    if (typeof resizeObserver !== "function") throw new Error("ResizeObserver is unavailable");
    return resizeObserver(fn, calls);
  }
  const create = new Function(
    "window", "ResizeObserver", "syncPublicMessagePuzzleGeometry",
    "let publicMessagePuzzleResizeObserver = null; let publicMessagePuzzleResizeFallbackCleanup = null;\n" +
    watch + "\nreturn { startPublicMessagePuzzleGeometryWatch, stopPublicMessagePuzzleGeometryWatch };"
  );
  const sync = () => {};
  return { ...create(window, resizeObserver ? ResizeObserver : undefined, sync), calls, sync };
}

test("Browsers without ResizeObserver get one resize fallback and cleanup on reload/close", () => {
  const h = geometryHarness(null);
  const scene = {};
  h.startPublicMessagePuzzleGeometryWatch(scene);
  assert.deepEqual(h.calls.added.map((x) => x.event), ["resize"]);
  assert.equal(h.calls.added[0].fn, h.sync);
  h.startPublicMessagePuzzleGeometryWatch(scene);
  assert.equal(h.calls.removed.length, 1, "Previous listener must be removed before a replacement");
  assert.equal(h.calls.removed[0].fn, h.calls.added[0].fn);
  h.stopPublicMessagePuzzleGeometryWatch();
  assert.equal(h.calls.removed.length, 2, "Close/disposal must not leak an event listener");
  assert.equal(h.calls.removed[1].fn, h.calls.added[1].fn);
});

test("Browsers with ResizeObserver keep the existing observer owner without extra listeners", () => {
  const h = geometryHarness((fn, calls) => ({
    observe: (scene) => calls.observed.push(scene),
    disconnect: () => { calls.disconnected++; }
  }));
  const scene = {};
  h.startPublicMessagePuzzleGeometryWatch(scene);
  assert.deepEqual(h.calls.observed, [scene]);
  assert.deepEqual(h.calls.added, []);
  h.stopPublicMessagePuzzleGeometryWatch();
  assert.equal(h.calls.disconnected, 1);
});

test("Puzzle lifecycle and server validation remain owned by their existing modules", () => {
  const destroy = owner("function destroyPublicMessagePuzzleVerification()", "\nfunction publicMessagePuzzleImageUrl(");
  const close = owner("function closePublicMessagePuzzleVerification(", "\nasync function loadPublicMessagePuzzleChallenge()");
  assert.match(destroy, /stopPublicMessagePuzzleGeometryWatch\(\)/);
  assert.match(close, /stopPublicMessagePuzzleGeometryWatch\(\)/);
  assert.match(puzzle, /startPublicMessagePuzzleGeometryWatch\(scene\)/);
  assert.match(puzzle, /45000/, "Keep existing 45-second Turnstile execution bound");
  assert.match(puzzle, /turnstile\.reset\?\.\(publicMessageTurnstileWidgetId\)/);
  assert.match(worker, /async function verifyTurnstile\(request, env, token\)/);
  assert.match(worker, /result\?\.success !== true/);
  assert.match(worker, /String\(result\.action \|\| ""\) !== PRIVATE_MESSAGE_ACTION/);
  assert.match(worker, /String\(result\.hostname \|\| ""\)\.toLowerCase\(\) !== config\.host/);
});
