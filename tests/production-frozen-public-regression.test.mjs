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

test('Production frozen Public messaging and layout assets retain exact live source identities', () => {
  const expected = {
    'app.js': '6971fde459ea2b59fc4868cae37bade0232e8765',
    'styles.css': 'ec2f4078616f7435a5c9cc1a646fa44eb9db5f4c',
    'message-service.js': '764a353722a63067b0335f80c17c09fbbfc00a06',
    'index.html': 'ba6b29cd5d2a84286850022f9f7ef075df5a73a5'
  };
  for (const [path, sha] of Object.entries(expected)) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url));
    const blob = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
    assert.equal(blob, sha, 'Exact already-published Public asset must not drift: ' + path);
  }
});
test('Backend retains mandatory independent challenge, Siteverify and server-authenticated security boundaries', () => {
  const worker = readFileSync(new URL('../telemetry-worker/src/index.js', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(source, /const turnstileToken = await runTurnstile\(\)/);
  assert.match(source, /verifyPrivateMessageChallenge\(\{[\s\S]*?answer:[\s\S]*?turnstileToken/);
  assert.match(worker, /async function verifyTurnstile\(request, env, token\)/);
  assert.match(worker, /result\?\.success !== true/);
  assert.match(worker, /String\(result\.hostname \|\| ""\)\.toLowerCase\(\) !== config\.host/);
  assert.match(worker, /String\(result\.action \|\| ""\) !== PRIVATE_MESSAGE_ACTION/);
  assert.match(rules, /function isAdministrator\(\)\s*\{\s*return hasSecurityApprovedSession\(\) && hasAdministratorRecord\(\);/);
});
