import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";

const origin="https://lan-portfolio-staging.web.app";
const workerUrl="https://lan-portfolio-staging.lagmayr2.workers.dev";
const state="drv-"+"A".repeat(32);
const record={
  scope:"drive-oauth-state",profileId:"staging-drive-profile",
  uid:"staging-admin-uid",origin,
  redirectUri:workerUrl+"/storage/google-drive/connect/callback",
  expiresAt:Date.now()+600000
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json"}
});

test("OAuth callback can exchange one authorization code at most once under 25 concurrent replays",async()=>{
  const objects=new Map(),kvState=new Map();
  kvState.set("oauth-state:"+state,JSON.stringify(record));
  const coordinator={
    idFromName:name=>name,
    get(name){
      if(!objects.has(name)){
        const entries=new Map();
        const o=new SecurityCoordinator({storage:{kv:{
          get:k=>entries.get(k),
          put:(k,v)=>entries.set(k,structuredClone(v)),
          delete:k=>entries.delete(k)
        }}});
        objects.set(name,{fetch:(url,init)=>o.fetch(new Request(url,init))});
      }
      return objects.get(name);
    }
  };
  const stateStub=coordinator.get(coordinator.idFromName(
    "security-challenge:drive-oauth-state:"+state
  ));
  const created=await stateStub.fetch("https://security-coordinator.internal/operation",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({op:"challenge-put",scope:"drive-oauth-state",id:state,record})
  });
  assert.equal(created.status,200);
  let kvReads=0,exchangeCalls=0,releaseReads;
  const gate=new Promise(resolve=>{releaseReads=resolve;});
  const env={
    FIREBASE_PROJECT_ID:"lan-portfolio-staging",
    SECURITY_COORDINATOR:coordinator,
    GOOGLE_DRIVE_CLIENT_ID:"isolated-test-client",
    GOOGLE_DRIVE_CLIENT_SECRET:"isolated-test-secret",
    STORAGE_OAUTH:{
      async get(key,type){
        const snap=kvState.get(key)||null;
        if(key.startsWith("oauth-state:")){
          kvReads++;
          if(kvReads===25)releaseReads();
          await gate;
        }
        return snap ? (type==="json"?JSON.parse(snap):snap) : null;
      },
      async delete(key){kvState.delete(key);},
      async put(key,value){kvState.set(key,value);},
      async list(){return {keys:[]};}
    }
  };
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    if(String(url)==="https://oauth2.googleapis.com/token"){
      exchangeCalls++;
      const form=new URLSearchParams(options.body);
      assert.equal(form.get("code"),"test-only-authorization-code");
      assert.equal(form.get("redirect_uri"),record.redirectUri);
      return json({error:"invalid_grant"},400);
    }
    throw Error("Unexpected external network call");
  };
  try{
    const callbackUrl=workerUrl+"/storage/google-drive/connect/callback?state="+
      encodeURIComponent(state)+"&code=test-only-authorization-code";
    const attempts=await Promise.all(Array.from({length:25},
      ()=>worker.fetch(new Request(callbackUrl),env,{waitUntil(){}})));
    assert.equal(exchangeCalls,1,
      "Only one callback may reach Google regardless of concurrent replay");
    assert.equal(attempts.filter(x=>x.status===400).length,24);
    assert.equal(attempts.filter(x=>x.status===502).length,1);
    const replay=await worker.fetch(new Request(callbackUrl),env,{waitUntil(){}});
    assert.equal(replay.status,400);
    assert.equal(exchangeCalls,1);
  }finally{globalThis.fetch=original;}
});

test("wrong or expired OAuth states never perform a token exchange",async()=>{
  const coordinator={
    idFromName:n=>n,
    get(){
      const store=new Map();
      const instance=new SecurityCoordinator({storage:{kv:{
        get:k=>store.get(k),put:(k,v)=>store.set(k,v),delete:k=>store.delete(k)
      }}});
      return {fetch:(url,init)=>instance.fetch(new Request(url,init))};
    }
  };
  const env={SECURITY_COORDINATOR:coordinator,
    STORAGE_OAUTH:{get:async()=>null,put:async()=>{},delete:async()=>{}}};
  const res=await worker.fetch(new Request(workerUrl+
    "/storage/google-drive/connect/callback?state=drv-invalid&code=bad"),
    env,{waitUntil(){}});
  assert.equal(res.status,400);
});
