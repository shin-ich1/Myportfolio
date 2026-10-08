import {
  getModuleLifecycleStatus,
  forcePromoteModule,
  demoteModule,
  returnModuleToCustomHome,
  getModuleDeletionImpact,
  deleteModulePermanently
} from "../services/moduleLifecycleService.js";
import { updateSectionRegistry } from "../services/portfolioSectionService.js";
import { modulePublicPresentationCompatibility } from "../../module-platform.js";
import { beginStepUpVerification, completeStepUpVerification, requireRecentStepUp } from "../services/adminSecurityService.js";

const MODULE_LIFECYCLE_COMMANDS = Object.freeze({
  "status": "Show the current lifecycle and promotion summary.",
  "readiness": "Show structural validation, maturity, and runtime safety checks.",
  "details": "Show module lifecycle, entries, and Admin-page state.",
  "history": "Show recent module and lifecycle activity.",
  "force-promote": "Promote using the canonical override transition.",
  "demote": "Return a promoted module to Builder while preserving content.",
  "return-custom": "Remove this module from Home Sections and return it to Custom Modules Home while preserving content.",
  "delete": "Permanently delete this module after current Admin-password verification.",
  "presentation": "View Public Presentation drawings, descriptions, compatibility, and choices.",
  "current": "Show the current and recommended Public Presentation.",
  "preview": "Preview one Public Presentation in the console: preview <1-8>.",
  "use": "Apply one Public Presentation: use <1-8>.",
  "reset": "Reset Public Presentation to Automatic.",
  "menu": "Return to the Module Console main menu.",
  "main": "Return to the Module Console main menu.",
  "exit": "Close the Module Console without changing the module.",
  "clear": "Clear the terminal and show the console header.",
  "lan": "Show the command guide.",
  "help": "Show the command guide.",
  "commands": "Show the command guide.",
  "cancel": "Cancel the current protected console operation."
});

const NUMBER_COMMANDS = Object.freeze({
  "1":"status", "2":"readiness", "3":"details", "4":"history",
  "5":"force-promote", "6":"demote", "7":"delete", "8":"menu", "9":"exit"
});

const PRESENTATION_OPTIONS = Object.freeze([
  Object.freeze({ number:1, value:"auto", label:"Automatic", description:"Lets the CMS choose the strongest compatible presentation from the module schema and content.", drawing:["[ schema + content ]", "         ↓", "[ adaptive presentation ]"] }),
  Object.freeze({ number:2, value:"cards", label:"Cards", description:"Repeated structured cards for records with text, metadata, summaries, and optional media.", drawing:["┌───────────┐  ┌───────────┐", "│ Title     │  │ Title     │", "│ metadata  │  │ metadata  │", "│ summary   │  │ summary   │", "└───────────┘  └───────────┘"] }),
  Object.freeze({ number:3, value:"timeline", label:"Timeline", description:"Chronological vertical presentation for records driven by dates or date ranges.", drawing:["●── Entry title", "│   Date · metadata", "│", "●── Entry title", "│   Date · metadata", "●── Entry title"] }),
  Object.freeze({ number:4, value:"media-gallery", label:"Gallery", description:"Media-first grid or mosaic for image-heavy records and multi-image content.", drawing:["┌─────────┬─────────┐", "│ image 1 │ image 2 │", "├─────────┼─────────┤", "│ image 3 │ image 4 │", "└─────────┴─────────┘"] }),
  Object.freeze({ number:5, value:"list", label:"List", description:"Compact vertical presentation for text-heavy or lightweight structured records.", drawing:["Title · metadata", "──────────────────", "Title · metadata", "──────────────────", "Title · metadata"] }),
  Object.freeze({ number:6, value:"carousel", label:"Carousel", description:"Horizontally browsable records presented in sequence using the shared card surface.", drawing:["‹   ┌─────┐ ┌─────┐ ┌─────┐   ›", "    │     │ │     │ │     │", "    └─────┘ └─────┘ └─────┘"] }),
  Object.freeze({ number:7, value:"rich-showcase", label:"Showcase", description:"Media-first presentation that gives strong visual priority to each record's primary media.", drawing:["┌─────────────────────┐", "│      MAIN MEDIA     │", "├─────────────────────┤", "│ Title               │", "│ metadata / summary  │", "└─────────────────────┘"] }),
  Object.freeze({ number:8, value:"featured-grid", label:"Featured + Grid", description:"One prominent featured record followed by smaller supporting records in a grid.", drawing:["┌─────────────────────┐", "│    FEATURED ITEM    │", "└─────────────────────┘", "  ┌─────┐ ┌─────┐ ┌─────┐", "  │     │ │     │ │     │", "  └─────┘ └─────┘ └─────┘"] })
]);

