/**
 * Owner-operated Firestore document export for Spark-plan production projects.
 * BACKUP ONLY: no writes to Firebase, Identity Platform, Cloudflare, or GitHub.
 * Requires separately authorized execution and external, private backup storage.
 * Auth, Firestore Rules/indexes, Cloudflare KV/DO/secrets are NOT covered.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as deriveKey } from 'node:crypto';
import { createReadStream, promises as fs, realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'rolando-portfolio-3f1a3';
export const ROOT_COLLECTIONS = Object.freeze([
  'authorizedAdministrators', 'adminSecurityDevices', 'adminSecurityDeviceBootstrap',
  'adminSecurityDeviceCredentials', 'adminSecuritySessions', 'adminSecurityRecovery',
  'adminSecurityEvents', 'adminSecurityChallenges', 'adminSecurityStepUps',
  'adminSecurityPreferences', 'adminSecurityState',
  'portfolio', 'experiences', 'projects', 'photoEditingProjects', 'education',
  'skills', 'certificates', 'resumes', 'portfolioSections', 'portfolioSectionEntries',
  'privateMessageThreads', 'contactMessages', 'settings', 'migrations'
]);
export const CHILD_COLLECTIONS = Object.freeze(['messages']);
const MAGIC = 'LAN-FIRESTORE-ENCRYPTED-V1\n';
const KDF = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 268435456 });
const derive = promisify(deriveKey);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

export async function getPage(request, method, path, body = undefined) {
  const response = await request(method, path, body);
  ensure(response && typeof response === 'object', 'Invalid Firestore response.');
  return response;
}

async function collectionIds(request, parent) {
  let next = '', ids = [], seen = new Set();
  do {
    const result = await getPage(request, 'POST', parent + ':listCollectionIds',
      { pageSize: 100, ...(next ? { pageToken: next } : {}) });
    ensure(Array.isArray(result.collectionIds || []), 'Malformed collection inventory.');
    ids.push(...(result.collectionIds || []));
    next = result.nextPageToken || '';
    ensure(!next || !seen.has(next), 'Collection pagination loop.');
    if (next) seen.add(next);
  } while (next);
  ensure(new Set(ids).size === ids.length, 'Duplicate collection inventory.');
  return ids.sort();
}

export async function enumerateFirestore(request, project, emit) {
  ensure(project === PROJECT, 'Refusing unexpected Firebase project.');
  const base = 'projects/' + project + '/databases/(default)/documents';
  const roots = await collectionIds(request, base);
  ensure(roots.length > 0, 'No root collections found; refusing empty export.');
  const unknown = roots.filter(id => !ROOT_COLLECTIONS.includes(id));
  ensure(!unknown.length, 'Unreviewed root collections detected; stop and audit the allowlist.');
  let count = 0;
  const counts = {};

  async function walk(parent, collectionId, depth) {
    ensure(depth < 16, 'Firestore subcollection depth limit reached.');
    ensure(/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(collectionId), 'Unexpected collection identifier.');
    const collection = parent + '/' + encodeURIComponent(collectionId);
    let next = '', tokens = new Set();
    do {
      const path = collection + '?pageSize=100&showMissing=true' +
        (next ? '&pageToken=' + encodeURIComponent(next) : '');
      const page = await getPage(request, 'GET', path);
      ensure(Array.isArray(page.documents || []), 'Malformed document page.');
      for (const doc of page.documents || []) {
        ensure(typeof doc.name === 'string' && doc.name.startsWith(parent + '/' + collectionId + '/'),
          'Unexpected Firestore document resource.');
        const relative = doc.name.slice((parent + '/' + collectionId + '/').length);
        ensure(relative && !relative.includes('/'), 'Unexpected document path in list response.');
        ensure(doc.fields !== undefined || doc.createTime === undefined,
          'Missing document unexpectedly contains timestamps.');
        await emit({ type: 'document', document: doc, missing: doc.fields === undefined });
        count++;
        counts[collectionId] = (counts[collectionId] || 0) + 1;
        const descendants = await collectionIds(request, doc.name);
        const forbidden = descendants.filter(name => !CHILD_COLLECTIONS.includes(name));
        ensure(forbidden.length === 0, 'Unreviewed child collections detected; stop and audit the allowlist.');
        for (const child of descendants) await walk(doc.name, child, depth + 1);
      }
      next = page.nextPageToken || '';
      ensure(!next || !tokens.has(next), 'Document pagination loop.');
      if (next) tokens.add(next);
    } while (next);
  }

  for (const root of roots) await walk(base, root, 0);
  ensure(count > 0, 'Refusing an empty Firestore document export.');
  return { project, rootCollections: roots, records: count, counts };
}

function parseHeader(bytes) {
  ensure(bytes.subarray(0, MAGIC.length).toString() === MAGIC, 'Not a LΛN encrypted backup.');
  const end = bytes.indexOf(10, MAGIC.length);
  ensure(end > MAGIC.length && end < 2048, 'Invalid encrypted backup header.');
  const header = JSON.parse(bytes.subarray(MAGIC.length, end).toString('utf8'));
  ensure(header?.algorithm === 'AES-256-GCM' && header?.kdf === 'scrypt' &&
    header?.project === PROJECT && header?.version === 1, 'Unsupported encrypted backup format.');
  ensure(header?.N === KDF.N && header?.r === KDF.r && header?.p === KDF.p, 'Unexpected encryption policy.');
  const salt = Buffer.from(header.salt || '', 'base64');
  const nonce = Buffer.from(header.nonce || '', 'base64');
  ensure(salt.length === 32 && nonce.length === 12, 'Invalid encryption parameters.');
  return { header, salt, nonce, dataStart: end + 1 };
}

function validateLocation(filename) {
  ensure(isAbsolute(filename), 'Output path must be absolute.');
  const parent = realpathSync(dirname(filename));
  const canonicalRepo = realpathSync(repoRoot);
  ensure(parent !== canonicalRepo && !parent.startsWith(canonicalRepo + sep),
    'Backups must be outside the source repository.');
  return resolve(parent, filename.split(/[\/]/).at(-1));
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    ensure(bytesWritten > 0, 'Encrypted archive write failed.');
    offset += bytesWritten;
  }
}

export async function createEncryptedBackup({ output, request, passphrase, project = PROJECT }) {
  ensure(project === PROJECT, 'Production target mismatch.');
  ensure(typeof passphrase === 'string' && passphrase.length >= 24,
    'Use a unique backup passphrase of at least 24 characters.');
  const target = validateLocation(output);
  const salt = randomBytes(32), nonce = randomBytes(12);
  const key = await derive(passphrase, salt, 32, KDF);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  key.fill(0);
  const header = Buffer.from(MAGIC + JSON.stringify({
    version: 1, project, algorithm: 'AES-256-GCM', kdf: 'scrypt',
    N: KDF.N, r: KDF.r, p: KDF.p,
    salt: salt.toString('base64'), nonce: nonce.toString('base64')
  }) + '\n');
  const partial = target + '.' + randomBytes(12).toString('hex') + '.partial';
  let handle;
  try {
    handle = await fs.open(partial, 'wx', 0o600);
    await writeAll(handle, header);
    const digest = createHash('sha256');
    const emit = async record => {
      const line = JSON.stringify(record) + '\n';
      ensure(Buffer.byteLength(line) < 8 * 1024 * 1024, 'Document exceeds safe encrypted record size.');
      digest.update(line);
      await writeAll(handle, cipher.update(line));
    };
    const manifest = await enumerateFirestore(request, project, emit);
    await writeAll(handle, cipher.update(JSON.stringify({
      type: 'manifest', ...manifest, sha256: digest.digest('hex')
    }) + '\n'));
    await writeAll(handle, cipher.final());
    await writeAll(handle, cipher.getAuthTag());
    await handle.sync();
    await handle.close(); handle = null;
    // A link is atomic and fails if the destination already exists; no overwrite.
    await fs.link(partial, target);
    await fs.unlink(partial);
    return { output: target, records: manifest.records, rootCollectionCount: manifest.rootCollections.length };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(partial).catch(() => {});
    throw error;
  }
}

export async function verifyEncryptedBackup({ input, passphrase }) {
  ensure(typeof passphrase === 'string' && passphrase.length >= 24,
    'A backup passphrase of at least 24 characters is required.');
  const handle = await fs.open(input, 'r');
  let headerPart, tag, size;
  try {
    size = (await handle.stat()).size;
    ensure(size > 60, 'Encrypted backup truncated.');
    headerPart = Buffer.alloc(Math.min(2048, size));
    await handle.read(headerPart, 0, headerPart.length, 0);
    const parsed = parseHeader(headerPart);
    ensure(size > parsed.dataStart + 16, 'Encrypted backup truncated.');
    tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
    const key = await derive(passphrase, parsed.salt, 32, KDF);
    const decipher = createDecipheriv('aes-256-gcm', key, parsed.nonce);
    key.fill(0);
    decipher.setAuthTag(tag);
    const digest = createHash('sha256');
    let tail = '', actual = 0, terminal = null;
    const decoder = new StringDecoder('utf8');
    function ingest(bytes) {
      tail += decoder.write(bytes);
      let index;
      while ((index = tail.indexOf('\n')) !== -1) {
        const line = tail.slice(0, index); tail = tail.slice(index + 1);
        const row = JSON.parse(line);
        if (row.type === 'document') {
          ensure(terminal === null && row.document?.name, 'Invalid archive document order.');
          digest.update(line + '\n');
          actual++;
        } else {
          ensure(row.type === 'manifest' && terminal === null, 'Invalid archive manifest.');
          terminal = row;
        }
      }
      ensure(tail.length < 16000000, 'Encrypted archive contains oversized record.');
    }
    const stream = createReadStream(input, { start: parsed.dataStart, end: size - 17 });
    for await (const part of stream) ingest(decipher.update(part));
    ingest(decipher.final()); // rejects incorrect key or changed ciphertext/tag
    tail += decoder.end();
    ensure(tail === '' && terminal !== null && terminal.project === PROJECT,
      'Archive missing a complete production manifest.');
    ensure(terminal.records === actual && terminal.sha256 === digest.digest('hex'),
      'Archive record count or digest mismatch.');
    return { verified: true, records: actual, rootCollectionCount: terminal.rootCollections.length };
  } finally {
    await handle.close();
  }
}

/**
 * Parse raw terminal input without echoing secrets. Chrome/Cloud Shell can
 * send bracketed-paste escape codes split across arbitrary chunks; they are
 * control sequences, never part of the actual backup passphrase.
 */
