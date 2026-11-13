import {
  createProject,
  reserveProjectId,
  deleteProject,
  loadProjects,
  updateProject,
  updateManyProjects,
  resolveProjectAction,
  getPortfolioModuleRegistry,
  refreshPortfolioModuleRegistry,
  getPortfolioModule,
  loadPortfolioModuleEntries,
  resolveLinkedProjectPresentation,
  setCapabilitiesOnLinkedProjectSource,
} from "../services/projectService.js";
import {
  capabilityRef,
  normalizePublicTagMode,
  normalizePublicTagRefs,
  resolvePublicProjectCapabilities,
  validPublicTagRefs,
} from "../../projectCapabilities.js";
import {
  detectExternalVideoProvider,
  getMediaSettings,
  getThumbnailUrl,
  uploadImage,
  uploadMedia,
  uploadVideo,
  validateMediaFile,
} from "../services/storageUploadService.js";
import { discardTemporaryMediaAssets } from "../services/mediaAssetLifecycleService.js";
import { ADMIN_PREVIEW_BLOCK_TYPES, renderAdminPreview, resolveAdminPreviewMediaUrl } from "./admin-preview.js";
import { adminMediaFallbackMarkup, adminMediaImageLayersMarkup, resolveAdminMediaAssetUrl } from "./admin-media-frame.js";
import { hasAssetReference, resolveAssetUrl } from "../../asset-resolver.js";

async function getSkillsLibraryRecords() {
  try {
    const module = await import("../services/skillService.js");

    if (module?.SkillService?.getAll) {
      return await module.SkillService.getAll();
    }
  } catch (error) {
    console.warn("Skills Library service is unavailable:", error);
  }

  try {
    const stored = localStorage.getItem("lanPortfolioSkills");
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Skills Library local data could not be read:", error);
    return [];
  }
}

const projectMediaSettings = getMediaSettings("projects");
const MAX_GALLERY_FILES = Number(projectMediaSettings.module?.maxGalleryItems) || 12;
const PROJECT_MEDIA_FOLDERS = projectMediaSettings.folders || {};

let projects = [];
let projectsLoading = true;
let skillsLibrary = [];
let toolsLibrary = [];
let selectedSkillIds = [];
let selectedToolIds = [];
let selectedTechnologies = [];
let selectedPublicTagRefs = [];
let projectPublicTagToolPicker = null;
let projectPublicTagSkillPicker = null;
let pendingDeleteId = "";
let hasUnsavedChanges = false;
let isSaving = false;
let notificationTimer;
let coverObjectUrl = "";
let videoObjectUrl = "";
let pendingCoverFile = null;
let pendingVideoFile = null;
let savedCoverImage = null;
let logoObjectUrl = "";
let pendingLogoFile = null;
let savedProjectLogo = null;
let savedVideo = null;
let savedPdfAsset = null;
let savedSourceFiles = [];
let savedCustomAssets = [];
let pendingPdfFile = null;
let pendingSourceFiles = [];
let pendingCustomAssets = [];
let enabledCustomMediaAssets = new Set();
let galleryPreviewItems = [];
let projectPreviewOpener = null;
let coverPreviewOpener = null;
let deleteModalOpener = null;
let isDeleting = false;
const linkedSourceCache = new Map();
let selectedLinkedSource = null;
let linkedActions = [];
let linkedActionSequence = 0;
let linkedSourceLoadToken = 0;

const $ = (id) => document.getElementById(id);
const savedMediaUrl = (value, purpose = "admin-read") => String(resolveAssetUrl(value, purpose) || "").trim();
function savedMediaAvailable(value) {
  return hasAssetReference(value);
}
const setSelectValue = (select, value, fallback = "") => {
  if (window.LANSetSelectValue) return window.LANSetSelectValue(select, value, fallback);
  if (!select) return false;
  const option = [...select.options].find((item) => item.value === String(value ?? ""));
  select.value = option?.value ?? fallback;
  return Boolean(option);
};

const form = $("projectForm");
const idInput = $("projectId");
const list = $("projectList");
const emptyState = $("projectEmptyState");
const saveStatus = $("saveStatus");

const fields = {
  title: $("projectTitle"),
  projectType: $("projectType"),
  linkedModule: $("projectLinkedModule"),
  linkedScope: $("projectLinkedScope"),
  linkedDocumentId: $("projectLinkedDocumentId"),
  linkedDestination: $("projectLinkedDestination"),
  linkedSourceSnapshot: $("projectLinkedSourceSnapshot"),
  standaloneProjectName: $("standaloneProjectName"),
  category: $("projectCategory"),
  customCategory: $("projectCustomCategory"),
  year: $("projectYear"),
  projectHours: $("projectHours"),
  displayOrder: $("projectDisplayOrder"),
  shortDescription: $("projectShortDescription"),
  description: $("projectDescription"),
  skillIds: $("projectSkillIds"),
  toolIds: $("projectToolIds"),
  technologies: $("projectTechnologies"),
  publicTagMode: $("projectPublicTagMode"),
  publicTagRefs: $("projectPublicTagRefs"),
  githubUrl: $("projectGithubUrl"),
  githubSecondaryEnabled: $("projectGithubSecondaryEnabled"),
  liveUrl: $("projectLiveUrl"),
  coverImageUrl: $("projectCoverImageUrl"),
  videoUrl: $("projectVideoUrl"),
  youtubeUrl: $("projectYoutubeUrl"),
  videoType: $("projectVideoType"),
  mediaType: $("projectMediaType"),
  demoVideoData: $("projectDemoVideoData"),
  externalVideoData: $("projectExternalVideoData"),
  pdfAssetData: $("projectPdfAssetData"),
  sourceFilesData: $("projectSourceFilesData"),
  customAssetsData: $("projectCustomAssetsData"),
  enabledMediaAssets: $("projectEnabledMediaAssets"),
  galleryImages: $("projectGalleryImages"),
  projectLogoData: $("projectLogoData"),
  buttonLabel: $("projectButtonLabel"),
  buttonCustomLabel: $("projectButtonCustomLabel"),
  actionType: $("projectActionType"),
  destination: $("projectDestination"),
  status: $("projectStatus"),
  featured: $("projectFeatured"),
  visible: $("projectVisible"),
};

const projectCustomCategoryField =
  $("projectCustomCategoryField");

const linkedSourceElements = {
  status: $("linkedSourceStatus"),
  preview: $("linkedSourcePreview"),
  warning: $("linkedSourceWarning"),
  success: $("linkedSuccessState"),
  entryField: $("projectLinkedEntryField"),
  connectionStep2: $("linkedConnectionStep2"),
  capabilitySummary: $("projectLinkedCapabilitySummary"),
  capabilityEditors: $("projectCapabilityEditors"),
  capabilityLibraryLink: $("projectCapabilityLibraryLink"),
  suggestedSkills: $("projectSuggestedSkills"),
  publicTagsStatus: $("projectPublicTagsStatus"),
  publicTagAutomaticSummary: $("projectPublicTagAutomaticSummary"),
  publicTagWarning: $("projectPublicTagWarning"),
  publicTagCustom: $("projectPublicTagCustom"),
  publicTagToolPickerHost: $("projectPublicTagToolPicker"),
  publicTagSkillPickerHost: $("projectPublicTagSkillPicker"),
  publicTagToolEmpty: $("projectPublicTagToolEmpty"),
  publicTagSkillEmpty: $("projectPublicTagSkillEmpty")
};

const linkedActionElements = {
  list: $("projectAdditionalActionsList"),
  addButton: $("addProjectActionButton")
};


function projectCategoryLabel(project = {}) {
  if (
    project.category === "other" &&
    String(project.customCategory || "").trim()
  ) {
    return String(project.customCategory).trim();
  }

  return formatLabel(project.category);
}

function updateProjectCustomCategoryVisibility() {
  if (!fields.category || !fields.customCategory || !projectCustomCategoryField) {
    return;
  }

  const isOther = fields.category.value === "other";

  projectCustomCategoryField.classList.toggle("hidden", !isOther);
  fields.customCategory.required = isOther;
  fields.customCategory.disabled = !isOther;

  if (!isOther) {
    fields.customCategory.value = "";
  }
}

const skillSelector = document.querySelector(".project-skill-selector");
const toolSelector = document.querySelector(".project-tool-selector");
const projectSkillPickerHost = $("projectSkillPicker");
const projectToolPickerHost = $("projectToolPicker");
let projectSkillPicker = null;
let projectToolPicker = null;

const media = {
  coverInput: $("projectCoverFile"),
  coverZone: $("coverUploadZone"),
  coverPreview: $("coverPreview"),
  coverPreviewImage: $("coverPreviewImage"),
  coverFileName: $("coverFileName"),
  coverFileMeta: $("coverFileMeta"),
  removeCoverButton: $("removeCoverButton"),
  previewCoverButton: $("previewCoverButton"),
  previewCoverImageButton: $("previewCoverImageButton"),
  replaceCoverButton: $("replaceCoverButton"),
  coverPreviewModal: $("coverPreviewModal"),
  coverPreviewModalImage: $("coverPreviewModalImage"),
  coverPreviewModalName: $("coverPreviewModalName"),
  logoInput: $("projectLogoFile"),
  logoZone: $("logoUploadZone"),
  logoPreview: $("projectLogoPreview"),
  logoPreviewImage: $("projectLogoPreviewImage"),
  logoFileName: $("projectLogoFileName"),
  logoFileMeta: $("projectLogoFileMeta"),
  removeLogoButton: $("removeProjectLogoButton"),
  closeCoverPreviewModal: $("closeCoverPreviewModal"),
  galleryInput: $("projectGalleryFiles"),
  galleryZone: $("galleryUploadZone"),
  galleryPreview: $("galleryPreview"),
  galleryEmptyMessage: $("galleryEmptyMessage"),
  clearGalleryButton: $("clearGalleryButton"),
  coverStatus: $("coverMediaStatus"),
  galleryStatus: $("galleryMediaStatus"),
  logoStatus: $("logoMediaStatus"),
  videoStatus: $("videoMediaStatus"),
  liveWebsiteStatus: $("liveWebsiteMediaStatus"),
  videoInput: $("projectVideoFile"),
  videoZone: $("videoUploadZone"),
  videoPreview: $("videoPreview"),
  videoPreviewStage: $("videoPreviewStage"),
  videoFileName: $("videoFileName"),
  videoFileMeta: $("videoFileMeta"),
  removeVideoButton: $("removeVideoButton"),
  replaceVideoButton: $("replaceVideoButton"),
  videoSourceTabs: $("projectVideoSourceTabs"),
  videoUploadTab: $("videoUploadTab"),
  videoYoutubeTab: $("videoYoutubeTab"),
  videoUploadPanel: $("videoUploadPanel"),
  videoYoutubePanel: $("videoYoutubePanel"),
  externalProviderHint: $("externalVideoProviderHint"),
  previewExternalVideoButton: $("previewExternalVideoButton"),
  coverCard: $("coverImageCard"),
  logoCard: $("projectLogoCard"),
  screenshotsCard: $("standaloneScreenshotsCard"),
  videoCard: $("demoVideoCard"),
  liveWebsiteCard: $("liveWebsiteCard"),
  pdfCard: $("pdfAssetCard"),
  pdfInput: $("projectPdfFile"),
  pdfZone: $("pdfUploadZone"),
  pdfPreview: $("pdfAssetPreview"),
  sourceCard: $("sourceFilesCard"),
  sourceInput: $("projectSourceFiles"),
  sourceZone: $("sourceUploadZone"),
  sourcePreview: $("sourceFilesPreview"),
  customCard: $("customAssetsCard"),
  customInput: $("projectCustomAssets"),
  customZone: $("customAssetUploadZone"),
  customPreview: $("customAssetsPreview"),
  documentStatus: $("documentMediaStatus"),
  sourceStatus: $("sourceMediaStatus"),
  customStatus: $("customAssetMediaStatus"),
  customAssetSelector: $("customAssetSelector"),
  customAssetInputs: [...document.querySelectorAll("[data-custom-media-asset]")],
};

