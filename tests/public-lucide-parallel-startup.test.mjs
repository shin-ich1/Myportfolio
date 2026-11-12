import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const script = html.match(/<script\b[^>]*src="https:\/\/unpkg\.com\/lucide@0\.468\.0\/dist\/umd\/lucide\.min\.js"[^>]*><\/script>/)?.[0] || "";

function readinessOwner() {
  const start = app.indexOf("function waitForPublicLucide() {");
  const end = app.indexOf("\nconst publicLucideReady = waitForPublicLucide();", start);
  assert.ok(start >= 0 && end > start, "Missing canonical Lucide readiness owner");
  return app.slice(start, end);
}

function readinessHarness(initialLucide = null, missingScript = false) {
  const listeners = new Map();
  const node = {
    addEventListener(name, listener, options) {
      assert.equal(options?.once, true, "Readiness callbacks must be one-shot");
      assert.ok(!listeners.has(name), "No duplicate listeners");
      listeners.set(name, listener);
    }
  };
  const window = { lucide: initialLucide };
  const document = {
    querySelector(selector) {
      assert.equal(selector, "script[data-public-lucide]");
      return missingScript ? null : node;
    }
  };
  const wait = new Function("document", "window", readinessOwner() + "\nreturn waitForPublicLucide;")(document, window);
  return { wait, window, listeners };
}

test("Public Lucide is non-parser-blocking without changing the pinned icon library", () => {
  assert.ok(script, "Keep existing pinned Lucide URL");
  assert.match(script, /\sasync(?:\s|>)/, "Lucide should not gate main application module execution");
  assert.doesNotMatch(script, /\sdefer(?:\s|>)/, "Do not combine async and defer");
  assert.match(script, /\sdata-public-lucide(?:\s|>)/, "Readiness owner must find the canonical script");
  assert.equal((html.match(/lucide\.min\.js/g) || []).length, 1, "Do not load the icon library twice");
});

test("Lucide and Firebase start independently but full portfolio renders with icons ready", () => {
  assert.match(app, /\nconst publicLucideReady = waitForPublicLucide\(\);/);
  const boot = app.slice(app.lastIndexOf("\n(async () => {"));
  assert.match(boot, /const ready = await initFirebase\(\);[\s\S]*?await publicLucideReady;\s*render\(\);/,
    "Run Firestore without waiting for Lucide, then render the complete portfolio after both");
  assert.match(boot, /await loadEmergencyFallback\(error\);\s*await publicLucideReady;\s*render\(\);/,
    "Emergency rendering must preserve icon readiness too");
  assert.match(app, /bindPublicMediaFrames\(app\);\s*window\.lucide\?\.createIcons\(\);/,
    "Keep existing renderer as the only owner of initial icon hydration");
  assert.match(app, /function renderPublicMessageStart\([\s\S]*?window\.lucide\?\.createIcons\(\);/,
    "Messages must retain their existing icon handling");
});

test("Readiness resolves immediately when Lucide was already downloaded", async () => {
  const view = readinessHarness({ createIcons() {} });
  await view.wait();
  assert.equal(view.listeners.size, 0, "Already loaded script must not register late listeners");
});

test("Slow Lucide load does not block module setup and readiness settles on load or error", async () => {
  for (const terminalEvent of ["load", "error"]) {
    const view = readinessHarness();
    let settled = false;
    const ready = view.wait().then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, "Wait only at final complete-portfolio render boundary");
    assert.deepEqual([...view.listeners.keys()], ["load", "error"]);
    view.listeners.get(terminalEvent)();
    await ready;
    assert.equal(settled, true, terminalEvent + " must settle the gate");
  }
});

test("Missing Lucide element must not leave the loader stuck forever", async () => {
  const view = readinessHarness(null, true);
  await view.wait();
  assert.equal(view.listeners.size, 0);
});
