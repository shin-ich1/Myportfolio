import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../admin/js/settings.js", import.meta.url), "utf8");
const start = settings.indexOf("function storageHubProfileMarkup(");
const end = settings.indexOf("\nasync function refreshStorageHubUsage(", start);
assert.ok(start >= 0 && end > start, "Expected the existing canonical Storage Hub profile renderer");

const render = new Function(
  "storageHubUsage", "storageProfileDefaultFamilies", "storageHubQuotaLabel",
  "storageHubEscape", "formatStorageHubBytes",
  settings.slice(start, end) + "\nreturn storageHubProfileMarkup;"
)(
  new Map(), () => [], () => "Unavailable",
  value => String(value ?? ""), bytes => String(bytes) + " B"
);

function googleDriveProfile(usageSnapshot) {
  return {
    id: "google-drive-example",
    provider: "google-drive",
    label: "Google Drive",
    enabled: true,
    publicReady: true,
    usageSnapshot
  };
}

test("transient Worker or Google outage does not falsely demand OAuth reconnect", () => {
  for (const code of ["google-drive-oauth-unavailable", "http-503", "network-failed", ""] ) {
    const html = render(googleDriveProfile({ healthy: false, code }));
    assert.match(html, /Connection check failed/i, code);
    assert.match(html, /Retry Connection Check/i, code);
    assert.doesNotMatch(html, /Reconnect required|Reconnect Google Drive/i, code);
    assert.doesNotMatch(html, /data-storage-ready="true"/, code);
  }
});

test("confirmed invalid Google authorization still requires real reconnect, never pretends ready", () => {
  for (const code of ["google-drive-not-connected", "google-drive-refresh-missing", "google-drive-reconnect-required"]) {
    const html = render(googleDriveProfile({ healthy: false, code }));
    assert.match(html, /Reconnect required/i, code);
    assert.match(html, /Reconnect Google Drive/i, code);
    assert.doesNotMatch(html, /data-storage-ready="true"/, code);
  }
});

test("healthy storage preserves existing ready state, disabled storage remains disabled", () => {
  const ready = render(googleDriveProfile({ healthy: true }));
  assert.match(ready, /data-storage-ready="true"/);
  assert.match(ready, /Test Public Access/);
  const disabled = render({ ...googleDriveProfile({ healthy: false, code: "network-failed" }), enabled: false });
  assert.match(disabled, />Disabled</);
  assert.doesNotMatch(disabled, /data-storage-ready="true"/);
});

test("verification only opens Google OAuth for explicit missing or revoked credentials", () => {
  const owner = settings.slice(settings.indexOf("export async function testStorageProfilePublicAccess("), settings.indexOf("\nexport function openStorageProfile("));
  assert.match(owner, /const reconnectCodes = new Set\(\["google-drive-not-connected", "google-drive-refresh-missing", "google-drive-reconnect-required"\]\)/);
  assert.match(owner, /if \(!reconnectCodes\.has\(String\(error\?\.code \|\| ""\)\)\) throw error;/);
  assert.doesNotMatch(owner, /removeConnectedStorageProfile|disconnectStorageProfile/);
});
