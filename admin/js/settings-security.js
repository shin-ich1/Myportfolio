import {
  getSecurityOverview,
  getSecurityAccessState,
  beginStepUpVerification,
  completeStepUpVerification,
  createDeviceEnrollmentChallenge,
  getDeviceEnrollmentStatus,
  approveDeviceEnrollment,
  completeDeviceEnrollment,
  renameTrustedDevice,
  revokeTrustedDevice,
  revokeSession,
  revokeAllOtherSessions,
  revokeAllTemporarySessions,
  changeAdministratorPassword,
  resetAuthenticatorEnrollment,
  generateRecoveryKit,
  activatePreparedRecoveryKit,
  listSecurityActivity,
  getSecurityEmailBranding,
  saveSecurityEmailBranding
} from '../services/adminSecurityService.js';
import { createQrMatrix } from './qr-code.js';

const $ = id => document.getElementById(id);
let overview = null;
let currentEnrollment = null;
let activeStepUpRequest = null;
let enrollmentWatchTimer = null;
let enrollmentCompletionInFlight = false;
let securityAccessStateWatchTimer = null;
let securityAccessStateRefreshInFlight = false;
let recoveryRotationActivationPending = false;
const SECURITY_ACCESS_STATE_SYNC_INTERVAL_MS = 3000;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const when = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

function friendlyTrustedDeviceName(deviceOrUserAgent) {
  const device = typeof deviceOrUserAgent === 'object' && deviceOrUserAgent ? deviceOrUserAgent : null;
  const explicit = String(device?.displayName || '').trim();
  if (explicit && !['This device', 'Trusted device'].includes(explicit)) return explicit;
  const userAgent = String(device?.browserSummary || deviceOrUserAgent || '');
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
      : /Firefox\//.test(userAgent) ? 'Firefox'
        : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent) ? 'Safari'
          : 'Browser';
  const platform = /Windows NT/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
      : /iPhone|iPad|iPod/.test(userAgent) ? 'iPhone/iPad'
        : /Macintosh|Mac OS X/.test(userAgent) ? 'macOS'
          : /Linux/.test(userAgent) ? 'Linux'
            : 'device';
  return `${browser} on ${platform}`;
}

function renderQr(target, value) {
  target.replaceChildren();
  const matrix = createQrMatrix(value);
  const scale = Math.max(3, Math.floor(220 / (matrix.length + 8)));
  const canvas = document.createElement('canvas');
  canvas.width = (matrix.length + 8) * scale;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  matrix.forEach((row, y) => row.forEach((dot, x) => {
    if (dot) context.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
  }));
  target.append(canvas);
}

function itemEmpty(text) {
  return `<div class="lan-empty-state"><strong>${esc(text)}</strong></div>`;
}

