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
  assert.match(dashboard, /Analytics unavailable|Not connected/);
  assert.match(read('admin/services/adminSecurityService.js'), /export const getVisitorAnalyticsSummary/);
});

test('public tracking only activates when Cloudflare Web Analytics site tag is configured', () => {
  assert.match(read('config.js'), /webAnalyticsConfig/);
  assert.match(read('index.html'), /web-analytics-beacon\.js/);
  assert.match(read('web-analytics-beacon.js'), /siteToken/);
});
