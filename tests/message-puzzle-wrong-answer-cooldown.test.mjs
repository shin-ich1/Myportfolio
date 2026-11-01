// Regression first: real coordinator + canonical Worker contract, no external services.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const worker=readFileSync(new URL("../telemetry-worker/src/index.js",import.meta.url),"utf8");
const source=readFileSync(new URL("../telemetry-worker/src/security-coordinator.js",import.meta.url),"utf8");
const {SecurityCoordinator}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
function harness(){
 const records=new Map();
 const kv={get:k=>records.get(k),put:(k,v)=>records.set(k,structuredClone(v)),delete:k=>records.delete(k)};
 const coordinator=new SecurityCoordinator({storage:{kv,setAlarm:async()=>{}}});
 const action=async (op,extra={})=>{
  const response=await coordinator.fetch(new Request("http://localhost/test",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({op,scope:"message-puzzle-cooldown",...extra})
  }));
  return {status:response.status,...await response.json()};
 };
 return {action,records};
}
test("On third wrong answer Worker triggers authoritative retry cooldown, not image replacement",()=>{
 const owner=worker.slice(worker.indexOf("async function handleMessagePuzzleVerify("),worker.indexOf("\nasync function consumePrivateMessageVerification("));
 assert.match(owner,/reply\.outcome === "replace"[\s\S]*?puzzle-cooldown-start/);
 assert.match(owner,/reply\.outcome === "replace"[\s\S]*?429/);
 assert.match(owner,/retryAt/);
 assert.doesNotMatch(owner,/reply\.outcome === "replace"[\s\S]{0,150}Switching to the next prepared image/);
});
test("Cooldown is server-managed, persists across requests, returns 429 and retryAt",async()=>{
 const c=harness();
 const started=await c.action("puzzle-cooldown-start",{seconds:10});
 assert.equal(started.ok,true);
 assert.ok(Date.parse(started.retryAt)>Date.now());
 const blocked=await c.action("puzzle-cooldown-check");
 assert.equal(blocked.status,429);
 assert.equal(blocked.code,"message-puzzle-cooldown");
 assert.equal(blocked.retryAt,started.retryAt);
});
test("Cooldown cannot be shortened by repeated starts or client time input",async()=>{
 const c=harness();
 const first=await c.action("puzzle-cooldown-start",{seconds:10});
 const second=await c.action("puzzle-cooldown-start",{seconds:1,now:0});
 assert.ok(Date.parse(second.retryAt)>=Date.parse(first.retryAt));
 assert.equal((await c.action("puzzle-cooldown-check",{now:Date.now()+200000})).status,429);
});
test("After server cooldown expires, a new puzzle is allowed",async()=>{
 const c=harness();
 await c.action("puzzle-cooldown-start",{seconds:10});
 const old=c.records.get("record");
 c.records.set("record",{...old,blockedUntil:Date.now()-20});
 assert.equal((await c.action("puzzle-cooldown-check")).ok,true);
});
test("Both challenge creation and verification check cooldown before expensive work",()=>{
 const a=worker.slice(worker.indexOf("async function handleMessagePuzzleChallenge("),worker.indexOf("\nasync function handleMessagePuzzleVerify("));
 const b=worker.slice(worker.indexOf("async function handleMessagePuzzleVerify("),worker.indexOf("\nasync function consumePrivateMessageVerification("));
 assert.ok(a.indexOf("enforceMessagePuzzleCooldown(")>0);
 assert.ok(a.indexOf("enforceMessagePuzzleCooldown(")<a.indexOf("chooseOpenversePuzzleImage("));
 assert.ok(b.indexOf("enforceMessagePuzzleCooldown(")>0);
 assert.ok(b.indexOf("enforceMessagePuzzleCooldown(")<b.indexOf('op:"puzzle-check"'));
 assert.match(a,/retryAt:\s*error\?\.retryAt/);
 assert.match(b,/retryAt:\s*error\?\.retryAt/);
});
test("A correct answer still requires Turnstile and one-use security proof",()=>{
 const b=worker.slice(worker.indexOf("async function handleMessagePuzzleVerify("),worker.indexOf("\nasync function consumePrivateMessageVerification("));
 const i=[b.indexOf('op:"puzzle-check"'),b.indexOf('reply.outcome !== "pending"'),b.indexOf("await verifyTurnstile("),b.indexOf('op:"puzzle-finalize"'),b.indexOf("const verificationToken=randomCapability(24)")];
 assert.ok(i.every(x=>x>0)&&i.every((x,n)=>n===0||x>i[n-1]));
});
