await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));

import { loadHome, saveHome, saveHomeSections, defaultSectionOrder } from "../services/homeService.js";
import { loadPublishedExperiences } from "../services/experienceService.js";
import { educationService } from "../services/educationService.js";
import { loadProjects } from "../services/projectService.js";
import { listPhotoEditingProjects } from "../services/photoEditingService.js";
import { loadCertificates } from "../services/certificateService.js";
import { loadContact } from "../services/contactService.js";
import { listSections, listEntries, updateSectionRegistry } from "../services/portfolioSectionService.js";
import { uploadImage } from "../services/storageUploadService.js";
import { discardTemporaryMediaAssets } from "../services/mediaAssetLifecycleService.js";
import { suggestModulePublicPresentation, eligibleModuleEntries } from "../../module-platform.js";
import { defaultPublicLayoutPreset, compatiblePublicLayoutPresets, resolvePublicLayoutPreset, suggestPublicLayoutPreset, placementOrder, canPairPublicLayoutPresets, publicLayoutSpan, planPublicLayoutRows } from "../../public-layout-contract.js";
import { isPublicLayoutSectionKey } from "../../public-section-eligibility.js";
import { resolveAdminMediaAssetUrl } from "./admin-media-frame.js";

const $ = (id) => document.getElementById(id);
const fields = ["eyebrow","displayName","brand","headline","roles","introduction","portraitAlt","primaryCtaLabel","primaryCtaDestination","secondaryCtaLabel","secondaryCtaDestination","aboutImageAlt","aboutTitleOverride","aboutSubtitle","aboutOrder","footerText","homeStatus","homeVisible","aboutVisible"];

let portrait = "";
let aboutImage = "";
let sections = [];
let registeredCustomSections = [];
let localPortraitUrl = "";
let localAboutUrl = "";
let failedPortraitSource = "";
let failedAboutSource = "";

function registeredCustomSectionKeys() {
  return new Set(registeredCustomSections.map((section) => String(section?.key || "").trim()).filter(Boolean));
}

function registeredCustomSectionMap() {
  return new Map(registeredCustomSections.map((section) => [String(section?.key || "").trim(), section]));
}

function combinedHomeSections() {
  return [...sections, ...registeredCustomSections];
}

function resolveAdminMediaSource(value) {
  if (value && typeof value === "object") return resolveAdminMediaAssetUrl(value);
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^(?:https?:|blob:|data:|\/)/i.test(source)) return source;
  if (source.startsWith("assets/")) return `../../${source}`;
  return source;
}

function note(message, type = "success") {
  window.LANNotice?.({
    title: type === "error" ? "Homepage" : "Homepage updated",
    message,
    tone: type === "error" ? "error" : type === "warning" ? "warning" : "success"
  });
  if (type === "error" && $("saveStatus")) {
    $("saveStatus").textContent = "Action failed";
    $("saveStatus").classList.add("error");
  }
}

function setImage(id, url) {
  const image = $(id);
  if (!image) return;
  const source = resolveAdminMediaSource(url);
  const empty = id === "portraitPreview" ? $("portraitEmptyState") : id === "aboutImagePreview" ? $("aboutImageEmptyState") : null;
  if (source) {
    image.src = source;
    image.hidden = false;
    if (empty) empty.hidden = true;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
    if (empty) empty.hidden = false;
  }
}