function render() {
  const devices = (overview?.devices || []).filter(device => device.active !== false);
  const sessions = (overview?.sessions || []).filter(session => session.active !== false && Date.parse(session.expiresAt) > Date.now());
  const events = overview?.events || [];
  const currentTrustedDevice = devices.find(device => device.current);
  const canManageSecurity = overview?.capabilities?.securityManagement === true;
  const registerTrustedDeviceButton = $('registerTrustedDeviceButton');
  const currentTrustedDeviceState = $('currentTrustedDeviceState');
  const revokeOtherSessionsButton = $('revokeOtherSessionsButton');
  const revokeTemporarySessionsButton = $('revokeTemporarySessionsButton');

  if (registerTrustedDeviceButton) registerTrustedDeviceButton.hidden = Boolean(currentTrustedDevice);
  if (revokeOtherSessionsButton) revokeOtherSessionsButton.hidden = !canManageSecurity;
  if (revokeTemporarySessionsButton) revokeTemporarySessionsButton.hidden = !canManageSecurity;
  if (currentTrustedDeviceState) {
    currentTrustedDeviceState.hidden = !currentTrustedDevice;
    currentTrustedDeviceState.textContent = currentTrustedDevice ? 'This device is trusted' : '';
  }
  if (currentEnrollment?.approvalOnly) {
    const approveTrustedDeviceButton = $('approveTrustedDeviceButton');
    if (approveTrustedDeviceButton) approveTrustedDeviceButton.hidden = !canManageSecurity || currentEnrollment.approved === true;
    if (!canManageSecurity && currentEnrollment.approved !== true) $('trustedDeviceStatus').textContent = 'Open this enrollment link on an authenticated trusted device to approve it.';
  }

  $('securityGatewayState').textContent = overview?.lockdown ? 'Lockdown active' : 'Protected';
  $('securityGatewayState').className = overview?.lockdown ? 'health-pill danger' : 'health-pill success';
  $('recoveryKitState').textContent = overview?.recovery?.configured ? 'Recovery Kit ready' : 'Not generated';
  $('securityEmailProviderState').textContent = overview?.emailProvider === 'configured' ? 'Configured' : 'Not configured';
  $('securityVerifiedEmail').textContent = overview?.account?.emailVerified
    ? `${overview.account.email} · Verified`
    : `${overview?.account?.email || 'Email'} · Unverified`;
  $('securityTotpState').textContent = overview?.account?.totpEnrolled ? 'Enrolled' : 'Not enrolled';

  $('trustedDevicesList').innerHTML = devices.length
    ? devices.map(device => `<article class="settings-security-item"><div><strong>${esc(friendlyTrustedDeviceName(device))} ${device.current ? '<em>Current device</em>' : ''}</strong><span>${esc(device.browserSummary || 'Browser device')}</span><small>Trusted ${when(device.createdAt)} · Last used ${when(device.lastUsedAt)}</small></div>${canManageSecurity ? `<div class="settings-actions"><button class="editor-secondary-button button-compact" data-device-rename="${esc(device.deviceId)}">Rename</button><button class="editor-danger-button button-compact" data-device-revoke="${esc(device.deviceId)}">Revoke</button></div>` : ''}</article>`).join('')
    : itemEmpty('No trusted devices yet.');

  $('activeSessionsList').innerHTML = sessions.length
    ? sessions.map(session => {
      const trustLevel = session.trustLevel === 'trusted' ? 'trusted' : 'temporary';
      const trustLabel = trustLevel === 'trusted' ? 'Trusted' : 'Temporary / Untrusted';
      return `<article class="settings-security-item settings-security-session" data-session-trust="${trustLevel}"><div><strong><b class="settings-security-session-badge" data-session-trust="${trustLevel}">${trustLabel}</b>${session.current ? '<em>Current session</em>' : ''}</strong><span>${esc(friendlyTrustedDeviceName(session.userAgent || ''))}</span><small>${esc(session.userAgent || 'Browser session')}</small><small>Created ${when(session.createdAt)} · Expires ${when(session.expiresAt)}</small></div>${canManageSecurity && !session.current ? `<button class="editor-danger-button button-compact" data-session-revoke="${esc(session.sessionId)}">Sign out</button>` : ''}</article>`;
    }).join('')
    : itemEmpty('No active sessions.');

  $('securityActivityList').innerHTML = events.length
    ? events.map(event => `<article class="settings-security-item settings-security-event"><div><strong>${esc(String(event.type || 'security event').replaceAll('-', ' '))}</strong><span>${esc(event.summary || '')}</span><small>${when(event.createdAt)} · ${event.success === false ? 'Failed' : 'Recorded'}</small></div></article>`).join('')
    : itemEmpty('No security activity recorded yet.');
}

async function refresh() {
  try {
    overview = await getSecurityOverview();
    render();
  } catch (error) {
    $('securityGatewayState').textContent = 'Unavailable';
    $('securityGatewayState').className = 'health-pill danger';
    console.error('Security overview failed:', error);
  }
}

function securityPanelIsLiveVisible() {
  const panel = document.querySelector('[data-lan-panel="security"]');
  return document.visibilityState === 'visible' && Boolean(panel) && !panel.classList.contains('workspace-panel-hidden');
}

async function refreshSecurityAccessState() {
  if (!overview || securityAccessStateRefreshInFlight || !securityPanelIsLiveVisible()) return;
  securityAccessStateRefreshInFlight = true;
  try {
    const accessState = await getSecurityAccessState();
    overview = { ...overview, ...accessState };
    render();
  } catch (error) {
    console.warn('Security access-state refresh failed:', error);
  } finally {
    securityAccessStateRefreshInFlight = false;
  }
}

