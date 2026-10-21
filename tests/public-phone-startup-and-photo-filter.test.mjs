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
  assert.doesNotMatch(index, /setTimeout\(function\(\)\{document\.getElementById\(\x27siteLoader\x27\)\?\.classList\.add\(\x27is-hidden\x27\)\},7000\)/);
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

test("Mobile Photo Editing cards use a definite container-based height", () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /html\[data-lan-public-mode="mobile"\] \.public-layout-item \.editing-carousel>\.public-media-footprint-card\{height:calc\(75cqi - 3px\)/);
  assert.match(styles, /@container public-card-carousel \(max-width:33\.75rem\)/);
});

test("Photo Editing category taps preserve page scroll and do not rebuild unrelated DOM", () => {
  const start = app.indexOf('  const filterButtons = [...document.querySelectorAll("#photo-editing .filter")];');
  const end = app.indexOf('  left.addEventListener("click"', start);
  assert.ok(start >= 0 && end > start, "Expected the filter controller inside the canonical Editing carousel owner");
  const filterController = app.slice(start, end);
  const filters = ["All", "Portrait Retouching"].map(filter => ({
    dataset: { filter }, classList: {
      selected: false,
      toggle(name, selected) { if (name === "active") this.selected = selected; }
    },
    addEventListener(type, callback) {
      if (type === "click") this.click = callback;
    }
  }));
  const card = { dataset: { photoSourceId: "a" }, addEventListener(type, callback) { this[type] = callback; } };
  const track = {
    innerHTML: "<button>previous</button>",
    scrollLeft: 90,
    querySelectorAll() { return [card]; }
  };
  const documentStub = { querySelectorAll() { return filters; } };
  const windowStub = { scrollY: 650, lucide: { createIcons() {} } };
  let mediaBindings = 0;
  let galleryShapes = 0;
  let refreshed = 0;
  const buildHandler = new Function(
    "document", "track", "window", "photoItems", "photoGalleryCardsMarkup",
    "openPhotoEditingSource", "bindPublicMediaFrames", "setupPhotoGalleryMediaShapes",
    "requestAnimationFrame", "updateArrows",
    "let activeFilter='All';\n" + filterController + "\nreturn () => activeFilter;"
  );
  const getFilter = buildHandler(
    documentStub, track, windowStub,
    () => [{ id: "a", category: "Portrait Retouching" }, { id: "b", category: "Other" }],
    entries => entries.map(entry => entry.id).join(","),
    () => {}, () => { mediaBindings++; }, () => { galleryShapes++; },
    callback => callback(), () => { refreshed++; }
  );
  filters[1].click();
  assert.equal(getFilter(), "Portrait Retouching");
  assert.equal(track.innerHTML, "a");
  assert.equal(track.scrollLeft, 0, "Reset only horizontal gallery scroll");
  assert.equal(windowStub.scrollY, 650, "Keep vertical page position");
  assert.equal(filters[1].classList.selected, true);
  assert.equal(filters[0].classList.selected, false);
  assert.equal(mediaBindings, 1);
  assert.equal(galleryShapes, 1);
  assert.equal(refreshed, 1);
});


test("Public startup deadline resolves fast reads and rejects stalled requests", async () => {
  const from = app.indexOf("function withPublicStartupDeadline(");
  const to = app.indexOf("\nasync function loadPublicSingleton(", from);
  assert.ok(from >= 0 && to > from, "Expected canonical startup deadline helper");
  const withDeadline = new Function(app.slice(from, to) + "\nreturn withPublicStartupDeadline;")();
  const fast = Promise.resolve("ready");
  assert.equal(await withDeadline(fast, Date.now() + 1000), "ready");
  assert.equal(withDeadline(fast, 0), fast, "Background refresh must not add a startup deadline");
  await assert.rejects(withDeadline(new Promise(() => {}), Date.now() + 30), /startup deadline exceeded/i);
});
