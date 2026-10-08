import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { portfolioModuleRegistry } from "../../config.js";

export const PORTFOLIO_INITIALIZATION_VERSION = 13;

export const INITIALIZATION_COLLECTION_MAPPING = Object.freeze({
  home: "portfolio/home",
  about: "portfolio/profile",
  contact: "portfolio/contact",
  experience: "experiences",
  projects: "projects",
  photoEditing: "photoEditingProjects",
  education: "education",
  skills: "skills",
  certificates: "certificates",
  resumes: "resumes"
});



const PRODUCTION_RESET_COLLECTIONS = Object.freeze([
  "experiences",
  "projects",
  "photoEditingProjects",
  "education",
  "skills",
  "certificates",
  "resumes"
]);

async function removePreviousPortfolioRecords(onProgress = () => {}) {
  const targets = [];
  for (const collectionName of PRODUCTION_RESET_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, collectionName));
    snapshot.docs.forEach((snapshotDocument) => {
      targets.push({ collectionName, reference: snapshotDocument.ref, id: snapshotDocument.id });
    });
  }

  // Home owns the user's public composition. A legacy production reset must not
  // erase generated-section registration, placement, or presentation choices.
  for (const documentId of ["profile", "contact"]) {
    const reference = doc(db, "portfolio", documentId);
    const snapshot = await getDoc(reference);
    if (snapshot.exists()) targets.push({ collectionName: "portfolio", reference, id: documentId });
  }

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    await deleteDoc(target.reference);
    onProgress({
      current: index + 1,
      total: targets.length,
      label: `Removed obsolete record: ${target.collectionName}/${target.id}`,
      result: "removed"
    });
  }

  pipelineLog("Production reset completed", { removed: targets.length });
  return targets.length;
}

const PIPELINE_MODULES = Object.freeze([
  "home", "about", "contact", "experience", "projects", "photoEditing",
  "education", "skills", "certificates", "resumes"
]);


const MODULE_READER_CONTRACTS = Object.freeze({
  home: { admin: "admin/services/homeService.js", public: "app.js: portfolio/home" },
  about: { admin: "admin/js/about.js", public: "app.js: portfolio/profile" },
  contact: { admin: "admin/js/contact.js", public: "app.js: portfolio/contact" },
  experience: { admin: "admin/services/experienceService.js", public: "app.js: experiences(status=published, visible=true)" },
  projects: { admin: "admin/services/projectService.js", public: "app.js: projects(status=published, visible=true)" },
  photoEditing: { admin: "admin/services/photoEditingService.js", public: "app.js: photoEditingProjects(status=published, visible=true, gateway excluded)" },
  education: { admin: "admin/services/educationService.js", public: "app.js: education(status=published, visible=true)" },
  skills: { admin: "admin/services/skillService.js", public: "app.js: skills(status=published, visible=true)" },
  certificates: { admin: "admin/js/certificates.js", public: "app.js: certificates(status=published, visible=true)" },
  resumes: { admin: "admin/js/resume.js", public: "app.js: resumes(status=published, visible=true)" }
});

function pipelineLog(stage, details = {}) {
  console.info(`[LΛN initialization pipeline] ${stage}`, {
    timestamp: new Date().toISOString(),
    ...details
  });
}

function expectedLegacyCounts(legacy = {}) {
  return {
    home: legacy.hero && legacy.site ? 1 : 0,
    about: legacy.about ? 1 : 0,
    contact: legacy.site ? 1 : 0,
    experience: Array.isArray(legacy.experience) ? legacy.experience.length : 0,
    projects: Array.isArray(legacy.projects) ? legacy.projects.length : 0,
    photoEditing: Array.isArray(legacy.gallery) ? legacy.gallery.length + (legacy.gallery.length ? 1 : 0) : 0,
    education: Array.isArray(legacy.education) ? legacy.education.length : 0,
    skills: Array.isArray(legacy.skills) ? legacy.skills.length : 0,
    certificates: Array.isArray(legacy.certificates) ? legacy.certificates.length : 0,
    resumes: Array.isArray(legacy.resumes) ? legacy.resumes.length : 0
  };
}

function createModuleResults(legacy = {}) {
  const expected = expectedLegacyCounts(legacy);
  return Object.fromEntries(PIPELINE_MODULES.map((moduleKey) => [moduleKey, {
    legacyCount: expected[moduleKey] || 0,
    expectedPublicCount: moduleKey === "photoEditing"
      ? (Array.isArray(legacy.gallery) ? legacy.gallery.length : 0)
      : (expected[moduleKey] || 0),
    importedCount: 0,
    existingCount: 0,
    skippedCount: 0,
    failedCount: 0,
    firestoreCount: null,
    adminCount: null,
    dashboardCount: null,
    publicCount: null,
    matched: null,
    recordIds: [],
    path: INITIALIZATION_COLLECTION_MAPPING[moduleKey],
    readers: MODULE_READER_CONTRACTS[moduleKey]
  }]));
}

const LEGACY_ARRAY_KEYS = Object.freeze([
  "experience", "projects", "gallery", "education", "skills", "certificates", "resumes"
]);

function sourceInventory(legacy = {}) {
  const arrays = Object.fromEntries(LEGACY_ARRAY_KEYS.map((key) => [key, Array.isArray(legacy[key]) ? legacy[key].length : -1]));
  return {
    objects: {
      site: Boolean(legacy.site && typeof legacy.site === "object" && !Array.isArray(legacy.site)),
      hero: Boolean(legacy.hero && typeof legacy.hero === "object" && !Array.isArray(legacy.hero)),
      about: Boolean(legacy.about && typeof legacy.about === "object" && !Array.isArray(legacy.about))
    },
    arrays,
    totalRecords: Object.values(arrays).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0)
  };
}

