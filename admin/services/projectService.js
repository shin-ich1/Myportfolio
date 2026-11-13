/* LΛN Portfolio CMS - Project Firestore Service */

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "./firebase.js";
import { normalizeHours } from "../../hours-value.js";
import { portfolioModuleRegistry } from "../../config.js";
import { listSections, listEntries } from "./portfolioSectionService.js";
import { cleanSkillData } from "./skillService.js";
import { announcePortfolioContentChanged } from "./portfolioSyncService.js";
import {
  commitMediaAssets,
  cleanupDeletedRecordMedia,
  cleanupRemovedMediaAssets
} from "./mediaAssetLifecycleService.js";
import { normalizePublicTagMode, normalizePublicTagRefs } from "../../projectCapabilities.js";
import { projectLinkDescriptorFromModule } from "../../module-platform.js";
import { normalizeAssetReference, hasAssetReference, persistentAssetUrl, resolveAssetUrl } from "../../asset-resolver.js";

import {
  cleanBoolean,
  cleanNumber,
  cleanText,
  commaSeparatedToArray,
  compareDisplayOrder,
  createSafeDocumentData,
  generateUniqueSlug,
  validateRequiredFields
} from "./firestoreHelpers.js";

const PROJECT_COLLECTION = "projects";
const BULK_PROJECT_WRITE_LIMIT = 200;
const BULK_PROJECT_MUTABLE_FIELDS = new Set(["status", "visible", "featured"]);

const projectCollectionReference = collection(
  db,
  PROJECT_COLLECTION
);

export function createDefaultProject() {
  return {
    projectType: "standalone",
    linkedModule: "",
    linkedModuleKey: "",
    linkedModuleId: "",
    linkedCollection: "",
    linkedScope: "",
    linkedDocumentId: "",
    linkedDestination: "",
    linkedTitleSnapshot: "",
    linkedSummarySnapshot: "",
    linkedCoverSnapshot: null,
    linkedUpdatedAtSnapshot: null,
    linkedActions: [],
    additionalActions: [],
    standaloneProjectName: "",
    cardSummary: "",
    fullDescription: "",
    title: "",
    category: "",
    shortDescription: "",
    description: "",
    skillIds: [],
    toolIds: [],
    technologies: [],
    publicTagMode: "automatic",
    publicTagRefs: [],
    githubUrl: "",
    githubSecondaryEnabled: false,
    liveUrl: "",
    coverImageUrl: "",
    coverImage: null,
    projectLogo: null,
    galleryImages: [],
    video: null,
    youtubeUrl: "",
    videoType: "",
    mediaType: "cover-only",
    demoVideo: null,
    externalVideo: null,
    pdfAsset: null,
    sourceFiles: [],
    customAssets: [],
    enabledMediaAssets: [],
    actionType: "project-preview",
    buttonLabel: "View Project",
    destination: "",
    year: new Date().getFullYear(),
    projectHours: null,
    status: "draft",
    visible: true,
    featured: false,
    displayOrder: 0
  };
}

function normalizeCategory(value) {
  const token = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\/_–—-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases = new Map([
    ["web development", "web-development"], ["web", "web-development"], ["website", "web-development"],
    ["capstone", "capstone"], ["academic capstone", "capstone"], ["thesis", "capstone"],
    ["data management", "data-management"], ["data", "data-management"], ["database", "data-management"],
    ["it support", "it-support"], ["technical support", "it-support"], ["computer maintenance", "it-support"],
    ["photo editing", "photo-editing"], ["photography editing", "photo-editing"],
    ["multimedia", "multimedia"], ["creative", "multimedia"], ["animation", "multimedia"], ["3d animation", "multimedia"],
    ["other", "other"]
  ]);
  return aliases.get(token) || "other";
}

function normalizeUrl(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return "";
  }

  if (/^(https?:\/\/|\.\.?\/|\/)/i.test(cleaned)) {
    return cleaned;
  }

  return `https://${cleaned}`;
}

function cleanMediaObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reference = normalizeAssetReference(value);
  if (!reference) return null;
  if (typeof reference === "string") return createSafeDocumentData({ ...value, url: reference, secureUrl: reference });
  return createSafeDocumentData(reference);
}

function mediaHasReference(value) {
  return hasAssetReference(value);
}

function cleanMediaValue(value) {
  const objectValue =
    cleanMediaObject(value);

  if (objectValue) {
    return objectValue;
  }

  const url =
    typeof value === "string"
      ? cleanText(value)
      : "";

  return url
    ? { url }
    : null;
}

function cleanMediaArray(value) {
  return Array.isArray(value)
    ? value.map(cleanMediaObject).filter(Boolean)
    : [];
}

function cleanMediaList(value) {
  const source = Array.isArray(value) ? value : commaSeparatedToArray(value);
  return source
    .map((item) => {
      const objectValue = cleanMediaObject(item);
      if (objectValue) return objectValue;
      const reference = normalizeAssetReference(item);
      if (typeof reference === "string") return cleanText(reference);
      return reference ? createSafeDocumentData(reference) : null;
    })
    .filter(Boolean);
}

const PROJECT_MEDIA_ASSET_KEYS = new Set(["cover", "logo", "screenshots", "demo-video", "pdf", "source-files", "custom-assets"]);
function projectOwnedMedia(record = {}) {
  return {
    coverImage: record.coverImage || record.coverImageUrl || null,
    projectLogo: record.projectLogo || null,
    galleryImages: Array.isArray(record.galleryImages) ? record.galleryImages : [],
    video: record.video || null,
    demoVideo: record.demoVideo || null,
    pdfAsset: record.pdfAsset || null,
    sourceFiles: Array.isArray(record.sourceFiles) ? record.sourceFiles : [],
    customAssets: Array.isArray(record.customAssets) ? record.customAssets : []
  };
}

function cleanEnabledMediaAssets(value) {
  return Array.isArray(value) ? [...new Set(value.map(cleanText).filter((item) => PROJECT_MEDIA_ASSET_KEYS.has(item)))] : [];
}
function inferEnabledMediaAssets(rawData = {}) {
  const enabled = [];
  if (mediaHasReference(rawData.coverImage) || rawData.coverImageUrl || rawData.image || rawData.imageUrl || rawData.thumbnail || rawData.primaryImage) enabled.push("cover");
  if (mediaHasReference(rawData.projectLogo)) enabled.push("logo");
  if (Array.isArray(rawData.galleryImages) && rawData.galleryImages.length) enabled.push("screenshots");
  if (mediaHasReference(rawData.demoVideo) || mediaHasReference(rawData.video) || mediaHasReference(rawData.externalVideo) || rawData.youtubeUrl) enabled.push("demo-video");
  if (mediaHasReference(rawData.pdfAsset) || mediaHasReference(rawData.pdfDocument)) enabled.push("pdf");
  if ((Array.isArray(rawData.sourceFiles) && rawData.sourceFiles.some(mediaHasReference)) || mediaHasReference(rawData.sourceFile)) enabled.push("source-files");
  if (Array.isArray(rawData.customAssets) && rawData.customAssets.some(mediaHasReference)) enabled.push("custom-assets");
  return cleanEnabledMediaAssets(enabled);
}

let dynamicPortfolioModuleRegistry = [];

function defaultProjectCtaForModule(module = {}) {
  const configured = cleanText(module.defaultButtonLabel);
  const key = cleanText(module.key).toLowerCase();
  const label = cleanText(module.label).toLowerCase();
  if (configured && configured !== "View Details") return configured;
  if (key === "experience" || label === "experience") return "View Experience";
  if (key === "photo-editing" || label.includes("photo editing")) return "View Portfolio";
  if (key === "projects" || label === "projects" || label === "project") return "View Project";
  if (key === "certificates" || label.includes("certificate")) return "View Certificate";
  if (key === "resume" || label.includes("resume")) return "View Resume";
  return configured || "View Details";
}

