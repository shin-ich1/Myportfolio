import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Run the actual canonical app.js puzzle controller with fake DOM/network.
// No Cloudflare, Firestore, credentials, localhost Worker, or private messages.
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("async function loadPublicMessagePuzzleChallenge()");
const end = app.indexOf("\nasync function openPublicMessagePuzzleVerification(", start);
assert.ok(start >= 0 && end > start, "One canonical Public Message puzzle owner");
const controller = app.slice(start, end);

function createBrowserPuzzle({
  verify,
  challenges = ["original-puzzle", "new-puzzle"],
  secondChallengeFails = false
} = {}) {
  let created = 0;
  let sent = 0;
  let verificationCalls = 0;
  let widgetOptions;
  let resets = 0;
  const slider = {
    disabled: true, value: "0", oninput: null, onchange: null,
    closest: () => ({ style: { setProperty() {} } })
  };
  const status = { textContent: "", className: "" };
  const label = { textContent: "" };
  const style = { removeProperty() {}, setProperty() {} };
  const scene = { style };
  const turnstile = {
    render(_slot, options) { widgetOptions = options; options.callback("test-token-not-sent"); return "fixture-widget"; },
    execute() { widgetOptions.callback("test-token-not-sent"); },
    remove() {},
    reset() { resets++; }
  };
  const nodes = new Map([
    ["[data-public-puzzle-scene]", scene],
    ["[data-public-puzzle-image]", { complete:true, naturalWidth:960 }],
    ["[data-public-puzzle-piece-image]", {}],
    ["[data-public-puzzle-slider]", slider],
    ["[data-public-puzzle-label]", label],
    ["[data-public-puzzle-status]", status],
    ["[data-public-turnstile-slot]", {parentElement:{getBoundingClientRect:()=>({width:350})}}]
  ]);
  const layer = { querySelector: selector => nodes.get(selector) || null };
  const document = { querySelector: selector => selector === "[data-public-puzzle-layer]" ? layer : null };
  const window = {
    turnstile, addEventListener() {}, removeEventListener() {},
    setTimeout() { return 1; }, clearTimeout() {}
  };
  const deps = {
    document, window, ResizeObserver: class { observe() {} disconnect() {} },
    stopPublicMessagePuzzleGeometryWatch() {},
    async takePublicMessagePuzzleWarmup() {
      created++;
      if (secondChallengeFails && created === 2) throw new Error("Upstream challenge unavailable");
      const name = challenges[created - 1];
      if (!name) throw new Error("Unexpected extra challenge: "+created);
      return {challenge:{challengeId:name,siteKey:"test-site-key",image:{url:"local-fixture",width:960,height:540},targetPercent:40}};
    },
    async loadPublicMessagePuzzleImage() {},
    syncPublicMessagePuzzleGeometry() {},
    async loadPublicMessageTurnstileApi() { return turnstile; },
    isPublicDocumentFlowMode() {return false;},
    setPublicMessagePuzzleSlider(node, value) {node.value=String(value);},
    async verifyPrivateMessageChallenge(args) {
      verificationCalls++;
      return await verify(args, verificationCalls);
    },
    async sendPendingPublicMessage(proof) {
      assert.equal(proof,"server-verified-proof","Only server proof may send a message");
      sent++;
    },
    async warmPublicMessagePuzzleChallenge() {},
    cleanText: String,
    PUBLIC_MESSAGE_PUZZLE_NEXT_WARMUP_DELAY_MS: 1500
  };
  const keys=Object.keys(deps);
  const factory=new Function(...keys,
    "let publicMessagePuzzleChallenge = null, publicMessagePuzzleAnswer = 0;\n" +
    "let publicMessageTurnstileCancel = null, publicMessageTurnstileWidgetId = null;\n" +
    "let publicMessagePuzzleResizeObserver = null, publicMessagePuzzleResizeFallbackCleanup = null;\n" +
    controller +
    "\nreturn {load:loadPublicMessagePuzzleChallenge, currentChallenge:()=>publicMessagePuzzleChallenge?.challengeId || null};");
  const api=factory(...keys.map(k=>deps[k]));
  return {
    ...api, slider, status, label,
    get created() { return created; },
    get sent() { return sent; },
    get verificationCalls(){return verificationCalls;},
    get resets(){return resets;}
  };
}

