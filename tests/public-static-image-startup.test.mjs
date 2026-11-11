import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const STORAGE = new URL("../assets/images/", import.meta.url);

test("Public image URL policy uses prepared static variants only for an authorized static image path", async () => {
  const { staticImageRendition, STATIC_IMAGE_RENDITIONS } = await import("../static-image-renditions.js");
  const large = "assets/images/hero.png";
  assert.ok(STATIC_IMAGE_RENDITIONS[large], "Hero must have an explicitly prepared rendition");
  assert.equal(staticImageRendition(large, "card"), STATIC_IMAGE_RENDITIONS[large].card);
  assert.equal(staticImageRendition(large, "detail"), STATIC_IMAGE_RENDITIONS[large].detail);
  assert.equal(staticImageRendition("/" + large, "card"), "/" + STATIC_IMAGE_RENDITIONS[large].card);
  assert.equal(staticImageRendition("./" + large, "card"), "./" + STATIC_IMAGE_RENDITIONS[large].card);
  for (const unsafe of ["https://example.org/hero.png", "//example.org/hero.png", "../assets/images/hero.png", "assets/images/hero.png?token=secret", "javascript:alert(1)"]) {
    assert.equal(staticImageRendition(unsafe, "card"), unsafe, "Never rewrite external, private, or ambiguous URLs");
  }
  assert.equal(staticImageRendition("assets/images/future-not-yet-prepared.png", "card"), "assets/images/future-not-yet-prepared.png",
    "Future uploads are not optimistically rewritten to missing variants");
});

test("Prepared variants physically exist and replace all oversized static PNG downloads without deleting originals", async () => {
  const { STATIC_IMAGE_RENDITIONS } = await import("../static-image-renditions.js");
  const entries = Object.entries(STATIC_IMAGE_RENDITIONS);
  assert.ok(entries.length >= 35, "At least the 35 oversized static images must have derivatives");
  let bytesSaved = 0;
  for (const [source, renditions] of entries) {
    assert.ok(source.startsWith("assets/images/"), "Only bundled static originals are transformed");
    const original = resolve(source);
    assert.ok(existsSync(original), "Original must remain: " + original);
    for (const kind of ["card", "detail"]) {
      const dest = resolve(renditions[kind]);
      assert.ok(existsSync(dest), "Optimized " + kind + " must exist: " + dest);
      assert.ok(statSync(dest).size > 0, "Generated file cannot be empty");
      const bytes = readFileSync(dest);
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", "Expected real RIFF WebP bytes");
      assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", "Expected real WebP image bytes");
    }
    bytesSaved += statSync(original).size - statSync(resolve(renditions.card)).size;
  }
  assert.ok(bytesSaved > 20_000_000, "Combined card renditions should save over 20 MB from raw sources");
});