const text = (value = "") => String(value ?? "").trim();
const slug = (value, index = 0) => text(value)
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || `record-${index + 1}`;
const normalized = (value = "") => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokenSet = (value = "") => new Set(normalized(value).split(/\s+/).filter((token) => token.length > 2 && !["the", "and", "with", "from", "for", "project", "portfolio", "work"].includes(token)));

const isEmptyValue = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const CANONICAL_PUBLIC_COLLECTIONS = Object.freeze([
  "experiences",
  "projects",
  "photoEditingProjects",
  "education",
  "skills",
  "certificates",
  "resumes",
  "portfolioSections",
  "portfolioSectionEntries"
]);

function canonicalPublicationState(collectionName, data = {}) {
  const deleted = data.isDeleted === true || data.deleted === true || Boolean(data.deletedAt);
  const archived = data.archived === true || data.isArchived === true || Boolean(data.archivedAt);
  if (deleted || archived) return { status: "draft", visible: false };

  const explicitStatus = text(data.status).toLowerCase();
  let status = explicitStatus === "published" ? "published" : explicitStatus === "draft" ? "draft" : "";
  if (!status && collectionName === "education") {
    status = text(data.educationStatus).toLowerCase() === "published" ? "published" : "draft";
  }
  if (!status && collectionName === "skills") {
    status = data.active === true ? "published" : "draft";
  }
  if (!status && (data.published === true || data.isPublished === true)) status = "published";
  if (!status) status = "draft";

  let visible;
  if (typeof data.visible === "boolean") visible = data.visible;
  else if (collectionName === "education" && typeof data.educationVisible === "boolean") visible = data.educationVisible;
  else if (collectionName === "skills" && typeof data.active === "boolean") visible = data.active;
  else if (typeof data.isVisible === "boolean") visible = data.isVisible;
  else if (text(data.visibility).toLowerCase() === "visible") visible = true;
  else visible = status === "published";

  return { status, visible };
}

function canonicalSchemaPatch(collectionName, data = {}) {
  const patch = {};
  const publication = canonicalPublicationState(collectionName, data);
  if (data.status !== publication.status) patch.status = publication.status;
  if (data.visible !== publication.visible) patch.visible = publication.visible;

  if (collectionName === "education") {
    const displayOrder = Number.isFinite(Number(data.displayOrder ?? data.educationDisplayOrder))
      ? Number(data.displayOrder ?? data.educationDisplayOrder)
      : 0;
    const featured = data.featured === true || data.featuredEducation === true;
    if (data.educationStatus !== publication.status) patch.educationStatus = publication.status;
    if (data.educationVisible !== publication.visible) patch.educationVisible = publication.visible;
    if (data.displayOrder !== displayOrder) patch.displayOrder = displayOrder;
    if (data.educationDisplayOrder !== displayOrder) patch.educationDisplayOrder = displayOrder;
    if (data.featured !== featured) patch.featured = featured;
    if (data.featuredEducation !== featured) patch.featuredEducation = featured;
  }

  if (collectionName === "skills" && data.active === undefined) {
    patch.active = publication.status === "published" && publication.visible === true;
  }

  return patch;
}

export async function migratePortfolioSchema(onProgress = () => {}) {
  const targets = [];

  // Home owns the user's public composition. A legacy production reset must not
  // erase generated-section registration, placement, or presentation choices.
  for (const documentId of ["profile", "contact"]) {
    const reference = doc(db, "portfolio", documentId);
    const snapshot = await getDoc(reference);
    if (!snapshot.exists()) continue;
    const data = snapshot.data() || {};
    const patch = {};
    const explicitStatus = text(data.status).toLowerCase();
    const status = explicitStatus === "draft" ? "draft" : "published";
    const visible = typeof data.visible === "boolean"
      ? data.visible
      : documentId === "profile" && typeof data.sectionVisible === "boolean"
        ? data.sectionVisible
        : true;
    if (data.status !== status) patch.status = status;
    if (data.visible !== visible) patch.visible = visible;
    if (documentId === "profile" && data.sectionVisible !== visible) patch.sectionVisible = visible;
    targets.push({ reference, path: reference.path, patch });
  }

  for (const collectionName of CANONICAL_PUBLIC_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, collectionName));
    snapshot.docs.forEach((item) => {
      targets.push({
        reference: item.ref,
        path: item.ref.path,
        patch: canonicalSchemaPatch(collectionName, item.data() || {})
      });
    });
  }

  let updated = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (Object.keys(target.patch).length) {
      await setDoc(target.reference, {
        ...target.patch,
        schemaVersion: PORTFOLIO_INITIALIZATION_VERSION,
        updatedAt: serverTimestamp()
      }, { merge: true });
      updated += 1;
    }
    onProgress({
      current: index + 1,
      total: targets.length,
      label: `Schema check: ${target.path}`,
      result: Object.keys(target.patch).length ? "migrated" : "current"
    });
  }

  pipelineLog("Canonical Firestore schema migration completed", { scanned: targets.length, updated });
  return { scanned: targets.length, updated };
}

function placeholderDocument(collectionName, documentId, current = {}) {
  if (collectionName !== "portfolio") return false;
  if (documentId === "home") {
    return [current.displayName, current.headline, current.introduction, current.portrait].every(isEmptyValue);
  }
  if (documentId === "profile") {
    return [current.fullName, current.aboutDescription, current.shortIntroduction].every(isEmptyValue);
  }
  if (documentId === "contact") {
    return [current.email, current.phone, current.location, current.github, current.linkedin, current.facebook].every(isEmptyValue);
  }
  return false;
}

function missingFieldPatch(current = {}, incoming = {}, allowBlankBackfill = false) {
  const patch = {};
  for (const [key, value] of Object.entries(incoming)) {
    const missing = !(key in current) || current[key] === undefined || current[key] === null;
    const blankPlaceholder = allowBlankBackfill && isEmptyValue(current[key]) && !isEmptyValue(value);
    if (missing || blankPlaceholder) patch[key] = value;
  }
  return patch;
}