const projectPreview = {
  modal: $("projectPreviewModal"),
  body: $("projectPreviewBody"),
  closeButton: $("closeProjectPreviewModal"),
  title: $("projectPreviewTitle"),
  context: $("projectPreviewContext")
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLabel(value = "") {
  return String(value)
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveAdminMediaUrl(value = "") {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("assets/")) return `/${url}`;
  if (url.startsWith("./assets/")) return `/${url.slice(2)}`;
  return url;
}

function projectAdminThumbnail(value, width = 900, height = 560) {
  const resolved = resolveAdminMediaUrl(value);
  if (!resolved) return "";
  return /^https?:/i.test(resolved) ? getThumbnailUrl(resolved, width, height) : resolved;
}

function resolveProjectAdminCover(project = {}, linkedPresentation = null) {
  const candidates = [
    project.coverImage,
    project.coverImageUrl,
    linkedPresentation?.cover,
    project.linkedCoverSnapshot,
    project.presentation?.cover,
    project.publicPresentation?.cover,
    project.media?.cover,
    project.cover,
    project.image,
    project.imageUrl,
    project.thumbnail,
    project.primaryImage
  ];
  for (const candidate of candidates) {
    const resolved = resolveAdminPreviewMediaUrl(candidate);
    if (resolved) return resolved;
  }
  return "";
}

function setStatus(value) {
  const labels = {
    ready: "Ready",
    editing: "Unsaved changes",
    loading: "Loading...",
    saving: "Saving...",
    saved: "Saved",
    error: "Error",
  };

  saveStatus.textContent = labels[value] || labels.ready;
  saveStatus.dataset.status = value;
}

function notify(message, type = "success") {
  const tone = type === "error" ? "error" : type === "warning" ? "warning" : "success";
  window.LANNotice?.({ title: "Projects", message, tone });
}

function markAsChanged() {
  hasUnsavedChanges = true;
  setStatus("editing");
}

function safeParseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function setJsonField(field, value) {
  if (field) field.value = JSON.stringify(value ?? null);
}

function normalizeProjectType(value) {
  return String(value || "").trim() === "linked-module" ? "linked-module" : "standalone";
}

function activeProjectType() {
  return normalizeProjectType(fields.projectType?.value);
}

function isValidInternalDestination(value) {
  const destination = String(value || "").trim();
  return /^(#[A-Za-z][\w-]*|\/[A-Za-z0-9][A-Za-z0-9/_-]*|[A-Za-z][\w-]*)$/.test(destination) && !/^javascript:/i.test(destination);
}

function registeredModules() {
  return getPortfolioModuleRegistry();
}

const PROJECT_CTA_PRESETS = Object.freeze([
  "View Experience",
  "View Project",
  "View Portfolio",
  "Watch Videos",
  "View Certificate",
  "View Resume",
  "View Details",
  "Watch Video",
  "Open Live Website",
  "View PDF",
  "Download",
  "GitHub"
]);

const STANDALONE_CTA_PRESETS = Object.freeze([
  "View Project",
  "Watch Video",
  "Open Live Website",
  "View PDF",
  "Download",
  "GitHub"
]);

const STANDALONE_PROJECT_CTA_PRESETS = STANDALONE_CTA_PRESETS;
const RESOURCE_ACTION_TYPES = Object.freeze({
  "Watch Video": "demo-video",
  "Open Live Website": "live-website",
  "View PDF": "pdf",
  "Download": "download",
  "GitHub": "github",
  "View Project": "project-preview"
});

function suggestedModuleCta(module = null) {
  if (!module) return "View Details";
  const configured = String(module.defaultButtonLabel || "").trim();
  const key = String(module.key || "").trim().toLowerCase();
  const label = String(module.label || "").trim().toLowerCase();
  if (configured && configured !== "View Details") return configured;
  if (key === "experience" || label === "experience") return "View Experience";
  if (key === "photo-editing" || label.includes("photo editing")) return "View Portfolio";
  if (key === "projects" || label === "projects" || label === "project") return "View Project";
  if (key === "certificates" || label.includes("certificate")) return "View Certificate";
  if (key === "resume" || label.includes("resume")) return "View Resume";
  return configured || "View Details";
}

function ctaSelectOptions(label = "", suggested = "View Details", presets = PROJECT_CTA_PRESETS) {
  const available = [...new Set((Array.isArray(presets) ? presets : PROJECT_CTA_PRESETS).map((item) => String(item || "").trim()).filter(Boolean))];
  const selected = String(label || suggested || available[0] || "View Details").trim();
  const presetSelected = available.includes(selected);
  const options = available.map((item) =>
    `<option value="${escapeHtml(item)}"${presetSelected && item === selected ? " selected" : ""}>${escapeHtml(item)}</option>`
  );
  options.push(`<option value="__custom__"${presetSelected ? "" : " selected"}>Custom…</option>`);
  return options.join("");
}

const LINKED_PROJECT_CTA_PRESETS = ["View Details", "View Gallery", "View Samples", "View Work"];
const RESOURCE_PRIMARY_CTA_PRESETS = ["Watch Video", "Open Live Website", "View PDF", "Download", "GitHub"];

function linkedPrimaryCtaPresets() {
  const module = getPortfolioModule(fields.linkedModule?.value);
  const sourceAction = suggestedModuleCta(module) || "View Details";
  return [...new Set([sourceAction, ...LINKED_PROJECT_CTA_PRESETS, ...RESOURCE_PRIMARY_CTA_PRESETS])];
}

function primaryCtaPresets() {
  return activeProjectType() === "linked-module"
    ? linkedPrimaryCtaPresets()
    : STANDALONE_PROJECT_CTA_PRESETS;
}

function renderPrimaryCtaOptions(selectedLabel = "") {
  if (!fields.buttonLabel) return;
  const presets = primaryCtaPresets();
  const selected = normalizeProjectButtonLabel(selectedLabel || presets[0] || "View Project");
  fields.buttonLabel.innerHTML = `${presets.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}<option value="__custom__">Custom…</option>`;
  fields.buttonLabel.value = presets.includes(selected) ? selected : "__custom__";
}

function normalizeProjectButtonLabel(label = "") {
  const value = String(label || "").trim();
  return value.toLowerCase() === "live demo" ? "Watch Video" : value;
}

function standaloneActionTypeForLabel(label = "", fallback = "project-preview") {
  const value = normalizeProjectButtonLabel(label);
  if (value === "Watch Video" || value === "Watch Demo" || value === "Watch Animation") return "uploaded-mp4";
  if (value === "Open Live Website") return "live-site";
  if (value === "View PDF") return "pdf";
  if (value === "Download") return "source-file";
  if (value === "GitHub") return "github";
  if (value === "View Project") return "project-preview";
  return fallback || "project-preview";
}

function resourceRequirementForAction(label = "") {
  return RESOURCE_ACTION_TYPES[normalizeProjectButtonLabel(label)] || "";
}

function projectResourceItems(resourceType = "") {
  if (resourceType === "download") return [...savedSourceFiles, ...pendingSourceFiles];
  if (resourceType === "custom-resource") return [...savedCustomAssets, ...pendingCustomAssets];
  return [];
}

function projectResourceItemName(item = null, index = 0) {
  return String(item?.name || item?.originalFilename || item?.original_filename || item?.filename || item?.publicId || item?.public_id || `Resource ${index + 1}`).trim();
}

function projectResourceReady(resourceType = "", resourceIndex = 0) {
  if (resourceType === "project-preview") return true;
  if (!resourceType) return false;
  if (resourceType === "demo-video") return Boolean(pendingVideoFile || savedMediaAvailable(savedVideo) || fields.youtubeUrl?.value.trim() || fields.videoUrl?.value);
  if (resourceType === "live-website") return isValidHttpsUrl(fields.liveUrl?.value || "");
  if (resourceType === "pdf") return Boolean(pendingPdfFile || savedMediaAvailable(savedPdfAsset));
  if (resourceType === "download" || resourceType === "custom-resource") {
    const items = projectResourceItems(resourceType);
    return Boolean(items[Number(resourceIndex) || 0]);
  }
  if (resourceType === "github") return Boolean(fields.githubUrl?.value.trim());
  return false;
}

function resourceRequirementLabel(resourceType = "") {
  return ({
    "project-preview": "Project detail content",
    "demo-video": "Project video in Project Assets",
    "live-website": "Live Website in Project Assets",
    pdf: "PDF document in Project Assets",
    download: "Download file in Project Assets",
    "custom-resource": "Custom asset in Project Assets",
    github: "GitHub repository in Project Assets"
  })[resourceType] || "Project asset target";
}

function primaryResourceRequirement(label = primaryCtaLabel()) {
  const requirement = resourceRequirementForAction(label);
  if (activeProjectType() === "linked-module" && requirement === "project-preview") return "";
  return requirement;
}

function resourceHasContent(resourceType = "") {
  if (resourceType === "github") return Boolean(fields.githubUrl?.value.trim());
  if (resourceType === "live-website") return isValidHttpsUrl(fields.liveUrl?.value || "");
  if (resourceType === "pdf") return Boolean(pendingPdfFile || savedMediaAvailable(savedPdfAsset));
  if (resourceType === "download") return Boolean(pendingSourceFiles.length || savedSourceFiles.some(savedMediaAvailable));
  if (resourceType === "custom-resource") return Boolean(pendingCustomAssets.length || savedCustomAssets.some(savedMediaAvailable));
  return false;
}

function activeProjectResourceTypes() {
  const usage = actionUsageMap();
  const active = new Set();
  ["github", "live-website", "pdf", "download", "custom-resource"].forEach((type) => {
    if (usage.has(type)) active.add(type);
  });
  if (fields.githubSecondaryEnabled?.checked) active.add("github");
  return active;
}

function syncSmartResourceVisibility() {
  const active = activeProjectResourceTypes();
  const mapping = {
    github: $("githubResourceCard"),
    "live-website": $("liveWebsiteCard"),
    pdf: $("pdfAssetCard"),
    download: $("sourceFilesCard"),
    "custom-resource": $("customAssetsCard")
  };
  Object.entries(mapping).forEach(([type, card]) => {
    if (!card) return;
    const show = active.has(type);
    card.hidden = !show;
    card.classList.toggle("hidden", !show);
    card.setAttribute("aria-hidden", show ? "false" : "true");
    if ("inert" in card) card.inert = !show;
  });

  const actionAssets = $("projectActionAssetsSection");
  if (actionAssets) {
    const show = active.size > 0;
    actionAssets.hidden = !show;
    actionAssets.classList.toggle("hidden", !show);
    actionAssets.setAttribute("aria-hidden", show ? "false" : "true");
  }

  const status = $("projectActionAssetsStatus");
  if (status) status.textContent = active.size ? `${active.size} action asset${active.size === 1 ? "" : "s"}` : "Action controlled";

  const resourceGrid = $("projectResourceGrid");
  if (resourceGrid) {
    const gridTypes = ["live-website", "pdf", "download", "custom-resource"];
    resourceGrid.dataset.activeCards = String(gridTypes.filter((type) => active.has(type)).length);
  }
}

function renderResourceStatus() {
  const host = $("projectResourceStatus");
  if (!host) return;
  const active = activeProjectResourceTypes();
  const rows = [
    ["github", "GitHub Repository", Boolean(fields.githubUrl?.value.trim())],
    ["live-website", "Live Website", isValidHttpsUrl(fields.liveUrl?.value || "")],
    ["pdf", "PDF / Document", Boolean(pendingPdfFile || savedMediaAvailable(savedPdfAsset))],
    ["download", "Download Files", Boolean(pendingSourceFiles.length || savedSourceFiles.some(savedMediaAvailable))],
    ["custom-resource", "Custom Asset", Boolean(pendingCustomAssets.length || savedCustomAssets.some(savedMediaAvailable))]
  ].filter(([type]) => active.has(type));
  host.hidden = rows.length === 0;
  host.classList.toggle("hidden", rows.length === 0);
  host.innerHTML = rows.length ? `<div class="project-resource-status-grid">${rows.map(([, label, ready]) => `<span class="project-resource-status-item ${ready ? "is-ready" : ""}"><i aria-hidden="true"></i><strong>${escapeHtml(label)}</strong><small>${ready ? "Ready" : "Needs setup"}</small></span>`).join("")}</div>` : "";
}

function renderActionRequirementStatus() {
  const host = $("projectPrimaryActionRequirement");
  if (!host) return;
  host.hidden = true;
  host.classList.add("hidden");
  if (activeProjectType() === "linked-module" && !primaryResourceRequirement()) {
    const module = getPortfolioModule(fields.linkedModule?.value);
    const ready = Boolean(module && (linkedModuleScope(module.key) === "module" || fields.linkedDocumentId?.value));
    host.className = `project-action-requirement ${ready ? "is-ready" : "is-missing"}`;
    host.innerHTML = `<strong>${ready ? "Source ready" : "Linked source required"}</strong><span>${ready ? `${escapeHtml(module?.label || "Portfolio source")} will receive this action.` : "Select the source module and entry in Project Details."}</span>`;
    return;
  }
  const resourceType = primaryResourceRequirement() || (activeProjectType() === "standalone" ? "project-preview" : "");
  const ready = projectResourceReady(resourceType);
  host.className = `project-action-requirement ${ready ? "is-ready" : "is-missing"}`;
  host.innerHTML = `<strong>${ready ? "Target ready" : "Target required"}</strong><span>${escapeHtml(resourceRequirementLabel(resourceType))}${ready ? " is configured." : " is missing. Configure it in Project Assets before saving."}</span>`;
}



function ensureActionResourceProfile() {
  // Action-required media is derived from actionUsageMap(). Do not mutate the
  // legacy media-profile field here; otherwise an old profile can keep an
  // empty Project Video card visible after the action changes.
  updateMediaTypeUI();
}

function smartActionTargetDescriptor(label = primaryCtaLabel()) {
  const type = resourceRequirementForAction(label) || (activeProjectType() === "standalone" ? "project-preview" : "");
  const ready = type ? projectResourceReady(type) : Boolean(fields.linkedModule?.value && (linkedModuleScope(fields.linkedModule?.value) === "module" || fields.linkedDocumentId?.value));
  return { type, ready };
}

function renderPrimaryActionTargetEditor() {
  const host = $("projectPrimaryActionTargetEditor");
  if (!host) return;
  const label = primaryCtaLabel();
  const linked = activeProjectType() === "linked-module";
  const { type, ready } = smartActionTargetDescriptor(label);
  if (linked && !type) {
    const module = getPortfolioModule(fields.linkedModule?.value);
    host.innerHTML = `<div class="project-smart-target ${ready ? "is-ready" : "is-missing"}"><div><span class="project-smart-target-kicker">Portfolio target</span><strong>${escapeHtml(module?.label || "Linked content")}</strong><small>${ready ? "Primary source is connected." : "Select the source module and entry in Project Details."}</small></div><button type="button" class="editor-secondary-button button-compact" data-action-open-tab="details">Open Project Details</button></div>`;
    return;
  }
  if (!type || type === "project-preview") {
    host.innerHTML = `<div class="project-smart-target is-ready"><div><span class="project-smart-target-kicker">Project target</span><strong>Project details</strong><small>The button opens this Project's full preview/details. No extra asset is required.</small></div></div>`;
    return;
  }
  const title = ({
    "demo-video": "Project video",
    "live-website": "Live website",
    pdf: "PDF / documentation",
    download: "Download file",
    github: "GitHub repository",
    "custom-resource": "Custom asset"
  })[type] || "Project asset";
  const hint = ready
    ? "This action's asset is configured and ready."
    : "This action automatically created a matching section in Project Assets. Configure it there before saving.";
  host.innerHTML = `<div class="project-smart-target ${ready ? "is-ready" : "is-missing"}"><div class="project-smart-target-copy"><span class="project-smart-target-kicker">${ready ? "Target ready" : "Target required"}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(hint)}</small></div><button type="button" class="project-smart-target-manage editor-secondary-button button-compact" data-action-open-tab="media">Open Project Assets</button></div>`;
}

function actionUsageMap() {
  const usage = new Map();
  const add = (type, label) => { if (!type) return; if (!usage.has(type)) usage.set(type, []); usage.get(type).push(label); };
  const primaryType = resourceRequirementForAction(primaryCtaLabel()) || (activeProjectType() === "standalone" ? "project-preview" : "");
  add(primaryType, `Primary — ${primaryCtaLabel() || "View Project"}`);
  linkedActions.filter((a) => a.kind === "resource").forEach((a, i) => add(a.resourceType, `Action ${i + 2} — ${a.label || resourceDefaultLabel(a.resourceType)}`));
  if (fields.githubSecondaryEnabled?.checked && fields.githubUrl?.value.trim()) add("github", "Automatic GitHub button");
  return usage;
}

function renderResourceUsageRelations() {
  const usage = actionUsageMap();
  const host = $("projectMediaUsageSummary");
  if (!host) return;
  const row = (type, title) => {
    const refs = usage.get(type) || [];
    return refs.length ? `<div class="project-usage-row"><strong>${escapeHtml(title)}</strong><span>Used by ${refs.map(escapeHtml).join(" · ")}</span></div>` : "";
  };
  host.innerHTML = [
    row("demo-video", "Project Video"),
    row("github", "GitHub Repository"),
    row("live-website", "Live Website"),
    row("pdf", "PDF / Document"),
    row("download", "Download"),
    row("custom-resource", "Custom Asset")
  ].filter(Boolean).join("") || '<div class="project-usage-empty">No public action currently requires an extra Project Asset.</div>';
}

function renderProjectReadiness() {
  const host = $("projectReadinessPanel");
  if (!host) return;
  const primary = smartActionTargetDescriptor(primaryCtaLabel());
  const linkedReady = activeProjectType() !== "linked-module" || Boolean(fields.linkedModule?.value && (linkedModuleScope(fields.linkedModule?.value) === "module" || fields.linkedDocumentId?.value));
  const checks = [
    ["Project title", Boolean(fields.title?.value.trim())],
    ["Short description", Boolean(fields.shortDescription?.value.trim())],
    ["Primary action", Boolean(primaryCtaLabel())],
    ["Primary action target", primary.type ? primary.ready : linkedReady],
    ["Cover image", Boolean(pendingCoverFile || savedMediaAvailable(savedCoverImage) || fields.coverImageUrl?.value)]
  ];
  host.innerHTML = `<div class="project-readiness-heading"><strong>Project Readiness</strong><span>${checks.filter(([,ok])=>ok).length}/${checks.length} ready</span></div><div class="project-readiness-grid">${checks.map(([label,ok]) => `<span class="project-readiness-item ${ok ? "is-ready" : "is-missing"}"><i aria-hidden="true"></i>${escapeHtml(label)}</span>`).join("")}</div>`;
}

function renderActionIntelligence() {
  renderActionRequirementStatus();
  renderPrimaryActionTargetEditor();
  syncSmartMediaVisibility();
  syncSmartResourceVisibility();
  renderResourceStatus();
  renderResourceUsageRelations();
  renderProjectReadiness();
}

function setPrimaryCtaLabel(label = "", { auto = false } = {}) {
  if (!fields.buttonLabel) return;
  const fallback = activeProjectType() === "linked-module" ? "View Details" : "View Project";
  const value = normalizeProjectButtonLabel(label || fallback) || fallback;
  const presets = primaryCtaPresets();
  renderPrimaryCtaOptions(value);
  if (presets.includes(value)) {
    fields.buttonLabel.value = value;
    if (fields.buttonCustomLabel) {
      fields.buttonCustomLabel.value = "";
      fields.buttonCustomLabel.classList.add("hidden");
      fields.buttonCustomLabel.required = false;
    }
  } else {
    fields.buttonLabel.value = "__custom__";
    if (fields.buttonCustomLabel) {
      fields.buttonCustomLabel.value = value;
      fields.buttonCustomLabel.classList.remove("hidden");
      fields.buttonCustomLabel.required = true;
    }
  }
  fields.buttonLabel.dataset.linkedResolvedLabel = value;
  if (auto) fields.buttonLabel.dataset.linkedAutoValue = value;
}

function primaryCtaLabel() {
  if (!fields.buttonLabel) return "";
  return fields.buttonLabel.value === "__custom__"
    ? normalizeProjectButtonLabel(fields.buttonCustomLabel?.value || "")
    : normalizeProjectButtonLabel(fields.buttonLabel.value || "");
}

function renderLinkedModuleOptions(selectedKey = "") {
  if (!fields.linkedModule) return;
  const modules = registeredModules();
  const options = ['<option value="">Select a portfolio module</option>'];
  modules.forEach((module) => {
    options.push(`<option value="${escapeHtml(module.key)}">${escapeHtml(module.label)}</option>`);
  });
  if (selectedKey && !modules.some((module) => module.key === selectedKey)) {
    options.push(`<option value="${escapeHtml(selectedKey)}">Legacy: ${escapeHtml(selectedKey)}</option>`);
  }
  fields.linkedModule.innerHTML = options.join("");
  fields.linkedModule.value = selectedKey || "";
}

function createLinkedActionId() {
  linkedActionSequence += 1;
  return `linked-action-${linkedActionSequence}`;
}

function normalizeLinkedActionState(action = {}, index = 0) {
  const moduleKey = String(action.moduleKey || action.linkedModuleKey || "").trim();
  const module = getPortfolioModule(moduleKey);
  const inferredKind = String(action.kind || "").trim() === "resource" ? "resource" : (moduleKey || action.documentId || action.linkedDocumentId ? "linked" : "resource");
  const resourceType = Object.prototype.hasOwnProperty.call(action, "resourceType") ? String(action.resourceType || "").trim() : (resourceRequirementForAction(action.label || action.buttonLabel) || "demo-video");
  const explicitLabel = String(action.label || action.buttonLabel || "").trim();
  const defaultLabel = inferredKind === "linked" ? suggestedModuleCta(module) : resourceDefaultLabel(resourceType);
  return {
    clientId: action.clientId || createLinkedActionId(),
    kind: inferredKind,
    resourceType,
    resourceIndex: Math.max(0, Number.parseInt(action.resourceIndex, 10) || 0),
    moduleKey: module?.key || moduleKey,
    documentId: String(action.documentId || action.linkedDocumentId || "").trim(),
    label: explicitLabel || defaultLabel,
    destination: String(module?.publicDestination || action.destination || action.linkedDestination || "").trim(),
    titleSnapshot: String(action.titleSnapshot || action.title || "").trim(),
    displayOrder: Number.isFinite(Number(action.displayOrder)) ? Number(action.displayOrder) : index,
    labelAuto: action.labelAuto === true || !explicitLabel || explicitLabel === defaultLabel
  };
}

function resourceDefaultLabel(resourceType = "") {
  return ({
    "project-preview": "View Project",
    "demo-video": "Watch Video",
    "live-website": "Open Live Website",
    pdf: "View PDF",
    download: "Download",
    "custom-resource": "Open Resource",
    github: "GitHub"
  })[resourceType] || "Choose action";
}

function resourceActionLabelPresets(resourceType = "") {
  return ({
    "project-preview": ["View Project"],
    "demo-video": ["Watch Video", "Watch Demo", "Watch Animation"],
    "live-website": ["Open Live Website", "View Website"],
    pdf: ["View PDF", "View Documentation"],
    download: ["Download", "Download Files"],
    "custom-resource": ["Open Resource", "View Resource", "Download Resource"],
    github: ["GitHub", "View Source Code"]
  })[resourceType] || [resourceDefaultLabel(resourceType)];
}

function linkedActionLabelPresets(module = null) {
  const suggested = suggestedModuleCta(module) || "View Details";
  return [...new Set([suggested, "View Details"])];
}

function projectActionKindOptions(selected = "resource") {
  return `<option value="resource"${selected === "resource" ? " selected" : ""}>Project Asset</option><option value="linked"${selected === "linked" ? " selected" : ""}>Portfolio Content</option>`;
}

function projectResourceOptions(selected = "") {
  const resources = [
    ["", "Select a Project Asset"],
    ["project-preview", "Project Details"],
    ["demo-video", "Project Video"],
    ["live-website", "Live Website"],
    ["pdf", "PDF / Document"],
    ["download", "Download File"],
    ["custom-resource", "Custom Asset"],
    ["github", "GitHub Repository"]
  ];
  return resources.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function projectResourceItemOptions(action = {}) {
  const items = projectResourceItems(action.resourceType);
  if (!items.length) return '<option value="0">No resources available</option>';
  return items.map((item, index) => `<option value="${index}"${index === Number(action.resourceIndex || 0) ? " selected" : ""}>${escapeHtml(projectResourceItemName(item, index))}</option>`).join("");
}

function resourceActionSummary(action = {}) {
  const ready = projectResourceReady(action.resourceType, action.resourceIndex);
  const selectedItem = ["download", "custom-resource"].includes(action.resourceType)
    ? projectResourceItems(action.resourceType)[Number(action.resourceIndex || 0)]
    : null;
  const itemLabel = selectedItem ? ` (${projectResourceItemName(selectedItem, Number(action.resourceIndex || 0))})` : "";
  return `${resourceRequirementLabel(action.resourceType)}${itemLabel} — ${ready ? "Ready" : "Missing resource"}`;
}

function linkedActionModuleOptions(selectedKey = "") {
  const modules = registeredModules();
  const options = ['<option value="">Select a portfolio module</option>'];
  modules.forEach((module) => {
    options.push(`<option value="${escapeHtml(module.key)}"${module.key === selectedKey ? " selected" : ""}>${escapeHtml(module.label)}</option>`);
  });
  if (selectedKey && !modules.some((module) => module.key === selectedKey)) {
    options.push(`<option value="${escapeHtml(selectedKey)}" selected>Legacy: ${escapeHtml(selectedKey)}</option>`);
  }
  return options.join("");
}

function linkedActionEntryOptions(action = {}) {
  if (!action.moduleKey) return '<option value="">Select a module first</option>';
  const entries = linkedSourceCache.get(action.moduleKey);
  if (!entries) return '<option value="">Loading entries…</option>';
  if (!entries.length) return '<option value="">No available entries</option>';
  const options = ['<option value="">Select source entry</option>'];
  entries.forEach((entry) => {
    const identifyingText = [entry.category, entry.meta, entry.status].filter(Boolean).join(" · ");
    options.push(`<option value="${escapeHtml(entry.id)}"${entry.id === action.documentId ? " selected" : ""}>${escapeHtml(entry.title)}${identifyingText ? ` — ${escapeHtml(identifyingText)}` : ""}</option>`);
  });
  if (action.documentId && !entries.some((entry) => entry.id === action.documentId)) {
    options.push(`<option value="${escapeHtml(action.documentId)}" selected>Missing source — choose a replacement</option>`);
  }
  return options.join("");
}

function linkedActionSummary(action = {}) {
  if (action.kind === "resource") return resourceActionSummary(action);
  const module = getPortfolioModule(action.moduleKey);
  const entries = linkedSourceCache.get(action.moduleKey) || [];
  const entry = entries.find((item) => item.id === action.documentId);
  if (!action.moduleKey) return "Choose a module and entry for this button.";
  if (!action.documentId) return `${module?.label || action.moduleKey}: choose an entry.`;
  if (!entry) return `${module?.label || action.moduleKey}: linked entry is unavailable.`;
  return `${module?.label || action.moduleKey} → ${entry.title}`;
}


function additionalActionTargetControls(action = {}) {
  if (action.kind !== "resource" || !action.resourceType || projectResourceReady(action.resourceType, action.resourceIndex)) return "";
  return '<button type="button" class="editor-secondary-button button-compact" data-action-open-tab="media">Open Project Assets</button>';
}

function renderLinkedActions() {
  if (!linkedActionElements.list) return;
  if (!linkedActions.length) {
    linkedActionElements.list.innerHTML = '<div class="project-linked-actions-empty"><strong>No additional actions</strong><span>Add a Project Asset or Portfolio Content button when this card needs another destination.</span></div>';
    return;
  }
  linkedActionElements.list.innerHTML = linkedActions.map((action, index) => {
    const module = getPortfolioModule(action.moduleKey);
    const entries = action.moduleKey ? linkedSourceCache.get(action.moduleKey) : null;
    const entryDisabled = !action.moduleKey || !entries || entries.length === 0;
    const resource = action.kind === "resource";
    const actionLabelPresets = resource ? resourceActionLabelPresets(action.resourceType) : linkedActionLabelPresets(module);
    const customLabel = !actionLabelPresets.includes(action.label);
    const resourceNeedsItem = resource && ["download", "custom-resource"].includes(action.resourceType);
    return `<article class="project-linked-action" data-linked-action-id="${escapeHtml(action.clientId)}">
      <header><div><span>Button ${index + 2}</span><strong>${escapeHtml(action.label || (resource ? resourceDefaultLabel(action.resourceType) : suggestedModuleCta(module)))}</strong></div><button class="editor-danger-button button-compact" type="button" data-remove-linked-action="${escapeHtml(action.clientId)}">Remove</button></header>
      <div class="project-linked-action-grid">
        <label><span>Target type</span><select data-project-action-kind required>${projectActionKindOptions(action.kind)}</select></label>
        ${resource
          ? `<label><span>Project asset</span><select data-project-action-resource required>${projectResourceOptions(action.resourceType)}</select></label>${resourceNeedsItem ? `<label><span>Resource item</span><select data-project-action-resource-item required>${projectResourceItemOptions(action)}</select></label>` : ""}`
          : `<label><span>Target module</span><select data-linked-action-module required>${linkedActionModuleOptions(action.moduleKey)}</select></label><label><span>Target entry</span><select data-linked-action-entry required ${entryDisabled ? "disabled" : ""}>${linkedActionEntryOptions(action)}</select></label>`}
        <label class="project-linked-action-label"><span>Button label</span><select data-linked-action-label required>${ctaSelectOptions(action.label, resource ? resourceDefaultLabel(action.resourceType) : suggestedModuleCta(module), actionLabelPresets)}</select><input class="project-cta-custom-input${customLabel ? "" : " hidden"}" data-linked-action-custom-label maxlength="50" value="${customLabel ? escapeHtml(action.label) : ""}" placeholder="Custom button label" type="text" ${customLabel ? "required" : ""}></label>
      </div>
      <p class="project-linked-action-summary ${resource && !projectResourceReady(action.resourceType, action.resourceIndex) ? "is-missing" : ""}">${escapeHtml(linkedActionSummary(action))}</p>
      ${resource ? `<div class="project-linked-action-smart-target">${additionalActionTargetControls(action)}</div>` : ""}
    </article>`;
  }).join("");
}

async function ensureLinkedActionEntries(action, { force = false } = {}) {
  if (!action?.moduleKey) return [];
  let entries = !force ? linkedSourceCache.get(action.moduleKey) : null;
  if (!entries) {
    entries = await loadPortfolioModuleEntries(action.moduleKey);
    linkedSourceCache.set(action.moduleKey, entries);
  }
  return entries;
}

async function hydrateLinkedActions() {
  const moduleKeys = [...new Set(linkedActions.filter((action) => action.kind === "linked").map((action) => action.moduleKey).filter(Boolean))];
  await Promise.all(moduleKeys.map(async (moduleKey) => {
    try {
      let entries = linkedSourceCache.get(moduleKey);
      if (!entries) {
        entries = await loadPortfolioModuleEntries(moduleKey);
        linkedSourceCache.set(moduleKey, entries);
      }
    } catch (error) {
      console.warn(`Unable to load additional linked actions for ${moduleKey}:`, error);
      linkedSourceCache.set(moduleKey, []);
    }
  }));
  renderLinkedActions();
}

function linkedActionsFromEditor() {
  return linkedActions.map((action, index) => ({
    kind: action.kind || "resource",
    resourceType: action.kind === "resource" ? action.resourceType : "",
    resourceIndex: action.kind === "resource" ? Math.max(0, Number.parseInt(action.resourceIndex, 10) || 0) : 0,
    moduleKey: action.kind === "linked" ? action.moduleKey : "",
    documentId: action.kind === "linked" ? action.documentId : "",
    label: action.label,
    destination: action.kind === "linked" ? (getPortfolioModule(action.moduleKey)?.publicDestination || action.destination || "") : "",
    titleSnapshot: action.kind === "linked" ? (action.titleSnapshot || "") : "",
    displayOrder: index
  }));
}

function validateLinkedActionsEditor() {
  const primaryKey = activeProjectType() === "linked-module" ? `${fields.linkedModule?.value || ""}:${fields.linkedDocumentId?.value || ""}` : "";
  const seen = new Set(primaryKey && primaryKey !== ":" ? [primaryKey] : []);
  linkedActions.forEach((action, index) => {
    const number = index + 2;
    if (!String(action.label || "").trim()) throw new Error(`Button ${number}: enter a button label.`);
    if (action.kind === "resource") {
      if (!action.resourceType) throw new Error(`Button ${number}: choose a Project Asset.`);
      if (!projectResourceReady(action.resourceType, action.resourceIndex)) throw new Error(`Button ${number}: ${resourceRequirementLabel(action.resourceType)} is required.`);
      return;
    }
    if (!getPortfolioModule(action.moduleKey)) throw new Error(`Button ${number}: select a target module.`);
    if (!action.documentId) throw new Error(`Button ${number}: select a target entry.`);
    const key = `${action.moduleKey}:${action.documentId}`;
    if (seen.has(key)) throw new Error(`Button ${number}: this source is already connected to the project.`);
    seen.add(key);
  });
}

function formatLinkedDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(date);
}


function linkedModuleEmblemMarkup(module = null) {
  const key = String(module?.key || "").toLowerCase();
  const common = 'viewBox="0 0 24 24" role="presentation" focusable="false"';
  const paths = key.includes("experience")
    ? '<rect x="3.5" y="7" width="17" height="12.5" rx="2.4"/><path d="M8.5 7V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6V7M3.5 11.5h17M10 11.5v1.8h4v-1.8"/>'
    : key.includes("education")
      ? '<path d="m2.5 9 9.5-4.6L21.5 9 12 13.6 2.5 9Z"/><path d="M6 11.2v4c3 2.6 9 2.6 12 0v-4M21.5 9v5.7"/>'
      : key.includes("skill")
        ? '<path d="m12 3 2.3 5.4 5.8.7-4.4 3.8 1.3 5.7-5-3-5 3 1.3-5.7-4.4-3.8 5.8-.7L12 3Z"/>'
        : key.includes("photo")
          ? '<rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><circle cx="12" cy="13" r="3.2"/><path d="m8 6.5 1.4-2h5.2l1.4 2"/>'
          : key.includes("certificate")
            ? '<circle cx="12" cy="9" r="5"/><path d="m9 13.1-1 7.9 4-2.2 4 2.2-1-7.9"/>'
            : key.includes("resume")
              ? '<path d="M6 2.5h8.2L18.5 7v14.5H6z"/><path d="M14 2.5V7h4.5M9 11.5h6M9 15h6M9 18.5h4.2"/>'
              : key.includes("about")
                ? '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.5-4 3-6.3 6.5-6.3s6 2.3 6.5 6.3"/>'
                : '<path d="M8.4 8.5 6.2 10.7a3.6 3.6 0 0 0 5.1 5.1l2.2-2.2M15.6 15.5l2.2-2.2a3.6 3.6 0 1 0-5.1-5.1l-2.2 2.2"/><path d="m9.5 14.5 5-5"/>';
  return `<svg class="linked-module-svg" ${common}>${paths}</svg>`;
}

function linkedConnectionEmblemMarkup() {
  return '<svg class="linked-module-svg" viewBox="0 0 24 24" role="presentation" focusable="false"><path d="M8.4 8.5 6.2 10.7a3.6 3.6 0 0 0 5.1 5.1l2.2-2.2M15.6 15.5l2.2-2.2a3.6 3.6 0 1 0-5.1-5.1l-2.2 2.2"/><path d="m9.5 14.5 5-5"/></svg>';
}

function setLinkedSourceStatus(message, state = "", details = {}) {
  if (!linkedSourceElements.status) return;
  const module = getPortfolioModule(details.moduleKey || fields.linkedModule?.value);
  const workspace = document.querySelector(".linked-connection-workspace");
  workspace?.classList.toggle("has-module", Boolean(module));
  linkedSourceElements.status.dataset.state = state;
  const stateLabel = state === "loading" ? "Loading" : state === "error" ? "Needs attention" : state === "empty" ? "No entries" : module ? "Connected" : "Waiting";
  if (module) {
    const countText = Number.isFinite(details.count)
      ? details.count === 1 ? "1 available entry" : `${details.count} available entries`
      : (message || "Registered portfolio module");
    const supportText = state === "error" ? "Try again or choose another portfolio module."
      : state === "empty" ? "This module has no entries currently available for linking."
      : "The source module keeps ownership; Projects stores only the link reference.";
    linkedSourceElements.status.innerHTML = `<div class="linked-status-summary"><span class="linked-status-module-icon" aria-hidden="true">${linkedModuleEmblemMarkup(module)}</span><div><span class="linked-module-status-label">${escapeHtml(stateLabel)}</span><strong>${escapeHtml(module.label)}</strong><span>${escapeHtml(countText)}</span></div></div><small>${escapeHtml(supportText)}</small>`;
    return;
  }
  linkedSourceElements.status.innerHTML = `<div class="linked-status-summary"><span class="linked-status-module-icon" aria-hidden="true">${linkedConnectionEmblemMarkup()}</span><div><span class="linked-module-status-label">${escapeHtml(stateLabel)}</span><strong>Choose a source module</strong><span>${escapeHtml(message || "Select a portfolio module to begin.")}</span></div></div>${details.supporting ? `<small>${escapeHtml(details.supporting)}</small>` : ""}`;
}

function renderLinkedSourcePreview(entry = null, { state = "empty" } = {}) {
  selectedLinkedSource = entry || null;
  document.querySelector(".linked-connection-workspace")?.classList.toggle("has-entry", Boolean(entry));
  if (!linkedSourceElements.preview) return;
  linkedSourceElements.success?.classList.add("hidden");
  if (!entry) {
    const title = state === "loading" ? "Loading linked content…"
      : state === "error" ? "Unable to load linked content"
      : "Choose content to preview";
    const description = state === "loading" ? "Preparing available entries."
      : state === "error" ? "Select another portfolio module or try again."
      : "Select an entry to preview the linked content.";
    const footer = state === "loading" ? "Please wait…"
      : state === "error" ? "No content is currently selected."
      : "Nothing has been linked yet.";
    linkedSourceElements.preview.innerHTML = `<div class="linked-preview-empty" data-state="${escapeHtml(state)}"><span class="linked-preview-empty-icon" aria-hidden="true">${state === "loading" ? "<span class=\"linked-loading-dot\"></span>" : linkedConnectionEmblemMarkup()}</span><div><p class="editor-eyebrow">Live card source</p><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p><small>${escapeHtml(footer)}</small></div></div>`;
    return;
  }
  const module = getPortfolioModule(entry.moduleKey);
  const moduleLabel = module?.label || entry.moduleLabel || "Portfolio module";
  const updated = formatLinkedDate(entry.updatedAt);
  const actionLabel = primaryCtaLabel() || suggestedModuleCta(module);
  const metadata = [
    entry.moduleScope ? `<span><b>Scope</b>Entire module</span>` : (entry.status ? `<span><b>Status</b>${escapeHtml(formatLabel(entry.status))}</span>` : ""),
    entry.category ? `<span><b>${entry.moduleScope ? "Coverage" : "Category"}</b>${escapeHtml(entry.category)}</span>` : "",
    updated ? `<span><b>Last updated</b>${escapeHtml(updated)}</span>` : "",
    actionLabel ? `<span><b>Primary action</b>${escapeHtml(actionLabel)}</span>` : ""
  ].filter(Boolean).join("");
  const viewSource = module?.adminDestination
    ? `<a class="editor-secondary-button button-compact linked-view-source" href="${escapeHtml(module.adminDestination)}" target="_blank" rel="noopener noreferrer">View Source</a>`
    : "";
  linkedSourceElements.preview.innerHTML = `
    <div class="linked-preview-heading"><span class="linked-preview-module-mark" aria-hidden="true">${linkedModuleEmblemMarkup(module)}</span><div><p class="editor-eyebrow">Live card source</p><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(moduleLabel)}</small></div><span class="linked-preview-ready">Linked</span></div>
    <div class="linked-preview-content">
      <div class="linked-source-thumbnail">${entry.cover ? `<img src="${escapeHtml(projectAdminThumbnail(entry.cover, 640, 420))}" alt="Cover preview for ${escapeHtml(entry.title)}" loading="lazy" decoding="async">` : `<span class="linked-thumbnail-emblem" aria-label="${escapeHtml(moduleLabel)} placeholder">${linkedModuleEmblemMarkup(module)}</span>`}</div>
      <div class="linked-source-copy"><span class="linked-source-kicker">${escapeHtml(moduleLabel)}</span>${entry.summary ? `<p>${escapeHtml(entry.summary)}</p>` : ""}<div class="linked-source-metadata">${metadata}</div>${viewSource ? `<div class="linked-preview-actions">${viewSource}</div>` : ""}</div>
    </div>`;
  const image = linkedSourceElements.preview.querySelector("img");
  if (image) {
    image.addEventListener("load", () => image.classList.add("is-loaded"), { once: true });
    image.addEventListener("error", () => {
      const fallback = document.createElement("span"); fallback.className = "linked-thumbnail-emblem"; fallback.innerHTML = linkedModuleEmblemMarkup(module); image.replaceWith(fallback);
    }, { once: true });
  }
  if (linkedSourceElements.success) {
    linkedSourceElements.success.innerHTML = `<span class="linked-success-emblem" aria-hidden="true"><svg class="linked-module-svg" viewBox="0 0 24 24" role="presentation" focusable="false"><path d="m5 12.5 4 4L19 6.8"/></svg></span><div class="linked-success-copy"><span class="linked-success-kicker">Connection complete</span><strong>${escapeHtml(entry.title)}</strong><div class="linked-success-meta"><span>${escapeHtml(moduleLabel)}</span><span>${entry.moduleScope ? "Entire module" : "Linked source"}</span></div><small>${entry.moduleScope ? `This Project represents the complete ${escapeHtml(moduleLabel)} module. New published content is included automatically.` : `Projects keeps only the reference. Opening this card will take visitors to the original ${escapeHtml(moduleLabel)} entry.`}</small></div>${module?.adminDestination ? `<a class="editor-secondary-button button-compact linked-success-action" href="${escapeHtml(module.adminDestination)}" target="_blank" rel="noopener noreferrer">View Source</a>` : ""}`;
    linkedSourceElements.success.classList.remove("hidden");
  }
}

function autoFillLinkedField(field, value) {
  if (!field || !value) return;
  const previousAutoValue = field.dataset.linkedAutoValue || "";
  if (!field.value.trim() || field.value === previousAutoValue) {
    field.value = value;
    field.dataset.linkedAutoValue = value;
  }
}

function linkedModuleScope(moduleKey = fields.linkedModule?.value || "") {
  const module = getPortfolioModule(moduleKey);
  return String(module?.linkScope || "entry").trim().toLowerCase() === "module" ? "module" : "entry";
}

function linkedProjectSourceMissing(project = {}) {
  const module = getPortfolioModule(project.linkedModuleKey || project.linkedModule || "");
  if (!module) return true;
  if (linkedModuleScope(module.key) === "module") return false;
  return Boolean(project.linkedSourceMissing || !project.linkedDocumentId);
}

function isPublishedLinkedEntry(entry = {}) {
  const raw = entry.raw || entry;
  return String(raw?.status || entry.status || "").trim().toLowerCase() === "published"
    && raw?.visible !== false
    && raw?.isDeleted !== true
    && !raw?.deletedAt
    && raw?.archived !== true
    && !raw?.archivedAt;
}

function linkedSourceOwnsCapabilities(moduleKey = "") {
  return ["experience", "photo-editing"].includes(String(moduleKey || "").trim().toLowerCase());
}

function moduleCapabilityIds(moduleKey = "", entries = []) {
  const published = (Array.isArray(entries) ? entries : []).filter(isPublishedLinkedEntry);
  return {
    skillIds: uniqueIds(published.flatMap((entry) => entry.raw?.skillIds || entry.skillIds || [])),
    toolIds: uniqueIds(published.flatMap((entry) => entry.raw?.toolIds || entry.toolIds || [])),
    categories: [...new Set(published.map((entry) => String(entry.raw?.category || entry.category || "").trim()).filter(Boolean))],
    count: published.length,
    entries: published
  };
}

function readOnlyCapabilityRow(record = {}, type = "skill") {
  if (!record?.name) return "";
  const tool = type === "tool";
  const iconSource = tool ? projectToolIconSource(record) : "";
  let iconMarkup = "";
  let iconClass = "lan-relationship-icon";
  if (iconSource) {
    iconMarkup = `<img src="${escapeHtml(iconSource)}" alt="" aria-hidden="true" loading="lazy">`;
  } else if (!tool && typeof window.LANSkillGlyphMarkup === "function") {
    const tone = typeof window.LANSkillIconTone === "function"
      ? window.LANSkillIconTone(record.name || "", record.customCategory || record.category || "")
      : "fallback";
    iconClass += ` is-skill-glyph skill-tone--${escapeHtml(tone)}`;
    iconMarkup = window.LANSkillGlyphMarkup(record.name || "", record.customCategory || record.category || "");
  } else {
    iconClass += " is-fallback";
    iconMarkup = tool ? "◇" : "✦";
  }
  const meta = tool
    ? formatLabel(record.customCategory || record.category || "tool")
    : skillCategoryLabel(record);
  return `<div class="lan-relationship-row is-${tool ? "tool" : "skill"}"><span class="${iconClass}">${iconMarkup}</span><span class="lan-relationship-copy"><strong class="lan-relationship-label">${escapeHtml(record.name)}</strong>${meta ? `<small class="lan-relationship-meta">${escapeHtml(meta)}</small>` : ""}</span></div>`;
}

function linkedSourceCapabilityIds(kind, source = selectedLinkedSource) {
  const raw = source?.raw || source || {};
  const isTool = kind === "tools" || kind === "tool";
  const direct = uniqueIds(isTool
    ? (raw.entryToolIds || raw.toolIds || [])
    : (raw.entrySkillIds || raw.skillIds || []));
  if (direct.length) return direct;
  return isTool
    ? inferLegacyToolIds(legacySourceToolNames(raw))
    : inferLegacySkillIds(raw.skills || raw.skillsUsed || []);
}

function renderLinkedCapabilitySummary(moduleKey = fields.linkedModule?.value || "", source = selectedLinkedSource) {
  const linked = activeProjectType() === "linked-module";
  const module = getPortfolioModule(moduleKey);
  const entryScope = linked && module && linkedModuleScope(module.key) === "entry";
  const linkedEntryReady = entryScope && Boolean(source?.id || fields.linkedDocumentId?.value);

  if (linkedSourceElements.capabilityEditors) {
    linkedSourceElements.capabilityEditors.classList.toggle("hidden", linked && !linkedEntryReady);
  }
  linkedSourceElements.capabilityLibraryLink?.classList.toggle("hidden", false);
  if (!linkedSourceElements.capabilitySummary) return;
  linkedSourceElements.capabilitySummary.classList.toggle("hidden", !linked);

  if (!linked) {
    syncProjectCapabilityPickers();
    syncProjectPublicTagsUI();
    return;
  }

  if (!module) {
    linkedSourceElements.capabilitySummary.innerHTML = `<div class="project-inherited-capability-empty"><strong>Select a source module first.</strong><span>Skills and Tools will be inherited automatically from the linked source.</span></div>`;
    syncProjectPublicTagsUI();
    return;
  }

  const manageHref = module.adminDestination || "";
  if (entryScope) {
    const sourceText = source?.title ? `${module.label} · ${source.title}` : module.label;
    const supporting = linkedEntryReady
      ? `Use + Link Skill or + Link Tool below. Existing records are linked to the owning ${module.label} entry; new names entered with Enter are created once in the shared library and linked to that source.`
      : `Select a ${module.label} entry before editing its Skills and Tools.`;
    linkedSourceElements.capabilitySummary.innerHTML = `
      <div class="project-inherited-capability-head"><div><span class="editor-eyebrow">Source-owned capabilities</span><strong>${escapeHtml(sourceText)}</strong><p>${escapeHtml(supporting)}</p></div>${manageHref ? `<a class="editor-secondary-button button-compact" href="${escapeHtml(manageHref)}">Manage in ${escapeHtml(module.label)}</a>` : ""}</div>`;
    if (linkedEntryReady) syncProjectCapabilityPickers();
    syncProjectPublicTagsUI();
    return;
  }

  const summary = moduleCapabilityIds(module.key, linkedSourceCache.get(module.key) || []);
  const skillMap = new Map(skillsLibrary.map((item) => [item.id, item]));
  const toolMap = new Map(toolsLibrary.map((item) => [item.id, item]));
  const skills = summary.skillIds.map((id) => skillMap.get(id)).filter(Boolean);
  const tools = summary.toolIds.map((id) => toolMap.get(id)).filter(Boolean);
  const sourceText = `${module.label} · Entire module`;
  const supporting = `${summary.count} published sample${summary.count === 1 ? "" : "s"}${summary.categories.length ? ` · ${summary.categories.length} categor${summary.categories.length === 1 ? "y" : "ies"}` : ""}. New published samples are included automatically.`;
  linkedSourceElements.capabilitySummary.innerHTML = `
    <div class="project-inherited-capability-head"><div><span class="editor-eyebrow">Inherited capabilities</span><strong>${escapeHtml(sourceText)}</strong><p>${escapeHtml(supporting)}</p></div>${manageHref ? `<a class="editor-secondary-button button-compact" href="${escapeHtml(manageHref)}">Manage in ${escapeHtml(module.label)}</a>` : ""}</div>
    <div class="project-inherited-capability-groups">
      <div><span class="project-inherited-capability-label">Tools used</span>${tools.length ? `<div class="lan-relationship-list">${tools.map((item) => readOnlyCapabilityRow(item, "tool")).join("")}</div>` : '<span class="project-capability-none">No Tools are currently exposed by this source.</span>'}</div>
      <div><span class="project-inherited-capability-label">Skills demonstrated</span>${skills.length ? `<div class="lan-relationship-list">${skills.map((item) => readOnlyCapabilityRow(item, "skill")).join("")}</div>` : '<span class="project-capability-none">No Skills are currently exposed by this source.</span>'}</div>
    </div>`;
  syncProjectPublicTagsUI();
}

function projectPublicTagMode() {
  return normalizePublicTagMode(fields.publicTagMode?.value || "automatic");
}

function availableProjectPublicCapabilities() {
  const skillById = new Map(skillsLibrary.map((skill) => [String(skill.id), skill]));
  const toolById = new Map(toolsLibrary.map((tool) => [String(tool.id), tool]));
  if (activeProjectType() !== "linked-module") {
    return {
      tools: uniqueIds(selectedToolIds).map((id) => toolById.get(String(id))).filter(Boolean),
      skills: uniqueIds(selectedSkillIds).map((id) => skillById.get(String(id))).filter(Boolean)
    };
  }

  const moduleKey = fields.linkedModule?.value || "";
  const module = getPortfolioModule(moduleKey);
  if (!module) return { tools: [], skills: [] };

  let toolIds = [];
  let skillIds = [];
  if (linkedModuleScope(module.key) === "module") {
    const summary = moduleCapabilityIds(module.key, linkedSourceCache.get(module.key) || []);
    toolIds = summary.toolIds;
    skillIds = summary.skillIds;
  } else if (selectedLinkedSource) {
    toolIds = linkedSourceCapabilityIds("tools", selectedLinkedSource);
    skillIds = linkedSourceCapabilityIds("skills", selectedLinkedSource);
  }
  return {
    tools: uniqueIds(toolIds).map((id) => toolById.get(String(id))).filter(Boolean),
    skills: uniqueIds(skillIds).map((id) => skillById.get(String(id))).filter(Boolean)
  };
}

function publicTagRefsForType(type = "tool") {
  return normalizePublicTagRefs(selectedPublicTagRefs).filter((ref) => ref.type === type);
}

function setPublicTagRefsForType(type = "tool", ids = []) {
  const normalizedType = type === "skill" ? "skill" : "tool";
  const other = normalizePublicTagRefs(selectedPublicTagRefs).filter((ref) => ref.type !== normalizedType);
  const current = uniqueIds(ids).map((id) => ({ type: normalizedType, id }));
  selectedPublicTagRefs = [...other, ...current];
}

function syncPublicTagField() {
  selectedPublicTagRefs = normalizePublicTagRefs(selectedPublicTagRefs);
  if (fields.publicTagRefs) fields.publicTagRefs.value = JSON.stringify(selectedPublicTagRefs);
}

function renderPublicTagSummary(capabilities = [], mode = projectPublicTagMode(), groups = availableProjectPublicCapabilities()) {
  if (!linkedSourceElements.publicTagAutomaticSummary) return;
  if (!capabilities.length) {
    linkedSourceElements.publicTagAutomaticSummary.innerHTML = '<span class="project-public-tool-empty">No public tags are available from this Project yet.</span>';
    return;
  }
  const rows = capabilities.map(({ type, item }) => readOnlyCapabilityRow(item, type)).join("");
  const toolCount = capabilities.filter((item) => item.type === "tool").length;
  const skillCount = capabilities.length - toolCount;
  let message = `${capabilities.length} public tag${capabilities.length === 1 ? "" : "s"} selected.`;
  if (mode === "automatic") {
    message = toolCount
      ? `${toolCount} Tool${toolCount === 1 ? "" : "s"} will appear automatically.`
      : `${skillCount} Skill${skillCount === 1 ? "" : "s"} will appear because this Project has no Tools.`;
  } else if (!groups.tools.length && groups.skills.length) {
    message = `${skillCount} Skill${skillCount === 1 ? "" : "s"} selected from this Project's inherited capabilities.`;
  }
  linkedSourceElements.publicTagAutomaticSummary.innerHTML = `<div class="lan-relationship-list project-public-tag-preview">${rows}</div><small>${escapeHtml(message)}</small>`;
}

function canCreateProjectPublicTagCapability() {
  if (activeProjectType() !== "linked-module") return true;
  return linkedEntryCapabilityEditingReady() && linkedSourceOwnsCapabilities(fields.linkedModule?.value || "");
}

function updatePublicTagEmptyStates(groups = availableProjectPublicCapabilities()) {
  const canCreate = canCreateProjectPublicTagCapability();
  linkedSourceElements.publicTagToolEmpty?.classList.toggle("hidden", groups.tools.length > 0 || canCreate);
  linkedSourceElements.publicTagSkillEmpty?.classList.toggle("hidden", groups.skills.length > 0 || canCreate);
  linkedSourceElements.publicTagToolPickerHost?.classList.toggle("hidden", groups.tools.length === 0 && !canCreate);
  linkedSourceElements.publicTagSkillPickerHost?.classList.toggle("hidden", groups.skills.length === 0 && !canCreate);
}

async function commitProjectPublicTagCapability(kind, rawName) {
  if (!canCreateProjectPublicTagCapability()) {
    throw new Error("This linked Project represents an entire module. Add the capability in the owning module first.");
  }

  const isTool = kind === "tools";
  const result = await commitProjectCapabilitySearch(kind, rawName);
  const capabilityId = String(result?.id || result?.record?.id || "").trim();
  if (!capabilityId) throw new Error(`Unable to resolve the ${isTool ? "Tool" : "Skill"} record.`);

  if (activeProjectType() === "linked-module") {
    const currentIds = linkedSourceCapabilityIds(kind);
    if (!currentIds.includes(capabilityId)) {
      await persistLinkedSourceCapabilitySelection(kind, [...currentIds, capabilityId]);
    }
  } else {
    if (isTool) selectedToolIds = uniqueIds([...selectedToolIds, capabilityId]);
    else selectedSkillIds = uniqueIds([...selectedSkillIds, capabilityId]);
    syncCapabilityFields();
    markAsChanged();
  }

  syncProjectCapabilityPickers();
  syncProjectPublicTagsUI();
  return result;
}

function syncProjectPublicTagsUI({ preserveSelection = true } = {}) {
  const groups = availableProjectPublicCapabilities();
  if (!preserveSelection) selectedPublicTagRefs = [];
  syncPublicTagField();

  const validRefs = validPublicTagRefs({ ...groups, refs: selectedPublicTagRefs });
  const staleCount = Math.max(0, selectedPublicTagRefs.length - validRefs.length);
  const mode = projectPublicTagMode();
  document.querySelectorAll("[data-project-public-tag-mode]").forEach((button) => {
    const active = button.dataset.projectPublicTagMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (linkedSourceElements.publicTagsStatus) linkedSourceElements.publicTagsStatus.textContent = mode === "custom" ? "Custom" : "Automatic";
  linkedSourceElements.publicTagCustom?.classList.toggle("hidden", mode !== "custom");
  updatePublicTagEmptyStates(groups);

  if (linkedSourceElements.publicTagWarning) {
    linkedSourceElements.publicTagWarning.classList.toggle("hidden", !staleCount || mode !== "custom");
    linkedSourceElements.publicTagWarning.textContent = staleCount
      ? `${staleCount} previously selected public tag${staleCount === 1 ? " is" : "s are"} no longer available from this Project and will not be published.`
      : "";
  }

  const visible = resolvePublicProjectCapabilities({
    ...groups,
    mode,
    refs: validRefs
  });
  renderPublicTagSummary(visible, mode, groups);

  if (typeof window.LANCreateCapabilityPicker !== "function") return;
  if (linkedSourceElements.publicTagToolPickerHost && (groups.tools.length || canCreateProjectPublicTagCapability())) {
    const selectedIds = publicTagRefsForType("tool").map((ref) => ref.id).filter((id) => groups.tools.some((tool) => String(tool.id) === String(id)));
    const options = {
      type: "tool",
      records: groups.tools,
      selectedIds,
      placeholder: "Choose an available Tool…",
      compactAdd: true,
      relationshipStyle: true,
      addLabel: "+ Choose Tool",
      emptyTitle: "No matching Tool found.",
      emptyHint: canCreateProjectPublicTagCapability()
        ? "No linked Tool matches yet."
        : "Only Tools actually owned or inherited by this Project are available.",
      getIcon: projectToolIconSource,
      getMeta: (tool) => formatLabel(tool.customCategory || tool.category || "tool"),
      onChange(ids) {
        const currentGroups = availableProjectPublicCapabilities();
        setPublicTagRefsForType("tool", ids.filter((id) => currentGroups.tools.some((tool) => String(tool.id) === String(id))));
        syncPublicTagField();
        syncProjectPublicTagsUI();
        markAsChanged();
      },
      async onCommit(value) {
        return commitProjectPublicTagCapability("tools", value);
      }
    };
    if (!projectPublicTagToolPicker) projectPublicTagToolPicker = window.LANCreateCapabilityPicker(linkedSourceElements.publicTagToolPickerHost, options);
    else projectPublicTagToolPicker.update(options);
  }

  if (linkedSourceElements.publicTagSkillPickerHost && (groups.skills.length || canCreateProjectPublicTagCapability())) {
    const selectedIds = publicTagRefsForType("skill").map((ref) => ref.id).filter((id) => groups.skills.some((skill) => String(skill.id) === String(id)));
    const options = {
      type: "skill",
      records: groups.skills,
      selectedIds,
      placeholder: "Choose an available Skill…",
      compactAdd: true,
      relationshipStyle: true,
      addLabel: "+ Choose Skill",
      emptyTitle: "No matching Skill found.",
      emptyHint: canCreateProjectPublicTagCapability()
        ? "No linked Skill matches yet."
        : "Only Skills actually owned or inherited by this Project are available.",
      getMeta: skillCategoryLabel,
      onChange(ids) {
        const currentGroups = availableProjectPublicCapabilities();
        setPublicTagRefsForType("skill", ids.filter((id) => currentGroups.skills.some((skill) => String(skill.id) === String(id))));
        syncPublicTagField();
        syncProjectPublicTagsUI();
        markAsChanged();
      },
      async onCommit(value) {
        return commitProjectPublicTagCapability("skills", value);
      }
    };
    if (!projectPublicTagSkillPicker) projectPublicTagSkillPicker = window.LANCreateCapabilityPicker(linkedSourceElements.publicTagSkillPickerHost, options);
    else projectPublicTagSkillPicker.update(options);
  }
}

function setProjectPublicTagMode(mode = "automatic", { markChanged = true } = {}) {
  const next = normalizePublicTagMode(mode);
  if (fields.publicTagMode) fields.publicTagMode.value = next;
  if (next === "custom" && !selectedPublicTagRefs.length) {
    const groups = availableProjectPublicCapabilities();
    selectedPublicTagRefs = resolvePublicProjectCapabilities({ ...groups, mode: "automatic" })
      .map(({ type, item }) => capabilityRef(type, item))
      .filter(Boolean);
  }
  syncProjectPublicTagsUI();
  if (markChanged) markAsChanged();
}

function applyLinkedSource(entry) {
  if (!entry) return;
  const module = getPortfolioModule(entry.moduleKey);
  autoFillLinkedField(fields.title, entry.title);
  autoFillLinkedField(fields.shortDescription, entry.summary);
  const currentLabel = primaryCtaLabel();
  const previousAutoLabel = fields.buttonLabel?.dataset.linkedAutoValue || "";
  if (!currentLabel || currentLabel === previousAutoLabel) {
    setPrimaryCtaLabel(suggestedModuleCta(module), { auto: true });
  }
  // Linked source media is resolved at render time. Do not copy it into the Project document.
  // Existing manual Project covers remain available only as a fallback override.
  if (fields.linkedDestination) fields.linkedDestination.value = module?.publicDestination || "";
  setJsonField(fields.linkedSourceSnapshot, {
    title: entry.title,
    summary: entry.summary,
    updatedAt: entry.updatedAt || null
  });
  if (linkedSourceOwnsCapabilities(entry.moduleKey) && linkedModuleScope(entry.moduleKey) === "entry") {
    const source = entry.raw || {};
    const sourceSkillIds = uniqueIds(source.skillIds || []);
    const sourceToolIds = uniqueIds(source.toolIds || []);
    setSelectedSkillIds(sourceSkillIds.length ? sourceSkillIds : inferLegacySkillIds(source.skills || []));
    setSelectedToolIds(sourceToolIds.length ? sourceToolIds : inferLegacyToolIds(legacySourceToolNames(source)));
  }
  renderLinkedSourcePreview(entry);
  renderLinkedCapabilitySummary(entry.moduleKey, entry);
  setLinkedSourceStatus("Source entry selected.", "ready", { moduleKey: entry.moduleKey, count: (linkedSourceCache.get(entry.moduleKey) || []).length });
  linkedSourceElements.warning?.classList.add("hidden");
  updateDestinationUI();
}

async function loadLinkedModuleSource(moduleKey, { force = false } = {}) {
  const module = getPortfolioModule(moduleKey);
  if (!module) return;
  if (fields.linkedScope) fields.linkedScope.value = "module";
  if (fields.linkedDocumentId) {
    fields.linkedDocumentId.value = "";
    fields.linkedDocumentId.required = false;
    fields.linkedDocumentId.disabled = true;
  }
  linkedSourceElements.entryField?.classList.add("hidden");
  if (linkedSourceElements.connectionStep2) linkedSourceElements.connectionStep2.querySelector("b").textContent = "Module";
  setLinkedSourceStatus("Loading module…", "loading", { moduleKey });
  try {
    let entries = !force ? linkedSourceCache.get(moduleKey) : null;
    if (!entries) {
      entries = await loadPortfolioModuleEntries(moduleKey);
      linkedSourceCache.set(moduleKey, entries);
    }
    const summary = moduleCapabilityIds(moduleKey, entries);
    const moduleTitle = module.key === "photo-editing" ? "Photo Editing Portfolio" : module.label;
    const categoryText = summary.categories.slice(0, 4).join(", ");
    const summaryText = summary.count
      ? `${summary.count} published sample${summary.count === 1 ? "" : "s"}${categoryText ? ` across ${categoryText}${summary.categories.length > 4 ? " and more" : ""}` : ""}.`
      : `The ${module.label} module has no published samples yet.`;
    const firstCover = summary.entries.find((entry) => entry.cover)?.cover || "";
    const synthetic = {
      id: "",
      moduleKey: module.key,
      moduleLabel: module.label,
      title: moduleTitle,
      summary: summaryText,
      cover: firstCover,
      status: "module",
      category: `${summary.categories.length} categories`,
      updatedAt: null,
      moduleScope: true,
      raw: null
    };
    selectedLinkedSource = synthetic;
    autoFillLinkedField(fields.title, moduleTitle);
    if (!fields.shortDescription?.value.trim()) autoFillLinkedField(fields.shortDescription, summaryText);
    if (fields.linkedDestination) fields.linkedDestination.value = module.publicDestination || "";
    setJsonField(fields.linkedSourceSnapshot, { title: moduleTitle, summary: summaryText, scope: "module" });
    renderLinkedSourcePreview(synthetic);
    setLinkedSourceStatus(`${summary.count} published sample${summary.count === 1 ? "" : "s"} included automatically.`, "ready", { moduleKey, count: summary.count });
    linkedSourceElements.warning?.classList.add("hidden");
    renderLinkedCapabilitySummary(moduleKey, synthetic);
  } catch (error) {
    console.error("Unable to load linked module summary:", error);
    renderLinkedSourcePreview(null, { state: "error" });
    setLinkedSourceStatus("Unable to load module summary", "error", { moduleKey });
    renderLinkedCapabilitySummary(moduleKey, null);
  }
}

async function loadLinkedSourceEntries(moduleKey, selectedDocumentId = "", { force = false } = {}) {
  if (!fields.linkedDocumentId) return;
  if (linkedModuleScope(moduleKey) === "module") {
    await loadLinkedModuleSource(moduleKey, { force });
    return;
  }
  if (fields.linkedScope) fields.linkedScope.value = "entry";
  linkedSourceElements.entryField?.classList.remove("hidden");
  if (linkedSourceElements.connectionStep2) linkedSourceElements.connectionStep2.querySelector("b").textContent = "Entry";
  const token = ++linkedSourceLoadToken;
  selectedLinkedSource = null;
  renderLinkedSourcePreview(null, { state: moduleKey ? "loading" : "empty" });
  fields.linkedDocumentId.disabled = true;
  fields.linkedDocumentId.innerHTML = '<option value="">Loading entries…</option>';
  if (!moduleKey) {
    fields.linkedDocumentId.innerHTML = '<option value="">Select the content you want this project card to represent</option>';
    setLinkedSourceStatus("Waiting for module selection", "", { supporting: "Choose a portfolio module to continue." });
    return;
  }
  setLinkedSourceStatus("Loading entries…", "loading", { moduleKey });
  try {
    let entries = !force ? linkedSourceCache.get(moduleKey) : null;
    if (!entries) {
      entries = await loadPortfolioModuleEntries(moduleKey);
      linkedSourceCache.set(moduleKey, entries);
    }
    if (token !== linkedSourceLoadToken) return;
    fields.linkedDocumentId.innerHTML = '<option value="">Select source entry</option>' + entries.map((entry) => {
      const linkedProject = projects.find((project) => project.id !== idInput.value && project.linkedModuleKey === moduleKey && project.linkedDocumentId === entry.id);
      const identifyingText = [entry.category, entry.meta, entry.status].filter(Boolean).join(" · ");
      return `<option value="${escapeHtml(entry.id)}"${linkedProject ? " disabled" : ""}>${escapeHtml(entry.title)}${identifyingText ? ` — ${escapeHtml(identifyingText)}` : ""}${linkedProject ? " — ✓ Linked to Project" : ""}</option>`;
    }).join("");
    fields.linkedDocumentId.disabled = false;
    if (!entries.length) {
      fields.linkedDocumentId.disabled = true;
      setLinkedSourceStatus("No available entries", "empty", { moduleKey, count: 0 });
      return;
    }
    const selected = entries.find((entry) => entry.id === selectedDocumentId);
    if (selected) {
      fields.linkedDocumentId.value = selected.id;
      applyLinkedSource(selected);
    } else if (selectedDocumentId) {
      fields.linkedDocumentId.value = "";
      linkedSourceElements.success?.classList.add("hidden");
      linkedSourceElements.warning?.classList.remove("hidden");
      if (linkedSourceElements.warning) linkedSourceElements.warning.innerHTML = "<strong>Linked Source Missing</strong><span>The connected portfolio entry could not be found.</span><small>Choose another available entry to restore the link.</small>";
      renderLinkedSourcePreview(null, { state: "error" });
      setLinkedSourceStatus("Source module unavailable", "error", { moduleKey });
    } else {
      setLinkedSourceStatus(`${entries.length} available ${entries.length === 1 ? "entry" : "entries"}.`, "ready", { moduleKey, count: entries.length });
    }
  } catch (error) {
    if (token !== linkedSourceLoadToken) return;
    console.error("Unable to load linked source entries:", error);
    fields.linkedDocumentId.innerHTML = '<option value="">Unable to load entries</option>';
    fields.linkedDocumentId.disabled = true;
    renderLinkedSourcePreview(null, { state: "error" });
    setLinkedSourceStatus("Unable to load entries", "error", { moduleKey });
  }
}

function syncProjectTypeOptions() {
  document.querySelectorAll("[data-project-type]").forEach((option) => {
    const active = option.dataset.projectType === activeProjectType();
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-checked", String(active));
    option.tabIndex = active ? 0 : -1;
  });
}


function setEditorSectionVisible(section, visible) {
  if (!(section instanceof HTMLElement)) {
    return;
  }

  section.hidden = !visible;
  section.inert = !visible;
  section.classList.toggle("is-mode-hidden", !visible);
  section.setAttribute("aria-hidden", String(!visible));

  section.querySelectorAll("input, select, textarea").forEach((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
      return;
    }

    if (control.dataset.modeRequired === undefined) {
      control.dataset.modeRequired = String(control.required);
    }

    control.required = visible && control.dataset.modeRequired === "true";
    if (!visible) {
      control.setCustomValidity("");
      control.classList.remove("is-invalid");
      control.removeAttribute("aria-invalid");
    }
  });
}

function clearEditorModeValidationState() {
  form.querySelectorAll('.is-invalid, [aria-invalid="true"]').forEach((element) => {
    element.classList.remove("is-invalid");
    element.removeAttribute("aria-invalid");
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      element.setCustomValidity("");
    }
  });
}

function configureProjectModeValidation(linked, legacyLinkedEdit) {
  if (fields.linkedDestination) fields.linkedDestination.required = false;
  if (fields.linkedModule) {
    fields.linkedModule.required = linked && !legacyLinkedEdit;
    fields.linkedModule.disabled = !linked;
  }
  if (fields.linkedDocumentId) {
    const entryScope = linkedModuleScope(fields.linkedModule?.value) === "entry";
    fields.linkedDocumentId.required = linked && entryScope && !legacyLinkedEdit;
    const cachedEntries = linkedSourceCache.get(fields.linkedModule?.value || "") || [];
    fields.linkedDocumentId.disabled = !linked || !entryScope || !getPortfolioModule(fields.linkedModule?.value) || cachedEntries.length === 0;
  }
  if (fields.buttonLabel) fields.buttonLabel.required = true;
  if (fields.standaloneProjectName) fields.standaloneProjectName.required = !linked;
  if (fields.description) fields.description.required = false;
  if (fields.destination && linked) fields.destination.required = false;
}

function updateProjectEditorSections() {
  const linked = activeProjectType() === "linked-module";

  form.querySelectorAll("[data-editor-mode]").forEach((section) => {
    const mode = section.dataset.editorMode;
    const visible =
      mode === "always" ||
      (mode === "linked" && linked) ||
      (mode === "standalone" && !linked);

    setEditorSectionVisible(section, visible);
  });

  form.classList.toggle("is-linked-editor", linked);
  form.classList.toggle("is-standalone-editor", !linked);
}

function updateProjectTypeUI() {
  const linked = activeProjectType() === "linked-module";
  const legacyLinkedEdit = Boolean(linked && idInput.value && !getPortfolioModule(fields.linkedModule?.value) && fields.linkedDestination?.value);
  const currentCta = primaryCtaLabel() || (linked ? suggestedModuleCta(getPortfolioModule(fields.linkedModule?.value)) : "View Project");

  renderPrimaryCtaOptions(currentCta);
  setPrimaryCtaLabel(currentCta);
  updateProjectEditorSections();
  configureProjectModeValidation(linked, legacyLinkedEdit);
  clearEditorModeValidationState();
  syncProjectTypeOptions();
  updateProjectCustomCategoryVisibility();
  updateMediaTypeUI();
  updateGithubSecondaryActionUI();
  updateDestinationUI();

  projectSkillPicker?.setDisabled(false);
  projectToolPicker?.setDisabled(false);
  [skillSelector, toolSelector].forEach((selector) => selector?.classList.remove("is-inherited"));
  if (linked) {
    projectSkillPicker?.close();
    projectToolPicker?.close();
    renderLinkedCapabilitySummary(fields.linkedModule?.value, selectedLinkedSource);
  } else {
    renderLinkedCapabilitySummary();
  }
  renderProjectSkillSuggestions();
  renderActionIntelligence();
}

const CUSTOM_MEDIA_ASSET_KEYS = Object.freeze([
  "cover", "logo", "screenshots", "demo-video",
]);

const PROJECT_MEDIA_PROFILES = Object.freeze({
  "cover-only": Object.freeze({ cards: ["cover"] }),
  "cover-demo-video": Object.freeze({ cards: ["cover", "demo-video"] }),
    "gallery-project": Object.freeze({ cards: ["cover", "screenshots"] }),
  "custom-assets": Object.freeze({ cards: [], selectable: CUSTOM_MEDIA_ASSET_KEYS }),
});

const MEDIA_STATUS_ELEMENTS = Object.freeze({
  cover: () => media.coverStatus,
  logo: () => media.logoStatus,
  screenshots: () => media.galleryStatus,
  "demo-video": () => media.videoStatus,
  "live-website": () => media.liveWebsiteStatus,
  pdf: () => media.documentStatus,
  "source-files": () => media.sourceStatus,
  "custom-assets": () => media.customStatus,
});

function normalizeEnabledMediaAssets(value = []) {
  const values = Array.isArray(value) ? value : safeParseJson(value, []);
  const allowed = new Set(CUSTOM_MEDIA_ASSET_KEYS);
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item || "").trim()).filter((item) => allowed.has(item)))];
}

