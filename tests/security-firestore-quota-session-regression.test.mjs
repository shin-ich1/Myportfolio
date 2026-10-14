import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the actual Security Worker authorization owner with simulated
// Firestore HTTP responses. No Production requests, secrets, or bypass.
const source = readFileSync(new URL('../telemetry-worker/src/index.js', import.meta.url), 'utf8');
const start = source.indexOf('async function requireSecurityApprovedAdministrator(');
const end = source.indexOf('\nasync function verifyStepUp(', start);
assert.ok(start > 0 && end > start, 'Canonical Worker authorization verifier must exist');
const implementation = source.slice(start, end);

async function checkFirestoreProof(status, providerStatus = '') {
  let backendSessionChecked = false;
  const serviceError = (message, { status, code }) =>
    Object.assign(new Error(message), { status, code });
  const verifier = new Function('fetch', 'serviceError', 'decodeJwtPayload',
    'firestoreProjectId', 'requireActiveSecuritySession', 'securityGetDoc',
    implementation + '\nreturn requireSecurityApprovedAdministrator;')(
    async () => ({
      ok: status === 200,
      status,
      json: async () => status === 200
        ? { fields: { active: { booleanValue: true } } }
        : { error: { status: providerStatus } }
    }),
    serviceError,
    () => ({ sub: 'emulator-owner', lanSecurityVerified: true, lanSessionId: 'active' }),
    () => 'emulator-project',
    async () => {
      backendSessionChecked = true;
      return { sessionId: 'active', uid: 'emulator-owner', active: true,
        trustLevel: 'temporary', expiresAt: new Date(Date.now() + 60000).toISOString() };
    },
    async () => null
  );
  const request = { headers: new Headers({Authorization: 'Bearer synthetic.jwt.token'}) };
  try {
    const result = await verifier(request, {});
    return { result, backendSessionChecked };
  } catch (error) {
    return { status: error.status, code: error.code, backendSessionChecked };
  }
}

test('quota failures deny access without falsely revoking the signed-in session', async () => {
  for (const [status, provider] of [
    [429, 'RESOURCE_EXHAUSTED'],
    [403, 'RESOURCE_EXHAUSTED'],
    [503, 'UNAVAILABLE']
  ]) {
    const outcome = await checkFirestoreProof(status, provider);
    assert.equal(outcome.status, 503, 'Quota/provider outage should report temporary unavailable');
    assert.equal(outcome.code, 'security-authorization-unavailable');
    assert.equal(outcome.backendSessionChecked, false, 'Never grant access without Firestore proof');
  }
});

test('genuine unauthenticated, permission-denied and verified session responses retain fail-closed semantics', async () => {
  const unauthenticated = await checkFirestoreProof(401, 'UNAUTHENTICATED');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.backendSessionChecked, false);

  const denied = await checkFirestoreProof(403, 'PERMISSION_DENIED');
  assert.equal(denied.status, 403);
  assert.equal(denied.backendSessionChecked, false);
  assert.equal(denied.code, 'security-session-expired');

  const approved = await checkFirestoreProof(200);
  assert.equal(approved.result.session.sessionId, 'active');
  assert.equal(approved.backendSessionChecked, true);
});
