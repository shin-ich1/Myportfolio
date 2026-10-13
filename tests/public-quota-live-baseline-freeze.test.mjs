import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const baseline = '2cc642e1190469dbe8ee77f130413dae09f1ab6d';
const baselineBlob = 'f156424e6adf216da6660648dc634319e340aa4a';
const reviewedBlob = '6971fde459ea2b59fc4868cae37bade0232e8765';
const repo = new URL('../', import.meta.url);
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const original = execFileSync('git', ['show', baseline + ':app.js'], { cwd: repo, encoding: 'utf8' }).replace(/\r\n/g, '\n');

function gitBlob(text) {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}
function maskCapabilityOwner(text) {
  const start = 'async function loadPublicCapabilities(';
  const stop = '\nasync function initFirebase(';
  const a = text.indexOf(start);
  const b = text.indexOf(stop, a);
  assert.ok(a >= 0 && b > a, 'Canonical capability owner exists');
  assert.equal(text.indexOf(start, a + 1), -1, 'Canonical capability owner is unique');
  return text.slice(0, a) + '[REVIEWED CAPABILITY OWNER]' + text.slice(b);
}
function maskSingleCaller(text) {
  const pattern = /^  await loadPublicCapabilities\([^;\n]*\);$/gm;
  assert.equal([...text.matchAll(pattern)].length, 1, 'One canonical Public capability consumer');
  return text.replace(pattern, '  [REVIEWED CAPABILITY CALL]');
}

test('Public live baseline remains byte-for-byte frozen outside one loader and one consumer', () => {
  assert.equal(gitBlob(original), baselineBlob, 'Wrong Production Public baseline');
  assert.equal(gitBlob(source), reviewedBlob, 'Reviewed isolated release candidate drifted');
  assert.equal(
    maskSingleCaller(maskCapabilityOwner(source)),
    maskSingleCaller(maskCapabilityOwner(original)),
    'Unrelated Public structure, messaging, styling or behavior changed'
  );
});
test('Approved loader does not reintroduce per-reference Firestore fallback', () => {
  const start = source.indexOf('async function loadPublicCapabilities(');
  const end = source.indexOf('\nasync function initFirebase(', start);
  const loader = source.slice(start, end);
  assert.match(loader, /Promise\.allSettled\(/);
  assert.match(loader, /firebase\.getDocs\(/);
  assert.doesNotMatch(loader, /firebase\.getDoc\(/);
  assert.doesNotMatch(loader, /const missing = \[/);
  assert.match(source, /^  await loadPublicCapabilities\(\);$/m);
});