function inferEnabledMediaAssets(project = {}) {
  const enabled = [];
  if (savedMediaAvailable(project.coverImage) || project.coverImageUrl) enabled.push("cover");
  if (savedMediaAvailable(project.projectLogo)) enabled.push("logo");
  if (Array.isArray(project.galleryImages) && project.galleryImages.length) enabled.push("screenshots");
  if (savedMediaAvailable(project.demoVideo) || savedMediaAvailable(project.video) || savedMediaAvailable(project.externalVideo) || project.youtubeUrl) enabled.push("demo-video");
  if (savedMediaAvailable(project.pdfAsset) || savedMediaAvailable(project.pdfDocument)) enabled.push("pdf");
  if ((Array.isArray(project.sourceFiles) && project.sourceFiles.some(savedMediaAvailable)) || savedMediaAvailable(project.sourceFile)) enabled.push("source-files");
  if (Array.isArray(project.customAssets) && project.customAssets.length) enabled.push("custom-assets");
  return normalizeEnabledMediaAssets(enabled);
}

function syncEnabledMediaAssetsField() {
  setJsonField(fields.enabledMediaAssets, [...enabledCustomMediaAssets]);
  media.customAssetInputs.forEach((input) => { input.checked = enabledCustomMediaAssets.has(input.dataset.customMediaAsset || ""); });
}

