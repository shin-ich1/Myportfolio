import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../admin/js/settings.js", import.meta.url)), "utf8");
const between = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Canonical Settings block must remain discoverable: " + start);
  return source.slice(a, b);
};

test("Settings startup does not fetch its asset inventory separately from realtime telemetry", () => {
  const start = between("async function start() {", 'window.addEventListener("pagehide", stopTelemetryRealtime');
  assert.doesNotMatch(start, /\["asset inventory", countAssets\]/,
    "Initial asset counts must come from the existing telemetry collection snapshots");
  assert.match(start, /startTelemetryRealtime\(\)/,
    "Keep the canonical realtime listeners, not a duplicate data owner");
});

test("Settings asset counts reuse provided complete snapshots without a duplicate Firestore read", async () => {
  const code = between("function walkValues(", "function diagnosticServiceGlyph(");
  let reads = 0;
  const labels = new Map();
  const { countAssets } = runInNewContext(code + "\n({ countAssets })", {
    readModule: async () => { reads++; throw Error("Unexpected duplicate Firestore read"); },
    setText: (key, value) => labels.set(key, value),
    document: { querySelectorAll: () => [] },
    $: () => null,
    syncAppearancePreview: () => {}
  });

  await countAssets([
    { name: "projects", records: [{ coverImageUrl: "https://cdn.example.invalid/hero.png" }] },
    { name: "portfolioSectionEntries", records: [{ documentUrl: "https://cdn.example.invalid/resume.pdf" }] }
  ]);
  assert.equal(reads, 0);
  assert.equal(labels.get("uploadedImageCount"), 1);
  assert.equal(labels.get("uploadedPdfCount"), 1);
  assert.equal(labels.get("settingsMediaTotal"), 2);
});

test("Settings realtime baseline refreshes asset counts from the same complete snapshot set", () => {
  const start = between("function startTelemetryRealtime() {", "function walkValues(");
  assert.match(start, /if\s*\(complete\)[\s\S]*?countAssets\(/,
    "All telemetry listeners must settle before computing the asset inventory");
  assert.match(start, /telemetryFeatureEntries/,
    "Generated module entry assets must remain counted");
  assert.match(start, /portfolioSectionEntries/,
    "The existing entries listener is the source for asset inventory");
  assert.match(start, /stopTelemetryRealtime\(\)/,
    "Previous listeners must be stopped before starting another");
});
