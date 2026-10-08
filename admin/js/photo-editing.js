import { getMediaSettings } from "../services/storageUploadService.js";

import {
  createPhotoEditingCategory,
  createPhotoEditingProject,
  deletePhotoEditingCategory,
  getPhotoEditingCategoryManagerData,
  getPhotoEditingCapabilityProfile,
  listPhotoEditingProjects,
  removePhotoEditingProject,
  renamePhotoEditingCategory,
  reorderPhotoEditingCategories,
  savePhotoEditingCapabilityProfile,
  updateManyPhotoEditingProjects,
  updatePhotoEditingProject,
  uploadPhotoEditingImage
} from "../services/photoEditingService.js";
import { discardTemporaryMediaAssets } from "../services/mediaAssetLifecycleService.js";
import { ADMIN_PREVIEW_BLOCK_TYPES, initializePreviewComparison, renderAdminPreview } from "./admin-preview.js";
import { applyRecordLibraryView, DEFAULT_RECORD_LIBRARY_PAGE_SIZE, recordLibraryPageCount, recordLibraryPageSlice } from "./admin-record-library.js";
import { mountAdminMediaCardComparison, mountAdminMediaCardGallery, mountAdminMediaFrame, resolveAdminMediaAssetUrl } from "./admin-media-frame.js";
import { normalizeAssetReference, hasAssetReference, assetReferenceIdentity } from "../../asset-resolver.js";

/* =========================================================
   LΛN PORTFOLIO CMS
   Photo Editing Administration Controller

   Architecture:
   - Firebase Authentication protects the admin page.
   - Cloud Firestore stores project metadata.
   - Storage Hub stores uploaded images through the selected provider.
   - Project deletion is a Firestore soft delete.
   - Provider-aware deletion is authorized server-side through the shared media lifecycle.
   ========================================================= */

const PAGE_SIZE = DEFAULT_RECORD_LIBRARY_PAGE_SIZE;
const DEFAULT_CATEGORY = "Portrait Retouching";

const REDUNDANT_MODULE_CATEGORY = "photo-editing";

function isPhotoEditingPortfolioGateway(project = {}) {
  if (project?.isPortfolioGateway === true || project?.showInPublicGallery === false) return true;
  const categoryKey = capabilityCategoryKey(project?.category || project?.projectCategory || project?.type);
  const titleKey = capabilityCategoryKey(project?.title || project?.projectTitle || project?.name);
  return categoryKey === REDUNDANT_MODULE_CATEGORY && (titleKey === "photo-editing-portfolio" || titleKey === "photo-editing");
}

const DEFAULT_STATUS = "draft";
const IMAGE_KINDS = ["before", "after"];
const DISPLAY_TYPES = {
  COMPARISON: "comparison",
  SINGLE: "single",
  GALLERY: "gallery"
};
const MAX_GALLERY_IMAGES = 30;
const CUSTOM_TECHNIQUE_STORAGE_KEY = "lanPhotoEditingCustomSkillsV1";
const MODAL_FOCUS_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const $ = id => document.getElementById(id);

const elements = {
  addSampleButton: $("addSampleButton"),
  capabilityProfileButton: $("photoCapabilityProfileButton"),
  categoryManagerButton: $("managePhotoCategoriesButton"),
  categoryManagerModal: $("photoCategoryManagerModal"),
  closeCategoryManager: $("closePhotoCategoryManager"),
  categoryManagerList: $("photoCategoryManagerList"),
  newCategoryName: $("newPhotoCategoryName"),
  addCategoryManagerButton: $("addPhotoCategoryManagerButton"),
  categoryReassignPanel: $("photoCategoryReassignPanel"),
  categoryReassignMessage: $("photoCategoryReassignMessage"),
  categoryReassignTarget: $("photoCategoryReassignTarget"),
  confirmCategoryReassign: $("confirmPhotoCategoryReassign"),
  cancelCategoryReassign: $("cancelPhotoCategoryReassign"),
  capabilityProfileInlineButton: $("editPhotoCapabilityProfileInline"),
  capabilityProfileModal: $("photoCapabilityProfileModal"),
  closeCapabilityProfile: $("closePhotoCapabilityProfile"),
  cancelCapabilityProfile: $("cancelPhotoCapabilityProfile"),
  saveCapabilityProfile: $("savePhotoCapabilityProfile"),
  profileCategory: $("photoProfileCategory"),
  profileCategorySkills: $("photoProfileCategorySkills"),
  profileCategoryTools: $("photoProfileCategoryTools"),
  inheritedCapabilities: $("photoInheritedCapabilities"),
  newPhotoButton: $("newPhotoButton"),
  emptyAddButton: $("emptyAddButton"),
  refreshSamples: $("refreshSamples"),
  photoLibrary: $("photoLibrary"),
  photoCardTemplate: $("photoCardTemplate"),
  emptyState: $("emptyState"),
  searchInput: $("searchInput"),
  categoryFilter: $("categoryFilter"),
  statusFilter: $("statusFilter"),
  sortBy: $("sortBy"),
  previousPage: $("previousPage"),
  nextPage: $("nextPage"),
  gridView: $("gridView"),
  listView: $("listView"),
  sampleModal: $("sampleModal"),
  sampleModalTitle: $("sampleModalTitle"),
  sampleForm: $("sampleForm"),
  closeModalButton: $("closeModal"),
  cancelButton: $("cancelButton"),
  previewModal: $("previewModal"),
  previewModalTitle: $("previewModalTitle"),
  previewModalContext: $("previewModalContext"),
  previewBody: $("photoPreviewBody"),
  closePreview: $("closePreview"),
  deleteModal: $("deleteModal"),
  deleteModalTitle: $("deleteModalTitle"),
  cancelDelete: $("cancelDelete"),
  confirmDelete: $("confirmDelete"),
  loadingScreen: $("loadingScreen"),
  toast: $("toast"),
  toastMessage: $("toastMessage"),
  toastIcon: $("toastIcon"),
  editorPanel: document.querySelector(".photo-editing-admin .editor-panel"),
  comparisonContainer: $("comparisonContainer"),
  comparisonSlider: $("comparisonSlider"),
  comparisonBefore: $("comparisonBefore"),
  comparisonAfter: $("comparisonAfter"),
  comparisonEmptyMessage: $("comparisonEmptyMessage"),
  comparisonRevealLayer: $("comparisonRevealLayer"),
  projectDisplayType: $("projectDisplayType"),
  displayTypeCards: $("displayTypeCards"),
  customCategoryGroup: $("customCategoryGroup"),
  createCategoryButton: $("createPhotoCategoryButton"),
  customTechniqueGroup: $("customTechniqueGroup"),
  photoSkillsSelector: $("photoSkillsSelector"),
  softwareSelector: $("softwareSelector"),
  techniquesSelector: $("techniquesSelector"),
  beforeImageSection: $("beforeImageSection"),
  afterImageSection: $("afterImageSection"),
  comparisonPreviewSection: $("comparisonPreviewSection"),
  galleryImagesSection: $("galleryImagesSection"),
  galleryImages: $("galleryImages"),
  galleryUploadZone: $("galleryUploadZone"),
  galleryImageGrid: $("galleryImageGrid"),
  galleryEmptyState: $("galleryEmptyState"),
  galleryImageCount: $("galleryImageCount"),
  galleryUploadStatus: $("galleryUploadStatus"),
  galleryProgress: $("galleryProgress"),
  uploadGalleryButton: $("uploadGalleryButton"),
  addGalleryImagesButton: $("addGalleryImagesButton"),
  clearGalleryButton: $("clearGalleryButton"),
  uploadLimitModal: $("uploadLimitModal"),
  uploadLimitMaximum: $("uploadLimitMaximum"),
  uploadLimitSelected: $("uploadLimitSelected"),
  uploadLimitExceeded: $("uploadLimitExceeded"),
  chooseAnotherImageButton: $("chooseAnotherImageButton"),
  closeUploadLimitModal: $("closeUploadLimitModal")
};

let photoRecordSelection = null;

const fields = {
  id: $("sampleId"),
  title: $("sampleTitle"),
  slug: $("projectSlug"),
  category: $("sampleCategory"),
  customCategory: $("customCategory"),
  customTechnique: $("customTechnique"),
  skillIds: $("photoSkillIds"),
  toolIds: $("photoToolIds"),
  inheritCapabilityProfile: $("inheritPhotoCapabilityProfile"),
  order: $("displayOrder"),
  status: $("projectStatus"),
  short: $("shortDescription"),
  description: $("fullDescription"),
  seoTitle: $("seoTitle"),
  seoDescription: $("seoDescription"),
  seoKeywords: $("seoKeywords"),
  featured: $("featuredProject"),
  comparison: $("showComparison"),
  fullscreen: $("allowFullscreen"),
  publish: $("publishImmediately"),
  beforeUrl: $("beforeImageUrl"),
  afterUrl: $("afterImageUrl"),
  beforePath: $("beforeStoragePath"),
  afterPath: $("afterStoragePath"),
  displayType: $("projectDisplayType"),
  singleImageUrl: $("singleImageUrl"),
  galleryImagesData: $("galleryImagesData")
};

const state = {
  projects: [],
  filteredProjects: [],
  currentPage: 1,
  view: "grid",
  pendingDeleteId: "",
  selectedIds: new Set(),
  files: {
    before: null,
    after: null
  },
  objectUrls: {
    before: "",
    after: ""
  },
  media: {
    before: emptyMedia(),
    after: emptyMedia()
  },
  galleryFiles: [],
  galleryObjectUrls: [],
  galleryMedia: [],
  formDirty: false,
  saving: false,
  loadingProjects: false,
  activeModal: null,
  previouslyFocusedElement: null,
  initialized: false,
  uploadLimitInput: null,
  previewSliderCleanup: null,
  panelLoadingTimer: 0
};

let photoCapabilityLibrary = [];
let selectedPhotoSkillIds = [];
let selectedPhotoToolIds = [];
let photoCapabilityLoadPromise = null;
let photoCapabilityProfile = { version: 2, categories: [], categoryProfiles: [], legacyModuleSkillIds: [], legacyModuleToolIds: [] };
let photoCategoryManagerData = [];
let pendingPhotoCategoryDelete = null;
let photoCapabilityProfileDraft = null;
const photoCapabilityPickers = new Map();

function emptyMedia() {
  return {
    url: "",
    secureUrl: "",
    publicId: "",
    assetId: "",
    provider: "",
    storageProfileId: "",
    previewUrl: "",
    downloadUrl: "",
    resourceType: "image",
    type: "upload",
    format: "",
    width: 0,
    height: 0,
    bytes: 0,
    version: 0,
    folder: "",
    displayName: "",
    originalFilename: "",
    uploadedAt: ""
  };
}

function normalizeMedia(media = {}) {
  const reference = normalizeAssetReference(media);
  if (reference && typeof reference === "object") return { ...emptyMedia(), ...reference };
  if (typeof reference === "string" && (typeof media !== "object" || !media || Array.isArray(media))) {
    const url = reference.trim();
    return url
      ? { ...emptyMedia(), url, secureUrl: url }
      : emptyMedia();
  }

  if (!media || typeof media !== "object") {
    return emptyMedia();
  }

  const url = String(
    (typeof reference === "string" ? reference : "") || media.url || media.secureUrl || media.secure_url || ""
  ).trim();

  return {
    url,
    secureUrl: String(
      media.secureUrl || media.secure_url || url
    ).trim(),
    publicId: String(
      media.publicId || media.public_id || media.path || ""
    ).trim(),
    assetId: String(media.assetId || media.asset_id || "").trim(),
    provider: String(media.provider || media.storageProvider || "").trim(),
    storageProfileId: String(media.storageProfileId || media.storage_profile_id || "").trim(),
    previewUrl: String(media.previewUrl || media.preview_url || "").trim(),
    downloadUrl: String(media.downloadUrl || media.download_url || "").trim(),
    resourceType: String(
      media.resourceType || media.resource_type || "image"
    ).trim(),
    type: String(media.type || "upload").trim(),
    format: String(media.format || "").trim(),
    width: Math.max(0, Number(media.width) || 0),
    height: Math.max(0, Number(media.height) || 0),
    bytes: Math.max(0, Number(media.bytes) || 0),
    version: Math.max(0, Number(media.version) || 0),
    folder: String(media.folder || media.asset_folder || "").trim(),
    displayName: String(
      media.displayName || media.display_name || ""
    ).trim(),
    originalFilename: String(
      media.originalFilename || media.original_filename || ""
    ).trim(),
    uploadedAt: String(
      media.uploadedAt || media.created_at || ""
    ).trim()
  };
}


function isCreateCategoryOption(value) {
  return String(value || "").trim() === "__create__";
}

function normalizePhotoCategoryLabel(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function registeredPhotoCategories() {
  const values = new Map();
  const add = (value) => {
    const label = normalizePhotoCategoryLabel(value);
    const key = capabilityCategoryKey(label);
    if (label && key && key !== "other" && key !== REDUNDANT_MODULE_CATEGORY && !values.has(key)) values.set(key, label);
  };
  (photoCapabilityProfile.categories || []).forEach(add);
  state.projects.forEach((project) => add(project?.category));
  return [...values.values()];
}

function renderSampleCategoryOptions(preferred = "") {
  if (!fields.category) return;
  const current = normalizePhotoCategoryLabel(preferred || fields.category.value || DEFAULT_CATEGORY);
  const categories = registeredPhotoCategories();
  fields.category.replaceChildren(
    ...categories.map((category) => new Option(category, category)),
    new Option("+ Create new category", "__create__")
  );
  const match = categories.find((category) => capabilityCategoryKey(category) === capabilityCategoryKey(current));
  fields.category.value = match || (isCreateCategoryOption(current) ? "__create__" : (categories.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : categories[0] || "__create__"));
}

function updateCustomCategoryUI() {
  const creating = isCreateCategoryOption(fields.category?.value);
  elements.customCategoryGroup?.classList.toggle("hidden", !creating);
  if (fields.customCategory) {
    fields.customCategory.required = creating;
    fields.customCategory.disabled = !creating;
    if (!creating) fields.customCategory.value = "";
  }
}

function resolvedCategoryValue() {
  return isCreateCategoryOption(fields.category?.value)
    ? normalizePhotoCategoryLabel(fields.customCategory?.value)
    : normalizePhotoCategoryLabel(fields.category?.value);
}

async function persistNewPhotoCategory(label = fields.customCategory?.value) {
  const category = normalizePhotoCategoryLabel(label);
  if (!category) throw new Error("Enter a category name first.");
  const categories = await createPhotoEditingCategory(category);
  photoCapabilityProfile = normalizePhotoCapabilityProfile({ ...photoCapabilityProfile, categories });
  if (photoCapabilityProfileDraft) photoCapabilityProfileDraft = normalizePhotoCapabilityProfile({ ...photoCapabilityProfileDraft, categories });
  renderSampleCategoryOptions(category);
  updateCustomCategoryUI();
  renderCapabilityProfileEditor();
  return category;
}


function photoCategoryUsageLabel(count = 0) {
  const value = Number(count) || 0;
  return `${value} sample${value === 1 ? "" : "s"}`;
}

function renderPhotoCategoryManager() {
  const host = elements.categoryManagerList;
  if (!host) return;
  if (!photoCategoryManagerData.length) {
    host.innerHTML = '<div class="photo-category-manager-empty"><strong>No categories yet</strong><span>Add a category to organize Photo Editing samples.</span></div>';
    return;
  }
  host.innerHTML = photoCategoryManagerData.map((item, index) => `<article class="photo-category-manager-row" data-photo-category-row="${escapeHtml(item.category)}">
    <div class="photo-category-manager-order" aria-label="Reorder ${escapeHtml(item.category)}"><button class="photo-category-order-button editor-icon-button button-icon-compact" aria-label="Move ${escapeHtml(item.category)} up" title="Move up" data-category-move="up" type="button"${index === 0 ? " disabled" : ""}>↑</button><button class="photo-category-order-button editor-icon-button button-icon-compact" aria-label="Move ${escapeHtml(item.category)} down" title="Move down" data-category-move="down" type="button"${index === photoCategoryManagerData.length - 1 ? " disabled" : ""}>↓</button></div>
    <div class="photo-category-manager-main"><div class="photo-category-manager-name-row"><strong class="photo-category-manager-name">${escapeHtml(item.category)}</strong><span class="photo-category-usage">${photoCategoryUsageLabel(item.usageCount)}</span></div><div class="photo-category-manager-edit"><input data-category-name aria-label="Category name" maxlength="60" value="${escapeHtml(item.category)}"><button class="editor-primary-button button-compact" data-category-save type="button">Save</button><button class="editor-secondary-button button-compact" data-category-cancel type="button">Cancel</button></div></div>
    <div class="photo-category-manager-actions"><button class="editor-secondary-button button-compact" data-category-edit type="button">Rename</button><button class="editor-danger-button button-compact" data-category-delete type="button">Delete</button></div>
  </article>`).join("");
}

function startManagedPhotoCategoryEdit(row) {
  if (!row) return;
  row.classList.add("is-editing");
  const input = row.querySelector("[data-category-name]");
  if (input) {
    input.value = normalizePhotoCategoryLabel(row.dataset.photoCategoryRow);
    input.focus();
    input.select();
  }
}

function cancelManagedPhotoCategoryEdit(row) {
  if (!row) return;
  row.classList.remove("is-editing");
  const input = row.querySelector("[data-category-name]");
  if (input) input.value = normalizePhotoCategoryLabel(row.dataset.photoCategoryRow);
}

async function refreshPhotoCategoryConsumers(preferred = "") {
  photoCapabilityProfile = normalizePhotoCapabilityProfile(await getPhotoEditingCapabilityProfile());
  if (photoCapabilityProfileDraft) photoCapabilityProfileDraft = normalizePhotoCapabilityProfile(photoCapabilityProfile);
  renderSampleCategoryOptions(preferred);
  refreshLibraryCategoryFilter();
  renderCapabilityProfileEditor();
  renderInheritedPhotoCapabilities();
}

async function loadPhotoCategoryManager() {
  const data = await getPhotoEditingCategoryManagerData();
  photoCategoryManagerData = Array.isArray(data?.categories) ? data.categories : [];
  renderPhotoCategoryManager();
  return photoCategoryManagerData;
}

async function openPhotoCategoryManager() {
  try {
    pendingPhotoCategoryDelete = null;
    elements.categoryReassignPanel?.classList.add("hidden");
    await loadPhotoCategoryManager();
    openModal(elements.categoryManagerModal, elements.newCategoryName);
  } catch (error) {
    console.error("Unable to open Photo Editing category manager:", error);
    showToast(error.message || "Unable to load categories.", "error");
  }
}

async function addManagedPhotoCategory() {
  const label = normalizePhotoCategoryLabel(elements.newCategoryName?.value);
  if (!label) return showToast("Enter a category name first.", "error");
  try {
    elements.addCategoryManagerButton.disabled = true;
    await createPhotoEditingCategory(label);
    if (elements.newCategoryName) elements.newCategoryName.value = "";
    await refreshPhotoCategoryConsumers(label);
    await loadPhotoCategoryManager();
    showToast(`Category “${label}” created.`, "success");
  } catch (error) {
    showToast(error.message || "The category could not be created.", "error");
  } finally {
    elements.addCategoryManagerButton.disabled = false;
  }
}

async function renameManagedPhotoCategory(row) {
  const current = normalizePhotoCategoryLabel(row?.dataset.photoCategoryRow);
  const next = normalizePhotoCategoryLabel(row?.querySelector("[data-category-name]")?.value);
  if (!current || !next) return showToast("Enter a valid category name.", "error");
  if (capabilityCategoryKey(current) === capabilityCategoryKey(next)) return cancelManagedPhotoCategoryEdit(row);
  try {
    await renamePhotoEditingCategory(current, next);
    state.projects = state.projects.map((project) => capabilityCategoryKey(project.category) === capabilityCategoryKey(current) ? { ...project, category: next } : project);
    await refreshPhotoCategoryConsumers(next);
    await loadPhotoCategoryManager();
    showToast(`Category renamed to “${next}”.`, "success");
  } catch (error) {
    showToast(error.message || "The category could not be renamed.", "error");
  }
}

async function moveManagedPhotoCategory(row, direction) {
  const current = normalizePhotoCategoryLabel(row?.dataset.photoCategoryRow);
  const index = photoCategoryManagerData.findIndex((item) => capabilityCategoryKey(item.category) === capabilityCategoryKey(current));
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= photoCategoryManagerData.length) return;
  const ordered = photoCategoryManagerData.map((item) => item.category);
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  try {
    const data = await reorderPhotoEditingCategories(ordered);
    photoCategoryManagerData = data.categories || [];
    await refreshPhotoCategoryConsumers();
    renderPhotoCategoryManager();
  } catch (error) {
    showToast(error.message || "The categories could not be reordered.", "error");
  }
}

