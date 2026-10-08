import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "./firebase.js";
import { announcePortfolioContentChanged } from "./portfolioSyncService.js";
import { resolveToolIconSource, toolIdentityMatchKey } from "../../tool-identity.js";

const COLLECTION_NAME = "skills";

const LEGACY_TOOL_RECORD_NAMES = new Set([
  "microsoft excel",
  "google workspace",
  "firebase and firestore",
  "firebase firestore",
  "adobe photoshop",
  "html css and javascript",
  "html css javascript",
]);

const CATEGORY_ALIASES = {
  "web development": "web-development",
  web: "web-development",
  frontend: "web-development",
  backend: "web-development",
  programming: "software-development",
  "software development": "software-development",
  "system development": "software-development",
  database: "database",
  databases: "database",
  "data office": "data-office",
  "data and office": "data-office",
  productivity: "data-office",
  "it support": "it-support",
  support: "it-support",
  multimedia: "multimedia",
  design: "multimedia",
  creative: "multimedia",
  ecommerce: "ecommerce",
  "e commerce": "ecommerce",
  administration: "administration",
  admin: "administration",
  "gis spatial": "gis-spatial",
  gis: "gis-spatial",
  spatial: "gis-spatial",
  other: "other",
};

const TOOL_CATEGORY_ALIASES = {
  office: "office-productivity",
  productivity: "office-productivity",
  "office productivity": "office-productivity",
  creative: "creative-media",
  multimedia: "creative-media",
  "creative media": "creative-media",
  design: "creative-media",
  web: "web-development",
  development: "web-development",
  "web development": "web-development",
  database: "database-cloud",
  cloud: "database-cloud",
  "database cloud": "database-cloud",
  collaboration: "collaboration",
  communication: "collaboration",
  "developer tools": "developer-tools",
  developer: "developer-tools",
  "data analytics": "data-analytics",
  analytics: "data-analytics",
  "ai automation": "ai-automation",
  automation: "ai-automation",
  "cms platforms": "cms-platforms",
  cms: "cms-platforms",
  security: "security",
  cybersecurity: "security",
  hardware: "hardware-embedded",
  embedded: "hardware-embedded",
  "hardware embedded": "hardware-embedded",
  surveying: "surveying-gnss",
  gnss: "surveying-gnss",
  "surveying gnss": "surveying-gnss",
  gis: "gis-spatial",
  spatial: "gis-spatial",
  "gis spatial": "gis-spatial",
  system: "systems-support",
  support: "systems-support",
  "systems support": "systems-support",
  other: "other",
};

const skillsCollection = collection(db, COLLECTION_NAME);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeName(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLegacyToolName(value = "") {
  return LEGACY_TOOL_RECORD_NAMES.has(normalizeName(value));
}

function cleanNumber(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function commaSeparatedToArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value).split(",").map(cleanText).filter(Boolean);
}

