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

test('monthly and rolling analytics query fixed UTC-week windows without exceeding seven days', async () => {
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
  assert.equal(calls.length,5,'October spans five bounded UTC calendar weeks');
  assert.ok(calls.every(c => Date.parse(c.end)-Date.parse(c.start) <= 7*86400000));
  assert.equal(calls[0].start,'2026-09-28T00:00:00.000Z');
  assert.equal(calls[4].end,'2026-11-02T00:00:00.000Z');
  calls.length=0;
  const current=await fn(env,{period:'month',month:'2026-11'});
  assert.equal(current.days.length,9);
  assert.equal(calls.length,3);
  assert.equal(calls[0].start,'2026-10-26T00:00:00.000Z');
  assert.equal(calls[2].end,'2026-11-10T00:00:00.000Z');
  calls.length=0;
  const weekly=await fn(env);
  assert.equal(weekly.days.length,7);
  assert.equal(calls.length,2);
  assert.equal(calls[0].start,'2026-11-02T00:00:00.000Z');
  assert.equal(calls[1].end,'2026-11-10T00:00:00.000Z');
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


test('portfolio analytics headings use exact UTC date ranges and selected calendar months', () => {
  const source = read('admin/js/dashboard.js');
  const from = source.indexOf('  function formatVisitorAnalyticsHeading(');
  const to = source.indexOf('  function analyticsBuckets(', from);
  assert.ok(from >= 0 && to > from, 'canonical heading formatter must be present');
  const formatHeading = runInNewContext(source.slice(from, to) + ';formatVisitorAnalyticsHeading', { Date });
  const dates = (start, count) => Array.from({length: count}, (_, offset) => ({
    date: new Date(Date.parse(start + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10)
  }));
  assert.equal(formatHeading(dates('2026-11-03', 7), '7d'), 'Nov 3–9');
  assert.equal(formatHeading(dates('2026-10-11', 30), '30d'), 'Oct 11–Nov 9');
  assert.equal(formatHeading(dates('2026-06-29', 30), '30d'), 'Jun 29–Jul 28');
  assert.equal(formatHeading(dates('2026-12-28', 7), '7d'), 'Dec 28 ’26–Jan 3 ’27');
  assert.equal(formatHeading(dates('2026-11-01', 9), 'month'), 'November 2026');
  assert.equal(formatHeading(dates('2026-10-01', 31), 'month'), 'October 2026');
  assert.match(source, /heading\.textContent = formatVisitorAnalyticsHeading\(days, period\)/);
  assert.match(source, /heading\.title = days\[0\]\.date \+ " – " \+ days\[days\.length - 1\]\.date \+ " \(UTC\)"/);
});

test('selecting another period resets visible enhanced History dropdown while preserving chosen month', () => {
  const source = read('admin/js/dashboard.js');
  const from = source.indexOf('  function syncVisitorAnalyticsControls()');
  const to = source.indexOf('  function selectVisitorAnalyticsView(', from);
  assert.ok(from >= 0 && to > from, 'canonical reporting control owner must be present');
  const adminUi = read('admin/js/admin-ui.js');
  assert.match(adminUi, /select\.addEventListener\("lan:select-sync", instance\.sync\)/);
  const buttons = ['7d', '30d', 'month'].map(period => ({
    dataset: { analyticsPeriod: period },
    state: '',
    setAttribute(key, value) { if (key === 'aria-pressed') this.state = value; }
  }));
  const dispatched = [];
  const select = {
    dataset: {}, value: '',
    querySelector(selector) { return selector === 'option[value="2026-10"]' ? {} : null; },
    dispatchEvent(event) { dispatched.push(event.type); }
  };
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-09T09:00:00Z'])); }
  };
  const ctx = {
    Date: FixedDate,
    Event: class { constructor(type) { this.type = type; } },
    visitorAnalyticsView: { period: 'month', month: '2026-10' },
    document: {
      querySelectorAll: () => buttons,
      querySelector: () => select
    }
  };
  const sync = runInNewContext(source.slice(from, to) + ';syncVisitorAnalyticsControls', ctx);
  sync();
  assert.equal(select.value, '2026-10', 'selected month must stay visible');
  assert.equal(select.dataset.selected, 'true');
  assert.equal(buttons[2].state, 'false', 'Month must not appear active during History');
  ctx.visitorAnalyticsView = {period:'7d', month:''};
  sync();
  assert.equal(select.value, '', 'History placeholder returns on 7 Days');
  assert.equal(select.dataset.selected, 'false');
  assert.equal(buttons[0].state, 'true');
  ctx.visitorAnalyticsView = {period:'month', month:'2026-11'};
  sync();
  assert.equal(select.value, '', 'current Month also resets History placeholder');
  assert.equal(buttons[2].state, 'true');
  assert.deepEqual(dispatched, ['lan:select-sync', 'lan:select-sync', 'lan:select-sync']);
});


test('overlapping UTC page views stay consistent across seven-day, thirty-day and month reports', async () => {
  const source = read('telemetry-worker/src/index.js');
  const from = source.indexOf('async function readCloudflareVisitorAnalytics(env');
  const to = source.indexOf('async function handleSecurityRoute(', from);
  assert.ok(from >= 0 && to > from);
  const calls = [];
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-09T09:00:00Z'])); }
  };
  const base = {
    '2026-11-01': { views: 2, visits: 1 },
    '2026-11-08': { views: 1, visits: 1 },
    '2026-11-09': { views: 4, visits: 2 }
  };
  const fn = runInNewContext(source.slice(from, to) + ';readCloudflareVisitorAnalytics', {
    Date: FixedDate,
    fetch: async (_url, options) => {
      const { variables } = JSON.parse(options.body);
      calls.push([variables.start, variables.end]);
      // Emulate Adaptive Bit Rate sampling: wider-than-week windows may
      // estimate different values for exactly the same UTC calendar date.
      const scale = Date.parse(variables.end) - Date.parse(variables.start) > 7 * 86400000 ? 2 : 1;
      return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{
        rumPageloadEventsAdaptiveGroups: Object.entries(base)
          .filter(([date]) => date >= variables.start.slice(0, 10) && date < variables.end.slice(0, 10))
          .map(([date, values]) => ({
            dimensions: { date }, count: values.views * scale,
            sum: { visits: values.visits * scale }
          }))
      }] } } }) };
    },
    AbortSignal: { timeout: () => undefined },
    serviceError: (message, details) => Object.assign(new Error(message), details)
  });
  const env = {
    CF_ANALYTICS_ACCOUNT_ID: 'a'.repeat(32),
    CF_ANALYTICS_SITE_TAG: 'b'.repeat(32),
    CF_ANALYTICS_READ_TOKEN: 'unit-test-fake'
  };
  const reports = {};
  const windows = {};
  for (const [label, options] of [
    ['seven', { period: '7d' }],
    ['thirty', { period: '30d' }],
    ['month', { period: 'month', month: '2026-11' }]
  ]) {
    const before = calls.length;
    reports[label] = await fn(env, options);
    windows[label] = calls.slice(before);
  }
  const day = (report, date) => report.days.find(item => item.date === date);
  for (const date of ['2026-11-08', '2026-11-09']) {
    assert.deepEqual(
      [day(reports.seven, date).views, day(reports.thirty, date).views, day(reports.month, date).views],
      [base[date].views, base[date].views, base[date].views],
      'The same UTC date should not change views merely because a wider period is selected'
    );
    assert.deepEqual(
      [day(reports.seven, date).visits, day(reports.thirty, date).visits, day(reports.month, date).visits],
      [base[date].visits, base[date].visits, base[date].visits],
      'The same UTC date should not change visits merely because a wider period is selected'
    );
  }
  assert.equal(day(reports.thirty, '2026-11-01').views, day(reports.month, '2026-11-01').views);
  for (const [label, ranges] of Object.entries(windows)) {
    assert.ok(ranges.length > 1, label + ' must use short shared week windows');
    assert.ok(ranges.every(([start, end]) => Date.parse(end) - Date.parse(start) <= 7 * 86400000),
      label + ' must never send a greater-than-seven-day sampling window');
  }
  const week = ['2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z'];
  const today = ['2026-11-09T00:00:00.000Z', '2026-11-10T00:00:00.000Z'];
  for (const label of ['seven', 'thirty', 'month']) {
    assert.ok(windows[label].some(range => range.join('|') === week.join('|')),
      'Shared dates must use the identical completed UTC calendar week on ' + label);
    assert.ok(windows[label].some(range => range.join('|') === today.join('|')),
      'Current partial UTC week must use the identical end boundary on ' + label);
  }
});
