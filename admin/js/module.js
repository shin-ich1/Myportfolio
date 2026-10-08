await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));

import {
  deleteEntry, duplicateEntry, getSection, listSections, listEntries, listRelationshipEntries, listRelationshipModules,
  registerSection, reserveEntryId, saveEntry, saveSection, updateSectionRegistry
} from "../services/portfolioSectionService.js";
import { uploadMedia } from "../services/storageUploadService.js";
import { mountStorageFieldControl } from "./storage-field-control.js";
import { discardTemporaryMediaAssets, isTemporaryMediaAsset, removeManagedMediaAssets } from "../services/mediaAssetLifecycleService.js";
import { stageLocalMediaFile, releaseLocalMediaSelection } from "../services/pendingMediaSelectionService.js";
import { loadSkills, ensureCapabilityByName } from "../services/skillService.js";
import { definitionKey, resolveSmartDefinitionKey } from "./module-definition-key.js";
import { moduleStudioTabs, moduleEntryStudioProfile, moduleRecordBulkCapabilities, moduleFieldEditorProfile, moduleFieldPreviewRole, resolveModuleFieldSemanticRole, resolveModulePrimaryMediaFieldForRecord, moduleDateFieldProfile, modulePublicCompositionState, modulePublicEligibility, fieldHelperText, isCoreEntryPropertyKey, CORE_ENTRY_PROPERTIES, CUSTOM_MODULE_FIELD_TYPES, moduleSlug, moduleCategoryEntryState, resolveModuleEntryCategory, moduleTimelineProfile, moduleTimelineEntryMeta, resolveModuleAdminWorkspace, OTHER_CATEGORY_VALUE } from "../../module-platform.js";
import { classifyPortfolioFile, fieldAcceptForSchema, validatePortfolioFileDescriptor } from "../../file-type-registry.js";
import { getSystemIconMeta, NAVIGATION_ICON_MAP, renderSystemIcon, resolveModuleAdminIcon, SYSTEM_ICON_CATALOG } from "../../icon-registry.js";
import { evaluateModuleChecks, selectModuleChecks, summarizeModuleChecks } from "../../module-validation.js";
import { evaluateModuleMaturity, structuralFingerprint } from "../../module-maturity.js";
import { evaluateAutomaticPromotion, recordModuleMaturityHydration, recordModuleRuntimeFailure } from "../services/moduleLifecycleService.js";
import { ADMIN_PREVIEW_BLOCK_TYPES, renderAdminPreview } from "./admin-preview.js";
import { createAdminRecordWorkspaceController } from "./admin-record-workspace.js";
import { composeGeneratedAdminCard } from "./module-card-composer.js";
import { adminMediaImageLayersMarkup } from "./admin-media-frame.js";
import { applyRecordLibraryView, DEFAULT_RECORD_LIBRARY_PAGE_SIZE, normalizeRecordLibraryPageSize, recordLibraryPageSlice } from "./admin-record-library.js";
import { resolveAssetUrl } from "../../asset-resolver.js";
import { resolveModuleRecordMedia } from "../../record-media.js";

