import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareStaging } from '../scripts/prepare-staging.mjs';

const syntheticWebApiKey = 'AIza' + 'A'.repeat(35);
const buildFixture = root => prepareStaging({ root, firebaseWebApiKey: syntheticWebApiKey });
const sourceConfig = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../storage-bridge-url.js', import.meta.url), 'utf8');
const sourceHosting = await readFile(new URL('../firebase.json', import.meta.url), 'utf8');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lan-staging-test-'));
  const files = {
    'config.js': sourceConfig,
    'storage-bridge-url.js': bridgeSource,
    'firebase.json': sourceHosting,
    'index.html': '<!doctype html><title>Staging fixture</title>',
    'admin/index.html': '<!doctype html><title>Admin login</title>',
    'admin/pages/home.html': '<!doctype html><title>Home</title>',
    'assets/example.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  return root;
}

test('staging build pins Firebase, Worker, and Hosting without editing source or copying untracked files', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'firebase-debug.log'), 'do not publish');
    await writeFile(path.join(root, '.dev.vars'), 'PRIVATE_KEY=do-not-publish');
    const result = await buildFixture(root);
    assert.equal(result.firebaseProjectId, 'lan-portfolio-staging');
    assert.equal(result.workerName, 'lan-portfolio-staging');
    assert.ok(result.copiedFiles >= 5);
    assert.equal(await readFile(path.join(root, 'config.js'), 'utf8'), sourceConfig);
    const siteConfig = await readFile(path.join(root, '.lan-staging/site/config.js'), 'utf8');
    assert.match(siteConfig, /projectId:\s*"lan-portfolio-staging"/);
    assert.match(siteConfig, new RegExp(syntheticWebApiKey));
    const manifest = JSON.parse(await readFile(new URL('../scripts/staging-targets.json', import.meta.url), 'utf8'));
    assert.equal(Object.hasOwn(manifest.firebase, 'apiKey'), false);
    const workerConfig = JSON.parse(await readFile(path.join(root, 'telemetry-worker/wrangler.staging.jsonc'), 'utf8'));
    assert.equal(workerConfig.vars.FIREBASE_WEB_API_KEY, undefined);
    assert.deepEqual(workerConfig.durable_objects.bindings, [
      { name: 'SECURITY_COORDINATOR', class_name: 'SecurityCoordinator' }
    ]);
    assert.equal(workerConfig.exports.SecurityCoordinator.storage, 'sqlite');
    assert.ok(workerConfig.kv_namespaces.every(item => item.binding !== 'SECURITY_STATE'),
      'old security KV owner must not be bound');
    assert.match(siteConfig, /enforceConfiguredBridge:\s*true/);
    assert.match(siteConfig, /cloudName:\s*""/);
    assert.match(siteConfig, /uploadPreset:\s*""/);
    assert.match(siteConfig, /lan-portfolio-staging\.lagmayr2\.workers\.dev/);
    assert.doesNotMatch(siteConfig, /rolando-portfolio-3f1a3|lan-cloudinary-telemetry\.lagmayr2\.workers\.dev/);
    const hosting = JSON.parse(await readFile(path.join(root, '.lan-staging/firebase.json'), 'utf8'));
    assert.equal(hosting.hosting.public, 'site');
    assert.equal(hosting.firestore, undefined);
    assert.equal(hosting.storage, undefined);
    assert.equal(JSON.parse(await readFile(path.join(root, '.lan-staging/.firebaserc'), 'utf8')).projects.default, 'lan-portfolio-staging');
    for (const name of ['firebase-debug.log', '.dev.vars', 'telemetry-worker/wrangler.jsonc', 'scripts/prepare-staging.mjs']) {
      await assert.rejects(readFile(path.join(root, '.lan-staging/site', name)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical bridge rejects a saved production override on a staging build', async () => {
  const root = await fixture();
  const previousLocation = globalThis.location;
  const previousStorage = globalThis.localStorage;
  try {
    await buildFixture(root);
    globalThis.location = { protocol: 'https:', hostname: 'lan-portfolio-staging.web.app', href: 'https://lan-portfolio-staging.web.app/' };
    globalThis.localStorage = { getItem: () => 'https://lan-cloudinary-telemetry.lagmayr2.workers.dev/telemetry' };
    const bridge = await import(pathToFileURL(path.join(root, '.lan-staging/site/storage-bridge-url.js')).href);
    assert.equal(bridge.configuredStorageBridgeUrl(), 'https://lan-portfolio-staging.lagmayr2.workers.dev/telemetry');
    assert.equal(bridge.storageBridgeOrigin(), 'https://lan-portfolio-staging.lagmayr2.workers.dev');
  } finally {
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
    await rm(root, { recursive: true, force: true });
  }
});

test('staging build fails closed if any published asset still references production backend', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'admin/pages/home.html'), '<script>fetch("https://lan-cloudinary-telemetry.lagmayr2.workers.dev")</script>');
    await assert.rejects(buildFixture(root), /Production reference detected/);
    await assert.rejects(readFile(path.join(root, '.lan-staging/firebase.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staging build rejects a wrong-worker binding before preparing publishable assets', async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, 'telemetry-worker'), { recursive: true });
    await writeFile(path.join(root, 'telemetry-worker/wrangler.staging.jsonc'), JSON.stringify({
      name: 'lan-portfolio-staging', main: 'src/index.js',
      kv_namespaces: [{ binding: 'SECURITY_STATE', id: 'production-kv-id' }],
      vars: { FIREBASE_PROJECT_ID: 'lan-portfolio-staging' }
    }));
    await assert.rejects(buildFixture(root), /Unrecognized old staging security KV binding/);
    await assert.rejects(readFile(path.join(root, '.lan-staging/firebase.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staging build refuses missing web API key and never emits deployable artifacts', async () => {
  const root = await fixture();
  try {
    await assert.rejects(prepareStaging({ root, firebaseWebApiKey: '' }), /LAN_STAGING_FIREBASE_WEB_API_KEY/);
    await assert.rejects(readFile(path.join(root, '.lan-staging/firebase.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staging Worker config migrates old web API key out of Wrangler vars', async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, 'telemetry-worker'), { recursive: true });
    const targets = JSON.parse(await readFile(new URL('../scripts/staging-targets.json', import.meta.url), 'utf8'));
    await writeFile(path.join(root, 'telemetry-worker/wrangler.staging.jsonc'), JSON.stringify({
      name: targets.worker.name,
      main: 'src/index.js',
      kv_namespaces: [
        ...Object.entries(targets.worker.kvNamespaces).map(([binding, id]) => ({ binding, id })),
        // Known retired staging-only namespace from the previous builder.
        { binding: 'SECURITY_STATE', id: '24224266caf94e6ebe5ba8c8e9010873' }
      ],
      vars: { FIREBASE_PROJECT_ID: targets.firebase.projectId, FIREBASE_WEB_API_KEY: syntheticWebApiKey }
    }));
    await buildFixture(root);
    const cfg = JSON.parse(await readFile(path.join(root, 'telemetry-worker/wrangler.staging.jsonc'), 'utf8'));
    assert.equal(cfg.vars.FIREBASE_WEB_API_KEY, undefined);
    assert.ok(cfg.kv_namespaces.every(item => item.binding !== 'SECURITY_STATE'));
    assert.equal(cfg.exports.SecurityCoordinator.storage, 'sqlite');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staging builder rejects a substituted Durable Object owner before writing output', async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, 'telemetry-worker'), { recursive: true });
    const targets = JSON.parse(await readFile(new URL('../scripts/staging-targets.json', import.meta.url), 'utf8'));
    await writeFile(path.join(root, 'telemetry-worker/wrangler.staging.jsonc'), JSON.stringify({
      name: targets.worker.name, main: 'src/index.js',
      kv_namespaces: Object.entries(targets.worker.kvNamespaces).map(([binding, id]) => ({ binding, id })),
      durable_objects: { bindings: [{ name: 'SECURITY_COORDINATOR', class_name: 'UntrustedOtherClass' }] },
      vars: { FIREBASE_PROJECT_ID: targets.firebase.projectId }
    }));
    await assert.rejects(buildFixture(root), /Durable Object configuration mismatch/);
    await assert.rejects(readFile(path.join(root, '.lan-staging/firebase.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
