/**
 * Source-only PRODUCTION CUTOVER PREFLIGHT.
 * Never calls Firebase/Cloudflare, never invokes Wrangler deploy,
 * never changes a production setting, does not request any credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const worker = JSON.parse(load('telemetry-worker/wrangler.jsonc'));
const gateway = load('telemetry-worker/src/index.js');
const coordinator = load('telemetry-worker/src/security-coordinator.js');
const rules = load('firestore.rules');
const mfaPlan = load('docs/production-mfa-change-plan.md');

test('Cloudflare production target is exact; no credentials or staging Worker target', () => {
  assert.equal(worker.name, 'lan-cloudinary-telemetry');
  assert.equal(worker.main, 'src/index.js');
  assert.equal(worker.vars.FIREBASE_PROJECT_ID, 'rolando-portfolio-3f1a3');
  assert.ok(!JSON.stringify(worker).includes('lan-portfolio-staging'));
  assert.ok(!JSON.stringify(worker).includes('CLOUDFLARE_API_TOKEN'));
  assert.ok(!JSON.stringify(worker).includes('FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY'));
  assert.ok(!JSON.stringify(worker).includes('SECURITY_RECOVERY_PEPPER'));
});

test('Cloudflare declarative DO exports exclusively owns atomic security state', () => {
  assert.deepEqual(worker.exports, {
    SecurityCoordinator: { type: 'durable-object', storage: 'sqlite' }
  }, 'Preserve the one canonical SQLite class and no additional DO owners');
  assert.equal(worker.migrations, undefined,
    'Use 2026 exports lifecycle, never competing legacy migrations');
  assert.deepEqual(worker.durable_objects, {
    bindings: [{ name: 'SECURITY_COORDINATOR', class_name: 'SecurityCoordinator' }]
  });
  assert.match(coordinator, /export class SecurityCoordinator/);
  assert.match(gateway, /env\?\.SECURITY_COORDINATOR/);
  assert.doesNotMatch(gateway, /env\?\.SECURITY_STATE/);
  assert.ok(!worker.kv_namespaces.some(x => x.binding === 'SECURITY_STATE'));
});

test('Existing independent KV bindings remain unchanged across the cutover', () => {
  assert.deepEqual(
    worker.kv_namespaces.map(x => ({binding:x.binding,id:x.id})).sort((a,b)=>a.binding.localeCompare(b.binding)),
    [
      {binding:'PORTFOLIO_MESSAGES',id:'ccd7d586b9534d409c036d44137dc29f'},
      {binding:'STORAGE_OAUTH',id:'0928060fc494486286a6d83f543f679e'}
    ]
  );
});

test('Gateway reports DO binding status and refuses sensitive operations without Coordinator', () => {
  assert.match(gateway, /securityCoordinatorConfigured:\s*Boolean\(/);
  assert.match(gateway, /code:\s*"security-coordinator-not-configured"/);
  assert.match(gateway, /if \(!namespace \|\| typeof namespace\.idFromName/);
  assert.match(gateway, /const stub = namespace\.get\(namespace\.idFromName\(owner\)\)/);
  assert.match(gateway, /op: "rate-hit"/);
  assert.match(gateway, /'step-up-totp':\s*\{limit:7/);
});

test('MFA activation is a separate one-field, opt-in production step', () => {
  assert.match(mfaPlan, /mfa\.state = DISABLED/);
  assert.match(mfaPlan, /TOTP.*ENABLED/);
  assert.match(mfaPlan, /updateMask=mfa\.state/);
  assert.match(mfaPlan, /separate explicit production MFA change approval/);
  assert.match(gateway, /first\.mfaPendingCredential/);
  assert.match(gateway, /state:'totp-enrollment-required'/);
  assert.match(gateway, /state:'totp-required'/);
});

test('Direct Firestore session authorization must remain independent of Worker rollout', () => {
  assert.match(rules, /function isAdministrator\(\)\s*\{\s*return hasSecurityApprovedSession\(\) && hasAdministratorRecord\(\)/);
  assert.match(rules, /request\.auth\.token\.lanSecurityVerified == true/);
  assert.match(rules, /adminSecuritySessions\/\$\(request\.auth\.token\.lanSessionId\)/);
  assert.match(rules, /match \/adminSecuritySessions\/\{id\} \{ allow read, write: if false; \}/);
});

test('Production candidate has no production-deploy automation or implicit MFA mutation', () => {
  const workflow = load('.github/workflows/admin-performance-regression.yml');
  const prodConfig = load('telemetry-worker/wrangler.jsonc');
  assert.match(workflow, /wrangler deploy --dry-run --config wrangler\.jsonc/);
  assert.doesNotMatch(workflow, /wrangler deploy --config wrangler\.jsonc(?!.*--dry-run)/);
  assert.doesNotMatch(workflow, /firebase-tools.*deploy.*rolando-portfolio-3f1a3/);
  assert.doesNotMatch(workflow, /identitytoolkit.*updateMask=mfa\.state/);
  assert.doesNotMatch(prodConfig, /"migrations":/);
});

test('emergency recovery start is destructive and must NEVER be used as a key checker', () => {
  const start = gateway.indexOf("if(path==='/security/recovery/start'&&method==='POST')");
  const end = gateway.indexOf("if(path==='/security/recovery/prepare'&&method==='POST')", start);
  assert.ok(start > 0 && end > start, 'Canonical recovery start handler not found');
  const handler = gateway.slice(start, end);
  assert.match(handler, /await enforceSecurityRateLimit\(request,env,'recovery'\)/);
  assert.match(handler, /await verifyFirebasePassword\(/);
  assert.match(handler, /const digest=await recoveryHmac\(body\.recoveryKey,env\)/);
  assert.match(handler, /await claimMasterRecoveryKey\(/,
    'Accepting a recovery key mutates the authoritative Recovery record');
  assert.match(handler, /revokeUserSecurityState\(first\.uid,env\)/);
  assert.match(handler, /clearFirebaseMfaForRecovery\(env,first\.uid\)/);
  assert.ok(handler.indexOf('await claimMasterRecoveryKey(') <
    handler.indexOf('revokeUserSecurityState(first.uid,env)'),
    'Claim must precede destructive session/MFA reset');
  assert.doesNotMatch(handler, /console\.(?:log|warn|error)\s*\([^)]*(?:recoveryKey|masterKey)/,
    'Never log a plaintext recovery key');
});

test('Recovery Key cannot be validated from metadata and pepper stays server-only', () => {
  const runbook = load('docs/production-backup-rollback-cutover.md');
  assert.match(runbook, /two stored Recovery Key candidates/i);
  assert.match(runbook, /not proof of key validity/i);
  assert.match(runbook, /do not call.*\/security\/recovery\/start/i);
  assert.match(gateway, /String\(env\.SECURITY_RECOVERY_PEPPER\|\|''\)/);
  assert.match(gateway, /name:'HMAC',hash:'SHA-256'/);
  for (const path of [
    'admin/services/adminSecurityService.js',
    'admin/js/settings-security.js',
    'admin/index.html'
  ]) {
    assert.doesNotMatch(load(path), /SECURITY_RECOVERY_PEPPER/,
      'Recovery pepper must never appear in frontend: ' + path);
  }
});
