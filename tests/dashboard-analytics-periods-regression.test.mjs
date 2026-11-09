import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('existing flip card has non-flipping period controls and accessible daily details', () => {
  const html = read('admin/dashboard.html');
  const js = read('admin/js/dashboard.js');
  assert.match(html, /data-command-wallet/);
  assert.match(html, /data-analytics-period="7d"/);
  assert.match(html, /data-analytics-period="30d"/);
  assert.match(html, /data-analytics-month-select/);
  assert.match(html, /data-analytics-open-details/);
  assert.match(html, /data-analytics-detail-dialog/);
  assert.match(js, /if \(event\.target\.closest\("a, button, input, select, textarea"\)\) return;/);
  assert.match(js, /data-analytics-period/);
  assert.match(js, /data-analytics-day-summary/);
  assert.match(js, /data-analytics-open-details/);
  assert.match(js, /dataset\.analyticsDayBar/);
});

test('monthly query splits 31-day months to avoid exceeding 30-day GraphQL window', async () => {
  const source = read('telemetry-worker/src/index.js');
  const from = source.indexOf('async function readCloudflareVisitorAnalytics(env');
  const to = source.indexOf('async function handleSecurityRoute(', from);
  assert.ok(from > 0 && to > from);
  const calls = [];
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-09T09:00:00Z'])); }
  };
  const fn = runInNewContext(source.slice(from, to) + ';readCloudflareVisitorAnalytics', {
    Date: FixedDate,
    fetch: async (_url, options) => {
      const {variables} = JSON.parse(options.body);
      calls.push(variables);
      return {ok:true,status:200,json:async()=>({data:{viewer:{accounts:[{
        rumPageloadEventsAdaptiveGroups:[
          {dimensions:{date:'2026-10-01'},count:2,sum:{visits:1}},
          {dimensions:{date:'2026-10-31'},count:5,sum:{visits:3}}
        ].filter(row => row.dimensions.date >= variables.start.slice(0,10)
          && row.dimensions.date < variables.end.slice(0,10))
      }]}}})};
    },
    AbortSignal: {timeout: () => undefined},
    serviceError: (message, details) => Object.assign(new Error(message),details)
  });
  const env = {
    CF_ANALYTICS_ACCOUNT_ID:'a'.repeat(32),
    CF_ANALYTICS_SITE_TAG:'b'.repeat(32),
    CF_ANALYTICS_READ_TOKEN:'unit-test-fake'
  };
  const previous = await fn(env,{period:'month',month:'2026-10'});
  assert.equal(previous.days.length,31);
  assert.equal(previous.days[0].views,2);
  assert.equal(previous.days[30].views,5);
  assert.equal(previous.days[30].visits,3);
  assert.equal(calls.length,2,'31-day historical month requires exactly two bounded queries');
  assert.ok(calls.every(c => Date.parse(c.end)-Date.parse(c.start) <= 30*86400000));
  calls.length=0;
  const current=await fn(env,{period:'month',month:'2026-11'});
  assert.equal(current.days.length,9);
  assert.equal(calls.length,1);
  calls.length=0;
  const weekly=await fn(env);
  assert.equal(weekly.days.length,7);
  assert.equal(calls.length,1);
  calls.length=0;
  await assert.rejects(fn(env,{period:'month',month:'2018-10'}),error=>error.code==='analytics-period-invalid');
  assert.equal(calls.length,0,'out-of-range queries must fail before Cloudflare request');
});

test('admin-only analytics request preserves authenticated Worker ownership and caching lives in dashboard', () => {
  const security = read('admin/services/adminSecurityService.js');
  const worker = read('telemetry-worker/src/index.js');
  const dashboard = read('admin/js/dashboard.js');
  assert.match(security,/getVisitorAnalyticsSummary/);
  assert.match(security,/URLSearchParams|searchParams/);
  assert.match(worker,/url\.searchParams\.get\('period'\)/);
  assert.match(worker,/await requireSecurityApprovedAdministrator/);
  assert.match(dashboard,/visitorAnalyticsCache/);
  assert.doesNotMatch(dashboard,/CF_ANALYTICS_READ_TOKEN/);
});


test('Portfolio Pass reporting controls retain compact height despite shared input/select defaults', () => {
  const css = read('admin/css/dashboard.css');
  const controls = css.match(/\.portfolio-analytics-period-controls>button,\.portfolio-analytics-period-controls>select,\.portfolio-analytics-period-controls>\.lan-select>\.lan-select-trigger\{([^}]+)\}/)?.[1] || '';
  const history = css.match(/^\.portfolio-analytics-period-controls>select\{([^}]+)\}/m)?.[1] || '';
  assert.match(controls, /min-height\s*:\s*24px\s*;/,
    'explicit min-height must override the shared select minimum');
  assert.match(controls, /height\s*:\s*24px\s*;/);
  assert.match(history, /background-image\s*:\s*none\s*;/,
    'remove the inherited oversized select arrow artwork');
  assert.match(history, /text-overflow\s*:\s*clip\s*;/,
    'History label must not be rendered as H…');
  assert.match(css, /\.portfolio-analytics-period-controls\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\) minmax\(0,1\.6fr\)/);
});


