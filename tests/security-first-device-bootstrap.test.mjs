import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";

const uid = "isolated-staging-admin";
const base = "projects/lan-portfolio-staging/databases/(default)/documents";
const result = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" }
});
const encode = value => {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (value && typeof value === "object")
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k,v]) => [k,encode(v)])) } };
  return { stringValue: String(value) };
};
const encFields = obj => Object.fromEntries(Object.entries(obj).map(([k,v]) => [k,encode(v)]));
const decode = value => value.booleanValue ?? value.stringValue ?? value.integerValue ??
  (value.mapValue ? Object.fromEntries(Object.entries(value.mapValue.fields).map(([k,v]) => [k,decode(v)])) : null);
const key = n => ({ kty: "EC", crv: "P-256", x: "X_" + n, y: "Y_" + n });
const jwt = sessionId => "mock." + Buffer.from(JSON.stringify({
  sub: uid, lanSecurityVerified: true, lanSessionId: sessionId,
  email: "staging-admin@example.invalid"
})).toString("base64url") + ".signature";

async function fixture({ historical = false, recovered = false } = {}) {
  const keys = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256"
  }, true, ["sign","verify"]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    Buffer.from(await crypto.subtle.exportKey("pkcs8",keys.privateKey)).toString("base64") +
    "\n-----END PRIVATE KEY-----";
  const docs = new Map();
  const put = (collection, id, doc) => docs.set(base + "/" + collection + "/" + id, structuredClone(doc));
  if (historical) put("adminSecurityDevices","previous-device", {
    uid, deviceId: "previous-device", active: false
  });
  if (recovered) put("adminSecurityRecovery",uid, {
    uid, active: true, deviceBootstrapEpoch: "new-recovery-generation"
  });
  for (const sid of ["s1","s2"]) {
    put("adminSecuritySessions", sid, {
      uid, sessionId: sid, active: true, trustLevel: "temporary",
      deviceId: "", createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now()+600000).toISOString()
    });
    put("adminSecurityStepUps","proof-"+sid, {
      uid, sessionId:sid, active:true, expiresAt: new Date(Date.now()+600000).toISOString()
    });
  }
  const namespace = new Map();
  const env = {
    FIREBASE_PROJECT_ID: "lan-portfolio-staging",
    FIREBASE_WEB_API_KEY: "test-only-noncredential",
    FIREBASE_SERVICE_ACCOUNT_EMAIL: "example@example.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
    SECURITY_RECOVERY_PEPPER: "TEST-ONLY-NOT-A-REAL-RECOVERY-PEPPER",
    SECURITY_COORDINATOR: {
      idFromName(name) { return name; },
      get(name) {
        if (!namespace.has(name)) {
          const records = new Map();
          const obj = new SecurityCoordinator({ storage: { kv: {
            get: key => records.get(key),
            put: (key, value) => records.set(key, structuredClone(value)),
            delete: key => records.delete(key)
          } } });
          namespace.set(name, { fetch(url, init) { return obj.fetch(new Request(url,init)); } });
        }
        return namespace.get(name);
      }
    }
  };
  let simultaneous = false, reads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const path = url.pathname;
    if (url.hostname === "oauth2.googleapis.com" && path === "/token")
      return result({ access_token: "test-only-access-token", expires_in: 3600 });
    if (path.endsWith("/accounts:update")) {
      return result({localId:uid});
    }
    if (path.endsWith("/documents/authorizedAdministrators/"+uid))
      return result({ fields: { active: { booleanValue: true } } });
    if (path.includes("/documents/") && (!options.method || options.method === "GET")) {
      const name = base + "/" + path.split("/documents/")[1];
      const doc = docs.get(name);
      return doc ? result({ name, fields: encFields(doc), updateTime: new Date().toISOString() })
        : result({},404);
    }
    if (path.endsWith("/documents:runQuery")) {
      const query = JSON.parse(options.body).structuredQuery;
      const coll = query.from[0].collectionId;
      let entries = [...docs].filter(([name, doc]) =>
        name.startsWith(base+"/"+coll+"/") && doc.uid === uid);
      if (query.where?.fieldFilter?.field.fieldPath === "active") {
        const desired = query.where.fieldFilter.value.booleanValue;
        entries = entries.filter(([,doc])=>doc.active === desired);
      }
      const snapshot = entries.slice(0,query.limit||100).map(([name,doc]) =>
        ({ document: {name,fields:encFields(doc)} }));
      if (simultaneous && coll === "adminSecurityDevices") {
        reads++;
        if (reads === 2) release();
        await gate;
      }
      return result(snapshot);
    }
    if (path.endsWith("/documents:commit")) {
      const writes = JSON.parse(options.body).writes;
      for (const write of writes) {
        const name = write.update?.name || write.delete;
        if (write.currentDocument?.exists === false && docs.has(name))
          return result({ error: { status:"FAILED_PRECONDITION",message:"document exists" } },400);
      }
      for (const write of writes) {
        const name = write.update?.name;
        if (!name) continue;
        const update = Object.fromEntries(Object.entries(write.update.fields||{})
          .map(([k,v])=>[k,decode(v)]));
        docs.set(name, write.updateMask ? { ...(docs.get(name)||{}), ...update } : update);
      }
      return result({ writeResults: writes.map(()=>({})) });
    }
    throw Error("Unexpected mock endpoint "+url.hostname+path);
  };
  return {
    sync() { simultaneous = true; }, get readCount() { return reads; },
    devices() { return [...docs].filter(([name])=>name.includes("/adminSecurityDevices/")); },
    credentials() { return [...docs].filter(([name])=>name.includes("/adminSecurityDeviceCredentials/")); },
    bootstrapClaims() { return [...docs].filter(([name])=>name.includes("/adminSecurityDeviceBootstrap/")); },
    recoveryRecord() {return docs.get(base+"/adminSecurityRecovery/"+uid)||null;},
    addLegacyDevice(id,publicKeyJwk,{active=true,approver=false}={}){
      put("adminSecurityDevices",id,{
        uid,deviceId:id,active,publicKeyJwk,
        displayName:"Preexisting trusted device"
      });
      if(approver){
        const name=base+"/adminSecuritySessions/s1";
        docs.set(name,{...docs.get(name),trustLevel:"trusted",deviceId:id});
      }
    },
    setRecoveryEpoch(epoch) { put("adminSecurityRecovery",uid,{
      uid,active:true,deviceBootstrapEpoch:epoch
    }); },
    get recoveryEpoch() {
      return docs.get(base+"/adminSecurityRecovery/"+uid)?.deviceBootstrapEpoch || "";
    },
    restoreFreshTemporarySession(id) {
      const name=base+"/adminSecuritySessions/"+id;
      const record=docs.get(name);
      if(!record)throw Error("session record absent");
      docs.set(name,{...record,active:true,trustLevel:"temporary",deviceId:"",
        createdAt:new Date().toISOString(),
        expiresAt:new Date(Date.now()+600000).toISOString()});
    },
    revokeDevice(id) {
      const name=base+"/adminSecurityDevices/"+id;
      const record=docs.get(name);
      if(!record)throw Error("device record absent");
      docs.set(name,{...record,active:false});
    },
    async post(sid,path,body) {
      const r = await worker.fetch(new Request(
        "https://lan-portfolio-staging.lagmayr2.workers.dev"+path,{
          method:"POST",
          headers:{ Origin:"https://lan-portfolio-staging.web.app",
            Authorization:"Bearer "+jwt(sid), "Content-Type":"application/json",
            "CF-Connecting-IP":"198.51.100.54" },
          body:JSON.stringify(body)
        }),env,{waitUntil(){}});
      return {status:r.status,body:await r.json()};
    },
    restore() { globalThis.fetch=original; }
  };
}

