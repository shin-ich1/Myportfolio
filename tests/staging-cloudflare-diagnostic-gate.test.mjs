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

const accountId = 'a'.repeat(32);
const root = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;
const worker = 'lan-portfolio-staging';
const serviceUrl = root + '/workers/services/' + worker;
const environment = 'production';
const envBase = serviceUrl + '/environments/' + environment;
const exactSix = [
  [envBase + '/bindings', 'bindings'],
  [envBase + '/routes?show_zonename=true', 'routes'],
  [root + '/workers/domains/records?page=0&per_page=5&service=' + worker + '&environment=' + environment, 'custom-domains'],
  [envBase + '/subdomain', 'subdomain'],
  [envBase, 'service-environment'],
  [root + '/workers/scripts/' + worker + '/schedules', 'cron-schedules']
];
const okResponse = result => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
const serviceResponse = (env = environment, source = 'dash') =>
  okResponse({ default_environment: { environment: env, script: { last_deployed_from: source } } });

function mockCloudflare(overrides = {}) {
  const calls = [];
  const lines = [];
  const http = async (url, options) => {
    calls.push({ url: String(url), options });
    if (Object.hasOwn(overrides, String(url))) {
      const value = overrides[String(url)];
      if (value instanceof Error) throw value;
      return value;
    }
    return String(url) === serviceUrl ? serviceResponse() : okResponse({});
  };
  return { calls, lines, http, log: message => lines.push(message) };
}

test('same staging Worker, exact Wrangler 4.131.2 service metadata and six GET requests', async () => {
  const mock = mockCloudflare();
  const result = await diagnose({ accountId, token: 'fake-token', http: mock.http, log: mock.log });
  assert.equal(result, true);
  assert.deepEqual(checks, exactSix.map(pair => pair[1]));
  assert.deepEqual(mock.calls.map(call => call.url), [serviceUrl, ...exactSix.map(pair => pair[0])]);
  for (const { options } of mock.calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fake-token');
  }
  assert.deepEqual(mock.lines, ['service-metadata: HTTP 200', ...checks.map(label => label + ': HTTP 200')]);
  assert.ok(mock.lines.every(line => !line.includes('fake-token')));
});

test('environment is derived from Cloudflare service response, not assumed', async () => {
  const mock = mockCloudflare({ [serviceUrl]: serviceResponse('preview_1') });
  const result = await diagnose({ accountId, token: 'fake-token', http: mock.http, log: mock.log });
  assert.equal(result, true);
  assert.equal(mock.calls.length, 7);
  assert.ok(mock.calls[1].url.endsWith('/environments/preview_1/bindings'));
  assert.ok(mock.calls[3].url.endsWith('environment=preview_1'));
  assert.ok(!mock.lines.join('\n').includes('preview_1'));
});

test('untrusted environment names cannot create arbitrary URL paths or leak response details', async () => {
  const secret = 'secret-from-cloudflare';
  const mock = mockCloudflare({
    [serviceUrl]: serviceResponse('../production?' + secret)
  });
  assert.equal(await diagnose({ accountId, token: secret, http: mock.http, log: mock.log }), false);
  assert.equal(mock.calls.length, 1);
  assert.ok(mock.lines.includes('remote-config-path: unsafe-environment'));
  assert.ok(!mock.lines.join('\n').includes(secret));
});

test('HTTP authorization error shows only numeric status and CF error code on exact failing endpoint', async () => {
  const secret = 'do-not-log-sensitive-token';
  const denied = new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: secret }] }), {
    status: 403, headers: { 'secret-header': secret }
  });
  const mock = mockCloudflare({ [exactSix[2][0]]: denied });
  assert.equal(await diagnose({ accountId, token: secret, http: mock.http, log: mock.log }), false);
  assert.equal(mock.calls.length, 7);
  assert.equal(mock.lines[3], 'custom-domains: HTTP 403 / CF code 10000');
  assert.ok(!mock.lines.join('\n').includes(secret));
});

test('Cloudflare 200 with success=false and malformed JSON fail closed', async () => {
  const rejected = new Response(JSON.stringify({ success: false, errors: [{ code: 10001, message: 'redacted' }] }), { status: 200 });
  const mock = mockCloudflare({
    [exactSix[4][0]]: rejected,
    [exactSix[5][0]]: new Response('not-json-and-not-a-secret', { status: 200 })
  });
  assert.equal(await diagnose({ accountId, token: 'dummy', http: mock.http, log: mock.log }), false);
  assert.ok(mock.lines.includes('service-environment: HTTP 200 / CF code 10001 / api-response-invalid'));
  assert.ok(mock.lines.includes('cron-schedules: HTTP 200 / api-response-invalid'));
});

test('first service request failure prevents calls to undiscovered environment', async () => {
  const mock = mockCloudflare({ [serviceUrl]: new Response('untrusted content', { status: 401 }) });
  assert.equal(await diagnose({ accountId, token: 'dummy', http: mock.http, log: mock.log }), false);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.lines[0], 'service-metadata: HTTP 401');
});

test('transport errors and malicious Cloudflare error values are not printed', async () => {
  const secret = 'private-bearer-token-and-body';
  const mock = mockCloudflare({
    [exactSix[0][0]]: Error(secret),
    [exactSix[1][0]]: new Response(JSON.stringify({ success: false, errors: [{ code: secret, message: secret }] }), { status: 429 })
  });
  assert.equal(await diagnose({ accountId, token: secret, http: mock.http, log: mock.log }), false);
  assert.ok(mock.lines.includes('bindings: transport-error'));
  assert.ok(mock.lines.includes('routes: HTTP 429'));
  assert.ok(!mock.lines.join('\n').includes(secret));
  const malformed = mockCloudflare({ [serviceUrl]: okResponse({ default_environment: { script: { last_deployed_from: 'dash' } } }) });
  assert.equal(await diagnose({ accountId, token: secret, http: malformed.http, log: malformed.log }), false);
  assert.equal(malformed.calls.length, 1);
});

test('non-dashboard deploy origin does not trigger Wrangler dashboard metadata reads', async () => {
  const mock = mockCloudflare({ [serviceUrl]: serviceResponse(environment, 'api') });
  assert.equal(await diagnose({ accountId, token: 'dummy', http: mock.http, log: mock.log }), true);
  assert.equal(mock.calls.length, 1);
  assert.ok(mock.lines.includes('remote-config-path: skipped-non-dashboard'));
});

test('invalid account and missing token fail before any API request', async () => {
  let called = false;
  await assert.rejects(diagnose({ accountId: 'production', token: 'secret', http: async () => { called = true; } }), /invalid staging credentials/);
  await assert.rejects(diagnose({ accountId, token: '', http: async () => { called = true; } }), /invalid staging credentials/);
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
