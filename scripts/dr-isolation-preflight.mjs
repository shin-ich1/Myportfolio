/**
 * Read-only full-stack disaster recovery preflight for the archived LΛN source.
 *
 * This is NOT a certificate, cloud restorer or permission check. It inspects
 * local, nonsecret source/config only; it makes zero cloud calls or writes.
 * An actual MFA enrollment and recreated Worker/Firestore IAM stack must be
 * observed by the owner before certification.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROTECTED_FILES = Object.freeze([
  'admin/services/adminSecurityService.js',
  'admin/services/adminAuthorizationService.js',
  'firestore.rules', 'storage.rules',
  'telemetry-worker/src/index.js',
  'telemetry-worker/src/security-coordinator.js',
  'scripts/prepare-staging.mjs',
  'scripts/secure-firestore-backup.mjs',
  'scripts/secure-cloudflare-kv-backup.mjs',
  'scripts/security-dr-restore-policy.mjs'
]);
const BINDINGS = Object.freeze(['PORTFOLIO_MESSAGES', 'STORAGE_OAUTH']);
const requiredWorkerSecrets = Object.freeze([
  'FIREBASE_SERVICE_ACCOUNT_EMAIL', 'FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'SECURITY_RECOVERY_PEPPER'
]);
// Names only. Their values are never read, requested, logged, or committed.
export const OWNER_GATES = Object.freeze([
  'ISOLATED_FIREBASE_PROJECT_IAM_AND_IDENTITY_PLATFORM_TOTP',
  'NEW_TEST_ADMIN_IDENTITY_PASSWORD_AND_HUMAN_TOTP_PROOF',
  'ISOLATED_WORKER_KV_COORDINATOR_AND_OWNER_HELD_SECRETS',
  'AUTHENTICATED_ARCHIVE_CONTENT_ONLY_TARGET_RESTORE',
  'WORKER_FIRESTORE_OLD_TOKEN_DENIAL_AFTER_REBUILD',
  'STORAGE_OAUTH_REAUTHORIZATION_AND_SAFE_CLEANUP'
]);

function ensure(ok, message) {
  if (!ok) throw Error('DR isolation preflight HOLD: ' + message);
}
function isId(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value); }

export function assessRecoveryIsolation({ productionFirebase, productionWorker, staging, sourceFiles }) {
  ensure(typeof productionFirebase === 'string' && productionFirebase.length > 0,
    'missing canonical Firebase Production identity');
  ensure(productionWorker && typeof productionWorker === 'object',
    'missing canonical Worker Production config');
  ensure(staging && typeof staging === 'object', 'missing staging target manifest');

  const productName = String(productionWorker.name || '');
  const productProject = String(productionWorker.vars?.FIREBASE_PROJECT_ID || '');
  ensure(productProject === productionFirebase, 'Production Worker/Firebase project mismatch');

  const targetProject = staging.firebase?.projectId;
  const targetWorker = staging.worker?.name;
  ensure(targetProject === 'lan-portfolio-staging' &&
    targetWorker === 'lan-portfolio-staging' &&
    targetProject !== productionFirebase && targetWorker !== productName,
  'staging points at Production or has an unexpected project/Worker name');
  ensure(staging.firebase?.authDomain === targetProject + '.firebaseapp.com' &&
    staging.firebase?.storageBucket?.startsWith(targetProject + '.') &&
    String(staging.worker?.telemetryUrl || '').startsWith(
      'https://' + targetWorker + '.') &&
    String(staging.worker?.telemetryUrl || '').endsWith('.workers.dev/telemetry'),
  'staging web/Worker references are not bound to isolated staging');

  const sourceBindings = productionWorker.kv_namespaces;
  const destinationBindings = staging.worker?.kvNamespaces;
  ensure(Array.isArray(sourceBindings) && sourceBindings.length === BINDINGS.length &&
    destinationBindings && Object.keys(destinationBindings).length === BINDINGS.length,
  'KV binding inventory incomplete');
  const sourceIds = new Set();
  const destinationIds = new Set();
  for (const binding of BINDINGS) {
    const prod = sourceBindings.find(x => x.binding === binding);
    const dest = destinationBindings[binding];
    ensure(prod && isId(prod.id) && isId(dest), 'missing required KV binding identity');
    ensure(!sourceIds.has(prod.id) && !destinationIds.has(dest) && prod.id !== dest,
      'duplicate or directly shared KV namespace');
    sourceIds.add(prod.id);
    destinationIds.add(dest);
  }
  ensure([...sourceIds].every(id => !destinationIds.has(id)),
    'staging Worker shares any Production KV namespace');

  ensure(productionWorker.durable_objects?.bindings?.some(x =>
    x.name === 'SECURITY_COORDINATOR' && x.class_name === 'SecurityCoordinator') &&
    productionWorker.exports?.SecurityCoordinator?.type === 'durable-object' &&
    productionWorker.exports?.SecurityCoordinator?.storage === 'sqlite',
  'canonical SQLite security coordinator missing');
  ensure(sourceFiles && PROTECTED_FILES.every(path => typeof sourceFiles[path] === 'string'),
    'required canonical recovery source owner missing');
  ensure(sourceFiles['scripts/prepare-staging.mjs'].includes('stagingCoordinator') &&
    sourceFiles['scripts/prepare-staging.mjs'].includes('forbiddenTargets') &&
    sourceFiles['scripts/prepare-staging.mjs'].includes("cloudName:"),
  'staging preparation no longer guarantees isolated coordinator or Cloudinary guard');
  ensure(sourceFiles['scripts/security-dr-restore-policy.mjs'].includes(
    'historicalSecurityStateExcludedFromCandidates: true') &&
    sourceFiles['scripts/secure-firestore-backup.mjs'].includes('recoveryScan.finish(true, actual)'),
  'offline restore quarantine/cryptographic verification is missing');
  ensure(sourceFiles['telemetry-worker/src/security-coordinator.js'].includes(
    'export class SecurityCoordinator'),
  'canonical coordinator implementation missing');
  for (const name of requiredWorkerSecrets) {
    ensure(sourceFiles['telemetry-worker/src/index.js'].includes('env.' + name),
      'missing server-only security dependency owner');
  }
  ensure(sourceFiles['admin/services/adminAuthorizationService.js'].includes('authorizedAdministrators'),
    'Admin authorization owner not found');
  return Object.freeze({
    status: 'SOURCE_ISOLATION_PREFLIGHT_PASS__FULL_STACK_DR_HOLD',
    productionModified: false,
    cloudRequestsMade: 0,
    credentialsRead: 0,
    sourceBoundariesVerified: PROTECTED_FILES.length,
    pendingOwnerGates: [...OWNER_GATES]
  });
}

export async function runOfflinePreflight(directory = root) {
  const read = async path => readFile(resolve(directory, path), 'utf8');
  const [firebaseRC, workerJSON, stagingJSON, ...sourceContent] = await Promise.all([
    read('.firebaserc'), read('telemetry-worker/wrangler.jsonc'),
    read('scripts/staging-targets.json'), ...PROTECTED_FILES.map(read)
  ]);
  const config = JSON.parse(firebaseRC);
  const sourceFiles = Object.fromEntries(PROTECTED_FILES.map((path, i) => [path, sourceContent[i]]));
  return assessRecoveryIsolation({
    productionFirebase: config.projects?.default,
    productionWorker: JSON.parse(workerJSON),
    staging: JSON.parse(stagingJSON),
    sourceFiles
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfflinePreflight().then(result => {
    console.log('PASS: offline source isolation preflight; zero Cloud operations.');
    console.log('HOLD: full-stack DR certification still requires ' +
      result.pendingOwnerGates.length + ' real isolated owner-verification gates.');
    console.log('Owner gate identifiers: ' + result.pendingOwnerGates.join(', '));
    console.log('No Production deploy, secret inspection, Auth user import, or backup restore occurred.');
  }).catch(() => {
    // Avoid printing arbitrary errors or raw provider configuration.
    console.error('HOLD: offline disaster recovery source preflight could not establish isolation.');
    process.exitCode = 1;
  });
}
