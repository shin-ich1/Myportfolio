import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../telemetry-worker/src/index.js',import.meta.url),'utf8');
const login=readFileSync(new URL('../admin/js/admin.js',import.meta.url),'utf8');
const loginHtml=readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('../admin/services/adminSecurityService.js',import.meta.url),'utf8');
const securitySettings=readFileSync(new URL('../admin/js/settings-security.js',import.meta.url),'utf8');
const docs=readFileSync(new URL('../docs/staging-security-readiness.md',import.meta.url),'utf8');

function route(path){
  const token="if(path==='"+path+"'&&method==='POST')";
  const start=worker.indexOf(token);
  assert.ok(start>=0,'missing canonical route '+path);
  const end=worker.indexOf("\n    if(path===",start+token.length);
  return worker.slice(start,end<0?worker.length:end);
}

test('step-up password and TOTP attempts are both atomically rate-limited before credential verification',()=>{
  assert.match(worker,/['"]step-up-password['"]\s*:\s*\{limit:\d+,windowSeconds:\d+[\s\S]*?cooldownSeconds:/);
  assert.match(worker,/['"]step-up-totp['"]\s*:\s*\{limit:\d+,windowSeconds:\d+[\s\S]*?cooldownSeconds:/);
  const start=route('/security/step-up/start');
  assert.match(start,/await enforceSecurityRateLimit\(request,env,'step-up-password'\)/);
  assert.ok(start.indexOf("enforceSecurityRateLimit")<start.indexOf("verifyFirebasePassword"),
    'rate limit must precede password challenge');
  const complete=route('/security/step-up/complete');
  assert.match(complete,/await enforceSecurityRateLimit\(request,env,'step-up-totp'\)/);
  assert.ok(complete.indexOf("enforceSecurityRateLimit")<complete.indexOf("consumeSecurityChallenge"),
    'rate limit must precede one-use TOTP challenge consumption');
  assert.match(complete,/type:'step-up-failure'/,'failed step-up TOTP must write a security audit event');
  assert.doesNotMatch(complete,/console\.(?:log|error)\([^)]*(?:body\.code|c\.mfaPendingCredential)/);
});

test('password-only email verification send is specifically rate-limited before Firebase credential checks',()=>{
  assert.match(worker,/['"]email-verify-send['"]\s*:\s*\{limit:\d+,windowSeconds:\d+[\s\S]*?cooldownSeconds:/);
  const send=route('/security/email-verification/send');
  assert.match(send,/await enforceSecurityRateLimit\(request,env,'email-verify-send'\)/);
  assert.ok(send.indexOf("enforceSecurityRateLimit")<send.indexOf("verifyFirebasePassword"));
});

test('security email branding requires fresh server-validated step-up and rejects unsafe logo URL',()=>{
  assert.match(route('/security/email-branding'),/verifyStepUp\(admin\.uid,admin\.session\.sessionId,body\.proofId,env\)/);
  assert.match(worker,/function validateSecurityBrandingLogoUrl\(/);
  assert.match(worker,/protocol\s*!==\s*'https:'/);
  assert.match(worker,/security-email-branding-url-invalid/);
  assert.match(client,/saveSecurityEmailBranding[\s\S]*requireRecentStepUp\('save security email branding'\)/);
  assert.match(securitySettings,/await stepUp\('save security email branding'\)/);
});

test('Resend API acceptance is recorded as accepted rather than falsely claimed delivered',()=>{
  const start=worker.indexOf('async function sendSecurityEmailAlert(');
  assert.ok(start>=0);
  const end=worker.indexOf('async function dispatchSecurityAlerts(',start);
  const send=worker.slice(start,end);
  assert.match(send,/state:'accepted',providerId:/);
  assert.doesNotMatch(send,/state:'sent'/);
});

test('emergency recovery warns explicitly before the destructive server recovery request',()=>{
  const start=login.indexOf("if(recoverySubmitButton) recoverySubmitButton.addEventListener");
  const end=login.indexOf("window.addEventListener('beforeunload'",start);
  const submit=login.slice(start,end);
  assert.match(submit,/window\.confirm\(/,'browser must explicitly confirm destructive recovery start');
  assert.ok(submit.indexOf('window.confirm(')<submit.indexOf('beginEmergencyRecovery('),
    'confirmation must occur BEFORE the server claims the recovery key');
  assert.match(submit,/cannot be canceled|cannot be undone/i);
  assert.match(loginHtml,/closing (?:the )?(?:browser|window).*not cancel/i);
  assert.match(loginHtml,/revokes.*sessions.*trusted devices/i);
});

test('staging readiness document records historical status as historical, not current deployment state',()=>{
  assert.match(docs,/2026-10-11/);
  assert.match(docs,/7c12ae960d5b9b246036ca6d17f11a734b8f8629/);
  assert.match(docs,/staging.*deployed/i);
});
