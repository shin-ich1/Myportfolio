import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const publicSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");

test("Public Turnstile renders compact when the verification slot is under the 300px flexible minimum", () => {
  assert.match(publicSource, /size:\s*slot\.getBoundingClientRect\(\)\.width\s*<\s*300\s*\?\s*"compact"\s*:\s*"flexible"/);
});

function executionHarness() {
  const snippet = publicSource.match(/    let pendingTurnstileResolve = null;([\s\S]*?)    publicMessageTurnstileWidgetId = turnstile\.render\(slot, \{/);
  assert.ok(snippet, "Expected one canonical Turnstile execution owner in app.js");

  const scheduled = [];
  const cleared = [];
  const executed = [];
  const globals = {
    cleanText: (value) => String(value ?? "").trim(),
    publicMessageTurnstileWidgetId: "widget-1",
    turnstile: { execute: (id) => executed.push(id) },
    window: {
      setTimeout(fn, delayMs) {
        scheduled.push({ fn, delayMs });
        return scheduled.length;
      },
      clearTimeout(id) { cleared.push(id); }
    }
  };
  const api = vm.runInNewContext(
    `let pendingTurnstileResolve = null;${snippet[1]}({ runTurnstile, finishTurnstile });`,
    globals
  );
  return { ...api, scheduled, cleared, executed };
}

test("A Turnstile execution with no callback times out and does not hold the puzzle forever", async () => {
  const harness = executionHarness();
  const pending = harness.runTurnstile();
  assert.deepEqual(harness.executed, ["widget-1"]);
  assert.equal(harness.scheduled.length, 1);
  assert.ok(harness.scheduled[0].delayMs > 0 && harness.scheduled[0].delayMs <= 60000);
  harness.scheduled[0].fn();
  await assert.rejects(pending, /timed out/i);
  assert.deepEqual(harness.cleared, [1]);
});

test("Turnstile success resolves once and cancels the execution timeout", async () => {
  const harness = executionHarness();
  const pending = harness.runTurnstile();
  harness.finishTurnstile(null, "  sample-token  ");
  assert.equal(await pending, "sample-token");
  assert.deepEqual(harness.cleared, [1]);
  harness.scheduled[0].fn();
  assert.deepEqual(harness.cleared, [1]);
});

test("Server-side Siteverify, action, and hostname gates remain mandatory", () => {
  assert.match(workerSource, /async function verifyTurnstile\(request, env, token\)/);
  assert.match(workerSource, /result\?\.success !== true/);
  assert.match(workerSource, /String\(result\.action \|\| ""\) !== PRIVATE_MESSAGE_ACTION/);
  assert.match(workerSource, /String\(result\.hostname \|\| ""\)\.toLowerCase\(\) !== config\.host/);
});
