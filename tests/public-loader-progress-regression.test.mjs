import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const loaderScript = scripts.map(match => match[1]).find(script => script.includes("data-loader-retry"));
assert.ok(loaderScript, "Use the existing index.html loader-status owner");

function runLoader() {
  const callbacks = new Map();
  let reloads = 0;
  let retryListener = null;
  let hidden = false;
  const status = { textContent: "Loading portfolio" };
  const retry = {
    hidden: true,
    addEventListener(type, handler) {
      assert.equal(type, "click");
      assert.equal(retryListener, null, "Must not install competing retry click handlers");
      retryListener = handler;
    }
  };
  const loader = {
    classList: { contains: value => value === "is-hidden" && hidden },
    querySelector: selector => selector === "[data-loader-status]" ? status
      : selector === "[data-loader-retry]" ? retry : null
  };
  runInNewContext(loaderScript, {
    document: {
      querySelector: selector => selector === "[data-loader-retry]" ? retry : null,
      getElementById: id => id === "siteLoader" ? loader : null
    },
    location: { reload: () => { reloads++; } },
    setTimeout: (callback, delay) => {
      assert.equal(callbacks.has(delay), false, "One canonical timer per phase");
      callbacks.set(delay, callback);
    }
  });
  return { callbacks, status, retry, setHidden: value => { hidden = value; },
    clickRetry: () => retryListener?.(), get reloads() { return reloads; } };
}

test("At seven seconds a still-running initial load shows honest progress, not a false failure or retry", () => {
  const runtime = runLoader();
  assert.equal(runtime.callbacks.size, 2);
  runtime.callbacks.get(7000)?.();
  assert.match(runtime.status.textContent, /still loading/i);
  assert.doesNotMatch(runtime.status.textContent, /longer to load|failed|error/i);
  assert.equal(runtime.retry.hidden, true, "No retry prompt while a normal slow startup is pending");
});

test("Only a prolonged stall presents an optional reload without bypassing startup", () => {
  const runtime = runLoader();
  const deadlines = [...runtime.callbacks.keys()].sort((a,b) => a-b);
  assert.deepEqual(deadlines, [7000,35000]);
  runtime.callbacks.get(7000)();
  assert.equal(runtime.retry.hidden, true);
  runtime.callbacks.get(35000)();
  assert.match(runtime.status.textContent, /taking longer/i);
  assert.equal(runtime.retry.hidden, false);
  assert.equal(runtime.reloads, 0, "No automatic reload or duplicate requests");
  runtime.clickRetry();
  assert.equal(runtime.reloads, 1, "Preserve explicit user-controlled retry");
});

test("After a successful initial render, overdue callbacks cannot reopen the recovery UI", () => {
  const runtime = runLoader();
  runtime.setHidden(true);
  runtime.callbacks.get(7000)();
  runtime.callbacks.get(35000)();
  assert.equal(runtime.status.textContent, "Loading portfolio");
  assert.equal(runtime.retry.hidden, true);
  assert.match(app, /requestAnimationFrame\(\(\) => document\.querySelector\("#siteLoader"\)\?\.classList\.add\("is-hidden"\)\)/,
    "The existing startup owner must hide the loader in finally");
});

test("Recovery button is visible only in a stall and the normal retry source remains static", () => {
  assert.equal((loaderScript.match(/location\.reload\(\)/g)||[]).length, 1);
  assert.equal((html.match(/data-loader-retry hidden/g)||[]).length, 1);
  assert.equal((html.match(/id="siteLoader"/g)||[]).length, 1);
  assert.ok(!loaderScript.includes("fetch("), "Never add extra network or Firestore calls in loader UI");
});
