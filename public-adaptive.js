/* Canonical Public adaptive runtime.
   The Public surface owns its mode independently from Admin and measures its real composition width. */
let observer = null;
let observedTarget = null;
let resizeHandler = null;

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

export function classifyPublicMode(inlineSize, wideMin, mobileMin) {
  if (inlineSize >= wideMin) return "wide";
  if (inlineSize >= mobileMin) return "compact";
  return "mobile";
}

export function initPublicAdaptiveMode(scope = document) {
  observer?.disconnect();
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  const target = scope.querySelector?.(".portfolio-main") || scope.querySelector?.("#app") || document.documentElement;
  observedTarget = target;

  let frame = 0;
  const measureNow = () => {
    const width = target.getBoundingClientRect?.().width || document.documentElement.clientWidth || 0;
    const mode = classifyPublicMode(
      width,
      cssLengthPx("--lan-public-wide-min", 1100),
      cssLengthPx("--lan-public-mobile-min", 720)
    );
    const root = document.documentElement;
    const previous = root.dataset.lanPublicMode || "";
    root.dataset.lanPublicMode = mode;
    if (mode !== previous) {
      window.dispatchEvent(new CustomEvent("lan:public-adaptive-mode-change", { detail: { mode, usableInline: width } }));
    }
  };
  const measure = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; measureNow(); });
  };

  // Element and viewport changes feed one RAF-coalesced mode scheduler.
  observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  observer?.observe(target);
  resizeHandler = measure;
  window.addEventListener("resize", resizeHandler, { passive: true });
  measureNow();
  return measureNow;
}

export function isPublicMobileMode() {
  return document.documentElement.dataset.lanPublicMode === "mobile";
}

export function isPublicDocumentFlowMode() {
  const mode = document.documentElement.dataset.lanPublicMode;
  return mode === "compact" || mode === "mobile";
}

export function getPublicAdaptiveTarget() {
  return observedTarget;
}
