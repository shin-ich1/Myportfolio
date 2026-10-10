/* Shared Admin UI runtime. */
import {
  NAVIGATION_ICON_MAP,
  renderSystemIcon,
  resolveModuleAdminIcon
} from "../../icon-registry.js";
import { resolveToolIconSource, resolveToolFallbackIcon } from "../../tool-identity.js";
import { mountAdminPageBand } from "./admin-page-band.js";
import { initAdminAdaptiveModes } from "./admin-adaptive.js";
import { decorateRecordCommand } from "./admin-record-actions.js";
import { installRecordCardBudgetRuntime, scheduleRecordCardBudget } from "./admin-record-card-budget.js";
(() => {
  if (window.__LAN_ADMIN_UI_RUNTIME__) return;
  window.__LAN_ADMIN_UI_RUNTIME__ = Object.freeze({ version: "admin-ui" });
  const isPersistentWorkspace = window.top !== window.self && document.documentElement.dataset.lanWorkspaceDocument === "true";
  const isPersistentShell = document.body.classList.contains("lan-admin-shell-page");
  if (!isPersistentShell) installRecordCardBudgetRuntime();

  // Persistent-shell workspaces must not duplicate global maintenance. The
  // shell owns cross-workspace media recovery once; standalone pages retain
  // the same behavior when opened directly.
  if (!isPersistentWorkspace) {
    window.setTimeout(() => {
      import("../services/mediaAssetLifecycleService.js")
        .then(({ recoverMediaAssetLifecycle }) => recoverMediaAssetLifecycle())
        .catch((error) => console.warn("Deferred media cleanup is still pending:", error));
    }, 1200);
  }

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const ADMIN_DISPLAY_NAME_KEY = "lan-cms-dashboard-greeting-name";
  const SIDEBAR_STATUS_VISIBLE_KEY = "lan-cms-sidebar-status-visible";

  function normalizeSelectToken(value = "") {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[\/_–—-]+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function setSelectValue(select, value, fallback = "") {
    if (!(select instanceof HTMLSelectElement)) return false;
    const wanted = normalizeSelectToken(value);
    if (wanted) {
      const match = [...select.options].find((option) =>
        normalizeSelectToken(option.value) === wanted ||
        normalizeSelectToken(option.textContent) === wanted
      );
      if (match) {
        select.value = match.value;
        select.dispatchEvent(new Event("lan:select-sync"));
        return true;
      }
    }
    const fallbackToken = normalizeSelectToken(fallback);
    const fallbackOption = [...select.options].find((option) =>
      normalizeSelectToken(option.value) === fallbackToken ||
      normalizeSelectToken(option.textContent) === fallbackToken
    );
    select.value = fallbackOption?.value ?? "";
    select.dispatchEvent(new Event("lan:select-sync"));
    return false;
  }

  window.LANSetSelectValue = setSelectValue;

  function controlLabel(control) {
    if (!(control instanceof HTMLElement)) return "Required field";
    const id = control.id;
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrapper = explicit || control.closest("label");
    const label = wrapper?.querySelector("span")?.textContent || wrapper?.textContent || control.getAttribute("aria-label") || control.name || id || "Required field";
    return String(label).replace(/[*:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Required field";
  }

  function validationWrapper(control) {
    if (!(control instanceof HTMLElement)) return null;
    return control.closest("label,.editor-field,.form-field,.field-group,.input-group") || control.parentElement;
  }

  function clearValidationState(control) {
    if (!(control instanceof HTMLElement)) return;
    control.classList.remove("lan-control-invalid");
    control.removeAttribute("aria-invalid");
    validationWrapper(control)?.classList.remove("lan-field-invalid");
    const errorId = control.dataset.lanValidationError;
    if (errorId) document.getElementById(errorId)?.remove();
    delete control.dataset.lanValidationError;
  }

  function validationMessage(control) {
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
      if (control.validity.valueMissing) return "This field is required.";
      return control.validationMessage || "Please enter a valid value.";
    }
    return "This field is required.";
  }

  function markValidationState(control) {
    if (!(control instanceof HTMLElement)) return;
    clearValidationState(control);
    control.classList.add("lan-control-invalid");
    control.setAttribute("aria-invalid", "true");
    validationWrapper(control)?.classList.add("lan-field-invalid");
    const error = document.createElement("small");
    const errorId = `lan-validation-${Math.random().toString(36).slice(2, 10)}`;
    error.id = errorId;
    error.className = "lan-field-error";
    error.textContent = validationMessage(control);
    control.dataset.lanValidationError = errorId;
    control.insertAdjacentElement("afterend", error);
  }

  function syncValidationTabs(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const root = form.closest("[data-lan-tab-root]") || form.closest(".composer-canvas,.about-canvas,.editor-content") || form;
    root.querySelectorAll("[data-lan-tab]").forEach((tab) => tab.classList.remove("has-validation-error"));
    root.querySelectorAll(".lan-control-invalid").forEach((control) => {
      const panelKey = control.closest("[data-lan-panel]")?.dataset.lanPanel;
      if (panelKey) root.querySelector(`[data-lan-tab="${CSS.escape(panelKey)}"]`)?.classList.add("has-validation-error");
    });
  }

  function validateForm(form, { title = "Complete required fields" } = {}) {
    if (!(form instanceof HTMLFormElement)) return true;
    [...form.elements].forEach((control) => { if (control instanceof HTMLElement) clearValidationState(control); });
    if (form.checkValidity()) { syncValidationTabs(form); return true; }
    const invalid = [...form.elements].filter((control) => control?.willValidate && !control.checkValidity());
    invalid.forEach(markValidationState);
    syncValidationTabs(form);
    const names = [...new Set(invalid.map(controlLabel))].slice(0, 5);
    window.LANNotice?.({
      title,
      message: names.length ? `Please complete: ${names.join(", ")}.` : "Please complete the required fields before saving.",
      tone: "warning"
    });
    const first = invalid[0];
    if (first instanceof HTMLElement) {
      const root = form.closest("[data-lan-tab-root]") || form.closest(".composer-canvas,.about-canvas,.editor-content") || form;
      const panelKey = first.closest("[data-lan-panel]")?.dataset.lanPanel;
      if (panelKey) root.querySelector(`[data-lan-tab="${CSS.escape(panelKey)}"]`)?.click();
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      window.requestAnimationFrame(() => first.focus({ preventScroll: true }));
    }
    return false;
  }

  window.LANValidateForm = validateForm;

  document.addEventListener("invalid", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLElement) || !control.closest("form")) return;
    markValidationState(control);
    const form = control.closest("form");
    if (form) syncValidationTabs(form);
  }, true);
  const clearResolvedValidation = (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
    if (!control.classList.contains("lan-control-invalid") || !control.checkValidity()) return;
    clearValidationState(control);
    const form = control.closest("form");
    if (form) syncValidationTabs(form);
  };
  document.addEventListener("input", clearResolvedValidation, true);
  document.addEventListener("change", clearResolvedValidation, true);

  function readAdminDisplayName() {
    try {
      return String(localStorage.getItem(ADMIN_DISPLAY_NAME_KEY) || "Rolando").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24) || "Rolando";
    } catch (error) {
      return "Rolando";
    }
  }

  function applyAdminDisplayName(value = readAdminDisplayName()) {
    const name = String(value || "Rolando").trim() || "Rolando";
    document.querySelectorAll(".editor-admin-card strong,.lan-user-chip strong").forEach((node) => {
      node.textContent = name;
    });
  }

  function sidebarStatusVisible() {
    try { return localStorage.getItem(SIDEBAR_STATUS_VISIBLE_KEY) !== "false"; } catch (error) { return true; }
  }

  /* --------------------------------------------------------------------- */
  /* Shared navigation icons — canonical registry lives at /icon-registry.js */
  /* --------------------------------------------------------------------- */
  function navKey(label = "") {
    const value = label.toLowerCase();
    if (value.includes("dashboard")) return "dashboard";
    if (value.includes("home")) return "home";
    if (value.includes("about")) return "about";
    if (value.includes("experience")) return "experience";
    if (value.includes("education")) return "education";
    if (value.includes("skill")) return "skills";
    if (value.includes("project")) return "projects";
    if (value.includes("photo")) return "photo";
    if (value.includes("custom module")) return "custom";
    if (value.includes("service") || value.includes("work with me")) return "services";
    if (value.includes("certificate")) return "certificates";
    if (value.includes("resume")) return "resume";
    if (value.includes("contact")) return "contact";
    if (value.includes("setting")) return "settings";
    return "";
  }

  function enhanceNavigationIcons() {
    $$(".editor-navigation a,.navigation-link").forEach((link) => {
      let holder = $("span:first-child,.navigation-icon", link);
      const existingLabel = $(".lan-nav-label", link) || [...link.children].find((child) => child !== holder && child.tagName === "SPAN");
      const textLabel = [...link.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || "").join(" ").replace(/\s+/g, " ").trim();
      const label = String(existingLabel?.textContent || textLabel || link.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const key = navKey(label);
      const canonicalLabel = key === "skills" ? "Skills & Tools Used" : label;
      if (key && holder) holder.innerHTML = renderSystemIcon(NAVIGATION_ICON_MAP[key] || "sparkles", { className: "lan-module-icon-svg" });

      let labelNode = $(".lan-nav-label", link);
      if (!labelNode) {
        if (existingLabel) {
          labelNode = existingLabel;
          labelNode.classList.add("lan-nav-label");
        } else {
          labelNode = document.createElement("span");
          labelNode.className = "lan-nav-label";
          labelNode.textContent = canonicalLabel;
          [...link.childNodes].forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) node.remove();
          });
          link.append(labelNode);
        }
      }
      if (labelNode) labelNode.textContent = canonicalLabel;
      if (canonicalLabel) {
        link.title = canonicalLabel;
        link.dataset.sidebarTooltip = canonicalLabel;
        link.setAttribute("aria-label", canonicalLabel);
      }
    });
  }

  /* --------------------------------------------------------------------- */
  /* Sidebar / topbar shell                                                */
  /* --------------------------------------------------------------------- */

  function initDrawer() {
    const root = document.documentElement;
    const sidebar = $(".editor-sidebar,.sidebar");
    if (!sidebar || sidebar.dataset.lanDrawerBound === "true") return;
    sidebar.dataset.lanDrawerBound = "true";

    let overlay = $(".sidebar-overlay,.sidebar-backdrop");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "sidebar-overlay";
      overlay.setAttribute("aria-hidden", "true");
      document.body.append(overlay);
    }

    /* The persistent shell owns the only navigation trigger. The adaptive
       controller decides Wide / Compact / Mobile; this runtime only handles a
       user's temporary navigation presentation request inside that mode. */
    const trigger = $("#menuButton.lan-shell-menu-button");
    const mode = () => {
      const value = String(root.dataset.lanAdminMode || "wide").toLowerCase();
      return value === "compact" || value === "mobile" ? value : "wide";
    };
    const defaultForm = () => mode() === "wide" ? "expanded" : mode() === "compact" ? "rail" : "drawer";
    const currentForm = () => String(root.dataset.lanNavForm || defaultForm());
    const isOverlayOpen = () => document.body.classList.contains("sidebar-open");

    const syncTrigger = () => {
      if (!trigger) return;
      const expanded = mode() === "wide" ? currentForm() === "expanded" : isOverlayOpen();
      const action = mode() === "wide"
        ? (currentForm() === "rail" ? "Expand navigation" : "Collapse navigation")
        : (isOverlayOpen() ? "Close navigation" : "Open navigation");
      trigger.setAttribute("aria-expanded", String(expanded));
      trigger.setAttribute("aria-label", action);
      trigger.setAttribute("title", action);
      trigger.dataset.drawerState = isOverlayOpen() ? "open" : "closed";
      trigger.innerHTML = renderSystemIcon(
        mode() === "wide" && currentForm() === "expanded" ? "panel-left-close" : (isOverlayOpen() ? "panel-left-close" : "menu"),
        { className: "lan-shell-menu-icon" }
      );
    };

    const closeOverlay = () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
      document.body.classList.remove("sidebar-open");
      overlay.setAttribute("aria-hidden", "true");
      if (mode() === "compact") root.dataset.lanNavForm = "rail";
      if (mode() === "mobile") root.dataset.lanNavForm = "drawer";
      syncTrigger();
    };

    const openOverlay = () => {
      if (mode() === "wide") return;
      root.dataset.lanNavForm = mode() === "compact" ? "expanded-overlay" : "drawer";
      sidebar.classList.add("open");
      overlay.classList.add("show");
      document.body.classList.add("sidebar-open");
      overlay.setAttribute("aria-hidden", "false");
      syncTrigger();
    };

    const toggleNavigation = () => {
      if (mode() === "wide") {
        closeOverlay();
        root.dataset.lanNavForm = currentForm() === "rail" ? "expanded" : "rail";
        syncTrigger();
        window.dispatchEvent(new CustomEvent("lan:navigation-form-change", {
          detail: { mode: "wide", form: root.dataset.lanNavForm }
        }));
        return;
      }
      if (isOverlayOpen()) closeOverlay(); else openOverlay();
    };

    const normalizeForMode = () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
      document.body.classList.remove("sidebar-open");
      overlay.setAttribute("aria-hidden", "true");
      root.dataset.lanNavForm = defaultForm();
      syncTrigger();
    };

    window.LANAdminShell = Object.freeze({
      openNavigation: () => mode() === "wide" ? (root.dataset.lanNavForm = "expanded", syncTrigger()) : openOverlay(),
      closeNavigation: () => mode() === "wide" ? (root.dataset.lanNavForm = "rail", syncTrigger()) : closeOverlay(),
      toggleNavigation,
      isMobile: () => mode() === "mobile",
      get mode() { return mode(); },
      get navigationForm() { return currentForm(); }
    });

    trigger?.addEventListener("click", toggleNavigation);
    $$(".sidebar-close", sidebar).forEach((button) => button.addEventListener("click", closeOverlay));
    overlay.addEventListener("click", closeOverlay);
    sidebar.addEventListener("click", (event) => {
      if (event.target.closest("a") && mode() !== "wide" && isOverlayOpen()) closeOverlay();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOverlayOpen()) closeOverlay();
    });
    window.addEventListener("lan:adaptive-mode-change", normalizeForMode);
    normalizeForMode();
  }

  function initSidebarTooltips() {
    const sidebar = $(".editor-sidebar,.sidebar");
    if (!sidebar || sidebar.dataset.lanTooltipBound === "true") return;
    sidebar.dataset.lanTooltipBound = "true";
    const tooltip = document.createElement("div");
    tooltip.className = "lan-sidebar-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);

    const hide = () => { tooltip.hidden = true; tooltip.textContent = ""; };
    const showFor = (target) => {
      const railNavigation = document.documentElement.dataset.lanNavForm === "rail";
      if (!railNavigation) return hide();
      const label = target?.dataset?.sidebarTooltip || target?.getAttribute?.("aria-label") || target?.title || "";
      if (!label) return hide();
      const rect = target.getBoundingClientRect();
      tooltip.textContent = label;
      tooltip.style.left = `${Math.round(rect.right + 10)}px`;
      tooltip.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
      tooltip.hidden = false;
    };

    sidebar.addEventListener("pointerover", (event) => {
      const target = event.target.closest("a[data-sidebar-tooltip],button[data-sidebar-tooltip]");
      if (target && sidebar.contains(target)) showFor(target);
    });
    sidebar.addEventListener("pointerout", (event) => {
      const target = event.target.closest("a[data-sidebar-tooltip],button[data-sidebar-tooltip]");
      if (target && (!event.relatedTarget || !target.contains(event.relatedTarget))) hide();
    });
    sidebar.addEventListener("focusin", (event) => showFor(event.target.closest("a[data-sidebar-tooltip],button[data-sidebar-tooltip]")));
    sidebar.addEventListener("focusout", hide);
    window.addEventListener("resize", hide, { passive: true });
  }

  async function syncCustomModulesNavigation() {
    const nav = $(".editor-navigation,.sidebar-navigation");
    if (!nav) return;

    $$(".editor-navigation-label,.navigation-label", nav)
      .filter((label) => label.textContent.trim().toLowerCase() === "custom modules")
      .forEach((label) => label.remove());
    // Keep the currently rendered promoted-module links in place while the
    // authoritative section registry is loading. Removing them before the
    // async read completed caused the sidebar to visibly lose pages on every
    // document navigation. Reconciliation below is atomic after data arrives.

    const photoLink = $$("a", nav).find((link) => /photo-editing\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));
    const certificatesLink = $$("a", nav).find((link) => /certificates\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));
    const contactLink = $$("a", nav).find((link) => /contact\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));
    const settingsLink = $$("a", nav).find((link) => /settings\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));

    let customModulesLink = $$("a", nav).find((link) => link.dataset.lanCustomModulesNav === "true" || (/module\.html(?:$|[?#])/.test(link.getAttribute("href") || "") && !new URL(link.href, location.href).searchParams.has("section")));
    if (!customModulesLink) {
      customModulesLink = document.createElement("a");
      customModulesLink.href = `${pageBase}module.html`;
      customModulesLink.dataset.lanCustomModulesNav = "true";
      customModulesLink.innerHTML = `<span class="navigation-icon" aria-hidden="true">${renderSystemIcon(NAVIGATION_ICON_MAP.custom, { className: "lan-module-icon-svg" })}</span><span class="lan-nav-label">Custom Modules</span>`;
    } else {
      customModulesLink.href = `${pageBase}module.html`;
      customModulesLink.dataset.lanCustomModulesNav = "true";
      const label = $(".lan-nav-label", customModulesLink);
      if (label) label.textContent = "Custom Modules";
    }
    customModulesLink.classList.add("navigation-link");
    if (photoLink) photoLink.after(customModulesLink);
    else if (certificatesLink) certificatesLink.before(customModulesLink);
    else nav.append(customModulesLink);

    let promotedModules = [];
    try {
      const { listSections } = await import("../services/portfolioSectionService.js");
      promotedModules = (await listSections()).filter((item) => item.lifecycle === "promoted");
    } catch (error) {
      console.warn("Promoted module navigation could not be loaded.", error);
    }
    const occupiedModuleIcons = new Set(Object.values(NAVIGATION_ICON_MAP));
    const allocatedModuleIcons = new Map();
    [...promotedModules].sort((a,b) => String(a.key || a.title || "").localeCompare(String(b.key || b.title || ""))).forEach((item) => {
      const iconName = resolveModuleAdminIcon(item, { occupied: [...occupiedModuleIcons] });
      occupiedModuleIcons.add(iconName);
      allocatedModuleIcons.set(String(item.id || item.key || ""), iconName);
    });
    const promotedFragment = document.createDocumentFragment();
    promotedModules.forEach((item) => {
      const link = document.createElement("a");
      const key = String(item.key || "").trim();
      if (!key) return;
      link.className = "navigation-link";
      link.href = `${pageBase}module.html?section=${encodeURIComponent(key)}`;
      link.dataset.lanPromotedModuleNav = String(item.id || key);
      const iconName = allocatedModuleIcons.get(String(item.id || key)) || resolveModuleAdminIcon(item, { occupied: [...occupiedModuleIcons] });
      link.innerHTML = `<span class="navigation-icon" aria-hidden="true">${renderSystemIcon(iconName, { className: "lan-module-icon-svg" })}</span><span class="lan-nav-label">${escapeHtml(item.title || key)}</span>`;
      promotedFragment.append(link);
    });
    // One synchronous DOM commit: old generated links never disappear while
    // Firestore/registry data is in flight, and the final set cannot flicker.
    $$('[data-lan-promoted-module-nav]', nav).forEach((link) => link.remove());
    customModulesLink.before(promotedFragment);

    let servicesLink = $$("a", nav).find((link) => /services\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));
    if (!servicesLink) {
      servicesLink = document.createElement("a");
      servicesLink.href = `${pageBase}services.html`;
      servicesLink.dataset.lanServicesNav = "true";
      servicesLink.innerHTML = `<span class="navigation-icon" aria-hidden="true">${renderSystemIcon(NAVIGATION_ICON_MAP.services, { className: "lan-module-icon-svg" })}</span><span class="lan-nav-label">Services</span>`;
    }
    servicesLink.classList.add("navigation-link");
    if (contactLink) contactLink.after(servicesLink);
    else if (settingsLink) settingsLink.before(servicesLink);
    else nav.append(servicesLink);

    const modulePage = /\/module\.html$/.test(location.pathname.replace(/\\/g, "/"));
    const selectedSection = modulePage ? String(new URLSearchParams(location.search).get("section") || "").trim() : "";
    let promotedActive = false;
    $$('[data-lan-promoted-module-nav]', nav).forEach((link) => {
      const linkSection = String(new URL(link.href, location.href).searchParams.get("section") || "").trim();
      const active = modulePage && Boolean(selectedSection) && linkSection === selectedSection;
      link.classList.toggle("active", active);
      if (active) {
        promotedActive = true;
        link.setAttribute("aria-current", "page");
      } else link.removeAttribute("aria-current");
    });
    const customActive = modulePage && !promotedActive;
    customModulesLink.classList.toggle("active", customActive);
    if (customActive) customModulesLink.setAttribute("aria-current", "page");
    else customModulesLink.removeAttribute("aria-current");

    const servicesPage = /\/services\.html$/.test(location.pathname.replace(/\\/g, "/"));
    servicesLink.classList.toggle("active", servicesPage);
    if (servicesPage) servicesLink.setAttribute("aria-current", "page");
    else servicesLink.removeAttribute("aria-current");

    enhanceNavigationIcons();
  }

  function initCustomModulesNavigation() {
    syncCustomModulesNavigation().catch((error) => console.warn("Admin module navigation sync failed.", error));
    window.addEventListener("lan:portfolio-sections-updated", () => syncCustomModulesNavigation().catch((error) => console.warn("Admin module navigation sync failed.", error)));
  }

  function enhanceSidebarStatus() {
    const nav = $(".editor-navigation,.sidebar-navigation");
    const footer = $(".editor-sidebar-footer,.sidebar-footer");

    if (nav) {
      const first = $(".editor-navigation-label,.navigation-label", nav);
      if (first) first.textContent = "Main";

      const settings = $$("a", nav).find((link) =>
        /settings\.html(?:$|[?#])/.test(link.getAttribute("href") || "")
      );
      const systemLabels = $$(".editor-navigation-label,.navigation-label", nav)
        .filter((label) => label.textContent.trim().toLowerCase() === "system");

      if (settings && systemLabels.length === 0) {
        const label = document.createElement("p");
        label.className = "editor-navigation-label";
        label.textContent = "System";
        settings.before(label);
      }

      systemLabels.slice(1).forEach((label) => label.remove());
    }

    if (!footer || footer.dataset.lanStatusBound === "true") return;
    footer.dataset.lanStatusBound = "true";

    if (!$(".editor-admin-card", footer)) {
      const account = document.createElement("div");
      account.className = "editor-admin-card";
      account.innerHTML = `<span class="lan-user-avatar" data-lan-avatar><span>RL</span></span><div><strong>${escapeHtml(readAdminDisplayName())}</strong><small>Administrator</small></div>`;
      footer.prepend(account);
    }

    const nested = /\/admin\/pages\//.test(location.pathname.replace(/\\/g, "/"));
    let status = $(".lan-sidebar-status");
    if (!status) {
      status = document.createElement("section");
      status.className = "lan-sidebar-status is-collapsed";
      status.innerHTML = `<button class="lan-sidebar-status-toggle" type="button" aria-expanded="false"><span><i></i> LIVE</span><strong>Public Portfolio</strong><b aria-hidden="true">⌃</b></button><div class="lan-sidebar-status-details"><small>Open the published portfolio in a new tab.</small><a href="${nested ? "../../index.html" : "../index.html"}" target="_blank" rel="noopener noreferrer">View Portfolio ↗</a></div>`;
      footer.before(status);
    }

    status.hidden = !sidebarStatusVisible();
    const toggle = $(".lan-sidebar-status-toggle", status);
    if (toggle && toggle.dataset.lanBound !== "true") {
      toggle.dataset.lanBound = "true";
      toggle.addEventListener("click", () => {
        const collapsed = status.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
      });
    }
  }


  function syncSidebarStatusVisibility(visible = sidebarStatusVisible()) {
    const status = $(".lan-sidebar-status");
    if (status) status.hidden = !visible;
  }

  window.addEventListener("lan:admin-identity-change", (event) => applyAdminDisplayName(event.detail?.displayName));
  window.addEventListener("lan:sidebar-status-visibility", (event) => syncSidebarStatusVisibility(Boolean(event.detail?.visible)));
  window.addEventListener("storage", (event) => {
    if (event.key === ADMIN_DISPLAY_NAME_KEY) applyAdminDisplayName();
    if (event.key === SIDEBAR_STATUS_VISIBLE_KEY) syncSidebarStatusVisibility();
  });

  /* --------------------------------------------------------------------- */
  /* Command palette / topbar search                                       */
  /* --------------------------------------------------------------------- */
  const nestedPage = /\/admin\/pages\//.test(location.pathname.replace(/\\/g, "/"));
  const pageBase = nestedPage ? "" : "pages/";
  const dashboardHref = nestedPage ? "../dashboard.html" : "dashboard.html";
  const portfolioHref = nestedPage ? "../../index.html" : "../index.html";
  const routes = [
    ["dashboard", "Dashboard", dashboardHref], ["home", "Home / Studio", `${pageBase}home.html`], ["about", "About", `${pageBase}about.html`],
    ["experience", "Experience", `${pageBase}experience.html`], ["education", "Education", `${pageBase}education.html`], ["skills", "Skills", `${pageBase}skills.html`],
    ["projects", "Projects", `${pageBase}projects.html`], ["photo", "Photo Editing", `${pageBase}photo-editing.html`], ["custom-modules", "Custom Modules", `${pageBase}module.html`], ["certificates", "Certificates", `${pageBase}certificates.html`],
    ["resume", "Resume", `${pageBase}resume.html`], ["contact", "Contact", `${pageBase}contact.html`], ["services", "Services", `${pageBase}services.html`], ["settings", "Settings", `${pageBase}settings.html`]
  ];

  const prefetchedAdminPages = new Set();

  function prefetchAdminPage(href) {
    let target;
    try { target = new URL(href, location.href); } catch (_) { return; }
    if (target.origin !== location.origin || !/\/admin\//.test(target.pathname) || target.href === location.href) return;
    const key = `${target.pathname}${target.search}`;
    if (prefetchedAdminPages.has(key)) return;
    prefetchedAdminPages.add(key);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = target.href;
    link.as = "document";
    document.head.append(link);
  }

  function navigateAdminPage(href) {
    const target = new URL(href, location.href);
    if (target.href === location.href) return;
    // The persistent shell is the sole Admin navigation owner. Workspace
    // documents delegate to it; standalone fallback remains a normal URL load.
    const shellNavigate = window.LANAdminNavigate || (window.parent !== window ? window.parent.LANAdminNavigate : null);
    if (typeof shellNavigate === "function") { shellNavigate(target.href); return; }
    location.href = target.href;
  }

  function initAdminNavigation() {
    document.addEventListener("pointerenter", (event) => {
      const link = event.target.closest?.(".editor-navigation a,.sidebar-navigation a,.lan-system-nav a");
      if (link) prefetchAdminPage(link.href);
    }, true);
    document.addEventListener("focusin", (event) => {
      const link = event.target.closest?.(".editor-navigation a,.sidebar-navigation a,.lan-system-nav a");
      if (link) prefetchAdminPage(link.href);
    });
  }

  function createCommandPalette() {
    if ($("#lanCommandPalette")) return;
    const layer = document.createElement("div");
    layer.id = "lanCommandPalette";
    layer.className = "lan-command-palette";
    layer.hidden = true;
    layer.innerHTML = `<section class="lan-command-card" role="dialog" aria-modal="true" aria-label="Navigate the Admin"><header><span aria-hidden="true">⌕</span><input id="lanCommandInput" autocomplete="off" placeholder="Search pages…" aria-label="Search Admin pages"><kbd>Esc</kbd></header><div class="lan-command-list" id="lanCommandList"></div></section>`;
    document.body.append(layer);
    const input = $("#lanCommandInput", layer);
    const list = $("#lanCommandList", layer);
    let previousFocus = null;

    const render = () => {
      const query = input.value.trim().toLowerCase();
      list.replaceChildren();
      routes.filter(([, name]) => !query || name.toLowerCase().includes(query)).forEach(([key, name, href, iconKey]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lan-command-item";
        button.innerHTML = `<span>${renderSystemIcon(NAVIGATION_ICON_MAP[iconKey || key] || NAVIGATION_ICON_MAP.custom, { className: "lan-command-icon" })}</span><span><strong>${name}</strong><small>Open ${name}</small></span>`;
        button.addEventListener("click", () => navigateAdminPage(href));
        list.append(button);
      });
      const publicButton = document.createElement("button");
      publicButton.type = "button";
      publicButton.className = "lan-command-item";
      publicButton.innerHTML = `<span aria-hidden="true">↗</span><span><strong>Open public portfolio</strong><small>View the published site</small></span>`;
      publicButton.addEventListener("click", () => window.open(portfolioHref, "_blank", "noopener"));
      list.append(publicButton);
    };
    const open = () => {
      previousFocus = document.activeElement;
      layer.hidden = false;
      document.body.classList.add("lan-command-open");
      input.value = ""; render();
      requestAnimationFrame(() => input.focus());
    };
    const close = () => {
      layer.hidden = true;
      document.body.classList.remove("lan-command-open");
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
    input.addEventListener("input", render);
    layer.addEventListener("pointerdown", (event) => { if (event.target === layer) close(); });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); layer.hidden ? open() : close(); }
      else if (event.key === "Escape" && !layer.hidden) { event.preventDefault(); close(); }
    });
    window.__LAN_OPEN_COMMAND__ = open;
  }

  const TOPBAR_ACTION_ICON_BY_KIND = Object.freeze({
    preview: "eye",
    visibility: "eye",
    refresh: "refresh-cw",
    back: "arrow-left",
    open: "external-link",
    save: "save",
    publish: "send",
    create: "plus",
    projects: "panels-top-left",
    settings: "settings",
    generic: "sparkles"
  });

  function topbarActionKind(command) {
    if (!(command instanceof HTMLElement)) return "generic";
    const explicit = String(command.dataset.lanActionKind || command.dataset.lanTopbarActionKind || "").trim().toLowerCase();
    if (TOPBAR_ACTION_ICON_BY_KIND[explicit]) return explicit;
    const label = String(command.getAttribute("aria-label") || command.getAttribute("title") || command.textContent || "").trim().toLowerCase();
    const href = command instanceof HTMLAnchorElement ? String(command.getAttribute("href") || "").toLowerCase() : "";
    if (/\b(preview|view)\b/.test(label)) return "preview";
    if (/\bvisibility\b/.test(label)) return "visibility";
    if (/\brefresh|reload|sync\b/.test(label)) return "refresh";
    if (/\bback|return\b/.test(label)) return "back";
    if (/\bsave\b/.test(label)) return "save";
    if (/\bpublish\b/.test(label)) return "publish";
    if (/\b(add|create|new)\b/.test(label)) return "create";
    if (/\bprojects?\b/.test(label) || /projects\.html/.test(href)) return "projects";
    if (/\bsettings?\b/.test(label) || /settings\.html/.test(href)) return "settings";
    if (/\bopen\b|↗/.test(label) || command.target === "_blank") return "open";
    return "generic";
  }

  function decorateTopbarAction(command) {
    if (!(command instanceof HTMLElement)) return;
    const storedLabel = String(command.dataset.lanTopbarActionLabel || "").replace(/\s+/g, " ").trim();
    const sourceLabel = String(command.getAttribute("aria-label") || command.getAttribute("title") || command.textContent || "").replace(/\s+/g, " ").trim();
    const label = storedLabel || sourceLabel;
    if (!label) return;

    const kind = topbarActionKind(command);
    command.setAttribute("data-lan-topbar-action-kind", kind);
    command.dataset.lanTopbarActionDecorated = "true";
    command.dataset.lanTopbarActionLabel = label;
    if (!command.getAttribute("aria-label")) command.setAttribute("aria-label", label);
    if (!command.getAttribute("title")) command.setAttribute("title", label);

    let icon = command.querySelector(":scope > .lan-topbar-action-icon");
    let text = command.querySelector(":scope > .lan-topbar-action-label");
    const canonicalChildren = command.children.length === 2 && icon && text;
    if (!canonicalChildren) {
      icon = document.createElement("span");
      icon.className = "lan-topbar-action-icon";
      icon.setAttribute("aria-hidden", "true");
      text = document.createElement("span");
      text.className = "lan-topbar-action-label";
      command.replaceChildren(icon, text);
    }
    const iconKind = TOPBAR_ACTION_ICON_BY_KIND[kind] || TOPBAR_ACTION_ICON_BY_KIND.generic;
    if (icon.dataset.lanTopbarIconKind !== iconKind || !icon.firstElementChild) {
      icon.innerHTML = renderSystemIcon(iconKind, { className: "lan-topbar-action-svg" });
      icon.dataset.lanTopbarIconKind = iconKind;
    }
    const nextText = command.dataset.lanTopbarStateLabel || label;
    if (text.textContent !== nextText) text.textContent = nextText;
  }

  function setTopbarActionState(command, { label = null, busy = null, disabled = null } = {}) {
    if (!(command instanceof HTMLElement)) return;
    decorateTopbarAction(command);
    if (label === null || label === undefined || label === "") delete command.dataset.lanTopbarStateLabel;
    else command.dataset.lanTopbarStateLabel = String(label).replace(/\s+/g, " ").trim();
    const text = command.querySelector(":scope > .lan-topbar-action-label");
    const nextText = command.dataset.lanTopbarStateLabel || command.dataset.lanTopbarActionLabel || "";
    if (text && text.textContent !== nextText) text.textContent = nextText;
    if (busy !== null) {
      if (busy) command.setAttribute("aria-busy", "true");
      else command.removeAttribute("aria-busy");
    }
    if (disabled !== null && "disabled" in command) command.disabled = Boolean(disabled);
    scheduleTopbarSync(command);
  }

  window.LANSetTopbarActionState = setTopbarActionState;

  function syncTopbarActions(topbar = $(".editor-topbar,.composer-header,.about-header,.dashboard-header")) {
    if (!(topbar instanceof HTMLElement)) return;
    const actions = $(".editor-topbar-actions,.composer-header-actions,.about-header-actions,.dashboard-header-actions", topbar);
    if (!(actions instanceof HTMLElement)) return;

    let commandGroup = actions.querySelector(":scope > .lan-topbar-command-group");
    if (!commandGroup) {
      commandGroup = document.createElement("div");
      commandGroup.className = "lan-topbar-command-group";
      const account = actions.querySelector(":scope > .lan-account-chip");
      actions.insertBefore(commandGroup, account || null);
    }

    [...actions.querySelectorAll("button,a")].forEach((node) => {
      if (node.closest(".lan-account-chip,[data-lan-health-control],.lan-global-health-control,.lan-command-search")) return;
      node.classList.add("lan-topbar-action");
      if (node.classList.contains("editor-primary-button") || node.classList.contains("btn-primary")) node.dataset.actionPriority = "primary";
      else node.dataset.actionPriority = "secondary";
      decorateTopbarAction(node);
      if (node.parentElement === actions) commandGroup.append(node);
    });

    actions.classList.add("lan-premium-actions");
  }

  function scheduleTopbarSync(scope = document) {
    const topbar = scope instanceof Element
      ? (scope.closest?.(".editor-topbar,.composer-header,.about-header,.dashboard-header") || scope.querySelector?.(".editor-topbar,.composer-header,.about-header,.dashboard-header"))
      : $(".editor-topbar,.composer-header,.about-header,.dashboard-header");
    if (!topbar || topbar.__lanTopbarSyncQueued) return;
    topbar.__lanTopbarSyncQueued = true;
    requestAnimationFrame(() => {
      topbar.__lanTopbarSyncQueued = false;
      syncTopbarActions(topbar);
    });
  }

  function enhanceTopbar() {
    const topbar = $(".editor-topbar,.composer-header,.about-header,.dashboard-header");
    if (!topbar) return;
    if (topbar.dataset.lanTopbarBound !== "true") {
      topbar.dataset.lanTopbarBound = "true";
      topbar.classList.add("lan-shell-header");

      const directContent = [...topbar.children]
        .filter((child) => !child.matches(".menu-button,.sidebar-toggle,#menuButton"));
      const identity = directContent.find((child) =>
        !child.matches(".editor-topbar-actions,.composer-header-actions,.about-header-actions,.dashboard-header-actions,.lan-command-search")
      );
      identity?.classList.add("lan-page-identity");

      let actions = $(".editor-topbar-actions,.composer-header-actions,.about-header-actions,.dashboard-header-actions", topbar);
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "editor-topbar-actions";
        directContent.filter((child) => child !== identity).forEach((child) => actions.append(child));
        topbar.append(actions);
      }

      if (!$(".lan-command-search", topbar)) {
        const search = document.createElement("button");
        search.type = "button";
        search.className = "lan-command-search";
        search.setAttribute("aria-label", "Search the Admin");
        search.innerHTML = `<span aria-hidden="true">⌕</span><span>Search anything…</span><kbd>Ctrl K</kbd>`;
        search.addEventListener("click", () => window.__LAN_OPEN_COMMAND__?.());
        topbar.insertBefore(search, actions);
      }

      if (!$(".lan-user-chip", topbar)) {
        const chip = document.createElement("div");
        chip.className = "lan-user-chip lan-account-chip";
        chip.innerHTML = `<span class="lan-user-avatar" data-lan-avatar><span>RL</span></span><span class="lan-account-chip__copy"><strong>${escapeHtml(readAdminDisplayName())}</strong><small>Administrator</small></span>`;
        actions.append(chip);
      }
    }

    syncTopbarActions(topbar);
    applyAdminDisplayName();
  }

  const HEALTH_NOTICE_KEY = "lan-cms-health-notified";
  const activeHealthNotices = new Map();

  function diagnosticsHref(service = "") {
    const url = new URL(`${pageBase}settings.html`, location.href);
    url.searchParams.set("room", "advanced");
    if (service) url.searchParams.set("service", service);
    return url.href;
  }

  function openDiagnostics(service = "") {
    const target = diagnosticsHref(service);
    if (new URL(target).href === location.href) {
      window.dispatchEvent(new CustomEvent("lan:open-diagnostics", { detail: { service } }));
      return;
    }
    navigateAdminPage(target);
  }

  function ensureHealthControl() {
    const topbar = $(".editor-topbar,.composer-header,.about-header,.dashboard-header");
    if (!topbar) return null;
    let control = $("[data-lan-health-control]", topbar);
    if (control) return control;
    const settingsPage = document.body.classList.contains("settings-page");
    const existingSettingsStatus = settingsPage ? $("#saveStatus", topbar) : null;
    if (existingSettingsStatus) {
      existingSettingsStatus.dataset.lanHealthControl = "true";
      existingSettingsStatus.classList.add("lan-global-health-control");
      existingSettingsStatus.setAttribute("role", "button");
      existingSettingsStatus.tabIndex = 0;
      if (!$('i', existingSettingsStatus) || !$('span', existingSettingsStatus)) {
        existingSettingsStatus.innerHTML = `<i aria-hidden="true"></i><span>Checking systems</span>`;
      }
      return existingSettingsStatus;
    }
    const actions = $(".editor-topbar-actions,.composer-header-actions,.about-header-actions,.dashboard-header-actions", topbar);
    if (!actions) return null;
    control = document.createElement("button");
    control.type = "button";
    control.className = "lan-global-health-control";
    control.dataset.lanHealthControl = "true";
    control.innerHTML = `<i aria-hidden="true"></i><span>Checking systems</span>`;
    actions.prepend(control);
    return control;
  }

  function setHealthControl(snapshot) {
    const control = ensureHealthControl();
    if (!control || !snapshot) return;
    const issue = snapshot.issues?.[0] || null;
    const critical = Number(snapshot.criticalCount || 0);
    const warnings = Number(snapshot.warningCount || 0);
    const checking = snapshot.readiness === "checking";
    const state = critical ? "critical" : warnings ? "warning" : checking ? "checking" : "healthy";
    control.dataset.healthState = state;
    const label = critical
      ? `${critical} critical ${critical === 1 ? "issue" : "issues"}`
      : warnings
        ? `Review ${warnings} ${warnings === 1 ? "issue" : "issues"}`
        : checking
          ? "Checking systems"
          : "System healthy";
    const text = $("span", control);
    if (text) text.textContent = label;
    else control.textContent = label;
    const description = issue
      ? `${label}. ${issue.name}: ${issue.summary}`
      : checking
        ? `${label}. Protected services are synchronizing.`
        : `${label}. Open diagnostics.`;
    control.setAttribute("aria-label", description);
    control.title = issue ? `${issue.name}: ${issue.detail}` : checking ? "Protected services are synchronizing" : "Open system diagnostics";
    control.dataset.healthService = issue?.id || "";
  }

  function notifyHealthIssues(snapshot) {
    let previous = {};
    try { previous = JSON.parse(sessionStorage.getItem(HEALTH_NOTICE_KEY) || "{}"); } catch {}
    const next = {};
    const issues = Array.isArray(snapshot?.issues) ? snapshot.issues : [];
    const currentIds = new Set(issues.map((issue) => issue.id));

    activeHealthNotices.forEach((record, serviceId) => {
      const issue = issues.find((item) => item.id === serviceId);
      const nextKey = issue ? `${issue.severity}:${issue.code}` : "";
      if (!issue || record.key !== nextKey) {
        record.toast?.remove();
        activeHealthNotices.delete(serviceId);
      }
    });

    issues.forEach((issue) => {
      const key = `${issue.severity}:${issue.code}`;
      next[issue.id] = key;
      if (activeHealthNotices.get(issue.id)?.key === key) return;
      if (previous[issue.id] === key && !activeHealthNotices.has(issue.id)) return;
      const toast = window.LANNotice?.({
        title: issue.severity === "critical" ? `${issue.name} requires attention` : `${issue.name} warning`,
        message: `${issue.summary}. Click to open Diagnostics.`,
        tone: issue.severity === "critical" ? "error" : "warning",
        timeout: issue.severity === "critical" ? 9000 : 7000
      });
      if (toast) {
        toast.classList.add("is-actionable", "lan-system-health-toast");
        toast.dataset.lanHealthNoticeService = issue.id;
        activeHealthNotices.set(issue.id, { key, toast });
        const retire = () => {
          const current = activeHealthNotices.get(issue.id);
          if (current?.toast === toast) activeHealthNotices.delete(issue.id);
        };
        toast.addEventListener("click", (event) => {
          if (event.target.closest(".lan-toast-close")) return;
          openDiagnostics(issue.id);
        });
        toast.addEventListener("transitionend", () => { if (!toast.isConnected) retire(); });
        window.setTimeout(() => { if (!toast.isConnected) retire(); }, issue.severity === "critical" ? 9400 : 7400);
      }
    });

    if (!issues.length) {
      activeHealthNotices.forEach(({ toast }) => toast?.remove());
      activeHealthNotices.clear();
    }
    try { sessionStorage.setItem(HEALTH_NOTICE_KEY, JSON.stringify(next)); } catch {}
  }

  function initSystemHealthUi() {
    const control = ensureHealthControl();
    if (control) {
      const open = () => openDiagnostics(control.dataset.healthService || "");
      control.addEventListener("click", open);
      control.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    }
    window.addEventListener("lan:system-health", (event) => {
      setHealthControl(event.detail);
      if (!isPersistentWorkspace) notifyHealthIssues(event.detail);
    });
    const healthOwner = isPersistentWorkspace
      ? window.parent?.LANAdminSystemHealth
      : window.LANAdminSystemHealth;
    const current = healthOwner?.getCurrentSystemHealth?.() || null;
    if (current) setHealthControl(current);
  }

  const celestialStarfieldMarkup = () => `<span class="lan-page-band-stars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
  const shootingStarMarkup = () => `<span class="lan-shooting-stars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
  const astronautMarkup = () => `<span class="lan-header-astronaut" aria-hidden="true"><svg viewBox="0 0 72 72" role="presentation"><g><path class="lan-astronaut-pack" d="M16 29h9v24h-9c-2 0-3-1-3-3V32c0-2 1-3 3-3Z"/><circle class="lan-astronaut-helmet" cx="35" cy="20" r="13"/><path class="lan-astronaut-visor" d="M25 18c2-8 17-10 21-1-1 7-17 10-21 1Z"/><path class="lan-astronaut-body" d="M24 33c5-5 18-5 23 0l4 21H20z"/><path class="lan-astronaut-suit-panel" d="M29 36h13v9H29z"/><path class="lan-astronaut-leg" d="M27 52 21 65M43 52l8 12"/><path class="lan-astronaut-arm" d="M24 35 11 45"/><g class="lan-astronaut-wave"><path d="M47 34 59 23"/><path d="M59 23 64 14"/></g><circle class="lan-astronaut-light" cx="39" cy="40" r="1.8"/><circle class="lan-astronaut-joint" cx="22" cy="54" r="2.3"/><circle class="lan-astronaut-joint" cx="49" cy="53" r="2.3"/></g></svg></span>`;

  function startPlanetSequence(band) {
    const planet = $(".lan-orbiting-planet", band);
    if (!planet) return;

    if (typeof band.__planetOrbitCleanup === "function") band.__planetOrbitCleanup();

    const planets = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
    const reduced = document.documentElement.dataset.reducedMotion === "true";
    let planetIndex = 2;

    const applyPlanet = () => {
      planet.dataset.planet = planets[planetIndex % planets.length];
    };

    applyPlanet();
    if (reduced) {
      planet.classList.add("is-static");
      band.__planetOrbitCleanup = () => delete band.__planetOrbitCleanup;
      return;
    }

    planet.classList.remove("is-static");
    const onIteration = () => {
      planetIndex = (planetIndex + 1) % planets.length;
      applyPlanet();
    };
    planet.addEventListener("animationiteration", onIteration);

    const cleanup = () => {
      planet.removeEventListener("animationiteration", onIteration);
      delete band.__planetOrbitCleanup;
    };
    band.__planetOrbitCleanup = cleanup;
    window.addEventListener("pagehide", cleanup, { once: true });
  }

  function startAstronautDrift(band) {
    const astronaut = $(".lan-header-astronaut", band);
    if (!astronaut) return;

    if (typeof band.__astronautCleanup === "function") band.__astronautCleanup();

    const reduced = document.documentElement.dataset.reducedMotion === "true";
    const stateKey = "lan:header-astronaut:v6";
    const paintInterval = 1000 / 30;
    const persistInterval = 8000;
    let frame = 0;
    let running = false;
    let visible = true;
    let lastTime = performance.now();
    let lastPaint = lastTime;
    let lastPersist = lastTime;
    let bounds = { width: 0, height: 0 };
    let astroWidth = 34;
    let astroHeight = 34;
    let x = 0;
    let y = 0;
    let vx = 13;
    let vy = 4;
    let ax = 0;
    let ay = 0;
    let angle = -10;
    let angularVelocity = 4;
    let initialized = false;
    let nextDriftChange = lastTime + 3800;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const randomBetween = (min, max) => min + Math.random() * (max - min);

    const capSpeed = () => {
      const speed = Math.hypot(vx, vy) || 1;
      const minSpeed = 9;
      const maxSpeed = 19;
      if (speed < minSpeed) {
        vx = (vx / speed) * minSpeed;
        vy = (vy / speed) * minSpeed;
      } else if (speed > maxSpeed) {
        vx = (vx / speed) * maxSpeed;
        vy = (vy / speed) * maxSpeed;
      }
    };

    const restoreState = () => {
      try {
        const stored = JSON.parse(sessionStorage.getItem(stateKey) || "null");
        return stored && typeof stored === "object" ? stored : null;
      } catch {
        return null;
      }
    };

    const persistState = () => {
      if (!initialized || !bounds.width || !bounds.height) return;
      try {
        sessionStorage.setItem(stateKey, JSON.stringify({
          nx: clamp(x / Math.max(1, bounds.width - astroWidth), 0, 1),
          ny: clamp(y / Math.max(1, bounds.height - astroHeight), 0, 1),
          vx, vy, ax, ay,
          angle: ((angle % 360) + 360) % 360,
          angularVelocity
        }));
      } catch {}
    };

    const chooseDrift = () => {
      ax = randomBetween(-.72, .72);
      ay = randomBetween(-.46, .46);
      nextDriftChange = performance.now() + randomBetween(4200, 7600);
    };

    const readGeometry = () => {
      const bandRect = band.getBoundingClientRect();
      const astroRect = astronaut.getBoundingClientRect();
      astroWidth = Math.max(24, astroRect.width || 34);
      astroHeight = Math.max(24, astroRect.height || astroWidth);
      bounds = {
        width: Math.max(astroWidth + 24, bandRect.width),
        height: Math.max(astroHeight + 18, bandRect.height)
      };

      const minX = 5;
      const minY = 4;
      const maxX = Math.max(minX, bounds.width - astroWidth - 5);
      const maxY = Math.max(minY, bounds.height - astroHeight - 4);

      if (!initialized) {
        const stored = restoreState();
        if (stored) {
          x = clamp(Number(stored.nx || 0) * maxX, minX, maxX);
          y = clamp(Number(stored.ny || 0) * maxY, minY, maxY);
          vx = Number.isFinite(Number(stored.vx)) ? Number(stored.vx) : vx;
          vy = Number.isFinite(Number(stored.vy)) ? Number(stored.vy) : vy;
          ax = Number.isFinite(Number(stored.ax)) ? Number(stored.ax) : ax;
          ay = Number.isFinite(Number(stored.ay)) ? Number(stored.ay) : ay;
          angle = Number.isFinite(Number(stored.angle)) ? Number(stored.angle) : angle;
          angularVelocity = Number.isFinite(Number(stored.angularVelocity)) ? Number(stored.angularVelocity) : angularVelocity;
        } else {
          x = randomBetween(bounds.width * .16, bounds.width * .78);
          y = randomBetween(minY, maxY);
          const horizontalDirection = Math.random() > .5 ? 1 : -1;
          vx = randomBetween(10, 16) * horizontalDirection;
          vy = randomBetween(-5, 5);
          angle = randomBetween(-34, 34);
          angularVelocity = randomBetween(-6, 6);
          chooseDrift();
        }
        capSpeed();
        initialized = true;
      } else {
        x = clamp(x, minX, maxX);
        y = clamp(y, minY, maxY);
      }
    };

    const paint = () => {
      astronaut.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${angle.toFixed(2)}deg)`;
    };

    const impactTumble = (axis) => {
      const direction = Math.random() > .5 ? 1 : -1;
      angularVelocity += direction * randomBetween(axis === "x" ? 24 : 18, axis === "x" ? 62 : 48);
      angularVelocity = clamp(angularVelocity, -88, 88);
      if (axis === "x") vy += randomBetween(-1.8, 1.8);
      else vx += randomBetween(-1.8, 1.8);
      ax *= .35;
      ay *= .35;
      capSpeed();
    };

    const stopLoop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      running = false;
    };

    const step = (now) => {
      if (!running) return;
      if (document.hidden || !visible) {
        stopLoop();
        return;
      }
      if (now - lastPaint < paintInterval) {
        frame = requestAnimationFrame(step);
        return;
      }

      const dt = Math.min(.06, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      lastPaint = now;
      if (now >= nextDriftChange) chooseDrift();

      vx += ax * dt;
      vy += ay * dt;
      capSpeed();

      const minX = 5;
      const minY = 4;
      const maxX = Math.max(minX, bounds.width - astroWidth - 5);
      const maxY = Math.max(minY, bounds.height - astroHeight - 4);
      let nextX = x + vx * dt;
      let nextY = y + vy * dt;

      if (nextX <= minX || nextX >= maxX) {
        nextX = clamp(nextX, minX, maxX);
        vx = Math.max(8, Math.abs(vx)) * (nextX <= minX ? 1 : -1);
        impactTumble("x");
      }
      if (nextY <= minY || nextY >= maxY) {
        nextY = clamp(nextY, minY, maxY);
        vy = Math.max(6, Math.abs(vy)) * (nextY <= minY ? 1 : -1);
        impactTumble("y");
      }

      x = nextX;
      y = nextY;
      angle = (angle + angularVelocity * dt) % 360;
      angularVelocity *= Math.pow(.985, dt * 60);
      paint();

      if (now - lastPersist > persistInterval) {
        persistState();
        lastPersist = now;
      }
      frame = requestAnimationFrame(step);
    };

    const startLoop = () => {
      if (running || reduced || document.hidden || !visible) return;
      running = true;
      lastTime = performance.now();
      lastPaint = lastTime - paintInterval;
      frame = requestAnimationFrame(step);
    };

    readGeometry();
    paint();

    if (reduced) {
      band.__astronautCleanup = () => {
        persistState();
        astronaut.style.removeProperty("transform");
        delete band.__astronautCleanup;
      };
      return;
    }

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(readGeometry) : null;
    resizeObserver?.observe(band);
    window.addEventListener("resize", readGeometry, { passive: true });

    const intersectionObserver = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          if (visible) startLoop(); else stopLoop();
        }, { rootMargin: "80px" })
      : null;
    intersectionObserver?.observe(band);

    const onVisibilityChange = () => {
      if (document.hidden) {
        persistState();
        stopLoop();
      } else {
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    startLoop();

    const cleanup = () => {
      stopLoop();
      persistState();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("resize", readGeometry);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      astronaut.style.removeProperty("transform");
      delete band.__astronautCleanup;
    };
    band.__astronautCleanup = cleanup;
    window.addEventListener("pagehide", cleanup, { once: true });
  }

  function applyTimeCelestial(band) {
    const body = $(".lan-time-celestial", band);
    if (!body) return;
    const hour = new Date().getHours();
    const isDay = hour >= 6 && hour < 18;
    body.dataset.celestial = isDay ? "sun" : "moon";
    body.setAttribute("aria-label", isDay ? "Daytime sun" : "Night moon");
  }

  function createLocalPageHeader() {
    const body = document.body;
    const topbar = $(".editor-topbar,.composer-header,.about-header,.dashboard-header");
    if (!topbar || body.dataset.lanLocalHeader === "true") return;

    if (body.classList.contains("dashboard-page")) {
      body.dataset.lanLocalHeader = "dashboard-native";
      return;
    }

    body.dataset.lanLocalHeader = "true";
    body.classList.add("lan-local-page-header");
    if (body.classList.contains("settings-page")) return;

    const root = body.classList.contains("home-page")
      ? $(".composer-canvas")
      : body.classList.contains("about-page")
        ? $(".about-canvas")
        : $(".editor-content");
    if (!root) return;

    mountAdminPageBand({
      body,
      root,
      topbar,
      resolvePageKey: navKey,
      renderPageIcon: (key) => key
        ? renderSystemIcon(NAVIGATION_ICON_MAP[key] || "sparkles", { className: "lan-page-band-system-icon" })
        : "LΛN",
      escapeHtml,
      celestialStarfieldMarkup,
      shootingStarMarkup,
      astronautMarkup,
      applyTimeCelestial,
      startPlanetSequence,
      startAstronautDrift
    });
  }

  let localPageFooterSyncFrame = 0;
  function syncLocalPageFooter() {
    const root = $(".editor-content,.composer-canvas,.about-canvas,.dashboard-stage");
    if (!root) return;
    const title = $(".editor-topbar h1,.composer-header h1,.about-header h1,.dashboard-header h1")?.textContent?.trim() || document.title.split("|")[0].trim() || "Workspace";
    let footer = root.querySelector(":scope > .lan-admin-page-footer");
    if (!footer) {
      footer = document.createElement("footer");
      footer.className = "lan-admin-page-footer";
    }
    footer.setAttribute("aria-label", `${title} workspace footer`);
    footer.innerHTML = `<strong>LΛN Portfolio CMS v2</strong><small>End of ${escapeHtml(title)} workspace</small>`;
    if (root.lastElementChild !== footer) root.append(footer);
  }

  function scheduleLocalPageFooterSync() {
    cancelAnimationFrame(localPageFooterSyncFrame);
    localPageFooterSyncFrame = requestAnimationFrame(() => {
      localPageFooterSyncFrame = 0;
      syncLocalPageFooter();
    });
  }

  function createLocalPageFooter() {
    syncLocalPageFooter();
  }

  function initSettingsCelestialHero() {
    const hero = $(".settings-hero");
    if (!hero || $(":scope > .settings-celestial-layer", hero)) return;

    const layer = document.createElement("div");
    layer.className = "settings-celestial-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = `${celestialStarfieldMarkup()}${shootingStarMarkup()}<span class="settings-space-planet settings-space-planet--far"></span><span class="settings-space-planet settings-space-planet--near"></span><span class="lan-planet-orbit-stage"><i class="lan-orbiting-planet" data-planet="earth"></i></span>${astronautMarkup()}`;
    hero.prepend(layer);
    startPlanetSequence(layer);
    startAstronautDrift(layer);
  }

  function resolveShellMediaUrl(value = "") {
    const url = String(value || "").trim();
    if (!url) return "";
    if (url.startsWith("assets/")) return `/${url}`;
    if (url.startsWith("./assets/")) return `/${url.slice(2)}`;
    return url;
  }

  function applyAdminAvatar(source = "") {
    const resolved = resolveShellMediaUrl(source);
    const hosts = [...document.querySelectorAll("[data-lan-avatar],.editor-avatar")];
    hosts.forEach((host) => {
      if (!(host instanceof HTMLElement)) return;
      host.classList.add("lan-user-avatar");
      host.dataset.lanAvatar = "true";
      host.replaceChildren();
      if (resolved) {
        const image = document.createElement("img");
        image.alt = "Rolando profile";
        image.src = resolved;
        image.decoding = "async";
        image.addEventListener("error", () => {
          host.replaceChildren(Object.assign(document.createElement("span"), { textContent: "RL" }));
          host.classList.remove("has-image");
        }, { once: true });
        host.append(image);
        host.classList.add("has-image");
      } else {
        host.append(Object.assign(document.createElement("span"), { textContent: "RL" }));
        host.classList.remove("has-image");
      }
    });
  }

  async function hydrateAdminAvatar() {
    // Give auth-guard time to publish its ready promise, then read the canonical
    // Home portrait. If Firestore is unavailable, the bundled Hero portrait is
    // a safe visual fallback; initials remain the final fallback.
    try {
      for (let index = 0; index < 40 && !window.__LAN_ADMIN_READY__; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (window.__LAN_ADMIN_READY__) await window.__LAN_ADMIN_READY__;
      const { loadHome } = await import("../services/homeService.js");
      const home = await loadHome();
      applyAdminAvatar(home?.portrait || "/assets/images/hero.png");
    } catch (error) {
      console.warn("Admin avatar could not read the saved Hero portrait.", error);
      applyAdminAvatar("/assets/images/hero.png");
    }
  }

  /* --------------------------------------------------------------------- */
  /* Shared Save Bar state                                                 */
  /* --------------------------------------------------------------------- */
  function saveStateFromText(value = "") {
    const text = String(value || "").trim().toLowerCase();
    if (/error|failed|unable|denied|invalid/.test(text)) return "error";
    if (/saving|uploading|processing|publishing|working|loading/.test(text)) return "saving";
    if (/unsaved|changed|draft|removed from this record|ready to save/.test(text)) return "dirty";
    if (/saved|complete|published|ready|success/.test(text)) return "saved";
    return "idle";
  }

  function initSaveBars(scope = document) {
    $$(".composer-savebar,.about-savebar,.project-sticky-actions,.editor-savebar,.sticky-form-actions", scope).forEach((bar) => {
      if (bar.dataset.lanSaveBound === "true") return;
      bar.dataset.lanSaveBound = "true";
      const form = bar.closest("form");
      const status = $("#saveStatus", form || document) || $("#saveStatus") || $("[aria-live='polite']", bar);
      const sync = () => {
        const state = saveStateFromText(status?.textContent || "");
        if (state !== "idle" || !bar.dataset.saveState) bar.dataset.saveState = state;
      };
      sync();
      if (status) new MutationObserver(sync).observe(status, { childList: true, subtree: true, characterData: true, attributes: true });
      form?.addEventListener("input", () => { if (bar.dataset.saveState !== "saving") bar.dataset.saveState = "dirty"; }, { passive: true });
      form?.addEventListener("change", () => { if (bar.dataset.saveState !== "saving") bar.dataset.saveState = "dirty"; }, { passive: true });
    });
  }

  /* --------------------------------------------------------------------- */
  /* Accessible custom select                                              */
  /* --------------------------------------------------------------------- */
  let selectPortal = null;
  let openSelectInstance = null;
  let selectCounter = 0;
  const selectInstances = new Set();

  function portal() {
    if (selectPortal?.isConnected) return selectPortal;
    selectPortal = document.createElement("div");
    selectPortal.className = "lan-select-menu";
    selectPortal.dataset.lanSelectPortal = "true";
    selectPortal.setAttribute("role", "listbox");
    document.body.append(selectPortal);
    return selectPortal;
  }

  function positionSelect(instance) {
    const menu = portal();
    if (!instance || !menu.classList.contains("is-open")) return;
    const rect = instance.trigger.getBoundingClientRect();
    const gutter = 10;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const width = Math.min(Math.max(rect.width, 190), vw - gutter * 2);
    const desired = Math.min(340, Math.max(90, instance.select.options.length * 40 + 10));
    const below = vh - rect.bottom - gutter;
    const above = rect.top - gutter;
    const openUp = below < Math.min(desired, 210) && above > below;
    const available = Math.max(120, Math.min(340, openUp ? above : below));
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(gutter, Math.min(rect.left, vw - width - gutter))}px`;
    menu.style.maxHeight = `${available}px`;
    menu.style.top = openUp ? `${Math.max(gutter, rect.top - Math.min(desired, available) - 5)}px` : `${Math.min(vh - gutter, rect.bottom + 5)}px`;
  }

  function closeSelect({ focus = false } = {}) {
    if (!openSelectInstance) return;
    const instance = openSelectInstance;
    instance.trigger.setAttribute("aria-expanded", "false");
    portal().classList.remove("is-open");
    portal().replaceChildren();
    openSelectInstance = null;
    if (focus && instance.trigger.isConnected) instance.trigger.focus();
  }

  function renderSelectOptions(instance) {
    const menu = portal();
    menu.replaceChildren();
    menu.setAttribute("aria-labelledby", instance.trigger.id);
    const seen = new Set();
    [...instance.select.options].forEach((option, index) => {
      const key = `${String(option.value || "").trim().toLowerCase()}::${String(option.textContent || "").trim().toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lan-select-option";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === instance.select.selectedIndex));
      item.disabled = option.disabled;
      const label = document.createElement("span"); label.textContent = option.textContent;
      const check = document.createElement("span"); check.className = "lan-select-check"; check.textContent = "✓"; check.setAttribute("aria-hidden", "true");
      item.append(label, check);
      item.addEventListener("click", () => {
        const changed = instance.select.selectedIndex !== index;
        instance.select.selectedIndex = index;
        if (changed) {
          instance.select.dispatchEvent(new Event("input", { bubbles: true }));
          instance.select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        instance.sync(); closeSelect({ focus: true });
      });
      menu.append(item);
    });
  }

  function openSelect(instance) {
    if (instance.select.disabled) return;
    if (openSelectInstance === instance) return closeSelect({ focus: true });
    closeSelect(); openSelectInstance = instance;
    instance.sync(); instance.trigger.setAttribute("aria-expanded", "true");
    renderSelectOptions(instance); portal().classList.add("is-open"); positionSelect(instance);
    $("[aria-selected='true']:not(:disabled)", portal())?.scrollIntoView({ block: "nearest" });
  }

  function enhanceSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.dataset.lanSelect === "native" || select.dataset.lanSelectEnhanced === "true" || select.closest(".lan-select")) return;
    if (select.classList.contains("sr-only") || select.classList.contains("visually-hidden") || select.classList.contains("display-type-native-select")) return;
    select.dataset.lanSelectEnhanced = "true";
    const wrapper = document.createElement("span"); wrapper.className = "lan-select";
    select.before(wrapper); wrapper.append(select); select.classList.add("lan-select-native");
    const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "lan-select-trigger"; trigger.id = `lanSelectTrigger${++selectCounter}`; trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
    const value = document.createElement("span"); value.className = "lan-select-value";
    const chev = document.createElement("span"); chev.className = "lan-select-chevron"; chev.setAttribute("aria-hidden", "true");
    trigger.append(value, chev); wrapper.append(trigger);
    const instance = {
      select, wrapper, trigger, value,
      sync() {
        value.textContent = select.options[select.selectedIndex]?.textContent?.trim() || "Select";
        trigger.disabled = select.disabled;
        const name = select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || select.name || select.id || "Select";
        trigger.setAttribute("aria-label", `${name}: ${value.textContent}`);
        if (openSelectInstance === instance) { renderSelectOptions(instance); positionSelect(instance); }
      }
    };
    selectInstances.add(instance);
    trigger.addEventListener("click", () => openSelect(instance));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeSelect({ focus: true }); }
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); if (openSelectInstance !== instance) openSelect(instance); }
    });
    select.addEventListener("input", instance.sync);
    select.addEventListener("change", instance.sync);
    select.addEventListener("lan:select-sync", instance.sync);
    select.form?.addEventListener("reset", () => queueMicrotask(instance.sync));
    new MutationObserver(instance.sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    instance.sync();
  }

  function enhanceSelects(scope = document) {
    if (scope instanceof HTMLSelectElement) enhanceSelect(scope);
    $$('select', scope).forEach(enhanceSelect);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!openSelectInstance) return;
    if (openSelectInstance.wrapper.contains(event.target) || portal().contains(event.target)) return;
    closeSelect();
  });
  document.addEventListener("keydown", (event) => {
    if (!openSelectInstance) return;
    if (event.key === "Escape") { event.preventDefault(); closeSelect({ focus: true }); }
  });
  addEventListener("resize", () => closeSelect());
  document.addEventListener("scroll", (event) => {
    if (!openSelectInstance) return;
    const menu = portal();
    const target = event.target;
    // Scrolling the open dropdown is intentional. The previous implementation
    // closed the menu on its own scroll event, which made long selects feel frozen.
    if (target === menu || (target instanceof Node && menu.contains(target))) return;
    // A scroll inside the native select wrapper cannot move the trigger.
    if (target instanceof Node && openSelectInstance.wrapper.contains(target)) return;
    closeSelect();
  }, true);

  /* --------------------------------------------------------------------- */
  /* Shared modal state                                                     */
  /* --------------------------------------------------------------------- */
  const MODAL_ROOT_SELECTOR = ".modal,.experience-modal,.education-modal,.skills-modal,.project-modal,.project-preview-modal,.project-image-modal,.editor-modal,.skills-editor-dialog,.lan-decision-layer,.lan-command-palette";

  function visibleModalRoots() {
    return $$(MODAL_ROOT_SELECTOR).filter((root) => !root.hidden && !root.classList.contains("hidden") && getComputedStyle(root).display !== "none");
  }

  function syncModalScrollLock() {
    const open = visibleModalRoots().length > 0;
    document.body.classList.toggle("modal-open", open);
    document.documentElement.dataset.modalOpen = open ? "true" : "false";
  }

  const modalStateObserver = new MutationObserver(syncModalScrollLock);
  modalStateObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
  syncModalScrollLock();

  /* --------------------------------------------------------------------- */
  /* Confirmation + notice                                                 */
  /* --------------------------------------------------------------------- */
  function decisionLayer() {
    let layer = $("#lanDecisionLayer");
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "lanDecisionLayer";
    layer.className = "lan-decision-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = `<section class="lan-decision-card" role="alertdialog" aria-modal="true" aria-labelledby="lanDecisionTitle" aria-describedby="lanDecisionMessage"><div class="lan-decision-icon" data-lan-decision-icon aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m8.5 12 2.2 2.2 4.8-5"></path></svg></div><div class="lan-decision-copy"><h2 id="lanDecisionTitle">Confirm action</h2><p id="lanDecisionMessage"></p></div><div class="lan-decision-actions"><button type="button" class="editor-secondary-button" data-lan-decision-cancel>Cancel</button><button type="button" class="editor-primary-button" data-lan-decision-confirm>Confirm</button></div></section>`;
    document.body.append(layer); return layer;
  }

  window.LANConfirm = (options = {}) => new Promise((resolve) => {
    const settings = typeof options === "string" ? { message: options } : options;
    const layer = decisionLayer();
    const title = $("#lanDecisionTitle", layer); const message = $("#lanDecisionMessage", layer);
    const cancel = $("[data-lan-decision-cancel]", layer); const confirm = $("[data-lan-decision-confirm]", layer); const icon = $("[data-lan-decision-icon]", layer);
    title.textContent = settings.title || "Confirm action"; message.textContent = settings.message || "Continue with this action?";
    if (icon) { icon.classList.toggle("is-danger", Boolean(settings.danger)); icon.innerHTML = settings.danger ? `<svg viewBox="0 0 24 24"><path d="M12 3 21 20H3L12 3Z"></path><path d="M12 9v5M12 17h.01"></path></svg>` : `<svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m8.5 12 2.2 2.2 4.8-5"></path></svg>`; }
    cancel.textContent = settings.cancelLabel || "Cancel"; confirm.textContent = settings.confirmLabel || "Confirm";
    confirm.className = settings.danger ? "editor-danger-button" : "editor-primary-button";
    const previous = document.activeElement;
    const close = (result) => {
      layer.hidden = true; layer.setAttribute("aria-hidden", "true"); document.body.classList.remove("lan-decision-open");
      document.removeEventListener("keydown", onKey, true); cancel.onclick = null; confirm.onclick = null; layer.onclick = null;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); resolve(result);
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(false); }
      if (event.key === "Tab") {
        const nodes = [cancel, confirm]; const index = nodes.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); confirm.focus(); }
        else if (!event.shiftKey && index === nodes.length - 1) { event.preventDefault(); cancel.focus(); }
      }
    };
    cancel.onclick = () => close(false); confirm.onclick = () => close(true); layer.onclick = (event) => { if (event.target === layer) close(false); };
    document.addEventListener("keydown", onKey, true); layer.hidden = false; layer.setAttribute("aria-hidden", "false"); document.body.classList.add("lan-decision-open");
    requestAnimationFrame(() => (settings.danger ? cancel : confirm).focus());
  });

  window.LANNotice = (messageOrOptions, options = {}) => {
    const objectForm = messageOrOptions && typeof messageOrOptions === "object" && !Array.isArray(messageOrOptions);
    const message = objectForm ? messageOrOptions.message : messageOrOptions;
    const title = objectForm ? (messageOrOptions.title || "LΛN Portfolio CMS") : (options.title || "LΛN Portfolio CMS");
    const tone = objectForm ? (messageOrOptions.tone || "info") : (options.tone || "info");
    const timeout = Number(objectForm ? messageOrOptions.timeout : options.timeout) || 4200;

    let stack = $("#lanToastStack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "lanToastStack";
      stack.className = "lan-toast-stack";
      stack.setAttribute("aria-live", "polite");
      stack.setAttribute("aria-relevant", "additions");
      document.body.append(stack);
    }

    if (tone === "success" && /saved|created|updated|uploaded|deleted|removed|published|restored|added/i.test(String(message || ""))) {
      try {
        const key = "lanPortfolioRecentActivity";
        const previous = JSON.parse(localStorage.getItem(key) || "[]");
        const next = [{ id: Date.now(), title: String(title || "Portfolio update"), description: String(message || "Update completed."), date: new Date().toISOString() }, ...previous].slice(0, 6);
        localStorage.setItem(key, JSON.stringify(next));
      } catch (error) {
        console.debug("Recent activity could not be recorded.", error);
      }
    }

    const toast = document.createElement("section");
    toast.className = "lan-toast";
    toast.dataset.tone = ["success", "error", "warning", "info"].includes(tone) ? tone : "info";
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
    const symbols = { success: "✓", error: "!", warning: "!", info: "i" };
    toast.innerHTML = `<span class="lan-toast-icon" aria-hidden="true">${symbols[toast.dataset.tone]}</span><div class="lan-toast-copy"><strong></strong><span></span></div><button class="lan-toast-close" type="button" aria-label="Dismiss notification">×</button>`;
    $("strong", toast).textContent = title;
    $(".lan-toast-copy>span", toast).textContent = String(message || "");

    const remove = () => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 180);
    };
    $(".lan-toast-close", toast).addEventListener("click", remove);
    stack.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    let timer = setTimeout(remove, timeout);
    toast.addEventListener("mouseenter", () => clearTimeout(timer));
    toast.addEventListener("mouseleave", () => {
      clearTimeout(timer);
      timer = setTimeout(remove, Math.min(1800, timeout));
    });
    return toast;
  };

  /* --------------------------------------------------------------------- */
  /* Tabs + dynamic component normalization                                */
  /* --------------------------------------------------------------------- */
  function ensureActiveTabContext(tablist, button, panel) {
    if (!tablist || !button) return;
    const behavior = document.documentElement.dataset.reducedMotion === "true" ? "auto" : "smooth";
    button.scrollIntoView({ behavior, block: "nearest", inline: "nearest" });
    if (!panel) return;
    const adminMode = String(document.documentElement.dataset.lanAdminMode || "wide");
    if (adminMode === "wide") return;
    window.requestAnimationFrame(() => {
      const header = $(".lan-shell-header");
      const tabRect = tablist.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const visibleTop = Math.max(header?.getBoundingClientRect().bottom || 0, tabRect.bottom);
      const visibleBottom = window.innerHeight;
      if (panelRect.top < visibleTop - 8 || panelRect.top > visibleBottom - 96) {
        panel.scrollIntoView({ behavior, block: "start", inline: "nearest" });
      }
    });
  }

  function initTabs(scope = document) {
    $$('[data-lan-tabs]', scope).forEach((tablist) => {
      if (tablist.dataset.lanTabsBound === "true") return;
      tablist.dataset.lanTabsBound = "true";
      const root = tablist.closest("form") || tablist.closest("[data-lan-tab-root]") || tablist.closest("main") || document;
      const buttons = $$('[data-lan-tab]', tablist);
      const panels = $$('[data-lan-panel]', root);
      if (!buttons.length || !panels.length) return;
      const activate = (key, { focus = false, reveal = false, emit = true } = {}) => {
        let activeButton = null;
        let activePanel = null;
        buttons.forEach((button) => {
          const active = button.dataset.lanTab === key;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-selected", String(active));
          button.tabIndex = active ? 0 : -1;
          if (active) {
            activeButton = button;
            if (focus) button.focus({ preventScroll: true });
          }
        });
        panels.forEach((panel) => {
          const active = String(panel.dataset.lanPanel || "").split(/\s+/).filter(Boolean).includes(key);
          panel.classList.toggle("workspace-panel-hidden", !active);
          panel.setAttribute("aria-hidden", String(!active));
          if (active && !activePanel) activePanel = panel;
          if (active && panel instanceof HTMLDetailsElement) panel.open = true;
        });
        document.body.dataset.lanActiveTab = key;
        if (reveal) ensureActiveTabContext(tablist, activeButton, activePanel);
        if (emit) tablist.dispatchEvent(new CustomEvent("lan:tabchange", { bubbles: true, detail: { key, button: activeButton, panel: activePanel } }));
        return { button: activeButton, panel: activePanel };
      };
      tablist.__lanActivateTab = activate;
      buttons.forEach((button, index) => {
        button.setAttribute("role", "tab");
        button.addEventListener("click", () => activate(button.dataset.lanTab, { reveal: true }));
        button.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
          if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
          if (event.key === "Home") next = 0;
          if (event.key === "End") next = buttons.length - 1;
          activate(buttons[next].dataset.lanTab, { focus: true, reveal: true });
        });
      });
      tablist.setAttribute("role", "tablist");
      activate(buttons.find((button) => button.classList.contains("is-active"))?.dataset.lanTab || buttons[0].dataset.lanTab, { emit: false });
    });
  }

  window.LANTabs = {
    activate(tablistOrSelector, key, options = {}) {
      const tablist = typeof tablistOrSelector === "string" ? $(tablistOrSelector) : tablistOrSelector;
      if (!tablist) return null;
      if (tablist.dataset.lanTabsBound !== "true") initTabs(tablist.parentElement || document);
      return tablist.__lanActivateTab?.(key, { focus: false, reveal: true, ...options }) || null;
    },
    bind(scope = document) { initTabs(scope); }
  };

  function normalizeFieldAnatomy(scope = document) {
    const controls = [];
    if (scope instanceof HTMLInputElement || scope instanceof HTMLTextAreaElement || scope instanceof HTMLSelectElement) controls.push(scope);
    controls.push(...$$("input,textarea,select", scope));
    controls.forEach((control, index) => {
      if (control.id || control.name || control.type === "hidden") return;
      const owner = control.closest("form,[data-lan-record-library],[data-lan-record-workspace],.editor-panel,.settings-card") || document.body;
      const ownerToken = String(owner.id || owner.getAttribute?.("data-lan-record-workspace") || owner.classList?.[0] || "admin")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "admin";
      const dataAttribute = [...control.attributes].find((attribute) => attribute.name.startsWith("data-") && attribute.name !== "data-lan-anatomy");
      const controlToken = String(dataAttribute?.name?.replace(/^data-/, "") || control.getAttribute("aria-label") || control.type || control.tagName)
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "field";
      let candidate = `${ownerToken}-${controlToken}-${index + 1}`;
      let suffix = 1;
      while (document.getElementById(candidate)) candidate = `${ownerToken}-${controlToken}-${index + 1}-${++suffix}`;
      control.id = candidate;
      control.name = candidate;
    });

    const labels = [];
    if (scope instanceof HTMLLabelElement) labels.push(scope);
    labels.push(...$$("label", scope));
    labels.forEach((label) => {
      const control = label.querySelector("input,textarea,select");
      if (!control || label.dataset.lanAnatomy === "true") return;
      label.dataset.lanAnatomy = "true";
      if (!label.htmlFor && control.id) label.htmlFor = control.id;
      const directText = [...label.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      directText.forEach((node) => {
        const span = document.createElement("span");
        span.className = (control.matches('[type="checkbox"],[type="radio"]') && node.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING)
          ? "check-label"
          : "field-label";
        span.textContent = node.textContent.trim();
        node.replaceWith(span);
      });
    });
  }

  function normalizeButtons(scope = document) {
    const protectedButtons = '.workspace-tab,.segmented-tab,.lan-select-trigger,.lan-select-option,.skills-level-option,.display-type-card,.project-type-option,.navigation-link,.editor-navigation a,.sidebar-toggle,.menu-button,.sidebar-close,.modal-close,.lan-command-search,.editor-logout-button,.logout-button,.settings-system-status,.lan-command-item,.quick-action';
    const known = '.editor-primary-button,.editor-save-button,.editor-secondary-button,.editor-danger-button,.editor-preview-button,.editor-reset-button,.editor-icon-button,.button-primary,.button-secondary,.button-danger,.btn-primary,.btn-secondary,.btn-danger,.quiet-action';
    $$('button', scope).forEach((button) => {
      if (button.matches(protectedButtons)) return;
      const text = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim().toLowerCase();
      if (!button.matches(known)) {
        if (/delete|remove|trash|reinitialize|reset production/.test(text)) button.classList.add("editor-danger-button");
        else if (/save|create|new|add|upload|publish|import|verify|backup/.test(text)) button.classList.add("editor-primary-button");
        else button.classList.add("editor-secondary-button");
      }
      if (button.closest('.simple-card-actions,.photo-card-footer,.bulk-right,.pagination,.view-switch,[class$="-card-actions"]')) button.classList.add("button-compact");
    });
  }

  function normalizeLocalAssetPaths(scope = document) {
    const selector = '[src^="assets/"],[href^="assets/"],[poster^="assets/"]';
    const nodes = [];
    if (scope instanceof Element && scope.matches(selector)) nodes.push(scope);
    if (scope?.querySelectorAll) nodes.push(...scope.querySelectorAll(selector));
    nodes.forEach((node) => {
      for (const attribute of ["src", "href", "poster"]) {
        const value = node.getAttribute?.(attribute);
        if (value?.startsWith("assets/")) node.setAttribute(attribute, `/${value}`);
      }
    });
  }

  const componentObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        normalizeLocalAssetPaths(mutation.target);
        return;
      }
      const mutationElement = mutation.target instanceof Element
        ? mutation.target
        : mutation.target?.parentElement;
      if (mutationElement?.closest?.(".editor-topbar,.composer-header,.about-header,.dashboard-header")) {
        scheduleTopbarSync(mutationElement);
      }
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        normalizeLocalAssetPaths(node);
        enhanceSelects(node); initTabs(node); normalizeFieldAnatomy(node); normalizeButtons(node); initSkillBrandIcons(node); initSaveBars(node);
        scheduleTopbarSync(node);
      });
    });
    scheduleLocalPageFooterSync();
  });

  /* --------------------------------------------------------------------- */
  /* Project presentation rail — one presentation owner                    */
  /* --------------------------------------------------------------------- */
  function projectValue(id, fallback = "") {
    const element = document.getElementById(id); if (!element) return fallback;
    if (element instanceof HTMLSelectElement) return element.options[element.selectedIndex]?.textContent?.trim() || fallback;
    return String(element.value || fallback).trim();
  }
  function ensureProjectLiveRail() {
    const form = document.getElementById("projectForm");
    if (!form || $(".lan-project-live-rail", form)) return;
    const rail = document.createElement("aside");
    rail.className = "lan-project-live-rail lan-admin-editor-rail";
    rail.innerHTML = `<section class="lan-project-preview-card"><div class="lan-project-preview-media" data-live-project-media><div class="lan-project-preview-placeholder">LΛN</div></div><div class="lan-project-preview-body"><small data-live-project-category>Portfolio Project</small><h3 data-live-project-title>Untitled project</h3><p data-live-project-summary>Add a title or select linked content to preview the public card.</p><div class="lan-project-preview-actions" data-live-project-actions><span class="lan-project-preview-action">View Project →</span></div></div></section><section class="lan-link-info"><h3>Link information</h3><dl><div><dt>Type</dt><dd data-live-project-type>Standalone</dd></div><div><dt>Source</dt><dd data-live-project-source>—</dd></div><div><dt>Record</dt><dd data-live-project-record>—</dd></div><div><dt>Buttons</dt><dd data-live-project-action-count>1</dd></div><div><dt>Status</dt><dd data-live-project-status>Draft</dd></div></dl></section>`;
    form.append(rail);
    const sync = () => {
      const type = projectValue("projectType", "Standalone");
      const linked = type.toLowerCase().includes("linked");
      const linkedModuleControl = $("#projectLinkedModule", form);
      const linkedRecordControl = $("#projectLinkedDocumentId", form);
      const linkedScope = String($("#projectLinkedScope", form)?.value || "entry").trim().toLowerCase();
      const linkedModuleValue = String(linkedModuleControl?.value || "").trim();
      const linkedRecordValue = String(linkedRecordControl?.value || "").trim();
      const linkedSourceReady = !linked || Boolean(linkedModuleValue && (linkedScope === "module" || linkedRecordValue));
      const linkedTitle = $("#linkedSourcePreview .linked-source-copy > strong")?.textContent?.trim() || "";
      const linkedSummary = $("#linkedSourcePreview .linked-source-copy p")?.textContent?.trim() || "";
      const linkedModuleLabel = linkedModuleValue
        ? (linkedModuleControl instanceof HTMLSelectElement ? linkedModuleControl.options[linkedModuleControl.selectedIndex]?.textContent?.trim() : linkedModuleValue)
        : "";
      const linkedRecordLabel = linkedRecordValue
        ? (linkedRecordControl instanceof HTMLSelectElement ? linkedRecordControl.options[linkedRecordControl.selectedIndex]?.textContent?.trim() : linkedRecordValue)
        : "";

      const title = linked
        ? (linkedSourceReady ? (linkedTitle || projectValue("projectTitle") || "Linked project") : "Linked source not selected")
        : (projectValue("projectTitle") || "Untitled project");
      const summary = linked
        ? (linkedSourceReady ? (linkedSummary || projectValue("projectShortDescription") || "Linked portfolio content") : "Choose a source module and record to preview this linked Project.")
        : (projectValue("projectShortDescription") || "Add a short description to preview the public card.");
      const category = linked
        ? (linkedModuleLabel || "Linked portfolio")
        : (projectValue("projectCategory") || "Portfolio Project");

      $("[data-live-project-title]", rail).textContent = title;
      $("[data-live-project-summary]", rail).textContent = summary;
      $("[data-live-project-category]", rail).textContent = category;

      const primarySelect = $("#projectButtonLabel", form);
      const primaryLabel = primarySelect?.value === "__custom__"
        ? String($("#projectButtonCustomLabel", form)?.value || "").trim()
        : String(primarySelect?.value || "View Project").trim();
      let actionLabels = linked && !linkedSourceReady ? [] : [primaryLabel || "View Project"];
      if (linkedSourceReady) {
        $$('[data-linked-action-label]', form).forEach((input) => {
          const row = input.closest("[data-linked-action-id]");
          const label = input.value === "__custom__"
            ? String($("[data-linked-action-custom-label]", row)?.value || "").trim()
            : String(input.value || "").trim();
          if (label) actionLabels.push(label);
        });
        const githubEnabled = $("#projectGithubSecondaryEnabled", form)?.checked;
        const githubUrl = String($("#projectGithubUrl", form)?.value || "").trim();
        if (githubEnabled && githubUrl && !actionLabels.some((label) => label.toLowerCase() === "github")) actionLabels.push("GitHub");
      }

      const actionHost = $("[data-live-project-actions]", rail);
      if (actionHost) {
        actionHost.innerHTML = actionLabels.length
          ? actionLabels.map((label, index) => `<span class="lan-project-preview-action${index ? " is-secondary" : ""}">${escapeHtml(label)} →</span>`).join("")
          : '<span class="lan-project-preview-action is-disabled">Select linked source</span>';
      }
      $("[data-live-project-action-count]", rail).textContent = String(actionLabels.length);
      $("[data-live-project-type]", rail).textContent = linked ? "Linked content" : "Standalone";
      $("[data-live-project-source]", rail).textContent = linked ? (linkedModuleLabel || "Not selected") : "Standalone";
      $("[data-live-project-record]", rail).textContent = linked ? (linkedSourceReady ? (linkedScope === "module" ? "Entire module" : (linkedRecordLabel || "Not selected")) : "Not selected") : "Independent project";
      $("[data-live-project-status]", rail).textContent = linked && !linkedSourceReady ? "Incomplete" : projectValue("projectStatus", "Draft");

      const media = $("[data-live-project-media]", rail);
      const cover = linked
        ? (linkedSourceReady ? ($("#linkedSourcePreview img")?.src || "") : "")
        : ($("#coverPreviewImage")?.src || "");
      if (cover && /^https?:|^blob:|^data:/.test(cover)) media.innerHTML = `<img src="${cover}" alt="Project cover preview">`;
      else media.innerHTML = '<div class="lan-project-preview-placeholder">LΛN</div>';
    };
    form.addEventListener("input", sync); form.addEventListener("change", sync);
    [$("#linkedSourcePreview"), $("#projectAdditionalActionsList"), $("#coverPreview"), $("#projectResourceStatus")].filter(Boolean).forEach((node) => new MutationObserver(sync).observe(node, { childList: true, subtree: true, attributes: true }));
    sync();
  }

  /* --------------------------------------------------------------------- */
  /* Skills & Tools semantics                                               */
  /* --------------------------------------------------------------------- */
  const LEGACY_TOOL_RECORD_NAMES = new Set([
    "microsoft excel",
    "google workspace",
    "firebase and firestore",
    "firebase firestore",
    "adobe photoshop",
    "html css and javascript",
    "html css javascript"
  ]);

  const normalizeCapabilityName = (value = "") => String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const isLegacyToolRecord = (value = "") => LEGACY_TOOL_RECORD_NAMES.has(normalizeCapabilityName(value));
  const isManagedToolRecord = (record = {}) => String(record?.recordType || "").toLowerCase() === "tool" || isLegacyToolRecord(record?.name);

  const collectCapabilityTools = (records = []) => {
    const byKey = new Map();
    const add = (name, owner = "", record = null) => {
      const clean = String(name || "").trim();
      const key = clean.toLowerCase();
      if (!clean) return;
      const existing = byKey.get(key);
      const candidate = {
        id: String(record?.id || existing?.id || "").trim(),
        name: clean,
        owner: String(owner || existing?.owner || "").trim(),
        managed: Boolean(record?.id || existing?.managed),
        category: String(record?.category || existing?.category || "").trim(),
        customCategory: String(record?.customCategory || existing?.customCategory || "").trim(),
        icon: String(record?.icon || existing?.icon || "").trim(),
        active: record?.active !== false,
      };
      if (!existing || candidate.managed) byKey.set(key, candidate);
    };
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (isManagedToolRecord(record)) add(record.name, "Tools library", record);
    });
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (isManagedToolRecord(record)) return;
      (Array.isArray(record?.tools) ? record.tools : []).forEach((tool) => add(tool, record?.name || ""));
    });
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  window.LANCapabilitySemantics = Object.freeze({
    normalizeName: normalizeCapabilityName,
    isLegacyToolRecord,
    isManagedToolRecord,
    collectTools: collectCapabilityTools
  });

  /* --------------------------------------------------------------------- */
  /* Skill / tool icon resolver — local first, automatic discovery second   */
  /* --------------------------------------------------------------------- */
  /* Tool brand identity is owned by the shared root tool-identity module. */

  const SKILL_GLYPHS = Object.freeze({
    "3d": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 4-7 4-7-4 7-4Z"/><path d="m5 7v8l7 4 7-4V7"/><path d="M12 11v8"/></svg>',
    data: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M9 5v14M15 5v14"/></svg>',
    research: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/></svg>',
    database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6-6 6 6 6M15 6l6 6-6 6M14 4l-4 16"/></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="13" height="10" rx="2"/><path d="M7 18h5M9.5 14v4"/><path d="m18.5 12.5 2 2-5 5-3 .8.8-3 5.2-4.8Z"/></svg>',
    gis: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/><path d="M3 21h18"/></svg>',
    photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 17 4-4 3 3 2-2 5 3"/><path d="M17 3v4M15 5h4"/></svg>',
    admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l2 3v13H6V7l2-3Z"/><path d="M9 4v3h6V4M9 11h6M9 15h6"/></svg>',
    typing: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h.01M6 14h2M10 14h5M17 14h1"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2v-4ZM9 9l4 3-4 3V9Z"/></svg>',
    design: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 9-9 9-9-9 9-9Z"/><circle cx="12" cy="12" r="2.5"/><path d="M12 5v4M12 15v4M5 12h4M15 12h4"/></svg>',
    verify: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 4.8-3.2 7.6-8 9-4.8-1.4-8-4.2-8-9V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
    convert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13l-3-3M20 17H7l3 3M17 4l3 3-3 3M7 14l-3 3 3 3"/></svg>',
    organize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M6 12h5M6 15h8"/></svg>',
    format: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 9h9M5 13h14M5 17h6"/><path d="M17 9v10M14 16l3 3 3-3"/></svg>',
    automation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 11h5l-1 9 8-12h-5l0-8Z"/></svg>',
    security: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 4.8-3.2 7.6-8 9-4.8-1.4-8-4.2-8-9V6l8-3Z"/><rect x="9" y="10" width="6" height="5" rx="1"/><path d="M10 10V8.5a2 2 0 0 1 4 0V10"/></svg>',
    fallback: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"/></svg>',
  });

  const SEMANTIC_ALIASES = [
    [/\b3d\b|animation|render(?:ing)?|model(?:ing|ling)/i, { key: "3d", label: "3D", type: "semantic", name: "3D and rendering" }],
    [/data\s+verification|verify|validation|quality\s+assurance|quality\s+check|audit/i, { key: "verify", label: "Check", type: "semantic", name: "Verification" }],
    [/data\s+conversion|convert|migration|transform/i, { key: "convert", label: "Convert", type: "semantic", name: "Conversion" }],
    [/research|search|analysis/i, { key: "research", label: "Search", type: "semantic", name: "Research" }],
    [/data\s+format|formatting|cleanup|cleaning/i, { key: "format", label: "Format", type: "semantic", name: "Formatting" }],
    [/data\s+organization|file\s+management|records?\s+management|document\s+management|organ(?:ize|ization)/i, { key: "organize", label: "Files", type: "semantic", name: "Organization" }],
    [/automation|macro|workflow\s+automation|apps\s+script/i, { key: "automation", label: "Auto", type: "semantic", name: "Automation" }],
    [/data entry|data encoding|encoding|spreadsheet|inventory/i, { key: "data", label: "Data", type: "semantic", name: "Data and records" }],
    [/database|sql/i, { key: "database", label: "DB", type: "semantic", name: "Database" }],
    [/software development|system development|programming|application development|web development|coding/i, { key: "code", label: "Code", type: "semantic", name: "Software development" }],
    [/support|troubleshoot|maintenance|computer/i, { key: "support", label: "Support", type: "semantic", name: "IT support" }],
    [/gis|spatial|mapping|geographic|survey/i, { key: "gis", label: "GIS", type: "semantic", name: "GIS and spatial" }],
    [/photo|image|retouch|background removal|color correction|composit/i, { key: "photo", label: "Photo", type: "semantic", name: "Photo editing" }],
    [/virtual assistant|assistant|administration|admin/i, { key: "admin", label: "Admin", type: "semantic", name: "Administration" }],
    [/typing|keyboard/i, { key: "typing", label: "Type", type: "semantic", name: "Typing" }],
    [/video|motion/i, { key: "video", label: "Video", type: "semantic", name: "Video" }],
    [/security|cyber|privacy/i, { key: "security", label: "Secure", type: "semantic", name: "Security" }],
    [/design|multimedia|creative/i, { key: "design", label: "Design", type: "semantic", name: "Design" }],
  ];

  const ICONIFY_API = "https://api.iconify.design";
  const ICONIFY_BRAND_PREFIXES = "logos,simple-icons,devicon,skill-icons,cib,vscode-icons";
  const ICONIFY_SKILL_PREFIXES = "ph,tabler,material-symbols,mdi";
  const AUTO_ICON_CACHE_KEY = "lan:auto-brand-icons:v6";
  const autoIconMemory = new Map();
  let autoIconDiskCache = null;

  const normalizeIconSearch = (value = "") => String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const compactIconSearch = (value = "") => normalizeIconSearch(value).replace(/\s+/g, "");

  const likelyToolCategory = (category = "") => /tool|software|technology|platform|application|productivity|office|database|cloud|web|development|creative|media|video|design|editing|framework|service|other|custom/i.test(String(category || ""));

  const TOOL_FALLBACK_ICON_BY_CATEGORY = Object.freeze({
    "office-productivity": "table-2",
    "creative-media": "brush",
    "web-development": "globe",
    "developer-tools": "code-2",
    "database-cloud": "cloud",
    "data-analytics": "chart-column",
    "ai-automation": "workflow",
    collaboration: "handshake",
    "cms-platforms": "globe",
    "gis-spatial": "map-pinned",
    "hardware-embedded": "cpu",
    "surveying-gnss": "map-pinned",
    "systems-support": "wrench",
    security: "shield-check",
    other: "sparkles",
  });

  const toolFallbackIconId = (name = "", category = "") => resolveToolFallbackIcon(name, category);

  const toolFallbackIconMarkup = (name = "", category = "") =>
    renderSystemIcon(toolFallbackIconId(name, category), { className: "skill-tool-fallback-svg" });

  const readAutoIconCache = () => {
    if (autoIconDiskCache) return autoIconDiskCache;
    try {
      const parsed = JSON.parse(localStorage.getItem(AUTO_ICON_CACHE_KEY) || "{}");
      autoIconDiskCache = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      autoIconDiskCache = {};
    }
    return autoIconDiskCache;
  };

  const writeAutoIconCache = (key, value) => {
    const cache = readAutoIconCache();
    cache[key] = value || "";
    try { localStorage.setItem(AUTO_ICON_CACHE_KEY, JSON.stringify(cache)); } catch {}
  };

  function allBrandMatches(name = "", category = "") {
    const src = resolveToolIconSource({ name, category });
    return src ? [{ label: String(name || "Tool").trim() || "Tool", type: "brand", src }] : [];
  }

  const semanticIconMatch = (name = "", category = "") => {
    const source = `${name} ${category}`.trim();
    for (const [pattern, value] of SEMANTIC_ALIASES) if (pattern.test(source)) return { ...value };
    return null;
  };

  const iconifyScore = (iconId = "", query = "", preferBrand = true) => {
    const [prefix = "", iconName = ""] = String(iconId).split(":");
    const queryText = normalizeIconSearch(query);
    const queryCompact = compactIconSearch(query);
    const iconText = normalizeIconSearch(iconName.replace(/-/g, " "));
    const iconCompact = compactIconSearch(iconName);
    const brandWeights = {
      logos: 130, "simple-icons": 126, devicon: 118, "skill-icons": 112, cib: 104, "vscode-icons": 96,
    };
    const skillWeights = { ph: 62, tabler: 58, "material-symbols": 54, mdi: 48 };
    let score = preferBrand ? (brandWeights[prefix] || 0) : (skillWeights[prefix] || 0);
    if (iconCompact === queryCompact) score += 260;
    else if (iconCompact.includes(queryCompact) || queryCompact.includes(iconCompact)) score += 132;
    const tokens = queryText.split(/\s+/).filter((token) => token.length > 1);
    score += tokens.reduce((total, token) => total + (iconText.includes(token) ? 24 : 0), 0);
    if (/wordmark|text|mono|outline|line/.test(iconName) && prefix !== "logos") score -= 18;
    if (/file-type|folder-type|light|dark/.test(iconName)) score -= 8;
    return score;
  };

  const automaticIconCacheKey = (name = "", category = "") => {
    const query = String(name || "").trim();
    if (!query) return "";
    return `${likelyToolCategory(category) ? "brand" : "skill"}:${normalizeIconSearch(query)}`;
  };

  const cleanIconLookupName = (value = "") => String(value || "")
    .replace(/\b(official|brand|logo|logos|icon|icons|software|application|app|tool|platform|program)\b/gi, " ")
    .replace(/[™®©]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const automaticIconQueryVariants = (name = "") => {
    const original = String(name || "").trim();
    if (!original) return [];
    const cleaned = cleanIconLookupName(original) || original;
    const normalized = normalizeIconSearch(cleaned);
    const compact = normalized.replace(/\s+/g, "");
    const hyphenated = normalized.replace(/\s+/g, "-");
    const withoutVendor = cleaned.replace(/^(adobe|microsoft|google|apple|oracle|autodesk|jetbrains|meta)\s+/i, "").trim();
    const vendorlessNormalized = normalizeIconSearch(withoutVendor);
    const simplified = normalized.replace(/\b(editor|suite|desktop|professional)\b/g, " ").replace(/\s+/g, " ").trim();
    const variants = [cleaned, normalized, compact, hyphenated, withoutVendor, vendorlessNormalized, simplified, original];
    return [...new Set(variants.map((value) => String(value || "").trim()).filter(Boolean))];
  };

  async function searchIconify(query, prefixes, limit = 64) {
    const params = new URLSearchParams({ query, limit: String(Math.max(32, limit)) });
    if (prefixes) params.set("prefixes", prefixes);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 5500) : 0;
    try {
      const response = await fetch(`${ICONIFY_API}/search?${params.toString()}`, {
        mode: "cors",
        cache: "no-cache",
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`Icon search failed (${response.status})`);
      const payload = await response.json();
      return Array.isArray(payload?.icons) ? payload.icons : [];
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }

  async function discoverAutomaticBrandIcon(name = "", category = "", preferBrandOverride = null) {
    const query = String(name || "").trim();
    if (!query) return "";
    const preferBrand = typeof preferBrandOverride === "boolean" ? preferBrandOverride : likelyToolCategory(category);
    const cacheKey = automaticIconCacheKey(query, category);
    if (!cacheKey) return "";

    if (autoIconMemory.has(cacheKey)) {
      const cachedMemory = await autoIconMemory.get(cacheKey);
      if (cachedMemory) return cachedMemory;
      autoIconMemory.delete(cacheKey);
    }

    const disk = readAutoIconCache();
    const diskValue = String(disk[cacheKey] || "").trim();
    if (diskValue) {
      autoIconMemory.set(cacheKey, diskValue);
      return diskValue;
    }
    if (Object.prototype.hasOwnProperty.call(disk, cacheKey) && !diskValue) delete disk[cacheKey];

    const request = (async () => {
      const allowed = preferBrand
        ? /^(logos|skill-icons|devicon|vscode-icons|simple-icons|cib):/
        : /^(ph|tabler|material-symbols|mdi):/;
      const prefixes = preferBrand ? ICONIFY_BRAND_PREFIXES : ICONIFY_SKILL_PREFIXES;
      try {
        let candidates = [];
        const variants = automaticIconQueryVariants(query);
        const rankingQuery = cleanIconLookupName(query) || query;
        for (const variant of variants.slice(0, 5)) {
          const icons = await searchIconify(variant, prefixes, 64);
          candidates.push(...icons.filter((icon) => allowed.test(icon)));
          if (candidates.length) break;
        }
        if (!candidates.length) {
          for (const variant of variants.slice(0, 3)) {
            const broad = await searchIconify(variant, "", 96);
            candidates.push(...broad.filter((icon) => allowed.test(icon)));
            if (candidates.length) break;
          }
        }
        const selected = [...new Set(candidates)]
          .sort((a, b) => iconifyScore(b, rankingQuery, preferBrand) - iconifyScore(a, rankingQuery, preferBrand))[0] || "";
        if (!selected) return "";
        const separator = selected.indexOf(":");
        const prefix = selected.slice(0, separator);
        const iconName = selected.slice(separator + 1);
        if (!prefix || !iconName) return "";
        const url = `${ICONIFY_API}/${encodeURIComponent(prefix)}/${encodeURIComponent(iconName)}.svg`;
        writeAutoIconCache(cacheKey, url);
        return url;
      } catch (error) {
        console.info("[LΛN icons] Automatic icon lookup unavailable; keeping the safe fallback.", error);
        return "";
      }
    })();

    autoIconMemory.set(cacheKey, request);
    const resolved = await request;
    if (resolved) autoIconMemory.set(cacheKey, resolved);
    else autoIconMemory.delete(cacheKey);
    return resolved;
  }

  async function fetchIconifySvgDataUri(iconUrl = "") {
    const source = String(iconUrl || "").trim();
    if (!source) return "";
    try {
      const response = await fetch(source, { mode: "cors", cache: "force-cache" });
      if (!response.ok) return "";
      const svgText = await response.text();
      if (!/^\s*<svg[\s>]/i.test(svgText)) return "";
      return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgText)}`;
    } catch {
      return "";
    }
  }

  window.LANResolveIconAsset = async (name = "", category = "", recordType = "tool") => {
    const kind = String(recordType || "tool").toLowerCase();
    if (kind !== "tool") return "";
    const lookupCategory = category || "software tool";
    const canonical = resolveToolIconSource({ name, category: lookupCategory });
    if (canonical) return canonical;

    const remoteUrl = await discoverAutomaticBrandIcon(name, lookupCategory, true);
    if (remoteUrl) {
      const embedded = await fetchIconifySvgDataUri(remoteUrl);
      if (embedded) return embedded;
    }

    const local = allBrandMatches(name, category)[0];
    return local?.src || "";
  };

  window.LANResolveSkillIcon = (name = "", category = "") => {
    const brands = allBrandMatches(name, category);
    if (brands.length) return brands[0];
    const semantic = semanticIconMatch(name, category);
    if (semantic) return semantic;
    const initials = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
    return { key: "fallback", label: initials || "Skill", type: "fallback", name: name || "Skill" };
  };

  window.LANSkillIconTone = (name = "", category = "") => semanticIconMatch(name, category)?.key || "fallback";
  window.LANSkillGlyphMarkup = (name = "", category = "") => {
    const key = window.LANSkillIconTone(name, category);
    return SKILL_GLYPHS[key] || SKILL_GLYPHS.fallback;
  };

  window.LANSkillIconMarkup = (name = "", category = "", override = "", recordType = "") => {
    const iconKind = String(recordType || "").trim().toLowerCase();
    const allowBrandIdentity = iconKind === "tool" || (!iconKind && likelyToolCategory(category));
    const genericToolFallback = allowBrandIdentity ? toolFallbackIconMarkup(name, category) : "✦";
    const custom = String(override || "").trim();
    const canonicalToolSource = allowBrandIdentity ? resolveToolIconSource({ name, category, icon: custom }) : "";

    if (canonicalToolSource) {
      return `<span class="skill-brand-icon"><img src="${escapeHtml(canonicalToolSource)}" alt="" aria-hidden="true" loading="lazy"><span class="skill-icon-fallback skill-icon-fallback--system" aria-hidden="true">${genericToolFallback}</span></span>`;
    }

    if (custom && custom !== "✦") {
      if (/^(?:data:image\/svg\+xml|https?:\/\/|\.?\.?\/|\/)/i.test(custom)) {
        return `<span class="skill-brand-icon"><img src="${escapeHtml(custom)}" alt="" aria-hidden="true" loading="lazy"><span class="skill-icon-fallback${allowBrandIdentity ? " skill-icon-fallback--system" : ""}" aria-hidden="true">${genericToolFallback}</span></span>`;
      }
      return `<span class="skill-custom-icon" aria-hidden="true">${escapeHtml(custom)}</span>`;
    }

    const brands = allowBrandIdentity ? allBrandMatches(name, category) : [];
    if (brands.length > 1) {
      return `<span class="skill-brand-stack" aria-hidden="true">${brands.slice(0, 3).map((icon) => `<span class="skill-brand-icon"><img src="${escapeHtml(icon.src)}" alt="" loading="lazy"><span class="skill-icon-fallback skill-icon-fallback--system">${genericToolFallback}</span></span>`).join("")}</span>`;
    }
    if (brands[0]) {
      const icon = brands[0];
      return `<span class="skill-brand-icon"><img src="${escapeHtml(icon.src)}" alt="" aria-hidden="true" loading="lazy"><span class="skill-icon-fallback skill-icon-fallback--system" aria-hidden="true">${genericToolFallback}</span></span>`;
    }

    /* Tools still prefer a real brand identity. While automatic resolution is
       pending or unavailable, the same strong category icon is used instead of
       a low-information command glyph. Skills keep semantic capability icons. */
    if (allowBrandIdentity) {
      return `<span class="skill-brand-icon skill-brand-icon--auto is-error" data-lan-auto-brand="${escapeHtml(name)}" data-lan-auto-category="${escapeHtml(category)}"><span class="skill-icon-fallback skill-icon-fallback--system" aria-hidden="true">${genericToolFallback}</span></span>`;
    }

    const semantic = semanticIconMatch(name, category);
    const key = semantic?.key || "fallback";
    const label = semantic?.name || "Skill";
    return `<span class="skill-semantic-icon skill-tone--${escapeHtml(key)}" title="${escapeHtml(label)}" aria-hidden="true">${SKILL_GLYPHS[key] || SKILL_GLYPHS.fallback}</span>`;
  };

  function bindBrandImage(image) {
    if (!(image instanceof HTMLImageElement) || image.dataset.lanBrandBound === "true") return;
    image.dataset.lanBrandBound = "true";
    const host = image.closest('.skill-brand-icon');
    const fail = () => host?.classList.add('is-error');
    const ok = () => host?.classList.remove('is-error');
    image.addEventListener('error', fail, { once: true });
    image.addEventListener('load', ok);
    if (image.complete && image.naturalWidth === 0) fail();
  }

  async function hydrateAutomaticBrandIcon(host) {
    if (!(host instanceof HTMLElement) || host.dataset.lanAutoBrandBound === "true") return;
    host.dataset.lanAutoBrandBound = "true";
    const name = host.dataset.lanAutoBrand || "";
    const category = host.dataset.lanAutoCategory || "";
    const cacheKey = automaticIconCacheKey(name, category);
    const src = await discoverAutomaticBrandIcon(name, category);
    if (!src || !host.isConnected) {
      host.classList.add("is-error");
      delete host.dataset.lanAutoBrandBound;
      return;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.loading = "lazy";
    image.addEventListener("error", () => {
      const cache = readAutoIconCache();
      if (cacheKey && cache[cacheKey] === src) {
        delete cache[cacheKey];
        try { localStorage.setItem(AUTO_ICON_CACHE_KEY, JSON.stringify(cache)); } catch {}
      }
      if (cacheKey) autoIconMemory.delete(cacheKey);
      delete host.dataset.lanAutoBrandBound;
      host.classList.add("is-error");
    }, { once: true });
    image.src = src;
    host.prepend(image);
    bindBrandImage(image);
  }

  function initSkillBrandIcons(scope = document) {
    const images = [];
    const automatic = [];
    if (scope instanceof Element) {
      if (scope.matches('.skill-brand-icon img')) images.push(scope);
      if (scope.matches('[data-lan-auto-brand]')) automatic.push(scope);
    }
    if (scope?.querySelectorAll) {
      images.push(...scope.querySelectorAll('.skill-brand-icon img'));
      automatic.push(...scope.querySelectorAll('[data-lan-auto-brand]'));
    }
    images.forEach(bindBrandImage);
    automatic.forEach((host) => void hydrateAutomaticBrandIcon(host));
  }

  window.addEventListener("online", () => {
    document.querySelectorAll("[data-lan-auto-brand]").forEach((host) => {
      delete host.dataset.lanAutoBrandBound;
    });
    initSkillBrandIcons(document);
  });

  /* --------------------------------------------------------------------- */
  /* Relationship quick entry                                               */
  /* --------------------------------------------------------------------- */
  function bindRelationshipEnter(input, handler) {
    if (!(input instanceof HTMLInputElement) || typeof handler !== "function") return () => {};

    const listener = async (event) => {
      if (event.key !== "Enter" || event.isComposing) return;

      event.preventDefault();
      event.stopPropagation();

      const value = String(input.value || "").trim();
      if (!value || input.dataset.lanRelationshipBusy === "true") return;

      input.dataset.lanRelationshipBusy = "true";
      input.setAttribute("aria-busy", "true");

      try {
        await handler(value, event);
      } finally {
        delete input.dataset.lanRelationshipBusy;
        input.removeAttribute("aria-busy");
      }
    };

    input.addEventListener("keydown", listener);
    return () => input.removeEventListener("keydown", listener);
  }

  window.LANBindRelationshipEnter = bindRelationshipEnter;

  /* --------------------------------------------------------------------- */
  /* Saved-record selection                                                 */
  /* --------------------------------------------------------------------- */

  function createRecordSelection(container, options = {}) {
    if (!(container instanceof HTMLElement)) return null;
    if (container.__lanRecordSelection) {
      container.__lanRecordSelection.updateOptions(options);
      return container.__lanRecordSelection;
    }

    let settings = {
      cardSelector: options.cardSelector || "[data-record-id]",
      idAttribute: options.idAttribute || "data-record-id",
      actionSelector: options.actionSelector || ".simple-card-actions",
      label: options.label || "record",
      selectAllLabel: options.selectAllLabel || "Select all visible",
      barAnchor: options.barAnchor || null,
      records: Array.isArray(options.records) ? options.records : null,
      recordId: typeof options.recordId === "function" ? options.recordId : (record) => String(record?.id || "").trim(),
      minimumRecordCount: Number(options.minimumRecordCount ?? 2),
      capabilities: options.capabilities && typeof options.capabilities === "object" ? { ...options.capabilities } : {},
      onBulkPatch: typeof options.onBulkPatch === "function" ? options.onBulkPatch : null,
      onDelete: typeof options.onDelete === "function" ? options.onDelete : null,
      deletePrompt: typeof options.deletePrompt === "function" ? options.deletePrompt : null,
      onChange: typeof options.onChange === "function" ? options.onChange : null
    };
    const selectedIds = new Set();

    const bar = document.createElement("div");
    bar.className = "lan-record-selection-bar";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="lan-record-selection-primary">
        <div class="lan-record-selection-summary"><strong data-lan-selection-count>0</strong><span>selected</span></div>
        <div class="lan-record-selection-utility">
          <button class="editor-secondary-button button-compact" type="button" data-lan-select-all>Select all visible</button>
          <button class="editor-secondary-button button-compact" type="button" data-lan-clear-selection>Clear</button>
        </div>
      </div>
      <div class="lan-record-selection-actions" data-lan-selection-actions></div>`;
    const barAnchor = typeof settings.barAnchor === "string"
      ? container.parentElement?.querySelector(settings.barAnchor)
      : settings.barAnchor instanceof HTMLElement
        ? settings.barAnchor
        : container;
    container.parentElement?.insertBefore(bar, barAnchor || container);

    const cards = () => [...container.querySelectorAll(settings.cardSelector)].filter((card) => card instanceof HTMLElement);
    const markRecordCardContract = (card) => {
      const actions = card.querySelector(settings.actionSelector);
      if (!(actions instanceof HTMLElement)) return actions;
      actions.setAttribute("data-lan-record-actions", "true");

      let commandGroup = actions.querySelector(":scope > .lan-record-command-group");
      const directCommands = [...actions.querySelectorAll(":scope > button, :scope > a")];
      if (directCommands.length) {
        if (!(commandGroup instanceof HTMLElement)) {
          commandGroup = document.createElement("div");
          commandGroup.className = "lan-record-command-group";
          commandGroup.setAttribute("data-lan-record-command-group", "true");
          actions.append(commandGroup);
        }
        directCommands.forEach((command) => commandGroup.append(command));
      }
      if (commandGroup instanceof HTMLElement) {
        commandGroup.querySelectorAll(":scope > button, :scope > a").forEach(decorateRecordCommand);
      } else {
        actions.querySelectorAll("button, a").forEach(decorateRecordCommand);
      }
      if (card.dataset.lanRecordCard === "true") scheduleRecordCardBudget(card);
      return actions;
    };
    const cardId = (card) => String(card.getAttribute(settings.idAttribute) || "").trim();
    const getIds = () => [...selectedIds];

    function records() {
      return Array.isArray(settings.records) ? settings.records : [];
    }

    function manageableRecordCount() {
      return Array.isArray(settings.records) ? settings.records.length : cards().length;
    }

    function hasRecordField(key) {
      return records().some((record) => record && Object.prototype.hasOwnProperty.call(record, key));
    }

    function resolveRecordBulkCapabilities() {
      const canPatch = typeof settings.onBulkPatch === "function";
      const inferred = {
        publishing: canPatch && hasRecordField("status"),
        featured: canPatch && hasRecordField("featured"),
        visibility: canPatch && hasRecordField("visible"),
        deletion: typeof settings.onDelete === "function"
      };
      const declared = settings.capabilities || {};
      return Object.fromEntries(Object.entries(inferred).map(([key, value]) => [
        key,
        typeof declared[key] === "boolean" ? Boolean(declared[key] && (key === "deletion" ? settings.onDelete : canPatch)) : value
      ]));
    }

    function selectionIsEnabled() {
      const capabilities = resolveRecordBulkCapabilities();
      return manageableRecordCount() >= settings.minimumRecordCount && Object.values(capabilities).some(Boolean);
    }

    function recordForId(id) {
      const cleanId = String(id || "").trim();
      return records().find((record) => String(settings.recordId(record) || "").trim() === cleanId) || null;
    }

    function notifyChange() {
      if (settings.onChange) settings.onChange(getIds(), api);
    }

    async function runBulkPatch(key, patch, button) {
      if (!selectedIds.size || typeof settings.onBulkPatch !== "function") return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        await settings.onBulkPatch(getIds(), patch, { actionKey: key, button, api });
      } catch (error) {
        console.error(`Bulk ${key} action failed:`, error);
        window.LANNotice?.({ title: "Bulk action failed", message: error?.message || "Unable to update the selected records.", tone: "error" });
      } finally {
        button.removeAttribute("aria-busy");
        sync();
      }
    }

    function createCapabilityAction(host, key, label, patchFactory) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "editor-secondary-button button-compact";
      button.dataset.lanSelectionAction = key;
      button.textContent = label;
      button.addEventListener("click", async () => {
        const patch = typeof patchFactory === "function" ? patchFactory(getIds()) : patchFactory;
        if (!patch || typeof patch !== "object") return;
        await runBulkPatch(key, patch, button);
      });
      host.append(button);
    }

    function renderActionButtons() {
      const host = bar.querySelector("[data-lan-selection-actions]");
      if (!host) return;
      host.replaceChildren();
      const capabilities = resolveRecordBulkCapabilities();

      if (capabilities.publishing) {
        createCapabilityAction(host, "publish", "Publish", { status: "published" });
        createCapabilityAction(host, "draft", "Draft", { status: "draft" });
      }
      if (capabilities.featured) {
        createCapabilityAction(host, "feature", "Feature", (ids) => {
          const selectedRecords = ids.map(recordForId).filter(Boolean);
          const shouldFeature = selectedRecords.some((record) => record.featured !== true);
          return { featured: shouldFeature };
        });
      }
      if (capabilities.visibility) {
        createCapabilityAction(host, "show", "Show", { visible: true });
        createCapabilityAction(host, "hide", "Hide", { visible: false });
      }
      if (capabilities.deletion) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "editor-danger-button button-compact";
        button.dataset.lanDeleteSelected = "";
        button.textContent = "Delete";
        host.append(button);
      }
    }

    function updateBar() {
      const selectionEnabled = manageableRecordCount() >= settings.minimumRecordCount && Object.values(resolveRecordBulkCapabilities()).some(Boolean);
      const count = selectedIds.size;
      const countNode = bar.querySelector("[data-lan-selection-count]");
      if (countNode) countNode.textContent = String(count);
      bar.hidden = !selectionEnabled || count === 0;

      const visibleIds = cards().map(cardId).filter(Boolean);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
      const selectAll = bar.querySelector("[data-lan-select-all]");
      if (selectAll) {
        selectAll.textContent = allVisibleSelected ? "All visible selected" : `${settings.selectAllLabel} (${visibleIds.length})`;
        selectAll.disabled = !selectionEnabled || visibleIds.length === 0 || allVisibleSelected;
      }

      bar.querySelectorAll("[data-lan-selection-action], [data-lan-delete-selected]").forEach((button) => {
        if (button instanceof HTMLButtonElement && button.getAttribute("aria-busy") !== "true") button.disabled = !selectionEnabled || count === 0;
      });
    }

    function removeCardCheckboxes() {
      cards().forEach((card) => {
        card.querySelectorAll(".lan-record-select").forEach((label) => label.remove());
        card.classList.remove("lan-record-selected");
        card.removeAttribute("aria-selected");
      });
    }

    function ensureCardCheckbox(card) {
      const id = cardId(card);
      if (!id) return;
      let label = card.querySelector(".lan-record-select");
      if (!label) {
        label = document.createElement("label");
        label.className = "lan-record-select";
        label.innerHTML = `<input type="checkbox" data-lan-record-checkbox><span class="lan-record-select-box" aria-hidden="true"></span><span class="lan-record-select-text">Select</span>`;
        const actions = markRecordCardContract(card);
        (actions || card).prepend(label);
      }
      if (label.dataset.lanSelectionGuard !== "true") {
        label.dataset.lanSelectionGuard = "true";
        label.addEventListener("pointerdown", (event) => event.stopPropagation());
        label.addEventListener("click", (event) => event.stopPropagation());
      }
      const input = label.querySelector("[data-lan-record-checkbox]");
      if (!(input instanceof HTMLInputElement)) return;
      input.value = id;
      input.checked = selectedIds.has(id);
      input.setAttribute("aria-label", `Select ${settings.label}`);
      const text = label.querySelector(".lan-record-select-text");
      if (text) text.textContent = input.checked ? "Selected" : "Select";
      card.classList.toggle("lan-record-selected", input.checked);
      card.setAttribute("aria-selected", String(input.checked));
    }

    function sync({ notify = true } = {}) {
      cards().forEach(markRecordCardContract);
      const selectionEnabled = manageableRecordCount() >= settings.minimumRecordCount && Object.values(resolveRecordBulkCapabilities()).some(Boolean);
      if (!selectionEnabled) {
        selectedIds.clear();
        removeCardCheckboxes();
        updateBar();
        if (notify) notifyChange();
        return;
      }
      const visibleIds = new Set(cards().map(cardId).filter(Boolean));
      [...selectedIds].forEach((id) => { if (!visibleIds.has(id)) selectedIds.delete(id); });
      cards().forEach(ensureCardCheckbox);
      updateBar();
      if (notify) notifyChange();
    }

    container.addEventListener("change", (event) => {
      if (!selectionIsEnabled()) return;
      const input = event.target.closest?.("[data-lan-record-checkbox]");
      if (!(input instanceof HTMLInputElement) || !container.contains(input)) return;
      const card = input.closest(settings.cardSelector);
      const id = card ? cardId(card) : String(input.value || "").trim();
      if (!id) return;
      if (input.checked) selectedIds.add(id); else selectedIds.delete(id);
      const label = input.closest(".lan-record-select");
      const text = label?.querySelector(".lan-record-select-text");
      if (text) text.textContent = input.checked ? "Selected" : "Select";
      card?.classList.toggle("lan-record-selected", input.checked);
      card?.setAttribute("aria-selected", String(input.checked));
      updateBar();
      notifyChange();
    });

    bar.querySelector("[data-lan-select-all]")?.addEventListener("click", () => {
      if (!selectionIsEnabled()) return;
      cards().forEach((card) => { const id = cardId(card); if (id) selectedIds.add(id); });
      sync();
    });
    bar.querySelector("[data-lan-clear-selection]")?.addEventListener("click", () => {
      selectedIds.clear();
      sync();
    });
    bar.addEventListener("click", async (event) => {
      const button = event.target.closest?.("[data-lan-delete-selected]");
      if (!button || !selectedIds.size || !settings.onDelete || !selectionIsEnabled()) return;
      const ids = getIds();
      const label = settings.label || "record";
      const prompt = settings.deletePrompt?.(ids) || {
        title: `Delete ${ids.length} selected ${label}${ids.length === 1 ? "" : "s"}?`,
        message: `This will delete the selected ${label}${ids.length === 1 ? "" : "s"}.`,
        confirmLabel: "Delete"
      };
      const confirmed = await (window.LANConfirm?.({
        title: prompt.title,
        message: prompt.message,
        confirmLabel: prompt.confirmLabel || "Delete",
        danger: true
      }) ?? Promise.resolve(window.confirm(prompt.title)));
      if (!confirmed) return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        await settings.onDelete(ids, api);
        selectedIds.clear();
      } catch (error) {
        console.error("Bulk record deletion failed:", error);
        window.LANNotice?.({ title: "Bulk action failed", message: error?.message || "Unable to delete the selected records.", tone: "error" });
      } finally {
        button.removeAttribute("aria-busy");
        sync();
      }
    });

    const api = {
      sync,
      clear() { selectedIds.clear(); sync(); },
      getSelectedIds: getIds,
      getCapabilities: resolveRecordBulkCapabilities,
      isEnabled: selectionIsEnabled,
      setSelectedIds(ids = []) {
        selectedIds.clear();
        ids.forEach((id) => { const clean = String(id || "").trim(); if (clean) selectedIds.add(clean); });
        sync();
      },
      updateOptions(next = {}) {
        settings = {
          ...settings,
          ...next,
          records: Object.prototype.hasOwnProperty.call(next, "records") ? (Array.isArray(next.records) ? next.records : null) : settings.records,
          recordId: typeof next.recordId === "function" ? next.recordId : settings.recordId,
          minimumRecordCount: Object.prototype.hasOwnProperty.call(next, "minimumRecordCount") ? Number(next.minimumRecordCount ?? 2) : settings.minimumRecordCount,
          capabilities: Object.prototype.hasOwnProperty.call(next, "capabilities") && next.capabilities && typeof next.capabilities === "object" ? { ...next.capabilities } : settings.capabilities,
          onBulkPatch: Object.prototype.hasOwnProperty.call(next, "onBulkPatch") ? (typeof next.onBulkPatch === "function" ? next.onBulkPatch : null) : settings.onBulkPatch,
          onDelete: Object.prototype.hasOwnProperty.call(next, "onDelete") ? (typeof next.onDelete === "function" ? next.onDelete : null) : settings.onDelete,
          deletePrompt: Object.prototype.hasOwnProperty.call(next, "deletePrompt") ? (typeof next.deletePrompt === "function" ? next.deletePrompt : null) : settings.deletePrompt,
          onChange: Object.prototype.hasOwnProperty.call(next, "onChange") ? (typeof next.onChange === "function" ? next.onChange : null) : settings.onChange
        };
        renderActionButtons();
        sync();
      }
    };
    container.__lanRecordSelection = api;
    renderActionButtons();
    sync({ notify: false });
    return api;
  }

  window.LANCreateRecordSelection = createRecordSelection;

  /* --------------------------------------------------------------------- */
  /* Capability picker                                                     */
  /* --------------------------------------------------------------------- */
  let activeCapabilityPicker = null;

  function rankCapabilityMatches(records = [], rawQuery = "", options = {}) {
    const query = String(rawQuery || "").trim().toLowerCase();
    if (!query) return [];

    const limit = Math.max(1, Number(options.limit || 8));
    const score = (record = {}) => {
      const name = String(record.name || "").trim().toLowerCase();
      const category = String(record.customCategory || record.category || "").trim().toLowerCase();
      const aliases = Array.isArray(record.aliases)
        ? record.aliases.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : [];
      const nameWords = name.split(/\s+/).filter(Boolean);
      const categoryWords = category.split(/\s+/).filter(Boolean);

      if (name === query) return 0;
      if (name.startsWith(query)) return 1;
      if (query.length >= 2 && nameWords.some((word) => word.startsWith(query))) return 2;
      if (query.length >= 2 && aliases.some((alias) => alias === query || alias.startsWith(query) || alias.split(/\s+/).some((word) => word.startsWith(query)))) return 3;
      if (query.length >= 3 && name.includes(query)) return 4;
      if (query.length >= 3 && aliases.some((alias) => alias.includes(query))) return 5;
      if (query.length >= 3 && (category.startsWith(query) || categoryWords.some((word) => word.startsWith(query)))) return 6;
      if (query.length >= 4 && category.includes(query)) return 7;
      return Number.POSITIVE_INFINITY;
    };

    return (Array.isArray(records) ? records : [])
      .filter((record) => record && record.active !== false)
      .map((record) => ({ record, rank: score(record) }))
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((a, b) =>
        a.rank - b.rank
        || Number(a.record.displayOrder || 0) - Number(b.record.displayOrder || 0)
        || String(a.record.name || "").localeCompare(String(b.record.name || ""))
      )
      .slice(0, limit)
      .map(({ record }) => record);
  }

  window.LANRankCapabilityMatches = rankCapabilityMatches;

  const CAPABILITY_RELATIONSHIP_HINTS = Object.freeze([
    { tool: /\b(?:microsoft\s+)?excel\b|google\s+sheets?|google\s+workspace/i, skill: /data\s+entry|spreadsheet|data\s+verification|data\s+format|records?\s+management|data\s+organization|administrat|research|office|workflow/i },
    { tool: /photoshop|canva|lightroom|gimp/i, skill: /photo|retouch|image|thumbnail|background\s+removal|color\s+correction|creative|graphic|composit/i },
    { tool: /premiere|davinci|after\s+effects|audacity/i, skill: /video|audio|editing|motion|media/i },
    { tool: /blender|3ds\s*max|maya|cinema\s*4d/i, skill: /3d|animation|render/i },
    { tool: /firebase|firestore|mysql|postgres|sql/i, skill: /database|data\s+management|system\s+development|web\s+development/i },
    { tool: /github|vs\s*code|visual\s+studio\s+code|html|css|javascript|typescript/i, skill: /web\s+development|software|system\s+development|workflow|version\s+control/i },
    { tool: /esp32|rfid|arduino/i, skill: /embedded|system\s+development|troubleshoot|hardware|computer\s+maintenance/i },
    { tool: /sinognss|gnss|qgis|arcgis/i, skill: /gis|spatial|survey|mapping/i }
  ]);

  const capabilityRelationshipText = (record = {}) => [record.name, record.category, record.customCategory, record.description]
    .map((value) => String(value || "").toLowerCase())
    .join(" " );

  function capabilityRelationshipScore(skill = {}, tool = {}) {
    const toolId = String(tool?.id || "").trim();
    const toolName = normalizeCapabilityName(tool?.name || "");
    const skillToolIds = Array.isArray(skill?.toolIds) ? skill.toolIds.map((id) => String(id || "").trim()) : [];
    const skillToolNames = Array.isArray(skill?.tools) ? skill.tools.map(normalizeCapabilityName) : [];
    if (toolId && skillToolIds.includes(toolId)) return 1000;
    if (toolName && skillToolNames.includes(toolName)) return 950;

    const skillText = capabilityRelationshipText(skill);
    const toolText = capabilityRelationshipText(tool);
    let score = 0;
    for (const hint of CAPABILITY_RELATIONSHIP_HINTS) {
      if (hint.tool.test(toolText) && hint.skill.test(skillText)) score = Math.max(score, 120);
    }

    const meaningfulTokens = (value = "") => new Set(normalizeCapabilityName(value).split(/\s+/).filter((token) => token.length >= 4 && !["other","development","management","tools","used"].includes(token)));
    const skillTokens = meaningfulTokens(`${skill?.name || ""} ${skill?.category || ""} ${skill?.customCategory || ""}`);
    const toolTokens = meaningfulTokens(`${tool?.name || ""} ${tool?.category || ""} ${tool?.customCategory || ""}`);
    let overlap = 0;
    skillTokens.forEach((token) => { if (toolTokens.has(token)) overlap += 1; });
    if (overlap) score = Math.max(score, 25 + overlap * 12);
    return score;
  }

  function suggestCapabilityRelationships(options = {}) {
    const sourceType = String(options.sourceType || "tool").toLowerCase() === "skill" ? "skill" : "tool";
    const source = options.sourceRecord || {};
    const skills = Array.isArray(options.skills) ? options.skills : [];
    const tools = Array.isArray(options.tools) ? options.tools : [];
    const excluded = new Set((Array.isArray(options.excludeIds) ? options.excludeIds : []).map((id) => String(id || "")));
    const limit = Math.max(1, Number(options.limit || 6));
    const candidates = sourceType === "tool" ? skills : tools;
    return candidates
      .filter((record) => record?.id && record.active !== false && !excluded.has(String(record.id)))
      .map((record) => ({
        record,
        score: sourceType === "tool" ? capabilityRelationshipScore(record, source) : capabilityRelationshipScore(source, record)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.record.name || "").localeCompare(String(b.record.name || "")))
      .slice(0, limit)
      .map((item) => item.record);
  }

  window.LANSuggestCapabilityRelationships = suggestCapabilityRelationships;

  function defaultCapabilityIconSource(record = {}) {
    const saved = String(record?.icon || "").trim();
    if (/^(?:data:image\/|https?:\/\/|\.?\.?\/|\/)/i.test(saved)) return saved;
    const resolved = window.LANResolveSkillIcon?.(record?.name || "", record?.category || "technology");
    return String(resolved?.src || "").trim();
  }

  function createCapabilityPicker(container, options = {}) {
    if (!(container instanceof HTMLElement)) return null;
    if (container.__lanCapabilityPicker) {
      container.__lanCapabilityPicker.update(options);
      return container.__lanCapabilityPicker;
    }

    let settings = {
      type: options.type === "tool" ? "tool" : "skill",
      records: Array.isArray(options.records) ? options.records : [],
      selectedIds: Array.isArray(options.selectedIds) ? options.selectedIds : [],
      placeholder: String(options.placeholder || (options.type === "tool" ? "Search or add a tool…" : "Search or add a skill…")),
      inputId: String(options.inputId || "").trim(),
      emptyTitle: String(options.emptyTitle || "No matching capability found."),
      emptyHint: String(options.emptyHint || "Try a different search."),
      resultLimit: Math.max(1, Number(options.resultLimit || 5)),
      disabled: Boolean(options.disabled),
      getIcon: typeof options.getIcon === "function" ? options.getIcon : null,
      getMeta: typeof options.getMeta === "function" ? options.getMeta : null,
      onChange: typeof options.onChange === "function" ? options.onChange : null,
      onCommit: typeof options.onCommit === "function" ? options.onCommit : null,
      compactAdd: Boolean(options.compactAdd),
      dense: Boolean(options.dense),
      relationshipStyle: Boolean(options.relationshipStyle),
      collapsedLimit: Math.max(0, Number(options.collapsedLimit || 0)),
      addLabel: String(options.addLabel || (options.type === "tool" ? "+ Add Tool" : "+ Add Skill"))
    };

    const state = {
      selectedIds: new Set(settings.selectedIds.map((id) => String(id || "").trim()).filter(Boolean)),
      open: false,
      busy: false,
      expanded: false
    };

    const root = document.createElement("div");
    root.className = "lan-capability-picker";
    root.dataset.capabilityType = settings.type;

    const field = document.createElement("div");
    field.className = "lan-capability-field";

    const tokenList = document.createElement("div");
    tokenList.className = "lan-capability-token-list";
    tokenList.setAttribute("aria-live", "polite");

    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.className = "lan-capability-more-toggle";
    moreButton.hidden = true;

    const search = document.createElement("input");
    search.type = "search";
    search.className = "lan-capability-search-input";
    if (settings.inputId) search.id = settings.inputId;
    search.autocomplete = "off";
    search.placeholder = settings.placeholder;
    search.setAttribute("aria-label", settings.placeholder);
    search.setAttribute("aria-expanded", "false");

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "lan-capability-clear";
    clearButton.textContent = "Clear all";
    clearButton.setAttribute("aria-label", `Clear selected ${settings.type === "tool" ? "tools" : "skills"}`);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "lan-capability-add";
    addButton.textContent = settings.addLabel;
    addButton.setAttribute("aria-label", settings.addLabel.replace(/^\+\s*/, ""));

    const results = document.createElement("div");
    results.className = "lan-capability-results hidden";
    results.setAttribute("role", "listbox");

    field.append(tokenList, moreButton, search, addButton, clearButton);
    root.append(field, results);
    container.replaceChildren(root);

    function syncCompactState() {
      root.classList.toggle("is-compact-add", settings.compactAdd);
      root.classList.toggle("is-dense", settings.dense);
      root.classList.toggle("is-relationship-style", settings.relationshipStyle);
      tokenList.classList.toggle("lan-relationship-list", settings.relationshipStyle);
      addButton.hidden = !settings.compactAdd || state.open || settings.disabled;
      search.hidden = settings.compactAdd && !state.open;
      addButton.textContent = settings.addLabel;
      addButton.setAttribute("aria-label", settings.addLabel.replace(/^\+\s*/, ""));
    }

    function recordMap() {
      return new Map(settings.records.map((record) => [String(record?.id || ""), record]).filter(([id]) => id));
    }

    function selectedRecords() {
      const byId = recordMap();
      return [...state.selectedIds].map((id) => byId.get(id)).filter(Boolean);
    }

    function close() {
      state.open = false;
      results.classList.add("hidden");
      results.replaceChildren();
      search.setAttribute("aria-expanded", "false");
      root.classList.remove("is-open");
      if (activeCapabilityPicker === api) activeCapabilityPicker = null;
      syncCompactState();
    }

    function open() {
      if (settings.disabled || !search.value.trim()) {
        close();
        return;
      }
      if (activeCapabilityPicker && activeCapabilityPicker !== api) activeCapabilityPicker.close();
      activeCapabilityPicker = api;
      state.open = true;
      search.setAttribute("aria-expanded", "true");
      root.classList.add("is-open");
      syncCompactState();
      renderResults();
    }

    function iconSource(record) {
      if (settings.type !== "tool") return "";
      const resolver = settings.getIcon || defaultCapabilityIconSource;
      return String(resolver(record) || "").trim();
    }

    function renderTokens() {
      tokenList.replaceChildren();
      const records = selectedRecords();
      const limit = settings.dense && settings.collapsedLimit > 0 ? settings.collapsedLimit : 0;
      if (limit && records.length <= limit) state.expanded = false;
      records.forEach((record, index) => {
        const token = document.createElement("span");
        token.className = `lan-capability-token is-${settings.type}`;
        if (settings.relationshipStyle) token.classList.add("lan-relationship-row");
        token.title = String(record.name || "");
        if (limit && !state.expanded && index >= limit) token.hidden = true;

        if (settings.relationshipStyle) {
          const icon = document.createElement("span");
          icon.className = "lan-relationship-icon";
          const src = settings.type === "tool" ? iconSource(record) : "";
          if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.loading = "lazy";
            img.setAttribute("aria-hidden", "true");
            icon.append(img);
          } else if (settings.type === "skill" && typeof window.LANSkillGlyphMarkup === "function") {
            const tone = typeof window.LANSkillIconTone === "function"
              ? window.LANSkillIconTone(record.name || "", record.customCategory || record.category || "")
              : "fallback";
            icon.classList.add("is-skill-glyph", `skill-tone--${tone}`);
            icon.innerHTML = window.LANSkillGlyphMarkup(record.name || "", record.customCategory || record.category || "");
          } else {
            icon.classList.add("is-fallback");
            icon.textContent = settings.type === "tool" ? "◇" : "✦";
          }
          token.append(icon);
        } else if (settings.type === "tool") {
          const icon = document.createElement("span");
          icon.className = "lan-capability-token-icon";
          const src = iconSource(record);
          if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.loading = "lazy";
            img.setAttribute("aria-hidden", "true");
            icon.append(img);
          } else {
            icon.classList.add("is-empty");
          }
          token.append(icon);
        }

        const label = document.createElement(settings.relationshipStyle ? "strong" : "span");
        label.className = settings.relationshipStyle ? "lan-capability-token-label lan-relationship-label" : "lan-capability-token-label";
        label.textContent = String(record.name || "");

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "lan-capability-token-remove";
        remove.dataset.capabilityRemove = String(record.id || "");
        remove.setAttribute("aria-label", `Remove ${String(record.name || "capability")}`);
        remove.disabled = settings.disabled;
        remove.textContent = "×";

        if (settings.relationshipStyle) {
          const copy = document.createElement("span");
          copy.className = "lan-relationship-copy";
          copy.append(label);
          const metaText = settings.getMeta ? String(settings.getMeta(record) || "").trim() : "";
          if (metaText) {
            const meta = document.createElement("small");
            meta.className = "lan-relationship-meta";
            meta.textContent = metaText;
            copy.append(meta);
          }
          token.append(copy, remove);
        } else {
          token.append(label, remove);
        }
        tokenList.append(token);
      });
      const hiddenCount = limit && records.length > limit ? records.length - limit : 0;
      moreButton.hidden = !hiddenCount;
      moreButton.textContent = state.expanded ? "Show less" : `Show ${hiddenCount} more`;
      moreButton.setAttribute("aria-expanded", String(state.expanded));
      clearButton.hidden = state.selectedIds.size <= 1;
    }

    function resultRow(record) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `lan-capability-result is-${settings.type}`;
      button.dataset.capabilityAdd = String(record.id || "");
      button.setAttribute("role", "option");

      if (settings.type === "tool") {
        const icon = document.createElement("span");
        icon.className = "lan-capability-result-icon";
        const src = iconSource(record);
        if (src) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = "";
          img.loading = "lazy";
          img.setAttribute("aria-hidden", "true");
          icon.append(img);
        } else {
          icon.classList.add("is-empty");
        }
        button.append(icon);
      }

      const copy = document.createElement("span");
      copy.className = "lan-capability-result-copy";
      const name = document.createElement("strong");
      name.textContent = String(record.name || "");
      copy.append(name);
      const metaText = settings.getMeta ? String(settings.getMeta(record) || "").trim() : "";
      if (metaText) {
        const meta = document.createElement("small");
        meta.textContent = metaText;
        copy.append(meta);
      }
      button.append(copy);
      return button;
    }

    function renderResults() {
      if (!state.open) return;
      const query = search.value.trim();
      if (!query) {
        close();
        return;
      }

      const available = settings.records.filter((record) => record?.id && !state.selectedIds.has(String(record.id)));
      const matches = rankCapabilityMatches(available, query, { limit: settings.resultLimit });
      results.replaceChildren();

      if (matches.length) {
        matches.forEach((record) => results.append(resultRow(record)));
      } else {
        const empty = document.createElement("div");
        empty.className = "lan-capability-empty-result";
        const title = document.createElement("strong");
        title.textContent = settings.emptyTitle;
        const hint = document.createElement("span");
        hint.textContent = settings.onCommit
          ? `${settings.emptyHint} Press Enter to add “${query}”.`
          : settings.emptyHint;
        empty.append(title, hint);
        results.append(empty);
      }
      results.classList.remove("hidden");
    }

    function notifyCapabilityChange(reason = "change") {
      settings.onChange?.([...state.selectedIds], { reason, picker: api });
    }

    function setSelectedIds(ids = [], { notify = false, reason = "sync" } = {}) {
      const valid = new Set(settings.records.map((record) => String(record?.id || "")).filter(Boolean));
      state.selectedIds = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter((id) => id && (!valid.size || valid.has(id))));
      if (settings.collapsedLimit > 0 && state.selectedIds.size <= settings.collapsedLimit) state.expanded = false;
      renderTokens();
      if (state.open) renderResults();
      if (notify) notifyCapabilityChange(reason);
    }

    async function commitQuery() {
      const query = search.value.trim();
      if (!query || !settings.onCommit || state.busy || settings.disabled) return;
      state.busy = true;
      search.disabled = true;
      try {
        const result = await settings.onCommit(query, api);
        if (result?.record?.id) {
          settings.records = [...settings.records.filter((record) => String(record?.id || "") !== String(result.record.id)), result.record];
          state.selectedIds.add(String(result.record.id));
        } else if (result?.id) {
          if (result.name && !settings.records.some((record) => String(record?.id || "") === String(result.id))) settings.records.push(result);
          state.selectedIds.add(String(result.id));
        }
        search.value = "";
        renderTokens();
        close();
        notifyCapabilityChange("commit");
      } finally {
        state.busy = false;
        search.disabled = settings.disabled;
        if (!settings.disabled) search.focus({ preventScroll: true });
      }
    }

    tokenList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-capability-remove]");
      if (!(button instanceof HTMLButtonElement) || settings.disabled) return;
      event.preventDefault();
      state.selectedIds.delete(button.dataset.capabilityRemove || "");
      renderTokens();
      if (search.value.trim()) open();
      notifyCapabilityChange("remove");
    });

    moreButton.addEventListener("click", () => {
      state.expanded = !state.expanded;
      renderTokens();
    });

    clearButton.addEventListener("click", () => {
      state.selectedIds.clear();
      renderTokens();
      if (search.value.trim()) open();
      notifyCapabilityChange("clear");
      search.focus({ preventScroll: true });
    });

    addButton.addEventListener("click", () => {
      if (settings.disabled) return;
      if (activeCapabilityPicker && activeCapabilityPicker !== api) activeCapabilityPicker.close();
      activeCapabilityPicker = api;
      state.open = true;
      root.classList.add("is-open");
      search.hidden = false;
      search.setAttribute("aria-expanded", "false");
      results.classList.add("hidden");
      syncCompactState();
      window.setTimeout(() => search.focus({ preventScroll: true }), 0);
    });

    results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-capability-add]");
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      const id = String(button.dataset.capabilityAdd || "");
      if (!id) return;
      state.selectedIds.add(id);
      search.value = "";
      renderTokens();
      close();
      notifyCapabilityChange("add");
      search.focus({ preventScroll: true });
    });

    search.addEventListener("input", () => {
      if (search.value.trim()) open();
      else if (settings.compactAdd) {
        state.open = true;
        root.classList.add("is-open");
        results.classList.add("hidden");
        syncCompactState();
      } else close();
    });
    search.addEventListener("focus", () => {
      if (search.value.trim()) open();
      else if (settings.compactAdd) {
        state.open = true;
        root.classList.add("is-open");
        syncCompactState();
      }
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "Enter" && search.value.trim() && settings.onCommit) {
        event.preventDefault();
        commitQuery().catch((error) => console.error("Capability quick entry failed:", error));
      }
    });

    const api = {
      root,
      field,
      search,
      results,
      close,
      open,
      getSelectedIds: () => [...state.selectedIds],
      setSelectedIds,
      clearSearch() { search.value = ""; close(); },
      focus() { search.focus(); },
      setDisabled(disabled) {
        settings.disabled = Boolean(disabled);
        search.disabled = settings.disabled;
        clearButton.disabled = settings.disabled;
        addButton.disabled = settings.disabled;
        root.classList.toggle("is-disabled", settings.disabled);
        renderTokens();
        syncCompactState();
        if (settings.disabled) close();
      },
      setRecords(records = []) {
        settings.records = Array.isArray(records) ? records : [];
        setSelectedIds([...state.selectedIds]);
        if (state.open) renderResults();
      },
      update(next = {}) {
        settings = {
          ...settings,
          ...next,
          type: next.type === "tool" ? "tool" : (next.type === "skill" ? "skill" : settings.type),
          records: Array.isArray(next.records) ? next.records : settings.records,
          getIcon: typeof next.getIcon === "function" ? next.getIcon : settings.getIcon,
          getMeta: typeof next.getMeta === "function" ? next.getMeta : settings.getMeta,
          onChange: typeof next.onChange === "function" ? next.onChange : settings.onChange,
          onCommit: Object.prototype.hasOwnProperty.call(next, "onCommit") ? (typeof next.onCommit === "function" ? next.onCommit : null) : settings.onCommit,
          compactAdd: Object.prototype.hasOwnProperty.call(next, "compactAdd") ? Boolean(next.compactAdd) : settings.compactAdd,
          dense: Object.prototype.hasOwnProperty.call(next, "dense") ? Boolean(next.dense) : settings.dense,
          relationshipStyle: Object.prototype.hasOwnProperty.call(next, "relationshipStyle") ? Boolean(next.relationshipStyle) : settings.relationshipStyle,
          collapsedLimit: Object.prototype.hasOwnProperty.call(next, "collapsedLimit") ? Math.max(0, Number(next.collapsedLimit || 0)) : settings.collapsedLimit,
          addLabel: Object.prototype.hasOwnProperty.call(next, "addLabel") ? String(next.addLabel || settings.addLabel) : settings.addLabel
        };
        root.dataset.capabilityType = settings.type;
        if (Object.prototype.hasOwnProperty.call(next, "inputId")) {
          settings.inputId = String(next.inputId || "").trim();
          if (settings.inputId) search.id = settings.inputId; else search.removeAttribute("id");
        }
        search.placeholder = String(next.placeholder || settings.placeholder);
        search.setAttribute("aria-label", search.placeholder);
        syncCompactState();
        if (Array.isArray(next.selectedIds)) setSelectedIds(next.selectedIds);
        else { renderTokens(); if (state.open) renderResults(); }
        if (Object.prototype.hasOwnProperty.call(next, "disabled")) api.setDisabled(next.disabled);
      },
      destroy() {
        if (activeCapabilityPicker === api) activeCapabilityPicker = null;
        container.__lanCapabilityPicker = null;
        container.replaceChildren();
      }
    };

    container.__lanCapabilityPicker = api;
    api.setDisabled(settings.disabled);
    setSelectedIds(settings.selectedIds);
    return api;
  }

  window.LANCreateCapabilityPicker = createCapabilityPicker;
  window.LANCloseActiveCapabilityPicker = () => {
    if (!activeCapabilityPicker) return false;
    activeCapabilityPicker.close();
    return true;
  };

  document.addEventListener("pointerdown", (event) => {
    if (!activeCapabilityPicker) return;
    if (activeCapabilityPicker.root.contains(event.target)) return;
    activeCapabilityPicker.close();
  }, true);

  /* --------------------------------------------------------------------- */
  /* Active record focus                                                    */
  /* --------------------------------------------------------------------- */
  function pinActiveRecordCard(container, activeId, options = {}) {
    if (!(container instanceof HTMLElement)) return null;

    const cardSelector = options.cardSelector || "[data-record-id]";
    const idAttribute = options.idAttribute || "data-record-id";
    const cards = [...container.querySelectorAll(cardSelector)].filter((card) => card instanceof HTMLElement);

    cards.forEach((card, index) => {
      if (!card.dataset.lanRecordOrder) card.dataset.lanRecordOrder = String(index);
      card.classList.remove("lan-record-active");
      card.removeAttribute("data-lan-record-active");
      if (card.getAttribute("aria-current") === "true") card.removeAttribute("aria-current");
    });

    const cleanId = String(activeId || "").trim();
    if (!cleanId) {
      cards
        .slice()
        .sort((a, b) => Number(a.dataset.lanRecordOrder || 0) - Number(b.dataset.lanRecordOrder || 0))
        .forEach((card) => container.append(card));
      return null;
    }

    const activeCard = cards.find((card) => String(card.getAttribute(idAttribute) || "") === cleanId) || null;
    if (!activeCard) return null;

    activeCard.classList.add("lan-record-active");
    activeCard.dataset.lanRecordActive = "true";
    activeCard.setAttribute("aria-current", "true");
    container.prepend(activeCard);
    return activeCard;
  }

  window.LANPinActiveRecordCard = pinActiveRecordCard;

  /* --------------------------------------------------------------------- */
  /* Start                                                                  */
  /* --------------------------------------------------------------------- */
  const sharedInitializers = [
    ["adaptive modes", initAdminAdaptiveModes],
    ["navigation", initAdminNavigation],
    ["command palette", createCommandPalette],
    ["drawer", initDrawer],
    ["sidebar tooltips", initSidebarTooltips],
    ["navigation icons", enhanceNavigationIcons],
    ["custom module navigation", initCustomModulesNavigation],
    ["sidebar status", enhanceSidebarStatus],
    ["topbar", enhanceTopbar],
    ["system health", initSystemHealthUi],
    ["local page header", createLocalPageHeader],
    ["page footer", createLocalPageFooter],
    ["settings celestial hero", initSettingsCelestialHero],
    ["avatar fallback", () => applyAdminAvatar("/assets/images/hero.png")],
    ["selects", () => enhanceSelects(document)],
    ["tabs", () => initTabs(document)],
    ["field anatomy", () => normalizeFieldAnatomy(document)],
    ["buttons", () => normalizeButtons(document)],
    ["local media paths", () => normalizeLocalAssetPaths(document)],
    ["skill icons", () => initSkillBrandIcons(document)],
    ["save bars", () => initSaveBars(document)],
    ["project live rail", ensureProjectLiveRail]
  ];

  for (const [name, initializer] of sharedInitializers) {
    try {
      initializer();
    } catch (error) {
      console.error(`Shared Admin UI initializer failed: ${name}`, error);
    }
  }

  hydrateAdminAvatar();

  try {
    componentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "href", "poster"]
    });
  } catch (error) {
    console.error("Shared Admin UI observer could not start.", error);
  }
})();
