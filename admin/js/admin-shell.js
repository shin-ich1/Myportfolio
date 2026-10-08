/* Canonical persistent Admin shell/router.
   ---------------------------------------
   Single-owner contract:
   - shell.html is a top-level document only.
   - this module is the only owner of workspace-frame creation/navigation.
   - workspace frames may contain dashboard.html or admin/pages/*.html only.
   - a shell document can never remain mounted inside a workspace frame.

   Wide, Compact and Mobile use the same frame/scroll architecture; adaptive
   mode only changes navigation presentation and component composition. There
   is no Compact/Mobile document-height measurement path. */
import {
  cacheCloudinaryUsageSnapshot,
  clearHealthHistory,
  getCurrentSystemHealth,
  getHealthHistory,
  repairSystemService,
  runSystemDiagnostics,
  startSystemHealthMonitor,
  stopSystemHealthMonitor
} from "../services/systemHealthService.js";
import { validateCurrentSecuritySession } from "../services/adminSecurityService.js";

const WORKSPACE_ROUTE_PATTERN = /^(?:dashboard\.html|pages\/[a-z0-9-]+\.html)(?:\?[^#]*)?(?:#.*)?$/i;
const DEFAULT_WORKSPACE_ROUTE = "dashboard.html";

const SYSTEM_HEALTH_API = Object.freeze({
  cacheCloudinaryUsageSnapshot,
  clearHealthHistory,
  getCurrentSystemHealth,
  getHealthHistory,
  repairSystemService,
  runSystemDiagnostics
});

function parseWorkspaceRoute(value = "") {
  const raw = String(value || "").replace(/^\/+/, "");
  return WORKSPACE_ROUTE_PATTERN.test(raw) ? raw : "";
}

function normalizeWorkspace(value = "") {
  return parseWorkspaceRoute(value) || DEFAULT_WORKSPACE_ROUTE;
}

function workspaceRouteFromHref(href) {
  let url;
  try { url = new URL(href, location.href); } catch (_) { return ""; }
  if (url.origin !== location.origin) return "";
  const marker = "/admin/";
  const at = url.pathname.indexOf(marker);
  if (at < 0) return "";
  return parseWorkspaceRoute(`${url.pathname.slice(at + marker.length)}${url.search}${url.hash}`);
}

function requestedWorkspaceFromShellLocation() {
  let requested = "";
  try { requested = new URL(location.href).searchParams.get("workspace") || ""; } catch (_) {}
  return normalizeWorkspace(requested);
}

function workspaceUrlForNestedShell(route) {
  return new URL(normalizeWorkspace(route), new URL("./", location.href));
}

function startPersistentAdminShell() {
  const host = document.getElementById("adminWorkspaceHost");
  const nav = document.querySelector(".editor-navigation");
  const sidebar = document.querySelector(".editor-sidebar,.sidebar");
  const shellRoot = document.documentElement;
  if (!host || !sidebar) return;

  window.__LAN_PERSISTENT_ADMIN_SHELL__ = true;
  window.LANAdminSystemHealth = SYSTEM_HEALTH_API;
  host.dataset.lanWorkspaceState = "loading";
  host.setAttribute("aria-busy", "true");

  let activeFrame = null;
  let navigationRevision = 0;
  let currentHealthSnapshot = null;
  let liveSessionValidation = null;
  let liveSessionRedirectStarted = false;
  const frameCleanups = new WeakMap();
  // The shell is the sole owner of per-navigation server approval. An embedded
  // workspace consumes only the approval assigned to its own iframe.
  const frameSecurityApprovals = new WeakMap();
  window.LANAdminAwaitWorkspaceSecurity = (frame) =>
    frameSecurityApprovals.get(frame) || Promise.reject(new Error("Unregistered Admin workspace navigation."));

  async function ensureLiveSecuritySession() {
    if (liveSessionRedirectStarted) return false;
    if (liveSessionValidation) return liveSessionValidation;
    liveSessionValidation = (async () => {
      try {
        await validateCurrentSecuritySession();
        return true;
      } catch (error) {
        const revoked = Number(error?.status) === 401 || String(error?.code || "").includes("security-session") || String(error?.code || "") === "security/session-required";
        if (revoked) {
          liveSessionRedirectStarted = true;
          stopSystemHealthMonitor();
          location.replace(new URL("index.html?error=session-ended", location.href).href);
          return false;
        }
        console.error("Administrator security session could not be revalidated.", error);
        return false;
      } finally {
        liveSessionValidation = null;
      }
    })();
    return liveSessionValidation;
  }

  function currentRoute() {
    return requestedWorkspaceFromShellLocation();
  }

  function shellUrlFor(route) {
    const url = new URL(location.href);
    url.searchParams.set("workspace", normalizeWorkspace(route));
    return url;
  }

  function updateActiveNavigation(route) {
    const routeUrl = new URL(normalizeWorkspace(route), new URL("./", location.href));
    document.querySelectorAll(".editor-sidebar a[data-lan-workspace],.sidebar a[data-lan-workspace]").forEach((link) => {
      const linkRoute = parseWorkspaceRoute(link.dataset.lanWorkspace || "") || workspaceRouteFromHref(link.href);
      if (!linkRoute) return;
      const linkUrl = new URL(linkRoute, new URL("./", location.href));
      const active = linkUrl.pathname === routeUrl.pathname && linkUrl.search === routeUrl.search;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
  }

  function makeFrame(route, revision) {
    const canonicalRoute = normalizeWorkspace(route);
    const frame = document.createElement("iframe");
    frame.className = "lan-admin-workspace-frame is-preparing";
    frame.dataset.navigationRevision = String(revision);
    frame.dataset.workspaceRoute = canonicalRoute;
    frame.title = "Admin workspace";
    frame.setAttribute("scrolling", "auto");
    frame.src = canonicalRoute;
    return frame;
  }

  function frameDocument(frame) {
    try { return frame.contentDocument || frame.contentWindow?.document || null; }
    catch (_) { return null; }
  }

  function canonicalMode() {
    const mode = String(shellRoot.dataset.lanAdminMode || "wide").trim().toLowerCase();
    return mode === "compact" || mode === "mobile" ? mode : "wide";
  }

  function canonicalFrameRoute(frame) {
    try { return workspaceRouteFromHref(frame.contentWindow.location.href); }
    catch (_) { return ""; }
  }

  function enforceWorkspaceDocument(frame) {
    if (!(frame instanceof HTMLIFrameElement) || !frame.isConnected) return false;
    const route = canonicalFrameRoute(frame);
    const doc = frameDocument(frame);
    const isNestedShell = doc?.body?.classList.contains("lan-admin-shell-page") === true;
    if (route && !isNestedShell) {
      frame.dataset.workspaceRoute = route;
      return true;
    }

    // A workspace is never allowed to own another persistent shell. Replace
    // any invalid/self-navigation with the frame's canonical workspace route.
    const recoveryRoute = normalizeWorkspace(frame.dataset.workspaceRoute || currentRoute());
    const currentHref = (() => { try { return frame.contentWindow.location.href; } catch (_) { return ""; } })();
    const recoveryHref = new URL(recoveryRoute, new URL("./", location.href)).href;
    if (currentHref !== recoveryHref) frame.contentWindow.location.replace(recoveryHref);
    return false;
  }

  function syncWorkspaceMode(frame) {
    if (!(frame instanceof HTMLIFrameElement) || !frame.isConnected) return;
    if (!enforceWorkspaceDocument(frame)) return;
    const doc = frameDocument(frame);
    if (!doc?.documentElement) return;
    const mode = canonicalMode();
    doc.documentElement.dataset.lanAdminMode = mode;
    try {
      doc.defaultView?.dispatchEvent(new CustomEvent("lan:adaptive-parent-mode-sync", { detail: { mode } }));
      if (currentHealthSnapshot) {
        doc.defaultView?.dispatchEvent(new CustomEvent("lan:system-health", { detail: currentHealthSnapshot }));
      }
    } catch (_) {}
  }

  function installWorkspaceFrameContract(frame) {
    frameCleanups.get(frame)?.();
    const sync = () => syncWorkspaceMode(frame);
    frame.addEventListener("load", sync);
    if (frame.contentDocument?.readyState === "complete") sync();
    const cleanup = () => {
      frame.removeEventListener("load", sync);
      frameCleanups.delete(frame);
    };
    frameCleanups.set(frame, cleanup);
    return cleanup;
  }

  function syncAllWorkspaceModes() {
    document.querySelectorAll(".lan-admin-workspace-frame").forEach(syncWorkspaceMode);
  }
  window.addEventListener("lan:adaptive-mode-change", syncAllWorkspaceModes);

  function dispatchToWorkspaceFrames(type, detail) {
    document.querySelectorAll(".lan-admin-workspace-frame").forEach((frame) => {
      if (!enforceWorkspaceDocument(frame)) return;
      const doc = frameDocument(frame);
      try {
        if (doc?.defaultView) doc.defaultView.dispatchEvent(new CustomEvent(type, { detail }));
      } catch (error) {
        console.error(`Unable to deliver ${type} to an Admin workspace.`, error);
      }
    });
  }

  window.addEventListener("lan:system-health", (event) => {
    currentHealthSnapshot = event.detail || null;
    if (currentHealthSnapshot) dispatchToWorkspaceFrames("lan:system-health", currentHealthSnapshot);
  });
  window.addEventListener("lan:system-health-history", (event) => dispatchToWorkspaceFrames("lan:system-health-history", event.detail || null));
  window.addEventListener("lan:system-health-history-cleared", () => dispatchToWorkspaceFrames("lan:system-health-history-cleared", null));

  async function navigate(route, { history: historyMode = "push" } = {}) {
    route = normalizeWorkspace(route);
    const revision = ++navigationRevision;
    // Start the static document load and the mandatory server validation in
    // parallel. The workspace authorization gate below cannot resolve before
    // this exact navigation is approved by the Security Gateway.
    const securityApproval = ensureLiveSecuritySession();
    const next = makeFrame(route, revision);
    frameSecurityApprovals.set(next, securityApproval);
    host.append(next);
    installWorkspaceFrameContract(next);
    const frameLoad = new Promise((resolve) => {
      next.addEventListener("load", () => resolve(true), { once: true });
      next.addEventListener("error", () => resolve(false), { once: true });
    });
    const [approved, loaded] = await Promise.all([securityApproval, frameLoad]);
    if (!approved || !loaded) {
      frameCleanups.get(next)?.();
      next.remove();
      return;
    }
    if (revision !== navigationRevision) {
      frameCleanups.get(next)?.();
      next.remove();
      return;
    }

    if (!enforceWorkspaceDocument(next)) return;
    syncWorkspaceMode(next);
    next.classList.remove("is-preparing");
    next.classList.add("is-entering");
    const previous = activeFrame;
    activeFrame = next;
    host.dataset.lanWorkspaceState = "ready";
    host.setAttribute("aria-busy", "false");

    next.addEventListener("load", () => {
      if (next !== activeFrame || !enforceWorkspaceDocument(next)) return;
      syncWorkspaceMode(next);
      const childRoute = canonicalFrameRoute(next);
      if (childRoute) {
        next.dataset.workspaceRoute = childRoute;
        updateActiveNavigation(childRoute);
        historyReplace(childRoute);
      }
    });

    updateActiveNavigation(route);
    if (historyMode === "push") historyPush(route);
    else if (historyMode === "replace") historyReplace(route);
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove("is-entering")));

    if (previous) {
      previous.classList.add("is-leaving");
      window.setTimeout(() => {
        frameCleanups.get(previous)?.();
        previous.remove();
      }, 190);
    }
  }

  function historyPush(route) { history.pushState({ workspace: route }, "", shellUrlFor(route)); }
  function historyReplace(route) { history.replaceState({ workspace: route }, "", shellUrlFor(route)); }

  sidebar?.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-lan-workspace]");
    if (!link || !sidebar.contains(link) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
    const route = parseWorkspaceRoute(link.dataset.lanWorkspace || "") || workspaceRouteFromHref(link.href);
    if (!route) return;
    event.preventDefault();
    link.blur?.();
    navigate(route);
  });

  // admin-ui creates promoted-module links asynchronously. Mark only valid
  // workspace documents; shell.html and every non-workspace URL remain outside
  // the workspace router contract.
  const navObserver = new MutationObserver(() => {
    nav?.querySelectorAll("a:not([data-lan-workspace])").forEach((link) => {
      const route = workspaceRouteFromHref(link.href);
      if (route) link.dataset.lanWorkspace = route;
    });
    updateActiveNavigation(currentRoute());
  });
  if (nav) navObserver.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

  window.LANAdminNavigate = (href) => {
    const route = parseWorkspaceRoute(href) || workspaceRouteFromHref(href);
    if (route) navigate(route);
  };
  window.LANAdminReplaceWorkspaceRoute = (href) => {
    const route = parseWorkspaceRoute(href) || workspaceRouteFromHref(href);
    if (!route) return false;
    if (activeFrame) activeFrame.dataset.workspaceRoute = route;
    updateActiveNavigation(route);
    historyReplace(route);
    return true;
  };
  window.addEventListener("popstate", () => navigate(currentRoute(), { history: "none" }));
  window.addEventListener("focus", () => { void ensureLiveSecuritySession(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensureLiveSecuritySession();
  });

  const shellReady = window.__LAN_ADMIN_READY__;
  if (!shellReady || typeof shellReady.then !== "function") {
    throw new Error("Persistent Admin authorization readiness was not initialized before the shell runtime.");
  }
  shellReady.then(async (session) => {
    if (!session?.authorized) throw new Error("Persistent Admin shell cannot start without an authorized session.");
    const route = currentRoute();
    historyReplace(route);
    await navigate(route, { history: "none" });
    startSystemHealthMonitor();
  }).catch((error) => {
    console.error("Persistent Admin system health could not start.", error);
  });

  window.addEventListener("pagehide", () => stopSystemHealthMonitor(), { once: true });
}

if (window.top !== window.self) {
  // shell.html has no nested mode. If a workspace ever self-navigates to the
  // shell, convert that frame back into the requested workspace document before
  // any second shell runtime can start.
  location.replace(workspaceUrlForNestedShell(requestedWorkspaceFromShellLocation()).href);
} else {
  startPersistentAdminShell();
}