function setEnabledCustomMediaAssets(values = []) {
  enabledCustomMediaAssets = new Set(normalizeEnabledMediaAssets(values));
  syncEnabledMediaAssetsField();
}

function activeMediaAssetKeys(profileKey = activeMediaType()) {
  const profile = PROJECT_MEDIA_PROFILES[profileKey] || PROJECT_MEDIA_PROFILES["cover-only"];
  const visible = new Set(["cover"]);
  (profileKey === "custom-assets" ? [...enabledCustomMediaAssets] : (profile.cards || [])).forEach((key) => visible.add(key));
  enabledCustomMediaAssets.forEach((key) => visible.add(key));
  if (typeof mediaAssetHasContent === "function") {
    CUSTOM_MEDIA_ASSET_KEYS.forEach((key) => { if (mediaAssetHasContent(key)) visible.add(key); });
  }
  if (typeof actionUsageMap === "function" && actionUsageMap().has("demo-video")) visible.add("demo-video");
  return visible;
}

function isMediaAssetActive(assetKey) {
  return activeMediaAssetKeys().has(assetKey);
}

function normalizeMediaProfile(value = "") {
  const profile = String(value || "").trim();
  if (profile === "cover-mp4" || profile === "cover-external-video") {
    return "cover-demo-video";
  }
  if (["cover-pdf", "cover-live-website", "cover-download", "cover-source-files"].includes(profile)) {
    return "cover-only";
  }
  return PROJECT_MEDIA_PROFILES[profile] ? profile : "cover-only";
}

function activeMediaType() {
  return normalizeMediaProfile(fields.mediaType?.value || "cover-only");
}

function applyMediaSettingsToInputs() {
  const types = projectMediaSettings.allowedTypes || {};
  if (media.coverInput) media.coverInput.accept = (types.image || []).join(",");
  if (media.galleryInput) media.galleryInput.accept = (types.image || []).join(",");
  if (media.videoInput) media.videoInput.accept = (types.video || []).join(",");
  if (media.pdfInput) media.pdfInput.accept = (types.pdf || []).join(",");
  if (media.sourceInput) media.sourceInput.accept = (types.source || []).join(",");
  if (media.customInput && (types.asset || []).length) media.customInput.accept = types.asset.join(",");
}

function mediaAssetHasContent(assetKey) {
  if (assetKey === "cover") return Boolean(pendingCoverFile || savedMediaAvailable(savedCoverImage) || fields.coverImageUrl?.value);
  if (assetKey === "logo") return Boolean(pendingLogoFile || savedMediaAvailable(savedProjectLogo));
  if (assetKey === "screenshots") return Boolean(galleryPreviewItems.length || String(fields.galleryImages?.value || "").trim());
  if (assetKey === "demo-video") return projectResourceReady("demo-video");
  return false;
}

function smartVisibleMediaAssets() {
  return activeMediaAssetKeys();
}

function syncSmartMediaVisibility() {
  const visibleCards = smartVisibleMediaAssets();
  const usage = actionUsageMap();
  const mediaGrid = document.querySelector("#projectMediaSection .project-media-grid");
  if (mediaGrid) mediaGrid.dataset.activeCards = String(visibleCards.size);

  document.querySelectorAll("#projectMediaSection [data-media-card]").forEach((card) => {
    const key = card.dataset.mediaCard || "";
    const shouldShow = visibleCards.has(key);
    card.hidden = !shouldShow;
    card.classList.toggle("hidden", !shouldShow);
    card.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    if ("inert" in card) card.inert = !shouldShow;
    card.querySelectorAll("input, select, textarea").forEach((control) => {
      control.setCustomValidity("");
      if (!shouldShow) control.required = false;
    });
  });

  Object.entries(MEDIA_STATUS_ELEMENTS).forEach(([assetKey, getElement]) => {
    const row = getElement();
    if (!row) return;
    const shouldShow = visibleCards.has(assetKey);
    row.hidden = !shouldShow;
    row.classList.toggle("hidden", !shouldShow);
    row.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  });

  const plan = $("projectMediaPlan");
  if (plan) {
    const requiredDemo = usage.has("demo-video");
    const items = [
      `<span class="project-media-plan-chip is-base">Cover <small>card visual</small></span>`,
      ...(visibleCards.has("logo") ? [`<span class="project-media-plan-chip">Logo <small>${mediaAssetHasContent("logo") ? "ready" : "optional"}</small></span>`] : []),
      ...(visibleCards.has("screenshots") ? [`<span class="project-media-plan-chip">Screenshots <small>${mediaAssetHasContent("screenshots") ? "ready" : "optional"}</small></span>`] : []),
      ...(visibleCards.has("demo-video") ? [`<span class="project-media-plan-chip ${requiredDemo ? "is-required" : ""}">Project video <small>${requiredDemo ? "required by action" : mediaAssetHasContent("demo-video") ? "ready" : "optional"}</small></span>`] : []),
      ...(activeProjectResourceTypes().has("github") ? [`<span class="project-media-plan-chip is-required">GitHub <small>required by action</small></span>`] : []),
      ...(activeProjectResourceTypes().has("live-website") ? [`<span class="project-media-plan-chip is-required">Website <small>required by action</small></span>`] : []),
      ...(activeProjectResourceTypes().has("pdf") ? [`<span class="project-media-plan-chip is-required">Document <small>required by action</small></span>`] : []),
      ...(activeProjectResourceTypes().has("download") ? [`<span class="project-media-plan-chip is-required">Download <small>required by action</small></span>`] : []),
      ...(activeProjectResourceTypes().has("custom-resource") ? [`<span class="project-media-plan-chip is-required">Custom asset <small>required by action</small></span>`] : [])
    ];
    plan.innerHTML = `<div><strong>Smart asset plan</strong><small>Only assets used by this Project are shown. Action-required assets are added automatically.</small></div><div class="project-media-plan-chips">${items.join("")}</div>`;
  }

  document.querySelectorAll("[data-toggle-project-media]").forEach((button) => {
    const key = button.dataset.toggleProjectMedia || "";
    const active = visibleCards.has(key);
    const required = key === "demo-video" && usage.has("demo-video");
    const hasContent = mediaAssetHasContent(key);
    const cancellable = active && !required && !hasContent;
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-required", required);
    button.classList.toggle("is-cancel", cancellable);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = required;
    const labels = { logo: "Logo", screenshots: "Screenshots", "demo-video": "Project video" };
    button.textContent = required
      ? `✓ ${labels[key]} · Required`
      : cancellable
        ? `Cancel ${labels[key]}`
        : active
          ? `✓ ${labels[key]}`
          : `+ ${labels[key]}`;
  });

  const demoVisible = visibleCards.has("demo-video");
  const externalMode = fields.videoType?.value === "external";
  if (fields.youtubeUrl) fields.youtubeUrl.required = demoVisible && externalMode;
  if (media.videoInput) media.videoInput.required = false;
  if (media.pdfInput) media.pdfInput.required = false;
  if (media.sourceInput) media.sourceInput.required = false;
  if (fields.liveUrl) { fields.liveUrl.disabled = false; fields.liveUrl.required = false; fields.liveUrl.setCustomValidity(""); }
  if (demoVisible) setVideoSource(externalMode ? "external" : "upload");
  syncEnabledMediaAssetsField();
  updateMediaStatus();
}

function updateMediaTypeUI() {
  syncSmartMediaVisibility();
}