const $ = (id) => document.getElementById(id);
const clean = (value = "") => String(value ?? "").trim();
const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const humanizeRuntimeLabel = (value = "") => clean(value) === "simple-manager" ? "Standard Grid / List" : clean(value).split(/[\s_-]+/).filter(Boolean).map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");
const libraryHeading = (title = "") => /\blibrary$/i.test(clean(title)) ? clean(title) : `${clean(title) || "Entry"} Library`;
const MEDIA_TYPES = new Set(["image","images","gallery","video","audio","pdf","document","file","project-file","files"]);
const MULTI_MEDIA_TYPES = new Set(["images","gallery","files"]);
const MODULE_RUNTIME_SESSION_ID = globalThis.crypto?.randomUUID?.() || `module-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const initialParams = new URLSearchParams(location.search);
let activeSectionKey = clean(initialParams.get("section"));
const initialView = clean(initialParams.get("view"));
let moduleMode = initialView === "create" ? "create" : initialView === "edit" ? "edit" : ["page","pages"].includes(initialView) ? "pages" : (activeSectionKey ? "pages" : "library");
let section = null;
let entries = [];
let editingEntry = null;
let relationshipModules = [];
let relationshipOptions = new Map();
let capabilities = [];
let selectedSkillIds = new Set();
let selectedToolIds = new Set();
let moduleSkillPicker = null;
let moduleToolPicker = null;
let definitionFields = [];
let definitionRelationships = [];
let definitionEntryCapabilities = { category:{ enabled:false, options:[], key:"category" }, skills:false, tools:false };
let persistedDefinitionFields = new WeakSet();
let persistedDefinitionRelationships = new WeakSet();
let fieldMedia = new Map();
let pendingMedia = new Map();
let storageProfileOverrides = new Map();
let storageFieldControls = new Map();
let entryPage = 1;
let entryPageSize = DEFAULT_RECORD_LIBRARY_PAGE_SIZE;
let entryView = "grid";
let entrySlugManual = false;
let moduleRegistrySections = [];
let moduleRecordWorkspace = null;
let entryStudioDependenciesReady = false;
let entryStudioDependenciesPromise = null;
let lifecycleSyncGeneration = 0;

function notice(message, tone = "success") {
  window.LANNotice?.({ title: tone === "error" ? "Custom module" : "Module updated", message, tone });
}
function mediaUrl(value) {
  if (!value) return "";
  if (Array.isArray(value)) return mediaUrl(value[0]);
  // Pending local selections must bypass the persisted-asset resolver. Blob URLs are
  // browser-owned previews and are intentionally replaced by provider URLs on Save.
  const localPreview = clean(value?.previewUrl);
  if (localPreview.startsWith("blob:")) return localPreview;
  return clean(resolveAssetUrl(value, "admin-read"));
}
function fileName(value, fallback = "File") {
  if (!value) return fallback;
  if (typeof value === "string") return value.split("/").filter(Boolean).at(-1) || fallback;
  return clean(value.originalFilename || value.displayName || value.name || fallback);
}
function formatSize(bytes = 0) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size/1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size/1048576).toFixed(size < 10485760 ? 1 : 0)} MB`;
}
function formatEntryTimestamp(value) {
  if (!value) return "After first save";
  const millis = typeof value?.toMillis === "function" ? value.toMillis() : value?.seconds ? value.seconds * 1000 : Date.parse(value);
  if (!Number.isFinite(millis)) return "Saved";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(millis));
}
function statusBadge(status = "draft") {
  const value = status === "published" ? "published" : "draft";
  return `<span class="status-badge ${value} lan-semantic-chip" data-semantic-role="status" data-semantic-state="${value}">${value === "published" ? "Published" : "Draft"}</span>`;
}
function publicCompositionHomeUrl(){
  return section?.key ? `home.html?module=${encodeURIComponent(section.key)}#future-portfolio-features` : 'home.html#future-portfolio-features';
}
function syncPublicCompositionGate(){
  if(!section)return;
  const composition=modulePublicCompositionState(section);
  const homeUrl=publicCompositionHomeUrl();
  const compositionLink=$("editModuleDefinition");
  const gateAction=$("modulePublicCompositionGateAction");
  if(compositionLink)compositionLink.href=homeUrl;
  if(gateAction)gateAction.href=homeUrl;
  const status=$("moduleEntryStatus")?.value||'draft';
  const visible=$("moduleEntryVisible")?.checked!==false;
  const contentReady=entries.some((entry)=>entry.status==='published'&&entry.visible!==false);
  const gate=$("modulePublicCompositionGate");
  if(gate){
    gate.hidden=status!=="published";
    if(status==="published"){
      const moduleReleased=section.status==='published';
      gate.dataset.state=composition.active?'ready':'blocked';
      $("modulePublicCompositionGateTitle").textContent=!composition.active?'Not public yet':moduleReleased?'Public module published':'Ready for module publishing';
      $("modulePublicCompositionGateMessage").textContent=!composition.active
        ? 'This entry is ready content, but Home / Studio must configure and enable this module before public release.'
        : !visible
          ? 'This entry is Published but Hidden. Enable Visible before it can contribute to public release.'
          : moduleReleased
            ? 'This entry is eligible for the active public module section.'
            : 'Home / Studio composition is ready. Use the module Publish action after at least one Published and Visible entry is saved.';
    }
  }
  const action=$("openPublicModule");
  if(action){
    if(!composition.active){
      action.textContent='Configure Public';
      action.disabled=false;
      action.dataset.publicAction='configure';
      action.title='Configure this module in Home / Studio.';
    }else if(section.status!=='published'){
      action.textContent='Publish';
      action.disabled=!contentReady;
      action.dataset.publicAction='publish';
      action.title=contentReady?'Publish this configured module to the public portfolio.':'Save at least one Published and Visible entry first.';
    }else{
      action.textContent='Published';
      action.disabled=true;
      action.dataset.publicAction='published';
      action.title='This configured module is published on the public portfolio.';
    }
    action.setAttribute('aria-disabled',String(action.disabled));
  }
}
async function handlePublicModuleAction(){
  if(!section)return;
  const action=$("openPublicModule")?.dataset.publicAction;
  if(action==='configure'){
    location.href=publicCompositionHomeUrl();
    return;
  }
  if(action!=='publish')return;
  const composition=modulePublicCompositionState(section);
  const contentReady=entries.some((entry)=>entry.status==='published'&&entry.visible!==false);
  if(!composition.active){notice('Configure and enable Public Composition in Home / Studio first.','warning');return;}
  if(!contentReady){notice('Save at least one Published and Visible entry before publishing this module.','warning');return;}
  const button=$("openPublicModule");
  try{
    if(button)button.disabled=true;
    await updateSectionRegistry(section.id,{status:'published'});
    section=await getSection(section.key);
    syncPublicCompositionGate();
    notice('Module published to the public portfolio.');
  }catch(error){notice(error.message||'Module could not be published.','error');}
  finally{if(button&&section?.status!=='published')button.disabled=false;}
}
function fieldAccept(field = {}) { return fieldAcceptForSchema(field); }
function isFileAccepted(file, accept = "") {
  const rules = clean(accept).split(",").map((x)=>x.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const name = clean(file?.name).toLowerCase(), type = clean(file?.type).toLowerCase();
  return rules.some((rule)=> rule.startsWith(".") ? name.endsWith(rule) : rule.endsWith("/*") ? type.startsWith(rule.slice(0,-1)) : type === rule);
}
function fieldClassification(field, file) {
  const classified = classifyPortfolioFile(file);
  if (field.type === "image" || field.type === "images" || field.type === "gallery") return { ...classified, family:"image", uploadResource:"image" };
  if (field.type === "video") return { ...classified, family:"video", uploadResource:"video" };
  if (field.type === "audio") return { ...classified, family:"audio", uploadResource:"video" };
  return classified;
}
function localFileDescriptor(file, field) {
  const meta = fieldClassification(field, file);
  return stageLocalMediaFile(file, { family: meta.family })?.descriptor || null;
}
function revokeDescriptor(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  values.forEach((item)=>releaseLocalMediaSelection(item));
}
function clearPending(key) { revokeDescriptor(pendingMedia.get(key)); pendingMedia.delete(key); }
function clearAllPending() { pendingMedia.forEach(revokeDescriptor); pendingMedia.clear(); }

function moduleWorkspaceState(item = {}) {
  if (item.lifecycle === "promoted") return { label:"Promoted", tone:"published" };
  if (!item.setupComplete) return { label:"Building", tone:"pending" };
  return { label:"Testing", tone:"draft" };
}

function moduleModeViewValue(mode = moduleMode, hasSelection = Boolean(activeSectionKey)) {
  if (mode === "pages") return hasSelection ? "page" : "pages";
  return mode;
}

function renderModuleStudioNavIcons() {
  document.querySelectorAll("[data-module-studio-icon]").forEach((host) => {
    host.innerHTML = renderSystemIcon(host.dataset.moduleStudioIcon || "sparkles", { className:"module-studio-nav__glyph" });
  });
}

function syncModeTabs() {
  document.querySelectorAll("[data-module-mode]").forEach((button)=>{
    const active = button.dataset.moduleMode === moduleMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderModuleStudioNavIcons();
}

function syncRegistryModeCopy() {
  const eyebrow = $("moduleRegistryEyebrow"), title = $("moduleRegistryTitle"), help = $("moduleRegistryHelp");
  if (!eyebrow || !title || !help) return;
  if (moduleMode === "edit") {
    eyebrow.textContent = "Module blueprints"; title.textContent = "Edit Module"; help.textContent = "Choose a saved module to edit its fields, capabilities, relationships and identity.";
  } else if (moduleMode === "pages") {
    eyebrow.textContent = "Generated Admin pages"; title.textContent = "Module Pages"; help.textContent = "Open a built module as the real Admin page used for samples and content testing.";
  } else {
    eyebrow.textContent = "All modules"; title.textContent = "Module Library"; help.textContent = "Overview of every Custom Module and its current lifecycle state.";
  }
}

function setModuleMode(mode = "library", { updateUrl = true, preserveSelection = false } = {}) {
  const next = ["library","create","edit","pages"].includes(mode) ? mode : "library";
  moduleMode = next;
  if (!preserveSelection && ["library","create"].includes(next)) { activeSectionKey = ""; section = null; }
  document.body.dataset.moduleMode = next;
  document.body.dataset.modulePageOpen = String(next === "pages" && Boolean(section));
  syncModeTabs();
  syncRegistryModeCopy();
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("view", moduleModeViewValue(next, Boolean(section)));
    if (section) url.searchParams.set("section", section.key); else url.searchParams.delete("section");
    history.replaceState({}, "", url);
  }
  const creation = $("moduleCreationPanel"), empty = $("moduleEmptyState"), detail = $("moduleDetailView");
  if (creation) creation.hidden = next !== "create";
  if (detail) detail.hidden = !section || !["edit","pages"].includes(next);
  if (empty) empty.hidden = next === "create" || Boolean(section) || ["library"].includes(next);
  const emptyEyebrow=$("moduleEmptyEyebrow"), emptyTitle=$("moduleEmptyTitle"), emptyHelp=$("moduleEmptyHelp");
  if (emptyEyebrow && emptyTitle && emptyHelp) {
    if (next === "edit") { emptyEyebrow.textContent="Edit module"; emptyTitle.textContent="Choose a module blueprint"; emptyHelp.textContent="Select a saved module on the left to edit fields, capabilities, relationships and identity."; }
    else if (next === "pages") { emptyEyebrow.textContent="Module pages"; emptyTitle.textContent="Choose a generated Admin page"; emptyHelp.textContent="Open a structurally built module to manage real entries and live-test the exact Admin runtime."; }
    else { emptyEyebrow.textContent="Module workspace"; emptyTitle.textContent="Select a module"; emptyHelp.textContent="Choose a saved module to continue."; }
  }
  const buildPanel = $("moduleBuildPanel"), contentPanel = $("moduleContentPanel");
  if (buildPanel) buildPanel.hidden = next !== "edit" || !section;
  if (contentPanel) contentPanel.hidden = next !== "pages" || !section;
  const input = $("moduleRegistrationTitle");
  if (next === "create" && input) { input.value = ""; requestAnimationFrame(()=>input.focus()); }
  syncModulePresentationMode();
}

function registryActions(item) {
  const key = escapeHtml(item.key);
  const canEdit = item.lifecycle !== "promoted";
  const canOpenPage = item.setupComplete || item.lifecycle === "promoted";
  if (moduleMode === "edit") {
    const primary = canEdit
      ? `<button class="editor-secondary-button button-compact" data-module-action="edit" data-module-select="${key}" type="button">${item.setupComplete ? "Edit Structure" : "Continue Setup"}</button>`
      : `<button class="editor-secondary-button button-compact" data-module-action="page" data-module-select="${key}" type="button">Open Admin Page</button>`;
    return `<div class="custom-module-registry-actions">${primary}</div>`;
  }
  if (moduleMode === "pages") {
    const primary = canOpenPage
      ? `<button class="editor-secondary-button button-compact" data-module-action="page" data-module-select="${key}" type="button">Open Admin Page</button>`
      : `<button class="editor-secondary-button button-compact" data-module-action="edit" data-module-select="${key}" type="button">Finish Structure</button>`;
    return `<div class="custom-module-registry-actions">${primary}</div>`;
  }
  const edit = canEdit ? `<button class="editor-secondary-button button-compact" data-module-action="edit" data-module-select="${key}" type="button">Edit Structure</button>` : "";
  const page = canOpenPage ? `<button class="editor-secondary-button button-compact" data-module-action="page" data-module-select="${key}" type="button">Open Admin Page</button>` : "";
  return `<div class="custom-module-registry-actions">${edit}${page || `<button class="editor-secondary-button button-compact" data-module-action="edit" data-module-select="${key}" type="button">Continue Setup</button>`}</div>`;
}

function updateModuleStudioSummary(all = []) {
  const counts = all.reduce((summary, item) => {
    const state = moduleWorkspaceState(item).label.toLowerCase();
    summary.total += 1;
    if (state === "building") summary.building += 1;
    else if (state === "promoted") summary.promoted += 1;
    else summary.testing += 1;
    return summary;
  }, { total:0, building:0, testing:0, promoted:0 });
  const factoryTotal = all.filter((item) => item.lifecycle !== "promoted").length;
  const map = {
    moduleStudioTotal: factoryTotal,
    moduleStudioBuilding: counts.building,
    moduleStudioTesting: counts.testing,
    moduleStudioPromoted: counts.promoted
  };
  Object.entries(map).forEach(([id, value]) => { const node = $(id); if (node) node.textContent = String(value); });
  const navMeta = {
    library: `${factoryTotal} modules`,
    create: "New blueprint",
    edit: `${factoryTotal} editable`,
    pages: `${counts.testing} pages`
  };
  document.querySelectorAll("[data-module-mode]").forEach((button) => {
    const meta = button.querySelector(".module-studio-nav__meta");
    if (meta && navMeta[button.dataset.moduleMode]) meta.textContent = navMeta[button.dataset.moduleMode];
  });
}

async function renderModuleRegistry() {
  const all = await listSections();
  moduleRegistrySections = all;
  updateModuleStudioSummary(all);
  const occupiedIcons = new Set(Object.values(NAVIGATION_ICON_MAP));
  const registryIcons = new Map();
  all.forEach((item) => {
    const icon = resolveModuleAdminIcon(item, { occupied:[...occupiedIcons] });
    registryIcons.set(item.key, icon);
    occupiedIcons.add(icon);
  });
  let registered = all;
  if (moduleMode === "library") registered = all.filter((item)=>item.lifecycle !== "promoted");
  if (moduleMode === "edit") registered = all.filter((item)=>item.lifecycle !== "promoted");
  if (moduleMode === "pages") registered = all.filter((item)=>item.lifecycle !== "promoted" && item.setupComplete);
  $("moduleRegistryCount").textContent = `${registered.length} modules`;
  $("moduleRegistryList").innerHTML = registered.length ? registered.map((item)=>{
    const state = moduleWorkspaceState(item); const selected = item.key === activeSectionKey;
    const readiness = item.setupComplete ? "Structure ready" : "Setup incomplete";
    const icon = registryIcons.get(item.key) || "sparkles";
    const cardAccent = /^#[0-9a-f]{6}$/i.test(clean(item.theme?.accent)) ? clean(item.theme.accent) : '#7c5cff';
    return `<article class="custom-module-registry-card${selected?' is-selected':''}" data-module-queue-card="${escapeHtml(item.key)}" style="--module-card-accent:${cardAccent}"><div class="custom-module-registry-card-copy"><div class="custom-module-registry-card-identity"><span class="custom-module-registry-card-icon" aria-hidden="true">${renderSystemIcon(icon)}</span><div><strong>${escapeHtml(item.title || item.key)}</strong><small>${escapeHtml(item.key)}</small></div></div><span class="module-registry-status is-${state.tone}">${state.label}</span></div><p>${escapeHtml(humanizeRuntimeLabel(item.adminWorkspace || 'simple-manager'))} · Public layout in Home / Studio</p><footer><span>${item.fields.length} fields · ${readiness}</span>${registryActions(item)}</footer></article>`;
  }).join("") : `<div class="custom-module-empty"><strong>${moduleMode === "pages" ? "No Module Pages yet" : moduleMode === "edit" ? "No editable modules" : "No custom modules yet"}</strong><span>${moduleMode === "pages" ? "Finish a module structure first, then its real Admin page will appear here." : "Create your first generic module to get started."}</span></div>`;
  $("moduleRegistryList").querySelectorAll("[data-module-select]").forEach((button)=>button.addEventListener("click",()=>selectModule(button.dataset.moduleSelect,{mode:button.dataset.moduleAction === "edit" ? "edit" : "pages"})));
  return all;
}

function usesRecordWorkspace() { return section?.workspaceTraits?.recordWorkspace === true; }
function syncGeneratedRecordWorkspace() {
  const root=$("moduleRecordWorkspace");
  if(!root)return;
  moduleRecordWorkspace?.destroy?.();
  moduleRecordWorkspace=null;
  const active=usesRecordWorkspace();
  root.classList.toggle('lan-record-workspace',active);
  root.toggleAttribute('data-lan-record-workspace',active);
  root.dataset.recordWorkspace=active?'true':'false';
  const idle=root.querySelector('[data-module-record-workspace-idle]');
  const inlinePreview=root.querySelector('[data-module-record-workspace-preview]');
  const headerAdd=$("newModuleEntry");
  if(headerAdd)headerAdd.hidden=active;
  if(!active){
    if(idle)idle.hidden=true;
    if(inlinePreview)inlinePreview.hidden=true;
    root.dataset.previewOpen='false';
    root.dataset.editorMode='idle';
    return;
  }
  const title=$("moduleRecordWorkspaceTitle");
  if(title)title.textContent=`${section?.title||'Entry'} workspace`;
  moduleRecordWorkspace=createAdminRecordWorkspaceController(root);
  moduleRecordWorkspace.showIdle();
}
function showContentSurface(surface = "library") {
  const workbench=document.querySelector('.custom-module-entry-workbench');
  if(workbench) workbench.setAttribute('data-entry-surface',surface);
  if(moduleRecordWorkspace)return;
  const keepLibraryVisible=Boolean(section)&&(moduleMode==='pages'||section.lifecycle==='promoted');
  document.querySelectorAll("[data-content-surface]").forEach((node)=>{
    if(keepLibraryVisible&&node.dataset.contentSurface==='library') node.hidden=false;
    else node.hidden=node.dataset.contentSurface!==surface;
  });
}
function openEntryEditor(mode='edit') { if(moduleRecordWorkspace){mode==='create'?moduleRecordWorkspace.startCreate():moduleRecordWorkspace.startEdit();return;} showContentSurface("editor"); }
function syncModulePresentationMode() {
  const promoted = section?.lifecycle === "promoted";
  const modulePage = Boolean(section) && moduleMode === "pages";
  const modulePageOpen = modulePage;
  const firstClass = promoted || modulePage;
  const directPromoted = promoted && !clean(new URLSearchParams(location.search).get("view"));
  document.body.dataset.modulePresentation = firstClass ? "first-class" : "builder";
  document.body.dataset.moduleDirectPromoted = String(directPromoted);
  const modeTabs = $("moduleModeTabs");
  if (modeTabs) modeTabs.hidden = directPromoted || modulePageOpen;
  const moduleStudioBack = $("moduleStudioBack");
  if (moduleStudioBack) moduleStudioBack.hidden = directPromoted || !modulePageOpen;

  const title = firstClass ? clean(section?.title) || "Module" : "Custom Modules";
  const eyebrow = firstClass ? "Portfolio content" : "Custom module";
  const pageTitle = $("modulePageTitle");
  if (pageTitle) pageTitle.textContent = title;
  const topbarEyebrow = pageTitle?.closest(".editor-topbar")?.querySelector(".editor-eyebrow");
  if (topbarEyebrow) topbarEyebrow.textContent = eyebrow;

  const pageBand = document.querySelector(".lan-page-band");
  if (pageBand) {
    pageBand.setAttribute("aria-label", `${title} page header`);
    const bandEyebrow = pageBand.querySelector(".lan-page-band-copy small");
    const bandTitle = pageBand.querySelector(".lan-page-band-copy strong");
    if (bandEyebrow) bandEyebrow.textContent = eyebrow;
    if (bandTitle) bandTitle.textContent = title;
  }

  const clearButton = $("clearModuleEntry");
  if (clearButton) {
    clearButton.hidden = firstClass;
    clearButton.textContent = "Clear";
    clearButton.classList.remove("editor-icon-button", "button-icon-compact");
    clearButton.setAttribute("aria-label", "Clear entry fields");
    clearButton.removeAttribute("title");
  }

  const cancelButton = $("cancelModuleEntry");
  if (cancelButton) cancelButton.hidden = false;
  document.querySelector(".custom-module-form-actions")?.classList.toggle("editor-savebar", firstClass);
}
async function closeEntryStudio() {
  await clearEntry();
  if(moduleRecordWorkspace)moduleRecordWorkspace.showIdle();
  else showContentSurface("library");
}

const FIELD_LABELS = Object.freeze({
  text:"Text", textarea:"Textarea", "rich-text":"Rich Text", number:"Number", hours:"Hours", date:"Date", url:"URL", email:"Email", boolean:"Boolean", toggle:"Toggle", tags:"Tags",
  image:"Image", images:"Multiple Images", gallery:"Gallery", video:"Video", audio:"Audio", pdf:"PDF", document:"Document", file:"Generic File", "project-file":"Project / Source File", files:"Multiple Files",
  relationship:"Relationship", select:"Select", multiselect:"Multi-select"
});
function definitionFieldOptions(selected="text") { return CUSTOM_MODULE_FIELD_TYPES.map((type)=>`<option value="${type}"${type===selected?' selected':''}>${escapeHtml(FIELD_LABELS[type]||type)}</option>`).join(""); }
function relationshipModuleOptions(selected="") { return relationshipModules.filter((m)=>m.key!==section?.key).map((m)=>`<option value="${escapeHtml(m.key)}"${m.key===selected?' selected':''}>${escapeHtml(m.label)}</option>`).join(""); }
function keyState(item, persistedSet) { return persistedSet.has(item) ? {badge:"Locked",help:"Stable system key · renaming the label will not change saved data."} : {badge:"Auto",help:"Generated from label · locks after Save Setup."}; }
function syncDefinitionKeys() {
  const used = new Set(CORE_ENTRY_PROPERTIES.map((item) => definitionKey(item.key)));
  definitionFields.filter((field) => persistedDefinitionFields.has(field)).forEach((field) => {
    const key = definitionKey(field.key);
    if (key) used.add(key);
  });
  document.querySelectorAll("[data-definition-field-index]").forEach((row) => {
    const index = Number(row.dataset.definitionFieldIndex);
    const field = definitionFields[index];
    if (!field || isCoreEntryPropertyKey(field.key)) return;
    const label = clean(row.querySelector("[data-definition-field-label]")?.value);
    field.label = label || field.label;
    if (!persistedDefinitionFields.has(field)) {
      field.key = resolveSmartDefinitionKey({ label, currentKey: field.key, persisted: false, usedKeys: used, fallback: `field_${index + 1}` });
    }
    if (field.key) used.add(field.key);
    const key = row.querySelector("[data-definition-field-key]");
    if (key) key.value = field.key;
    const heading = row.querySelector(".module-definition-row-head strong");
    if (heading) heading.textContent = field.label || `Field ${index + 1}`;
  });
}
function collectDefinitionFields() {
  syncDefinitionKeys();
  document.querySelectorAll("[data-definition-field-index]").forEach((row) => {
    const field = definitionFields[Number(row.dataset.definitionFieldIndex)];
    if (!field || isCoreEntryPropertyKey(field.key)) return;
    field.label = clean(row.querySelector("[data-definition-field-label]")?.value) || field.label;
    field.type = row.querySelector("[data-definition-field-type]")?.value || field.type || "text";
    const profile = moduleFieldEditorProfile(field);
    field.required = row.querySelector("[data-definition-field-required]")?.checked === true;
    field.public = row.querySelector("[data-definition-field-public]")?.checked !== false;
    field.placeholder = profile.placeholder ? clean(row.querySelector("[data-definition-field-placeholder]")?.value) : "";
    field.helpText = clean(row.querySelector("[data-definition-field-help]")?.value);
    const previewRole = row.querySelector("[data-definition-field-preview-role]")?.value || "auto";
    if (previewRole === "auto") delete field.previewRole;
    else field.previewRole = previewRole;
    field.options = profile.options
      ? [...row.querySelectorAll("[data-definition-field-option-token]")].map((token) => clean(token.dataset.value)).filter(Boolean)
      : [];
    field.acceptPreset = profile.filePreset ? (row.querySelector("[data-definition-field-accept]")?.value || "any") : "any";
    field.accept = profile.customAccept ? clean(row.querySelector("[data-definition-field-custom-accept]")?.value) : "";
    field.access = profile.sourceAccess ? (row.querySelector("[data-definition-field-access]")?.value || (field.type === "project-file" ? "admin-only" : "public-preview")) : "public-preview";
    field.targetModule = profile.relationshipTarget ? (row.querySelector("[data-definition-field-target]")?.value || "") : "";
    if (profile.dateOptions) {
      field.datePrecision = row.querySelector("[data-definition-field-date-precision]")?.value || field.datePrecision || "auto";
      field.dateRange = row.querySelector("[data-definition-field-date-range]")?.value || field.dateRange || "auto";
    } else {
      delete field.datePrecision;
      delete field.dateRange;
    }
    field.multiple = profile.intrinsicMultiple || (profile.multiple && row.querySelector("[data-definition-field-multiple]")?.checked === true);
  });
}
function definitionSelectOptions(values, selected) {
  return values.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}
function definitionOptionTokenMarkup(value) {
  return `<span class="module-option-token lan-chip" data-definition-field-option-token data-value="${escapeHtml(value)}"><span>${escapeHtml(value)}</span><button class="lan-chip-remove" type="button" aria-label="Remove ${escapeHtml(value)}" data-remove-definition-option></button></span>`;
}
function definitionOptionEditorMarkup(field) {
  const category = field.type === "category";
  const label = category ? "Categories" : "Options";
  const placeholder = category ? "Type a category and press Enter" : "Type an option and press Enter";
  return `<label class="module-option-field"><span>${label}</span><div class="module-option-editor" data-definition-options-editor>${(field.options || []).map(definitionOptionTokenMarkup).join("")}<input data-definition-field-option-input aria-label="Add ${category ? "category" : "option"}" placeholder="${placeholder}"></div><small>${category ? "Reusable category choices for this module." : "Press Enter or comma to add a removable option."}</small></label>`;
}
function renderDefinitionFieldCard(field, index) {
  if (isCoreEntryPropertyKey(field.key)) return "";
  const ks = keyState(field, persistedDefinitionFields);
  const profile = moduleFieldEditorProfile(field);
  const optional = [];
  if (profile.placeholder) optional.push(`<label>Placeholder<input data-definition-field-placeholder value="${escapeHtml(field.placeholder || "")}" placeholder="Optional input hint"></label>`);
  if (profile.options) optional.push(definitionOptionEditorMarkup(field));
  if (profile.filePreset) optional.push(`<label>File preset<select data-definition-field-accept>${definitionSelectOptions([["any","Any permitted file"],["documents","Documents"],["images","Images"],["video","Video"],["audio","Audio"],["source","Source / project"],["custom","Custom"]], field.acceptPreset || "any")}</select></label>`);
  if (profile.customAccept) optional.push(`<label>Custom accept<input data-definition-field-custom-accept value="${escapeHtml(field.accept || "")}" placeholder=".ext,.ext"></label>`);
  if (profile.sourceAccess) optional.push(`<label>Asset access<select data-definition-field-access>${definitionSelectOptions([["admin-only","Admin Only"],["metadata-only","Metadata Only"],["public-preview","Public Preview"],["public-download","Public Download"]], field.access || (field.type === "project-file" ? "admin-only" : "public-preview"))}</select></label>`);
  if ((profile.previewRoleOptions || []).length > 1) optional.push(`<label>Preview role<select data-definition-field-preview-role>${definitionSelectOptions(profile.previewRoleOptions, moduleFieldPreviewRole(field))}</select><small>Automatic preserves the generic preview. Choose a semantic role only when this field has a specific presentation meaning.</small></label>`);
  if (profile.dateOptions) {
    optional.push(`<label>Date precision<select data-definition-field-date-precision>${definitionSelectOptions([["auto","Automatic"],["exact-date","Exact date"],["month-year","Month & year"],["year","Year only"]], field.datePrecision || "auto")}</select><small>Automatic uses the workspace precision; choose Month & year or Year only when the source is not exact.</small></label>`);
    optional.push(`<label>Allowed dates<select data-definition-field-date-range>${definitionSelectOptions([["auto","Automatic"],["past-present","Past & present"],["any","Any date"],["present-future","Present & future"]], field.dateRange || "auto")}</select><small>Automatic defaults to Past & present. The current date/year ceiling advances automatically.</small></label>`);
  }
  if (profile.relationshipTarget) optional.push(`<label>Relationship target<select data-definition-field-target><option value="">Select module</option>${relationshipModuleOptions(field.targetModule)}</select></label>`);
  return `<article class="module-definition-row module-field-card" data-definition-field-index="${index}">
    <div class="module-definition-row-head"><div><strong>${escapeHtml(field.label || `Field ${index + 1}`)}</strong><small>${escapeHtml(profile.defaultHelp)}</small></div><button class="editor-danger-button button-compact" data-remove-definition-field="${index}" type="button">Remove</button></div>
    <div class="module-field-primary-grid">
      <label>Label<input data-definition-field-label value="${escapeHtml(field.label)}"></label>
      <label>Field type<select data-definition-field-type>${definitionFieldOptions(field.type)}</select></label>
    </div>
    <details class="module-field-technical"><summary><span>System field settings</span><span class="module-system-key-badge">${ks.badge}</span></summary><label class="module-system-key-field"><span>System key</span><input data-definition-field-key value="${escapeHtml(field.key)}" readonly><small>${ks.help}</small></label></details>
    ${optional.length ? `<div class="module-field-context-grid" data-context-count="${optional.length}">${optional.join("")}</div>` : ""}
    <div class="module-field-flags"><label class="simple-check"><input data-definition-field-required type="checkbox"${field.required ? " checked" : ""}>Required</label><label class="simple-check"><input data-definition-field-public type="checkbox"${field.public !== false ? " checked" : ""}>Shown publicly</label>${profile.multiple ? `<label class="simple-check"><input data-definition-field-multiple type="checkbox"${field.multiple ? " checked" : ""}>Multiple values</label>` : ""}</div>
    <details class="module-field-help"><summary>Help text <span>Uses smart default unless overridden</span></summary><label>Custom explanation<input data-definition-field-help value="${escapeHtml(field.helpText || "")}" placeholder="Optional override"></label><small>Built-in guidance: ${escapeHtml(profile.defaultHelp)}</small></details>
  </article>`;
}
function addDefinitionOption(editor, rawValue) {
  const input = editor?.querySelector("[data-definition-field-option-input]");
  const values = clean(rawValue).split(",").map(clean).filter(Boolean);
  if (!editor || !values.length) return;
  const existing = new Set([...editor.querySelectorAll("[data-definition-field-option-token]")].map((token) => clean(token.dataset.value).toLowerCase()));
  values.forEach((value) => {
    if (existing.has(value.toLowerCase())) return;
    existing.add(value.toLowerCase());
    const holder = document.createElement("div");
    holder.innerHTML = definitionOptionTokenMarkup(value);
    editor.insertBefore(holder.firstElementChild, input);
  });
  if (input) input.value = "";
}
function bindDefinitionOptionEditors(host) {
  host.querySelectorAll("[data-definition-options-editor]").forEach((editor) => {
    const input = editor.querySelector("[data-definition-field-option-input]");
    const commit = () => {
      if (!clean(input?.value)) return;
      addDefinitionOption(editor, input.value);
      collectDefinitionFields();
      renderDisplayMapping();
      renderReadiness();
    };
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== ",") return;
      event.preventDefault();
      commit();
    });
    input?.addEventListener("input", () => {
      if (input.value.includes(",")) commit();
    });
    input?.addEventListener("blur", commit);
    editor.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-definition-option]");
      if (!remove) return;
      remove.closest("[data-definition-field-option-token]")?.remove();
      collectDefinitionFields();
      renderDisplayMapping();
      renderReadiness();
    });
  });
}

function categoryCapabilityTokenMarkup(value) {
  return `<span class="module-option-token module-category-token lan-chip lan-chip-category" data-module-category-token data-value="${escapeHtml(value)}"><span class="lan-chip-label">${escapeHtml(value)}</span><button class="lan-chip-remove" type="button" aria-label="Remove ${escapeHtml(value)}" data-remove-module-category></button></span>`;
}
function categoryCapabilityValues() {
  return [...$("moduleCategoryCapabilityEditor").querySelectorAll("[data-module-category-token]")].map((token) => clean(token.dataset.value)).filter(Boolean);
}
function collectEntryCapabilities() {
  return {
    category: {
      enabled: $("moduleCategoryCapability").checked === true,
      options: categoryCapabilityValues(),
      key: definitionEntryCapabilities?.category?.key || "category"
    },
    skills: $("moduleSkillsCapability").checked === true,
    tools: $("moduleToolsCapability").checked === true
  };
}
function renderEntryCapabilities() {
  const category = definitionEntryCapabilities?.category || { enabled:false, options:[], key:"category" };
  $("moduleCategoryCapability").checked = category.enabled === true;
  $("moduleSkillsCapability").checked = definitionEntryCapabilities?.skills === true;
  $("moduleToolsCapability").checked = definitionEntryCapabilities?.tools === true;
  $("moduleCategoryCapabilityOptions").hidden = category.enabled !== true;
  const editor = $("moduleCategoryCapabilityEditor");
  const input = $("moduleCategoryCapabilityInput");
  editor.querySelectorAll("[data-module-category-token]").forEach((token) => token.remove());
  (category.options || []).forEach((value) => {
    const holder = document.createElement("div");
    holder.innerHTML = categoryCapabilityTokenMarkup(value);
    editor.insertBefore(holder.firstElementChild, input);
  });
}
function addCategoryCapabilityValue(rawValue) {
  const input = $("moduleCategoryCapabilityInput");
  const values = clean(rawValue).split(",").map(clean).filter(Boolean);
  const editor = $("moduleCategoryCapabilityEditor");
  const existing = new Set(categoryCapabilityValues().map((value) => value.toLowerCase()));
  values.forEach((value) => {
    if (existing.has(value.toLowerCase())) return;
    existing.add(value.toLowerCase());
    const holder = document.createElement("div");
    holder.innerHTML = categoryCapabilityTokenMarkup(value);
    editor.insertBefore(holder.firstElementChild, input);
  });
  input.value = "";
  definitionEntryCapabilities = collectEntryCapabilities();
  renderDisplayMapping();
  renderReadiness();
}
function bindEntryCapabilityControls() {
  $("moduleCategoryCapability")?.addEventListener("change", () => {
    definitionEntryCapabilities = collectEntryCapabilities();
    $("moduleCategoryCapabilityOptions").hidden = !$("moduleCategoryCapability").checked;
    renderDisplayMapping();
    renderReadiness();
  });
  ["moduleSkillsCapability", "moduleToolsCapability"].forEach((id) => $(id)?.addEventListener("change", () => {
    definitionEntryCapabilities = collectEntryCapabilities();
    renderReadiness();
  }));
  const input = $("moduleCategoryCapabilityInput");
  const commit = () => { if (clean(input?.value)) addCategoryCapabilityValue(input.value); };
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    commit();
  });
  input?.addEventListener("input", () => { if (input.value.includes(",")) commit(); });
  input?.addEventListener("blur", commit);
  $("moduleCategoryCapabilityEditor")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-module-category]");
    if (!remove) return;
    remove.closest("[data-module-category-token]")?.remove();
    definitionEntryCapabilities = collectEntryCapabilities();
    renderDisplayMapping();
    renderReadiness();
  });
}

