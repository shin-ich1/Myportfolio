import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
const first = src.indexOf("async function loadOpenversePuzzleImagePool(");
const last = src.indexOf("\nfunction puzzleImageCacheKey(", first);
assert.ok(first >= 0 && last > first, "Use the existing canonical Openverse image selection implementation");
const canonical = src.slice(first, last);
const fallbackStart = src.indexOf("const MESSAGE_PUZZLE_OPENVERSE_SEARCH_TIMEOUT_MS =");
const fallbackEnd = fallbackStart >= 0 ? src.indexOf("const MESSAGE_PUZZLE_IMAGE_QUERIES =", fallbackStart) : -1;
const fallbackOwner = fallbackStart >= 0 && fallbackEnd > fallbackStart
  ? src.slice(fallbackStart, fallbackEnd) : "";


function workerHarness(fetchStub, { prime } = {}) {
  const records = new Map();
  let fetchCalls = 0;
  const store = {
    get: async (key) => records.get(key) ?? null,
    put: async (key, value) => records.set(key, typeof value === "string" ? JSON.parse(value) : value)
  };
  const fastAbortSignal = {
    timeout() {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("Openverse search timed out")), 20);
      return controller.signal;
    }
  };
  const fixtures = {
    store, fetch: (...args) => { fetchCalls++; return fetchStub(...args); },
    AbortSignal: fastAbortSignal,
    primePuzzleImage: prime || (async (image) => ({ ...image, deliveryUrl:image.sourceUrl })),
    randomInteger: (min) => min
  };
  const helpers = [
    "const { store, fetch, AbortSignal, primePuzzleImage, randomInteger } = f;",
    'const MESSAGE_PUZZLE_IMAGE_QUERIES = ["landscape photography","nature photography","mountain landscape photography"];',
    "const MESSAGE_PUZZLE_IMAGE_PAGE_SIZE = 20;",
    "const MESSAGE_PUZZLE_IMAGE_POOL_TTL_SECONDS = 21600;",
    "const MESSAGE_PUZZLE_READY_POOL_TTL_SECONDS = 21600;",
    "const MESSAGE_PUZZLE_READY_POOL_SEARCHES = 3;",
    "const MESSAGE_PUZZLE_QUALITY_SELECTION_LIMIT = 18;",
    "const MESSAGE_PUZZLE_READY_POOL_TARGET = 8;",
    "const MESSAGE_PUZZLE_READY_POOL_PRIME_BATCH = 4;",
    'const OPENVERSE_IMAGE_SEARCH_URL = "https://api.openverse.org/v1/images/";',
    "let messagePuzzleReadyPoolPromise = null;",
    "const pushStore = () => store;",
    "const serviceError = (message, options = {}) => Object.assign(new Error(message), options);",
    'const privateMessageImagePoolKey = (index, page) => "pool:" + index + ":" + page;',
    'const privateMessageImageHistoryKey = (binding) => "history:" + binding;',
    'const privateMessageReadyImagePoolKey = () => "ready-v2";',
    'const safeExternalHttpUrl = (value) => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } };',
    "const normalizeOpenversePuzzleImage = (item) => item;",
    fallbackOwner,
    canonical,
    "return { chooseOpenversePuzzleImage, readyOpenversePuzzleImagePool };"
  ].join("\n");
  const result = new Function("f", helpers)(fixtures);
  return { ...result, get fetchCalls() { return fetchCalls; }, records };
}

const bound = (promise, maxMs = 800) =>
  Promise.race([promise, new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Challenge still blocked by Openverse")), maxMs))]);

test("Openverse HTTP 502/503 cannot block Public Message puzzle when a licensed fallback can be prepared", async () => {
  const fixture = workerHarness(async () => ({ok:false, status:502}));
  const image = await bound(fixture.chooseOpenversePuzzleImage({}, "visitor-1"));
  assert.ok(image, "An offline fallback is required when upstream search fails");
  assert.match(image.sourceUrl, /^https:\/\//);
  assert.ok(["cc0", "pdm"].includes(image.license), "Fallback must satisfy existing Public Domain/CC0 license policy");
  assert.match(image.landingUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.ok(image.width >= 960 && image.height >= 540, "Fallback must preserve puzzle image quality");
  assert.ok(fixture.fetchCalls >= 1, "Regression reproduces a real upstream search failure");
  const before = fixture.fetchCalls;
  await bound(fixture.chooseOpenversePuzzleImage({}, "visitor-2"));
  assert.equal(fixture.fetchCalls, before, "Fallback pool must be cached instead of hammering the failing provider");
});

test("A never-settling Openverse fetch must be aborted and use a fallback", async () => {
  let aborted = 0;
  const fixture = workerHarness((url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      aborted++;
      reject(new Error("aborted"));
    }, {once:true});
  }));
  const image = await bound(fixture.chooseOpenversePuzzleImage({}, "visitor-3"));
  assert.ok(image && image.sourceUrl.startsWith("https://"), "Upstream hang must not leave puzzle preparing forever");
  assert.ok(aborted > 0, "Worker must actually abort slow upstream requests");
});

test("If no external image can be fetched, fail closed without minting an unverified puzzle", async () => {
  const fixture = workerHarness(async () => ({ok:false, status:503}), {
    prime: async () => null
  });
  await assert.rejects(bound(fixture.chooseOpenversePuzzleImage({}, "visitor-4")),
    /image|unavailable|prepared/i);
});