function isValidHttpsUrl(value) {
  try {
    return new URL(String(value || "").trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function updateGithubSecondaryActionUI() {
  const wrapper = $("projectGithubUrlField");
  if (wrapper) {
    wrapper.hidden = false;
    wrapper.classList.remove("hidden");
    wrapper.setAttribute("aria-hidden", "false");
  }
  if (fields.githubSecondaryEnabled) fields.githubSecondaryEnabled.disabled = false;
  if (fields.githubUrl) {
    fields.githubUrl.disabled = false;
    fields.githubUrl.required = false;
    fields.githubUrl.setCustomValidity("");
  }
  renderResourceStatus();
  renderActionIntelligence();
}

function validateOptionalProjectUrls() {
  const githubUrl = fields.githubUrl?.value.trim() || "";
  const liveUrl = fields.liveUrl?.value.trim() || "";

  if (githubUrl) {
    try {
      const url = new URL(githubUrl);
      if (url.protocol !== "https:" || !/(^|\.)github\.com$/i.test(url.hostname)) {
        throw new Error();
      }
    } catch {
      throw new Error("Enter a valid HTTPS GitHub repository URL.");
    }
  }

  if (liveUrl && !isValidHttpsUrl(liveUrl)) {
    throw new Error("Enter a valid HTTPS Live Website URL.");
  }
}

function validateConfiguredProjectAction() {
  const label = primaryCtaLabel();
  if (!label) throw new Error("Choose a primary button action or enter a Custom label.");
  const resourceType = primaryResourceRequirement(label);
  if (resourceType && !projectResourceReady(resourceType)) {
    throw new Error(`${resourceRequirementLabel(resourceType)} is required by the ${label} action.`);
  }
  if (activeProjectType() !== "linked-module") return;
  if (resourceType) return;
  const moduleKey = fields.linkedModule?.value || "";
  const documentId = fields.linkedDocumentId?.value || "";
  const module = getPortfolioModule(moduleKey);
  const scope = module ? linkedModuleScope(module.key) : "entry";
  const editingLegacyLink = Boolean(idInput.value && !documentId && fields.linkedDestination?.value && !module);
  if (!module && !editingLegacyLink) throw new Error("Select a valid source module.");
  if (scope === "entry" && !documentId && !editingLegacyLink) throw new Error("Select a source entry.");
  if (module && !isValidInternalDestination(module.publicDestination)) throw new Error("The selected source module has no valid public destination.");
}

function validateSelectedMediaType() {
  if (activeProjectType() === "linked-module") return;
  const type = activeMediaType();

  if (type === "cover-demo-video") {
    const externalMode = fields.videoType?.value === "external";
    if (externalMode) {
      const value = fields.youtubeUrl?.value.trim() || "";
      const external = detectExternalVideoProvider(value);
      if (!value || external.provider === "invalid") {
        throw new Error("Enter a valid External Video URL for the selected Media Type.");
      }
    } else if (!(pendingVideoFile || savedMediaAvailable(savedVideo) || fields.videoUrl?.value)) {
      throw new Error("Upload an MP4 demo or choose External Video for the selected Media Type.");
    }
  }


  if (type === "gallery-project" && !(galleryPreviewItems.length || safeParseJson(fields.galleryImages?.value, []).length)) {
    throw new Error("Add at least one gallery image for the selected Media Type.");
  }
}

function projectModuleEmblem() { return `<span class="lan-card-emblem lan-card-emblem--project" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><rect class="emblem-stroke" x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect class="emblem-stroke" x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect class="emblem-stroke" x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><rect class="emblem-stroke" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"/></svg></span>`; }

function projectInitials(title = "") {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((word) => word[0]).join("") || "LΛ").toUpperCase();
}

function updateDestinationUI() {
  if (activeProjectType() === "linked-module") {
    if (fields.destination) fields.destination.required = false;
    const preview = $("projectActionPreview");
    const module = getPortfolioModule(fields.linkedModule?.value);
    if (fields.linkedDestination) fields.linkedDestination.value = module?.publicDestination || fields.linkedDestination.value || "";
    if (preview) preview.textContent = module
      ? `${primaryCtaLabel() || suggestedModuleCta(module)} → ${module.label}`
      : "Select a source module and source entry.";
    return;
  }
  const type = fields.actionType?.value || "project-preview";
  const needsDestination = ["internal-section", "custom-url"].includes(type);
  $("projectDestinationField")?.classList.toggle("hidden", !needsDestination);
  if (fields.destination) fields.destination.required = needsDestination;
  const preview = $("projectActionPreview");
  if (preview) {
    const action = resolveProjectAction(dataFromForm());
    preview.textContent = action.available ? `Primary action: ${action.label}${action.destination ? ` → ${action.destination}` : ""}` : `Primary action unavailable: ${action.label}`;
  }
}

function clearLogoPreview({ clearSaved = false, markChanged = false } = {}) {
  if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
  logoObjectUrl = ""; pendingLogoFile = null;
  if (clearSaved) savedProjectLogo = null;
  if (media.logoInput) media.logoInput.value = "";
  media.logoPreview?.classList.add("hidden");
  media.logoPreviewImage?.removeAttribute("src");
  setJsonField(fields.projectLogoData, savedProjectLogo);
  if (markChanged) markAsChanged();
}

function setLogoFromFile(file) {
  if (!file) return;
  try { validateMediaFile(file, "logo", "projects"); }
  catch (error) { notify(error.message || "Invalid logo image.", "error"); return; }
  clearLogoPreview();
  pendingLogoFile = file; savedProjectLogo = null; logoObjectUrl = URL.createObjectURL(file);
  if (media.logoPreviewImage) media.logoPreviewImage.src = logoObjectUrl;
  if (media.logoFileName) media.logoFileName.textContent = file.name;
  if (media.logoFileMeta) media.logoFileMeta.textContent = formatFileSize(file.size);
  media.logoPreview?.classList.remove("hidden"); markAsChanged();
}

function renderSavedLogo(logo, title = "") {
  savedProjectLogo = logo || null; setJsonField(fields.projectLogoData, savedProjectLogo);
  const logoUrl = resolveAdminMediaAssetUrl(logo);
  if (logoUrl) {
    if (media.logoPreviewImage) media.logoPreviewImage.src = logoUrl;
    if (media.logoFileName) media.logoFileName.textContent = logo.originalFilename || "Saved logo";
    if (media.logoFileMeta) media.logoFileMeta.textContent = "Existing project identity";
    media.logoPreview?.classList.remove("hidden");
  } else { clearLogoPreview(); }
}

function dataFromForm() {
  const linked = activeProjectType() === "linked-module";
  return {
    id: idInput?.value || "",
    projectType: linked ? "linked-module" : "standalone",
    linkedModule: linked ? (fields.linkedModule?.value || "") : "",
    linkedModuleKey: linked ? (fields.linkedModule?.value || "") : "",
    linkedScope: linked ? linkedModuleScope(fields.linkedModule?.value) : "",
    linkedDocumentId: linked && linkedModuleScope(fields.linkedModule?.value) === "entry" ? (fields.linkedDocumentId?.value || "") : "",
    linkedDestination: linked ? (getPortfolioModule(fields.linkedModule?.value)?.publicDestination || fields.linkedDestination?.value || "") : "",
    linkedTitleSnapshot: linked ? (selectedLinkedSource?.title || safeParseJson(fields.linkedSourceSnapshot?.value, {})?.title || "") : "",
    linkedSummarySnapshot: linked ? (selectedLinkedSource?.summary || safeParseJson(fields.linkedSourceSnapshot?.value, {})?.summary || "") : "",
    linkedCoverSnapshot: linked && idInput.value && safeParseJson(fields.linkedSourceSnapshot?.value, {})?.cover
      ? { url: safeParseJson(fields.linkedSourceSnapshot?.value, {})?.cover }
      : null,
    linkedUpdatedAtSnapshot: linked ? (selectedLinkedSource?.updatedAt || safeParseJson(fields.linkedSourceSnapshot?.value, {})?.updatedAt || null) : null,
    additionalActions: linkedActionsFromEditor(),
    linkedActions: linkedActionsFromEditor().filter((action) => action.kind === "linked"),
    standaloneProjectName: fields.standaloneProjectName?.value || fields.title.value,
    cardSummary: fields.shortDescription.value,
    fullDescription: fields.description.value,
    title: fields.title.value,
    category: fields.category.value,
    customCategory:
      fields.category.value === "other"
        ? fields.customCategory.value
        : "",
    year: fields.year.value,
    projectHours: fields.projectHours?.value || "",
    displayOrder: fields.displayOrder.value,
    shortDescription: fields.shortDescription.value,
    description: fields.description.value,
    skillIds: linked ? [] : [...selectedSkillIds],
    toolIds: linked ? [] : [...selectedToolIds],
    technologies: linked ? [] : [...selectedTechnologies],
    publicTagMode: projectPublicTagMode(),
    publicTagRefs: validPublicTagRefs({ ...availableProjectPublicCapabilities(), refs: selectedPublicTagRefs }),
    githubUrl: fields.githubUrl?.value.trim() || "",
    githubSecondaryEnabled: Boolean(fields.githubSecondaryEnabled?.checked),
    liveUrl: fields.liveUrl.value || "",
    coverImageUrl: idInput.value || isMediaAssetActive("cover") ? (fields.coverImageUrl?.value || "") : "",
    coverImage: idInput.value || isMediaAssetActive("cover") ? savedCoverImage : null,
    projectLogo: idInput.value || isMediaAssetActive("logo") ? savedProjectLogo : null,
    video: idInput.value || isMediaAssetActive("demo-video") ? savedVideo : null,
    youtubeUrl: idInput.value || isMediaAssetActive("demo-video") ? (fields.youtubeUrl?.value || "") : "",
    videoType: idInput.value || isMediaAssetActive("demo-video") ? (fields.videoType?.value || "") : "",
    mediaType: fields.mediaType?.value || "cover-only",
    demoVideo: idInput.value || isMediaAssetActive("demo-video") ? savedVideo : null,
    externalVideo: idInput.value || isMediaAssetActive("demo-video") ? safeParseJson(fields.externalVideoData?.value, null) : null,
    pdfAsset: savedPdfAsset,
    sourceFiles: savedSourceFiles,
    customAssets: savedCustomAssets,
    enabledMediaAssets: [...enabledCustomMediaAssets],
    actionType: linked
      ? "internal-section"
      : standaloneActionTypeForLabel(primaryCtaLabel(), fields.actionType?.value || "project-preview"),
    buttonLabel: primaryCtaLabel() || (linked ? "View Details" : "View Project"),
    destination: linked ? (fields.linkedDestination?.value || "") : (fields.destination?.value || ""),
    galleryImages: idInput.value || isMediaAssetActive("screenshots") ? projectGalleryAssets() : [],
    status: fields.status.value,
    featured: fields.featured.checked,
    visible: fields.visible.checked,
  };
}

function normalizeTechnologyName(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function normalizeCapabilityKey(value = "") {
  return normalizeTechnologyName(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : String(values || "").split(","))
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function uniqueTechnologyNames(values = []) {
  const seen = new Set();
  const source = Array.isArray(values)
    ? values
    : String(values || "")
        .split(",")
        .map((value) => value.trim());

  return source
    .map(normalizeTechnologyName)
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function legacySourceToolNames(source = {}) {
  const candidates = [source.tools, source.toolsUsed, source.software, source.technologies];
  return candidates.find((value) => Array.isArray(value) && value.length) || [];
}

function skillCategoryLabel(skill = {}) {
  if (skill.category === "other" && String(skill.customCategory || "").trim()) {
    return String(skill.customCategory).trim();
  }
  return formatLabel(skill.category || "other");
}

function selectedSkillRecords(project = null) {
  const ids = project ? uniqueIds(project.skillIds || []) : selectedSkillIds;
  const byId = new Map(skillsLibrary.map((skill) => [skill.id, skill]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function selectedToolRecords(project = null) {
  const ids = project ? uniqueIds(project.toolIds || []) : selectedToolIds;
  const byId = new Map(toolsLibrary.map((tool) => [tool.id, tool]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}


function projectToolIconSource(tool = {}) {
  const resolved = window.LANResolveSkillIcon?.(tool.name, tool.category || "technology");
  const canonical = String(resolved?.src || "").trim();
  if (canonical) return canonical;
  const custom = String(tool.icon || "").trim();
  return /^(?:data:image\/|https?:\/\/|\.?\.?\/|\/)/i.test(custom) ? custom : "";
}

function toolChipMarkup(tool = {}, removable = false) {
  const iconSource = projectToolIconSource(tool);
  return `<span class="project-selected-skill project-tool-chip lan-chip">${iconSource ? `<span class="project-tool-chip-icon"><img src="${escapeHtml(iconSource)}" alt="" aria-hidden="true" loading="lazy"></span>` : ""}<span>${escapeHtml(tool.name)}</span>${removable ? `<button class="lan-chip-remove" type="button" data-remove-tool-id="${escapeHtml(tool.id)}" aria-label="Remove ${escapeHtml(tool.name)}">×</button>` : ""}</span>`;
}

function relatedSkillSuggestionsForSelectedTools() {
  if (!selectedToolIds.length || typeof window.LANSuggestCapabilityRelationships !== "function") return [];
  const suggestions = new Map();
  const selectedSkills = new Set(selectedSkillIds);
  selectedToolIds.forEach((toolId) => {
    const tool = toolsLibrary.find((item) => item.id === toolId);
    if (!tool) return;
    window.LANSuggestCapabilityRelationships({
      sourceType: "tool", sourceRecord: tool, skills: skillsLibrary, tools: toolsLibrary,
      excludeIds: [...selectedSkills], limit: 8
    }).forEach((skill) => { if (skill?.id && !selectedSkills.has(skill.id) && !suggestions.has(skill.id)) suggestions.set(skill.id, skill); });
  });
  return [...suggestions.values()].slice(0, 8);
}

function renderProjectSkillSuggestions() {
  const host = linkedSourceElements.suggestedSkills;
  if (!host) return;
  const suggestions = activeProjectType() === "linked-module" ? [] : relatedSkillSuggestionsForSelectedTools();
  host.classList.toggle("hidden", !suggestions.length);
  if (!suggestions.length) { host.replaceChildren(); return; }
  host.innerHTML = `<div class="project-smart-suggestions-copy"><span class="editor-eyebrow">Smart relationships</span><strong>Suggested Skills from selected Tools</strong><p>Based on Skills &amp; Tools Used. Add only the Skills this Project actually demonstrates.</p></div><div class="project-smart-suggestion-list">${suggestions.map((skill) => `<button type="button" class="project-smart-suggestion" data-project-suggested-skill="${escapeHtml(skill.id)}"><span>+</span>${escapeHtml(skill.name)}</button>`).join("")}</div>`;
}

function syncCapabilityFields() {
  selectedSkillIds = uniqueIds(selectedSkillIds);
  selectedToolIds = uniqueIds(selectedToolIds);
  const toolMap = new Map(toolsLibrary.map((tool) => [tool.id, tool]));
  selectedTechnologies = selectedToolIds.map((id) => toolMap.get(id)?.name).filter(Boolean);
  if (fields.skillIds) fields.skillIds.value = selectedSkillIds.join(",");
  if (fields.toolIds) fields.toolIds.value = selectedToolIds.join(",");
  if (fields.technologies) fields.technologies.value = selectedTechnologies.join(", ");
  renderProjectSkillSuggestions();
  syncProjectPublicTagsUI();
}

function linkedEntryCapabilityEditingReady() {
  const moduleKey = String(fields.linkedModule?.value || "").trim();
  const documentId = String(fields.linkedDocumentId?.value || selectedLinkedSource?.id || "").trim();
  return activeProjectType() === "linked-module"
    && Boolean(moduleKey)
    && linkedModuleScope(moduleKey) === "entry"
    && Boolean(documentId);
}

async function persistLinkedSourceCapabilitySelection(kind, ids = []) {
  const moduleKey = String(fields.linkedModule?.value || "").trim();
  const documentId = String(fields.linkedDocumentId?.value || selectedLinkedSource?.id || "").trim();
  const label = kind === "tools" ? "Tools" : "Skills";
  if (!linkedEntryCapabilityEditingReady()) return;
  try {
    await setCapabilitiesOnLinkedProjectSource(moduleKey, documentId, kind === "tools" ? "tool" : "skill", uniqueIds(ids));
    await loadLinkedSourceEntries(moduleKey, documentId, { force: true });
    notify(`${label} updated on the linked source entry.`, "success");
  } catch (error) {
    console.error(`Unable to update linked ${label}:`, error);
    notify(error.message || `Unable to update linked ${label}.`, "error");
    await loadLinkedSourceEntries(moduleKey, documentId, { force: true }).catch(() => {});
  }
}

function projectCapabilityPickerOptions(kind) {
  const isTool = kind === "tools";
  const linkedEntry = linkedEntryCapabilityEditingReady();
  const selectedIds = linkedEntry
    ? linkedSourceCapabilityIds(kind)
    : (isTool ? selectedToolIds : selectedSkillIds);
  return {
    type: isTool ? "tool" : "skill",
    records: isTool ? toolsLibrary : skillsLibrary,
    selectedIds,
    inputId: isTool ? "projectToolSearch" : "projectSkillSearch",
    placeholder: isTool ? "Search or add a Tool…" : "Search or add a Skill…",
    compactAdd: true,
    dense: true,
    relationshipStyle: true,
    collapsedLimit: 6,
    addLabel: isTool ? "+ Link Tool" : "+ Link Skill",
    emptyTitle: `No matching ${isTool ? "Tool" : "Skill"} found.`,
    emptyHint: "Try another search.",
    getIcon: isTool ? projectToolIconSource : null,
    getMeta: isTool
      ? (tool) => formatLabel(tool.customCategory || tool.category || "other")
      : skillCategoryLabel,
    onChange(ids) {
      if (linkedEntry) {
        void persistLinkedSourceCapabilitySelection(kind, ids);
        return;
      }
      if (isTool) selectedToolIds = uniqueIds(ids);
      else selectedSkillIds = uniqueIds(ids);
      syncCapabilityFields();
      markAsChanged();
    },
    async onCommit(value) {
      return commitProjectCapabilitySearch(kind, value);
    }
  };
}

function syncProjectCapabilityPickers() {
  if (projectSkillPickerHost && typeof window.LANCreateCapabilityPicker === "function") {
    const skillOptions = projectCapabilityPickerOptions("skills");
    if (!projectSkillPicker) projectSkillPicker = window.LANCreateCapabilityPicker(projectSkillPickerHost, skillOptions);
    else projectSkillPicker.update(skillOptions);
  }

  if (projectToolPickerHost && typeof window.LANCreateCapabilityPicker === "function") {
    const toolOptions = projectCapabilityPickerOptions("tools");
    if (!projectToolPicker) projectToolPicker = window.LANCreateCapabilityPicker(projectToolPickerHost, toolOptions);
    else projectToolPicker.update(toolOptions);
  }

  syncCapabilityFields();
}

function initProjectCapabilityPickers() {
  syncProjectCapabilityPickers();
}

function setSelectedSkillIds(values = []) {
  const valid = new Set(skillsLibrary.map((skill) => String(skill.id || "")));
  selectedSkillIds = uniqueIds(values).filter((id) => !valid.size || valid.has(String(id)));
  syncCapabilityFields();
  syncProjectCapabilityPickers();
}

function setSelectedToolIds(values = []) {
  const valid = new Set(toolsLibrary.map((tool) => String(tool.id || "")));
  selectedToolIds = uniqueIds(values).filter((id) => !valid.size || valid.has(String(id)));
  syncCapabilityFields();
  syncProjectCapabilityPickers();
}

function inferLegacySkillIds(values = []) {
  const wanted = new Set(uniqueTechnologyNames(values).map(normalizeCapabilityKey));
  return skillsLibrary.filter((skill) => wanted.has(normalizeCapabilityKey(skill.name))).map((skill) => skill.id);
}

function inferLegacyToolIds(values = []) {
  const legacyKeys = new Set(uniqueTechnologyNames(values).map(normalizeCapabilityKey));
  const aliases = new Map([
    ["firebase", "firebase and firestore"], ["firebase ready", "firebase and firestore"], ["firestore", "firebase and firestore"],
    ["photoshop", "adobe photoshop"], ["premiere pro", "adobe premiere pro"], ["3ds max", "autodesk 3ds max"],
    ["html", "html css and javascript"], ["css", "html css and javascript"], ["javascript", "html css and javascript"],
    ["js", "html css and javascript"], ["html css javascript", "html css and javascript"]
  ]);
  const wanted = new Set();
  legacyKeys.forEach((key) => wanted.add(aliases.get(key) || key));
  return toolsLibrary.filter((tool) => wanted.has(normalizeCapabilityKey(tool.name))).map((tool) => tool.id);
}

function setProjectCapabilities(project = {}) {
  setSelectedSkillIds(project.skillIds || []);
  const savedToolIds = uniqueIds(project.toolIds || []);
  setSelectedToolIds(savedToolIds.length ? savedToolIds : inferLegacyToolIds(project.technologies || []));
}

async function commitProjectCapabilitySearch(kind, rawName) {
  const label = kind === "skills" ? "Skill" : "Tool";

  try {
    const module = await import("../services/skillService.js");
    if (typeof module?.ensureCapabilityByName !== "function") {
      throw new Error("Skills & Tools quick entry is unavailable.");
    }

    const result = await module.ensureCapabilityByName(kind === "tools" ? "tool" : "skill", rawName);
    await loadSkillsLibrary();
    notify(
      result.created
        ? `${label} “${result.name || rawName}” added to the shared library.`
        : `${label} “${result.name || rawName}” found in the shared library.`,
      "success"
    );
    return result;
  } catch (error) {
    console.error(`Unable to add ${label}:`, error);
    notify(error.message || `Unable to add ${label}.`, "error");
    throw error;
  }
}


async function loadSkillsLibrary() {
  try {
    const records = await getSkillsLibraryRecords();
    skillsLibrary = records
      .filter((item) => item && item.id && item.name && String(item.recordType || "skill").toLowerCase() !== "tool")
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || String(a.name).localeCompare(String(b.name)));
    toolsLibrary = records
      .filter((item) => item && item.id && item.name && String(item.recordType || "skill").toLowerCase() === "tool")
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || String(a.name).localeCompare(String(b.name)));
    syncProjectCapabilityPickers();
    renderProjectSkillSuggestions();
    renderLinkedCapabilitySummary(fields.linkedModule?.value, selectedLinkedSource);
    render();
  } catch (error) {
    console.error("Unable to load Skills & Tools Library:", error);
    skillsLibrary = [];
    toolsLibrary = [];
    syncProjectCapabilityPickers();
    notify("Skills & Tools Library could not be loaded.", "error");
  }
}

function projectToolRecords(project = {}) {
  const linkedModuleKey = project.linkedModuleKey || project.linkedModule || "";
  const linked = normalizeProjectType(project.projectType || (project.linkedModule ? "linked-module" : "standalone")) === "linked-module";
  if (linked) {
    const moduleScope = linkedModuleScope(linkedModuleKey) === "module";
    const sources = moduleScope
      ? (project.linkedModuleEntries || linkedSourceCache.get(linkedModuleKey) || []).filter(isPublishedLinkedEntry).map((entry) => entry.raw || entry).filter(Boolean)
      : (project.linkedSourceRaw ? [project.linkedSourceRaw] : []);
    const byId = new Map(toolsLibrary.map((tool) => [tool.id, tool]));
    const inheritedIds = uniqueIds(sources.flatMap((source) => source.toolIds || []));
    const inherited = inheritedIds.map((id) => byId.get(id)).filter(Boolean);
    if (inherited.length || moduleScope) return inherited;
    const legacyIds = uniqueIds(sources.flatMap((source) => inferLegacyToolIds(legacySourceToolNames(source))));
    const legacyResolved = legacyIds.map((id) => byId.get(id)).filter(Boolean);
    if (legacyResolved.length) return legacyResolved;
    return uniqueTechnologyNames(sources.flatMap((source) => legacySourceToolNames(source))).map((name) => ({ id: "", name, category: "", icon: "" }));
  }
  const records = selectedToolRecords(project);
  if (records.length) return records;
  const legacyNames = uniqueTechnologyNames(project.technologies || []);
  const inferred = inferLegacyToolIds(legacyNames);
  const byId = new Map(toolsLibrary.map((tool) => [tool.id, tool]));
  const resolved = inferred.map((id) => byId.get(id)).filter(Boolean);
  return resolved.length ? resolved : legacyNames.map((name) => ({ id: "", name, category: "", icon: "" }));
}

function projectSkillRecords(project = {}) {
  const linkedModuleKey = project.linkedModuleKey || project.linkedModule || "";
  const linked = normalizeProjectType(project.projectType || (project.linkedModule ? "linked-module" : "standalone")) === "linked-module";
  if (linked) {
    const moduleScope = linkedModuleScope(linkedModuleKey) === "module";
    const sources = moduleScope
      ? (project.linkedModuleEntries || linkedSourceCache.get(linkedModuleKey) || []).filter(isPublishedLinkedEntry).map((entry) => entry.raw || entry).filter(Boolean)
      : (project.linkedSourceRaw ? [project.linkedSourceRaw] : []);
    const byId = new Map(skillsLibrary.map((skill) => [skill.id, skill]));
    const inheritedIds = uniqueIds(sources.flatMap((source) => source.skillIds || []));
    const inherited = inheritedIds.map((id) => byId.get(id)).filter(Boolean);
    if (inherited.length || moduleScope) return inherited;
    const legacy = sources.flatMap((source) => Array.isArray(source.skills) ? source.skills : []);
    const inferred = inferLegacySkillIds(legacy);
    const resolved = inferred.map((id) => byId.get(id)).filter(Boolean);
    return resolved.length ? resolved : uniqueTechnologyNames(legacy).map((name) => ({ id: "", name, category: "" }));
  }
  return selectedSkillRecords(project);
}

function projectPublicCapabilityRecords(project = {}) {
  return resolvePublicProjectCapabilities({
    tools: projectToolRecords(project),
    skills: projectSkillRecords(project),
    mode: project.publicTagMode || project.publicToolMode || "automatic",
    refs: normalizePublicTagRefs(project.publicTagRefs, project.publicToolIds || [])
  });
}

function projectCapabilityMarkup(project = {}, removable = false) {
  return projectPublicCapabilityRecords(project).map(({ type, item }) => {
    if (type === "tool") return item.id ? toolChipMarkup(item, removable) : `<span class="lan-chip">${escapeHtml(item.name)}</span>`;
    return `<span class="project-selected-skill lan-chip">${escapeHtml(item.name)}</span>`;
  }).join("");
}

function projectToolMarkup(project = {}, removable = false) {
  return projectCapabilityMarkup(project, removable);
}

function revokeCoverObjectUrl() {
  if (coverObjectUrl) {
    URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = "";
  }
}

function clearGalleryObjectUrls() {
  galleryPreviewItems.forEach((item) => {
    if (item.isObjectUrl) URL.revokeObjectURL(item.url);
  });
  galleryPreviewItems = [];
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Saved image";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateMediaStatus() {
  const activeAssets = activeMediaAssetKeys();
  const hasCover = Boolean(media.coverPreview && !media.coverPreview.classList.contains("hidden"));
  const galleryCount = galleryPreviewItems.length;
  if (media.coverStatus && activeAssets.has("cover")) media.coverStatus.innerHTML = `<span class="project-media-status-dot ${hasCover ? "is-ready" : ""}"></span>${hasCover ? "Cover image ready" : "No cover image selected"}`;
  if (media.logoStatus && activeAssets.has("logo")) {
    const ready = Boolean(pendingLogoFile || savedMediaAvailable(savedProjectLogo));
    media.logoStatus.innerHTML = `<span class="project-media-status-dot ${ready ? "is-ready" : ""}"></span>${ready ? "Project logo ready" : "No project logo selected"}`;
  }
  if (media.galleryStatus && activeAssets.has("screenshots")) media.galleryStatus.innerHTML = `<span class="project-media-status-dot ${galleryCount ? "is-ready" : ""}"></span>${galleryCount ? `${galleryCount} screenshot${galleryCount === 1 ? "" : "s"} ready` : "No screenshots selected"}`;
  if (media.videoStatus && activeAssets.has("demo-video")) {
    const externalMode = fields.videoType?.value === "external";
    if (externalMode) {
      const value = fields.youtubeUrl?.value?.trim() || "";
      const provider = value ? detectExternalVideoProvider(value) : null;
      const valid = Boolean(value && provider?.provider !== "invalid");
      media.videoStatus.innerHTML = `<span class="project-media-status-dot ${valid ? "is-ready" : ""}"></span>${valid ? "External video ready" : value ? "Invalid external video URL" : "No external video URL"}`;
    } else {
      const ready = Boolean(pendingVideoFile || savedMediaAvailable(savedVideo) || fields.videoUrl?.value);
      media.videoStatus.innerHTML = `<span class="project-media-status-dot ${ready ? "is-ready" : ""}"></span>${ready ? "Video ready" : "No demo video selected"}`;
    }
  }
  if (media.liveWebsiteStatus && activeAssets.has("live-website")) {
    const value = fields.liveUrl?.value?.trim() || "";
    const ready = isValidHttpsUrl(value);
    media.liveWebsiteStatus.innerHTML = `<span class="project-media-status-dot ${ready ? "is-ready" : ""}"></span>${ready ? "Live website ready" : value ? "Invalid live website URL" : "No live website URL"}`;
  }
  if (media.documentStatus && activeAssets.has("pdf")) {
    const ready = Boolean(savedPdfAsset || pendingPdfFile);
    media.documentStatus.innerHTML = `<span class="project-media-status-dot ${ready ? "is-ready" : ""}"></span>${ready ? "PDF ready" : "No PDF selected"}`;
  }
  if (media.sourceStatus && activeAssets.has("source-files")) {
    const count = savedSourceFiles.length + pendingSourceFiles.length;
    media.sourceStatus.innerHTML = `<span class="project-media-status-dot ${count ? "is-ready" : ""}"></span>${count ? `${count} source file${count === 1 ? "" : "s"} ready` : "No source files selected"}`;
  }
  if (media.customStatus && activeAssets.has("custom-assets")) {
    const count = savedCustomAssets.length + pendingCustomAssets.length;
    media.customStatus.innerHTML = `<span class="project-media-status-dot ${count ? "is-ready" : ""}"></span>${count ? `${count} custom asset${count === 1 ? "" : "s"} ready` : "No custom assets selected"}`;
  }
}

function fitProjectMediaPreviewImage(image = media.coverPreviewImage) {
  const stage = image?.closest?.(".project-media-preview-stage");
  if (!image || !stage || !image.naturalWidth || !image.naturalHeight) return;

  const styles = window.getComputedStyle(stage);
  const horizontalPadding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
  const verticalPadding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  const availableWidth = Math.max(1, stage.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, stage.clientHeight - verticalPadding);
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const stageRatio = availableWidth / availableHeight;

  if (imageRatio >= stageRatio) {
    image.style.width = `${Math.floor(availableWidth)}px`;
    image.style.height = `${Math.max(1, Math.round(availableWidth / imageRatio))}px`;
  } else {
    image.style.height = `${Math.floor(availableHeight)}px`;
    image.style.width = `${Math.max(1, Math.round(availableHeight * imageRatio))}px`;
  }
}

function renderCoverPreview({ url = "", name = "Cover image", meta = "Saved image" } = {}) {
  const hasImage = Boolean(url);

  media.coverZone?.classList.toggle("hidden", hasImage);
  media.coverPreview?.classList.toggle("hidden", !hasImage);

  if (!hasImage) {
    media.coverPreviewImage?.removeAttribute("src");
    if (media.coverPreviewImage) {
      media.coverPreviewImage.style.width = "";
      media.coverPreviewImage.style.height = "";
    }
    if (media.coverFileName) media.coverFileName.textContent = "Cover image";
    if (media.coverFileMeta) media.coverFileMeta.textContent = "Image preview";
    updateMediaStatus();
    return;
  }

  if (media.coverPreviewImage) {
    media.coverPreviewImage.src = url;
    if (media.coverPreviewImage.complete && media.coverPreviewImage.naturalWidth) {
      fitProjectMediaPreviewImage(media.coverPreviewImage);
    }
  }
  if (media.coverFileName) {
    media.coverFileName.textContent = name;
    media.coverFileName.title = name;
  }
  if (media.coverFileMeta) {
    media.coverFileMeta.textContent = meta;
    media.coverFileMeta.title = meta;
  }
  updateMediaStatus();
}

function openCoverPreviewModal(event) {
  const source = media.coverPreviewImage?.getAttribute("src");
  if (!source || !media.coverPreviewModal) return;
  coverPreviewOpener = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : document.activeElement;

  if (media.coverPreviewModalImage) media.coverPreviewModalImage.src = source;
  if (media.coverPreviewModalName) {
    media.coverPreviewModalName.textContent =
      media.coverFileName?.textContent || "Project cover image";
  }
  media.coverPreviewModal.classList.remove("hidden");
  media.coverPreviewModal.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => media.closeCoverPreviewModal?.focus());
}

function closeCoverPreviewModal() {
  if (!media.coverPreviewModal || media.coverPreviewModal.classList.contains("hidden")) return;
  media.coverPreviewModal.classList.add("hidden");
  media.coverPreviewModal.setAttribute("aria-hidden", "true");
  media.coverPreviewModalImage?.removeAttribute("src");
  const opener = coverPreviewOpener;
  coverPreviewOpener = null;
  if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
}

function clearCoverPreview({ clearSavedValue = false, markChanged = false } = {}) {
  revokeCoverObjectUrl();
  if (media.coverInput) media.coverInput.value = "";
  renderCoverPreview();

  if (clearSavedValue) {
    if (fields.coverImageUrl) fields.coverImageUrl.value = "";
    savedCoverImage = null;
    pendingCoverFile = null;
  }
  if (markChanged) markAsChanged();
}

function setCoverFromFile(file) {
  try {
    validateMediaFile(file, "image", "projects");
  } catch (error) {
    notify(error.message || "Please choose a supported cover image.", "error");
    return;
  }

  revokeCoverObjectUrl();
  pendingCoverFile = file;
  coverObjectUrl = URL.createObjectURL(file);
  renderCoverPreview({
    url: coverObjectUrl,
    name: file.name,
    meta: `${formatFileSize(file.size)} · Local preview`,
  });
  markAsChanged();
  notify("Cover preview ready. It will upload when you save.");
}

function revokeVideoObjectUrl() {
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = "";
}

function renderVideoPreview() {
  const externalValue = fields.youtubeUrl?.value || "";
  const external = detectExternalVideoProvider(externalValue);
  const source = videoObjectUrl || savedMediaUrl(savedVideo, "preview") || fields.videoUrl?.value || "";
  const hasExternal = Boolean(externalValue.trim() && external.provider !== "invalid");
  const hasVideo = Boolean(hasExternal || source);

  media.videoPreview?.classList.toggle("hidden", !hasVideo);
  media.videoZone?.classList.toggle("hidden", hasVideo);
  media.videoSourceTabs?.classList.toggle("hidden", hasVideo);
  if (hasVideo) {
    media.videoUploadPanel?.classList.add("project-video-panel-has-preview");
    media.videoYoutubePanel?.classList.add("project-video-panel-has-preview");
  } else {
    media.videoUploadPanel?.classList.remove("project-video-panel-has-preview");
    media.videoYoutubePanel?.classList.remove("project-video-panel-has-preview");
  }
  if (media.externalProviderHint) {
    media.externalProviderHint.textContent = hasExternal
      ? `Detected provider: ${formatLabel(external.provider)}`
      : "Provider is detected automatically.";
  }
  setJsonField(fields.externalVideoData, hasExternal ? external : null);

  if (!hasVideo) {
    if (media.videoPreviewStage) media.videoPreviewStage.innerHTML = "";
    updateMediaStatus();
    return;
  }

  if (media.previewExternalVideoButton) {
    const externalPreviewUrl = external.safeUrl || external.url || externalValue.trim();
    media.previewExternalVideoButton.classList.toggle("hidden", !hasExternal || !externalPreviewUrl);
    if (hasExternal && externalPreviewUrl) media.previewExternalVideoButton.href = externalPreviewUrl;
    else media.previewExternalVideoButton.removeAttribute("href");
  }

  if (hasExternal) {
    if (media.videoPreviewStage) {
      media.videoPreviewStage.innerHTML = external.posterUrl
        ? `<img loading="lazy" src="${escapeHtml(external.posterUrl)}" alt="${escapeHtml(formatLabel(external.provider))} video thumbnail">`
        : `<div class="project-external-video-ready"><strong>${escapeHtml(formatLabel(external.provider))}</strong><span>External video ready</span></div>`;
    }
    if (media.videoFileName) media.videoFileName.textContent = `${formatLabel(external.provider)} video ready`;
    if (media.videoFileMeta) media.videoFileMeta.textContent = externalValue.trim();
  } else {
    if (media.videoPreviewStage) media.videoPreviewStage.innerHTML = `<video controls preload="metadata" src="${escapeHtml(source)}"></video>`;
    if (media.videoFileName) media.videoFileName.textContent = pendingVideoFile?.name || savedVideo?.originalFilename || "Uploaded project video";
    if (media.videoFileMeta) {
      const savedMeta = [
        savedVideo?.bytes ? formatFileSize(savedVideo.bytes) : "",
        savedVideo?.duration ? `${Math.round(savedVideo.duration)}s` : "",
        savedVideo?.width && savedVideo?.height ? `${savedVideo.width} × ${savedVideo.height}` : "",
      ].filter(Boolean).join(" · ");
      media.videoFileMeta.textContent = pendingVideoFile
        ? `${formatFileSize(pendingVideoFile.size)} · Reading video details…`
        : savedMeta || "Saved MP4 video";
    }
  }
  updateMediaStatus();
}

function setVideoSource(type) {
  const external = type === "youtube" || type === "external";
  if (fields.videoType) fields.videoType.value = external ? "external" : "upload";
  media.videoUploadTab?.classList.toggle("is-active", !external);
  media.videoYoutubeTab?.classList.toggle("is-active", external);
  media.videoUploadPanel?.classList.toggle("hidden", external);
  media.videoYoutubePanel?.classList.toggle("hidden", !external);
  if (fields.youtubeUrl) {
    fields.youtubeUrl.required = isMediaAssetActive("demo-video") && external;
    fields.youtubeUrl.setCustomValidity("");
  }
  renderVideoPreview();
}

function setVideoFromFile(file) {
  if (!file) return;
  try {
    validateMediaFile(file, "video", "projects");
  } catch (error) {
    notify(error.message || "Please choose a supported MP4 video.", "error");
    return;
  }
  revokeVideoObjectUrl();
  pendingVideoFile = file;
  savedVideo = null;
  if (fields.videoUrl) fields.videoUrl.value = "";
  if (fields.youtubeUrl) fields.youtubeUrl.value = "";
  setJsonField(fields.externalVideoData, null);
  videoObjectUrl = URL.createObjectURL(file);
  setVideoSource("upload");
  renderVideoPreview();
  const metadataVideo = document.createElement("video");
  metadataVideo.preload = "metadata";
  metadataVideo.src = videoObjectUrl;
  metadataVideo.addEventListener("loadedmetadata", () => {
    if (pendingVideoFile !== file || !media.videoFileMeta) return;
    const details = [
      formatFileSize(file.size),
      Number.isFinite(metadataVideo.duration) ? `${Math.round(metadataVideo.duration)}s` : "",
      metadataVideo.videoWidth && metadataVideo.videoHeight
        ? `${metadataVideo.videoWidth} × ${metadataVideo.videoHeight}`
        : "",
    ].filter(Boolean);
    media.videoFileMeta.textContent = details.join(" · ");
    metadataVideo.removeAttribute("src");
    metadataVideo.load();
  }, { once: true });
  markAsChanged();
  notify("Video ready. It will upload when you save.");
}

function clearVideo({ markChanged = true } = {}) {
  revokeVideoObjectUrl();
  pendingVideoFile = null;
  savedVideo = null;
  if (fields.videoUrl) fields.videoUrl.value = "";
  if (fields.youtubeUrl) fields.youtubeUrl.value = "";
  if (fields.videoType) fields.videoType.value = "";
  setJsonField(fields.externalVideoData, null);
  if (media.videoInput) media.videoInput.value = "";
  renderVideoPreview();
  updateMediaStatus();
  if (markChanged) markAsChanged();
}

function renderGalleryPreview() {
  const hasImages = galleryPreviewItems.length > 0;
  media.galleryPreview?.classList.toggle("hidden", !hasImages);
  media.galleryEmptyMessage?.classList.toggle("hidden", hasImages);
  media.clearGalleryButton?.classList.toggle("hidden", !hasImages);

  if (media.galleryPreview) {
    media.galleryPreview.innerHTML = galleryPreviewItems
      .map(
        (item, index) => `
          <figure class="project-gallery-item">
            <img src="${escapeHtml(item.url)}" alt="Gallery preview ${index + 1}">
            <button class="icon-button project-gallery-remove-button" type="button" data-remove-gallery-index="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
          </figure>
        `,
      )
      .join("");
  }
  updateMediaStatus();
}

function projectGalleryAssets() {
  return galleryPreviewItems
    .filter((item) => !item.isObjectUrl && savedMediaAvailable(item.asset))
    .map((item) => item.asset);
}

function syncProjectGalleryField() {
  setJsonField(fields.galleryImages, projectGalleryAssets());
}

function setGalleryFromSavedMedia(values = []) {
  clearGalleryObjectUrls();
  const source = Array.isArray(values)
    ? values
    : String(values || "").split(",").map((value) => value.trim()).filter(Boolean);
  galleryPreviewItems = source
    .filter(savedMediaAvailable)
    .map((asset, index) => ({
      asset,
      url: resolveAdminMediaAssetUrl(asset),
      name: asset?.originalFilename || asset?.name || `Saved gallery image ${index + 1}`,
      isObjectUrl: false,
      file: null,
    }))
    .filter((item) => item.url);
  syncProjectGalleryField();
  renderGalleryPreview();
}

function addGalleryFiles(fileList) {
  const validFiles = [...fileList].filter((file) => {
    try {
      validateMediaFile(file, "image", "projects");
      return true;
    } catch {
      return false;
    }
  });

  if (!validFiles.length) {
    notify("Please choose supported gallery images within the configured upload limit.", "error");
    return;
  }

  const remainingSlots = Math.max(0, MAX_GALLERY_FILES - galleryPreviewItems.length);
  const filesToAdd = validFiles.slice(0, remainingSlots);

  filesToAdd.forEach((file) => {
    galleryPreviewItems.push({
      asset: null,
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      isObjectUrl: true,
    });
  });

  if (media.galleryInput) media.galleryInput.value = "";
  renderGalleryPreview();
  markAsChanged();

  if (validFiles.length > remainingSlots) {
    notify(`Only ${MAX_GALLERY_FILES} gallery previews are allowed.`, "error");
    return;
  }

  notify("Screenshots ready. They will upload when you save.");
}

function removeGalleryItem(index) {
  const item = galleryPreviewItems[index];
  if (!item) return;

  if (item.isObjectUrl) URL.revokeObjectURL(item.url);
  galleryPreviewItems.splice(index, 1);
  syncProjectGalleryField();
  renderGalleryPreview();
  markAsChanged();
}

function clearGalleryPreview({ clearSavedValue = false, markChanged = false } = {}) {
  clearGalleryObjectUrls();
  if (media.galleryInput) media.galleryInput.value = "";
  if (clearSavedValue) setJsonField(fields.galleryImages, []);
  renderGalleryPreview();
  if (markChanged) markAsChanged();
}

function assetPreviewMarkup(items = [], kind = "asset") {
  return items.map((item, index) => `
    <div class="project-asset-row">
      <span><strong>${escapeHtml(item.originalFilename || item.name || `${formatLabel(kind)} ${index + 1}`)}</strong><small>${escapeHtml(savedMediaAvailable(item) ? "Uploaded" : formatFileSize(item.size || 0))}</small></span>
    </div>`).join("");
}

function renderAssetPreviews() {
  if (media.pdfPreview) {
    const items = [savedPdfAsset, pendingPdfFile].filter(Boolean).slice(-1);
    media.pdfPreview.classList.toggle("hidden", !items.length);
    media.pdfPreview.innerHTML = assetPreviewMarkup(items, "pdf");
  }
  if (media.sourcePreview) {
    const items = [...savedSourceFiles, ...pendingSourceFiles];
    media.sourcePreview.classList.toggle("hidden", !items.length);
    media.sourcePreview.innerHTML = assetPreviewMarkup(items, "source file");
  }
  if (media.customPreview) {
    const items = [...savedCustomAssets, ...pendingCustomAssets];
    media.customPreview.classList.toggle("hidden", !items.length);
    media.customPreview.innerHTML = assetPreviewMarkup(items, "asset");
  }
  updateMediaStatus();
  renderResourceStatus();
  renderActionRequirementStatus();
}

function createMediaUploadComponent({ input, zone, kind, multiple = false, onSelect }) {
  const selectFiles = (files) => {
    const selected = [...(files || [])];
    if (!selected.length) return;
    const accepted = [];
    for (const file of selected) {
      try {
        validateMediaFile(file, kind, "projects");
        accepted.push(file);
      } catch (error) {
        notify(error.message || `Unable to use ${file.name}.`, "error");
      }
    }
    if (accepted.length) onSelect(multiple ? accepted : accepted[0]);
    if (input) input.value = "";
  };
  addOptionalListener(input, "change", () => selectFiles(input?.files));
  setupDropZone(zone, selectFiles);
  return { selectFiles };
}

function setPdfFile(file) {
  pendingPdfFile = file || null;
  if (file) savedPdfAsset = null;
  renderAssetPreviews();
  renderLinkedActions();
  renderActionRequirementStatus();
  markAsChanged();
}

function setSourceFiles(files) {
  pendingSourceFiles = [...files];
  renderAssetPreviews();
  renderLinkedActions();
  renderActionRequirementStatus();
  markAsChanged();
}

function setCustomAssets(files) {
  pendingCustomAssets = [...files];
  renderAssetPreviews();
  renderLinkedActions();
  renderActionRequirementStatus();
  markAsChanged();
}

function resetMedia() {
  void discardTemporaryMediaAssets({ savedCoverImage, savedProjectLogo, galleryImages: projectGalleryAssets(), savedVideo, savedPdfAsset, savedSourceFiles, savedCustomAssets }, { reason: "project-editor-reset" });
  clearCoverPreview();
  clearLogoPreview({ clearSaved: true });
  clearGalleryPreview();
  clearVideo({ markChanged: false });
  pendingCoverFile = null;
  savedCoverImage = null;
  pendingPdfFile = null;
  pendingSourceFiles = [];
  pendingCustomAssets = [];
  savedPdfAsset = null;
  savedSourceFiles = [];
  savedCustomAssets = [];
  setEnabledCustomMediaAssets([]);
  setJsonField(fields.demoVideoData, null);
  setJsonField(fields.externalVideoData, null);
  setJsonField(fields.pdfAssetData, null);
  setJsonField(fields.sourceFilesData, []);
  setJsonField(fields.customAssetsData, []);
  renderAssetPreviews();
}

function resetForm() {
  linkedSourceLoadToken += 1;
  form.reset();
  resetMedia();
  projectSkillPicker?.clearSearch();
  projectToolPicker?.clearSearch();
  setSelectedSkillIds([]);
  setSelectedToolIds([]);
  selectedPublicTagRefs = [];
  if (fields.publicTagMode) fields.publicTagMode.value = "automatic";
  if (fields.publicTagRefs) fields.publicTagRefs.value = "[]";
  projectPublicTagToolPicker?.setSelectedIds([]);
  projectPublicTagSkillPicker?.setSelectedIds([]);
  idInput.value = "";
  fields.year.value = new Date().getFullYear();
  fields.displayOrder.value = "0";
  fields.status.value = "draft";
  if (fields.projectType) fields.projectType.value = "standalone";
  renderLinkedModuleOptions("");
  if (fields.linkedScope) fields.linkedScope.value = "entry";
  if (fields.linkedDocumentId) { fields.linkedDocumentId.innerHTML = '<option value="">Select the content you want this project card to represent.</option>'; fields.linkedDocumentId.disabled = true; }
  linkedSourceElements.entryField?.classList.remove("hidden");
  if (fields.linkedDestination) fields.linkedDestination.value = "";
  setJsonField(fields.linkedSourceSnapshot, null);
  selectedLinkedSource = null;
  linkedActions = [];
  renderLinkedActions();
  renderLinkedSourcePreview(null, { state: "empty" });
  setLinkedSourceStatus("No module selected yet.", "", { supporting: "Choose a portfolio module to view available entries." });
  linkedSourceElements.warning?.classList.add("hidden");
  linkedSourceElements.success?.classList.add("hidden");
  if (fields.standaloneProjectName) fields.standaloneProjectName.value = "";
  if (fields.githubSecondaryEnabled) fields.githubSecondaryEnabled.checked = false;
  if (fields.githubUrl) fields.githubUrl.value = "";
  updateGithubSecondaryActionUI();
  if (fields.mediaType) fields.mediaType.value = "cover-only";
  if (fields.actionType) fields.actionType.value = "project-preview";
  setPrimaryCtaLabel("View Project", { auto: true });
  if (fields.destination) fields.destination.value = "";
  fields.visible.checked = true;
  fields.customCategory.value = "";
  projectCustomCategoryField.classList.add("hidden");
  fields.customCategory.required = false;
  $("projectFormTitle").textContent = "Add Project";
  $("saveProjectButtonText").textContent = "Save Project";
  $("deleteProjectButton").classList.add("hidden");
  updateProjectTypeUI();
  syncProjectPublicTagsUI();
  updateCounts();
  hasUnsavedChanges = false;
  setStatus("ready");
}

async function openForm(project = null) {
  resetForm();

  if (project) {
    idInput.value = project.id;
    fields.title.value = project.title || "";
    if (fields.projectType) setSelectValue(fields.projectType, normalizeProjectType(project.projectType || (project.linkedDestination || project.linkedModule ? "linked-module" : "standalone")), "standalone");
    const linkedModuleKey = project.linkedModuleKey || project.linkedModule || "";
    const registeredLinkedModule = getPortfolioModule(linkedModuleKey);
    renderLinkedModuleOptions(registeredLinkedModule?.key || linkedModuleKey);
    if (fields.linkedScope) fields.linkedScope.value = project.linkedScope || linkedModuleScope(registeredLinkedModule?.key || linkedModuleKey);
    if (fields.linkedDestination) fields.linkedDestination.value = project.linkedDestination || (project.projectType === "linked-module" ? project.destination || "" : "");
    setJsonField(fields.linkedSourceSnapshot, {
      title: project.linkedTitleSnapshot || project.title || "",
      summary: project.linkedSummarySnapshot || project.shortDescription || "",
      cover: project.linkedCoverSnapshot?.url || "",
      updatedAt: project.linkedUpdatedAtSnapshot || null
    });
    linkedActions = (Array.isArray(project.additionalActions) && project.additionalActions.length ? project.additionalActions : (Array.isArray(project.linkedActions) ? project.linkedActions : [])).map((action, index) => normalizeLinkedActionState(action, index));
    renderLinkedActions();
    if (fields.standaloneProjectName) fields.standaloneProjectName.value = project.standaloneProjectName || project.title || "";
    setSelectValue(fields.category, project.category || "", "");
    fields.customCategory.value =
      project.customCategory || "";

    updateProjectCustomCategoryVisibility();

    fields.year.value = project.year || new Date().getFullYear();
    if (fields.projectHours) fields.projectHours.value = project.projectHours ?? "";
    fields.displayOrder.value = project.displayOrder || 0;
    fields.shortDescription.value = project.shortDescription || "";
    fields.description.value = project.fullDescription || project.description || "";
    setProjectCapabilities(project);
    selectedPublicTagRefs = normalizePublicTagRefs(project.publicTagRefs, project.publicToolIds || []);
    if (fields.publicTagMode) fields.publicTagMode.value = normalizePublicTagMode(project.publicTagMode || project.publicToolMode);
    syncPublicTagField();
    syncProjectPublicTagsUI();
    fields.githubUrl.value = project.githubUrl || "";
    if (fields.githubSecondaryEnabled) {
      fields.githubSecondaryEnabled.checked = project.githubSecondaryEnabled === undefined
        ? Boolean(project.githubUrl)
        : Boolean(project.githubSecondaryEnabled);
    }
    updateGithubSecondaryActionUI();
    fields.liveUrl.value = project.liveUrl || "";
    savedProjectLogo = project.projectLogo || null;
    renderSavedLogo(savedProjectLogo, project.title);
    savedCoverImage = project.coverImage || (project.coverImageUrl ? { url: project.coverImageUrl } : null);
    if (fields.coverImageUrl) {
      fields.coverImageUrl.value = project.coverImageUrl || "";
    }
    savedVideo = project.demoVideo || project.video || null;
    savedPdfAsset = project.pdfAsset || null;
    savedSourceFiles = Array.isArray(project.sourceFiles) ? project.sourceFiles : [];
    savedCustomAssets = Array.isArray(project.customAssets) ? project.customAssets : [];
    setEnabledCustomMediaAssets(Array.isArray(project.enabledMediaAssets) ? project.enabledMediaAssets : inferEnabledMediaAssets(project));
    if (fields.actionType) setSelectValue(fields.actionType, project.actionType || "project-preview", "project-preview");
    setPrimaryCtaLabel(project.buttonLabel || resolveProjectAction(project).label || "View Project");
    if (fields.destination) fields.destination.value = project.destination || "";
    if (fields.mediaType) {
      setSelectValue(
        fields.mediaType,
        normalizeMediaProfile(project.mediaType || (project.youtubeUrl ? "cover-external-video" : (savedMediaAvailable(project.demoVideo) || savedMediaAvailable(project.video)) ? "cover-mp4" : "cover-only")),
        "cover-only"
      );
    }
    if (fields.videoUrl) fields.videoUrl.value = "";
    const externalUrl = project.externalVideo?.url || project.youtubeUrl || "";
    if (fields.youtubeUrl) fields.youtubeUrl.value = externalUrl;
    setJsonField(fields.demoVideoData, savedVideo);
    setJsonField(fields.externalVideoData, project.externalVideo || (externalUrl ? detectExternalVideoProvider(externalUrl) : null));
    setJsonField(fields.pdfAssetData, savedPdfAsset);
    setJsonField(fields.sourceFilesData, savedSourceFiles);
    setJsonField(fields.customAssetsData, savedCustomAssets);
    if (fields.videoType) {
      setSelectValue(fields.videoType, project.videoType || (externalUrl ? "external" : savedMediaAvailable(savedVideo) ? "upload" : ""), "");
    }
    setJsonField(fields.galleryImages, project.galleryImages || []);
    setSelectValue(fields.status, project.status || "draft", "draft");
    fields.featured.checked = Boolean(project.featured);
    fields.visible.checked = project.visible !== false;

    const savedCoverUrl = resolveAdminMediaAssetUrl(project.coverImage) || resolveAdminMediaAssetUrl(project.coverImageUrl) || "";
    if (savedCoverUrl) {
      renderCoverPreview({
        url: savedCoverUrl,
        name: "Saved cover image",
        meta: "Existing project media",
      });
    }

    setGalleryFromSavedMedia(project.galleryImages || []);
    if (fields.videoType?.value) setVideoSource(fields.videoType.value);
    renderVideoPreview();
    renderAssetPreviews();
    updateProjectTypeUI();
    if (activeProjectType() === "linked-module" && registeredLinkedModule) {
      await loadLinkedSourceEntries(registeredLinkedModule.key, project.linkedDocumentId || "");
      if (linkedModuleScope(registeredLinkedModule.key) === "entry" && !project.linkedDocumentId) {
        linkedSourceElements.warning?.classList.remove("hidden");
        if (linkedSourceElements.warning) linkedSourceElements.warning.textContent = "Legacy linked project. Select a source entry to complete the registry link.";
      }
    } else if (activeProjectType() === "linked-module") {
      linkedSourceElements.warning?.classList.remove("hidden");
      if (linkedSourceElements.warning) linkedSourceElements.warning.textContent = "Legacy Link: this project is not mapped to a registered module. Existing values are preserved; select a registered source module to relink it.";
      setLinkedSourceStatus("Legacy link preserved. Select a registered module to relink.", "error");
    }
    if (linkedActions.some((action) => action.kind === "linked")) {
      await hydrateLinkedActions();
    }

    updateProjectTypeUI();

    $("projectFormTitle").textContent = "Edit Project";
    $("saveProjectButtonText").textContent = "Update Project";
    $("deleteProjectButton").classList.remove("hidden");
  }

  form.classList.remove("hidden");
  updateCounts();
  render();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  form.classList.add("hidden");
  resetForm();
  render();
}

function updateCounts() {
  $("shortDescriptionCount").textContent = fields.shortDescription.value.length;
}

function projectStatusBadge(project = {}) {
  const published = project.status === "published";
  return `<span class="badge project-status-badge ${published ? "is-published" : "is-draft"}">${published ? "Published" : "Draft"}</span>`;
}

function projectVisibilityBadge(project = {}) {
  const hidden = project.visible === false;
  return `<span class="badge project-visibility-badge ${hidden ? "is-hidden" : "is-visible"}">${hidden ? "Hidden" : "Visible"}</span>`;
}

function projectPreviewAssetUrl(value = null) {
  return resolveAdminPreviewMediaUrl(value);
}

function projectPreviewActionItems(project, primaryAction, configuredAdditionalActions, automaticGithubButton) {
  const items = [];
  if (primaryAction.available && primaryAction.type !== "project-preview") {
    items.push({ label: primaryAction.label, href: primaryAction.destination, sameWindow: primaryAction.target === "same-window", primary: true });
  }
  configuredAdditionalActions.forEach((action) => {
    if (action?.kind === "resource") {
      const type = action.resourceType || resourceRequirementForAction(action.label);
      const resourceIndex = Math.max(0, Number.parseInt(action.resourceIndex, 10) || 0);
      const destinations = {
        "demo-video": savedMediaUrl(project.demoVideo || project.video, "preview") || project.externalVideo?.embedUrl || project.externalVideo?.url || project.youtubeUrl || "",
        "live-website": project.liveUrl || "",
        pdf: savedMediaUrl(project.pdfAsset || project.pdfDocument, "pdf-preview"),
        download: savedMediaUrl(project.sourceFiles?.[resourceIndex] || project.sourceFile, "download"),
        "custom-resource": savedMediaUrl(project.customAssets?.[resourceIndex], "download"),
        github: project.githubUrl || "",
        "project-preview": ""
      };
      items.push({ label: action.label || resourceDefaultLabel(type), href: destinations[type] || "", disabled: type === "project-preview" });
      return;
    }
    const destination = String(getPortfolioModule(action.moduleKey || action.linkedModuleKey)?.publicDestination || action.destination || action.linkedDestination || "").trim();
    items.push({ label: String(action.label || action.buttonLabel || "View Details").trim(), href: destination });
  });
  if (project.liveUrl && !items.some((item) => item.href === project.liveUrl)) items.push({ label: "Open Live Website", href: project.liveUrl });
  if (automaticGithubButton && project.githubUrl && !items.some((item) => item.href === project.githubUrl)) items.push({ label: "GitHub", href: project.githubUrl });
  return items.filter((item) => item.label && (item.href || item.disabled));
}

function openProjectPreview(project, opener = null) {
  if (!project || !projectPreview.modal || !projectPreview.body) return;
  projectPreviewOpener = opener instanceof HTMLElement ? opener : document.activeElement;
  projectPreview.title.textContent = "Project Preview";

  const linkedPresentation = project.linkedSourcePresentation || null;
  const linkedProject = normalizeProjectType(project.projectType || (project.linkedDestination || project.linkedModule ? "linked-module" : "standalone")) === "linked-module";
  const linkedModule = linkedProject ? getPortfolioModule(project.linkedModuleKey || project.linkedModule) : null;
  const context = linkedProject ? (linkedModule?.label || project.linkedModule || "Linked Portfolio Content") : (projectCategoryLabel(project) || "Standalone Project");
  projectPreview.context.textContent = context;

  const coverUrl = resolveProjectAdminCover(project, linkedPresentation);
  const logoUrl = resolveAdminMediaAssetUrl(project.projectLogo) || resolveAdminMediaAssetUrl(project.projectLogoUrl) || "";
  const title = linkedPresentation?.title || project.title || "Untitled project";
  const chips = [
    project.status === "published" ? "Published" : "Draft",
    linkedProject ? "Linked content" : "Standalone",
    !linkedProject && projectCategoryLabel(project),
    !linkedProject && project.year ? String(project.year) : "",
    project.featured ? "Featured" : "",
    project.visible === false ? "Hidden" : "Visible"
  ].filter(Boolean);

  const summary = linkedProject
    ? (linkedPresentation?.summary || project.cardSummary || project.shortDescription || "")
    : (project.cardSummary || project.shortDescription || "");
  const description = linkedProject
    ? (linkedPresentation?.description || project.fullDescription || project.description || "")
    : (project.fullDescription || project.description || "");

  const configuredAdditionalActions = Array.isArray(project.additionalActions) && project.additionalActions.length
    ? project.additionalActions
    : (Array.isArray(project.linkedActions) ? project.linkedActions : []);
  const primaryAction = resolveProjectAction(project);
  const explicitGithubAction = configuredAdditionalActions.some((action) =>
    action?.kind === "resource" && (action.resourceType === "github" || resourceRequirementForAction(action.label) === "github")
  );
  const githubSecondaryEnabled = project.githubSecondaryEnabled === undefined ? Boolean(project.githubUrl) : Boolean(project.githubSecondaryEnabled);
  const automaticGithubButton = Boolean(githubSecondaryEnabled && project.githubUrl && primaryAction.type !== "github" && !explicitGithubAction);

  const blocks = [];
  if (coverUrl) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, src: coverUrl, alt: `${title} cover` });
  blocks.push({
    type: ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY,
    role: "work",
    title,
    eyebrow: context,
    logo: logoUrl,
    chips
  });
  if (summary || description) blocks.push({
    type: ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW,
    title: "Overview",
    lead: summary && summary !== description ? summary : "",
    body: description
  });

  const galleryItems = (Array.isArray(project.galleryImages) ? project.galleryImages : []).map((item, index) => ({ src: projectPreviewAssetUrl(item), alt: `${title} gallery image ${index + 1}` })).filter((item) => item.src);
  if (!coverUrl && galleryItems.length) blocks.unshift({ type: ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, src: galleryItems[0].src, alt: galleryItems[0].alt, caption: "Primary project media" });
  if (galleryItems.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.GALLERY, title: "Gallery", items: galleryItems });

  const external = project.externalVideo || detectExternalVideoProvider(project.youtubeUrl || "");
  const videoUrl = savedMediaUrl(project.demoVideo || project.video, "preview");
  const externalUrl = external?.embedUrl || external?.url || "";
  if (externalUrl || videoUrl) blocks.push({
    type: ADMIN_PREVIEW_BLOCK_TYPES.VIDEO,
    title: "Demo",
    embed: Boolean(externalUrl && ["youtube", "vimeo", "google-drive"].includes(external.provider)),
    embedUrl: externalUrl,
    src: videoUrl || externalUrl
  });

  const publicCapabilityItems = [
    ...projectSkillRecords(project).map((item) => ({
      name: String(item?.name || item?.title || "").trim(),
      category: String(item?.category || "").trim(),
      icon: String(item?.icon || "").trim(),
      recordType: "skill"
    })),
    ...projectToolRecords(project).map((item) => ({
      name: String(item?.name || item?.title || "").trim(),
      category: String(item?.category || "").trim(),
      icon: String(item?.icon || "").trim(),
      recordType: "tool"
    }))
  ].filter((item) => item.name);
  const uniqueCapabilityItems = [...new Map(publicCapabilityItems.map((item) => [`${item.recordType}:${item.name.toLowerCase()}`, item])).values()];
  if (uniqueCapabilityItems.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.CHIPS, role: "capabilities", title: "Skills & Tools", items: uniqueCapabilityItems });

  const facts = [];
  if (linkedProject) {
    facts.push({ label: "Linked module", value: linkedPresentation?.moduleLabel || linkedModule?.label || project.linkedModule || "Legacy module" });
    facts.push({ label: linkedModuleScope(linkedModule?.key || project.linkedModuleKey) === "module" ? "Source scope" : "Source entry", value: linkedModuleScope(linkedModule?.key || project.linkedModuleKey) === "module" ? "Entire module" : (linkedPresentation?.title || project.linkedTitleSnapshot || project.title || "Linked source") });
    facts.push({ label: "Destination", value: linkedModule?.publicDestination || project.linkedDestination || "Unavailable" });
    if (linkedProjectSourceMissing(project)) facts.push({ label: "Source", value: "Source Missing — select a replacement in Edit." });
  } else {
    if (projectCategoryLabel(project)) facts.push({ label: "Category", value: projectCategoryLabel(project) });
    if (project.year) facts.push({ label: "Year", value: String(project.year) });
    if (project.projectHours) facts.push({ label: "Hours", value: String(project.projectHours) });
  }
  if (facts.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.FACTS, title: "Project details", items: facts });

  const files = [];
  { const href = savedMediaUrl(project.pdfAsset, "download"); if (href) files.push({ label: "PDF", href }); }
  (Array.isArray(project.sourceFiles) ? project.sourceFiles : []).forEach((asset, index) => { const href = savedMediaUrl(asset, "download"); if (href) files.push({ label: asset.originalFilename || asset.name || `Source file ${index + 1}`, href }); });
  (Array.isArray(project.customAssets) ? project.customAssets : []).forEach((asset, index) => { const href = savedMediaUrl(asset, "download"); if (href) files.push({ label: asset.originalFilename || asset.name || `Asset ${index + 1}`, href }); });
  if (files.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.FILES, title: "Files", items: files });

  const actions = projectPreviewActionItems(project, primaryAction, configuredAdditionalActions, automaticGithubButton);
  if (actions.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.ACTIONS, items: actions });

  const created = project.createdAt?.toDate ? project.createdAt.toDate().toLocaleDateString() : "—";
  const updated = project.updatedAt?.toDate ? project.updatedAt.toDate().toLocaleDateString() : "—";
  renderAdminPreview(projectPreview.body, {
    mode: coverUrl || galleryItems.length || videoUrl || externalUrl ? "media-first" : "structured",
    blocks,
    system: [
      { label: "Status", value: project.status || "draft" },
      { label: "Created", value: created },
      { label: "Updated", value: updated }
    ]
  });
  projectPreview.body.scrollTop = 0;
  projectPreview.modal.classList.remove("hidden");
  projectPreview.modal.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => projectPreview.closeButton?.focus());
}

