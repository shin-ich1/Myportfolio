import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: viewing Security, Vault, or Diagnostics must not start
// collection-wide Firestore telemetry. Only an active, visible Control
// room may own those live subscriptions. Keep chart behavior unchanged.
const settings = readFileSync(new URL('../admin/js/settings.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const functionSource = settings.match(/function syncTelemetryRealtimeForRoom\([^\n]*\) \{[\s\S]*?\n\}/)?.[0];
test('Control-only telemetry subscription lifecycle is canonical and idempotent', () => {
  assert.ok(functionSource, 'Missing the canonical tab/visibility telemetry gate');
  let starts = 0, stops = 0;
  let room = 'security';
  const doc = { hidden: false, body: { dataset: { settingsRoom: room } } };
  const active = [];
  const start = () => { starts++; active.push(() => {}); };
  const stop = () => { stops++; active.length = 0; };
  const sync = new Function('document', 'startTelemetryRealtime', 'stopTelemetryRealtime',
    'telemetryRealtimeUnsubscribers', functionSource + '\nreturn syncTelemetryRealtimeForRoom;')(doc, start, stop, active);

  sync();
  assert.equal(starts, 0, 'Security room must not open expensive listeners');
  room = 'general'; doc.body.dataset.settingsRoom = room;
  sync();
  sync();
  assert.equal(starts, 1, 'Repeat Control activation cannot duplicate listeners');
  room = 'backup'; doc.body.dataset.settingsRoom = room; sync();
  assert.equal(stops, 1, 'Leaving Control must release live listeners');
  room = 'general'; doc.body.dataset.settingsRoom = room; sync();
  assert.equal(starts, 2, 'Returning to Control restores real live telemetry');
  doc.hidden = true; sync();
  assert.equal(stops, 2, 'Hidden Admin tab must close listeners');
  doc.hidden = false; sync();
  assert.equal(starts, 3, 'Visible Control should resume live telemetry');
});

test('Settings room, visibility and startup share only one telemetry gate', () => {
  assert.match(settings, /settingsRoomNav\?\.addEventListener\("lan:tabchange"[\s\S]{0,380}syncTelemetryRealtimeForRoom\(room\)/,
    'Settings nav must drive subscriptions by selected room');
  assert.match(settings, /document\.addEventListener\("visibilitychange", \(\) => \{\s*syncTelemetryRealtimeForRoom\(\)/,
    'Background tab must release collection listeners');
  assert.match(settings, /\n\s*syncTelemetryRealtimeForRoom\(\);\n\s*void startSettingsRoomData\(document\.body\.dataset\.settingsRoom \|\| "general"\);\n\s*syncAppearancePreview\(\);/,
    'Settings startup must use canonical gate instead of unconditional listeners');
  assert.doesNotMatch(settings, /\n\s*startTelemetryRealtime\(\);\n\s*syncAppearancePreview\(\);/,
    'Do not start costly telemetry on any Settings page by default');
});
