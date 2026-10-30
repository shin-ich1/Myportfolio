import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("../storage-privacy.html", import.meta.url);
const home = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("Google Drive storage privacy page is a standalone, public, accessible document", () => {
  assert.ok(existsSync(pageUrl), "Public storage-privacy.html must exist for the OAuth consent-screen URL");
  const page = readFileSync(pageUrl, "utf8");
  assert.match(page, /<!doctype html>/i);
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
  assert.match(page, /<title>LAN Portfolio Storage[^<]*Privacy Policy<\/title>/);
  assert.match(page, /<link rel="stylesheet" href="styles.css"/);
  assert.match(page, /<main[^>]*id="main-content"/);
  assert.match(page, /<h1[^>]*>[^<]*Privacy Policy<\/h1>/);
  assert.match(page, /href="index.html"/, "Must link back to real portfolio");
  assert.doesNotMatch(page, /<form|firebasejs|storageBridgeUrl|GOOGLE_DRIVE_CLIENT_SECRET|TURNSTILE_SECRET_KEY/i);
});

test("Privacy disclosure describes actual Worker Drive scope, data, public delivery, and revocation", () => {
  assert.ok(existsSync(pageUrl));
  const page = readFileSync(pageUrl, "utf8");
  for (const required of [
    /https:\/\/www\.googleapis\.com\/auth\/drive\.file/,
    /Google Drive/i, /Cloudflare Worker/i, /Firebase/i,
    /access tokens/i, /refresh tokens/i,
    /publicly accessible/i, /disconnect/i, /revoke/i, /delete/i,
    /contact/i, /lagmayr2@gmail\.com/i
  ]) assert.match(page, required);
  assert.doesNotMatch(page, /all (your|of your) (Google Drive|Drive) files/i, "Must not overstate narrow Drive scope");
  assert.doesNotMatch(page, /never expires|permanently connected|guaranteed secure|100% secure/i);
});

test("Public homepage footer exposes privacy page without changing project and admin link owners", () => {
  const start = home.indexOf('<footer class="wrap site-footer">');
  const end = home.indexOf("</footer>", start);
  assert.ok(start > 0 && end > start, "Expected single Public footer owner");
  const footer = home.slice(start, end + 9);
  assert.match(footer, /href="storage-privacy\.html"/);
  assert.match(footer, /LAN Portfolio Storage/);
  assert.match(footer, /href="#home"/);
  assert.match(footer, /href="admin\/"/);
  assert.equal((home.match(/href="storage-privacy\.html"/g) || []).length, 1);
});

test("Privacy page styling reuses site tokens and only adds dedicated policy selectors", () => {
  assert.match(styles, /\.storage-policy-page/);
  assert.match(styles, /\.storage-policy-body/);
  assert.match(styles, /\.storage-policy-panel/);
  assert.match(styles, /\.storage-policy-page[^\n]*a:focus-visible/);
  const page = existsSync(pageUrl) ? readFileSync(pageUrl, "utf8") : "";
  if (page) assert.doesNotMatch(page, /<style[\s>]/i, "Policy should not introduce competing inline CSS ownership");
});
