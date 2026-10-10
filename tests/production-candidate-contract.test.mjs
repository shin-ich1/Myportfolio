import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Candidate-only source contract. This suite must never contact production
// Firebase, Cloudflare, email, or GitHub; it verifies source, not live readiness.
const load = path => readFileSync(new URL('../'+path,import.meta.url));
const source = path => load(path).toString('utf8');
function gitBlobSha(path){
  const bytes=load(path);
  return createHash('sha1')
    .update(Buffer.from('blob '+bytes.length+'\0'))
    .update(bytes).digest('hex');
}

test('Public Portfolio layout and rendering sources remain byte-for-byte identical to audited main',()=>{
  const frozen={
    'index.html':'ba6b29cd5d2a84286850022f9f7ef075df5a73a5',
    'app.js':'f156424e6adf216da6660648dc634319e340aa4a',
    'styles.css':'ec2f4078616f7435a5c9cc1a646fa44eb9db5f4c', // deliberately filled below with canonical audited main blob
    'public-adaptive.js':'62ec14a5cde2655ce199f5e00085db884b9bcead',
    'public-layout-contract.js':'4c21875d832b06cafad0bebc0ee09b467cbd4ca8',
    'public-section-eligibility.js':'4304cc5a2c2c4d2b6b93a0fd8e49d15044dbe748'
  };
  for(const [path,sha] of Object.entries(frozen)){
    assert.ok(sha,'Missing audited production blob hash for '+path);
    assert.equal(gitBlobSha(path),sha,'Public UI must not drift: '+path);
  }
});

test('production Hosting excludes Git data, staging infrastructure, secrets, test fixtures and backend',()=>{
  assert.equal(gitBlobSha('firebase.json'),'784f171c9f36892b8c4791d073ed4816cca74eae',
    'Keep canonical hardened Hosting config from main');
  const config=JSON.parse(source('firebase.json'));
  assert.equal(config.hosting.public,'.');
  assert.equal(config.firestore.rules,'firestore.rules');
  for(const pattern of ['.git/**','**/.git/**','.github/**','**/.github/**',
    'tests/**','**/tests/**','telemetry-worker/**','scripts/**','**/*.zip',
    '**/*.pem','**/*.key','**/*credentials*.json','**/service-account*.json']){
    assert.ok(config.hosting.ignore.includes(pattern),'Required Hosting exclusion: '+pattern);
  }
});

test('production configuration retains production Firebase, Cloudinary and canonical Worker identity',()=>{
  const conf=source('config.js'),worker=JSON.parse(source('telemetry-worker/wrangler.jsonc'));
  assert.match(conf,/projectId:\s*['"]rolando-portfolio-3f1a3['"]/);
  assert.equal(worker.name,'lan-cloudinary-telemetry');
  assert.equal(worker.vars.FIREBASE_PROJECT_ID,'rolando-portfolio-3f1a3');
  assert.equal(worker.vars.CLOUDINARY_CLOUD_NAME,'fmbcpufk');
  assert.doesNotMatch(conf,/lan-portfolio-staging/);
  assert.doesNotMatch(source('telemetry-worker/wrangler.jsonc'),/lan-portfolio-staging/);
  assert.ok(worker.kv_namespaces.some(x=>x.binding==='STORAGE_OAUTH'));
  assert.ok(worker.kv_namespaces.some(x=>x.binding==='PORTFOLIO_MESSAGES'));
});

test('canonical atomic Security Coordinator replaces legacy KV security-state owner',()=>{
  const worker=JSON.parse(source('telemetry-worker/wrangler.jsonc'));
  assert.ok(worker.durable_objects.bindings.some(x=>
    x.name==='SECURITY_COORDINATOR'&&x.class_name==='SecurityCoordinator'));
  assert.ok(!worker.kv_namespaces.some(x=>x.binding==='SECURITY_STATE'),
    'Old non-atomic security KV owner must not coexist with Durable Object');
  const gateway=source('telemetry-worker/src/index.js');
  assert.match(gateway,/env\?\.SECURITY_COORDINATOR/);
  assert.doesNotMatch(gateway,/env\?\.SECURITY_STATE/);
  assert.match(gateway,/claimMasterRecoveryKey\(/);
  assert.match(gateway,/enforceSecurityRateLimit\(request,env,'step-up-totp'\)/);
  assert.match(gateway,/validateSecurityBrandingLogoUrl/);
});

test('direct Firestore administrators need active allowlist and server-verified session',()=>{
  const rules=source('firestore.rules');
  assert.match(rules,/function isAdministrator\(\)\s*\{\s*return hasSecurityApprovedSession\(\) && hasAdministratorRecord\(\);/);
  assert.match(rules,/request\.auth\.token\.lanSecurityVerified == true/);
  assert.match(rules,/adminSecuritySessions\/\$\(request\.auth\.token\.lanSessionId\)/);
  assert.match(rules,/get\([^;]*adminSecuritySessions[^;]*\)\.data\.active == true/);
  assert.match(rules,/match \/authorizedAdministrators\/\{uid\}[^}]+allow create, update, delete: if false/s);
  for(const collection of ['adminSecurityDevices','adminSecuritySessions',
    'adminSecurityRecovery','adminSecurityEvents','adminSecurityPreferences']){
    assert.match(rules,new RegExp('match /'+collection+'/\\{id\\} \\{ allow read, write: if false; \\}'));
  }
});

test('candidate retains latest production lazy Admin startup and staging single-owner avatar improvements',()=>{
  const ui=source('admin/js/admin-ui.js');
  assert.match(ui,/import\(["']\.\.\/services\/mediaAssetLifecycleService\.js["']\)/);
  assert.match(ui,/const \{ listSections \} = await import\(["']\.\.\/services\/portfolioSectionService\.js["']\)/);
  assert.doesNotMatch(ui,/warmAdminNavigation\(/,
    'Do not reintroduce automatic sidebar-wide eager prefetch');
  assert.match(ui,/LANAdminAvatarSource/);
  assert.match(ui,/lan:admin-home-portrait-saved/);
});

test('staging deployment workflow cannot execute on main or on candidate pull requests',()=>{
  const yaml=source('.github/workflows/admin-performance-regression.yml');
  assert.match(yaml,/vars\.LAN_STAGING_DEPLOY_APPROVED == 'true' && github\.event_name == 'push' && github\.ref == 'refs\/heads\/perf\/admin-workspace-investigation-20261008'/);
  assert.match(yaml,/project_id: lan-portfolio-staging/);
  assert.doesNotMatch(yaml,/project_id:\s*rolando-portfolio-3f1a3/);
});
