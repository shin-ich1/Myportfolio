import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const source = readFileSync(fileURLToPath(new URL("../admin/js/admin-ui.js", import.meta.url)), "utf8");

function navigationFixture() {
  const start = source.indexOf("const prefetchedAdminPages = new Set();");
  const end = source.indexOf("function navigateAdminPage(", start);
  const init = source.indexOf("function initAdminNavigation()");
  const initEnd = source.indexOf("function createCommandPalette(", init);
  assert.ok(start >= 0 && end > start && init >= 0 && initEnd > init, "Canonical navigation owner must remain discoverable");
  const handlers = new Map();
  const prefetched = [];
  const links = [
    { href: "https://portfolio.example/admin/pages/home.html", target: "", hasAttribute: () => false },
    { href: "https://portfolio.example/admin/pages/settings.html", target: "", hasAttribute: () => false }
  ];
  const document = {
    head: { append: (link) => prefetched.push(link.href) },
    createElement: () => ({}),
    addEventListener: (name, listener) => handlers.set(name, listener)
  };
  const context = {
    URL,
    document,
    location: { origin: "https://portfolio.example", href: "https://portfolio.example/admin/shell.html" },
    window: { setTimeout: (callback) => callback() },
    $$: () => links
  };
  const code = source.slice(start, end) + "\n" + source.slice(init, initEnd) + "\n({ initAdminNavigation })";
  const { initAdminNavigation } = runInNewContext(code, context);
  return { initAdminNavigation, prefetched, handlers, links };
}

test("Admin startup does not eagerly prefetch all sidebar pages", () => {
  const fixture = navigationFixture();
  fixture.initAdminNavigation();
  assert.deepEqual(fixture.prefetched, [], "Only user-requested destinations should be prefetched");
});

test("Pointer and keyboard navigation still prefetch only the requested page once", () => {
  const fixture = navigationFixture();
  fixture.initAdminNavigation();
  const home = fixture.links[0];
  fixture.handlers.get("pointerenter")({ target: { closest: () => home } });
  fixture.handlers.get("focusin")({ target: { closest: () => home } });
  assert.deepEqual(fixture.prefetched, [home.href], "Interactive prefetch remains enabled and deduplicated");
});
