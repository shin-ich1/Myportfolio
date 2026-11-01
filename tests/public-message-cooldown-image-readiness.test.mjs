import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("function stopPublicMessageRetryCountdown() {");
const end = app.indexOf("\nfunction closePublicMessagePuzzleVerification(", start);
assert.ok(start > 0 && end > start, "Use the single existing Public Message countdown owner");
const controller = app.slice(start, end);

function countdownHarness({connected=true, shouldRejectWarmup=false}={}) {
  let now=Date.parse("2026-11-01T00:00:00.000Z");
  let interval=null;
  let warmups=0;
  let pendingWarmups=0;
  const button={disabled:false,isConnected:connected};
  const status={textContent:"",className:"",isConnected:connected};
  const document={querySelector:selector=>({
    "[data-public-message-send]":button,
    "[data-public-message-status]":status
  })[selector]??null};
  const window={
    setInterval(callback){interval=callback;return 7;},
    clearInterval(){interval=null;}
  };
  const DateFake={now:()=>now,parse:Date.parse};
  const warmPublicMessagePuzzleChallenge=()=>{
    warmups++;
    pendingWarmups++;
    return shouldRejectWarmup ? Promise.reject(new Error("Temporary image provider outage")) : Promise.resolve();
  };
  const api=new Function("document","window","Date","warmPublicMessagePuzzleChallenge",
    "let publicMessageRetryTimerId=null,publicMessageRetryUntil=0;\n"
    +controller+"\nreturn {begin:beginPublicMessageRetryCountdown};"
  )(document,window,DateFake,warmPublicMessagePuzzleChallenge);
  return { ...api, button,status,
    get warmups(){return warmups},
    get pendingWarmups(){return pendingWarmups},
    get timerActive(){return Boolean(interval)},
    advance(ms){now+=ms; interval?.();}
  };
}

function wrongAttemptCooldown() {
  return {status:429,code:"message-puzzle-cooldown",
    retryAt:"2026-11-01T00:00:10.000Z"};
}

test("Server cooldown must not request or warm a challenge before authoritative expiry",()=>{
  const view=countdownHarness();
  view.begin(wrongAttemptCooldown());
  assert.equal(view.warmups,0);
  assert.equal(view.button.disabled,true);
  view.advance(9000);
  assert.equal(view.warmups,0,"Server cooldown cannot be bypassed by a background fetch");
  assert.equal(view.button.disabled,true);
});

test("Exactly one existing challenge warmup begins at cooldown expiry, ready for later Send",()=>{
  const view=countdownHarness();
  view.begin(wrongAttemptCooldown());
  view.advance(10_000);
  assert.equal(view.warmups,1,"Start image/challenge warmup at the first legally allowed instant");
  assert.equal(view.button.disabled,false);
  assert.equal(view.timerActive,false);
  assert.match(view.status.textContent,/try sending.*again/i);
  view.advance(1_000);
  assert.equal(view.warmups,1,"No duplicate challenge while cooldown timer has ended");
});

test("Closing or disconnecting the form prevents background puzzle allocation",()=>{
  const view=countdownHarness();
  view.begin(wrongAttemptCooldown());
  view.button.isConnected=false;
  view.status.isConnected=false;
  view.advance(10_000);
  assert.equal(view.warmups,0);
  assert.equal(view.timerActive,false);
});

test("Image-service errors during optional warmup cannot break the countdown or enable security bypass",async()=>{
  const view=countdownHarness({shouldRejectWarmup:true});
  view.begin(wrongAttemptCooldown());
  view.advance(10_000);
  await Promise.resolve();
  assert.equal(view.warmups,1);
  assert.equal(view.button.disabled,false,"A normal later Send can retry through the canonical challenge owner");
});

test("No early warmup for unrelated rate-limit or image-loading retry timers",()=>{
  for(const issue of [
    {status:429,code:"message-rate-window",retryAt:"2026-11-01T00:00:10.000Z"},
    {code:"message-puzzle-image-unavailable"}
  ]) {
    const view=countdownHarness();
    view.begin(issue);
    view.advance(10_000);
    assert.equal(view.warmups,0,"Only the verified three-wrong cooldown should schedule an automatic next puzzle");
  }
});

test("A new puzzle must never show the previous image while the replacement is pending",()=>{
  const source=app.slice(app.indexOf("async function loadPublicMessagePuzzleChallenge() {"),
    app.indexOf("\nasync function openPublicMessagePuzzleVerification(",app.indexOf("async function loadPublicMessagePuzzleChallenge() {")));
  assert.ok(source.indexOf('scene.style.visibility = "hidden"') > 0,
    "Hide the whole scene while an old image could still be present");
  const loading=source.indexOf("await loadPublicMessagePuzzleImage(");
  const revealed=source.indexOf('scene.style.visibility = ""');
  assert.ok(loading > 0 && revealed > loading,
    "Reveal the scene only once the new image is completely ready");
});