const clean = (value = "") => String(value ?? "").trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clock(value = "") {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value || "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle:"medium", timeStyle:"medium" }).format(new Date(parsed));
}

function activityClock(value = "") {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "--:--:--.---";
  const date = new Date(parsed);
  return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}:${String(date.getSeconds()).padStart(2,"0")}.${String(date.getMilliseconds()).padStart(3,"0")}`;
}

function editDistance(first = "", second = "") {
  const a = String(first), b = String(second);
  const rows = Array.from({ length:a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i=0;i<=a.length;i+=1) rows[i][0]=i;
  for (let j=0;j<=b.length;j+=1) rows[0][j]=j;
  for (let i=1;i<=a.length;i+=1) {
    for (let j=1;j<=b.length;j+=1) {
      rows[i][j]=Math.min(rows[i-1][j]+1, rows[i][j-1]+1, rows[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    }
  }
  return rows[a.length][b.length];
}

function closestCommand(raw = "") {
  const wanted = clean(raw).toLowerCase();
  const commands = Object.keys(MODULE_LIFECYCLE_COMMANDS);
  const prefix = commands.find((command) => command.startsWith(wanted) || wanted.startsWith(command));
  if (prefix) return prefix;
  const ranked = commands.map((command) => ({ command, distance:editDistance(wanted, command) })).sort((a,b) => a.distance - b.distance);
  return ranked[0] && ranked[0].distance <= Math.max(2, Math.floor(wanted.length / 3)) ? ranked[0].command : "";
}

function consoleMarkup() {
  return `
  <div class="lan-module-console" hidden>
    <div class="lan-module-console__backdrop" data-module-console-close aria-hidden="true"></div>
    <section class="lan-module-console__window" role="dialog" aria-modal="true" aria-labelledby="moduleConsoleTitle">
      <header class="lan-module-console__titlebar">
        <div class="lan-module-console__lights" aria-hidden="true"><i></i><i></i><i></i></div>
        <div><small>Advanced module controls</small><strong id="moduleConsoleTitle">LΛN Module Console</strong></div>
        <button class="editor-secondary-button button-compact" data-module-console-close type="button">Close</button>
      </header>
      <div class="lan-module-console__identity"><span data-module-console-state>READY</span><strong data-module-console-module>Custom Module</strong></div>
      <div class="module-lifecycle-terminal-output" data-module-console-output aria-live="polite"></div>
      <form class="module-lifecycle-terminal-input" data-module-console-form>
        <span>lan&gt;</span>
        <input data-module-console-input autocomplete="off" spellcheck="false" aria-label="Module console command" placeholder="Type menu for commands">
      </form>
    </section>
  </div>`;
}

export function createModuleLifecycleConsole(host, options = {}) {
  if (!host) throw new Error("Module Console host is required.");
  host.innerHTML = consoleMarkup();

  const root = host.querySelector(".lan-module-console");
  const output = host.querySelector("[data-module-console-output]");
  const form = host.querySelector("[data-module-console-form]");
  const input = host.querySelector("[data-module-console-input]");
  const moduleLabel = host.querySelector("[data-module-console-module]");
  const stateLabel = host.querySelector("[data-module-console-state]");
  let moduleKey = "";
  let pending = null;
  let bootSerial = 0;
  let commandBusy = false;
  let activityTrace = null;

  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  function setInputMode(mode = "command") {
    if (!input) return;
    const passwordMode = mode === "password";
    if (passwordMode) input.type = "password";
    else input.type = "text";
    input.autocomplete = passwordMode ? "current-password" : "off";
    input.placeholder = passwordMode ? "Enter current Admin password" : "Type menu for commands";
    input.setAttribute("aria-label", passwordMode ? "Current Admin password" : "Module console command");
  }

  function setCommandBusy(busy = false, label = "WORKING") {
    busy = busy === true;
    commandBusy = busy;
    if (input) input.disabled = busy;
    if (form) form.dataset.busy = commandBusy ? "true" : "false";
    if (commandBusy) setConsoleState(label, "info");
  }

  function setConsoleState(label = "READY", tone = "info") {
    if (!stateLabel) return;
    stateLabel.textContent = label;
    stateLabel.dataset.tone = tone;
  }

  function lineTone(text = "") {
    const value = String(text ?? "").trim();
    if (!value) return "muted";
    if (/^(ERROR:|BLOCKED|FORCE PROMOTE BLOCKED|PERMANENT MODULE DELETE|MODULE DELETE|\[DELETE\]|\[AUTH\] verification failed|✕)/i.test(value)) return "danger";
    if (/^(WARNING:|WARNING|AUTHORIZATION REQUIRED|\[WARN\])/i.test(value)) return "warning";
    if (/^(PROMOTION COMPLETE|DEMOTION COMPLETE|MODULE DELETED|\[READY\]|\[VERIFY\]|\[AUTH\] credential verified|✓)/i.test(value)) return "success";
    if (/^(lan>|\[(BOOT|LOAD|SCAN|AUTH|INFO|CHECK|COUNT|PRESERVE|LIFECYCLE|WRITE|NAV|WORKSPACE|REFRESH|LOCK)\])/i.test(value)) return "info";
    if (/^(MAIN MENU|Available commands:)/i.test(value)) return "heading";
    return "default";
  }

  function appendLine(text = "", tone = "") {
    if (!output) return;
    const line = document.createElement("div");
    line.className = `lan-console-line is-${tone || lineTone(text)}`;
    line.textContent = String(text ?? "") || " ";
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function clearOutput() {
    output?.replaceChildren();
  }

  function append(lines = "") {
    const values = Array.isArray(lines) ? lines : String(lines ?? "").split("\n");
    values.forEach((line) => appendLine(line));
  }

  function beginCommand(raw = "", { protectedInput = false } = {}) {
    const visible = protectedInput ? "••••••••" : String(raw ?? "").trim();
    appendLine(`lan> ${visible}`, "command");
  }

  function formatActivityLine(event = {}) {
    const type = clean(event.type);
    const module = clean(event.moduleKey);
    const entries = Number.isFinite(Number(event.entryCount)) ? Number(event.entryCount) : null;
    switch (type) {
      case "module_loaded": return `[LOAD] registry/${module || "module"} · state=${event.lifecycle || "building"}`;
      case "structural_readiness": return `[SCAN] structural readiness ${Number(event.passed) || 0}/${Number(event.total) || 0}`;
      case "check": return `[CHECK] ${event.checkLabel || event.checkId || "runtime safety"} · ${event.pass ? "pass" : "fail"}`;
      case "entry_count": return `[COUNT] owned entries ${entries ?? 0}`;
      case "preserving_records": return `[PRESERVE] ${entries ?? 0} entries · IDs · relationships · media`;
      case "lifecycle_write_started": return `[LIFECYCLE] ${event.previousLifecycle || "building"} -> ${event.currentLifecycle || "promoted"}${event.mode ? ` · ${event.mode}` : ""}`;
      case "lifecycle_write_confirmed": return `[WRITE] lifecycle ${event.lifecycle || "state"} confirmed`;
      case "navigation_state_updated": return `[NAV] Admin navigation ${event.navigationActive ? "active" : "inactive"}`;
      case "workspace_state_updated": return `[WORKSPACE] Builder ${event.builderActive ? "active" : "hidden"}`;
      case "home_registration_remove_started": return `[HOME] removing Home Sections registration`;
      case "home_registration_removed": return event.homeRegistrationRemoved ? `[VERIFY] Home Sections registration removed · Custom Modules Home restored` : `[VERIFY] Home Sections registration already absent`;
      case "history_write_failed": return `[WARN] module history could not be updated${event.message ? ` · ${event.message}` : ""}`;
      case "transition_complete": return `[VERIFY] ${event.currentLifecycle || event.lifecycle || "runtime"} state confirmed${entries === null ? "" : ` · entries ${entries}`}`;
      case "deletion_scan": return `[SCAN] deletion dependencies ${event.message === "blocked" ? "blocked" : "clear"}${entries === null ? "" : ` · entries ${entries}`}`;
      case "deletion_started": return `[DELETE] removing module registry${entries === null ? "" : ` + ${entries} owned entries`}`;
      case "deletion_complete": return `[VERIFY] module removal confirmed${entries === null ? "" : ` · entries ${entries}`}`;
      default: {
        const stamp = activityClock(event.timestamp);
        return `[INFO] ${stamp} · ${type || "activity"}`;
      }
    }
  }

  function activityTone(event = {}) {
    if (event.type === "deletion_started") return "danger";
    if (event.type === "check" && event.pass === false) return "warning";
    if (["transition_complete","deletion_complete","home_registration_removed"].includes(event.type) && event.homeRegistrationRemoved !== false) return "success";
    if (event.type === "history_write_failed") return "warning";
    return "info";
  }

  function renderActivity(event = {}) {
    if (Array.isArray(activityTrace)) {
      activityTrace.push(event);
      return;
    }
    appendLine(formatActivityLine(event), activityTone(event));
  }

  async function playActivityTrace(events = []) {
    const trace = Array.isArray(events) ? events.filter(Boolean) : [];
    if (!trace.length) return;
    const interval = reducedMotion() ? 0 : Math.max(32, Math.min(58, Math.floor(720 / trace.length)));
    for (const event of trace) {
      appendLine(formatActivityLine(event), activityTone(event));
      if (interval) await delay(interval);
    }
  }

  async function tracedOperation(label, work) {
    setCommandBusy(true, label);
    activityTrace = [];
    let result;
    let failure = null;
    try {
      result = await work();
    } catch (error) {
      failure = error;
    }
    const events = activityTrace.slice();
    activityTrace = null;
    try {
      await playActivityTrace(events);
    } finally {
      setCommandBusy(false);
      if (!root.hidden) setConsoleState("READY", "success");
    }
    if (failure) throw failure;
    return result;
  }

  function menuLines() {
    return [
      "",
      "MAIN MENU",
      "  1  status         Current module state",
      "  2  readiness      Structural/runtime checks",
      "  3  details        Full lifecycle details",
      "  4  history        Recent lifecycle activity",
      "  5  force-promote  Protected promotion override",
      "  6  demote         Return to Builder",
      "     return-custom  Return from Home Sections to Custom Modules Home",
      "  7  delete         Password-protected permanent deletion",
      "     presentation   Public Presentation visual selector",
      "     current        Current Public Presentation",
      "     preview <1-8>  Preview one presentation drawing",
      "     use <1-8>      Apply one compatible presentation",
      "     reset          Reset presentation to Automatic",
      "  8  menu           Show this main menu",
      "  9  exit           Close console",
      "",
      "Also available: clear · lan · help · cancel"
    ];
  }

  function helpLines() {
    const primary = ["status","readiness","details","history","force-promote","demote","return-custom","delete","presentation","current","preview","use","reset","menu","exit","clear","cancel"];
    return ["Available commands:", ...primary.flatMap((command) => ["", command, `  ${MODULE_LIFECYCLE_COMMANDS[command]}`])];
  }

  async function boot(status, serial) {
    if (!output || serial !== bootSerial) return;
    clearOutput();
    const lines = [
      "[BOOT] initializing module console...",
      `[LOAD] ${status.title || status.moduleKey}`,
      `[AUTH] ${window.__LAN_ADMIN_AUTH__?.user ? "secure Admin session detected" : "Admin password required for destructive actions"}`,
      "[READY] module console online",
      "",
      "Type menu for commands."
    ];
    if (reducedMotion()) {
      append(lines);
    } else {
      for (const line of lines) {
        if (serial !== bootSerial || root.hidden) return;
        appendLine(line);
        await delay(70);
      }
    }
    setConsoleState("READY", "success");
  }

  async function freshStatus() {
    if (!moduleKey) throw new Error("Select a module before using the Module Console.");
    return getModuleLifecycleStatus(moduleKey, { includeEntries:true, onActivity:renderActivity });
  }

  async function presentationContext() {
    const status = await getModuleLifecycleStatus(moduleKey, { includeEntries:false });
    const section = status.section || {};
    const model = modulePublicPresentationCompatibility(section);
    return { status, section, model };
  }

  function presentationOption(number) {
    return PRESENTATION_OPTIONS.find((item) => item.number === Number(number)) || null;
  }

  function presentationCompatibility(option, model = {}) {
    if (!option || option.value === "auto") return { compatible:true, reason:`Automatic currently recommends ${presentationLabel(model.recommended || "cards")}.` };
    return model.compatibility?.[option.value] || { compatible:false, reason:"This presentation is not supported by the current schema." };
  }

  function presentationLabel(value = "") {
    return PRESENTATION_OPTIONS.find((item) => item.value === value)?.label || clean(value).replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Cards";
  }

  function appendPresentationOption(option, context, { compact = false } = {}) {
    const { section, model } = context;
    const automatic = section.publicPresentationMode !== "manual";
    const currentValue = automatic ? "auto" : section.publicPresentation;
    const compatibility = presentationCompatibility(option, model);
    const markers = [];
    if (currentValue === option.value) markers.push("● Current");
    if (option.value !== "auto" && model.recommended === option.value) markers.push("★ Recommended");
    markers.push(compatibility.compatible ? "✓ Compatible" : "✕ Not compatible");
    appendLine(`[${option.number}] ${option.label.toUpperCase()}${markers.length ? `  ${markers.join("  ")}` : ""}`, compatibility.compatible ? "heading" : "muted");
    option.drawing.forEach((line) => appendLine(`    ${line}`, "default"));
    appendLine("    Description:", "info");
    appendLine(`    ${option.description}`, "default");
    appendLine(`    ${compatibility.compatible ? "Compatibility" : "Reason"}: ${compatibility.reason}`, compatibility.compatible ? "success" : "warning");
    if (!compact) appendLine("");
  }

  async function renderPresentationMenu() {
    const context = await presentationContext();
    appendLine("PUBLIC PRESENTATION", "heading");
    appendLine(`Module: ${context.status.title || context.status.moduleKey}`, "default");
    appendLine(`Current: ${context.section.publicPresentationMode === "manual" ? presentationLabel(context.section.publicPresentation) : `Automatic · ${presentationLabel(context.model.recommended)}`}`, "default");
    appendLine(`Recommended: ${presentationLabel(context.model.recommended)}`, "info");
    appendLine("");
    PRESENTATION_OPTIONS.forEach((option) => appendPresentationOption(option, context));
    append(["Commands: preview <1-8> · use <1-8> · reset · current · menu"]);
  }

  async function renderCurrentPresentation() {
    const context = await presentationContext();
    const automatic = context.section.publicPresentationMode !== "manual";
    append([
      `Current Public Presentation: ${automatic ? `Automatic · ${presentationLabel(context.model.recommended)}` : presentationLabel(context.section.publicPresentation)}`,
      `Recommended: ${presentationLabel(context.model.recommended)}`
    ]);
  }

  async function previewPresentation(number) {
    const option = presentationOption(number);
    if (!option) throw new Error("Choose a Public Presentation number from 1 to 8.");
    const context = await presentationContext();
    appendLine(`PREVIEW · ${option.label}`, "heading");
    appendPresentationOption(option, context, { compact:true });
    appendLine("Preview only · nothing saved. Type use <number> to apply.", "muted");
  }

  async function usePresentation(number) {
    const option = presentationOption(number);
    if (!option) throw new Error("Choose a Public Presentation number from 1 to 8.");
    const context = await presentationContext();
    const compatibility = presentationCompatibility(option, context.model);
    if (!compatibility.compatible) throw new Error(`${option.label} cannot be used: ${compatibility.reason}`);
    const changes = option.value === "auto"
      ? { publicPresentationMode:"auto", publicPresentation:context.model.recommended }
      : { publicPresentationMode:"manual", publicPresentation:option.value };
    const updated = await updateSectionRegistry(context.section.id || context.section.key, changes);
    append([
      `Public Presentation saved: ${option.value === "auto" ? `Automatic · ${presentationLabel(context.model.recommended)}` : option.label}`,
      "Home composition uses this same canonical presentation value."
    ]);
    window.dispatchEvent?.(new CustomEvent("lan:portfolio-sections-updated"));
    options.onChanged?.(updated);
  }

  async function resetPresentation() {
    const context = await presentationContext();
    await updateSectionRegistry(context.section.id || context.section.key, { publicPresentationMode:"auto", publicPresentation:context.model.recommended });
    append(`Public Presentation reset: Automatic · ${presentationLabel(context.model.recommended)}`);
    window.dispatchEvent?.(new CustomEvent("lan:portfolio-sections-updated"));
    options.onChanged?.();
  }

  function renderStatus(status) {
    append([
      `Module: ${status.title || status.moduleKey}`,
      `Lifecycle: ${status.lifecycle === "promoted" ? "Promoted" : "Building"}`,
      `Structural validation: ${status.structural.passed} / ${status.structural.total}`,
      `Maturity: ${status.maturity.passed} / ${status.maturity.total}${status.maturity.ready ? " · complete" : " · in progress"}`,
      `Automatic promotion: ${status.automaticPromotionEligible ? "Eligible" : status.lifecycle === "promoted" ? "Completed" : "Not eligible"}`,
      `Entries: ${status.entryCount}`,
      `Admin page: ${status.navigationActive ? "Active" : "Inactive"}`
    ]);
  }

  function renderReadiness(status) {
    append(`Structural readiness: ${status.structural.passed} / ${status.structural.total}`);
    status.structural.checks.forEach((check) => append(`${check.pass ? "✓" : "✕"} ${check.label}${check.pass ? "" : ` — ${check.reason}`}`));
    append(`Runtime safety: ${status.runtimeSafety.passed} / ${status.runtimeSafety.total}`);
    append(`Maturity · structural revision ${status.maturity.currentRevision || "—"}: ${status.maturity.passed} / ${status.maturity.total}`);
    status.maturity.checks.forEach((check) => append(`${check.pass ? "✓" : "✕"} ${check.label}${check.pass ? "" : ` — ${check.reason}`}`));
    append(`Automatic promotion: ${status.automaticPromotionEligible ? "Eligible" : status.lifecycle === "promoted" ? "Completed" : "Not eligible"}`);
  }

  function renderDetails(status) {
    renderStatus(status);
    append([
      `Promotion mode: ${status.promotionMode ? status.promotionMode === "override" ? "Override" : "Automatic" : "—"}`,
      `Promoted: ${status.promotedAt ? clock(status.promotedAt) : "—"}`,
      `Builder: ${status.builderActive ? "Active" : "Hidden"}`,
      `Legacy lifecycle compatibility: ${status.legacyLifecycle || "None"}`
    ]);
  }

  function renderHistory(status) {
    if (!status.history.length) return append("No module history has been recorded yet.");
    append("Recent module history:");
    status.history.slice().reverse().forEach((item) => append(`- ${clock(item.at)} · ${item.action || "transition"} · ${item.from || "—"} -> ${item.to || "—"}${item.mode ? ` · ${item.mode}` : ""}`));
  }

  function renderTransitionReport(kind, status) {
    append([
      "",
      `${kind} COMPLETE`,
      `Module: ${status.title || status.moduleKey}`,
      `Current state: ${status.lifecycle === "promoted" ? "Promoted" : "Building"}`,
      `Entries preserved: ${status.entryCount}`,
      `Admin page: ${status.navigationActive ? "Active" : "Inactive"}`,
      `Completed: ${clock(status.history.at(-1)?.at || new Date().toISOString())}`
    ]);
  }

  function cancelPending(message = "Protected operation cancelled.") {
    pending = null;
    setInputMode("command");
    setConsoleState("READY", "success");
    append(message);
  }

  async function beginDelete() {
    const impact = await tracedOperation("SCANNING", () => getModuleDeletionImpact(moduleKey, { onActivity:renderActivity }));
    const dependencyTrace = [
      `[SCAN] module lifecycle ${impact.lifecycle === "promoted" ? "promoted" : "building"}`,
      `[SCAN] owned entries ${impact.entryCount}`,
      `[SCAN] dependent modules ${impact.dependentModules.length}`,
      `[SCAN] linked Projects to delete ${impact.linkedProjects.length}`,
      `[SCAN] owned media assets ${impact.mediaAssetCount || 0}`
    ];
    for (const line of dependencyTrace) {
      appendLine(line, "info");
      if (!reducedMotion()) await delay(42);
    }
    appendLine(`[VERIFY] destructive-action guard ${impact.blocked ? "blocked" : "clear"}`, impact.blocked ? "danger" : "success");
    append([
      "",
      "PERMANENT MODULE DELETE",
      `Module: ${impact.title || impact.moduleKey}`,
      `Entries that will be deleted: ${impact.entryCount}`,
      `Owned media assets to delete: ${impact.mediaAssetCount || 0}`,
      `Linked Projects to delete: ${impact.linkedProjects.length}`,
      `Home Section registration/composition: remove`,
      `Lifecycle: ${impact.lifecycle === "promoted" ? "Promoted" : "Building"}`
    ]);
    if (impact.dependentModules.length) {
      append(["", "BLOCKED · dependent modules:", ...impact.dependentModules.map((item) => `- ${item.title}`)]);
    }
    if (impact.linkedProjects.length) {
      append(["", "Linked Projects that will also be permanently deleted:", ...impact.linkedProjects.map((item) => `- ${item.title}`)]);
    }
    if (impact.blocked) {
      append("Remove these external dependencies first. Nothing was deleted.");
      return;
    }
    append([
      "",
      "AUTHORIZATION REQUIRED",
      "Enter the CURRENT Admin account password.",
      "Submitting the correct password permanently deletes this module, its entries, owned media, Home Section registration, and linked Project records listed above.",
      "Use Close or Esc to stop without deleting."
    ]);
    pending = { action:"delete-password", impact };
    setConsoleState("PASSWORD", "warning");
    setInputMode("password");
  }

  async function verifyDeletePassword(rawPassword = "") {
    const shellUser = window.__LAN_ADMIN_AUTH__?.user || null;
    if (!shellUser?.email) throw new Error("A signed-in Admin email/password account is required for permanent deletion.");
    const password = String(rawPassword ?? "");
    if (!password) throw new Error("Enter the current Admin password or use Close/Esc to cancel.");
    setConsoleState("VERIFYING", "info");
    append("[AUTH] verifying current Admin credential...");
    setCommandBusy(true, "VERIFYING");
    try {
      const challenge = await beginStepUpVerification(password);
      const code = window.prompt("Enter the current 6-digit authenticator code to authorize permanent deletion:");
      if (code === null) throw new Error("Permanent deletion cancelled.");
      await completeStepUpVerification(challenge.challengeId, String(code).trim());
      requireRecentStepUp("module-delete");
    } finally {
      setCommandBusy(false);
    }
    append("[AUTH] password + authenticator verified");
    setConsoleState("DELETING", "danger");
    const impact = pending?.impact;
    pending = null;
    setInputMode("command");
    appendLine("[LOCK] destructive action authorized", "warning");
    const result = await tracedOperation("DELETING", () => deleteModulePermanently(moduleKey, { onActivity:renderActivity }));
    appendLine("[REFRESH] module registry refresh dispatched", "info");
    append([
      "",
      "MODULE DELETED",
      `Module: ${result.title || result.moduleKey}`,
      `Entries removed: ${result.entryCount}`,
      `Owned media removed: ${result.mediaAssetCount || 0}`,
      `Linked Projects removed: ${result.linkedProjectCount || 0}`,
      `Home Section registration: ${result.homeRegistrationRemoved ? "removed" : "not registered"}`,
      "Registry refresh dispatched."
    ]);
    setConsoleState("DELETED", "success");
    options.onDeleted?.(result);
    if (impact?.moduleKey === moduleKey) moduleKey = "";
  }

  async function execute(rawCommand = "") {
    if (commandBusy) return;
    const raw = String(rawCommand ?? "");
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (pending?.action === "delete-password") {
      beginCommand("", { protectedInput:true });
      try {
        await verifyDeletePassword(raw);
      } catch (error) {
        pending = null;
        setInputMode("command");
        setConsoleState("DENIED", "danger");
        append(["[AUTH] verification failed", error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password" ? "Current Admin password was not accepted." : (error.message || "Authentication failed."), "Nothing was deleted."]);
      }
      return;
    }

    const navigationCommand = trimmed.toLowerCase();
    if (["exit","menu","main","cancel"].includes(navigationCommand)) {
      beginCommand(trimmed);
      if (navigationCommand === "exit") return close();
      if (pending) cancelPending(navigationCommand === "cancel" ? "Protected operation cancelled." : "Protected operation cancelled; returning to main menu.");
      if (["menu","main"].includes(navigationCommand)) append(menuLines());
      return;
    }

    if (pending && ["force-promote","demote","return-custom"].includes(pending.action)) {
      beginCommand(trimmed);
      if (trimmed !== pending.phrase) {
        append(`Confirmation not accepted. Type ${pending.phrase} exactly, or type cancel.`);
        return;
      }
      const action = pending.action;
      pending = null;
      try {
        if (action === "force-promote") {
          const result = await tracedOperation("PROMOTING", () => forcePromoteModule(moduleKey, { onActivity:renderActivity }));
          renderTransitionReport("PROMOTION", result.status);
        } else if (action === "demote") {
          const result = await tracedOperation("DEMOTING", () => demoteModule(moduleKey, { onActivity:renderActivity }));
          renderTransitionReport("DEMOTION", result.status);
        } else {
          const result = await tracedOperation("RETURNING", () => returnModuleToCustomHome(moduleKey, { onActivity:renderActivity }));
          if (result.returned) {
            append([
              "",
              "MODULE RETURNED",
              `Module: ${result.status.title || result.status.moduleKey}`,
              "Home Sections registration: removed",
              "Custom Modules Home: restored",
              `Lifecycle preserved: ${result.status.lifecycle === "promoted" ? "Promoted" : "Building"}`,
              `Entries preserved: ${result.status.entryCount}`
            ]);
          } else {
            append("This module is already in Custom Modules Home and is not registered in Home Sections.");
          }
        }
        options.onChanged?.();
      } catch (error) {
        append(`ERROR: ${error.message || "Lifecycle transition failed."}`);
      }
      return;
    }

    beginCommand(trimmed);
    const argumentMatch = trimmed.match(/^(preview|use)\s+([1-8])$/i);
    const normalized = NUMBER_COMMANDS[trimmed] || (argumentMatch ? argumentMatch[1].toLowerCase() : navigationCommand);
    try {
      if (["lan","help","commands"].includes(normalized)) append(helpLines());
      else if (["menu","main"].includes(normalized)) append(menuLines());
      else if (normalized === "exit") close();
      else if (normalized === "clear") {
        clearOutput();
        append("[READY] Console cleared. Type menu for commands.");
      } else if (["status","readiness","details","history"].includes(normalized)) {
        const status = await tracedOperation("SCANNING", () => freshStatus());
        if (normalized === "status") renderStatus(status);
        if (normalized === "readiness") renderReadiness(status);
        if (normalized === "details") renderDetails(status);
        if (normalized === "history") renderHistory(status);
      } else if (normalized === "presentation") {
        await renderPresentationMenu();
      } else if (normalized === "current") {
        await renderCurrentPresentation();
      } else if (normalized === "preview") {
        if (!argumentMatch) throw new Error("Use: preview <1-8>");
        await previewPresentation(argumentMatch[2]);
      } else if (normalized === "use") {
        if (!argumentMatch) throw new Error("Use: use <1-8>");
        await usePresentation(argumentMatch[2]);
      } else if (normalized === "reset") {
        await resetPresentation();
      } else if (normalized === "force-promote") {
        const status = await tracedOperation("SCANNING", () => freshStatus());
        if (status.lifecycle === "promoted") append("This module is already promoted.");
        else if (!status.runtimeSafety.ready) {
          append(["FORCE PROMOTE BLOCKED", ...status.runtimeSafety.missing.map((check) => `✕ ${check.label} — ${check.reason}`)]);
        } else {
          append(["WARNING: Force Promote bypasses normal maturity requirements but still enforces the runtime-safety floor.", "Type FORCE PROMOTE to continue."]);
          pending = { action:"force-promote", phrase:"FORCE PROMOTE" };
        }
      } else if (normalized === "demote") {
        const status = await tracedOperation("SCANNING", () => freshStatus());
        if (status.lifecycle !== "promoted") append("This module is already in Builder.");
        else {
          append([`Schema, ${status.entryCount} entries, IDs, relationships, media, and configuration will be preserved.`, "Type DEMOTE to continue."]);
          pending = { action:"demote", phrase:"DEMOTE" };
        }
      } else if (normalized === "return-custom") {
        const status = await tracedOperation("SCANNING", () => freshStatus());
        append([
          `Return ${status.title || status.moduleKey} from Home Sections to Custom Modules Home?`,
          `Schema, ${status.entryCount} entries, IDs, relationships, media, lifecycle, and configuration will be preserved.`,
          "Type RETURN CUSTOM to continue."
        ]);
        pending = { action:"return-custom", phrase:"RETURN CUSTOM" };
      } else if (normalized === "delete") {
        await beginDelete();
      } else {
        const suggestion = closestCommand(normalized);
        append(`Unknown command: ${trimmed}.${suggestion ? ` Did you mean “${suggestion}”?` : " Type menu to see available commands."}`);
      }

    } catch (error) {
      append(`ERROR: ${error.message || "Module Console command failed."}`);
    }
  }

  async function open(nextModuleKey = "") {
    const requested = clean(nextModuleKey);
    if (!requested) throw new Error("Select a module before opening the Module Console.");
    const status = await getModuleLifecycleStatus(requested, { includeEntries:false });
    moduleKey = status.moduleKey;
    pending = null;
    setInputMode("command");
    root.hidden = false;
    moduleLabel.textContent = status.title || status.moduleKey;
    setConsoleState("BOOT", "info");
    setCommandBusy(true, "BOOT");
    const serial = ++bootSerial;
    await boot(status, serial);
    setCommandBusy(false);
    requestAnimationFrame(() => input?.focus());
  }

  function close() {
    bootSerial += 1;
    pending = null;
    commandBusy = false;
    moduleKey = "";
    setInputMode("command");
    if (input) input.disabled = false;
    clearOutput();
    if (input) input.value = "";
    root.hidden = true;
    setConsoleState("READY", "success");
    options.onClosed?.();
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input?.value || "";
    if (input) input.value = "";
    execute(value).finally(() => input?.focus());
  });
  host.querySelectorAll("[data-module-console-close]").forEach((button) => button.addEventListener("click", close));
  root.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

  return { open, close, execute, isOpen:() => !root.hidden };
}
