import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Regression harness executes the real canonical public startup orchestration.
// Firestore is mocked: no live network, credentials, messages, or data changes.
const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const begin = source.indexOf("async function loadPublicPortfolioData(deadline = 0) {");
const end = source.indexOf("  const featureEntries =", begin);
assert.ok(begin >= 0 && end > begin, "Find canonical loadPublicPortfolioData source");
const fragment = source.slice(begin, end) + "  return loaded;\n}\n";

function makeHarness() {
  const operations = [];
  const pending = new Map();
  const completed = new Set();
  const context = {
    Date, Map, Set, Promise,
    loadedPublicCollections: new Set(),
    sourceMaps: new Map(),
    dynamicPortfolioModuleRegistry: [],
    publicFeatureSections: [],
    publicServices: null,
    portfolioModuleRegistry: [{active: true, collection: "projects"}],
    normalizeServices: value => value,
    applySingletonContent: () => { operations.push("applySingletonContent"); },
    loadPublicSingleton: key => {
      operations.push("singleton:" + key);
      return new Promise((resolve, reject) => pending.set(key, {resolve, reject}));
    },
    loadPublicCapabilities: async () => {
      operations.push("capabilities");
    },
    loadPublicCollection: async name => {
      operations.push("collection:" + name);
      return [{id: name + "-fixture", status:"published", visible:true}];
    },
    console: {warn: () => {}, log: () => {}}
  };
  runInNewContext(fragment, context, {filename:"app.js public startup fragment"});
  return {operations, pending, completed, run: context.loadPublicPortfolioData};
}

test("independent Firestore collection and capability requests start while core singleton requests are pending", async () => {
  const harness = makeHarness();
  const task = harness.run(Date.now() + 2000);
  // Give the queued Promise continuation a chance, without releasing any
  // singleton. Network requests must already have begun.
  await Promise.resolve();
  await Promise.resolve();
  const beforeRelease = [...harness.operations];
  for (const req of harness.pending.values()) req.resolve({});
  const loaded = await task;

  assert.equal(beforeRelease.filter(x => x.startsWith("singleton:")).length, 4);
  assert.ok(beforeRelease.some(x => x.startsWith("collection:")),
    "Collections must overlap with core singleton RTTs rather than waiting for all four to finish");
  assert.ok(beforeRelease.includes("capabilities"),
    "Independent capability requests must overlap with core singleton RTTs");
  assert.ok(loaded.has("projects"), "The canonical collection response must remain present");
  assert.ok(harness.operations.includes("applySingletonContent"),
    "Singleton content is still normalized before the rest of rendering consumes it");
});

test("core public singleton failure still fails closed when a startup deadline is active", async () => {
  const harness = makeHarness();
  const task = harness.run(Date.now() + 2000);
  await Promise.resolve();
  for (const [name, req] of harness.pending) {
    if (name === "home") req.reject(new Error("mock read failure"));
    else req.resolve({});
  }
  await assert.rejects(task, /Public portfolio core content could not load before the startup deadline/);
});
