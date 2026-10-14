import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
function ruleBody(expression) {
  const match = rules.match(expression);
  assert.ok(match, 'Expected canonical Firestore Rules section to exist');
  return match[1];
}

test('only server credentials may create, update or delete administrator allowlist records', () => {
  const block = ruleBody(/match\s+\/authorizedAdministrators\/\{uid\}\s*\{([\s\S]*?)\n\s*\}/);
  assert.match(block, /allow\s+create,\s*update,\s*delete:\s*if\s+false\s*;/,
    'An old admin custom claim must never permit direct allowlist writes');
});

test('Admin access requires an ACTIVE administrator record and active security-approved session', () => {
  const block = ruleBody(/function\s+isAdministrator\(\)\s*\{([\s\S]*?)\}/);
  assert.match(block, /return\s+hasSecurityApprovedSession\(\)\s*&&\s*hasAdministratorRecord\(\)\s*;/,
    'Legacy admin:true claims must not override administrator deactivation');
  assert.doesNotMatch(rules, /function\s+hasAdminClaim\(\)/,
    'Remove obsolete legacy authorization owner when migration is complete');
});

test('security session and device records remain backend-only', () => {
  for (const collection of ['adminSecuritySessions', 'adminSecurityDevices', 'adminSecurityRecovery']) {
    assert.match(rules,
      new RegExp('match\\s+/' + collection + '/\\{id\\}\\s*\\{\\s*allow\\s+read,\\s*write:\\s*if\\s+false;\\s*\\}'),
      collection + ' must be backend-only');
  }
});


const authorizationSource = readFileSync(
  new URL('../admin/services/adminAuthorizationService.js', import.meta.url), 'utf8'
);

// Execute the canonical production verifier (rather than duplicating its policy).
// Mock only Firebase's identity, allowlist document and capability probe.
function productionVerifier({ active, exists = true, capabilityCalls }) {
  const begin = authorizationSource.indexOf('export async function verifyAdministrator(');
  const end = authorizationSource.indexOf('\nexport function getCurrentAuthorizedAdministrator()', begin);
  assert.ok(begin >= 0 && end > begin, 'Canonical Admin verifier must be extractable');
  const realImplementation = authorizationSource.slice(begin, end).replace(/^export /, '');
  return new Function(
    'readAllowlistRecord', 'readAdminFirestoreCapability', 'AdministratorAuthorizationError',
    realImplementation + '\nreturn verifyAdministrator;'
  )(
    async () => ({ exists: () => exists, data: () => ({ active }) }),
    async () => {
      capabilityCalls.count++;
      return { moduleRegistryCollectionsReadable: true, settingsDocumentPresent: true };
    },
    Error
  );
}

test('Runtime Firebase authorization does not accept legacy admin claims without an active allowlist record', async () => {
  for (const scenario of [
    { active: false, exists: true, label: 'inactive administrator' },
    { active: undefined, exists: false, label: 'missing administrator record' }
  ]) {
    const capabilityCalls = { count: 0 };
    const verifyAdministrator = productionVerifier({ ...scenario, capabilityCalls });
    const user = {
      uid: 'local-emulator-admin',
      getIdTokenResult: async () => ({
        claims: { lanSecurityVerified: true, lanSessionId: 'valid-session', admin: true }
      })
    };
    const result = await verifyAdministrator(user);
    assert.equal(result.authorized, false, scenario.label);
    assert.equal(result.firestoreProof, null, scenario.label);
    assert.equal(capabilityCalls.count, 0, 'Never probe private CMS data for inactive/missing admin');
  }
});

test('Runtime Firebase authorization requires BOTH a verified security session and active allowlist', async () => {
  for (const claims of [
    { lanSecurityVerified: false, lanSessionId: 'valid-session', admin: true },
    { lanSecurityVerified: true, lanSessionId: '', admin: true },
    { lanSecurityVerified: true, admin: true }
  ]) {
    const capabilityCalls = { count: 0 };
    const verifyAdministrator = productionVerifier({ active: true, capabilityCalls });
    const result = await verifyAdministrator({ uid: 'local-emulator-admin', getIdTokenResult: async () => ({ claims }) });
    assert.equal(result.authorized, false);
    assert.equal(capabilityCalls.count, 0);
  }

  const capabilityCalls = { count: 0 };
  const verifyAdministrator = productionVerifier({ active: true, capabilityCalls });
  const result = await verifyAdministrator({
    uid: 'local-emulator-admin',
    getIdTokenResult: async () => ({ claims: { lanSecurityVerified: true, lanSessionId: 'valid-session' } })
  });
  assert.equal(result.authorized, true, 'Active allowlist succeeds without a legacy admin claim');
  assert.equal(result.firestoreProof.administratorRecordActive, true);
  assert.equal(capabilityCalls.count, 1);
});