function stopSecurityAccessStateWatch() {
  if (securityAccessStateWatchTimer) clearTimeout(securityAccessStateWatchTimer);
  securityAccessStateWatchTimer = null;
}

function startSecurityAccessStateWatch({ immediate = false } = {}) {
  stopSecurityAccessStateWatch();
  if (!securityPanelIsLiveVisible()) return;
  const run = async () => {
    securityAccessStateWatchTimer = null;
    await refreshSecurityAccessState();
    if (securityPanelIsLiveVisible()) {
      securityAccessStateWatchTimer = setTimeout(run, SECURITY_ACCESS_STATE_SYNC_INTERVAL_MS);
    }
  };
  securityAccessStateWatchTimer = setTimeout(run, immediate ? 0 : SECURITY_ACCESS_STATE_SYNC_INTERVAL_MS);
}

window.addEventListener('focus', () => {
  if (!securityPanelIsLiveVisible()) return;
  void refreshSecurityAccessState();
  startSecurityAccessStateWatch();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    stopSecurityAccessStateWatch();
    return;
  }
  if (!securityPanelIsLiveVisible()) return;
  void refreshSecurityAccessState();
  startSecurityAccessStateWatch();
});

document.addEventListener('lan:tabchange', event => {
  if (event.detail?.key !== 'security') {
    stopSecurityAccessStateWatch();
    return;
  }
  startSecurityAccessStateWatch({ immediate: true });
});

window.addEventListener('pagehide', stopSecurityAccessStateWatch);

function stopEnrollmentApprovalWatch() {
  if (enrollmentWatchTimer) clearTimeout(enrollmentWatchTimer);
  enrollmentWatchTimer = null;
}

async function finishCurrentDeviceEnrollment({ automatic = false } = {}) {
  if (!currentEnrollment || currentEnrollment.approvalOnly || enrollmentCompletionInFlight) return;
  const challengeId = currentEnrollment.challengeId;
  const status = $('trustedDeviceStatus');
  const completeButton = $('completeTrustedDeviceEnrollmentButton');
  enrollmentCompletionInFlight = true;
  stopEnrollmentApprovalWatch();
  if (completeButton) completeButton.disabled = true;
  status.textContent = automatic ? 'Approved by trusted device. Finishing enrollment…' : 'Finishing trusted-device enrollment…';
  try {
    await completeDeviceEnrollment(challengeId, friendlyTrustedDeviceName(navigator.userAgent));
    if (currentEnrollment?.challengeId === challengeId) currentEnrollment = null;
    $('trustedDeviceEnrollment').hidden = true;
    status.textContent = 'This device is trusted. Security controls are now available.';
    await refresh();
  } catch (error) {
    status.textContent = error.message;
    if (completeButton) {
      completeButton.hidden = false;
      completeButton.disabled = false;
    }
    throw error;
  } finally {
    enrollmentCompletionInFlight = false;
  }
}

function startEnrollmentApprovalWatch(challengeId, expiresAt) {
  stopEnrollmentApprovalWatch();
  const poll = async () => {
    if (!currentEnrollment || currentEnrollment.approvalOnly || currentEnrollment.challengeId !== challengeId) return;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      $('trustedDeviceStatus').textContent = 'Enrollment challenge expired. Start Trust This Device again.';
      return;
    }
    try {
      const result = await getDeviceEnrollmentStatus(challengeId);
      if (result?.state === 'approved') {
        await finishCurrentDeviceEnrollment({ automatic: true });
        return;
      }
      enrollmentWatchTimer = setTimeout(poll, 1200);
    } catch (error) {
      const code = String(error?.code || '');
      if (code === 'security-enrollment-invalid' || code === 'security-enrollment-expired') {
        $('trustedDeviceStatus').textContent = error.message;
        return;
      }
      enrollmentWatchTimer = setTimeout(poll, 1800);
    }
  };
  enrollmentWatchTimer = setTimeout(poll, 600);
}

