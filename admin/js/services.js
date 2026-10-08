await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));
import { loadServices, saveServices } from "../services/servicesService.js";
import { loadHome } from "../services/homeService.js";
import { getSystemIconMeta, normalizeSystemIconName, renderSystemIcon, searchSystemIcons } from "../../icon-registry.js";

const $ = (id) => document.getElementById(id);
const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const clean = (value = "") => String(value ?? "").trim();
let services = [];
let availability = [];
let currentStatus = "draft";
let currentVisible = true;
let homeServicesEnabled = null;

function notice(message, tone = "success") { window.LANNotice?.({ title: tone === "error" ? "Services" : "Services updated", message, tone }); }

function homeAllowsWorkWithMe(home = {}) {
  const sections = Array.isArray(home.sections) ? home.sections : [];
  const servicesSection = sections.find((section) => clean(section?.key) === "services");
  return servicesSection ? servicesSection.enabled !== false : true;
}

function updatePublishingHint() {
  const hint = $("servicesSaveHint");
  if (!hint) return;
  const homeState = homeServicesEnabled === null ? "Home visibility unavailable" : `Home visibility ${homeServicesEnabled ? "ON" : "OFF"}`;
  if (currentStatus !== "published") {
    hint.textContent = `Draft · Work With Me is hidden until Services is published · ${homeState}`;
    return;
  }
  if (currentVisible === false) {
    hint.textContent = `Published · Services visibility is OFF, so Work With Me is hidden · ${homeState}`;
    return;
  }
  if (homeServicesEnabled === false) {
    hint.textContent = "Published · Home / Studio visibility is OFF, so Work With Me is hidden.";
    return;
  }
  hint.textContent = homeServicesEnabled === null
    ? "Published · Work With Me is eligible when Home / Studio visibility is enabled."
    : "Published · Work With Me is eligible for the public header.";
}
function uid(prefix = "item") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

function serviceIconOptions(query = "", selected = "sparkles") {
  const selectedId = normalizeSystemIconName(selected);
  const matches = searchSystemIcons(query);
  return matches.map((item) => `<button class="services-icon-option${item.id === selectedId ? " is-selected" : ""}" data-service-icon-option="${esc(item.id)}" type="button" aria-pressed="${item.id === selectedId}"><span class="services-icon-option-symbol">${renderSystemIcon(item.id)}</span><span class="services-icon-option-copy"><strong>${esc(item.label)}</strong><small>${esc(item.id)}</small></span></button>`).join("") || '<div class="services-icon-empty">No matching icons.</div>';
}

function serviceIconPickerMarkup(item = {}) {
  const iconId = normalizeSystemIconName(item.icon || "sparkles");
  const meta = getSystemIconMeta(iconId);
  return `<div class="services-icon-field services-record-field"><span class="services-field-label">Icon</span><div class="services-icon-picker" data-service-icon-picker>
    <input data-service-icon-value type="hidden" value="${esc(iconId)}">
    <button class="services-icon-trigger" data-service-icon-trigger type="button" aria-expanded="false"><span data-service-icon-preview>${renderSystemIcon(iconId)}</span><span><strong data-service-icon-name>${esc(meta.label)}</strong><small>${esc(iconId)}</small></span><b aria-hidden="true">⌄</b></button>
  </div></div>`;
}

function serviceIconDrawerMarkup(item = {}) {
  const iconId = normalizeSystemIconName(item.icon || "sparkles");
  return `<div class="services-icon-popover" data-service-icon-popover hidden><label class="services-icon-search-label"><span>Search icons</span><input data-service-icon-search type="search" autocomplete="off" placeholder="Search icons..."></label><div class="services-icon-options" data-service-icon-options>${serviceIconOptions("", iconId)}</div></div>`;
}

function closeServiceIconPickers(exceptRow = null) {
  document.querySelectorAll("[data-service-index]").forEach((row) => {
    if (row === exceptRow) return;
    row.querySelector("[data-service-icon-popover]")?.setAttribute("hidden", "");
    row.querySelector("[data-service-icon-trigger]")?.setAttribute("aria-expanded", "false");
    row.classList.remove("is-icon-picker-open");
  });
}