async function requestManagedPhotoCategoryDelete(row) {
  const category = normalizePhotoCategoryLabel(row?.dataset.photoCategoryRow);
  const item = photoCategoryManagerData.find((entry) => capabilityCategoryKey(entry.category) === capabilityCategoryKey(category));
  if (!item) return;
  if (!item.usageCount) {
    const allowed = await (window.LANConfirm?.({ title:"Delete category?", message:`Delete “${category}”? It is not used by any samples.`, confirmLabel:"Delete", danger:true }) ?? Promise.resolve(confirm(`Delete “${category}”?`)));
    if (!allowed) return;
    try {
      await deletePhotoEditingCategory(category);
      await refreshPhotoCategoryConsumers();
      await loadPhotoCategoryManager();
      showToast(`Category “${category}” deleted.`, "success");
    } catch (error) {
      showToast(error.message || "The category could not be deleted.", "error");
    }
    return;
  }
  pendingPhotoCategoryDelete = item;
  if (elements.categoryReassignMessage) elements.categoryReassignMessage.textContent = `“${category}” is used by ${photoCategoryUsageLabel(item.usageCount)}. Choose where those samples should move.`;
  if (elements.categoryReassignTarget) {
    elements.categoryReassignTarget.innerHTML = photoCategoryManagerData.filter((entry) => capabilityCategoryKey(entry.category) !== capabilityCategoryKey(category)).map((entry) => `<option value="${escapeHtml(entry.category)}">${escapeHtml(entry.category)}</option>`).join("");
  }
  elements.categoryReassignPanel?.classList.remove("hidden");
  elements.categoryReassignTarget?.focus();
}

async function confirmManagedPhotoCategoryDelete() {
  if (!pendingPhotoCategoryDelete) return;
  const replacement = normalizePhotoCategoryLabel(elements.categoryReassignTarget?.value);
  if (!replacement) return showToast("Choose a replacement category.", "error");
  try {
    elements.confirmCategoryReassign.disabled = true;
    await deletePhotoEditingCategory(pendingPhotoCategoryDelete.category, { reassignTo: replacement });
    const removed = pendingPhotoCategoryDelete.category;
    state.projects = state.projects.map((project) => capabilityCategoryKey(project.category) === capabilityCategoryKey(removed) ? { ...project, category: replacement } : project);
    pendingPhotoCategoryDelete = null;
    elements.categoryReassignPanel?.classList.add("hidden");
    await refreshPhotoCategoryConsumers(replacement);
    await loadPhotoCategoryManager();
    showToast(`“${removed}” deleted and its samples moved to “${replacement}”.`, "success");
  } catch (error) {
    showToast(error.message || "The category could not be deleted.", "error");
  } finally {
    elements.confirmCategoryReassign.disabled = false;
  }
}

function syncDisplayTypeCards() {
  const value = normalizeDisplayType(fields.displayType?.value);

  elements.displayTypeCards
    ?.querySelectorAll("[data-display-type]")
    .forEach(card => {
      const active = card.dataset.displayType === value;
      card.classList.toggle("active", active);
      card.setAttribute("aria-checked", String(active));
      card.tabIndex = active ? 0 : -1;
    });
}

function normalizeDisplayType(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === DISPLAY_TYPES.SINGLE) {
    return DISPLAY_TYPES.SINGLE;
  }

  if (normalized === DISPLAY_TYPES.GALLERY) {
    return DISPLAY_TYPES.GALLERY;
  }

  return DISPLAY_TYPES.COMPARISON;
}

function mediaHasReference(media) {
  return hasAssetReference(media);
}

function mediaIdentity(media) {
  return assetReferenceIdentity(media);
}

function normalizeGalleryMedia(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.images)
      ? value.images
      : [];

  const unique = new Map();
  source.map(item => normalizeMedia(item)).filter(mediaHasReference).forEach((item) => {
    const identity = mediaIdentity(item);
    if (identity && !unique.has(identity)) unique.set(identity, item);
  });
  return [...unique.values()];
}

function getProjectDisplayType(project = {}) {
  return normalizeDisplayType(
    project.projectDisplayType ||
    project.displayType ||
    (Array.isArray(project.galleryImages) && project.galleryImages.length
      ? DISPLAY_TYPES.GALLERY
      : project.beforeImage || project.beforeImageUrl
        ? DISPLAY_TYPES.COMPARISON
        : DISPLAY_TYPES.SINGLE)
  );
}

function getProjectGalleryMedia(project = {}) {
  return normalizeGalleryMedia(
    project.galleryImages ||
    project.gallery ||
    project.images ||
    []
  );
}

function displayTypeLabel(type) {
  if (type === DISPLAY_TYPES.GALLERY) {
    return "Gallery";
  }

  if (type === DISPLAY_TYPES.SINGLE) {
    return "Single Showcase";
  }

  return "Before & After";
}

function categoryDuplicatesTitle(title, category) {
  const cleanTitle = String(title || "").trim().toLocaleLowerCase();
  const cleanCategory = String(category || "").trim().toLocaleLowerCase();
  if (!cleanTitle || !cleanCategory || !cleanTitle.startsWith(cleanCategory)) return false;
  if (cleanTitle === cleanCategory) return true;
  const remainder = cleanTitle.slice(cleanCategory.length).trimStart();
  return ["—", "–", "-", ":", "|"].some(separator => remainder.startsWith(separator));
}

