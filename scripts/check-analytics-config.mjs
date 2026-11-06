// Read-only Cloudflare Web Analytics configuration sanity check.
// PR #60 verified the public beacon site_token and Worker GraphQL siteTag
// are DISTINCT identifiers. Do NOT equate them.
// The regression test tests/analytics-site-tag-regression.test.mjs
// anchors the verified Worker GraphQL tag to the Cloudflare dashboard.
// No secrets, live settings, or deployments are changed here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const config = read("config.js");
const worker = JSON.parse(read("telemetry-worker/wrangler.jsonc"));

const publicBeaconToken = config.match(/webAnalyticsConfig\s*=\s*Object\.freeze\(\{\s*siteToken:\s*"([^"]*)"/)?.[1] ?? "";
const reportingSiteTag = String(worker.vars?.CF_ANALYTICS_SITE_TAG ?? "");
const accountId = String(worker.vars?.CF_ANALYTICS_ACCOUNT_ID ?? "");
const valid = /^[a-f0-9]{32}$/i;

if (!valid.test(publicBeaconToken)) throw new Error("Public Web Analytics beacon site_token is missing or malformed.");
if (!valid.test(reportingSiteTag)) throw new Error("Worker GraphQL siteTag is missing or malformed.");
if (!valid.test(accountId)) throw new Error("Worker GraphQL account ID is missing or malformed.");

if (publicBeaconToken === reportingSiteTag) {
  throw new Error("Public beacon site_token must not be mistaken for the Worker GraphQL siteTag; see PR #60.");
}

if (Object.hasOwn(worker.vars ?? {}, "CF_ANALYTICS_READ_TOKEN")) {
  throw new Error("Private CF_ANALYTICS_READ_TOKEN must be a Worker secret, not a checked-in Wrangler var.");
}

console.log("Analytics source checks PASS: distinct public beacon token and Worker reporting siteTag.");
console.log("PR #60 regression test verifies the expected reporting property. This check cannot confirm LIVE Worker settings or real visitor counts.");
