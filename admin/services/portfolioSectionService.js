import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { persistentAssetUrl } from "../../asset-resolver.js";
import {
  MODULE_FIELD_TYPES as PLATFORM_FIELD_TYPES,
  normalizeEntryField as normalizePlatformField,
  normalizeModuleDefinition,
  resolveModuleCoverField,
  suggestModulePublicPresentation,
  nextModuleDuplicateSlug
} from "../../module-platform.js";
import {
  evaluateModuleChecks,
  summarizeModuleChecks
} from "../../module-validation.js";
import { reconcileModuleMaturityMeta } from "../../module-maturity.js";
import {
  commitMediaAssets,
  cleanupDeletedRecordMedia,
  cleanupModuleOwnedMedia
} from "./mediaAssetLifecycleService.js";
import {
  collectManagedMediaReferences,
  removedManagedMediaReferences,
  unreferencedManagedMediaReferences
} from "../../media-asset-lifecycle.js";

export const SECTION_COLLECTION = "portfolioSections";
export const ENTRY_COLLECTION = "portfolioSectionEntries";

export const MODULE_CONTENT_MODES = Object.freeze(["standalone", "linked", "mixed"]);
export const MODULE_PLACEMENTS = Object.freeze([
  "after-experience",
  "before-projects",
  "after-projects",
  "before-photo-editing",
  "after-photo-editing",
  "before-education",
  "after-education",
  "before-contact"
]);
export const MODULE_LAYOUT_PROFILES = Object.freeze(["cards", "compact", "showcase", "media-gallery", "list"]);

const safe = (value = "") => String(value ?? "").trim();
const slugify = (value = "") => safe(value)
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 64);
const unique = (value = []) => [...new Set((Array.isArray(value) ? value : safe(value).split(",")).map(safe).filter(Boolean))];
const cleanBoolean = (value, fallback = false) => value === undefined || value === null ? fallback : value === true || value === "true" || value === 1 || value === "1";
const enumToken = (value = "") => safe(value)
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[\/_–—-]+/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const enumValue = (value, options, fallback) => {
  const wanted = enumToken(value);
  const match = options.find((option) => enumToken(option) === wanted);
  return match || fallback;
};

export const MODULE_FIELD_TYPES = PLATFORM_FIELD_TYPES;

const MODULE_MEDIA_FIELD_TYPES = new Set([
  "image", "images", "gallery", "video", "audio", "pdf", "document", "file", "project-file", "files"
]);

function sectionEntryOwnedMedia(section = null, record = {}) {
  if (!section) return {};
  const normalizedSection = normalizeSection(section);
  const entry = normalizeEntry(record, normalizedSection);
  const media = {};
  normalizedSection.fields
    .filter((field) => MODULE_MEDIA_FIELD_TYPES.has(field.type))
    .forEach((field) => { media[field.key] = entry.data?.[field.key]; });
  return media;
}

export const DEFAULT_MODULE_FIELDS = Object.freeze([]);

export const RELATIONSHIP_TARGETS = Object.freeze([
  Object.freeze({ key: "experience", label: "Experience", collection: "experiences", titleFields: ["role", "position", "jobTitle", "title"], metaFields: ["company"] }),
  Object.freeze({ key: "projects", label: "Projects", collection: "projects", titleFields: ["title", "standaloneProjectName"], metaFields: ["category", "projectYear"] }),
  Object.freeze({ key: "photo-editing", label: "Photo Editing", collection: "photoEditingProjects", titleFields: ["title"], metaFields: ["category"] }),
  Object.freeze({ key: "education", label: "Education", collection: "education", titleFields: ["degreeName", "degree", "schoolName", "school"], metaFields: ["schoolName", "majorName"] }),
  Object.freeze({ key: "certificates", label: "Certificates", collection: "certificates", titleFields: ["title"], metaFields: ["issuer"] }),
  Object.freeze({ key: "resume", label: "Resume", collection: "resumes", titleFields: ["title", "name"], metaFields: [] })
]);

function normalizeField(raw = {}, index = 0) {
  return normalizePlatformField(raw, index);
}

function normalizeFields(value) {
  const source = Array.isArray(value) ? value : DEFAULT_MODULE_FIELDS;
  const fields = [];
  const seen = new Set();
  source.forEach((raw, index) => {
    const field = normalizeField(raw, index);
    if (!field.key || seen.has(field.key)) return;
    seen.add(field.key);
    fields.push(field);
  });
  return fields;
}

function normalizeRelationship(raw = {}, index = 0) {
  const label = safe(raw.label || raw.name || `Relationship ${index + 1}`);
  const key = slugify(raw.key || label).replace(/-/g, "_") || `relationship_${index + 1}`;
  return {
    key,
    label: label || key,
    targetModule: safe(raw.targetModule || raw.moduleKey).toLowerCase(),
    multiple: cleanBoolean(raw.multiple, false),
    required: cleanBoolean(raw.required, false),
    public: cleanBoolean(raw.public, true)
  };
}


const RESERVED_MODULE_KEYS = new Set([
  "dashboard", "home", "about", "experience", "education", "skills", "projects",
  "photo-editing", "services", "certificates", "resume", "resumes", "contact", "settings", "module"
]);

