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
