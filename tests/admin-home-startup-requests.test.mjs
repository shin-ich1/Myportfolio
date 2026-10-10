import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../admin/js/home.js", import.meta.url)), "utf8");
const block = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, "Canonical Home function boundaries must remain discoverable");
  return source.slice(start, end);
};

test("Home bootstrap shares one contact snapshot between summary and mini preview", () => {
  const loader = block("async function loadMiniModuleData(", "async function loadMiniCustomModuleData(");
  const init = block("async function init()", "// Home / Studio composes generated modules.");
  assert.match(loader, /async function loadMiniModuleData\(contactData = null\)/);
  assert.match(loader, /contact:\s*async\s*\(\)\s*=>\s*contactData\s*\?\?\s*loadContact\(\)/);
  assert.match(init, /Promise\.all\(\[\s*loadHome\(\),\s*loadContact\(\),\s*listSections\(\)\.catch\(/);
  assert.match(init, /loadMiniModuleData\(contactData\)/);
});

test("Home bootstrap resolves one section registry read and reuses it across both presentations", () => {
  const sections = block("async function renderSections(", "async function upload(");
  const init = block("async function init()", "// Home / Studio composes generated modules.");
  const boot = source.slice(source.indexOf('document.querySelector(".home-live-preview__portrait")?.addEventListener'));
  assert.match(sections, /async function renderSections\(saved = \[\], registry = undefined\)/);
  assert.match(sections, /registry = registry \?\? await listSections\(\)\.catch/);
  assert.match(init, /featureSections = registry/);
  assert.match(init, /renderSections\(data\.sections \|\| \[\], registry\)/);
  assert.match(source, /await init\(\);\s*if \(location\.hash ===/);
  assert.doesNotMatch(boot, /refreshFutureFeatures\(requestedModuleKey\)/);
  assert.match(source, /async function refreshFutureFeatures\(selectedKey = ""\).*listSections\(\)/);
});

test("concurrent Home preview reads merge their results without overwriting unrelated modules", () => {
  const builtin = block("async function loadMiniModuleData(", "async function loadMiniCustomModuleData(");
  const generated = block("async function loadMiniCustomModuleData(", "function miniOverflow(");
  const init = block("async function init()", "// Home / Studio composes generated modules.");
  assert.match(builtin, /modulePreviewData\s*=\s*\{\s*\.\.\.modulePreviewData,\s*\.\.\.Object\.fromEntries\(settled\)\s*\}/);
  assert.match(generated, /modulePreviewData\s*=\s*\{\s*\.\.\.modulePreviewData,\s*\.\.\.Object\.fromEntries\(settled\)\s*\}/);
  assert.match(init, /await Promise\.all\(\[loadMiniModuleData\(contactData\),\s*loadMiniCustomModuleData\(registry\)\]\)/);
});

test("Home refresh still fetches fresh data after initialization, without weakening security gate", () => {
  assert.match(source, /^await \(window\.__LAN_ADMIN_READY__/);
  const refresh = block("async function refreshMiniPortfolioPreview(", "function renderHomePreview(");
  assert.match(refresh, /await loadMiniModuleData\(\)/);
  assert.match(refresh, /await loadMiniCustomModuleData\(miniPortfolioRegistry\)/);
  const sections = block("async function renderSections(", "async function upload(");
  assert.match(sections, /registry = registry \?\? await listSections\(\)\.catch/);
});

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

test("real Home loaders retain both core and custom preview data regardless of fetch completion order", async () => {
  const builtinSource = block("async function loadMiniModuleData(", "async function loadMiniCustomModuleData(");
  const customSource = block("async function loadMiniCustomModuleData(", "function miniOverflow(");
  for (const customFirst of [true, false]) {
    const experience = deferred();
    const generated = deferred();
    let contactReads = 0;
    const harness = runInNewContext(
      "let modulePreviewData = {};\n" + builtinSource + "\n" + customSource +
      "\n({ loadMiniModuleData, loadMiniCustomModuleData, readPreview: () => modulePreviewData })",
      {
        loadPublishedExperiences: () => experience.promise,
        educationService: { getEducationRecords: async () => [] },
        loadProjects: async () => [],
        listPhotoEditingProjects: async () => [],
        loadCertificates: async () => [],
        loadContact: async () => { contactReads++; return { email: "fresh@example.com" }; },
        listEntries: async () => generated.promise,
        eligibleModuleEntries: (records) => records,
        publicLike: () => true,
        sortMiniRecords: (records) => records,
        console: { warn: (message) => { throw new Error(message); } }
      }
    );
    const coreTask = harness.loadMiniModuleData({ email: "shared@example.com" });
    const customTask = harness.loadMiniCustomModuleData([{ key: "generated" }]);
    if (customFirst) {
      generated.resolve([{ title: "Generated entry" }]);
      await customTask;
      experience.resolve([{ title: "Experience entry" }]);
      await coreTask;
    } else {
      experience.resolve([{ title: "Experience entry" }]);
      await coreTask;
      generated.resolve([{ title: "Generated entry" }]);
      await customTask;
    }
    const data = harness.readPreview();
    assert.equal(contactReads, 0, "initial Contact snapshot must be reused");
    assert.equal(data.contact.email, "shared@example.com");
    assert.equal(data.generated[0].title, "Generated entry");
    assert.equal(data.experience[0].title, "Experience entry");
    await harness.loadMiniModuleData();
    assert.equal(contactReads, 1, "explicit refresh fetches a new Contact snapshot");
    assert.equal(harness.readPreview().generated[0].title, "Generated entry");
    assert.equal(harness.readPreview().contact.email, "fresh@example.com");
  }
});
