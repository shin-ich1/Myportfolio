import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("Photo Editing filters update only their own gallery, never the whole portfolio", () => {
  const owner = app.match(/function setupEditingCarousel\(\)[\s\S]*?(?=\nfunction setupDynamicModuleCarousels\()/)?.[0] || "";
  assert.match(owner, /track\.innerHTML\s*=\s*photoGalleryCardsMarkup\(/);
  assert.match(owner, /bindPublicMediaFrames\(track\)/);
  assert.match(owner, /setupPhotoGalleryMediaShapes\(track\)/);
  assert.doesNotMatch(app, /querySelectorAll\(["']\.filter["']\)[^\n]*\brender\(\)/);
});

test("Photo Editing initial and filtered cards share one markup owner", () => {
  assert.match(app, /function photoGalleryCardsMarkup\(/);
  assert.match(app, /\$\{photoGalleryCardsMarkup\(gallery\)\}/);
});

test("Public adaptive mode is initialized before carousel event setup", () => {
  const render = app.match(/function render\(\)[\s\S]*?(?=\nconst PUBLIC_MESSAGE_TURNSTILE_SRC)/)?.[0] || "";
  assert.ok(render.indexOf("initPublicAdaptiveMode();") >= 0);
  assert.ok(render.indexOf("initPublicAdaptiveMode();") < render.indexOf("bind();"));
});

test("The loader never disappears just because seven seconds passed", () => {
  assert.doesNotMatch(index, /setTimeout\([^]*?siteLoader[^]*?is-hidden[^]*?,\s*7000\)/);
  assert.match(index, /portfolio is taking longer|taking longer to load/i);
  assert.match(index, /location\.reload\(\)/);
});

test("Firestore startup has a bounded deadline without weakening normal refresh", () => {
  assert.match(app, /function withPublicStartupDeadline\(/);
  assert.match(app, /async function initFirebase\(\)/);
  assert.match(app, /loadPublicPortfolioData\(deadline\)/);
  assert.match(app, /getDocs\(/);
  assert.match(app, /getDoc\(/);
  assert.match(app, /loadPublicPortfolioData\(\);/);
});