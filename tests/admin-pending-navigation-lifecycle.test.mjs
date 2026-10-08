import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../admin/js/admin-shell.js", import.meta.url)), "utf8");
const routerSource = source.slice(
  source.indexOf("const WORKSPACE_ROUTE_PATTERN"),
  source.indexOf("if (window.top !== window.self)")
).replace(
  /const SYSTEM_HEALTH_API = Object\.freeze\(\{[\s\S]*?\}\);/,
  "const SYSTEM_HEALTH_API = Object.freeze({});"
);

assert.ok(routerSource.includes("function startPersistentAdminShell()"));

const tick = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};

class FixtureFrame {
  constructor() {
    this.dataset = {};
    this.className = "";
    this.title = "";
    this.isConnected = false;
    this.listeners = new Map();
    this.classList = { add() {}, remove() {} };
    this.contentDocument = {
      readyState: "loading",
      body: { classList: { contains: () => false } },
      documentElement: { dataset: {} },
      defaultView: { dispatchEvent() {} }
    };
    this.contentWindow = { location: { href: "" } };
  }
  set src(route) {
    this.route = route;
    this.contentWindow.location.href = new URL(route, "https://staging.example/admin/").href;
  }
  addEventListener(type, handler, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ handler, once: Boolean(options.once) });
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.handler !== handler));
  }
  emit(type) {
    for (const entry of [...(this.listeners.get(type) || [])]) {
      if (entry.once) this.removeEventListener(type, entry.handler);
      entry.handler({ type, target: this });
    }
  }
  remove() {
    this.isConnected = false;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createShell({ approvals = [] } = {}) {
  const frames = [];
  const requests = [];
  const historyCalls = [];
  const host = {
    dataset: {},
    setAttribute() {},
    append(frame) { frame.isConnected = true; frames.push(frame); }
  };
  const sidebar = { addEventListener() {} };
  const listeners = {};
  const location = {
    href: "https://staging.example/admin/shell.html?workspace=dashboard.html",
    origin: "https://staging.example",
    replace(url) { this.redirect = url; }
  };
  const history = {
    replaceState(state) { historyCalls.push(["replace", state.workspace]); },
    pushState(state) { historyCalls.push(["push", state.workspace]); }
  };
  const window = {
    __LAN_ADMIN_READY__: Promise.resolve({ authorized: true, user: { uid: "admin-fixture" } }),
    addEventListener(type, handler) { listeners[type] = handler; },
    setTimeout(handler) { handler(); }
  };
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) { return id === "adminWorkspaceHost" ? host : null; },
    querySelector(selector) { return selector.includes("sidebar") ? sidebar : null; },
    querySelectorAll() { return []; },
    createElement(name) {
      assert.equal(name, "iframe");
      return new FixtureFrame();
    },
    addEventListener() {}
  };
  const execute = new Function(
    "window", "document", "location", "history", "HTMLIFrameElement",
    "MutationObserver", "CustomEvent", "URL", "requestAnimationFrame",
    "validateCurrentSecuritySession", "stopSystemHealthMonitor", "startSystemHealthMonitor",
    routerSource + "\nstartPersistentAdminShell();"
  );
  execute(
    window, document, location, history, FixtureFrame,
    class { observe() {} },
    class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    URL, callback => callback(),
    () => {
      const approval = approvals[requests.length] || Promise.resolve();
      requests.push(approval);
      return approval;
    },
    () => {}, () => {}
  );
  return { frames, requests, host, window, location, historyCalls };
}

test("rapid navigation cancels obsolete iframe immediately before starting another", async () => {
  const shell = createShell();
  await tick();
  const initial = shell.frames[0];
  initial.emit("load");
  await tick();
  assert.equal(initial.isConnected, true);
  assert.equal(shell.host.dataset.lanWorkspaceState, "ready");

  shell.window.LANAdminNavigate("pages/home.html");
  const obsolete = shell.frames[1];
  assert.equal(obsolete.isConnected, true);

  shell.window.LANAdminNavigate("pages/projects.html");
  const current = shell.frames[2];
  assert.equal(obsolete.isConnected, false, "obsolete loading iframe must be discarded immediately");
  assert.equal(initial.isConnected, true, "active workspace must remain while new frame loads");
  assert.equal(current.isConnected, true);

  obsolete.emit("load");
  await tick();
  assert.equal(initial.isConnected, true);
  current.emit("load");
  await tick();
  assert.equal(shell.host.dataset.lanWorkspaceState, "ready");
  assert.equal(current.dataset.workspaceRoute, "pages/projects.html");
  assert.equal(initial.isConnected, false, "old active frame retires only after new frame approval");
  assert.equal(shell.historyCalls.at(-1)[1], "pages/projects.html");
});

test("canceled iframe never activates after late server approval", async () => {
  const gate = deferred();
  const shell = createShell({ approvals: [Promise.resolve(), gate.promise] });
  await tick();
  shell.frames[0].emit("load");
  await tick();

  shell.window.LANAdminNavigate("pages/home.html");
  const obsolete = shell.frames[1];
  obsolete.emit("load");
  shell.window.LANAdminNavigate("pages/settings.html");
  const current = shell.frames[2];
  current.emit("load");

  assert.equal(obsolete.isConnected, false);
  assert.equal(shell.frames[0].isConnected, true);
  gate.resolve();
  await tick();
  assert.equal(current.isConnected, true);
  assert.equal(shell.historyCalls.at(-1)[1], "pages/settings.html");
  assert.equal(obsolete.isConnected, false);
  assert.equal(shell.location.redirect, undefined);
});
