// Read-only, opt-in performance evidence collector for the PUBLIC portfolio.
// No authentication, browser mutation, local writes, or deployments. No country is inferred.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

export const PUBLIC_ORIGIN = "https://rolando-portfolio-3f1a3.web.app";
export const PUBLIC_STATIC_PATHS = Object.freeze([
  "/", "/styles.css", "/app.js", "/static-image-renditions.js"
]);

function metric(audits, key, digits = 1) {
  const value = audits?.[key]?.numericValue;
  return typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(digits)) : null;
}

export function summarizeLighthouse(report, label = "unlabeled") {
  // Supports standalone Lighthouse JSON and the PageSpeed Insights API envelope.
  const lhr = report?.lighthouseResult ?? report;
  if (!lhr || typeof lhr !== "object" || !lhr.audits) {
    throw new TypeError("Expected Lighthouse JSON with an audits object.");
  }
  const audits = lhr.audits;
  const score = lhr.categories?.performance?.score;
  const result = {
    label: String(label).slice(0, 120),
    kind: "Lighthouse lab metrics (not international field measurements)",
    performanceScore: typeof score === "number" && Number.isFinite(score)
      ? Math.round(score * 100) : null,
    firstContentfulPaintMs: metric(audits, "first-contentful-paint"),
    largestContentfulPaintMs: metric(audits, "largest-contentful-paint"),
    speedIndexMs: metric(audits, "speed-index"),
    totalBlockingTimeMs: metric(audits, "total-blocking-time"),
    cumulativeLayoutShift: metric(audits, "cumulative-layout-shift", 3)
  };
  result.investigate = {
    lcp: result.largestContentfulPaintMs === null
      ? "not measured" : result.largestContentfulPaintMs > 2500,
    cls: result.cumulativeLayoutShift === null
      ? "not measured" : result.cumulativeLayoutShift > 0.1,
    tbtLabOnly: result.totalBlockingTimeMs === null
      ? "not measured" : result.totalBlockingTimeMs > 200
  };
  return result;
}

export async function probePublicAssets(fetchImpl = fetch) {
  const rows = [];
  for (const path of PUBLIC_STATIC_PATHS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const start = performance.now();
    try {
      // Exact same-origin PUBLIC URLs only, GET only; redirects are rejected.
      const response = await fetchImpl(PUBLIC_ORIGIN + path, {
        method: "GET", redirect: "error", signal: controller.signal
      });
      const firstByteMs = Math.round(performance.now() - start);
      const decodedBytes = (await response.arrayBuffer()).byteLength;
      rows.push({
        path, status: response.status,
        firstByteMs, totalMs: Math.round(performance.now() - start),
        decodedBytes,
        cacheControl: response.headers.get("cache-control"),
        contentEncoding: response.headers.get("content-encoding"),
        contentType: response.headers.get("content-type"),
        note: "TTFB and duration measured only from the machine running this command"
      });
    } catch (error) {
      // Never echo request URLs, bodies, tokens, or potentially sensitive error messages.
      rows.push({ path, status: "error", errorType:
        error?.name === "AbortError" ? "timeout" : "network_or_redirect_error" });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    origin: PUBLIC_ORIGIN,
    scope: "Public static GETs, local runner only; NOT a multi-country speed test",
    measurements: rows
  };
}

function usage() {
  return [
    "Read-only international performance preparation (NO DEPLOY).",
    "  node scripts/public-performance-readonly.mjs --probe",
    "  node scripts/public-performance-readonly.mjs --report path/to/lighthouse.json --label \"mobile / country / run 1\"",
    "  node scripts/public-performance-readonly.mjs --help",
    "The --probe measures the runner's network only. --report parses a saved Lighthouse JSON.",
    "This script cannot measure remote users, INP field data, or real mobile networks by itself."
  ].join("\n");
}

async function main(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    console.log(usage());
    return;
  }
  if (argv.length === 1 && argv[0] === "--probe") {
    console.log(JSON.stringify(await probePublicAssets(), null, 2));
    return;
  }
  if ((argv.length === 2 || argv.length === 4) && argv[0] === "--report"
      && argv[1] && (argv.length === 2 || (argv[2] === "--label" && argv[3]))) {
    const raw = await readFile(resolve(argv[1]), "utf8");
    console.log(JSON.stringify(summarizeLighthouse(JSON.parse(raw),
      argv.length === 4 ? argv[3] : "unlabeled"), null, 2));
    return;
  }
  throw new Error("Invalid arguments. Use --help for supported read-only commands.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Do not print raw JSON content, URLs, secrets, or arbitrary server responses.
    console.error(error instanceof SyntaxError ? "Invalid JSON report."
      : error instanceof TypeError ? "Unsupported Lighthouse report format."
      : "Performance report/probe command failed. Check the file path and syntax.");
    process.exitCode = 1;
  });
}
