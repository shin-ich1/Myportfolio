import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestHarness } from "wrangler";

// Real local workerd + SQLite Durable Object, using the generated isolated
// staging configuration. No Firebase/GCP credentials, API calls, or deployment.
const harness = createTestHarness({
  workers: [{
    configPath: new URL("../wrangler.staging.jsonc", import.meta.url),
    secrets: {}
  }]
});

before(async () => {
  await harness.listen();
});
after(async () => {
  await harness.close();
});

const send = async (stub, op, payload) => {
  const result = await stub.fetch("https://security-coordinator.internal/operation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...payload })
  });
  return { status: result.status, body: await result.json() };
};

test("workerd runs canonical SQLite coordinator; 50 concurrent one-time requests yield exactly one success", async () => {
  const env = await harness.getWorker().getEnv();
  const namespace = env.SECURITY_COORDINATOR;
  assert.equal(typeof namespace.idFromName, "function");
  const id = "R".repeat(32);
  const stub = namespace.get(namespace.idFromName("security-challenge:totp-login:" + id));
  const request = { scope: "totp-login", id };
  const created = await send(stub, "challenge-put", {
    ...request,
    record: { ...request, expiresAt: Date.now() + 60000, uid: "nonexistent-test-admin" }
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const outcomes = await Promise.all(Array.from({ length: 50 }, () =>
    send(stub, "challenge-consume", request)
  ));
  assert.equal(outcomes.filter(x => x.status === 200).length, 1);
  assert.equal(outcomes.filter(x => x.status === 400).length, 49);
});

test("workerd SQLite rate limiter strictly caps parallel attempts", async () => {
  const env = await harness.getWorker().getEnv();
  const namespace = env.SECURITY_COORDINATOR;
  const stub = namespace.get(namespace.idFromName("security-rate:workerd-staging-test"));
  const now = Date.now();
  const results = await Promise.all(Array.from({ length: 36 }, () => send(stub, "rate-hit", {
    category: "security",
    policy: { limit: 4, windowSeconds: 600, cooldownSeconds: 600 },
    now
  })));
  assert.equal(results.filter(x => x.status === 200).length, 4);
  assert.equal(results.filter(x => x.status === 429).length, 32);
  assert.ok(results.slice(4).every(x => x.body.code === "security-rate-limited"));
});


test("workerd rejects concurrent public puzzle solution replay before and after Turnstile", async()=>{
  const env=await harness.getWorker().getEnv();
  const ns=env.SECURITY_COORDINATOR;
  const id="puzzle-workerd-"+crypto.randomUUID().replaceAll("-","");
  const stub=ns.get(ns.idFromName("security-challenge:message-puzzle:"+id));
  const record={
    scope:"message-puzzle",origin:"https://lan-portfolio-staging.web.app",
    binding:"local-workerd-browser-binding",
    targetPercent:50,topPercent:21,pieceScalePercent:16,attempts:0,
    image:{id:"test-image"},expiresAt:Date.now()+60000
  };
  assert.equal((await send(stub,"challenge-put",{scope:"message-puzzle",id,record})).status,200);
  const results=await Promise.all(Array.from({length:40},(_,i)=>
    send(stub,"puzzle-check",{
      scope:"message-puzzle",id,origin:record.origin,binding:record.binding,
      answer:50,tolerance:4,maxAttempts:3,
      nextGeometry:{targetPercent:70,topPercent:29,pieceScalePercent:16},
      verificationNonce:"proof-"+String(i).padStart(20,"A")
    })
  ));
  const winners=results.filter(x=>x.status===200&&x.body.outcome==="pending");
  assert.equal(winners.length,1);
  assert.equal(results.filter(x=>x.status===409).length,39);
  const finalizations=await Promise.all(Array.from({length:35},()=>send(stub,"puzzle-finalize",{
    scope:"message-puzzle",id,
    verificationNonce:winners[0].body.verificationNonce
  })));
  assert.equal(finalizations.filter(x=>x.status===200).length,1);
  assert.equal(finalizations.filter(x=>x.status!==200).length,34);
});

test("workerd consumes Google Drive OAuth state once across 40 simultaneous callbacks", async()=>{
  const env=await harness.getWorker().getEnv();
  const ns=env.SECURITY_COORDINATOR;
  const id="drv-"+crypto.randomUUID().replaceAll("-","");
  const stub=ns.get(ns.idFromName("security-challenge:drive-oauth-state:"+id));
  const record={
    scope:"drive-oauth-state",uid:"isolated-admin",profileId:"isolated-drive",
    origin:"https://lan-portfolio-staging.web.app",
    redirectUri:"https://isolated.invalid/storage/google-drive/connect/callback",
    expiresAt:Date.now()+60000
  };
  assert.equal((await send(stub,"challenge-put",{scope:"drive-oauth-state",id,record})).status,200);
  const uses=await Promise.all(Array.from({length:40},()=>send(stub,"challenge-consume",{
    scope:"drive-oauth-state",id
  })));
  assert.equal(uses.filter(x=>x.status===200).length,1);
  assert.equal(uses.filter(x=>x.status===400).length,39);
});


test("workerd serializes concurrent Drive upload confirmation and supports exclusive retry", async()=>{
  const env=await harness.getWorker().getEnv();
  const ns=env.SECURITY_COORDINATOR;
  const id="up-"+crypto.randomUUID().replaceAll("-","");
  const stub=ns.get(ns.idFromName("security-challenge:drive-upload:"+id));
  const profileId="isolated-staging-profile";
  const record={
    scope:"drive-upload",profileId,folderId:"expected-staging-folder",
    sessionUrl:"https://upload.example.invalid/opaque-session",
    name:"test-photo.jpg",mimeType:"image/jpeg",bytes:222,
    expiresAt:Date.now()+120000
  };
  assert.equal((await send(stub,"challenge-put",{
    scope:"drive-upload",id,record
  })).status,200);
  const attempts=await Promise.all(Array.from({length:40},(_,i)=>
    send(stub,"upload-claim",{
      scope:"drive-upload",id,profileId,
      claimId:"claim-"+String(i).padStart(24,"0")
    })
  ));
  const allowed=attempts.filter(x=>x.status===200);
  assert.equal(allowed.length,1);
  assert.equal(attempts.filter(x=>x.status===409).length,39);
  assert.equal((await send(stub,"upload-release",{
    scope:"drive-upload",id,profileId,claimId:allowed[0].body.claimId
  })).status,200);
  const retry=await send(stub,"upload-claim",{
    scope:"drive-upload",id,profileId,claimId:"retry-"+String(1).padStart(24,"0")
  });
  assert.equal(retry.status,200);
  const consumption=await Promise.all(Array.from({length:25},()=>send(stub,
    "upload-consume",{
      scope:"drive-upload",id,profileId,claimId:retry.body.claimId
    })
  ));
  assert.equal(consumption.filter(x=>x.status===200).length,1);
});

test("workerd leaves recovery challenge pending on read, but never after consume", async()=>{
  const env=await harness.getWorker().getEnv();
  const ns=env.SECURITY_COORDINATOR;
  const id="R".repeat(24)+crypto.randomUUID().replaceAll("-").slice(0,12);
  const stub=ns.get(ns.idFromName("security-challenge:recovery:"+id));
  const record={scope:"recovery",uid:"isolated-recovery-admin",
    email:"staging-test@example.invalid",expiresAt:Date.now()+120000};
  assert.equal((await send(stub,"challenge-put",{
    scope:"recovery",id,record
  })).status,200);
  const reads=await Promise.all(Array.from({length:20},()=>
    send(stub,"recovery-read",{scope:"recovery",id})
  ));
  assert.equal(reads.filter(x=>x.status===200).length,20);
  const claims=await Promise.all(Array.from({length:20},()=>
    send(stub,"challenge-consume",{scope:"recovery",id})
  ));
  assert.equal(claims.filter(x=>x.status===200).length,1);
  assert.equal((await send(stub,"recovery-read",{scope:"recovery",id})).status,400);
});