function clearEnrollmentApprovalRoute() {
  const cleanUrl = new URL(window.location.href);
  if (!cleanUrl.searchParams.has('approveDeviceEnrollment')) return;
  cleanUrl.searchParams.delete('approveDeviceEnrollment');
  history.replaceState(null, '', cleanUrl);
  const replaceShellRoute = window.parent !== window ? window.parent?.LANAdminReplaceWorkspaceRoute : null;
  if (typeof replaceShellRoute === 'function') replaceShellRoute(cleanUrl.href);
}

async function finishApproverEnrollmentSync(challengeId, message) {
  if (!currentEnrollment?.approvalOnly || currentEnrollment.challengeId !== challengeId) return;
  stopEnrollmentApprovalWatch();
  await refresh();
  const panel = $('trustedDeviceEnrollment');
  if (panel) panel.hidden = true;
  currentEnrollment = null;
  clearEnrollmentApprovalRoute();
  $('trustedDeviceStatus').textContent = message;
}

function startApproverEnrollmentCompletionWatch(challengeId, expiresAt) {
  stopEnrollmentApprovalWatch();
  const poll = async () => {
    if (!currentEnrollment?.approvalOnly || currentEnrollment.challengeId !== challengeId || currentEnrollment.approved !== true) return;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      await finishApproverEnrollmentSync(challengeId, 'Enrollment approval expired before completion. The link is no longer active.');
      return;
    }
    try {
      const result = await getDeviceEnrollmentStatus(challengeId);
      if (result?.state === 'approved') {
        enrollmentWatchTimer = setTimeout(poll, 1000);
        return;
      }
      enrollmentWatchTimer = setTimeout(poll, 1000);
    } catch (error) {
      const code = String(error?.code || '');
      if (code === 'security-enrollment-invalid' || code === 'security-enrollment-expired') {
        await finishApproverEnrollmentSync(challengeId, 'Enrollment completed. Trusted-device list updated.');
        return;
      }
      enrollmentWatchTimer = setTimeout(poll, 1800);
    }
  };
  enrollmentWatchTimer = setTimeout(poll, 650);
}

async function initializeIncomingEnrollment(challengeId) {
  const panel = $('trustedDeviceEnrollment');
  currentEnrollment = { challengeId, approvalOnly: true, approved: false };
  if (panel) panel.hidden = false;
  $('trustedDeviceQr').hidden = true;
  $('trustedDeviceEnrollmentUrl').textContent = 'Checking enrollment request…';
  $('completeTrustedDeviceEnrollmentButton').hidden = true;
  $('approveTrustedDeviceButton').hidden = true;
  $('trustedDeviceStatus').textContent = 'Validating one-time enrollment link…';
  document.querySelector('[data-lan-tab="security"]')?.click();
  try {
    const result = await getDeviceEnrollmentStatus(challengeId);
    if (result?.state === 'approved') {
      currentEnrollment = { ...currentEnrollment, approved: true, expiresAt: result.expiresAt };
      $('trustedDeviceEnrollmentUrl').textContent = 'Enrollment approved. The requesting device will finish automatically.';
      $('trustedDeviceStatus').textContent = 'Enrollment approved. Waiting for the requesting device to finish…';
      startApproverEnrollmentCompletionWatch(challengeId, result.expiresAt);
      render();
      return;
    }
    currentEnrollment = { ...currentEnrollment, expiresAt: result?.expiresAt || '' };
    $('trustedDeviceEnrollmentUrl').textContent = 'A new device is requesting approval.';
    $('trustedDeviceStatus').textContent = 'A new device is requesting approval from this trusted device.';
    render();
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'security-enrollment-invalid' || code === 'security-enrollment-expired') {
      if (panel) panel.hidden = true;
      currentEnrollment = null;
      clearEnrollmentApprovalRoute();
      $('trustedDeviceStatus').textContent = 'This enrollment link is no longer active. It may have been completed, used, or expired.';
      await refresh();
      return;
    }
    if (panel) panel.hidden = true;
    currentEnrollment = null;
    $('trustedDeviceStatus').textContent = error.message || 'Enrollment request could not be validated.';
  }
}

function cancelledError() {
  return Object.assign(new Error('Verification cancelled.'), { code: 'security/cancelled' });
}

function requireTrustedSecurityManagementUi() {
  if (overview?.capabilities?.securityManagement === true) return;
  throw Object.assign(new Error('Use an authenticated trusted device to manage trusted devices or other Admin sessions.'), { code: 'security-trusted-session-required' });
}