function normalizeRelationships(value = []) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list.map(normalizeRelationship).filter((item) => {
    if (!item.key || !item.targetModule || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function compatibleField(fields, preferredKey, acceptedTypes = []) {
  const direct = fields.find((field) => field.key === safe(preferredKey));
  if (direct && (!acceptedTypes.length || acceptedTypes.includes(direct.type))) return direct.key;
  return fields.find((field) => !acceptedTypes.length || acceptedTypes.includes(field.type))?.key || "";
}

function normalizeDisplay(raw = {}, fields = [], entryCapabilities = {}) {
  const requestedSummary = safe(raw.summaryField);
  const summaryField = ["shortsummary", "cardsummary", "summary", "shortdescription"].includes(requestedSummary.toLowerCase().replace(/[^a-z0-9]/g, ""))
    ? "shortSummary"
    : requestedSummary === "description"
      ? "description"
      : "shortSummary";
  const coverField = resolveModuleCoverField(fields, { displayImageField: raw.imageField || "coverImage" });
  return {
    titleField: "title",
    summaryField,
    // `imageField` is retained as the persisted compatibility key, but its
    // canonical meaning is now Cover source. Gallery/video/document fields are
    // secondary media and cannot replace the required Cover slot.
    imageField: coverField?.key || "",
    categoryField: entryCapabilities?.category?.enabled ? "category" : "",
    tagsField: compatibleField(fields, raw.tagsField || "tags", ["tags", "multiselect"]),
    buttonLabel: safe(raw.buttonLabel || "View Details") || "View Details"
  };
}

export function normalizeSection(raw = {}) {
  const title = safe(raw.title || raw.publicTitle);
  const key = slugify(raw.key || raw.internalKey || title);
  const normalizedFields = normalizeFields(raw.fields);
  const platform = normalizeModuleDefinition({ ...raw, fields: normalizedFields });
  const fields = platform.fields;
  const relationships = normalizeRelationships(raw.relationships);
  const display = normalizeDisplay(raw.display || {}, fields, platform.entryCapabilities);
  return {
    id: safe(raw.id), key, title, subtitle: safe(raw.subtitle), slug: slugify(raw.slug || key),
    lifecycle: platform.lifecycle, rawLifecycle: platform.rawLifecycle, legacyLifecycle: platform.legacyLifecycle,
    lifecycleMeta: raw.lifecycleMeta && typeof raw.lifecycleMeta === "object" && !Array.isArray(raw.lifecycleMeta) ? { ...raw.lifecycleMeta } : {},
    adminWorkspaceMode: platform.adminWorkspaceMode, adminWorkspace: platform.adminWorkspace, resolvedAdminWorkspace: platform.resolvedAdminWorkspace, workspaceTraits: platform.workspaceTraits, workspaceResolutionReason: platform.workspaceResolutionReason,
    contentIntentMode: platform.contentIntentMode, contentIntent: platform.contentIntent,
    publicPresentationMode: platform.publicPresentationMode, publicPresentation: platform.publicPresentation,
    theme: platform.theme, projectLinking: platform.projectLinking, composition: platform.composition,
    entryCapabilities: platform.entryCapabilities,
    publicEnabled: platform.publicEnabled, hideWhenEmpty: platform.hideWhenEmpty, layoutMode: platform.layoutMode, layoutPreset: platform.layoutPreset, overflowMode: platform.overflowMode, width: platform.width,
    shareRowWith: platform.shareRowWith, side: platform.side, navigationLink: platform.navigationLink,
    status: enumValue(raw.status || raw.publicationStatus, ["draft", "published"], "draft"),
    visible: raw.visible !== false, enabled: raw.enabled !== false,
    state: enumValue(raw.state || raw.moduleState, ["enabled", "hidden", "coming-soon"], "enabled"),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 500,
    placement: enumValue(raw.placement || raw.publicPlacement || raw.placementAfter, MODULE_PLACEMENTS, "after-photo-editing"),
    placementAfter: enumValue(raw.placement || raw.publicPlacement || raw.placementAfter, MODULE_PLACEMENTS, "after-photo-editing"),
    contentMode: enumValue(raw.contentMode || raw.entryMode, MODULE_CONTENT_MODES, "standalone"),
    setupComplete: cleanBoolean(raw.setupComplete, Array.isArray(raw.fields) && raw.fields.length > 0),
    setupState: enumValue(raw.setupState, ["pending", "ready", "draft", "published", "hidden"], raw.setupComplete === false ? "pending" : (safe(raw.status).toLowerCase() === "published" ? "published" : "draft")),
    linkableToProjects: platform.projectLinking.enabled,
    layoutProfile: enumValue(raw.layoutProfile || raw.layout, MODULE_LAYOUT_PROFILES, "cards"),
    emptyStateText: safe(raw.emptyStateText), cover: safe(raw.cover || raw.icon || raw.coverUrl), categories: platform.entryCapabilities.category.options,
    fields, relationships, display, adapter: "generic-entry", collection: ENTRY_COLLECTION
  };
}

export function sectionContentReadiness(sectionRaw = {}, entries = []) {
  const result = evaluateModuleChecks(sectionRaw);
  const structural = summarizeModuleChecks(result, "structural");
  const publicEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.status === "published" && entry?.visible !== false);
  const contentIssues = publicEntries.length ? [] : ["Publish at least one visible entry."];
  const structuralIssues = structural.missing.map((check) => check.reason || check.label);
  const issues = [...structuralIssues, ...contentIssues];
  return {
    ready: issues.length === 0,
    issues,
    publicEntryCount: publicEntries.length,
    structural,
    content: { ready: contentIssues.length === 0, issues: contentIssues, publicEntryCount: publicEntries.length }
  };
}

export function sectionReadiness(sectionRaw = {}, entries = []) {
  return sectionContentReadiness(sectionRaw, entries);
}

export async function registerSection(raw = {}) {
  const title = safe(raw.title || raw.publicTitle);
  const key = slugify(raw.key || title);
  if (!title || !key) throw new Error("Module title is required.");
  const value = normalizeSection({
    title, key, slug: key, lifecycle: "building", status: "draft", visible: true, enabled: true, state: "enabled",
    placement: "after-photo-editing", contentMode: "standalone", setupComplete: false, setupState: "pending",
    adminWorkspaceMode: "auto", adminWorkspace: "simple-manager", resolvedAdminWorkspace: "simple-manager", contentIntentMode: "auto", contentIntent: "mixed", publicPresentationMode: "auto", publicPresentation: "cards",
    theme: { accent: "#7c5cff", icon: "", iconMode: "auto", heroStyle: "soft-glow" },
    projectLinking: { enabled: false, scope: "module" },
    composition: { publicEnabled: false, hideWhenEmpty: true, placement: "after-photo-editing", publicPresentationMode: "auto", publicPresentation: "cards", layoutMode: "auto", layoutPreset: "standard-half", overflowMode: "auto", width: "full", shareRowWith: "", side: "auto", navigationLink: false },
    fields: [], relationships: [], display: {}
  });
  if (RESERVED_MODULE_KEYS.has(value.key)) throw new Error("Choose a different module title. That name belongs to a built-in CMS module.");
  await assertUnique(value, "");
  const reference = doc(collection(db, SECTION_COLLECTION), value.key);
  const { id: _id, rawLifecycle: _rawLifecycle, legacyLifecycle: _legacyLifecycle, lifecycleMeta: _lifecycleMeta, ...persisted } = value;
  const lifecycleMeta = reconcileModuleMaturityMeta(value, {}).meta;
  await setDoc(reference, { ...persisted, lifecycle: "building", lifecycleMeta, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return reference.id;
}

export async function updateSectionRegistry(id, changes = {}) {
  if (!id) throw new Error("Module id is required.");
  const ref = doc(db, SECTION_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("This custom module no longer exists.");
  const current = normalizeSection({ ...snap.data(), id });
  const placement = enumValue(changes.placement ?? changes.placementAfter ?? current.placement, MODULE_PLACEMENTS, current.placement);
  const publicPresentationMode = ["auto", "manual"].includes(changes.publicPresentationMode) ? changes.publicPresentationMode : (current.publicPresentationMode || "auto");
  const recommendedPresentation = suggestModulePublicPresentation(current);
  const publicPresentation = publicPresentationMode === "auto" ? recommendedPresentation : (changes.publicPresentation ?? current.publicPresentation);
  const composition = {
    ...current.composition,
    publicEnabled: changes.publicEnabled ?? current.publicEnabled,
    hideWhenEmpty: changes.hideWhenEmpty ?? current.hideWhenEmpty,
    placement,
    publicPresentationMode,
    publicPresentation,
    layoutMode: ["auto", "manual"].includes(changes.layoutMode) ? changes.layoutMode : (current.layoutMode || "auto"),
    layoutPreset: changes.layoutPreset ?? current.layoutPreset ?? "standard-half",
    overflowMode: changes.overflowMode ?? current.overflowMode ?? "auto",
    width: changes.width ?? current.width,
    shareRowWith: changes.shareRowWith ?? current.shareRowWith,
    side: changes.side ?? current.side,
    navigationLink: changes.navigationLink ?? current.navigationLink
  };
  const next = { composition, publicEnabled: composition.publicEnabled, hideWhenEmpty: composition.hideWhenEmpty, placement, placementAfter: placement, publicPresentationMode: composition.publicPresentationMode, publicPresentation: composition.publicPresentation, layoutMode: composition.layoutMode, layoutPreset: composition.layoutPreset, overflowMode: composition.overflowMode, width: composition.width, shareRowWith: composition.shareRowWith, side: composition.side, navigationLink: composition.navigationLink, status: changes.status === "published" ? "published" : changes.status === "draft" ? "draft" : current.status, updatedAt: serverTimestamp() };
  await updateDoc(ref, next);
  return normalizeSection({ ...current, ...next, id });
}

function mediaUrl(value) {
  return persistentAssetUrl(value);
}


function normalizeFieldValue(value, field = {}) {
  if (["boolean", "toggle"].includes(field.type)) return cleanBoolean(value, false);
  if (field.type === "number") return value === "" || value === null || value === undefined ? "" : Number(value);
  if (["tags", "multiselect", "skills", "tools"].includes(field.type)) return unique(value);
  if (["images", "gallery", "files"].includes(field.type)) return Array.isArray(value) ? value.filter(Boolean) : [];
  if (["image", "video", "audio", "pdf", "document", "file", "project-file"].includes(field.type)) return value && typeof value === "object" ? value : safe(value);
  if (field.type === "relationship") return field.multiple ? (Array.isArray(value) ? value.filter(Boolean) : []) : (value && typeof value === "object" ? value : safe(value));
  return safe(value);
}

function legacyEntryData(raw = {}) {
  return {
    title: raw.title,
    shortSummary: raw.shortSummary,
    description: raw.description,
    coverImage: raw.coverImage || raw.coverImageUrl,
    category: raw.category,
    tags: raw.tags,
    externalLink: raw.externalLink,
    mediaLink: raw.mediaLink
  };
}

function firstEntryAlias(source = {}, keys = []) {
  const normalized = new Map(Object.entries(source || {}).map(([key, value]) => [safe(key).toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
  for (const key of keys) {
    const value = normalized.get(safe(key).toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

export function normalizeEntry(raw = {}, section = null) {
  const normalizedSection = section ? normalizeSection(section) : null;
  const fields = normalizedSection?.fields || normalizeFields(raw.fields || DEFAULT_MODULE_FIELDS);
  const sourceData = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? { ...legacyEntryData(raw), ...raw.data }
    : legacyEntryData(raw);
  const data = {};
  fields.forEach((field) => {
    data[field.key] = normalizeFieldValue(sourceData[field.key], field);
  });
  Object.entries(sourceData).forEach(([key, value]) => {
    if (!(key in data) && value !== undefined) data[key] = value;
  });

  const display = normalizedSection?.display || normalizeDisplay({}, fields, normalizedSection?.entryCapabilities);
  const title = safe(raw.title || data.title || firstEntryAlias(sourceData, ["title", "entryName", "name"]));
  const slug = slugify(raw.slug || data.slug || title);
  const shortSummary = safe(raw.shortSummary || firstEntryAlias(sourceData, ["shortSummary", "cardSummary", "summary", "shortDescription"]));
  const description = safe(raw.description || firstEntryAlias(sourceData, ["description", "fullDescription"]) || shortSummary);
  const categoryKey = normalizedSection?.entryCapabilities?.category?.key || "category";
  const category = safe(raw.category || sourceData[categoryKey] || data.category || firstEntryAlias(sourceData, ["category"]));
  const imageValue = raw.coverImage || data[display.imageField] || data.coverImage;
  const tags = unique(raw.tags?.length ? raw.tags : (data[display.tagsField] || data.tags || []));

  return {
    sectionKey: slugify(raw.sectionKey),
    entryMode: enumValue(raw.entryMode, ["standalone", "linked"], normalizedSection?.contentMode === "linked" ? "linked" : "standalone"),
    data,
    relationships: raw.relationships && typeof raw.relationships === "object" && !Array.isArray(raw.relationships) ? raw.relationships : {},
    skillIds: unique(raw.skillIds),
    toolIds: unique(raw.toolIds),
    title,
    slug,
    category,
    shortSummary,
    description,
    coverImage: imageValue && typeof imageValue === "object" && !Array.isArray(imageValue) ? imageValue : null,
    coverImageUrl: safe(raw.coverImageUrl || mediaUrl(imageValue)),
    coverImageAlt: safe(raw.coverImageAlt || `${title || "Portfolio entry"} cover`),
    mediaLink: safe(raw.mediaLink || data.mediaLink),
    externalLink: safe(raw.externalLink || data.externalLink),
    tags,
    status: enumValue(raw.status || raw.publicationStatus, ["draft", "published"], "draft"),
    visible: raw.visible !== false,
    featured: raw.featured === true,
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 0,
    maturityRevision: Math.max(0, Number(raw.maturityRevision) || 0),
    maturitySaveCount: Math.max(0, Number(raw.maturitySaveCount) || 0),
    maturitySessionId: safe(raw.maturitySessionId),
    duplicateRootEntryId: safe(raw.duplicateRootEntryId),
    duplicateSourceEntryId: safe(raw.duplicateSourceEntryId),
    duplicateGeneration: Math.max(0, Number(raw.duplicateGeneration) || 0),
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null
  };
}

export function buildEntryRecord(section, raw = {}) {
  const normalizedSection = normalizeSection(section || {});
  const value = normalizeEntry({ ...raw, sectionKey: normalizedSection.key }, normalizedSection);
  const display = normalizedSection.display;
  const imageValue = value.data[display.imageField];
  return {
    ...value,
    title: safe(value.data[display.titleField] || value.title),
    slug: slugify(value.slug || value.data.slug || value.data[display.titleField] || value.title),
    shortSummary: safe(value.data[display.summaryField] || value.shortSummary),
    description: safe(value.data.description || value.description),
    category: safe(value.data[display.categoryField] || value.category),
    coverImage: imageValue && typeof imageValue === "object" && !Array.isArray(imageValue) ? imageValue : value.coverImage,
    coverImageUrl: mediaUrl(imageValue) || value.coverImageUrl,
    tags: unique(value.data[display.tagsField] || value.tags)
  };
}

async function assertUnique(section, currentId = "") {
  const all = await getDocs(collection(db, SECTION_COLLECTION));
  for (const item of all.docs) {
    if (item.id === currentId) continue;
    const data = item.data();
    if (safe(data.key) === section.key) throw new Error("That internal key already exists.");
    if (safe(data.slug) === section.slug) throw new Error("That public slug already exists.");
  }
}

export async function listSections() {
  const snapshot = await getDocs(collection(db, SECTION_COLLECTION));
  return snapshot.docs
    .map((item) => ({ ...normalizeSection(item.data()), id: item.id }))
    .sort((first, second) => first.displayOrder - second.displayOrder || first.title.localeCompare(second.title));
}

export async function auditModuleRegistryIntegrity() {
  const [sectionsSnapshot, entriesSnapshot] = await Promise.all([
    getDocs(collection(db, SECTION_COLLECTION)),
    getDocs(collection(db, ENTRY_COLLECTION))
  ]);
  const sectionKeys = new Set(
    sectionsSnapshot.docs
      .map((item) => slugify(item.data()?.key || item.id))
      .filter(Boolean)
  );
  const orphanEntryIds = entriesSnapshot.docs
    .filter((item) => {
      const sectionKey = slugify(item.data()?.sectionKey);
      return sectionKey && !sectionKeys.has(sectionKey);
    })
    .map((item) => item.id);

  return {
    sections: sectionsSnapshot.size,
    entries: entriesSnapshot.size,
    orphanEntryIds,
    orphanEntries: orphanEntryIds.length
  };
}

export async function getSectionSource(sectionKey = "") {
  const key = slugify(sectionKey);
  if (!key) return null;
  const direct = await getDoc(doc(db, SECTION_COLLECTION, key));
  if (direct.exists()) {
    const raw = direct.data() || {};
    return { raw: { ...raw, id: direct.id }, section: { ...normalizeSection(raw), id: direct.id } };
  }
  const snapshot = await getDocs(collection(db, SECTION_COLLECTION));
  for (const item of snapshot.docs) {
    const raw = item.data() || {};
    const section = { ...normalizeSection(raw), id: item.id };
    if (section.key === key || section.slug === key) return { raw: { ...raw, id: item.id }, section };
  }
  return null;
}

export async function getSection(sectionKey = "") {
  return (await getSectionSource(sectionKey))?.section || null;
}

export async function saveSection(raw, id = "") {
  const validation = evaluateModuleChecks(raw);
  const persistenceSafety = summarizeModuleChecks(validation, "persistenceSafety");
  if (!persistenceSafety.ready) throw new Error(persistenceSafety.missing[0]?.reason || "Module structure cannot be saved safely.");
  const value = normalizeSection(raw);
  if (!value.title || !value.key || !value.slug) throw new Error("Title, key, and slug are required.");
  if (RESERVED_MODULE_KEYS.has(value.key)) throw new Error("Choose a different stable key. That key belongs to a built-in CMS module.");
  if (RESERVED_MODULE_KEYS.has(value.slug)) throw new Error("Choose a different public slug. That destination belongs to a built-in portfolio section.");
  let currentSection = null;
  let currentLifecycleMeta = {};
  if (id) {
    const current = await getDoc(doc(db, SECTION_COLLECTION, id));
    if (current.exists()) {
      const currentRaw = current.data() || {};
      currentSection = normalizeSection({ ...currentRaw, id });
      currentLifecycleMeta = currentRaw.lifecycleMeta && typeof currentRaw.lifecycleMeta === "object" && !Array.isArray(currentRaw.lifecycleMeta) ? { ...currentRaw.lifecycleMeta } : {};
      if (currentSection.key && currentSection.key !== value.key) throw new Error("The stable module key cannot be changed after the module is created.");
    }
  }
  await assertUnique(value, id);
  const requestedSetupState = enumValue(raw.setupState, ["pending", "ready", "draft", "published", "hidden"], value.setupState);
  const setupState = !value.setupComplete
    ? "pending"
    : value.status === "published"
      ? "published"
      : requestedSetupState === "ready" ? "ready" : "draft";
  const { lifecycle: _lifecycle, rawLifecycle: _rawLifecycle, legacyLifecycle: _legacyLifecycle, lifecycleMeta: _lifecycleMeta, ...ordinaryValue } = value;
  const homePresentationMode = currentSection?.publicPresentationMode || "auto";
  const homePresentation = currentSection && homePresentationMode === "auto" ? suggestModulePublicPresentation(value) : currentSection?.publicPresentation;
  const homeComposition = currentSection ? {
    composition: { ...currentSection.composition, publicPresentationMode: homePresentationMode, publicPresentation: homePresentation, layoutMode: currentSection.layoutMode || "auto", layoutPreset: currentSection.layoutPreset || "standard-half", overflowMode: currentSection.overflowMode || "auto" },
    publicEnabled: currentSection.publicEnabled,
    hideWhenEmpty: currentSection.hideWhenEmpty,
    placement: currentSection.placement,
    placementAfter: currentSection.placement,
    publicPresentationMode: homePresentationMode,
    publicPresentation: homePresentation,
    layoutMode: currentSection.layoutMode || "auto",
    layoutPreset: currentSection.layoutPreset || "standard-half",
    overflowMode: currentSection.overflowMode || "auto",
    width: currentSection.width,
    shareRowWith: currentSection.shareRowWith,
    side: currentSection.side,
    navigationLink: currentSection.navigationLink
  } : { placementAfter: value.placement };
  const maturityState = reconcileModuleMaturityMeta({ ...value, setupState }, currentLifecycleMeta);
  const persisted = { ...ordinaryValue, ...homeComposition, setupState, lifecycleMeta: maturityState.meta };
  if (id) {
    await setDoc(doc(db, SECTION_COLLECTION, id), { ...persisted, updatedAt: serverTimestamp() }, { merge: true });
    return id;
  }
  const reference = doc(collection(db, SECTION_COLLECTION), value.key);
  await setDoc(reference, { ...persisted, lifecycle: "building", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return reference.id;
}

export async function persistSectionLifecycleTransition(sectionIdOrKey, transitionPatch = {}) {
  const requested = safe(sectionIdOrKey);
  if (!requested) throw new Error("Module id is required for a lifecycle transition.");
  let reference = doc(db, SECTION_COLLECTION, requested);
  let snapshot = await getDoc(reference);
  if (!snapshot.exists()) {
    const section = await getSection(requested);
    if (!section?.id) throw new Error("This custom module no longer exists.");
    reference = doc(db, SECTION_COLLECTION, section.id);
    snapshot = await getDoc(reference);
  }
  const lifecycle = transitionPatch.lifecycle === "promoted" ? "promoted" : transitionPatch.lifecycle === "building" ? "building" : "";
  if (!lifecycle) throw new Error("Lifecycle transitions may only persist building or promoted state.");
  const lifecycleMeta = transitionPatch.lifecycleMeta && typeof transitionPatch.lifecycleMeta === "object" && !Array.isArray(transitionPatch.lifecycleMeta)
    ? { ...transitionPatch.lifecycleMeta }
    : {};
  await updateDoc(reference, { lifecycle, lifecycleMeta, updatedAt: serverTimestamp() });
  const verified = await getDoc(reference);
  return verified.exists() ? { ...normalizeSection(verified.data()), id: verified.id } : null;
}

export async function persistSectionLifecycleMeta(sectionIdOrKey, lifecycleMeta = {}) {
  const requested = safe(sectionIdOrKey);
  if (!requested) throw new Error("Module id is required for lifecycle metadata.");
  let reference = doc(db, SECTION_COLLECTION, requested);
  let snapshot = await getDoc(reference);
  if (!snapshot.exists()) {
    const section = await getSection(requested);
    if (!section?.id) throw new Error("This custom module no longer exists.");
    reference = doc(db, SECTION_COLLECTION, section.id);
    snapshot = await getDoc(reference);
  }
  const safeMeta = lifecycleMeta && typeof lifecycleMeta === "object" && !Array.isArray(lifecycleMeta) ? { ...lifecycleMeta } : {};
  await updateDoc(reference, { lifecycleMeta: safeMeta, updatedAt: serverTimestamp() });
  const verified = await getDoc(reference);
  return verified.exists() ? { ...normalizeSection(verified.data()), id: verified.id } : null;
}

export async function getSectionDeletionImpact(sectionIdOrKey = "") {
  const source = await getSectionSource(sectionIdOrKey);
  const section = source?.section || null;
  if (!section) throw new Error("This custom module no longer exists.");

  const [entriesSnapshot, sections, projectsSnapshot] = await Promise.all([
    getDocs(query(collection(db, ENTRY_COLLECTION), where("sectionKey", "==", section.key))),
    listSections(),
    getDocs(collection(db, "projects"))
  ]);

  const dependentModules = sections.filter((candidate) => {
    if (candidate.id === section.id) return false;
    const relationshipDependency = (candidate.relationships || []).some((relationship) => relationship.targetModule === section.key);
    const compositionDependency = [section.id, section.key].includes(safe(candidate.shareRowWith));
    return relationshipDependency || compositionDependency;
  });

  const acceptedModuleTokens = new Set([section.key, section.id, section.title].map((value) => safe(value).toLowerCase()).filter(Boolean));
  const linkedProjects = projectsSnapshot.docs
    .map((item) => ({ id:item.id, ...(item.data() || {}) }))
    .filter((project) => {
      const tokens = [project.linkedModuleKey, project.linkedModuleId, project.linkedModule]
        .map((value) => safe(value).toLowerCase())
        .filter(Boolean);
      return tokens.some((token) => acceptedModuleTokens.has(token));
    });

  const ownedMedia = entriesSnapshot.docs.map((item) => sectionEntryOwnedMedia(section, item.data() || {}));
  return {
    moduleId: section.id,
    moduleKey: section.key,
    title: section.title,
    lifecycle: section.lifecycle,
    entryCount: entriesSnapshot.size,
    mediaAssetCount: collectManagedMediaReferences(ownedMedia).length,
    dependentModules: dependentModules.map((item) => ({ id:item.id, key:item.key, title:item.title })),
    linkedProjects: linkedProjects.map((item) => ({ id:item.id, title:safe(item.title || item.standaloneProjectName || item.id) })),
    blocked: dependentModules.length > 0
  };
}

async function deleteEntryDocumentsInChunks(documents = []) {
  const queue = Array.from(documents);
  while (queue.length) {
    const batch = writeBatch(db);
    queue.splice(0, 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function unreferencedEntryMedia(references = [], excludedEntryIds = [], { ignoreBorrowersOf = '' } = {}) {
  const candidates = collectManagedMediaReferences(references);
  if (!candidates.length) return [];
  const excluded = new Set((Array.isArray(excludedEntryIds) ? excludedEntryIds : [excludedEntryIds]).map(safe).filter(Boolean));
  const ownerRoot = safe(ignoreBorrowersOf);
  const snapshot = await getDocs(collection(db, ENTRY_COLLECTION));
  const retainedRecords = snapshot.docs
    .filter((item) => !excluded.has(item.id))
    .map((item) => ({ id: item.id, record: item.data() || {} }))
    .filter(({ record }) => !ownerRoot || safe(record.duplicateRootEntryId) !== ownerRoot)
    .map(({ record }) => record);
  return unreferencedManagedMediaReferences(candidates, retainedRecords);
}


export async function deleteSectionPermanently(sectionIdOrKey = "") {
  const impact = await getSectionDeletionImpact(sectionIdOrKey);
  if (impact.blocked) {
    const blockers = [];
    if (impact.dependentModules.length) blockers.push(`module relationships/composition: ${impact.dependentModules.map((item) => item.title).join(", ")}`);
    const error = new Error(`Remove external dependencies before deleting this module (${blockers.join("; ")}).`);
    error.code = "MODULE_DELETE_BLOCKED";
    error.impact = impact;
    throw error;
  }
  if (impact.linkedProjects.length) {
    const error = new Error("Linked Projects must be removed by the canonical module deletion cascade before deleting this module record.");
    error.code = "MODULE_DELETE_PROJECT_CASCADE_REQUIRED";
    error.impact = impact;
    throw error;
  }

  const source = await getSectionSource(sectionIdOrKey);
  if (!source?.section?.id) throw new Error("This custom module no longer exists.");
  const entriesSnapshot = await getDocs(query(collection(db, ENTRY_COLLECTION), where("sectionKey", "==", source.section.key)));
  const ownedMedia = entriesSnapshot.docs.map((item) => sectionEntryOwnedMedia(source.section, item.data() || {}));
  const deletableMedia = await unreferencedEntryMedia(ownedMedia, entriesSnapshot.docs.map((item) => item.id));
  await cleanupModuleOwnedMedia(deletableMedia, { reason: "custom-module-deleted", strict: true });
  await deleteEntryDocumentsInChunks(entriesSnapshot.docs);
  await deleteDoc(doc(db, SECTION_COLLECTION, source.section.id));
  return { deleted:true, ...impact };
}

export async function deleteSection(id) {
  const impact = await getSectionDeletionImpact(id);
  if (impact.entryCount) throw new Error("Delete this module's entries before deleting the module.");
  if (impact.blocked) throw new Error("Remove external dependencies before deleting this module.");
  await deleteSectionPermanently(id);
}

export async function listEntries(sectionKey, section = null) {
  const key = slugify(sectionKey);
  const resolvedSection = section || await getSection(key).catch(() => null);
  const snapshot = await getDocs(query(collection(db, ENTRY_COLLECTION), where("sectionKey", "==", key)));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...normalizeEntry(item.data(), resolvedSection) }))
    .sort((first, second) => first.displayOrder - second.displayOrder || first.title.localeCompare(second.title));
}


export function reserveEntryId() {
  return doc(collection(db, ENTRY_COLLECTION)).id;
}

export async function saveEntry(raw, id = "", section = null, options = {}) {
  const resolvedSection = section || await getSection(raw.sectionKey);
  if (!resolvedSection) throw new Error("The selected module is unavailable.");
  const value = buildEntryRecord(resolvedSection, raw);
  if (!value.sectionKey) throw new Error("Module is required.");
  const evidenceEnabled = options?.maturityEvidence === true;
  const currentRevision = Math.max(0, Number(resolvedSection.lifecycleMeta?.structuralRevision) || 0);
  const sessionId = safe(options?.sessionId);
  let maturityPatch = {};
  let previousData = null;
  const reservedCreate = options?.reservedCreate === true;
  let existingSnapshot = null;
  if (id) {
    existingSnapshot = await getDoc(doc(db, ENTRY_COLLECTION, id));
    if (!existingSnapshot.exists() && !reservedCreate) throw new Error("This module entry no longer exists.");
    previousData = existingSnapshot.exists() ? (existingSnapshot.data() || {}) : null;
  }
  if (evidenceEnabled && currentRevision > 0) {
    const previousRevision = previousData ? Math.max(0, Number(previousData.maturityRevision) || 0) : 0;
    const previousSaveCount = previousData ? Math.max(0, Number(previousData.maturitySaveCount) || 0) : 0;
    maturityPatch = {
      maturityRevision: currentRevision,
      maturitySaveCount: previousRevision === currentRevision ? previousSaveCount + 1 : 1,
      maturitySessionId: sessionId
    };
  }
  if (id) {
    const nextOwnedMedia = sectionEntryOwnedMedia(resolvedSection, value);
    if (!existingSnapshot?.exists() && reservedCreate) {
      await setDoc(doc(db, ENTRY_COLLECTION, id), { ...value, ...maturityPatch, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      commitMediaAssets(nextOwnedMedia);
      return id;
    }
    const previousOwnedMedia = sectionEntryOwnedMedia(resolvedSection, previousData);
    await updateDoc(doc(db, ENTRY_COLLECTION, id), { ...value, ...maturityPatch, updatedAt: serverTimestamp() });
    const removedMedia = removedManagedMediaReferences(previousOwnedMedia, nextOwnedMedia);
    const deletableMedia = await unreferencedEntryMedia(removedMedia);
    await cleanupDeletedRecordMedia(deletableMedia, { reason: "custom-module-entry-updated" });
    commitMediaAssets(nextOwnedMedia);
    return id;
  }
  const reference = await addDoc(collection(db, ENTRY_COLLECTION), { ...value, ...maturityPatch, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  commitMediaAssets(sectionEntryOwnedMedia(resolvedSection, value));
  return reference.id;
}

export async function duplicateEntry(id, section = null) {
  const sourceRef = doc(db, ENTRY_COLLECTION, id);
  const sourceSnapshot = await getDoc(sourceRef);
  if (!sourceSnapshot.exists()) throw new Error("This module entry no longer exists.");
  const source = sourceSnapshot.data() || {};
  const resolvedSection = section || await getSection(source.sectionKey);
  if (!resolvedSection) throw new Error("The selected module is unavailable.");

  const siblings = await getDocs(query(collection(db, ENTRY_COLLECTION), where("sectionKey", "==", resolvedSection.key)));
  const slug = nextModuleDuplicateSlug(source.slug || source.title || "entry", siblings.docs.map((item) => item.data()?.slug));
  const rootEntryId = safe(source.duplicateRootEntryId) || id;
  const generation = Math.max(0, Number(source.duplicateGeneration) || 0) + 1;
  const sourceData = source.data && typeof source.data === "object" && !Array.isArray(source.data) ? source.data : {};
  const { createdAt, updatedAt, maturityRevision, maturitySaveCount, maturitySessionId, ...copyable } = source;
  const duplicate = {
    ...copyable,
    sectionKey: resolvedSection.key,
    slug,
    data: { ...sourceData, slug },
    duplicateRootEntryId: rootEntryId,
    duplicateSourceEntryId: id,
    duplicateGeneration: generation,
    maturityRevision: 0,
    maturitySaveCount: 0,
    maturitySessionId: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const reference = await addDoc(collection(db, ENTRY_COLLECTION), duplicate);
  return reference.id;
}

export async function deleteEntry(id) {
  const reference = doc(db, ENTRY_COLLECTION, id);
  const existing = await getDoc(reference);
  if (!existing.exists()) return;
  const previousData = existing.data() || {};
  const resolvedSection = await getSection(previousData.sectionKey).catch(() => null);
  await deleteDoc(reference);
  if (resolvedSection) {
    const isBorrower = Boolean(safe(previousData.duplicateRootEntryId));
    const deletableMedia = await unreferencedEntryMedia(
      sectionEntryOwnedMedia(resolvedSection, previousData),
      [id],
      { ignoreBorrowersOf: isBorrower ? '' : id }
    );
    await cleanupDeletedRecordMedia(
      deletableMedia,
      { reason: isBorrower ? "custom-module-duplicate-deleted" : "custom-module-entry-owner-deleted" }
    );
  }
}

function firstValue(record = {}, fields = []) {
  for (const field of fields) {
    const value = record?.[field];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function targetRecordAllowed(record = {}) {
  return record?.deleted !== true && record?.isDeleted !== true && !record?.deletedAt && record?.archived !== true && record?.isArchived !== true && !record?.archivedAt;
}

export async function listRelationshipModules() {
  const custom = (await listSections()).filter((section) => section.enabled !== false).map((section) => ({
    key: section.key,
    label: section.title,
    dynamic: true
  }));
  return [...RELATIONSHIP_TARGETS.map((item) => ({ key: item.key, label: item.label, dynamic: false })), ...custom];
}

export async function listRelationshipEntries(moduleKey = "") {
  const key = safe(moduleKey).toLowerCase();
  const staticTarget = RELATIONSHIP_TARGETS.find((item) => item.key === key);
  if (staticTarget) {
    const snapshot = await getDocs(collection(db, staticTarget.collection));
    return snapshot.docs
      .map((item) => {
        const record = item.data() || {};
        const title = safe(firstValue(record, staticTarget.titleFields)) || "Untitled entry";
        const meta = staticTarget.metaFields.map((field) => safe(record[field])).filter(Boolean).join(" · ");
        return { id: item.id, moduleKey: key, title, meta, status: safe(record.status), visible: record.visible !== false, raw: record };
      })
      .filter((item) => targetRecordAllowed(item.raw))
      .sort((first, second) => first.title.localeCompare(second.title, undefined, { sensitivity: "base" }));
  }

  const section = await getSection(key);
  if (!section) return [];
  return (await listEntries(section.key, section)).map((entry) => ({
    id: entry.id,
    moduleKey: section.key,
    title: entry.title || "Untitled entry",
    meta: entry.category || "",
    status: entry.status,
    visible: entry.visible,
    raw: entry
  }));
}