function slugCategory(value = "") {
  return cleanText(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function inferSkillCategory(name = "", rawCategory = "", customCategory = "") {
  const normalizedRaw = slugCategory(rawCategory);
  const direct = CATEGORY_ALIASES[normalizedRaw];
  if (direct && direct !== "other") return direct;

  const source = `${cleanText(name)} ${cleanText(customCategory)} ${cleanText(rawCategory)}`.toLowerCase();
  if (/\b(html|css|javascript|js|php|web|frontend|backend|api)\b/.test(source)) return "web-development";
  if (/software development|system development|application development|programming/.test(source)) return "software-development";
  if (/firebase|firestore|mysql|sql|database/.test(source)) return "database";
  if (/excel|spreadsheet|google workspace|google sheets|data entry|data encoding|records management|inventory/.test(source)) return "data-office";
  if (/troubleshoot|it support|tech support|maintenance|computer support/.test(source)) return "it-support";
  if (/photoshop|photo editing|image editing|retouch|multimedia|design|canva|video editing/.test(source)) return "multimedia";
  if (/gis|spatial|mapping|geographic/.test(source)) return "gis-spatial";
  if (/virtual assistant|administrative|administration|admin assistant/.test(source)) return "administration";
  if (/e[ -]?commerce|product listing|product lister/.test(source)) return "ecommerce";
  return direct || "other";
}

function inferToolCategory(name = "", rawCategory = "", customCategory = "") {
  const rawKey = slugCategory(rawCategory);
  const direct = TOOL_CATEGORY_ALIASES[rawKey];
  if (rawKey === "other" && cleanText(customCategory)) return "other";
  if (direct && direct !== "other") return direct;
  const source = `${cleanText(name)} ${cleanText(customCategory)} ${cleanText(rawCategory)}`.toLowerCase();
  if (/excel|sheets|word|powerpoint|office/.test(source)) return "office-productivity";
  if (/photoshop|canva|premiere|lightroom|illustrator|audacity|blender|3ds max|3dsmax|video|photo|animation|rendering/.test(source)) return "creative-media";
  if (/vscode|vs code|visual studio|github|git|npm|node|docker|terminal|ide/.test(source)) return "developer-tools";
  if (/html|css|javascript|php|web|frontend|backend/.test(source)) return "web-development";
  if (/firebase|firestore|mysql|sql|cloudinary|database|cloud|hosting/.test(source)) return "database-cloud";
  if (/power bi|tableau|analytics|dashboard|statistics|data studio|looker/.test(source)) return "data-analytics";
  if (/chatgpt|openai|gemini|copilot|automation|apps script|zapier|make\.com|ai /.test(source)) return "ai-automation";
  if (/wordpress|shopify|wix|squarespace|cms/.test(source)) return "cms-platforms";
  if (/google workspace|drive|docs|forms|slack|teams|discord|zoom/.test(source)) return "collaboration";
  if (/esp32|rfid|arduino|microcontroller|embedded|hardware platform/.test(source)) return "hardware-embedded";
  if (/sinognss|\bgnss\b|\brtk\b|surveying|survey equipment/.test(source)) return "surveying-gnss";
  if (/gis|qgis|arcgis|spatial|mapping/.test(source)) return "gis-spatial";
  if (/security|cyber|wireshark|nmap|firewall/.test(source)) return "security";
  if (/pais|windows|hardware|support|troubleshoot/.test(source)) return "systems-support";
  return direct || "other";
}

export function cleanSkillData(rawData = {}) {
  const name = cleanText(rawData.name || rawData.title || rawData.label);
  if (!name) throw new Error("Skill name is required.");

  const rawRecordType = cleanText(rawData.recordType || rawData.capabilityType).toLowerCase();
  const recordType = rawRecordType === "tool" || isLegacyToolName(name)
    ? "tool"
    : "skill";

  if (recordType === "tool") {
    const requestedCategory = cleanText(rawData.category || rawData.toolCategory || rawData.categoryLabel) || "other";
    const customCategory = cleanText(rawData.customCategory || rawData.otherCategory);
    const category = inferToolCategory(name, requestedCategory, customCategory);
    return {
      recordType: "tool",
      name,
      category,
      customCategory: category === "other" ? (customCategory || (slugCategory(requestedCategory) === "other" ? "Other" : requestedCategory)) : "",
      icon: cleanText(rawData.icon || rawData.logo || rawData.logoUrl),
      proficiency: 0,
      years: 0,
      description: cleanText(rawData.description || rawData.internalNote || rawData.note),
      tools: [],
      displayOrder: cleanNumber(rawData.displayOrder ?? rawData.order, 0, 0, 999),
      active: typeof rawData.active === "boolean" ? rawData.active : rawData.visible !== false,
      status: cleanText(rawData.status || rawData.publicationStatus).toLowerCase() === "draft" ? "draft" : "published",
      visible: rawData.visible === undefined ? (typeof rawData.active === "boolean" ? rawData.active : true) : rawData.visible !== false,
      featured: false,
    };
  }

  const requestedCategory = cleanText(rawData.category || rawData.skillCategory || rawData.categoryLabel) || "other";
  const customCategory = cleanText(rawData.customCategory || rawData.otherCategory);
  const category = inferSkillCategory(name, requestedCategory, customCategory);
  const normalizedCustomCategory = category === "other"
    ? (customCategory || (slugCategory(requestedCategory) === "other" ? "Other" : requestedCategory))
    : "";

  return {
    recordType: "skill",
    name,
    category,
    customCategory: category === "other" ? normalizedCustomCategory : "",
    icon: cleanText(rawData.icon || rawData.logo || rawData.logoUrl),
    proficiency: cleanNumber(rawData.proficiency ?? rawData.level ?? rawData.percentage, 80, 0, 95),
    years: cleanNumber(rawData.years ?? rawData.yearsExperience ?? rawData.experienceYears, 0, 0, 50),
    description: cleanText(rawData.description || rawData.internalNote || rawData.note),
    toolIds: commaSeparatedToArray(rawData.toolIds || rawData.toolsUsedIds),
    tools: commaSeparatedToArray(rawData.tools || rawData.toolsUsed),
    displayOrder: cleanNumber(rawData.displayOrder ?? rawData.order, 0, 0, 999),
    active: typeof rawData.active === "boolean" ? rawData.active : rawData.visible !== false,
    status: cleanText(rawData.status || rawData.publicationStatus).toLowerCase() === "draft" ? "draft" : "published",
    visible: rawData.visible === undefined ? (typeof rawData.active === "boolean" ? rawData.active : true) : rawData.visible !== false,
    featured: Boolean(rawData.featured),
  };
}

async function assertUniqueCapabilityName(recordType, name, excludeId = "") {
  const targetType = cleanText(recordType).toLowerCase() === "tool" ? "tool" : "skill";
  const targetName = targetType === "tool" ? toolIdentityMatchKey(name) : normalizeName(name);
  if (!targetName) return;

  const snapshot = await getDocs(skillsCollection);
  for (const item of snapshot.docs) {
    if (item.id === excludeId) continue;
    try {
      const existing = cleanSkillData(item.data() || {});
      const existingName = targetType === "tool" ? toolIdentityMatchKey(existing.name) : normalizeName(existing.name);
      if (existing.recordType === targetType && existingName === targetName) {
        const label = targetType === "tool" ? "Tool" : "Skill";
        throw new Error(`${label} “${name}” already exists. Select the existing record instead of creating a duplicate.`);
      }
    } catch (error) {
      if (/already exists\./.test(String(error?.message || ""))) throw error;
    }
  }
}

async function createCapability(rawData) {
  const data = cleanSkillData(rawData);
  await assertUniqueCapabilityName(data.recordType, data.name);
  const reference = await addDoc(skillsCollection, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  announcePortfolioContentChanged("capabilities");
  return reference.id;
}

async function updateCapability(capabilityId, rawData) {
  if (!capabilityId) throw new Error("Capability ID is required.");
  const data = cleanSkillData(rawData);
  await assertUniqueCapabilityName(data.recordType, data.name, capabilityId);
  await updateDoc(doc(db, COLLECTION_NAME, capabilityId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  announcePortfolioContentChanged("capabilities");
}

async function deleteCapability(capabilityId) {
  if (!capabilityId) throw new Error("Capability ID is required.");
  await deleteDoc(doc(db, COLLECTION_NAME, capabilityId));
  announcePortfolioContentChanged("capabilities");
}

export async function createSkill(rawData) {
  return createCapability({ ...rawData, recordType: "skill" });
}

export async function updateSkill(skillId, rawData) {
  return updateCapability(skillId, { ...rawData, recordType: "skill" });
}

export async function deleteSkill(skillId) {
  return deleteCapability(skillId);
}

export async function createTool(rawData) {
  return createCapability({ ...rawData, recordType: "tool" });
}


export async function ensureCapabilityByName(recordType, name) {
  const targetType = cleanText(recordType).toLowerCase() === "tool" ? "tool" : "skill";
  const cleanName = cleanText(name);
  if (!cleanName) throw new Error(`${targetType === "tool" ? "Tool" : "Skill"} name is required.`);

  const targetName = targetType === "tool" ? toolIdentityMatchKey(cleanName) : normalizeName(cleanName);
  const existing = (await loadSkills()).find((item) => {
    if (item.recordType !== targetType) return false;
    const itemName = targetType === "tool" ? toolIdentityMatchKey(item.name) : normalizeName(item.name);
    return itemName === targetName;
  });
  if (existing) {
    if (existing.active === false) {
      throw new Error(`${targetType === "tool" ? "Tool" : "Skill"} “${existing.name}” already exists but is inactive. Activate it in Skills & Tools Used instead of creating a duplicate.`);
    }
    return { ...existing, created: false };
  }

  let id;
  try {
    const toolCategory = targetType === "tool" ? inferToolCategory(cleanName, "other", "") : "";
    const toolIcon = targetType === "tool" ? resolveToolIconSource({ name: cleanName, category: toolCategory }) : "";
    id = targetType === "tool"
      ? await createTool({ name: cleanName, category: toolCategory, icon: toolIcon })
      : await createSkill({ name: cleanName, proficiency: 0 });
  } catch (error) {
    if (!/already exists\./i.test(String(error?.message || ""))) throw error;
    const concurrent = (await loadSkills()).find((item) => {
      if (item.recordType !== targetType) return false;
      const itemName = targetType === "tool" ? toolIdentityMatchKey(item.name) : normalizeName(item.name);
      return itemName === targetName;
    });
    if (concurrent) {
      if (concurrent.active === false) {
        throw new Error(`${targetType === "tool" ? "Tool" : "Skill"} “${concurrent.name}” already exists but is inactive. Activate it in Skills & Tools Used instead of creating a duplicate.`);
      }
      return { ...concurrent, created: false };
    }
    throw error;
  }

  const created = (await loadSkills()).find((item) => item.id === id);
  return created
    ? { ...created, created: true }
    : { id, recordType: targetType, name: cleanName, created: true };
}

export async function updateTool(toolId, rawData) {
  return updateCapability(toolId, { ...rawData, recordType: "tool" });
}

export async function syncToolSkillLinks(toolId, toolName, selectedSkillIds = [], previousToolName = "") {
  if (!toolId) throw new Error("Tool ID is required for Skill linking.");
  const nextName = cleanText(toolName);
  if (!nextName) throw new Error("Tool name is required for Skill linking.");

  const selected = new Set(commaSeparatedToArray(selectedSkillIds));
  const currentNameKey = normalizeName(nextName);
  const previousNameKey = normalizeName(previousToolName);
  const snapshot = await getDocs(skillsCollection);
  const batch = writeBatch(db);
  let changes = 0;

  for (const item of snapshot.docs) {
    let capability;
    try {
      capability = cleanSkillData(item.data() || {});
    } catch {
      continue;
    }
    if (capability.recordType !== "skill") continue;

    const currentIds = commaSeparatedToArray(capability.toolIds);
    const currentNames = commaSeparatedToArray(capability.tools);
    const linkedById = currentIds.includes(toolId);
    const linkedByName = currentNames.some((name) => {
      const key = normalizeName(name);
      return key === currentNameKey || (previousNameKey && key === previousNameKey);
    });
    const shouldLink = selected.has(item.id);

    let nextIds = currentIds.filter((id) => id !== toolId);
    let nextNames = currentNames.filter((name) => {
      const key = normalizeName(name);
      return key !== currentNameKey && (!previousNameKey || key !== previousNameKey);
    });

    if (shouldLink) {
      nextIds.push(toolId);
    }

    nextIds = [...new Set(nextIds)];
    const seenNames = new Set();
    nextNames = nextNames.filter((name) => {
      const key = normalizeName(name);
      if (!key || seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

    const idsChanged = JSON.stringify(currentIds) !== JSON.stringify(nextIds);
    const namesChanged = JSON.stringify(currentNames) !== JSON.stringify(nextNames);
    const membershipChanged = shouldLink !== (linkedById || linkedByName);
    if (!idsChanged && !namesChanged && !membershipChanged) continue;

    batch.update(item.ref, {
      toolIds: nextIds,
      tools: nextNames,
      updatedAt: serverTimestamp(),
    });
    changes += 1;
  }

  if (changes) await batch.commit();
}

export async function deleteTool(toolId) {
  if (!toolId) throw new Error("Capability ID is required.");
  const toolReference = doc(db, COLLECTION_NAME, toolId);
  const toolSnapshot = await getDoc(toolReference);
  const toolName = toolSnapshot.exists() ? cleanText(toolSnapshot.data()?.name) : "";
  const snapshot = await getDocs(skillsCollection);
  const batch = writeBatch(db);

  for (const item of snapshot.docs) {
    if (item.id === toolId) continue;
    let capability;
    try {
      capability = cleanSkillData(item.data() || {});
    } catch {
      continue;
    }
    if (capability.recordType !== "skill") continue;

    const nextIds = commaSeparatedToArray(capability.toolIds).filter((id) => id !== toolId);
    const nextNames = commaSeparatedToArray(capability.tools).filter((name) => normalizeName(name) !== normalizeName(toolName));
    if (nextIds.length !== capability.toolIds.length || nextNames.length !== capability.tools.length) {
      batch.update(item.ref, { toolIds: nextIds, tools: nextNames, updatedAt: serverTimestamp() });
    }
  }

  batch.delete(toolReference);
  await batch.commit();
}

export async function loadSkills() {
  const snapshot = await getDocs(skillsCollection);
  const normalized = [];

  for (const item of snapshot.docs) {
    try {
      normalized.push({ id: item.id, ...cleanSkillData(item.data() || {}) });
    } catch (error) {
      console.warn(`Skipping malformed Skill/Tool record ${item.id}:`, error);
    }
  }

  const toolsById = new Map(
    normalized
      .filter((item) => item.recordType === "tool")
      .map((tool) => [tool.id, tool])
  );

  const hydrated = normalized.map((item) => {
    if (item.recordType !== "skill") return item;
    const legacyNames = commaSeparatedToArray(item.tools);
    const referencedNames = commaSeparatedToArray(item.toolIds)
      .map((id) => toolsById.get(id)?.name)
      .filter(Boolean);
    const seen = new Set();
    const tools = [...legacyNames, ...referencedNames].filter((name) => {
      const key = normalizeName(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...item, tools };
  });

  return hydrated.sort((a, b) =>
    (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

export const SkillService = {
  getAll: loadSkills,
  create: createSkill,
  update: updateSkill,
  remove: deleteSkill,
  createTool,
  ensureCapabilityByName,
  updateTool,
  syncToolSkillLinks,
  removeTool: deleteTool,
};
