import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../scripts/diagnose-staging-cloudflare-metadata.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8');
const { checks, diagnose, diagnosticApproved } = await import(moduleUrl.href);

const approved = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'shin-ich1/Myportfolio',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/perf/admin-workspace-investigation-20261008',
  LAN_STAGING_DEPLOY_APPROVED: 'false',
  LAN_STAGING_DIAGNOSTIC_APPROVED: 'true'
};

test('diagnostic authorization requires both mutually exclusive gates and exact testing identity', () => {
  assert.equal(diagnosticApproved(approved), true);
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: 'false',
    GITHUB_REPOSITORY: 'another-org/another-repo',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/heads/main',
    LAN_STAGING_DEPLOY_APPROVED: 'true',
    LAN_STAGING_DIAGNOSTIC_APPROVED: 'false'
  })) assert.equal(diagnosticApproved({ ...approved, [key]: value }), false, key);
  for (const key of Object.keys(approved)) {
    const altered = { ...approved };
    delete altered[key];
    assert.equal(diagnosticApproved(altered), false, 'missing ' + key);
  }
});

test('one fixed staging Worker, four documented read-only endpoints and GET only', async () => {
  const requests = [];
  const lines = [];
  const ok = await diagnose({
    accountId: 'a'.repeat(32),
    token: 'fake-diagnostic-token',
    http: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response('{}', { status: 200 });
    },
    log: line => lines.push(line)
  });
  assert.equal(ok, true);
  assert.deepEqual(checks.map(item => item[1]), ['settings', 'script-settings', 'subdomain', 'deployments']);
  assert.equal(requests.length, 4);
  for (const { url, options } of requests) {
    assert.match(url, /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/a{32}\/workers\/scripts\/lan-portfolio-staging\/(settings|script-settings|subdomain|deployments)$/);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fake-diagnostic-token');
  }
  assert.equal(lines.length, 4);
  assert.ok(lines.every(line => /^[-a-z]+: HTTP 200$/.test(line)));
  assert.ok(lines.every(line => !line.includes('fake-diagnostic-token')));
});

test('HTTP failures disclose only status and validated numeric error code, never response details', async () => {
  const lines = [];
  const secret = 'secret-sensitive-body-and-headers';
  const ok = await diagnose({
    accountId: 'b'.repeat(32),
    token: 'another-fake-token',
    http: async () => new Response(JSON.stringify({ errors: [{ code: 10000, message: secret }], token: secret }), {
      status: 403,
      headers: { 'x-leaked-value': secret }
    }),
    log: line => lines.push(line)
  });
  assert.equal(ok, false);
  assert.equal(lines.length, 4);
  assert.ok(lines.every(line => /HTTP 403 \/ CF code 10000$/.test(line)));
  assert.doesNotMatch(lines.join('\n'), /secret-sensitive|another-fake-token|message|x-leaked/);
});

test('untrusted error code strings and transport errors never appear in CI output', async () => {
  const secret = 'bearer-private-sensitive-value';
  let counter = 0;
  const lines = [];
  const ok = await diagnose({
    accountId: 'c'.repeat(32),
    token: secret,
    http: async () => {
      counter++;
      if (counter === 1) throw Error(secret);
      return new Response(JSON.stringify({ errors: [{ code: secret, message: secret }] }), { status: 401 });
    },
    log: line => lines.push(line)
  });
  assert.equal(ok, false);
  assert.equal(lines[0], 'worker-settings: transport-error');
  assert.ok(lines.slice(1).every(line => /HTTP 401$/.test(line)));
  assert.ok(!lines.join('\n').includes(secret));
});

test('invalid account identifier or missing token is rejected before any request', async () => {
  let called = false;
  await assert.rejects(diagnose({ accountId: 'production', token: 'secret', http: async () => { called = true; } }), /invalid staging credentials/);
  await assert.rejects(diagnose({ accountId: 'a'.repeat(32), token: '', http: async () => { called = true; } }), /invalid staging credentials/);
  assert.equal(called, false);
});

test('direct CLI execution refuses unapproved invocation without leaking provided secrets', () => {
  const secret = 'do-not-log-this-diagnostic-secret';
  const processRun = spawnSync(process.execPath, [new URL(moduleUrl).pathname], {
    env: { ...process.env, ...approved, LAN_STAGING_DEPLOY_APPROVED: 'true', CLOUDFLARE_API_TOKEN: secret },
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(processRun.status, 1);
  assert.match(processRun.stderr, /safety gate denied/);
  assert.ok(!(processRun.stderr + processRun.stdout).includes(secret));
});

test('workflow must reuse canonical CI and require diagnostic approval while deploy remains off', async () => {
  const workflow = await readFile(new URL('../.github/workflows/admin-performance-regression.yml', import.meta.url), 'utf8');
  const start = workflow.indexOf('  staging-metadata-diagnostic:');
  const end = workflow.indexOf('  staging-deploy:');
  assert.ok(start > 0 && end > start, 'diagnostic job must precede unchanged deployment job');
  const job = workflow.slice(start, end);
  assert.match(job, /needs: shared-admin-regression/);
  assert.match(job, /LAN_STAGING_DIAGNOSTIC_APPROVED == 'true'/);
  assert.match(job, /LAN_STAGING_DEPLOY_APPROVED == 'false'/);
  assert.match(job, /github\.event_name == 'push'/);
  assert.match(job, /github\.repository == 'shin-ich1\/Myportfolio'/);
  assert.match(job, /github\.ref == 'refs\/heads\/perf\/admin-workspace-investigation-20261008'/);
  assert.match(job, /environment: lan-security-staging/);
  assert.match(job, /run: node scripts\/diagnose-staging-cloudflare-metadata\.mjs/);
  assert.doesNotMatch(job, /wrangler deploy|firebase-tools|id-token: write|--project rolando-portfolio|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
  assert.match(workflow.slice(end), /vars\.LAN_STAGING_DEPLOY_APPROVED == 'true'/);
  assert.doesNotMatch(source, /fetch\s*\([^)]*method:\s*['"](?:POST|PUT|PATCH|DELETE)/s);
});
