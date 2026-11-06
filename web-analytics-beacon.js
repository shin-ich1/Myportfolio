// Public Cloudflare Web Analytics beacon. Not loaded for Admin or local/staging.
import { webAnalyticsConfig } from "./config.js";

const allowedHosts = new Set([
  "rolando-portfolio-3f1a3.web.app",
  "rolando-portfolio-3f1a3.firebaseapp.com"
]);
const siteToken = String(webAnalyticsConfig.siteToken || "").trim();
if (allowedHosts.has(location.hostname) && /^[a-f0-9]{32}$/i.test(siteToken)) {
  const script = document.createElement("script");
  // Match Cloudflare’s recommended module beacon and data-cf-beacon attribute.
  script.type = "module";
  script.async = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token: siteToken });
  document.body.append(script);
}
