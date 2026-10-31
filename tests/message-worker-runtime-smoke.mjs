// Standalone local Wrangler smoke, never imported by Public/Admin or Firebase Hosting.
// Does NOT call message creation, verification, or any Admin endpoint.
import assert from "node:assert/strict";

const origin = "http://127.0.0.1:5500";
const localWorker = "http://127.0.0.1:8788";
const run = async () => {
  const health = await fetch(localWorker + "/health", {signal:AbortSignal.timeout(5000)});
  assert.equal(health.status,200,"local Worker must start");
  const data = await health.json();
  assert.equal(data.firebaseConfigured,true);
  assert.equal(data.securityCoordinatorConfigured,true);
  assert.equal(data.messagePushConfigured,true);
  assert.equal(data.messageSecurityConfigured,true);
  console.log("PASS: isolated Worker ready with local KV/DO; no Firebase network requests");

  const began=Date.now();
  const response=await fetch(localWorker+"/messages/security/challenge",{
    method:"POST",headers:{"Origin":origin,"Content-Type":"application/json"},
    body:"{}",signal:AbortSignal.timeout(45000)
  });
  const payload=await response.json();
  assert.equal(response.status,201,
    "challenge must succeed: "+JSON.stringify({status:response.status,error:payload.error,code:payload.code}));
  assert.match(payload.challengeId,/^[a-zA-Z0-9_-]{24}$/);
  assert.match(payload.siteKey,/^1x00000000000000000000AA$/,"official Turnstile localhost test site key");
  assert.ok(["LAN Portfolio","Openverse"].includes(payload.image.source),"Only canonical Openverse or built-in Worker image");
  if (process.env.EXPECT_IMAGE_SOURCE) assert.equal(payload.image.source, process.env.EXPECT_IMAGE_SOURCE, "Forcing isolated fallback pool must use the locally generated image");
  assert.equal(payload.image.url,localWorker+"/messages/security/challenge/"+payload.challengeId+"/image");
  console.log("PASS: real challenge created through local Worker with source "+payload.image.source+" in "+(Date.now()-began)+" ms");

  const image=await fetch(payload.image.url,{
    headers:{"Origin":origin,"Accept":"image/*"},
    signal:AbortSignal.timeout(16000)
  });
  assert.equal(image.status,200,"challenge image must be delivered");
  assert.match(image.headers.get("content-type")||"",/^image\//i,"must deliver actual image bytes");
  const bytes=await image.arrayBuffer();
  assert.ok(bytes.byteLength>1024,"image payload must be nonempty and usable");
  console.log("PASS: real puzzle image endpoint returned "+bytes.byteLength+" bytes, "+image.headers.get("content-type"));
  console.log("PASS: message sending not attempted; no LIVE or staging Firebase calls.");
};
await run().catch(error => {console.error("FAIL: isolated Worker real-runtime test:",error);process.exitCode=1;});
