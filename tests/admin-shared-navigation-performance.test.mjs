import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("each navigation starts server validation and document loading concurrently", () => {
  const shell = read("admin/js/admin-shell.js");
  const navigate = shell.slice(shell.indexOf("async function navigate("), shell.indexOf("function historyPush("));
  assert.match(navigate, /const securityApproval\s*=\s*ensureLiveSecuritySession\(\)/);
  assert.match(navigate, /const next\s*=\s*makeFrame\(route, revision\)/);
  assert.match(navigate, /Promise\.all\(\[securityApproval, frameLoad\]\)/);
  assert.ok(navigate.indexOf("const next = makeFrame(") < navigate.indexOf("await Promise.all("));
  assert.match(navigate, /if\s*\(!approved\s*\|\|\s*!loaded\s*\|\|\s*revision\s*!==\s*navigationRevision\)/);
  assert.match(navigate, /discardWorkspaceFrame\(next\)/);
});

test("workspace authorization waits for its own navigation's validated session", () => {
  const shell = read("admin/js/admin-shell.js");
  const host = read("admin/js/workspace-host.js");
  assert.match(shell, /LANAdminAwaitWorkspaceSecurity/);
  assert.match(shell, /frameSecurityApprovals\.set\(next, securityApproval\)/);
  assert.match(host, /LANAdminAwaitWorkspaceSecurity\?\.\(window\.frameElement\)/);
  assert.match(host, /Promise\.all\(\[shellReady, navigationApproval\]\)/);
  assert.match(host, /if\s*\(!approved\)/);
  assert.match(host, /waitForLocalFirebaseCredential\(liveUser\.uid\)/);
});

test("shared UI loads Firebase-heavy shell-only dependencies lazily", () => {
  const ui = read("admin/js/admin-ui.js");
  assert.doesNotMatch(ui, /^import \{ listSections \} from /m);
  assert.doesNotMatch(ui, /^import \{ recoverMediaAssetLifecycle \} from /m);
  assert.match(ui, /await import\("\.\.\/services\/portfolioSectionService\.js"\)/);
  assert.match(ui, /import\("\.\.\/services\/mediaAssetLifecycleService\.js"\)/);
});

test("workspace avatar uses one shell-owned Home read, not a read per page", () => {
  const ui = read("admin/js/admin-ui.js");
  assert.match(ui, /LANAdminAvatarSource/);
  assert.match(ui, /isPersistentWorkspace\s*\?\s*window\.parent/);
  assert.match(ui, /lan:admin-home-portrait-saved/);
  assert.match(ui, /if\s*\(isPersistentShell\)/);
});

test("successful Home save refreshes persistent shell avatar without another data fetch", () => {
  const home = read("admin/js/home.js");
  const save = home.slice(home.indexOf('document.getElementById("homeForm")') >= 0 ? home.indexOf('document.getElementById("homeForm")') : home.indexOf('$("homeForm").addEventListener("submit"'), home.indexOf('$("uploadPortraitButton").addEventListener('));
  assert.match(save, /await saveHome\(data\)/);
  assert.match(save, /lan:admin-home-portrait-saved/);
  assert.ok(save.indexOf("await saveHome(data)") < save.indexOf("lan:admin-home-portrait-saved"));
});

const WORKSPACES = [
  "admin/dashboard.html",
  "admin/pages/home.html",
  "admin/pages/about.html",
  "admin/pages/experience.html",
  "admin/pages/education.html",
  "admin/pages/skills.html",
  "admin/pages/projects.html",
  "admin/pages/photo-editing.html",
  "admin/pages/certificates.html",
  "admin/pages/resume.html",
  "admin/pages/contact.html",
  "admin/pages/services.html",
  "admin/pages/settings.html",
  "admin/pages/module.html"
];

for (const page of WORKSPACES) {
  test(`${page} uses the shared persistent-shell workspace and UI owners`, () => {
    const source = read(page);
    assert.match(source, /src="(?:\.\.\/)?js\/workspace-host\.js"/);
    assert.match(source, /src="(?:\.\.\/)?js\/admin-ui\.js"/);
    assert.doesNotMatch(source, /src="(?:\.\.\/)?js\/auth-guard\.js"/);
  });
}

