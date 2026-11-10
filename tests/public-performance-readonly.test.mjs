import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  PUBLIC_ORIGIN, PUBLIC_STATIC_PATHS,
  summarizeLighthouse, probePublicAssets
} from "../scripts/public-performance-readonly.mjs";

const cli = fileURLToPath(new URL("../scripts/public-performance-readonly.mjs", import.meta.url));

test("performance helper defaults to offline usage without fetching", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO DEPLOY/);
  assert.match(result.stdout, /runner.s network only/);
  assert.doesNotMatch(result.stdout, /secret|private.key|password/i);
});

test("Lighthouse summary keeps lab metrics separate and does not print raw URLs", () => {
  const sample = {
    lighthouseResult: {
      finalUrl: "https://example.invalid/?private_token=dont-echo",
      categories: {performance: {score: 0.91}},
      audits: {
        "first-contentful-paint": {numericValue: 1250.245},
        "largest-contentful-paint": {numericValue: 2701.5},
        "speed-index": {numericValue: 1900},
        "total-blocking-time": {numericValue: 250},
        "cumulative-layout-shift": {numericValue: 0.042}
      }
    }
  };
  const summary = summarizeLighthouse(sample, "US / mobile / run 1");
  assert.equal(summary.performanceScore, 91);
  assert.equal(summary.largestContentfulPaintMs, 2701.5);
  assert.equal(summary.cumulativeLayoutShift, 0.042);
  assert.deepEqual(summary.investigate, {lcp: true, cls: false, tbtLabOnly: true});
  assert.match(summary.kind, /not international field measurements/);
  assert.doesNotMatch(JSON.stringify(summary), /private_token|example\.invalid/);
});

test("missing Lighthouse metrics are not invented", () => {
  const result = summarizeLighthouse({audits: {}});
  assert.equal(result.largestContentfulPaintMs, null);
  assert.equal(result.investigate.lcp, "not measured");
  assert.equal(result.investigate.cls, "not measured");
  assert.throws(() => summarizeLighthouse({}), /audits object/);
});

test("static probe only issues public same-origin GETs and never exposes response bodies", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({url, method: options.method, redirect: options.redirect, hasSignal: !!options.signal});
    return {
      status: 200,
      headers: {get: name => name === "cache-control" ? "no-cache" : null},
      arrayBuffer: async () => new TextEncoder().encode("SECRET_IN_BODY").buffer
    };
  };
  const result = await probePublicAssets(fakeFetch);
  assert.equal(result.measurements.length, 4);
  assert.deepEqual(requests.map(x => x.url), PUBLIC_STATIC_PATHS.map(p => PUBLIC_ORIGIN + p));
  assert.ok(requests.every(x => x.method === "GET" && x.redirect === "error" && x.hasSignal));
  assert.ok(result.measurements.every(x => x.decodedBytes === 14 && x.status === 200));
  assert.doesNotMatch(JSON.stringify(result), /SECRET_IN_BODY/);
  assert.match(result.scope, /NOT a multi-country speed test/);
});

test("static probe fails closed on network error without logging request secrets", async () => {
  const result = await probePublicAssets(async () => { throw new Error("secret=private"); });
  assert.ok(result.measurements.every(x => x.errorType === "network_or_redirect_error"));
  assert.doesNotMatch(JSON.stringify(result), /secret=private/);
});