function renderDefinitionFields() {
  const host = $("moduleDefinitionFields");
  const customCards = definitionFields.map((field, index) => renderDefinitionFieldCard(field, index)).filter(Boolean);
  host.innerHTML = `<section class="module-custom-fields"><div class="module-schema-section-heading"><div><strong>Module-specific fields</strong><small>Add only information this module actually needs.</small></div><span>${customCards.length}</span></div><div class="module-definition-list">${customCards.length ? customCards.join("") : '<div class="custom-module-empty"><strong>No module-specific fields yet</strong><span>The common entry foundation is already available. Add only content unique to this module.</span></div>'}</div></section>`;
  host.querySelectorAll("[data-remove-definition-field]").forEach((button) => button.addEventListener("click", () => {
    collectDefinitionFields();
    const index = Number(button.dataset.removeDefinitionField);
    if (isCoreEntryPropertyKey(definitionFields[index]?.key)) return;
    definitionFields.splice(index, 1);
    renderDefinitionFields();
    renderDisplayMapping();
    renderReadiness();
  }));
  host.querySelectorAll("[data-definition-field-label]").forEach((input) => input.addEventListener("input", syncDefinitionKeys));
  host.querySelectorAll("[data-definition-field-type]").forEach((control) => control.addEventListener("change", () => {
    collectDefinitionFields();
    const row = control.closest("[data-definition-field-index]");
    const field = definitionFields[Number(row?.dataset.definitionFieldIndex)];
    if (!field) return;
    field.type = control.value;
    const profile = moduleFieldEditorProfile(field);
    const allowedPreviewRoles = new Set((profile.previewRoleOptions || []).map(([value]) => value));
    if (!allowedPreviewRoles.has(moduleFieldPreviewRole(field))) delete field.previewRole;
    field.multiple = profile.intrinsicMultiple || (profile.multiple && field.multiple === true);
    renderDefinitionFields();
    renderDisplayMapping();
    renderReadiness();
  }));
  bindDefinitionOptionEditors(host);
  renderModuleIconIdentity();
  renderWorkspaceResolution();
  host.querySelectorAll("input:not([data-definition-field-type]):not([data-definition-field-option-input]),select:not([data-definition-field-type])").forEach((control) => control.addEventListener("change", () => {
    collectDefinitionFields();
    const field = definitionFields[Number(control.closest("[data-definition-field-index]")?.dataset.definitionFieldIndex)];
    if (control.matches("[data-definition-field-accept]") && field) renderDefinitionFields();
    renderDisplayMapping();
    renderReadiness();
  }));
}
function syncRelationshipKeys() {
  const used=new Set(definitionRelationships.filter((r)=>persistedDefinitionRelationships.has(r)).map((r)=>definitionKey(r.key)).filter(Boolean));
  document.querySelectorAll("[data-definition-relationship-index]").forEach((row)=>{ const index=Number(row.dataset.definitionRelationshipIndex), rel=definitionRelationships[index]; if(!rel)return; const label=clean(row.querySelector('[data-definition-relationship-label]')?.value); rel.label=label||rel.label; if(!persistedDefinitionRelationships.has(rel)) rel.key=resolveSmartDefinitionKey({label,currentKey:rel.key,persisted:false,usedKeys:used,fallback:`relationship_${index+1}`}); if(rel.key)used.add(rel.key); const key=row.querySelector('[data-definition-relationship-key]'); if(key)key.value=rel.key; });
}
function collectDefinitionRelationships() {
  syncRelationshipKeys(); document.querySelectorAll('[data-definition-relationship-index]').forEach((row)=>{ const rel=definitionRelationships[Number(row.dataset.definitionRelationshipIndex)]; if(!rel)return; rel.label=clean(row.querySelector('[data-definition-relationship-label]')?.value)||rel.label; rel.targetModule=row.querySelector('[data-definition-relationship-target]')?.value||''; rel.multiple=row.querySelector('[data-definition-relationship-multiple]')?.checked===true; rel.required=row.querySelector('[data-definition-relationship-required]')?.checked===true; rel.public=row.querySelector('[data-definition-relationship-public]')?.checked!==false; });
}
function renderDefinitionRelationships() {
  const host=$("moduleDefinitionRelationships");
  host.innerHTML=definitionRelationships.length?definitionRelationships.map((rel,index)=>{const ks=keyState(rel,persistedDefinitionRelationships);return `<article class="module-definition-row" data-definition-relationship-index="${index}"><div class="module-definition-row-head"><strong>${escapeHtml(rel.label)}</strong><button class="editor-danger-button button-compact" data-remove-definition-relationship="${index}" type="button">Remove</button></div><div class="module-definition-row-grid"><label>Label<input data-definition-relationship-label value="${escapeHtml(rel.label)}"></label><label><span class="module-system-key-heading"><span>System key</span><span class="module-system-key-badge">${ks.badge}</span></span><input data-definition-relationship-key value="${escapeHtml(rel.key)}" readonly><small>${ks.help}</small></label><label>Target module<select data-definition-relationship-target><option value="">Select module</option>${relationshipModuleOptions(rel.targetModule)}</select></label><label class="simple-check"><input data-definition-relationship-multiple type="checkbox"${rel.multiple?' checked':''}>Allow multiple</label><label class="simple-check"><input data-definition-relationship-required type="checkbox"${rel.required?' checked':''}>Required</label><label class="simple-check"><input data-definition-relationship-public type="checkbox"${rel.public!==false?' checked':''}>Public relationship</label></div></article>`}).join(""):'<div class="custom-module-empty"><strong>No relationships</strong><span>Add relationships only when entries need references to records owned by another module.</span></div>';
  host.querySelectorAll('[data-remove-definition-relationship]').forEach((button)=>button.addEventListener('click',()=>{collectDefinitionRelationships();definitionRelationships.splice(Number(button.dataset.removeDefinitionRelationship),1);renderDefinitionRelationships();renderReadiness();}));
  host.querySelectorAll('[data-definition-relationship-label]').forEach((input)=>input.addEventListener('input',syncRelationshipKeys));
  renderModuleIconIdentity();
}
function displayOptions(types,selected,blank=true){const fields=definitionFields.filter((f)=>!types.length||types.includes(f.type));return `${blank?'<option value="">None</option>':''}${fields.map((f)=>`<option value="${escapeHtml(f.key)}"${f.key===selected?' selected':''}>${escapeHtml(f.label)}</option>`).join('')}`;}
function renderDisplayMapping(){
  if(!section)return;
  const currentCapabilities = collectEntryCapabilities();
  $("moduleDisplayTitle").innerHTML='<option value="title">Entry name (core)</option>';
  $("moduleDisplaySummary").innerHTML='<option value="shortSummary">Short summary (core)</option><option value="description">Full description (core)</option>';
  $("moduleDisplaySummary").value=section.display?.summaryField === "description" ? "description" : "shortSummary";
  $("moduleDisplayImage").innerHTML=displayOptions(["image","file","project-file"],section.display?.imageField);
  $("moduleDisplayCategory").innerHTML=currentCapabilities.category.enabled?'<option value="category">Category (built-in)</option>':'<option value="">None</option>';
  $("moduleDisplayTags").innerHTML=displayOptions(["tags","multiselect"],section.display?.tagsField);
}
function populateModuleIconOptions() {
  const select = $("moduleThemeIcon");
  if (!select || select.options.length) return;
  select.innerHTML = SYSTEM_ICON_CATALOG.map((item)=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("");
}
function moduleIconOccupiedSet() {
  const occupied = new Set(Object.values(NAVIGATION_ICON_MAP));
  const others = moduleRegistrySections.filter((item)=>item?.key && item.key !== section?.key && item.lifecycle === "promoted");
  const sorted = [...others].sort((a,b)=>clean(a.key).localeCompare(clean(b.key)));
  for (const item of sorted) occupied.add(resolveModuleAdminIcon(item,{occupied:[...occupied]}));
  return occupied;
}
function currentAdminWorkspaceDraft() {
  const selection = $("moduleAdminWorkspace")?.value || (section?.adminWorkspaceMode === 'auto' ? 'auto' : section?.adminWorkspace) || 'auto';
  const mode = selection === 'auto' ? 'auto' : 'manual';
  const candidate = {
    ...section,
    title: clean($("moduleDefinitionTitle")?.value || section?.title),
    subtitle: clean($("moduleDefinitionSubtitle")?.value || section?.subtitle),
    fields: definitionFields,
    entryCapabilities: definitionEntryCapabilities
  };
  const automatic = resolveModuleAdminWorkspace(candidate);
  const workspace = mode === 'manual' ? selection : automatic.workspace;
  return { mode, workspace, automatic };
}
function renderWorkspaceResolution() {
  const helper = $("moduleResolvedWorkspace");
  if (!helper) return;
  const state = currentAdminWorkspaceDraft();
  helper.textContent = state.mode === 'auto'
    ? `Resolved: ${humanizeRuntimeLabel(state.workspace)} · ${state.automatic.reason}`
    : `Manual override: ${humanizeRuntimeLabel(state.workspace)} · Automatic remains available.`;
}

function currentModuleIconDraft() {
  const mode = $("moduleThemeIconMode")?.value === "manual" ? "manual" : "auto";
  return {
    ...section,
    title: clean($("moduleDefinitionTitle")?.value || section?.title),
    subtitle: clean($("moduleDefinitionSubtitle")?.value || section?.subtitle),
    contentMode: $("moduleContentMode")?.value || section?.contentMode,
    adminWorkspace: currentAdminWorkspaceDraft().workspace,
    fields: definitionFields, relationships: definitionRelationships,
    theme: { ...(section?.theme || {}), iconMode: mode, icon: mode === "manual" ? clean($("moduleThemeIcon")?.value) : "" }
  };
}
function renderModuleIconIdentity() {
  const modeControl = $("moduleThemeIconMode"), manualWrap = $("moduleThemeIconManualWrap"), select = $("moduleThemeIcon"), preview = $("moduleThemeIconPreview");
  if (!modeControl || !select || !preview) return;
  populateModuleIconOptions();
  const mode = modeControl.value === "manual" ? "manual" : "auto";
  manualWrap.hidden = mode !== "manual";
  const icon = resolveModuleAdminIcon(currentModuleIconDraft(), { occupied:[...moduleIconOccupiedSet()] });
  const meta = getSystemIconMeta(icon);
  preview.innerHTML = `<span class="module-admin-icon-preview__glyph">${renderSystemIcon(icon)}</span><span class="module-admin-icon-preview__copy"><strong>${escapeHtml(mode === "auto" ? `Automatic · ${meta.label}` : `Custom · ${meta.label}`)}</strong><small>${mode === "auto" ? "Chosen from the module purpose and schema; avoids occupied Admin icons when possible." : "Manual override for this module."}</small></span>`;
}
function definitionPayload(statusOverride=null,setupComplete=true){
  collectDefinitionFields();
  collectDefinitionRelationships();
  definitionEntryCapabilities=collectEntryCapabilities();
  const intentSelection=$("moduleContentIntent")?.value||'auto';
  const contentIntentMode=intentSelection==='auto'?'auto':'manual';
  const contentIntent=contentIntentMode==='manual'?intentSelection:'';
  const workspaceState=currentAdminWorkspaceDraft();
  return { ...section, title:clean($("moduleDefinitionTitle").value), subtitle:clean($("moduleDefinitionSubtitle").value), contentMode:$("moduleContentMode").value, adminWorkspaceMode:workspaceState.mode, adminWorkspace:workspaceState.workspace, resolvedAdminWorkspace:workspaceState.workspace, contentIntentMode, contentIntent, theme:{accent:$("moduleThemeAccent").value,iconMode:$("moduleThemeIconMode").value==='manual'?'manual':'auto',icon:$("moduleThemeIconMode").value==='manual'?clean($("moduleThemeIcon").value):'',heroStyle:$("moduleThemeHeroStyle").value}, projectLinking:{enabled:$("moduleLinkableToProjects").checked,scope:$("moduleProjectLinkScope").value}, linkableToProjects:$("moduleLinkableToProjects").checked, entryCapabilities:definitionEntryCapabilities, categories:definitionEntryCapabilities.category.options, fields:definitionFields, relationships:definitionRelationships, display:{titleField:'title',summaryField:$("moduleDisplaySummary").value||'shortSummary',imageField:$("moduleDisplayImage").value,categoryField:definitionEntryCapabilities.category.enabled?'category':'',tagsField:$("moduleDisplayTags").value}, status:statusOverride||section.status, setupComplete, setupState:setupComplete?'ready':'pending' };
}
function renderReadiness(candidate=null){
  const draft=candidate||definitionPayload(section?.status,section?.setupComplete===true);
  const validation=evaluateModuleChecks(draft);
  const structural=summarizeModuleChecks(validation,'structural');
  const runtimeSafety=summarizeModuleChecks(selectModuleChecks(validation,'runtimeSafety'),'runtimeSafety');
  const maturity=evaluateModuleMaturity(section||draft,entries);
  const persistedFingerprint=clean(section?.lifecycleMeta?.structuralFingerprint);
  const pendingStructuralChange=Boolean(persistedFingerprint&&structuralFingerprint(draft)!==persistedFingerprint);
  const promoted=section?.lifecycle==='promoted';
  const automaticEligible=!promoted&&!pendingStructuralChange&&structural.ready&&runtimeSafety.ready&&maturity.ready;
  const badge=$("moduleReadinessBadge");
  if(badge){
    badge.textContent=promoted?'Promoted':pendingStructuralChange?'Unsaved revision':!structural.ready?'Needs setup':automaticEligible?'Promotion eligible':'Testing';
    badge.classList.toggle('is-ready',promoted||automaticEligible);
  }
  return {structural,runtimeSafety,maturity,pendingStructuralChange,automaticEligible};
}
function renderDefinitionEditor(){ definitionFields=(section.fields||[]).map((f)=>({...f,options:[...(f.options||[])]})); definitionRelationships=(section.relationships||[]).map((r)=>({...r})); definitionEntryCapabilities={category:{enabled:section.entryCapabilities?.category?.enabled===true,options:[...(section.entryCapabilities?.category?.options||[])],key:section.entryCapabilities?.category?.key||"category"},skills:section.entryCapabilities?.skills===true,tools:section.entryCapabilities?.tools===true}; persistedDefinitionFields=new WeakSet(definitionFields); persistedDefinitionRelationships=new WeakSet(definitionRelationships); $("moduleDefinitionTitle").value=section.title||''; $("moduleDefinitionSubtitle").value=section.subtitle||''; $("moduleContentMode").value=section.contentMode||'standalone'; $("moduleAdminWorkspace").value=section.adminWorkspaceMode==='auto'?'auto':(section.adminWorkspace||'simple-manager'); if($("moduleContentIntent")) $("moduleContentIntent").value=section.contentIntentMode==='manual'?(section.contentIntent||'mixed'):'auto'; $("moduleThemeAccent").value=/^#[0-9a-f]{6}$/i.test(section.theme?.accent||'')?section.theme.accent:'#7c5cff'; populateModuleIconOptions(); $("moduleThemeIconMode").value=section.theme?.iconMode==='manual'?'manual':'auto'; $("moduleThemeIcon").value=section.theme?.icon||SYSTEM_ICON_CATALOG[0]?.id||'sparkles'; $("moduleThemeHeroStyle").value=section.theme?.heroStyle||'soft-glow'; $("moduleLinkableToProjects").checked=section.projectLinking?.enabled===true; $("moduleProjectLinkScope").value=section.projectLinking?.scope||'module'; renderEntryCapabilities(); renderDefinitionFields(); renderDefinitionRelationships(); renderDisplayMapping(); renderWorkspaceResolution(); $("moduleRelationshipDefinitionBlock").hidden=section.contentMode==='standalone'; renderModuleIconIdentity(); renderReadiness(); }
async function saveDefinition(){
  const payload=definitionPayload(section?.status,true);
  await saveSection(payload,section.id);
  section=await getSection(section.key);
  applySectionIdentity();
  syncGeneratedRecordWorkspace();
  renderDefinitionEditor();
  await renderGeneratedForm();
  renderEntryCategoryFilter();
  renderEntryList();
  renderPromotedAdminPreview();
  await renderModuleRegistry();
  return section;
}

function capabilityRecords(type){return capabilities.filter((item)=>item.recordType===type&&item.active!==false);}
function pickerOptions(type){const tool=type==='tool';return{type,records:capabilityRecords(type),selectedIds:tool?[...selectedToolIds]:[...selectedSkillIds],placeholder:tool?'Search or add a Tool…':'Search or add a Skill…',emptyTitle:`No matching ${tool?'Tool':'Skill'} found.`,emptyHint:'Try another search.',compactAdd:true,dense:true,relationshipStyle:true,collapsedLimit:6,addLabel:tool?'+ Link Tool':'+ Link Skill',getMeta:(record)=>clean(record?.customCategory||record?.category||'Shared library'),onChange(ids){const set=new Set((ids||[]).map(clean).filter(Boolean));if(tool)selectedToolIds=set;else selectedSkillIds=set;},async onCommit(value){const record=await ensureCapabilityByName(type,value);capabilities=await loadSkills();return{record:capabilities.find((item)=>item.id===record.id)||record};}};}
function syncCapabilityPickers(){ const wantsSkills=section?.entryCapabilities?.skills===true, wantsTools=section?.entryCapabilities?.tools===true; $("moduleSkillPickerHost").closest('.custom-module-capability-picker').hidden=!wantsSkills; $("moduleToolPickerHost").closest('.custom-module-capability-picker').hidden=!wantsTools; if(wantsSkills&&window.LANCreateCapabilityPicker){const options=pickerOptions('skill');moduleSkillPicker?moduleSkillPicker.update(options):moduleSkillPicker=window.LANCreateCapabilityPicker($("moduleSkillPickerHost"),options);} if(wantsTools&&window.LANCreateCapabilityPicker){const options=pickerOptions('tool');moduleToolPicker?moduleToolPicker.update(options):moduleToolPicker=window.LANCreateCapabilityPicker($("moduleToolPickerHost"),options);} }

function controlValue(field){
  const control=document.querySelector(`[data-module-field="${CSS.escape(field.key)}"]`);
  if(MEDIA_TYPES.has(field.type))return fieldMedia.get(field.key)??(MULTI_MEDIA_TYPES.has(field.type)?[]:null);
  if(field.type==='date'){
    const profile=moduleDateFieldProfile(section||{},field);
    if(profile.precision==='month-year'){
      const year=clean(document.querySelector(`[data-module-date-year="${CSS.escape(field.key)}"]`)?.value);
      const month=clean(document.querySelector(`[data-module-date-month="${CSS.escape(field.key)}"]`)?.value);
      if(!year&&!month)return'';
      if(!year||!month)throw new Error(`${field.label} needs both month and year.`);
      const y=Number(year),m=Number(month);
      if(profile.range==='past-present'&&(y>profile.currentYear||(y===profile.currentYear&&m>profile.currentMonth)))throw new Error(`${field.label} cannot be in the future.`);
      if(profile.range==='present-future'&&(y<profile.currentYear||(y===profile.currentYear&&m<profile.currentMonth)))throw new Error(`${field.label} cannot be before the current month.`);
      const next=`${year}-${month}`;
      const original=clean(document.querySelector(`[data-module-date-field="${CSS.escape(field.key)}"]`)?.dataset.moduleDateOriginal);
      return /^\d{4}-\d{2}-\d{2}$/.test(original)&&original.startsWith(`${next}-`)?original:next;
    }
    if(profile.precision==='year'){
      const year=clean(document.querySelector(`[data-module-date-year="${CSS.escape(field.key)}"]`)?.value);
      if(!year)return'';
      const y=Number(year);
      if(profile.range==='past-present'&&y>profile.currentYear)throw new Error(`${field.label} cannot be in the future.`);
      if(profile.range==='present-future'&&y<profile.currentYear)throw new Error(`${field.label} cannot be before the current year.`);
      return year;
    }
    if(profile.precision==='exact-date'){
      const exact=clean(control?.value);
      if(!exact)return'';
      const parts=moduleDateParts(exact);
      if(!parts.year||!parts.month||!parts.day)throw new Error(`${field.label} needs a complete date.`);
      const selected=Number(parts.year)*10000+Number(parts.month)*100+Number(parts.day);
      const current=profile.currentYear*10000+profile.currentMonth*100+profile.currentDay;
      if(profile.range==='past-present'&&selected>current)throw new Error(`${field.label} cannot be in the future.`);
      if(profile.range==='present-future'&&selected<current)throw new Error(`${field.label} cannot be before today.`);
      return exact;
    }
  }
  if(field.type==='boolean'||field.type==='toggle')return control?.checked===true;
  if(field.type==='multiselect')return [...(control?.selectedOptions||[])].map((o)=>o.value);
  if(field.type==='tags')return clean(control?.value).split(',').map(clean).filter(Boolean);
  if(field.type==='number'||field.type==='hours')return clean(control?.value)===''?'':Number(control.value);
  if(field.type==='relationship'){if(field.multiple)return [...(control?.selectedOptions||[])].map((o)=>o.value);return control?.value||'';}
  return control?.value??'';
}
function currentFormData(){ const data={...(editingEntry?.data||{})}; for(const field of (section?.fields||[])){ if(isCoreEntryPropertyKey(field.key))continue; data[field.key]=controlValue(field); } return data; }
function fieldGuidance(field){ return fieldHelperText(field); }
function mediaDescriptor(value){
  if(Array.isArray(value)) return value[0]||null;
  return value||null;
}
function mediaDimensionText(value){
  const item=mediaDescriptor(value);
  const width=Number(item?.width||item?.naturalWidth||0);
  const height=Number(item?.height||item?.naturalHeight||0);
  return width>0&&height>0?`${width} × ${height}`:"";
}
function mediaSelectionMetaMarkup(value,field,pending=false){
  const item=mediaDescriptor(value);
  if(!item)return'';
  const info=fieldClassification(field,item);
  const dimensions=mediaDimensionText(item);
  const bits=[info.label];
  if(item.bytes)bits.push(formatSize(item.bytes));
  if(dimensions)bits.push(dimensions);
  const key=escapeHtml(field.key);
  return `<div class="custom-module-media-selection-meta" data-upload-meta="${key}"><div class="custom-module-media-selection-copy"><span class="custom-module-upload-file-icon">${renderSystemIcon(info.family==='video'?'video':info.family==='image'?'image':'file-text')}</span><span><strong>${escapeHtml(fileName(item,field.label||'Media'))}</strong><small>${escapeHtml(bits.filter(Boolean).join(' · '))}<span data-media-dimensions="${key}">${dimensions?'': ''}</span></small></span></div><span class="custom-module-media-state">${pending?'Ready to upload':'Saved'}</span></div>`;
}
function uploadSelectionMarkup(value,field,pending=false){
  const values=Array.isArray(value)?value:value?[value]:[];
  if(!values.length)return'';
  if(['image','images','gallery'].includes(field.type)){
    const gallery=field.type==='images'||field.type==='gallery';
    const images=values.map((item)=>`<img class="${gallery?'lan-media-gallery-item ':''}lan-image-uploader__image" data-generated-media-preview="image" data-media-key="${escapeHtml(field.key)}" src="${escapeHtml(mediaUrl(item))}" alt="${escapeHtml(field.label||'Image')} preview">`).join('');
    return gallery?`<div class="lan-media-gallery-grid">${images}</div>`:`<div class="custom-module-upload-image-grid">${images}</div>`;
  }
  if(field.type==='video'){
    const item=values[0];
    const source=mediaUrl(item);
    return source?`<div class="custom-module-video-frame" data-media-fit="intrinsic" data-media-ready="false"><video class="custom-module-video-preview" data-generated-media-preview="video" data-media-key="${escapeHtml(field.key)}" controls preload="metadata" src="${escapeHtml(source)}"></video></div>`:'';
  }
  const item=values[0];
  const meta=classifyPortfolioFile(item);
  const source=mediaUrl(item);
  if(meta.family==='audio'&&source) return `<div class="custom-module-file-inline-preview"><audio controls preload="metadata" src="${escapeHtml(source)}"></audio></div>${mediaSelectionMetaMarkup(item,field,item?.pending===true)}`;
  if(meta.family==='pdf'&&source) return `<div class="custom-module-file-inline-preview custom-module-pdf-inline-preview"><iframe title="${escapeHtml(fileName(item,'PDF'))} preview" src="${escapeHtml(source)}"></iframe></div>${mediaSelectionMetaMarkup(item,field,item?.pending===true)}`;
  if(clean(item?.type).startsWith('text/')&&source) return `<div class="custom-module-file-inline-preview custom-module-text-inline-preview"><iframe title="${escapeHtml(fileName(item,'Text file'))} preview" src="${escapeHtml(source)}"></iframe></div>${mediaSelectionMetaMarkup(item,field,item?.pending===true)}`;
  return `<div class="custom-module-upload-file-list">${values.map((item)=>{const info=classifyPortfolioFile(item),name=fileName(item);return `<span class="uploaded-file-card custom-module-upload-file-card"><span class="custom-module-upload-file-icon">${renderSystemIcon(info.family==='video'?'video':info.family==='image'?'image':'file-text')}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(info.label)}${item.bytes?` · ${formatSize(item.bytes)}`:''}</small></span></span>`}).join('')}</div>`;
}
function mediaFieldMarkup(field,value){
  fieldMedia.set(field.key,value??(MULTI_MEDIA_TYPES.has(field.type)?[]:null));
  const accept=fieldAccept(field);
  const multiple=MULTI_MEDIA_TYPES.has(field.type);
  const current=value;
  const hasCurrent=Array.isArray(current)?current.length>0:Boolean(current);
  const imageFamily=['image','images','gallery'].includes(field.type);
  const galleryFamily=field.type==='images'||field.type==='gallery';
  const singleImage=field.type==='image';
  const videoField=field.type==='video';
  const chooseLabel=field.type==='project-file'?'Choose source/project file':multiple?'Choose files':videoField?'Choose video':'Choose file';
  const removeLabel=imageFamily?'Remove image':videoField?'Remove video':'Remove file';
  const key=escapeHtml(field.key);
  const storageHost=`<div data-storage-control-host="${key}"></div>`;
  const heading=`<div class="custom-module-media-heading"><div><strong>${escapeHtml(field.label)}</strong><span>${videoField?'Video':singleImage?'Image':galleryFamily?'Gallery':'Asset'}</span></div><small>${escapeHtml(fieldGuidance(field))}</small></div>`;
  const input=`<input hidden type="file" data-module-file-input="${key}"${accept?` accept="${escapeHtml(accept)}"`:''}${multiple?' multiple':''}>`;
  const actions=`<div class="lan-image-uploader-actions custom-module-media-actions"><button class="editor-primary-button button-compact" type="button" data-upload-trigger="${key}">${hasCurrent?'Replace':'Upload'}</button><button class="editor-danger-button button-compact" type="button" data-clear-media="${key}"${hasCurrent?'':' hidden'}>${removeLabel}</button></div>`;
  if(imageFamily){
    const purpose=galleryFamily?'gallery':'image';
    const ratio=mediaDescriptor(current);
    const width=Number(ratio?.width||0),height=Number(ratio?.height||0);
    const ratioStyle=width>0&&height>0?` style="--lan-media-aspect-ratio:${width/height}"`:'';
    const uploader=`<button class="lan-image-uploader custom-module-canonical-uploader" type="button" data-media-purpose="${purpose}"${singleImage?' data-media-fit="intrinsic"':''} data-media-ready="${singleImage&&hasCurrent?'true':'false'}" data-upload-trigger="${key}"${ratioStyle}><span class="lan-image-uploader__content"${singleImage&&hasCurrent?' hidden':''}><span class="lan-image-uploader__icon">${renderSystemIcon('image')}</span><strong>${escapeHtml(chooseLabel)}</strong><small>${escapeHtml(fieldGuidance(field))}</small></span>${galleryFamily?'':`<span class="lan-image-uploader__preview" data-upload-selection="${key}"${hasCurrent?'':' hidden'}>${uploadSelectionMarkup(current,field,false)}</span>`}</button>`;
    const gallerySelection=galleryFamily?`<div class="lan-media-gallery-selection" data-upload-selection="${key}"${hasCurrent?'':' hidden'}>${uploadSelectionMarkup(current,field,false)}</div>`:'';
    const meta=singleImage?`<div data-upload-meta-host="${key}"${hasCurrent?'':' hidden'}>${mediaSelectionMetaMarkup(current,field,false)}</div>`:'';
    return `<div class="full-field custom-module-media-field" data-media-field="${key}" data-media-purpose="${purpose}">${heading}${uploader}${gallerySelection}${meta}${storageHost}${input}${actions}</div>`;
  }
  if(videoField){
    const selection=`<div class="custom-module-video-selection" data-upload-selection="${key}"${hasCurrent?'':' hidden'}>${uploadSelectionMarkup(current,field,false)}</div>`;
    const emptyZone=`<button class="premium-upload-zone custom-module-file-uploader custom-module-video-empty-zone" type="button" data-video-empty-zone="${key}" data-media-purpose="video" data-upload-trigger="${key}"${hasCurrent?' hidden':''}><span class="upload-symbol">${renderSystemIcon('video')}</span><strong>${escapeHtml(chooseLabel)}</strong><small>${escapeHtml(fieldGuidance(field))}</small></button>`;
    const meta=`<div data-upload-meta-host="${key}"${hasCurrent?'':' hidden'}>${mediaSelectionMetaMarkup(current,field,false)}</div>`;
    return `<div class="full-field custom-module-media-field" data-media-field="${key}" data-media-purpose="video">${heading}${emptyZone}${selection}${meta}${storageHost}${input}${actions}</div>`;
  }
  const assetIcon=field.type==='audio'?'volume-2':'file-text';
  const uploader=`<button class="premium-upload-zone custom-module-file-uploader" type="button" data-media-purpose="asset" data-upload-trigger="${key}"><span class="upload-symbol">${renderSystemIcon(assetIcon)}</span><strong>${escapeHtml(chooseLabel)}</strong><small>${escapeHtml(fieldGuidance(field))}</small></button>`;
  const selection=`<div class="lan-media-file-selection" data-upload-selection="${key}"${hasCurrent?'':' hidden'}>${uploadSelectionMarkup(current,field,false)}</div>`;
  return `<div class="full-field custom-module-media-field" data-media-field="${key}" data-media-purpose="asset">${heading}${uploader}${selection}${storageHost}${input}${actions}</div>`;
}
function fieldLabelMarkup(field){
  return `<span class="custom-module-field__label"><span>${escapeHtml(field.label)}</span></span>`;
}
function fieldHelpMarkup(field){
  return `<small class="custom-module-field__help">${escapeHtml(fieldGuidance(field))}</small>`;
}
async function relationshipFieldMarkup(field,value){
  const options=field.targetModule?await listRelationshipEntries(field.targetModule):[];
  const saved=new Set(Array.isArray(value)?value.map((v)=>typeof v==='object'?v.documentId||v.id:v):[typeof value==='object'?value?.documentId||value?.id:value].filter(Boolean));
  return `<label class="custom-module-field full-field" data-field-kind="relationship">${fieldLabelMarkup(field)}<select data-module-field="${escapeHtml(field.key)}"${field.multiple?' multiple':''}${field.required?' required':''}><option value="">Select…</option>${options.map((item)=>`<option value="${escapeHtml(item.id)}"${saved.has(item.id)?' selected':''}>${escapeHtml(item.title)}${item.meta?` · ${escapeHtml(item.meta)}`:''}</option>`).join('')}</select>${fieldHelpMarkup(field)}</label>`;
}
const MODULE_MONTH_LABELS = Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
function moduleDateParts(value=''){
  const raw=clean(value);
  const match=raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  return match?{raw,year:match[1]||'',month:match[2]||'',day:match[3]||''}:{raw,year:'',month:'',day:''};
}
function moduleDateYearOptions(profile,selectedYear=''){
  const selected=Number(selectedYear)||0;
  const years=[];
  const first=profile.range==='present-future'?profile.currentYear:profile.maxYear;
  const last=profile.range==='present-future'?profile.maxYear:profile.minYear;
  const step=profile.range==='present-future'?1:-1;
  for(let year=first;step>0?year<=last:year>=last;year+=step)years.push(year);
  if(selected&&!years.includes(selected))years.unshift(selected);
  return `<option value="">Select year</option>${years.map((year)=>`<option value="${year}"${year===selected?' selected':''}>${year}</option>`).join('')}`;
}
function moduleDateMonthOptions(profile,selectedYear='',selectedMonth=''){
  const year=Number(selectedYear)||0;
  const selected=Number(selectedMonth)||0;
  return `<option value="">Select month</option>${MODULE_MONTH_LABELS.map((label,index)=>{
    const month=index+1;
    const disabled=(profile.range==='past-present'&&year===profile.currentYear&&month>profile.currentMonth)||(profile.range==='present-future'&&year===profile.currentYear&&month<profile.currentMonth);
    return `<option value="${String(month).padStart(2,'0')}"${month===selected?' selected':''}${disabled?' disabled':''}>${label}</option>`;
  }).join('')}`;
}
function moduleDateInputBounds(profile){
  const today=`${profile.currentYear}-${String(profile.currentMonth).padStart(2,'0')}-${String(profile.currentDay).padStart(2,'0')}`;
  if(profile.range==='past-present')return ` max="${today}"`;
  if(profile.range==='present-future')return ` min="${today}"`;
  return '';
}
function dateFieldMarkup(field,value){
  const profile=moduleDateFieldProfile(section||{},field);
  const parts=moduleDateParts(value);
  const required=field.required?' required':'';
  const key=escapeHtml(field.key);
  if(profile.precision==='month-year'){
    const original=escapeHtml(parts.raw);
    return `<div class="custom-module-field custom-module-date-field" data-field-kind="date" data-module-date-field="${key}" data-module-date-original="${original}" data-date-range="${escapeHtml(profile.range)}">${fieldLabelMarkup(field)}<div class="custom-module-date-grid"><label><span>Month</span><select data-module-date-month="${key}" aria-label="${escapeHtml(field.label)} month"${required}>${moduleDateMonthOptions(profile,parts.year,parts.month)}</select></label><label><span>Year</span><select data-module-date-year="${key}" aria-label="${escapeHtml(field.label)} year"${required}>${moduleDateYearOptions(profile,parts.year)}</select></label></div>${fieldHelpMarkup(field)}</div>`;
  }
  if(profile.precision==='year'){
    return `<label class="custom-module-field" data-field-kind="date">${fieldLabelMarkup(field)}<select data-module-field="${key}" data-module-date-year="${key}"${required}>${moduleDateYearOptions(profile,parts.year)}</select>${fieldHelpMarkup(field)}</label>`;
  }
  return `<label class="custom-module-field" data-field-kind="date">${fieldLabelMarkup(field)}<input data-module-field="${key}" type="date"${required}${moduleDateInputBounds(profile)} value="${escapeHtml(parts.raw)}">${fieldHelpMarkup(field)}</label>`;
}
async function fieldMarkup(field){
  const value=editingEntry?.data?.[field.key];
  if(MEDIA_TYPES.has(field.type))return mediaFieldMarkup(field,value);
  if(field.type==='relationship')return relationshipFieldMarkup(field,value);
  if(field.type==='date')return dateFieldMarkup(field,value);
  const required=field.required?' required':'';
  const common=`data-module-field="${escapeHtml(field.key)}"${required}`;
  const placeholder=field.placeholder?` placeholder="${escapeHtml(field.placeholder)}"`:field.type==='tags'?` placeholder="Add tags separated by commas"`:'';
  let control='';
  let extraClass='';
  if(field.type==='textarea'||field.type==='rich-text'){
    extraClass=' full-field';
    control=`<textarea ${common}${placeholder} rows="${field.type==='rich-text'?7:4}">${escapeHtml(value||'')}</textarea>`;
  }else if(field.type==='select'||field.type==='category'){
    control=field.options?.length?`<select ${common}><option value="">Select…</option>${field.options.map((o)=>`<option value="${escapeHtml(o)}"${clean(value)===clean(o)?' selected':''}>${escapeHtml(o)}</option>`).join('')}</select>`:`<input ${common}${placeholder} value="${escapeHtml(value||'')}">`;
  }else if(field.type==='multiselect'){
    extraClass=' full-field';
    control=`<select ${common} multiple>${(field.options||[]).map((o)=>`<option value="${escapeHtml(o)}"${(Array.isArray(value)?value:[]).includes(o)?' selected':''}>${escapeHtml(o)}</option>`).join('')}</select>`;
  }else if(field.type==='boolean'||field.type==='toggle'){
    return `<label class="custom-module-field custom-module-field--toggle" data-field-kind="${escapeHtml(field.type)}">${fieldLabelMarkup(field)}<span class="custom-module-toggle-row"><input ${common} type="checkbox"${value===true?' checked':''}><span>Enabled</span></span>${fieldHelpMarkup(field)}</label>`;
  }else if(field.type==='tags'){
    control=`<input ${common}${placeholder} value="${escapeHtml((Array.isArray(value)?value:[]).join(', '))}">`;
  }else if(field.type==='hours'){
    control=`<span class="lan-input-with-unit"><input ${common} type="number" min="0.25" step="0.25" inputmode="decimal"${placeholder} value="${escapeHtml(value??'')}"><span aria-hidden="true">hours</span></span>`;
  }else{
    const inputType={number:'number',url:'url',email:'email'}[field.type]||'text';
    control=`<input ${common} type="${inputType}"${placeholder} value="${escapeHtml(value??'')}">`;
  }
  return `<label class="custom-module-field${extraClass}" data-field-kind="${escapeHtml(field.type||'text')}">${fieldLabelMarkup(field)}${control}${fieldHelpMarkup(field)}</label>`;
}
async function legacyRelationshipMarkup(rel){const options=await listRelationshipEntries(rel.targetModule);relationshipOptions.set(rel.key,options);const saved=editingEntry?.relationships?.[rel.key]||[];const ids=new Set(saved.map((x)=>x.documentId));const pseudoField={...rel,type:'relationship'};return `<label class="custom-module-field${rel.multiple?' full-field':''}" data-field-kind="relationship">${fieldLabelMarkup(pseudoField)}<select data-module-relationship="${escapeHtml(rel.key)}"${rel.multiple?' multiple':''}>${!rel.multiple?'<option value="">Select…</option>':''}${options.map((o)=>`<option value="${escapeHtml(o.id)}"${ids.has(o.id)?' selected':''}>${escapeHtml(o.title)}</option>`).join('')}</select><small class="custom-module-field__help">Linked records keep their source module ownership.</small></label>`;}
function renderStudioTabs(){const tabs=moduleStudioTabs(section);const labels={details:'Details',media:'Media','skills-tools':'Skills & Tools',publishing:'Publishing'};$("moduleEntryStudioTabs").innerHTML=tabs.map((tab,i)=>`<button class="workspace-tab${i===0?' is-active':''}" data-entry-studio-tab="${tab}" type="button">${labels[tab]}</button>`).join('');const activate=(tab)=>{document.querySelectorAll('[data-entry-studio-tab]').forEach((b)=>b.classList.toggle('is-active',b.dataset.entryStudioTab===tab));document.querySelectorAll('[data-entry-studio-panel]').forEach((p)=>p.hidden=p.dataset.entryStudioPanel!==tab);};$("moduleEntryStudioTabs").querySelectorAll('button').forEach((b)=>b.addEventListener('click',()=>activate(b.dataset.entryStudioTab)));activate(tabs[0]||'details');}

function renderEntryFoundation() {
  $("moduleEntryShortSummary").value=editingEntry?.shortSummary||"";
  $("moduleEntryDescription").value=editingEntry?.description||"";
  const categoryCapability=section?.entryCapabilities?.category||{enabled:false,options:[]};
  const wrap=$("moduleEntryCategoryWrap"), control=$("moduleEntryCategory");
  const otherWrap=$("moduleEntryCategoryOtherWrap"), otherInput=$("moduleEntryCategoryOther");
  wrap.hidden=categoryCapability.enabled!==true;
  const state=moduleCategoryEntryState(categoryCapability.options||[],editingEntry?.category||"");
  control.innerHTML='<option value="">Select category</option>'+state.options.map((value)=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')+`<option value="${OTHER_CATEGORY_VALUE}">Other Category</option>`;
  control.value=state.selectedValue;
  otherInput.value=state.otherValue;
  otherWrap.hidden=categoryCapability.enabled!==true||!state.showOther;
  control.dispatchEvent(new Event("lan:select-sync",{bubbles:true}));
}
function syncOtherCategoryField(){
  const enabled=section?.entryCapabilities?.category?.enabled===true;
  const otherWrap=$("moduleEntryCategoryOtherWrap"), otherInput=$("moduleEntryCategoryOther");
  const useOther=enabled&&$("moduleEntryCategory").value===OTHER_CATEGORY_VALUE;
  otherWrap.hidden=!useOther;
  if(!useOther) otherInput.value="";
}

function syncGeneratedMediaPreview(root=document){
  const scope=root||document;
  const sync=(node,width,height)=>{
    const w=Number(width)||0,h=Number(height)||0;
    if(!(w>0&&h>0))return;
    const stage=node.closest('[data-media-fit="intrinsic"]');
    if(stage){
      stage.style.setProperty('--lan-media-aspect-ratio',String(w/h));
      stage.dataset.mediaReady='true';
    }
    const key=node.dataset.mediaKey;
    if(key){
      const dimensions=document.querySelector(`[data-media-dimensions="${CSS.escape(key)}"]`);
      if(dimensions)dimensions.textContent=` · ${w} × ${h}`;
    }
  };
  scope.querySelectorAll?.('[data-generated-media-preview="image"]').forEach((image)=>{
    const apply=()=>sync(image,image.naturalWidth,image.naturalHeight);
    if(image.complete&&image.naturalWidth>0)apply();
    else image.addEventListener('load',apply,{once:true});
  });
  scope.querySelectorAll?.('[data-generated-media-preview="video"]').forEach((video)=>{
    const apply=()=>sync(video,video.videoWidth,video.videoHeight);
    if(video.readyState>=1&&video.videoWidth>0)apply();
    else video.addEventListener('loadedmetadata',apply,{once:true});
  });
}
function resetGeneratedMediaPreviewState(key,field){
  const fieldHost=document.querySelector(`[data-media-field="${CSS.escape(key)}"]`);
  if(!fieldHost)return;
  const selection=fieldHost.querySelector(`[data-upload-selection="${CSS.escape(key)}"]`);
  if(selection){selection.innerHTML='';selection.hidden=true;}
  const metaHost=fieldHost.querySelector(`[data-upload-meta-host="${CSS.escape(key)}"]`);
  if(metaHost){metaHost.innerHTML='';metaHost.hidden=true;}
  const intrinsic=fieldHost.querySelector('[data-media-fit="intrinsic"]');
  if(intrinsic){intrinsic.dataset.mediaReady='false';intrinsic.style.removeProperty('--lan-media-aspect-ratio');}
  const imageContent=fieldHost.querySelector('.lan-image-uploader__content');
  if(imageContent)imageContent.hidden=false;
  const videoEmpty=fieldHost.querySelector(`[data-video-empty-zone="${CSS.escape(key)}"]`);
  if(videoEmpty)videoEmpty.hidden=false;
}
function renderPendingMediaSelection(field,value){
  const key=field.key;
  const fieldHost=document.querySelector(`[data-media-field="${CSS.escape(key)}"]`);
  if(!fieldHost)return;
  const selection=fieldHost.querySelector(`[data-upload-selection="${CSS.escape(key)}"]`);
  if(selection){selection.innerHTML=uploadSelectionMarkup(value,field,true);selection.hidden=false;}
  const metaHost=fieldHost.querySelector(`[data-upload-meta-host="${CSS.escape(key)}"]`);
  if(metaHost){metaHost.innerHTML=mediaSelectionMetaMarkup(value,field,true);metaHost.hidden=false;}
  if(field.type==='image'){
    const uploader=fieldHost.querySelector('.custom-module-canonical-uploader');
    if(uploader){uploader.dataset.mediaReady='false';uploader.style.removeProperty('--lan-media-aspect-ratio');}
    const content=fieldHost.querySelector('.lan-image-uploader__content');
    if(content)content.hidden=true;
  }
  if(field.type==='video'){
    const videoEmpty=fieldHost.querySelector(`[data-video-empty-zone="${CSS.escape(key)}"]`);
    if(videoEmpty)videoEmpty.hidden=true;
  }
  syncGeneratedMediaPreview(fieldHost);
}
async function renderGeneratedForm(){
  if(!section)return;
  clearAllPending();
  fieldMedia=new Map();
  const modeWrap=$("moduleEntryModeWrap");
  if(modeWrap)modeWrap.hidden=section.contentMode!=="mixed";
  const profile=moduleEntryStudioProfile(section);
  const form=$("moduleEntryForm");
  if(form) form.dataset.entryComposition=profile.composition;
  $("moduleEntryFormHelp").textContent=`${profile.profileLabel} · sections are composed from this module schema.`;
  renderStudioTabs();
  renderEntryFoundation();

  const groupConfig=[
    {key:'context',sectionId:'moduleEntryContextSection',hostId:'moduleGeneratedContextFields',titleId:'moduleEntryContextTitle',hintId:'moduleEntryContextHint',indexId:'moduleEntryContextIndex'},
    {key:'dates',sectionId:'moduleEntryDateSection',hostId:'moduleGeneratedDateFields',titleId:'moduleEntryDateTitle',hintId:'moduleEntryDateHint',indexId:'moduleEntryDateIndex'}
  ];
  $("moduleEntryIdentityTitle").textContent=profile.labels.identity.title;
  $("moduleEntryIdentityHint").textContent=profile.labels.identity.hint;
  let sectionIndex=1;
  $("moduleEntryIdentityIndex").textContent=String(sectionIndex++).padStart(2,'0');
  for(const group of groupConfig){
    const fields=profile.groups[group.key]||[];
    const wrapper=$(group.sectionId);
    wrapper.hidden=!fields.length;
    $(group.titleId).textContent=profile.labels[group.key].title;
    $(group.hintId).textContent=profile.labels[group.key].hint;
    if(fields.length){
      $(group.indexId).textContent=String(sectionIndex++).padStart(2,'0');
      $(group.hostId).innerHTML=(await Promise.all(fields.map(fieldMarkup))).filter(Boolean).join('');
    }else $(group.hostId).innerHTML='';
  }
  $("moduleEntryNarrativeTitle").textContent=profile.labels.narrative.title;
  $("moduleEntryNarrativeHint").textContent=profile.labels.narrative.hint;
  $("moduleEntryNarrativeIndex").textContent=String(sectionIndex++).padStart(2,'0');
  $("moduleGeneratedNarrativeFields").innerHTML=(await Promise.all(profile.groups.narrative.map(fieldMarkup))).filter(Boolean).join('');

  $("moduleEntryMediaTitle").textContent=profile.labels.media.title;
  $("moduleEntryMediaHint").textContent=profile.labels.media.hint;
  $("moduleGeneratedMediaFields").innerHTML=(await Promise.all(profile.mediaFields.map(fieldMarkup))).filter(Boolean).join('')||'<div class="custom-module-empty custom-module-generated-empty"><strong>No media fields configured</strong><span>This module does not currently require media assets.</span></div>';

  const rels=section.relationships||[];
  $("moduleRelationshipEditor").hidden=!rels.length;
  $("moduleGeneratedRelationships").innerHTML=(await Promise.all(rels.map(legacyRelationshipMarkup))).join('');
  syncCapabilityPickers();
  bindEntryControls();
  syncGeneratedMediaPreview($("moduleGeneratedMediaFields"));
  mountModuleStorageControls();
  syncPublicCompositionGate();
}

function syncModuleDateMonthRange(key){
  const field=section?.fields?.find((item)=>item.key===key);
  if(!field||field.type!=="date")return;
  const profile=moduleDateFieldProfile(section||{},field);
  if(profile.precision!=="month-year")return;
  const yearSelect=document.querySelector(`[data-module-date-year="${CSS.escape(key)}"]`);
  const monthSelect=document.querySelector(`[data-module-date-month="${CSS.escape(key)}"]`);
  if(!yearSelect||!monthSelect)return;
  const previous=monthSelect.value;
  monthSelect.innerHTML=moduleDateMonthOptions(profile,yearSelect.value,previous);
  if(previous&&[...monthSelect.options].some((option)=>option.value===previous&&!option.disabled))monthSelect.value=previous;
  else if(previous)monthSelect.value="";
  monthSelect.dispatchEvent(new Event("lan:select-sync",{bubbles:true}));
}
function storageFamilyForModuleField(field={}){
  if(['image','images','gallery'].includes(field.type))return'image';
  if(['video','audio'].includes(field.type))return'video';
  if(['pdf','document'].includes(field.type))return'document';
  return'file';
}
function mountModuleStorageControls(){
  storageFieldControls.forEach((control)=>control?.destroy?.());
  storageFieldControls.clear();
  for(const field of (section?.fields||[]).filter((item)=>MEDIA_TYPES.has(item.type))){
    const host=document.querySelector(`[data-storage-control-host="${CSS.escape(field.key)}"]`);
    if(!host)continue;
    const access=field.access||(field.type==='project-file'?'admin-only':'public-preview');
    const control=mountStorageFieldControl(host,{family:storageFamilyForModuleField(field),access,value:storageProfileOverrides.get(field.key)||'automatic',onChange:(value)=>storageProfileOverrides.set(field.key,value)});
    if(control)storageFieldControls.set(field.key,control);
  }
}
function bindEntryControls(){
  document.querySelectorAll('[data-module-date-year]').forEach((select)=>select.addEventListener('change',()=>syncModuleDateMonthRange(select.dataset.moduleDateYear)));
  document.querySelectorAll('[data-upload-trigger]').forEach((button)=>button.addEventListener('click',()=>document.querySelector(`[data-module-file-input="${CSS.escape(button.dataset.uploadTrigger)}"]`)?.click()));
  document.querySelectorAll('[data-module-file-input]').forEach((input)=>input.addEventListener('change',()=>{
    const field=section.fields.find((f)=>f.key===input.dataset.moduleFileInput);
    if(!field)return;
    clearPending(field.key);
    const files=[...(input.files||[])];
    if(!files.length)return;
    const accept=fieldAccept(field);
    const bad=files.find((file)=>!isFileAccepted(file,accept)||!validatePortfolioFileDescriptor(file).valid);
    if(bad){notice(`${bad.name} is not a valid file for ${field.label}.`,'error');input.value='';return;}
    const descriptors=files.map((f)=>localFileDescriptor(f,field));
    const value=MULTI_MEDIA_TYPES.has(field.type)?descriptors:descriptors[0];
    pendingMedia.set(field.key,value);
    renderPendingMediaSelection(field,value);
    document.querySelector(`[data-clear-media="${CSS.escape(field.key)}"]`)?.removeAttribute('hidden');
    document.querySelectorAll(`[data-upload-trigger="${CSS.escape(field.key)}"]`).forEach((el)=>{if(el.tagName==='BUTTON'&&el.classList.contains('editor-primary-button'))el.textContent='Replace';});
  }));
  document.querySelectorAll('[data-clear-media]').forEach((button)=>button.addEventListener('click',async()=>{
    const key=button.dataset.clearMedia;
    const current=fieldMedia.get(key);
    const field=section.fields.find((f)=>f.key===key);
    const emptyValue=MULTI_MEDIA_TYPES.has(field?.type)?[]:null;
    if(isTemporaryMediaAsset(current)){
      await discardTemporaryMediaAssets(current,{reason:'custom-module-media-removed-before-save'});
    }else if(current){
      // Explicit removal is atomic for an existing record: clear the persisted reference first,
      // then delete only that field's managed asset. This prevents a saved record from ever
      // pointing at a physically deleted Drive/Cloudinary object.
      if(editingEntry?.id){
        const nextData={...(editingEntry.data||{}),[key]:emptyValue};
        const nextEntry={...editingEntry,data:nextData};
        await saveEntry(nextEntry,editingEntry.id,section);
        editingEntry=nextEntry;
        const index=entries.findIndex((entry)=>entry.id===editingEntry.id);
        if(index>=0)entries[index]=nextEntry;
      }
      await removeManagedMediaAssets(current,{reason:'custom-module-media-explicitly-removed'});
    }
    clearPending(key);
    fieldMedia.set(key,emptyValue);
    resetGeneratedMediaPreviewState(key,field);
    button.hidden=true;
    const input=document.querySelector(`[data-module-file-input="${CSS.escape(key)}"]`);
    if(input)input.value='';
    document.querySelectorAll(`[data-upload-trigger="${CSS.escape(key)}"]`).forEach((el)=>{if(el.tagName==='BUTTON'&&el.classList.contains('editor-primary-button'))el.textContent='Upload';});
  }));
}
async function uploadPendingMedia(data, ownerId){
  for(const field of section.fields.filter((item)=>MEDIA_TYPES.has(item.type))){
    const pending=pendingMedia.get(field.key);
    if(pending===undefined)continue;
    const input=document.querySelector(`[data-module-file-input="${CSS.escape(field.key)}"]`);
    const files=[...(input?.files||[])];
    if(!files.length)continue;
    const uploaded=[];
    const access=field.access||(field.type==='project-file'?'admin-only':'public-preview');
    const storageProfileId=storageProfileOverrides.get(field.key)||'automatic';
    for(const file of files){
      const validation=validatePortfolioFileDescriptor(file);
      if(!validation.valid)throw new Error(`${file.name}: ${validation.reason}`);
      const classification=fieldClassification(field,file);
      const media=await uploadMedia(file,{
        family:classification.family,
        access,
        storageProfileId,
        kind:'asset',
        module:'custom-modules',
        folder:`portfolio-sections/${section.key}/${ownerId}/${field.key}`,
        resourceType:classification.uploadResource||'raw',
        context:{ownerType:'module-entry',moduleId:section.id||section.key,ownerId:ownerId,fieldId:field.key,pageName:section.title||section.key,recordTitle:clean($("moduleEntryTitle")?.value)||ownerId}
      });
      uploaded.push({...media,fileFamily:classification.family,access,sourceAsset:field.type==='project-file'});
    }
    if(MULTI_MEDIA_TYPES.has(field.type)){
      const current=Array.isArray(fieldMedia.get(field.key))?fieldMedia.get(field.key):[];
      data[field.key]=[...current,...uploaded];
      fieldMedia.set(field.key,data[field.key]);
    }else{
      data[field.key]=uploaded[0]||null;
      fieldMedia.set(field.key,data[field.key]);
    }
    clearPending(field.key);
  }
}

function collectLegacyRelationships(){const result={};for(const rel of section.relationships||[]){const select=document.querySelector(`[data-module-relationship="${CSS.escape(rel.key)}"]`);if(!select)continue;const ids=rel.multiple?[...select.selectedOptions].map((o)=>o.value).filter(Boolean):[select.value].filter(Boolean);if(rel.required&&!ids.length)throw new Error(`${rel.label} is required.`);const options=relationshipOptions.get(rel.key)||[];result[rel.key]=ids.map((id)=>({moduleKey:rel.targetModule,documentId:id,label:options.find((x)=>x.id===id)?.title||id}));}return result;}

function entryCategory(entry){return clean(entry.category||entry.data?.[section.display?.categoryField]);}
function filteredEntries(){const query=clean($("moduleEntrySearch").value).toLowerCase(),category=$("moduleEntryCategoryFilter").value,status=$("moduleEntryStatusFilter").value;let list=entries.filter((entry)=>{if(category!=='all'&&entryCategory(entry)!==category)return false;if(status==='published'&&entry.status!=='published')return false;if(status==='draft'&&entry.status==='published')return false;if(status==='visible'&&entry.visible===false)return false;if(status==='hidden'&&entry.visible!==false)return false;if(status==='featured'&&!entry.featured)return false;if(!query)return true;return `${entry.title} ${entry.category} ${entry.shortSummary} ${entry.description}`.toLowerCase().includes(query);});const sort=$("moduleEntrySort").value;if(sort==='timeline')list.sort((a,b)=>{const av=moduleTimelineEntryMeta(section||{},a).sortTime,bv=moduleTimelineEntryMeta(section||{},b).sortTime;if(av!==bv)return bv-av;return (Number(a.displayOrder)||0)-(Number(b.displayOrder)||0);});else if(sort==='title')list.sort((a,b)=>clean(a.title).localeCompare(clean(b.title)));else if(sort==='newest')list.sort((a,b)=>{const av=a.updatedAt?.seconds||0,bv=b.updatedAt?.seconds||0;return bv-av;});else list.sort((a,b)=>(Number(a.displayOrder)||0)-(Number(b.displayOrder)||0));return list;}
function entryCardMediaProfile(entry){
  const resolved=resolveModuleRecordMedia(section||{},entry);
  return {
    field:resolved.coverField||resolved.field||null,
    values:resolved.items.map((item)=>item.asset),
    family:resolved.adminItem?.family||resolved.first?.family||'',
    hasMedia:resolved.hasAsset,
    expectedMedia:resolved.supportsCardMedia,
    resolved
  };
}
function cardMedia(profile,entry={}){
  const fallbackEmblem=renderSystemIcon(resolveModuleAdminIcon(section||{}));
  const fallbackTitle=entry.title||section?.title||'Portfolio entry';
  const resolved=profile?.resolved;
  const kind=resolved?.cardMediaKind||'none';
  if(kind==='none')return'';

  if(kind==='gallery'){
    const items=(resolved.galleryAdminItems||[]).slice(0,4);
    if(!items.length)return'';
    const total=(resolved.galleryAdminItems||[]).length;
    const tiles=items.map((item,index)=>{
      const source=item?.adminUrl||item?.displayUrl||'';
      const fallbackSource=item?.originalUrl||item?.displayUrl||'';
      const more=index===items.length-1&&total>items.length?`<span class="lan-admin-media-card-gallery__more">+${total-items.length}</span>`:'';
      return `<span class="custom-module-entry-card-gallery__tile lan-admin-media-card-gallery__tile lan-admin-media-frame lan-admin-media-frame--gallery">${adminMediaImageLayersMarkup({ src:source, fallbackSrc:fallbackSource&&fallbackSource!==source?fallbackSource:'', alt:`${fallbackTitle} gallery image ${index+1}`, title:fallbackTitle, context:'Gallery', role:'gallery', emblemHtml:fallbackEmblem })}${more}</span>`;
    }).join('');
    return `<div class="custom-module-entry-card-gallery lan-admin-media-card-gallery" data-count="${Math.min(items.length,4)}">${tiles}</div>`;
  }

  if(kind==='comparison'){
    const before=resolved.comparison?.adminBefore||null;
    const after=resolved.comparison?.adminAfter||null;
    if(!before&&!after)return'';
    const renderSide=(item,label)=>{
      const source=item?.adminUrl||item?.displayUrl||'';
      const fallbackSource=item?.originalUrl||item?.displayUrl||'';
      return `<span><span class="lan-admin-media-frame">${adminMediaImageLayersMarkup({ src:source, fallbackSrc:fallbackSource&&fallbackSource!==source?fallbackSource:'', alt:`${fallbackTitle} ${label.toLowerCase()}`, title:fallbackTitle, context:label, role:'comparison', emblemHtml:fallbackEmblem, imageClass:'custom-module-entry-card-image' })}</span><small>${label}</small></span>`;
    };
    return `<div class="custom-module-entry-card-comparison lan-admin-media-card-comparison">${renderSide(before,'Before')}${renderSide(after,'After')}</div>`;
  }

  if(kind==='video'){
    const item=resolved.adminItem||null;
    const source=item?.adminUrl||item?.displayUrl||'';
    if(!source)return'';
    return `<div class="custom-module-entry-card-video-frame"><video class="custom-module-entry-card-video" src="${escapeHtml(source)}" muted loop autoplay playsinline preload="metadata"></video></div>`;
  }

  const item=resolved.adminItem||resolved.adminCoverItem||null;
  const source=item?.adminUrl||item?.displayUrl||'';
  const fallbackSource=item?.originalUrl||item?.displayUrl||'';
  const isCover=Boolean(resolved.coverField);
  const context=isCover?`${section?.title||'Portfolio'} cover`:(resolved.field?.label||'Primary image');
  return `<div class="custom-module-entry-card-cover lan-admin-media-frame lan-admin-media-frame--cover">${adminMediaImageLayersMarkup({ src:source, fallbackSrc:fallbackSource&&fallbackSource!==source?fallbackSource:'', alt:isCover?`${fallbackTitle} cover`:fallbackTitle, title:fallbackTitle, context, role:isCover?'cover':'primary-media', emblemHtml:fallbackEmblem, imageClass:'custom-module-entry-card-image' })}</div>`;
}
function entryCardIdentityMarkup(card,entry){
  const icon=renderSystemIcon(resolveModuleAdminIcon(section||{}));
  return `<div class="custom-module-entry-card-identity"><span class="custom-module-entry-card-icon" aria-hidden="true">${icon}</span><div class="custom-module-entry-card-heading"><small class="custom-module-entry-card-kicker" data-lan-record-identity="context">${escapeHtml(entryCategory(entry)||section.title)}</small><strong data-lan-record-identity="title">${escapeHtml(entry.title||'Untitled entry')}</strong></div></div>`;
}
function entryCardMetadataItemMarkup(item,{meta=false}={}){
  const presentation=item?.presentation||'metadata';
  const occupancy=escapeHtml(item?.occupancy||'balanced');
  const role=escapeHtml(item?.role||'context');
  const label=item?.showLabel!==false&&item?.label?`<small>${escapeHtml(item.label)}</small>`:'';
  const roleAttribute=meta?`data-card-meta-role="${role}"`:`data-card-fact-role="${role}"`;
  if(presentation==='relationship')return `<span class="lan-semantic-chip custom-module-entry-card-relationship" data-semantic-role="relationship" ${roleAttribute} data-card-fact-occupancy="${occupancy}">${label}<b>${escapeHtml(item.value)}</b></span>`;
  return `<span class="custom-module-entry-card-context-item" data-semantic-role="metadata" ${roleAttribute} data-card-fact-occupancy="${occupancy}">${label}<b>${escapeHtml(item.value)}</b></span>`;
}
function entryCardStateMarkup(entry){
  const visibility=entry.visible===false?'hidden':'visible';
  const visibilityLabel=entry.visible===false?'Hidden':'Visible';
  return `<span class="custom-module-entry-card-states">${statusBadge(entry.status)}<span class="lan-semantic-chip" data-semantic-role="visibility" data-semantic-state="${visibility}">${visibilityLabel}${entry.featured?' · Featured':''}</span></span>`;
}
function entryCardMetaMarkup(card){
  const meta=card?.meta||[];
  if(!meta.length)return'';
  return `<div class="custom-module-entry-card-context custom-module-entry-card-context--editorial" data-lan-record-overflow-group="metadata">${meta.map((item)=>entryCardMetadataItemMarkup(item,{meta:true})).join('')}</div>`;
}
function entryCardFactsMarkup(card,{excludeRoles=[]}={}){
  const excluded=new Set(excludeRoles);
  const facts=(card?.facts||[]).filter((fact)=>!excluded.has(fact.role));
  if(!facts.length)return'';
  return `<div class="custom-module-entry-card-context custom-module-entry-card-context--facts" data-lan-record-overflow-group="secondary">${facts.map((fact)=>entryCardMetadataItemMarkup(fact)).join('')}</div>`;
}
function entryCardTagsMarkup(card){
  const values=card?.tags||[];
  return values.length?`<div class="custom-module-entry-card-tags" data-lan-record-overflow-group="tags">${values.map((value)=>`<span class="lan-semantic-chip" data-semantic-role="tag">${escapeHtml(value)}</span>`).join('')}</div>`:'';
}
function entryCardCapabilitiesMarkup(card){
  const values=card?.capabilities||[];
  if(!values.length)return'';
  const items=values.map((item)=>{
    const icon=typeof window.LANSkillIconMarkup==='function'?window.LANSkillIconMarkup(item.label,item.category,item.icon,item.recordType):'';
    return `<span class="custom-module-entry-card-capability lan-semantic-chip" data-semantic-role="capability" data-capability-type="${escapeHtml(item.recordType||'capability')}">${icon?`<i>${icon}</i>`:''}<b>${escapeHtml(item.label)}</b></span>`;
  }).join('');
  return `<div class="custom-module-entry-card-capabilities" data-lan-record-overflow-group="capabilities">${items}</div>`;
}
function renderGeneratedEntryCard(entry){
  const card=composeGeneratedAdminCard(section||{},entry,{capabilities});
  const media=entryCardMediaProfile(entry);
  const mediaMarkup=cardMedia(media,entry);
  const traits=card.traits.join(' ');
  const deck=card.deck?`<p class="custom-module-entry-card-deck" data-lan-record-summary="true">${escapeHtml(card.deck)}</p>`:'';
  const summary=card.summary?`<p class="custom-module-entry-card-summary" data-lan-record-summary="true">${escapeHtml(card.summary)}</p>`:'';
  const footprint=mediaMarkup?(card.footprint||'schema-media'):'schema-content';
  const mediaState=mediaMarkup?`<div class="custom-module-entry-card-media-state">${entryCardStateMarkup(entry)}</div>`:'';
  const contentState=mediaMarkup?'':entryCardStateMarkup(entry);
  return `<article data-lan-record-card="true" data-lan-record-library-card="true" data-lan-record-footprint="${escapeHtml(footprint)}" data-lan-record-flow="grid" data-lan-record-has-media="${mediaMarkup?'true':'false'}" class="custom-module-entry-card${entry.duplicateRootEntryId?' is-duplicate':''}${mediaMarkup?' has-media':''}${media.field&&['images','gallery'].includes(media.field.type)?' has-gallery':''}${editingEntry?.id===entry.id?' is-selected':''}" data-entry-card="${escapeHtml(entry.id)}" data-card-profile="${escapeHtml(card.profile)}" data-card-traits="${escapeHtml(traits)}">${mediaMarkup?`<div class="custom-module-entry-card-media" data-lan-record-media="true">${mediaMarkup}${mediaState}</div>`:''}<div class="custom-module-entry-card-content" data-lan-record-content="true"><div class="custom-module-entry-card-primary"><header>${entryCardIdentityMarkup(card,entry)}${contentState}</header>${deck}${summary}</div><div class="custom-module-entry-card-secondary" data-lan-record-overflow-region="secondary">${entryCardMetaMarkup(card)}${entryCardFactsMarkup(card)}${entryCardCapabilitiesMarkup(card)}${entryCardTagsMarkup(card)}</div></div><footer data-lan-record-actions="true">${entryActionMarkup(entry)}</footer></article>`;
}
function isTimelineWorkspace(){return moduleTimelineProfile(section||{}).enabled;}
function formatTimelineDate(value){
  const raw=clean(value);
  if(!raw)return'';
  if(/^\d{4}$/.test(raw))return raw;
  if(/^\d{4}-\d{2}$/.test(raw)){
    const [year,month]=raw.split('-').map(Number);
    const parsed=new Date(year,Math.max(0,month-1),1);
    return new Intl.DateTimeFormat(undefined,{month:'short',year:'numeric'}).format(parsed);
  }
  const parsed=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T00:00:00`:raw);
  if(Number.isNaN(parsed.getTime()))return raw;
  return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(parsed);
}
function timelineDateLabel(entry){
  const meta=moduleTimelineEntryMeta(section||{},entry);
  const start=formatTimelineDate(meta.start),end=formatTimelineDate(meta.end);
  return {meta,label:start&&end&&meta.end!==meta.start?`${start} – ${end}`:(start||end||'Undated')};
}
function entryActionMarkup(entry){return `<span class="lan-record-command-group" data-lan-record-command-group="true"><button class="editor-secondary-button button-compact" data-preview-entry="${escapeHtml(entry.id)}" type="button">Preview</button><button class="editor-secondary-button button-compact" data-edit-entry="${escapeHtml(entry.id)}" type="button">Edit</button><button class="editor-secondary-button button-compact" data-duplicate-entry="${escapeHtml(entry.id)}" type="button">Duplicate</button><button class="editor-danger-button button-compact" data-delete-entry="${escapeHtml(entry.id)}" type="button">Delete</button></span>`;}
function renderTimelineEntryCard(entry){
  const {meta,label}=timelineDateLabel(entry);
  const card=composeGeneratedAdminCard(section||{},entry,{capabilities});
  const summary=card.summary?`<p class="custom-module-entry-card-summary">${escapeHtml(card.summary)}</p>`:'';
  const traits=[...new Set(['chronology',...card.traits])].join(' ');
  const deck=card.deck?`<p class="custom-module-entry-card-deck">${escapeHtml(card.deck)}</p>`:'';
  return `<article class="custom-module-entry-card custom-module-timeline-entry${entry.duplicateRootEntryId?' is-duplicate':''}${editingEntry?.id===entry.id?' is-selected':''}" data-entry-card="${escapeHtml(entry.id)}" data-card-profile="chronology" data-card-traits="${escapeHtml(traits)}"><div class="custom-module-timeline-entry__rail" aria-hidden="true"><span></span></div><div class="custom-module-timeline-entry__content"><div class="custom-module-timeline-entry__date"><strong>${escapeHtml(meta.year||'—')}</strong><span>${escapeHtml(label)}</span></div><div class="custom-module-timeline-entry__panel"><div class="custom-module-entry-card-primary"><header>${entryCardIdentityMarkup(card,entry)}${entryCardStateMarkup(entry)}</header>${deck}${summary}</div><div class="custom-module-entry-card-secondary">${entryCardMetaMarkup(card)}${entryCardFactsMarkup(card,{excludeRoles:['start-date','end-date','chronology-period']})}${entryCardCapabilitiesMarkup(card)}${entryCardTagsMarkup(card)}</div><footer>${entryActionMarkup(entry)}</footer></div></div></article>`;
}
function syncTimelineWorkspaceUi(){
  const timeline=isTimelineWorkspace();
  const primary=$('moduleGridView'),sort=$('moduleEntrySort');
  if(primary){primary.textContent=timeline?'Timeline':'Grid';primary.setAttribute('aria-label',timeline?'Timeline view':'Grid view');}
  if(sort){
    let option=sort.querySelector('option[value="timeline"]');
    if(timeline&&!option){option=document.createElement('option');option.value='timeline';option.textContent='Timeline date';sort.insertBefore(option,sort.firstChild);}
    if(!timeline&&option)option.remove();
    if(timeline&&(sort.value==='order'||!sort.value))sort.value='timeline';
    if(!timeline&&sort.value==='timeline')sort.value='order';
  }
  if(timeline&&entryView==='grid')entryView='timeline';
  if(!timeline&&entryView==='timeline')entryView='grid';
  primary?.classList.toggle('is-active',timeline?entryView==='timeline':entryView==='grid');
  $('moduleListView')?.classList.toggle('is-active',entryView==='list');
}
function renderEntrySummary() {
  $("moduleTotalCount").textContent = String(entries.length);
  $("moduleFeaturedCount").textContent = String(entries.filter((entry) => entry.featured === true).length);
  $("modulePublishedCount").textContent = String(entries.filter((entry) => entry.status === "published").length);
  $("moduleDraftCount").textContent = String(entries.filter((entry) => entry.status !== "published").length);
  $("moduleVisibleCount").textContent = String(entries.filter((entry) => entry.visible !== false).length);
  $("moduleHiddenCount").textContent = String(entries.filter((entry) => entry.visible === false).length);
}
function renderEntryCategoryFilter() {
  const control = $("moduleEntryCategoryFilter");
  const wrap = $("moduleEntryCategoryFilterWrap");
  const enabled = section?.entryCapabilities?.category?.enabled === true;
  if (wrap) wrap.hidden = !enabled;
  const filters=document.querySelector('.custom-module-filters');
  if(filters)filters.dataset.hasCategory=enabled?'true':'false';
  const current = control.value || "all";
  const categories = enabled ? [...new Set([...(section?.entryCapabilities?.category?.options||[]),...entries.map(entryCategory)].filter(Boolean))].sort((a, b) => a.localeCompare(b)) : [];
  control.innerHTML = `<option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  control.value = categories.includes(current) ? current : "all";
}
async function synchronizeModuleLifecycleAfterPaint(targetKey, snapshotEntries, generation) {
  try {
    const hydratedSection = await recordModuleMaturityHydration(targetKey, { sessionId:MODULE_RUNTIME_SESSION_ID, entries:snapshotEntries });
    if (generation !== lifecycleSyncGeneration || section?.key !== targetKey) return;
    if (hydratedSection) section = hydratedSection;
    const promotion = await evaluateAutomaticPromotion(targetKey);
    if (generation !== lifecycleSyncGeneration || section?.key !== targetKey) return;
    if (promotion?.status?.section) section = promotion.status.section;
    if (promotion?.promoted) {
      applySectionIdentity();
      notice('Current structural revision completed maturity checks and was automatically promoted.');
    }
    syncPublicCompositionGate();
    renderPromotedAdminPreview();
    renderReadiness();
  } catch (evidenceError) {
    console.warn('Module maturity evidence could not be synchronized.', evidenceError);
  }
}

function scheduleModuleLifecycleSync(targetKey = section?.key, snapshotEntries = entries) {
  const key = clean(targetKey);
  if (!key) return;
  const generation = ++lifecycleSyncGeneration;
  const values = Array.isArray(snapshotEntries) ? [...snapshotEntries] : [];
  const run = () => synchronizeModuleLifecycleAfterPaint(key, values, generation);
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout:900 });
  else window.requestAnimationFrame(() => window.setTimeout(run, 0));
}