function clearStepUpValidation() {
  const status = $('securityStepUpDialogStatus');
  for (const input of [$('securityStepUpPassword'), $('securityStepUpCode')]) {
    input?.removeAttribute('aria-invalid');
    input?.closest('.settings-field')?.classList.remove('lan-field-invalid');
  }
  status?.classList.remove('lan-field-error');
  status?.removeAttribute('role');
}

function showStepUpValidationError(input, message) {
  clearStepUpValidation();
  const status = $('securityStepUpDialogStatus');
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.closest('.settings-field')?.classList.add('lan-field-invalid');
  }
  if (status) {
    status.textContent = message;
    status.classList.add('lan-field-error');
    status.setAttribute('role', 'alert');
  }
}

function closeStepUpDialog({ reject = false } = {}) {
  const dialog = $('securityStepUpDialog');
  clearStepUpValidation();
  dialog?.classList.add('hidden');
  dialog?.setAttribute('aria-hidden', 'true');
  if (reject && activeStepUpRequest) activeStepUpRequest.reject(cancelledError());
  activeStepUpRequest = null;
}

function openStepUpDialog(reason, { password = '' } = {}) {
  if (activeStepUpRequest) closeStepUpDialog({ reject: true });
  const dialog = $('securityStepUpDialog');
  const form = $('securityStepUpForm');
  const passwordInput = $('securityStepUpPassword');
  const codeInput = $('securityStepUpCode');
  const status = $('securityStepUpDialogStatus');
  if (!dialog || !form || !passwordInput || !codeInput || !status) {
    return Promise.reject(Object.assign(new Error('Security verification UI is unavailable.'), { code: 'security/ui-unavailable' }));
  }

  form.reset();
  clearStepUpValidation();
  $('securityStepUpReason').textContent = `To ${reason}, confirm your current password and the current 6-digit code from your authenticator app.`;
  passwordInput.value = String(password || '');
  status.textContent = '';
  dialog.classList.remove('hidden');
  dialog.setAttribute('aria-hidden', 'false');
  queueMicrotask(() => (passwordInput.value ? codeInput : passwordInput).focus());

  return new Promise((resolve, reject) => {
    activeStepUpRequest = { resolve, reject };
  });
}

async function stepUp(reason, options = {}) {
  const proof = await openStepUpDialog(reason, options);
  $('securityStepUpState').textContent = `Verified until ${new Date(proof.expiresAt).toLocaleTimeString()}`;
  $('securityStepUpState').className = 'health-pill success';
  return proof;
}

$('securityStepUpForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeStepUpRequest) return;

  const password = String($('securityStepUpPassword')?.value || '');
  const code = String($('securityStepUpCode')?.value || '').trim();
  const status = $('securityStepUpDialogStatus');
  const confirmButton = $('securityStepUpConfirmButton');

  if (!password) {
    showStepUpValidationError($('securityStepUpPassword'), 'Enter your current Admin password.');
    $('securityStepUpPassword')?.focus();
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    showStepUpValidationError($('securityStepUpCode'), 'Enter the current 6-digit authenticator code.');
    $('securityStepUpCode')?.focus();
    return;
  }

  clearStepUpValidation();
  confirmButton.disabled = true;
  status.textContent = 'Verifying password and authenticator code…';
  try {
    const challenge = await beginStepUpVerification(password);
    const proof = await completeStepUpVerification(challenge.challengeId, code);
    const request = activeStepUpRequest;
    closeStepUpDialog();
    request?.resolve(proof);
  } catch (error) {
    const codeValue = String(error?.code || '');
    const isPasswordError = codeValue === 'security-password-invalid';
    const target = isPasswordError ? $('securityStepUpPassword') : $('securityStepUpCode');
    const message = codeValue === 'security-step-up-invalid'
      ? 'Authenticator code is invalid or expired.'
      : (error?.message || 'Security verification failed.');
    showStepUpValidationError(target, message);
    if (!isPasswordError) $('securityStepUpCode').value = '';
    target?.focus();
  } finally {
    confirmButton.disabled = false;
  }
});