function basePortfolioModuleRegistry() {
  return portfolioModuleRegistry
    .filter((module) => module?.active === true && module.key && module.collection)
    .map((module) => ({
      ...module,
      defaultButtonLabel: defaultProjectCtaForModule(module)
    }));
}

function dynamicSectionToModule(section = {}) {
  const descriptor = projectLinkDescriptorFromModule(section);
  return {
    ...descriptor,
    collection: "portfolioSectionEntries",
    sectionKey: descriptor.key,
    titleFields: ["title"],
    summaryFields: ["shortSummary", "description"],
    categoryFields: ["category"],
    entryMetaFields: ["category"],
    coverFields: ["coverImage", "coverImageUrl"],
    tagFields: ["tags"],
    statusFields: ["status"],
    publishedValues: ["published", "featured"],
    visibleFields: ["visible"],
    deletedFields: ["deletedAt", "isDeleted", "deleted"],
    archivedFields: ["archivedAt", "isArchived", "archived"],
    adminDestination: `module.html?section=${encodeURIComponent(descriptor.key)}`,
    defaultButtonLabel: "View Details",
    publicEnabled: section.publicEnabled === true,
    hideWhenEmpty: section.hideWhenEmpty !== false,
    navigationLink: section.navigationLink === true,
    lifecycle: cleanText(section.lifecycle || "building"),
    icon: cleanText(section.theme?.icon || section.cover) || "◇",
    dynamic: true
  };
}

export async function refreshPortfolioModuleRegistry() {
  try {
    const sections = await listSections();
    dynamicPortfolioModuleRegistry = (Array.isArray(sections) ? sections : [])
      .filter((section) => section?.linkableToProjects === true && section?.enabled !== false && section?.key)
      .map(dynamicSectionToModule);
  } catch (error) {
    console.warn("Custom modules could not be loaded for Projects:", error);
    dynamicPortfolioModuleRegistry = [];
  }
  return getPortfolioModuleRegistry();
}