export function createHiddenInputParser() {
  const decoder = new StringDecoder('utf8');
  let value = '', escape = '', finished = false;
  return {
    accept(chunk) {
      if (finished) return { complete: true, value };
      for (const char of decoder.write(chunk)) {
        if (escape) {
          escape += char;
          if (escape.length > 32 || /[A-Za-z~]/.test(char)) escape = '';
          continue;
        }
        if (char === '\u001b') { escape = char; continue; }
        if (char === '\r' || char === '\n') {
          finished = true;
          return { complete: true, value };
        }
        if (char === '\u0003') return { cancelled: true };
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        // Ctrl+V may insert a control character instead of pasting. Ignore it.
        // Never echo the password, raw terminal input, or clipboard contents.
        if (char >= ' ' && char !== '\u007f' && value.length < 512) value += char;
      }
      return { complete: false };
    }
  };
}

async function readHiddenPrompt(message) {
  ensure(process.stdin.isTTY && typeof process.stdin.setRawMode === 'function',
    'Encrypted backup requires an interactive TTY for a hidden passphrase.');
  process.stderr.write(message);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const parser = createHiddenInputParser();
  try {
    return await new Promise((resolveSecret, rejectSecret) => {
      function receive(chunk) {
        const result = parser.accept(chunk);
        if (!result.complete && !result.cancelled) return;
        process.stdin.off('data', receive);
        process.stderr.write('\n');
        if (result.cancelled) rejectSecret(new Error('Input cancelled.'));
        else resolveSecret(result.value);
      }
      process.stdin.on('data', receive);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

export function safeBackupFailureCode(error) {
  // Intentionally a fixed allowlist. Never print arbitrary exception messages:
  // REST error bodies could contain private documents or credentials.
  const message = String(error?.message || '');
  if (message.includes('Backup passphrases do not match')) return 'PASSPHRASE_MISMATCH';
  if (message.includes('at least 24 characters')) return 'PASSPHRASE_TOO_SHORT';
  if (message.includes('Input cancelled')) return 'INPUT_CANCELLED';
  if (message.includes('gcloud') || message.includes('Google Cloud access token'))
    return 'CLOUD_CREDENTIAL_UNAVAILABLE';
  if (message.includes('Read-only Firestore request denied or failed'))
    return 'FIRESTORE_READ_DENIED';
  if (message.includes('Unreviewed root collections') ||
      message.includes('Unreviewed child collections')) return 'FIRESTORE_COLLECTION_REVIEW_REQUIRED';
  if (message.includes('pagination loop') || message.includes('Malformed') ||
      message.includes('Invalid Firestore') || message.includes('unexpectedly contains timestamps'))
    return 'FIRESTORE_INVENTORY_INCOMPLETE';
  if (error?.code === 'ENOENT') return 'BACKUP_FILE_NOT_FOUND';
  if (error?.code === 'EEXIST') return 'BACKUP_ALREADY_EXISTS';
  if (message.includes('Not a LΛN encrypted backup') ||
      message.includes('Archive') || message.includes('Encrypted backup'))
    return 'BACKUP_VERIFY_FAILED';
  return 'BACKUP_CHECK_FAILED';
}

export async function main(args = process.argv.slice(2)) {
  const [action, ...params] = args;
  if (!['backup', 'verify'].includes(action)) {
    process.stdout.write('Usage: node scripts/secure-firestore-backup.mjs backup --output /PRIVATE/backup.lanfbak --confirm-production-read\n' +
      '       node scripts/secure-firestore-backup.mjs verify --input /PRIVATE/backup.lanfbak\n' +
      'Requires explicit separate owner approval for any production read. NO RESTORE COMMAND EXISTS.\n');
    return;
  }
  ensure(process.env.CI !== 'true' && !process.env.GITHUB_ACTIONS,
    'Production backups are forbidden in CI.');
  const flags = new Map();
  for (let i = 0; i < params.length; i += 2) {
    ensure(params[i]?.startsWith('--') && params[i + 1], 'Invalid command arguments.');
    flags.set(params[i], params[i + 1]);
  }
  if (action === 'verify') {
    ensure(flags.size === 1 && flags.has('--input'), 'Only --input is permitted for verify.');
    const passphrase = await readHiddenPrompt('Backup passphrase (not displayed): ');
    const result = await verifyEncryptedBackup({ input: flags.get('--input'), passphrase });
    process.stdout.write('Encrypted archive verified. Records: ' + result.records + '. No data was displayed.\n');
    return;
  }
  ensure(flags.size === 2 && flags.has('--output') &&
    flags.get('--confirm-production-read') === 'true',
    'Requires --output and explicit --confirm-production-read true (after owner authorization).');
  const passphrase = await readHiddenPrompt('Create UNIQUE backup passphrase (not displayed): ');
  const confirm = await readHiddenPrompt('Confirm backup passphrase: ');
  ensure(passphrase === confirm, 'Backup passphrases do not match.');
  ensure(passphrase.length >= 24, 'Use a backup passphrase of at least 24 characters.');
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000
  }).trim();
  ensure(token.length > 50, 'Google Cloud access token unavailable.');
  const requester = async (method, path, body) => {
    const result = await fetch('https://firestore.googleapis.com/v1/' + path, {
      method, headers: {
        Authorization: 'Bearer ' + token,
        'X-Goog-User-Project': PROJECT,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000)
    });
    ensure(result.ok, 'Read-only Firestore request denied or failed (HTTP ' + result.status + ').');
    return result.json();
  };
  const result = await createEncryptedBackup({
    output: flags.get('--output'), project: PROJECT, passphrase, request: requester
  });
  process.stdout.write('Encrypted backup created with restrictive file permissions: ' +
    result.records + ' document resources. Offline verification still required.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Emit a fixed diagnostic code, never error.message or private payloads.
    process.stderr.write('Backup utility stopped safely [' +
      safeBackupFailureCode(error) + ']. No production writes were made.\n');
    process.exitCode = 1;
  });
}
