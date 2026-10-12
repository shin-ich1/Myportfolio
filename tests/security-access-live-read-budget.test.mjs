import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const securityUi = readFileSync(new URL('../admin/js/settings-security.js', import.meta.url), 'utf8');
const securityService = readFileSync(new URL('../admin/services/adminSecurityService.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../admin/js/admin-shell.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../telemetry-worker/src/index.js', import.meta.url), 'utf8');

test('Security & Access must never repeatedly re-query the entire device/session list in a timer', () => {
  // Each access-state HTTP refresh runs two broad, up-to-100/200-document
  // Firestore queries. Three-second polling exhausted the production free tier.
  assert.doesNotMatch(securityUi, /SECURITY_ACCESS_STATE_SYNC_INTERVAL_MS/);
  assert.doesNotMatch(securityUi, /securityAccessStateWatchTimer/);
  assert.doesNotMatch(securityUi, /startSecurityAccessStateWatch|stopSecurityAccessStateWatch/);
  assert.doesNotMatch(securityUi, /set(?:Interval|Timeout)\s*\(\s*(?:run|refreshSecurityAccessState)/);
});

test('Security overview and access-state reads are activation-driven, not read on every Settings room', () => {
  assert.match(securityUi, /async function refreshSecurityAccessState\(\)/);
  assert.match(securityUi, /await getSecurityAccessState\(\)/);
  assert.match(securityUi, /securityPanelIsLiveVisible\(\)/);
  assert.match(securityUi, /addEventListener\('focus'/);
  assert.match(securityUi, /addEventListener\('visibilitychange'/);
  assert.match(securityUi, /addEventListener\('lan:tabchange'/);
  assert.match(securityUi, /event\.detail\?\.key\s*!==\s*'security'/);
  assert.doesNotMatch(securityUi, /getSecurityAccessState\s*\(\s*\)\s*;[\s\S]{0,100}setTimeout/);
});

test('read-budget reduction never removes backend session validation, authorization, or revocation', () => {
  assert.match(securityService, /workerRequest\('\/security\/session\/validate'/);
  assert.match(shell, /ensureLiveSecuritySession\(\)/);
  assert.match(shell, /validateCurrentSecuritySession\(\)/);
  assert.match(worker, /async function requireActiveSecuritySession\(/);
  assert.match(worker, /s\.active!==true\|\|Date\.parse\(s\.expiresAt\)<=Date\.now\(\)/);
  assert.match(worker, /async function requireSecurityApprovedAdministrator\(/);
  assert.match(worker, /await requireActiveSecuritySession\(uid,sessionId,env\)/);
  assert.match(worker, /async function securityQueryAll\(/);
  assert.match(worker, /\/security\/session\/revoke-others/);
});
