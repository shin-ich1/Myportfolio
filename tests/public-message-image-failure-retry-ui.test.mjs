import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const start = app.indexOf("function stopPublicMessageRetryCountdown(");
const end = app.indexOf("\nasync function openPublicMessagePuzzleVerification(", start);
assert.ok(start > 0 && end > start, "Canonical Public Message controller must own failed-image retry countdown");
const controller = app.slice(start, end);

function harness(error = new Error("Verification image could not be loaded. Please try again.")) {
  let now = 2_000_000;
  let timer = null;
  const button = { disabled:false, isConnected:true };
  const messageStatus = { textContent:"", className:"", isConnected:true };
  const slider = { disabled:false };
  const scene = {style:{removeProperty(){}}};
  const inPuzzleStatus = {textContent:"",className:""};
  const layer = {
    hidden:false,
    querySelector(key) {
      return {
        "[data-public-puzzle-scene]":scene,
        "[data-public-puzzle-image]":{},
        "[data-public-puzzle-piece-image]":{},
        "[data-public-puzzle-slider]":slider,
        "[data-public-puzzle-label]":{textContent:""},
        "[data-public-puzzle-status]":inPuzzleStatus,
        "[data-public-turnstile-slot]":{}
      }[key] || null;
    }
  };
  const document={
    querySelector(key) {
      return {
        "[data-public-puzzle-layer]": layer,
        "[data-public-message-send]":button,
        "[data-public-message-status]":messageStatus
      }[key] || null;
    }
  };
  const window={
    turnstile:{remove(){}},
    setInterval(cb) {timer=cb;return 1;},
    clearInterval() {timer=null;}
  };
  const FakeDate={ now(){return now;},parse:Date.parse };
  const source=[
    "let publicMessagePuzzleChallenge=null, publicMessagePuzzleAnswer=0;",
    "let publicMessagePuzzleResizeObserver=null, publicMessageTurnstileWidgetId=null, publicMessagePendingSubmission=null;",
    "let publicMessageRetryUntil=0, publicMessageRetryTimerId=null;",
    controller,
    "return {load:loadPublicMessagePuzzleChallenge,stop:stopPublicMessageRetryCountdown,until:()=>publicMessageRetryUntil};"
  ].join("\n");
  const api=new Function("document","window","Date","takePublicMessagePuzzleWarmup",source)(
    document,window,FakeDate,async()=>{throw error;});
  return {
    ...api,button,messageStatus,slider,layer,inPuzzleStatus,
    advance(ms){now+=ms;timer?.();},
    get hasTimer(){return Boolean(timer);}
  };
}

test("Failed image automatically closes stuck puzzle, leaves message form, and starts a local retry countdown",async()=>{
  const view=harness();
  await view.load();
  assert.equal(view.layer.hidden,true,"Bad image must not leave an unusable verification overlay");
  assert.equal(view.slider.disabled,true,"Cannot submit broken puzzle");
  assert.equal(view.button.disabled,true,"Send retry must wait briefly without sending message");
  assert.match(view.messageStatus.textContent,/verification image|retry/i);
  assert.match(view.messageStatus.textContent,/10s/i);
  assert.ok(view.hasTimer);
  view.advance(10_000);
  assert.equal(view.button.disabled,false);
  assert.equal(view.hasTimer,false);
  assert.match(view.messageStatus.textContent,/try again|send/i);
});

test("Server's authoritative 429 retryAt overrides local retry delay",async()=>{
  const view=harness(Object.assign(new Error("Too many verification requests"),{
    code:"message-rate-window",status:429,retryAt:new Date(2_090_000).toISOString()
  }));
  await view.load();
  assert.equal(view.layer.hidden,true);
  assert.match(view.messageStatus.textContent,/90s/);
  view.advance(10_000);
  assert.equal(view.button.disabled,true);
  assert.match(view.messageStatus.textContent,/80s/);
  view.advance(80_000);
  assert.equal(view.button.disabled,false);
});

test("Retry timer is cancelled if the message form is no longer connected",async()=>{
  const view=harness();
  await view.load();
  view.button.isConnected=false;
  view.advance(1000);
  assert.equal(view.hasTimer,false);
});

test("Puzzle footer is visually hidden, but live verification text stays accessible",()=>{
  assert.match(css,/\.public-message-puzzle-foot\{[^}]*clip-path:inset\(50%\)/);
  assert.match(app,/data-public-puzzle-status aria-live="polite"/);
  assert.match(css,/\.public-message-puzzle-card\{[^}]*scrollbar-width:none/);
});

test("Normal wrong-answer retry keeps a brief visible slider label instead of a clipped footer",()=>{
  assert.match(controller,/resetSamePuzzle[\s\S]*?Not quite/);
  assert.match(controller,/label\.textContent = "Try again/);
});

test("The original form submit respects an active retry interval",()=>{
  const submit=app.slice(app.indexOf("async function submitPublicMessage("),app.indexOf("\nfunction publicServicesValid",app.indexOf("async function submitPublicMessage(")));
  assert.match(submit,/publicMessageRetryUntil\s*>\s*Date\.now\(\)/);
  assert.match(submit,/openPublicMessagePuzzleVerification/);
});
