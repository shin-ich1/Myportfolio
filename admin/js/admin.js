import {
  signInAdministrator,
  completeTotpAdministratorLogin,
  beginTotpEnrollment,
  completeTotpEnrollment,
  sendAdministratorEmailVerification,
  beginEmergencyRecovery,
  prepareRecoveryKit,
  completeRecoveryReset,
  getRecoveryResetStatus
} from "../services/adminSecurityService.js";
import { authorizationMessage } from "../services/adminAuthorizationService.js";
import { createQrMatrix } from "./qr-code.js";

const $ = id => document.getElementById(id);
const loginForm=$('loginForm'),emailInput=$('email'),passwordInput=$('password'),loginButton=$('loginButton'),loginMessage=$('loginMessage'),togglePassword=$('togglePassword');
const totpStage=$('totpStage'),totpCode=$('totpCode'),totpVerifyButton=$('totpVerifyButton'),totpError=$('totpError');
const enrollmentStage=$('totpEnrollmentStage'),enrollmentQr=$('totpEnrollmentQr'),manualSecret=$('totpManualSecret'),enrollmentCode=$('totpEnrollmentCode'),enrollmentButton=$('totpEnrollmentButton');
const emailStage=$('emailVerificationStage'),sendVerificationButton=$('sendVerificationButton');
const recoveryStage=$('recoveryStage'),showRecoveryButton=$('showRecoveryButton'),recoverySubmitButton=$('recoverySubmitButton'),recoveryResult=$('recoveryResult'),recoveryEmail=$('recoveryEmail'),recoveryPassword=$('recoveryPassword'),recoveryMasterKey=$('recoveryMasterKey'),recoveryNewEmail=$('recoveryNewEmail'),recoveryError=$('recoveryError');
const loginVerificationOverlay=$('loginVerificationOverlay'),loginVerificationTitle=$('loginVerificationTitle'),loginVerificationDetail=$('loginVerificationDetail'),loginVerificationCodeCenter=$('loginVerificationCodeCenter');
const loginVerificationCodeDigits=Array.from(document.querySelectorAll('[data-code-index]'));
let pendingTotpChallenge='', pendingEnrollmentChallenge='', pendingBootstrapPassword='', verificationCodeTimer=0;
let recoveryActivationPending=false;

function showMessage(message,type='error'){ if(!loginMessage)return; loginMessage.textContent=message; loginMessage.className=`login-message ${type}`; }
function clearMessage(){ showMessage('',''); }
function setLoading(on,label='Signing In...'){ if(!loginButton)return; loginButton.disabled=on; loginButton.textContent=on?label:'Login to Dashboard'; }
function stopVerificationCodeAnimation(){ if(verificationCodeTimer){window.clearInterval(verificationCodeTimer);verificationCodeTimer=0;} }
function setVerificationLoading(on,title='Verifying…',detail='Securely checking your credentials.',mode='password',code=''){
  if(!loginVerificationOverlay)return;
  stopVerificationCodeAnimation();
  loginVerificationOverlay.hidden=!on;
  loginVerificationOverlay.dataset.mode=mode==='code'?'code':'password';
  loginForm?.setAttribute('aria-busy',on?'true':'false');
  if(loginVerificationTitle)loginVerificationTitle.textContent=title;
  if(loginVerificationDetail)loginVerificationDetail.textContent=detail;
  if(!on)return;
  if(mode==='code'){
    const digits=String(code||'').replace(/\D/g,'').slice(0,6).padEnd(6,'•').split('');
    loginVerificationCodeDigits.forEach((node,index)=>{node.textContent=digits[index]||'•';});
    let index=0;
    if(loginVerificationCodeCenter)loginVerificationCodeCenter.textContent=digits[index]||'•';
    verificationCodeTimer=window.setInterval(()=>{index=(index+1)%digits.length;if(loginVerificationCodeCenter)loginVerificationCodeCenter.textContent=digits[index]||'•';},180);
  }
}
function setTotpFieldError(message=''){ if(!totpCode||!totpError)return; if(message){totpCode.setAttribute('aria-invalid','true');totpError.textContent=message;totpError.hidden=false;}else{totpCode.removeAttribute('aria-invalid');totpError.textContent='';totpError.hidden=true;} }
function setRecoveryError(message='',field=null){ if(!recoveryError)return; for(const input of [recoveryEmail,recoveryPassword,recoveryMasterKey,recoveryNewEmail]) input?.removeAttribute('aria-invalid'); if(message){field?.setAttribute('aria-invalid','true');recoveryError.textContent=message;recoveryError.hidden=false;}else{recoveryError.textContent='';recoveryError.hidden=true;} }
function hideStages(){ for(const node of [totpStage,enrollmentStage,emailStage,recoveryStage]) if(node) node.hidden=true; }
function getFriendlyError(error){ const code=String(error?.code||''); const messages={'security-password-invalid':'The email or password is incorrect.','security-totp-invalid':'That authenticator code is invalid or expired.','security-rate-limited':'Too many attempts. Try again after the cooldown.','security-session-expired':'Your security session expired. Sign in again.','security-device-proof-invalid':'Trusted-device proof failed. Authenticator verification is required.'}; if(messages[code])return messages[code]; if(code.startsWith('authorization/'))return authorizationMessage(error); return error?.message||'Login failed. Please try again.'; }
function openAdminShell(){ window.location.replace('shell.html'); }
function renderQr(target,value){ target.replaceChildren(); const matrix=createQrMatrix(value); const size=matrix.length; const canvas=document.createElement('canvas'); const scale=Math.max(4,Math.floor(232/(size+8))); canvas.width=(size+8)*scale; canvas.height=(size+8)*scale; const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);})); target.append(canvas); }

