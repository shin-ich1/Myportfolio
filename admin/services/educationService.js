import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "./firebase.js";

const COLLECTION_NAME = "education";
const LEGACY_STORAGE_KEY = "lanPortfolioEducation";
const educationCollection = collection(db, COLLECTION_NAME);

function generateEducationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `education-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanText(value = "") {
  return String(value ?? "").trim();
}

function cleanArray(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/g)
      : [];
  return source.map(cleanText).filter(Boolean);
}

function toIsoDate(value) {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeToken(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\/_–—-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEducationLevel(value = "") {
  const aliases = new Map([
    ["preschool", "preschool"], ["pre school", "preschool"], ["kindergarten", "preschool"],
    ["elementary", "elementary"], ["primary", "elementary"], ["primary school", "elementary"], ["elementary primary school grades 1 6", "elementary"],
    ["junior high", "junior-high"], ["junior high school", "junior-high"], ["secondary", "junior-high"], ["secondary school", "junior-high"], ["high school", "junior-high"], ["junior high secondary school grades 7 10", "junior-high"],
    ["senior high", "senior-high"], ["senior high school", "senior-high"], ["senior high school grades 11 12", "senior-high"],
    ["associate", "associate"], ["associate degree", "associate"], ["associates degree", "associate"],
    ["college", "college"], ["university", "college"], ["college university", "college"], ["undergraduate", "college"], ["bachelor", "college"], ["bachelors", "college"], ["bachelors degree", "college"],
    ["masters", "masters"], ["master", "masters"], ["masters degree", "masters"],
    ["doctoral", "doctoral"], ["doctoral degree", "doctoral"], ["doctorate", "doctoral"], ["phd", "doctoral"],
    ["postgraduate", "postgraduate"], ["graduate", "postgraduate"], ["graduate postgraduate", "postgraduate"], ["postgraduate graduate study other", "postgraduate"],
    ["vocational", "vocational"], ["technical", "vocational"], ["vocational technical", "vocational"],
    ["certification", "certification"], ["certification program", "certification"],
    ["other", "other"]
  ]);
  return aliases.get(normalizeToken(value)) || "";
}

const MONTHS = new Map([
  ["jan", "01"], ["january", "01"], ["feb", "02"], ["february", "02"],
  ["mar", "03"], ["march", "03"], ["apr", "04"], ["april", "04"], ["may", "05"],
  ["jun", "06"], ["june", "06"], ["jul", "07"], ["july", "07"], ["aug", "08"], ["august", "08"],
  ["sep", "09"], ["sept", "09"], ["september", "09"], ["oct", "10"], ["october", "10"],
  ["nov", "11"], ["november", "11"], ["dec", "12"], ["december", "12"]
]);

function normalizeMonth(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  if (/^(0?[1-9]|1[0-2])$/.test(text)) return String(Number(text)).padStart(2, "0");
  return MONTHS.get(normalizeToken(text)) || "";
}

function normalizeYear(value = "") {
  const match = cleanText(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function parsePeriod(value = "") {
  const raw = cleanText(value);
  if (!raw) return { month: "", year: "" };
  const iso = raw.match(/^((?:19|20)\d{2})-(0?[1-9]|1[0-2])(?:-\d{1,2})?$/);
  if (iso) return { year: iso[1], month: String(Number(iso[2])).padStart(2, "0") };
  const text = raw.match(/^([A-Za-z]+)\s+((?:19|20)\d{2})$/);
  if (text) return { month: normalizeMonth(text[1]), year: text[2] };
  return { month: "", year: normalizeYear(raw) };
}

function resolvePeriod(record = {}, prefix = "start") {
  const directMonth = normalizeMonth(record[`${prefix}Month`]);
  const directYear = normalizeYear(record[`${prefix}Year`]);
  if (directMonth || directYear) return { month: directMonth, year: directYear };
  return parsePeriod(record[`${prefix}Date`] || record[prefix] || record[`${prefix}Period`]);
}

function normalizeEducation(record = {}, id = "") {
  const canonicalStatus = cleanText(record.status).toLowerCase();
  const legacyStatus = cleanText(record.educationStatus || record.publicationStatus).toLowerCase();
  const status = canonicalStatus === "published" || canonicalStatus === "draft"
    ? canonicalStatus
    : legacyStatus === "published"
      ? "published"
      : "draft";

  const visible = typeof record.visible === "boolean"
    ? record.visible
    : typeof record.educationVisible === "boolean"
      ? record.educationVisible
      : typeof record.isVisible === "boolean"
        ? record.isVisible
        : true;

  const displayOrderCandidate = record.displayOrder ?? record.educationDisplayOrder ?? record.order;
  const displayOrder = Number.isFinite(Number(displayOrderCandidate)) ? Number(displayOrderCandidate) : 0;
  const featured = typeof record.featured === "boolean"
    ? record.featured
    : typeof record.featuredEducation === "boolean"
      ? record.featuredEducation
      : Boolean(record.isFeatured);

  const start = resolvePeriod(record, "start");
  const end = resolvePeriod(record, "end");
  const levelSource = record.educationLevel || record.level || record.schoolLevel || record.educationType;
  const normalizedLevel = normalizeEducationLevel(levelSource);
  const customLevel = cleanText(record.educationLevelOther || record.customEducationLevel || record.levelOther);
  const educationLevel = normalizedLevel || (cleanText(levelSource) ? "other" : "");

  return {
    id: cleanText(id || record.id || generateEducationId()),
    schoolName: cleanText(record.schoolName || record.school || record.institution || record.institutionName),
    degreeName: cleanText(record.degreeName || record.degree || record.program || record.course || record.qualification),
    degreeShortName: cleanText(record.degreeShortName || record.degreeAbbreviation || record.degreeAcronym || record.shortDegreeName),
    majorName: cleanText(record.majorName || record.major || record.specialization || record.fieldOfStudy),
    educationLevel,
    educationLevelOther: educationLevel === "other" ? (customLevel || cleanText(levelSource)) : customLevel,
    educationLocation: cleanText(record.educationLocation || record.location || record.schoolLocation),
    schoolWebsite: cleanText(record.schoolWebsite || record.website || record.institutionWebsite),
    startMonth: start.month,
    startYear: start.year,
    endMonth: Boolean(record.currentlyStudying ?? record.isCurrent ?? record.current) ? "" : end.month,
    endYear: Boolean(record.currentlyStudying ?? record.isCurrent ?? record.current) ? "" : end.year,
    currentlyStudying: Boolean(record.currentlyStudying ?? record.isCurrent ?? record.current),
    educationSummary: cleanText(record.educationSummary || record.summary || record.description || record.details),
    achievements: cleanArray(record.achievements || record.highlights),
    coursework: cleanArray(record.coursework || record.courses || record.relevantCoursework),
    schoolLogoUrl: cleanText(record.schoolLogoUrl || record.logoUrl || record.logo || record.schoolLogo),
    status,
    visible,
    featured,
    displayOrder,
    educationStatus: status,
    educationVisible: visible,
    featuredEducation: featured,
    educationDisplayOrder: displayOrder,
    createdAt: toIsoDate(record.createdAt),
    updatedAt: toIsoDate(record.updatedAt)
  };
}

function canonicalizeEducationPayload(payload = {}) {
  const canonical = { ...payload };

  if (Object.prototype.hasOwnProperty.call(payload, "educationStatus")) {
    canonical.status = cleanText(payload.educationStatus).toLowerCase() === "published"
      ? "published"
      : "draft";
  }
  if (Object.prototype.hasOwnProperty.call(payload, "educationVisible")) {
    canonical.visible = Boolean(payload.educationVisible);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "featuredEducation")) {
    canonical.featured = Boolean(payload.featuredEducation);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "educationDisplayOrder")) {
    const displayOrder = Number(payload.educationDisplayOrder);
    canonical.displayOrder = Number.isFinite(displayOrder) ? displayOrder : 0;
  }

  return canonical;
}

function educationSemanticKey(record = {}) {
  const normalize = (value = "") => cleanText(value).toLowerCase().replace(/\s+/g, " ");
  return [
    normalize(record.schoolName),
    normalize(record.degreeName),
    normalize(record.majorName),
    normalize(record.startYear),
    normalize(record.endYear)
  ].join("|");
}

function dedupeEducationRecords(records = []) {
  const chosen = new Map();
  const score = (record = {}) =>
    (record.status === "published" ? 8 : 0) +
    (record.visible !== false ? 4 : 0) +
    (record.featured ? 2 : 0) +
    (record.schoolLogoUrl ? 1 : 0);
  const timestamp = (record = {}) => Date.parse(record.updatedAt || record.createdAt || 0) || 0;

  for (const record of records) {
    const key = educationSemanticKey(record);
    if (!key.replace(/\|/g, "")) {
      chosen.set(`id:${record.id}`, record);
      continue;
    }
    const current = chosen.get(key);
    if (!current || score(record) > score(current) || (score(record) === score(current) && timestamp(record) > timestamp(current))) {
      chosen.set(key, record);
    }
  }
  return [...chosen.values()];
}

function persistedEducation(record = {}) {
  const normalized = normalizeEducation(record, record.id);
  const {
    id,
    createdAt,
    updatedAt,
    ...data
  } = normalized;
  return data;
}

function parseLegacyStorage() {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((record) => normalizeEducation(record)) : [];
  } catch (error) {
    console.warn("Unable to read legacy Education local storage.", error);
    return [];
  }
}

async function importLegacyLocalEducationIfNeeded() {
  const snapshot = await getDocs(educationCollection);
  if (!snapshot.empty) return snapshot;

  const legacyRecords = parseLegacyStorage();
  if (!legacyRecords.length) return snapshot;

  for (const record of legacyRecords) {
    const reference = doc(db, COLLECTION_NAME, record.id || generateEducationId());
    await setDoc(reference, {
      ...persistedEducation(record),
      migratedFromLocalStorage: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  try {
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // A successful Firestore import is authoritative even if local cleanup is blocked.
  }

  return getDocs(educationCollection);
}


export class EducationService {
  async getEducationRecords() {
    const snapshot = await importLegacyLocalEducationIfNeeded();
    return dedupeEducationRecords(
      snapshot.docs.map((item) => normalizeEducation(item.data(), item.id))
    ).sort((a, b) => a.displayOrder - b.displayOrder || a.schoolName.localeCompare(b.schoolName));
  }

  async getEducationById(educationId) {
    if (!educationId) return null;
    const snapshot = await getDoc(doc(db, COLLECTION_NAME, educationId));
    return snapshot.exists() ? normalizeEducation(snapshot.data(), snapshot.id) : null;
  }

  async createEducation(payload) {
    const id = generateEducationId();
    const reference = doc(db, COLLECTION_NAME, id);
    const data = persistedEducation({ ...canonicalizeEducationPayload(payload), id });
    if (!data.schoolName || !data.degreeName) {
      throw new Error("School name and degree/program are required.");
    }
    await setDoc(reference, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const created = await getDoc(reference);
    return normalizeEducation(created.data(), created.id);
  }

  async updateEducation(educationId, payload) {
    if (!educationId) throw new Error("Education ID is required.");
    const reference = doc(db, COLLECTION_NAME, educationId);
    const existing = await getDoc(reference);
    if (!existing.exists()) throw new Error("Education record was not found.");
    const data = persistedEducation({
      ...existing.data(),
      ...canonicalizeEducationPayload(payload),
      id: educationId
    });
    if (!data.schoolName || !data.degreeName) {
      throw new Error("School name and degree/program are required.");
    }
    await setDoc(reference, {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
    const updated = await getDoc(reference);
    return normalizeEducation(updated.data(), updated.id);
  }

  async updateManyEducationRecords(educationIds = [], changes = {}) {
    const ids = [...new Set((educationIds || []).map((id) => cleanText(id)).filter(Boolean))];
    if (!ids.length) return 0;

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(changes, "status")) {
      patch.status = cleanText(changes.status).toLowerCase() === "published" ? "published" : "draft";
      patch.educationStatus = patch.status;
    }
    if (Object.prototype.hasOwnProperty.call(changes, "featured")) {
      patch.featured = Boolean(changes.featured);
      patch.featuredEducation = patch.featured;
    }
    if (Object.prototype.hasOwnProperty.call(changes, "visible")) {
      patch.visible = Boolean(changes.visible);
      patch.educationVisible = patch.visible;
    }
    if (!Object.keys(patch).length) throw new Error("No valid bulk Education changes were provided.");

    await Promise.all(ids.map((educationId) => setDoc(doc(db, COLLECTION_NAME, educationId), {
      ...patch,
      updatedAt: serverTimestamp()
    }, { merge: true })));
    return ids.length;
  }

  async deleteEducation(educationId) {
    if (!educationId) throw new Error("Education ID is required.");
    const reference = doc(db, COLLECTION_NAME, educationId);
    const existing = await getDoc(reference);
    if (!existing.exists()) throw new Error("Education record was not found.");
    await deleteDoc(reference);
    return true;
  }

  async duplicateEducation(educationId) {
    const source = await this.getEducationById(educationId);
    if (!source) throw new Error("Education record was not found.");
    return this.createEducation({
      ...source,
      id: undefined,
      schoolName: `${source.schoolName} (Copy)`,
      status: "draft",
      educationStatus: "draft",
      featured: false,
      featuredEducation: false
    });
  }
}

export const educationService = new EducationService();
