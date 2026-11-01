// Offline regression against the real canonical SecurityCoordinator class.
// Uses isolated in-memory KV; no network, production keys, Firebase, or Turnstile services.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
const coordinatorSource = readFileSync(new URL("../telemetry-worker/src/security-coordinator.js", import.meta.url), "utf8");
const toleranceMatch = worker.match(/\bconst MESSAGE_PUZZLE_TOLERANCE\s*=\s*(\d+)\s*;/);
assert.ok(toleranceMatch, "Real Worker must define the one canonical server-side puzzle tolerance");
const tolerance = Number(toleranceMatch[1]);
const { SecurityCoordinator } = await import(
  "data:text/javascript;base64," + Buffer.from(coordinatorSource).toString("base64")
);

const origin = "http://127.0.0.1:5500";
const binding = "offline-test-browser-binding";
const id = "ABCDEFGHIJKLMNOPQRSTUVWX";
const nonce = "0123456789abcdefghijklmn";
const nextGeometry = { targetPercent: 75, topPercent: 32, pieceScalePercent: 16 };

function fixture(targetPercent = 55) {
  const records = new Map([["record", {
    scope: "message-puzzle", targetPercent, topPercent: 25, pieceScalePercent: 16,
    attempts: 0, origin, binding, image: { id: "offline-image" },
    expiresAt: Date.now() + 60_000
  }]]);
  const kv = {
    get: key => records.get(key),
    put: (key, value) => records.set(key, structuredClone(value)),
    delete: key => records.delete(key)
  };
  const coordinator = new SecurityCoordinator({ storage: { kv, setAlarm: async () => {} } });
  return {
    get record() { return records.get("record"); },
    async check(answer, extras = {}) {
      const response = await coordinator.fetch(new Request("http://127.0.0.1/coordinator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "puzzle-check", scope: "message-puzzle", id,
          origin, binding, answer, tolerance, maxAttempts: 3,
          nextGeometry, verificationNonce: nonce,
          ...extras
        })
      }));
      return { status: response.status, ...(await response.json()) };
    },
    async finalize(verificationNonce = nonce) {
      const response = await coordinator.fetch(new Request("http://127.0.0.1/coordinator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "puzzle-finalize", scope: "message-puzzle", id, verificationNonce
        })
      }));
      return { status: response.status, ...(await response.json()) };
    }
  };
}

test("Visible 3%-off slider is rejected, consumes a retry, and never reserves proof", async () => {
  const c = fixture(55);
  const response = await c.check(52);
  assert.equal(response.outcome, "retry", "Visible 3%-wide gap must never authorize sending");
  assert.equal(c.record.attempts, 1);
  assert.equal(c.record.verificationNonce, undefined, "Wrong answer must not reserve verification");
  assert.equal(c.record.targetPercent, 75, "Canonical server moves the target on a wrong attempt");
});

test("A 2%-off placement is rejected on either side of the target", async () => {
  for (const answer of [53, 57]) {
    const c = fixture(55);
    const response = await c.check(answer);
    assert.equal(response.outcome, "retry", "2% off must not count as aligned");
    assert.equal(c.record.verificationNonce, undefined);
  }
});

test("Exact alignment and only a near-invisible 1% rounding allowance can proceed", async () => {
  assert.ok(tolerance <= 1, "Worker must not allow the former 4% visibly misaligned match");
  for (const answer of [54, 55, 56]) {
    const c = fixture(55);
    const response = await c.check(answer);
    assert.equal(response.outcome, "pending", "Only genuine near-alignment may advance to Turnstile");
    assert.equal(c.record.verificationNonce, nonce);
    assert.equal(c.record.attempts, 0);
  }
});

test("Three wrong placements rotate challenge without issuing verification", async () => {
  const c = fixture(55);
  assert.equal((await c.check(20)).outcome, "retry");
  assert.equal((await c.check(20)).outcome, "retry");
  assert.equal((await c.check(20)).outcome, "replace");
  assert.equal(c.record, undefined);
  const retry = await c.check(55);
  assert.equal(retry.status, 410, "Deleted challenge must not authorize a message");
});

test("Binding isolation, atomic finalize and replay protection are unchanged", async () => {
  const c = fixture(55);
  const denied = await c.check(55, { binding: "different-browser" });
  assert.equal(denied.status, 403);
  assert.equal(c.record.verificationNonce, undefined);
  assert.equal((await c.check(55)).outcome, "pending");
  const concurrent = await c.check(55);
  assert.equal(concurrent.status, 409, "In-progress challenge must not issue a second proof");
  const badNonce = await c.finalize("abcdefghijklmnopqrstuvwx");
  assert.equal(badNonce.status, 403, "Only the reserved nonce finalizes a puzzle");
  assert.equal((await c.finalize()).ok, true);
  assert.equal(c.record, undefined);
  assert.equal((await c.check(55)).status, 410);
});

test("Worker still checks puzzle before Turnstile and issues proof only after finalizing", () => {
  const start = worker.indexOf("async function handleMessagePuzzleVerify(");
  const end = worker.indexOf("\nasync function consumePrivateMessageVerification(", start);
  assert.ok(start > 0 && end > start);
  const owner = worker.slice(start, end);
  const positions = [
    owner.indexOf('op:"puzzle-check"'),
    owner.indexOf('if (reply.outcome !== "pending")'),
    owner.indexOf("await verifyTurnstile(request,env,body?.turnstileToken)"),
    owner.indexOf('op:"puzzle-finalize"'),
    owner.indexOf("const verificationToken=randomCapability(24)")
  ];
  assert.ok(positions.every(x => x >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b),
    "No proof or Turnstile path may bypass the server-side puzzle check");
});