for (const id of ['securityStepUpPassword', 'securityStepUpCode']) {
  $(id)?.addEventListener('input', () => {
    const input = $(id);
    input?.removeAttribute('aria-invalid');
    input?.closest('.settings-field')?.classList.remove('lan-field-invalid');
    const status = $('securityStepUpDialogStatus');
    if (status?.classList.contains('lan-field-error')) {
      status.textContent = '';
      status.classList.remove('lan-field-error');
      status.removeAttribute('role');
    }
  });
}

$('securityStepUpCancelButton')?.addEventListener('click', () => closeStepUpDialog({ reject: true }));
$('securityStepUpDialog')?.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  closeStepUpDialog({ reject: true });
});

$('securityChangePasswordForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const current = $('securityCurrentPassword').value;
  const next = $('securityNewPassword').value;
  const confirm = $('securityConfirmPassword').value;
  const status = $('securityPasswordStatus');
  if (next.length < 8 || next !== confirm) {
    status.textContent = 'New passwords must match and be at least 8 characters.';
    return;
  }
  try {
    status.textContent = 'Waiting for security verification…';
    await stepUp('change your password', { password: current });
    await changeAdministratorPassword(next);
    event.currentTarget.reset();
    status.textContent = 'Password changed. This event was recorded server-side.';
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
});

$('resetAuthenticatorButton')?.addEventListener('click', async () => {
  if (!confirm('Reset the authenticator? This will revoke every active session and trusted device, including this one.')) return;
  try {
    await stepUp('reset the authenticator');
    await resetAuthenticatorEnrollment();
    window.top.location.href = '../index.html';
  } catch (error) {
    if (error?.code !== 'security/cancelled') window.alert(error.message);
  }
});

$('registerTrustedDeviceButton')?.addEventListener('click', async () => {
  const status = $('trustedDeviceStatus');
  try {
    const currentTrustedDevice = (overview?.devices || []).find(device => device.active !== false && device.current);
    if (currentTrustedDevice) {
      status.textContent = 'This device is already trusted.';
      render();
      return;
    }
    status.textContent = 'Waiting for password + authenticator verification…';
    await stepUp('trust this device');
    currentEnrollment = await createDeviceEnrollmentChallenge();
    const hasExistingTrustedDevice = (overview?.devices || []).some(device => device.active !== false);

    if (!hasExistingTrustedDevice) {
      await finishCurrentDeviceEnrollment();
      return;
    }

    $('trustedDeviceEnrollment').hidden = false;
    $('trustedDeviceEnrollmentUrl').textContent = currentEnrollment.enrollmentUrl;
    $('trustedDeviceQr').hidden = false;
    renderQr($('trustedDeviceQr'), currentEnrollment.enrollmentUrl);
    $('approveTrustedDeviceButton').hidden = true;
    $('completeTrustedDeviceEnrollmentButton').hidden = true;
    status.textContent = 'Waiting for approval from an existing trusted device. This QR expires and is one-time use.';
    startEnrollmentApprovalWatch(currentEnrollment.challengeId, currentEnrollment.expiresAt);
  } catch (error) {
    status.textContent = error?.code === 'security/cancelled' ? 'Device enrollment cancelled.' : error.message;
  }
});

$('completeTrustedDeviceEnrollmentButton')?.addEventListener('click', async () => {
  if (!currentEnrollment || currentEnrollment.approvalOnly) return;
  try {
    await finishCurrentDeviceEnrollment();
  } catch {}
});

$('approveTrustedDeviceButton')?.addEventListener('click', async () => {
  if (!currentEnrollment) return;
  const status = $('trustedDeviceStatus');
  const approveButton = $('approveTrustedDeviceButton');
  try {
    requireTrustedSecurityManagementUi();
    status.textContent = 'Waiting for password + authenticator verification…';
    await stepUp('approve trusted-device enrollment');
    status.textContent = 'Approving enrollment…';
    await approveDeviceEnrollment(currentEnrollment.challengeId);
    currentEnrollment = { ...currentEnrollment, approved: true };
    if (approveButton) approveButton.hidden = true;
    $('trustedDeviceEnrollmentUrl').textContent = 'Enrollment approved. The requesting device will finish automatically.';
    status.textContent = 'Enrollment approved. The requesting device will finish automatically.';
    startApproverEnrollmentCompletionWatch(currentEnrollment.challengeId, currentEnrollment.expiresAt);
  } catch (error) {
    status.textContent = error?.code === 'security/cancelled' ? 'Approval cancelled.' : error.message;
  }
});

