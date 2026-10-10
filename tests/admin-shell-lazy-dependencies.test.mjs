import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ui = readFileSync(fileURLToPath(new URL("../admin/js/admin-ui.js", import.meta.url)), "utf8");
const block = (from, to) => {
  const start = ui.indexOf(from), end = ui.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, "Canonical Admin UI section must remain discoverable: " + from);
  return ui.slice(start, end);
};

test("Shared Admin UI does not eagerly import Firebase-heavy registry or media maintenance", () => {
  assert.doesNotMatch(ui, /^import\s*\{\s*listSections\s*\}\s*from\s*["']\.\.\/services\/portfolioSectionService\.js["'];/m);
  assert.doesNotMatch(ui, /^import\s*\{\s*recoverMediaAssetLifecycle\s*\}\s*from\s*["']\.\.\/services\/mediaAssetLifecycleService\.js["'];/m);
});

test("Promoted modules still load from the canonical registry owner when navigation needs them", () => {
  const navigation = block("async function syncCustomModulesNavigation()", "function initCustomModulesNavigation()");
  assert.match(navigation, /await import\(["']\.\.\/services\/portfolioSectionService\.js["']\)/);
  assert.match(navigation, /listSections\(\)/);
  assert.match(navigation, /\.filter\(\(item\)\s*=>\s*item\.lifecycle\s*===\s*["']promoted["']\)/);
});

test("Deferred media maintenance uses the same canonical service, and is not run by embedded workspaces", () => {
  const top = block("const isPersistentWorkspace =", "const $ = ");
  assert.match(top, /if\s*\(!isPersistentWorkspace\)/);
  assert.match(top, /setTimeout\(/);
  assert.match(top, /import\(["']\.\.\/services\/mediaAssetLifecycleService\.js["']\)/);
  assert.match(top, /recoverMediaAssetLifecycle\(\)/);
});

test("Existing on-demand navigation prefetch is retained", () => {
  assert.doesNotMatch(ui, /warmAdminNavigation\(\)/);
  assert.match(ui, /function prefetchAdminPage\(href\)/);
  assert.match(ui, /document\.addEventListener\(["']pointerenter["']/);
  assert.match(ui, /document\.addEventListener\(["']focusin["']/);
});