test('enhanced History control uses the same compact Portfolio Pass sizing as period buttons', () => {
  const css = read('admin/css/dashboard.css');
  const adminUi = read('admin/js/admin-ui.js');
  assert.match(adminUi, /trigger\.className = "lan-select-trigger"/,
    'global Admin UI enhances the native select into a visible custom trigger');
  assert.match(adminUi, /wrapper\.className = "lan-select"/);
  assert.match(css, /\.portfolio-analytics-period-controls>\.lan-select\{[^}]*min-width:0;[^}]*width:100%/);
  const trigger = css.match(/\.portfolio-analytics-period-controls>button,\.portfolio-analytics-period-controls>select,\.portfolio-analytics-period-controls>\.lan-select>\.lan-select-trigger\{([^}]+)\}/)?.[1] || '';
  assert.match(trigger, /min-height:24px/);
  assert.match(trigger, /height:24px/);
  assert.match(trigger, /padding:0 3px/);
  assert.match(css, /^\.portfolio-analytics-period-controls>\.lan-select>\.lan-select-trigger\{[^}]*gap:4px/m);
  assert.match(css, /\.portfolio-analytics-period-controls\{[^}]*minmax\(0,1\.6fr\)/,
    'give the longer History label more room than the period buttons');
});


test('History label and chevron remain centered together at compact and wide sizes', () => {
  const css = read('admin/css/dashboard.css');
  const trigger = css.match(/^\.portfolio-analytics-period-controls>\.lan-select>\.lan-select-trigger\{([^}]+)\}/m)?.[1] || '';
  const value = css.match(/^\.portfolio-analytics-period-controls>\.lan-select>\.lan-select-trigger \.lan-select-value\{([^}]+)\}/m)?.[1] || '';
  const chevron = css.match(/^\.portfolio-analytics-period-controls>\.lan-select>\.lan-select-trigger \.lan-select-chevron\{([^}]+)\}/m)?.[1] || '';
  assert.match(trigger, /justify-content:center(?:;|\s)/,
    'center History text and chevron as a single compact group');
  assert.match(trigger, /gap:4px(?:;|\s)/);
  assert.match(value, /flex:0 1 auto(?:;|\s)/,
    'the label must not consume the free space and push the chevron away');
  assert.match(chevron, /flex:0 0 \.5rem(?:;|\s|$)/);
});


test('mini analytics chart pairs each value with its bar and aligns day labels consistently', () => {
  const js = read('admin/js/dashboard.js');
  const css = read('admin/css/dashboard.css');
  assert.match(js, /plot\.className = "portfolio-analytics-day-plot"/,
    'canonical chart renderer needs a dedicated value-and-bar plot area');
  assert.match(js, /plot\.append\(number, value\)/,
    'count must remain directly above its corresponding bar');
  assert.match(js, /button\.append\(plot, label\)/,
    'day labels must use a separate consistent bottom row');
  assert.match(js, /value\.style\.height = Math\.max\(3, Math\.round\(30 \* bucket\.views \/ peak\)\) \+ "px"/,
    'bar heights must be tied to a compact fixed plot scale, not percentages of a flex item');
  assert.match(js, /button\.dataset\.zero = String\(bucket\.views === 0\)/,
    'zero-count days should have an explicit visual indicator');
  assert.match(css, /\.portfolio-analytics-day-plot\{[^}]*justify-content:flex-end;[^}]*gap:3px/);
  assert.match(css, /\.portfolio-analytics-day\[data-zero="true"\] \.portfolio-analytics-day-bar\{[^}]*opacity:/);
  assert.match(css, /\.portfolio-analytics-day strong\{[^}]*font-variant-numeric:tabular-nums/);
});


test('daily details keeps one right-aligned Views column without hiding the underlying visits metric', () => {
  const js = read('admin/js/dashboard.js');
  const css = read('admin/css/dashboard.css');
  const html = read('admin/dashboard.html');
  const start = js.indexOf('function showVisitorAnalyticsDetails()');
  const end = js.indexOf('async function loadVisitorAnalytics(', start);
  assert.ok(start > -1 && end > start, 'inspect the canonical details renderer');
  const details = js.slice(start, end);
  assert.match(details, /const rows = \[\["UTC day", "Views"\], \.\.\.days\.map\(day => \[/);
  assert.match(details, /formatAnalyticsCount\(day\.views\)/);
  assert.doesNotMatch(details, /formatAnalyticsCount\(day\.visits\)|"Visits"/);
  assert.match(html, /data-analytics-day-list aria-label="Page views by date"/);
  assert.doesNotMatch(html, /Visits are not necessarily unique people/);
  const rowRule = css.match(/^\.portfolio-analytics-detail-list>div\{([^}]+)\}/m)?.[1] || '';
  assert.match(rowRule, /grid-template-columns:minmax\(0,1fr\) 64px;/,
    'both header and daily values must use the same fixed-aligned metric column');
  assert.match(css, /\.portfolio-analytics-detail-list b\{[^}]*font-variant-numeric:tabular-nums;[^}]*text-align:right/);
  assert.match(js, /day\.visits/, 'other analytics features retain their existing visits metric');
});