function normalizeProjectMedia(project, kind) {
  const nestedMedia =
    normalizeMedia(project?.[`${kind}Image`]);

  if (mediaHasReference(nestedMedia)) {
    return nestedMedia;
  }

  if (kind === "after") {
    for (const legacyValue of [
      project?.singleImage,
      project?.image,
      project?.coverImage,
      project?.primaryImage,
      project?.thumbnail
    ]) {
      const media = normalizeMedia(legacyValue);
      if (mediaHasReference(media)) {
        return media;
      }
    }
  }

  return normalizeMedia({
    url:
      project?.[`${kind}ImageUrl`] ||
      (
        kind === "after"
          ? (
              project?.singleImageUrl ||
              project?.imageUrl ||
              (typeof project?.image === "string" ? project.image : "") ||
              project?.coverImageUrl ||
              project?.primaryImageUrl ||
              project?.thumbnailUrl ||
              ""
            )
          : ""
      ),

    publicId:
      project?.[`${kind}StoragePath`] ||
      (
        kind === "after"
          ? (
              project?.singleImageStoragePath ||
              project?.singleImagePublicId ||
              ""
            )
          : ""
      )
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function formatDate(value) {
  const date = value?.toDate
    ? value.toDate()
    : value
      ? new Date(value)
      : null;

  if (!date || Number.isNaN(date.valueOf())) {
    return "—";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatFileSize(bytes = 0) {
  const size = Number(bytes);

  if (!Number.isFinite(size) || size <= 0) {
    return "—";
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function uploadLimitMB() {
  const configured = Number(getMediaSettings()?.limitsMB?.image);
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

function createUploadLimitError(file) {
  const error = new Error(`Maximum upload size is ${uploadLimitMB()} MB.`);
  error.code = "upload-limit-exceeded";
  error.file = file;
  return error;
}

function showUploadLimitModal(file, input = null) {
  if (!(file instanceof File)) {
    return;
  }

  const maximumMB = uploadLimitMB();
  const selectedMB = file.size / (1024 * 1024);
  const exceededMB = Math.max(0, selectedMB - maximumMB);

  state.uploadLimitInput = input instanceof HTMLInputElement ? input : null;

  if (elements.uploadLimitMaximum) {
    elements.uploadLimitMaximum.textContent = `${maximumMB.toFixed(2)} MB`;
  }

  if (elements.uploadLimitSelected) {
    elements.uploadLimitSelected.textContent = `${selectedMB.toFixed(2)} MB`;
  }

  if (elements.uploadLimitExceeded) {
    elements.uploadLimitExceeded.textContent = `+${exceededMB.toFixed(2)} MB`;
  }

  openModal(elements.uploadLimitModal, elements.chooseAnotherImageButton);
}

function closeUploadLimitDialog() {
  state.uploadLimitInput = null;
  closeModal(elements.uploadLimitModal);
}

function chooseAnotherUploadImage() {
  const input = state.uploadLimitInput;
  closeModal(elements.uploadLimitModal, { restoreFocus: false });
  state.uploadLimitInput = null;

  window.requestAnimationFrame(() => {
    if (input instanceof HTMLInputElement && document.contains(input)) {
      input.value = "";
      input.click();
    }
  });
}

function normalizeStatus(value) {
  return String(value).trim().toLowerCase() === "published"
    ? "published"
    : "draft";
}

function checkedValues(name) {
  return [
    ...document.querySelectorAll(`input[name="${name}"]:checked`)
  ].map(input => input.value);
}

function normalizeReferenceIds(values = []) {
  const source = Array.isArray(values) ? values : String(values || "").split(",");
  return [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeCapabilityName(value = "") {
  return String(value || "").trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function photoCapabilityRecords(type) {
  const expectedType = type === "tools" ? "tool" : "skill";
  return photoCapabilityLibrary.filter((item) => String(item.recordType || "skill").toLowerCase() === expectedType && item.active !== false);
}

function syncPhotoCapabilityFields() {
  selectedPhotoSkillIds = normalizeReferenceIds(selectedPhotoSkillIds);
  selectedPhotoToolIds = normalizeReferenceIds(selectedPhotoToolIds);
  if (fields.skillIds) fields.skillIds.value = selectedPhotoSkillIds.join(",");
  if (fields.toolIds) fields.toolIds.value = selectedPhotoToolIds.join(",");
}

function photoToolIconSource(record = {}) {
  const resolved = window.LANResolveSkillIcon?.(record.name, record.category || "technology");
  const canonical = String(resolved?.src || "").trim();
  if (canonical) return canonical;
  const custom = String(record.icon || "").trim();
  return /^(?:data:image\/|https?:\/\/|\.?\.?\/|\/)/i.test(custom) ? custom : "";
}

function photoCapabilityMetaLabel(record = {}, type = "skill") {
  const raw = String(record.customCategory || record.category || (type === "tool" ? "Tool" : "Skill"))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw.split(" ").map((word) => {
    if (!word || word !== word.toLowerCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

function photoCapabilityChip(record = {}, type = "skill", scope = "entry", removable = true) {
  const iconSource = type === "tool" ? photoToolIconSource(record) : "";
  return `<span class="photo-capability-chip ${type === "tool" ? "is-tool" : "is-skill"}">${iconSource ? `<span class="photo-capability-chip-logo"><img src="${escapeHtml(iconSource)}" alt="" aria-hidden="true" loading="lazy"></span>` : ""}<span>${escapeHtml(record.name)}</span>${removable ? `<button type="button" class="photo-capability-chip-remove" data-photo-capability-remove="${escapeHtml(record.id)}" data-photo-capability-scope="${escapeHtml(scope)}" data-photo-capability-type="${escapeHtml(type)}" aria-label="Remove ${escapeHtml(record.name)}">×</button>` : ""}</span>`;
}

function photoReadOnlyCapabilityRow(record = {}, type = "skill") {
  if (!record?.name) return "";
  const tool = type === "tool";
  const iconSource = tool ? photoToolIconSource(record) : "";
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
  const meta = photoCapabilityMetaLabel(record, type);
  return `<div class="lan-relationship-row is-${tool ? "tool" : "skill"}"><span class="${iconClass}">${iconMarkup}</span><span class="lan-relationship-copy"><strong class="lan-relationship-label">${escapeHtml(record.name)}</strong>${meta ? `<small class="lan-relationship-meta">${escapeHtml(meta)}</small>` : ""}</span></div>`;
}

async function commitPhotoCapabilitySearch(type, rawName) {
  const label = type === "tool" ? "Tool" : "Skill";
  try {
    const module = await import("../services/skillService.js");
    if (typeof module?.ensureCapabilityByName !== "function") {
      throw new Error("Skills & Tools quick entry is unavailable.");
    }
    const result = await module.ensureCapabilityByName(type, rawName);
    await loadPhotoCapabilityLibrary();
    showToast(
      result.created
        ? `${label} “${result.name || rawName}” added to the shared library.`
        : `${label} “${result.name || rawName}” linked from the shared library.`,
      "success"
    );
    return result;
  } catch (error) {
    console.error(`Unable to add ${label}:`, error);
    showToast(error.message || `Unable to add ${label}.`, "error");
    throw error;
  }
}

function setProfileSelectionIds(scope, type, ids = []) {
  if (!photoCapabilityProfileDraft || scope !== "category") return;
  const normalized = normalizeReferenceIds(ids);
  const key = type === "tool" ? "toolIds" : "skillIds";
  const category = elements.profileCategory?.value || "";
  if (!category) return;
  const categoryKey = capabilityCategoryKey(category);
  let record = photoCapabilityProfileDraft.categoryProfiles.find((item) => item.key === categoryKey);
  if (!record) {
    record = { category, key: categoryKey, skillIds: [], toolIds: [] };
    photoCapabilityProfileDraft.categoryProfiles.push(record);
  }
  record[key] = normalized;
}

function photoCapabilityPicker(container, { type = "skill", scope = "entry", selectedIds = [] } = {}) {
  if (!container || typeof window.LANCreateCapabilityPicker !== "function") return null;
  const recordType = type === "tool" ? "tools" : "skills";
  const records = photoCapabilityRecords(recordType);
  const key = `${scope}:${type}`;
  let picker = photoCapabilityPickers.get(key);

  const options = {
    type,
    records,
    selectedIds,
    placeholder: type === "tool" ? "Search or add a tool…" : "Search or add a skill…",
    emptyTitle: `No matching ${type === "tool" ? "Tool" : "Skill"} found.`,
    emptyHint: "Try another search.",
    getIcon: type === "tool" ? photoToolIconSource : null,
    getMeta: (record) => photoCapabilityMetaLabel(record, type),
    compactAdd: true,
    dense: scope === "category",
    relationshipStyle: true,
    collapsedLimit: scope === "category" ? 6 : 4,
    addLabel: scope === "category"
      ? (type === "tool" ? "+ Link Tool" : "+ Link Skill")
      : (type === "tool" ? "+ Add Tool" : "+ Add Skill"),
    onChange(ids) {
      if (scope === "entry") {
        if (type === "tool") selectedPhotoToolIds = normalizeReferenceIds(ids);
        else selectedPhotoSkillIds = normalizeReferenceIds(ids);
        syncPhotoCapabilityFields();
        markFormDirty();
      } else {
        setProfileSelectionIds(scope, type, ids);
      }
    },
    async onCommit(value) {
      return commitPhotoCapabilitySearch(type, value);
    }
  };

  if (!picker || picker.root?.closest(`#${CSS.escape(container.id)}`) !== container) {
    picker = window.LANCreateCapabilityPicker(container, options);
    photoCapabilityPickers.set(key, picker);
  } else {
    picker.update(options);
  }
  return picker;
}

function renderPhotoCapabilitySelectors() {
  syncPhotoCapabilityFields();
  photoCapabilityPicker(elements.photoSkillsSelector, { type: "skill", scope: "entry", selectedIds: selectedPhotoSkillIds });
  photoCapabilityPicker(elements.softwareSelector, { type: "tool", scope: "entry", selectedIds: selectedPhotoToolIds });
}

function inferPhotoToolIds(legacyNames = []) {
  const wanted = new Set((Array.isArray(legacyNames) ? legacyNames : []).map(normalizeCapabilityName));
  const aliases = new Map([
    ["photoshop", "adobe photoshop"], ["premiere pro", "adobe premiere pro"],
    ["3ds max", "autodesk 3ds max"], ["firebase", "firebase and firestore"]
  ]);
  const normalizedWanted = new Set([...wanted].map((name) => aliases.get(name) || name));
  return photoCapabilityRecords("tools")
    .filter((tool) => normalizedWanted.has(normalizeCapabilityName(tool.name)))
    .map((tool) => tool.id);
}

function setPhotoProjectCapabilities(project = {}) {
  const skillValid = new Set(photoCapabilityRecords("skills").map((item) => item.id));
  const toolValid = new Set(photoCapabilityRecords("tools").map((item) => item.id));
  const hasEntryCapabilityFields = Array.isArray(project.entrySkillIds) || Array.isArray(project.entryToolIds);
  const portfolioSkillIds = new Set(normalizeReferenceIds(project.moduleSkillIds || photoCapabilityProfile.legacyModuleSkillIds));
  const portfolioToolIds = new Set(normalizeReferenceIds(project.moduleToolIds || photoCapabilityProfile.legacyModuleToolIds));
  const entrySkillIds = hasEntryCapabilityFields ? project.entrySkillIds : normalizeReferenceIds(project.skillIds || []).filter((id) => !portfolioSkillIds.has(id));
  const entryToolIds = hasEntryCapabilityFields ? project.entryToolIds : normalizeReferenceIds(project.toolIds || []).filter((id) => !portfolioToolIds.has(id));
  selectedPhotoSkillIds = normalizeReferenceIds(entrySkillIds).filter((id) => skillValid.has(id));
  const savedToolIds = normalizeReferenceIds(entryToolIds).filter((id) => toolValid.has(id));
  selectedPhotoToolIds = savedToolIds.length ? savedToolIds : (!hasEntryCapabilityFields ? inferPhotoToolIds(project.software || []) : []);
  if (fields.inheritCapabilityProfile) fields.inheritCapabilityProfile.checked = project.inheritCapabilityProfile !== false;
  renderPhotoCapabilitySelectors();
  renderInheritedPhotoCapabilities();
}

async function loadPhotoCapabilityLibrary() {
  if (photoCapabilityLoadPromise) return photoCapabilityLoadPromise;
  photoCapabilityLoadPromise = import("../services/skillService.js")
    .then(async (module) => {
      const records = module?.SkillService?.getAll ? await module.SkillService.getAll() : [];
      photoCapabilityLibrary = (Array.isArray(records) ? records : [])
        .filter((item) => item?.id && item?.name)
        .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || String(a.name).localeCompare(String(b.name)));
      renderPhotoCapabilitySelectors();
      if (photoCapabilityProfileDraft) renderCapabilityProfileEditor();
      return photoCapabilityLibrary;
    })
    .catch((error) => {
      console.error("Unable to load shared Skills & Tools for Photo Editing:", error);
      photoCapabilityLibrary = [];
      renderPhotoCapabilitySelectors();
      if (photoCapabilityProfileDraft) renderCapabilityProfileEditor();
      showToast("Skills & Tools Used library could not be loaded.", "error");
      return [];
    })
    .finally(() => { photoCapabilityLoadPromise = null; });
  return photoCapabilityLoadPromise;
}


function capabilityCategoryKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizePhotoCapabilityProfile(raw = {}) {
  const categoryProfiles = (Array.isArray(raw.categoryProfiles) ? raw.categoryProfiles : []).map((item) => ({
    category: normalizePhotoCategoryLabel(item?.category),
    key: capabilityCategoryKey(item?.category || item?.key),
    skillIds: normalizeReferenceIds(item?.skillIds || []),
    toolIds: normalizeReferenceIds(item?.toolIds || [])
  })).filter((item) => item.category && item.key && item.key !== "other" && item.key !== REDUNDANT_MODULE_CATEGORY);
  const categories = new Map();
  [...(Array.isArray(raw.categories) ? raw.categories : []), ...categoryProfiles.map((item) => item.category)].forEach((value) => {
    const label = normalizePhotoCategoryLabel(value);
    const key = capabilityCategoryKey(label);
    if (label && key && key !== "other" && key !== REDUNDANT_MODULE_CATEGORY && !categories.has(key)) categories.set(key, label);
  });
  return {
    version: Math.max(2, Number(raw.version) || 2),
    categories: [...categories.values()],
    categoryProfiles,
    legacyModuleSkillIds: normalizeReferenceIds(raw.legacyModuleSkillIds || raw.moduleSkillIds || []),
    legacyModuleToolIds: normalizeReferenceIds(raw.legacyModuleToolIds || raw.moduleToolIds || [])
  };
}

function profileCategoryRecord(profile = photoCapabilityProfile, category = "") {
  const key = capabilityCategoryKey(category);
  return (Array.isArray(profile.categoryProfiles) ? profile.categoryProfiles : []).find((item) => item.key === key) || { category: String(category || "").trim(), key, skillIds: [], toolIds: [] };
}

function uniqueCapabilityIds(...groups) {
  return [...new Set(groups.flatMap((group) => normalizeReferenceIds(group)))];
}

function effectivePhotoCapabilities(category, entrySkillIds = selectedPhotoSkillIds, entryToolIds = selectedPhotoToolIds, inherit = fields.inheritCapabilityProfile?.checked !== false, profile = photoCapabilityProfile) {
  const categoryRecord = profileCategoryRecord(profile, category);
  return {
    skillIds: inherit ? uniqueCapabilityIds(categoryRecord.skillIds, entrySkillIds) : normalizeReferenceIds(entrySkillIds),
    toolIds: inherit ? uniqueCapabilityIds(categoryRecord.toolIds, entryToolIds) : normalizeReferenceIds(entryToolIds)
  };
}

function capabilityRecordById(id) {
  return photoCapabilityLibrary.find((item) => item.id === id) || null;
}

function inheritedPhotoCapabilityIds() {
  if (fields.inheritCapabilityProfile?.checked === false) return { skillIds: [], toolIds: [] };
  const category = resolvedCategoryValue();
  const categoryRecord = profileCategoryRecord(photoCapabilityProfile, category);
  return {
    skillIds: uniqueCapabilityIds(categoryRecord.skillIds),
    toolIds: uniqueCapabilityIds(categoryRecord.toolIds)
  };
}

function renderInheritedPhotoCapabilities() {
  if (!elements.inheritedCapabilities) return;
  const inherited = inheritedPhotoCapabilityIds();
  const records = [...inherited.toolIds.map((id) => ({ type: "tool", record: capabilityRecordById(id) })), ...inherited.skillIds.map((id) => ({ type: "skill", record: capabilityRecordById(id) }))].filter((item) => item.record);
  if (!records.length) {
    elements.inheritedCapabilities.innerHTML = fields.inheritCapabilityProfile?.checked === false
      ? '<span>Profile inheritance is off for this entry.</span>'
      : '<span>No category capabilities are configured for this sample category yet.</span>';
    return;
  }
  elements.inheritedCapabilities.innerHTML = `<div class="lan-relationship-list">${records.map(({ type, record }) => photoReadOnlyCapabilityRow(record, type)).join("")}</div>`;
}

function profileCategoryOptions() {
  return registeredPhotoCategories();
}

function renderCapabilityProfileEditor() {
  if (!photoCapabilityProfileDraft) return;
  const categories = profileCategoryOptions();
  if (elements.profileCategory) {
    const current = elements.profileCategory.value || categories[0] || "";
    elements.profileCategory.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    elements.profileCategory.value = categories.includes(current) ? current : (categories[0] || "");
  }
  const category = elements.profileCategory?.value || "";
  const categoryRecord = profileCategoryRecord(photoCapabilityProfileDraft, category);
  photoCapabilityPicker(elements.profileCategorySkills, { type: "skill", scope: "category", selectedIds: categoryRecord.skillIds });
  photoCapabilityPicker(elements.profileCategoryTools, { type: "tool", scope: "category", selectedIds: categoryRecord.toolIds });
}


async function loadPhotoCapabilityProfile() {
  try {
    photoCapabilityProfile = normalizePhotoCapabilityProfile(await getPhotoEditingCapabilityProfile());
  } catch (error) {
    console.error("Unable to load Photo Editing capability profile:", error);
    photoCapabilityProfile = normalizePhotoCapabilityProfile({});
  }
  renderSampleCategoryOptions();
  renderInheritedPhotoCapabilities();
  return photoCapabilityProfile;
}

async function openCapabilityProfileModal() {
  await loadPhotoCapabilityLibrary();
  await loadPhotoCapabilityProfile();
  photoCapabilityProfileDraft = normalizePhotoCapabilityProfile(photoCapabilityProfile);
  renderCapabilityProfileEditor();
  openModal(elements.capabilityProfileModal, elements.profileCategory);
}

async function saveCapabilityProfile() {
  if (!photoCapabilityProfileDraft || !elements.saveCapabilityProfile) return;
  const previous = elements.saveCapabilityProfile.textContent;
  elements.saveCapabilityProfile.disabled = true;
  elements.saveCapabilityProfile.textContent = "Saving…";
  try {
    photoCapabilityProfile = normalizePhotoCapabilityProfile(await savePhotoEditingCapabilityProfile(photoCapabilityProfileDraft));
    photoCapabilityProfileDraft = null;
    window.LANCloseActiveCapabilityPicker?.();
    closeModal(elements.capabilityProfileModal);
    await loadProjects();
    renderInheritedPhotoCapabilities();
    showToast("Photo Editing capabilities saved and synchronized across the library.");
  } catch (error) {
    console.error("Unable to save Photo Editing capability profile:", error);
    showToast(error.message || "The shared capability profile could not be saved.", "error");
  } finally {
    elements.saveCapabilityProfile.disabled = false;
    elements.saveCapabilityProfile.textContent = previous;
  }
}

function normalizeCustomTechniqueLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function customTechniqueId(name, value) {
  const safe = slugify(value) || `custom-${Date.now()}`;
  return `checkbox-${name}-custom-${safe}`;
}

function uniqueCustomTechniqueLabels(values = []) {
  const uniqueValues = new Map();
  (Array.isArray(values) ? values : []).forEach(rawValue => {
    const value = normalizeCustomTechniqueLabel(rawValue);
    if (value) uniqueValues.set(value.toLowerCase(), value);
  });
  return [...uniqueValues.values()].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: "base" }));
}

function customTechniqueLibrary() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_TECHNIQUE_STORAGE_KEY) || "{}");
    return {
      techniques: uniqueCustomTechniqueLabels(parsed.techniques),
      deleted: { techniques: uniqueCustomTechniqueLabels(parsed.deleted?.techniques) }
    };
  } catch {
    return { techniques: [], deleted: { techniques: [] } };
  }
}

function saveCustomTechniqueLibrary(library) {
  try {
    window.localStorage.setItem(CUSTOM_TECHNIQUE_STORAGE_KEY, JSON.stringify({
      techniques: uniqueCustomTechniqueLabels(library.techniques),
      deleted: { techniques: uniqueCustomTechniqueLabels(library.deleted?.techniques) }
    }));
  } catch (error) {
    console.warn("Custom technique library could not be saved:", error);
  }
}

function isDeletedCustomTechnique(library, name, rawValue) {
  const value = normalizeCustomTechniqueLabel(rawValue).toLowerCase();
  return Boolean(value && (library.deleted?.[name] || []).some(item => item.toLowerCase() === value));
}

function knownStaticValues(name) {
  return new Set([...document.querySelectorAll(`input[name="${name}"]`)]
    .filter(input => input.dataset.customTechnique !== "true")
    .map(input => input.value)
    .filter(value => value !== "Other"));
}

function techniqueSelector() {
  return elements.techniquesSelector;
}

function createCustomTechniqueOption(name, rawValue, { checked = false, allowDeleted = false } = {}) {
  const value = normalizeCustomTechniqueLabel(rawValue);
  const selector = techniqueSelector(name);
  if (!value || !selector) return null;
  if (!allowDeleted && isDeletedCustomTechnique(customTechniqueLibrary(), name, value)) return null;
  const existing = [...document.querySelectorAll(`input[name="${name}"]`)].find(input => input.value.toLowerCase() === value.toLowerCase());
  if (existing) { existing.checked = checked || existing.checked; return existing; }
  const otherLabel = selector.querySelector(".other-technique-option");
  const label = document.createElement("label");
  label.className = "custom-technique-option";
  const input = document.createElement("input");
  input.type = "checkbox"; input.name = name; input.value = value; input.id = customTechniqueId(name, value); input.dataset.customTechnique = "true"; input.checked = checked;
  const text = document.createElement("span"); text.className = "custom-technique-label"; text.textContent = value;
  const removeButton = document.createElement("button"); removeButton.type = "button"; removeButton.className = "custom-technique-delete"; removeButton.setAttribute("aria-label", `Delete custom technique ${value}`); removeButton.title = "Delete custom option"; removeButton.textContent = "×";
  label.htmlFor = input.id; label.append(input, text, removeButton); selector.insertBefore(label, otherLabel || null);
  input.addEventListener("change", markFormDirty);
  removeButton.addEventListener("click", async event => {
    event.preventDefault(); event.stopPropagation();
    const confirmed = await window.LANConfirm({ title: `Delete “${value}”?`, message: "This removes the reusable technique from this browser. Existing saved samples keep the value until you edit and save them.", confirmLabel: "Delete option", danger: true });
    if (!confirmed) return;
    const library = customTechniqueLibrary();
    library[name] = (library[name] || []).filter(item => item.toLowerCase() !== value.toLowerCase());
    library.deleted[name] = uniqueCustomTechniqueLabels([...(library.deleted[name] || []), value]);
    saveCustomTechniqueLibrary(library); label.remove(); markFormDirty(); showToast(`${value} was removed from your reusable techniques.`);
  });
  return input;
}

function rememberCustomTechnique(name, rawValue) {
  const value = normalizeCustomTechniqueLabel(rawValue);
  if (!value) return null;
  const library = customTechniqueLibrary();
  library.deleted[name] = (library.deleted[name] || []).filter(item => item.toLowerCase() !== value.toLowerCase());
  library[name] = uniqueCustomTechniqueLabels([...(library[name] || []), value]);
  saveCustomTechniqueLibrary(library);
  const input = createCustomTechniqueOption(name, value, { checked: true, allowDeleted: true });
  markFormDirty();
  return input;
}

function hydrateCustomTechniqueOptions(projects = []) {
  const library = customTechniqueLibrary();
  const staticTechniques = knownStaticValues("techniques");
  projects.forEach(project => {
    (Array.isArray(project.techniques) ? project.techniques : []).forEach(value => {
      if (value && !staticTechniques.has(value) && value !== "Other" && !isDeletedCustomTechnique(library, "techniques", value)) library.techniques.push(value);
    });
  });
  library.techniques = uniqueCustomTechniqueLabels(library.techniques).filter(value => !isDeletedCustomTechnique(library, "techniques", value));
  saveCustomTechniqueLibrary(library);
  library.techniques.forEach(value => createCustomTechniqueOption("techniques", value));
}

function checkedTechniqueValues(name) {
  return checkedValues(name).filter(value => value !== "Other");
}

function updateCustomTechniqueUI(name, group, field) {
  const otherCheckbox = document.querySelector(
    `input[name="${name}"][value="Other"]`
  );
  const showCustom = Boolean(otherCheckbox?.checked);

  group?.classList.toggle("hidden", !showCustom);

  if (field) {
    field.disabled = !showCustom;
    field.required = false;

    if (!showCustom) {
      field.value = "";
    }
  }
}

function splitKnownAndCustomValues(name, values) {
  const source = Array.isArray(values) ? values : [];

  const library = customTechniqueLibrary();

  source.forEach(value => {
    if (
      value &&
      !isDeletedCustomTechnique(library, name, value) &&
      ![...document.querySelectorAll(`input[name="${name}"]`)]
        .some(input => input.value.toLowerCase() === String(value).toLowerCase())
    ) {
      createCustomTechniqueOption(name, value);
    }
  });

  document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
    input.checked =
      input.value !== "Other" &&
      source.some(value =>
        String(value).toLowerCase() === input.value.toLowerCase()
      );
  });

  const otherCheckbox = document.querySelector(
    `input[name="${name}"][value="Other"]`
  );

  if (otherCheckbox) {
    otherCheckbox.checked = false;
  }
}

function setCount(id, value) {
  const element = $(id);

  if (element) {
    element.textContent = String(value);
  }
}

function getErrorMessage(error, fallback) {
  if (error?.code === "permission-denied") {
    return "Firestore permissions blocked this action. Verify the deployed Firestore rules and your admin login.";
  }

  const message = String(error?.message || "").trim();
  return message || fallback;
}

function showToast(message, type = "success") {
  if (!elements.toast || !elements.toastMessage) {
    return;
  }

  const normalizedType = ["success", "error", "warning", "info"].includes(type)
    ? type
    : "info";
  const icons = {
    success: "✓",
    error: "!",
    warning: "!",
    info: "i"
  };

  elements.toastMessage.textContent = message;
  if (elements.toastIcon) {
    elements.toastIcon.textContent = icons[normalizedType];
    elements.toastIcon.setAttribute("aria-hidden", "true");
  }

  elements.toast.className = `toast ${normalizedType}`;
  elements.toast.classList.remove("hidden");
  elements.toast.setAttribute("aria-hidden", "false");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
    elements.toast.setAttribute("aria-hidden", "true");
  }, 4000);
}

function setActionButtonState(button, isBusy, label = "") {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  if (isBusy) {
    if (!button.dataset.originalContent) {
      button.dataset.originalContent = button.innerHTML;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
    return;
  }

  button.disabled = state.selectedIds.size === 0;
  button.removeAttribute("aria-busy");
  if (button.dataset.originalContent) {
    button.innerHTML = button.dataset.originalContent;
    delete button.dataset.originalContent;
  }
}

function setPanelLoading(show, message = "Updating samples...") {
  const panel = elements.editorPanel;
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  window.clearTimeout(state.panelLoadingTimer);
  state.panelLoadingTimer = 0;

  let overlay = panel.querySelector(".panel-loading-overlay");
  if (!overlay && show) {
    overlay = document.createElement("div");
    overlay.className = "panel-loading-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = '<span class="panel-loading-spinner" aria-hidden="true"></span><span class="panel-loading-message"></span>';
    panel.append(overlay);
  }

  if (!overlay) {
    panel.removeAttribute("aria-busy");
    return;
  }

  const text = overlay.querySelector(".panel-loading-message");
  if (text) {
    text.textContent = message;
  }

  overlay.classList.toggle("is-visible", show);
  panel.setAttribute("aria-busy", String(show));

  if (!show) {
    state.panelLoadingTimer = window.setTimeout(() => {
      overlay.remove();
      panel.removeAttribute("aria-busy");
      state.panelLoadingTimer = 0;
    }, 180);
  }
}

function updateProjectsInMemory(ids, changes) {
  const idSet = new Set(ids);
  state.projects = state.projects.map(project =>
    idSet.has(project.id) ? { ...project, ...changes } : project
  );
  state.filteredProjects = state.filteredProjects.map(project =>
    idSet.has(project.id) ? { ...project, ...changes } : project
  );
}

function refreshAffectedCardBadges(ids, changes) {
  ids.forEach(id => {
    const card = elements.photoLibrary?.querySelector(
      `.photo-card[data-project-id="${CSS.escape(String(id))}"]`
    );
    if (!(card instanceof HTMLElement)) return;

    if (Object.prototype.hasOwnProperty.call(changes, "status")) {
      const statusBadge = card.querySelector(".photo-status-badge");
      if (statusBadge) {
        const status = normalizeStatus(changes.status);
        const published = status === "published";
        statusBadge.textContent = published ? "Published" : "Draft";
        statusBadge.classList.toggle("is-published", published);
        statusBadge.classList.toggle("is-draft", !published);
        statusBadge.dataset.status = status;
        statusBadge.setAttribute("aria-label", `Status: ${statusBadge.textContent}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, "featured")) {
      card.querySelector(".badge-featured")?.classList.toggle(
        "hidden",
        changes.featured !== true
      );
    }
  });

  setCount("featuredSamples", state.projects.filter(project => project?.featured === true).length);
  setCount("publishedSamples", state.projects.filter(project => normalizeStatus(project?.status) === "published").length);
  setCount("draftSamples", state.projects.filter(project => normalizeStatus(project?.status) === "draft").length);
}

function setLoading(show, message = "Working...") {
  if (!elements.loadingScreen) {
    return;
  }

  elements.loadingScreen.classList.toggle("hidden", !show);
  elements.loadingScreen.classList.toggle("is-active", show);
  elements.loadingScreen.setAttribute("aria-hidden", String(!show));
  elements.loadingScreen.setAttribute("aria-busy", String(show));
  document.body.classList.toggle("body-loading", show);

  const messageElement = elements.loadingScreen.querySelector("p");
  if (messageElement) {
    messageElement.textContent = message;
  }
}

function setFormSubmitting(isSubmitting) {
  state.saving = isSubmitting;

  const submitButton = elements.sampleForm?.querySelector(
    'button[type="submit"]'
  );

  if (submitButton) {
    submitButton.disabled = isSubmitting;
    submitButton.setAttribute("aria-disabled", String(isSubmitting));
  }

  if (elements.cancelButton) {
    elements.cancelButton.disabled = isSubmitting;
  }

  if (elements.closeModalButton) {
    elements.closeModalButton.disabled = isSubmitting;
  }
}

function getVisibleModals() {
  return [...document.querySelectorAll(".modal:not(.hidden)")];
}

function syncModalBodyLock() {
  // Shared Admin UI observes modal visibility and owns background scroll lock.
}

function openModal(modal, focusTarget = null) {
  if (!modal) {
    return;
  }

  state.previouslyFocusedElement = document.activeElement;
  state.activeModal = modal;

  modal.classList.remove("hidden");
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  syncModalBodyLock();

  window.requestAnimationFrame(() => {
    const target = focusTarget || modal.querySelector(MODAL_FOCUS_SELECTOR);
    target?.focus();
  });
}

function closeModal(modal, { restoreFocus = true } = {}) {
  if (!modal) {
    return;
  }

  modal.classList.add("hidden");
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");

  const visibleModals = getVisibleModals();
  state.activeModal = visibleModals.at(-1) || null;

  syncModalBodyLock();
  if (visibleModals.length === 0) {
    document.body.removeAttribute("aria-busy");
    setLoading(false);
  }

  if (
    restoreFocus &&
    state.previouslyFocusedElement instanceof HTMLElement &&
    document.contains(state.previouslyFocusedElement)
  ) {
    state.previouslyFocusedElement.focus();
  }
}

function trapModalFocus(event) {
  if (event.key !== "Tab") {
    return;
  }

  const modal = state.activeModal;
  if (!modal || modal.classList.contains("hidden")) {
    return;
  }

  const focusableElements = [
    ...modal.querySelectorAll(MODAL_FOCUS_SELECTOR)
  ].filter(element => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });

  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements.at(-1);

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function markFormDirty() {
  if (!state.saving) {
    state.formDirty = true;
  }
}

async function canCloseEditor() {
  if (state.saving) return false;
  if (!state.formDirty) return true;
  return window.LANConfirm({
    title: "Discard photo editing changes?",
    message: "The unsaved changes in this sample editor will be lost.",
    confirmLabel: "Discard changes",
    danger: true
  });
}

async function closeEditorModal() {
  if (!await canCloseEditor()) {
    return;
  }

  resetTemporaryImageState();
  state.formDirty = false;
  fields.id.value = "";
  renderProjects();
  closeModal(elements.sampleModal);
}

function timestampValue(value) {
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000;
  }

  const date = value?.toDate
    ? value.toDate()
    : value
      ? new Date(value)
      : null;

  return date && !Number.isNaN(date.valueOf())
    ? date.valueOf()
    : 0;
}

async function loadProjects({ announce = false } = {}) {
  if (state.loadingProjects) {
    return;
  }

  state.loadingProjects = true;

  const refreshButton = elements.refreshSamples;

  if (refreshButton) {
    window.LANSetTopbarActionState?.(refreshButton, { label: "Loading…", busy: true, disabled: true });
  }

  setLoading(true, "Loading photo editing samples...");
  elements.photoLibrary?.setAttribute("aria-busy", "true");

  try {
    const loadedProjects = await listPhotoEditingProjects();
    state.projects = loadedProjects.filter((project) => !isPhotoEditingPortfolioGateway(project));
    hydrateCustomTechniqueOptions(state.projects);
    renderSampleCategoryOptions();
    refreshLibraryCategoryFilter();

    const activeIds = new Set(state.projects.map(project => project.id));
    state.selectedIds = new Set(
      [...state.selectedIds].filter(id => activeIds.has(id))
    );

    applyFilters();

    if (announce) {
      showToast("Photo editing samples refreshed.");
    }
  } catch (error) {
    console.error("Unable to load photo editing samples:", error);
    showToast(
      getErrorMessage(error, "Samples could not be loaded."),
      "error"
    );
  } finally {
    state.loadingProjects = false;
    setLoading(false);
    elements.photoLibrary?.setAttribute("aria-busy", "false");

    if (refreshButton) {
      window.LANSetTopbarActionState?.(refreshButton, { label: null, busy: false, disabled: false });
    }
  }
}

function projectSearchText(project) {
  return [
    project.title,
    project.slug,
    project.category,
    displayTypeLabel(getProjectDisplayType(project)),
    project.shortDescription,
    project.description,
    ...(Array.isArray(project.software) ? project.software : []),
    ...(Array.isArray(project.techniques) ? project.techniques : []),
    ...(Array.isArray(project.seo?.keywords) ? project.seo.keywords : []),
    ...(Array.isArray(project.seoKeywords) ? project.seoKeywords : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function refreshLibraryCategoryFilter() {
  const select = elements.categoryFilter;
  if (!select) return;

  const previous = select.value;
  const categories = registeredPhotoCategories();

  select.replaceChildren(
    new Option("All Categories", ""),
    ...categories.map(category => new Option(category, category))
  );

  select.value = categories.includes(previous) ? previous : "";
}

function applyFilters() {
  const searchTerm = elements.searchInput?.value.trim().toLowerCase() || "";
  const category = elements.categoryFilter?.value.trim().toLowerCase() || "";
  const status = elements.statusFilter?.value.trim().toLowerCase() || "";

  state.filteredProjects = state.projects.filter(project => {
    const matchesSearch =
      !searchTerm || projectSearchText(project).includes(searchTerm);

    const matchesCategory =
      !category || String(project.category).toLowerCase() === category;

    const matchesStatus =
      !status || normalizeStatus(project.status) === normalizeStatus(status);

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const sortValue = elements.sortBy?.value || "Newest";

  state.filteredProjects.sort((first, second) => {
    if (sortValue === "Oldest") {
      return timestampValue(first.createdAt) - timestampValue(second.createdAt);
    }

    if (sortValue === "Featured") {
      return (
        Number(Boolean(second.featured)) - Number(Boolean(first.featured)) ||
        (Number(first.displayOrder) || 0) -
          (Number(second.displayOrder) || 0)
      );
    }

    if (sortValue === "A–Z") {
      return String(first.title || "").localeCompare(
        String(second.title || ""),
        undefined,
        { sensitivity: "base" }
      );
    }

    return timestampValue(second.createdAt) - timestampValue(first.createdAt);
  });

  const totalPages = recordLibraryPageCount(state.filteredProjects, PAGE_SIZE);

  state.currentPage = Math.min(state.currentPage, totalPages);
  renderProjects();
}


function resolveAdminMediaUrl(value = "") {
  const url = String(value || "").trim();

  if (!url) {
    return "";
  }

  // The Admin lives under /admin/pages. Legacy portfolio media is stored
  // relative to the site root. Resolve for display only; never rewrite data.
  if (url.startsWith("assets/")) {
    return `/${url}`;
  }

  if (url.startsWith("./assets/")) {
    return `/${url.slice(2)}`;
  }

  return url;
}

function setImageWithFallback(image, url, alt) {
  if (!(image instanceof HTMLImageElement)) return;

  const parent = image.parentElement;
  parent?.classList.add("lan-image-fallback-host");
  let fallback = parent?.querySelector(":scope > .lan-image-fallback");
  if (!fallback && parent) {
    fallback = document.createElement("div");
    fallback.className = "lan-image-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.innerHTML = "<strong>LΛN</strong><small>Media unavailable</small>";
    parent.append(fallback);
  }

  const showFallback = () => {
    image.removeAttribute("src");
    image.alt = "";
    image.classList.add("image-load-error");
    if (fallback) fallback.hidden = false;
  };
  const showImage = () => {
    image.classList.remove("image-load-error");
    image.alt = alt || "";
    if (fallback) fallback.hidden = true;
  };

  image.onerror = showFallback;
  image.onload = showImage;
  const resolvedUrl =
    resolveAdminMediaUrl(url);

  if (resolvedUrl) {
    showImage();
    image.src = resolvedUrl;
  } else {
    showFallback();
  }
}


function resolvePhotoCardMediaSource(value) {
  return resolveAdminMediaUrl(resolveAdminMediaAssetUrl(value));
}

function renderSingleCardMedia(container, media, title) {
  if (!container) {
    return;
  }

  container.innerHTML = "";

  const image = mountAdminMediaFrame(container, {
    src: resolvePhotoCardMediaSource(media),
    alt: `Final artwork: ${title}`,
    title,
    context: "Photo editing media",
    imageClass: "single-showcase-card-image"
  });

  const badge = document.createElement("span");
  badge.className = "badge photo-type-badge";
  badge.textContent = "Single";

  container.append(badge);
}

function preventImageDragging(image) {
  if (!(image instanceof HTMLImageElement)) {
    return;
  }

  image.draggable = false;
  image.addEventListener("dragstart", event => {
    event.preventDefault();
  });
}


function removeDuplicateComparisonLabels(root) {
  if (!(root instanceof Element)) {
    return;
  }

  ["before", "after"].forEach(kind => {
    const labels = root.querySelectorAll(
      `.static-comparison-label-${kind}`
    );

    [...labels].slice(1).forEach(label => label.remove());
  });
}

function renderStaticComparisonCardMedia(
  container,
  beforeMedia,
  afterMedia,
  title
) {
  if (!container) {
    return;
  }

  const { images } = mountAdminMediaCardComparison(container, {
    before: resolvePhotoCardMediaSource(beforeMedia),
    after: resolvePhotoCardMediaSource(afterMedia),
    title
  });
  images.forEach(preventImageDragging);

  const badge = document.createElement("span");
  badge.className = "badge photo-type-badge";
  badge.textContent = "Before & After";
  container.append(badge);
}

function renderGalleryCardMedia(container, galleryMedia, title) {
  if (!container) {
    return;
  }

  const items = galleryMedia.map((media, index) => ({
    src: resolvePhotoCardMediaSource(media),
    alt: `${title}, gallery image ${index + 1}`
  }));
  const { images } = mountAdminMediaCardGallery(container, {
    items,
    title,
    context: "Gallery image"
  });
  images.forEach(preventImageDragging);

  const count = document.createElement("span");
  count.className = "gallery-card-count";
  count.textContent = `${galleryMedia.length} photo${galleryMedia.length === 1 ? "" : "s"}`;
  container.append(count);
}

function renderProjects() {
  const library = elements.photoLibrary;
  const templateRoot = elements.photoCardTemplate?.content?.firstElementChild;

  if (!library || !templateRoot) {
    return;
  }

  applyRecordLibraryView(library, state.view);
  library.querySelectorAll(".photo-card").forEach(card => card.remove());

  elements.emptyState?.classList.toggle(
    "hidden",
    state.filteredProjects.length > 0
  );

  const pageState = recordLibraryPageSlice(state.filteredProjects, state.currentPage, PAGE_SIZE);
  state.currentPage = pageState.currentPage;
  const pageProjects = pageState.items;
  const fragment = document.createDocumentFragment();

  pageProjects.forEach(project => {
    const card = templateRoot.cloneNode(true);

    if (!(card instanceof HTMLElement)) {
      return;
    }

    card.dataset.projectId = String(project?.id || "");
    card.setAttribute(
      "aria-label",
      `${project?.title || "Untitled sample"}, ${normalizeStatus(project?.status)}`
    );

    const displayType = getProjectDisplayType(project);
    const beforeMedia = normalizeProjectMedia(project, "before");
    const afterMedia = normalizeProjectMedia(project, "after");
    const galleryMedia = getProjectGalleryMedia(project);
    const comparisonWrapper =
      card.querySelector(".comparison-wrapper");

    if (displayType === DISPLAY_TYPES.GALLERY) {
      renderGalleryCardMedia(
        comparisonWrapper,
        galleryMedia,
        project?.title || "Gallery sample"
      );
    } else if (displayType === DISPLAY_TYPES.SINGLE) {
      renderSingleCardMedia(
        comparisonWrapper,
        mediaHasReference(afterMedia) ? afterMedia : beforeMedia,
        project?.title || "Single image sample"
      );
    } else {
      renderStaticComparisonCardMedia(
        comparisonWrapper,
        beforeMedia,
        afterMedia,
        project?.title || "Comparison sample"
      );
    }

    const categoryElement = card.querySelector(".photo-category");
    const displayTypeElement = card.querySelector(".photo-display-type");
    const titleElement = card.querySelector(".photo-title");
    const descriptionElement = card.querySelector(".photo-description");
    const tools = card.querySelector(".photo-tools");
    const createdDate = card.querySelector(".created-date");
    const updatedDate = card.querySelector(".updated-date");
    const featuredBadge = card.querySelector(".badge-featured");
    const statusBadge = card.querySelector(".photo-status-badge");

    const cardTitle = project?.title || "Untitled Sample";
    const cardCategory = project?.category || "Uncategorized";
    if (categoryElement) {
      categoryElement.textContent = cardCategory;
      categoryElement.classList.toggle("hidden", categoryDuplicatesTitle(cardTitle, cardCategory));
    }
    if (displayTypeElement) displayTypeElement.textContent = displayTypeLabel(displayType);
    if (titleElement) titleElement.textContent = cardTitle;
    if (descriptionElement) descriptionElement.textContent = project?.shortDescription || "";
    if (createdDate) createdDate.textContent = formatDate(project?.createdAt);
    if (updatedDate) updatedDate.textContent = formatDate(project?.updatedAt);
    featuredBadge?.classList.toggle("hidden", project?.featured !== true);

    if (tools) {
      tools.replaceChildren();
      const toolById = new Map(photoCapabilityRecords("tools").map((record) => [record.id, record]));
      const skillById = new Map(photoCapabilityRecords("skills").map((record) => [record.id, record]));
      const hasEntryCapabilityFields = Array.isArray(project?.entrySkillIds) || Array.isArray(project?.entryToolIds);
      const portfolioSkillIds = new Set(normalizeReferenceIds(project?.moduleSkillIds || photoCapabilityProfile.legacyModuleSkillIds));
      const portfolioToolIds = new Set(normalizeReferenceIds(project?.moduleToolIds || photoCapabilityProfile.legacyModuleToolIds));
      const entrySkillIds = hasEntryCapabilityFields ? project.entrySkillIds : normalizeReferenceIds(project?.skillIds || []).filter((id) => !portfolioSkillIds.has(id));
      const entryToolIds = hasEntryCapabilityFields ? project.entryToolIds : normalizeReferenceIds(project?.toolIds || []).filter((id) => !portfolioToolIds.has(id));
      const effective = effectivePhotoCapabilities(project?.category || project?.projectCategory || project?.type, entrySkillIds, entryToolIds, project?.inheritCapabilityProfile !== false);
      const linkedTools = normalizeReferenceIds(effective.toolIds).map((id) => toolById.get(id)).filter(Boolean);
      const linkedSkills = normalizeReferenceIds(effective.skillIds).map((id) => skillById.get(id)).filter(Boolean);
      const capabilityItems = [
        ...linkedTools.map((record) => ({ type: "tool", record })),
        ...linkedSkills.map((record) => ({ type: "skill", record }))
      ];
      if (capabilityItems.length) {
        tools.innerHTML = capabilityItems.map(({ type, record }) => photoCapabilityChip(record, type, "card", false)).join("");
      } else {
        tools.innerHTML = (Array.isArray(project?.software) ? project.software : [])
          .map((tool) => `<span class="photo-capability-chip is-tool"><span>${escapeHtml(String(tool))}</span></span>`)
          .join("");
      }
    }

    const status = normalizeStatus(project?.status);
    if (statusBadge) {
      const isPublished = status === "published";
      statusBadge.textContent = isPublished ? "Published" : "Draft";
      statusBadge.classList.toggle("is-published", isPublished);
      statusBadge.classList.toggle("is-draft", !isPublished);
      statusBadge.classList.remove("hidden");
      statusBadge.setAttribute("data-status", status);
      statusBadge.setAttribute("aria-label", `Status: ${statusBadge.textContent}`);
    }

    if (project?.linkedProjectId) {
      const linkedBadge = document.createElement("span");
      linkedBadge.className = "badge badge-linked-project";
      linkedBadge.innerHTML = `<span>✓ Linked to Project</span>${project.linkedProjectTitle ? `<small>Project: ${escapeHtml(project.linkedProjectTitle)}</small>` : ""}`;
      linkedBadge.title = project.linkedProjectTitle || "Linked Project";
      linkedBadge.setAttribute("aria-label", linkedBadge.textContent);
      card.querySelector(".photo-status")?.append(linkedBadge);
    }

    const actions = [
      [card.querySelector(".previewButton"), "Preview", () => previewProject(project)],
      [card.querySelector(".editButton"), "Edit", () => editProject(project)],
      [card.querySelector(".deleteButton"), "Delete", () => askDeleteProject(project)]
    ];

    actions.forEach(([button, label, handler]) => {
      if (!(button instanceof HTMLElement)) return;
      button.setAttribute("aria-label", `${label} ${project?.title || "sample"}`);
      button.addEventListener("click", handler);
    });

    fragment.append(card);
  });

  library.append(fragment);

  const totalPages = recordLibraryPageCount(state.filteredProjects, PAGE_SIZE);
  ["currentPage", "summaryCurrentPage"].forEach(id => setCount(id, state.currentPage));
  ["totalPages", "summaryTotalPages"].forEach(id => setCount(id, totalPages));

  setCount("resultCount", state.filteredProjects.length);
  setCount("totalSamples", state.projects.length);
  setCount("featuredSamples", state.projects.filter(project => project?.featured === true).length);
  setCount("publishedSamples", state.projects.filter(project => normalizeStatus(project?.status) === "published").length);
  setCount("draftSamples", state.projects.filter(project => normalizeStatus(project?.status) === "draft").length);

  if (elements.previousPage) elements.previousPage.disabled = state.currentPage <= 1;
  if (elements.nextPage) elements.nextPage.disabled = state.currentPage >= totalPages;

  window.LANPinActiveRecordCard?.(library, fields.id?.value || "", {
    cardSelector: ".photo-card",
    idAttribute: "data-project-id"
  });
  ensurePhotoRecordSelection();
}

function syncPhotoSelectionState(ids = []) {
  state.selectedIds = new Set(ids.map((id) => String(id || "").trim()).filter(Boolean));
}

function ensurePhotoRecordSelection() {
  const library = elements.photoLibrary;
  if (!(library instanceof HTMLElement) || typeof window.LANCreateRecordSelection !== "function") return;

  photoRecordSelection = window.LANCreateRecordSelection(library, {
    cardSelector: ".photo-card",
    idAttribute: "data-project-id",
    actionSelector: ".photo-card-footer",
    label: "sample",
    barAnchor: ".library-information",
    records: state.projects,
    capabilities: { publishing: true, featured: true, visibility: false, deletion: true },
    onChange: syncPhotoSelectionState,
    onBulkPatch: (_ids, changes, { actionKey, button }) => runBulkUpdate(
      changes,
      {
        button,
        busyLabel: actionKey === "publish" ? "Publishing..." : actionKey === "draft" ? "Saving as draft..." : "Updating...",
        panelMessage: actionKey === "publish" ? "Publishing selected samples..." : actionKey === "draft" ? "Saving selected samples as draft..." : "Updating selected samples...",
        successMessage: state.selectedIds.size === 1 ? "Sample updated successfully" : "Samples updated successfully"
      }
    ),
    deletePrompt: (ids) => ({
      title: `Delete ${ids.length} selected sample${ids.length === 1 ? "" : "s"}?`,
      message: `Move ${ids.length} selected sample${ids.length === 1 ? "" : "s"} to deleted samples?`,
      confirmLabel: "Move to deleted"
    }),
    onDelete: deleteSelectedPhotoProjects
  });
  photoRecordSelection.sync();
}

function revokeObjectUrl(kind) {
  if (state.objectUrls[kind]) {
    URL.revokeObjectURL(state.objectUrls[kind]);
    state.objectUrls[kind] = "";
  }
}

function resetTemporaryImageState() {
  IMAGE_KINDS.forEach(kind => {
    revokeObjectUrl(kind);
    state.files[kind] = null;
  });

  state.galleryObjectUrls.forEach(url => URL.revokeObjectURL(url));
  state.galleryObjectUrls = [];
  state.galleryFiles = [];
}

function setStoredMedia(kind, media) {
  if (!IMAGE_KINDS.includes(kind)) {
    return;
  }

  state.media[kind] = normalizeMedia(media);

  const urlField = fields[`${kind}Url`];
  const pathField = fields[`${kind}Path`];

  if (urlField) {
    urlField.value = state.media[kind].url;
  }

  if (pathField) {
    pathField.value = state.media[kind].publicId;
  }
}

function syncEditorImageRatio(kind, width = 0, height = 0) {
  const zone = $(`${kind}UploadZone`);
  if (!zone) return;

  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const ratio = numericWidth > 0 && numericHeight > 0 ? numericWidth / numericHeight : 0;
  const previewImage = $(`${kind}PreviewImage`);
  const hasPreview = Boolean(previewImage?.getAttribute("src"));

  if (Number.isFinite(ratio) && ratio > 0) {
    zone.style.setProperty("--lan-media-aspect-ratio", String(ratio));
    zone.dataset.mediaReady = "true";
  } else if (!hasPreview) {
    zone.style.removeProperty("--lan-media-aspect-ratio");
    zone.dataset.mediaReady = "false";
  }

  const intrinsic = kind === "after" && normalizeDisplayType(fields.displayType?.value) === DISPLAY_TYPES.SINGLE;
  if (intrinsic && zone.dataset.mediaReady === "true") zone.dataset.mediaFit = "intrinsic";
  else delete zone.dataset.mediaFit;
}

function clearImage(kind, { clearStored = false, markDirty = true } = {}) {
  revokeObjectUrl(kind);
  state.files[kind] = null;

  const input = $(`${kind}Image`);
  if (input) {
    input.value = "";
  }

  const preview = $(`${kind}Preview`);
  const previewImage = $(`${kind}PreviewImage`);

  if (previewImage) {
    previewImage.removeAttribute("src");
  }
  if (preview) {
    preview.classList.add("hidden");
  }
  syncEditorImageRatio(kind);

  setCount(`${kind}FileName`, "No file selected");
  setCount(`${kind}Resolution`, "—");
  setCount(`${kind}FileSize`, "—");

  if (clearStored) {
    setStoredMedia(kind, emptyMedia());
  }

  resetUploadProgress(kind);
  updateComparisonPreview();

  if (markDirty) {
    markFormDirty();
  }
}

function showMediaPreview(kind, source, details = {}) {
  const preview = $(`${kind}Preview`);
  const previewImage = $(`${kind}PreviewImage`);
  if (!preview || !previewImage || !source) {
    return;
  }

  previewImage.onerror = () => {
    previewImage.removeAttribute("src");
    preview.classList.add("hidden");
    showToast(`The ${kind} image could not be previewed.`, "error");
  };
  previewImage.onload = null;
  previewImage.src = source;
  preview.classList.remove("hidden");
  syncEditorImageRatio(kind, details.width, details.height);

  setCount(
    `${kind}FileName`,
    details.fileName || details.displayName || "Existing uploaded image"
  );
  setCount(
    `${kind}Resolution`,
    details.width && details.height
      ? `${details.width} × ${details.height}`
      : "Loading…"
  );
  setCount(`${kind}FileSize`, formatFileSize(details.bytes));

  if (!details.width || !details.height) {
    const image = new Image();
    image.onload = () => {
      setCount(
        `${kind}Resolution`,
        `${image.naturalWidth} × ${image.naturalHeight}`
      );
      syncEditorImageRatio(kind, image.naturalWidth, image.naturalHeight);
    };
    image.onerror = () => setCount(`${kind}Resolution`, "Unavailable");
    image.src = source;
  }
}

async function validateSelectedImage(file, input = null) {
  if (!(file instanceof File)) {
    throw new Error("Please choose an image file.");
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Only JPG, PNG, and WebP images are allowed.");
  }

  if (!file.size) {
    throw new Error("The selected image is empty or invalid.");
  }

  const maxUploadSize = uploadLimitMB() * 1024 * 1024;
  if (file.size > maxUploadSize) {
    showUploadLimitModal(file, input);
    throw createUploadLimitError(file);
  }

  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const details = {
        width: image.naturalWidth,
        height: image.naturalHeight
      };
      URL.revokeObjectURL(source);

      if (!details.width || !details.height) {
        reject(new Error("The selected image has invalid dimensions."));
        return;
      }

      resolve(details);
    };

    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("The selected image is corrupted or unreadable."));
    };

    image.src = source;
  });
}

async function chooseFile(kind, file) {
  if (!file) {
    return;
  }

  try {
    const dimensions = await validateSelectedImage(file, $(`${kind}Image`));

    revokeObjectUrl(kind);
    state.files[kind] = file;
    state.objectUrls[kind] = URL.createObjectURL(file);

    showMediaPreview(kind, state.objectUrls[kind], {
      fileName: file.name,
      width: dimensions.width,
      height: dimensions.height,
      bytes: file.size
    });

    updateComparisonPreview();
    markFormDirty();
  } catch (error) {
    console.error(`Invalid ${kind} image:`, error);
    if (error?.code !== "upload-limit-exceeded") {
      showToast(getErrorMessage(error, "The image is invalid."), "error");
    }

    const input = $(`${kind}Image`);
    if (input) {
      input.value = "";
    }
  }
}


function updateGallerySummary(message = "") {
  const total = state.galleryMedia.length + state.galleryFiles.length;

  if (elements.galleryImageCount) {
    elements.galleryImageCount.textContent =
      `${total} image${total === 1 ? "" : "s"} selected`;
  }

  if (elements.galleryUploadStatus) {
    elements.galleryUploadStatus.textContent =
      message || (total ? "Gallery ready to save" : "No gallery images selected");
  }

  elements.galleryEmptyState?.classList.toggle("hidden", total > 0);
}

function galleryPreviewItems() {
  return [
    ...state.galleryMedia.map((media, index) => ({
      source: resolvePhotoCardMediaSource(media),
      stored: true,
      index,
      name: media.displayName || media.originalFilename || `Gallery image ${index + 1}`
    })),
    ...state.galleryFiles.map((file, index) => ({
      source: state.galleryObjectUrls[index],
      stored: false,
      index,
      name: file.name
    }))
  ];
}

function renderGalleryEditorPreview() {
  const grid = elements.galleryImageGrid;
  if (!grid) {
    return;
  }

  grid.querySelectorAll(".gallery-editor-item").forEach(item => item.remove());

  galleryPreviewItems().forEach((item, visualIndex) => {
    const wrapper = document.createElement("article");
    wrapper.className = "gallery-editor-item lan-media-gallery-item";

    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    setImageWithFallback(
      image,
      item.source,
      `Gallery image ${visualIndex + 1}: ${item.name}`
    );

    const footer = document.createElement("div");
    footer.className = "gallery-editor-item-footer";

    const position = document.createElement("span");
    position.textContent = String(visualIndex + 1);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "editor-danger-button button-compact gallery-remove-image";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.name}`);

    remove.addEventListener("click", () => {
      if (item.stored) {
        state.galleryMedia.splice(item.index, 1);
      } else {
        URL.revokeObjectURL(state.galleryObjectUrls[item.index]);
        state.galleryObjectUrls.splice(item.index, 1);
        state.galleryFiles.splice(item.index, 1);
      }

      renderGalleryEditorPreview();
      updateGallerySummary("Gallery image removed. Save to apply the change.");
      markFormDirty();
    });

    footer.append(position, remove);
    wrapper.append(image, footer);
    grid.append(wrapper);
  });

  updateGallerySummary();
}

async function chooseGalleryFiles(fileList) {
  const files = [...(fileList || [])];

  if (!files.length) {
    return;
  }

  const currentCount = state.galleryMedia.length + state.galleryFiles.length;
  const availableSlots = Math.max(0, MAX_GALLERY_IMAGES - currentCount);

  if (!availableSlots) {
    showToast(`A gallery can contain up to ${MAX_GALLERY_IMAGES} images.`, "error");
    return;
  }

  const acceptedFiles = files.slice(0, availableSlots);
  const rejectedCount = files.length - acceptedFiles.length;
  let added = 0;

  for (const file of acceptedFiles) {
    try {
      await validateSelectedImage(file, elements.galleryImages);
      state.galleryFiles.push(file);
      state.galleryObjectUrls.push(URL.createObjectURL(file));
      added += 1;
    } catch (error) {
      console.error("Invalid gallery image:", error);
      if (error?.code !== "upload-limit-exceeded") {
        showToast(`${file.name}: ${getErrorMessage(error, "Invalid image.")}`, "error");
      }
    }
  }

  if (elements.galleryImages) {
    elements.galleryImages.value = "";
  }

  renderGalleryEditorPreview();
  markFormDirty();

  if (rejectedCount > 0) {
    showToast(
      `${added} image${added === 1 ? "" : "s"} added. ${rejectedCount} exceeded the ${MAX_GALLERY_IMAGES}-image limit.`,
      "error"
    );
  } else if (added > 0) {
    showToast(`${added} gallery image${added === 1 ? "" : "s"} added.`);
  }
}

function clearGallery({ clearStored = true, markDirty = true } = {}) {
  state.galleryObjectUrls.forEach(url => URL.revokeObjectURL(url));
  state.galleryObjectUrls = [];
  state.galleryFiles = [];

  if (clearStored) {
    state.galleryMedia = [];
  }

  if (elements.galleryImages) {
    elements.galleryImages.value = "";
  }

  renderGalleryEditorPreview();
  updateGallerySummary("Gallery cleared. Save to apply the change.");

  if (markDirty) {
    markFormDirty();
  }
}

function initializeGalleryUploadControl() {
  const input = elements.galleryImages;
  const zone = elements.galleryUploadZone;

  if (!input || !zone) {
    return;
  }

  const openPicker = () => input.click();

  zone.addEventListener("click", event => {
    if (!event.target.closest("button")) {
      openPicker();
    }
  });

  zone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });

  zone.addEventListener("dragenter", event => {
    event.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", event => {
    if (!zone.contains(event.relatedTarget)) {
      zone.classList.remove("dragover");
    }
  });

  zone.addEventListener("drop", event => {
    event.preventDefault();
    zone.classList.remove("dragover");
    chooseGalleryFiles(event.dataTransfer.files);
  });

  input.addEventListener("change", () => chooseGalleryFiles(input.files));
  elements.uploadGalleryButton?.addEventListener("click", openPicker);
  elements.addGalleryImagesButton?.addEventListener("click", openPicker);
  elements.clearGalleryButton?.addEventListener("click", () => clearGallery());

  resetUploadProgress("gallery");
  renderGalleryEditorPreview();
}

function updateProjectTypeUI() {
  syncDisplayTypeCards();
  const type = normalizeDisplayType(fields.displayType?.value);
  const isComparison = type === DISPLAY_TYPES.COMPARISON;
  const isSingle = type === DISPLAY_TYPES.SINGLE;
  const isGallery = type === DISPLAY_TYPES.GALLERY;
  const editorBody = document.querySelector("#sampleModal .photo-editor-body");
  if (editorBody) editorBody.dataset.displayType = type;

  elements.beforeImageSection?.classList.toggle("hidden", !isComparison);
  elements.afterImageSection?.classList.toggle("hidden", isGallery);
  elements.comparisonPreviewSection?.classList.toggle("hidden", !isComparison);
  elements.galleryImagesSection?.classList.toggle("hidden", !isGallery);

  const afterHeading = elements.afterImageSection?.querySelector(".card-header h3");
  const afterDescription = elements.afterImageSection?.querySelector(".card-header p");

  if (afterHeading) {
    afterHeading.textContent = isSingle ? "Final Showcase Image" : "After Image";
  }

  if (afterDescription) {
    afterDescription.textContent = isSingle
      ? "Upload the finished image visitors will see."
      : "Upload the finished edited image.";
  }

  syncEditorImageRatio("after");

  if (fields.comparison) {
    fields.comparison.disabled = !isComparison;
    if (!isComparison) {
      fields.comparison.checked = false;
    }
  }

  updateComparisonPreview();
}

function resetUploadProgress(kind) {
  const container = $(`${kind}Progress`);
  if (!container) {
    return;
  }

  const fill = container.querySelector(".progress-fill");
  if (fill) {
    fill.style.width = "0%";
  }

  container.setAttribute("role", "progressbar");
  container.setAttribute("aria-valuemin", "0");
  container.setAttribute("aria-valuemax", "100");
  container.setAttribute("aria-valuenow", "0");
  container.classList.add("hidden");
}

function updateUploadProgress(kind, progress) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  const container = $(`${kind}Progress`);
  if (!container) {
    return;
  }

  const fill = container.querySelector(".progress-fill");
  if (fill) {
    fill.style.width = `${safeProgress}%`;
  }

  container.classList.remove("hidden");
  container.setAttribute("aria-valuenow", String(Math.round(safeProgress)));
  container.setAttribute(
    "aria-label",
    `${kind} image upload ${Math.round(safeProgress)} percent`
  );
}

function setComparisonImage(image, source) {
  if (!image) {
    return;
  }

  if (!source) {
    image.removeAttribute("src");
    image.classList.remove("is-loaded");
    return;
  }

  if (image.src === source) {
    image.classList.add("is-loaded");
    return;
  }

  image.classList.remove("is-loaded");

  const reveal = () => {
    window.requestAnimationFrame(() => {
      image.classList.add("is-loaded");
    });
  };

  image.onload = reveal;
  image.onerror = () => {
    image.removeAttribute("src");
    image.classList.remove("is-loaded");
    showToast("A comparison image could not be previewed.", "error");
  };

  image.src = source;

  if (image.complete) {
    reveal();
  }
}

function updateComparisonPreview() {
  const beforeSource = state.objectUrls.before || resolvePhotoCardMediaSource(state.media.before);
  const afterSource = state.objectUrls.after || resolvePhotoCardMediaSource(state.media.after);
  const hasComparison = Boolean(beforeSource && afterSource);

  /*
   * Professional layered comparison:
   * - AFTER is the full base image.
   * - BEFORE is clipped over the left side.
   * Both images always occupy the exact same frame.
   */
  setComparisonImage(elements.comparisonBefore, beforeSource);
  setComparisonImage(elements.comparisonAfter, afterSource);

  elements.comparisonContainer?.classList.toggle(
    "has-comparison",
    hasComparison
  );

  elements.comparisonContainer?.classList.toggle(
    "has-before-only",
    Boolean(beforeSource && !afterSource)
  );

  elements.comparisonContainer?.classList.toggle(
    "has-after-only",
    Boolean(afterSource && !beforeSource)
  );

  const emptyMessage = elements.comparisonEmptyMessage;
  if (emptyMessage) {
    const heading = emptyMessage.querySelector("strong");
    const detail = emptyMessage.querySelector("span");
    if (beforeSource && !afterSource) {
      if (heading) heading.textContent = "Before image ready";
      if (detail) detail.textContent = "Add the After image to activate the comparison slider.";
    } else if (afterSource && !beforeSource) {
      if (heading) heading.textContent = "After image ready";
      if (detail) detail.textContent = "Add the Before image to activate the comparison slider.";
    } else {
      if (heading) heading.textContent = "Upload both images to compare";
      if (detail) detail.textContent = "The original will appear on the left and the edited result on the right.";
    }
  }

  setMainSliderPosition(50);
}


function setMainSliderPosition(percentage) {
  const container = elements.comparisonContainer;
  const slider = elements.comparisonSlider;
  const revealLayer = elements.comparisonRevealLayer;

  if (!container || !slider || !revealLayer) {
    return;
  }

  const numericPosition = Number(percentage);
  const safePercentage = Math.max(
    0,
    Math.min(100, Number.isFinite(numericPosition) ? numericPosition : 50)
  );

  container.style.setProperty(
    "--comparison-position",
    `${safePercentage}%`
  );

  revealLayer.style.clipPath =
    `inset(0 ${100 - safePercentage}% 0 0)`;

  slider.style.left = `${safePercentage}%`;
  slider.setAttribute(
    "aria-valuenow",
    String(Math.round(safePercentage))
  );
}

function initializeMainSlider() {
  const container = elements.comparisonContainer;
  const slider = elements.comparisonSlider;

  if (!container || !slider) {
    return;
  }

  let dragging = false;
  let animationFrame = 0;
  let pendingPosition = 50;

  const positionFromPointer = event => {
    const rectangle = container.getBoundingClientRect();

    if (!rectangle.width) {
      return 50;
    }

    return (
      (event.clientX - rectangle.left) /
      rectangle.width
    ) * 100;
  };

  const schedulePosition = position => {
    pendingPosition = position;

    if (animationFrame) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => {
      setMainSliderPosition(pendingPosition);
      animationFrame = 0;
    });
  };

  const beginDrag = event => {
    if (!container.classList.contains("has-comparison")) {
      return;
    }

    event.preventDefault();
    dragging = true;
    container.classList.add("is-dragging");
    window.getSelection?.()?.removeAllRanges();
    container.setPointerCapture?.(event.pointerId);
    schedulePosition(positionFromPointer(event));
  };

  const continueDrag = event => {
    if (!dragging) {
      return;
    }

    event.preventDefault();
    window.getSelection?.()?.removeAllRanges();
    schedulePosition(positionFromPointer(event));
  };

  const endDrag = event => {
    if (!dragging) {
      return;
    }

    dragging = false;
    container.classList.remove("is-dragging");

    if (
      event?.pointerId !== undefined &&
      container.hasPointerCapture?.(event.pointerId)
    ) {
      container.releasePointerCapture?.(event.pointerId);
    }
  };

  container.addEventListener("pointerdown", beginDrag);
  container.addEventListener("pointermove", continueDrag);
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", endDrag);
  container.addEventListener("lostpointercapture", endDrag);

  container.addEventListener("dragstart", event => {
    event.preventDefault();
  });

  container.querySelectorAll("img").forEach(image => {
    image.draggable = false;
    image.addEventListener(
      "dragstart",
      event => event.preventDefault()
    );
  });

  slider.addEventListener("keydown", event => {
    let value =
      Number(slider.getAttribute("aria-valuenow")) || 50;

    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowDown"
    ) {
      value -= event.shiftKey ? 10 : 3;
    } else if (
      event.key === "ArrowRight" ||
      event.key === "ArrowUp"
    ) {
      value += event.shiftKey ? 10 : 3;
    } else if (event.key === "Home") {
      value = 0;
    } else if (event.key === "End") {
      value = 100;
    } else {
      return;
    }

    event.preventDefault();
    setMainSliderPosition(value);
  });

  setMainSliderPosition(50);
}

function updateCharacterCounters() {
  [
    [fields.title, "titleCounter"],
    [fields.short, "shortCounter"],
    [fields.description, "descriptionCounter"],
    [fields.seoTitle, "seoTitleCounter"],
    [fields.seoDescription, "seoDescriptionCounter"]
  ].forEach(([field, counterId]) => {
    if (field) {
      setCount(counterId, field.value.length);
    }
  });
}

function setCheckedValues(name, values = []) {
  const selectedValues = new Set(Array.isArray(values) ? values : []);

  document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
    input.checked = selectedValues.has(input.value);
  });
}

