await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));
import { loadContact, saveContact } from "../services/contactService.js";
import { loadProfile } from "../services/profileService.js";

const $ = (id) => document.getElementById(id);
const form = $("contactForm"), status = $("saveStatus");
const fields = ["heading", "message", "email", "phone", "github", "linkedin", "facebook", "status"];
const legacyMethods = ["phone", "github", "linkedin", "facebook"];
const methodDefinitions = {
  phone:{label:"Phone",type:"tel",placeholder:"+63 900 000 0000"}, github:{label:"GitHub",type:"url",placeholder:"https://github.com/username"}, linkedin:{label:"LinkedIn",type:"url",placeholder:"https://linkedin.com/in/username"}, facebook:{label:"Facebook",type:"url",placeholder:"https://facebook.com/username"},
  whatsapp:{label:"WhatsApp",type:"text",placeholder:"+63 900 000 0000 or WhatsApp URL"}, messenger:{label:"Messenger",type:"text",placeholder:"Username or https://m.me/username"}, telegram:{label:"Telegram",type:"text",placeholder:"@username or https://t.me/username"}, discord:{label:"Discord",type:"text",placeholder:"Discord username or invite URL"},
  instagram:{label:"Instagram",type:"url",placeholder:"https://instagram.com/username"}, twitter:{label:"X / Twitter",type:"url",placeholder:"https://x.com/username"}, youtube:{label:"YouTube",type:"url",placeholder:"https://youtube.com/@channel"}, behance:{label:"Behance",type:"url",placeholder:"https://behance.net/username"},
  dribbble:{label:"Dribbble",type:"url",placeholder:"https://dribbble.com/username"}, upwork:{label:"Upwork",type:"url",placeholder:"https://upwork.com/freelancers/..."}, fiverr:{label:"Fiverr",type:"url",placeholder:"https://fiverr.com/username"}, website:{label:"Personal Website",type:"url",placeholder:"https://yourwebsite.com"}, "email-alt":{label:"Alternate Email",type:"email",placeholder:"name@example.com"}, other:{label:"Other",type:"text",placeholder:"Enter contact value"}
};
let extraMethods = [];
let profileContext = { location: "", availability: "", showAvailability: true };
let contactContext = { location: "", availability: "" };
const setStatus = (message) => { if (status) status.textContent = message; };
const value = (id, fallback = "—") => $(id)?.value?.trim() || fallback;
const escapeHtml = (value = "") => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const availabilityLabels = { available:"Available for work", "part-time":"Available for part-time work", "full-time":"Available for full-time work", freelance:"Available for freelance projects", unavailable:"Currently unavailable" };
const profileAvailability = () => profileContext.showAvailability === false ? "Hidden in About" : (availabilityLabels[String(profileContext.availability || "").toLowerCase()] || String(profileContext.availability || "").trim() || "—");

function hrefFor(method = {}) {
  const raw = String(method.value || "").trim();
  if (!raw) return "";
  const type = String(method.type || "").toLowerCase();
  if (type === "phone") return `tel:${raw.replace(/\s+/g, "")}`;
  if (type === "email-alt") return `mailto:${raw}`;
  if (/^(?:https?:|mailto:|tel:)/i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "").trim();
  if (type === "whatsapp" && /^[+\d][\d\s().-]+$/.test(raw)) return `https://wa.me/${raw.replace(/\D/g, "")}`;
  if (type === "messenger" && handle && !raw.includes(" ")) return `https://m.me/${encodeURIComponent(handle)}`;
  if (type === "telegram" && handle && !raw.includes(" ")) return `https://t.me/${encodeURIComponent(handle)}`;
  if (type === "instagram" && handle && !raw.includes(" ")) return `https://instagram.com/${encodeURIComponent(handle)}`;
  if (type === "twitter" && handle && !raw.includes(" ")) return `https://x.com/${encodeURIComponent(handle)}`;
  if (type === "youtube" && raw.startsWith("@")) return `https://youtube.com/${raw}`;
  return raw.includes(".") ? `https://${raw}` : "";
}

function syncLegacyMethods() {
  legacyMethods.forEach((id) => {
    const wrapper = document.querySelector(`[data-contact-method="${id}"]`);
    if (!wrapper) return;
    const hasValue = Boolean($(id)?.value?.trim());
    if (!wrapper.dataset.userVisibility) wrapper.hidden = !hasValue;
  });
}