$('closeTrustedDeviceEnrollmentButton')?.addEventListener('click', () => {
  const wasApprovalOnly = currentEnrollment?.approvalOnly === true;
  stopEnrollmentApprovalWatch();
  $('trustedDeviceEnrollment').hidden = true;
  currentEnrollment = null;
  if (wasApprovalOnly) clearEnrollmentApprovalRoute();
  $('trustedDeviceStatus').textContent = 'Device enrollment closed.';
});

$('trustedDevicesList')?.addEventListener('click', async event => {
  const rename = event.target.closest('[data-device-rename]');
  const revoke = event.target.closest('[data-device-revoke]');
  try {
    if (rename) {
      requireTrustedSecurityManagementUi();
      const name = window.prompt('Trusted device name:');
      if (name) await renameTrustedDevice(rename.dataset.deviceRename, name);
    }
    if (revoke) {
      requireTrustedSecurityManagementUi();
      if (!confirm('Revoke this trusted device and all of its active sessions?')) return;
      await stepUp('revoke a trusted device');
      const result = await revokeTrustedDevice(revoke.dataset.deviceRevoke);
      if (result?.currentDeviceRevoked) {
        window.top.location.replace(new URL('../index.html', window.location.href).href);
        return;
      }
    }
    await refresh();
  } catch (error) {
    if (error?.code !== 'security/cancelled') window.alert(error.message);
  }
});

$('activeSessionsList')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-session-revoke]');
  if (!button) return;
  try {
    requireTrustedSecurityManagementUi();
    await revokeSession(button.dataset.sessionRevoke);
    await refresh();
  } catch (error) {
    window.alert(error.message);
  }
});

$('revokeOtherSessionsButton')?.addEventListener('click', async () => {
  try {
    requireTrustedSecurityManagementUi();
    await stepUp('sign out all other sessions');
    await revokeAllOtherSessions();
    await refresh();
  } catch (error) {
    if (error?.code !== 'security/cancelled') window.alert(error.message);
  }
});

$('revokeTemporarySessionsButton')?.addEventListener('click', async () => {
  try {
    requireTrustedSecurityManagementUi();
    await stepUp('sign out temporary sessions');
    await revokeAllTemporarySessions();
    await refresh();
  } catch (error) {
    if (error?.code !== 'security/cancelled') window.alert(error.message);
  }
});

