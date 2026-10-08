/**
 * Prepare a tracked-only staging site. No production source is edited or deployed.
 * scripts/staging-targets.json is the canonical owner of staging public identifiers.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'scripts/staging-targets.json');
const webExtensions = new Set('.html .htm .js .mjs .css .json .svg .png .jpg .jpeg .webp .avif .gif .ico .woff .woff2 .ttf .otf .eot .mp4 .webm .mp3 .ogg .pdf .webmanifest'.split(' '));
const textExtensions = new Set('.html .htm .js .mjs .css .json .webmanifest'.split(' '));
const forbiddenTargets = ['rolando-portfolio-3f1a3', 'lan-cloudinary-telemetry.lagmayr2.workers.dev'];
// Exact legacy staging-only KV ID permitted once during local config migration.
// No runtime code may continue using this obsolete security state namespace.
const legacySecurityStateKvId = '24224266caf94e6ebe5ba8c8e9010873';
const stagingCoordinator = Object.freeze({
  durable_objects: { bindings: [{ name: 'SECURITY_COORDINATOR', class_name: 'SecurityCoordinator' }] },
  exports: { SecurityCoordinator: { type: 'durable-object', storage: 'sqlite' } }
});

function assertSafe(ok, why) {
  if (!ok) throw new Error(why);
}
function exactlyOneReplace(source, regex, value, label) {
  const matches = source.match(new RegExp(regex.source, 'g')) || [];
  assertSafe(matches.length === 1, 'Expected exactly one canonical ' + label + ' in config.js.');
  return source.replace(regex, value);
}
function objectLiteral(values) {
  return Object.entries(values).map(([key, value]) => {
    assertSafe(/^[a-zA-Z_$][\w$]*$/.test(key), 'Invalid staging configuration key.');
    return '  ' + key + ': ' + JSON.stringify(value);
  }).join(',\n');
}
function stageConfig(source, target) {
  assertSafe(source.includes('projectId: "rolando-portfolio-3f1a3"'),
    'Source config.js must keep production defaults; revert manual staging edits before building.');
  let result = exactlyOneReplace(source,
    /export const firebaseConfig\s*=\s*\{[\s\S]*?\n\};/,
    'export const firebaseConfig = {\n' + objectLiteral(target.firebase) + '\n};',
    'Firebase configuration');
  result = exactlyOneReplace(result,
    /export const telemetryBridgeConfig\s*=\s*Object\.freeze\(\{[\s\S]*?\n\}\);/,
    'export const telemetryBridgeConfig = Object.freeze({\n' +
    '  localUrl: ' + JSON.stringify(target.worker.telemetryUrl) + ',\n' +
    '  productionUrl: ' + JSON.stringify(target.worker.telemetryUrl) + ',\n' +
    '  enforceConfiguredBridge: true\n});',
    'Worker bridge configuration');
  // No staging Cloudinary account is configured. Fail uploads closed instead of
  // accidentally using the production unsigned preset/account from config.js.
  result = exactlyOneReplace(result, /cloudName:\s*"fmbcpufk"/, 'cloudName: ""', 'Cloudinary cloud name');
  result = exactlyOneReplace(result, /uploadPreset:\s*"lan_portfolio_unsigned"/, 'uploadPreset: ""', 'Cloudinary upload preset');
  return result;
}
function webFile(filename) {
  const parts = filename.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part.startsWith('.') || part === '..')) return false;
  if (parts.length > 1 && parts[0] !== 'admin' && parts[0] !== 'assets') return false;
  return webExtensions.has(path.extname(filename).toLowerCase());
}
function validateManifest(target) {
  assertSafe(target.firebase.projectId === 'lan-portfolio-staging', 'Unexpected Firebase project.');
  assertSafe(target.firebase.authDomain === 'lan-portfolio-staging.firebaseapp.com', 'Unexpected Firebase auth domain.');
  assertSafe(target.firebase.storageBucket === 'lan-portfolio-staging.firebasestorage.app', 'Unexpected Firebase storage bucket.');
  assertSafe(/^1:\d+:web:[a-zA-Z0-9]+$/.test(target.firebase.appId), 'Invalid staging web app ID.');
  assertSafe(target.worker.name === 'lan-portfolio-staging', 'Unexpected Worker name.');
  assertSafe(target.worker.telemetryUrl === 'https://lan-portfolio-staging.lagmayr2.workers.dev/telemetry',
    'Refusing non-staging Worker endpoint.');
  const expectedBindings = ['PORTFOLIO_MESSAGES', 'STORAGE_OAUTH'];
  assertSafe(Object.keys(target.worker.kvNamespaces || {}).sort().join() === expectedBindings.sort().join(),
    'Unexpected Worker KV binding names.');
  for (const id of Object.values(target.worker.kvNamespaces)) {
    assertSafe(/^[a-f0-9]{32}$/.test(id), 'Invalid staging Worker KV namespace ID.');
  }
}
function parseJsonc(source) {
  let result = '', quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (quoted) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') { quoted = true; result += ch; }
    else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      result += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
    } else result += ch;
  }
  return JSON.parse(result.replace(/,\s*(?=[}\]])/g, ''));
}
function workerConfig(target) {
  return {
    '$schema': 'node_modules/wrangler/config-schema.json',
    name: target.worker.name,
    main: 'src/index.js',
    compatibility_date: '2026-08-15',
    kv_namespaces: Object.entries(target.worker.kvNamespaces).map(([binding, id]) => ({ binding, id })),
    ...structuredClone(stagingCoordinator),
    vars: { FIREBASE_PROJECT_ID: target.firebase.projectId }
  };
}
async function reviewExistingWorker(file, expected) {
  let source;
  try { source = await readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  const current = parseJsonc(source);
  assertSafe(current.name === expected.name, 'Staging Worker name mismatch.');
  assertSafe(current.main === expected.main, 'Staging Worker entrypoint mismatch.');
  assertSafe(current.vars?.FIREBASE_PROJECT_ID === expected.vars.FIREBASE_PROJECT_ID, 'Staging Worker Firebase project mismatch.');
  const bindings = new Map((current.kv_namespaces || []).map(item => [item.binding, item.id]));
  const legacyBinding = bindings.get('SECURITY_STATE');
  assertSafe(!legacyBinding || legacyBinding === legacySecurityStateKvId,
    'Unrecognized old staging security KV binding; no file was overwritten.');
  assertSafe(bindings.size === expected.kv_namespaces.length + (legacyBinding ? 1 : 0),
    'Staging Worker KV binding count mismatch.');
  for (const item of expected.kv_namespaces) {
    assertSafe(bindings.get(item.binding) === item.id,
      'Staging Worker KV binding ' + item.binding + ' mismatch.');
  }
  // An older generated staging config may lack the Durable Object declaration;
  // migrate it only after all existing settings have been verified above.
  for (const key of ['durable_objects', 'exports']) {
    if (current[key] !== undefined) {
      assertSafe(JSON.stringify(current[key]) === JSON.stringify(expected[key]),
        'Staging Worker Durable Object configuration mismatch.');
    }
  }
  const allowedVars = new Set(Object.keys(expected.vars));
  for (const name of Object.keys(current.vars || {})) {
    // Migration only: strip the previously generated web API key from Wrangler vars.
    // No unrelated local environment variable may be silently overwritten.
    assertSafe(allowedVars.has(name) || name === 'FIREBASE_WEB_API_KEY',
      'Unreviewed staging Worker variable; no file was overwritten.');
  }
}
function trackedWebFiles(root) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached'], { encoding: 'utf8' })
    .split('\0').filter(webFile);
}
async function auditPublishedFiles(site, filenames) {
  for (const filename of filenames) {
    if (!textExtensions.has(path.extname(filename).toLowerCase())) continue;
    const text = await readFile(path.join(site, filename), 'utf8');
    for (const marker of forbiddenTargets) {
      assertSafe(!text.includes(marker), 'Production reference detected in publishable asset ' + filename + ': ' + marker + '. Build blocked.');
    }
  }
}
export async function prepareStaging({ root = repoRoot, firebaseWebApiKey = process.env.LAN_STAGING_FIREBASE_WEB_API_KEY } = {}) {
  root = path.resolve(root);
  const target = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(target);
  assertSafe(/^AIza[A-Za-z0-9_-]{30,}$/.test(firebaseWebApiKey || ''),
    'Missing or invalid LAN_STAGING_FIREBASE_WEB_API_KEY. Set it locally (never commit it to Git).');
  const runtimeTarget = { ...target, firebase: { ...target.firebase, apiKey: firebaseWebApiKey } };
  const hosting = JSON.parse(await readFile(path.join(root, 'firebase.json'), 'utf8')).hosting;
  assertSafe(hosting?.rewrites && hosting?.headers, 'Canonical Firebase Hosting configuration missing.');
  const intendedWorker = workerConfig(target);
  const workerFile = path.join(root, 'telemetry-worker/wrangler.staging.jsonc');
  await reviewExistingWorker(workerFile, intendedWorker);
  const sourceConfig = await readFile(path.join(root, 'config.js'), 'utf8');
  const sourceBridge = await readFile(path.join(root, 'storage-bridge-url.js'), 'utf8');
  assertSafe(sourceBridge.includes('telemetryBridgeConfig.enforceConfiguredBridge === true'),
    'Canonical Worker URL owner must protect staging from saved production overrides.');
  const renderedConfig = stageConfig(sourceConfig, runtimeTarget);
  const files = trackedWebFiles(root);
  for (const required of ['config.js', 'storage-bridge-url.js', 'index.html', 'admin/index.html']) {
    assertSafe(files.includes(required), 'Missing tracked web entrypoint: ' + required);
  }
  const outputDir = path.join(root, '.lan-staging');
  const tempDir = path.join(root, '.lan-staging.tmp-' + process.pid);
  await rm(tempDir, { recursive: true, force: true });
  try {
    const site = path.join(tempDir, 'site');
    for (const filename of files) {
      const input = path.join(root, filename);
      const stat = await lstat(input);
      assertSafe(stat.isFile() && !stat.isSymbolicLink(), 'Unsafe source file: ' + filename);
      const output = path.join(site, filename);
      await mkdir(path.dirname(output), { recursive: true });
      if (filename === 'config.js') await writeFile(output, renderedConfig);
      else await copyFile(input, output);
    }
    await auditPublishedFiles(site, files);
    execFileSync(process.execPath, ['--check', path.join(site, 'config.js')], { stdio: 'pipe' });
    await writeFile(path.join(tempDir, 'firebase.json'), JSON.stringify({ hosting: { ...hosting, public: 'site' } }, null, 2) + '\n');
    await writeFile(path.join(tempDir, '.firebaserc'), JSON.stringify({
      projects: { default: 'lan-portfolio-staging' }, targets: {}, etags: {}
    }, null, 2) + '\n');
    await writeFile(path.join(tempDir, 'README.txt'),
      'ISOLATED LΛN STAGING BUILD - NOT DEPLOYED\n' +
      'Firebase: lan-portfolio-staging\nWorker: lan-portfolio-staging\n' +
      'No production credential, OAuth integration or Firestore data is copied.\n' +
      'Server credentials, TOTP enrollment, full security tests and deployment are pending.\n' +
      'Worker FIREBASE_WEB_API_KEY must be configured separately as a staging-only encrypted secret.\n');
    await rm(outputDir, { recursive: true, force: true });
    await rename(tempDir, outputDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
  await mkdir(path.dirname(workerFile), { recursive: true });
  const plannedWorkerContent = JSON.stringify(intendedWorker, null, 2) + '\n';
  let existing = '';
  try { existing = await readFile(workerFile, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing !== plannedWorkerContent) await writeFile(workerFile, plannedWorkerContent);
  return {
    outputDir, copiedFiles: files.length,
    firebaseProjectId: target.firebase.projectId, workerName: target.worker.name,
    deployed: false, runtimeSecurityVerified: false
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertSafe(process.argv.length === 2, 'Usage: node scripts/prepare-staging.mjs (no deploy options).');
    const result = await prepareStaging();
    console.log('STAGING BUILD READY (NOT DEPLOYED)\nFirebase: ' + result.firebaseProjectId +
      '\nWorker: ' + result.workerName + '\nPublished files: ' + result.copiedFiles +
      '\nOutput: .lan-staging/site\nHosting config: .lan-staging/firebase.json' +
      '\nWorker config: telemetry-worker/wrangler.staging.jsonc' +
      '\nSecurity runtime: NOT VERIFIED. Do not deploy or sign in yet.');
  } catch (error) {
    console.error('STAGING BUILD BLOCKED: ' + error.message);
    process.exitCode = 1;
  }
}