async function refreshEntries() {
  const host = $("moduleEntryList");
  host.setAttribute("aria-busy", "true");
  host.innerHTML = '<div class="custom-module-empty"><strong>Loading entries…</strong><span>Reading the current module library.</span></div>';
  try {
    entries = await listEntries(section.key, section);
    if (editingEntry) editingEntry = entries.find((entry) => entry.id === editingEntry.id) || null;
    renderEntrySummary();
    renderEntryCategoryFilter();
    renderEntryList();
    syncPublicCompositionGate();
    renderPromotedAdminPreview();
    renderReadiness();
    $("moduleSaveStatus").textContent = "Loaded";
    scheduleModuleLifecycleSync(section.key, entries);
    return true;
  } catch (error) {
    entries = [];
    editingEntry = null;
    recordModuleRuntimeFailure(section?.key, error).catch(()=>{});
    renderEntrySummary();
    renderEntryCategoryFilter();
    host.innerHTML = `<div class="custom-module-empty is-error"><strong>Entries could not be loaded</strong><span>${escapeHtml(error?.message || "Try again after checking the connection.")}</span></div>`;
    renderPromotedAdminPreview();
    renderReadiness();
    $("moduleSaveStatus").textContent = "Load error";
    notice(error?.message || "Unable to load module entries.", "error");
    return false;
  } finally {
    host.setAttribute("aria-busy", "false");
  }
}