async function createChallenge(f,sid,id,index) {
  const pub=key(index);
  const r=await f.post(sid,"/security/device/enrollment/create",{
    proofId:"proof-"+sid,deviceId:id,publicKeyJwk:pub
  });
  assert.equal(r.status,200,JSON.stringify(r.body));
  return {sid,id,pub,challengeId:r.body.challengeId};
}
const complete = (f,c) => f.post(c.sid,"/security/device/enrollment/complete",{
  challengeId:c.challengeId,deviceId:c.id,publicKeyJwk:c.pub,displayName:c.id
});

test("two simultaneous first enrollments must atomically allow exactly one trusted device",async()=>{
  const f=await fixture();
  try{
    const enrollments=await Promise.all([
      createChallenge(f,"s1","first-device-a",1),
      createChallenge(f,"s2","first-device-b",2)
    ]);
    f.sync();
    const all=await Promise.all(enrollments.map(c=>complete(f,c)));
    assert.equal(f.readCount,2);
    assert.equal(all.filter(r=>r.status===200).length,1);
    assert.equal(all.filter(r=>r.body.code==="security-device-bootstrap-already-used").length,1);
    assert.equal(f.devices().length,1);
  }finally{f.restore();}
});

test("historically revoked devices must not reactivate first-device enrollment",async()=>{
  const f=await fixture({historical:true});
  try{
    const c=await createChallenge(f,"s1","unapproved-device",3);
    const r=await complete(f,c);
    assert.equal(r.status,403);
    assert.equal(r.body.code,"security-enrollment-approval-required");
    assert.equal(f.devices().length,1);
  }finally{f.restore();}
});