function setUploadStatus(id, message, state = "") {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

const escapePreview = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const previewValue = (id, fallback = "") => $(id)?.value.trim() || fallback;

function sectionLabel(key, registry) {
  const built = {about:"About",experience:"Experience",projects:"Projects","photo-editing":"Photo Editing",education:"Education",skills:"Skills",services:"Services / Work With Me",certificates:"Certificates",resume:"Resume",contact:"Contact"};
  return built[key] || registry.find((section) => section.key === key)?.title || key;
}
function sectionOwnerRoute(key, registry = []) {
  const routes = {about:"about.html",experience:"experience.html",projects:"projects.html","photo-editing":"photo-editing.html",education:"education.html",skills:"skills.html",services:"services.html",certificates:"certificates.html",resume:"resume.html",contact:"contact.html"};
  if (routes[key]) return routes[key];
  const module = registry.find((section) => section.key === key);
  return module ? `module.html?section=${encodeURIComponent(module.key)}` : "home.html#future-portfolio-features";
}
function sectionPublicSlug(key, registry = []) {
  return registry.find((section) => section.key === key)?.slug || key;
}
function sectionIcon(key) {
  return ({about:"◉",experience:"⌁",projects:"▦","photo-editing":"▧",education:"◇",skills:"✦",services:"✧",certificates:"◈",resume:"▤",contact:"✉"})[key] || "◆";
}
function miniPreviewType(key) {
  return ({about:"profile",experience:"timeline",projects:"cards","photo-editing":"gallery",education:"education",certificates:"credential",contact:"contact"})[key] || "feature";
}

function premiumMiniMedia(source, label) {
  if (source) return `<div class="mini-about-media lan-media-frame lan-media-frame--mini" aria-hidden="true"><img src="${escapePreview(source)}" alt=""></div>`;
  return `<div class="mini-about-media lan-media-frame lan-media-frame--mini" aria-hidden="true"><div class="lan-media-frame__empty"><span class="lan-media-frame__brand">LΛN</span><small class="lan-media-frame__label">${escapePreview(label)}</small></div></div>`;
}

let modulePreviewData = {};

function miniMediaUrl(value, depth = 0) {
  if (!value || depth > 3) return "";
  const managedUrl = resolveAdminMediaAssetUrl(value);
  if (managedUrl) return managedUrl;
  if (typeof value === "string") return resolveAdminMediaSource(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = miniMediaUrl(item, depth + 1);
      if (resolved) return resolved;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const key of ["url","secureUrl","secure_url","src","imageUrl","fileUrl","image","media","asset"]) {
    const resolved = miniMediaUrl(value[key], depth + 1);
    if (resolved) return resolved;
  }
  return "";
}

function formatMiniDateValue(value = "") {
  const source = String(value || "").trim();
  if (!source) return "";
  const match = source.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return source;
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
  return `${month} ${match[1]}`;
}

function miniDate(record = {}) {
  const start = record.startDate || [record.startMonth,record.startYear].filter(Boolean).join(" ");
  const end = record.isCurrent || record.currentlyStudying ? "Present" : (record.endDate || [record.endMonth,record.endYear].filter(Boolean).join(" "));
  return [formatMiniDateValue(start),formatMiniDateValue(end)].filter(Boolean).join(" – ");
}

function publicLike(record = {}) {
  const status = String(record.status || "published").toLowerCase();
  return status !== "draft" && record.visible !== false && record.isDeleted !== true && !record.deletedAt && record.archived !== true;
}

function previewTimestamp(record = {}) {
  const value = record.updatedAt || record.createdAt || record.publishedAt;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return Number(value.seconds) * 1000;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortMiniRecords(records = []) {
  return [...records].sort((a,b) => {
    const featured = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    if (featured) return featured;
    const orderA = Number(a.displayOrder ?? a.order ?? 0);
    const orderB = Number(b.displayOrder ?? b.order ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return previewTimestamp(b) - previewTimestamp(a);
  });
}

async function loadMiniModuleData(contactData = null) {
  const loaders = {
    experience: async () => loadPublishedExperiences(),
    education: async () => (await educationService.getEducationRecords()).filter(publicLike),
    projects: async () => (await loadProjects()).filter(publicLike),
    "photo-editing": async () => (await listPhotoEditingProjects()).filter(publicLike),
    certificates: async () => (await loadCertificates()).filter(publicLike),
    contact: async () => contactData ?? loadContact()
  };
  const settled = await Promise.all(Object.entries(loaders).map(async ([key,loader]) => {
    try {
      const value = await loader();
      return [key, Array.isArray(value) ? sortMiniRecords(value) : value];
    } catch (error) {
      console.warn(`Homepage preview could not load ${key}.`, error);
      return [key, key === "contact" ? {} : []];
    }
  }));
  modulePreviewData = { ...modulePreviewData, ...Object.fromEntries(settled) };
}

async function loadMiniCustomModuleData(registry = []) {
  const modules = Array.isArray(registry) ? registry.filter((section) => section?.key) : [];
  if (!modules.length) return;
  const settled = await Promise.all(modules.map(async (section) => {
    try {
      const records = await listEntries(section.key, section);
      return [section.key, sortMiniRecords(eligibleModuleEntries(records))];
    } catch (error) {
      console.warn(`Homepage preview could not load generated module ${section.key}.`, error);
      return [section.key, []];
    }
  }));
  modulePreviewData = { ...modulePreviewData, ...Object.fromEntries(settled) };
}

function miniOverflow(total, shown, label) {
  const remaining = Math.max(0, total - shown);
  return remaining ? `<span class="mini-overflow">+${remaining} more ${escapePreview(label)}</span>` : "";
}


function miniCardMedia(source, label = "LΛN") {
  const url = miniMediaUrl(source);
  return url ? `<span class="mini-project-media has-image"><img src="${escapePreview(url)}" alt=""></span>` : `<span class="mini-project-media"><b>${escapePreview(label)}</b></span>`;
}

function miniSectionBody(type, key = "") {
  const records = Array.isArray(modulePreviewData[key]) ? modulePreviewData[key] : [];
  if (type === "profile") {
    const candidate = localAboutUrl || $("aboutImagePreview")?.getAttribute("src") || aboutImage || "";
    const resolvedCandidate = resolveAdminMediaSource(candidate);
    const source = resolvedCandidate === failedAboutSource ? "" : resolvedCandidate;
    return `<div class="mini-about">${premiumMiniMedia(source, "About")}<div class="mini-copy-lines" aria-hidden="true"><strong>Professional profile</strong><i></i><i></i><i></i><small>Biography managed in About</small></div></div>`;
  }
  if (type === "timeline") {
    const shown = 3;
    const items = records.slice(0,shown);
    return `<div class="mini-section-content"><div class="mini-timeline">${(items.length ? items : [{},{}]).map((item,index) => `<div><i></i><span><strong>${escapePreview(item.jobTitle || item.role || item.position || (index ? "Career milestone" : "Professional role"))}</strong><small>${escapePreview([item.company || item.organization || "Organization", miniDate(item) || "period"].filter(Boolean).join(" · "))}</small></span></div>`).join("")}</div>${miniOverflow(records.length,items.length,"roles")}</div>`;
  }
  if (type === "education") {
    const shown = 3;
    const items = records.slice(0,shown);
    return `<div class="mini-section-content"><div class="mini-timeline mini-education">${(items.length ? items : [{}]).map((item,index) => `<div><i></i><span><strong>${escapePreview(item.degreeName || item.degree || (index ? "Training" : "Degree / program"))}</strong><small>${escapePreview([item.schoolName || item.school || "School", miniDate(item) || item.startYear || "period"].filter(Boolean).join(" · "))}</small></span></div>`).join("")}</div>${miniOverflow(records.length,items.length,"education records")}</div>`;
  }
  if (type === "cards") {
    const photos = modulePreviewData["photo-editing"] || [];
    const photoMap = new Map(photos.map((item) => [item.id,item]));
    const shown = 5;
    const items = records.slice(0,shown);
    return `<div class="mini-section-content"><div class="mini-project-grid">${(items.length ? items : [{},{},{},{},{}]).map((item,index) => {
      const linkedPhoto = /photo/i.test(String(item.linkedModuleKey || item.linkedModule || item.linkedCollection || "")) ? photoMap.get(item.linkedDocumentId) : null;
      const source = linkedPhoto || item;
      const cover = source.coverImage || source.coverImageUrl || source.afterImage || source.afterImageUrl || source.singleImage || source.singleImageUrl || source.image || source.imageUrl || (Array.isArray(source.galleryImages) ? source.galleryImages[0] : "");
      const title = item.title || linkedPhoto?.title || `Project ${index + 1}`;
      const summary = item.shortSummary || item.description || linkedPhoto?.shortSummary || linkedPhoto?.description || "Project summary";
      const label = title.split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase();
      return `<article class="mini-project-card">${miniCardMedia(cover,label)}<span class="mini-project-card-body"><strong>${escapePreview(title)}</strong><small class="mini-project-summary">${escapePreview(summary)}</small><span class="mini-project-capabilities"><i></i><i></i></span><span class="mini-project-actions"><b></b><b></b></span></span></article>`;
    }).join("")}</div>${miniOverflow(records.length,items.length,"projects")}</div>`;
  }
  if (type === "gallery") {
    const shown = 5;
    const items = records.slice(0,shown);
    const cells = (items.length ? items : [{},{},{},{},{}]).map((item,index) => {
      const finalImage = item.coverImage || item.coverImageUrl || item.afterImage || item.afterImageUrl || item.singleImage || item.singleImageUrl || item.image || item.imageUrl || (Array.isArray(item.galleryImages) ? item.galleryImages[0] : "");
      const url = miniMediaUrl(finalImage);
      return `<article class="mini-photo-category">${url ? `<img src="${escapePreview(url)}" alt="">` : '<span class="mini-photo-category-empty">LΛN</span>'}<b>${escapePreview(item.title || `Sample ${index + 1}`)}</b></article>`;
    });
    return `<div class="mini-section-content"><div class="mini-gallery mini-gallery--categories">${cells.join("")}</div>${miniOverflow(records.length,items.length,"samples")}</div>`;
  }
  if (type === "credential") {
    const shown = 4;
    const items = records.slice(0,shown);
    return `<div class="mini-section-content"><div class="mini-certificate-list">${(items.length ? items : [{}]).map((item,index) => `<div class="mini-certificate-row"><strong>${escapePreview(item.title || (index ? "Training" : "Certificate"))}</strong><span class="mini-certificate-year">${escapePreview(item.year || "Year")}</span></div>`).join("")}</div>${miniOverflow(records.length,items.length,"certificates")}</div>`;
  }
  if (type === "contact") {
    const contact = modulePreviewData.contact || {};
    const methodCount = Array.isArray(contact.methods) ? contact.methods.filter((item) => item.visible !== false && item.value).length : 0;
    const summary = [contact.email,contact.phone,contact.location,methodCount ? `${methodCount} contact channels` : ""].filter(Boolean).slice(0,3).join(" · ") || "Email · Location · Social";
    return `<div class="mini-contact"><strong>${escapePreview(contact.heading || "Start a conversation")}</strong><span>${escapePreview(summary)}</span><b>Send message</b></div>`;
  }
  return `<div class="mini-feature-card"><strong>Registered portfolio section</strong><i></i><i></i></div>`;
}

function miniCustomEntryData(entry = {}) {
  return entry?.data && typeof entry.data === "object" && !Array.isArray(entry.data)
    ? { ...entry, ...entry.data }
    : { ...entry };
}

function miniCustomEntryTitle(entry = {}) {
  const data = miniCustomEntryData(entry);
  return String(data.title || data.name || data.entryName || "Untitled entry").trim();
}

function miniCustomEntrySummary(entry = {}) {
  const data = miniCustomEntryData(entry);
  return String(data.shortSummary || data.summary || data.description || "").trim();
}

function miniCustomEntryMedia(section = {}, entry = {}) {
  const data = miniCustomEntryData(entry);
  const displayKey = String(section.display?.imageField || "").trim();
  if (displayKey && data[displayKey]) return miniMediaUrl(data[displayKey]);
  for (const field of section.fields || []) {
    if (!["image","images","gallery"].includes(field.type)) continue;
    const url = miniMediaUrl(data[field.key]);
    if (url) return url;
  }
  return miniMediaUrl(data.coverImage || data.coverImageUrl || data.image || data.imageUrl);
}

function miniCustomEntryDate(section = {}, entry = {}) {
  const data = miniCustomEntryData(entry);
  const dateFields = (section.fields || []).filter((field) => field.type === "date");
  const values = dateFields.map((field) => formatMiniDateValue(data[field.key])).filter(Boolean);
  if (values.length >= 2 && values[0] !== values[1]) return `${values[0]} – ${values[1]}`;
  return values[0] || "";
}

function miniCustomEntryContext(section = {}, entry = {}) {
  const data = miniCustomEntryData(entry);
  const field = (section.fields || []).find((candidate) => {
    if (!["text","select","number","hours"].includes(candidate.type)) return false;
    const signature = `${candidate.key || ""} ${candidate.label || ""}`.toLowerCase();
    return /organization|company|location|venue|type|category|role/.test(signature) && data[candidate.key];
  });
  return field ? String(data[field.key] || "").trim() : "";
}

function miniCustomCard(section = {}, entry = {}, index = 0) {
  const title = miniCustomEntryTitle(entry);
  const summary = miniCustomEntrySummary(entry);
  const media = miniCustomEntryMedia(section, entry);
  const date = miniCustomEntryDate(section, entry);
  const context = miniCustomEntryContext(section, entry);
  const label = title.split(/\s+/).slice(0,2).map((part) => part[0] || "").join("").toUpperCase() || String(index + 1);
  return `<article class="mini-project-card mini-generated-card">${miniCardMedia(media,label)}<span class="mini-project-card-body"><strong>${escapePreview(title)}</strong>${summary ? `<small class="mini-project-summary">${escapePreview(summary)}</small>` : ""}${date || context ? `<span class="mini-generated-meta">${[date,context].filter(Boolean).map(escapePreview).join(" · ")}</span>` : ""}</span></article>`;
}

function miniCustomSectionBody(section = {}) {
  const records = Array.isArray(modulePreviewData[section.key]) ? modulePreviewData[section.key] : [];
  if (section.status !== "published") {
    return `<div class="mini-preview-empty mini-preview-blocked"><strong>Module not published</strong><span>Home composition is configured, but this module still needs its own Publish action before it can appear publicly.</span></div>`;
  }
  if (!records.length) {
    return `<div class="mini-preview-empty"><strong>No public entries</strong><span>No Published + Visible entries are available for this generated section.</span></div>`;
  }
  const presentation = section.publicPresentation || section.composition?.publicPresentation || "cards";
  if (presentation === "timeline") {
    const shown = records.slice(0,4);
    return `<div class="mini-section-content"><div class="mini-timeline">${shown.map((entry) => `<div><i></i><span><strong>${escapePreview(miniCustomEntryTitle(entry))}</strong><small>${escapePreview([miniCustomEntryDate(section,entry),miniCustomEntryContext(section,entry)].filter(Boolean).join(" · "))}</small></span></div>`).join("")}</div>${miniOverflow(records.length,shown.length,"entries")}</div>`;
  }
  if (presentation === "media-gallery") {
    const shown = records.slice(0,5);
    return `<div class="mini-section-content"><div class="mini-gallery mini-gallery--categories">${shown.map((entry,index) => { const url=miniCustomEntryMedia(section,entry); return `<article class="mini-photo-category">${url?`<img src="${escapePreview(url)}" alt="">`:`<span class="mini-photo-category-empty">${index+1}</span>`}<b>${escapePreview(miniCustomEntryTitle(entry))}</b></article>`; }).join("")}</div>${miniOverflow(records.length,shown.length,"entries")}</div>`;
  }
  if (presentation === "list" || presentation === "text-section") {
    const shown = records.slice(0,5);
    return `<div class="mini-section-content"><div class="mini-credentials">${shown.map((entry) => `<article><span class="mini-credential-check">•</span><span><strong>${escapePreview(miniCustomEntryTitle(entry))}</strong><small>${escapePreview([miniCustomEntryDate(section,entry),miniCustomEntryContext(section,entry),miniCustomEntrySummary(entry)].filter(Boolean).join(" · "))}</small></span></article>`).join("")}</div>${miniOverflow(records.length,shown.length,"entries")}</div>`;
  }
  const shown = records.slice(0,5);
  return `<div class="mini-section-content"><div class="mini-project-grid">${shown.map((entry,index) => miniCustomCard(section,entry,index)).join("")}</div>${miniOverflow(records.length,shown.length,"entries")}</div>`;
}

let miniPortfolioRegistry = [];
let miniRefreshPromise = null;

function customPlacementOrder(placement, core = sections) {
  const orders=Object.fromEntries(core.map((item,index)=>[item.key,Number(item.order)||((index+1)*100)]));
  return placementOrder(placement,orders);
}

function customModulePreviewState(section = {}) {
  if (!section.setupComplete) return { label: "Pending setup", className: "pending" };
  if (section.publicEnabled === false) return { label: "Disabled preview", className: "hidden" };
  if (section.state === "hidden" || section.visible === false) return { label: "Hidden preview", className: "hidden" };
  if (section.status !== "published") return { label: "Not published", className: "draft" };
  const records = Array.isArray(modulePreviewData[section.key]) ? modulePreviewData[section.key] : [];
  if (!records.length) return { label: "No public entries", className: "pending" };
  return { label: section.lifecycle === "promoted" ? "Published · Promoted" : "Published", className: "published" };
}

function renderMiniPortfolioSections(registry = miniPortfolioRegistry) {
  if (registry?.length) miniPortfolioRegistry = registry;
  const host = $("miniPortfolioSections");
  if (!host) return;
  const core = sections.filter((section) => section.enabled && isPublicLayoutSectionKey(section.key)).map((section) => ({ ...section, isCustom: false }));
  const registeredKeys = registeredCustomSectionKeys();
  const registeredMap = registeredCustomSectionMap();
  const custom = (registry || []).filter((section) => registeredKeys.has(section.key)).filter((section) => section.enabled !== false).map((section, index) => {
    const homeState = registeredMap.get(section.key) || {};
    return {
      key: section.key,
      enabled: true,
      order: customPlacementOrder(section.placement, core) + (index / 100),
      titleOverride: section.title,
      subtitle: `${section.placement?.replace(/-/g, " ") || "after photo editing"}`,
      layoutMode: homeState.layoutMode || section.layoutMode || section.composition?.layoutMode || "auto",
      layoutPreset: homeState.layoutPreset || section.layoutPreset || section.composition?.layoutPreset || suggestPublicLayoutPreset({ key: section.key, presentation: section.publicPresentation || "cards" }),
      overflowMode: homeState.overflowMode || section.overflowMode || section.composition?.overflowMode || "auto",
      rowPairing: homeState.rowPairing || "none",
      rowPairingExplicit: true,
      rowPartnerKey: homeState.rowPartnerKey || "",
      publicPresentation: section.publicPresentation || "cards",
      isCustom: true,
      registry: section
    };
  });
  const composition = [...core, ...custom].sort((a,b) => a.order - b.order).map((section) => {
    const type = section.isCustom ? "feature" : miniPreviewType(section.key);
    const recordCount = section.isCustom ? (modulePreviewData[section.key]?.length || 0) : 1;
    const preferredPreset = resolvePublicLayoutPreset({key:section.key,presentation:section.publicPresentation||type,recordCount,layoutMode:section.layoutMode||"auto",layoutPreset:section.layoutPreset});
    return { ...section, type, recordCount, layoutMode:section.layoutMode||"auto", preset:preferredPreset, preferredPreset, content:"preview" };
  });
  const planned = planPublicLayoutRows(composition).flatMap((row) => row.items);
  host.innerHTML = planned.map((section) => {
    const title = escapePreview(section.titleOverride || sectionLabel(section.key, registry));
    const subtitle = escapePreview(section.subtitle || "Preview from its owner module");
    const state = section.isCustom ? customModulePreviewState(section.registry) : null;
    return `<section class="mini-module mini-module--${section.type}${section.isCustom ? " mini-module--custom" : ""} mini-layout-${section.finalPreset}" data-preview-preferred-layout="${escapePreview(section.preferredPreset)}" data-preview-key="${escapePreview(section.key)}"><div class="mini-module-heading"><div><h4>${title}</h4><p>${subtitle}</p></div>${state ? `<span class="mini-module-state is-${state.className}">${escapePreview(state.label)}</span>` : ""}</div>${section.isCustom ? miniCustomSectionBody(section.registry) : miniSectionBody(section.type, section.key)}</section>`;
  }).join("") || `<div class="mini-preview-empty"><strong>No homepage sections enabled</strong><span>Enable modules in the section canvas.</span></div>`;
  host.querySelectorAll(".mini-about-media img").forEach((image) => image.addEventListener("error", () => {
    failedAboutSource = image.getAttribute("src") || aboutImage;
    const frame = image.closest(".mini-about-media");
    image.remove();
    if (frame && !frame.querySelector(".lan-media-frame__empty")) frame.insertAdjacentHTML("beforeend", `<div class="lan-media-frame__empty"><span class="lan-media-frame__brand">LΛN</span><small class="lan-media-frame__label">About</small></div>`);
  }, { once:true }));
}

async function refreshMiniPortfolioPreview() {
  if (miniRefreshPromise) return miniRefreshPromise;
  miniRefreshPromise = (async () => {
    await loadMiniModuleData();
    await loadMiniCustomModuleData(miniPortfolioRegistry);
    renderMiniPortfolioSections(miniPortfolioRegistry);
  })().finally(() => { miniRefreshPromise = null; });
  return miniRefreshPromise;
}

function renderHomePreview() {
  const livePreview = document.querySelector(".home-composer__preview");
  if (!livePreview) return;
  livePreview.querySelector(".home-live-preview__brand").textContent = previewValue("brand", "LΛN");
  livePreview.querySelector(".home-live-preview__eyebrow").textContent = previewValue("eyebrow", "Hello, I’m");
  livePreview.querySelector(".home-live-preview__name").textContent = previewValue("displayName", "Rolando Lagmay Jr.");
  livePreview.querySelector(".home-live-preview__headline").textContent = previewValue("headline", "Information Technology Professional");
  livePreview.querySelector(".home-live-preview__roles").textContent = previewValue("roles", "Portfolio professional").split(",").map((role) => role.trim()).filter(Boolean).join(" · ");
  livePreview.querySelector(".home-live-preview__introduction").textContent = previewValue("introduction", "Your homepage introduction will appear here.");
  const actions = livePreview.querySelectorAll(".home-live-preview__actions span");
  if (actions[0]) actions[0].textContent = previewValue("primaryCtaLabel", "View my work");
  if (actions[1]) actions[1].textContent = previewValue("secondaryCtaLabel", "View resume");
  const image = livePreview.querySelector(".home-live-preview__portrait");
  const candidate = localPortraitUrl || $("portraitPreview")?.getAttribute("src") || portrait || "";
  const resolvedCandidate = resolveAdminMediaSource(candidate);
  const source = resolvedCandidate === failedPortraitSource ? "" : resolvedCandidate;
  if (image) {
    if (source) { image.src = source; image.alt = previewValue("portraitAlt", "Homepage portrait preview"); image.hidden = false; }
    else { image.removeAttribute("src"); image.alt = ""; image.hidden = true; }
    image.closest(".home-live-preview__portrait-wrap")?.classList.toggle("is-empty", !source);
  }
  const visible = $("homeVisible")?.checked !== false;
  const status = $("homeStatus")?.value || "published";
  $("homePreviewVisibility").textContent = visible ? "Hero visible" : "Hero hidden";
  $("homePreviewStatus").textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

function markHomeDirty() {
  const status = $("saveStatus");
  if (!status || status.textContent === "Loading…") return;
  status.textContent = "Unsaved changes";
  status.classList.remove("saved","error");
  status.classList.add("unsaved");
}

function coreSectionRow(section, registry = []) {
  return `<article class="section-composer-row" data-key="${escapePreview(section.key)}" data-section-kind="core"><span class="section-drag-handle" aria-hidden="true">⋮⋮</span><span class="section-module-icon" aria-hidden="true">${sectionIcon(section.key)}</span><div class="section-module-copy"><strong>${sectionLabel(section.key,registry)}</strong><small>Presentation only · owned by its module</small></div><span class="section-visibility">${section.enabled ? "Visible" : "Hidden"}</span><label class="section-switch"><span>Enabled</span><input class="section-enabled" type="checkbox" role="switch" ${section.enabled ? "checked" : ""}></label><label class="section-order-field">Order<input class="section-order" type="number" value="${section.order}"></label><div class="section-module-actions"><a class="editor-secondary-button button-compact" href="${sectionOwnerRoute(section.key,registry)}">Open owner</a><a class="editor-secondary-button button-compact" href="../../index.html#${encodeURIComponent(sectionPublicSlug(section.key,registry))}" target="_blank" rel="noopener">Preview</a></div><details class="section-quick-editor"><summary>Edit presentation</summary><div class="section-overrides"><label>Layout<select class="section-layout-preset">${layoutOptions(section.layoutPreset, section.key, sectionPresentation(section.key), section.layoutMode)}</select></label><label>Overflow<select class="section-overflow-mode">${overflowOptions(section.overflowMode || "auto")}</select></label><label>Row pairing<select class="section-row-pairing">${rowPairingOptions(section.rowPairing)}</select></label><label class="section-row-partner-field"${section.rowPairing === "manual" ? "" : " hidden"}>Partner<select class="section-row-partner" data-selected-partner="${escapePreview(section.rowPartnerKey || "")}"><option value="">Choose compatible section</option></select></label><small class="section-row-pairing-status" data-row-pairing-status></small></div></details></article>`;
}

function registeredSectionRow(section, registry = []) {
  const presentation = section.publicPresentation || suggestModulePublicPresentation(section);
  return `<article class="section-composer-row section-row--custom" data-key="${escapePreview(section.key)}" data-module-id="${escapePreview(section.id)}" data-section-kind="custom"><span class="section-drag-handle" aria-hidden="true">⋮⋮</span><span class="section-module-icon" aria-hidden="true">${sectionIcon(section.key)}</span><div class="section-module-copy"><strong>${escapePreview(section.title || section.key)}</strong><small>Registered custom section</small></div><span class="section-visibility">${section.publicEnabled ? "Visible" : "Hidden"}</span><label class="section-switch"><span>Enabled</span><input class="section-enabled" type="checkbox" role="switch" ${section.publicEnabled ? "checked" : ""}></label><div class="section-order-field section-placement-summary"><span>Placement</span><strong>${escapePreview(placementLabels[section.placement] || "After Photo Editing")}</strong></div><div class="section-module-actions"><a class="editor-secondary-button button-compact" href="${sectionOwnerRoute(section.key,registry)}">Open owner</a><a class="editor-secondary-button button-compact" href="../../index.html#${encodeURIComponent(sectionPublicSlug(section.key,registry))}" target="_blank" rel="noopener">Preview</a></div><details class="section-quick-editor"><summary>Edit presentation</summary><div class="section-overrides"><label>Placement<select class="section-placement">${placementOptions(section.placement)}</select></label><label>Layout<select class="section-layout-preset">${layoutOptions(section.layoutPreset, section.key, presentation, section.layoutMode, modulePreviewData[section.key]?.length || 0)}</select></label><label>Overflow<select class="section-overflow-mode">${overflowOptions(section.overflowMode || "auto")}</select></label><label>Row pairing<select class="section-row-pairing">${rowPairingOptions(section.rowPairing)}</select></label><label class="section-row-partner-field"${section.rowPairing === "manual" ? "" : " hidden"}>Partner<select class="section-row-partner" data-selected-partner="${escapePreview(section.rowPartnerKey || "")}"><option value="">Choose compatible section</option></select></label><label class="section-inline-switch"><span>Hide when empty</span><input class="section-hide-empty" type="checkbox" ${section.hideWhenEmpty !== false ? "checked" : ""}></label><label class="section-inline-switch"><span>Navigation link</span><input class="section-navigation" type="checkbox" ${section.navigationLink ? "checked" : ""}></label><small class="section-row-pairing-status" data-row-pairing-status></small></div></details></article>`;
}

async function renderSections(saved = [], registry = undefined) {
  // Reuse the snapshot during initial composition, but fetch fresh on later edits.
  registry = registry ?? await listSections().catch(() => []);
  const registryKeys = new Set(registry.map((section) => section.key));
  const savedCore = saved.filter((section) => !registryKeys.has(section.key));
  registeredCustomSections = saved
    .filter((section) => registryKeys.has(section.key))
    .map((section, index) => ({
      key: section.key,
      enabled: section.enabled !== false,
      order: Number(section.order) || (500 + index),
      layoutMode: section.layoutMode || "auto",
      layoutPreset: section.layoutPreset || defaultPublicLayoutPreset(section.key),
      overflowMode: section.overflowMode || "auto",
      rowPairing: section.rowPairing || "none",
      rowPairingExplicit: true,
      rowPartnerKey: section.rowPartnerKey || ""
    }));
  const all = [...new Set([...defaultSectionOrder, ...savedCore.map((section) => section.key)])];
  const map = new Map(savedCore.map((section) => [section.key, section]));
  sections = all.map((key,index) => ({
    key,
    enabled: map.get(key)?.enabled !== false,
    order: map.get(key)?.order || ((index + 1) * 100),
    layoutMode: map.get(key)?.layoutMode || "auto",
    layoutPreset: map.get(key)?.layoutPreset || defaultPublicLayoutPreset(key),
    overflowMode: map.get(key)?.overflowMode || "auto",
    rowPairing: map.get(key)?.rowPairing || "none",
    rowPairingExplicit: true,
    rowPartnerKey: map.get(key)?.rowPartnerKey || ""
  }));
  const registeredKeys = registeredCustomSectionKeys();
  const homeState = registeredCustomSectionMap();
  const registered = registry
    .filter((section) => registeredKeys.has(section.key))
    .map((section) => {
      const savedState = homeState.get(section.key) || {};
      return {
        ...section,
        layoutMode: savedState.layoutMode || section.layoutMode || "auto",
        layoutPreset: savedState.layoutPreset || section.layoutPreset,
        overflowMode: savedState.overflowMode || section.overflowMode || "auto",
        rowPairing: savedState.rowPairing || "none",
        rowPairingExplicit: true,
        rowPartnerKey: savedState.rowPartnerKey || ""
      };
    });
  const rows = [
    ...sections.map((section) => ({ kind:"core", order:Number(section.order)||0, section })),
    ...registered.map((section,index) => ({ kind:"custom", order:customPlacementOrder(section.placement, sections) + (index / 100), section }))
  ].sort((a,b) => a.order - b.order || sectionLabel(a.section.key, registry).localeCompare(sectionLabel(b.section.key, registry)));
  $("sectionComposer").innerHTML = rows.map((item) => item.kind === "custom" ? registeredSectionRow(item.section, registry) : coreSectionRow(item.section, registry)).join("");
  if (featureSections.length) renderFeatureSections(requestedModuleKey);
  refreshRowPartnerControls(registry);
  updateRowPairingFeedback(registry);
  renderMiniPortfolioSections(registry);
}
async function upload(fileInput, folder, setter) {
  const file = $(fileInput)?.files?.[0];
  if (!file) throw new Error("Choose an image first.");
  const result = await uploadImage(file, folder, () => {}, { access: "public-preview", context: { ownerType: "home", ownerId: "home", fieldId: folder.includes("about") ? "aboutImage" : "portrait", pageName: "Home", recordTitle: "Home" } });
  setter(result);
}

async function init() {
  try {
    $("saveStatus").textContent = "Loading…";
    const [data, contactData, registry] = await Promise.all([
      loadHome(),
      loadContact(),
      listSections().catch((error) => {
        console.warn("Homepage section registry could not load.", error);
        return [];
      })
    ]);
    fields.forEach((id) => {
      const element = $(id); if (!element) return;
      if (element.type === "checkbox") element.checked = id === "homeVisible" ? data.visible !== false : data[id] !== false;
      else if (id === "roles") element.value = (data.roles || []).join(", ");
      else if (id === "homeStatus" && window.LANSetSelectValue) window.LANSetSelectValue(element, data.status || "published", "published");
      else if (id === "homeStatus") element.value = data.status || "published";
      else element.value = data[id] ?? "";
    });
    portrait = data.portrait || "";
    aboutImage = data.aboutImage || "";
    failedPortraitSource = ""; failedAboutSource = "";
    setImage("portraitPreview", portrait);
    setImage("aboutImagePreview", aboutImage);
    setUploadStatus("portraitUploadStatus", portrait ? "Current image" : "No portrait uploaded yet.", portrait ? "success" : "ready");
    setUploadStatus("aboutUploadStatus", aboutImage ? "Current image" : "No homepage About image uploaded yet.", aboutImage ? "success" : "ready");
    // Both preview owners load in parallel; they merge distinct keys without clobbering data.
    await Promise.all([loadMiniModuleData(contactData), loadMiniCustomModuleData(registry)]);
    featureSections = registry;
    await renderSections(data.sections || [], registry);
    const contactMethods = Array.isArray(contactData.methods)
      ? contactData.methods.filter((method) => method && method.visible !== false && (method.value || method.url))
      : [];
    const contactMethodLabels = contactMethods
      .filter((method) => !["phone","github","linkedin","facebook"].includes(String(method.type || "").toLowerCase()))
      .slice(0,3)
      .map((method) => method.label || method.type);
    $("contactSummary").textContent = [
      contactData.email,
      contactData.phone,
      contactData.location,
      contactData.availability,
      ...contactMethodLabels
    ].filter(Boolean).join(" · ") || "No Contact values published.";
    $("saveStatus").textContent = "Ready";
    $("saveStatus").classList.remove("unsaved","error","saved");
    const publication = $("headerPublicationState");
    if (publication) {
      const isPublic = (data.status || "published") === "published" && data.visible !== false;
      publication.textContent = isPublic ? "Published · Visible" : "Draft / hidden";
      publication.dataset.status = isPublic ? "saved" : "warning";
      publication.setAttribute("aria-label", publication.textContent);
      publication.title = publication.textContent;
    }
    renderHomePreview();
  } catch (error) {
    console.error(error); note("Unable to load Homepage Composer.","error");
  }
}

// Home / Studio composes generated modules. Creation, schema, entries and lifecycle belong to Custom Modules.
const requestedModuleKey = new URLSearchParams(location.search).get("module") || "";
let featureSections = [];
const placementLabels = Object.freeze({
  "after-experience": "After Experience", "before-projects": "Before Projects", "after-projects": "After Projects",
  "before-photo-editing": "Before Photo Editing", "after-photo-editing": "After Photo Editing", "before-education": "Before Education",
  "after-education": "After Education", "before-contact": "Before Contact"
});

const publicLayoutLabels = Object.freeze({
  "compact-full":"Compact Full",
  "standard-half":"Standard Half",
  "tall-half":"Tall Half",
  "tall-narrow":"Tall Narrow",
  "tall-wide":"Tall Wide",
  "standard-full":"Standard Full",
  "large-full":"Large Full"
});
const overflowChoices = Object.freeze([["auto","Automatic"],["vertical","Vertical"],["horizontal","Horizontal"],["show-more","Show more"],["natural","Natural"]]);
const rowPairingChoices = Object.freeze([["none","None / Unpaired"],["auto","Automatic"],["manual","Choose section"]]);
const optionList = (choices, selected = "auto") => choices.map(([value,label]) => `<option value="${value}"${value===selected?' selected':''}>${label}</option>`).join("");
const sectionPresentation = (key = "") => ({about:"text-section",experience:"timeline",projects:"carousel","photo-editing":"media-gallery",education:"list",certificates:"list",contact:"cta-contact"})[key] || "list";
const layoutOptions = (selected = "", key = "", presentation = "", layoutMode = "auto", recordCount = 0) => {
  const recommended = suggestPublicLayoutPreset({ key, presentation: presentation || sectionPresentation(key), recordCount });
  const automatic = layoutMode !== "manual";
  const current = selected || defaultPublicLayoutPreset(key) || recommended;
  const choices = compatiblePublicLayoutPresets({ key, presentation: presentation || sectionPresentation(key) });
  const values = choices.includes(current) ? choices : [current, ...choices];
  return [`<option value="auto"${automatic?' selected':''}>Automatic · ${publicLayoutLabels[recommended] || recommended}</option>`, ...values.map((value) => `<option value="${value}"${!automatic&&value===current?' selected':''}>${publicLayoutLabels[value] || value}${value===recommended?' · Recommended':''}</option>`)].join("");
};
const overflowOptions = (selected = "auto") => optionList(overflowChoices, selected);
const rowPairingOptions = (selected = "none") => optionList(rowPairingChoices, selected);

const placementOptions = (selected = "after-photo-editing") => Object.entries(placementLabels).map(([value,label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
const publicPresentationChoices = Object.freeze([
  ["cards", "Cards"],
  ["timeline", "Timeline"],
  ["media-gallery", "Gallery"],
  ["list", "List"],
  ["carousel", "Carousel"],
  ["rich-showcase", "Showcase"],
  ["featured-grid", "Featured + Grid"]
]);
const presentationLabel = (value = "cards") => publicPresentationChoices.find(([key]) => key === value)?.[1] || String(value || "cards").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
function publicPresentationOptions(item = {}) {
  const recommended = suggestModulePublicPresentation(item);
  const automatic = item.publicPresentationMode !== "manual";
  const selected = automatic ? "auto" : (item.publicPresentation || recommended);
  const values = new Set(publicPresentationChoices.map(([value]) => value));
  const options = [`<option value="auto"${selected === "auto" ? " selected" : ""}>Automatic · ${escapePreview(presentationLabel(recommended))}</option>`];
  options.push(...publicPresentationChoices.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}${value === recommended ? " · Recommended" : ""}</option>`));
  if (selected !== "auto" && selected && !values.has(selected)) options.unshift(`<option value="${escapePreview(selected)}" selected>${escapePreview(presentationLabel(selected))} · Current</option>`);
  return options.join("");
}

function composedSectionItems(registry = featureSections) {
  const core = sections.filter((section) => section.enabled && isPublicLayoutSectionKey(section.key)).map((section) => ({
    key: section.key,
    title: sectionLabel(section.key, registry),
    order: Number(section.order) || 0,
    layoutMode: section.layoutMode || "auto",
    layoutPreset: resolvePublicLayoutPreset({ key:section.key, presentation:sectionPresentation(section.key), recordCount:1, layoutMode:section.layoutMode || "auto", layoutPreset:section.layoutPreset || defaultPublicLayoutPreset(section.key) }),
    rowPairing: section.rowPairing || "none",
    rowPairingExplicit: true,
    rowPartnerKey: section.rowPartnerKey || ""
  }));
  const registeredKeys = registeredCustomSectionKeys();
  const registeredMap = registeredCustomSectionMap();
  const custom = (registry || []).filter((section) => registeredKeys.has(section.key)).map((section,index) => ({
    key: section.key,
    title: section.title || section.key,
    order: customPlacementOrder(section.placement, sections) + (index / 100),
    layoutMode: registeredMap.get(section.key)?.layoutMode || section.layoutMode || section.composition?.layoutMode || "auto",
    layoutPreset: resolvePublicLayoutPreset({ key:section.key, presentation:section.publicPresentation || "cards", recordCount:modulePreviewData[section.key]?.length || 0, layoutMode:registeredMap.get(section.key)?.layoutMode || section.layoutMode || section.composition?.layoutMode || "auto", layoutPreset:registeredMap.get(section.key)?.layoutPreset || section.layoutPreset || section.composition?.layoutPreset }),
    rowPairing: registeredMap.get(section.key)?.rowPairing || "none",
    rowPairingExplicit: true,
    rowPartnerKey: registeredMap.get(section.key)?.rowPartnerKey || ""
  }));
  return [...core, ...custom].sort((a,b) => a.order - b.order || a.title.localeCompare(b.title));
}

function compatibleAdjacentPartners(items, index) {
  const item = items[index];
  if (!item || publicLayoutSpan(item.layoutPreset).columns >= 12) return [];
  return [items[index - 1], items[index + 1]].filter((candidate) => candidate
    && publicLayoutSpan(candidate.layoutPreset).columns < 12
    && canPairPublicLayoutPresets(item.layoutPreset, candidate.layoutPreset));
}

function refreshRowPartnerControls(registry = featureSections) {
  const items = composedSectionItems(registry);
  const byKey = new Map(items.map((item,index) => [item.key,{ item,index }]));
  document.querySelectorAll('.section-composer-row').forEach((row) => {
    const mode = row.querySelector('.section-row-pairing');
    const field = row.querySelector('.section-row-partner-field');
    const select = row.querySelector('.section-row-partner');
    if (!mode || !field || !select) return;
    field.hidden = mode.value !== 'manual';
    const found = byKey.get(row.dataset.key);
    const selected = select.dataset.selectedPartner || select.value || found?.item?.rowPartnerKey || '';
    const candidates = found ? compatibleAdjacentPartners(items, found.index) : [];
    select.innerHTML = `<option value="">Choose compatible section</option>${candidates.map((candidate) => `<option value="${escapePreview(candidate.key)}"${candidate.key === selected ? ' selected' : ''}>${escapePreview(candidate.title)}</option>`).join('')}`;
    if (selected && !candidates.some((candidate) => candidate.key === selected)) {
      select.insertAdjacentHTML('beforeend', `<option value="${escapePreview(selected)}" selected disabled>Unavailable in current order</option>`);
    }
    select.dataset.selectedPartner = selected;
    select.disabled = mode.value !== 'manual';
  });
}

function updateRowPairingFeedback(registry = featureSections) {
  const items = composedSectionItems(registry);
  const planned = planPublicLayoutRows(items.map((item) => ({ ...item, preset:item.layoutPreset, content:"preview" })));
  const plannedByKey = new Map(planned.flatMap((plannedRow) => plannedRow.items.map((item) => [item.key, plannedRow])));
  const byKey = new Map(items.map((item,index) => [item.key,{ item,index }]));
  document.querySelectorAll('.section-composer-row').forEach((row) => {
    const status = row.querySelector('[data-row-pairing-status]');
    if (!status) return;
    const found = byKey.get(row.dataset.key);
    if (!found) { status.textContent = 'Disabled sections are not part of the active row composition.'; return; }
    const { item,index } = found;
    const span = publicLayoutSpan(item.layoutPreset);
    if (span.columns >= 12) { status.textContent = 'Full-width layout starts its own row.'; return; }
    const pairing = row.querySelector('.section-row-pairing')?.value || item.rowPairing || 'none';
    if (pairing === 'none') { status.textContent = 'Unpaired. The other half remains reserved until you choose a partner.'; return; }
    const plannedRow = plannedByKey.get(item.key);
    const partner = plannedRow?.items?.length === 2 ? plannedRow.items.find((candidate) => candidate.key !== item.key) : null;
    if (pairing === 'auto') {
      status.textContent = partner ? `Automatically sharing row with: ${partner.title || partner.key}` : 'Automatic is waiting for another compatible section also set to Automatic.';
      return;
    }
    const selectedKey = row.querySelector('.section-row-partner')?.value || item.rowPartnerKey || '';
    if (!selectedKey) { status.textContent = 'Choose a compatible adjacent section to share this row.'; return; }
    const candidate = compatibleAdjacentPartners(items,index).find((entry) => entry.key === selectedKey);
    status.textContent = partner ? `Sharing row with: ${partner.title || partner.key}` : candidate ? `Pair with ${candidate.title} to complete the row.` : 'Selected partner is no longer compatible or adjacent.';
  });
}

function registryState(item = {}) { if (item.lifecycle === "promoted") return {label:"Promoted",tone:"published"}; if (!item.setupComplete) return {label:"Building",tone:"pending"}; return {label:"Testing",tone:"draft"}; }
function stagingCompositionPatch(item, card) {
  const presentationControl = card.querySelector('[data-module-presentation]');
  const automaticPresentation = presentationControl.value === 'auto';
  const layoutControl = card.querySelector('[data-module-layout]');
  const automaticLayout = layoutControl.value === 'auto';
  const resolvedPresentation = automaticPresentation ? suggestModulePublicPresentation(item) : presentationControl.value;
  return {
    publicEnabled: card.querySelector('[data-module-public]').checked,
    hideWhenEmpty: card.querySelector('[data-module-hide-empty]').checked,
    publicPresentationMode: automaticPresentation ? 'auto' : 'manual',
    publicPresentation: resolvedPresentation,
    layoutMode: automaticLayout ? 'auto' : 'manual',
    layoutPreset: automaticLayout ? suggestPublicLayoutPreset({ key:item.key, presentation:resolvedPresentation, recordCount:0 }) : layoutControl.value,
    overflowMode: card.querySelector('[data-module-overflow]').value,
    navigationLink: card.querySelector('[data-module-navigation]').checked
  };
}

function renderFeatureSections(selectedKey = "") {
  const host = $("sectionList"); if (!host) return;
  const registeredKeys = registeredCustomSectionKeys();
  const staged = featureSections.filter((item) => !registeredKeys.has(item.key));
  if (!staged.length) { host.innerHTML = '<div class="feature-empty"><span aria-hidden="true">✦</span><strong>No staged custom sections</strong><p>New Custom Modules appear here until you add them to the Home Sections canvas.</p><a class="editor-secondary-button" href="module.html">Open Custom Modules</a></div>'; return; }
  host.innerHTML = staged.map(item => {
    const state = registryState(item);
    return `<article class="manager-card module-registry-card${item.key===selectedKey?' is-selected':''}" data-module-card="${escapePreview(item.id)}">
      <div class="module-registry-card-head"><div><strong>${escapePreview(item.title)}</strong><small>${escapePreview(item.key)} · ${escapePreview(presentationLabel(item.publicPresentation || 'cards'))}</small></div><span class="module-registry-status is-${state.tone}">${state.label}</span></div>
      <section class="module-composition-primary" aria-label="Public composition basics">
        <div class="module-composition-section-head"><div><strong>Section staging</strong><small>Prepare this generated page before adding it to the Home Sections canvas.</small></div></div>
        <div class="module-composition-switches lan-admin-form-grid">
          <label class="studio-switch"><span><strong>Public section</strong><small>Becomes effective after Add to Sections.</small></span><input data-module-public type="checkbox"${item.publicEnabled?' checked':''}></label>
          <label class="studio-switch"><span><strong>Hide when empty</strong><small>No eligible entries = no public section.</small></span><input data-module-hide-empty type="checkbox"${item.hideWhenEmpty!==false?' checked':''}></label>
          <label class="studio-switch"><span><strong>Navigation link</strong><small>Optional top navigation item after registration.</small></span><input data-module-navigation type="checkbox"${item.navigationLink?' checked':''}></label>
        </div>
        <div class="module-composition-public-controls module-composition-public-controls--staging lan-admin-form-grid">
          <label class="module-composition-presentation">Public presentation<select data-module-presentation>${publicPresentationOptions(item)}</select></label>
          <small class="module-composition-recommendation">Automatic follows the module blueprint. Recommended now: ${escapePreview(presentationLabel(suggestModulePublicPresentation(item)))}.</small>
        </div>
      </section>
      <section class="module-composition-layout-controls" aria-label="Adaptive public layout">
        <div><strong>Adaptive layout</strong><small>Choose the starting geometry; placement is chosen after this page enters Sections.</small></div>
        <label>Layout<select data-module-layout>${layoutOptions(item.layoutPreset, item.key, item.publicPresentation || suggestModulePublicPresentation(item), item.layoutMode || item.composition?.layoutMode || "auto")}</select></label>
        <label>Overflow<select data-module-overflow>${overflowOptions(item.overflowMode || "auto")}</select></label>
        <small class="module-composition-layout-recommendation">Automatic recommendation: ${escapePreview(suggestPublicLayoutPreset({key:item.key,presentation:item.publicPresentation,recordCount:0}))}.</small>
      </section>
      <div class="manager-card-actions module-registry-actions module-registry-actions--staging"><a class="editor-secondary-button button-compact" href="module.html?section=${encodeURIComponent(item.key)}">Open Module</a><button class="editor-secondary-button button-compact" data-save-composition="${escapePreview(item.id)}" type="button">Save setup</button><button class="editor-primary-button button-compact" data-add-to-sections="${escapePreview(item.id)}" type="button">Add to Sections</button></div>
    </article>`;
  }).join("");
  host.querySelectorAll('[data-save-composition]').forEach(button => button.addEventListener('click', async()=>{
    const item=featureSections.find(x=>x.id===button.dataset.saveComposition);
    const card=button.closest('[data-module-card]'); if(!item||!card)return;
    try { button.disabled=true; await updateSectionRegistry(item.id, stagingCompositionPatch(item,card)); await refreshFutureFeatures(item.key); note('Staging composition saved.'); }
    catch(error){ note(error.message,'error'); } finally { button.disabled=false; }
  }));
  host.querySelectorAll('[data-add-to-sections]').forEach(button => button.addEventListener('click', async()=>{
    const item=featureSections.find(x=>x.id===button.dataset.addToSections);
    const card=button.closest('[data-module-card]'); if(!item||!card)return;
    try {
      button.disabled=true;
      const stagingPatch = stagingCompositionPatch(item,card);
      await updateSectionRegistry(item.id, stagingPatch);
      const existing = registeredCustomSectionMap().get(item.key);
      if (!existing) {
        registeredCustomSections.push({
          key: item.key,
          enabled: true,
          order: customPlacementOrder(item.placement, sections),
          layoutMode: stagingPatch.layoutMode || "auto",
          layoutPreset: stagingPatch.layoutPreset || item.layoutPreset || defaultPublicLayoutPreset(item.key),
          overflowMode: stagingPatch.overflowMode || item.overflowMode || "auto",
          rowPairing: "none", rowPairingExplicit: true, rowPartnerKey: ""
        });
      }
      registeredCustomSections = await saveHomeSections(combinedHomeSections()).then((saved) => saved.filter((section) => registeredCustomSectionKeys().has(section.key)));
      await refreshFutureFeatures();
      await renderSections(combinedHomeSections());
      window.dispatchEvent(new CustomEvent('lan:portfolio-sections-updated'));
      document.querySelector('[data-lan-tab="sections"]')?.click();
      note(`${item.title || 'Custom page'} added to Home Sections.`);
    } catch(error) { note(error.message,'error'); }
    finally { button.disabled=false; }
  }));
}

async function refreshFutureFeatures(selectedKey = "") { featureSections = await listSections(); await loadMiniCustomModuleData(featureSections); renderFeatureSections(selectedKey); renderMiniPortfolioSections(featureSections); refreshRowPartnerControls(featureSections); updateRowPairingFeedback(featureSections); }

function syncSectionsFromDom() {
  sections = [...document.querySelectorAll('.section-composer-row[data-section-kind="core"]')].map((row) => {
    const layoutControl = row.querySelector('.section-layout-preset');
    const automaticLayout = layoutControl?.value === 'auto';
    const rowPairing = row.querySelector('.section-row-pairing')?.value || 'none';
    return {
      key: row.dataset.key,
      enabled: row.querySelector('.section-enabled').checked,
      order: Number(row.querySelector('.section-order').value) || 0,
      layoutMode: automaticLayout ? 'auto' : 'manual',
      layoutPreset: automaticLayout ? suggestPublicLayoutPreset({ key:row.dataset.key, presentation:sectionPresentation(row.dataset.key), recordCount:1 }) : (layoutControl?.value || defaultPublicLayoutPreset(row.dataset.key)),
      overflowMode: row.querySelector('.section-overflow-mode')?.value || 'auto',
      rowPairing,
      rowPairingExplicit: true,
      rowPartnerKey: rowPairing === 'manual' ? (row.querySelector('.section-row-partner')?.value || row.querySelector('.section-row-partner')?.dataset.selectedPartner || '') : ''
    };
  });
  document.querySelectorAll('.section-composer-row[data-section-kind="core"]').forEach((row) => {
    const enabled = row.querySelector('.section-enabled').checked;
    row.querySelector('.section-visibility').textContent = enabled ? 'Visible' : 'Hidden';
  });
}

function syncRegisteredSectionsFromDom() {
  const current = registeredCustomSectionMap();
  registeredCustomSections = [...document.querySelectorAll('.section-composer-row[data-section-kind="custom"]')].map((row) => {
    const existing = current.get(row.dataset.key) || { key:row.dataset.key, enabled:true, order:500 };
    const item = featureSections.find((section) => section.id === row.dataset.moduleId || section.key === row.dataset.key);
    const layoutControl = row.querySelector('.section-layout-preset');
    const automaticLayout = layoutControl?.value === 'auto';
    const presentation = item?.publicPresentation || suggestModulePublicPresentation(item || {});
    const rowPairing = row.querySelector('.section-row-pairing')?.value || 'none';
    return {
      ...existing,
      key: row.dataset.key,
      enabled: row.querySelector('.section-enabled')?.checked !== false,
      layoutMode: automaticLayout ? 'auto' : 'manual',
      layoutPreset: automaticLayout ? suggestPublicLayoutPreset({ key:row.dataset.key, presentation, recordCount:modulePreviewData[row.dataset.key]?.length || 0 }) : (layoutControl?.value || existing.layoutPreset || defaultPublicLayoutPreset(row.dataset.key)),
      overflowMode: row.querySelector('.section-overflow-mode')?.value || existing.overflowMode || 'auto',
      rowPairing,
      rowPairingExplicit: true,
      rowPartnerKey: rowPairing === 'manual' ? (row.querySelector('.section-row-partner')?.value || row.querySelector('.section-row-partner')?.dataset.selectedPartner || '') : ''
    };
  });
}

function clearReciprocalPair(key = '', partnerKey = '') {
  if (!key || !partnerKey) return;
  const partnerRow = document.querySelector(`.section-composer-row[data-key="${CSS.escape(partnerKey)}"]`);
  if (!partnerRow) return;
  const partnerSelect = partnerRow.querySelector('.section-row-partner');
  if (partnerSelect?.value !== key && partnerSelect?.dataset.selectedPartner !== key) return;
  const partnerMode = partnerRow.querySelector('.section-row-pairing');
  if (partnerMode) partnerMode.value = 'none';
  if (partnerSelect) { partnerSelect.value = ''; partnerSelect.dataset.selectedPartner = ''; }
}

function applyPairingControlChange(row, target) {
  const key = row.dataset.key;
  const mode = row.querySelector('.section-row-pairing');
  const partner = row.querySelector('.section-row-partner');
  if (!mode || !partner) return;
  const previousPartner = partner.dataset.selectedPartner || '';
  if (target.matches('.section-row-pairing')) {
    if (mode.value !== 'manual') {
      clearReciprocalPair(key, previousPartner);
      partner.value = '';
      partner.dataset.selectedPartner = '';
    }
  } else if (target.matches('.section-row-partner')) {
    if (previousPartner && previousPartner !== partner.value) clearReciprocalPair(key, previousPartner);
    partner.dataset.selectedPartner = partner.value;
    if (partner.value) {
      mode.value = 'manual';
      const partnerRow = document.querySelector(`.section-composer-row[data-key="${CSS.escape(partner.value)}"]`);
      const partnerMode = partnerRow?.querySelector('.section-row-pairing');
      const partnerSelect = partnerRow?.querySelector('.section-row-partner');
      if (partnerMode && partnerSelect) {
        clearReciprocalPair(partner.value, partnerSelect.dataset.selectedPartner || partnerSelect.value || '');
        partnerMode.value = 'manual';
        partnerSelect.dataset.selectedPartner = key;
        partnerSelect.value = key;
      }
    }
  }
}

function previewSelectedFile(inputId, previewId, statusId, kind) {
  const input = $(inputId); const preview = $(previewId);
  if (!input || !preview) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0]; if (!file) return;
    if (!file.type.startsWith("image/")) { setUploadStatus(statusId,"Choose a supported image file.","error"); input.value=""; return; }
    const objectUrl = URL.createObjectURL(file);
    if (kind === "portrait") { if (localPortraitUrl) URL.revokeObjectURL(localPortraitUrl); localPortraitUrl = objectUrl; failedPortraitSource=""; }
    else { if (localAboutUrl) URL.revokeObjectURL(localAboutUrl); localAboutUrl = objectUrl; failedAboutSource=""; }
    setImage(previewId,objectUrl); setUploadStatus(statusId,`${file.name} · ready to upload`,"ready"); markHomeDirty(); renderHomePreview(); renderMiniPortfolioSections();
  });
}

$("homeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (window.LANValidateForm ? !window.LANValidateForm($("homeForm"), { title: "Complete Homepage" }) : !$("homeForm").reportValidity()) return;
  const button = $("saveHomeButton");
  try {
    button.disabled = true;
    const data = {};
    fields.forEach((id) => {
      const element = $(id);
      if (id === "homeVisible") data.visible = element.checked;
      else if (element.type === "checkbox") data[id] = element.checked;
      else if (id === "homeStatus") data.status = element.value;
      else if (id === "roles") data.roles = element.value.split(",").map((value) => value.trim()).filter(Boolean);
      else data[id] = element.value;
    });
    syncSectionsFromDom();
    syncRegisteredSectionsFromDom();
    data.portrait = portrait; data.aboutImage = aboutImage; data.sections = combinedHomeSections();
    await saveHome(data);
    if (window.parent !== window) {
      window.parent.dispatchEvent(new CustomEvent("lan:admin-home-portrait-saved", {
        detail: { portrait: resolveAdminMediaSource(data.portrait) }
      }));
    }
    $("saveStatus").textContent = "Saved"; $("saveStatus").classList.remove("unsaved","error"); $("saveStatus").classList.add("saved");
    note("Homepage presentation saved.");
  } catch (error) { note(error.message,"error"); }
  finally { button.disabled = false; }
});

$("uploadPortraitButton").addEventListener("click", async () => {
  const button = $("uploadPortraitButton");
  try { button.disabled=true; const previousPortrait = portrait; setUploadStatus("portraitUploadStatus","Uploading portrait…","loading"); await upload("portraitFile","home",(url)=>{portrait=url;if(localPortraitUrl)URL.revokeObjectURL(localPortraitUrl);localPortraitUrl="";failedPortraitSource="";setImage("portraitPreview",url)}); setUploadStatus("portraitUploadStatus","Portrait ready · Save Homepage to publish.","success"); markHomeDirty(); renderHomePreview(); await discardTemporaryMediaAssets(previousPortrait, { reason: "home-temp-portrait-replaced" }); note("Portrait uploaded. Save to publish."); }
  catch(error){setUploadStatus("portraitUploadStatus",error.message,"error");note(error.message,"error")} finally{button.disabled=false}
});

$("uploadAboutImageButton").addEventListener("click", async () => {
  const button = $("uploadAboutImageButton");
  try { button.disabled=true; const previousAboutImage = aboutImage; setUploadStatus("aboutUploadStatus","Uploading image…","loading"); await upload("aboutImageFile","home/about",(url)=>{aboutImage=url;if(localAboutUrl)URL.revokeObjectURL(localAboutUrl);localAboutUrl="";failedAboutSource="";setImage("aboutImagePreview",url)}); setUploadStatus("aboutUploadStatus","About image uploaded. Save Homepage to publish.","success"); markHomeDirty(); renderMiniPortfolioSections(); await discardTemporaryMediaAssets(previousAboutImage, { reason: "home-temp-about-image-replaced" }); note("About image uploaded. Save to publish."); }
  catch(error){setUploadStatus("aboutUploadStatus",error.message,"error");note(error.message,"error")} finally{button.disabled=false}
});

$("removeAboutImageButton").addEventListener("click", async () => { await discardTemporaryMediaAssets(aboutImage, { reason: "home-temp-about-image-removed" }); aboutImage=""; if(localAboutUrl)URL.revokeObjectURL(localAboutUrl);localAboutUrl="";$("aboutImageFile").value="";setImage("aboutImagePreview","");setUploadStatus("aboutUploadStatus","Homepage About image removed. Save Homepage to publish.","ready");markHomeDirty();renderMiniPortfolioSections(); });
$("removePortraitPreviewButton").addEventListener("click", () => { if(localPortraitUrl)URL.revokeObjectURL(localPortraitUrl);localPortraitUrl="";$("portraitFile").value="";setImage("portraitPreview",portrait);setUploadStatus("portraitUploadStatus",portrait ? "Current image" : "No portrait uploaded yet.",portrait ? "success" : "ready");renderHomePreview(); });
$("initializeHomeButton").addEventListener("click", init);

previewSelectedFile("portraitFile","portraitPreview","portraitUploadStatus","portrait");
previewSelectedFile("aboutImageFile","aboutImagePreview","aboutUploadStatus","about");

$("homeForm").addEventListener("input", () => { markHomeDirty(); renderHomePreview(); });
$("homeForm").addEventListener("change", () => { markHomeDirty(); renderHomePreview(); });
$("sectionComposer").addEventListener("change", async (event) => {
  const row = event.target.closest('.section-composer-row');
  if (!row) return;
  applyPairingControlChange(row, event.target);
  markHomeDirty();
  try {
    if (row.dataset.sectionKind === 'custom') {
      const item = featureSections.find((section) => section.id === row.dataset.moduleId);
      if (!item) throw new Error('This registered custom section is no longer available.');
      const layoutControl = row.querySelector('.section-layout-preset');
      const automaticLayout = layoutControl?.value === 'auto';
      const resolvedPresentation = item.publicPresentation || suggestModulePublicPresentation(item);
      const resolvedLayoutPreset = automaticLayout
        ? suggestPublicLayoutPreset({ key:item.key, presentation:resolvedPresentation, recordCount:modulePreviewData[item.key]?.length || 0 })
        : (layoutControl?.value || item.layoutPreset);
      await updateSectionRegistry(item.id, {
        publicEnabled: row.querySelector('.section-enabled').checked,
        hideWhenEmpty: row.querySelector('.section-hide-empty')?.checked !== false,
        placement: row.querySelector('.section-placement')?.value || item.placement,
        layoutMode: automaticLayout ? 'auto' : 'manual',
        layoutPreset: resolvedLayoutPreset,
        overflowMode: row.querySelector('.section-overflow-mode')?.value || 'auto',
        navigationLink: row.querySelector('.section-navigation')?.checked === true
      });
    }

    syncSectionsFromDom();
    syncRegisteredSectionsFromDom();
    const savedHomeSections = await saveHomeSections(combinedHomeSections());
    const registeredKeys = registeredCustomSectionKeys();
    registeredCustomSections = savedHomeSections.filter((section) => registeredKeys.has(section.key));
    sections = savedHomeSections.filter((section) => !registeredKeys.has(section.key));
    if (row.dataset.sectionKind === 'custom') await refreshFutureFeatures();
    await renderSections(combinedHomeSections());

    const refreshedRow = document.querySelector(`.section-composer-row[data-key="${CSS.escape(row.dataset.key)}"]`);
    refreshedRow?.querySelector('.section-visibility')?.classList.add('is-saved');
    window.setTimeout(() => refreshedRow?.querySelector('.section-visibility')?.classList.remove('is-saved'), 700);
    $('saveStatus').textContent = 'Saved';
    $('saveStatus').classList.remove('unsaved','error');
    $('saveStatus').classList.add('saved');
  } catch (error) {
    note(error.message || 'Section presentation could not be saved.', 'error');
  }
});

$("portraitPreview")?.addEventListener("error", () => { failedPortraitSource=$("portraitPreview").getAttribute("src")||portrait;setImage("portraitPreview","");renderHomePreview(); }, { passive:true });
$("aboutImagePreview")?.addEventListener("error", () => { failedAboutSource=$("aboutImagePreview").getAttribute("src")||aboutImage;setImage("aboutImagePreview","");renderMiniPortfolioSections(); }, { passive:true });
document.querySelector(".home-live-preview__portrait")?.addEventListener("error", (event) => { failedPortraitSource=event.currentTarget.getAttribute("src")||portrait;event.currentTarget.removeAttribute("src");event.currentTarget.hidden=true;event.currentTarget.closest(".home-live-preview__portrait-wrap")?.classList.add("is-empty"); }, { passive:true });

await init();
if (location.hash === "#future-portfolio-features" || requestedModuleKey) {
  requestAnimationFrame(() => document.querySelector('[data-lan-tab="future"]')?.click());
}
renderHomePreview();

let lastMiniRefresh = Date.now();
async function refreshMiniWhenReturning() {
  if (document.hidden || Date.now() - lastMiniRefresh < 700) return;
  lastMiniRefresh = Date.now();
  await refreshMiniPortfolioPreview().catch((error) => console.warn("Homepage live preview refresh failed.", error));
}
window.addEventListener("focus", refreshMiniWhenReturning);
window.addEventListener("pageshow", refreshMiniWhenReturning);
document.addEventListener("visibilitychange", refreshMiniWhenReturning);

