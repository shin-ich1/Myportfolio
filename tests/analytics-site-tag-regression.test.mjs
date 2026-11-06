import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Cloudflare RUM reporting uses the verified site tag, not the public beacon token', () => {
  const worker = JSON.parse(read('telemetry-worker/wrangler.jsonc'));
  const publicConfig = read('config.js');
  const beaconToken = publicConfig.match(/webAnalyticsConfig\s*=\s*Object\.freeze\(\{\s*siteToken:\s*"([a-f0-9]{32})"/i)?.[1];

  assert.ok(beaconToken, 'Existing public beacon token must remain configured');
  assert.equal(
    worker.vars.CF_ANALYTICS_SITE_TAG,
    '0e789eedfbd845fe8c72505572b7666f',
    'Worker GraphQL siteTag must match the actual Cloudflare Web Analytics property'
  );
  assert.notEqual(worker.vars.CF_ANALYTICS_SITE_TAG, beaconToken,
    'The RUM site tag and public beacon token must not be mixed up');
});

test('Analytics correction preserves canonical Worker security bindings and source', () => {
  const worker = JSON.parse(read('telemetry-worker/wrangler.jsonc'));
  const source = read('telemetry-worker/src/index.js');

  assert.equal(worker.name, 'lan-cloudinary-telemetry');
  assert.equal(worker.keep_vars, true);
  assert.equal(worker.preview_urls, false);
  assert.deepEqual(
    worker.kv_namespaces.map(binding => binding.binding).sort(),
    ['PORTFOLIO_MESSAGES', 'STORAGE_OAUTH']
  );
  assert.equal(worker.durable_objects.bindings[0]?.name, 'SECURITY_COORDINATOR');
  assert.equal(worker.durable_objects.bindings[0]?.class_name, 'SecurityCoordinator');
  assert.match(source, /rumPageloadEventsAdaptiveGroups\(filter: \{siteTag: \$siteTag,/);
  assert.match(source, /await requireSecurityApprovedAdministrator/);
});
