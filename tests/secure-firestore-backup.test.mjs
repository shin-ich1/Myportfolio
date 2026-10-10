import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT, enumerateFirestore, createEncryptedBackup, verifyEncryptedBackup
} from '../scripts/secure-firestore-backup.mjs';

const passphrase = 'local synthetic TEST only: long phrase 1234';
const base = 'projects/' + PROJECT + '/databases/(default)/documents';
const resource = name => ({ name, fields: { greeting: { stringValue: 'synthetic private-looking test' },
  count: { integerValue: '123' }, timestamp: { timestampValue: '2026-10-10T02:34:56Z' } },
  createTime: '2026-10-10T02:34:56Z', updateTime: '2026-10-10T02:34:57Z' });

function fixtureRequest({ unknown = false, repeatedPage = false } = {}) {
  const seen = [];
  const requests = async (method, path, body) => {
    seen.push({ method, path, body });
    assert.ok(['GET','POST'].includes(method), 'Must never write to production');
    if (path === base + ':listCollectionIds')
      return { collectionIds: unknown ? ['authorizedAdministrators','someUnreviewedCollection'] :
        ['authorizedAdministrators','portfolio','privateMessageThreads'] };
    if (path === base + '/authorizedAdministrators?pageSize=100&showMissing=true')
      return { documents: [resource(base + '/authorizedAdministrators/admin-1')] };
    if (path === base + '/portfolio?pageSize=100&showMissing=true')
      return { documents: [resource(base + '/portfolio/home')], nextPageToken: 'page2' };
    if (path === base + '/portfolio?pageSize=100&showMissing=true&pageToken=page2')
      return { documents: [resource(base + '/portfolio/contact')],
        nextPageToken: repeatedPage ? 'page2' : '' };
    if (path === base + '/privateMessageThreads?pageSize=100&showMissing=true')
      return { documents: [resource(base + '/privateMessageThreads/thread-1')] };
    if (path === base + '/privateMessageThreads/thread-1:listCollectionIds')
      return { collectionIds: ['messages'] };
    if (path === base + '/privateMessageThreads/thread-1/messages?pageSize=100&showMissing=true')
      return { documents: [resource(base + '/privateMessageThreads/thread-1/messages/msg-1')] };
    if (path.endsWith(':listCollectionIds'))
      return { collectionIds: [] };
    assert.fail('Unexpected synthetic Firestore URL: ' + path);
  };
  return { requests, seen };
}

test('enumerator recursively reads typed REST documents and paginates without writes', async () => {
  const mock = fixtureRequest();
  const names = [];
  const result = await enumerateFirestore(mock.requests, PROJECT, async row => {
    names.push(row.document.name);
    assert.equal(row.type, 'document');
    assert.equal(row.document.fields.count.integerValue, '123');
    assert.ok(row.document.createTime);
  });
  assert.equal(result.records, 5);
  assert.equal(result.rootCollections.length, 3);
  assert.ok(names.some(s => s.endsWith('/privateMessageThreads/thread-1/messages/msg-1')));
  assert.ok(mock.seen.every(x => x.method === 'GET' || x.path.endsWith(':listCollectionIds')));
});

test('unknown root collection fails closed instead of silently creating incomplete export', async () => {
  const mock = fixtureRequest({ unknown: true });
  await assert.rejects(enumerateFirestore(mock.requests, PROJECT, async () => {}),
    /Unreviewed root collections/);
});

test('pagination loop fails closed instead of silently missing documents', async () => {
  const mock = fixtureRequest({ repeatedPage: true });
  await assert.rejects(enumerateFirestore(mock.requests, PROJECT, async () => {}),
    /pagination loop/);
});

test('export encrypts every document before disk; verify parses no plaintext outputs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lan-fb-synthetic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'backup.lanfbak');
  const mock = fixtureRequest();
  const created = await createEncryptedBackup({ output, request: mock.requests, passphrase });
  assert.equal(created.records, 5);
  const file = await readFile(output);
  assert.match(file.subarray(0, 64).toString(), /LAN-FIRESTORE-ENCRYPTED-V1/);
  assert.equal(file.includes(Buffer.from('synthetic private-looking test')), false);
  assert.equal(file.includes(Buffer.from('admin-1')), false);
  assert.equal(file.includes(Buffer.from('masterKeyHash')), false);
  const verified = await verifyEncryptedBackup({ input: output, passphrase });
  assert.deepEqual(verified, { verified: true, records: 5, rootCollectionCount: 3 });
  await assert.rejects(createEncryptedBackup({
    output, request: mock.requests, passphrase
  }), /EEXIST/);
  const files = await readdir(dir);
  assert.deepEqual(files, ['backup.lanfbak'], 'No partial or plaintext file remains.');
});

test('wrong passphrase and tampering reject offline verification without exposing records', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lan-fb-synthetic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'backup.lanfbak');
  const mock = fixtureRequest();
  await createEncryptedBackup({ output, request: mock.requests, passphrase });
  await assert.rejects(verifyEncryptedBackup({
    input: output, passphrase: 'different-long-test-passphrase-12345'
  }));
  const bytes = await readFile(output);
  bytes[bytes.length - 1] ^= 0x02;
  const altered = join(dir, 'altered.lanfbak');
  await writeFile(altered, bytes, { mode: 0o600 });
  await assert.rejects(verifyEncryptedBackup({ input: altered, passphrase }));
});

test('production-only and storage location gates prevent accidental script misuse', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lan-fb-synthetic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mock = fixtureRequest();
  await assert.rejects(enumerateFirestore(mock.requests, 'lan-portfolio-staging', async () => {}),
    /unexpected Firebase project/);
  await assert.rejects(createEncryptedBackup({
    output: join(dir, 'test.lanfbak'), request: mock.requests, passphrase:'too short'
  }), /at least 24 characters/);
  await assert.rejects(createEncryptedBackup({
    output: 'backup.lanfbak', request: mock.requests, passphrase
  }), /absolute/);
});