function hasRequiredEditorElements() {
  const required = [
    elements.sampleForm,
    fields.id,
    fields.title,
    fields.slug,
    fields.category,
    fields.order,
    fields.status,
    fields.short,
    fields.description,
    fields.seoTitle,
    fields.seoDescription,
    fields.seoKeywords,
    fields.featured,
    fields.comparison,
    fields.fullscreen,
    fields.publish
  ];

  return required.every(Boolean);
}

function resetForm() {
  resetTemporaryImageState();

  if (!hasRequiredEditorElements()) {
    showToast("The sample form is incomplete or unavailable on this page.", "error");
    return false;
  }

  elements.sampleForm.reset();

  fields.id.value = "";
  fields.order.value = "1";
  setPhotoSelectValue(fields.status, DEFAULT_STATUS, DEFAULT_STATUS);
  renderSampleCategoryOptions(DEFAULT_CATEGORY);
  if (fields.customCategory) fields.customCategory.value = "";
  updateCustomCategoryUI();
  fields.comparison.checked = true;
  fields.fullscreen.checked = true;
  fields.publish.checked = false;
  fields.slug.dataset.edited = "";
  if (fields.displayType) {
    fields.displayType.value = DISPLAY_TYPES.COMPARISON;
  }

  setStoredMedia("before", emptyMedia());
  setStoredMedia("after", emptyMedia());
  state.galleryMedia = [];
  clearGallery({ clearStored: true, markDirty: false });

  selectedPhotoSkillIds = [];
  selectedPhotoToolIds = [];
  if (fields.inheritCapabilityProfile) fields.inheritCapabilityProfile.checked = true;
  renderPhotoCapabilitySelectors();
  renderInheritedPhotoCapabilities();
  setCheckedValues("techniques", []);
  if (fields.customTechnique) fields.customTechnique.value = "";
  updateCustomTechniqueUI("techniques", elements.customTechniqueGroup, fields.customTechnique);

  IMAGE_KINDS.forEach(kind => clearImage(kind, {
    clearStored: false,
    markDirty: false
  }));

  if (elements.sampleModalTitle) {
    elements.sampleModalTitle.textContent = "New Photo Editing Sample";
  }
  updateCharacterCounters();
  updateCustomCategoryUI();
  updateCustomTechniqueUI("techniques", elements.customTechniqueGroup, fields.customTechnique);
  updateProjectTypeUI();
  syncDisplayTypeCards();
  updateComparisonPreview();
  state.formDirty = false;
  return true;
}

