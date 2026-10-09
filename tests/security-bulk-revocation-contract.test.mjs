import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../telemetry-worker/src/index.js', import.meta.url), 'utf8');
const lineForRoute = path => {
  const line = source.split('\n').find(value => value.includes("if(path==='" + path + "'"));
  assert.ok(line, 'Canonical Security Gateway route absent: ' + path);
  return line;
};

test('all bulk session/device revocation routes must enumerate more than UI query limits', () => {
  for (const route of [
    '/security/device/revoke',
    '/security/session/revoke-others',
    '/security/session/revoke-temporary'
  ]) {
    assert.match(lineForRoute(route), /securityQueryAll\(/,
      'Potentially truncated revocation is not allowed: ' + route);
  }
});

test('the Firestore batch revocation owner is reused by recovery and session/device revocation', () => {
  assert.match(source, /async function revokeSecurityDocuments\(/);
  assert.match(source, /async function revokeUserSecurityState\([\s\S]*?revokeSecurityDocuments\(/);
  for (const route of [
    '/security/device/revoke',
    '/security/session/revoke-others',
    '/security/session/revoke-temporary'
  ]) assert.match(lineForRoute(route), /revokeSecurityDocuments\(/, route);
});

test('a revoked or missing trusted device cannot retain authorization on its old session', () => {
  const body = source.split('async function canonicalizeActiveSecuritySessionTrust(')[1]
    ?.split('async function requireActiveSecuritySession(')[0];
  assert.ok(body, 'Canonical server session validator must exist');
  assert.doesNotMatch(body, /return\s+\{\.\.\.session,\s*trustLevel:'temporary'/,
    'A revoked trusted-device session must be rejected, never silently downgraded');
  assert.match(body, /security-session-expired/);
});