async function handlePrimaryResult(result,password){
  hideStages();
  if(result?.state==='authenticated'){ showMessage('Login successful. Opening your dashboard...','success'); return openAdminShell(); }
  if(result?.state==='totp-required'){ pendingTotpChallenge=result.challengeId; totpStage.hidden=false; totpCode?.focus(); showMessage('Authenticator verification is required.','success'); return; }
  if(result?.state==='email-verification-required'){ pendingBootstrapPassword=password; emailStage.hidden=false; showMessage('Verify the administrator email before security setup can continue.'); return; }
  if(result?.state==='totp-enrollment-required'){
    pendingBootstrapPassword=password;
    const enrollment=await beginTotpEnrollment(password); pendingEnrollmentChallenge=enrollment.challengeId; manualSecret.textContent=enrollment.manualSecret||''; renderQr(enrollmentQr,enrollment.totpUri); enrollmentStage.hidden=false; enrollmentCode?.focus(); showMessage('Set up an authenticator to finish security bootstrap.','success'); return;
  }
  throw Object.assign(new Error('Security Gateway returned an unsupported login state.'),{code:'security/login-state'});
}

async function refreshTotpLoginChallenge(error){
  const result=await signInAdministrator(emailInput.value.trim(),passwordInput.value);
  if(result?.state==='totp-required'){
    pendingTotpChallenge=result.challengeId;
    if(totpCode)totpCode.value='';
    totpStage.hidden=false;
    totpCode?.focus();
    const code=String(error?.code||'');
    if(code==='security-totp-invalid'){
      setTotpFieldError('Authenticator code is invalid or expired.');
      clearMessage();
    }else{
      setTotpFieldError('Verification expired. Enter the current authenticator code to try again.');
      clearMessage();
    }
    return;
  }
  await handlePrimaryResult(result,passwordInput.value);
}