function setPhotoSelectValue(select, value, fallback = "") {
  if (!select) return false;
  if (window.LANSetSelectValue) {
    return window.LANSetSelectValue(select, value, fallback);
  }
  const resolved = findSelectValue(select, value);
  const fallbackValue = findSelectValue(select, fallback);
  const option = [...select.options].find((item) => item.value === resolved);
  select.value = option?.value || fallbackValue || "";
  return Boolean(option);
}

function findSelectValue(select, desiredValue) {
  if (!select) return desiredValue;
  const token = (value) => String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\/_–—-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const desired = token(desiredValue);
  const matchingOption = [...select.options].find((option) =>
    token(option.value) === desired || token(option.textContent) === desired
  );
  return matchingOption?.value || desiredValue;
}

async function openNewProject() {
  await loadPhotoCapabilityLibrary();
  await loadPhotoCapabilityProfile();
  if (!resetForm()) {
    return;
  }

  openModal(elements.sampleModal, fields.title);
}

async function editProject(project) {
  await loadPhotoCapabilityLibrary();
  await loadPhotoCapabilityProfile();
  if (!project || !resetForm()) {
    return;
  }

  const beforeMedia = normalizeProjectMedia(project, "before");
  const afterMedia = normalizeProjectMedia(project, "after");
  const seo = project.seo || {};
  const displayType = getProjectDisplayType(project);
  const galleryMedia = getProjectGalleryMedia(project);

  fields.id.value = project.id;
  fields.title.value = project.title || "";
  fields.slug.value = project.slug || "";
  fields.slug.dataset.edited = "true";
  const savedCategory = normalizePhotoCategoryLabel(project.category || DEFAULT_CATEGORY);
  if (savedCategory && !photoCapabilityProfile.categories.some((item) => capabilityCategoryKey(item) === capabilityCategoryKey(savedCategory))) {
    photoCapabilityProfile = normalizePhotoCapabilityProfile({ ...photoCapabilityProfile, categories: [...photoCapabilityProfile.categories, savedCategory] });
  }
  renderSampleCategoryOptions(savedCategory);
  if (fields.customCategory) fields.customCategory.value = "";
  updateCustomCategoryUI();
  if (fields.displayType) {
    fields.displayType.value = findSelectValue(
      fields.displayType,
      displayType
    );
  }
  fields.order.value = String(Math.max(0, Number(project.displayOrder) || 0));
  setPhotoSelectValue(
    fields.status,
    normalizeStatus(project.status),
    DEFAULT_STATUS
  );
  fields.short.value = project.shortDescription || "";
  fields.description.value = project.description || "";
  fields.seoTitle.value = seo.title || project.seoTitle || "";
  fields.seoDescription.value =
    seo.description || project.seoDescription || "";

  const keywords = Array.isArray(seo.keywords)
    ? seo.keywords
    : Array.isArray(project.seoKeywords)
      ? project.seoKeywords
      : String(project.seoKeywords || "")
          .split(",")
          .map(keyword => keyword.trim())
          .filter(Boolean);

  fields.seoKeywords.value = keywords.join(", ");
  fields.featured.checked = project.featured === true;
  fields.comparison.checked = project.showComparison !== false;
  fields.fullscreen.checked = project.allowFullscreen !== false;
  fields.publish.checked = false;

  setStoredMedia("before", beforeMedia);
  setStoredMedia("after", afterMedia);
  state.galleryMedia = galleryMedia;
  renderGalleryEditorPreview();

  if (!photoCapabilityLibrary.length) await loadPhotoCapabilityLibrary();
  setPhotoProjectCapabilities(project);
  splitKnownAndCustomValues("techniques", project.techniques || []);
  updateCustomTechniqueUI("techniques", elements.customTechniqueGroup, fields.customTechnique);

  const beforeSource = resolvePhotoCardMediaSource(beforeMedia);
  const afterSource = resolvePhotoCardMediaSource(afterMedia);
  if (beforeSource) {
    showMediaPreview("before", beforeSource, beforeMedia);
  }

  if (afterSource) {
    showMediaPreview("after", afterSource, afterMedia);
  }

  if (elements.sampleModalTitle) {
    elements.sampleModalTitle.textContent = "Edit Photo Editing Sample";
  }
  updateCharacterCounters();
  updateProjectTypeUI();
  updateComparisonPreview();
  state.formDirty = false;
  renderProjects();
  openModal(elements.sampleModal, fields.title);
}

