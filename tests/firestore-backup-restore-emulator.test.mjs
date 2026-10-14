/**
 * Synthetic-only backup restore rehearsal in a local Firestore emulator.
 * Absolutely no production network calls, credentials, backups, or real UIDs.
 * This is NOT a production restore utility and does NOT verify the owner's
 * private production archive or Firebase Authentication/Cloudflare recovery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, Timestamp, Bytes, GeoPoint
} from 'firebase/firestore';
import {
  PROJECT, createEncryptedBackup, verifyEncryptedBackup
} from '../scripts/secure-firestore-backup.mjs';

const allowedEmulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!allowedEmulator || !/^(localhost|127\.0\.0\.1):\d+$/.test(allowedEmulator)) {
  throw Error('Restore rehearsal is emulator-only. Refusing all real Firebase connections.');
}
const [host, port] = allowedEmulator.split(':');
const testProject = 'lan-security-rules-emulator-only';
const prefix = 'projects/' + PROJECT + '/databases/(default)/documents';
const passphrase = 'synthetic-rehearsal-passphrase-only-2026!';
const r = (path, fields) => ({
  name: prefix + '/' + path, fields,
  createTime: '2026-10-10T00:00:00Z',
  updateTime: '2026-10-10T00:01:00Z'
});
const fixture = new Map([
  ['authorizedAdministrators', [r('authorizedAdministrators/synthetic-backup-test-admin',
    { active: { booleanValue: true } })]],
  ['adminSecurityRecovery', [r('adminSecurityRecovery/synthetic-backup-test-admin',
    { active: { booleanValue: true }, masterKeyHash: { stringValue: 'SYNTHETIC-NONSECRET-ONLY' } })]],
  ['portfolio', [r('portfolio/synthetic-backup-test-home', {
    greeting: { stringValue: 'Synthetic résumé – Γειά' },
    count: { integerValue: '42' },
    fractional: { doubleValue: 3.25 },
    published: { booleanValue: true },
    schedule: { timestampValue: '2026-10-10T12:34:56Z' },
    nested: { mapValue: { fields: {
      tags: { arrayValue: { values: [{ stringValue: 'one' }, { nullValue: null }] } },
      enabled: { booleanValue: false }
    } } },
    icon: { bytesValue: Buffer.from('test-binary').toString('base64') },
    place: { geoPointValue: { latitude: 14.2, longitude: 121.1 } }
  })]],
  ['privateMessageThreads', [r('privateMessageThreads/synthetic-backup-test-thread',
    { topic: { stringValue: 'emulator only' } })]],
  ['privateMessageThreads/synthetic-backup-test-thread/messages',
    [r('privateMessageThreads/synthetic-backup-test-thread/messages/synthetic-message',
      { text: { stringValue: 'Only a fixture' }, isRead: { booleanValue: false } })]]
]);

async function syntheticFirestoreRead(method, path, body) {
  assert.ok(['GET', 'POST'].includes(method), 'Backups never use Firestore writes');
  assert.ok(path.startsWith(prefix), 'Must use designated source identity');
  if (path.endsWith(':listCollectionIds')) {
    const parent = path.slice(0, -':listCollectionIds'.length);
    if (parent === prefix)
      return { collectionIds: ['authorizedAdministrators', 'adminSecurityRecovery', 'portfolio', 'privateMessageThreads'] };
    if (parent === prefix + '/privateMessageThreads/synthetic-backup-test-thread')
      return { collectionIds: ['messages'] };
    return { collectionIds: [] };
  }
  const url = path.split('?');
  assert.ok(url[1] === 'pageSize=100&showMissing=true', 'Unexpected pagination in static fixture.');
  const name = url[0].slice(prefix.length + 1);
  assert.ok(fixture.has(name), 'An unexpected collection would be an incomplete rehearsal.');
  return { documents: fixture.get(name) };
}

function parseSyntheticArchive(bytes, secret) {
  const magic = 'LAN-FIRESTORE-ENCRYPTED-V1\n';
  assert.equal(bytes.subarray(0, magic.length).toString(), magic);
  const split = bytes.indexOf(10, magic.length);
  const h = JSON.parse(bytes.subarray(magic.length, split).toString('utf8'));
  assert.equal(h.project, PROJECT);
  const salt = Buffer.from(h.salt, 'base64');
  const nonce = Buffer.from(h.nonce, 'base64');
  const k = scryptSync(secret, salt, 32, { N: h.N, r: h.r, p: h.p, maxmem: 268435456 });
  const decipher = createDecipheriv('aes-256-gcm', k, nonce);
  k.fill(0);
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(split + 1, bytes.length - 16)),
    decipher.final()
  ]).toString('utf8');
  return plaintext.trimEnd().split('\n').map(line => JSON.parse(line));
}

function typed(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) {
    const value = Number(v.integerValue);
    assert.ok(Number.isSafeInteger(value), 'Unsupported unsafe integer requires reviewed restore');
    return value;
  }
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Timestamp.fromDate(new Date(v.timestampValue));
  if ('bytesValue' in v) return Bytes.fromBase64String(v.bytesValue);
  if ('geoPointValue' in v) return new GeoPoint(
    v.geoPointValue.latitude, v.geoPointValue.longitude);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(typed);
  if ('mapValue' in v)
    return Object.fromEntries(Object.entries(v.mapValue.fields || {})
      .map(([key, value]) => [key, typed(value)]));
  throw Error('Unsupported Firestore type in synthetic rehearsal.');
}

test('synthetic encrypted export can be authenticated and recovered in isolated Firestore emulator only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lan-backup-rehearsal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = join(directory, 'synthetic-encrypted.lanfbak');
  const created = await createEncryptedBackup({
    output: archive, request: syntheticFirestoreRead, passphrase
  });
  assert.equal(created.records, 5);
  assert.deepEqual(await verifyEncryptedBackup({ input: archive, passphrase }), {
    verified: true, records: 5, rootCollectionCount: 4
  });

  // Only synthetic data ever crosses into the isolated emulator.
  const rows = parseSyntheticArchive(await readFile(archive), passphrase);
  const dataRows = rows.filter(x => x.type === 'document');
  assert.equal(dataRows.length, 5);
  assert.equal(rows.at(-1).type, 'manifest');

  const env = await initializeTestEnvironment({
    projectId: testProject,
    firestore: { host, port: Number(port),
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
  try {
    await env.withSecurityRulesDisabled(async superuser => {
      const db = superuser.firestore();
      for (const row of dataRows) {
        const path = row.document.name.slice(prefix.length + 1);
        assert.ok(path.includes('synthetic-') || path.includes('synthetic'),
          'No non-synthetic Firestore resources can enter this test.');
        const fields = Object.fromEntries(
          Object.entries(row.document.fields).map(([key, val]) => [key, typed(val)])
        );
        await setDoc(doc(db, path), fields);
      }

      const home = (await getDoc(doc(db, 'portfolio', 'synthetic-backup-test-home'))).data();
      assert.equal(home.greeting, 'Synthetic résumé – Γειά');
      assert.equal(home.count, 42);
      assert.equal(home.fractional, 3.25);
      assert.equal(home.published, true);
      assert.equal(home.schedule.toDate().toISOString(), '2026-10-10T12:34:56.000Z');
      assert.deepEqual(home.nested.tags, ['one', null]);
      assert.equal(home.nested.enabled, false);
      assert.equal(Buffer.from(home.icon.toUint8Array()).toString('utf8'), 'test-binary');
      assert.equal(home.place.latitude, 14.2);
      assert.equal(home.place.longitude, 121.1);
      const message = (await getDoc(doc(db, 'privateMessageThreads',
        'synthetic-backup-test-thread', 'messages', 'synthetic-message'))).data();
      assert.equal(message.text, 'Only a fixture');
      assert.equal(message.isRead, false);
      const recovery = (await getDoc(doc(db,
        'adminSecurityRecovery', 'synthetic-backup-test-admin'))).data();
      assert.equal(recovery.masterKeyHash, 'SYNTHETIC-NONSECRET-ONLY');
    });
    // Backend-owned recovery remains inaccessible to unauthenticated clients.
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),
      'adminSecurityRecovery', 'synthetic-backup-test-admin')));
  } finally {
    await env.cleanup();
  }
});