async function bulkPatch(ids,patch){for(const id of ids){const entry=entries.find((x)=>x.id===id);if(!entry)continue;await saveEntry({...entry,...patch},id,section);}await refreshEntries();}
async function openNewEntry(){
  await ensureEntryStudioDependencies();
  await clearEntry();
  openEntryEditor('create');
}
function resetEntryFilters(){
  $("moduleEntrySearch").value='';
  $("moduleEntryCategoryFilter").value='all';
  $("moduleEntryStatusFilter").value='all';
  $("moduleEntrySort").value=isTimelineWorkspace()?'timeline':'order';
  entryPage=1;
  renderEntryList();
}
function renderEntryList(){
  const list=filteredEntries();
  const pageState=recordLibraryPageSlice(list,entryPage,entryPageSize);
  const pages=pageState.totalPages;
  entryPage=pageState.currentPage;
  const visible=pageState.items;
  const host=$("moduleEntryList");
  const timelineView=isTimelineWorkspace()&&entryView==='timeline';
  applyRecordLibraryView(host, entryView==='list'?'list':'grid');
  host.classList.toggle('is-timeline-view',timelineView);
  if(visible.length){
    host.innerHTML=timelineView?visible.map(renderTimelineEntryCard).join(''):visible.map(renderGeneratedEntryCard).join('');
  }else if(entries.length){
    host.innerHTML=`<div class="custom-module-empty custom-module-library-empty"><span class="custom-module-library-empty__icon">${renderSystemIcon('search')}</span><div><strong>No matching entries</strong><span>Nothing matches the current search or filters.</span></div><button class="editor-secondary-button" data-empty-clear-filters type="button">Clear filters</button></div>`;
  }else{
    host.innerHTML=`<div class="custom-module-empty custom-module-library-empty"><span class="custom-module-library-empty__icon">${renderSystemIcon(resolveModuleAdminIcon(section||{}))}</span><div><strong>No entries yet</strong><span>${usesRecordWorkspace()?'Use the workspace Add action to create the first record.':`Create the first ${escapeHtml(section?.title||'module')} entry using this module blueprint.`}</span></div>${usesRecordWorkspace()?'':'<button class="editor-primary-button" data-empty-add-entry type="button">+ Add first entry</button>'}</div>`;
  }
  const modulePagination=document.querySelector('.custom-module-pagination');
  modulePagination.hidden = list.length === 0 || pages <= 1;
  $("modulePageInfo").textContent=`Page ${entryPage} of ${pages}`;
  $("modulePrevPage").disabled=entryPage<=1;
  $("moduleNextPage").disabled=entryPage>=pages;
  const capabilities=moduleRecordBulkCapabilities(section||{});
  window.LANCreateRecordSelection?.(host,{cardSelector:'.custom-module-entry-card',idAttribute:'data-entry-card',actionSelector:'footer',label:'entry',records:entries,capabilities,onBulkPatch:(ids,patch)=>bulkPatch(ids,patch),onDelete:capabilities.deletion?async(ids)=>{for(const id of ids)await deleteEntry(id);if(editingEntry&&ids.includes(editingEntry.id))await clearEntry();await refreshEntries();}:null})?.sync();
  host.querySelectorAll('[data-preview-entry]').forEach((button)=>button.addEventListener('click',()=>previewEntry(button.dataset.previewEntry)));
  host.querySelectorAll('[data-edit-entry]').forEach((button)=>button.addEventListener('click',()=>editEntry(button.dataset.editEntry)));
  host.querySelectorAll('[data-duplicate-entry]').forEach((button)=>button.addEventListener('click',()=>duplicateEntryById(button.dataset.duplicateEntry)));
  host.querySelectorAll('[data-delete-entry]').forEach((button)=>button.addEventListener('click',()=>deleteEntryById(button.dataset.deleteEntry)));
  host.querySelector('[data-empty-add-entry]')?.addEventListener('click',openNewEntry);
  host.querySelector('[data-empty-clear-filters]')?.addEventListener('click',resetEntryFilters);
}
async function editEntry(id){await ensureEntryStudioDependencies();editingEntry=entries.find((e)=>e.id===id)||null;if(!editingEntry)return;$("moduleEntryId").value=editingEntry.id;$("moduleEntryTitle").value=editingEntry.title||editingEntry.data?.title||"";$("moduleEntrySlug").value=editingEntry.slug||moduleSlug(editingEntry.title||"");entrySlugManual=Boolean(editingEntry.slug);$("moduleEntrySystemId").textContent=editingEntry.id||"New entry";$("moduleEntryCreatedAt").textContent=formatEntryTimestamp(editingEntry.createdAt);$("moduleEntryUpdatedAt").textContent=formatEntryTimestamp(editingEntry.updatedAt);$("moduleEntryFormTitle").textContent=`Edit ${editingEntry.title||'Entry'}`;$("moduleEntryStatus").value=editingEntry.status||'draft';$("moduleEntryOrder").value=editingEntry.displayOrder??0;$("moduleEntryVisible").checked=editingEntry.visible!==false;$("moduleEntryFeatured").checked=editingEntry.featured===true;$("moduleEntryMode").value=editingEntry.entryMode||(section.contentMode==='linked'?'linked':'standalone');selectedSkillIds=new Set(editingEntry.skillIds||editingEntry.data?.skills||[]);selectedToolIds=new Set(editingEntry.toolIds||editingEntry.data?.tools||[]);$("deleteModuleEntry").hidden=false;await renderGeneratedForm();renderEntryList();openEntryEditor('edit');$("moduleEntryForm").scrollIntoView({behavior:'smooth',block:'start'});}
async function clearEntry({renderForm=true}={}){storageProfileOverrides.clear();await discardTemporaryMediaAssets([...fieldMedia.values()],{reason:'custom-module-entry-cancelled'});editingEntry=null;$("moduleEntryId").value='';$("moduleEntryTitle").value='';$("moduleEntrySlug").value='';entrySlugManual=false;$("moduleEntrySystemId").textContent='New entry';$("moduleEntryCreatedAt").textContent='After first save';$("moduleEntryUpdatedAt").textContent='After first save';$("moduleEntryFormTitle").textContent='New Entry';$("moduleEntryStatus").value='draft';$("moduleEntryOrder").value='0';$("moduleEntryVisible").checked=true;$("moduleEntryFeatured").checked=false;$("moduleEntryMode").value=section?.contentMode==='linked'?'linked':'standalone';selectedSkillIds=new Set();selectedToolIds=new Set();$("deleteModuleEntry").hidden=true;if(renderForm)await renderGeneratedForm();renderEntryList();}
async function submitEntry(event){event.preventDefault();const form=event.currentTarget;if(window.LANValidateForm?!window.LANValidateForm(form,{title:'Complete Module Entry'}):!form.reportValidity())return;const submit=event.submitter;try{if(submit)submit.disabled=true;const data=currentFormData();const existingId=clean($("moduleEntryId").value);const reservedId=existingId||reserveEntryId();if(!existingId)$("moduleEntryId").value=reservedId;await uploadPendingMedia(data,reservedId);for(const field of section.fields){if(isCoreEntryPropertyKey(field.key))continue;const value=data[field.key],missing=value===''||value===null||value===undefined||(Array.isArray(value)&&!value.length);if(field.required&&missing)throw new Error(`${field.label} is required.`);} const relationships=collectLegacyRelationships(); const entryMode=section.contentMode==='mixed'?$("moduleEntryMode").value:section.contentMode;const title=clean($("moduleEntryTitle").value);const slug=clean($("moduleEntrySlug").value)||moduleSlug(title);const shortSummary=clean($("moduleEntryShortSummary").value);const description=clean($("moduleEntryDescription").value);const categoryEnabled=section.entryCapabilities?.category?.enabled===true;const category=categoryEnabled?resolveModuleEntryCategory($("moduleEntryCategory").value,$("moduleEntryCategoryOther").value):clean(editingEntry?.category);if(categoryEnabled&&$("moduleEntryCategory").value===OTHER_CATEGORY_VALUE&&!category)throw new Error('Specify category is required when Other Category is selected.');const foundationData={title,slug,shortSummary,description};if(categoryEnabled){foundationData.category=category;const categoryKey=section.entryCapabilities?.category?.key||'category';foundationData[categoryKey]=category;}const skillIds=section.entryCapabilities?.skills===true?[...selectedSkillIds]:[...(editingEntry?.skillIds||[])];const toolIds=section.entryCapabilities?.tools===true?[...selectedToolIds]:[...(editingEntry?.toolIds||[])];const record={sectionKey:section.key,entryMode,title,slug,shortSummary,description,category,data:{...data,...foundationData},relationships,skillIds,toolIds,status:$("moduleEntryStatus").value,visible:$("moduleEntryVisible").checked,featured:$("moduleEntryFeatured").checked,displayOrder:Number($("moduleEntryOrder").value)||0};const id=await saveEntry(record,reservedId,section,{maturityEvidence:true,sessionId:MODULE_RUNTIME_SESSION_ID,reservedCreate:!existingId});const refreshed=await refreshEntries();if(refreshed){if(moduleRecordWorkspace){await clearEntry();moduleRecordWorkspace.showIdle();}else await editEntry(id);}$("moduleSaveStatus").textContent=refreshed?'Saved':'Saved · refresh needed';notice(refreshed?'Entry saved.':'Entry saved, but the library could not refresh.',refreshed?'success':'warning');}catch(error){notice(error.message||'Entry could not be saved.','error');}finally{if(submit)submit.disabled=false;}}
async function duplicateEntryById(id){const entry=entries.find((item)=>item.id===id);if(!entry)return;try{await duplicateEntry(id,section);await refreshEntries();notice(`${entry.title||'Entry'} duplicated.`);}catch(error){notice(error.message||'Entry could not be duplicated.','error');}}
async function deleteCurrentEntry(){if(!editingEntry)return;await deleteEntryById(editingEntry.id,true);}
async function deleteEntryById(id,clearAfter=false){const entry=entries.find((item)=>item.id===id);if(!entry)return;const yes=await(window.LANConfirm?.({title:'Delete entry?',message:`Delete ${entry.title||'this entry'}? This cannot be undone.`,confirmLabel:'Delete entry',danger:true})??Promise.resolve(confirm('Delete entry?')));if(!yes)return;await deleteEntry(id);if(clearAfter||editingEntry?.id===id)await clearEntry();await refreshEntries();notice('Entry deleted.');}
let entryPreviewReturnFocus=null;
function isEmptyPreviewValue(value){return value===undefined||value===null||value===''||(Array.isArray(value)&&value.length===0);}
function previewDisplayText(value){
  if(value===true)return'Yes';
  if(value===false)return'No';
  if(Array.isArray(value))return value.map((item)=>previewDisplayText(item)).filter(Boolean).join(', ');
  if(typeof value==='object')return clean(value.label||value.title||value.name||value.displayName||value.originalFilename||'Saved value');
  return clean(value);
}
function previewMediaItems(value,label='Media'){
  return (Array.isArray(value)?value:[value]).filter(Boolean).map((item,index)=>({src:mediaUrl(item),alt:`${label} ${index+1}`})).filter((item)=>item.src);
}
function shouldEmbedPreviewDocument(){
  return section?.workspaceTraits?.documentDominant === true && section?.workspaceTraits?.recordWorkspace === true;
}
function previewMediaBlock(field,value){
  const values=(Array.isArray(value)?value:[value]).filter(Boolean);
  const items=previewMediaItems(value,field.label||humanizeRuntimeLabel(field.key));
  if(!items.length)return null;
  const title=field.label||humanizeRuntimeLabel(field.key);
  const previewRole=resolveModuleFieldSemanticRole(field);
  const semantics=previewRole==='auto'?{}:{semanticRole:previewRole};
  if(['images','gallery'].includes(field.type))return{type:ADMIN_PREVIEW_BLOCK_TYPES.GALLERY,title,items,...semantics};
  if(field.type==='image')return{type:ADMIN_PREVIEW_BLOCK_TYPES.IMAGE,src:items[0].src,alt:items[0].alt,...semantics};
  if(field.type==='video')return{type:ADMIN_PREVIEW_BLOCK_TYPES.VIDEO,title,src:items[0].src,...semantics};
  if(field.type==='audio')return{type:ADMIN_PREVIEW_BLOCK_TYPES.AUDIO,title,src:items[0].src,...semantics};
  const asPreviewFile=(item)=>({...(item&&typeof item==='object'?item:{}),label:fileName(item,title),href:mediaUrl(item)});
  const documentValue=values.find((item)=>field.type==='pdf'||item?.fileFamily==='pdf'||clean(item?.mimeType||item?.mime).toLowerCase()==='application/pdf'||/\.pdf$/i.test(fileName(item,'')));
  if((documentValue&&['pdf','document','file'].includes(field.type))||previewRole==='document'){
    const selected=documentValue||values[0];
    if(shouldEmbedPreviewDocument())return{type:ADMIN_PREVIEW_BLOCK_TYPES.DOCUMENT,title,src:mediaUrl(selected),file:asPreviewFile(selected),...semantics};
    return{type:ADMIN_PREVIEW_BLOCK_TYPES.FILES,title,items:[asPreviewFile(selected)],...semantics};
  }
  return{type:ADMIN_PREVIEW_BLOCK_TYPES.FILES,title,items:values.map((item)=>asPreviewFile(item)),...semantics};
}
function previewCapabilityBlocks(entry,{semantic=false}={}){
  if(semantic){
    const items=[];
    for(const [recordType,ids] of [['skill',entry.skillIds||[]],['tool',entry.toolIds||[]]]){
      ids.forEach((id)=>{const record=capabilities.find((item)=>item.id===id);const name=clean(record?.name||record?.title||record?.label||id);if(name)items.push({name,category:clean(record?.category),icon:clean(record?.icon),recordType});});
    }
    return items.length?[{type:ADMIN_PREVIEW_BLOCK_TYPES.CHIPS,role:'capabilities',title:'Skills & Tools',items}]:[];
  }
  const blocks=[];
  for(const [title,ids] of [['Skills',entry.skillIds||[]],['Tools',entry.toolIds||[]]]){
    const names=ids.map((id)=>{const record=capabilities.find((item)=>item.id===id);return clean(record?.name||record?.title||record?.label||id);}).filter(Boolean);
    if(names.length)blocks.push({type:ADMIN_PREVIEW_BLOCK_TYPES.CHIPS,title,items:names});
  }
  return blocks;
}
function previewComparisonBlock(fields,entry){
  const beforeField=fields.find((field)=>resolveModuleFieldSemanticRole(field)==='comparison-before');
  const afterField=fields.find((field)=>resolveModuleFieldSemanticRole(field)==='comparison-after');
  if(!beforeField||!afterField)return null;
  const before=previewMediaItems(entry.data?.[beforeField.key],beforeField.label||'Before')[0];
  const after=previewMediaItems(entry.data?.[afterField.key],afterField.label||'After')[0];
  if(!before?.src||!after?.src)return null;
  return{type:ADMIN_PREVIEW_BLOCK_TYPES.COMPARISON,title:'Before & After',before,after,semanticRole:'comparison'};
}
function previewRelationshipBlocks(entry){
  const relationships=entry.relationships&&typeof entry.relationships==='object'?entry.relationships:{};
  return Object.entries(relationships).map(([key,value])=>{
    if(isEmptyPreviewValue(value))return null;
    const definition=(section.relationships||[]).find((item)=>item.key===key);
    const values=(Array.isArray(value)?value:[value]).map(previewDisplayText).filter(Boolean);
    return values.length?{type:ADMIN_PREVIEW_BLOCK_TYPES.CHIPS,title:definition?.label||humanizeRuntimeLabel(key),items:values}:null;
  }).filter(Boolean);
}
function openEntryPreview(entry){
  const inline=Boolean(moduleRecordWorkspace);
  const modal=$('moduleEntryPreviewModal');
  const body=inline?$('moduleRecordPreviewBody'):$('moduleEntryPreviewBody');
  if(!body||(!inline&&!modal))return;
  entryPreviewReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const entryTitle=clean(entry.title||entry.data?.title)||'Untitled entry';
  const status=entry.status==='published'?'Published':'Draft';
  const visibility=entry.visible===false?'Hidden':'Visible';
  if(inline){
    const inlineTitle=$('moduleRecordPreviewTitle');
    if(inlineTitle)inlineTitle.textContent=entryTitle;
  }else{
    $('moduleEntryPreviewTitle').textContent=entryTitle;
    $('moduleEntryPreviewMeta').textContent=[section?.title,status,visibility,entry.featured?'Featured':''].filter(Boolean).join(' · ');
  }

  const schemaFields=(section.fields||[]).filter((field)=>!isCoreEntryPropertyKey(field.key));
  const fields=schemaFields.filter((field)=>!isEmptyPreviewValue(entry.data?.[field.key]));
  const dataFields=fields.filter((field)=>!MEDIA_TYPES.has(field.type));
  const semanticFields=fields;
  const semanticPreview=semanticFields.length>0;
  const resolvedMedia=resolveModuleRecordMedia(section||{},entry);
  const coverFieldKey=clean(resolvedMedia.coverField?.key);
  const mediaFields=fields.filter((field)=>MEDIA_TYPES.has(field.type)&&clean(field.key)!==coverFieldKey);
  const comparisonBlock=semanticPreview?previewComparisonBlock(mediaFields,entry):null;
  const comparisonKeys=new Set(comparisonBlock?mediaFields.filter((field)=>['comparison-before','comparison-after'].includes(resolveModuleFieldSemanticRole(field))).map((field)=>field.key):[]);
  const mediaBlocks=mediaFields.filter((field)=>!comparisonKeys.has(field.key)).map((field)=>previewMediaBlock(field,entry.data?.[field.key])).filter(Boolean);
  if(comparisonBlock)mediaBlocks.unshift(comparisonBlock);

  // Preview hero ownership comes from the same canonical record-media resolver
  // as Admin cards and Public. Secondary media never gets promoted into Cover.
  const coverItem=resolvedMedia.adminCoverItem||null;
  const coverSource=coverItem?.detailUrl||coverItem?.adminUrl||coverItem?.displayUrl||'';
  const coverFallbackSource=coverItem?.originalUrl||coverItem?.displayUrl||'';
  const primaryMedia=resolvedMedia.supportsCover?{
    type:ADMIN_PREVIEW_BLOCK_TYPES.IMAGE,
    src:coverSource,
    fallbackSrc:coverFallbackSource&&coverFallbackSource!==coverSource?coverFallbackSource:'',
    alt:`${entryTitle} cover`,
    title:'Cover',
    semanticRole:'cover',
    fallback:!coverSource
  }:null;
  const summary=clean(entry.shortSummary);
  const description=clean(entry.description);
  const semanticRoles=new Set(semanticFields.map((field)=>resolveModuleFieldSemanticRole(field)));
  const capabilityBlocks=previewCapabilityBlocks(entry,{semantic:true});
  const hasNarrativeSignal=Boolean(summary||description||dataFields.some((field)=>['textarea','rich-text'].includes(field.type)));
  let identityRole='';
  if(semanticPreview){
    if(comparisonBlock||semanticRoles.has('gallery')||(section?.contentIntent==='showcase'&&semanticRoles.has('primary-media')))identityRole='creative-work';
    else if(semanticRoles.has('primary-media')&&hasNarrativeSignal)identityRole='work';
  }
  const blocks=[{
    type:ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY,
    ...(identityRole?{role:identityRole}:{}),
    title:entryTitle,
    eyebrow:clean(section?.title)||'Custom Module',
    chips:[status,visibility,entry.featured?'Featured':''].filter(Boolean)
  }];
  if(primaryMedia)blocks.push(primaryMedia);

  if(summary||description)blocks.push({type:ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW,title:'Overview',lead:summary&&summary!==description?summary:'',body:description||(!summary?'':summary)});

  const facts=[];
  const narratives=[];
  const chipGroups=[];
  for(const field of dataFields){
    const value=entry.data?.[field.key];
    const label=field.label||humanizeRuntimeLabel(field.key);
    const previewRole=resolveModuleFieldSemanticRole(field);
    if(['textarea','rich-text'].includes(field.type)){
      const text=previewDisplayText(value);
      if(text)narratives.push({type:ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW,title:label,body:text,...(previewRole==='auto'?{}:{semanticRole:previewRole})});
      continue;
    }
    if(['tags','multiselect'].includes(field.type)||Array.isArray(value)){
      const items=(Array.isArray(value)?value:[value]).map(previewDisplayText).filter(Boolean);
      if(items.length)chipGroups.push({type:ADMIN_PREVIEW_BLOCK_TYPES.CHIPS,title:label,items,...(previewRole==='auto'?{}:{semanticRole:previewRole})});
      continue;
    }
    const formatted=field.type==='date'?formatTimelineDate(value):previewDisplayText(value);
    if(formatted)facts.push({label,value:formatted,...(previewRole==='auto'?{}:{semanticRole:previewRole})});
  }
  const category=entryCategory(entry);
  if(category)chipGroups.unshift({type:ADMIN_PREVIEW_BLOCK_TYPES.CHIPS,title:'Category',items:[category]});
  if(facts.length)blocks.push({type:ADMIN_PREVIEW_BLOCK_TYPES.FACTS,title:'Key information',items:facts});
  blocks.push(...narratives,...chipGroups,...previewRelationshipBlocks(entry),...capabilityBlocks,...mediaBlocks);

  renderAdminPreview(body,{
    mode:primaryMedia?'media-first':'structured',
    blocks,
    system:[
      clean(entry.slug)?{label:'Slug',value:clean(entry.slug)}:null,
      {label:'Entry ID',value:entry.id||'—'},
      {label:'Created',value:formatEntryTimestamp(entry.createdAt)},
      {label:'Updated',value:formatEntryTimestamp(entry.updatedAt)}
    ].filter(Boolean)
  });
  if(inline){
    moduleRecordWorkspace.openPreview();
    $('closeModuleRecordPreviewAction')?.focus({preventScroll:true});
  }else{
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    $('closeModuleEntryPreview')?.focus({preventScroll:true});
  }
}

