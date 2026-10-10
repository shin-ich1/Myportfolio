import { storageBridgeUrl } from '../../storage-bridge-url.js';
import { signInSecurityCustomToken, signOutFirebaseAdministrator } from './adminAuthorizationService.js';

const SESSION_KEY = 'lan-admin-security-session';
const DEVICE_DB = 'lan-admin-security';
const DEVICE_STORE = 'device-identity';
const DEVICE_RECORD = 'current';
let volatileSession = null;
let stepUpProof = null;
let lastLoginEmail = '';

const text = v => String(v ?? '').trim();
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

function safeSessionStorage(){ try { return sessionStorage; } catch { return null; } }
function readStoredSession(){
  if (volatileSession) return volatileSession;
  try { const raw=safeSessionStorage()?.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeStoredSession(session){
  volatileSession=session || null;
  try { session ? safeSessionStorage()?.setItem(SESSION_KEY, JSON.stringify(session)) : safeSessionStorage()?.removeItem(SESSION_KEY); } catch {}
}

async function workerRequest(path, { method='POST', body=null, authorization=false }={}) {
  const url=storageBridgeUrl(path);
  if (!url) throw Object.assign(new Error('Security Gateway URL is not configured.'),{code:'security/gateway-not-configured'});
  const headers=new Headers({Accept:'application/json'});
  if (body != null) headers.set('Content-Type','application/json');
  if (authorization) {
    const bridge=window.__LAN_ADMIN_AUTH__ || window.parent?.__LAN_ADMIN_AUTH__;
    const token=await bridge?.getIdToken?.(false);
    if (!token) throw Object.assign(new Error('Administrator security session is required.'),{code:'security/session-required'});
    headers.set('Authorization',`Bearer ${token}`);
  }
  const response=await fetch(url,{method,headers,body:body==null?undefined:JSON.stringify(body),cache:'no-store'});
  const payload=await response.json().catch(()=>({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error || `Security Gateway returned HTTP ${response.status}.`),{code:payload?.code || `security/http-${response.status}`,status:response.status,retryAt:payload?.retryAt || ''});
  return payload;
}

function openDeviceDb(){
  return new Promise((resolve,reject)=>{
    if (!globalThis.indexedDB) return reject(Object.assign(new Error('IndexedDB is unavailable.'),{code:'security/indexeddb-unavailable'}));
    const request=indexedDB.open(DEVICE_DB,1);
    request.onupgradeneeded=()=>{ const db=request.result; if(!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE); };
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
}
async function deviceRecord(mode='readonly', mutator=null){
  const db=await openDeviceDb();
  try { return await new Promise((resolve,reject)=>{ const tx=db.transaction(DEVICE_STORE,mode); const store=tx.objectStore(DEVICE_STORE); if(mode==='readonly'){ const q=store.get(DEVICE_RECORD); q.onsuccess=()=>resolve(q.result||null); q.onerror=()=>reject(q.error); } else { Promise.resolve(mutator(store)).then(resolve,reject); } }); } finally { db.close(); }
}
async function putDevice(record){ return deviceRecord('readwrite',store=>new Promise((resolve,reject)=>{ const q=store.put(record,DEVICE_RECORD); q.onsuccess=()=>resolve(record); q.onerror=()=>reject(q.error); })); }
export async function clearLocalTrustedDevice(){ return deviceRecord('readwrite',store=>new Promise((resolve,reject)=>{ const q=store.delete(DEVICE_RECORD); q.onsuccess=()=>resolve(); q.onerror=()=>reject(q.error); })); }

export async function createDeviceKeyPair({renew=false}={}){
  const existing=await deviceRecord().catch(()=>null); if(!renew&&existing?.privateKey&&existing?.deviceId) return {deviceId:existing.deviceId,publicKeyJwk:existing.publicKeyJwk};
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const publicKeyJwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
  const deviceId=base64url(crypto.getRandomValues(new Uint8Array(24)));
  await putDevice({deviceId,privateKey:keys.privateKey,publicKeyJwk,createdAt:new Date().toISOString()});
  return {deviceId,publicKeyJwk};
}
async function signDeviceChallenge(challenge){
  const local=await deviceRecord(); if(!local?.privateKey || local.deviceId!==challenge.deviceId) throw Object.assign(new Error('Trusted-device key is unavailable.'),{code:'security/device-key-unavailable'});
  const data=new TextEncoder().encode(text(challenge.nonce));
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},local.privateKey,data);
  return base64url(sig);
}

async function completeCustomTokenSession(payload){
  if(!payload?.customToken || !payload?.session?.sessionId) throw Object.assign(new Error('Security Gateway did not return an approved session.'),{code:'security/session-incomplete'});
  const authorized=await signInSecurityCustomToken(payload.customToken);
  writeStoredSession(payload.session);
  return {...payload.session,authorized};
}

export async function signInAdministrator(email,password){
  lastLoginEmail=text(email);
  const local=await deviceRecord().catch(()=>null);
  const first=await workerRequest('/security/login/password',{body:{email:text(email),password:String(password??''),deviceId:local?.deviceId||''}});
  if(first.state==='trusted-device-challenge' && local?.privateKey){
    try {
      const signature=await signDeviceChallenge(first.challenge);
      const completed=await workerRequest('/security/device/login-complete',{body:{challengeId:first.challenge.challengeId,deviceId:local.deviceId,signature}});
      return {state:'authenticated',session:await completeCustomTokenSession(completed)};
    } catch(error) {
      if(first.fallbackChallengeId) return {state:'totp-required',challengeId:first.fallbackChallengeId};
      if(!String(error?.code||'').includes('device')) throw error;
    }
  }
  return first;
}
export async function completeTotpAdministratorLogin(code, challengeId){
  const payload=await workerRequest('/security/login/totp',{body:{challengeId:text(challengeId),code:text(code)}});
  return completeCustomTokenSession(payload);
}
export async function beginTotpEnrollment(password){ return workerRequest('/security/totp/enrollment/start',{body:{email:lastLoginEmail,password:String(password??'')}}); }
export async function completeTotpEnrollment(challengeId,code,displayName='Authenticator'){ const payload=await workerRequest('/security/totp/enrollment/complete',{body:{challengeId:text(challengeId),code:text(code),displayName:text(displayName)||'Authenticator'}}); return completeCustomTokenSession(payload); }
export async function sendAdministratorEmailVerification(password){ return workerRequest('/security/email-verification/send',{body:{email:lastLoginEmail,password:String(password??'')}}); }

export function getSecuritySession(){ const s=readStoredSession(); return s && (!s.expiresAt || Date.parse(s.expiresAt)>Date.now()) ? s : null; }
export async function getSecurityAuthorizationHeader(){ const bridge=window.__LAN_ADMIN_AUTH__||window.parent?.__LAN_ADMIN_AUTH__; const token=await bridge?.getIdToken?.(false); if(!token) throw new Error('Administrator security token is unavailable.'); return `Bearer ${token}`; }
async function clearRejectedSecuritySession(){
  writeStoredSession(null);
  stepUpProof=null;
  await signOutFirebaseAdministrator().catch(()=>{});
}
export async function validateCurrentSecuritySession(){
  if(!getSecuritySession()){
    await clearRejectedSecuritySession();
    throw Object.assign(new Error('Administrator security session is no longer active.'),{code:'security/session-required',status:401});
  }
  try {
    return await workerRequest('/security/session/validate',{method:'GET',authorization:true});
  } catch(error) {
    const code=String(error?.code||'');
    if(Number(error?.status)===401 || code==='security-session-expired' || code==='security/session-required') await clearRejectedSecuritySession();
    throw error;
  }
}
export async function logoutAdministrator(){
  let teardownError=null;
  try { if(getSecuritySession()) await workerRequest('/security/session/end',{body:{},authorization:true}); } catch(error){ teardownError=error; }
  writeStoredSession(null); stepUpProof=null;
  await signOutFirebaseAdministrator();
  if(teardownError) throw teardownError;
}

export async function requestTrustedDeviceLogin(email,password){ const local=await deviceRecord(); return workerRequest('/security/device/login-challenge',{body:{email:text(email),password:String(password??''),deviceId:local?.deviceId||''}}); }
export async function completeTrustedDeviceLogin(challenge){ const local=await deviceRecord(); const signature=await signDeviceChallenge({...challenge,deviceId:local.deviceId}); return completeCustomTokenSession(await workerRequest('/security/device/login-complete',{body:{challengeId:challenge.challengeId,deviceId:local.deviceId,signature}})); }
export async function createDeviceEnrollmentChallenge(){
  const proof=requireRecentStepUp('register trusted device');
  const current=getSecuritySession();
  const existing=await deviceRecord().catch(()=>null);
  // A successful emergency recovery or device revocation retires the OLD
  // server-side credential permanently. Explicit re-enrollment MUST create
  // a new device ID and non-extractable private key, not retry the IndexedDB
  // key the server correctly rejects as already registered.
  if(current?.trustLevel==='trusted' && current.deviceId &&
     existing?.deviceId===current.deviceId){
    throw Object.assign(new Error('This device is already trusted.'),{
      code:'security-device-already-trusted'
    });
  }
  const local=await createDeviceKeyPair({renew:true});
  const enrollment=await workerRequest('/security/device/enrollment/create',{body:{deviceId:local.deviceId,publicKeyJwk:local.publicKeyJwk,proofId:proof.proofId},authorization:true});
  const workspace=`pages/settings.html?room=security&approveDeviceEnrollment=${encodeURIComponent(enrollment.challengeId)}`;
  const enrollmentUrl=new URL(`/admin/shell.html?workspace=${encodeURIComponent(workspace)}`,window.location.origin).href;
  return {...enrollment,enrollmentUrl};
}
export async function getDeviceEnrollmentStatus(challengeId){ return workerRequest('/security/device/enrollment/status',{body:{challengeId:text(challengeId)},authorization:true}); }
export async function approveDeviceEnrollment(challengeId){ return workerRequest('/security/device/enrollment/approve',{body:{challengeId:text(challengeId),proofId:stepUpProof?.proofId||''},authorization:true}); }
export async function completeDeviceEnrollment(challengeId,displayName='Trusted device'){
  const local=await createDeviceKeyPair();
  const payload=await workerRequest('/security/device/enrollment/complete',{body:{challengeId:text(challengeId),deviceId:local.deviceId,publicKeyJwk:local.publicKeyJwk,displayName:text(displayName)||'Trusted device'},authorization:true});
  const session=await completeCustomTokenSession(payload);
  return {...payload,session};
}
export async function renameTrustedDevice(deviceId,displayName){ return workerRequest('/security/device/rename',{body:{deviceId,displayName},authorization:true}); }
export async function revokeTrustedDevice(deviceId){
  const result=await workerRequest('/security/device/revoke',{body:{deviceId,proofId:stepUpProof?.proofId||''},authorization:true});
  const local=await deviceRecord().catch(()=>null);
  const currentDeviceRevoked=result?.currentDeviceRevoked===true || local?.deviceId===deviceId;
  if(currentDeviceRevoked){
    await clearLocalTrustedDevice().catch(()=>{});
    writeStoredSession(null);
    stepUpProof=null;
    await signOutFirebaseAdministrator().catch(()=>{});
  }
  return {...result,currentDeviceRevoked};
}

export async function beginStepUpVerification(password){ return workerRequest('/security/step-up/start',{body:{password:String(password??'')},authorization:true}); }
export async function completeStepUpVerification(challengeId,code){ const proof=await workerRequest('/security/step-up/complete',{body:{challengeId:text(challengeId),code:text(code)},authorization:true}); stepUpProof=proof; return proof; }
export function requireRecentStepUp(action='sensitive-action'){
  if(!stepUpProof?.proofId || Date.parse(stepUpProof.expiresAt||0)<=Date.now()) throw Object.assign(new Error(`Recent password + authenticator verification is required for ${action}.`),{code:'security/step-up-required'});
  return stepUpProof;
}
export async function changeAdministratorPassword(newPassword){ const proof=requireRecentStepUp('change password'); return workerRequest('/security/account/password',{body:{newPassword:String(newPassword??''),proofId:proof.proofId},authorization:true}); }
export async function resetAuthenticatorEnrollment(){ const proof=requireRecentStepUp('reset authenticator'); const result=await workerRequest('/security/totp/reset',{body:{proofId:proof.proofId},authorization:true}); await clearLocalTrustedDevice().catch(()=>{}); writeStoredSession(null); stepUpProof=null; await signOutFirebaseAdministrator(); return result; }

export const getSecurityOverview=()=>workerRequest('/security/overview',{method:'GET',authorization:true});
export const getSecurityAccessState=()=>workerRequest('/security/access-state',{method:'GET',authorization:true});
export const listTrustedDevices=()=>workerRequest('/security/devices',{method:'GET',authorization:true});
export const listActiveSessions=()=>workerRequest('/security/sessions',{method:'GET',authorization:true});
export const revokeSession=sessionId=>workerRequest('/security/session/revoke',{body:{sessionId},authorization:true});
export const revokeAllOtherSessions=()=>workerRequest('/security/session/revoke-others',{body:{proofId:requireRecentStepUp('sign out all sessions').proofId},authorization:true});
export const revokeAllTemporarySessions=()=>workerRequest('/security/session/revoke-temporary',{body:{proofId:requireRecentStepUp('sign out temporary sessions').proofId},authorization:true});
export const listSecurityActivity=()=>workerRequest('/security/activity',{method:'GET',authorization:true});
export const getSecurityEmailBranding=()=>workerRequest('/security/email-branding',{method:'GET',authorization:true});
export const saveSecurityEmailBranding=branding=>workerRequest('/security/email-branding',{body:{branding,proofId:requireRecentStepUp('save security email branding').proofId},authorization:true});
export const getSecurityAlertStatus=()=>workerRequest('/security/alert-status',{method:'GET',authorization:true});
export async function generateRecoveryKit(){ const proof=requireRecentStepUp('rotate recovery kit'); return workerRequest('/security/recovery/generate',{body:{proofId:proof.proofId},authorization:true}); }
export async function activatePreparedRecoveryKit(rotationId,preparedKitId){
  const proof=requireRecentStepUp('activate the prepared recovery kit');
  return workerRequest('/security/recovery/rotate/activate',{
    body:{rotationId:text(rotationId),preparedKitId:text(preparedKitId),proofId:proof.proofId},
    authorization:true
  });
}
export const beginEmergencyRecovery=(email,password,recoveryKey)=>workerRequest('/security/recovery/start',{body:{email:text(email),password:String(password??''),recoveryKey:text(recoveryKey)}});
export const prepareRecoveryKit=recoverySessionId=>workerRequest('/security/recovery/prepare',{body:{recoverySessionId}});
export const completeRecoveryReset=(recoverySessionId,payload={})=>workerRequest('/security/recovery/complete',{body:{recoverySessionId,...payload}});
export const getRecoveryResetStatus=(recoverySessionId,preparedKitId)=>workerRequest('/security/recovery/status',{body:{recoverySessionId,preparedKitId}});
export const enterSecurityLockdown=()=>workerRequest('/security/lockdown/enter',{body:{proofId:requireRecentStepUp('enter lockdown').proofId},authorization:true});
export const exitSecurityLockdown=()=>workerRequest('/security/lockdown/exit',{body:{proofId:requireRecentStepUp('exit lockdown').proofId},authorization:true});
