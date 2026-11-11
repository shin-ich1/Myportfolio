import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("Initial Hero fetch is hinted after verified core data but before slower independent collections settle", async () => {
  const start = app.indexOf("async function loadPublicPortfolioData(deadline = 0) {");
  const end = app.indexOf("  const loaded = new Map();", start);
  assert.ok(start >= 0 && end > start, "Use the canonical Public startup owner");
  const fragment = app.slice(start, end) + "  return results;\n}\n";
  const events = [];
  let releaseCollections;
  const pendingCollections = new Promise(resolve => { releaseCollections = resolve; });
  const added = [];
  const state = {
    Promise, Map, Set, Date,
    loadedPublicCollections: new Set(), sourceMaps: new Map(),
    dynamicPortfolioModuleRegistry: [], publicFeatureSections: [], publicServices: null,
    portfolioModuleRegistry: [],
    loadPublicSingleton: async name => {
      events.push("singleton:" + name);
      return name === "home" ? { portrait: "assets/images/hero.png" } : {};
    },
    loadPublicCollection: async name => {
      events.push("collection:" + name);
      await pendingCollections;
      return [];
    },
    loadPublicCapabilities: async () => { events.push("capabilities"); },
    normalizeServices: item => item,
    applySingletonContent: () => { events.push("core-normalized"); },
    content: { hero: { image: "assets/images/hero.png" } },
    staticImageRendition: () => "/assets/images/hero.card.webp",
    mediaUrl: url => url,
    safeImageSource: url => url,
    document: {
      head: { append: node => { added.push(node); events.push("hero-hint"); } },
      createElement: tag => {
        assert.equal(tag, "link");
        return {};
      }
    },
    console: { warn() {}, log() {} }
  };
  runInNewContext(fragment, state);
  const loading = state.loadPublicPortfolioData(Date.now() + 10000);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(events.includes("core-normalized"), "Must await canonical core normalization");
  assert.equal(events.filter(x => x === "hero-hint").length, 1,
    "Hint must start while independent collections are still outstanding");
  assert.equal(added[0].rel, "preload");
  assert.equal(added[0].as, "image");
  assert.equal(added[0].href, "/assets/images/hero.card.webp");
  assert.equal(added[0].fetchPriority, "high");
  assert.equal(events.filter(x => x.startsWith("singleton:")).length, 4,
    "Do not add Firestore queries");
  assert.equal(events.filter(x => x.startsWith("collection:")).length, 8,
    "Do not remove public data reads");
  releaseCollections();
  const loaded = await loading;
  assert.equal(loaded.length, 8);
});

test("Public Hero warmup is startup-only, safe-URL only, and does not run on refresh", async () => {
  const start = app.indexOf("async function loadPublicPortfolioData(deadline = 0) {");
  const end = app.indexOf("  const loaded = new Map();", start);
  assert.ok(start >= 0 && end > start);
  const fragment = app.slice(start, end) + "  return results;\n}\n";
  async function run(deadline, hero, valid) {
    const hints = [];
    const state = {
      Promise, Map, Set, Date,
      loadedPublicCollections: new Set(), sourceMaps: new Map(),
      dynamicPortfolioModuleRegistry: [], publicFeatureSections: [], publicServices: null,
      portfolioModuleRegistry: [],
      loadPublicSingleton: async () => ({}),
      loadPublicCollection: async () => [],
      loadPublicCapabilities: async () => {},
      normalizeServices: value => value,
      applySingletonContent: () => {},
      content: { hero: { image: hero } },
      staticImageRendition: value => value,
      mediaUrl: value => value,
      safeImageSource: value => valid ? value : "",
      document: { head: { append: node => hints.push(node) }, createElement: () => ({}) },
      console: { warn() {} }
    };
    runInNewContext(fragment, state);
    await state.loadPublicPortfolioData(deadline);
    return hints;
  }
  assert.equal((await run(0, "assets/images/hero.png", true)).length, 0, "Background refresh must not preload");
  assert.equal((await run(Date.now() + 5000, "", true)).length, 0, "Empty CMS image must not preload");
  assert.equal((await run(Date.now() + 5000, "javascript:alert(1)", false)).length, 0, "Invalid media URL must not preload");
  assert.equal((await run(Date.now() + 5000, "assets/images/hero.png", true)).length, 1);
});

test("Hero warmup has no duplicate media resolver, layout, fallback, or security owner", () => {
  const start = app.indexOf("async function loadPublicPortfolioData(deadline = 0) {");
  const end = app.indexOf("  const loaded = new Map();", start);
  const early = app.slice(start, end);
  assert.match(early, /safeImageSource\(mediaUrl\(staticImageRendition\(content\.hero\.image,\s*"card"\),\s*\{\s*delivery:\s*"card"\s*\}\)\)/);
  assert.doesNotMatch(early, /new Image\(|getDoc\(|getDocs\(|addEventListener\(|innerHTML\s*=/);
  assert.match(app, /data-public-static-fallback="\$\{escapeHtml\(content\.hero\.image\)\}"/,
    "Existing canonical Hero error fallback must stay intact");
});
