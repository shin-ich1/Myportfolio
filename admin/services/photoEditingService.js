/* =========================================================
   LΛN PORTFOLIO CMS
   Photo Editing Firestore Service

   Architecture:
   - Cloud Firestore stores project metadata.
   - Cloudinary stores uploaded images.
   - Firebase Storage is not used.
   - Project deletion uses soft delete.
   ========================================================= */

import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "./firebase.js";
import { uploadImage } from "./storageUploadService.js";
import { cleanSkillData } from "./skillService.js";
import { announcePortfolioContentChanged } from "./portfolioSyncService.js";
import { commitMediaAssets, cleanupRemovedMediaAssets } from "./mediaAssetLifecycleService.js";
import { normalizeAssetReference, hasAssetReference, assetReferenceIdentity, persistentAssetUrl } from "../../asset-resolver.js";

/* =========================================================
   CONSTANTS
   ========================================================= */

const COLLECTION_NAME = "photoEditingProjects";
const BULK_WRITE_LIMIT = 400;
const MAX_SLUG_LENGTH = 90;
const CAPABILITY_PROFILE_COLLECTION = "settings";
const CAPABILITY_PROFILE_DOCUMENT = "photoEditingCapabilities";
const DEFAULT_PHOTO_EDITING_CATEGORIES = Object.freeze([
  "Portrait Retouching",
  "Product Editing",
  "Background Removal",
  "Color Correction",
  "Thumbnail Design",
  "AI-Assisted Editing",
  "Photo Manipulation"
]);

const DISPLAY_TYPES = Object.freeze({
  COMPARISON: "comparison",
  SINGLE: "single",
  GALLERY: "gallery"
});

const PROJECT_STATUSES = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published"
});

const VALID_IMAGE_KINDS = Object.freeze([
  "before",
  "after"
]);

const photoEditingCollection = collection(
  db,
  COLLECTION_NAME
);

const projectsCollection = collection(
  db,
  "projects"
);


async function loadPhotoEditingLinkedProjectMap() {
  const references = new Map();
  const queries = [
    query(projectsCollection, where("linkedModuleKey", "==", "photo-editing")),
    query(projectsCollection, where("linkedModule", "==", "photo-editing")),
    query(projectsCollection, where("linkedModule", "==", "Photo Editing"))
  ];
  const snapshots = await Promise.all(queries.map((item) => getDocs(item)));
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
    const project = item.data() || {};
    const sourceId = cleanText(project.linkedDocumentId);
    if (sourceId && !references.has(sourceId)) {
      references.set(sourceId, {
        linkedProjectId: item.id,
        linkedProjectTitle: cleanText(project.title || project.linkedTitleSnapshot)
      });
    }
  }));
  return references;
}

async function attachPhotoEditingLinkedStatus(projects = []) {
  try {
    const references = await loadPhotoEditingLinkedProjectMap();
    return projects.map((project) => ({
      ...project,
      ...(references.get(project.id) || {})
    }));
  } catch (error) {
    console.warn("Unable to load Photo Editing linked status:", error);
    return projects;
  }
}

async function assertPhotoEditingProjectIsNotLinked(projectId) {
  const linkedProjectsQuery = query(
    projectsCollection,
    where("linkedDocumentId", "==", projectId),
    limit(10)
  );

  const linkedProjects = await getDocs(linkedProjectsQuery);
  const hasLinkedProject = linkedProjects.docs.some((item) => {
    const project = item.data() || {};
    const moduleKey = cleanText(
      project.linkedModuleKey || project.linkedModule
    ).toLowerCase();
    return moduleKey === "photo-editing" || moduleKey === "photo editing";
  });

  if (hasLinkedProject) {
    throw new Error(
      "This photo editing project is linked to a Project. Remove or unlink that Project first."
    );
  }
}

async function assertPhotoEditingProjectsAreNotLinked(projectIds = []) {
  const ids = [...new Set(projectIds.map((id) => cleanText(id)).filter(Boolean))];
  for (let start = 0; start < ids.length; start += 30) {
    const currentIds = ids.slice(start, start + 30);
    const snapshot = await getDocs(query(
      projectsCollection,
      where("linkedDocumentId", "in", currentIds)
    ));
    const linkedSourceIds = new Set(snapshot.docs
      .filter((item) => {
        const project = item.data() || {};
        const moduleKey = cleanText(project.linkedModuleKey || project.linkedModule).toLowerCase();
        return moduleKey === "photo-editing" || moduleKey === "photo editing";
      })
      .map((item) => cleanText(item.data()?.linkedDocumentId)));
    if (linkedSourceIds.size) {
      throw new Error(
        linkedSourceIds.size === 1
          ? "A selected photo editing project is linked to a Project. Remove or unlink that Project first."
          : "Some selected photo editing projects are linked to Projects. Remove or unlink those Projects first."
      );
    }
  }
}

const activeUploads = new Map();

/* =========================================================
   ERROR HELPERS
   ========================================================= */

function createServiceError(message, cause) {
  const error = new Error(message);

  if (cause !== undefined) {
    error.cause = cause;
  }

  return error;
}

function getErrorMessage(error, fallback) {
  const message = cleanText(error?.message);
  return message || fallback;
}

