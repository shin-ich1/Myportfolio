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
      const snapshot = entries.map(([name,doc]) => ({ document: {name,fields:encFields(doc)} }));
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
