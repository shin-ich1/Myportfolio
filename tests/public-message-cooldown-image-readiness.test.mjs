import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("function stopPublicMessageRetryCountdown() {");
const end = app.indexOf("\nfunction closePublicMessagePuzzleVerification(", start);
assert.ok(start > 0 && end > start, "Use the single existing Public Message countdown owner");
const controller = app.slice(start, end);

function countdownHarness({connected=true, shouldRejectWarmup=false, shouldHoldWarmup=false}={}) {
  let now=Date.parse("2026-11-01T00:00:00.000Z");
  let interval=null;
  let warmups=0;
  let pendingWarmups=0;
  let releaseWarmup=null;
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
    if (shouldRejectWarmup) return Promise.reject(new Error("Temporary image provider outage"));
    if (shouldHoldWarmup) return new Promise(resolve => { releaseWarmup=resolve; });
    return Promise.resolve();
  };
  const api=new Function("document","window","Date","warmPublicMessagePuzzleChallenge",
    "let publicMessageRetryTimerId=null,publicMessageRetryUntil=0;\n"
    +controller+"\nreturn {begin:beginPublicMessageRetryCountdown};"
  )(document,window,DateFake,warmPublicMessagePuzzleChallenge);
  return { ...api, button,status,
    get warmups(){return warmups},
    get pendingWarmups(){return pendingWarmups},
    get timerActive(){return Boolean(interval)},
    completeWarmup(){ const done=releaseWarmup; releaseWarmup=null; done?.(); },
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

test("Exactly one warmup starts after the 10s server cooldown; keep Send disabled for the additional 5s",async()=>{
  const view=countdownHarness();
  view.begin(wrongAttemptCooldown());
  view.advance(10_000);
  assert.equal(view.warmups,1,"Start challenge/image warmup only once the Worker retry deadline has passed");
  assert.equal(view.button.disabled,true,"Visible countdown has five more preparation seconds");
  assert.match(view.status.textContent,/5s/);
  await Promise.resolve();
  view.advance(4000);
  assert.equal(view.button.disabled,true);
  assert.equal(view.warmups,1,"No duplicate challenge during the preparation buffer");
  view.advance(1000);
  assert.equal(view.button.disabled,false);
  assert.equal(view.timerActive,false);
  assert.match(view.status.textContent,/try sending.*again/i);
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

test("Image-service errors during optional warmup cannot shorten the additional 5s",async()=>{
  const view=countdownHarness({shouldRejectWarmup:true});
  view.begin(wrongAttemptCooldown());
  view.advance(10_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(view.warmups,1);
  assert.equal(view.button.disabled,true,"A failed warmup cannot end the preparation buffer early");
  view.advance(5000);
  assert.equal(view.button.disabled,false,"Normal Send remains available for an authorized retry after buffer");
  assert.equal(view.timerActive,false);
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

test("If warmup takes longer than 5s, keep the wait in the message form until image is ready",async()=>{
  const view=countdownHarness({shouldHoldWarmup:true});
  view.begin(wrongAttemptCooldown());
  view.advance(10_000);
  assert.equal(view.warmups,1);
  view.advance(5_000);
  assert.equal(view.button.disabled,true,"Do not display an empty puzzle while image is still loading");
  assert.match(view.status.textContent,/prepar|loading/i);
  view.completeWarmup();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(view.button.disabled,false);
  assert.match(view.status.textContent,/try sending.*again/i);
});

test("Only puzzle wrong-answer cooldown receives five additional preparation seconds",()=>{
  const view=countdownHarness();
  view.begin({status:429,code:"message-rate-window",retryAt:"2026-11-01T00:00:10.000Z"});
  view.advance(10_000);
  assert.equal(view.button.disabled,false,"Unrelated server limits must not gain an arbitrary extension");
  assert.equal(view.warmups,0);
});

test("The five-second buffer must not create a fresh puzzle before a longer authoritative deadline",()=>{
  const view=countdownHarness();
  view.begin({status:429,code:"message-puzzle-cooldown",retryAt:"2026-11-01T00:00:20.000Z"});
  view.advance(15_000);
  assert.equal(view.warmups,0);
  assert.equal(view.button.disabled,true);
  view.advance(5_000);
  assert.equal(view.warmups,1,"The server retryAt, not an assumed local 10s interval, starts warmup");
  assert.equal(view.button.disabled,true);
});
