import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function loadOwner() {
  const match = html.match(/<script>\s*(window\.lanPublicLucideReady\s*=\s*new Promise\([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "Missing single canonical early Lucide readiness owner");
  return match[1];
}

function harness(terminalEvent = "load") {
  const listeners = new Map();
  let appendCount = 0;
  let url = "";
  const script = {
    async: false,
    addEventListener(name, listener, options) {
      assert.equal(options?.once, true, "Use one-shot load/error listeners");
      assert.ok(!listeners.has(name), "No duplicated listeners");
      listeners.set(name, listener);
    }
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, "script");
      return script;
    },
    head: {
      appendChild(node) {
        appendCount++;
        assert.equal(node, script);
        assert.equal(script.async, true, "Do not serialize independent script downloads");
        assert.deepEqual([...listeners.keys()], ["load", "error"],
          "Register both listeners before starting download, including cached/fast errors");
        url = script.src;
        if (terminalEvent === "synchronous-load") listeners.get("load")();
        return node;
      }
    }
  };
  const window = {};
  new Function("window", "document", loadOwner())(window, document);
  return {
    ready: window.lanPublicLucideReady,
    listeners,
    get appendCount() { return appendCount; },
    get url() { return url; }
  };
}

test("One pinned Lucide library starts asynchronously before the Public module graph", () => {
  const loader = loadOwner();
  assert.match(loader, /document\.createElement\("script"\)/);
  assert.match(loader, /script\.async = true/);
  assert.match(loader, /https:\/\/unpkg\.com\/lucide@0\.468\.0\/dist\/umd\/lucide\.min\.js/);
  assert.equal((html.match(/lucide\.min\.js/g) || []).length, 1);
  assert.ok(html.indexOf("window.lanPublicLucideReady") < html.indexOf('src="app.js"'));
  assert.doesNotMatch(html, /<script[^>]+lucide\.min\.js[^>]+\bdefer\b/,
    "Remove the deferred Lucide execution barrier");
});

test("Firebase and Lucide begin independently; the complete Public render waits for icons", () => {
  const boot = app.slice(app.lastIndexOf("\n(async () => {"));
  assert.match(boot, /const ready = await initFirebase\(\);[\s\S]*?await window\.lanPublicLucideReady;\s*render\(\);/,
    "Run Firestore without waiting for Lucide, then render the complete portfolio after both");
  assert.match(boot, /await loadEmergencyFallback\(error\);\s*await window\.lanPublicLucideReady;\s*render\(\);/,
    "Emergency render must preserve icon readiness too");
  assert.match(app, /bindPublicMediaFrames\(app\);\s*window\.lucide\?\.createIcons\(\);/,
    "Retain existing canonical icon hydration");
  assert.match(app, /function renderPublicMessageStart\([\s\S]*?window\.lucide\?\.createIcons\(\);/,
    "Message UI keeps its existing icon handling");
});

test("Slow Lucide request and CDN error both settle without indefinite loader", async () => {
  for (const event of ["load", "error"]) {
    const view = harness(event);
    assert.equal(view.appendCount, 1);
    assert.equal(view.url, "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js");
    let done = false;
    const pending = view.ready.then(() => { done = true; });
    await Promise.resolve();
    assert.equal(done, false);
    view.listeners.get(event)();
    await pending;
    assert.equal(done, true);
  }
});

test("Cached Lucide that completes during script insertion cannot lose its load event", async () => {
  const view = harness("synchronous-load");
  await view.ready;
  assert.equal(view.appendCount, 1);
  assert.equal(view.url, "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js");
});

test("No additional messaging/puzzle/network owner is introduced by the icon loader", () => {
  const loader = loadOwner();
  assert.doesNotMatch(loader, /firebase|firestore|message|puzzle|window\.lucide\?\.createIcons/);
  assert.doesNotMatch(loader, /onload=|onerror=|innerHTML|eval\(/);
});