function closeProjectPreview() {
  if (!projectPreview.modal || projectPreview.modal.classList.contains("hidden")) return;
  projectPreview.body?.querySelectorAll("video").forEach((video) => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
  projectPreview.body?.querySelectorAll("iframe").forEach((frame) => {
    frame.src = "about:blank";
  });
  projectPreview.modal.classList.add("hidden");
  projectPreview.modal.setAttribute("aria-hidden", "true");
  const opener = projectPreviewOpener;
  projectPreviewOpener = null;
  if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
}

function projectTypeBadge(project = {}) {
  const linked = normalizeProjectType(project.projectType || (project.linkedDestination || project.linkedModule ? "linked-module" : "standalone")) === "linked-module";
  if (!linked) return '<span class="badge project-type-badge">Standalone</span>';
  const label = project.linkedSourcePresentation?.moduleLabel || getPortfolioModule(project.linkedModuleKey || project.linkedModule)?.label || project.linkedModule || "Portfolio Content";
  return `<span class="badge project-type-badge project-type-badge-linked">Linked ${escapeHtml(label)}</span>`;
}

function projectMediaBadge(project = {}) {
  if (normalizeProjectType(project.projectType) === "linked-module") return "";
  const type = project.mediaType || "cover-only";
  if (type === "cover-pdf" || savedMediaAvailable(project.pdfDocument) || savedMediaAvailable(project.pdfAsset)) return '<span class="badge project-demo-badge">PDF</span>';
  if (type === "gallery-project" || project.galleryImages?.length) return '<span class="badge project-demo-badge">Gallery</span>';
  if (type === "cover-live-website" && project.liveUrl) return '<span class="badge project-demo-badge">Live</span>';
  if (type === "cover-download" || type === "cover-source-files" || savedMediaAvailable(project.sourceFile) || project.sourceFiles?.some(savedMediaAvailable)) return '<span class="badge project-demo-badge">Download</span>';
  if (savedMediaAvailable(project.demoVideo) || savedMediaAvailable(project.video)) return '<span class="badge project-demo-badge">▶ Demo</span>';
  if (project.externalVideo?.url || project.youtubeUrl) return '<span class="badge project-demo-badge">External Video</span>';
  return "";
}

function render() {
  if (projectsLoading) {
    $("totalProjectCount").textContent = "—";
    $("publishedProjectCount").textContent = "—";
    $("draftProjectCount").textContent = "—";
    emptyState.classList.add("hidden");
    list.innerHTML = `
      <div class="project-loading-state" role="status" aria-live="polite">
        <span class="project-loading-orbit" aria-hidden="true"></span>
        <strong>Loading project library</strong>
        <span>Synchronizing your saved portfolio projects…</span>
      </div>`;
    return;
  }

  const query = $("projectSearch").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  const filteredProjects = projects.filter((project) => {
    const matchesFilter = filter === "all" || project.status === filter;
    const searchText = [project.title, project.standaloneProjectName, project.linkedModule, project.linkedDestination, projectCategoryLabel(project), ...selectedSkillRecords(project).map((skill) => skill.name), ...projectToolRecords(project).map((tool) => tool.name)].join(" ").toLowerCase();
    return matchesFilter && searchText.includes(query);
  });

  $("totalProjectCount").textContent = projects.length;
  $("publishedProjectCount").textContent = projects.filter((project) => project.status === "published").length;
  $("draftProjectCount").textContent = projects.filter((project) => project.status !== "published").length;
  emptyState.classList.toggle("hidden", filteredProjects.length !== 0);
  const emptyTitle = emptyState.querySelector("strong");
  const emptyDescription = emptyState.querySelector("p");
  const noProjects = projects.length === 0;
  if (emptyTitle) emptyTitle.textContent = noProjects ? "No projects yet" : "No matching projects";
  if (emptyDescription) emptyDescription.textContent = noProjects
    ? "Add your first portfolio project to begin."
    : "Adjust the search or status filter to see more projects.";
  emptyState.setAttribute("aria-label", noProjects ? "No projects yet" : "No projects match the current filters");

  list.innerHTML = filteredProjects.map((project) => {
    const presentation = project.linkedSourcePresentation || null;
    const displayTitle = presentation?.title || project.title;
    const displaySummary = presentation?.summary || project.cardSummary || project.shortDescription || "";
    const displayCover = resolveProjectAdminCover(project, presentation);
    return `
    <article class="project-card" data-lan-record-card="true" data-lan-record-flow="grid" data-lan-record-has-media="true" data-lan-record-footprint="media-rich" data-project-id="${escapeHtml(project.id)}">
      <button class="project-card-cover-button lan-admin-media-frame lan-admin-media-frame--cover" data-lan-record-media="true" data-preview-id="${escapeHtml(project.id)}" type="button" aria-label="Preview ${escapeHtml(project.title)}">
        ${displayCover ? `<span class="project-cover-skeleton" aria-hidden="true"></span>` : ""}${adminMediaImageLayersMarkup({ src: displayCover || "", alt: `${displayTitle || "Project"} cover`, title: displayTitle || project.title || "Project", context: "Project media", role: "cover", imageClass: "project-cover", imageAttributes: "data-project-cover-image" })}
        <span class="project-card-cover-status">${projectStatusBadge(project)}</span>
      </button>
      <div class="project-card-content" data-lan-record-content="true">
        <div class="project-card-title-row"><div class="project-card-identity">${resolveAdminMediaAssetUrl(project.projectLogo) ? `<img class="project-card-logo" src="${escapeHtml(projectAdminThumbnail(resolveAdminMediaAssetUrl(project.projectLogo), 96, 96))}" alt="${escapeHtml(displayTitle)} logo">` : `<span class="project-card-logo project-card-logo-fallback" aria-label="${escapeHtml(displayTitle)} emblem">${projectModuleEmblem()}</span>`}<div class="project-card-heading"><h3 data-lan-record-identity="title">${escapeHtml(displayTitle)}</h3><div class="project-card-secondary-badges">${projectTypeBadge(project)}${project.featured ? '<span class="badge project-featured-badge">Featured</span>' : ""}${projectMediaBadge(project)}</div></div></div></div>
        <p data-lan-record-summary="true">${escapeHtml(displaySummary)}</p>
        <div class="project-meta" data-lan-record-overflow-group="metadata">${normalizeProjectType(project.projectType || (project.linkedDestination || project.linkedModule ? "linked-module" : "standalone")) === "linked-module" ? `<span>${escapeHtml(getPortfolioModule(project.linkedModuleKey || project.linkedModule)?.label || project.linkedModule || "Portfolio Module")}</span>${linkedProjectSourceMissing(project) ? '<span class="badge project-source-missing-badge">Source Missing</span>' : ""}` : `<span>${escapeHtml(projectCategoryLabel(project))}</span><span>${escapeHtml(String(project.year || ""))}</span>`}<span>Order ${escapeHtml(String(project.displayOrder || 0))}</span>${projectVisibilityBadge(project)}</div>
        <div class="project-card-technologies" data-lan-record-overflow-group="capabilities">${projectToolMarkup(project)}</div>
      </div>
      <div class="project-actions">
        <button class="project-preview-button editor-secondary-button button-compact" data-preview-id="${escapeHtml(project.id)}" type="button">Preview</button>
        <button class="project-edit-button editor-secondary-button button-compact" data-edit-id="${escapeHtml(project.id)}" type="button">Edit</button>
        <button class="project-delete-button editor-danger-button button-compact" data-delete-id="${escapeHtml(project.id)}" type="button">Delete</button>
      </div>
    </article>`;
  }).join("");

  window.LANPinActiveRecordCard?.(list, idInput?.value || "", {
    cardSelector: ".project-card",
    idAttribute: "data-project-id"
  });
  window.LANCreateRecordSelection?.(list, {
    cardSelector: ".project-card",
    idAttribute: "data-project-id",
    actionSelector: ".project-actions",
    label: "project",
    records: projects,
    capabilities: { publishing: true, featured: true, visibility: false, deletion: true },
    onBulkPatch: (ids, changes) => runBulkProjectUpdate(ids, changes, { successMessage: `${ids.length} project${ids.length === 1 ? "" : "s"} updated.` }),
    onDelete: async (ids) => {
      for (const id of ids) await deleteProject(id);
      if (ids.includes(idInput?.value || "")) closeForm();
      await refresh();
      notify(`${ids.length} project${ids.length === 1 ? "" : "s"} deleted.`, "success");
    }
  })?.sync();
}

async function hydrateLinkedSourceAvailability(projectList = []) {
  const moduleKeys = [...new Set(projectList
    .filter((project) => normalizeProjectType(project.projectType) === "linked-module" && project.linkedModuleKey)
    .map((project) => project.linkedModuleKey))];
  await Promise.all(moduleKeys.map(async (moduleKey) => {
    try {
      let entries = linkedSourceCache.get(moduleKey);
      if (!entries) {
        entries = await loadPortfolioModuleEntries(moduleKey);
        linkedSourceCache.set(moduleKey, entries);
      }
      const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
      const module = getPortfolioModule(moduleKey);
      projectList.forEach((project) => {
        if (project.linkedModuleKey !== moduleKey) return;
        if (linkedModuleScope(moduleKey) === "module") {
          project.linkedSourceMissing = false;
          project.linkedModuleEntries = entries;
          project.linkedSourceRaw = null;
          project.linkedSourcePresentation = {
            title: project.title || (moduleKey === "photo-editing" ? "Photo Editing Portfolio" : module?.label || "Linked module"),
            summary: project.shortDescription || project.cardSummary || "",
            moduleLabel: module?.label || moduleKey,
            sourceMissing: false,
            module
          };
          return;
        }
        if (project.linkedDocumentId) {
          const source = entryMap.get(project.linkedDocumentId) || null;
          project.linkedSourceMissing = !source;
          project.linkedSourceRaw = source?.raw || null;
          project.linkedSourcePresentation = resolveLinkedProjectPresentation(project, source, module);
        }
      });
    } catch (error) {
      console.warn(`Unable to verify linked sources for ${moduleKey}:`, error);
    }
  }));
}

async function runBulkProjectUpdate(ids = [], changes = {}, { successMessage = "Projects updated." } = {}) {
  const cleanIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!cleanIds.length) return false;

  const selectedProjects = cleanIds
    .map((id) => projects.find((project) => project.id === id))
    .filter(Boolean);
  if (!selectedProjects.length) return false;

  try {
    await updateManyProjects(cleanIds, changes);
    await refresh();
    list.__lanRecordSelection?.clear();
    notify(successMessage, "success");
    return true;
  } catch (error) {
    console.error("Bulk project update failed:", error);
    notify(error?.message || "Unable to update the selected projects.", "error");
    return false;
  }
}

