import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const publicSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("Public Turnstile sizes the widget by available dialog width, never by hidden slot width", () => {
  assert.match(styleSource, /\.public-message-turnstile-slot:empty\{display:none\}/);
  const match = publicSource.match(/size:\s*(slot\.parentElement\.getBoundingClientRect\(\)\.width\s*<\s*300\s*\?\s*"compact"\s*:\s*"flexible")/);
  assert.ok(match, "Sizing uses actual parent width; mobile mode alone must not force compact");
  assert.doesNotMatch(publicSource, /matchMedia\(["']\(max-width:/);
  const chooseSize = new Function("slot", `return (${match[1]});`);
  const sizeAt = (width) => chooseSize({ parentElement: { getBoundingClientRect: () => ({ width }) } });
  assert.equal(sizeAt(328), "flexible");
  assert.equal(sizeAt(300), "flexible");
  assert.equal(sizeAt(280), "compact");
});

function executionHarness() {
  const snippet = publicSource.match(/    let pendingTurnstileResolve = null;([\s\S]*?)    publicMessageTurnstileWidgetId = turnstile\.render\(slot, \{/);
  assert.ok(snippet, "Expected one canonical Turnstile execution owner in app.js");

  const scheduled = [];
  const cleared = [];
  const globals = {
    cleanText: (value) => String(value ?? "").trim(),
    publicMessageTurnstileWidgetId: "widget-1",
    turnstile: { isExpired: () => false },
    Date: { now: () => 100000 },
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
  return { ...api, scheduled, cleared };
}

test("A rendered Turnstile widget without callback times out and does not hold the puzzle forever", async () => {
  const harness = executionHarness();
  const pending = harness.runTurnstile();
  assert.equal(harness.scheduled.length, 1);
  assert.ok(harness.scheduled[0].delayMs > 0 && harness.scheduled[0].delayMs <= 60000);
  harness.scheduled[0].fn();
  await assert.rejects(pending, /timed out/i);
  assert.deepEqual(harness.cleared, [1]);
});

test("Turnstile success after slide resolves once and cancels the waiting timeout", async () => {
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
