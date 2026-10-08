import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(navigate, /if\s*\(!approved\s*\|\|\s*!loaded\)/);
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