test("the shell keeps server validation in its canonical session owner", () => {
  const shell = read("admin/js/admin-shell.js");
  assert.match(shell, /async function ensureLiveSecuritySession\(\)/);
  assert.match(shell, /await validateCurrentSecuritySession\(\)/);
  assert.match(shell, /lanSessionId|security-session|security\/session-required/);
  assert.match(shell, /location\.replace\(new URL\("index\.html\?error=session-ended"/);
});

function createBrandIconHarness({ localStorage, fetch, clock }) {
  const source = read("admin/js/admin-ui.js");
  const from = source.indexOf('  const ICONIFY_API = "https://api.iconify.design";');
  const to = source.indexOf("  async function fetchIconifySvgDataUri(", from);
  assert.ok(from > 0 && to > from, "Canonical Admin automatic icon lookup owner must remain discoverable");
  return runInNewContext(source.slice(from, to) +
    "\n({ discoverAutomaticBrandIcon })", {
    localStorage, fetch, URLSearchParams, Date: { now: () => clock.now },
    window: {}, console: { info() {} }
  });
}

test("automatic brand icon misses are cached across workspace document reloads with bounded retry", async () => {
  const saved = new Map();
  const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); }
  };
  const clock = { now: 1700000000000 };
  let requests = 0;
  const fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ icons: [] }) };
  };
  const first = createBrandIconHarness({ localStorage, fetch, clock });
  assert.equal(await first.discoverAutomaticBrandIcon("Unlisted example editor", "software tool"), "");
  assert.ok(requests > 0, "the first uncached lookup must still try remote icon discovery");
  const initialRequests = requests;

  const second = createBrandIconHarness({ localStorage, fetch, clock });
  assert.equal(await second.discoverAutomaticBrandIcon("Unlisted example editor", "software tool"), "");
  assert.equal(requests, initialRequests, "a new workspace iframe must reuse the recorded miss instead of repeating all searches");

  clock.now += 24 * 60 * 60 * 1000;
  const later = createBrandIconHarness({ localStorage, fetch, clock });
  assert.equal(await later.discoverAutomaticBrandIcon("Unlisted example editor", "software tool"), "");
  assert.ok(requests > initialRequests, "the missing-brand cache must expire so lookup may recover");
});

test("automatic brand icon discovery still resolves and reuses real matching icons", async () => {
  const saved = new Map();
  const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  };
  const clock = { now: 1700000000000 };
  let requests = 0;
  const fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ icons: ["logos:figma"] }) };
  };
  const expected = "https://api.iconify.design/logos/figma.svg";
  assert.equal(await createBrandIconHarness({ localStorage, fetch, clock }).discoverAutomaticBrandIcon("Figma", "software tool"), expected);
  assert.equal(requests, 1);
  assert.equal(await createBrandIconHarness({ localStorage, fetch, clock }).discoverAutomaticBrandIcon("Figma", "software tool"), expected);
  assert.equal(requests, 1, "successful icon lookup must remain cached across document loads");
});

test("Dashboard card navigation delegates directly to the canonical shell without a redundant HEAD probe", async () => {
  const source = read("admin/js/dashboard.js");
  const a = source.indexOf("  const editorRoutes = {");
  const b = source.indexOf("  managementCards.forEach(", a);
  assert.ok(a >= 0 && b > a, "Dashboard card navigation owner must remain discoverable");
  const body = source.slice(a, b);
  assert.doesNotMatch(body, /fetch\(|routeExists\(|method:\s*"HEAD"/,
    "All Dashboard cards target known static workspace files; no probe is required");
  const destinations = [];
  const shell = { LANAdminNavigate: href => destinations.push(href) };
  const state = runInNewContext(
    'const sectionNames = { projects: "Projects" };' +
    body + '\n({ openSection })',
    {
      window: { parent: shell, location: { href: "https://lan-portfolio-staging.web.app/admin/dashboard.html" } },
      location: { href: "https://lan-portfolio-staging.web.app/admin/dashboard.html" },
      URL, showNotification: () => { throw Error("Known route must not fail"); },
      closeSidebar: () => {}
    }
  );
  assert.equal(await state.openSection("projects"), true);
  assert.equal(destinations.length, 1, "Dashboard cards must route through exactly one shell navigation");
  assert.equal(destinations[0], "https://lan-portfolio-staging.web.app/admin/pages/projects.html");
});