function renderExtraMethods({ focusLast = false } = {}) {
  const host = $("dynamicContactMethods");
  if (!host) return;
  host.innerHTML = extraMethods.length ? `<section class="contact-extra-section"><div class="contact-extra-section-head"><div><p class="editor-eyebrow">Additional channels</p><strong>Optional contact methods</strong></div><small>${extraMethods.length} added</small></div><div class="contact-method-extra-grid">${extraMethods.map((method,index) => {
    const def = methodDefinitions[method.type] || methodDefinitions.other;
    const customLabel = method.type === "other" ? `<label class="contact-extra-custom-label"><span>Channel name</span><input class="contact-extra-label" data-extra-label="${index}" value="${escapeHtml(method.label || "Other")}" placeholder="e.g. Portfolio community"></label>` : `<div><strong>${escapeHtml(def.label)}</strong><small>${escapeHtml(def.type === "url" ? "Profile URL" : def.type === "email" ? "Email address" : "Contact value")}</small></div>`;
    return `<section class="contact-method-extra-card" data-extra-index="${index}"><div class="contact-extra-heading">${customLabel}<button class="editor-danger-button button-compact" data-remove-extra="${index}" type="button">Remove</button></div><label class="contact-extra-value"><span>${escapeHtml(method.type === "other" ? "Contact value" : def.label)}</span><input data-extra-value="${index}" type="${def.type}" value="${escapeHtml(method.value || "")}" placeholder="${escapeHtml(def.placeholder || "Enter contact value")}"></label></section>`;
  }).join("")}</div></section>` : "";
  host.querySelectorAll("[data-extra-value]").forEach((input) => input.addEventListener("input", (event) => { extraMethods[Number(event.target.dataset.extraValue)].value = event.target.value; updatePreview(); }));
  host.querySelectorAll("[data-extra-label]").forEach((input) => input.addEventListener("input", (event) => { extraMethods[Number(event.target.dataset.extraLabel)].label = event.target.value; updatePreview(); }));
  host.querySelectorAll("[data-remove-extra]").forEach((button) => button.addEventListener("click", () => { extraMethods.splice(Number(button.dataset.removeExtra),1); renderExtraMethods(); updatePreview(); setStatus("Contact method removed. Save Contact to persist."); }));
  if (focusLast) requestAnimationFrame(() => {
    host.scrollIntoView({ behavior: "smooth", block: "nearest" });
    host.querySelector(`[data-extra-value="${extraMethods.length - 1}"]`)?.focus();
  });
}

function collectMethods() {
  const methods = [];
  legacyMethods.forEach((type,index) => {
    const val = $(type)?.value?.trim();
    const wrapper = document.querySelector(`[data-contact-method="${type}"]`);
    if (val && !wrapper?.hidden) methods.push({ type, label: methodDefinitions[type].label, value: val, visible: true, displayOrder: (index+1)*10 });
  });
  extraMethods.forEach((method,index) => {
    const val = String(method.value || "").trim();
    if (val) methods.push({ type: method.type, label: String(method.label || methodDefinitions[method.type]?.label || "Contact").trim(), value: val, visible: true, displayOrder: 100 + index*10 });
  });
  return methods;
}

function updatePreview() {
  $("contactPreviewHeading").textContent = value("heading", "Let's Work Together");
  $("contactPreviewMessage").textContent = value("message", "Have a project in mind? Use the contact details below to get in touch.");
  $("contactPreviewEmail").textContent = value("email");
  $("contactPreviewPhone").textContent = value("phone");
  $("contactPreviewLocation").textContent = String(profileContext.location || "").trim() || "—";
  $("contactPreviewAvailability").textContent = profileAvailability();
  const methods = collectMethods().filter((method) => method.type !== "phone");
  const socials = $("contactPreviewSocials");
  socials.innerHTML = methods.length ? methods.map((method) => {
    const href = hrefFor(method); const label = escapeHtml(method.label || method.type);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
  }).join("") : '<span>No additional contact methods</span>';
  $("contactPreviewStatus").textContent = $("status")?.value === "draft" || !$("visible")?.checked ? "Draft preview" : "Public preview";
}

