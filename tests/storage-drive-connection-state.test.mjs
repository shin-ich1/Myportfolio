import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../admin/js/settings.js", import.meta.url), "utf8");
const helperStart = settings.indexOf("const STORAGE_DRIVE_RECONNECT_CODES =");
const helperEnd = settings.indexOf("\nfunction storageHubEscape(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Expected one shared reconnect classification owner");
const start = settings.indexOf("function storageHubProfileMarkup(");
const end = settings.indexOf("\nasync function refreshStorageHubUsage(", start);
assert.ok(start >= 0 && end > start, "Expected the existing canonical Storage Hub profile renderer");

const render = new Function(
  "storageHubUsage", "storageProfileDefaultFamilies", "storageHubQuotaLabel",
  "storageHubEscape", "formatStorageHubBytes",
  settings.slice(helperStart, helperEnd) + "\n" +
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
  assert.match(owner, /if \(!storageHubNeedsReconnect\(error\?\.code\)\) throw error;/);
  assert.doesNotMatch(owner, /const reconnectCodes = new Set/);
  assert.doesNotMatch(owner, /removeConnectedStorageProfile|disconnectStorageProfile/);
});

const worker = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
const tokenStart = worker.indexOf("async function driveAccessToken(");
const tokenEnd = worker.indexOf("\nfunction escapeDriveQuery(", tokenStart);
assert.ok(tokenStart >= 0 && tokenEnd > tokenStart, "Expected single canonical Drive OAuth refresh owner");
const createDriveAccess = new Function(
  "kvJsonGet", "kvJsonPut", "driveTokenExchange", "driveTokenKey", "serviceError",
  worker.slice(tokenStart, tokenEnd) + "\nreturn driveAccessToken;"
);

test("expired short-lived access token refreshes automatically without reauthorization", async () => {
  const old = { accessToken: "expired-access-demo", accessTokenExpiresAt: Date.now() - 5000, refreshToken: "saved-refresh-demo", uid: "admin-demo" };
  const records = [];
  const access = createDriveAccess(
    async () => ({ ...old }),
    async (env, key, next) => records.push({ key, next }),
    async (params) => {
      assert.equal(params.grant_type, "refresh_token");
      assert.equal(params.refresh_token, old.refreshToken);
      return { access_token: "fresh-access-demo", expires_in: 3600 };
    },
    id => "demo:" + id, message => new Error(message)
  );
  const token = await access("original-profile", {});
  assert.equal(token, "fresh-access-demo");
  assert.equal(records.length, 1);
  assert.equal(records[0].key, "demo:original-profile");
  assert.equal(records[0].next.refreshToken, old.refreshToken, "Never overwrite the reusable refresh token");
  assert.equal(records[0].next.uid, old.uid, "Original profile and account ownership remain");
  assert.ok(records[0].next.accessTokenExpiresAt > Date.now());
});

test("valid access token is reused without unnecessary reconnect or writes", async () => {
  const current = { accessToken: "still-valid-demo", accessTokenExpiresAt: Date.now() + 3600_000, refreshToken: "saved-refresh-demo" };
  const access = createDriveAccess(
    async () => ({ ...current }),
    async () => { throw Error("No writes expected"); },
    async () => { throw Error("No refresh expected"); },
    id => id, message => new Error(message)
  );
  assert.equal(await access("original-profile", {}), "still-valid-demo");
});

test("revoked refresh token never mints a fake connection or deletes the storage profile", async () => {
  const revocation = Object.assign(new Error("Google requires reauthorization"), { code: "google-drive-reconnect-required" });
  let writes = 0;
  const access = createDriveAccess(
    async () => ({ accessToken: "expired-demo", accessTokenExpiresAt: 1, refreshToken: "revoked-demo", uid: "admin-demo" }),
    async () => { writes++; },
    async () => { throw revocation; },
    id => id, message => new Error(message)
  );
  await assert.rejects(access("original-profile", {}), error => error === revocation);
  assert.equal(writes, 0, "A revoked token must not replace stored credentials with a fake authorization");
});