async function refresh() {
  projectsLoading = true;
  setStatus("loading");
  render();

  try {
    projects = await loadProjects();
    await hydrateLinkedSourceAvailability(projects);
    projectsLoading = false;
    render();
    setStatus("ready");
  } catch (error) {
    console.error(error);
    projectsLoading = false;
    render();
    setStatus("error");
    notify(error.message || "Unable to load projects.", "error");
  }
}

function openDelete(id, opener = null) {
  if (!id || isDeleting) return;
  pendingDeleteId = id;
  deleteModalOpener = opener instanceof HTMLElement ? opener : document.activeElement;
  const project = projects.find((item) => item.id === id);
  const title = $("deleteProjectTitle");
  if (title) title.textContent = `Move “${project?.title || "this project"}” to deleted projects?`;
  const modal = $("deleteConfirmationModal");
  modal?.classList.remove("hidden");
  modal?.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => $("cancelDeleteButton")?.focus());
}

function closeDelete() {
  if (isDeleting) return;
  pendingDeleteId = "";
  $("deleteConfirmationModal")?.classList.add("hidden");
  $("deleteConfirmationModal")?.setAttribute("aria-hidden", "true");
  const opener = deleteModalOpener;
  deleteModalOpener = null;
  if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
}

async function confirmDelete() {
  if (!pendingDeleteId || isDeleting) return;
  const button = $("confirmDeleteButton");
  const originalText = button?.textContent || "Delete Permanently";
  isDeleting = true;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Deleting…";
  }

  try {
    await deleteProject(pendingDeleteId);
    notify("Project deleted successfully.");
    isDeleting = false;
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = originalText; }
    closeDelete();
    closeForm();
    await refresh();
  } catch (error) {
    console.error(error);
    notify(error.message || "Unable to delete project.", "error");
  } finally {
    isDeleting = false;
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = originalText;
    }
  }
}

function setupDropZone(zone, handleFiles) {
  if (!zone || typeof handleFiles !== "function") return;

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    });
  });

  zone.addEventListener("drop", (event) => {
    if (event.dataTransfer?.files?.length) {
      handleFiles(event.dataTransfer.files);
    }
  });
}

if (!form || !$("addProjectButton")) {
  throw new Error("Projects Manager could not initialize because required HTML elements are missing.");
}

$("addProjectButton").addEventListener("click", () => openForm());
$("emptyStateAddButton")?.addEventListener("click", () => openForm());

form.addEventListener("input", (event) => {
  if (event.target.matches("input[type='file']")) return;
  markAsChanged();
  updateCounts();
  renderProjectReadiness();
});

form.addEventListener("change", (event) => {
  if (event.target.matches("input[type='file']")) return;
  markAsChanged();
});

fields.githubSecondaryEnabled?.addEventListener("change", () => {
  updateGithubSecondaryActionUI();
  markAsChanged();
});

function focusFirstInvalidField() {
  const invalid = form.querySelector(":invalid");
  if (!(invalid instanceof HTMLElement)) return;
  invalid.scrollIntoView({ behavior: "smooth", block: "center" });
  window.requestAnimationFrame(() => invalid.focus({ preventScroll: true }));
}