function syncServiceIconPicker(picker, iconName) {
  if (!(picker instanceof HTMLElement)) return;
  const iconId = normalizeSystemIconName(iconName);
  const meta = getSystemIconMeta(iconId);
  const input = picker.querySelector("[data-service-icon-value]");
  if (input) input.value = iconId;
  const preview = picker.querySelector("[data-service-icon-preview]");
  if (preview) preview.innerHTML = renderSystemIcon(iconId);
  const name = picker.querySelector("[data-service-icon-name]");
  if (name) name.textContent = meta.label;
  const small = picker.querySelector("[data-service-icon-name] + small");
  if (small) small.textContent = iconId;
  const row = picker.closest("[data-service-index]");
  row?.querySelectorAll("[data-service-icon-option]").forEach((button) => {
    const selected = button.dataset.serviceIconOption === iconId;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderServiceRows() {
  const host = $("serviceRows");
  host.innerHTML = services.length ? services.map((item, index) => `<article class="services-record-row" data-service-index="${index}">
    <div class="services-record-main">
      <div class="services-primary-stack">
        <label class="services-title-field services-record-field"><span class="services-field-label">Service title</span><input data-service-title maxlength="80" value="${esc(item.title)}" required></label>
        ${serviceIconPickerMarkup(item)}
      </div>
      <label class="services-description-field services-record-field"><span class="services-field-label">Short description</span><textarea data-service-description maxlength="360" rows="3" required>${esc(item.description)}</textarea></label>
      <div class="services-side-controls">
        <label class="services-order-field services-record-field"><span class="services-field-label">Order</span><input data-service-order type="number" value="${Number(item.displayOrder) || (index + 1) * 10}"></label>
        <div class="services-row-visible services-record-field"><span class="services-field-label">Visible</span><label class="services-visible-control" title="Show this service in the Work With Me popup"><span class="sr-only">Show in popup</span><input data-service-visible aria-label="Show this service in the Work With Me popup" type="checkbox" role="switch"${item.visible !== false ? " checked" : ""}></label></div>
        <footer class="services-record-actions"><button class="editor-danger-button button-compact service-delete" data-remove-service="${index}" type="button">Delete service</button></footer>
      </div>
    </div>
    ${serviceIconDrawerMarkup(item)}
  </article>`).join("") : '<div class="lan-empty-state"><strong>No services yet</strong><p>Add at least one service before publishing.</p></div>';
  host.querySelectorAll("[data-remove-service]").forEach((button) => button.addEventListener("click", () => { collectServiceRows(); services.splice(Number(button.dataset.removeService), 1); renderServiceRows(); renderPreview(); markDirty(); }));
  host.querySelectorAll("input:not([data-service-icon-search]),textarea").forEach((control) => { control.addEventListener("input", () => { collectServiceRows(); renderPreview(); markDirty(); }); control.addEventListener("change", () => { collectServiceRows(); renderPreview(); markDirty(); }); });
}

function collectServiceRows() {
  document.querySelectorAll("[data-service-index]").forEach((row) => {
    const item = services[Number(row.dataset.serviceIndex)]; if (!item) return;
    item.title = clean(row.querySelector("[data-service-title]")?.value);
    item.description = clean(row.querySelector("[data-service-description]")?.value);
    item.icon = normalizeSystemIconName(row.querySelector("[data-service-icon-value]")?.value || "sparkles");
    item.displayOrder = Number(row.querySelector("[data-service-order]")?.value) || 0;
    item.visible = row.querySelector("[data-service-visible]")?.checked !== false;
  });
}

function renderAvailabilityRows() {
  const host = $("availabilityRows");
  host.innerHTML = availability.map((item, index) => `<article class="services-availability-card" data-availability-index="${index}"><label>Label<input data-availability-label maxlength="60" value="${esc(item.label)}"></label><label class="lan-toggle-compact" title="Show ${esc(item.label)} in the Work With Me popup"><span class="sr-only">Show ${esc(item.label)}</span><input data-availability-enabled aria-label="Show ${esc(item.label)}" type="checkbox" role="switch"${item.enabled !== false ? " checked" : ""}></label></article>`).join("");
  host.querySelectorAll("input").forEach((control) => { control.addEventListener("input", () => { collectAvailabilityRows(); renderPreview(); markDirty(); }); control.addEventListener("change", () => { collectAvailabilityRows(); renderPreview(); markDirty(); }); });
}

function collectAvailabilityRows() {
  document.querySelectorAll("[data-availability-index]").forEach((row) => {
    const item = availability[Number(row.dataset.availabilityIndex)]; if (!item) return;
    item.label = clean(row.querySelector("[data-availability-label]")?.value);
    item.enabled = row.querySelector("[data-availability-enabled]")?.checked !== false;
  });
}

function collectPayload(status = currentStatus) {
  collectServiceRows(); collectAvailabilityRows();
  return {
    heading: clean($("servicesHeading").value), intro: clean($("servicesIntro").value), ctaLabel: "Work With Me", status, visible: status === "published" ? true : currentVisible,
    services: services.map((item, index) => ({ ...item, displayOrder: Number(item.displayOrder) || (index + 1) * 10 })),
    availability: availability.map((item, index) => ({ ...item, displayOrder: Number(item.displayOrder) || (index + 1) * 10 })),
    contact: {
      emailEnabled: $("servicesEmailEnabled").checked, emailLabel: clean($("servicesEmailLabel").value), email: clean($("servicesEmail").value),
      linkedinEnabled: $("servicesLinkedinEnabled").checked, linkedinLabel: clean($("servicesLinkedinLabel").value), linkedinUrl: clean($("servicesLinkedinUrl").value),
      copyEmailEnabled: $("servicesCopyEmailEnabled").checked, copyEmailLabel: clean($("servicesCopyEmailLabel").value)
    },
    emailSubject: clean($("servicesEmailSubject").value), emailTemplate: $("servicesEmailTemplate").value.trim()
  };
}

function syncContactRequirements(status) {
  const publishing = status === "published";
  const emailRequired = publishing && ($("servicesEmailEnabled").checked || $("servicesCopyEmailEnabled").checked);
  const linkedinRequired = publishing && $("servicesLinkedinEnabled").checked;
  $("servicesEmail").required = emailRequired;
  $("servicesLinkedinUrl").required = linkedinRequired;
}

function renderPreview() {
  const data = collectPayload(currentStatus);
  $("servicesPreviewStatus").textContent = currentStatus === "published" ? "Published" : "Draft";
  $("servicesPreviewHeading").textContent = data.heading || "Work With Me";
  $("servicesPreviewIntro").textContent = data.intro || "Add a short client-focused introduction.";
  $("servicesPreviewAvailability").innerHTML = data.availability.filter((item) => item.enabled && item.label).map((item) => `<span>${esc(item.label)}</span>`).join("");
  $("servicesPreviewCards").innerHTML = data.services.filter((item) => item.visible && item.title).map((item) => `<article class="services-preview-card"><span class="services-preview-card-icon" aria-hidden="true">${renderSystemIcon(item.icon)}</span><strong>${esc(item.title)}</strong><p>${esc(item.description || "Add a short description.")}</p></article>`).join("") || '<div class="lan-empty-state">No visible services.</div>';
  const buttons = [];
  if (data.contact.emailEnabled && data.contact.email) buttons.push(data.contact.emailLabel || "Email Me");
  if (data.contact.linkedinEnabled && data.contact.linkedinUrl) buttons.push(data.contact.linkedinLabel || "LinkedIn");
  if (data.contact.copyEmailEnabled && data.contact.email) buttons.push(data.contact.copyEmailLabel || "Copy Email");
  $("servicesPreviewContactButtons").innerHTML = buttons.map((label) => `<span>${esc(label)}</span>`).join("");
}

function markDirty() { $("saveStatus").textContent = "Unsaved changes"; $("servicesSaveHint").textContent = "Unsaved changes · Public visitors still see the last saved Services state."; }

async function persist(status) {
  const form = $("servicesForm");
  syncContactRequirements(status);
  if (window.LANValidateForm ? !window.LANValidateForm(form, { title: "Complete Services Setup" }) : !form.reportValidity()) return;
  const data = collectPayload(status);
  const saved = await saveServices(data, status);
  currentStatus = saved.status;
  currentVisible = saved.visible !== false;
  services = saved.services.map((item) => ({ ...item }));
  availability = saved.availability.map((item) => ({ ...item }));
  $("saveStatus").textContent = currentStatus === "published" ? "Published" : "Draft saved";
  updatePublishingHint();
  renderServiceRows(); renderAvailabilityRows(); renderPreview();
  notice(currentStatus === "published" ? "Services published. Home / Studio remains the master visibility controller." : "Services saved as Draft.");
}

async function init() {
  const [servicesResult, homeResult] = await Promise.allSettled([loadServices(), loadHome()]);
  if (servicesResult.status !== "fulfilled") throw servicesResult.reason;
  const data = servicesResult.value;
  currentStatus = data.status;
  currentVisible = data.visible !== false;
  homeServicesEnabled = homeResult.status === "fulfilled" ? homeAllowsWorkWithMe(homeResult.value) : null;
  services = data.services.map((item) => ({ ...item }));
  availability = data.availability.map((item) => ({ ...item }));
  $("servicesHeading").value = data.heading; $("servicesIntro").value = data.intro;
  $("servicesEmailEnabled").checked = data.contact.emailEnabled; $("servicesEmailLabel").value = data.contact.emailLabel; $("servicesEmail").value = data.contact.email;
  $("servicesLinkedinEnabled").checked = data.contact.linkedinEnabled; $("servicesLinkedinLabel").value = data.contact.linkedinLabel; $("servicesLinkedinUrl").value = data.contact.linkedinUrl;
  $("servicesCopyEmailEnabled").checked = data.contact.copyEmailEnabled; $("servicesCopyEmailLabel").value = data.contact.copyEmailLabel;
  $("servicesEmailSubject").value = data.emailSubject; $("servicesEmailTemplate").value = data.emailTemplate;
  renderServiceRows(); renderAvailabilityRows(); renderPreview();
  $("saveStatus").textContent = currentStatus === "published" ? "Published" : "Draft";
  updatePublishingHint();
}

$("serviceRows").addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-service-icon-trigger]");
  if (trigger) {
    const row = trigger.closest("[data-service-index]");
    const picker = row?.querySelector("[data-service-icon-picker]");
    const popover = row?.querySelector("[data-service-icon-popover]");
    if (!row || !picker || !popover) return;
    const willOpen = popover.hidden;
    closeServiceIconPickers(willOpen ? row : null);
    popover.hidden = !willOpen;
    row.classList.toggle("is-icon-picker-open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) requestAnimationFrame(() => popover.querySelector("[data-service-icon-search]")?.focus());
    return;
  }
  const option = event.target.closest("[data-service-icon-option]");
  if (option) {
    const row = option.closest("[data-service-index]");
    const picker = row?.querySelector("[data-service-icon-picker]");
    syncServiceIconPicker(picker, option.dataset.serviceIconOption);
    row?.querySelector("[data-service-icon-popover]")?.setAttribute("hidden", "");
    row?.querySelector("[data-service-icon-trigger]")?.setAttribute("aria-expanded", "false");
    row?.classList.remove("is-icon-picker-open");
    collectServiceRows(); renderPreview(); markDirty();
  }
});
$("serviceRows").addEventListener("input", (event) => {
  const search = event.target.closest("[data-service-icon-search]");
  if (!search) return;
  const row = search.closest("[data-service-index]");
  const picker = row?.querySelector("[data-service-icon-picker]");
  const selected = picker?.querySelector("[data-service-icon-value]")?.value || "sparkles";
  const options = row?.querySelector("[data-service-icon-options]");
  if (options) options.innerHTML = serviceIconOptions(search.value, selected);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-service-icon-picker],[data-service-icon-popover]")) closeServiceIconPickers();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const openRow = document.querySelector("[data-service-icon-popover]:not([hidden])")?.closest("[data-service-index]");
  if (!openRow) return;
  closeServiceIconPickers();
  openRow.querySelector("[data-service-icon-trigger]")?.focus();
});

$("addServiceButton").addEventListener("click", () => { collectServiceRows(); services.push({ id: uid("service"), title: "", description: "", icon: "sparkles", visible: true, displayOrder: (services.length + 1) * 10 }); renderServiceRows(); renderPreview(); document.querySelector("[data-service-index]:last-child input")?.focus(); markDirty(); });
$("saveServicesDraft").addEventListener("click", () => persist("draft").catch((error) => notice(error.message, "error")));
$("publishServices").addEventListener("click", () => persist("published").catch((error) => notice(error.message, "error")));
$("previewServicesButton").addEventListener("click", () => { renderPreview(); document.querySelector(".services-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
$("servicesForm").addEventListener("input", (event) => { if (event.target.closest("#serviceRows,#availabilityRows")) return; renderPreview(); markDirty(); });
$("servicesForm").addEventListener("change", (event) => { if (event.target.closest("#serviceRows,#availabilityRows")) return; renderPreview(); markDirty(); });

init().catch((error) => { console.error(error); $("saveStatus").textContent = "Unavailable"; notice(error.message || "Unable to load Services.", "error"); });
