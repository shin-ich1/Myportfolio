/**
 * Owner-operated, READ-ONLY Cloudflare KV snapshot. The only remote HTTP method
 * used is GET. No token, key/value, metadata, passphrase, or decrypted payload
 * may be sent to GitHub/CI or printed to stdout.
 *
 * Usage: node scripts/secure-cloudflare-kv-backup.mjs backup --output ABS_PATH
 *        node scripts/secure-cloudflare-kv-backup.mjs verify --input ABS_PATH
 * Environment for backup only: LAN_CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN.
 * Both operations prompt for a private passphrase using a non-echoing TTY.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, link, unlink, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const MAGIC = Buffer.from('LANKV001');
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const MAX_RECORDS = 100000;
const MAX_VALUE_BYTES = 26 * 1024 * 1024;
const KDF = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export async function canonicalNamespaces() {
  const raw = JSON.parse(await readFile(resolve(ROOT, 'telemetry-worker/wrangler.jsonc'), 'utf8'));
  if (raw.name !== 'lan-cloudinary-telemetry') throw Error('Refusing noncanonical Worker config.');
  const binds = raw.kv_namespaces || [];
  const names = ['STORAGE_OAUTH', 'PORTFOLIO_MESSAGES'];
  const result = names.map(binding => {
    const found = binds.filter(x => x.binding === binding);
    if (found.length !== 1 || !/^[0-9a-f]{32}$/i.test(found[0].id || '')) throw Error('KV binding identity contract invalid.');
    return { binding, id: found[0].id };
  });
  if (binds.length !== 2 || result[0].id === result[1].id) throw Error('Unexpected KV namespace binding set.');
  return result;
}
function backupLocation(supplied) {
  if (!supplied || !isAbsolute(supplied)) throw Error('Backup path must be absolute.');
  const path = resolve(supplied);
  const rel = relative(ROOT, path);
  if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) {
    throw Error('Encrypted backup must be outside the source repository.');
  }
  return path;
}
function keyFor(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw Error('A private passphrase of at least 16 characters is required.');
  return scryptSync(passphrase, salt, 32, KDF);
}
async function writeAll(fh, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await fh.write(bytes, offset, bytes.length - offset, null);
    if (!bytesWritten) throw Error('Encrypted local write failed.');
    offset += bytesWritten;
  }
}
function lineBytes(value) { return Buffer.from(JSON.stringify(value) + '\n', 'utf8'); }

export async function makeVault(output, passphrase, namespaces, readKeys, readValue) {
  const dest = backupLocation(output);
  const tmp = dest + '.incomplete-' + randomBytes(12).toString('hex');
  const fh = await open(tmp, 'wx', 0o600);
  let closed = false;
  try {
    const salt = randomBytes(16), nonce = randomBytes(12);
    const header = { format: 1, createdAt: new Date().toISOString(), namespaces, salt: salt.toString('base64'), nonce: nonce.toString('base64') };
    const headerBytes = Buffer.from(JSON.stringify(header));
    if (headerBytes.length > 4096) throw Error('Backup header too large.');
    const size = Buffer.alloc(4); size.writeUInt32BE(headerBytes.length);
    await writeAll(fh, MAGIC); await writeAll(fh, size); await writeAll(fh, headerBytes);
    const cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), nonce);
    cipher.setAAD(Buffer.concat([MAGIC, size, headerBytes]));
    const digest = createHash('sha256');
    const counts = {};
    const submit = async (obj, hash = true) => {
      const plain = lineBytes(obj);
      if (hash) digest.update(plain);
      await writeAll(fh, cipher.update(plain));
    };
    for (const { binding, id } of namespaces) {
      const keys = await readKeys(id);
      if (!Array.isArray(keys) || keys.length > MAX_RECORDS) throw Error('KV inventory incomplete or exceeds safe limit.');
      const used = new Set();
      counts[binding] = 0;
      for (const item of keys) {
        if (typeof item.name !== 'string' || used.has(item.name)) throw Error('KV inventory contains an invalid or duplicate name.');
        used.add(item.name);
        const bytes = await readValue(id, item.name);
        if (!Buffer.isBuffer(bytes) || bytes.length > MAX_VALUE_BYTES) throw Error('KV value missing or exceeds safe limit.');
        await submit({ kind: 'kv', binding, name: item.name, valueBase64: bytes.toString('base64'), expiration: item.expiration ?? null, metadata: item.metadata ?? null });
        counts[binding]++;
      }
    }
    await submit({ kind: 'manifest', counts, sha256: digest.digest('hex') }, false);
    await writeAll(fh, cipher.final());
    await writeAll(fh, cipher.getAuthTag());
    await fh.sync(); await fh.close(); closed = true;
    // Authenticate the local file before atomically exposing the final path.
    const verified = await inspectVault(tmp, passphrase, namespaces);
    for (const ns of namespaces) if (verified.counts[ns.binding] !== counts[ns.binding]) throw Error('Backup verification count mismatch.');
    // Hard link is atomic and fails if final path exists (never overwrite).
    await link(tmp, dest);
    await unlink(tmp);
    return { counts, path: dest, verified: true };
  } catch (error) {
    if (!closed) await fh.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function readExact(fh, bytes, offset) {
  const b = Buffer.alloc(bytes); let done = 0;
  while (done < bytes) {
    const r = await fh.read(b, done, bytes - done, offset + done);
    if (!r.bytesRead) throw Error('Truncated encrypted backup.');
    done += r.bytesRead;
  }
  return b;
}
export async function inspectVault(input, passphrase, expectedNamespaces) {
  const path = backupLocation(input);
  const fh = await open(path, 'r');
  let dataStart, fileSize, header, decipher;
  try {
    const info = await fh.stat(); fileSize = info.size;
    if (!info.isFile() || fileSize < 50) throw Error('Backup is missing or truncated.');
    const magic = await readExact(fh, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw Error('Invalid backup format.');
    const size = await readExact(fh, 4, MAGIC.length), len = size.readUInt32BE();
    if (!len || len > 4096) throw Error('Invalid backup header size.');
    const bytes = await readExact(fh, len, MAGIC.length + 4);
    header = JSON.parse(bytes.toString('utf8'));
    if (header.format !== 1 || JSON.stringify(header.namespaces) !== JSON.stringify(expectedNamespaces)) {
      throw Error('Backup KV namespace identities do not match the canonical source.');
    }
    dataStart = MAGIC.length + 4 + len;
    if (fileSize <= dataStart + 16) throw Error('Encrypted backup has no records.');
    const tag = await readExact(fh, 16, fileSize - 16);
    decipher = createDecipheriv('aes-256-gcm', keyFor(passphrase, Buffer.from(header.salt, 'base64')), Buffer.from(header.nonce, 'base64'));
    decipher.setAAD(Buffer.concat([magic, size, bytes]));
    decipher.setAuthTag(tag);
  } finally { await fh.close(); }
  const counts = Object.fromEntries(expectedNamespaces.map(n => [n.binding, 0]));
  const known = Object.fromEntries(expectedNamespaces.map(n => [n.binding, new Set()]));
  const digest = createHash('sha256');
  const utf8 = new StringDecoder('utf8');
  let pending = '', footer = null, total = 0;
  function handleLine(line) {
    if (!line) throw Error('Unexpected empty encrypted record.');
    const entry = JSON.parse(line);
    if (entry.kind === 'manifest') {
      if (footer) throw Error('Duplicate encrypted manifest.');
      footer = entry;
      return;
    }
    if (entry.kind !== 'kv' || footer || !(entry.binding in counts) || typeof entry.name !== 'string' ||
        typeof entry.valueBase64 !== 'string' || known[entry.binding].has(entry.name)) throw Error('Unexpected/duplicate encrypted KV record.');
    known[entry.binding].add(entry.name);
    digest.update(Buffer.from(line + '\n'));
    counts[entry.binding]++;
    if (++total > MAX_RECORDS * expectedNamespaces.length) throw Error('Too many KV records.');
  }
  function processChunk(chunk) {
    pending += utf8.write(chunk);
    let eol;
    while ((eol = pending.indexOf('\n')) !== -1) {
      handleLine(pending.slice(0, eol));
      pending = pending.slice(eol + 1);
    }
    if (pending.length > MAX_VALUE_BYTES * 2) throw Error('Unbounded encrypted record.');
  }
  try {
    for await (const block of createReadStream(path, { start: dataStart, end: fileSize - 17 })) processChunk(decipher.update(block));
    processChunk(decipher.final());
    pending += utf8.end();
    if (pending !== '' || !footer || JSON.stringify(footer.counts) !== JSON.stringify(counts) ||
        footer.sha256 !== digest.digest('hex')) throw Error('Encrypted manifest mismatch.');
    return { counts, verified: true };
  } catch {
    throw Error('Encrypted KV backup integrity verification failed (wrong passphrase, changed source, or corrupt/incomplete file).');
  }
}
export async function cloudflareReader(accountId, token) {
  if (!/^[0-9a-f]{32}$/i.test(accountId || '') || !token) throw Error('Read-only Cloudflare account ID/token environment not configured.');
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/storage/kv/namespaces/';
  async function get(url, binary = false) {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw Error('Cloudflare KV READ failed: HTTP ' + response.status + ' (no data printed).');
    if (binary) {
      if (Number(response.headers.get('content-length') || 0) > MAX_VALUE_BYTES) throw Error('KV value exceeds safe size.');
      return Buffer.from(await response.arrayBuffer());
    }
    const value = await response.json();
    if (value.success !== true) throw Error('Cloudflare KV inventory denied/incomplete.');
    return value;
  }
  async function readKeys(id) {
    const records = [], seenCursors = new Set();
    let cursor = '';
    do {
      const url = new URL(base + id + '/keys');
      url.searchParams.set('limit', '1000');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await get(url);
      if (!Array.isArray(response.result)) throw Error('KV inventory was not a list.');
      records.push(...response.result);
      if (records.length > MAX_RECORDS) throw Error('KV inventory exceeds safe limit.');
      cursor = response.result_info?.cursor || '';
      if (cursor && seenCursors.has(cursor)) throw Error('KV pagination repeated.');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return records;
  }
  const readValue = async (id, name) => get(base + id + '/values/' + encodeURIComponent(name), true);
  return { readKeys, readValue };
}
async function privatePrompt(label) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw Error('Run in a local interactive terminal; never pass backup passwords via arguments or CI.');
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const end = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      for (const c of String(chunk)) {
        if (c === '\r' || c === '\n') return end();
        if (c === '\u0003') return end(Error('Canceled.'));
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ' && value.length < 256) value += c;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
async function cli() {
  const [command, option, filename, ...extra] = process.argv.slice(2);
  if (extra.length || !['backup','verify'].includes(command) ||
      option !== (command === 'backup' ? '--output' : '--input')) throw Error('Usage: backup --output ABS_PATH | verify --input ABS_PATH');
  const namespaces = await canonicalNamespaces();
  const passphrase = await privatePrompt('Private KV backup passphrase (hidden, 16+ chars): ');
  if (command === 'verify') {
    const status = await inspectVault(filename, passphrase, namespaces);
    console.log('PASS: encrypted Cloudflare KV snapshot integrity. Counts: ' + JSON.stringify(status.counts));
    return;
  }
  const second = await privatePrompt('Repeat private passphrase (hidden): ');
  if (passphrase !== second) throw Error('Passphrases do not match.');
  keyFor(passphrase, randomBytes(16));
  const reader = await cloudflareReader(process.env.LAN_CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
  const result = await makeVault(filename, passphrase, namespaces, reader.readKeys, reader.readValue);
  console.log('PASS: read-only Cloudflare KV backup written and integrity verified. Counts: ' + JSON.stringify(result.counts));
  console.log('Keep encrypted archive outside GitHub and passphrase separately. Source KV was not changed.');
}
// Publish ONLY stable, non-sensitive diagnostic categories. Never print raw
// provider responses, URLs with query strings, process env, passphrases,
// archive contents, key names, metadata, values, or arbitrary Error.messages.
export function safeBackupFailureCode(error) {
  const message = String(error?.message || '');
  const http = message.match(/^Cloudflare KV READ failed: HTTP (\d{3}) /);
  if (http) return 'CLOUDFLARE_KV_READ_HTTP_' + http[1];
  if (message === 'Passphrases do not match.') return 'PASSPHRASE_CONFIRMATION_MISMATCH';
  if (message.includes('private passphrase of at least 16 characters')) return 'PASSPHRASE_TOO_SHORT';
  if (message.includes('Cloudflare account ID/token environment not configured')) return 'CLOUDFLARE_ACCOUNT_OR_TOKEN_MISSING';
  if (message.includes('Encrypted KV backup integrity verification failed')) return 'ARCHIVE_INTEGRITY_OR_PASSPHRASE_INVALID';
  if (message.includes('KV inventory') || message.includes('KV pagination') ||
      message.includes('KV value missing')) return 'CLOUDFLARE_KV_INCOMPLETE_READ';
  if (error?.code === 'EEXIST') return 'LOCAL_ARCHIVE_ALREADY_EXISTS';
  if (error?.code === 'ENOENT') return 'LOCAL_DIRECTORY_OR_FILE_MISSING';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'LOCAL_FILE_PERMISSION_DENIED';
  if (message.includes('Backup path must be absolute') ||
      message.includes('Encrypted backup must be outside')) return 'UNSAFE_BACKUP_PATH';
  if (message.includes('interactive terminal')) return 'INTERACTIVE_TERMINAL_REQUIRED';
  return 'OTHER_LOCAL_OR_NETWORK_ERROR';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => {
    console.error('HOLD: ' + safeBackupFailureCode(error) + '. Cloudflare KV was not modified.');
    console.error('Never share backup passwords, API tokens, file contents or OAuth values.');
    process.exitCode = 1;
  });
}