function closeEntryPreview(){
  if(moduleRecordWorkspace&&$('moduleRecordWorkspace')?.dataset.previewOpen==='true'){
    moduleRecordWorkspace.closePreview();
    const focusTarget=entryPreviewReturnFocus;
    entryPreviewReturnFocus=null;
    focusTarget?.focus?.({preventScroll:true});
    return;
  }
  const modal=$('moduleEntryPreviewModal');
  if(!modal||modal.classList.contains('hidden'))return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  const focusTarget=entryPreviewReturnFocus;
  entryPreviewReturnFocus=null;
  focusTarget?.focus?.({preventScroll:true});
}
async function previewEntry(id){const entry=entries.find((item)=>item.id===id);if(!entry){notice('This entry is no longer available.','warning');return;}if(section?.entryCapabilities?.skills===true||section?.entryCapabilities?.tools===true)await ensureEntryStudioDependencies();openEntryPreview(entry);}

function previewRecord(entry){return{id:entry.id,title:clean(entry.title||entry.data?.title)||'Untitled entry',summary:clean(entry.shortSummary||entry.description),category:entryCategory(entry)||section.title,status:entry.status||'draft',visible:entry.visible!==false,featured:entry.featured===true};}
function renderPromotedAdminPreview(){
  const host=$("moduleAdaptivePreview");
  if(!section){
    $("modulePreviewCategory").textContent='First-class Admin';
    $("modulePreviewTitle").textContent='Select a module';
    $("modulePreviewSummary").textContent='Production Admin page after promotion.';
    $("modulePreviewState").textContent='No module selected';
    $("modulePreviewMeta").innerHTML='';
    host.removeAttribute('data-count');
    host.dataset.layout='admin-workspace';
    host.innerHTML='<div class="lan-empty-state"><strong>Admin preview ready</strong><p>Select a registered module to preview its promoted workspace.</p></div>';
    return;
  }
  const records=entries.map(previewRecord);
  const studioTabs=moduleStudioTabs(section);
  const studioProfile=moduleEntryStudioProfile(section);
  const tabLabels={details:'Details',media:'Media','skills-tools':'Skills & Tools',publishing:'Publishing'};
  const customFields=(section.fields||[]).filter((field)=>!isCoreEntryPropertyKey(field.key));
  const capabilityLabels=[];
  if(section.entryCapabilities?.category?.enabled)capabilityLabels.push('Categories');
  if(section.entryCapabilities?.skills)capabilityLabels.push('Skills');
  if(section.entryCapabilities?.tools)capabilityLabels.push('Tools');
  if((section.relationships||[]).length)capabilityLabels.push('Relationships');
  const fieldLabels=customFields.slice(0,4).map((field)=>clean(field.label)||humanizeRuntimeLabel(field.key));
  const extraFieldCount=Math.max(0,customFields.length-fieldLabels.length);
  const workspace=humanizeRuntimeLabel(section.adminWorkspace||'simple-manager');
  host.dataset.count=records.length>=4?'many':String(records.length);
  host.dataset.layout='admin-workspace';
  $("modulePreviewCategory").textContent='First-class Admin';
  $("modulePreviewTitle").textContent=section.title;
  $("modulePreviewSummary").textContent=`${records.length} ${records.length===1?'entry':'entries'} · ${workspace}`;
  $("modulePreviewState").textContent=section.lifecycle==='promoted'?'Promoted':'Projected';
  const recordMarkup=records.length?records.slice(0,4).map((record)=>`<article class="custom-module-admin-record${record.status==='published'?'':' is-draft'}" data-preview-entry-card="${escapeHtml(record.id)}" tabindex="-1"><div><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml(record.category)}</small></div><span>${record.status==='published'?'Published':'Draft'}</span></article>`).join(''):'<div class="custom-module-admin-preview-empty"><strong>No entries yet</strong><span>Add Entry will use the current module schema.</span></div>';
  const fieldMarkup=[...fieldLabels,...capabilityLabels].map((label)=>`<span>${escapeHtml(label)}</span>`).join('')+(extraFieldCount?`<span>+${extraFieldCount} more</span>`:'');
  host.innerHTML=`<section class="custom-module-admin-preview"><header class="custom-module-admin-preview__page-head"><div><small>Portfolio content</small><strong>${escapeHtml(section.title)}</strong></div></header><nav class="custom-module-admin-preview__workspace-tabs" aria-label="Projected Admin workspace"><span class="is-active">Library</span><span>Entry Studio</span></nav><div class="custom-module-admin-preview__library"><div class="custom-module-admin-preview__library-head"><div><small>Existing entries</small><strong>${escapeHtml(libraryHeading(section.title))}</strong></div><span class="custom-module-admin-preview__button">+ Add Entry</span></div><div class="custom-module-admin-preview__search">Search entries</div><div class="custom-module-admin-preview__records">${recordMarkup}</div></div><div class="custom-module-admin-preview__studio"><div><small>Entry Studio</small><strong>${escapeHtml(studioProfile.profileLabel)}</strong></div><div class="custom-module-admin-preview__studio-tabs">${studioTabs.map((tab)=>`<span>${escapeHtml(tabLabels[tab]||humanizeRuntimeLabel(tab))}</span>`).join('')}</div><div class="custom-module-admin-preview__blueprint">${fieldMarkup||'<span>Core entry fields</span>'}</div></div></section>`;
  $("modulePreviewMeta").innerHTML=`<div><span>Lifecycle</span><b>${escapeHtml(humanizeRuntimeLabel(section.lifecycle||'building'))}</b></div><div><span>Promoted workspace</span><b>First-class Admin</b></div><div><span>Entry Studio</span><b>${escapeHtml(studioTabs.map((tab)=>tabLabels[tab]||humanizeRuntimeLabel(tab)).join(' · '))}</b></div><div><span>Builder controls</span><b>${section.lifecycle==='promoted'?'Hidden':'Hidden after promotion'}</b></div>`;
}
function applySectionIdentity(){
  const moduleAccent=/^#[0-9a-f]{6}$/i.test(clean(section.theme?.accent))?clean(section.theme.accent):'#7c5cff';
  document.body.style.setProperty('--module-accent',moduleAccent);
  document.title=`${section.title} | Custom Modules | LΛN Portfolio CMS`;
  $("moduleBandTitle").textContent=section.title;
  $("moduleBandSubtitle").textContent=`${humanizeRuntimeLabel(section.adminWorkspace)} · ${section.fields.length} fields · Public layout in Home / Studio`;
  $("moduleLibraryTitle").textContent=libraryHeading(section.title);
  $("moduleEntryFormHelp").textContent='Fields and tabs are generated from this module schema.';
  $("editModuleDefinition").href=publicCompositionHomeUrl();
  syncTimelineWorkspaceUi();
  syncPublicCompositionGate();
  syncModulePresentationMode();
}