if(togglePassword&&passwordInput) togglePassword.addEventListener('click',()=>{const hidden=passwordInput.type==='password';passwordInput.type=hidden?'text':'password';togglePassword.textContent=hidden?'Hide':'Show';togglePassword.setAttribute('aria-label',hidden?'Hide password':'Show password');});
if(loginForm&&emailInput&&passwordInput&&loginButton) loginForm.addEventListener('submit',async event=>{event.preventDefault();clearMessage();setTotpFieldError('');hideStages();const email=emailInput.value.trim(),password=passwordInput.value;if(!email||!password)return showMessage('Please enter your email address and password.');setLoading(true);setVerificationLoading(true,'Verifying…','Securely checking your administrator password.','password');try{await handlePrimaryResult(await signInAdministrator(email,password),password);}catch(error){console.error('Administrator security login failed:',error);showMessage(getFriendlyError(error));}finally{setVerificationLoading(false);setLoading(false);}});
if(totpVerifyButton) totpVerifyButton.addEventListener('click',async()=>{const code=String(totpCode?.value||'').trim();setTotpFieldError('');if(!/^\d{6}$/.test(code))return setTotpFieldError('Enter the 6-digit authenticator code.');totpVerifyButton.disabled=true;setVerificationLoading(true,'Verifying code…','Checking your authenticator code and active security challenge.','code',code);try{await completeTotpAdministratorLogin(code,pendingTotpChallenge);showMessage('Login successful. Opening your dashboard...','success');openAdminShell();}catch(error){const errorCode=String(error?.code||'');if(['security-totp-invalid','security-challenge-invalid','security-challenge-expired'].includes(errorCode)){try{await refreshTotpLoginChallenge(error);}catch(refreshError){showMessage(getFriendlyError(refreshError));}}else showMessage(getFriendlyError(error));}finally{setVerificationLoading(false);totpVerifyButton.disabled=false;}});
if(totpCode){ totpCode.addEventListener('input',()=>setTotpFieldError('')); totpCode.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();event.stopPropagation();totpVerifyButton?.click();}); }
if(enrollmentCode) enrollmentCode.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();event.stopPropagation();enrollmentButton?.click();});
// A rejected attempt consumes the one-time Firebase enrollment challenge.
// Rebuild the QR from a NEW backend challenge, never reuse the old secret or
// pretend that entering another code can redeem an already-consumed challenge.
async function renewTotpEnrollmentChallenge(error){
  const code=String(error?.code||'');
  if(!['security-totp-enrollment-code-invalid','security-totp-enrollment-session-expired',
        'security-challenge-invalid','security-challenge-expired'].includes(code))return false;
  if(!pendingBootstrapPassword)throw Error('Please sign in again to prepare a fresh authenticator.');
  pendingEnrollmentChallenge='';
  const fresh=await beginTotpEnrollment(pendingBootstrapPassword);
  if(!fresh?.challengeId||!fresh?.totpUri)throw Error('A fresh authenticator challenge could not be created.');
  pendingEnrollmentChallenge=fresh.challengeId;
  manualSecret.textContent=fresh.manualSecret||'';
  renderQr(enrollmentQr,fresh.totpUri);
  if(enrollmentCode)enrollmentCode.value='';
  enrollmentStage.hidden=false;
  enrollmentCode?.focus();
  showMessage(code==='security-totp-enrollment-code-invalid'
    ? 'That code was not accepted. A NEW QR is ready: scan it in your authenticator and enter its current code.'
    : 'The previous QR expired or was already used. Scan this NEW QR and enter its current code.');
  return true;
}
if(enrollmentButton) enrollmentButton.addEventListener('click',async()=>{
  const code=String(enrollmentCode?.value||'').trim();
  if(!/^\d{6}$/.test(code))return showMessage('Enter the 6-digit authenticator code.');
  enrollmentButton.disabled=true;
  setVerificationLoading(true,'Verifying code…','Confirming your authenticator enrollment code.','code',code);
  try{
    await completeTotpEnrollment(pendingEnrollmentChallenge,code,'LΛN Admin');
    pendingBootstrapPassword='';
    pendingEnrollmentChallenge='';
    showMessage('Authenticator enrolled. Opening your dashboard...','success');
    openAdminShell();
  }catch(error){
    try{
      if(!await renewTotpEnrollmentChallenge(error))showMessage(getFriendlyError(error));
    }catch(renewalError){
      pendingEnrollmentChallenge='';
      enrollmentStage.hidden=true;
      showMessage('Could not prepare a fresh authenticator. Sign in again. '+getFriendlyError(renewalError));
    }
  }finally{
    setVerificationLoading(false);
    enrollmentButton.disabled=false;
  }
});
if(sendVerificationButton) sendVerificationButton.addEventListener('click',async()=>{sendVerificationButton.disabled=true;try{await sendAdministratorEmailVerification(pendingBootstrapPassword);showMessage('Firebase verification email requested. After verifying it, submit your email and password again.','success');}catch(error){showMessage(getFriendlyError(error));}finally{sendVerificationButton.disabled=false;}});
if(showRecoveryButton) showRecoveryButton.addEventListener('click',()=>{hideStages();clearMessage();setRecoveryError('');recoveryStage.hidden=false;if(recoveryEmail&&!recoveryEmail.value)recoveryEmail.value=emailInput?.value||'';recoveryEmail?.focus();});
if(recoverySubmitButton) recoverySubmitButton.addEventListener('click',async()=>{
  const email=String(recoveryEmail?.value||'').trim();
  const password=String(recoveryPassword?.value||'');
  const recoveryKey=String(recoveryMasterKey?.value||'').trim();
  const newEmail=String(recoveryNewEmail?.value||'').trim();
  setRecoveryError('');clearMessage();
  if(recoveryActivationPending)return;
  if(!email||!password||!recoveryKey){
    return setRecoveryError('Enter the Admin email, current password, and Master Recovery Key.');
  }
  // Emergency Recovery is destructive at /start, BEFORE replacement-key
  // preparation or activation. Closing a browser cannot cancel a committed
  // server reset. Confirm this exact boundary before sending ANY credentials.
  if(!window.confirm(
    'Emergency Recovery will immediately revoke ALL Admin sessions and trusted devices, invalidate existing Firebase tokens, and remove the authenticator enrollment if your key is valid. This reset cannot be canceled or undone by closing the browser. You must save and activate a new Recovery Kit, then set up TOTP and trusted devices again. Continue?'
  ))return;
  recoverySubmitButton.disabled=true;
  recoveryResult.hidden=true;
  try{
    const recovery=await beginEmergencyRecovery(email,password,recoveryKey);
    const prepared=await prepareRecoveryKit(recovery.recoverySessionId);
    if(prepared.state!=='kit-prepared' || !prepared.preparedKitId || !prepared.masterKey ||
       !Array.isArray(prepared.backupCodes) || prepared.backupCodes.length!==8){
      throw Error('Security Gateway did not prepare a complete Recovery Kit.');
    }
    recoveryActivationPending=true;
    recoveryResult.replaceChildren();
    recoveryResult.hidden=false;

    const title=document.createElement('strong');
    title.textContent='Save the NEW Recovery Kit before activating it.';
    const key=document.createElement('code');
    key.textContent=prepared.masterKey;
    const codes=document.createElement('pre');
    codes.textContent=prepared.backupCodes.join('\n');
    const explanation=document.createElement('p');
    explanation.textContent='This kit is not active yet. Save the entire key and all backup codes offline. Do not close this page until activation is confirmed.';
    const savedLabel=document.createElement('label');
    const saved=document.createElement('input');
    saved.type='checkbox';saved.id='recoveryKitSavedConfirmation';
    const savedText=document.createElement('span');
    savedText.textContent=' I saved the new Master Recovery Key and all eight backup codes offline.';
    savedLabel.append(saved,savedText);
    const activate=document.createElement('button');
    activate.type='button';activate.className='login-button';
    activate.textContent='Activate saved Recovery Kit';
    activate.disabled=true;
    saved.addEventListener('change',()=>{activate.disabled=!saved.checked;});
    const state=document.createElement('p');
    state.setAttribute('role','status');state.setAttribute('aria-live','polite');

    async function confirmRecovery(result){
      if(result?.state!=='bootstrap-required')throw Error('Recovery confirmation is incomplete.');
      recoveryActivationPending=false;
      saved.disabled=true;activate.disabled=true;
      // The Admin explicitly confirmed an offline copy. Clear plaintext from
      // the DOM after server activation, never persist it in localStorage.
      key.textContent='';
      codes.textContent='';
      activate.textContent='Recovery Kit activated';
      state.textContent='Security reset confirmed. Your saved Recovery Kit is now valid. Sign in to re-enroll TOTP and a trusted device.';
      for(const input of [recoveryPassword,recoveryMasterKey]) if(input)input.value='';
      if(result.email)emailInput.value=result.email;
      if(passwordInput)passwordInput.value='';
      showMessage('Recovery confirmed. Keep the saved new Recovery Kit offline.','success');
    }
    activate.addEventListener('click',async()=>{
      if(!saved.checked || !recoveryActivationPending)return;
      activate.disabled=true;
      state.textContent='Activating Recovery Kit and verifying server confirmation…';
      try{
        let result;
        try{
          result=await completeRecoveryReset(recovery.recoverySessionId,{
            preparedKitId:prepared.preparedKitId,newEmail
          });
        }catch(error){
          // If the commit succeeded but the HTTP response was lost, confirm
          // the exact prepared kit on the server; never generate another key.
          const checked=await getRecoveryResetStatus(recovery.recoverySessionId,
            prepared.preparedKitId).catch(()=>null);
          if(checked?.state!=='bootstrap-required')throw error;
          result=checked;
        }
        await confirmRecovery(result);
      }catch(error){
        state.textContent='Activation is not confirmed. Your saved key is still shown. Check the connection, then retry activation without regenerating this kit.';
        setRecoveryError(getFriendlyError(error));
        activate.disabled=!saved.checked;
      }
    });
    recoveryResult.append(title,key,codes,explanation,savedLabel,activate,state);
    showMessage('Save the displayed Recovery Kit, then explicitly activate it.','success');
  }catch(error){
    const code=String(error?.code||'');
    if(code==='security-recovery-key-invalid'){
      setRecoveryError('Recovery key is invalid.',recoveryMasterKey);clearMessage();
    }else if(code==='security-password-invalid'||code==='security-recovery-password'){
      setRecoveryError('The Admin email or password is incorrect.',recoveryPassword);clearMessage();
    }else{
      setRecoveryError(getFriendlyError(error));clearMessage();
    }
  }finally{
    if(!recoveryActivationPending)recoverySubmitButton.disabled=false;
  }
});
window.addEventListener('beforeunload',event=>{
  if(!recoveryActivationPending)return;
  event.preventDefault();
  event.returnValue='';
});
for(const input of [recoveryEmail,recoveryPassword,recoveryMasterKey,recoveryNewEmail]) input?.addEventListener('input',()=>setRecoveryError(''));

const query=new URL(window.location.href).searchParams;if(query.get('error')==='unauthorized')showMessage('This Firebase account is not authorized to use the CMS.');
