import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const worker = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");

function turnstileHarness() {
  const snippet = app.match(/    let pendingTurnstileResolve = null;([\s\S]*?)    publicMessageTurnstileWidgetId = turnstile\.render\(slot, \{/);
  assert.ok(snippet, "Must keep one canonical Turnstile promise/callback owner");
  const timeouts = [];
  const cleared = [];
  const globals = {
    cleanText: (value) => String(value || "").trim(),
    publicMessageTurnstileWidgetId: "staging-widget",
    turnstile: { isExpired: () => false },
    Date: { now: () => 100000 },
    window: {
      setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
      clearTimeout(handle) { cleared.push(handle); }
    }
  };
  const api = vm.runInNewContext(
    `let pendingTurnstileResolve = null;${snippet[1]}({ runTurnstile, finishTurnstile });`,
    globals
  );
  return { ...api, timeouts, cleared };
}

test("Turnstile pre-executes at widget render; slider remains mandatory before server proof", () => {
  assert.match(app, /execution:\s*"render"/);
  assert.match(app, /appearance:\s*"interaction-only"/);
  assert.match(app, /slider\.onchange = async \(\) => \{/);
  assert.match(app, /const turnstileToken = await runTurnstile\(\)/);
  assert.match(app, /verifyPrivateMessageChallenge\(\{[\s\S]*?challengeId:[\s\S]*?answer:[\s\S]*?turnstileToken/);
  assert.doesNotMatch(app, /turnstile\.execute\(publicMessageTurnstileWidgetId\)/);
});

test("Wide-enough compact/mobile dialog uses flexible widget; narrow dialog uses compact", () => {
  const match = app.match(/size:\s*(slot\.parentElement\.getBoundingClientRect\(\)\.width\s*<\s*300\s*\?\s*"compact"\s*:\s*"flexible")/);
  assert.ok(match, "Choose Turnstile by real space only, not mobile/document-flow mode");
  const choose = new Function("slot", `return (${match[1]});`);
  const slot = (width) => ({ parentElement: { getBoundingClientRect: () => ({ width }) } });
  assert.equal(choose(slot(324)), "flexible");
  assert.equal(choose(slot(299)), "compact");
  assert.match(styles, /\.public-message-turnstile-slot\{[^}]*place-items:center/);
});

test("Precompleted Cloudflare token can be consumed after the visitor slides, without re-executing", async () => {
  const h = turnstileHarness();
  h.finishTurnstile(null, "  short-lived-token  ");
  const token = await h.runTurnstile();
  assert.equal(token, "short-lived-token");
  assert.equal(h.timeouts.length, 0);
  const second = h.runTurnstile();
  assert.equal(h.timeouts.length, 1, "A completed token must not be reused");
  h.timeouts[0].fn();
  await assert.rejects(second, /timed out/i);
});

test("Expired Turnstile tokens cannot be reused, even if slide happens later", async () => {
  const h = turnstileHarness();
  h.finishTurnstile(null, "old-token");
  h.finishTurnstile(new Error("Secure browser verification expired."));
  const pending = h.runTurnstile();
  assert.equal(h.timeouts.length, 1);
  h.timeouts[0].fn();
  await assert.rejects(pending, /timed out/i);
});

test("Failed challenge gives an actionable timeout and safe numeric Cloudflare error without secrets", () => {
  assert.match(app, /"error-callback":\s*\(errorCode\)/);
  assert.match(app, /String\(errorCode\)/);
  assert.match(app, /"unsupported-callback"/);
  assert.match(app, /Complete the Cloudflare check/i);
  assert.doesNotMatch(app, /console\.(?:log|warn|error)\([^\n]*(?:turnstileToken|challenge\.siteKey)/);
});

test("Security architecture is untouched: mandatory Siteverify, action, hostname and one-use server proof", () => {
  assert.match(worker, /async function verifyTurnstile\(request, env, token\)/);
  assert.match(worker, /result\?\.success !== true/);
  assert.match(worker, /String\(result\.action \|\| ""\) !== PRIVATE_MESSAGE_ACTION/);
  assert.match(worker, /String\(result\.hostname \|\| ""\)\.toLowerCase\(\) !== config\.host/);
  assert.match(app, /await sendPendingPublicMessage\(verified\.verificationToken\)/);
});
