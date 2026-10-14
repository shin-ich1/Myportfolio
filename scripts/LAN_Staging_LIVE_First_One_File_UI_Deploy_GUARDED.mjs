/**
 * LΛN Staging-only Hosting UI patch, live-first, 2026-10-14.
 * ONLY /admin/js/settings-security.js can differ between live versions.
 * The CURRENT deployed JS, not the stale local 741-line copy, is patched.
 * Two reviewed UI changes: save currentTarget synchronously; later call form.reset().
 * Read-only by default. Writes ONLY with --deploy + exact confirmation.
 * Run from the root of Myportfolio-Security-Release-Candidate.
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const SITE = 'lan-portfolio-staging';
const ASSET = '/admin/js/settings-security.js';
const API = 'https://firebasehosting.googleapis.com/v1beta1';
const STAGING_PUBLIC = 'https://lan-portfolio-staging.web.app';
const CONFIRM = 'DEPLOY-STAGING-UI-ONLY';
const VERSION_PATTERN = /^sites\/lan-portfolio-staging\/versions\/[a-zA-Z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STAGING_UPLOAD_PATTERN = /^https:\/\/upload-firebasehosting\.googleapis\.com\/upload\/sites\/lan-portfolio-staging\/versions\/[A-Za-z0-9_-]+\/files$/;

function stop(reason) { throw new Error(`STOP: ${reason}`); }
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function patchLiveUi(source) {
  const marker = "$('securityChangePasswordForm')?.addEventListener('submit', async event => {";
  const pos = source.indexOf(marker);
  if (pos < 0 || source.indexOf(marker, pos + marker.length) >= 0) stop('Expected exactly one password form handler.');
  const mixedEndings = source.includes('\r\n') && source.replaceAll('\r\n', '').includes('\n');
  if (mixedEndings || /\r(?!\n)/.test(source)) stop('Mixed/unexpected line endings in live JS.');
  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const end = source.indexOf(`${nl}});`, pos);
  if (end < 0) stop('Password form handler terminator missing.');
  const block = source.slice(pos, end);
  const prevent = '  event.preventDefault();';
  const reset = 'event.currentTarget.reset();';
  const count = (haystack, needle) => haystack.split(needle).length - 1;
  if (count(block, prevent) !== 1 || count(block, reset) !== 1 ||
      block.includes('const form = event.currentTarget;') || block.indexOf(prevent) >= block.indexOf(reset)) {
    stop('Live password handler is not the reviewed old implementation.');
  }
  const newBlock = block.replace(prevent, `${prevent}${nl}  const form = event.currentTarget;`).replace(reset, 'form.reset();');
  const modified = source.slice(0, pos) + newBlock + source.slice(end);
  if (modified === source || modified.split('\n').length !== source.split('\n').length + 1) {
    stop('Unexpected patch line count.');
  }
  // Prove that reversing the two substitutions restores every original character.
  const reversed = modified.slice(0, pos) + newBlock
    .replace(`${prevent}${nl}  const form = event.currentTarget;`, prevent)
    .replace('form.reset();', reset) + modified.slice(pos + newBlock.length);
  if (reversed !== source) stop('Patch modifies unrelated JS source.');
  return { modified, originalLines: source.split('\n').length, patchedLines: modified.split('\n').length };
}

export function decodeStrictJs(buffer) {
  if (buffer.length < 10000 || buffer.length > 200000) stop('Unexpected live JS response size.');
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) stop('Unexpected UTF-8 BOM in live UI.');
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  if (source.includes('\u0000') || !source.includes('securityChangePasswordForm')) stop('Unexpected live JS response.');
  return source;
}

function preflightProject() {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'scripts/staging-targets.json'), 'utf8'));
  const rc = JSON.parse(readFileSync(path.join(process.cwd(), '.lan-staging/.firebaserc'), 'utf8'));
  if (manifest.firebase?.projectId !== SITE || rc.projects?.default !== SITE || manifest.worker?.name !== SITE ||
      manifest.firebase?.authDomain !== `${SITE}.firebaseapp.com`) {
    stop('Local staging target mismatched; must run from the reviewed repository root.');
  }
}
function getToken() {
  const cmd = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  const token = execFileSync(cmd, ['auth', 'print-access-token', '--quiet'], {
    encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  if (!/^[A-Za-z0-9._~+/-]{20,}={0,2}$/.test(token)) stop('Google Cloud user token unavailable.');
  return token; // Do not print or save to a file.
}
function apiFactory(token) {
  const headers = {Authorization: `Bearer ${token}`, 'X-Goog-User-Project': SITE, Accept: 'application/json'};
  return async (method, suffix, body) => {
    if (!suffix.startsWith(`/sites/${SITE}/`)) stop('Firebase Hosting API outside Staging.');
    const res = await fetch(`${API}${suffix}`, {
      method, headers: {...headers, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) stop(`Firebase Staging Hosting API ${method} failed: HTTP ${res.status} (${suffix.split('?')[0]}).`);
    const result = await res.json();
    if (!result || typeof result !== 'object') stop('Invalid Firebase Hosting response.');
    return result;
  };
}
async function liveRelease(api) {
  const result = await api('GET', `/sites/${SITE}/channels/live/releases?pageSize=1`);
  if (!Array.isArray(result.releases) || result.releases.length !== 1) stop('Staging live Hosting release unavailable.');
  const version = result.releases[0].version?.name;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) stop('Invalid Staging Hosting version.');
  return version;
}
async function sameRelease(api, original) {
  if (await liveRelease(api) !== original) stop('Live Staging Hosting version changed during preparation.');
}
async function listActiveFiles(api, version) {
  if (!VERSION_PATTERN.test(version)) stop('Invalid file-manifest version.');
  const files = new Map();
  let next = '';
  for (let pages = 0; pages < 100; pages++) {
    const extra = next ? `&pageToken=${encodeURIComponent(next)}` : '';
    const result = await api('GET', `/${version}/files?status=ACTIVE&pageSize=1000${extra}`);
    if (!Array.isArray(result.files)) stop('Hosting version file list missing.');
    for (const file of result.files) {
      if (typeof file.path !== 'string' || !file.path.startsWith('/') ||
          typeof file.hash !== 'string' || !HASH_PATTERN.test(file.hash) || files.has(file.path)) {
        stop('Invalid or duplicate Hosting file manifest entry.');
      }
      files.set(file.path, file.hash);
      if (files.size > 10000) stop('Unusually large Hosting manifest.');
    }
    next = result.nextPageToken || '';
    if (!next) return files;
  }
  stop('Unexpected Hosting manifest pagination.');
}
async function fetchPublicJs() {
  const url = new URL(`${STAGING_PUBLIC}${ASSET}`);
  url.searchParams.set('audit', createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 20));
  const response = await fetch(url, {headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(45000)});
  if (!response.ok) stop(`Could not fetch published Staging JS (HTTP ${response.status}).`);
  if ((response.headers.get('content-type') || '').toLowerCase().includes('text/html')) stop('Hosted URL returned HTML, not JS.');
  return Buffer.from(await response.arrayBuffer());
}
async function stableLiveSnapshot() {
  const a = await fetchPublicJs();
  const b = await fetchPublicJs();
  if (sha256(a) !== sha256(b)) stop('Live JS changed between independent reads.');
  return a;
}
async function checkJsSyntax(tempDir, bytes) {
  const file = path.join(tempDir, 'settings-security-PATCHED.mjs');
  writeFileSync(file, bytes);
  execFileSync(process.execPath, ['--check', file], {stdio: 'pipe', timeout: 20000});
}
async function uploadRequired(url, hash, gzipBytes, token) {
  if (!STAGING_UPLOAD_PATTERN.test(url) || !HASH_PATTERN.test(hash)) stop('Non-staging or malformed file upload URL.');
  const response = await fetch(`${url}/${hash}`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'X-Goog-User-Project': SITE, 'Content-Type': 'application/octet-stream'},
    body: gzipBytes, signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) stop(`Staging JS upload failed: HTTP ${response.status}.`);
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--preflight', '--deploy'].includes(args[0]))) {
    stop('Usage: node LAN_Staging_LIVE_First_One_File_UI_Deploy_GUARDED.mjs [--preflight|--deploy]');
  }
  const deploy = args[0] === '--deploy';
  preflightProject();
  console.log('STAGING TARGET: VERIFIED; LOCAL FILE WILL NOT BE UPLOADED');
  const temp = mkdtempSync(path.join(tmpdir(), 'lan-staging-hosting-'));
  try {
    const token = getToken();
    const api = apiFactory(token);
    const original = await liveRelease(api);
    const originalVersion = await api('GET', `/${original}`);
    if (originalVersion.status !== 'FINALIZED' || !originalVersion.config) stop('Active Staging Hosting config unavailable.');
    const originalFiles = await listActiveFiles(api, original);
    if (originalFiles.size < 100 || ![ASSET, '/index.html', '/admin/index.html'].every(f => originalFiles.has(f))) {
      stop('Staging live file manifest incomplete.');
    }
    const live = await stableLiveSnapshot();
    const liveHash = sha256(live);
    const patched = patchLiveUi(decodeStrictJs(live));
    const payload = Buffer.from(patched.modified, 'utf8');
    await checkJsSyntax(temp, payload);
    const gzip = gzipSync(payload, {level: 9});
    const fileHash = sha256(gzip);
    if (originalFiles.get(ASSET) === fileHash) stop('Patched UI hash already present in current Staging release.');

    console.log(`CURRENT LIVE HOSTING VERSION: ${original}`);
    console.log(`LIVE JS SHA256: ${liveHash}`);
    console.log(`LIVE UI LINES: ${patched.originalLines} -> PATCHED UI LINES: ${patched.patchedLines}`);
    console.log(`FILES TO PRESERVE UNCHANGED: ${originalFiles.size - 1}`);
    console.log(`ONLY CHANGED PATH: ${ASSET}`);
    console.log('SOURCE PATCH: EXACTLY TWO REVIEWED EDITS ON CURRENT LIVE JS');
    console.log('PRODUCTION: NOT TARGETED');
    await sameRelease(api, original);
    if (!deploy) { console.log('READ-ONLY PREFLIGHT PASSED; DEPLOYMENT NOT PERFORMED'); return; }

    const rl = createInterface({input: stdin, output: stdout});
    let approval = '';
    try { approval = (await rl.question(`Type ${CONFIRM} to publish to Staging (Enter cancels): `)).trim(); }
    finally { rl.close(); }
    if (approval !== CONFIRM) { console.log('CANCELLED - NO DEPLOYMENT'); return; }
    await sameRelease(api, original);
    if (sha256(await stableLiveSnapshot()) !== liveHash) stop('Live JS changed after approval. No write performed.');

    // WRITE PHASE: clone existing live Hosting config + ALL existing file hashes.
    const created = await api('POST', `/sites/${SITE}/versions`, {config: originalVersion.config});
    const draft = created.name;
    if (typeof draft !== 'string' || !VERSION_PATTERN.test(draft)) stop('Invalid created Staging draft version.');
    const planned = new Map(originalFiles);
    planned.set(ASSET, fileHash);
    const entries = [...planned.entries()].sort(([a], [b]) => a.localeCompare(b));
    const required = new Set();
    let uploadUrl;
    for (let i = 0; i < entries.length; i += 500) {
      const batch = Object.fromEntries(entries.slice(i, i + 500));
      const result = await api('POST', `/${draft}:populateFiles`, {files: batch});
      for (const hash of result.uploadRequiredHashes || []) required.add(hash);
      if (result.uploadUrl) uploadUrl = result.uploadUrl;
    }
    if ([...required].some(hash => hash !== fileHash) || required.size > 1) {
      stop('Hosting requested unreviewed file upload; draft NOT released.');
    }
    if (required.has(fileHash)) {
      if (!uploadUrl) stop('Staging file-upload URL absent; draft NOT released.');
      await uploadRequired(uploadUrl, fileHash, gzip, token);
    }
    const draftFiles = await listActiveFiles(api, draft);
    if (draftFiles.size !== planned.size) stop('Staging draft manifest count mismatch.');
    for (const [key, hash] of planned) {
      if (draftFiles.get(key) !== hash) stop(`Staging draft manifest differs at ${key}. No release.`);
    }
    await sameRelease(api, original);
    const finished = await api('PATCH', `/${draft}?update_mask=status`, {status: 'FINALIZED'});
    if (finished.status !== 'FINALIZED') stop('Staging draft finalization failed.');
    await sameRelease(api, original);
    const release = await api('POST', `/sites/${SITE}/channels/live/releases?versionName=${encodeURIComponent(draft)}`);
    if (release.version?.name !== draft) stop('Staging release confirmation missing; inspect Hosting console before retrying.');
    console.log('STAGING HOSTING RELEASE: CONFIRMED');
    console.log(`PREVIOUS VERSION: ${original}`);
    console.log(`NEW VERSION: ${draft}`);
    console.log(`ONLY NEW FILE: ${ASSET}`);
    console.log('PRODUCTION: NOT DEPLOYED');
    console.log('NEXT: verify served Staging JS, then reconcile live changes into canonical local source.');
  } finally { rmSync(temp, {recursive: true, force: true}); }
}

const calledDirectly = Boolean(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)));
if (calledDirectly) {
  main().catch(e => { console.error(String(e?.message || e)); process.exitCode = 1; });
}