function focusFieldForValidationError(error) {
  const message = String(error?.message || "").toLowerCase();
  const linkedButtonMatch = message.match(/button\s+(\d+)/);
  if (linkedButtonMatch && linkedActionElements.list) {
    const actionIndex = Math.max(0, Number(linkedButtonMatch[1]) - 2);
    const action = linkedActions[actionIndex];
    const row = action ? linkedActionElements.list.querySelector(`[data-linked-action-id="${CSS.escape(action.clientId)}"]`) : null;
    const target = message.includes("entry")
      ? row?.querySelector("[data-linked-action-entry]")
      : message.includes("label")
        ? row?.querySelector("[data-linked-action-label]")
        : row?.querySelector("[data-linked-action-module]");
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
      return;
    }
  }
  const mappings = [
    ["cover image", media.coverInput || media.coverZone],
    ["standalone project name", fields.standaloneProjectName],
    ["full description", fields.description],
    ["github", fields.githubUrl],
    ["live website", fields.liveUrl],
    ["external video", fields.youtubeUrl],
    ["mp4", media.videoInput || media.videoZone],
    ["pdf", media.pdfInput || media.pdfZone],
    ["source file", media.sourceInput || media.sourceZone],
    ["button label", fields.buttonLabel],
    ["source module", fields.linkedModule],
    ["source entry", fields.linkedDocumentId],
    ["linked module destination", fields.linkedModule],
    ["internal linked module destination", fields.linkedModule]
  ];
  const target = mappings.find(([needle]) => message.includes(needle))?.[1];
  if (!(target instanceof HTMLElement)) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSaving) return;
  if (window.LANValidateForm ? !window.LANValidateForm(form, { title: "Complete Project" }) : !form.reportValidity()) {
    focusFirstInvalidField();
    return;
  }

  isSaving = true;
  setStatus("saving");
  $("saveProjectButton").disabled = true;

  try {
    const hasCover = Boolean(pendingCoverFile || savedMediaAvailable(savedCoverImage) || fields.coverImageUrl?.value);
    if (activeProjectType() === "standalone" && isMediaAssetActive("cover") && !idInput.value && projectMediaSettings.module?.coverRequired !== false && !hasCover) {
      throw new Error("A cover image is required for every standalone project.");
    }
    validateOptionalProjectUrls();
    if (activeProjectType() === "standalone") {
      if (!String(fields.standaloneProjectName?.value || "").trim()) throw new Error("Enter a standalone project name.");
      if (!selectedToolIds.length && !selectedSkillIds.length) throw new Error("Select at least one Skill or Tool for the standalone project.");
    }
    validateLinkedActionsEditor();
    validateSelectedMediaType();
    validateConfiguredProjectAction();
    const storageOwnerId = idInput.value || reserveProjectId();
    if (pendingCoverFile && isMediaAssetActive("cover")) {
      savedCoverImage = await uploadImage(pendingCoverFile, PROJECT_MEDIA_FOLDERS.projectCovers || "projects/covers", progress => { $("saveProjectButtonText").textContent = `Uploading cover ${progress}%`; }, { context: { ownerType: "project", ownerId: storageOwnerId, fieldId: "cover", pageName: "Projects", recordTitle: String(fields.title?.value || "Project").trim() }, access: "public-preview" });
      if (fields.coverImageUrl) fields.coverImageUrl.value = "";
      pendingCoverFile = null;
    }
    if (isMediaAssetActive("logo") && pendingLogoFile) {
      savedProjectLogo = await uploadMedia(pendingLogoFile, { module: "projects", kind: "logo", family: "image", folder: PROJECT_MEDIA_FOLDERS.projectLogos || "projects/logos", resourceType: "image", access: "public-preview", context: { ownerType: "project", ownerId: storageOwnerId, fieldId: "logo", pageName: "Projects", recordTitle: String(fields.title?.value || "Project").trim() }, onProgress: progress => { $("saveProjectButtonText").textContent = `Uploading logo ${progress}%`; } });
      pendingLogoFile = null; setJsonField(fields.projectLogoData, savedProjectLogo);
    }
    if (isMediaAssetActive("screenshots")) {
      for (let index = 0; index < galleryPreviewItems.length; index += 1) {
        const item = galleryPreviewItems[index];
        if (!item?.isObjectUrl || !(item.file instanceof File)) continue;
        const uploaded = await uploadImage(
          item.file,
          PROJECT_MEDIA_FOLDERS.projectScreenshots || "projects/screenshots",
          progress => { $("saveProjectButtonText").textContent = `Uploading screenshot ${index + 1} ${progress}%`; },
          {
            context: {
              ownerType: "project",
              ownerId: storageOwnerId,
              fieldId: "screenshots",
              pageName: "Projects",
              recordTitle: String(fields.title?.value || "Project").trim(),
            },
            access: "public-preview",
          },
        );
        URL.revokeObjectURL(item.url);
        galleryPreviewItems[index] = {
          asset: uploaded,
          file: null,
          url: resolveAdminMediaAssetUrl(uploaded),
          name: uploaded.originalFilename || uploaded.name || item.name,
          isObjectUrl: false,
        };
      }
      syncProjectGalleryField();
      renderGalleryPreview();
    }
    if (isMediaAssetActive("demo-video") && pendingVideoFile) {
      savedVideo = await uploadVideo(pendingVideoFile, PROJECT_MEDIA_FOLDERS.projectVideos || "projects/videos", progress => { $("saveProjectButtonText").textContent = `Uploading video ${progress}%`; }, { context: { ownerType: "project", ownerId: storageOwnerId, fieldId: "demo-video", pageName: "Projects", recordTitle: String(fields.title?.value || "Project").trim() }, access: "public-preview" });
      if (fields.videoUrl) fields.videoUrl.value = "";
      if (fields.videoType) fields.videoType.value = "upload";
      pendingVideoFile = null;
    }
    if (isMediaAssetActive("demo-video") && fields.youtubeUrl?.value.trim()) {
      const external = detectExternalVideoProvider(fields.youtubeUrl.value);
      if (external.provider === "invalid") throw new Error("Please enter a valid external video URL.");
      if (fields.videoType) fields.videoType.value = "external";
      setJsonField(fields.externalVideoData, external);
      savedVideo = null;
      if (fields.videoUrl) fields.videoUrl.value = "";
    }
    if (pendingPdfFile) {
      savedPdfAsset = await uploadMedia(pendingPdfFile, { module: "projects", kind: "pdf", family: "document", folder: PROJECT_MEDIA_FOLDERS.projectDocuments || "projects/documents", resourceType: "raw", access: "public-preview", context: { ownerType: "project", ownerId: storageOwnerId, fieldId: "pdf", pageName: "Projects", recordTitle: String(fields.title?.value || "Project").trim() }, onProgress: progress => { $("saveProjectButtonText").textContent = `Uploading PDF ${progress}%`; } });
      pendingPdfFile = null;
      setJsonField(fields.pdfAssetData, savedPdfAsset);
    }
    if (pendingSourceFiles.length) {
      const uploaded = [];
      for (const file of pendingSourceFiles) uploaded.push(await uploadMedia(file, { module: "projects", kind: "source", family: "file", folder: PROJECT_MEDIA_FOLDERS.projectSources || "projects/source-files", resourceType: "raw", access: "public-preview", context: { ownerType: "project", ownerId: storageOwnerId, fieldId: "source-files", pageName: "Projects", recordTitle: String(fields.title?.value || "Project").trim() }, onProgress: progress => { $("saveProjectButtonText").textContent = `Uploading source ${progress}%`; } }));
      savedSourceFiles = [...savedSourceFiles, ...uploaded];
      pendingSourceFiles = [];
      setJsonField(fields.sourceFilesData, savedSourceFiles);
    }
    if (pendingCustomAssets.length) {
      const uploaded = [];
      for (const file of pendingCustomAssets) uploaded.push(await uploadMedia(file, { module: "projects", kind: "asset", family: "file", folder: PROJECT_MEDIA_FOLDERS.projectAssets || "projects/assets", resourceType: "auto", access: "public-preview", context: { ownerType: "project", ownerId: storageOwnerId, fieldId: "custom-assets", pageName: "Projects", recordTitle: String(fields.title?.value || "Project").trim() }, onProgress: progress => { $("saveProjectButtonText").textContent = `Uploading asset ${progress}%`; } }));
      savedCustomAssets = [...savedCustomAssets, ...uploaded];
      pendingCustomAssets = [];
      setJsonField(fields.customAssetsData, savedCustomAssets);
    }
    setJsonField(fields.demoVideoData, savedVideo);
    const data = dataFromForm();

    if (idInput.value) {
      await updateProject(idInput.value, data);
      notify("Project updated successfully.");
    } else {
      await createProject(data, storageOwnerId);
      notify("Project added successfully.");
    }

    await refresh();
    closeForm();
    setStatus("saved");
  } catch (error) {
    console.error(error);
    setStatus("error");
    focusFieldForValidationError(error);
    notify(error.message || "Unable to save project.", "error");
  } finally {
    isSaving = false;
    $("saveProjectButton").disabled = false;
    $("saveProjectButtonText").textContent = idInput.value ? "Update Project" : "Save Project";
  }
});

list.addEventListener("load", (event) => {
  const image = event.target.closest?.("[data-project-cover-image]");
  if (!(image instanceof HTMLImageElement)) return;
  image.classList.add("is-loaded");
  image.closest(".project-card-cover-button")?.querySelector(".project-cover-skeleton")?.classList.add("hidden");
}, true);

list.addEventListener("error", (event) => {
  const image = event.target.closest?.("[data-project-cover-image]");
  if (!(image instanceof HTMLImageElement)) return;
  const wrapper = image.closest(".project-card-cover-button");
  wrapper?.querySelector(".project-cover-skeleton")?.remove();
  wrapper?.querySelectorAll(":scope > [data-admin-media-layer]").forEach((node) => node.remove());
  if (wrapper && !wrapper.querySelector(":scope > .lan-admin-media-frame__fallback")) {
    wrapper.insertAdjacentHTML("afterbegin", adminMediaFallbackMarkup({ context: "Project media", role: "cover" }));
  }
}, true);

list.addEventListener("click", (event) => {
  const previewButton = event.target.closest("[data-preview-id]");
  const editButton = event.target.closest("[data-edit-id]");
  const deleteButton = event.target.closest("[data-delete-id]");

  if (previewButton) {
    const project = projects.find((item) => item.id === previewButton.dataset.previewId);
    if (project) openProjectPreview(project, previewButton);
    return;
  }
  if (editButton) {
    const project = projects.find((item) => item.id === editButton.dataset.editId);
    if (project) openForm(project).catch((error) => {
      console.error("Unable to open project editor:", error);
      notify("Unable to open this project for editing.", "error");
    });
    return;
  }
  if (deleteButton) openDelete(deleteButton.dataset.deleteId, deleteButton);
});

function addOptionalListener(element, eventName, handler) {
  if (element && typeof handler === "function") {
    element.addEventListener(eventName, handler);
  }
}

addOptionalListener(media.coverInput, "change", () => {
  setCoverFromFile(media.coverInput?.files?.[0]);
});

addOptionalListener(media.previewCoverButton, "click", openCoverPreviewModal);
addOptionalListener(media.previewCoverImageButton, "click", openCoverPreviewModal);
addOptionalListener(media.replaceCoverButton, "click", () => media.coverInput?.click());
addOptionalListener(media.closeCoverPreviewModal, "click", closeCoverPreviewModal);
media.coverPreviewImage?.addEventListener("load", () => fitProjectMediaPreviewImage(media.coverPreviewImage));
window.addEventListener("resize", () => {
  if (media.coverPreviewImage?.src) fitProjectMediaPreviewImage(media.coverPreviewImage);
}, { passive: true });

addOptionalListener(media.coverPreviewModal, "click", (event) => {
  if (event.target === media.coverPreviewModal) closeCoverPreviewModal();
});

addOptionalListener(media.logoInput, "change", () => setLogoFromFile(media.logoInput?.files?.[0]));
addOptionalListener(media.removeLogoButton, "click", () => clearLogoPreview({ clearSaved: true, markChanged: true }));
setupDropZone(media.logoZone, (files) => setLogoFromFile(files?.[0]));

addOptionalListener(media.galleryInput, "change", () => {
  addGalleryFiles(media.galleryInput?.files || []);
});

addOptionalListener(media.removeCoverButton, "click", () => {
  clearCoverPreview({ clearSavedValue: true, markChanged: true });
});

addOptionalListener(media.clearGalleryButton, "click", () => {
  clearGalleryPreview({ clearSavedValue: true, markChanged: true });
});

addOptionalListener(media.galleryPreview, "click", (event) => {
  const removeButton = event.target.closest("[data-remove-gallery-index]");
  if (!removeButton) return;
  removeGalleryItem(Number(removeButton.dataset.removeGalleryIndex));
});

setupDropZone(media.coverZone, (files) => setCoverFromFile(files?.[0]));
setupDropZone(media.galleryZone, addGalleryFiles);
addOptionalListener(media.videoInput, "change", () => setVideoFromFile(media.videoInput?.files?.[0]));
addOptionalListener(media.videoUploadTab, "click", () => setVideoSource("upload"));
addOptionalListener(media.videoYoutubeTab, "click", () => setVideoSource("youtube"));
addOptionalListener(fields.youtubeUrl, "input", () => {
  setVideoSource("external");
  renderVideoPreview();
  markAsChanged();
});
addOptionalListener(media.replaceVideoButton, "click", () => {
  if ((fields.videoType?.value || "upload") === "external") {
    clearVideo({ markChanged: false });
    setVideoSource("external");
    fields.youtubeUrl?.focus();
  } else {
    media.videoInput?.click();
  }
});
addOptionalListener(media.removeVideoButton, "click", () => clearVideo());
setupDropZone(media.videoZone, (files) => setVideoFromFile(files?.[0]));
document.querySelectorAll("[data-project-type]").forEach((option) => {
  addOptionalListener(option, "click", () => {
    if (fields.projectType) fields.projectType.value = option.dataset.projectType || "standalone";
    const linked = activeProjectType() === "linked-module";
    setPrimaryCtaLabel(linked ? suggestedModuleCta(getPortfolioModule(fields.linkedModule?.value)) : "View Project", { auto: true });
    if (!linked && fields.actionType) fields.actionType.value = "project-preview";
    updateProjectTypeUI();
    markAsChanged();
  });
});
addOptionalListener(fields.projectType, "change", () => {
  const linked = activeProjectType() === "linked-module";
  setPrimaryCtaLabel(linked ? suggestedModuleCta(getPortfolioModule(fields.linkedModule?.value)) : "View Project", { auto: true });
  if (!linked && fields.actionType) fields.actionType.value = "project-preview";
  updateProjectTypeUI();
  markAsChanged();
});
addOptionalListener(fields.linkedModule, "change", async () => {
  const module = getPortfolioModule(fields.linkedModule?.value);
  if (fields.linkedDestination) fields.linkedDestination.value = module?.publicDestination || "";
  const currentLabel = primaryCtaLabel();
  const previousAutoLabel = fields.buttonLabel?.dataset.linkedAutoValue || "";
  if (!currentLabel || currentLabel === previousAutoLabel) {
    setPrimaryCtaLabel(suggestedModuleCta(module), { auto: true });
  }
  if (fields.linkedDocumentId) fields.linkedDocumentId.value = "";
  if (fields.linkedScope) fields.linkedScope.value = linkedModuleScope(fields.linkedModule?.value);
  setJsonField(fields.linkedSourceSnapshot, null);
  await loadLinkedSourceEntries(fields.linkedModule?.value || "");
  updateProjectTypeUI();
  updateDestinationUI();
  markAsChanged();
});
addOptionalListener(fields.linkedDocumentId, "change", () => {
  const entries = linkedSourceCache.get(fields.linkedModule?.value || "") || [];
  const entry = entries.find((item) => item.id === fields.linkedDocumentId?.value);
  if (entry) applyLinkedSource(entry); else { renderLinkedSourcePreview(); linkedSourceElements.success?.classList.add("hidden"); }
  markAsChanged();
});
addOptionalListener(linkedActionElements.addButton, "click", () => {
  linkedActions.push(normalizeLinkedActionState({ kind: "resource", resourceType: "", label: "", labelAuto: true }, linkedActions.length));
  renderLinkedActions();
  renderActionIntelligence();
  markAsChanged();
  linkedActionElements.list?.querySelector(`[data-linked-action-id="${CSS.escape(linkedActions.at(-1).clientId)}"] [data-project-action-kind]`)?.focus();
});
addOptionalListener(linkedActionElements.list, "click", (event) => {
  const tabButton = event.target.closest("[data-action-open-tab]");
  if (tabButton) {
    document.querySelector(`[data-lan-tab="${CSS.escape(tabButton.dataset.actionOpenTab || "details")}"]`)?.click();
    return;
  }
  const removeButton = event.target.closest("[data-remove-linked-action]");
  if (!removeButton) return;
  linkedActions = linkedActions.filter((action) => action.clientId !== removeButton.dataset.removeLinkedAction);
  renderLinkedActions();
  renderActionIntelligence();
  markAsChanged();
});
addOptionalListener(linkedActionElements.list, "input", (event) => {
  if (!event.target.matches("[data-linked-action-custom-label]")) return;
  const row = event.target.closest("[data-linked-action-id]");
  const action = linkedActions.find((item) => item.clientId === row?.dataset.linkedActionId);
  if (!action) return;
  action.label = event.target.value.trim();
  action.labelAuto = false;
  row?.querySelector("header strong")?.replaceChildren(document.createTextNode(action.label || "Linked action"));
  markAsChanged();
});

addOptionalListener(linkedActionElements.list, "change", async (event) => {
  const row = event.target.closest("[data-linked-action-id]");
  if (!row) return;
  const action = linkedActions.find((item) => item.clientId === row.dataset.linkedActionId);
  if (!action) return;

  if (event.target.matches("[data-project-action-kind]")) {
    action.kind = event.target.value === "linked" ? "linked" : "resource";
    if (action.kind === "resource") {
      action.resourceType = action.resourceType || "demo-video";
      action.moduleKey = ""; action.documentId = ""; action.destination = ""; action.titleSnapshot = "";
      if (action.labelAuto || !action.label) action.label = resourceDefaultLabel(action.resourceType);
    } else {
      action.resourceType = "";
      action.label = "View Details";
      action.labelAuto = true;
    }
    renderLinkedActions();
    renderActionIntelligence();
    markAsChanged();
    return;
  }

  if (event.target.matches("[data-project-action-resource]")) {
    action.kind = "resource";
    action.resourceType = String(event.target.value || "project-preview");
    action.resourceIndex = 0;
    if (action.labelAuto || !action.label) {
      action.label = resourceDefaultLabel(action.resourceType);
      action.labelAuto = true;
    }
    renderLinkedActions();
    renderActionIntelligence();
    markAsChanged();
    return;
  }

  if (event.target.matches("[data-project-action-resource-item]")) {
    action.resourceIndex = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
    renderLinkedActions();
    markAsChanged();
    return;
  }

  if (event.target.matches("[data-linked-action-module]")) {
    action.kind = "linked";
    const module = getPortfolioModule(event.target.value);
    action.moduleKey = module?.key || String(event.target.value || "").trim();
    action.documentId = "";
    action.titleSnapshot = "";
    action.destination = module?.publicDestination || "";
    if (!action.label || action.labelAuto) {
      action.label = suggestedModuleCta(module);
      action.labelAuto = true;
    }
    renderLinkedActions();
    if (action.moduleKey) {
      try {
        await ensureLinkedActionEntries(action);
      } catch (error) {
        console.warn("Unable to load additional linked button entries:", error);
        linkedSourceCache.set(action.moduleKey, []);
      }
      renderLinkedActions();
    }
    markAsChanged();
    return;
  }

  if (event.target.matches("[data-linked-action-entry]")) {
    action.documentId = String(event.target.value || "").trim();
    const entry = (linkedSourceCache.get(action.moduleKey) || []).find((item) => item.id === action.documentId);
    action.titleSnapshot = entry?.title || "";
    renderLinkedActions();
    markAsChanged();
    return;
  }

  if (event.target.matches("[data-linked-action-label]")) {
    const custom = event.target.value === "__custom__";
    const customInput = row.querySelector("[data-linked-action-custom-label]");
    if (customInput) {
      customInput.classList.toggle("hidden", !custom);
      customInput.required = custom;
      if (custom) customInput.focus();
    }
    action.label = custom ? String(customInput?.value || "").trim() : event.target.value;
    action.labelAuto = false;
    row.querySelector("header strong")?.replaceChildren(document.createTextNode(action.label || "Linked action"));
    markAsChanged();
  }
});
addOptionalListener(linkedActionElements.list, "input", (event) => {
  if (!event.target.matches("[data-linked-action-custom-label]")) return;
  const row = event.target.closest("[data-linked-action-id]");
  const action = linkedActions.find((item) => item.clientId === row?.dataset.linkedActionId);
  if (!action) return;
  action.label = event.target.value.trim();
  action.labelAuto = false;
  row?.querySelector("header strong")?.replaceChildren(document.createTextNode(action.label || "Linked action"));
  markAsChanged();
});
addOptionalListener(fields.actionType, "change", () => { updateDestinationUI(); markAsChanged(); });
addOptionalListener(fields.buttonLabel, "change", () => {
  const custom = fields.buttonLabel?.value === "__custom__";
  if (fields.buttonCustomLabel) {
    fields.buttonCustomLabel.classList.toggle("hidden", !custom);
    fields.buttonCustomLabel.required = custom;
    if (custom) fields.buttonCustomLabel.focus();
  }
  fields.buttonLabel.dataset.linkedAutoValue = "";
  if (activeProjectType() === "standalone" && !custom && fields.actionType) {
    fields.actionType.value = standaloneActionTypeForLabel(primaryCtaLabel(), fields.actionType.value);
  }
  ensureActionResourceProfile(primaryCtaLabel());
  updateDestinationUI();
  renderActionIntelligence();
  if (selectedLinkedSource) renderLinkedSourcePreview(selectedLinkedSource);
  markAsChanged();
});
addOptionalListener(fields.buttonCustomLabel, "input", () => {
  fields.buttonLabel.dataset.linkedResolvedLabel = primaryCtaLabel();
  updateDestinationUI();
  renderActionIntelligence();
  if (selectedLinkedSource) renderLinkedSourcePreview(selectedLinkedSource);
  markAsChanged();
});
addOptionalListener(fields.destination, "input", updateDestinationUI);
addOptionalListener(fields.mediaType, "change", () => {
  updateMediaTypeUI();
  renderActionIntelligence();
  markAsChanged();
});
const optionalMediaControls = $("projectOptionalMediaControls");
addOptionalListener(optionalMediaControls, "click", (event) => {
  const button = event.target.closest("[data-toggle-project-media]");
  if (!button) return;
  const key = button.dataset.toggleProjectMedia || "";
  if (!["logo", "screenshots", "demo-video"].includes(key)) return;
  if (key === "demo-video" && actionUsageMap().has("demo-video")) return;
  if (enabledCustomMediaAssets.has(key)) enabledCustomMediaAssets.delete(key); else enabledCustomMediaAssets.add(key);
  if (fields.mediaType) fields.mediaType.value = "custom-assets";
  syncEnabledMediaAssetsField();
  updateMediaTypeUI();
  markAsChanged();
});

addOptionalListener(media.customAssetSelector, "change", (event) => {
  const input = event.target.closest("[data-custom-media-asset]");
  if (!(input instanceof HTMLInputElement)) return;
  const key = input.dataset.customMediaAsset || "";
  if (!CUSTOM_MEDIA_ASSET_KEYS.includes(key)) return;
  if (input.checked) enabledCustomMediaAssets.add(key); else enabledCustomMediaAssets.delete(key);
  syncEnabledMediaAssetsField();
  updateMediaTypeUI();
  markAsChanged();
});
createMediaUploadComponent({ input: media.pdfInput, zone: media.pdfZone, kind: "pdf", onSelect: setPdfFile });
createMediaUploadComponent({ input: media.sourceInput, zone: media.sourceZone, kind: "source", multiple: true, onSelect: setSourceFiles });
createMediaUploadComponent({ input: media.customInput, zone: media.customZone, kind: "asset", multiple: true, onSelect: setCustomAssets });

const primaryActionTargetEditor = $("projectPrimaryActionTargetEditor");
addOptionalListener(primaryActionTargetEditor, "click", (event) => {
  const tabButton = event.target.closest("[data-action-open-tab]");
  if (tabButton) document.querySelector(`[data-lan-tab="${CSS.escape(tabButton.dataset.actionOpenTab || "details")}"]`)?.click();
});

[fields.githubUrl, fields.liveUrl, fields.youtubeUrl].forEach((control) => addOptionalListener(control, "input", () => { renderResourceStatus(); renderActionIntelligence(); renderLinkedActions(); }));
addOptionalListener(fields.githubSecondaryEnabled, "change", () => { updateGithubSecondaryActionUI(); renderResourceStatus(); renderActionIntelligence(); renderLinkedActions(); });


[media.videoInput, media.pdfInput, media.sourceInput, media.customInput, media.coverInput].forEach((control) => addOptionalListener(control, "change", () => window.setTimeout(renderActionIntelligence, 0)));

initProjectCapabilityPickers();
addOptionalListener(linkedSourceElements.suggestedSkills, "click", (event) => {
  const button = event.target.closest("[data-project-suggested-skill]");
  if (!button) return;
  const id = String(button.dataset.projectSuggestedSkill || "");
  if (!id) return;
  setSelectedSkillIds([...selectedSkillIds, id]);
  markAsChanged();
});

$("cancelProjectButton").addEventListener("click", closeForm);
$("closeProjectFormButton").addEventListener("click", closeForm);
$("deleteProjectButton").addEventListener("click", (event) => openDelete(idInput.value, event.currentTarget));
$("cancelDeleteButton").addEventListener("click", closeDelete);
$("confirmDeleteButton").addEventListener("click", confirmDelete);

$("deleteConfirmationModal").addEventListener("click", (event) => {
  if (event.target === $("deleteConfirmationModal")) closeDelete();
});

projectPreview.closeButton?.addEventListener("click", closeProjectPreview);
projectPreview.modal?.addEventListener("click", (event) => {
  if (event.target === projectPreview.modal) closeProjectPreview();
});
addOptionalListener(fields.category, "change", updateProjectCustomCategoryVisibility);

$("projectSearch").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
fields.shortDescription.addEventListener("input", updateCounts);
fields.description.addEventListener("input", updateCounts);


document.querySelectorAll("[data-project-public-tag-mode]").forEach((button) => {
  button.addEventListener("click", () => setProjectPublicTagMode(button.dataset.projectPublicTagMode || "automatic"));
});



try {
  await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin shell session bridge did not initialize.")));
  await refreshPortfolioModuleRegistry();
  renderLinkedModuleOptions();
  applyMediaSettingsToInputs();
  resetForm();
  await Promise.all([loadSkillsLibrary(), refresh()]);
} catch (error) {
  console.error("Admin workspace session could not be consumed:", error);
  setStatus("error");
  notify("Administrator session could not be verified.", "error");
}

window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedChanges && !form.classList.contains("hidden")) {
    event.preventDefault();
    event.returnValue = "";
  }
});


const MODAL_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function visibleProjectModal() {
  return [media.coverPreviewModal, projectPreview.modal, $("deleteConfirmationModal")]
    .find((modal) => modal && !modal.classList.contains("hidden")) || null;
}

function trapProjectModalFocus(event) {
  if (event.key !== "Tab") return false;
  const modal = visibleProjectModal();
  if (!modal) return false;
  const controls = [...modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)]
    .filter((element) => element.getClientRects().length > 0);
  if (!controls.length) {
    event.preventDefault();
    return true;
  }
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

document.addEventListener("keydown", (event) => {
  if (trapProjectModalFocus(event)) return;
  if (event.key !== "Escape") return;

  const activeModal = visibleProjectModal();
  if (activeModal === media.coverPreviewModal) {
    closeCoverPreviewModal();
  } else if (activeModal === projectPreview.modal) {
    closeProjectPreview();
  } else if (activeModal === $("deleteConfirmationModal")) {
    closeDelete();
  } else {
    projectSkillPicker?.close();
    projectToolPicker?.close();
  }
});
