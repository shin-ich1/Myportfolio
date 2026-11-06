// Read-only Cloudflare Web Analytics consistency check.
// Does not change tokens, site properties, Worker secrets, or LIVE configuration.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = readFileSync(fileURLToPath(new URL("../config.js", import.meta.url)), "utf8");
const wrangler = readFileSync(fileURLToPath(new URL("../telemetry-worker/wrangler.jsonc", import.meta.url)), "utf8");

const beacon = config.match(/webAnalyticsConfig\s*=\s*Object\.freeze\(\{\s*siteToken:\s*"([^"]*)"/)?.[1] ?? "";
const worker = wrangler.match(/"CF_ANALYTICS_SITE_TAG"\s*:\s*"([^"]*)"/)?.[1] ?? "";
const valid = /^[a-f0-9]{32}$/i;

if (beacon && !valid.test(beacon)) throw new Error("Frontend Analytics beacon site token is malformed.");
if (worker && !valid.test(worker)) throw new Error("Worker Analytics GraphQL site tag is malformed.");

if (!beacon || !worker) {
  console.warn("REVIEW: Web Analytics is not fully configured in the frontend/Worker checked-in settings.");
} else if (beacon !== worker) {
  console.warn("REVIEW: Frontend beacon site token and Worker RUM GraphQL siteTag differ.");
  console.warn("These normally identify the same Cloudflare Web Analytics property. Confirm the correct value in the Cloudflare dashboard before any change.");
  console.warn("No credentials or token values were printed; no changes were made.");
} else {
  console.log("Cloudflare Web Analytics site tag references agree (format checked).");
}
console.log("Account ID and the private CF_ANALYTICS_READ_TOKEN are separate values and must NOT be copied into the public beacon.");
