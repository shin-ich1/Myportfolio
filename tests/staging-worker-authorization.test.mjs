import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../telemetry-worker/src/index.js';

// Exercise canonical Worker in-process. No credentials, Google APIs, or network used.
const workerUrl = 'https://lan-portfolio-staging.lagmayr2.workers.dev';
const stagingOrigin = 'https://lan-portfolio-staging.web.app';
const productionOrigin = 'https://rolando-portfolio-3f1a3.web.app';
const env = Object.freeze({ FIREBASE_PROJECT_ID: 'lan-portfolio-staging' });

async function callWorker(path, { method = 'GET', origin = stagingOrigin, auth = '', body } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(workerUrl + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await worker.fetch(request, env, { waitUntil() {} });
  const result = await response.json().catch(() => null);
  return { response, result };
}

test('canonical Worker /health reports unconfigured integrations without disclosing credentials', async () => {
  const { response, result } = await callWorker('/health');
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.firebaseConfigured, true);
  assert.equal(result.messageSecurityConfigured, false);
  assert.equal(result.storageOAuthConfigured, false);
  assert.equal(result.googleDriveOAuthConfigured, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), stagingOrigin);
  assert.ok(!JSON.stringify(result).includes('FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY'));
});

test('canonical Worker rejects a production origin for staging Security & Access', async () => {
  const { response, result } = await callWorker('/security/session/validate', { origin: productionOrigin });
  assert.equal(response.status, 403);
  assert.equal(result.code, 'origin-not-allowed');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('canonical Worker rejects requests without an Origin for protected Security & Access routes', async () => {
  const { response, result } = await callWorker('/security/session/validate', { origin: '' });
  assert.equal(response.status, 403);
  assert.equal(result.code, 'origin-not-allowed');
});

test('canonical Worker rejects staging session-validation requests without Firebase credentials', async () => {
  const { response, result } = await callWorker('/security/session/validate');
  assert.equal(response.status, 401);
  assert.equal(result.code, 'firebase-unauthenticated');
});

test('canonical Worker rejects protected settings and device operations without Firebase credentials', async () => {
  for (const [path, method, body] of [
    ['/security/access-state', 'GET', undefined],
    ['/security/device/revoke', 'POST', { deviceId: 'test-device', proofId: 'test-proof' }],
    ['/security/session/revoke-others', 'POST', { proofId: 'test-proof' }]
  ]) {
    const { response, result } = await callWorker(path, { method, body });
    assert.equal(response.status, 401, path);
    assert.equal(result.code, 'firebase-unauthenticated', path);
  }
});

test('canonical Worker rejects bearer tokens without a server-approved security session', async () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'test-uid', lanSecurityVerified: false }))
    .toString('base64url');
  const { response, result } = await callWorker('/security/session/validate', {
    auth: 'Bearer ignored.' + payload + '.ignored'
  });
  assert.equal(response.status, 403);
  assert.equal(result.code, 'security-session-required');
});

test('canonical Worker rejects unauthorized Cloudinary telemetry before querying backend services', async () => {
  const { response, result } = await callWorker('/telemetry', { method: 'POST', body: { references: [] } });
  assert.equal(response.status, 401);
  assert.equal(result.code, 'firebase-unauthenticated');
});

test('canonical Worker CORS preflight accepts staging and refuses production origins', async () => {
  const good = await worker.fetch(
    new Request(workerUrl + '/security/session/validate', { method: 'OPTIONS', headers: { Origin: stagingOrigin } }),
    env, { waitUntil() {} }
  );
  const bad = await worker.fetch(
    new Request(workerUrl + '/security/session/validate', { method: 'OPTIONS', headers: { Origin: productionOrigin } }),
    env, { waitUntil() {} }
  );
  assert.equal(good.status, 204);
  assert.equal(good.headers.get('access-control-allow-origin'), stagingOrigin);
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
