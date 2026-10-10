import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { SecurityCoordinator } from '../telemetry-worker/src/index.js';

// Runs canonical Worker HTTP handlers with ephemeral fake Firebase records and
// the same strongly-consistent coordinator. No network or real credentials.
const UID='security-hardening-mock-admin';
const ORIGIN='https://lan-portfolio-staging.web.app';
const WORKER='https://lan-portfolio-staging.lagmayr2.workers.dev';
const record=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json'}
});
const jwt='mock.'+Buffer.from(JSON.stringify({
  sub:UID,email:'admin@example.invalid',lanSecurityVerified:true,lanSessionId:'s1'
})).toString('base64url')+'.test-only-signature';
const fields=obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,
  typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)}
]));
async function fixture({authMode='mfa'}={}){
  const records=new Map(),doObjects=new Map();
  const now=new Date().toISOString(), expiresAt=new Date(Date.now()+900000).toISOString();
  const base='projects/lan-portfolio-staging/databases/(default)/documents';
  records.set(base+'/adminSecuritySessions/s1',{uid:UID,sessionId:'s1',
    active:true,trustLevel:'temporary',expiresAt});
  records.set(base+'/adminSecurityStepUps/proof-1',{uid:UID,sessionId:'s1',
    active:true,createdAt:now,expiresAt});
  const env={
    FIREBASE_PROJECT_ID:'lan-portfolio-staging',FIREBASE_WEB_API_KEY:'test-only-api-key',
    SECURITY_COORDINATOR:{
      idFromName(name){return name;},
      get(name){
        if(!doObjects.has(name)){
          const kv=new Map();
          const obj=new SecurityCoordinator({storage:{kv:{
            get:k=>kv.get(k),
            put:(k,v)=>kv.set(k,structuredClone(v)),
            delete:k=>kv.delete(k)
          }}});
          doObjects.set(name,{fetch:(url,init)=>obj.fetch(new Request(url,init))});
        }
        return doObjects.get(name);
      }
    }
  };
  let passwordCalls=0,totpFinalizes=0,verificationEmails=0,failedStepUpEvents=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    const path=url.pathname;
    if(path.endsWith('/accounts:signInWithPassword')){
      passwordCalls++;
      if(authMode==='password')return record({
        localId:UID,email:'admin@example.invalid',idToken:'fake-password-id-token',
        emailVerified:true
      });
      return record({error:{message:'MFA_REQUIRED',details:[{
        mfaPendingCredential:'pending-mfa-only-for-tests',
        mfaInfo:[{uid:UID,mfaEnrollmentId:'test-authenticator',totpInfo:{}}]
      }]}},400);
    }
    if(path.endsWith('/accounts:lookup'))return record({users:[{
      localId:UID,email:'admin@example.invalid',emailVerified:true
    }]});
    if(path.endsWith('/accounts/mfaSignIn:finalize')){
      totpFinalizes++;
      return record({error:{message:'INVALID_TOTP_CODE'}},400);
    }
    if(path.endsWith('/accounts:sendOobCode')){
      verificationEmails++;
      return record({email:'admin@example.invalid'});
    }
    if(path.endsWith('/documents/authorizedAdministrators/'+UID)){
      return record({fields:{active:{booleanValue:true}}});
    }
    if(path.includes('/documents/')&&(!init.method||init.method==='GET')){
      const name=base+'/'+path.split('/documents/')[1];
      const doc=records.get(name);
      return doc?record({name,fields:fields(doc),updateTime:now}):record({},404);
    }
    if(path.endsWith('/documents:commit')){
      const writes=JSON.parse(init.body).writes||[];
      for(const write of writes){
        if(write.update?.name?.includes('/adminSecurityEvents/')){
          const payload=write.update.fields||{};
          if(payload.type?.stringValue==='step-up-failure')failedStepUpEvents++;
        }
        const name=write.update?.name;
        if(name){
          const update=Object.fromEntries(Object.entries(write.update.fields||{}).map(
            ([k,v])=>[k,v.stringValue??v.booleanValue??v.integerValue??null]));
          records.set(name,{...(records.get(name)||{}),...update});
        }
      }
      return record({writeResults:writes.map(()=>({}))});
    }
    throw Error('Unexpected security test mock request: '+path);
  };
  return {
    stats(){return {passwordCalls,totpFinalizes,verificationEmails,failedStepUpEvents};},
    async post(path,body,ip='192.0.2.54'){
      const response=await worker.fetch(new Request(WORKER+path,{
        method:'POST',headers:{
          Origin:ORIGIN,'CF-Connecting-IP':ip,'Content-Type':'application/json',
          Authorization:'Bearer '+jwt
        },body:JSON.stringify(body)
      }),env,{waitUntil(){}});
      return {status:response.status,body:await response.json()};
    },
    restore(){globalThis.fetch=original;}
  };
}
test('live Worker step-up password route throttles before it invokes Firebase again',async()=>{
  const f=await fixture();
  try{
    const attempts=[];
    for(let i=0;i<12;i++)attempts.push(await f.post('/security/step-up/start',{
      password:'only-test-password'
    }));
    assert.equal(attempts.filter(x=>x.status===200).length,10);
    assert.equal(attempts.filter(x=>x.status===429).length,2);
    assert.equal(attempts[10].body.code,'security-rate-limited');
    assert.equal(f.stats().passwordCalls,10,'blocked password attempts cannot reach Firebase');
  }finally{f.restore();}
});
test('live Worker step-up TOTP route locks out repeated bad codes and audits all failures',async()=>{
  const f=await fixture();
  try{
    const ids=[];
    for(let i=0;i<8;i++){
      const started=await f.post('/security/step-up/start',{password:'test-password'});
      assert.equal(started.status,200,JSON.stringify(started.body));
      ids.push(started.body.challengeId);
    }
    for(let i=0;i<ids.length;i++){
      const result=await f.post('/security/step-up/complete',{
        challengeId:ids[i],code:'000000'
      });
      assert.equal(result.status,i<7?401:429,JSON.stringify(result.body));
      assert.equal(result.body.code,i<7?'security-step-up-invalid':'security-rate-limited');
    }
    assert.equal(f.stats().totpFinalizes,7,
      'eighth code must be rejected BEFORE asking Firebase or using its challenge');
    assert.equal(f.stats().failedStepUpEvents,7);
  }finally{f.restore();}
});
test('live Worker email verification sends only three provider requests per limit window',async()=>{
  const f=await fixture({authMode:'password'});
  try{
    const codes=[];
    for(let i=0;i<4;i++){
      const result=await f.post('/security/email-verification/send',{
        email:'admin@example.invalid',password:'test-password'
      });
      codes.push(result.status);
    }
    assert.deepEqual(codes,[200,200,200,429]);
    assert.equal(f.stats().verificationEmails,3);
    assert.equal(f.stats().passwordCalls,3);
  }finally{f.restore();}
});
test('Security Email Branding rejects URL attacks and unauthorized edits before committing preferences',async()=>{
  const f=await fixture();
  try{
    const missing=await f.post('/security/email-branding',{
      branding:{logoUrl:'https://images.example.invalid/logo.png'}
    });
    assert.equal(missing.status,403);
    assert.equal(missing.body.code,'security-step-up-required');
    for(const logoUrl of ['javascript:alert(1)','data:image/svg+xml,PHN2Zz4=',
      'http://images.example.invalid/photo.png','https://localhost/image.png',
      'https://127.0.0.1/photo.png','https://user:pass@images.example.invalid/a.png']){
      const result=await f.post('/security/email-branding',{
        proofId:'proof-1',branding:{logoUrl}
      });
      assert.equal(result.status,400,JSON.stringify({logoUrl,result}));
      assert.equal(result.body.code,'security-email-branding-url-invalid');
    }
  }finally{f.restore();}
});
