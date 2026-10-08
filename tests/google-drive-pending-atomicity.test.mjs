import test from "node:test";
import assert from "node:assert/strict";
import { SecurityCoordinator } from "../telemetry-worker/src/security-coordinator.js";

function makeCoordinator() {
  const slots = new Map(), objects = new Map();
  const send = async (id, op, fields = {}) => {
    if (!objects.has(id)) {
      const cells = new Map();
      objects.set(id,new SecurityCoordinator({ storage: { kv: {
        get: key=>cells.get(key),
        put: (key,value)=>cells.set(key,structuredClone(value)),
        delete: key=>cells.delete(key)
      } } }));
      slots.set(id,cells);
    }
    const resp = await objects.get(id).fetch(new Request("https://security-coordinator.internal/operation",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({op,scope:"drive-upload",id,...fields})
    }));
    return {status:resp.status,body:await resp.json()};
  };
  return {send,slots};
}

const name = "up-"+"P".repeat(32);
const profileId = "test-storage-profile";
const pending = {
  scope:"drive-upload",profileId,sessionUrl:"https://upload.google.invalid/resumable/session",
  folderId:"expected-folder",name:"test-file.jpg",
  mimeType:"image/jpeg",bytes:432,access:"public-preview",
  expiresAt:Date.now()+3_600_000
};
const claim = i=>"C".repeat(25)+String(i).padStart(4,"0");

test("concurrent Drive upload completion attempts reserve exactly one pending upload",async()=>{
  const {send}=makeCoordinator();
  assert.equal((await send(name,"challenge-put",{record:pending})).status,200);
  const tries=await Promise.all(Array.from({length:30},(_,i)=>send(name,"upload-claim",{
    profileId,claimId:claim(i)
  })));
  assert.equal(tries.filter(v=>v.status===200).length,1);
  assert.equal(tries.filter(v=>v.status===409).length,29);
  const winner=tries.find(v=>v.status===200);
  assert.equal(winner.body.record.sessionUrl,pending.sessionUrl);
  const finalize=await Promise.all(Array.from({length:25},()=>send(name,"upload-consume",{
    profileId,claimId:winner.body.claimId
  })));
  assert.equal(finalize.filter(v=>v.status===200).length,1);
  assert.equal(finalize.filter(v=>v.status!==200).length,24);
  assert.notEqual((await send(name,"upload-claim",{profileId,claimId:claim(95)})).status,200);
});

test("failed upload or verification releases only matching owner's lease for safe retry",async()=>{
  const {send}=makeCoordinator(),id="up-"+"Q".repeat(32);
  await send(id,"challenge-put",{record:pending});
  const first=await send(id,"upload-claim",{profileId,claimId:claim(30)});
  assert.equal(first.status,200);
  const other=await send(id,"upload-release",{profileId,claimId:claim(31)});
  assert.equal(other.status,403);
  assert.equal((await send(id,"upload-claim",{profileId,claimId:claim(32)})).status,409);
  assert.equal((await send(id,"upload-release",{profileId,claimId:first.body.claimId})).status,200);
  const again=await send(id,"upload-claim",{profileId,claimId:claim(33)});
  assert.equal(again.status,200);
  assert.equal((await send(id,"upload-consume",{profileId,claimId:again.body.claimId})).status,200);
});

test("Drive upload capability cannot cross storage profiles or be reused after consumption",async()=>{
  const {send}=makeCoordinator(),id="up-"+"R".repeat(32);
  await send(id,"challenge-put",{record:pending});
  assert.equal((await send(id,"upload-read",{profileId:"other-profile"})).status,403);
  assert.equal((await send(id,"upload-claim",{profileId:"other-profile",claimId:claim(40)})).status,403);
  const first=await send(id,"upload-claim",{profileId,claimId:claim(41)});
  assert.equal(first.status,200);
  assert.equal((await send(id,"upload-consume",{profileId,claimId:claim(42)})).status,403);
  assert.equal((await send(id,"upload-consume",{profileId,claimId:first.body.claimId})).status,200);
  assert.notEqual((await send(id,"upload-read",{profileId})).status,200);
});