function assertPlainObject(value, fieldName = "Data") {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${fieldName} must be an object.`);
  }
}

function requireProjectId(projectId) {
  const id = cleanText(projectId);

  if (!id) {
    throw new Error(
      "Photo editing project ID is required."
    );
  }

  return id;
}

/* =========================================================
   BASIC SANITIZATION
   ========================================================= */

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function cleanBoolean(value) {
  if (typeof value === "string") {
    const normalizedValue = value
      .trim()
      .toLowerCase();

    return (
      normalizedValue === "true" ||
      normalizedValue === "on" ||
      normalizedValue === "yes" ||
      normalizedValue === "1"
    );
  }

  return value === true || value === 1;
}

function cleanNumber(value, fallback = 0) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function cleanNonNegativeNumber(
  value,
  fallback = 0
) {
  return Math.max(
    0,
    cleanNumber(value, fallback)
  );
}

function cleanArray(value = []) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const uniqueValues = new Map();

  for (const item of source) {
    const cleanedItem = cleanText(item);

    if (!cleanedItem) {
      continue;
    }

    const identity = cleanedItem.toLowerCase();

    if (!uniqueValues.has(identity)) {
      uniqueValues.set(identity, cleanedItem);
    }
  }

  return [...uniqueValues.values()];
}

function cleanKeywords(value = []) {
  const source = Array.isArray(value)
    ? value
    : cleanText(value).split(",");

  return cleanArray(source);
}


function uniqueReferenceIds(...values) {
  return cleanArray(values.flatMap((value) => Array.isArray(value) ? value : cleanArray(value)));
}

function capabilityCategoryKey(value = "") {
  return cleanText(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanCategoryLabel(value = "") {
  return cleanText(value).replace(/\s+/g, " ").slice(0, 60);
}

function uniqueCategoryLabels(...groups) {
  const values = new Map();
  groups.flatMap((group) => Array.isArray(group) ? group : []).forEach((value) => {
    const label = cleanCategoryLabel(typeof value === "object" ? value?.category : value);
    const key = capabilityCategoryKey(label);
    if (label && key && key !== "other" && key !== "photo-editing" && !values.has(key)) values.set(key, label);
  });
  return [...values.values()];
}

function cleanCapabilityProfile(raw = {}) {
  const rawProfiles = Array.isArray(raw.categoryProfiles) ? raw.categoryProfiles : [];
  const parsedProfiles = rawProfiles
    .map((item) => ({
      category: cleanCategoryLabel(item?.category),
      key: capabilityCategoryKey(item?.category || item?.key),
      skillIds: cleanArray(item?.skillIds),
      toolIds: cleanArray(item?.toolIds)
    }))
    .filter((item) => item.category && item.key && item.key !== "other" && item.key !== "photo-editing");
  const hasStoredCategories = Array.isArray(raw.categories);
  const categories = hasStoredCategories
    ? uniqueCategoryLabels(raw.categories)
    : uniqueCategoryLabels(DEFAULT_PHOTO_EDITING_CATEGORIES, parsedProfiles);
  const categoryKeys = new Set(categories.map(capabilityCategoryKey));
  const categoryProfiles = parsedProfiles.filter((item) => categoryKeys.has(item.key));
  return {
    version: 2,
    categories,
    categoryProfiles,
    // Read only for migration from the older portfolio-level capability model.
    legacyModuleSkillIds: cleanArray(raw.moduleSkillIds),
    legacyModuleToolIds: cleanArray(raw.moduleToolIds)
  };
}

function capabilityProfileForCategory(profile = {}, category = "") {
  const key = capabilityCategoryKey(category);
  return (Array.isArray(profile.categoryProfiles) ? profile.categoryProfiles : [])
    .find((item) => item.key === key) || { skillIds: [], toolIds: [] };
}

function effectivePhotoCapabilityIds(profile = {}, category = "", entrySkillIds = [], entryToolIds = [], inherit = true) {
  const categoryProfile = capabilityProfileForCategory(profile, category);
  return {
    skillIds: inherit ? uniqueReferenceIds(categoryProfile.skillIds, entrySkillIds) : cleanArray(entrySkillIds),
    toolIds: inherit ? uniqueReferenceIds(categoryProfile.toolIds, entryToolIds) : cleanArray(entryToolIds)
  };
}

export async function getPhotoEditingCapabilityProfile() {
  const snapshot = await getDoc(doc(db, CAPABILITY_PROFILE_COLLECTION, CAPABILITY_PROFILE_DOCUMENT));
  return cleanCapabilityProfile(snapshot.exists() ? snapshot.data() || {} : {});
}

export async function savePhotoEditingCapabilityProfile(rawProfile = {}) {
  const profile = cleanCapabilityProfile(rawProfile);
  await validatePhotoCapabilityReferences({
    skillIds: uniqueReferenceIds(...profile.categoryProfiles.map((item) => item.skillIds)),
    toolIds: uniqueReferenceIds(...profile.categoryProfiles.map((item) => item.toolIds))
  });

  const userId = currentUserId();
  const profileReference = doc(db, CAPABILITY_PROFILE_COLLECTION, CAPABILITY_PROFILE_DOCUMENT);
  const currentSnapshot = await getDoc(profileReference);
  const currentRaw = currentSnapshot.exists() ? currentSnapshot.data() || {} : {};
  const legacyProfileSkillIds = cleanArray(currentRaw.moduleSkillIds);
  const legacyProfileToolIds = cleanArray(currentRaw.moduleToolIds);

  await setDoc(profileReference, {
    version: profile.version,
    categories: profile.categories,
    categoryProfiles: profile.categoryProfiles,
    moduleSkillIds: deleteField(),
    moduleToolIds: deleteField(),
    updatedAt: serverTimestamp(),
    updatedBy: userId
  }, { merge: true });

  const snapshot = await getDocs(photoEditingCollection);
  const documents = snapshot.docs.filter((item) => (item.data() || {}).isDeleted !== true);
  for (let start = 0; start < documents.length; start += BULK_WRITE_LIMIT) {
    const batch = writeBatch(db);
    for (const item of documents.slice(start, start + BULK_WRITE_LIMIT)) {
      const data = item.data() || {};
      const hasEntryFields = Array.isArray(data.entrySkillIds) || Array.isArray(data.entryToolIds);
      const legacySkillIds = new Set(uniqueReferenceIds(legacyProfileSkillIds, data.moduleSkillIds));
      const legacyToolIds = new Set(uniqueReferenceIds(legacyProfileToolIds, data.moduleToolIds));
      const entrySkillIds = cleanArray(hasEntryFields ? data.entrySkillIds : (data.skillIds || data.skillsUsedIds)).filter((id) => !legacySkillIds.has(id));
      const entryToolIds = cleanArray(hasEntryFields ? data.entryToolIds : (data.toolIds || data.toolsUsedIds)).filter((id) => !legacyToolIds.has(id));
      const inherit = data.inheritCapabilityProfile !== false;
      const effective = effectivePhotoCapabilityIds(profile, data.category || data.projectCategory || data.type, entrySkillIds, entryToolIds, inherit);
      batch.update(item.ref, {
        inheritCapabilityProfile: inherit,
        entrySkillIds,
        entryToolIds,
        moduleSkillIds: deleteField(),
        moduleToolIds: deleteField(),
        skillIds: effective.skillIds,
        toolIds: effective.toolIds,
        capabilityProfileVersion: profile.version,
        capabilityProfileUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: userId
      });
    }
    await batch.commit();
  }
  announcePortfolioContentChanged("photo-editing");
  return profile;
}

export async function createPhotoEditingCategory(name) {
  const label = cleanCategoryLabel(name);
  const key = capabilityCategoryKey(label);
  if (!label || !key || key === "other" || key === "photo-editing") {
    throw new Error("Enter a valid Photo Editing category name.");
  }
  const reference = doc(db, CAPABILITY_PROFILE_COLLECTION, CAPABILITY_PROFILE_DOCUMENT);
  const snapshot = await getDoc(reference);
  const profile = cleanCapabilityProfile(snapshot.exists() ? snapshot.data() || {} : {});
  const categories = uniqueCategoryLabels(profile.categories, [label]);
  await setDoc(reference, {
    version: Math.max(2, Number(profile.version) || 2),
    categories,
    categoryProfiles: profile.categoryProfiles,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserId()
  }, { merge: true });
  announcePortfolioContentChanged("photo-editing");
  return categories;
}


async function photoCategoryMutationContext() {
  const profileReference = doc(db, CAPABILITY_PROFILE_COLLECTION, CAPABILITY_PROFILE_DOCUMENT);
  const [profileSnapshot, projectsSnapshot] = await Promise.all([
    getDoc(profileReference),
    getDocs(photoEditingCollection)
  ]);
  const profile = cleanCapabilityProfile(profileSnapshot.exists() ? profileSnapshot.data() || {} : {});
  const documents = projectsSnapshot.docs.filter((item) => (item.data() || {}).isDeleted !== true);
  return { profileReference, profile, documents };
}

function categoryUsageFromDocuments(documents = [], category = "") {
  const key = capabilityCategoryKey(category);
  return documents.filter((item) => capabilityCategoryKey((item.data() || {}).category) === key);
}

export async function getPhotoEditingCategoryManagerData() {
  const { profile, documents } = await photoCategoryMutationContext();
  return {
    categories: profile.categories.map((category, index) => ({
      category,
      order: index,
      usageCount: categoryUsageFromDocuments(documents, category).length
    }))
  };
}

export async function renamePhotoEditingCategory(currentName, nextName) {
  const current = cleanCategoryLabel(currentName);
  const next = cleanCategoryLabel(nextName);
  const currentKey = capabilityCategoryKey(current);
  const nextKey = capabilityCategoryKey(next);
  if (!currentKey || !nextKey || nextKey === "other" || nextKey === "photo-editing") throw new Error("Enter a valid category name.");
  const { profileReference, profile, documents } = await photoCategoryMutationContext();
  const currentIndex = profile.categories.findIndex((item) => capabilityCategoryKey(item) === currentKey);
  if (currentIndex < 0) throw new Error("That Photo Editing category no longer exists.");
  const duplicate = profile.categories.some((item, index) => index !== currentIndex && capabilityCategoryKey(item) === nextKey);
  if (duplicate) throw new Error("A Photo Editing category with that name already exists.");
  if (currentKey === nextKey && current === next) return getPhotoEditingCategoryManagerData();

  const categories = [...profile.categories];
  categories[currentIndex] = next;
  const categoryProfiles = profile.categoryProfiles.map((item) => item.key === currentKey ? { ...item, category: next, key: nextKey } : item);
  const nextProfile = cleanCapabilityProfile({ ...profile, categories, categoryProfiles });
  const affected = categoryUsageFromDocuments(documents, current);
  const batch = writeBatch(db);
  batch.set(profileReference, {
    version: nextProfile.version,
    categories: nextProfile.categories,
    categoryProfiles: nextProfile.categoryProfiles,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserId()
  }, { merge: true });
  affected.forEach((item) => {
    const data = item.data() || {};
    const effective = effectivePhotoCapabilityIds(nextProfile, next, data.entrySkillIds || [], data.entryToolIds || [], data.inheritCapabilityProfile !== false);
    batch.update(item.ref, { category: next, skillIds: effective.skillIds, toolIds: effective.toolIds, updatedAt: serverTimestamp(), updatedBy: currentUserId() });
  });
  await batch.commit();
  announcePortfolioContentChanged("photo-editing");
  return getPhotoEditingCategoryManagerData();
}

export async function reorderPhotoEditingCategories(orderedCategories = []) {
  const { profileReference, profile } = await photoCategoryMutationContext();
  const known = new Map(profile.categories.map((item) => [capabilityCategoryKey(item), item]));
  const ordered = [];
  const seen = new Set();
  for (const value of orderedCategories) {
    const key = capabilityCategoryKey(value);
    if (!key || seen.has(key) || !known.has(key)) continue;
    seen.add(key);
    ordered.push(known.get(key));
  }
  profile.categories.forEach((value) => {
    const key = capabilityCategoryKey(value);
    if (!seen.has(key)) ordered.push(value);
  });
  await setDoc(profileReference, { categories: ordered, updatedAt: serverTimestamp(), updatedBy: currentUserId() }, { merge: true });
  announcePortfolioContentChanged("photo-editing");
  return getPhotoEditingCategoryManagerData();
}

export async function deletePhotoEditingCategory(categoryName, { reassignTo = "" } = {}) {
  const category = cleanCategoryLabel(categoryName);
  const categoryKey = capabilityCategoryKey(category);
  const target = cleanCategoryLabel(reassignTo);
  const targetKey = capabilityCategoryKey(target);
  const { profileReference, profile, documents } = await photoCategoryMutationContext();
  const sourceIndex = profile.categories.findIndex((item) => capabilityCategoryKey(item) === categoryKey);
  if (sourceIndex < 0) throw new Error("That Photo Editing category no longer exists.");
  const affected = categoryUsageFromDocuments(documents, category);
  if (affected.length && !targetKey) throw new Error(`“${category}” is used by ${affected.length} sample${affected.length === 1 ? "" : "s"}. Choose a replacement category before deleting it.`);
  if (targetKey === categoryKey) throw new Error("Choose a different replacement category.");
  if (targetKey && !profile.categories.some((item) => capabilityCategoryKey(item) === targetKey)) throw new Error("The replacement category no longer exists.");

  const sourceProfile = profile.categoryProfiles.find((item) => item.key === categoryKey);
  let categoryProfiles = profile.categoryProfiles.filter((item) => item.key !== categoryKey);
  if (targetKey && sourceProfile) {
    const targetProfile = categoryProfiles.find((item) => item.key === targetKey);
    if (targetProfile) {
      categoryProfiles = categoryProfiles.map((item) => item.key === targetKey ? {
        ...item,
        skillIds: uniqueReferenceIds(item.skillIds, sourceProfile.skillIds),
        toolIds: uniqueReferenceIds(item.toolIds, sourceProfile.toolIds)
      } : item);
    } else {
      categoryProfiles.push({ category: target, key: targetKey, skillIds: sourceProfile.skillIds, toolIds: sourceProfile.toolIds });
    }
  }
  const categories = profile.categories.filter((item) => capabilityCategoryKey(item) !== categoryKey);
  const nextProfile = cleanCapabilityProfile({ ...profile, categories, categoryProfiles });
  const batch = writeBatch(db);
  batch.set(profileReference, {
    version: nextProfile.version,
    categories: nextProfile.categories,
    categoryProfiles: nextProfile.categoryProfiles,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserId()
  }, { merge: true });
  affected.forEach((item) => {
    const data = item.data() || {};
    const effective = effectivePhotoCapabilityIds(nextProfile, target, data.entrySkillIds || [], data.entryToolIds || [], data.inheritCapabilityProfile !== false);
    batch.update(item.ref, { category: target, skillIds: effective.skillIds, toolIds: effective.toolIds, updatedAt: serverTimestamp(), updatedBy: currentUserId() });
  });
  await batch.commit();
  announcePortfolioContentChanged("photo-editing");
  return getPhotoEditingCategoryManagerData();
}

function slugify(value = "") {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

function currentUserId() {
  return cleanText(window.__LAN_ADMIN_AUTH__?.user?.uid);
}

function cleanStatus(value) {
  return cleanText(value).toLowerCase() ===
    PROJECT_STATUSES.PUBLISHED
    ? PROJECT_STATUSES.PUBLISHED
    : PROJECT_STATUSES.DRAFT;
}

function cleanDisplayType(value) {
  const normalizedValue = cleanText(value)
    .toLowerCase();

  if (
    normalizedValue === DISPLAY_TYPES.SINGLE ||
    normalizedValue === DISPLAY_TYPES.GALLERY ||
    normalizedValue === DISPLAY_TYPES.COMPARISON
  ) {
    return normalizedValue;
  }

  return DISPLAY_TYPES.COMPARISON;
}

/* =========================================================
   MEDIA NORMALIZATION
   ========================================================= */

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

function cleanMedia(media = {}) {
  const reference = normalizeAssetReference(media);
  if (reference && typeof reference === "object") return { ...emptyMedia(), ...reference };
  if (typeof reference === "string" && (typeof media !== "object" || !media || Array.isArray(media))) {
    const url = cleanText(reference);
    return url
      ? { ...emptyMedia(), url, secureUrl: url }
      : emptyMedia();
  }

  if (
    !media ||
    typeof media !== "object" ||
    Array.isArray(media)
  ) {
    return emptyMedia();
  }

  const url = cleanText(
    (typeof reference === "string" ? reference : "") ||
    media.url ||
    media.secureUrl ||
    media.secure_url
  );

  return {
    url,

    secureUrl: cleanText(
      media.secureUrl ||
      media.secure_url ||
      url
    ),

    publicId: cleanText(
      media.publicId ||
      media.public_id ||
      media.path
    ),

    assetId: cleanText(
      media.assetId ||
      media.asset_id
    ),

    provider: cleanText(media.provider || media.storageProvider),
    storageProfileId: cleanText(media.storageProfileId || media.storage_profile_id),
    previewUrl: cleanText(media.previewUrl || media.preview_url),
    downloadUrl: cleanText(media.downloadUrl || media.download_url),

    resourceType:
      cleanText(
        media.resourceType ||
        media.resource_type
      ) || "image",

    type: cleanText(media.type) || "upload",
    format: cleanText(media.format),

    width: cleanNonNegativeNumber(
      media.width
    ),

    height: cleanNonNegativeNumber(
      media.height
    ),

    bytes: cleanNonNegativeNumber(
      media.bytes
    ),

    version: cleanNonNegativeNumber(
      media.version
    ),

    folder: cleanText(
      media.folder ||
      media.asset_folder
    ),

    displayName: cleanText(
      media.displayName ||
      media.display_name
    ),

    originalFilename: cleanText(
      media.originalFilename ||
      media.original_filename
    ),

    uploadedAt: cleanText(
      media.uploadedAt ||
      media.created_at
    )
  };
}

function mediaHasReference(media) {
  return hasAssetReference(media);
}

function getMediaIdentity(media) {
  return assetReferenceIdentity(media);
}

function cleanGalleryMedia(value = []) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.images)
      ? value.images
      : [];

  const uniqueMedia = new Map();

  for (const item of source) {
    const media = cleanMedia(item);

    if (!mediaHasReference(media)) {
      continue;
    }

    const identity = getMediaIdentity(media);

    if (!identity) {
      continue;
    }

    if (!uniqueMedia.has(identity)) {
      uniqueMedia.set(identity, media);
    }
  }

  return [...uniqueMedia.values()];
}

function mediaFromLegacyFields(
  raw = {},
  kind = ""
) {
  const normalizedKind = cleanText(kind);

  if (!normalizedKind) {
    return emptyMedia();
  }

  const finalCompatibilityValue =
    normalizedKind === "after"
      ? (
          raw.singleImage ||
          raw.image ||
          raw.coverImage ||
          raw.primaryImage ||
          raw.thumbnail
        )
      : null;

  const nestedMedia =
    raw[`${normalizedKind}Image`] ||
    finalCompatibilityValue;

  const normalizedNested =
    cleanMedia(nestedMedia);

  if (mediaHasReference(normalizedNested)) {
    return normalizedNested;
  }

  const displayName =
    normalizedKind.charAt(0).toUpperCase() +
    normalizedKind.slice(1) +
    " image";

  return cleanMedia({
    url:
      raw[`${normalizedKind}ImageUrl`] ||
      raw[`${normalizedKind}Url`] ||
      (
        normalizedKind === "after"
          ? (
              raw.singleImageUrl ||
              raw.imageUrl ||
              (typeof raw.image === "string" ? raw.image : "") ||
              raw.coverImageUrl ||
              raw.primaryImageUrl ||
              raw.thumbnailUrl
            )
          : ""
      ) ||
      "",

    secureUrl:
      raw[`${normalizedKind}SecureUrl`] ||
      raw[`${normalizedKind}SecureURL`] ||
      "",

    publicId:
      raw[`${normalizedKind}PublicId`] ||
      raw[`${normalizedKind}StoragePath`] ||
      (
        normalizedKind === "after"
          ? (
              raw.singleImagePublicId ||
              raw.singleImageStoragePath ||
              ""
            )
          : ""
      ),

    assetId:
      raw[`${normalizedKind}AssetId`] ||
      "",

    displayName
  });
}

function galleryFromLegacyFields(raw = {}) {
  return cleanGalleryMedia(
    raw.galleryImages ||
    raw.gallery ||
    raw.images ||
    []
  );
}

function inferDisplayType(raw = {}) {
  const explicitlyRequested =
    raw.projectDisplayType ||
    raw.displayType;

  if (cleanText(explicitlyRequested)) {
    return cleanDisplayType(
      explicitlyRequested
    );
  }

  const galleryImages =
    galleryFromLegacyFields(raw);

  if (galleryImages.length > 0) {
    return DISPLAY_TYPES.GALLERY;
  }

  const beforeImage =
    mediaFromLegacyFields(raw, "before");

  return mediaHasReference(beforeImage)
    ? DISPLAY_TYPES.COMPARISON
    : DISPLAY_TYPES.SINGLE;
}

function validateProjectMedia(
  projectDisplayType,
  beforeImage,
  afterImage,
  galleryImages
) {
  if (
    projectDisplayType ===
      DISPLAY_TYPES.COMPARISON &&
    !mediaHasReference(beforeImage) &&
    !mediaHasReference(afterImage)
  ) {
    return;
  }

  if (
    projectDisplayType ===
      DISPLAY_TYPES.GALLERY &&
    galleryImages.length === 0
  ) {
    return;
  }

  if (
    projectDisplayType ===
      DISPLAY_TYPES.SINGLE &&
    !mediaHasReference(afterImage) &&
    !mediaHasReference(beforeImage) &&
    galleryImages.length === 0
  ) {
    return;
  }
}

/* =========================================================
   PROJECT DATA VALIDATION
   ========================================================= */

export function cleanPhotoEditingData(raw = {}) {
  assertPlainObject(
    raw,
    "Photo editing project data"
  );

  const title = cleanText(raw.title);
  const category = cleanText(raw.category);
  const shortDescription = cleanText(
    raw.shortDescription
  );

  if (!title) {
    throw new Error(
      "Project title is required."
    );
  }

  if (!category) {
    throw new Error(
      "Project category is required."
    );
  }

  if (!shortDescription) {
    throw new Error(
      "A short project description is required."
    );
  }

  const generatedSlug = slugify(
    raw.slug || title
  );

  if (!generatedSlug) {
    throw new Error(
      "A valid project slug could not be generated."
    );
  }

  const projectDisplayType =
    inferDisplayType(raw);

  const beforeImage =
    mediaFromLegacyFields(raw, "before");

  const afterImage =
    mediaFromLegacyFields(raw, "after");

  const galleryImages =
    galleryFromLegacyFields(raw);

  validateProjectMedia(
    projectDisplayType,
    beforeImage,
    afterImage,
    galleryImages
  );

  return {
    title,
    slug: generatedSlug,
    category,
    projectDisplayType,
    galleryImages,

    displayOrder: cleanNonNegativeNumber(
      raw.displayOrder,
      1
    ),

    status: cleanStatus(raw.status),

    // Canonical public visibility field. Older records may not have it,
    // so new/edited projects default to visible unless explicitly hidden.
    visible: raw.visible === undefined ? true : cleanBoolean(raw.visible),

    shortDescription,

    description: cleanText(
      raw.description
    ),

    inheritCapabilityProfile: raw.inheritCapabilityProfile !== false,
    entrySkillIds: cleanArray(raw.entrySkillIds),
    entryToolIds: cleanArray(raw.entryToolIds),
    capabilityProfileVersion: cleanNonNegativeNumber(raw.capabilityProfileVersion, 2),

    skillIds: cleanArray(raw.skillIds),
    toolIds: cleanArray(raw.toolIds),

    software: cleanArray(
      raw.software
    ),

    techniques: cleanArray(
      raw.techniques
    ),

    seo: {
      title: cleanText(
        raw.seo?.title ||
        raw.seoTitle
      ),

      description: cleanText(
        raw.seo?.description ||
        raw.seoDescription
      ),

      keywords: cleanKeywords(
        raw.seo?.keywords ||
        raw.seoKeywords
      )
    },

    featured: cleanBoolean(
      raw.featured
    ),

    showComparison:
      projectDisplayType ===
        DISPLAY_TYPES.COMPARISON &&
      (
        raw.showComparison === undefined
          ? true
          : cleanBoolean(
              raw.showComparison
            )
      ),

    allowFullscreen:
      raw.allowFullscreen === undefined
        ? true
        : cleanBoolean(
            raw.allowFullscreen
          ),

    beforeImage,
    afterImage,

    isDeleted: false
  };
}

/* =========================================================
   PROJECT NORMALIZATION
   ========================================================= */

function normalizeProject(
  documentSnapshot
) {
  const rawData =
    documentSnapshot?.data?.() || {};

  const beforeImage =
    mediaFromLegacyFields(
      rawData,
      "before"
    );

  const afterImage =
    mediaFromLegacyFields(
      rawData,
      "after"
    );

  const galleryImages =
    galleryFromLegacyFields(rawData);

  const projectDisplayType =
    inferDisplayType({
      ...rawData,
      beforeImage,
      afterImage,
      galleryImages
    });

  const seo = {
    title: cleanText(
      rawData.seo?.title ||
      rawData.seoTitle
    ),

    description: cleanText(
      rawData.seo?.description ||
      rawData.seoDescription
    ),

    keywords: cleanKeywords(
      rawData.seo?.keywords ||
      rawData.seoKeywords
    )
  };

  return {
    id: documentSnapshot.id,
    ...rawData,

    title: cleanText(rawData.title || rawData.projectTitle || rawData.name),
    slug: slugify(
      rawData.slug ||
      rawData.title ||
      rawData.projectTitle ||
      rawData.name
    ),

    category: (() => {
      const stored = cleanText(rawData.category || rawData.projectCategory || rawData.type);
      return stored.toLowerCase() === "other" && cleanText(rawData.customCategory)
        ? cleanCategoryLabel(rawData.customCategory)
        : stored;
    })(),

    shortDescription: cleanText(
      rawData.shortDescription || rawData.cardSummary || rawData.summary
    ),

    description: cleanText(
      rawData.description || rawData.fullDescription || rawData.details
    ),

    status: cleanStatus(
      rawData.status || rawData.publicationStatus
    ),

    visible: rawData.visible === undefined
      ? (rawData.isVisible === undefined ? true : cleanBoolean(rawData.isVisible))
      : cleanBoolean(rawData.visible),

    featured: cleanBoolean(
      rawData.featured ?? rawData.isFeatured
    ),

    displayOrder:
      cleanNonNegativeNumber(
        rawData.displayOrder ?? rawData.order,
        1
      ),

    inheritCapabilityProfile: rawData.inheritCapabilityProfile !== false,
    entrySkillIds: cleanArray(rawData.entrySkillIds),
    entryToolIds: cleanArray(rawData.entryToolIds),
    moduleSkillIds: cleanArray(rawData.moduleSkillIds),
    moduleToolIds: cleanArray(rawData.moduleToolIds),
    capabilityProfileVersion: cleanNonNegativeNumber(rawData.capabilityProfileVersion, 0),

    skillIds: cleanArray(rawData.skillIds || rawData.skillsUsedIds),
    toolIds: cleanArray(rawData.toolIds || rawData.toolsUsedIds),

    software: cleanArray(
      rawData.software || rawData.tools || rawData.softwareUsed
    ),

    techniques: cleanArray(
      rawData.techniques || rawData.editingTechniques
    ),

    projectDisplayType,
    displayType: projectDisplayType,

    beforeImage,
    afterImage,
    galleryImages,

    showComparison:
      projectDisplayType ===
        DISPLAY_TYPES.COMPARISON &&
      (
        rawData.showComparison ===
          undefined
          ? true
          : cleanBoolean(
              rawData.showComparison
            )
      ),

    allowFullscreen:
      rawData.allowFullscreen ===
        undefined
        ? true
        : cleanBoolean(
            rawData.allowFullscreen
          ),

    isDeleted:
      rawData.isDeleted === true,

    seo,

    beforeImageUrl: persistentAssetUrl(beforeImage),
    afterImageUrl: persistentAssetUrl(afterImage),

    beforeStoragePath:
      beforeImage.publicId,

    afterStoragePath:
      afterImage.publicId,

    beforePublicId:
      beforeImage.publicId,

    afterPublicId:
      afterImage.publicId,

    seoTitle: seo.title,
    seoDescription: seo.description,
    seoKeywords: seo.keywords
  };
}

function compareProjects(
  firstProject,
  secondProject
) {
  const orderDifference =
    cleanNonNegativeNumber(
      firstProject.displayOrder,
      1
    ) -
    cleanNonNegativeNumber(
      secondProject.displayOrder,
      1
    );

  if (orderDifference !== 0) {
    return orderDifference;
  }

  return cleanText(firstProject.title)
    .localeCompare(
      cleanText(secondProject.title),
      undefined,
      {
        sensitivity: "base",
        numeric: true
      }
    );
}

/* =========================================================
   DUPLICATE DOCUMENT PREVENTION
   ========================================================= */

async function findDuplicateProject(
  projectData,
  excludedProjectId = ""
) {
  const snapshot = await getDocs(
    photoEditingCollection
  );

  const targetSlug = cleanText(
    projectData.slug
  ).toLowerCase();

  const targetTitle = cleanText(
    projectData.title
  ).toLowerCase();

  const targetCategory = cleanText(
    projectData.category
  ).toLowerCase();

  for (const documentSnapshot of snapshot.docs) {
    if (
      documentSnapshot.id ===
      excludedProjectId
    ) {
      continue;
    }

    const existingData =
      documentSnapshot.data() || {};

    if (existingData.isDeleted === true) {
      continue;
    }

    const existingSlug = slugify(
      existingData.slug ||
      existingData.title
    ).toLowerCase();

    const existingTitle = cleanText(
      existingData.title
    ).toLowerCase();

    const existingCategory = cleanText(
      existingData.category
    ).toLowerCase();

    const sameSlug =
      targetSlug &&
      existingSlug === targetSlug;

    const sameProjectIdentity =
      targetTitle &&
      existingTitle === targetTitle &&
      existingCategory === targetCategory;

    if (sameSlug || sameProjectIdentity) {
      return {
        id: documentSnapshot.id,
        data: existingData
      };
    }
  }

  return null;
}

async function ensureProjectIsUnique(
  projectData,
  excludedProjectId = ""
) {
  const duplicateProject =
    await findDuplicateProject(
      projectData,
      excludedProjectId
    );

  if (!duplicateProject) {
    return;
  }

  throw new Error(
    "A photo editing project with the same title or slug already exists."
  );
}

/* =========================================================
   READ PROJECTS
   ========================================================= */

export async function listPhotoEditingProjects({
  includeDeleted = false
} = {}) {
  try {
    // Read the full collection and sort client-side. Firestore orderBy() skips
    // legacy documents with no displayOrder, which can otherwise make valid
    // photo-editing projects vanish from Admin counters and libraries.
    const snapshot = await getDocs(
      photoEditingCollection
    );

    const projects = snapshot.docs
      .map(normalizeProject)
      .filter(project => (
        includeDeleted ||
        project.isDeleted !== true
      ))
      .sort(compareProjects);

    return attachPhotoEditingLinkedStatus(projects);
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to load photo editing projects."
      ),
      error
    );
  }
}

async function validatePhotoCapabilityReferences(project = {}) {
  const references = [
    ...cleanArray(project.skillIds).map((id) => ({ id, type: "skill", label: "Skill" })),
    ...cleanArray(project.toolIds).map((id) => ({ id, type: "tool", label: "Tool" }))
  ];
  if (!references.length) return;
  const checked = await Promise.all(references.map(async (entry) => ({
    ...entry,
    snapshot: await getDoc(doc(db, "skills", entry.id))
  })));
  for (const entry of checked) {
    if (!entry.snapshot.exists()) throw new Error(`${entry.label} reference is no longer available. Re-select it from Skills & Tools Used.`);
    const stored = entry.snapshot.data() || {};
    let recordType = cleanText(stored.recordType).toLowerCase();
    if (!recordType) {
      try { recordType = cleanSkillData(stored).recordType; } catch {}
    }
    if (recordType !== entry.type) throw new Error(`${entry.label} reference points to the wrong library record type.`);
  }
}

function photoEditingOwnedMedia(record = {}) {
  return {
    beforeImage: record.beforeImage || mediaFromLegacyFields(record, "before"),
    afterImage: record.afterImage || mediaFromLegacyFields(record, "after"),
    galleryImages: Array.isArray(record.galleryImages) ? record.galleryImages : galleryFromLegacyFields(record)
  };
}

/* =========================================================
   CREATE PROJECT
   ========================================================= */

export function reservePhotoEditingProjectId() {
  return doc(photoEditingCollection).id;
}

export async function createPhotoEditingProject(
  raw = {},
  reservedProjectId = ""
) {
  try {
    const projectData =
      cleanPhotoEditingData(raw);

    await ensureProjectIsUnique(
      projectData
    );
    await validatePhotoCapabilityReferences(projectData);

    const userId = currentUserId();

    const documentReference = reservedProjectId
      ? doc(db, COLLECTION_NAME, cleanText(reservedProjectId))
      : doc(photoEditingCollection);
    await setDoc(documentReference, {
      ...projectData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
      deletedBy: ""
    });

    commitMediaAssets(photoEditingOwnedMedia(projectData));
    announcePortfolioContentChanged("photo-editing");
    return documentReference.id;
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to create the photo editing project."
      ),
      error
    );
  }
}

/* =========================================================
   PARTIAL PROJECT FIELD UPDATE
   ========================================================= */

function cleanPartialProjectChanges(raw = {}) {
  assertPlainObject(
    raw,
    "Photo editing project changes"
  );

  const changes = {};

  if (raw.featured !== undefined) {
    changes.featured = cleanBoolean(
      raw.featured
    );
  }

  return changes;
}

export async function updatePhotoEditingProjectFields(
  projectId,
  rawChanges = {}
) {
  try {
    const id = requireProjectId(
      projectId
    );

    const changes =
      cleanPartialProjectChanges(
        rawChanges
      );

    if (
      Object.keys(changes).length === 0
    ) {
      throw new Error(
        "No valid project fields were provided."
      );
    }

    await updateDoc(
      doc(db, COLLECTION_NAME, id),
      {
        ...changes,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId()
      }
    );

    announcePortfolioContentChanged("photo-editing");
    return id;
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to update the photo editing project fields."
      ),
      error
    );
  }
}

function isFeaturedOnlyUpdate(raw = {}) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return false;
  }

  const keys = Object.keys(raw);

  return (
    keys.length === 1 &&
    keys[0] === "featured"
  );
}

/* =========================================================
   UPDATE PROJECT
   ========================================================= */

export async function updatePhotoEditingProject(
  projectId,
  raw = {}
) {
  if (isFeaturedOnlyUpdate(raw)) {
    return updatePhotoEditingProjectFields(
      projectId,
      raw
    );
  }
  try {
    const id = requireProjectId(
      projectId
    );

    const projectData =
      cleanPhotoEditingData(raw);

    await ensureProjectIsUnique(
      projectData,
      id
    );
    await validatePhotoCapabilityReferences(projectData);

    const reference = doc(db, COLLECTION_NAME, id);
    const previousSnapshot = await getDoc(reference);
    if (!previousSnapshot.exists()) throw new Error("Photo editing project not found.");
    const previousData = previousSnapshot.data() || {};

    await updateDoc(
      reference,
      {
        ...projectData,
        moduleSkillIds: deleteField(),
        moduleToolIds: deleteField(),

        updatedAt: serverTimestamp(),
        updatedBy: currentUserId(),

        isDeleted: false,
        deletedAt: null,
        deletedBy: ""
      }
    );

    await cleanupRemovedMediaAssets(
      photoEditingOwnedMedia(previousData),
      photoEditingOwnedMedia(projectData),
      { reason: "photo-editing-media-updated" }
    );
    announcePortfolioContentChanged("photo-editing");

    return id;
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to update the photo editing project."
      ),
      error
    );
  }
}

/* =========================================================
   SOFT DELETE PROJECT
   ========================================================= */

export async function removePhotoEditingProject(
  projectId
) {
  try {
    const id = requireProjectId(
      projectId
    );

    const userId = currentUserId();

    await assertPhotoEditingProjectIsNotLinked(id);

    await updateDoc(
      doc(db, COLLECTION_NAME, id),
      {
        isDeleted: true,
        status: "draft",
        visible: false,

        deletedAt: serverTimestamp(),
        deletedBy: userId,

        updatedAt: serverTimestamp(),
        updatedBy: userId
      }
    );

    announcePortfolioContentChanged("photo-editing");

    return id;
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to remove the photo editing project."
      ),
      error
    );
  }
}

/* =========================================================
   RESTORE PROJECT
   ========================================================= */

export async function restorePhotoEditingProject(
  projectId
) {
  try {
    const id = requireProjectId(
      projectId
    );

    const userId = currentUserId();

    await updateDoc(
      doc(db, COLLECTION_NAME, id),
      {
        isDeleted: false,

        deletedAt: null,
        deletedBy: "",

        updatedAt: serverTimestamp(),
        updatedBy: userId
      }
    );

    announcePortfolioContentChanged("photo-editing");

    return id;
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to restore the photo editing project."
      ),
      error
    );
  }
}

/* =========================================================
   BULK UPDATE
   ========================================================= */

function cleanBulkChanges(raw = {}) {
  assertPlainObject(
    raw,
    "Bulk changes"
  );

  const changes = {};

  if (raw.status !== undefined) {
    changes.status = cleanStatus(
      raw.status
    );
  }

  if (raw.featured !== undefined) {
    changes.featured = cleanBoolean(
      raw.featured
    );
  }

  if (
    raw.displayOrder !== undefined
  ) {
    changes.displayOrder =
      cleanNonNegativeNumber(
        raw.displayOrder
      );
  }

  if (raw.isDeleted !== undefined) {
    changes.isDeleted = cleanBoolean(
      raw.isDeleted
    );
  }

  return changes;
}

function cleanProjectIds(
  projectIds = []
) {
  if (!Array.isArray(projectIds)) {
    return [];
  }

  return [
    ...new Set(
      projectIds
        .map(cleanText)
        .filter(Boolean)
    )
  ];
}

function buildBulkUpdateData(
  changes,
  userId
) {
  const updateData = {
    ...changes,
    updatedAt: serverTimestamp(),
    updatedBy: userId
  };

  if (changes.isDeleted === true) {
    updateData.deletedAt =
      serverTimestamp();

    updateData.deletedBy = userId;
  }

  if (changes.isDeleted === false) {
    updateData.deletedAt = null;
    updateData.deletedBy = "";
  }

  return updateData;
}

export async function updateManyPhotoEditingProjects(
  projectIds = [],
  rawChanges = {}
) {
  const ids = cleanProjectIds(
    projectIds
  );

  if (ids.length === 0) {
    throw new Error(
      "Select at least one photo editing project."
    );
  }

  const changes = cleanBulkChanges(
    rawChanges
  );

  if (
    Object.keys(changes).length === 0
  ) {
    throw new Error(
      "No valid bulk changes were provided."
    );
  }

  const userId = currentUserId();

  try {
    if (changes.isDeleted === true) {
      await assertPhotoEditingProjectsAreNotLinked(ids);
    }

    for (
      let start = 0;
      start < ids.length;
      start += BULK_WRITE_LIMIT
    ) {
      const currentIds = ids.slice(
        start,
        start + BULK_WRITE_LIMIT
      );

      const batch = writeBatch(db);

      for (const id of currentIds) {
        batch.update(
          doc(db, COLLECTION_NAME, id),
          buildBulkUpdateData(
            changes,
            userId
          )
        );
      }

      await batch.commit();
    }

    announcePortfolioContentChanged("photo-editing");
    return ids.length;
  } catch (error) {
    throw createServiceError(
      getErrorMessage(
        error,
        "Unable to update the selected photo editing projects."
      ),
      error
    );
  }
}

/* =========================================================
   CLOUDINARY UPLOAD VALIDATION
   ========================================================= */

function validateUploadFile(file) {
  if (
    !file ||
    typeof file !== "object"
  ) {
    throw new TypeError(
      "Select a valid image file."
    );
  }

  const fileName = cleanText(
    file.name
  );

  const fileType = cleanText(
    file.type
  ).toLowerCase();

  const fileSize =
    cleanNonNegativeNumber(file.size);

  if (!fileName) {
    throw new Error(
      "The selected image must have a filename."
    );
  }

  if (
    fileType &&
    !fileType.startsWith("image/")
  ) {
    throw new Error(
      "The selected file must be an image."
    );
  }

  if (fileSize <= 0) {
    throw new Error(
      "The selected image is empty or invalid."
    );
  }
}

function cleanUploadKind(kind) {
  const normalizedKind = cleanText(kind)
    .toLowerCase();

  const isStandardKind =
    VALID_IMAGE_KINDS.includes(
      normalizedKind
    );

  const isGalleryKind =
    /^gallery-[1-9]\d*$/.test(
      normalizedKind
    );

  if (
    !isStandardKind &&
    !isGalleryKind
  ) {
    throw new Error(
      'Image type must be "before", "after", or "gallery-N".'
    );
  }

  return normalizedKind;
}

function cleanFolderSegment(
  value,
  fallback
) {
  const segment = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return segment || fallback;
}

function createUploadIdentity(
  file,
  projectId,
  kind
) {
  return [
    cleanText(projectId),
    cleanText(kind),
    cleanText(file.name),
    cleanNonNegativeNumber(file.size),
    cleanNonNegativeNumber(
      file.lastModified
    )
  ].join("::");
}

function normalizeUploadedMedia(media) {
  const normalizedMedia =
    cleanMedia(media);

  if (!hasAssetReference(normalizedMedia)) {
    throw new Error(
      "Storage provider did not return a valid media asset."
    );
  }

  return {
    ...normalizedMedia,
    path: normalizedMedia.publicId
  };
}

/* =========================================================
   CLOUDINARY IMAGE UPLOAD
   ========================================================= */

export async function uploadPhotoEditingImage(
  file,
  projectId = "",
  kind = "image",
  onProgress = () => {},
  routing = {}
) {
  validateUploadFile(file);

  const cleanProjectId =
    cleanFolderSegment(
      projectId,
      "pending"
    );

  const cleanKind =
    cleanUploadKind(kind);

  const progressCallback =
    typeof onProgress === "function"
      ? onProgress
      : () => {};

  const uploadIdentity =
    createUploadIdentity(
      file,
      cleanProjectId,
      cleanKind
    );

  const existingUpload =
    activeUploads.get(uploadIdentity);

  if (existingUpload) {
    return existingUpload;
  }

  const uploadPromise = (async () => {
    try {
      const folder =
        `photo-editing/${cleanProjectId}/${cleanKind}`;

      const uploadedMedia =
        await uploadImage(
          file,
          folder,
          progressCallback,
          {
            ...routing,
            storageProfileId: routing.storageProfileId || "automatic",
            access: routing.access || "public-preview",
            context: {
              ...(routing.context || {}),
              ownerType: "photo-editing",
              ownerId: cleanProjectId,
              fieldId: cleanKind
            }
          }
        );

      return normalizeUploadedMedia(
        uploadedMedia
      );
    } catch (error) {
      throw createServiceError(
        getErrorMessage(
          error,
          "Unable to upload the photo editing image."
        ),
        error
      );
    } finally {
      activeUploads.delete(
        uploadIdentity
      );
    }
  })();

  activeUploads.set(
    uploadIdentity,
    uploadPromise
  );

  return uploadPromise;
}

/* =========================================================
   LEGACY STORAGE COMPATIBILITY
   ========================================================= */

export async function removeStoredImage() {
  return false;
}

/* END OF FILE */