test("a new recovery generation permits only the first replacement enrollment",async()=>{
  const f=await fixture({historical:true,recovered:true});
  try{
    const first=await createChallenge(f,"s1","replacement-device",4);
    const a=await complete(f,first);
    assert.equal(a.status,200,JSON.stringify(a.body));
    const second=await createChallenge(f,"s2","second-device",5);
    const b=await complete(f,second);
    assert.equal(b.status,403);
    assert.equal(b.body.code,"security-enrollment-approval-required");
    assert.equal(f.devices().length,2);
  }finally{f.restore();}
});


test("two distinct approved devices cannot register one duplicated public-key credential",async()=>{
  const f=await fixture();
  try{
    const first=await createChallenge(f,"s1","first-unique-device",101);
    assert.equal((await complete(f,first)).status,200);
    const shared=key(909);
    const candidates=await Promise.all(["duplicate-key-device-a","duplicate-key-device-b"].map(async id=>{
      const created=await f.post("s2","/security/device/enrollment/create",{
        proofId:"proof-s2",deviceId:id,publicKeyJwk:shared
      });
      assert.equal(created.status,200);
      const approval=await f.post("s1","/security/device/enrollment/approve",{
        proofId:"proof-s1",challengeId:created.body.challengeId
      });
      assert.equal(approval.status,200,JSON.stringify(approval.body));
      return {sid:"s2",id,pub:shared,challengeId:created.body.challengeId};
    }));
    f.sync();
    const outcomes=await Promise.all(candidates.map(c=>complete(f,c)));
    assert.equal(outcomes.filter(r=>r.status===200).length,1);
    assert.equal(outcomes.filter(r=>r.body.code==="security-device-credential-duplicate").length,1);
    assert.equal(f.devices().length,2);
  }finally{f.restore();}
});

test("enrollment cannot overwrite an already-registered device ID",async()=>{
  const f=await fixture();
  try{
    const first=await createChallenge(f,"s1","durable-device-id",11);
    assert.equal((await complete(f,first)).status,200);
    const altered=key(12);
    const created=await f.post("s2","/security/device/enrollment/create",{
      proofId:"proof-s2",deviceId:"durable-device-id",publicKeyJwk:altered
    });
    assert.equal(created.status,200);
    const approval=await f.post("s1","/security/device/enrollment/approve",{
      proofId:"proof-s1",challengeId:created.body.challengeId
    });
    assert.equal(approval.status,200);
    const rejected=await f.post("s2","/security/device/enrollment/complete",{
      challengeId:created.body.challengeId,
      deviceId:"durable-device-id",publicKeyJwk:altered
    });
    assert.equal(rejected.status,409);
    assert.equal(f.devices().length,1);
    assert.equal(f.devices()[0][1].publicKeyJwk.x,key(11).x);
  }finally{f.restore();}
});


test("an enrollment created before a security reset cannot be redeemed in the new epoch",async()=>{
  const f=await fixture();
  try{
    const challenge=await createChallenge(f,"s1","stale-pre-reset-device",55);
    f.setRecoveryEpoch("fresh-reset-epoch");
    const rejected=await complete(f,challenge);
    assert.equal(rejected.status,403);
    assert.equal(rejected.body.code,"security-enrollment-epoch-changed");
    assert.equal(f.devices().length,0);
  }finally{f.restore();}
});

