import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";

const ORIGIN="https://lan-portfolio-staging.web.app";
const TARGET="https://lan-portfolio-staging.lagmayr2.workers.dev";
const UID="staging-isolated-admin";
const SID="isolated-session";
const PROFILE="isolated-profile";
const FILE_ID="isolated-file-123";
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json"}
});
const jwt="mock."+Buffer.from(JSON.stringify({
  sub:UID,lanSecurityVerified:true,lanSessionId:SID,
  email:"isolated-admin@example.invalid"
})).toString("base64url")+".signature";
const encodeRecord=record=>({
  fields:Object.fromEntries(Object.entries(record).map(([k,v])=>[k,
    typeof v==="boolean"?{booleanValue:v}:{stringValue:String(v)}
  ]))
});

async function fixture({ failedDriveVerifications=0, failedUploads=0 }={}){
  const generated=await crypto.subtle.generateKey({
    name:"RSASSA-PKCS1-v1_5",modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"
  },true,["sign","verify"]);
  const pem="-----BEGIN PRIVATE KEY-----\n"+
    Buffer.from(await crypto.subtle.exportKey("pkcs8",generated.privateKey))
      .toString("base64")+"\n-----END PRIVATE KEY-----";
  const objects=new Map(),kv=new Map();
  const namespaces={
    idFromName:name=>name,
    get(name){
      if(!objects.has(name)){
        const records=new Map();
        const owner=new SecurityCoordinator({storage:{kv:{
          get:key=>records.get(key),
          put:(key,value)=>records.set(key,structuredClone(value)),
          delete:key=>records.delete(key)
        }}});
        objects.set(name,{fetch:(url,init)=>owner.fetch(new Request(url,init))});
      }
      return objects.get(name);
    }
  };
  kv.set("drive-token:"+PROFILE,JSON.stringify({
    accessToken:"isolated-drive-access-token",
    accessTokenExpiresAt:Date.now()+600000
  }));
  let driveVerifications=0,uploads=0,assetWrites=0;
  const env={
    FIREBASE_PROJECT_ID:"lan-portfolio-staging",
    FIREBASE_WEB_API_KEY:"isolated-web-config",
    FIREBASE_SERVICE_ACCOUNT_EMAIL:"isolation-test@example.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY:pem,
    SECURITY_COORDINATOR:namespaces,
    STORAGE_OAUTH:{
      async get(key,mode){
        const value=kv.get(key);
        return !value?null:mode==="json"?JSON.parse(value):value;
      },
      async put(key,value){
        kv.set(key,value);
        if(key.startsWith("drive-asset:"))assetWrites++;
      },
      async delete(key){kv.delete(key);},
      async list(){return {keys:[]}}
    }
  };
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(typeof input==="string"?input:input.url);
    const path=url.pathname;
    if(url.hostname==="oauth2.googleapis.com"&&path==="/token"){
      return json({access_token:"isolated-service-token",expires_in:3600});
    }
    if(path.endsWith("/documents/authorizedAdministrators/"+UID)){
      return json({fields:{active:{booleanValue:true}}});
    }
    if(path.endsWith("/documents/adminSecuritySessions/"+SID)){
      return json(encodeRecord({
        uid:UID,sessionId:SID,active:true,trustLevel:"temporary",deviceId:"",
        createdAt:new Date().toISOString(),
        expiresAt:new Date(Date.now()+600000).toISOString()
      }));
    }
    if(path.endsWith("/documents/adminSecurityState/"+UID))return json({},404);
    if(url.hostname==="www.googleapis.com" && path.endsWith("/files/"+FILE_ID)){
      driveVerifications++;
      if(failedDriveVerifications-- > 0)return json({error:"temporary"},503);
      return json({
        id:FILE_ID,name:"test-photo.jpg",mimeType:"image/jpeg",
        size:"7",parents:["isolated-folder"],trashed:false,
        appProperties:{lanStorageProfile:PROFILE,lanAccess:"public-preview"}
      });
    }
    if(url.hostname==="upload.isolated.invalid"){
      uploads++;
      if(failedUploads-- > 0)return json({error:"temporary"},503);
      return json({id:FILE_ID});
    }
    throw Error("Unexpected request: "+url.hostname+path);
  };
  const initialize=async(id)=>{
    const stub=namespaces.get(namespaces.idFromName(
      "security-challenge:drive-upload:"+id
    ));
    const response=await stub.fetch("https://security-coordinator.internal/operation",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        op:"challenge-put",scope:"drive-upload",id,
        record:{
          scope:"drive-upload",profileId:PROFILE,folderId:"isolated-folder",
          name:"test-photo.jpg",mimeType:"image/jpeg",bytes:7,
          access:"public-preview",context:{source:"test"},
          sessionUrl:"https://upload.isolated.invalid/session",
          expiresAt:Date.now()+600000
        }
      })
    });
    assert.equal(response.status,200);
  };
  const post=async(path,body)=>{
    let request;
    if(body instanceof FormData){
      request=new Request(TARGET+path,{
        method:"POST",headers:{Origin:ORIGIN,Authorization:"Bearer "+jwt,
          "CF-Connecting-IP":"198.51.100.88"},body
      });
    }else{
      request=new Request(TARGET+path,{
        method:"POST",headers:{Origin:ORIGIN,Authorization:"Bearer "+jwt,
          "CF-Connecting-IP":"198.51.100.88","Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
    }
    const resp=await worker.fetch(request,env,{waitUntil(){}});
    return {status:resp.status,body:await resp.json()};
  };
  return {
    initialize,post,kv,
    stats(){return {driveVerifications,uploads,assetWrites}},
    restore(){globalThis.fetch=oldFetch}
  };
}

test("Worker HTTP finalize routes allow only one of 25 concurrent pending-upload confirmations",async()=>{
  const f=await fixture();
  try{
    const pendingToken="up-"+"H".repeat(32);
    await f.initialize(pendingToken);
    const responses=await Promise.all(Array.from({length:25},()=>f.post(
      "/storage/google-drive/finalize",{
        profileId:PROFILE,pendingToken,fileId:FILE_ID
      })));
    assert.equal(responses.filter(x=>x.status===200).length,1);
    assert.equal(responses.filter(x=>x.status===409).length,24);
    assert.equal(f.stats().assetWrites,1);
    assert.equal(f.stats().driveVerifications,1);
    const replay=await f.post("/storage/google-drive/finalize",{
      profileId:PROFILE,pendingToken,fileId:FILE_ID
    });
    assert.equal(replay.status,409);
    assert.equal(f.stats().assetWrites,1);
  }finally{f.restore();}
});

test("Worker HTTP finalize releases pending lease after upstream Drive failure then permits retry",async()=>{
  const f=await fixture({failedDriveVerifications:1});
  try{
    const pendingToken="up-"+"J".repeat(32);
    await f.initialize(pendingToken);
    const payload={profileId:PROFILE,pendingToken,fileId:FILE_ID};
    const failed=await f.post("/storage/google-drive/finalize",payload);
    assert.equal(failed.status,502);
    assert.equal(f.stats().assetWrites,0);
    const success=await f.post("/storage/google-drive/finalize",payload);
    assert.equal(success.status,200);
    assert.equal(f.stats().assetWrites,1);
    assert.equal(f.stats().driveVerifications,2);
  }finally{f.restore();}
});

test("Worker HTTP upload-content rejects concurrent use and allows retry after a failed upstream PUT",async()=>{
  const f=await fixture({failedUploads:1});
  try{
    const pendingToken="up-"+"K".repeat(32);
    await f.initialize(pendingToken);
    const content=()=>{
      const form=new FormData();
      form.set("profileId",PROFILE);
      form.set("pendingToken",pendingToken);
      form.set("file",new Blob(["1234567"],{type:"image/jpeg"}),"photo.jpg");
      return form;
    };
    const failed=await f.post("/storage/google-drive/upload-content",content());
    assert.equal(failed.status,502);
    assert.equal(f.stats().assetWrites,0);
    const responses=await Promise.all(Array.from({length:16},()=>
      f.post("/storage/google-drive/upload-content",content())
    ));
    assert.equal(responses.filter(x=>x.status===200).length,1);
    assert.equal(responses.filter(x=>x.status===409).length,15);
    assert.equal(f.stats().uploads,2,"only failed initial PUT and one successful retry");
    assert.equal(f.stats().assetWrites,1);
  }finally{f.restore();}
});
