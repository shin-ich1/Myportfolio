import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessRecoveryIsolation, runOfflinePreflight, OWNER_GATES } from '../scripts/dr-isolation-preflight.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const needed = [
  'admin/services/adminSecurityService.js','admin/services/adminAuthorizationService.js',
  'firestore.rules','storage.rules','telemetry-worker/src/index.js',
  'telemetry-worker/src/security-coordinator.js','scripts/prepare-staging.mjs',
  'scripts/secure-firestore-backup.mjs','scripts/secure-cloudflare-kv-backup.mjs',
  'scripts/security-dr-restore-policy.mjs'
];
async function baseline() {
  const [firebase, worker, stage, ...body] = await Promise.all([
    read('.firebaserc'),read('telemetry-worker/wrangler.jsonc'),
    read('scripts/staging-targets.json'),...needed.map(read)
  ]);
  return {
    productionFirebase: JSON.parse(firebase).projects.default,
    productionWorker: JSON.parse(worker),
    staging: JSON.parse(stage),
    sourceFiles: Object.fromEntries(needed.map((key, index) => [key, body[index]]))
  };
}
function duplicate(source) { return structuredClone(source); }

test('source-only DR readiness is honest and reports pending owner gates',async()=>{
  const offline=await runOfflinePreflight();
  assert.equal(offline.status,'SOURCE_ISOLATION_PREFLIGHT_PASS__FULL_STACK_DR_HOLD');
  assert.equal(offline.productionModified,false);
  assert.equal(offline.cloudRequestsMade,0);
  assert.equal(offline.credentialsRead,0);
  assert.deepEqual(offline.pendingOwnerGates,OWNER_GATES);
  assert.ok(offline.sourceBoundariesVerified>=10);
  assert.ok(offline.pendingOwnerGates.includes('NEW_TEST_ADMIN_IDENTITY_PASSWORD_AND_HUMAN_TOTP_PROOF'));
  assert.deepEqual(assessRecoveryIsolation(await baseline()),offline);
});

test('rejects any reuse of production Firebase project, Worker, KV or security coordinator',async()=>{
  const b=await baseline();
  for(const mutate of [
    x=>{x.staging.firebase.projectId=x.productionFirebase;},
    x=>{x.staging.worker.name=x.productionWorker.name;},
    x=>{x.staging.worker.telemetryUrl='https://lan-cloudinary-telemetry.lagmayr2.workers.dev/telemetry';},
    x=>{x.staging.worker.kvNamespaces.STORAGE_OAUTH=x.productionWorker.kv_namespaces.find(z=>z.binding==='STORAGE_OAUTH').id;},
    x=>{x.staging.worker.kvNamespaces.PORTFOLIO_MESSAGES=x.productionWorker.kv_namespaces.find(z=>z.binding==='STORAGE_OAUTH').id;},
    x=>{x.productionWorker.durable_objects.bindings=[];},
    x=>{x.productionWorker.exports.SecurityCoordinator.storage='memory';},
    x=>{delete x.sourceFiles['scripts/security-dr-restore-policy.mjs'];},
    x=>{x.sourceFiles['scripts/security-dr-restore-policy.mjs']='// removed quarantining';},
    x=>{x.sourceFiles['telemetry-worker/src/index.js']='// missing server-side secrets';}
  ]) {
    const test=duplicate(b);mutate(test);
    assert.throws(()=>assessRecoveryIsolation(test),/DR isolation preflight HOLD/);
  }
});

test('preflight has no secret value access, network calls or filesystem writes',async()=>{
  const fsSource=await read('scripts/dr-isolation-preflight.mjs');
  assert.doesNotMatch(fsSource,/\bfetch\s*\(|\bhttps?\s*\.|writeFile|execFile|spawn\s*\(|process\.env|secretManager/);
  assert.match(fsSource,/FULL_STACK_DR_HOLD/);
  assert.match(fsSource,/cloudRequestsMade:\s*0/);
  assert.match(fsSource,/credentialsRead:\s*0/);
  const source = await baseline();
  const result=assessRecoveryIsolation(source);
  assert.equal(result.productionModified,false);
});
