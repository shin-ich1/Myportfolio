import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('same flip card has real analytics front and seven-day back, not duplicated records', () => {
  const html = read('admin/dashboard.html');
  assert.match(html, /data-visitor-analytics/);
  assert.match(html, /data-analytics-total-views/);
  assert.match(html, /data-analytics-week-chart/);
  const front = html.split('portfolio-pass-front')[1]?.split('portfolio-pass-back')[0] || '';
  assert.doesNotMatch(front, /Workspace records|analyticsTotalCount/);
  const back = html.split('portfolio-pass-back')[1]?.split('dashboard-pulse-dock')[0] || '';
  assert.doesNotMatch(back, /Workspace snapshot|portfolio-pass-detail-grid/);
  assert.match(html, /data-mirror="analyticsTotalCount"/);
});

test('compact dashboard shows its photo through the canonical hero image variable', () => {
  const css = read('admin/css/admin-layout.css');
  assert.match(css, /\.welcome-copy\{[^\n]*background-image:[^;]*var\(--dashboard-edge-image\)/);
  // The compact hero renders the same image as a contained backdrop;
  // the foreground element remains reserved for wide composition.
  assert.match(read('admin/js/dashboard.js'), /closest\("\.dashboard-welcome"\)\?\.style\.setProperty\("--dashboard-edge-image"/);
});

test('compact layout uses existing dashboard-stage scroll owner for footer placement', () => {
  const css = read('admin/css/admin-layout.css');
  assert.match(css, /\.dashboard-stage\{display:flex;flex-direction:column/);
  assert.match(css, /\.dashboard-stage>\.lan-admin-page-footer\{[^}]*margin-top:var\(--space-3\)/);
  assert.match(css, /\.dashboard-welcome\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
});

test('analytics request is protected by the canonical Admin security gateway', () => {
  const worker = read('telemetry-worker/src/index.js');
  const idx = worker.indexOf("if(path==='/security/analytics/visitor-summary'");
  assert.ok(idx > 0);
  const auth = worker.lastIndexOf('await requireSecurityApprovedAdministrator', idx);
  assert.ok(auth > 0 && auth < idx, 'Endpoint must follow privileged admin validation');
  assert.match(worker, /rumPageloadEventsAdaptiveGroups/);
  assert.match(worker, /CF_ANALYTICS_READ_TOKEN/);
  assert.match(worker, /Cache-Control.*no-store/);
  assert.doesNotMatch(read('admin/js/dashboard.js'), /CF_ANALYTICS_READ_TOKEN/);
});

test('analytics UI has fail-closed unconfigured state and production data source', () => {
  const dashboard = read('admin/js/dashboard.js');
  assert.match(dashboard, /getVisitorAnalyticsSummary/);
  assert.match(dashboard, /renderVisitorAnalytics/);
  assert.match(dashboard, /Connection check failed · Retry/);
  assert.match(dashboard, /status.textContent = "Analytics not connected"/);
  assert.match(read('admin/services/adminSecurityService.js'), /export const getVisitorAnalyticsSummary/);
});

test('public tracking only activates when Cloudflare Web Analytics site tag is configured', () => {
  assert.match(read('config.js'), /webAnalyticsConfig/);
  assert.match(read('index.html'), /web-analytics-beacon\.js/);
  assert.match(read('web-analytics-beacon.js'), /siteToken/);
});


test('one-click retry stays in the canonical analytics card and never flips the wallet', () => {
  const html = read('admin/dashboard.html');
  const js = read('admin/js/dashboard.js');
  assert.match(html, /data-analytics-retry/);
  assert.match(html, /type="button"[^>]*data-analytics-retry/);
  assert.match(js, /function bindVisitorAnalyticsRetry\(/);
  assert.match(js, /retryButton\.addEventListener\("click",/);
  assert.match(js, /if \(event\.target !== wallet\) return;/);
  assert.match(js, /visitorAnalyticsRequestInFlight/);
  assert.match(js, /retryButton\.disabled = true/);
});

test('one-click recovery reports Cloudflare auth vs transient failures without token rotation', () => {
  const js = read('admin/js/dashboard.js');
  const worker = read('telemetry-worker/src/index.js');
  assert.match(worker, /upstream\.status===401/);
  assert.match(worker, /upstream\.status===403/);
  assert.match(worker, /upstream\.status===429/);
  assert.match(worker, /analytics-token-invalid/);
  assert.match(worker, /analytics-token-permission-denied/);
  assert.match(worker, /analytics-rate-limited/);
  assert.match(js, /analytics-token-invalid/);
  assert.match(js, /analytics-token-permission-denied/);
  assert.match(js, /analytics-rate-limited/);
  assert.doesNotMatch(js, /CF_ANALYTICS_READ_TOKEN|createToken|rotateToken/);
});

test('Cloudflare analytics provider failures have distinct safe diagnostic codes', async () => {
  const { runInNewContext } = await import('node:vm');
  const worker = read('telemetry-worker/src/index.js');
  const begin = worker.indexOf('async function readCloudflareVisitorAnalytics(env){');
  const end = worker.indexOf('async function handleSecurityRoute(', begin);
  assert.ok(begin > 0 && end > begin, 'Canonical worker function is extractable');
  const fnCode = worker.slice(begin, end);
  const env = {
    CF_ANALYTICS_ACCOUNT_ID: 'a'.repeat(32),
    CF_ANALYTICS_SITE_TAG: 'b'.repeat(32),
    CF_ANALYTICS_READ_TOKEN: 'test-only-placeholder-not-a-real-token'
  };
  const simulate = (status, errorMessages = [], networkError = false) => {
    const fakeFetch = networkError
      ? async () => { throw new Error('network temporarily unavailable'); }
      : async () => ({status, ok: status === 200, json: async () => errorMessages.length
        ? {errors: errorMessages.map(message => ({message}))}
        : {data: {viewer: {accounts: [{rumPageloadEventsAdaptiveGroups: []}]}}}});
    return runInNewContext(`${fnCode}; readCloudflareVisitorAnalytics`, {
      fetch: fakeFetch,
      AbortSignal: {timeout: () => null},
      serviceError: (message, props) => Object.assign(new Error(message), props)
    });
  };
  await assert.rejects(simulate(401)(env), error => error.code === 'analytics-token-invalid');
  await assert.rejects(simulate(403)(env), error => error.code === 'analytics-token-permission-denied');
  await assert.rejects(simulate(429)(env), error => error.code === 'analytics-rate-limited');
  await assert.rejects(simulate(200, ['not authorized for that account'])(env), error => error.code === 'analytics-token-permission-denied');
  await assert.rejects(simulate(200, ['token expired'])(env), error => error.code === 'analytics-token-invalid');
  await assert.rejects(simulate(0, [], true)(env), error => error.code === 'analytics-upstream-unavailable');
  const empty = await simulate(200)(env);
  assert.equal(empty.configured, true);
  assert.equal(empty.days.length, 7);
  assert.ok(empty.days.every(d => d.views === 0 && d.visits === 0));
  const unconfigured = await simulate(200)({});
  assert.equal(unconfigured.configured, false);
});