function validateProjectImages() {
  const displayType = normalizeDisplayType(fields.displayType?.value);
  const hasBefore = Boolean(state.files.before || mediaHasReference(state.media.before));
  const hasAfter = Boolean(state.files.after || mediaHasReference(state.media.after));
  const galleryCount = state.galleryMedia.length + state.galleryFiles.length;

  if (displayType === DISPLAY_TYPES.COMPARISON && (!hasBefore || !hasAfter)) {
    throw new Error(
      "Both Before and After images are required for a comparison sample."
    );
  }

  if (displayType === DISPLAY_TYPES.SINGLE && !hasAfter) {
    throw new Error("A final showcase image is required.");
  }

  if (displayType === DISPLAY_TYPES.GALLERY && galleryCount < 2) {
    throw new Error("A gallery sample requires at least two images.");
  }

}

function collectProjectData(mediaOverrides = {}) {
  const beforeImage = normalizeMedia(
    mediaOverrides.before || state.media.before
  );
  const afterImage = normalizeMedia(
    mediaOverrides.after || state.media.after
  );

  return {
    title: fields.title.value,
    slug: fields.slug.value,
    category: resolvedCategoryValue(),
    projectDisplayType: normalizeDisplayType(fields.displayType?.value),
    galleryImages: normalizeGalleryMedia(
      mediaOverrides.gallery || state.galleryMedia
    ),
    displayOrder: Math.max(0, Number(fields.order.value) || 0),
    status: fields.publish.checked
      ? "published"
      : normalizeStatus(fields.status.value),
    shortDescription: fields.short.value,
    description: fields.description.value,
    inheritCapabilityProfile: fields.inheritCapabilityProfile?.checked !== false,
    entrySkillIds: normalizeReferenceIds(selectedPhotoSkillIds),
    entryToolIds: normalizeReferenceIds(selectedPhotoToolIds),
    capabilityProfileVersion: photoCapabilityProfile.version || 2,
    skillIds: effectivePhotoCapabilities(resolvedCategoryValue()).skillIds,
    toolIds: effectivePhotoCapabilities(resolvedCategoryValue()).toolIds,
    software: effectivePhotoCapabilities(resolvedCategoryValue()).toolIds.map((id) => capabilityRecordById(id)?.name).filter(Boolean),
    techniques: checkedTechniqueValues("techniques"),
    seo: {
      title: fields.seoTitle.value,
      description: fields.seoDescription.value,
      keywords: fields.seoKeywords.value
    },
    featured: fields.featured.checked,
    showComparison:
      normalizeDisplayType(fields.displayType?.value) === DISPLAY_TYPES.COMPARISON &&
      fields.comparison.checked,
    allowFullscreen: fields.fullscreen.checked,
    beforeImage,
    afterImage
  };
}

