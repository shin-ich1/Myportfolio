import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

// The 2026-11-11 cold-load trace shows the Hero IMG initially occupying only
// its 2px border before an image response expands the image and moves hero-copy
// by ~428px at a 473px viewport. Native width/height attributes alone do not
// reserve the used width while the canonical CSS explicitly says width:auto.
const start = app.indexOf("function portraitDimensionAttributes(");
const end = app.indexOf("\nfunction browserPdfViewerSource(", start);
assert.ok(start >= 0 && end > start, "Expected existing canonical portrait geometry helper");
const portraitDimensionAttributes = new Function(
  app.slice(start, end) + "\nreturn portraitDimensionAttributes;"
)();

test("Known Hero geometry reserves the actual border-box width before loading", () => {
  const attrs = portraitDimensionAttributes({ width: 960, height: 1443 });
  assert.equal(attrs,
    ' width="960" height="1443" style="--portrait-render-width:min(962px,calc(2px + (var(--portrait-max-height) - 2px) * 960 / 1443))"',
    "Known portrait metadata must specify a responsive reserved width while preserving native dimensions");
});

test("Unknown and invalid metadata remain fail-safe and cannot inject CSS", () => {
  for (const value of [null, {}, { width: 0, height: 1443 },
    { width: 960, height: Infinity }, { width: 33000, height: 1443 },
    { width: "10; color:red", height: 20 }]) {
    assert.equal(portraitDimensionAttributes(value), "");
  }
});

test("The original Hero owner uses one metadata-driven sizing rule across adaptive modes", () => {
  const hero = styles.slice(styles.indexOf("/* ---------- hero ---------- */"),
    styles.indexOf("/* ---------- panels ---------- */"));
  assert.match(hero, /--portrait-max-height:\s*600px/);
  assert.match(hero, /width:\s*var\(--portrait-render-width,\s*auto\)/);
  assert.equal((styles.match(/width:\s*var\(--portrait-render-width,\s*auto\)/g) || []).length, 1,
    "Do not add competing Hero width overrides");
  const adaptive = styles.slice(styles.indexOf("/* ---------- canonical public adaptive modes ---------- */"));
  assert.match(adaptive, /html\[data-lan-public-mode="compact"\]\s+\.hero-img img,[\s\S]*?--portrait-max-height:\s*500px/);
  assert.match(adaptive, /html\[data-lan-public-mode="mobile"\]\s+\.hero-img img\s*\{[^}]*--portrait-max-height:\s*430px/);
  assert.match(hero, /max-width:\s*min\(100%,\s*560px\)/);
  assert.match(hero, /max-height:\s*600px/);
  assert.match(adaptive, /html\[data-lan-public-mode="mobile"\]\s+\.hero\s*\{\s*gap:28px;padding:34px 0 32px;\s*\}/,
    "Do not change the approved mobile Hero spacing");
});

test("Hero remains the sole consumer of the existing portrait dimension helper", () => {
  const heroLine = app.split("\n").find(line => line.includes('class="hero-img"><img')) || "";
  assert.ok(heroLine.includes('$' + '{portraitDimensionAttributes(content.hero.imageDimensions)}'),
    "Apply the image metadata at the canonical Hero renderer, not via a duplicate handler");
  assert.equal((app.match(/portraitDimensionAttributes\(content\.hero\.imageDimensions\)/g) || []).length, 1);
});
