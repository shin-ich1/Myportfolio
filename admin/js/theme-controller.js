/*
 * LΛN Portfolio CMS v2 — canonical Admin theme controller
 * Owns System / Dark / Light preference, persistence, OS resolution and live updates.
 * Loaded synchronously in <head> so the resolved theme is applied before CSS paints.
 */
(() => {
  const THEME_KEY = "lan-cms-theme";
  const VALID_THEMES = new Set(["system", "dark", "light"]);
  const root = document.documentElement;
  const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function getPreference() {
    const stored = safeStorageGet(THEME_KEY);
    return VALID_THEMES.has(stored) ? stored : "system";
  }

  function resolveTheme(preference = getPreference()) {
    const safePreference = VALID_THEMES.has(preference) ? preference : "system";
    return safePreference === "system" ? (mediaQuery.matches ? "light" : "dark") : safePreference;
  }

  function commitTheme(preference, { persist = true, emit = true } = {}) {
    const safePreference = VALID_THEMES.has(preference) ? preference : "system";
    const resolved = resolveTheme(safePreference);

    root.dataset.themePreference = safePreference;
    root.dataset.theme = resolved;
    root.dataset.cmsThemeResolved = resolved;

    if (persist) safeStorageSet(THEME_KEY, safePreference);

    if (emit) {
      document.dispatchEvent(new CustomEvent("lan:themechange", {
        detail: { preference: safePreference, resolved }
      }));
    }

    return { preference: safePreference, resolved };
  }

  function applyTheme(preference) {
    return commitTheme(preference, { persist: true, emit: true });
  }

  function refreshSystemTheme() {
    if (getPreference() !== "system") return;
    commitTheme("system", { persist: false, emit: true });
  }

  function initializeTheme() {
    commitTheme(getPreference(), { persist: false, emit: false });
    root.dataset.reducedMotion = String(safeStorageGet("lan-cms-reduced-motion") === "true");
    root.dataset.compact = String(safeStorageGet("lan-cms-compact") === "true");
    root.dataset.sidebarLayout = safeStorageGet("lan-cms-sidebar-layout-compact") === "true" ? "compact" : "expanded";
  }

  initializeTheme();

  mediaQuery.addEventListener?.("change", refreshSystemTheme);
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY) commitTheme(getPreference(), { persist: false, emit: true });
  });

  window.LANTheme = Object.freeze({
    getPreference,
    resolveTheme,
    applyTheme,
    refreshSystemTheme
  });
})();