$('generateRecoveryKitButton')?.addEventListener('click', async () => {
  if(recoveryRotationActivationPending)return;
  const launch=$('generateRecoveryKitButton');
  if(launch)launch.disabled=true;
  try {
    await stepUp('generate or rotate the Recovery Kit');
    const kit = await generateRecoveryKit();
    if(kit?.state!=='kit-prepared' || !kit.rotationId || !kit.preparedKitId ||
       !kit.masterKey || !Array.isArray(kit.backupCodes) || kit.backupCodes.length!==8) {
      throw Error('Security Gateway did not prepare a complete Recovery Kit.');
    }
    const output = $('recoveryKitOutput');
    recoveryRotationActivationPending=true;
    output.hidden=false;
    output.innerHTML = `<strong>Save this NEW Recovery Kit offline before activation.</strong><div class="settings-recovery-key-card"><div class="settings-recovery-key-head"><span>Master Recovery Key</span><button class="editor-secondary-button button-compact" id="copyRecoveryMasterKeyButton" type="button">Copy key</button></div><pre class="settings-recovery-key-value" data-recovery-master-key>${esc(kit.masterKey)}</pre><small id="recoveryCopyStatus" aria-live="polite">The current Recovery Key is still active until you confirm this saved kit.</small></div><p>New one-time backup codes</p><pre>${esc(kit.backupCodes.join('\n'))}</pre><label><input type="checkbox" id="recoveryRotationSavedConfirmation"> I saved the new key and all backup codes offline.</label><button type="button" id="activateRecoveryKitButton" class="editor-secondary-button" disabled>Activate saved Recovery Kit</button><p id="recoveryActivationStatus" role="status" aria-live="polite">Your saved kit is not active yet. Keep this window open until confirmation.</p>`;
    const saved=output.querySelector('#recoveryRotationSavedConfirmation');
    const activationButton=output.querySelector('#activateRecoveryKitButton');
    const status=output.querySelector('#recoveryActivationStatus');
    saved.addEventListener('change',()=>{
      activationButton.disabled=!saved.checked;
    });
    activationButton.addEventListener('click',async()=>{
      if(!saved.checked)return;
      activationButton.disabled=true;
      if(status)status.textContent='Activating the new Recovery Kit…';
      try{
        const result=await activatePreparedRecoveryKit(kit.rotationId,kit.preparedKitId);
        if(result?.state!=='recovery-kit-active')
          throw Error('Security Gateway has not confirmed Recovery Kit activation.');
        // A saved offline copy is required. Clear plaintext after server
        // confirmation; no frontend storage or duplicate key owner.
        recoveryRotationActivationPending=false;
        output.replaceChildren();
        const message=document.createElement('p');
        message.textContent='Recovery Kit activated. Its secret material is no longer displayed. Keep your saved offline copy.';
        output.append(message);
        if(launch)launch.disabled=false;
        await refresh();
      }catch(error){
        if(status)status.textContent='Activation was not confirmed. Keep your saved kit and retry activation; do not generate another key.';
        activationButton.disabled=!saved.checked;
        window.alert(error?.message||'Recovery Kit activation could not be confirmed.');
      }
    });
  }catch(error){
    if(!recoveryRotationActivationPending && launch)launch.disabled=false;
    if(error?.code!=='security/cancelled')window.alert(error?.message||'Recovery Kit preparation failed.');
  }
});
window.addEventListener('beforeunload',event=>{
  if(!recoveryRotationActivationPending)return;
  event.preventDefault();
  event.returnValue='';
});

$('recoveryKitOutput')?.addEventListener('click', async event => {
  const button = event.target.closest('#copyRecoveryMasterKeyButton');
  if (!button) return;
  const key = $('recoveryKitOutput')?.querySelector('[data-recovery-master-key]')?.textContent || '';
  const status = $('recoveryCopyStatus');
  try {
    await navigator.clipboard.writeText(key);
    button.textContent = 'Copied';
    if (status) status.textContent = 'Master Recovery Key copied. Store it offline now.';
  } catch {
    if (status) status.textContent = 'Copy was blocked by the browser. Select the key box and copy it manually.';
  }
});

$('refreshSecurityActivityButton')?.addEventListener('click', async () => {
  try {
    const activity = await listSecurityActivity();
    overview = { ...overview, events: activity.events || [] };
    render();
  } catch (error) {
    window.alert(error.message);
  }
});

async function loadBranding() {
  try {
    const result = await getSecurityEmailBranding();
    const branding = result.branding || {};
    $('securityEmailSenderName').value = branding.senderName || '';
    $('securityEmailLogoUrl').value = branding.logoUrl || '';
    $('securityEmailHeading').value = branding.heading || '';
    $('securityEmailFooter').value = branding.footer || '';
    $('securityEmailProviderState').textContent = result.provider === 'configured' ? 'Configured' : 'Not configured';
  } catch (error) {
    $('securityEmailBrandingStatus').textContent = error.message;
  }
}

$('securityEmailBrandingForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const status = $('securityEmailBrandingStatus');
  try {
    await saveSecurityEmailBranding({
      senderName: $('securityEmailSenderName').value,
      logoUrl: $('securityEmailLogoUrl').value,
      heading: $('securityEmailHeading').value,
      footer: $('securityEmailFooter').value
    });
    status.textContent = 'Branding preferences saved. Security event content and secure links remain server-controlled.';
  } catch (error) {
    status.textContent = error.message;
  }
});

const incomingEnrollmentId = new URLSearchParams(window.location.search).get('approveDeviceEnrollment');
void (async () => {
  await refresh();
  if (incomingEnrollmentId) await initializeIncomingEnrollment(incomingEnrollmentId);
  startSecurityAccessStateWatch();
})();
loadBranding();