test("approval from a now-revoked trusted device cannot authorize enrollment",async()=>{
  const f=await fixture();
  try{
    const initial=await createChallenge(f,"s1","revocable-trusted-device",77);
    assert.equal((await complete(f,initial)).status,200);
    const second=await createChallenge(f,"s2","attempted-second-device",88);
    const approval=await f.post("s1","/security/device/enrollment/approve",{
      proofId:"proof-s1",challengeId:second.challengeId
    });
    assert.equal(approval.status,200);
    f.revokeDevice("revocable-trusted-device");
    const denied=await complete(f,second);
    assert.equal(denied.status,403);
    assert.equal(denied.body.code,"security-enrollment-approver-revoked");
    assert.equal(f.devices().length,1);
  }finally{f.restore();}
});


test("verified TOTP reset rotates the bootstrap epoch and permits fresh first enrollment",async()=>{
  const f=await fixture();
  try{
    const initial=await createChallenge(f,"s1","device-before-totp-reset",700);
    assert.equal((await complete(f,initial)).status,200);
    const reset=await f.post("s1","/security/totp/reset",{proofId:"proof-s1"});
    assert.equal(reset.status,200,JSON.stringify(reset.body));
    assert.equal(reset.body.bootstrapRequired,true);
    assert.ok(f.recoveryEpoch,"TOTP reset must rotate the authoritative first-device epoch");
    assert.equal(f.devices()[0][1].active,false);
    // Simulate a *separate*, freshly TOTP-verified temporary session after
    // Identity Platform MFA re-enrollment. No old session is reused.
    f.restoreFreshTemporarySession("s2");
    const fresh=await createChallenge(f,"s2","device-after-totp-reset",701);
    const completed=await complete(f,fresh);
    assert.equal(completed.status,200,JSON.stringify(completed.body));
    assert.equal(f.devices().length,2);
  }finally{f.restore();}
});


test("approved registration migrates historical active credential claims and bootstrap marker",async()=>{
  const f=await fixture();
  try{
    f.addLegacyDevice("preexisting-admin-device",key(200),{approver:true});
    const next=await createChallenge(f,"s2","newly-approved-device",201);
    const approved=await f.post("s1","/security/device/enrollment/approve",{
      proofId:"proof-s1",challengeId:next.challengeId
    });
    assert.equal(approved.status,200);
    const result=await complete(f,next);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(f.devices().length,2);
    assert.equal(f.credentials().length,2,
      "historical and new public keys must have unique authoritative claims");
    assert.equal(f.bootstrapClaims().length,1,
      "legacy first-device enrollment must be marked as already used");
    assert.ok(f.credentials().some(([,doc])=>doc.deviceId==="preexisting-admin-device"));
  }finally{f.restore();}
});

test("duplicate cryptographic credentials in historical active devices fail closed",async()=>{
  const f=await fixture();
  try{
    f.addLegacyDevice("historical-a",key(230),{approver:true});
    f.addLegacyDevice("historical-b",key(230));
    const next=await createChallenge(f,"s2","legitimate-new-device",231);
    const approved=await f.post("s1","/security/device/enrollment/approve",{
      proofId:"proof-s1",challengeId:next.challengeId
    });
    assert.equal(approved.status,200);
    const attempt=await complete(f,next);
    assert.equal(attempt.status,409);
    assert.equal(attempt.body.code,"security-device-credential-duplicate");
    assert.equal(f.devices().length,2);
  }finally{f.restore();}
});

test("incomplete historical active device keys block registration instead of silently skipping",async()=>{
  const f=await fixture();
  try{
    f.addLegacyDevice("valid-approver",key(270),{approver:true});
    f.addLegacyDevice("missing-credential",null);
    const next=await createChallenge(f,"s2","would-be-device",271);
    const approved=await f.post("s1","/security/device/enrollment/approve",{
      proofId:"proof-s1",challengeId:next.challengeId
    });
    assert.equal(approved.status,200);
    const attempt=await complete(f,next);
    assert.equal(attempt.status,503);
    assert.equal(attempt.body.code,"security-device-migration-required");
    assert.equal(f.devices().length,2);
  }finally{f.restore();}
});