async function ensureEntryStudioDependencies() {
  if (entryStudioDependenciesReady) return;
  if (!entryStudioDependenciesPromise) {
    entryStudioDependenciesPromise = Promise.all([
      listRelationshipModules(),
      loadSkills()
    ]).then(([resolvedRelationships, resolvedCapabilities]) => {
      relationshipModules = resolvedRelationships;
      capabilities = resolvedCapabilities;
      entryStudioDependenciesReady = true;
    }).finally(() => {
      if (!entryStudioDependenciesReady) entryStudioDependenciesPromise = null;
    });
  }
  await entryStudioDependenciesPromise;
}

async function selectModule(key,{replaceUrl=true,mode=null,renderRegistry=true}={}){
  activeSectionKey=clean(key);
  section=await getSection(activeSectionKey);
  if(!section)throw new Error('This custom module no longer exists.');
  entryStudioDependenciesReady=false;
  entryStudioDependenciesPromise=null;
  relationshipModules=[];
  capabilities=[];
  if(mode) moduleMode=mode;
  if(moduleMode==='edit') await ensureEntryStudioDependencies();
  applySectionIdentity();
  syncGeneratedRecordWorkspace();
  if(moduleMode==='edit') renderDefinitionEditor();
  const entriesLoaded=await refreshEntries();
  if(entriesLoaded){await clearEntry({renderForm:false});showContentSurface('library');}
  setModuleMode(moduleMode,{updateUrl:replaceUrl,preserveSelection:true});
  if(entriesLoaded)renderPromotedAdminPreview();
  if(renderRegistry)await renderModuleRegistry();
}