async function uploadPendingImages(projectId) {
  const displayType = normalizeDisplayType(fields.displayType?.value);
  const uploadedMedia = {
    before: state.media.before,
    after: state.media.after,
    gallery: [...state.galleryMedia]
  };
  const uploadedDuringAttempt = [];

  try {
    const kindsToUpload =
      displayType === DISPLAY_TYPES.COMPARISON
        ? IMAGE_KINDS
        : displayType === DISPLAY_TYPES.SINGLE
          ? ["after"]
          : [];

    for (const kind of kindsToUpload) {
      const file = state.files[kind];
      if (!file) continue;
      updateUploadProgress(kind, 0);
      try {
        const uploaded = normalizeMedia(
          await uploadPhotoEditingImage(
            file,
            projectId,
            kind,
            progress => updateUploadProgress(kind, progress)
          )
        );
        uploadedMedia[kind] = uploaded;
        uploadedDuringAttempt.push(uploaded);
      } finally {
        window.setTimeout(() => resetUploadProgress(kind), 350);
      }
    }

    if (displayType === DISPLAY_TYPES.GALLERY && state.galleryFiles.length) {
      const startingCount = uploadedMedia.gallery.length;
      for (let index = 0; index < state.galleryFiles.length; index += 1) {
        const file = state.galleryFiles[index];
        const overallProgress = progress => {
          const completed = index;
          const partial = Math.max(0, Math.min(100, Number(progress) || 0)) / 100;
          const totalProgress = ((completed + partial) / state.galleryFiles.length) * 100;
          updateUploadProgress("gallery", totalProgress);
        };
        const uploaded = normalizeMedia(
          await uploadPhotoEditingImage(
            file,
            projectId,
            `gallery-${startingCount + index + 1}`,
            overallProgress
          )
        );
        uploadedMedia.gallery.push(uploaded);
        uploadedDuringAttempt.push(uploaded);
      }
      updateUploadProgress("gallery", 100);
      window.setTimeout(() => resetUploadProgress("gallery"), 350);
    }

    return uploadedMedia;
  } catch (error) {
    await discardTemporaryMediaAssets(uploadedDuringAttempt, { reason: "photo-editing-upload-failed" });
    throw error;
  }
}

async function saveProject(event) {
  // Custom categories must contain a meaningful label.

  event.preventDefault();

  if (state.saving) {
    return;
  }

  if (isCreateCategoryOption(fields.category?.value) && !resolvedCategoryValue()) {
    fields.customCategory?.focus();
    showToast("Enter a category name before saving.", "error");
    return;
  }

  if (window.LANValidateForm ? !window.LANValidateForm(elements.sampleForm, { title: "Complete Photo Editing" }) : !elements.sampleForm.reportValidity()) {
    return;
  }

  let projectId = fields.id.value.trim();
  let createdDuringSave = false;
  let uploadedMedia = null;

  try {
    if (isCreateCategoryOption(fields.category?.value)) {
      await persistNewPhotoCategory(fields.customCategory?.value);
    }
    validateProjectImages();
    setFormSubmitting(true);
    setLoading(true, "Saving photo editing sample...");

    if (!projectId) {
      projectId = await createPhotoEditingProject(collectProjectData());
      fields.id.value = projectId;
      createdDuringSave = true;
    }

    uploadedMedia = await uploadPendingImages(projectId);
    await updatePhotoEditingProject(
      projectId,
      collectProjectData(uploadedMedia)
    );

    setStoredMedia("before", uploadedMedia.before);
    setStoredMedia("after", uploadedMedia.after);
    state.galleryMedia = normalizeGalleryMedia(uploadedMedia.gallery);
    resetTemporaryImageState();
    state.formDirty = false;

    fields.id.value = "";
    closeModal(elements.sampleModal);
    showToast("Photo editing sample saved.");
    await loadProjects();
  } catch (error) {
    console.error("Unable to save photo editing sample:", error);
    if (uploadedMedia) {
      await discardTemporaryMediaAssets(uploadedMedia, { reason: "photo-editing-save-failed" });
    }

    if (createdDuringSave && projectId) {
      try {
        await removePhotoEditingProject(projectId);
      } catch (cleanupError) {
        console.error(
          "Unable to soft-delete the incomplete project:",
          cleanupError
        );
      }

      fields.id.value = "";
    }

    showToast(
      getErrorMessage(error, "The sample could not be saved."),
      "error"
    );
  } finally {
    setFormSubmitting(false);
    setLoading(false);
  }
}

function photoPreviewAssetUrl(value = null) {
  if (!value) return "";
  return resolveAdminMediaAssetUrl(value);
}

function resolvePhotoPreviewDisplayType(project = {}, beforeMedia = {}, afterMedia = {}, galleryMedia = []) {
  const configured = getProjectDisplayType(project);
  if (configured === DISPLAY_TYPES.GALLERY && galleryMedia.length) return DISPLAY_TYPES.GALLERY;
  const beforeUrl = photoPreviewAssetUrl(beforeMedia);
  const afterUrl = photoPreviewAssetUrl(afterMedia);
  if (beforeUrl && afterUrl && beforeUrl !== afterUrl) return DISPLAY_TYPES.COMPARISON;
  if (configured === DISPLAY_TYPES.COMPARISON && beforeUrl && afterUrl) return DISPLAY_TYPES.COMPARISON;
  return DISPLAY_TYPES.SINGLE;
}

function photoPreviewCapabilityItems(project = {}, category = "") {
  const hasEntryCapabilityFields = Array.isArray(project.entrySkillIds) || Array.isArray(project.entryToolIds);
  const portfolioSkillIds = new Set(normalizeReferenceIds(project.moduleSkillIds || photoCapabilityProfile.legacyModuleSkillIds));
  const portfolioToolIds = new Set(normalizeReferenceIds(project.moduleToolIds || photoCapabilityProfile.legacyModuleToolIds));
  const entrySkillIds = hasEntryCapabilityFields
    ? normalizeReferenceIds(project.entrySkillIds)
    : normalizeReferenceIds(project.skillIds || []).filter((id) => !portfolioSkillIds.has(id));
  const entryToolIds = hasEntryCapabilityFields
    ? normalizeReferenceIds(project.entryToolIds)
    : normalizeReferenceIds(project.toolIds || []).filter((id) => !portfolioToolIds.has(id));
  const effective = effectivePhotoCapabilities(category, entrySkillIds, entryToolIds, project.inheritCapabilityProfile !== false, photoCapabilityProfile);
  const structured = [
    ...effective.skillIds.map((id) => ({ recordType: "skill", record: capabilityRecordById(id) })),
    ...effective.toolIds.map((id) => ({ recordType: "tool", record: capabilityRecordById(id) }))
  ].filter((item) => item.record).map(({ recordType, record }) => ({
    name: String(record.name || record.title || "").trim(),
    category: String(record.category || "").trim(),
    icon: String(record.icon || record.logo || "").trim(),
    recordType
  })).filter((item) => item.name);

  const seen = new Set(structured.map((item) => item.name.toLowerCase()));
  const legacy = [
    ...(Array.isArray(project.software) ? project.software : []),
    ...(Array.isArray(project.techniques) ? project.techniques : [])
  ].map((value) => String(value || "").trim()).filter(Boolean).filter((label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...structured, ...legacy];
}

function previewProject(project) {
  if (!project || !elements.previewModal || !elements.previewBody) return;
  const beforeMedia = normalizeProjectMedia(project, "before");
  const afterMedia = normalizeProjectMedia(project, "after");
  const galleryMedia = getProjectGalleryMedia(project);
  const previewDisplayType = resolvePhotoPreviewDisplayType(project, beforeMedia, afterMedia, galleryMedia);

  state.previewSliderCleanup?.();
  state.previewSliderCleanup = null;

  if (elements.previewModalTitle) elements.previewModalTitle.textContent = "Sample Preview";
  if (elements.previewModalContext) {
    const category = String(project.category || project.projectCategory || "Photo Editing").trim();
    elements.previewModalContext.textContent = [category, project.status === "published" ? "Published" : "Draft", project.visible === false ? "Hidden" : "Visible"].filter(Boolean).join(" · ");
  }

  const blocks = [];
  const category = String(project.category || project.projectCategory || "Photo Editing").trim();
  const identityChips = [
    project.status === "published" ? "Published" : "Draft",
    project.visible === false ? "Hidden" : "Visible",
    previewDisplayType === DISPLAY_TYPES.GALLERY ? "Gallery" : previewDisplayType === DISPLAY_TYPES.SINGLE ? "Single image" : "Before & After"
  ];
  blocks.push({
    type: ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY,
    role: "creative-work",
    title: project.title || "Untitled sample",
    eyebrow: category || "Photo Editing",
    chips: identityChips
  });
  if (previewDisplayType === DISPLAY_TYPES.GALLERY) {
    const items = galleryMedia.map((media, index) => ({ src: photoPreviewAssetUrl(media), alt: `${project.title || "Sample"} gallery image ${index + 1}` })).filter((item) => item.src);
    if (items.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.GALLERY, title: "Gallery", items, limit: 12 });
  } else if (previewDisplayType === DISPLAY_TYPES.SINGLE) {
    const src = photoPreviewAssetUrl(afterMedia) || photoPreviewAssetUrl(beforeMedia);
    if (src) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, src, alt: `Final artwork: ${project.title || "Sample"}` });
  } else {
    blocks.push({
      type: ADMIN_PREVIEW_BLOCK_TYPES.COMPARISON,
      title: "Before & After",
      before: { src: photoPreviewAssetUrl(beforeMedia), alt: `Before editing: ${project.title || "Sample"}` },
      after: { src: photoPreviewAssetUrl(afterMedia), alt: `After editing: ${project.title || "Sample"}` }
    });
  }

  const description = String(project.description || project.shortDescription || "").trim();
  if (description) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW, title: "Overview", body: description });

  const capabilityItems = photoPreviewCapabilityItems(project, category);
  if (capabilityItems.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.CHIPS, role: "capabilities", title: "Skills & Tools", items: capabilityItems });

  renderAdminPreview(elements.previewBody, {
    mode: "media-first",
    blocks,
    system: [
      project.id ? { label: "Record ID", value: project.id } : null,
      { label: "Status", value: project.status || "draft" }
    ].filter(Boolean)
  });

  if (previewDisplayType === DISPLAY_TYPES.COMPARISON) {
    state.previewSliderCleanup = initializePreviewComparison(elements.previewBody, { position: 50 });
  }
  if (previewDisplayType === DISPLAY_TYPES.GALLERY) {
    const items = galleryMedia.filter((media) => photoPreviewAssetUrl(media));
    elements.previewBody.querySelectorAll("[data-preview-gallery-index]").forEach((button) => {
      button.addEventListener("click", () => openGalleryLightbox(items, Number(button.dataset.previewGalleryIndex) || 0, project.title || "Gallery"));
    });
  }

  openModal(elements.previewModal, elements.closePreview);
}