test("signed-in normal Recovery Kit rotation does not invalidate the old key before saved-key activation",async()=>{
  const f=await fixture();
  try{
    const prepared=await f.post("s1","/security/recovery/generate",{
      proofId:"proof-s1"
    });
    assert.equal(prepared.status,200,JSON.stringify(prepared.body));
    assert.equal(prepared.body.state,"kit-prepared");
    assert.ok(prepared.body.masterKey);
    assert.equal(prepared.body.backupCodes.length,8);
    assert.equal(f.recoveryRecord(),null,"preparing must not modify Recovery Key authority");
    const mismatch=await f.post("s1","/security/recovery/rotate/activate",{
      rotationId:prepared.body.rotationId,
      preparedKitId:"Z".repeat(32),proofId:"proof-s1"
    });
    assert.equal(mismatch.status,403);
    assert.equal(f.recoveryRecord(),null);
    const activated=await f.post("s1","/security/recovery/rotate/activate",{
      rotationId:prepared.body.rotationId,
      preparedKitId:prepared.body.preparedKitId,proofId:"proof-s1"
    });
    assert.equal(activated.status,200,JSON.stringify(activated.body));
    assert.equal(activated.body.state,"recovery-kit-active");
    assert.equal(activated.body.masterKey,undefined);
    const record=f.recoveryRecord();
    assert.equal(record?.active,true);
    assert.equal(record?.lastRotationId,prepared.body.rotationId);
    assert.equal(record?.lastPreparedKitId,prepared.body.preparedKitId);
    assert.notEqual(record?.masterKeyHash,prepared.body.masterKey);
    const replay=await f.post("s1","/security/recovery/rotate/activate",{
      rotationId:prepared.body.rotationId,
      preparedKitId:prepared.body.preparedKitId,proofId:"proof-s1"
    });
    assert.equal(replay.status,200);
    assert.equal(replay.body.alreadyCompleted,true);
    assert.equal(replay.body.masterKey,undefined);
  }finally{f.restore();}
});

test("post-recovery enrollment rejects the retired public key but accepts a new unique key without resurrecting the old device",async()=>{
  const f=await fixture({recovered:true});
  try{
    f.addLegacyDevice("retired-before-recovery",key(850),{active:false});
    const reused=await createChallenge(f,"s1","retired-before-recovery",850);
    const rejected=await complete(f,reused);
    assert.equal(rejected.status,409);
    assert.equal(rejected.body.code,"security-device-credential-duplicate");
    assert.equal(f.devices().length,1);
    assert.equal(f.devices()[0][1].active,false,"old server-side device remains revoked");

    const fresh=await createChallenge(f,"s1","fresh-after-recovery",851);
    const enrolled=await complete(f,fresh);
    assert.equal(enrolled.status,200,JSON.stringify(enrolled.body));
    assert.equal(f.devices().length,2);
    assert.equal(f.devices().find(([,doc])=>doc.deviceId==="retired-before-recovery")[1].active,false);
    assert.equal(f.devices().find(([,doc])=>doc.deviceId==="fresh-after-recovery")[1].active,true);
    assert.equal(f.credentials().length,1,"new credential has a unique server-side claim");
    assert.equal(f.bootstrapClaims().length,1,"fresh recovery epoch can only bootstrap once");
    assert.equal((await complete(f,fresh)).status,400,"first enrollment challenge cannot be reused");
  }finally{f.restore();}
});

test("explicit trusted-device enrollment rotates local key material; completing the challenge retains that exact new key",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../admin/services/adminSecurityService.js",import.meta.url),"utf8");
  assert.match(source,/export async function createDeviceKeyPair\(\{renew=false\}=\{\}\)/);
  assert.match(source,/if\(!renew&&existing\?\.privateKey&&existing\?\.deviceId\)/);
  assert.match(source,/export async function createDeviceEnrollmentChallenge\(\)[\s\S]*?createDeviceKeyPair\(\{renew:true\}\)/);
  assert.match(source,/export async function completeDeviceEnrollment\([^)]*\)[\s\S]*?createDeviceKeyPair\(\);/);
  assert.match(source,/requireRecentStepUp\('register trusted device'\)[\s\S]*?createDeviceKeyPair\(\{renew:true\}\)/,
    "do not rotate a stored credential without a recent step-up proof");
});