function addContactMethod(typeOverride = "") {
  const select = $("contactMethodType");
  const type = typeOverride || select?.value || "";
  if (!type) return;
  if (legacyMethods.includes(type)) {
    const wrapper = document.querySelector(`[data-contact-method="${type}"]`);
    if (wrapper) { wrapper.hidden = false; wrapper.dataset.userVisibility = "visible"; $(type)?.focus(); }
    if (select) { select.value = ""; select.dispatchEvent(new Event("input", { bubbles: true })); }
    setStatus(`${methodDefinitions[type].label} ready to edit.`); updatePreview(); return;
  }
  const existingIndex = extraMethods.findIndex((method) => method.type === type);
  if (existingIndex >= 0 && type !== "other") {
    renderExtraMethods();
    requestAnimationFrame(() => document.querySelector(`[data-extra-value="${existingIndex}"]`)?.focus());
    window.LANNotice?.({ title: "Contact method", message: `${methodDefinitions[type].label} is already added.`, tone: "info" });
    if (select) { select.value = ""; select.dispatchEvent(new Event("input", { bubbles: true })); }
    return;
  }
  extraMethods.push({ type, label: methodDefinitions[type]?.label || "Other", value: "" });
  renderExtraMethods({ focusLast: true });
  if (select) { select.value = ""; select.dispatchEvent(new Event("input", { bubbles: true })); }
  setStatus(`${methodDefinitions[type]?.label || "Contact method"} added. Enter the value below, then Save Contact.`);
}

function removeLegacyMethod(id) {
  const input = $(id), wrapper = document.querySelector(`[data-contact-method="${id}"]`); if (!input || !wrapper) return;
  input.value = ""; wrapper.hidden = true; wrapper.dataset.userVisibility = "hidden"; updatePreview(); setStatus(`${methodDefinitions[id].label} removed. Save Contact to persist.`);
}

async function load() {
  setStatus("Loading...");
  try {
    const [data, profile] = await Promise.all([loadContact(), loadProfile()]);
    contactContext = { location: data.location || "", availability: data.availability || "" };
    profileContext = { location: profile.location || "", availability: profile.availability || "", showAvailability: profile.showAvailability !== false };
    fields.forEach((key) => {
      const element = $(key);
      if (!element) return;
      if (key === "status" && window.LANSetSelectValue) {
        window.LANSetSelectValue(element, data[key] ?? "published", "published");
      } else {
        element.value = data[key] ?? "";
      }
    });
    $("visible").checked = data.visible !== false;
    extraMethods = (data.methods || []).filter((method) => !legacyMethods.includes(method.type)).map((method) => ({ ...method }));
    syncLegacyMethods(); renderExtraMethods(); updatePreview(); setStatus("Ready");
  } catch (error) {
    console.error("Contact loading failed:", error); setStatus("Unable to load contact content"); window.LANNotice?.({ title: "Contact", message: error?.message || "Unable to load contact content", tone: "error" });
  }
}

fields.forEach((id) => $(id)?.addEventListener("input", updatePreview));
$("visible")?.addEventListener("change", updatePreview);
$("addContactMethodButton")?.addEventListener("click", () => addContactMethod());
$("contactMethodType")?.addEventListener("change", (event) => addContactMethod(event.target.value));
document.querySelectorAll("[data-remove-contact]").forEach((button) => button.addEventListener("click", () => removeLegacyMethod(button.dataset.removeContact)));
form?.addEventListener("submit", async (event) => {
  event.preventDefault(); if (window.LANValidateForm ? !window.LANValidateForm(form, { title: "Complete Contact" }) : !form.reportValidity()) return; setStatus("Saving...");
  const data = {}; fields.forEach((key) => data[key] = $(key).value); data.visible = $("visible").checked; data.methods = collectMethods();
  data.location = contactContext.location; data.availability = contactContext.availability;
  try { await saveContact(data); setStatus("Saved"); window.LANNotice?.({ title: "Contact saved", message: "Public contact information was saved successfully.", tone: "success" }); syncLegacyMethods(); updatePreview(); }
  catch (error) { console.error("Contact save failed:", error); setStatus(error?.message || "Unable to save contact content"); window.LANNotice?.({ title: "Contact", message: error?.message || "Unable to save contact content", tone: "error" }); }
});
await load();