function expiredError() {
  return Object.assign(new Error("Verification puzzle expired. Load a new puzzle."),
    { code:"message-puzzle-expired", status:410 });
}

test("HTTP 410 expired puzzle invalidates old challenge and loads a new challenge before unlocking slider", async () => {
  const view=createBrowserPuzzle({verify:async()=>{throw expiredError();}});
  await view.load();
  assert.equal(view.currentChallenge(),"original-puzzle");
  assert.equal(view.slider.disabled,false);
  view.slider.value="15";
  await view.slider.onchange();
  assert.equal(view.created,2,"Expired server challenge must be replaced, not reused");
  assert.equal(view.currentChallenge(),"new-puzzle","Old challenge must never be submitted again");
  assert.equal(view.slider.disabled,false,"Only successfully prepared fresh challenge unlocks slider");
  assert.equal(view.slider.value,"0","Fresh puzzle starts at zero, not stale geometry");
  assert.equal(view.sent,0,"Expired challenge cannot send a message");
});

test("If expired challenge replacement fails, slider remains disabled and invalid old challenge cannot be sent", async () => {
  const view=createBrowserPuzzle({verify:async()=>{throw expiredError();},secondChallengeFails:true});
  await view.load();
  view.slider.value="19";
  await view.slider.onchange();
  assert.equal(view.created,2);
  assert.equal(view.currentChallenge(),null);
  assert.equal(view.slider.disabled,true,"No slider until a valid fresh challenge is available");
  assert.match(view.status.textContent,/unavailable|expired|try again/i);
  assert.equal(view.sent,0);
});

test("Wrong-answer retry preserves active challenge with new geometry and allows another attempt", async () => {
  const view=createBrowserPuzzle({
    verify:async()=>({outcome:"retry",message:"Not quite. The matching space moved — try again.",
      challenge:{targetPercent:72,topPercent:31,pieceScalePercent:16}})
  });
  await view.load();
  view.slider.value="12";
  await view.slider.onchange();
  assert.equal(view.created,1,"Regular wrong answer should not force new image");
  assert.equal(view.currentChallenge(),"original-puzzle");
  assert.equal(view.slider.disabled,false);
  assert.equal(view.slider.value,"0");
  assert.match(view.status.textContent,/Not quite/);
  assert.equal(view.sent,0);
});

test("Third incorrect answer replacement loads a new server puzzle without sending a message", async () => {
  const view=createBrowserPuzzle({verify:async()=>({outcome:"replace",
    message:"That puzzle did not match. Switching to the next prepared image…"})});
  await view.load();
  view.slider.value="77";
  await view.slider.onchange();
  assert.equal(view.currentChallenge(),"new-puzzle");
  assert.equal(view.created,2);
  assert.equal(view.sent,0);
});

test("Transient non-expiry error can retry the same challenge but cannot bypass server proof", async () => {
  const view=createBrowserPuzzle({verify:async()=>{throw new Error("Temporary connection problem");}});
  await view.load();
  view.slider.value="22";
  await view.slider.onchange();
  assert.equal(view.created,1);
  assert.equal(view.currentChallenge(),"original-puzzle");
  assert.equal(view.slider.disabled,false);
  assert.equal(view.sent,0);
});

test("A successful server verification proof is still mandatory for message creation", async () => {
  const view=createBrowserPuzzle({verify:async()=>({verificationToken:"server-verified-proof"})});
  await view.load();
  view.slider.value="40";
  await view.slider.onchange();
  assert.equal(view.sent,1,"Only canonical secure server proof calls message creation");
});