function openGalleryLightbox(media, startIndex, title) {
  if (!media.length) {
    return;
  }

  let index = Math.max(0, Math.min(media.length - 1, startIndex));
  const overlay = document.createElement("div");
  overlay.className = "gallery-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${title} gallery`);

  const image = document.createElement("img");
  const counter = document.createElement("span");
  counter.className = "gallery-lightbox-counter";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "gallery-lightbox-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close gallery");

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "gallery-lightbox-previous";
  previous.textContent = "←";
  previous.setAttribute("aria-label", "Previous image");

  const next = document.createElement("button");
  next.type = "button";
  next.className = "gallery-lightbox-next";
  next.textContent = "→";
  next.setAttribute("aria-label", "Next image");

  const render = () => {
    setImageWithFallback(
      image,
      resolvePhotoCardMediaSource(media[index]),
      `${title}, image ${index + 1} of ${media.length}`
    );
    counter.textContent = `${index + 1} / ${media.length}`;
  };

  const remove = () => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };

  const onKeyDown = event => {
    if (event.key === "Escape") {
      remove();
    } else if (event.key === "ArrowLeft") {
      index = (index - 1 + media.length) % media.length;
      render();
    } else if (event.key === "ArrowRight") {
      index = (index + 1) % media.length;
      render();
    }
  };

  close.addEventListener("click", remove);
  previous.addEventListener("click", () => {
    index = (index - 1 + media.length) % media.length;
    render();
  });
  next.addEventListener("click", () => {
    index = (index + 1) % media.length;
    render();
  });
  overlay.addEventListener("click", event => {
    if (event.target === overlay) {
      remove();
    }
  });

  overlay.append(image, counter, close, previous, next);
  document.body.append(overlay);
  document.addEventListener("keydown", onKeyDown);
  render();
  close.focus();
}

function askDeleteProject(project) {
  if (!project?.id) {
    showToast("This sample cannot be deleted because its ID is missing.", "error");
    return;
  }

  state.pendingDeleteId = project.id;

  if (elements.deleteModalTitle) {
    elements.deleteModalTitle.textContent =
      `Move “${project.title || "Untitled Sample"}” to deleted samples?`;
  }

  openModal(elements.deleteModal, elements.confirmDelete);
}

async function confirmDeleteProject() {
  const project = state.projects.find(
    item => item.id === state.pendingDeleteId
  );

  if (!project) {
    closeModal(elements.deleteModal);
    state.pendingDeleteId = "";
    return;
  }

  setLoading(true, "Moving sample to deleted samples...");

  if (elements.confirmDelete) {
    elements.confirmDelete.disabled = true;
  }

  try {
    await removePhotoEditingProject(project.id);
    state.selectedIds.delete(project.id);
    state.pendingDeleteId = "";
    closeModal(elements.deleteModal);
    showToast("Sample moved to deleted samples.");
    await loadProjects();
  } catch (error) {
    console.error("Unable to soft-delete sample:", error);
    showToast(
      getErrorMessage(error, "The sample could not be deleted."),
      "error"
    );
  } finally {
    if (elements.confirmDelete) {
      elements.confirmDelete.disabled = false;
    }

    setLoading(false);
  }
}

async function runBulkUpdate(
  changes,
  {
    button = null,
    busyLabel = "Updating...",
    panelMessage = "Updating selected samples...",
    successMessage = "Samples updated successfully"
  } = {}
) {
  if (state.selectedIds.size === 0) {
    showToast("Select at least one sample.", "warning");
    return;
  }

  const ids = [...state.selectedIds];
  setActionButtonState(button, true, busyLabel);
  setPanelLoading(true, panelMessage);

  try {
    await updateManyPhotoEditingProjects(ids, changes);
    updateProjectsInMemory(ids, changes);
    refreshAffectedCardBadges(ids, changes);
    photoRecordSelection?.clear();
    showToast(successMessage, "success");
    return true;
  } catch (error) {
    console.error("Bulk sample update failed:", error);
    showToast(
      getErrorMessage(error, "The bulk update failed."),
      "error"
    );
    return false;
  } finally {
    setPanelLoading(false);
    setActionButtonState(button, false);
  }
}


async function deleteSelectedPhotoProjects(ids = []) {
  const cleanIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!cleanIds.length) return;
  setPanelLoading(true, "Moving selected samples to deleted samples...");
  try {
    await updateManyPhotoEditingProjects(cleanIds, { isDeleted: true });
    state.projects = state.projects.filter((project) => !cleanIds.includes(project.id));
    showToast(`${cleanIds.length} sample${cleanIds.length === 1 ? "" : "s"} moved to deleted samples.`, "success");
    await loadProjects();
  } finally {
    setPanelLoading(false);
  }
}

function initializeUploadControl(kind) {
  const capitalizedKind = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  const input = $(`${kind}Image`);
  const zone = $(`${kind}UploadZone`);
  const uploadButton = $(`upload${capitalizedKind}Button`);
  const replaceButton = $(`replace${capitalizedKind}Button`);
  const removeButton = $(`remove${capitalizedKind}Button`);

  if (!input || !zone) {
    return;
  }

  zone.tabIndex = 0;
  zone.setAttribute("role", "button");
  zone.setAttribute("aria-label", `Choose ${kind} image`);

  const openFilePicker = () => input.click();

  zone.addEventListener("click", event => {
    if (!event.target.closest("button")) {
      openFilePicker();
    }
  });

  zone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  });

  zone.addEventListener("dragenter", event => {
    event.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", event => {
    if (!zone.contains(event.relatedTarget)) {
      zone.classList.remove("dragover");
    }
  });

  zone.addEventListener("drop", event => {
    event.preventDefault();
    zone.classList.remove("dragover");
    chooseFile(kind, event.dataTransfer.files?.[0]);
  });

  input.addEventListener("change", () => {
    chooseFile(kind, input.files?.[0]);
  });

  uploadButton?.addEventListener("click", openFilePicker);
  replaceButton?.addEventListener("click", openFilePicker);

  removeButton?.addEventListener("click", () => {
    clearImage(kind, { clearStored: true });
    showToast(
      `${capitalizedKind} image removed from this sample. Save to apply the change.`
    );
  });

  resetUploadProgress(kind);
}

function initializeFilters() {
  const update = () => {
    state.currentPage = 1;
    applyFilters();
  };

  let searchTimer = 0;
  elements.searchInput?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(update, 120);
  });

  elements.categoryFilter?.addEventListener("change", update);
  elements.statusFilter?.addEventListener("change", update);
  elements.sortBy?.addEventListener("change", update);
}

function initializePagination() {
  elements.previousPage?.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      renderProjects();
      elements.photoLibrary?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  elements.nextPage?.addEventListener("click", () => {
    const totalPages = Math.max(
      1,
      recordLibraryPageCount(state.filteredProjects, PAGE_SIZE)
    );

    if (state.currentPage < totalPages) {
      state.currentPage += 1;
      renderProjects();
      elements.photoLibrary?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });
}

function setView(view) {
  state.view = view;
  const isGrid = view === "grid";

  elements.gridView?.classList.toggle("active", isGrid);
  elements.listView?.classList.toggle("active", !isGrid);
  elements.gridView?.setAttribute("aria-pressed", String(isGrid));
  elements.listView?.setAttribute("aria-pressed", String(!isGrid));
  renderProjects();
}

function initializeViewSwitch() {
  elements.gridView?.addEventListener("click", () => setView("grid"));
  elements.listView?.addEventListener("click", () => setView("list"));
}

function initializeFormEvents() {
  elements.sampleForm?.addEventListener("submit", saveProject);

  elements.sampleForm?.addEventListener("input", event => {
    if (event.target === fields.title) {
      if (!fields.id.value || fields.slug.dataset.edited !== "true") {
        fields.slug.value = slugify(fields.title.value);
      }
    }

    if (event.target === fields.slug) {
      fields.slug.dataset.edited = "true";
    }

    updateCharacterCounters();
    markFormDirty();
  });

  elements.sampleForm?.addEventListener("change", markFormDirty);

  fields.displayType?.addEventListener("change", () => {
    updateProjectTypeUI();
    markFormDirty();
  });

  elements.displayTypeCards
    ?.querySelectorAll("[data-display-type]")
    .forEach(card => {
      card.addEventListener("click", () => {
        fields.displayType.value = card.dataset.displayType;
        fields.displayType.dispatchEvent(new Event("change", { bubbles: true }));
      });

      card.addEventListener("keydown", event => {
        const cards = [
          ...elements.displayTypeCards.querySelectorAll("[data-display-type]")
        ];
        const currentIndex = cards.indexOf(card);
        let nextIndex = currentIndex;

        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          nextIndex = (currentIndex + 1) % cards.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          nextIndex = (currentIndex - 1 + cards.length) % cards.length;
        } else {
          return;
        }

        event.preventDefault();
        cards[nextIndex].click();
        cards[nextIndex].focus();
      });
    });

  fields.category?.addEventListener("change", () => {
    updateCustomCategoryUI();
    renderInheritedPhotoCapabilities();
    if (isCreateCategoryOption(fields.category.value)) {
      window.requestAnimationFrame(() => fields.customCategory?.focus());
    }
    markFormDirty();
  });

  elements.createCategoryButton?.addEventListener("click", async () => {
    const previous = elements.createCategoryButton.textContent;
    elements.createCategoryButton.disabled = true;
    elements.createCategoryButton.textContent = "Creating…";
    try {
      const category = await persistNewPhotoCategory(fields.customCategory?.value);
      showToast(`Category “${category}” created.`, "success");
      renderInheritedPhotoCapabilities();
      markFormDirty();
    } catch (error) {
      console.error("Unable to create Photo Editing category:", error);
      showToast(error.message || "The category could not be created.", "error");
      fields.customCategory?.focus();
    } finally {
      elements.createCategoryButton.disabled = false;
      elements.createCategoryButton.textContent = previous;
    }
  });

  document
    .querySelector('input[name="techniques"][value="Other"]')
    ?.addEventListener("change", event => {
      updateCustomTechniqueUI(
        "techniques",
        elements.customTechniqueGroup,
        fields.customTechnique
      );
      if (event.target.checked) {
        window.requestAnimationFrame(() => fields.customTechnique?.focus());
      }
      markFormDirty();
    });

  const bindCustomTechniqueComposer = (name, field, group) => {
    field?.addEventListener("keydown", event => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      const value = normalizeCustomTechniqueLabel(field.value);

      if (!value) {
        showToast("Type a name before pressing Enter.", "error");
        return;
      }

      const created = rememberCustomTechnique(name, value);
      field.value = "";

      if (created) {
        showToast(`${value} was added as a reusable checkbox.`);
      }

      updateCustomTechniqueUI(name, group, field);
      field.focus();
    });
  };

  bindCustomTechniqueComposer(
    "techniques",
    fields.customTechnique,
    elements.customTechniqueGroup
  );

  fields.inheritCapabilityProfile?.addEventListener("change", () => {
    renderInheritedPhotoCapabilities();
    markFormDirty();
  });

  fields.publish?.addEventListener("change", () => {
    if (fields.publish.checked) {
      setPhotoSelectValue(fields.status, "published", DEFAULT_STATUS);
    }
  });

  fields.status?.addEventListener("change", () => {
    if (normalizeStatus(fields.status.value) === "draft") {
      fields.publish.checked = false;
    }
  });
}

function closePreviewModal() {
  state.previewSliderCleanup?.();
  state.previewSliderCleanup = null;
  closeModal(elements.previewModal);
}

function initializeModalEvents() {
  document.querySelector(".photo-editor-tabs")?.addEventListener("lan:tabchange", () => {
    document.querySelector("#sampleModal .photo-editor-body")?.scrollTo({ top: 0, behavior: "auto" });
  });

  window.addEventListener("resize", () => {
    if (getVisibleModals().length) syncModalBodyLock();
  }, { passive: true });

  elements.chooseAnotherImageButton?.addEventListener(
    "click",
    chooseAnotherUploadImage
  );
  elements.closeUploadLimitModal?.addEventListener(
    "click",
    closeUploadLimitDialog
  );

  elements.closeModalButton?.addEventListener("click", closeEditorModal);
  elements.cancelButton?.addEventListener("click", closeEditorModal);
  elements.closePreview?.addEventListener("click", closePreviewModal);
  elements.cancelDelete?.addEventListener("click", () => {
    state.pendingDeleteId = "";
    closeModal(elements.deleteModal);
  });
  elements.confirmDelete?.addEventListener("click", confirmDeleteProject);

  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", event => {
      if (event.target !== overlay) {
        return;
      }

      const modal = overlay.closest(".modal");

      if (modal === elements.sampleModal) {
        closeEditorModal();
      } else if (modal === elements.uploadLimitModal) {
        closeUploadLimitDialog();
      } else if (modal === elements.previewModal) {
        closePreviewModal();
      } else {
        closeModal(modal);
      }
    });
  });

  document.addEventListener("keydown", event => {
    trapModalFocus(event);

    if (event.key !== "Escape") {
      return;
    }

    if (window.LANCloseActiveCapabilityPicker?.()) {
      event.preventDefault();
      return;
    }

    const topModal = getVisibleModals().at(-1);
    if (!topModal) {
      return;
    }

    event.preventDefault();

    if (topModal === elements.sampleModal) {
      closeEditorModal();
    } else if (topModal === elements.uploadLimitModal) {
      closeUploadLimitDialog();
    } else if (topModal === elements.previewModal) {
      closePreviewModal();
    } else {
      closeModal(topModal);
    }
  });
}

function initializeSidebar() {
  // Shared Admin shell ownership lives in admin-ui.js.
  // This module intentionally does not bind competing sidebar handlers.
}

function initializeButtons() {
  [
    elements.addSampleButton,
    elements.newPhotoButton,
    elements.emptyAddButton
  ].forEach(button => button?.addEventListener("click", openNewProject));

  [elements.capabilityProfileButton, elements.capabilityProfileInlineButton].forEach((button) => button?.addEventListener("click", openCapabilityProfileModal));
  elements.categoryManagerButton?.addEventListener("click", openPhotoCategoryManager);
  elements.closeCategoryManager?.addEventListener("click", () => closeModal(elements.categoryManagerModal));
  elements.addCategoryManagerButton?.addEventListener("click", addManagedPhotoCategory);
  elements.newCategoryName?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addManagedPhotoCategory(); } });
  elements.categoryManagerList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-photo-category-row]");
    if (!row) return;
    if (event.target.closest("[data-category-edit]")) return startManagedPhotoCategoryEdit(row);
    if (event.target.closest("[data-category-save]")) return renameManagedPhotoCategory(row);
    if (event.target.closest("[data-category-cancel]")) return cancelManagedPhotoCategoryEdit(row);
    const move = event.target.closest("[data-category-move]");
    if (move) return moveManagedPhotoCategory(row, move.dataset.categoryMove);
    if (event.target.closest("[data-category-delete]")) requestManagedPhotoCategoryDelete(row);
  });
  elements.categoryManagerList?.addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-category-name]")) return;
    const row = event.target.closest("[data-photo-category-row]");
    if (event.key === "Enter") { event.preventDefault(); renameManagedPhotoCategory(row); }
    if (event.key === "Escape") { event.preventDefault(); cancelManagedPhotoCategoryEdit(row); }
  });
  elements.confirmCategoryReassign?.addEventListener("click", confirmManagedPhotoCategoryDelete);
  elements.cancelCategoryReassign?.addEventListener("click", () => { pendingPhotoCategoryDelete = null; elements.categoryReassignPanel?.classList.add("hidden"); });
  elements.closeCapabilityProfile?.addEventListener("click", () => closeModal(elements.capabilityProfileModal));
  elements.cancelCapabilityProfile?.addEventListener("click", () => closeModal(elements.capabilityProfileModal));
  elements.saveCapabilityProfile?.addEventListener("click", saveCapabilityProfile);
  elements.profileCategory?.addEventListener("change", () => {
    photoCapabilityPickers.get("category:skill")?.clearSearch();
    photoCapabilityPickers.get("category:tool")?.clearSearch();
    renderCapabilityProfileEditor();
  });

  elements.refreshSamples?.addEventListener("click", () => {
    loadProjects({ announce: true });
  });

;
}

function initializePage() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;

  document.querySelectorAll(".modal").forEach(modal => {
    modal.classList.add("hidden");
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  });
  setLoading(false);
  setPanelLoading(false);
  document.body.classList.remove("body-loading");
  document.body.removeAttribute("aria-busy");

  hydrateCustomTechniqueOptions([]);
  void loadPhotoCapabilityLibrary().then(loadPhotoCapabilityProfile);
  initializeButtons();
  initializeFilters();
  initializePagination();
  initializeViewSwitch();
  initializeFormEvents();
  initializeModalEvents();
  initializeSidebar();
  initializeMainSlider();
  IMAGE_KINDS.forEach(initializeUploadControl);
  initializeGalleryUploadControl();

  updateCharacterCounters();
  updateProjectTypeUI();
  updateComparisonPreview();
}

try {
  await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin shell session bridge did not initialize.")));
  initializePage();
  loadProjects();
} catch (error) {
  console.error("Admin workspace session could not be consumed:", error);
  setLoading(false);
  setPanelLoading(false);
}