function setModuleCreationMode(open){
  setModuleMode(open ? 'create' : 'library',{updateUrl:true,preserveSelection:false});
}

function focusDefinitionEditorRow(kind, index) {
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-definition-${kind}-index="${index}"]`);
    const input = row?.querySelector(`[data-definition-${kind}-label]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
    input?.select?.();
  });
}
function addDefinitionField() {
  collectDefinitionFields();
  const n = definitionFields.length + 1;
  definitionFields.push({ key:`field_${n}`, label:`Field ${n}`, type:'text', required:false, public:true, options:[], acceptPreset:'any', access:'public-preview' });
  const index = definitionFields.length - 1;
  renderDefinitionFields();
  renderDisplayMapping();
  renderReadiness();
  focusDefinitionEditorRow('field', index);
}
function addDefinitionRelationship() {
  collectDefinitionRelationships();
  const n = definitionRelationships.length + 1;
  definitionRelationships.push({ key:`relationship_${n}`, label:`Relationship ${n}`, targetModule:'', multiple:false, required:false, public:true });
  const index = definitionRelationships.length - 1;
  renderDefinitionRelationships();
  renderReadiness();
  focusDefinitionEditorRow('relationship', index);
}

async function createModule(event){
  event.preventDefault();
  const input=$("moduleRegistrationTitle");
  if(!clean(input.value))return;
  const submit=event.submitter;
  try{
    if(submit)submit.disabled=true;
    const id=await registerSection({title:input.value});
    input.value='';
    await renderModuleRegistry();
    await selectModule(id,{mode:'edit'});
    notice('Module created. Continue in Edit Module to define its blueprint.');
  }catch(error){notice(error.message,'error');}
  finally{if(submit)submit.disabled=false;}
}

async function activateModuleMode(mode){
  activeSectionKey='';
  section=null;
  setModuleMode(mode,{updateUrl:true,preserveSelection:false});
  await renderModuleRegistry();
  if(mode==='create') return;
  renderPromotedAdminPreview();
}

function bindStaticEvents(){
  bindEntryCapabilityControls();
  document.querySelectorAll('[data-module-mode]').forEach((b)=>b.addEventListener('click',()=>activateModuleMode(b.dataset.moduleMode)));
  $("newModuleButton")?.addEventListener('click',()=>activateModuleMode('create'));
  $("cancelModuleRegistration")?.addEventListener('click',()=>activateModuleMode('library'));
  $("moduleStudioBack")?.addEventListener('click',async()=>{activeSectionKey='';section=null;setModuleMode('pages',{updateUrl:true,preserveSelection:false});await renderModuleRegistry();renderPromotedAdminPreview();});
  $("moduleRegistrationForm")?.addEventListener('submit',createModule);
  $("moduleEntryForm")?.addEventListener('submit',submitEntry);
  $("moduleEntryTitle")?.addEventListener('input',()=>{const slug=$("moduleEntrySlug");if(slug&&!entrySlugManual)slug.value=moduleSlug($("moduleEntryTitle").value);});
  $("moduleEntrySlug")?.addEventListener('input',()=>{entrySlugManual=true;});
  $("moduleEntryCategory")?.addEventListener('change',syncOtherCategoryField);
  $("moduleEntryStatus")?.addEventListener('change',syncPublicCompositionGate);
  $("moduleEntryVisible")?.addEventListener('change',syncPublicCompositionGate);
  $("openPublicModule")?.addEventListener('click',handlePublicModuleAction);
  $("clearModuleEntry")?.addEventListener('click',()=>document.body.dataset.modulePresentation==='first-class'?closeEntryStudio():clearEntry());
  $("cancelModuleEntry")?.addEventListener('click',closeEntryStudio);
  $("newModuleEntry")?.addEventListener('click',openNewEntry);
  $("moduleRecordWorkspace")?.addEventListener('lan:recordcreate',openNewEntry);
  $("moduleRecordWorkspace")?.addEventListener('lan:recordpreviewclose',closeEntryPreview);
  $("deleteModuleEntry")?.addEventListener('click',deleteCurrentEntry);
  $("closeModuleEntryPreview")?.addEventListener('click',closeEntryPreview);
  $("closeModuleRecordPreviewAction")?.addEventListener('click',closeEntryPreview);
  $("moduleEntryPreviewModal")?.addEventListener('click',(event)=>{if(event.target===$("moduleEntryPreviewModal"))closeEntryPreview();});
  document.addEventListener('keydown',(event)=>{if(event.key!=='Escape')return;if(moduleRecordWorkspace&&$('moduleRecordWorkspace')?.dataset.previewOpen==='true')closeEntryPreview();else if(!$('moduleEntryPreviewModal')?.classList.contains('hidden'))closeEntryPreview();});
  for(const id of ['moduleEntrySearch','moduleEntryCategoryFilter','moduleEntryStatusFilter','moduleEntrySort'])$(id)?.addEventListener(id==='moduleEntrySearch'?'input':'change',()=>{entryPage=1;renderEntryList();});
  $("moduleEntryPageSize")?.addEventListener('change',()=>{entryPageSize=normalizeRecordLibraryPageSize($("moduleEntryPageSize").value);entryPage=1;renderEntryList();});
  $("modulePrevPage")?.addEventListener('click',()=>{if(entryPage>1){entryPage--;renderEntryList();}});
  $("moduleNextPage")?.addEventListener('click',()=>{entryPage++;renderEntryList();});
  $("moduleGridView")?.addEventListener('click',()=>{entryView=isTimelineWorkspace()?'timeline':'grid';$("moduleGridView").classList.add('is-active');$("moduleListView").classList.remove('is-active');renderEntryList();});
  $("moduleListView")?.addEventListener('click',()=>{entryView='list';$("moduleListView").classList.add('is-active');$("moduleGridView").classList.remove('is-active');renderEntryList();});
  document.querySelectorAll('[data-add-definition-field]').forEach((button)=>button.addEventListener('click',addDefinitionField));
  document.querySelectorAll('[data-add-definition-relationship]').forEach((button)=>button.addEventListener('click',addDefinitionRelationship));
  $("moduleContentMode")?.addEventListener('change',()=>{$("moduleRelationshipDefinitionBlock").hidden=$("moduleContentMode").value==='standalone';renderModuleIconIdentity();});
  ["moduleDefinitionTitle","moduleDefinitionSubtitle"].forEach((id)=>$(id)?.addEventListener("input",renderModuleIconIdentity));
  $("moduleThemeAccent")?.addEventListener("input",(event)=>{const value=clean(event.currentTarget?.value);if(/^#[0-9a-f]{6}$/i.test(value))document.body.style.setProperty('--module-accent',value);});
  ["moduleAdminWorkspace","moduleThemeIconMode","moduleThemeIcon"].forEach((id)=>$(id)?.addEventListener("change",()=>{renderModuleIconIdentity();renderWorkspaceResolution();renderReadiness();}));
  $("moduleDefinitionForm")?.addEventListener('submit',async(event)=>{event.preventDefault();const submit=event.submitter;try{if(submit)submit.disabled=true;await saveDefinition();notice('Module blueprint saved. Structural changes start a new maturity revision; existing content stays preserved.');}catch(error){notice(error.message,'error');}finally{if(submit)submit.disabled=false;}});
}

async function init(){
  bindStaticEvents();
  document.body.dataset.moduleMode=moduleMode;
  if(activeSectionKey){
    document.body.dataset.moduleRouteState='resolving';
    if($("moduleSaveStatus"))$("moduleSaveStatus").textContent='Loading module…';
    await selectModule(activeSectionKey,{replaceUrl:false,mode:moduleMode,renderRegistry:false});
    document.body.dataset.moduleRouteState='ready';
  }else{
    await renderModuleRegistry();
    document.body.dataset.moduleRouteState='studio';
    setModuleMode(moduleMode,{updateUrl:false,preserveSelection:false});
    $("moduleEmptyState").hidden=moduleMode==='library' || moduleMode==='create';
    $("moduleDetailView").hidden=true;
    renderPromotedAdminPreview();
  }
}

init().catch((error)=>{console.error('Custom module workspace failed to initialize.',error);$("moduleSaveStatus").textContent='Unavailable';notice(error.message||'Unable to load Custom Modules.','error');});
window.addEventListener('beforeunload',clearAllPending);
