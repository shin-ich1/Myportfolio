import test from "node:test";
import assert from "node:assert/strict";
import { SecurityCoordinator } from "../telemetry-worker/src/security-coordinator.js";

function fixture(){
  const storage=new Map();
  const obj=new SecurityCoordinator({ storage:{ kv:{
    get:key=>storage.get(key),
    put:(key,value)=>storage.set(key,structuredClone(value)),
    delete:key=>storage.delete(key)
  } } });
  const send=async(op,params={})=>{
    const r=await obj.fetch(new Request("https://security-coordinator.internal/operation",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op,...params})
    }));
    return {status:r.status,body:await r.json()};
  };
  return {send,storage};
}
const puzzle=(id="P".repeat(24))=>({
  scope:"message-puzzle",id,record:{
    scope:"message-puzzle",origin:"https://lan-portfolio-staging.web.app",
    binding:"unique-browser-binding",targetPercent:47,topPercent:32,
    pieceScalePercent:17,attempts:0,
    image:{id:"prepared-image",sourceUrl:"https://example.invalid/image.jpg"},
    expiresAt:Date.now()+180000
  }
});
const verify=(p,nonce,answer=47)=>({
  scope:p.scope,id:p.id,
  origin:"https://lan-portfolio-staging.web.app",
  binding:"unique-browser-binding",answer,tolerance:4,
  maxAttempts:3,verificationNonce:nonce,
  nextGeometry:{targetPercent:70,topPercent:28,pieceScalePercent:15}
});

test("public puzzle image reads never disclose challenge solution or private browser binding",async()=>{
  const {send}=fixture(),p=puzzle();
  assert.equal((await send("challenge-put",p)).status,200);
  const read=await send("puzzle-image-read",{scope:p.scope,id:p.id});
  assert.equal(read.status,200);
  assert.equal(read.body.image.id,"prepared-image");
  assert.equal(JSON.stringify(read.body).includes("targetPercent"),false);
  assert.equal(JSON.stringify(read.body).includes("unique-browser-binding"),false);
});

test("parallel correct puzzle answers lead to one pending Turnstile proof and one finalization",async()=>{
  const {send}=fixture(),p=puzzle();
  await send("challenge-put",p);
  const results=await Promise.all(Array.from({length:30},(_,i)=>send("puzzle-check",verify(p,"N".repeat(20)+i))));
  assert.equal(results.filter(x=>x.status===200&&x.body.outcome==="pending").length,1);
  assert.equal(results.filter(x=>x.status!==200).length,29);
  const winner=results.find(x=>x.body.outcome==="pending");
  const finalized=await Promise.all(Array.from({length:20},()=>send("puzzle-finalize",{
    scope:p.scope,id:p.id,
    verificationNonce:winner.body.verificationNonce
  })));
  assert.equal(finalized.filter(x=>x.status===200).length,1);
  assert.equal(finalized.filter(x=>x.status!==200).length,19);
});

test("incorrect attempts atomically rotate geometry and permanently exhaust the challenge",async()=>{
  const {send}=fixture(),p=puzzle("Q".repeat(24));
  await send("challenge-put",p);
  const wrong=verify(p,"X".repeat(24),5);
  const first=await send("puzzle-check",wrong);
  assert.equal(first.status,200);
  assert.equal(first.body.outcome,"retry");
  assert.equal(first.body.attemptsRemaining,2);
  const rest=await Promise.all(Array.from({length:7},()=>send("puzzle-check",wrong)));
  assert.equal(rest.filter(x=>x.status===200&&x.body.outcome==="replace").length,1);
  assert.equal(rest.filter(x=>x.status===200&&x.body.outcome==="retry").length,1);
  assert.equal(rest.filter(x=>x.status!==200).length,5);
});

test("wrong browser binding cannot redeem valid puzzle and proof is one-time",async()=>{
  const {send}=fixture(),p=puzzle("B".repeat(24));
  await send("challenge-put",p);
  const invalid=await send("puzzle-check",{...verify(p,"J".repeat(24)),binding:"another-client"});
  assert.equal(invalid.status,403);
  const proof={scope:"message-proof",id:"T".repeat(32),record:{
    scope:"message-proof",origin:p.record.origin,binding:p.record.binding,
    expiresAt:Date.now()+90000
  }};
  assert.equal((await send("challenge-put",proof)).status,200);
  const results=await Promise.all(Array.from({length:35},()=>send("challenge-consume",{
    scope:proof.scope,id:proof.id
  })));
  assert.equal(results.filter(x=>x.status===200).length,1);
});

test("public message limiter atomically enforces cooldown and window under contention",async()=>{
  const {send}=fixture();
  const t=Date.now(),policy={limit:3,windowSeconds:60,cooldownSeconds:2};
  const hit=(now)=>send("rate-hit",{category:"message",policy,now});
  const first=await hit(t);
  assert.equal(first.status,200);
  const cooled=await Promise.all(Array.from({length:24},()=>hit(t+1000)));
  assert.equal(cooled.filter(x=>x.body.code==="message-rate-cooldown").length,24);
  assert.equal((await hit(t+2500)).status,200);
  assert.equal((await hit(t+5000)).status,200);
  const blocked=await Promise.all(Array.from({length:24},()=>hit(t+8000)));
  assert.equal(blocked.filter(x=>x.body.code==="message-rate-window").length,24);
  assert.equal((await hit(t+61000)).status,200);
});
