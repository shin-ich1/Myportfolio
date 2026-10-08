/* Canonical Admin adaptive controller.
   -----------------------------------
   One measured state owns the whole Admin surface:
     wide    -> expanded navigation
     compact -> icon rail
     mobile  -> drawer

   The controller never identifies devices. It measures the space available to
   the Admin shell and chooses the mode whose navigation still leaves a usable
   workspace. Workspace documents loaded by the persistent shell inherit that
   exact mode; they do not run a second competing classification. Components
   may still reflow from their own container size, but they never redefine the
   global Admin mode. */

function cssLengthPx(property, fallback) {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const raw = style.getPropertyValue(property).trim();
  if (!raw) return fallback;
  const rootPx = parseFloat(style.fontSize) || 16;
  if (raw.endsWith("rem")) return (parseFloat(raw) || 0) * rootPx;
  if (raw.endsWith("px")) return parseFloat(raw) || fallback;
  const numeric = parseFloat(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/* Pure workspace classifier retained for component/tests that only have an
   already-usable inline size. Global shell mode is resolved by
   classifyAdminShellMode() below so the cost of navigation is accounted for
   exactly once. */
export function classifyAdminMode(inlineSize, wideMin, mobileMin) {
  if (inlineSize >= wideMin) return "wide";
  if (inlineSize >= mobileMin) return "compact";
  return "mobile";
}

export function classifyAdminShellMode(shellInline, wideMin, mobileMin, expandedNav, compactNav) {
  const inline = Math.max(0, Number(shellInline) || 0);
  const wideWorkspace = Math.max(0, inline - Math.max(0, Number(expandedNav) || 0));
  if (wideWorkspace >= wideMin) return "wide";

  const compactWorkspace = Math.max(0, inline - Math.max(0, Number(compactNav) || 0));
  if (compactWorkspace >= mobileMin) return "compact";
  return "mobile";
}

function inheritedMode() {
  if (window.top === window.self) return "";
  try {
    const mode = String(window.top.document.documentElement.dataset.lanAdminMode || "").trim().toLowerCase();
    return mode === "wide" || mode === "compact" || mode === "mobile" ? mode : "";
  } catch (_) {
    return "";
  }
}

function defaultNavigationForm(mode) {
  if (mode === "mobile") return "drawer";
  if (mode === "compact") return "rail";
  return "expanded";
}

function publishMode(root, nextMode, detail = {}) {
  const previousMode = root.dataset.lanAdminMode || "";
  root.dataset.lanAdminMode = nextMode;
  if (previousMode === nextMode) return false;

  /* Adaptive mode owns the default navigation form. User-triggered hamburger
     changes may temporarily override this form, but they never redefine the
     global Wide / Compact / Mobile state. A real mode transition always
     returns navigation to that mode's canonical starting form. */
  root.dataset.lanNavForm = defaultNavigationForm(nextMode);

  window.dispatchEvent(new CustomEvent("lan:adaptive-mode-change", {
    detail: {
      mode: nextMode,
      previousMode,
      ...detail
    }
  }));
  return true;
}

export function initAdminAdaptiveModes() {
  const root = document.documentElement;
  const shell = document.querySelector(".lan-admin-shell");
  const workspace = document.querySelector(".lan-admin-workspace-host,.editor-main,.dashboard-workspace,.about-main,.composer-main");
  const target = shell || workspace || root;
  let frame = 0;

  const measureNow = () => {
    const wideMin = cssLengthPx("--lan-admin-wide-min", 960);
    const mobileMin = cssLengthPx("--lan-admin-mobile-min", 672);
    const expandedNav = cssLengthPx("--lan-sidebar-expanded-width", 240);
    const compactNav = cssLengthPx("--lan-sidebar-compact-width", 76);
    const inherited = inheritedMode();
    const targetInline = target.getBoundingClientRect?.().width || root.clientWidth || window.innerWidth || 0;

    let mode;
    let workspaceInlineEstimate = targetInline;
    let source = "standalone-workspace";

    if (inherited) {
      mode = inherited;
      source = "persistent-shell";
    } else if (shell) {
      mode = classifyAdminShellMode(targetInline, wideMin, mobileMin, expandedNav, compactNav);
      const navReserve = mode === "wide" ? expandedNav : mode === "compact" ? compactNav : 0;
      workspaceInlineEstimate = Math.max(0, targetInline - navReserve);
      source = "shell-measurement";
    } else {
      mode = classifyAdminMode(targetInline, wideMin, mobileMin);
    }

    publishMode(root, mode, {
      availableInline: targetInline,
      workspaceInlineEstimate,
      source
    });
    return mode;
  };

  const measure = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      measureNow();
    });
  };

  // ResizeObserver owns element-geometry changes while the window listener feeds
  // the same RAF-coalesced scheduler for immediate viewport/device-mode changes.
  // They never run separate layout pipelines.
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  observer?.observe(target);
  window.addEventListener("resize", measure, { passive: true });

  /* Child workspaces receive this event from admin-shell.js after the parent
     publishes a new mode. Re-read the inherited canonical value rather than
     classifying the child independently. */
  const syncInherited = () => {
    if (window.top !== window.self) measureNow();
  };
  window.addEventListener("lan:adaptive-parent-mode-sync", syncInherited);

  measureNow();
  window.LANAdminAdaptiveMode = Object.freeze({
    measure: measureNow,
    get mode() { return root.dataset.lanAdminMode || "wide"; }
  });

  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("resize", measure);
    window.removeEventListener("lan:adaptive-parent-mode-sync", syncInherited);
  };
}
