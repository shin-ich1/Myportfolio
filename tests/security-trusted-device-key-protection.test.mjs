import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/services/adminSecurityService.js', import.meta.url), 'utf8');

test('starting an enrollment never overwrites the active trusted-device credential', () => {
  const start = source.indexOf('export async function createDeviceEnrollmentChallenge()');
  const end = source.indexOf('export async function getDeviceEnrollmentStatus', start);
  assert.ok(start > 0 && end > start, 'canonical enrollment owner must exist');
  const enrollment = source.slice(start, end);
  assert.doesNotMatch(enrollment, /createDeviceKeyPair\(\{renew:true\}\)/, 'overwriting the active key before server approval is destructive');
  assert.match(enrollment, /pending/i, 'new enrollment must use a separate pending credential');
});

test('the pending enrollment is bound to server challenge and promoted only after server completion', () => {
  assert.match(source, /DEVICE_PENDING_RECORD/);
  assert.match(source, /pending\.challengeId\s*!==\s*text\(challengeId\)/);
  const start = source.indexOf('export async function completeDeviceEnrollment(');
  const end = source.indexOf('export async function renameTrustedDevice', start);
  const complete = source.slice(start, end);
  assert.match(complete, /workerRequest\('\/security\/device\/enrollment\/complete'/);
  assert.match(complete, /putDeviceRecord\(DEVICE_RECORD, credential\)/);
  assert.ok(complete.indexOf("workerRequest('/security/device/enrollment/complete'") < complete.indexOf('putDeviceRecord(DEVICE_RECORD, credential)'), 'must not promote before server acceptance');
});

test('normal logout keeps active local credential, unlike explicit revoke/reset', () => {
  const start = source.indexOf('export async function logoutAdministrator()');
  const end = source.indexOf('export async function requestTrustedDeviceLogin', start);
  assert.doesNotMatch(source.slice(start, end), /clearLocalTrustedDevice|removeDeviceRecord|deleteDatabase/);
  assert.match(source, /export async function clearLocalTrustedDevice/);
  assert.match(source, /export async function resetAuthenticatorEnrollment/);
});
