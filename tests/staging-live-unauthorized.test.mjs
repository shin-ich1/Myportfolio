import test from 'node:test';
import assert from 'node:assert/strict';

// Non-mutating live staging checks from GitHub Actions with NO admin identity.
// A denied anonymous request proves only that this path does not permit
// anonymous access. It cannot prove revocation of a formerly VALID token.
const STAGING_WORKER = 'https://lan-portfolio-staging.lagmayr2.workers.dev';
const STAGING_ORIGIN = 'https://lan-portfolio-staging.web.app';
const PRODUCTION_ORIGIN = 'https://rolando-portfolio-3f1a3.web.app';
const STAGING_FIRESTORE = 'https://firestore.googleapis.com/v1/projects/lan-portfolio-staging/databases/(default)/documents';
const timeoutMs = 15_000;

async function request(url, { method = 'GET', origin, authorization } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (authorization) headers.Authorization = authorization;
  const response = await fetch(url, {
    method, headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => null);
  // No user tokens or secret server response body is printed to CI.
  return { status: response.status, code: payload?.code || '', payload, headers: response.headers };
}

test('live staging Worker is reachable and reports only public health', async () => {
  const result = await request(STAGING_WORKER + '/health', { origin: STAGING_ORIGIN });
  assert.equal(result.status, 200);
  assert.equal(result.payload?.ok, true);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('live staging Worker denies unauthenticated direct Security & Access reads', async () => {
  for (const path of ['/security/access-state','/security/session/validate',
    '/security/sessions','/security/devices','/security/overview',
    '/security/activity']) {
    const result = await request(STAGING_WORKER + path, { origin: STAGING_ORIGIN });
    assert.equal(result.status, 401, 'expected 401 for anonymous ' + path);
    assert.equal(result.code, 'firebase-unauthenticated', path);
  }
});

test('live staging Worker denies forged security-session claims', async () => {
  const jwtPayload = Buffer.from(JSON.stringify({
    sub: 'anonymous-negative-smoke', lanSecurityVerified: false, lanSessionId: 'forged'
  })).toString('base64url');
  const result = await request(STAGING_WORKER + '/security/session/validate', {
    origin: STAGING_ORIGIN, authorization: 'Bearer bogus.' + jwtPayload + '.signature'
  });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'security-session-required');
});

test('live staging Worker denies production Origin on protected Security & Access', async () => {
  const result = await request(STAGING_WORKER + '/security/access-state', { origin: PRODUCTION_ORIGIN });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'origin-not-allowed');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('anonymous direct Firestore REST read cannot expose the backend-only recovery collection', async () => {
  // This is strictly an anonymous-denial smoke test. Separate authenticated
  // Firestore Rules emulator/live tests must verify authorized and revoked
  // identities; 403 without a token may be caused by API IAM or Security Rules.
  const result = await request(STAGING_FIRESTORE + '/adminSecurityRecovery/negative-smoke-probe');
  assert.ok([401,403].includes(result.status),
    'anonymous Firestore read must reject with 401/403, got ' + result.status);
  assert.equal(result.payload?.fields, undefined,
    'private Firestore document fields must never be disclosed anonymously');
});