test("Public media presentation delegates static image card and detail delivery to one canonical resolver", () => {
  const start = app.indexOf("const mediaPresentation =");
  const end = app.indexOf("\nconst mediaUrl =", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /staticImageRendition\(/);
  assert.match(source, /publicCardUrl/);
  assert.match(source, /publicDetailUrl/);
  assert.doesNotMatch(source, /getDoc\(|getDocs\(|onSnapshot\(/);
  const binder = app.slice(app.indexOf("function bindPublicMediaFrames("), app.indexOf("\nfunction projectCardMediaMarkup("));
  assert.match(binder, /data-public-static-fallback/);
  assert.match(app, /staticImageRendition\(content\.hero\.image/);
  assert.match(app, /staticImageRendition\(content\.about\.image/);
});

test("Existing startup queries run capabilities alongside collections, not after them", () => {
  const source = app.slice(app.indexOf("async function loadPublicPortfolioData("), app.indexOf("\nasync function loadEmergencyFallback(", app.indexOf("async function loadPublicPortfolioData(")));
  const capability = source.indexOf("const capabilityWork = Promise.allSettled([loadPublicCapabilities(deadline)])");
  const collections = source.indexOf("const collectionWork = Promise.allSettled(collectionNames.map(");
  const awaitCollection = source.indexOf("const results = await collectionWork");
  const awaitCapabilities = source.indexOf("await capabilityWork");
  assert.ok(capability > 0 && collections > 0);
  assert.ok(capability < awaitCollection && collections < awaitCollection && awaitCollection < awaitCapabilities);
  assert.equal((source.match(/loadPublicCapabilities\(deadline\)/g)||[]).length, 1, "Must not duplicate query workloads");
  assert.equal((source.match(/loadPublicCollection\(name, deadline\)/g)||[]).length, 1);
});

test("Collection reads and capability reads begin concurrently without extra calls", async () => {
  const from = app.indexOf("async function loadPublicPortfolioData(");
  const to = app.indexOf("  const loaded = new Map();", from);
  assert.ok(from >= 0 && to > from);
  // Execute the unchanged initial part of the real startup owner, before
  // normalization (which is irrelevant to request scheduling).
  const snippet = app.slice(from, to) + "  return results;\n}";
  const launch = new Function(
    "portfolioModuleRegistry", "loadedPublicCollections", "sourceMaps",
    "loadPublicSingleton", "loadPublicCollection", "loadPublicCapabilities",
    "normalizeServices", "applySingletonContent",
    "let dynamicPortfolioModuleRegistry, publicFeatureSections, publicServices;\n" +
      snippet + "\nreturn loadPublicPortfolioData;"
  );
  const requests = [];
  let release;
  const inFlight = new Promise(resolve => { release = resolve; });
  const load = launch(
    [], new Set(), new Map(),
    async () => ({}),
    async name => { requests.push("collection:" + name); await inFlight; return []; },
    async () => { requests.push("capability"); await inFlight; },
    () => ({}),
    () => {}
  );
  const pending = load(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.filter(name => name === "capability").length, 1);
  assert.equal(requests.filter(name => name.startsWith("collection:")).length, 8);
  release();
  const settled = await pending;
  assert.equal(settled.length, 8);
  assert.ok(settled.every(result => result.status === "fulfilled"));
});

test("Hero and About portraits use card delivery for replaceable Cloudinary images without changing fallback", async () => {
  // Both portraits come from Home CMS fields. A new Cloudinary PNG must not
  // bypass the canonical card rendition simply because it is not bundled.
  const heroSource = 'src="${escapeHtml(mediaUrl(staticImageRendition(content.hero.image, "card"), { delivery: "card" }))}"';
  const aboutSource = 'src="${escapeHtml(mediaUrl(staticImageRendition(content.about.image, "card"), { delivery: "card" }))}"';
  assert.ok(app.includes(heroSource), "Hero must request optimized delivery for future CMS uploads");
  assert.ok(app.includes(aboutSource), "About must request optimized delivery for future CMS uploads");
  assert.ok(app.includes('data-public-static-fallback="${escapeHtml(content.hero.image)}"'), "Hero retains its original fallback");
  assert.ok(app.includes('data-public-static-fallback="${escapeHtml(content.about.image)}"'), "About retains its original fallback");

  const { resolveAssetUrl } = await import("../asset-resolver.js");
  const remoteOriginal = "https://res.cloudinary.com/fmbcpufk/image/upload/v1793876456/xutw6xnj5gddfnrec9nf.png";
  const card = resolveAssetUrl(remoteOriginal, "card");
  assert.match(card, /^https:\/\/res\.cloudinary\.com\/fmbcpufk\/image\/upload\/c_limit,w_1200,h_1200,f_auto,q_auto:best\/v1793876456\//);
  assert.equal(resolveAssetUrl(remoteOriginal, "original"), remoteOriginal, "Keep original quality and download source intact");
});

test("Independent public collections and capabilities launch before core singleton requests settle", async () => {
  // Execute the real startup owner with read-only mocked Firestore calls.
  const begin = app.indexOf("async function loadPublicPortfolioData(deadline = 0) {");
  const end = app.indexOf("  const featureEntries =", begin);
  assert.ok(begin >= 0 && end > begin);
  const fragment = app.slice(begin, end) + "  return loaded;\n}\n";
  const operations = [];
  const pending = new Map();
  const state = {
    Date, Map, Set, Promise,
    loadedPublicCollections: new Set(),
    sourceMaps: new Map(),
    dynamicPortfolioModuleRegistry: [],
    publicFeatureSections: [],
    publicServices: null,
    portfolioModuleRegistry: [{ active: true, collection: "projects" }],
    normalizeServices: value => value,
    applySingletonContent: () => { operations.push("normalize-core"); },
    loadPublicSingleton: name => {
      operations.push("singleton:" + name);
      return new Promise((fulfill, reject) => pending.set(name, { fulfill, reject }));
    },
    loadPublicCollection: async name => {
      operations.push("collection:" + name);
      return [{ id: name + "-fixture", status: "published", visible: true }];
    },
    loadPublicCapabilities: async () => { operations.push("capabilities"); },
    console: { warn() {}, log() {} }
  };
  runInNewContext(fragment, state);
  const request = state.loadPublicPortfolioData(Date.now() + 2000);
  await Promise.resolve();
  await Promise.resolve();
  const beforeRelease = [...operations];
  for (const controller of pending.values()) controller.fulfill({});
  const loaded = await request;
  assert.equal(beforeRelease.filter(value => value.startsWith("singleton:")).length, 4);
  assert.ok(beforeRelease.some(value => value.startsWith("collection:")),
    "Independent collection requests must not wait behind the four singleton round trips");
  assert.ok(beforeRelease.includes("capabilities"),
    "Capabilities must start in the same startup network phase");
  assert.ok(loaded.has("projects"));
  assert.ok(operations.includes("normalize-core"));
});

test("Startup overlap preserves fail-closed core content when a deadline is active", async () => {
  const begin = app.indexOf("async function loadPublicPortfolioData(deadline = 0) {");
  const end = app.indexOf("  const featureEntries =", begin);
  assert.ok(begin >= 0 && end > begin);
  const fragment = app.slice(begin, end) + "  return loaded;\n}\n";
  const pending = new Map();
  const state = {
    Date, Map, Set, Promise, loadedPublicCollections: new Set(), sourceMaps: new Map(),
    dynamicPortfolioModuleRegistry: [], publicFeatureSections: [], publicServices: null,
    portfolioModuleRegistry: [],
    loadPublicSingleton: name => new Promise((fulfill, reject) => pending.set(name, {fulfill, reject})),
    loadPublicCollection: async () => [],
    loadPublicCapabilities: async () => {},
    normalizeServices: value => value,
    applySingletonContent: () => {},
    console: {warn() {}, log() {}}
  };
  runInNewContext(fragment, state);
  const request = state.loadPublicPortfolioData(Date.now() + 2000);
  await Promise.resolve();
  for(const [name, controller] of pending) {
    if(name === "home") controller.reject(new Error("offline simulated"));
    else controller.fulfill({});
  }
  await assert.rejects(request, /core content could not load before the startup deadline/i);
});