async function preserveAndBackfillExisting(reference, current, incoming, collectionName, documentId) {
  const legacyManaged = current.legacySource === "content.js" || Number(current.initializationVersion) > 0;
  const allowBlankBackfill = legacyManaged || placeholderDocument(collectionName, documentId, current);
  const patch = missingFieldPatch(current, incoming, allowBlankBackfill);
  if (legacyManaged) {
    // Re-running initialization is the explicit, controlled recovery path for
    // records originally owned by content.js. Synchronize those records to the
    // current approved source while leaving administrator-created records alone.
    for (const [field, value] of Object.entries(incoming)) {
      if (current[field] !== value) patch[field] = value;
    }
  }
  if (!Object.keys(patch).length) return { backfilledFields: [] };
  await setDoc(reference, {
    ...patch,
    initializationVersion: PORTFOLIO_INITIALIZATION_VERSION,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { backfilledFields: Object.keys(patch) };
}

function parseLegacyDate(date = "") {
  const legacyDate = text(date);
  const months = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
  const parts = legacyDate.split(/[–—-]/).map((part) => part.trim()).filter(Boolean);
  const parsePart = (part = "") => {
    const match = part.toLowerCase().match(/([a-z]+)\s+(\d{4})/);
    return match && months[match[1]] ? `${match[2]}-${months[match[1]]}` : "";
  };
  const isCurrent = /present|current/i.test(parts[1] || "");
  return { legacyDate, startDate: parsePart(parts[0]), endDate: isCurrent ? "" : parsePart(parts[1]), isCurrent };
}

async function findMatchingDocument(collectionName, matches = []) {
  for (const match of matches) {
    if (!match?.field || match.value === undefined || match.value === null || text(match.value) === "") continue;
    const snapshot = await getDocs(query(collection(db, collectionName), where(match.field, "==", match.value)));
    if (!snapshot.empty) return snapshot.docs[0];
  }
  return null;
}

async function verifyImmediateReadBack(reference, expectedData = {}) {
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) {
    throw new Error(`Immediate Firestore read-back failed for ${reference.path}.`);
  }
  const stored = snapshot.data() || {};
  const criticalFields = ["status", "visible", "educationStatus", "educationVisible", "active"]
    .filter((field) => Object.prototype.hasOwnProperty.call(expectedData, field));
  const mismatches = criticalFields.filter((field) => stored[field] !== expectedData[field]);
  if (mismatches.length) {
    throw new Error(`Immediate read-back mismatch at ${reference.path}: ${mismatches.join(", ")}.`);
  }
  pipelineLog("Immediate read-back verified", { path: reference.path, id: snapshot.id, criticalFields });
  return { id: snapshot.id, data: stored };
}

async function ensureMissingDocument({ collectionName, documentId, data, matches = [] }) {
  const reference = doc(db, collectionName, documentId);
  pipelineLog("Firestore write target", { path: reference.path, collectionName, documentId });
  const directSnapshot = await getDoc(reference);
  if (directSnapshot.exists()) {
    const current = directSnapshot.data();
    const backfill = await preserveAndBackfillExisting(reference, current, data, collectionName, documentId);
    const expectedReadBack = { ...current, ...Object.fromEntries(backfill.backfilledFields.map((key) => [key, data[key]])) };
    const readBack = await verifyImmediateReadBack(reference, expectedReadBack);
    pipelineLog("Firestore write result", { path: reference.path, result: "existing", backfilledFields: backfill.backfilledFields });
    return { result: "existing", id: directSnapshot.id, data: readBack.data, reference, readBackVerified: true, ...backfill };
  }

  const matchedSnapshot = await findMatchingDocument(collectionName, matches);
  if (matchedSnapshot) {
    const current = matchedSnapshot.data();
    const backfill = await preserveAndBackfillExisting(matchedSnapshot.ref, current, data, collectionName, matchedSnapshot.id);
    const expectedReadBack = { ...current, ...Object.fromEntries(backfill.backfilledFields.map((key) => [key, data[key]])) };
    const readBack = await verifyImmediateReadBack(matchedSnapshot.ref, expectedReadBack);
    pipelineLog("Firestore write result", { path: matchedSnapshot.ref.path, result: "existing", backfilledFields: backfill.backfilledFields });
    return { result: "existing", id: matchedSnapshot.id, data: readBack.data, reference: matchedSnapshot.ref, readBackVerified: true, ...backfill };
  }

  await setDoc(reference, {
    ...data,
    legacySource: "content.js",
    initializationVersion: PORTFOLIO_INITIALIZATION_VERSION,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const readBack = await verifyImmediateReadBack(reference, data);
  pipelineLog("Firestore write result", { path: reference.path, result: "imported" });
  return { result: "imported", id: documentId, data: readBack.data, reference, readBackVerified: true };
}

function createReport(legacy = {}) {
  return {
    imported: 0,
    existing: 0,
    skipped: 0,
    linked: 0,
    standalone: 0,
    unresolved: 0,
    failed: 0,
    sourceInventory: sourceInventory(legacy),
    collectionMapping: { ...INITIALIZATION_COLLECTION_MAPPING },
    moduleResults: createModuleResults(legacy),
    trace: [],
    failures: [],
    unresolvedItems: [],
    items: []
  };
}

function updateReport(report, result) {
  if (Object.prototype.hasOwnProperty.call(report, result)) report[result] += 1;
}

function recordReportItem(report, label, result, details = "") {
  report.items.push({ label, result, details: text(details) });
}

function recordTrace(report, stage, details = {}) {
  const entry = { stage, timestamp: new Date().toISOString(), ...details };
  report.trace.push(entry);
  pipelineLog(stage, details);
}

function updateModuleResult(report, moduleKey, result) {
  const module = report.moduleResults?.[moduleKey];
  if (!module) return;
  if (result === "imported") module.importedCount += 1;
  else if (result === "existing") module.existingCount += 1;
  else if (result === "skipped" || result === "unresolved") module.skippedCount += 1;
  else if (result === "failed") module.failedCount += 1;
}

function trackModuleRecord(report, moduleKey, result = {}) {
  const module = report.moduleResults?.[moduleKey];
  const id = text(result.id);
  if (!module || !id) return;
  if (!module.recordIds.includes(id)) module.recordIds.push(id);
}

function sourceScore(project, source) {
  const projectTokens = tokenSet(`${project.title} ${project.description} ${(project.tags || []).join(" ")}`);
  const sourceTokens = tokenSet(`${source.role} ${source.company} ${source.details}`);
  let score = 0;
  for (const token of projectTokens) if (sourceTokens.has(token)) score += 1;
  return score;
}

function registryEntry(key) {
  return portfolioModuleRegistry.find((entry) => entry.active && entry.key === key) || null;
}

function linkedProjectPayload(item, index, module, linkedDocumentId) {
  return {
    projectType: "linked-module",
    linkedModuleKey: module.key,
    linkedModule: module.key,
    linkedCollection: module.collection,
    linkedDocumentId,
    linkedDestination: module.publicDestination,
    title: text(item.title),
    cardSummary: text(item.description),
    technologies: Array.isArray(item.tags) ? item.tags : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    // The existing architecture permits a card-level cover override. It is a
    // fallback only; the runtime resolver still prefers current source media.
    coverImageUrl: text(item.image),
    coverImage: text(item.image) ? { url: text(item.image) } : null,
    buttonLabel: text(item.primaryLabel || module.defaultButtonLabel),
    actionType: "internal-section",
    destination: module.publicDestination,
    status: "published",
    visible: true,
    featured: index === 0,
    displayOrder: index + 1
  };
}

function standaloneProjectPayload(item, index) {
  const url = text(item.primaryUrl);
  const isVideo = item.mediaType === "video" || /\.(mp4|webm)(\?|$)/i.test(url);
  const isAnchor = url.startsWith("#");
  const github = text(item.secondaryUrl) || (/github\.com/i.test(url) ? url : "");
  return {
    projectType: "standalone",
    standaloneProjectName: text(item.title),
    title: text(item.title),
    cardSummary: text(item.description),
    fullDescription: text(item.description),
    description: text(item.description),
    technologies: Array.isArray(item.tags) ? item.tags : [],
    coverImageUrl: text(item.image),
    coverImage: text(item.image) ? { url: text(item.image) } : null,
    actionType: isVideo ? "uploaded-mp4" : isAnchor ? "internal-section" : /github\.com/i.test(url) ? "github" : "live-site",
    destination: isAnchor ? url : "",
    githubUrl: github,
    liveUrl: !isVideo && !isAnchor && !/github\.com/i.test(url) ? url : "",
    demoVideo: isVideo ? { url } : null,
    buttonLabel: text(item.primaryLabel || "View Project"),
    status: "published",
    visible: true,
    featured: index === 0,
    displayOrder: index + 1,
    mediaType: isVideo ? "cover-mp4" : "cover-only"
  };
}

async function ensureProject(item, index, payload) {
  const documentId = `legacy-${slug(item.title, index)}`;
  const reference = doc(db, "projects", documentId);
  pipelineLog("Firestore write target", { path: reference.path, collectionName: "projects", documentId });
  const directSnapshot = await getDoc(reference);

  if (directSnapshot.exists()) {
    const existing = directSnapshot.data();
    const shouldUpgradeLegacyLink =
      payload.projectType === "linked-module" &&
      existing.legacySource === "content.js" &&
      Number(existing.initializationVersion || 1) < PORTFOLIO_INITIALIZATION_VERSION &&
      text(existing.linkedDocumentId) === "";

    if (shouldUpgradeLegacyLink) {
      // Correct only the old initializer's classification fields. Existing
      // administrator-edited card copy and media overrides remain untouched.
      await setDoc(reference, {
        projectType: payload.projectType,
        linkedModuleKey: payload.linkedModuleKey,
        linkedModule: payload.linkedModule,
        linkedCollection: payload.linkedCollection,
        linkedDocumentId: payload.linkedDocumentId,
        linkedDestination: payload.linkedDestination,
        actionType: payload.actionType,
        destination: payload.destination,
        buttonLabel: text(existing.buttonLabel || payload.buttonLabel),
        initializationVersion: PORTFOLIO_INITIALIZATION_VERSION,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    const readBack = await verifyImmediateReadBack(reference, existing);
    pipelineLog("Firestore write result", { path: reference.path, result: "existing" });
    return { result: "existing", id: directSnapshot.id, data: readBack.data, reference, readBackVerified: true };
  }

  if (payload.projectType === "linked-module" && payload.linkedDocumentId) {
    const linkedMatches = await getDocs(query(collection(db, "projects"), where("linkedDocumentId", "==", payload.linkedDocumentId)));
    const duplicate = linkedMatches.docs.find((snapshot) => {
      const data = snapshot.data();
      return text(data.linkedModuleKey || data.linkedModule).toLowerCase() === payload.linkedModuleKey;
    });
    if (duplicate) {
      const readBack = await verifyImmediateReadBack(duplicate.ref, duplicate.data());
      pipelineLog("Firestore write result", { path: duplicate.ref.path, result: "existing-duplicate-protected" });
      return { result: "existing", id: duplicate.id, data: readBack.data, reference: duplicate.ref, readBackVerified: true };
    }
  }

  const titleMatch = await findMatchingDocument("projects", [{ field: "title", value: text(item.title) }]);
  if (titleMatch) {
    const readBack = await verifyImmediateReadBack(titleMatch.ref, titleMatch.data());
    pipelineLog("Firestore write result", { path: titleMatch.ref.path, result: "existing-title-match" });
    return { result: "existing", id: titleMatch.id, data: readBack.data, reference: titleMatch.ref, readBackVerified: true };
  }

  await setDoc(reference, {
    ...payload,
    legacySource: "content.js",
    initializationVersion: PORTFOLIO_INITIALIZATION_VERSION,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const readBack = await verifyImmediateReadBack(reference, payload);
  pipelineLog("Firestore write result", { path: reference.path, result: "imported" });
  return { result: "imported", id: documentId, data: readBack.data, reference, readBackVerified: true };
}


function publiclyEligible(collectionName, record = {}) {
  if (record.isDeleted === true || record.archived === true || record.deletedAt || record.archivedAt) return false;
  return record.status === "published" && record.visible === true;
}

async function runExactPublicQuery(moduleKey, path) {
  if (path.includes("/")) {
    const [collectionName, documentId] = path.split("/");
    const snapshot = await getDoc(doc(db, collectionName, documentId));
    if (!snapshot.exists()) return [];
    const record = snapshot.data() || {};
    return publiclyEligible(collectionName, record) ? [{ id: documentId, ...record }] : [];
  }

  const reference = collection(db, path);
  const publicQuery = query(reference, where("status", "==", "published"), where("visible", "==", true));
  const snapshot = await getDocs(publicQuery);
  return snapshot.docs
    .map((item) => ({ id: item.id, ...(item.data() || {}) }))
    .filter((record) => !(moduleKey === "photoEditing" && (record.isPortfolioGateway === true || record.showInPublicGallery === false)))
    .filter((record) => record.isDeleted !== true && record.archived !== true && !record.deletedAt && !record.archivedAt);
}

async function verifyInitializationPipeline(report) {
  const verification = {};
  for (const [moduleKey, path] of Object.entries(INITIALIZATION_COLLECTION_MAPPING)) {
    let adminRecords = [];
    if (path.includes("/")) {
      const [collectionName, documentId] = path.split("/");
      const snapshot = await getDoc(doc(db, collectionName, documentId));
      adminRecords = snapshot.exists() ? [{ id: documentId, ...(snapshot.data() || {}) }] : [];
    } else {
      const snapshot = await getDocs(collection(db, path));
      adminRecords = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() || {}) }));
    }
    const publicRecords = await runExactPublicQuery(moduleKey, path);
    const dashboardSupported = ["experience", "projects", "photoEditing", "education", "skills", "certificates", "resumes"].includes(moduleKey);
    const moduleResult = report.moduleResults[moduleKey];
    const trackedIds = new Set(moduleResult.recordIds || []);
    const trackedFirestoreRecords = adminRecords.filter((record) => trackedIds.has(text(record.id)));
    const trackedPublicRecords = publicRecords.filter((record) => trackedIds.has(text(record.id)));
    const expectedPublicIds = new Set(trackedFirestoreRecords
      .filter((record) => publiclyEligible(path.includes("/") ? path.split("/")[0] : path, record))
      .filter((record) => !(moduleKey === "photoEditing" && (record.isPortfolioGateway === true || record.showInPublicGallery === false)))
      .map((record) => text(record.id)));

    moduleResult.firestoreCount = adminRecords.length;
    moduleResult.adminCount = adminRecords.length;
    moduleResult.dashboardCount = dashboardSupported ? adminRecords.length : null;
    moduleResult.publicCount = publicRecords.length;
    moduleResult.expectedPublicCount = expectedPublicIds.size;

    const processedCount = moduleResult.importedCount + moduleResult.existingCount;
    const processedMatches = moduleResult.legacyCount === processedCount;
    const trackedMatches = trackedIds.size === moduleResult.legacyCount;
    const firestoreMatches = trackedFirestoreRecords.length === trackedIds.size;
    const publicIds = new Set(trackedPublicRecords.map((record) => text(record.id)));
    const publicMatches = [...expectedPublicIds].every((id) => publicIds.has(id));
    moduleResult.matched = processedMatches && trackedMatches && firestoreMatches && publicMatches;
    moduleResult.mismatchReason = moduleResult.matched ? "" : [
      !processedMatches ? `initializeLegacyPortfolio: legacy ${moduleResult.legacyCount} != imported/existing ${processedCount}` : "",
      !trackedMatches ? `initialization tracking: expected ${moduleResult.legacyCount} deterministic records but tracked ${trackedIds.size}` : "",
      !firestoreMatches ? `${moduleResult.path}: ${trackedFirestoreRecords.length}/${trackedIds.size} initialized records were immediately readable by Admin` : "",
      !publicMatches ? `${moduleResult.readers.public}: one or more currently Published-and-Visible initialized records were filtered out by the public query` : ""
    ].filter(Boolean).join("; ");

    verification[moduleKey] = {
      path,
      legacyCount: moduleResult.legacyCount,
      importedCount: moduleResult.importedCount,
      existingCount: moduleResult.existingCount,
      firestoreCount: moduleResult.firestoreCount,
      adminCount: moduleResult.adminCount,
      dashboardCount: moduleResult.dashboardCount,
      publicCount: moduleResult.publicCount,
      expectedPublicCount: moduleResult.expectedPublicCount,
      matched: moduleResult.matched,
      mismatchReason: moduleResult.mismatchReason,
      readers: moduleResult.readers
    };
    recordTrace(report, "Dashboard query count", { moduleKey, count: moduleResult.dashboardCount, reader: moduleResult.readers.admin });
    recordTrace(report, "Public query count", { moduleKey, count: moduleResult.publicCount, reader: moduleResult.readers.public });
    recordTrace(report, "Module count reconciliation", { moduleKey, ...verification[moduleKey] });
  }
  return verification;
}

export function normalizeLegacyPortfolioSource(candidate = {}) {
  const legacy = candidate?.PORTFOLIO_CONTENT || candidate?.default || candidate;
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
    throw new Error("Legacy portfolio content is unavailable.");
  }
  const requiredObjects = ["site", "hero", "about"];
  const missingObjects = requiredObjects.filter((key) => !legacy[key] || typeof legacy[key] !== "object" || Array.isArray(legacy[key]));
  const requiredArrays = ["experience", "projects", "gallery", "certificates", "resumes"];
  const optionalArrays = ["education", "skills"];
  const invalidArrays = requiredArrays.filter((key) => !Array.isArray(legacy[key]));
  if (missingObjects.length || invalidArrays.length) {
    throw new Error(`Legacy portfolio source is incomplete. Missing objects: ${missingObjects.join(", ") || "none"}; invalid arrays: ${invalidArrays.join(", ") || "none"}.`);
  }
  const totalOfficialRecords = [...requiredArrays, ...optionalArrays].reduce((sum, key) => sum + (Array.isArray(legacy[key]) ? legacy[key].length : 0), 0);
  if (!text(legacy.hero.name || legacy.site.name) || totalOfficialRecords === 0) {
    throw new Error("Legacy portfolio source does not contain the official portfolio records.");
  }
  return {
    ...legacy,
    education: Array.isArray(legacy.education) ? legacy.education : [],
    skills: Array.isArray(legacy.skills) ? legacy.skills : []
  };
}

export async function initializeLegacyPortfolio(candidate = {}, onProgress = () => {}, options = {}) {
  const legacy = normalizeLegacyPortfolioSource(candidate);

  // A normal re-run is the explicit production reset. Repair mode remains
  // non-destructive and only backfills missing official records.
  const replaceProduction = options.replaceProduction !== false;
  const removedRecords = replaceProduction ? await removePreviousPortfolioRecords(onProgress) : 0;

  const report = createReport(legacy);
  report.removedRecords = removedRecords;
  report.schemaMigration = replaceProduction
    ? { scanned: 0, updated: 0, skipped: "production reset" }
    : await migratePortfolioSchema();
  recordTrace(report, "Legacy object loaded", { sourceInventory: report.sourceInventory });
  recordTrace(report, "Inventory counts", { counts: expectedLegacyCounts(legacy), totalRecords: report.sourceInventory.totalRecords });
  recordTrace(report, "Data passed into initializeLegacyPortfolio()", {
    sourceInventory: report.sourceInventory,
    collectionMapping: report.collectionMapping
  });
  onProgress({ current: 0, total: 1, label: `Validated official source (${report.sourceInventory.totalRecords} collection records)`, result: "validated", report: { ...report } });
  const operations = [];
  const addOperation = (moduleKey, label, execute) => operations.push({ moduleKey, label, execute });
  const site = legacy.site || {};
  const hero = legacy.hero || {};

  addOperation("home", "Home", () => ensureMissingDocument({
    collectionName: "portfolio",
    documentId: "home",
    data: {
      eyebrow: text(hero.eyebrow || "Hello, I'm"), displayName: text(hero.name || site.name), brand: text(site.brand || "LΛN"),
      headline: Array.isArray(hero.roles) ? text(hero.roles[0]) : "", roles: Array.isArray(hero.roles) ? hero.roles : [],
      introduction: text(hero.intro), portrait: text(hero.image), portraitAlt: `${text(hero.name || site.name || "Portfolio")} portrait`,
      primaryCtaLabel: "View My Work", primaryCtaDestination: "#projects", secondaryCtaLabel: "View Resumes", secondaryCtaDestination: "#resumes",
      aboutImage: text(legacy.about?.image), aboutImageAlt: `${text(hero.name || site.name || "Portfolio")} about portrait`,
      aboutVisible: true, sections: ["about","experience","projects","photo-editing","education","skills","certificates","resume","contact"].map((key,index)=>({key,enabled:true,order:(index+1)*100,titleOverride:"",subtitle:""})), footerText: `© ${new Date().getFullYear()} ${text(hero.name || site.name)}`,
      status: "published", visible: true
    }
  }));
  addOperation("about", "About", () => ensureMissingDocument({
    collectionName: "portfolio", documentId: "profile",
    data: {
      fullName: text(hero.name || site.name), displayName: text(hero.name || site.name).split(" ")[0],
      professionalTitle: Array.isArray(hero.roles) ? hero.roles.join(" · ") : "", location: text(site.location), shortIntroduction: text(hero.intro),
      aboutDescription: text(legacy.about?.text), featuredRoles: Array.isArray(hero.roles) ? hero.roles : [],
      sectionVisible: true, status: "published", visible: true
    }
  }));
  addOperation("contact", "Contact", () => ensureMissingDocument({
    collectionName: "portfolio", documentId: "contact",
    data: {
      email: text(site.email), phone: text(site.phone), location: text(site.location), github: text(site.github), linkedin: text(site.linkedin), facebook: text(site.facebook),
      heading: "Let's Work Together", message: "I'm open to opportunities and meaningful projects. Let's create something useful together.", status: "published", visible: true
    }
  }));
  const legacyEducation = Array.isArray(legacy.education) ? legacy.education : [];
  legacyEducation.forEach((item, index) => addOperation("education", `Education: ${item.schoolName || item.degreeName}`, () => ensureMissingDocument({
    collectionName: "education", documentId: `legacy-${slug(item.schoolName || item.degreeName, index)}`,
    data: {
      schoolName: text(item.schoolName), degreeName: text(item.degreeName), majorName: text(item.majorName), educationLevel: text(item.educationLevel || "college"),
      educationLocation: text(item.educationLocation || item.location), startYear: text(item.startYear), endYear: text(item.endYear), currentlyStudying: item.currentlyStudying === true,
      educationSummary: text(item.summary || item.educationSummary), achievements: Array.isArray(item.achievements) ? item.achievements : [], coursework: Array.isArray(item.coursework) ? item.coursework : [],
      status: "published", visible: true, featured: index === 0, displayOrder: index + 1,
      educationStatus: "published", educationVisible: true, featuredEducation: index === 0, educationDisplayOrder: index + 1
    },
    matches: [{ field: "schoolName", value: text(item.schoolName) }]
  })));

  (legacy.skills || []).forEach((item, index) => addOperation("skills", `Skill: ${item.name}`, () => ensureMissingDocument({
    collectionName: "skills", documentId: `legacy-${slug(item.name, index)}`,
    data: { name: text(item.name), category: text(item.category || "Professional"), customCategory: text(item.category || "Professional"), proficiency: Number(item.proficiency) || 0, active: true, status: "published", visible: true, featured: index < 6, displayOrder: index + 1 },
    matches: [{ field: "name", value: text(item.name) }]
  })));

  const experienceSources = [];
  for (const [index, item] of (legacy.experience || []).entries()) {
    addOperation("experience", `Experience: ${item.role}`, async () => {
      const result = await ensureMissingDocument({
        collectionName: "experiences", documentId: `legacy-${slug(item.role, index)}`,
        data: {
          role: text(item.role), jobTitle: text(item.role), company: text(item.company), description: text(item.details), summary: text(item.details),
          ...parseLegacyDate(item.date), status: "published", visible: true, featured: index === 0, displayOrder: index + 1
        },
        matches: [{ field: "role", value: text(item.role) }, { field: "jobTitle", value: text(item.role) }]
      });
      experienceSources[index] = { ...item, id: result.id };
      return result;
    });
  }

  const galleryItems = (legacy.gallery || []).map((item) => ({
    url: text(item.image), displayName: text(item.title), title: text(item.title), category: text(item.category), description: text(item.description)
  }));
  let photoPortfolioSourceId = "";
  if (galleryItems.length) {
    addOperation("photoEditing", "Photo Editing: Portfolio Gallery", async () => {
      const result = await ensureMissingDocument({
        collectionName: "photoEditingProjects", documentId: "legacy-photo-editing-portfolio",
        data: {
          title: "Photo Editing Portfolio", description: "The official photo-editing portfolio collection.", shortDescription: "Portrait, product, background-removal, color-correction, thumbnail, and AI-assisted editing work.",
          category: "Photo Editing", projectDisplayType: "gallery", displayType: "gallery", galleryImages: galleryItems,
          coverImageUrl: text(legacy.projects?.find((project) => text(project.primaryUrl) === "#photo-editing")?.image || galleryItems[0]?.url),
          status: "published", visible: true, featured: true, displayOrder: 1, isPortfolioGateway: true, showInPublicGallery: false
        },
        matches: [{ field: "title", value: "Photo Editing Portfolio" }]
      });
      photoPortfolioSourceId = result.id;
      // Non-destructively upgrade legacy aggregate records with gateway flags.
      // No administrator-authored presentation fields are overwritten.
      if (result.result === "existing") {
        await setDoc(result.reference, {
          isPortfolioGateway: true,
          showInPublicGallery: false,
          initializationVersion: PORTFOLIO_INITIALIZATION_VERSION,
          updatedAt: serverTimestamp()
        }, { merge: true });
        result.data = { ...(result.data || {}), isPortfolioGateway: true, showInPublicGallery: false };
      }
      return result;
    });
  }

  (legacy.gallery || []).forEach((item, index) => addOperation("photoEditing", `Photo Editing: ${item.title}`, () => ensureMissingDocument({
    collectionName: "photoEditingProjects", documentId: `legacy-${slug(item.title, index)}`,
    data: {
      title: text(item.title), description: text(item.description), shortDescription: text(item.description), category: text(item.category || "Photo Editing"),
      projectDisplayType: "single", displayType: "single", singleImageUrl: text(item.image), singleImage: text(item.image) ? { url: text(item.image) } : null,
      coverImageUrl: text(item.image), status: "published", visible: true, featured: false, displayOrder: index + 2
    },
    matches: [{ field: "title", value: text(item.title) }, { field: "singleImageUrl", value: text(item.image) }, { field: "coverImageUrl", value: text(item.image) }]
  })));

  (legacy.certificates || []).forEach((item, index) => addOperation("certificates", `Certificate: ${item.title}`, () => ensureMissingDocument({
    collectionName: "certificates", documentId: `legacy-${slug(item.title, index)}`,
    data: { title: text(item.title), issuer: "", year: text(item.year), issueDate: text(item.year), status: "published", visible: true, featured: false, displayOrder: index + 1 },
    matches: [{ field: "title", value: text(item.title) }]
  })));
  (legacy.resumes || []).forEach((item, index) => addOperation("resumes", `Resume: ${item.title}`, () => ensureMissingDocument({
    collectionName: "resumes", documentId: `legacy-${slug(item.title, index)}`,
    data: { title: text(item.title), category: slug(item.title, index), description: "", sourceType: "external", externalUrl: text(item.file), pdfUrl: text(item.file), file: text(item.file), fileUrl: text(item.file), uploadedAsset: null, fileName: text(item.file).split("/").pop() || `${slug(item.title, index)}.pdf`, version: "", status: "published", visible: true, featured: index === 0, displayOrder: index + 1 },
    matches: [{ field: "title", value: text(item.title) }]
  })));

  // Import all source-owned content first, then classify and create legacy Project cards.
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    try {
      const result = await operation.execute();
      updateReport(report, result.result);
      updateModuleResult(report, operation.moduleKey, result.result);
      trackModuleRecord(report, operation.moduleKey, result);
      recordTrace(report, "Firestore write result", { moduleKey: operation.moduleKey, label: operation.label, result: result.result, id: result.id, readBackVerified: result.readBackVerified === true });
      recordReportItem(report, operation.label, result.result, result.backfilledFields?.length ? `${result.id || ""} · restored fields: ${result.backfilledFields.join(", ")}` : (result.id || ""));
      onProgress({ current: index + 1, total: operations.length + (legacy.projects || []).length, label: operation.label, result: result.result, report: { ...report } });
    } catch (error) {
      report.failed += 1;
      updateModuleResult(report, operation.moduleKey, "failed");
      recordTrace(report, "Firestore write failed", { moduleKey: operation.moduleKey, label: operation.label, message: error.message });
      report.failures.push({ label: operation.label, message: error.message });
      recordReportItem(report, operation.label, "failed", error.message);
      onProgress({ current: index + 1, total: operations.length + (legacy.projects || []).length, label: operation.label, result: "failed", report: { ...report } });
    }
  }

  for (const [projectIndex, item] of (legacy.projects || []).entries()) {
    const label = `Project: ${item.title}`;
    const target = text(item.primaryUrl).toLowerCase();
    try {
      let payload;
      let classification;

      if (target === "#photo-editing") {
        const module = registryEntry("photo-editing");
        if (module && photoPortfolioSourceId) {
          payload = linkedProjectPayload(item, projectIndex, module, photoPortfolioSourceId);
          classification = "linked";
        } else {
          payload = standaloneProjectPayload(item, projectIndex);
          payload.destination = "#photo-editing";
          payload.actionType = "internal-section";
          classification = "standalone-recovery";
        }
      } else if (target === "#experience") {
        const ranked = experienceSources.filter(Boolean).map((source) => ({ source, score: sourceScore(item, source) })).sort((a, b) => b.score - a.score);
        const best = ranked[0];
        const module = registryEntry("experience");
        if (module && best && best.score >= 3) {
          payload = linkedProjectPayload(item, projectIndex, module, best.source.id);
          classification = "linked";
        } else {
          payload = standaloneProjectPayload(item, projectIndex);
          payload.destination = "#experience";
          payload.actionType = "internal-section";
          classification = "standalone-recovery";
        }
      } else {
        payload = standaloneProjectPayload(item, projectIndex);
        classification = "standalone";
      }

      const result = await ensureProject(item, projectIndex, payload);
      updateReport(report, result.result);
      updateModuleResult(report, "projects", result.result);
      trackModuleRecord(report, "projects", result);
      recordTrace(report, "Firestore write result", { moduleKey: "projects", label, result: result.result, id: result.id, readBackVerified: result.readBackVerified === true });
      report[classification] += 1;
      recordReportItem(report, label, result.result, `${classification}:${result.id || ""}`);
      onProgress({ current: operations.length + projectIndex + 1, total: operations.length + (legacy.projects || []).length, label, result: result.result, report: { ...report } });
    } catch (error) {
      const isUnresolved = target === "#experience" || target === "#photo-editing";
      if (isUnresolved) {
        report.unresolved += 1;
        report.skipped += 1;
        updateModuleResult(report, "projects", "unresolved");
        report.unresolvedItems.push({ label, reason: error.message });
        recordReportItem(report, label, "unresolved", error.message);
        onProgress({ current: operations.length + projectIndex + 1, total: operations.length + (legacy.projects || []).length, label, result: "unresolved", report: { ...report } });
      } else {
        report.failed += 1;
        updateModuleResult(report, "projects", "failed");
        report.failures.push({ label, message: error.message });
        recordReportItem(report, label, "failed", error.message);
        onProgress({ current: operations.length + projectIndex + 1, total: operations.length + (legacy.projects || []).length, label, result: "failed", report: { ...report } });
      }
    }
  }

  try {
    report.firestoreVerification = await verifyInitializationPipeline(report);
    console.info("[LΛN initialization pipeline] Firestore write/read verification", report.firestoreVerification);
  } catch (error) {
    report.failed += 1;
    report.failures.push({ label: "Firestore pipeline verification", message: error.message });
    recordReportItem(report, "Firestore pipeline verification", "failed", error.message);
  }

  const countMismatches = Object.entries(report.moduleResults || {})
    .filter(([, result]) => result.matched === false)
    .map(([moduleKey, result]) => ({ moduleKey, reason: result.mismatchReason }));
  report.countMismatches = countMismatches;
  for (const mismatch of countMismatches) {
    const label = `Pipeline count mismatch: ${mismatch.moduleKey}`;
    recordReportItem(report, label, "mismatch", mismatch.reason);
    recordTrace(report, "Pipeline mismatch identified", mismatch);
  }

  if (report.failed === 0 && report.unresolved === 0 && report.countMismatches.length === 0) {
    await setDoc(doc(db, "portfolio", "initialization"), {
      version: PORTFOLIO_INITIALIZATION_VERSION,
      schemaVersion: PORTFOLIO_INITIALIZATION_VERSION,
      completed: true,
      imported: report.imported,
      existing: report.existing,
      skipped: report.skipped,
      linked: report.linked,
      standalone: report.standalone,
      unresolved: report.unresolved,
      failed: report.failed,
      itemCount: report.items.length,
      sourceInventory: report.sourceInventory,
      collectionMapping: report.collectionMapping,
      schemaMigration: report.schemaMigration || {},
      firestoreVerification: report.firestoreVerification || {},
      moduleResults: report.moduleResults || {},
      countMismatches: report.countMismatches || [],
      completedAt: serverTimestamp(),
      runtimeRevision: Date.now(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    try {
      const payload = { type: "portfolio-content-changed", scope: "initialization", at: Date.now() };
      localStorage.setItem("lan.portfolio.contentChanged", JSON.stringify(payload));
      if (typeof BroadcastChannel === "function") { const channel = new BroadcastChannel("lan-portfolio-sync"); channel.postMessage(payload); channel.close(); }
    } catch { /* storage or BroadcastChannel may be unavailable */ }
  }

  return report;
}

export async function loadInitializationStatus() {
  const snapshot = await getDoc(doc(db, "portfolio", "initialization"));
  return snapshot.exists() ? snapshot.data() : { completed: false, version: 0 };
}