export function getPortfolioModuleRegistry() {
  const modules = [...basePortfolioModuleRegistry(), ...dynamicPortfolioModuleRegistry];
  const seen = new Set();
  return modules.filter((module) => {
    const key = cleanText(module?.key).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((module) => ({ ...module }));
}

export function getPortfolioModule(moduleKey = "") {
  const key = cleanText(moduleKey).toLowerCase();
  return getPortfolioModuleRegistry().find((module) =>
    cleanText(module.moduleId).toLowerCase() === key || cleanText(module.key).toLowerCase() === key || cleanText(module.label).toLowerCase() === key
  ) || null;
}

function firstConfiguredValue(record = {}, fields = []) {
  for (const field of fields || []) {
    const value = record?.[field];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function mediaUrlFromValue(value, purpose = "preview") {
  if (!value) return "";
  return cleanText(resolveAssetUrl(value, purpose));
}

function mediaUrlFromList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    const url = mediaUrlFromValue(value);
    if (url) return url;
  }
  return "";
}

function resolveRegistrySourceCover(record = {}, module = {}) {
  const explicitCover = mediaUrlFromValue(record.coverImage)
    || cleanText(record.coverImageUrl)
    || mediaUrlFromValue(record.image)
    || cleanText(record.imageUrl)
    || mediaUrlFromValue(record.thumbnail)
    || mediaUrlFromValue(record.primaryImage);
  if (explicitCover) return explicitCover;

  if (module.key === "photo-editing") {
    const displayType = cleanText(record.projectDisplayType || record.displayType).toLowerCase();
    const galleryCover = mediaUrlFromList(record.galleryImages || []);
    const finalImage = mediaUrlFromValue(record.afterImage)
      || cleanText(record.afterImageUrl)
      || mediaUrlFromValue(record.singleImage)
      || cleanText(record.singleImageUrl)
      || mediaUrlFromValue(record.image)
      || cleanText(record.imageUrl);
    if (displayType === "gallery") return galleryCover || finalImage;
    return finalImage || galleryCover;
  }

  for (const field of module.coverFields || []) {
    const value = record?.[field];
    const url = Array.isArray(value) ? mediaUrlFromList(value) : mediaUrlFromValue(value);
    if (url) return url;
  }
  return "";
}

function resolveRegistrySourceTags(record = {}, module = {}) {
  const values = [];
  for (const field of module.tagFields || []) {
    const value = record?.[field];
    if (Array.isArray(value)) values.push(...value);
    else if (value) values.push(value);
  }
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

export function resolveLinkedProjectPresentation(project = {}, source = null, registryEntry = null) {
  const module = registryEntry || getPortfolioModule(project.linkedModuleId || project.linkedModuleKey || project.linkedModule);
  const sourceData = source || null;
  const sourceCover = cleanText(sourceData?.cover) || (sourceData ? resolveRegistrySourceCover(sourceData.raw || sourceData, module || {}) : "");
  const manualCover = mediaUrlFromValue(project.coverImage) || cleanText(project.coverImageUrl);
  const sourceTags = Array.isArray(sourceData?.tags) ? sourceData.tags : (sourceData ? resolveRegistrySourceTags(sourceData.raw || sourceData, module || {}) : []);
  const projectTags = Array.isArray(project.technologies) ? project.technologies : [];
  return {
    cover: manualCover || sourceCover || "",
    title: cleanText(sourceData?.title) || cleanText(project.title || project.linkedTitleSnapshot),
    summary: cleanText(sourceData?.summary) || cleanText(project.cardSummary || project.shortDescription || project.linkedSummarySnapshot),
    tags: sourceTags.length ? sourceTags : projectTags,
    moduleLabel: cleanText(module?.label || project.linkedModule || "Linked Portfolio Content"),
    status: cleanText(sourceData?.status || project.status),
    actions: resolveProjectAction(project),
    sourceMissing: !sourceData,
    source: sourceData,
    module
  };
}

function configuredModuleScope(module = {}) {
  return cleanText(module?.linkScope).toLowerCase() === "module" ? "module" : "entry";
}

function moduleFromStoredCollection(collectionName = "") {
  const normalizedCollection = cleanText(collectionName).toLowerCase();
  if (!normalizedCollection) return null;
  const matches = getPortfolioModuleRegistry().filter((module) =>
    cleanText(module.collection).toLowerCase() === normalizedCollection
  );
  return matches.length === 1 ? matches[0] : null;
}

function resolveStoredProjectModule(raw = {}) {
  const byId = getPortfolioModule(raw.linkedModuleId);
  const directToken = cleanText(raw.linkedModuleKey || raw.linkedModule).toLowerCase();
  const byDirect = directToken ? getPortfolioModule(directToken) : null;
  const byCollection = moduleFromStoredCollection(raw.linkedCollection);
  const explicit = byId || byDirect;

  // Older Project records can contain contradictory relationship metadata after
  // the link model evolved. A module-scoped identity cannot legitimately own an
  // entry document from a different, uniquely registered entry-scoped collection.
  // Prefer that collection owner only for this contradictory legacy shape.
  if (explicit && byCollection && cleanText(explicit.key).toLowerCase() !== cleanText(byCollection.key).toLowerCase()) {
    const explicitScope = configuredModuleScope(explicit);
    const collectionScope = configuredModuleScope(byCollection);
    const hasEntryReference = Boolean(cleanText(raw.linkedDocumentId));
    if (hasEntryReference && explicitScope === "module" && collectionScope === "entry") {
      return byCollection;
    }
  }

  if (explicit) return explicit;
  if (byCollection) return byCollection;

  const destination = cleanText(raw.linkedDestination || raw.destination).toLowerCase();
  return getPortfolioModuleRegistry().find((module) => {
    const publicDestination = cleanText(module.publicDestination).toLowerCase();
    const label = cleanText(module.label).toLowerCase();
    return (publicDestination && (destination === publicDestination || destination === cleanText(module.key).toLowerCase())) || directToken === label;
  }) || null;
}

function inferRegistryModuleKey(raw = {}) {
  return cleanText(resolveStoredProjectModule(raw)?.key).toLowerCase();
}

function normalizeLinkedAction(raw = {}, index = 0) {
  const requestedKey = cleanText(raw.moduleKey || raw.linkedModuleKey || raw.module || raw.linkedModule).toLowerCase();
  const module = getPortfolioModule(requestedKey);
  const moduleKey = cleanText(module?.key || requestedKey).toLowerCase();
  const documentId = cleanText(raw.documentId || raw.linkedDocumentId || raw.entryId);
  return {
    moduleKey,
    documentId,
    label: cleanText(raw.label || raw.buttonLabel) || defaultProjectCtaForModule(module || {}),
    destination: cleanText(module?.publicDestination || raw.destination || raw.linkedDestination),
    titleSnapshot: cleanText(raw.titleSnapshot || raw.title),
    displayOrder: cleanNumber(raw.displayOrder, index, 0)
  };
}

function normalizeLinkedActions(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => normalizeLinkedAction(item, index))
    .filter((item) => item.moduleKey || item.documentId || item.label || item.destination)
    .sort((first, second) => first.displayOrder - second.displayOrder);
}

const PROJECT_RESOURCE_ACTION_TYPES = new Set(["project-preview", "demo-video", "live-website", "pdf", "download", "custom-resource", "github"]);

function normalizeAdditionalAction(raw = {}, index = 0) {
  const requestedKind = cleanText(raw.kind).toLowerCase();
  const inferredLinked = Boolean(cleanText(raw.moduleKey || raw.linkedModuleKey || raw.module || raw.linkedModule || raw.documentId || raw.linkedDocumentId));
  const kind = requestedKind === "resource" ? "resource" : requestedKind === "linked" ? "linked" : (inferredLinked ? "linked" : "resource");
  if (kind === "linked") return { kind: "linked", ...normalizeLinkedAction(raw, index) };
  const requestedResource = cleanText(raw.resourceType).toLowerCase();
  const label = normalizeProjectButtonLabel(raw.label || raw.buttonLabel);
  const inferredResource = label === "Watch Video" || label === "Watch Demo" || label === "Watch Animation"
    ? "demo-video"
    : label === "Open Live Website" ? "live-website"
      : label === "View PDF" || label === "Open PDF" ? "pdf"
        : label === "Download" || label === "Download Source" ? "download"
          : label === "GitHub" || label === "View Source Code" ? "github"
            : label === "Open Resource" || label === "View Resource" || label === "Download Resource" ? "custom-resource"
              : "project-preview";
  const resourceType = PROJECT_RESOURCE_ACTION_TYPES.has(requestedResource) ? requestedResource : inferredResource;
  const defaultLabel = ({
    "project-preview": "View Project",
    "demo-video": "Watch Video",
    "live-website": "Open Live Website",
    pdf: "View PDF",
    download: "Download",
    "custom-resource": "Open Resource",
    github: "GitHub"
  })[resourceType] || "View Project";
  return {
    kind: "resource",
    resourceType,
    resourceIndex: Math.max(0, cleanNumber(raw.resourceIndex, 0, 0)),
    moduleKey: "",
    documentId: "",
    label: label || defaultLabel,
    destination: "",
    titleSnapshot: "",
    displayOrder: cleanNumber(raw.displayOrder, index, 0)
  };
}

function normalizeAdditionalActions(value = [], legacyLinkedActions = []) {
  const source = Array.isArray(value) && value.length ? value : (Array.isArray(legacyLinkedActions) ? legacyLinkedActions : []);
  return source
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => normalizeAdditionalAction(item, index))
    .sort((first, second) => first.displayOrder - second.displayOrder);
}

function sourceRecordIsEligible(record = {}, module = {}) {
  const deletedValue = firstConfiguredValue(record, module.deletedFields);
  if (deletedValue) return false;
  const archivedValue = firstConfiguredValue(record, module.archivedFields);
  if (archivedValue) return false;

  const statusValue = cleanText(firstConfiguredValue(record, module.statusFields)).toLowerCase();
  const allowedStatuses = (module.publishedValues || []).map((value) => cleanText(value).toLowerCase());
  if (statusValue && allowedStatuses.length && !allowedStatuses.includes(statusValue)) return false;

  const visibleValue = firstConfiguredValue(record, module.visibleFields);
  if (visibleValue !== "" && visibleValue !== undefined && visibleValue !== null && cleanBoolean(visibleValue, true) === false) return false;
  return true;
}

function isPhotoEditingModuleGateway(record = {}, module = {}) {
  if (cleanText(module?.key).toLowerCase() !== "photo-editing") return false;
  if (record?.isPortfolioGateway === true || record?.showInPublicGallery === false) return true;
  const category = cleanText(record?.category || record?.projectCategory || record?.type).toLowerCase();
  const title = cleanText(record?.title || record?.projectTitle || record?.name).toLowerCase();
  return category === "photo editing" && (title === "photo editing portfolio" || title === "photo editing");
}

function normalizedModuleEntryCategory(record = {}, module = {}) {
  const stored = cleanText(firstConfiguredValue(record, module.categoryFields || []));
  if (cleanText(module?.key).toLowerCase() === "photo-editing" && stored.toLowerCase() === "other" && cleanText(record?.customCategory)) {
    return cleanText(record.customCategory);
  }
  return stored;
}

export async function loadPortfolioModuleEntries(moduleKey) {
  const module = getPortfolioModule(moduleKey);
  if (!module) throw new Error("The selected portfolio module is unavailable.");

  if (module.dynamic === true && module.sectionKey) {
    const entries = await listEntries(module.sectionKey);
    return (Array.isArray(entries) ? entries : [])
      .filter((data) => sourceRecordIsEligible(data, module))
      .map((data) => ({
        id: data.id,
        moduleKey: module.key,
        moduleLabel: module.label,
        title: cleanText(data.title) || "Untitled entry",
        summary: cleanText(data.shortSummary || data.description),
        cover: mediaUrlFromValue(data.coverImage) || cleanText(data.coverImageUrl),
        tags: Array.isArray(data.tags) ? data.tags.map(cleanText).filter(Boolean) : [],
        status: cleanText(data.status),
        category: cleanText(data.category),
        meta: cleanText(data.category),
        eligible: true,
        updatedAt: data.updatedAt || null,
        raw: data
      }))
      .sort((first, second) => first.title.localeCompare(second.title, undefined, { sensitivity: "base" }));
  }

  const snapshot = await getDocs(collection(db, module.collection));
  return snapshot.docs
    .map((item) => {
      const data = item.data() || {};
      const title = cleanText(firstConfiguredValue(data, module.titleFields)) || "Untitled entry";
      const summary = cleanText(firstConfiguredValue(data, module.summaryFields));
      const cover = resolveRegistrySourceCover(data, module);
      const tags = resolveRegistrySourceTags(data, module);
      const status = cleanText(firstConfiguredValue(data, module.statusFields));
      const category = normalizedModuleEntryCategory(data, module);
      const meta = (module.entryMetaFields || [])
        .map((field) => cleanText(data?.[field]))
        .filter(Boolean)
        .join(" · ");
      return {
        id: item.id,
        moduleKey: module.key,
        moduleLabel: module.label,
        title,
        summary,
        cover,
        tags,
        status,
        category,
        meta,
        eligible: sourceRecordIsEligible(data, module),
        updatedAt: data.updatedAt || null,
        raw: data
      };
    })
    .filter((entry) => entry.eligible && !isPhotoEditingModuleGateway(entry.raw || {}, module))
    .sort((first, second) => first.title.localeCompare(second.title, undefined, { sensitivity: "base" }));
}

export async function setCapabilitiesOnLinkedProjectSource(moduleKey, documentId, capabilityType, capabilityIds = []) {
  const module = getPortfolioModule(moduleKey);
  if (!module) throw new Error("The selected source module is unavailable.");
  if (String(module.linkScope || "entry").trim().toLowerCase() === "module") {
    throw new Error("This linked module does not use individual source entries.");
  }
  const sourceId = cleanText(documentId);
  if (!sourceId) throw new Error("Select a source entry first.");

  const sourceReference = doc(db, module.collection, sourceId);
  const snapshot = await getDoc(sourceReference);
  if (!snapshot.exists()) throw new Error("The selected source entry no longer exists.");

  const isTool = cleanText(capabilityType).toLowerCase() === "tool";
  const capabilityField = isTool ? "toolIds" : "skillIds";
  const nextIds = [...new Set(commaSeparatedToArray(capabilityIds))];
  const update = { [capabilityField]: nextIds, updatedAt: serverTimestamp() };

  // Photo Editing entry records expose both entry-level and effective capability fields.
  // Keep them synchronized so Projects and the owning Photo Editing editor resolve the same data.
  if (cleanText(module.key).toLowerCase() === "photo-editing") {
    const entryField = isTool ? "entryToolIds" : "entrySkillIds";
    update[entryField] = nextIds;
  }

  const batch = writeBatch(db);
  batch.update(sourceReference, update);
  await batch.commit();
  announcePortfolioContentChanged(module.key);
  return { id: sourceId, capabilityIds: nextIds, type: isTool ? "tool" : "skill" };
}

export async function validateLinkedSourceReference(moduleKey, documentId) {
  const module = getPortfolioModule(moduleKey);
  if (!module) throw new Error("The selected source module is unavailable.");
  if (!cleanText(documentId)) throw new Error("Select a source entry.");
  const snapshot = await getDoc(doc(db, module.collection, cleanText(documentId)));
  if (!snapshot.exists()) throw new Error("The selected source entry is no longer available.");
  const data = snapshot.data() || {};
  if (module.dynamic === true && module.sectionKey && cleanText(data.sectionKey).toLowerCase() !== cleanText(module.sectionKey).toLowerCase()) {
    throw new Error("The selected source entry does not belong to this portfolio module.");
  }
  if (!sourceRecordIsEligible(data, module)) {
    throw new Error("The selected source entry is not eligible for linking.");
  }
  return true;
}

export async function ensureUniqueLinkedProjectReference(moduleKey, documentId, excludedProjectId = "") {
  const module = getPortfolioModule(moduleKey);
  const normalizedModuleKey = cleanText(module?.key || moduleKey).toLowerCase();
  const normalizedDocumentId = cleanText(documentId);
  if (!normalizedModuleKey || !normalizedDocumentId) return;

  // Query the source document ID only. This remains targeted, avoids a new
  // composite-index requirement, and lets legacy linkedModule values share
  // the same duplicate-protection path as linkedModuleKey.
  const snapshot = await getDocs(query(
    projectCollectionReference,
    where("linkedDocumentId", "==", normalizedDocumentId),
    limit(10)
  ));
  const acceptedModuleValues = new Set([
    normalizedModuleKey,
    cleanText(module?.label).toLowerCase()
  ].filter(Boolean));
  const duplicate = snapshot.docs.find((item) => {
    if (item.id === excludedProjectId) return false;
    const data = item.data() || {};
    const storedModule = cleanText(data.linkedModuleKey || data.linkedModule).toLowerCase();
    return acceptedModuleValues.has(storedModule);
  });
  if (duplicate) throw new Error("This source entry is already linked to another project.");
}

export async function ensureUniqueLinkedModuleReference(moduleKey, excludedProjectId = "") {
  const module = getPortfolioModule(moduleKey);
  const normalizedModuleKey = cleanText(module?.key || moduleKey).toLowerCase();
  if (!normalizedModuleKey) return;
  const snapshot = await getDocs(query(projectCollectionReference, where("linkedModuleKey", "==", normalizedModuleKey), limit(20)));
  const duplicate = snapshot.docs.find((item) => {
    if (item.id === excludedProjectId) return false;
    const data = item.data() || {};
    const scope = normalizeLinkedScope(data.linkedScope, module);
    return cleanText(data.projectType) === "linked-module" && scope === "module";
  });
  if (duplicate) throw new Error(`The ${module?.label || "selected"} module is already represented by another Project.`);
}

function normalizeProjectType(value, raw = {}) {
  const cleaned = cleanText(value);
  if (cleaned === "linked-module" || cleaned === "standalone") return cleaned;
  return cleanText(raw.linkedDestination || raw.linkedModule) || normalizeActionType(raw.actionType) === "internal-section"
    ? "linked-module"
    : "standalone";
}

function normalizeLinkedScope(value = "", module = null) {
  const configured = cleanText(module?.linkScope).toLowerCase();
  if (configured === "module") return "module";
  if (configured === "entry") return "entry";
  return cleanText(value).toLowerCase() === "module" ? "module" : "entry";
}

function normalizeMediaType(value) {
  const allowed = [
    "cover-only",
    "cover-demo-video",
    "cover-mp4",
    "cover-external-video",
    "cover-pdf",
    "cover-live-website",
    "cover-download",
    "gallery-project",
    "cover-source-files",
    "custom-assets"
  ];
  const cleaned = cleanText(value);
  if (cleaned === "cover-mp4" || cleaned === "cover-external-video") return "cover-demo-video";
  if (cleaned === "cover-source-files") return "cover-download";
  return allowed.includes(cleaned) ? cleaned : "cover-only";
}


function normalizeProjectButtonLabel(value) {
  const label = cleanText(value);
  return label.toLowerCase() === "live demo" ? "Watch Video" : label;
}

function normalizeActionType(value) {
  const allowed = [
    "project-preview", "github", "live-site", "uploaded-mp4",
    "external-video", "pdf", "source-file", "internal-section", "custom-url"
  ];
  const cleaned = cleanText(value);
  return allowed.includes(cleaned) ? cleaned : "project-preview";
}

function canonicalStandaloneActionType(project = {}) {
  const label = normalizeProjectButtonLabel(project.buttonLabel).toLowerCase();
  if (label === "view project" || label === "view details") return "project-preview";
  if (["watch demo", "watch video", "watch animation"].includes(label)) return "uploaded-mp4";
  if (label === "open live website") return "live-site";
  if (["view pdf", "open pdf"].includes(label)) return "pdf";
  if (["download", "download source"].includes(label)) return "source-file";
  if (label === "github") return "github";
  return normalizeActionType(project.actionType);
}

export function resolveProjectAction(project = {}) {
  const projectType = normalizeProjectType(project.projectType, project);
  const requestedLabel = normalizeProjectButtonLabel(project.buttonLabel).toLowerCase();
  const linkedResourceLabel = ["watch demo", "watch video", "watch animation", "open live website", "view pdf", "open pdf", "download", "download source", "github"].includes(requestedLabel);
  if (projectType === "linked-module" && !linkedResourceLabel) {
    const module = getPortfolioModule(project.linkedModuleId || project.linkedModuleKey || project.linkedModule);
    const destination = cleanText(module?.publicDestination || project.linkedDestination || project.destination);
    const available = /^(#[A-Za-z][\w-]*|\/[A-Za-z0-9][A-Za-z0-9/_-]*|[A-Za-z][\w-]*)$/.test(destination) && !/^javascript:/i.test(destination);
    return {
      type: "internal-section",
      label: normalizeProjectButtonLabel(project.buttonLabel) || defaultProjectCtaForModule(module || {}) || "View Details",
      destination: available ? destination : "",
      available,
      target: "same-window",
      fallback: available ? "" : "project-preview"
    };
  }

  const configuredType = canonicalStandaloneActionType(project);
  const demoUrl = mediaUrlFromValue(project.demoVideo || project.video, "preview");
  const externalUrl = cleanText(project.externalVideo?.url || project.externalVideoUrl || project.youtubeUrl);
  const pdfUrl = mediaUrlFromValue(project.pdfDocument || project.pdfAsset, "pdf-preview");
  const sourceUrl = mediaUrlFromValue(project.sourceFile || project.sourceFiles?.[0], "download");
  const destinations = {
    github: cleanText(project.githubUrl),
    "live-site": cleanText(project.liveUrl),
    "uploaded-mp4": demoUrl,
    "external-video": externalUrl,
    pdf: pdfUrl,
    "source-file": sourceUrl,
    "internal-section": cleanText(project.destination),
    "custom-url": cleanText(project.destination),
    "project-preview": ""
  };
  const labels = {
    "project-preview": "View Project",
    github: "View Source Code",
    "live-site": "Open Live Website",
    "uploaded-mp4": "Watch Demo",
    "external-video": "Open Video",
    pdf: "Open PDF",
    "source-file": "Download Source",
    "internal-section": "View Section",
    "custom-url": "Open Link"
  };
  const destination = destinations[configuredType] || "";
  const available = configuredType === "project-preview"
    ? true
    : configuredType === "internal-section"
      ? /^#[A-Za-z][\w-]*$/.test(destination)
      : configuredType === "custom-url"
        ? (() => { try { return new URL(destination).protocol === "https:"; } catch { return false; } })()
        : Boolean(destination);

  if (!available) {
    return {
      type: "project-preview",
      label: "View Project",
      destination: "",
      available: true,
      target: "same-window",
      fallback: configuredType
    };
  }

  return {
    type: configuredType,
    label: normalizeProjectButtonLabel(project.buttonLabel) || labels[configuredType],
    destination,
    available: true,
    target: configuredType === "internal-section" || configuredType === "project-preview"
      ? "same-window"
      : "new-window",
    fallback: ""
  };
}

function normalizeExternalVideo(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return createSafeDocumentData(value);
  }
  const url = normalizeUrl(value);
  return url ? { url, provider: "external", embedUrl: url, posterUrl: "" } : null;
}

export function cleanProjectData(rawData = {}) {
  const title = cleanText(rawData.title);
  const category = normalizeCategory(
    rawData.category
  );
  const customCategory = cleanText(
    rawData.customCategory
  );
  const projectType = normalizeProjectType(rawData.projectType, rawData);
  const linkedModuleDefinition = projectType === "linked-module" ? resolveStoredProjectModule(rawData) : null;
  const linkedModuleKey = projectType === "linked-module" ? cleanText(linkedModuleDefinition?.key || inferRegistryModuleKey(rawData)).toLowerCase() : "";
  const linkedModuleId = projectType === "linked-module" ? cleanText(linkedModuleDefinition?.moduleId || rawData.linkedModuleId) : "";
  const linkedModule = projectType === "linked-module" ? cleanText(linkedModuleDefinition?.key || rawData.linkedModule || linkedModuleKey) : "";
  const linkedCollection = projectType === "linked-module" ? cleanText(linkedModuleDefinition?.collection || rawData.linkedCollection) : "";
  const linkedScope = projectType === "linked-module" ? normalizeLinkedScope(rawData.linkedScope, linkedModuleDefinition) : "";
  const defaultButtonLabel = projectType === "linked-module"
    ? defaultProjectCtaForModule(linkedModuleDefinition || {})
    : "View Project";
  const linkedDocumentId = projectType === "linked-module" && linkedScope !== "module" ? cleanText(rawData.linkedDocumentId) : "";
  const linkedDestination = projectType === "linked-module"
    ? cleanText(linkedModuleDefinition?.publicDestination || rawData.linkedDestination || rawData.destination)
    : "";
  const standaloneProjectName = cleanText(rawData.standaloneProjectName || title);

  if (
    projectType !== "linked-module" &&
    category === "other" &&
    !customCategory
  ) {
    throw new Error(
      "Please enter the other project category."
    );
  }

  const project = {
    projectType,
    linkedModule,
    linkedModuleKey,
    linkedModuleId,
    linkedCollection,
    linkedScope,
    linkedDocumentId,
    linkedDestination,
    linkedTitleSnapshot: projectType === "linked-module" ? cleanText(rawData.linkedTitleSnapshot) : "",
    linkedSummarySnapshot: projectType === "linked-module" ? cleanText(rawData.linkedSummarySnapshot) : "",
    linkedCoverSnapshot: projectType === "linked-module" ? cleanMediaObject(rawData.linkedCoverSnapshot) : null,
    linkedUpdatedAtSnapshot: projectType === "linked-module" ? (rawData.linkedUpdatedAtSnapshot || null) : null,
    additionalActions: normalizeAdditionalActions(rawData.additionalActions, rawData.linkedActions),
    linkedActions: normalizeAdditionalActions(rawData.additionalActions, rawData.linkedActions).filter((action) => action.kind === "linked").map((action) => normalizeLinkedAction(action, action.displayOrder)),
    standaloneProjectName,
    cardSummary: cleanText(rawData.cardSummary || rawData.shortDescription),
    fullDescription: cleanText(rawData.fullDescription || rawData.description),
    title,

    slug: generateUniqueSlug(
      title,
      rawData.category
    ),

    category,

    customCategory:
      category === "other"
        ? customCategory
        : "",

    shortDescription: cleanText(
      rawData.shortDescription || rawData.cardSummary
    ),

    description: cleanText(
      rawData.description || rawData.fullDescription
    ),

    skillIds: projectType === "linked-module" ? [] : commaSeparatedToArray(rawData.skillIds || rawData.skillsUsedIds),
    toolIds: projectType === "linked-module" ? [] : commaSeparatedToArray(rawData.toolIds || rawData.toolsUsedIds),
    technologies: projectType === "linked-module" ? [] : commaSeparatedToArray(rawData.technologies),
    publicTagMode: normalizePublicTagMode(rawData.publicTagMode || rawData.publicToolMode),
    publicTagRefs: normalizePublicTagRefs(rawData.publicTagRefs, commaSeparatedToArray(rawData.publicToolIds)),

    githubUrl: normalizeUrl(rawData.githubUrl || rawData.repositoryUrl || rawData.repoUrl),

    githubSecondaryEnabled: rawData.githubSecondaryEnabled === undefined
      ? Boolean(cleanText(rawData.githubUrl || rawData.repositoryUrl || rawData.repoUrl))
      : cleanBoolean(rawData.githubSecondaryEnabled, false),

    liveUrl: normalizeUrl(rawData.liveUrl || rawData.projectUrl || rawData.websiteUrl),

    coverImageUrl: cleanText(rawData.coverImageUrl),

    coverImage:
      rawData.coverImage && typeof rawData.coverImage === "object"
        ? createSafeDocumentData(rawData.coverImage)
        : null,

    projectLogo: cleanMediaObject(rawData.projectLogo),

    galleryImages: cleanMediaList(rawData.galleryImages),

    video: cleanMediaObject(rawData.video || rawData.demoVideo),

    youtubeUrl: normalizeUrl(rawData.youtubeUrl || rawData.externalVideo?.url),

    videoType: ["upload", "youtube", "external"].includes(cleanText(rawData.videoType))
      ? cleanText(rawData.videoType)
      : "",

    mediaType: normalizeMediaType(rawData.mediaType),

    demoVideo: cleanMediaObject(rawData.demoVideo || rawData.video),

    externalVideo: normalizeExternalVideo(
      rawData.externalVideo || rawData.externalVideoUrl || rawData.youtubeUrl
    ),

    pdfAsset: cleanMediaObject(rawData.pdfAsset),

    sourceFiles: cleanMediaArray(rawData.sourceFiles),

    customAssets: cleanMediaArray(rawData.customAssets),

    enabledMediaAssets: cleanEnabledMediaAssets(rawData.enabledMediaAssets),

    actionType: projectType === "linked-module" ? "internal-section" : normalizeActionType(rawData.actionType),
    buttonLabel: normalizeProjectButtonLabel(rawData.buttonLabel) || defaultButtonLabel,
    destination: projectType === "linked-module" ? linkedDestination : cleanText(rawData.destination),
    externalVideoUrl: normalizeUrl(rawData.externalVideoUrl || rawData.externalVideo?.url || rawData.youtubeUrl),
    pdfDocument: cleanMediaObject(rawData.pdfDocument || rawData.pdfAsset),
    sourceFile: cleanMediaObject(rawData.sourceFile || rawData.sourceFiles?.[0]),

    year: cleanNumber(
      rawData.year || rawData.projectYear,
      new Date().getFullYear(),
      1990,
      new Date().getFullYear() + 2
    ),
    projectHours: normalizeHours(projectType === "linked-module" ? null : rawData.projectHours),

    status:
      cleanText(rawData.status) === "published"
        ? "published"
        : "draft",

    visible: cleanBoolean(
      rawData.visible,
      true
    ),

    featured: cleanBoolean(
      rawData.featured,
      false
    ),

    displayOrder: cleanNumber(
      rawData.displayOrder,
      0,
      0
    )
  };

  validateRequiredFields(project, projectType === "linked-module"
    ? ["title", "shortDescription"]
    : ["title", "category", "shortDescription"]
  );

  let primaryConnectionKey = "";
  if (projectType === "linked-module") {
    if (!project.buttonLabel) throw new Error("Primary button label is required for linked module projects.");
    const legacyLinkedEdit = Boolean(cleanText(rawData.id) && !linkedModuleDefinition && linkedDestination);
    if ((!linkedModuleKey || !linkedModuleDefinition) && !legacyLinkedEdit) throw new Error("Select a valid source module.");
    if (linkedScope === "entry" && !linkedDocumentId && !legacyLinkedEdit) throw new Error("Select a source entry.");
    if (!/^(#[A-Za-z][\w-]*|\/[A-Za-z0-9][A-Za-z0-9/_-]*|[A-Za-z][\w-]*)$/.test(linkedDestination) || /^javascript:/i.test(linkedDestination)) {
      throw new Error("The linked module destination is unavailable.");
    }

    primaryConnectionKey = linkedScope === "module"
      ? `${linkedModuleKey}:__module__`
      : `${linkedModuleKey}:${linkedDocumentId}`;
  } else {
    if (!standaloneProjectName) throw new Error("Standalone project name is required.");
    if (!project.description) throw new Error("Full description is required for standalone projects.");
  }

  validateAdditionalLinkedActions(project, primaryConnectionKey);

  project.additionalActions.filter((action) => action.kind === "resource").forEach((action, index) => {
    if (!action.label) throw new Error(`Button ${index + 2}: enter a button label.`);
    const resourceIndex = Math.max(0, Number.parseInt(action.resourceIndex, 10) || 0);
    const ready = action.resourceType === "project-preview"
      || (action.resourceType === "demo-video" && Boolean(mediaHasReference(project.demoVideo) || mediaHasReference(project.externalVideo) || project.youtubeUrl))
      || (action.resourceType === "live-website" && Boolean(project.liveUrl))
      || (action.resourceType === "pdf" && mediaHasReference(project.pdfAsset))
      || (action.resourceType === "download" && mediaHasReference(project.sourceFiles?.[resourceIndex]))
      || (action.resourceType === "custom-resource" && mediaHasReference(project.customAssets?.[resourceIndex]))
      || (action.resourceType === "github" && Boolean(project.githubUrl));
    if (!ready) throw new Error(`Button ${index + 2}: the selected Project resource is not configured.`);
  });

  return project;
}

function normalizeLoadedProject(id, rawData = {}) {
  const defaults = createDefaultProject();
  const demoVideo = cleanMediaObject(rawData.demoVideo || rawData.video);
  const externalVideo = normalizeExternalVideo(
    rawData.externalVideo || rawData.externalVideoUrl || rawData.youtubeUrl
  );
  const pdfAsset = cleanMediaObject(rawData.pdfAsset || rawData.pdfDocument);
  const sourceFiles = cleanMediaArray(
    rawData.sourceFiles?.length
      ? rawData.sourceFiles
      : rawData.sourceFile
        ? [rawData.sourceFile]
        : []
  );
  const coverImage =
    cleanMediaValue(rawData.coverImage) ||
    cleanMediaValue(rawData.coverImageUrl) ||
    cleanMediaValue(rawData.image) ||
    cleanMediaValue(rawData.imageUrl) ||
    cleanMediaValue(rawData.thumbnail) ||
    cleanMediaValue(rawData.primaryImage);
  const inferredMediaType = rawData.mediaType ||
    (mediaHasReference(demoVideo)
      ? "cover-mp4"
      : mediaHasReference(externalVideo)
        ? "cover-external-video"
        : mediaHasReference(pdfAsset)
          ? "cover-pdf"
          : sourceFiles.some(mediaHasReference)
            ? "cover-source-files"
            : "cover-only");

  const projectType = normalizeProjectType(rawData.projectType, rawData);
  const linkedModuleDefinition = projectType === "linked-module" ? resolveStoredProjectModule(rawData) : null;
  const linkedModuleKey = projectType === "linked-module" ? cleanText(linkedModuleDefinition?.key || inferRegistryModuleKey(rawData)).toLowerCase() : "";
  return {
    ...defaults,
    ...rawData,
    id,
    projectType,
    linkedModule: projectType === "linked-module" ? cleanText(linkedModuleDefinition?.key || rawData.linkedModule || linkedModuleKey) : "",
    linkedModuleKey,
    linkedModuleId: projectType === "linked-module" ? cleanText(linkedModuleDefinition?.moduleId || rawData.linkedModuleId) : "",
    linkedCollection: projectType === "linked-module" ? cleanText(linkedModuleDefinition?.collection || rawData.linkedCollection) : "",
    linkedScope: projectType === "linked-module" ? normalizeLinkedScope(rawData.linkedScope, linkedModuleDefinition) : "",
    linkedDocumentId: projectType === "linked-module" && normalizeLinkedScope(rawData.linkedScope, linkedModuleDefinition) !== "module" ? cleanText(rawData.linkedDocumentId) : "",
    linkedDestination: projectType === "linked-module" ? cleanText(linkedModuleDefinition?.publicDestination || rawData.linkedDestination || rawData.destination) : "",
    linkedTitleSnapshot: projectType === "linked-module" ? cleanText(rawData.linkedTitleSnapshot) : "",
    linkedSummarySnapshot: projectType === "linked-module" ? cleanText(rawData.linkedSummarySnapshot) : "",
    linkedCoverSnapshot: projectType === "linked-module" ? cleanMediaObject(rawData.linkedCoverSnapshot) : null,
    linkedUpdatedAtSnapshot: projectType === "linked-module" ? (rawData.linkedUpdatedAtSnapshot || null) : null,
    additionalActions: normalizeAdditionalActions(rawData.additionalActions, rawData.linkedActions),
    linkedActions: normalizeAdditionalActions(rawData.additionalActions, rawData.linkedActions).filter((action) => action.kind === "linked").map((action) => normalizeLinkedAction(action, action.displayOrder)),
    standaloneProjectName: cleanText(rawData.standaloneProjectName || rawData.projectName || rawData.title),
    cardSummary: cleanText(rawData.cardSummary || rawData.shortDescription || rawData.summary),
    fullDescription: cleanText(rawData.fullDescription || rawData.description || rawData.details),
    title: cleanText(rawData.title || rawData.projectName || rawData.name),
    category: normalizeCategory(rawData.category || rawData.projectCategory),
    customCategory: normalizeCategory(rawData.category || rawData.projectCategory) === "other"
      ? cleanText(rawData.customCategory || rawData.otherCategory || ((rawData.category || rawData.projectCategory) && cleanText(rawData.category || rawData.projectCategory).toLowerCase() !== "other" ? rawData.category || rawData.projectCategory : ""))
      : "",
    shortDescription: cleanText(rawData.shortDescription || rawData.cardSummary || rawData.summary),
    description: cleanText(rawData.description || rawData.fullDescription || rawData.details),
    skillIds: projectType === "linked-module" ? [] : commaSeparatedToArray(rawData.skillIds || rawData.skillsUsedIds),
    toolIds: projectType === "linked-module" ? [] : commaSeparatedToArray(rawData.toolIds || rawData.toolsUsedIds),
    technologies: projectType === "linked-module"
      ? []
      : Array.isArray(rawData.technologies)
        ? rawData.technologies
        : commaSeparatedToArray(rawData.technologies),
    publicTagMode: normalizePublicTagMode(rawData.publicTagMode || rawData.publicToolMode),
    publicTagRefs: normalizePublicTagRefs(rawData.publicTagRefs, commaSeparatedToArray(rawData.publicToolIds)),
    coverImage,
    coverImageUrl: cleanText(rawData.coverImageUrl || rawData.imageUrl || persistentAssetUrl(rawData.image)),
    projectLogo: cleanMediaObject(rawData.projectLogo),
    galleryImages: cleanMediaList(rawData.galleryImages),
    githubUrl: normalizeUrl(rawData.githubUrl || rawData.repositoryUrl || rawData.repoUrl),
    liveUrl: normalizeUrl(rawData.liveUrl || rawData.projectUrl || rawData.websiteUrl),
    year: cleanNumber(rawData.year || rawData.projectYear, new Date().getFullYear(), 1990, new Date().getFullYear() + 2),
    projectHours: normalizeHours(projectType === "linked-module" ? null : rawData.projectHours),
    githubSecondaryEnabled: rawData.githubSecondaryEnabled === undefined
      ? Boolean(cleanText(rawData.githubUrl || rawData.repositoryUrl || rawData.repoUrl))
      : cleanBoolean(rawData.githubSecondaryEnabled, false),
    demoVideo,
    video: demoVideo,
    externalVideo,
    externalVideoUrl: cleanText(rawData.externalVideoUrl || externalVideo?.url),
    youtubeUrl: cleanText(rawData.youtubeUrl || externalVideo?.url),
    pdfAsset,
    pdfDocument: pdfAsset,
    sourceFiles,
    sourceFile: sourceFiles[0] || null,
    enabledMediaAssets: Array.isArray(rawData.enabledMediaAssets) ? cleanEnabledMediaAssets(rawData.enabledMediaAssets) : inferEnabledMediaAssets(rawData),
    mediaType: normalizeMediaType(inferredMediaType),
    actionType: rawData.actionType ? normalizeActionType(rawData.actionType) : "",
    buttonLabel: normalizeProjectButtonLabel(rawData.buttonLabel),
    destination: cleanText(rawData.destination),
    displayOrder: cleanNumber(rawData.displayOrder ?? rawData.order, 0, 0),
    visible: rawData.visible === undefined ? true : cleanBoolean(rawData.visible, true),
    featured: cleanBoolean(rawData.featured, false),
    status: cleanText(rawData.status) === "published" ? "published" : "draft"
  };
}

async function ensureUniqueProjectSlug(projectData, excludedId = "") {
  const normalizedSlug = cleanText(projectData?.slug).toLowerCase();
  const title = cleanText(projectData?.title);
  const category = cleanText(projectData?.category);
  const candidates = new Map();

  if (normalizedSlug) {
    const slugSnapshot = await getDocs(
      query(
        projectCollectionReference,
        where("slug", "==", normalizedSlug),
        limit(2)
      )
    );
    slugSnapshot.docs.forEach((item) => candidates.set(item.id, item));
  }

  // Legacy documents may not have a slug. Query only matching titles, then
  // compare the category locally instead of scanning the complete collection.
  if (title) {
    const titleSnapshot = await getDocs(
      query(
        projectCollectionReference,
        where("title", "==", title)
      )
    );
    titleSnapshot.docs.forEach((item) => candidates.set(item.id, item));
  }

  const duplicate = [...candidates.values()].find((item) => {
    if (item.id === excludedId) return false;
    const data = item.data() || {};
    const existingSlug = cleanText(data.slug).toLowerCase();
    const sameSlug = normalizedSlug && existingSlug === normalizedSlug;
    const sameLegacyIdentity =
      cleanText(data.title).toLowerCase() === title.toLowerCase() &&
      cleanText(data.category).toLowerCase() === category.toLowerCase();
    return sameSlug || sameLegacyIdentity;
  });

  if (duplicate) {
    throw new Error("A project with this title and category already exists.");
  }
}


function linkedSourcePublishTarget(project = {}) {
  if (project.projectType !== "linked-module" || project.status !== "published") return null;
  const module = getPortfolioModule(project.linkedModuleId || project.linkedModuleKey || project.linkedModule);
  if (!module || normalizeLinkedScope(project.linkedScope, module) !== "entry" || !project.linkedDocumentId) {
    return null;
  }
  const statusField = (module.statusFields || []).find(Boolean) || "status";
  return {
    reference: doc(db, module.collection, project.linkedDocumentId),
    statusField
  };
}

function addLinkedSourcePublishToBatch(batch, project = {}) {
  const target = linkedSourcePublishTarget(project);
  if (!target) return;
  batch.update(target.reference, { [target.statusField]: "published" });
}

async function validateAdditionalLinkedActions(project = {}) {
  for (const action of normalizeLinkedActions(project.linkedActions)) {
    await validateLinkedSourceReference(action.moduleKey, action.documentId);
  }
}

async function validateProjectCapabilityReferences(project = {}) {
  const references = [
    ...commaSeparatedToArray(project.skillIds).map((id) => ({ id, type: "skill", label: "Skill" })),
    ...commaSeparatedToArray(project.toolIds).map((id) => ({ id, type: "tool", label: "Tool" })),
    ...normalizePublicTagRefs(project.publicTagRefs).map((ref) => ({ id: ref.id, type: ref.type, label: `Public ${ref.type === "skill" ? "Skill" : "Tool"}` }))
  ];
  if (!references.length) return;
  const checked = await Promise.all(references.map(async (entry) => {
    const snapshot = await getDoc(doc(db, "skills", entry.id));
    return { ...entry, snapshot };
  }));
  for (const entry of checked) {
    if (!entry.snapshot.exists()) throw new Error(`${entry.label} reference is no longer available. Re-select it from the library.`);
    const stored = entry.snapshot.data() || {};
    let recordType = cleanText(stored.recordType).toLowerCase();
    if (!recordType) {
      try { recordType = cleanSkillData(stored).recordType; } catch {}
    }
    if (recordType !== entry.type) throw new Error(`${entry.label} reference points to the wrong library record type.`);
  }
}

function cleanBulkProjectChanges(rawChanges = {}) {
  const source = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges) ? rawChanges : {};
  const changes = {};
  if (BULK_PROJECT_MUTABLE_FIELDS.has("status") && Object.prototype.hasOwnProperty.call(source, "status")) {
    const status = cleanText(source.status).toLowerCase();
    if (!new Set(["draft", "published"]).has(status)) throw new Error("Project status must be Draft or Published.");
    changes.status = status;
  }
  if (BULK_PROJECT_MUTABLE_FIELDS.has("visible") && Object.prototype.hasOwnProperty.call(source, "visible")) {
    changes.visible = cleanBoolean(source.visible, true);
  }
  if (BULK_PROJECT_MUTABLE_FIELDS.has("featured") && Object.prototype.hasOwnProperty.call(source, "featured")) {
    changes.featured = cleanBoolean(source.featured, false);
  }
  return changes;
}

function storedRelationshipRepairPatch(rawData = {}) {
  if (normalizeProjectType(rawData.projectType, rawData) !== "linked-module") return {};
  const module = resolveStoredProjectModule(rawData);
  if (!module) return {};
  const moduleKey = cleanText(module.key).toLowerCase();
  const scope = normalizeLinkedScope(rawData.linkedScope, module);
  const patch = {
    linkedModuleKey: moduleKey,
    linkedModule: moduleKey,
    linkedModuleId: cleanText(module.moduleId),
    linkedCollection: cleanText(module.collection),
    linkedScope: scope,
    linkedDestination: cleanText(module.publicDestination || rawData.linkedDestination || rawData.destination)
  };
  if (scope === "module") patch.linkedDocumentId = deleteField();
  return patch;
}

export async function updateManyProjects(projectIds = [], rawChanges = {}) {
  const ids = [...new Set((projectIds || []).map((id) => cleanText(id)).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one Project.");
  const changes = cleanBulkProjectChanges(rawChanges);
  if (!Object.keys(changes).length) throw new Error("No valid bulk Project changes were provided.");

  let updatedCount = 0;
  for (let start = 0; start < ids.length; start += BULK_PROJECT_WRITE_LIMIT) {
    const currentIds = ids.slice(start, start + BULK_PROJECT_WRITE_LIMIT);
    const snapshots = await Promise.all(currentIds.map((id) => getDoc(doc(db, PROJECT_COLLECTION, id))));
    const missing = snapshots.find((snapshot) => !snapshot.exists());
    if (missing) throw new Error("A selected Project is no longer available. Refresh and try again.");

    const batch = writeBatch(db);
    const linkedSourceUpdates = new Map();
    snapshots.forEach((snapshot) => {
      const raw = snapshot.data() || {};
      const repair = storedRelationshipRepairPatch(raw);
      batch.update(snapshot.ref, { ...repair, ...changes, updatedAt: serverTimestamp() });
      if (changes.status === "published") {
        const normalized = normalizeLoadedProject(snapshot.id, { ...raw, ...repair, ...changes });
        const target = linkedSourcePublishTarget(normalized);
        if (target) linkedSourceUpdates.set(target.reference.path, target);
      }
      updatedCount += 1;
    });
    linkedSourceUpdates.forEach((target) => {
      batch.update(target.reference, { [target.statusField]: "published" });
    });
    await batch.commit();
  }

  announcePortfolioContentChanged("projects");
  return updatedCount;
}

export function reserveProjectId() {
  return doc(projectCollectionReference).id;
}

export async function createProject(rawData, reservedProjectId = "") {
  const data = createSafeDocumentData(
    cleanProjectData(rawData)
  );

  await ensureUniqueProjectSlug(data);
  await validateProjectCapabilityReferences(data);
  if (data.projectType === "linked-module") {
    if (data.linkedScope === "module") {
      await ensureUniqueLinkedModuleReference(data.linkedModuleKey);
    } else if (data.linkedDocumentId) {
      await validateLinkedSourceReference(data.linkedModuleKey, data.linkedDocumentId);
      await ensureUniqueLinkedProjectReference(data.linkedModuleKey, data.linkedDocumentId);
    }
    await validateAdditionalLinkedActions(data);
  }

  const reference = reservedProjectId ? doc(db, PROJECT_COLLECTION, cleanText(reservedProjectId)) : doc(projectCollectionReference);
  const batch = writeBatch(db);
  batch.set(reference, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  addLinkedSourcePublishToBatch(batch, data);
  await batch.commit();
  commitMediaAssets(projectOwnedMedia(data));
  announcePortfolioContentChanged("projects");

  return reference.id;
}

export async function updateProject(
  projectId,
  rawData
) {
  if (!projectId) {
    throw new Error("Project ID is required.");
  }

  const data = createSafeDocumentData(
    cleanProjectData(rawData)
  );

  await ensureUniqueProjectSlug(data, projectId);
  await validateProjectCapabilityReferences(data);
  if (data.projectType === "linked-module") {
    if (data.linkedScope === "module") {
      await ensureUniqueLinkedModuleReference(data.linkedModuleKey, projectId);
    } else if (data.linkedDocumentId) {
      await validateLinkedSourceReference(data.linkedModuleKey, data.linkedDocumentId);
      await ensureUniqueLinkedProjectReference(data.linkedModuleKey, data.linkedDocumentId, projectId);
    }
    await validateAdditionalLinkedActions(data);
  }

  const projectReference = doc(db, PROJECT_COLLECTION, projectId);
  const existingSnapshot = await getDoc(projectReference);
  if (!existingSnapshot.exists()) throw new Error("Project not found.");
  const previousData = existingSnapshot.data() || {};

  const batch = writeBatch(db);
  batch.update(projectReference, {
    ...data,
    // Projects are hard-deleted by this service. Clear legacy soft-delete /
    // archive tombstones whenever an active Project is explicitly saved so
    // old records cannot remain hidden from the public portfolio.
    isDeleted: deleteField(),
    deleted: deleteField(),
    deletedAt: deleteField(),
    archived: deleteField(),
    isArchived: deleteField(),
    archivedAt: deleteField(),
    publicToolMode: deleteField(),
    publicToolIds: deleteField(),
    ...(data.projectType === "standalone" ? {
      linkedCollection: deleteField()
    } : {}),
    updatedAt: serverTimestamp()
  });
  addLinkedSourcePublishToBatch(batch, data);
  await batch.commit();
  await cleanupRemovedMediaAssets(
    projectOwnedMedia(previousData),
    projectOwnedMedia(data),
    { reason: "project-media-updated" }
  );
  announcePortfolioContentChanged("projects");
}

export async function deleteProject(projectId, options = {}) {
  if (!projectId) {
    throw new Error("Project ID is required.");
  }

  const reference = doc(db, PROJECT_COLLECTION, projectId);
  const existingSnapshot = await getDoc(reference);
  const previousData = existingSnapshot.exists() ? existingSnapshot.data() || {} : {};
  const strictMediaCleanup = options.strictMediaCleanup === true;

  if (strictMediaCleanup) {
    await cleanupDeletedRecordMedia(projectOwnedMedia(previousData), { reason: "project-deleted", strict: true });
  }
  await deleteDoc(reference);
  if (!strictMediaCleanup) {
    await cleanupDeletedRecordMedia(projectOwnedMedia(previousData), { reason: "project-deleted" });
  }
  announcePortfolioContentChanged("projects");
}

export async function loadProjects() {
  // Do not order in Firestore: orderBy excludes legacy documents that do not
  // contain displayOrder. Load every project and apply the existing safe
  // client-side comparator, which already provides a numeric fallback.
  const snapshot = await getDocs(projectCollectionReference);

  return snapshot.docs
    .map((item) => normalizeLoadedProject(item.id, item.data() || {}))
    .sort(compareDisplayOrder);
}
