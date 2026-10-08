import { firebaseConfig, portfolioModuleRegistry } from "./config.js";
import { normalizePublicTagRefs, resolvePublicProjectCapabilities } from "./projectCapabilities.js";
import { normalizeSystemIconName, renderSystemIcon, resolveModuleAdminIcon } from "./icon-registry.js";
import { normalizeModuleDefinition, modulePublicEligibility, resolveModulePublicRecords, moduleSlug, resolveModuleFieldSemanticRole } from "./module-platform.js";
import { classifyPortfolioFile, resolvePortfolioFilePreview, buildMicrosoftOfficeEmbedUrl } from "./file-type-registry.js";
import { normalizeHours, formatHours } from "./hours-value.js";
import { resolveToolIconSource, resolveToolFallbackIcon } from "./tool-identity.js";
import { publicSectionEligibility } from "./public-section-eligibility.js";
import { resolvePublicLayoutPreset, resolvePublicOverflow, placementOrder, publicLayoutSpan, planPublicLayoutRows } from "./public-layout-contract.js";
import { initPublicAdaptiveMode, isPublicDocumentFlowMode } from "./public-adaptive.js";
import { resolveModuleRecordMedia, resolveModuleFieldAssetPresentation, resolvePortfolioAssetPresentation } from "./record-media.js";
import {
  clearVisitorConversationIdentity,
  createPrivateMessageChallenge,
  createPrivateVisitorThread,
  getPrivateVisitorThread,
  loadVisitorConversationIdentity,
  markPrivateVisitorThreadRead,
  forgetPrivateVisitorThread,
  sendPrivateVisitorMessage,
  storeVisitorConversationIdentity,
  verifyPrivateMessageChallenge,
  subscribePrivateVisitorThread
} from "./message-service.js";
import { disablePortfolioPushForThread, enablePortfolioPush, rehydratePortfolioPush } from "./notification-service.js";
import { bindMessageComposerKeyboard } from "./message-composer.js";

const app = document.querySelector("#app");
const icon = (name) => `<i data-lucide="${name}"></i>`;
const cleanText = (value = "") => String(value ?? "").trim();
const escapeHtml = (value = "") => {
  const node = document.createElement("div");
  node.textContent = cleanText(value);
  return node.innerHTML;
};
const tags = (items = []) => (Array.isArray(items) ? items : [])
  .filter(Boolean)
  .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
  .join("");
const mediaPresentation = (value, options = {}) => {
  if (!value) return resolvePortfolioAssetPresentation(null, options);
  return resolvePortfolioAssetPresentation(value, { public: true, ...options });
};
const mediaUrl = (value, options = {}) => cleanText(mediaPresentation(value, options).publicDisplayUrl);

function browserPdfViewerSource(source = "") {
  const value = cleanText(source);
  if (!value) return "";
  const [base] = value.split("#");
  return `${base}#view=FitH`;
}

const safeImageSource = (value = "") => {
  const source = cleanText(value);
  return /^(?:data:image\/|https?:\/\/|\.?\.?\/|\/)/i.test(source) ? source : "";
};


const looseList = (value = []) => {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(source.map((item) => cleanText(typeof item === "string" ? item : item?.name || item?.id)).filter(Boolean))];
};
const capabilityKey = (value = "") => cleanText(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const TOOL_NAME_ALIASES = new Map([
  ["firebase", "firebase and firestore"], ["firebase ready", "firebase and firestore"], ["firestore", "firebase and firestore"],
  ["photoshop", "adobe photoshop"], ["premiere pro", "adobe premiere pro"], ["3ds max", "autodesk 3ds max"],
  ["html", "html css and javascript"], ["css", "html css and javascript"], ["javascript", "html css and javascript"],
  ["js", "html css and javascript"], ["html css javascript", "html css and javascript"]
]);
function capabilityByLegacyName(name, type = "tool") {
  const rawKey = capabilityKey(name);
  const wanted = type === "tool" ? (TOOL_NAME_ALIASES.get(rawKey) || rawKey) : rawKey;
  const source = type === "tool" ? publicToolsById : publicSkillsById;
  return [...source.values()].find((record) => capabilityKey(record.name) === wanted) || null;
}

function publicToolIcon(tool = {}) {
  return resolveToolIconSource(tool);
}

function publicToolLogoMarkup(tool = {}) {
  const name = cleanText(tool?.name);
  const category = cleanText(tool?.category);
  const iconSource = publicToolIcon(tool);
  if (iconSource) return `<span class="project-tool-logo"><img src="${escapeHtml(iconSource)}" alt="" aria-hidden="true" loading="lazy"></span>`;
  return `<span class="project-tool-logo project-tool-logo--system">${renderSystemIcon(resolveToolFallbackIcon(name, category), { className: "project-tool-system-icon" })}</span>`;
}

function projectToolIds(project = {}) {
  return [...new Set(looseList(project.toolIds).map(cleanText).filter(Boolean))];
}

function projectPublicTools(project = {}) {
  const ids = projectToolIds(project);
  const resolved = ids.map((id) => publicToolsById.get(id)).filter(Boolean);
  if (ids.length) return uniqueCapabilities(resolved);
  const legacyNames = looseList(project.technologies || project.tools || project.toolsUsed);
  const matched = legacyNames.map((name) => capabilityByLegacyName(name, "tool")).filter(Boolean);
  const matchedNames = new Set(matched.map((item) => capabilityKey(item.name)));
  const unmatched = legacyNames
    .filter((name) => !matchedNames.has(capabilityKey(TOOL_NAME_ALIASES.get(capabilityKey(name)) || name)))
    .map((name) => ({ id: "", name, category: "", icon: "" }));
  return uniqueCapabilities([...resolved, ...matched, ...unmatched]);
}

function projectPublicSkills(project = {}) {
  const ids = [...new Set(looseList(project.skillIds).map(cleanText).filter(Boolean))];
  const resolved = ids.map((id) => publicSkillsById.get(id)).filter(Boolean);
  if (ids.length) return uniqueCapabilities(resolved);
  const legacyNames = looseList(project.skills || project.skillsUsed);
  const matched = legacyNames.map((name) => capabilityByLegacyName(name, "skill")).filter(Boolean);
  const matchedNames = new Set(matched.map((item) => capabilityKey(item.name)));
  const unmatched = legacyNames.filter((name) => !matchedNames.has(capabilityKey(name))).map((name) => ({ id: "", name, category: "" }));
  return uniqueCapabilities([...resolved, ...matched, ...unmatched]);
}

function uniqueCapabilities(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = capabilityKey(item?.name) || cleanText(item?.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectPublicTagRefs(project = {}) {
  return normalizePublicTagRefs(project.publicTagRefs, project.publicToolIds || []);
}

function projectCardCapabilities(project = {}, source = null, sourceToolNames = [], sourceSkillNames = []) {
  const normalizedSource = source?.data && typeof source.data === "object" ? { ...source, ...source.data } : source;
  const tools = normalizedSource
    ? sourcePublicTools(normalizedSource, sourceToolNames)
    : projectPublicTools(project);
  const skills = normalizedSource
    ? sourcePublicSkills(normalizedSource, sourceSkillNames.length ? sourceSkillNames : firstNonEmptyArray(normalizedSource.skills, normalizedSource.skillsUsed, normalizedSource.techniques))
    : projectPublicSkills(project);
  return resolvePublicProjectCapabilities({
    tools,
    skills,
    mode: project.publicTagMode || project.publicToolMode || "automatic",
    refs: projectPublicTagRefs(project)
  });
}

function sourcePublicTools(source = {}, legacyNames = []) {
  const ids = [...new Set(looseList(source.toolIds).map(cleanText).filter(Boolean))];
  const resolved = ids.map((id) => publicToolsById.get(id)).filter(Boolean);
  if (ids.length) return uniqueCapabilities(resolved);
  const names = looseList(legacyNames);
  const matched = names.map((name) => capabilityByLegacyName(name, "tool")).filter(Boolean);
  const matchedNames = new Set(matched.map((item) => capabilityKey(item.name)));
  const unmatched = names
    .filter((name) => !matchedNames.has(capabilityKey(TOOL_NAME_ALIASES.get(capabilityKey(name)) || name)))
    .map((name) => ({ id: "", name, category: "", icon: "" }));
  return uniqueCapabilities([...resolved, ...matched, ...unmatched]);
}

function sourcePublicSkills(source = {}, legacyNames = []) {
  const ids = [...new Set(looseList(source.skillIds).map(cleanText).filter(Boolean))];
  const resolved = ids.map((id) => publicSkillsById.get(id)).filter(Boolean);
  if (ids.length) return uniqueCapabilities(resolved);
  const names = looseList(legacyNames);
  const matched = names.map((name) => capabilityByLegacyName(name, "skill")).filter(Boolean);
  const matchedNames = new Set(matched.map((item) => capabilityKey(item.name)));
  const unmatched = names.filter((name) => !matchedNames.has(capabilityKey(name))).map((name) => ({ id: "", name, category: "" }));
  return uniqueCapabilities([...resolved, ...matched, ...unmatched]);
}

function photoEditingModuleCapabilityGroups() {
  const records = [...(sourceMaps.get("photo-editing")?.values() || [])]
    .filter(isPublicRecord)
    .filter((record) => !isPhotoEditingPortfolioGateway(record));
  const toolIds = [...new Set(records.flatMap((record) => looseList(record.toolIds)))];
  const skillIds = [...new Set(records.flatMap((record) => looseList(record.skillIds)))];
  const resolvedTools = toolIds.map((id) => publicToolsById.get(id)).filter(Boolean);
  const resolvedSkills = skillIds.map((id) => publicSkillsById.get(id)).filter(Boolean);
  return {
    tools: uniqueCapabilities(resolvedTools),
    skills: uniqueCapabilities(resolvedSkills)
  };
}

function firstNonEmptyArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || [];
}

function isLinkedProjectRecord(project = {}) {
  const explicitType = cleanText(project.projectType);
  if (explicitType === "linked-module") return true;
  if (explicitType === "standalone") return false;
  return Boolean(project.linkedModuleKey || project.linkedCollection || project.linkedDocumentId || project.linkedModule);
}

function linkedSourceForProject(project = {}) {
  const module = getRegistryModuleForProject(project);
  const documentId = cleanText(project.linkedDocumentId);
  if (!module || !documentId) return null;
  return sourceMaps.get(module.key)?.get(documentId) || null;
}

function projectToolTagsMarkup(items = []) {
  return (Array.isArray(items) ? items : []).map((tool) => {
    const name = cleanText(typeof tool === "string" ? tool : tool?.name);
    if (!name) return "";
    const identityMarkup = typeof tool === "object" ? publicToolLogoMarkup(tool) : "";
    return `<span class="tag project-tool-tag">${identityMarkup}<span>${escapeHtml(name)}</span></span>`;
  }).join("");
}

function projectCapabilityTagsMarkup(capabilities = [], adaptive = false) {
  const markup = (Array.isArray(capabilities) ? capabilities : []).map((capability) => {
    const type = capability?.type === "tool" ? "tool" : "skill";
    const item = capability?.item || capability;
    const name = cleanText(typeof item === "string" ? item : item?.name);
    if (!name) return "";
    if (type === "tool") {
      const identityMarkup = typeof item === "object" ? publicToolLogoMarkup(item) : "";
      return `<span class="tag project-capability-tag project-tool-tag" data-capability-type="tool" data-public-budget-item>${identityMarkup}<span>${escapeHtml(name)}</span></span>`;
    }
    return `<span class="tag project-capability-tag project-skill-tag" data-capability-type="skill" data-public-budget-item>${escapeHtml(name)}</span>`;
  }).join("");
  return adaptive ? `${markup}<button class="tag project-capability-more public-budget-more" type="button" data-public-budget-more hidden></button>` : markup;
}

const emptyContent = () => ({
  site: { name: "", brand: "LΛN", email: "", phone: "", location: "", github: "", linkedin: "", facebook: "" },
  hero: { eyebrow: "", name: "", roles: [], intro: "", image: "", imageAlt: "Portfolio portrait" },
  about: { image: "", imageAlt: "About portrait", text: "", shortText: "" },
  contact: { heading: "Let's Work Together", message: "", availability: "" },
  home: { sections: [] },
  certificates: [],
  resumes: [],
  education: []
});

let content = emptyContent();
let activeFilter = "All";
let firebase = null;
let resolvedProjects = [];
let publicExperiences = [];
let publicPhotoProjects = [];
let publicSkillsById = new Map();
let publicToolsById = new Map();
let publicFeatureSections = [];
let publicServices = null;
let dynamicPortfolioModuleRegistry = [];
let sourceMaps = new Map();
const loadedPublicCollections = new Set();
let publicDataMode = "firestore";

const PUBLIC_SYNC_STORAGE_KEY = "lan.portfolio.contentChanged";
const PUBLIC_SYNC_CHANNEL = "lan-portfolio-sync";
let publicSyncInstalled = false;
let publicSyncChannel = null;
let publicRefreshTimer = 0;
let publicRefreshInFlight = false;

const formatDateRange = (experience) => {
  const month = (value) => {
    if (!value) return "";
    const [year, monthNumber] = cleanText(value).split("-").map(Number);
    if (!year || !monthNumber) return cleanText(value);
    return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
  };
  const start = month(experience.startDate);
  const end = experience.isCurrent ? "Present" : month(experience.endDate);
  return [start, end].filter(Boolean).join(" – ");
};

const isPublicRecord = (record = {}) => {
  const status = cleanText(record.status).toLowerCase();
  const statusAllowsPublic = !status || status === "published";
  return statusAllowsPublic
    && record.visible !== false
    && record.isDeleted !== true
    && !record.deletedAt
    && record.archived !== true
    && !record.archivedAt;
};

// Projects use a canonical publication contract. Current Project records are
// physically deleted by the Admin service, so legacy soft-delete/archive
// fields must not override an explicit modern Project state. This keeps old
// records recoverable after switching Linked ↔ Standalone while preserving
// the generic legacy rules for records that predate the canonical fields.
const isPublicProjectRecord = (record = {}) => {
  const status = cleanText(record.status).toLowerCase();
  const projectType = cleanText(record.projectType);
  const hasCanonicalState =
    (projectType === "standalone" || projectType === "linked-module")
    && (status === "published" || status === "draft")
    && typeof record.visible === "boolean";

  if (hasCanonicalState) {
    return status === "published" && record.visible === true;
  }

  return isPublicRecord(record);
};

const getRegistryModule = (identity = "") => {
  const wanted = cleanText(identity);
  return [...portfolioModuleRegistry, ...dynamicPortfolioModuleRegistry].find((item) => item.active && (item.key === wanted || cleanText(item.moduleId) === wanted)) || null;
};
const getRegistryModuleForProject = (project = {}) => {
  const direct = getRegistryModule(project.linkedModuleId || project.linkedModuleKey || project.linkedModule);
  if (direct) return direct;
  const collectionName = cleanText(project.linkedCollection);
  return [...portfolioModuleRegistry, ...dynamicPortfolioModuleRegistry].find((item) => item.active && item.collection === collectionName && (!item.sectionKey || item.sectionKey === cleanText(project.linkedSectionKey || project.linkedModuleKey))) || null;
};


function defaultPublicModuleCta(module = {}) {
  const configured = cleanText(module.defaultButtonLabel || module.buttonLabel);
  const key = cleanText(module.key).toLowerCase();
  const label = cleanText(module.label || module.title).toLowerCase();
  if (configured && configured !== "View Details") return configured;
  if (key === "experience" || label === "experience") return "View Experience";
  if (key === "photo-editing" || label.includes("photo editing")) return "View Portfolio";
  if (key === "projects" || label === "projects" || label === "project") return "View Project";
  if (key === "certificates" || label.includes("certificate")) return "View Certificate";
  if (key === "resume" || label.includes("resume")) return "View Resume";
  return configured || "View Details";
}

function linkedProjectPrimaryLabel(project = {}, module = {}) {
  const saved = cleanText(project.buttonLabel);
  const semantic = defaultPublicModuleCta(module);
  if (!saved) return semantic;
  if (saved.toLowerCase() === "view details" && semantic.toLowerCase() !== "view details") return semantic;
  if (saved.toLowerCase() === "view gallery" && semantic === "View Portfolio") return semantic;
  return saved;
}

function firstModuleField(fields = [], predicate = () => false, preferredKeys = []) {
  for (const key of preferredKeys) {
    const preferred = fields.find((field) => cleanText(field.key).toLowerCase() === key.toLowerCase());
    if (preferred) return preferred.key;
  }
  return fields.find(predicate)?.key || "";
}

function normalizePublicModuleSection(section = {}) {
  const module = normalizeModuleDefinition(section);
  const fields = module.fields;
  const display = module.display || {};
  const titleField = cleanText(display.titleField) || firstModuleField(fields, (field) => ["text", "textarea", "rich-text"].includes(field.type), ["title", "name"]);
  const summaryField = cleanText(display.summaryField) || firstModuleField(fields, (field) => ["textarea", "rich-text", "text"].includes(field.type), ["shortSummary", "short_summary", "summary", "description"]);
  const imageField = cleanText(display.imageField) || firstModuleField(fields, (field) => ["image", "images", "gallery"].includes(field.type), ["thumbnail", "coverImage", "cover_image", "image"]);
  const categoryField = cleanText(display.categoryField) || firstModuleField(fields, (field) => field.type === "category" || cleanText(field.key).toLowerCase() === "category", ["category"]);
  const tagsField = cleanText(display.tagsField) || firstModuleField(fields, (field) => field.type === "tags", ["tags"]);
  return {
    ...section,
    ...module,
    id: cleanText(section.id || module.id),
    key: module.key,
    title: module.title || module.key,
    slug: module.slug || module.key,
    fields,
    relationships: module.relationships,
    display: {
      ...display,
      titleField,
      summaryField,
      imageField,
      categoryField,
      tagsField
    }
  };
}

function publicSectionModule(section = {}) {
  const eligibility = modulePublicEligibility(section, section.records || []);
  return {
    moduleId: cleanText(section.id),
    key: section.key,
    label: section.title,
    collection: "portfolioSectionEntries",
    sectionKey: section.key,
    publicDestination: `#${section.slug || section.key}`,
    defaultButtonLabel: "View Details",
    active: section.projectLinking?.enabled === true,
    dynamic: true,
    linkScope: section.projectLinking?.scope || "module",
    publicAvailable: homeSectionRegistered(section.key) && eligibility.section,
    definition: section
  };
}

function normalizeHome(raw = {}) {
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  return {
    ...raw,
    eyebrow: cleanText(raw.eyebrow || "Hello, I'm"),
    displayName: cleanText(raw.displayName || raw.name),
    brand: cleanText(raw.brand || "LΛN"),
    headline: cleanText(raw.headline || raw.professionalHeadline),
    roles: Array.isArray(raw.roles) ? raw.roles.map(cleanText).filter(Boolean) : [],
    introduction: cleanText(raw.introduction || raw.intro),
    portrait: mediaUrl(raw.portrait || raw.image),
    portraitAlt: cleanText(raw.portraitAlt || raw.imageAlt || "Portfolio portrait"),
    primaryCtaLabel: cleanText(raw.primaryCtaLabel || "View My Work"),
    primaryCtaDestination: cleanText(raw.primaryCtaDestination || "#projects"),
    secondaryCtaLabel: cleanText(raw.secondaryCtaLabel || "View Resumes"),
    secondaryCtaDestination: cleanText(raw.secondaryCtaDestination || "#resumes"),
    aboutImage: mediaUrl(raw.aboutImage || raw.homeAboutImage),
    aboutImageAlt: cleanText(raw.aboutImageAlt || raw.homeAboutImageAlt || "About portrait"),
    sections
  };
}

function normalizeProfile(raw = {}) {
  return {
    ...raw,
    fullName: cleanText(raw.fullName || raw.displayName),
    displayName: cleanText(raw.displayName),
    professionalTitle: cleanText(raw.professionalTitle),
    location: cleanText(raw.location),
    availability: cleanText(raw.availability),
    shortIntroduction: cleanText(raw.shortIntroduction),
    aboutDescription: cleanText(raw.aboutDescription || raw.biography),
    featuredRoles: Array.isArray(raw.featuredRoles) ? raw.featuredRoles.map(cleanText).filter(Boolean) : [],
    sectionVisible: raw.sectionVisible !== false
  };
}

function normalizeServices(raw = {}) {
  const services = (Array.isArray(raw.services) ? raw.services : []).map((item, index) => ({
    id: cleanText(item?.id || `service-${index + 1}`),
    title: cleanText(item?.title || item?.name),
    description: cleanText(item?.description),
    icon: normalizeSystemIconName(item?.icon || "sparkles"),
    visible: item?.visible !== false,
    displayOrder: Number(item?.displayOrder) || ((index + 1) * 10)
  })).filter((item) => item.title && item.visible).sort((a, b) => a.displayOrder - b.displayOrder);
  const availability = (Array.isArray(raw.availability) ? raw.availability : []).map((item, index) => ({
    id: cleanText(item?.id || `availability-${index + 1}`),
    label: cleanText(item?.label || item?.title),
    enabled: item?.enabled !== false,
    displayOrder: Number(item?.displayOrder) || ((index + 1) * 10)
  })).filter((item) => item.label && item.enabled).sort((a, b) => a.displayOrder - b.displayOrder);
  const contact = raw.contact && typeof raw.contact === "object" ? raw.contact : {};
  return {
    heading: cleanText(raw.heading || raw.title || "Work With Me"),
    intro: cleanText(raw.intro || raw.description),
    ctaLabel: cleanText(raw.ctaLabel || "Work With Me"),
    status: cleanText(raw.status).toLowerCase() === "published" ? "published" : "draft",
    visible: raw.visible !== false,
    services,
    availability,
    contact: {
      emailEnabled: contact.emailEnabled !== false,
      emailLabel: cleanText(contact.emailLabel || "Email Me"),
      email: cleanText(contact.email),
      linkedinEnabled: contact.linkedinEnabled !== false,
      linkedinLabel: cleanText(contact.linkedinLabel || "LinkedIn"),
      linkedinUrl: cleanText(contact.linkedinUrl),
      copyEmailEnabled: contact.copyEmailEnabled !== false,
      copyEmailLabel: cleanText(contact.copyEmailLabel || "Copy Email")
    },
    emailSubject: cleanText(raw.emailSubject || "Work Opportunity for Rolando Lagmay Jr."),
    emailTemplate: String(raw.emailTemplate || "").trim()
  };
}

function normalizeContact(raw = {}) {
  const methods = (Array.isArray(raw.methods) ? raw.methods : []).map((method) => ({
    type: cleanText(method?.type).toLowerCase(),
    label: cleanText(method?.label || method?.type || "Contact"),
    value: cleanText(method?.value || method?.url),
    visible: method?.visible !== false,
    displayOrder: Number(method?.displayOrder) || 0
  })).filter((method) => method.value && method.visible !== false).sort((a,b) => a.displayOrder - b.displayOrder);
  return {
    ...raw,
    heading: cleanText(raw.heading || "Let's Work Together"),
    message: cleanText(raw.message),
    email: cleanText(raw.email),
    phone: cleanText(raw.phone),
    location: cleanText(raw.location),
    github: cleanText(raw.github),
    linkedin: cleanText(raw.linkedin),
    facebook: cleanText(raw.facebook),
    availability: cleanText(raw.availability),
    methods
  };
}

function contactMethodHref(method = {}) {
  const raw = cleanText(method.value);
  if (!raw) return "";
  const type = cleanText(method.type).toLowerCase();
  if (type === "phone") return `tel:${raw.replace(/\s+/g, "")}`;
  if (type === "email-alt") return `mailto:${raw}`;
  if (/^(?:https?:|mailto:|tel:)/i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "").trim();
  if (type === "whatsapp" && /^[+\d][\d\s().-]+$/.test(raw)) return `https://wa.me/${raw.replace(/\D/g, "")}`;
  if (type === "messenger" && handle && !raw.includes(" ")) return `https://m.me/${encodeURIComponent(handle)}`;
  if (type === "telegram" && handle && !raw.includes(" ")) return `https://t.me/${encodeURIComponent(handle)}`;
  if (type === "instagram" && handle && !raw.includes(" ")) return `https://instagram.com/${encodeURIComponent(handle)}`;
  if (type === "twitter" && handle && !raw.includes(" ")) return `https://x.com/${encodeURIComponent(handle)}`;
  return raw.includes(".") ? `https://${raw}` : "";
}

function publicCompanyName(record = {}) {
  const company = cleanText(record.company || record.organization);
  const rawMode = cleanText(record.publicCompanyDisplay || record.companyDisplayMode || record.companyPrivacy || "full").toLowerCase();
  const mode = rawMode === "hide" ? "hidden"
    : rawMode === "private company" ? "private"
      : rawMode === "mask" ? "masked"
        : rawMode === "show" || rawMode === "show full name" ? "full"
          : rawMode;
  if (!company || mode === "hidden") return "";
  if (mode === "private") return "Private Company";
  if (mode === "masked") {
    const first = [...company][0] || "";
    const remaining = Math.max(3, Math.min(8, [...company].length - 1));
    return `${first}${"•".repeat(remaining)}`;
  }
  return company;
}

function normalizeExperience(record) {
  const resolvedSkills = sourcePublicSkills(record, firstNonEmptyArray(record.skills, record.skillsUsed)).map((skill) => skill.name);
  const resolvedTools = sourcePublicTools(record, firstNonEmptyArray(record.tools, record.toolsUsed, record.technologies)).map((tool) => tool.name);
  return {
    ...record,
    role: cleanText(record.jobTitle || record.role || record.position || record.title),
    company: publicCompanyName(record),
    details: cleanText(record.summary || record.shortDescription || record.description),
    date: cleanText(record.date || record.legacyDate) || formatDateRange(record),
    tags: [...new Set([...resolvedSkills, ...resolvedTools].filter(Boolean))],
    workSetup: cleanText(record.workSetup || record.workArrangement),
    location: cleanText(record.location),
    cover: mediaUrl(record.coverImage || record.coverImageUrl || record.image || record.imageUrl || record.thumbnail || record.primaryImage || record.companyLogo)
  };
}

function educationMonthYear(month = "", year = "") {
  const labels = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthNumber = Number(month);
  const monthLabel = Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12 ? labels[monthNumber] : "";
  return [monthLabel, cleanText(year)].filter(Boolean).join(" ");
}

function normalizeEducation(record = {}) {
  const start = educationMonthYear(record.startMonth, record.startYear);
  const end = record.currentlyStudying ? "Present" : educationMonthYear(record.endMonth, record.endYear);
  return {
    ...record,
    schoolName: cleanText(record.schoolName),
    degreeName: cleanText(record.degreeName),
    degreeShortName: cleanText(record.degreeShortName || record.degreeAbbreviation || record.degreeAcronym || record.shortDegreeName),
    majorName: cleanText(record.majorName),
    educationLevel: cleanText(record.educationLevel),
    educationLevelOther: cleanText(record.educationLevelOther),
    location: cleanText(record.educationLocation || record.location),
    schoolWebsite: cleanText(record.schoolWebsite),
    schoolLogoUrl: mediaUrl(record.schoolLogoUrl),
    summary: cleanText(record.educationSummary || record.summary),
    achievements: Array.isArray(record.achievements) ? record.achievements.map(cleanText).filter(Boolean) : [],
    date: [start, end].filter(Boolean).join(" – "),
    displayOrder: Number(record.displayOrder ?? record.educationDisplayOrder) || 0
  };
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

function dedupePublicEducationRecords(records = []) {
  const chosen = new Map();
  const score = (record = {}) =>
    (isPublicRecord(record) ? 8 : 0) +
    ((record.featured === true || record.featuredEducation === true) ? 4 : 0) +
    (cleanText(record.schoolLogoUrl) ? 2 : 0) +
    (cleanText(record.educationSummary || record.summary) ? 1 : 0);
  const timestamp = (record = {}) => Date.parse(record.updatedAt || record.createdAt || 0) || 0;

  for (const record of records) {
    const key = educationSemanticKey(record);
    if (!key.replace(/\|/g, "")) {
      chosen.set(`id:${record.id || Math.random()}`, record);
      continue;
    }
    const current = chosen.get(key);
    if (!current || score(record) > score(current) || (score(record) === score(current) && timestamp(record) > timestamp(current))) {
      chosen.set(key, record);
    }
  }
  return [...chosen.values()];
}

function normalizeCertificate(record = {}) {
  return {
    ...record,
    title: cleanText(record.title),
    issuer: cleanText(record.issuer),
    year: cleanText(record.year || record.issueDate),
    trainingHours: normalizeHours(record.trainingHours ?? record.contactHours ?? record.hours),
    credentialUrl: cleanText(record.credentialUrl),
    displayOrder: Number(record.displayOrder) || 0
  };
}

function normalizeResume(record = {}) {
  return {
    ...record,
    title: cleanText(record.title),
    category: cleanText(record.category),
    description: cleanText(record.description),
    file: mediaUrl(record.uploadedAsset || record.pdfAsset) || cleanText(record.pdfUrl || record.fileUrl || record.file || record.externalUrl),
    displayOrder: Number(record.displayOrder) || 0
  };
}

function photoPrimaryAsset(record = {}) {
  const gallery = Array.isArray(record.galleryImages) ? record.galleryImages : [];
  const explicitCover = record.coverImage
    || cleanText(record.coverImageUrl)
    || record.image
    || cleanText(record.imageUrl)
    || record.thumbnail
    || record.primaryImage;
  if (explicitCover) return explicitCover;
  const finalImage = record.afterImage
    || cleanText(record.afterImageUrl)
    || record.singleImage
    || cleanText(record.singleImageUrl)
    || record.image
    || cleanText(record.imageUrl);
  const galleryCover = gallery[0] || null;
  const displayType = cleanText(record.projectDisplayType || record.displayType).toLowerCase();
  return displayType === "gallery" ? (galleryCover || finalImage || null) : (finalImage || galleryCover || null);
}

function isPhotoEditingPortfolioGateway(record = {}) {
  if (record?.isPortfolioGateway === true || record?.showInPublicGallery === false) return true;
  const category = capabilityKey(record?.category || record?.projectCategory || record?.type);
  const title = capabilityKey(record?.title || record?.projectTitle || record?.name);
  return category === "photo editing" && (title === "photo editing portfolio" || title === "photo editing");
}

function normalizePhotoProject(record) {
  const resolvedTools = sourcePublicTools(record, record.software || []).map((tool) => tool.name);
  return {
    ...record,
    title: cleanText(record.title),
    description: cleanText(record.shortDescription || record.description),
    category: (() => {
      const stored = cleanText(record.category || record.projectCategory || "Uncategorized");
      return stored.toLowerCase() === "other" && cleanText(record.customCategory) ? cleanText(record.customCategory) : stored;
    })(),
    displayType: cleanText(record.projectDisplayType || record.displayType || "single"),
    coverAsset: photoPrimaryAsset(record),
    tags: [...new Set([...resolvedTools, ...(record.techniques || [])].filter(Boolean))]
  };
}


function publicAvailabilityLabel(value = "") {
  const key = cleanText(value).toLowerCase();
  const labels = {
    available: "Available for work",
    "part-time": "Available for part-time work",
    "full-time": "Available for full-time work",
    freelance: "Available for freelance projects",
    unavailable: "Currently unavailable"
  };
  return labels[key] || cleanText(value);
}

function applySingletonContent(homeRaw = {}, profileRaw = {}, contactRaw = {}) {
  const home = normalizeHome(homeRaw);
  const profile = normalizeProfile(profileRaw);
  const contact = normalizeContact(contactRaw);
  const profileAvailable = Boolean(profileRaw && Object.keys(profileRaw).length);
  content = {
    ...emptyContent(),
    home,
    profile,
    contact: {
      ...contact,
      availability: profile.showAvailability === false ? "" : publicAvailabilityLabel(profile.availability)
    },
    site: {
      name: profile.fullName || home.displayName,
      brand: home.brand || "LΛN",
      email: contact.email,
      phone: contact.phone,
      location: profile.location,
      github: contact.github,
      linkedin: contact.linkedin,
      facebook: contact.facebook,
      contactMethods: contact.methods || []
    },
    hero: {
      eyebrow: home.eyebrow,
      name: home.displayName || profile.fullName,
      roles: home.roles.length ? home.roles : (profile.featuredRoles || []),
      intro: home.introduction || profile.shortIntroduction,
      image: home.portrait,
      imageAlt: home.portraitAlt
    },
    about: {
      visible: profileAvailable && profile.sectionVisible !== false,
      image: home.aboutImage || home.portrait,
      imageAlt: home.aboutImageAlt,
      text: profile.aboutDescription,
      shortText: profile.shortIntroduction
    }
  };
}

async function loadPublicSingleton(documentId) {
  const snapshot = await firebase.getDoc(firebase.doc(firebase.db, "portfolio", documentId));
  if (!snapshot.exists()) return {};
  const value = snapshot.data() || {};
  return isPublicRecord(value) ? value : {};
}

async function loadPublicCollection(name) {
  const reference = firebase.collection(firebase.db, name);
  const canonicalQuery = firebase.query(
    reference,
    firebase.where("status", "==", "published"),
    firebase.where("visible", "==", true)
  );
  let snapshot = await firebase.getDocs(canonicalQuery);

  // Transitional compatibility for legacy Education records.
  if (snapshot.empty && name === "education") {
    snapshot = await firebase.getDocs(firebase.query(
      reference,
      firebase.where("educationStatus", "==", "published"),
      firebase.where("educationVisible", "==", true)
    ));
  }

  return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() || {}) }));
}

async function loadPublicCapabilities(projects = [], capabilitySources = []) {
  const skillIds = new Set();
  const toolIds = new Set();

  projects.forEach((project) => {
    looseList(project.skillIds).forEach((id) => skillIds.add(id));
    projectToolIds(project).forEach((id) => toolIds.add(id));
    projectPublicTagRefs(project).forEach((ref) => (ref.type === "skill" ? skillIds : toolIds).add(ref.id));
    const source = linkedSourceForProject(project);
    looseList(source?.skillIds).forEach((id) => skillIds.add(id));
    looseList(source?.toolIds).forEach((id) => toolIds.add(id));
  });
  capabilitySources.forEach((source) => {
    looseList(source?.skillIds).forEach((id) => skillIds.add(id));
    looseList(source?.toolIds).forEach((id) => toolIds.add(id));
  });

  publicSkillsById = new Map();
  publicToolsById = new Map();
  const capabilityCollection = firebase.collection(firebase.db, "skills");
  const snapshots = await Promise.allSettled([
    firebase.getDocs(firebase.query(capabilityCollection, firebase.where("status", "==", "published"), firebase.where("visible", "==", true))),
    firebase.getDocs(firebase.query(capabilityCollection, firebase.where("active", "==", true)))
  ]);
  snapshots.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.docs.forEach((item) => {
      const data = item.data() || {};
      if (data.active === false || data.visible === false) return;
      const recordType = cleanText(data.recordType || data.capabilityType).toLowerCase() === "tool" ? "tool" : "skill";
      const record = { id: item.id, ...data, name: cleanText(data.name), icon: cleanText(data.icon), category: cleanText(data.category) };
      if (!record.name) return;
      (recordType === "tool" ? publicToolsById : publicSkillsById).set(record.id, record);
    });
  });

  const missing = [
    ...[...skillIds].filter((id) => !publicSkillsById.has(id)).map((id) => ({ id, type: "skill" })),
    ...[...toolIds].filter((id) => !publicToolsById.has(id)).map((id) => ({ id, type: "tool" }))
  ];
  const results = await Promise.allSettled(missing.map(async (reference) => {
    const snapshot = await firebase.getDoc(firebase.doc(firebase.db, "skills", reference.id));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() || {};
    if (data.active === false || data.visible === false) return null;
    const storedType = cleanText(data.recordType || data.capabilityType).toLowerCase();
    if (storedType && storedType !== reference.type) return null;
    return { type: reference.type, record: { id: snapshot.id, ...data, name: cleanText(data.name), icon: cleanText(data.icon), category: cleanText(data.category) } };
  }));
  results.forEach((result) => {
    if (result.status !== "fulfilled" || !result.value?.record?.id || !result.value?.record?.name) return;
    (result.value.type === "tool" ? publicToolsById : publicSkillsById).set(result.value.record.id, result.value.record);
  });
}

async function initFirebase() {
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) return false;
  try {
    const [appModule, firestoreModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js")
    ]);
    const firebaseApp = appModule.initializeApp(firebaseConfig);
    firebase = {
      db: firestoreModule.getFirestore(firebaseApp),
      doc: firestoreModule.doc,
      getDoc: firestoreModule.getDoc,
      collection: firestoreModule.collection,
      getDocs: firestoreModule.getDocs,
      query: firestoreModule.query,
      where: firestoreModule.where,
      addDoc: firestoreModule.addDoc,
      serverTimestamp: firestoreModule.serverTimestamp
    };
    await loadPublicPortfolioData();
    publicDataMode = "firestore";
    return true;
  } catch (error) {
    console.error("Public Firestore startup failed.", error);
    return false;
  }
}

async function loadPublicPortfolioData() {
  loadedPublicCollections.clear();
  sourceMaps.clear();
  dynamicPortfolioModuleRegistry = [];
  publicFeatureSections = [];
  publicServices = null;

  const [homeResult, profileResult, contactResult, servicesResult] = await Promise.allSettled([
    loadPublicSingleton("home"),
    loadPublicSingleton("profile"),
    loadPublicSingleton("contact"),
    loadPublicSingleton("services")
  ]);

  const home = homeResult.status === "fulfilled" ? homeResult.value : {};
  const profile = profileResult.status === "fulfilled" ? profileResult.value : {};
  const contact = contactResult.status === "fulfilled" ? contactResult.value : {};
  const services = servicesResult.status === "fulfilled" ? servicesResult.value : {};
  publicServices = Object.keys(services).length ? normalizeServices(services) : null;
  [homeResult, profileResult, contactResult, servicesResult].forEach((result) => {
    if (result.status === "rejected") console.warn("A public singleton could not be loaded.", result.reason);
  });
  applySingletonContent(home, profile, contact);

  const registry = portfolioModuleRegistry.filter((module) => module.active);
  const collectionNames = [...new Set([
    "experiences",
    "projects",
    "photoEditingProjects",
    "education",
    "certificates",
    "resumes",
    "portfolioSections",
    "portfolioSectionEntries",
    ...registry.map((module) => module.collection)
  ])];

  const results = await Promise.allSettled(collectionNames.map(async (name) => [name, await loadPublicCollection(name)]));
  const loaded = new Map();
  for (const result of results) {
    if (result.status === "fulfilled") {
      loaded.set(result.value[0], result.value[1]);
      loadedPublicCollections.add(result.value[0]);
    } else {
      console.warn("Unable to load a public portfolio collection.", result.reason);
    }
  }

  const featureEntries = (loaded.get("portfolioSectionEntries") || []).filter(isPublicRecord);
  const featureSections = (loaded.get("portfolioSections") || [])
    .map(normalizePublicModuleSection)
    .map((section) => ({
      ...section,
      records: resolveModulePublicRecords(section, featureEntries)
        .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0))
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title));

  publicFeatureSections = featureSections.filter((section) => homeSectionRegistered(section.key) && modulePublicEligibility(section, section.records).section);
  dynamicPortfolioModuleRegistry = featureSections.map(publicSectionModule).filter((module) => module.active);

  for (const module of [...registry, ...dynamicPortfolioModuleRegistry]) {
    const records = module.dynamic
      ? resolveModulePublicRecords(module.definition || { key: module.sectionKey }, featureEntries)
      : (loaded.get(module.collection) || []);
    sourceMaps.set(module.key, new Map(records.map((record) => [record.id, record])));
  }

  const rawPublicExperiences = (loaded.get("experiences") || []).filter(isPublicRecord);
  const rawPublicPhotoProjects = (loaded.get("photoEditingProjects") || []).filter(isPublicRecord)
    .filter((record) => !isPhotoEditingPortfolioGateway(record));

  content.education = dedupePublicEducationRecords((loaded.get("education") || []).filter(isPublicRecord))
    .map(normalizeEducation)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  content.certificates = (loaded.get("certificates") || []).filter(isPublicRecord).map(normalizeCertificate)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  content.resumes = (loaded.get("resumes") || []).filter(isPublicRecord).map(normalizeResume)
    .filter((record) => record.file)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const projects = (loaded.get("projects") || []).filter(isPublicProjectRecord)
    .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));
  await loadPublicCapabilities(projects, [...rawPublicExperiences, ...rawPublicPhotoProjects, ...featureEntries]);
  publicExperiences = rawPublicExperiences.map(normalizeExperience)
    .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));
  publicPhotoProjects = rawPublicPhotoProjects.map(normalizePhotoProject)
    .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));
  resolvedProjects = projects.map((project) => (
    isLinkedProjectRecord(project)
      ? resolveLinkedProject(project)
      : normalizeStandaloneProject(project)
  )).filter(Boolean);
}

async function loadEmergencyFallback(reason) {
  console.warn("Using bundled portfolio recovery data because Firestore startup failed.", reason || "unknown error");
  const { loadLegacyFallbackContent } = await import("./legacyFallbackLoader.js");
  const fallback = await loadLegacyFallbackContent();
  const base = emptyContent();
  content = {
    ...base,
    ...fallback,
    site: { ...base.site, ...(fallback.site || {}) },
    hero: { ...base.hero, ...(fallback.hero || {}) },
    about: { ...base.about, ...(fallback.about || {}) },
    contact: { ...base.contact },
    home: { ...base.home },
    education: Array.isArray(fallback.education) ? fallback.education : [],
    certificates: Array.isArray(fallback.certificates) ? fallback.certificates : [],
    resumes: Array.isArray(fallback.resumes) ? fallback.resumes : []
  };
  publicDataMode = "emergency-fallback";
  loadedPublicCollections.clear();
  resolvedProjects = [];
  publicExperiences = [];
  publicPhotoProjects = [];
  publicSkillsById = new Map();
  publicToolsById = new Map();
  publicFeatureSections = [];
  publicServices = null;
  dynamicPortfolioModuleRegistry = [];
}

function normalizeProjectButtonLabel(value) {
  const label = cleanText(value);
  return label.toLowerCase() === "live demo" ? "Watch Video" : label;
}

function canonicalStandaloneActionType(project = {}) {
  const allowed = new Set([
    "project-preview", "github", "live-site", "uploaded-mp4",
    "external-video", "pdf", "source-file", "internal-section", "custom-url"
  ]);
  const label = normalizeProjectButtonLabel(project.buttonLabel).toLowerCase();
  if (label === "view project" || label === "view details") return "project-preview";
  if (["watch demo", "watch video", "watch animation"].includes(label)) return "uploaded-mp4";
  if (label === "open live website") return "live-site";
  if (["view pdf", "open pdf"].includes(label)) return "pdf";
  if (["download", "download source"].includes(label)) return "source-file";
  if (label === "github") return "github";
  const configured = cleanText(project.actionType || "project-preview");
  return allowed.has(configured) ? configured : "project-preview";
}

function resolveStandalonePrimaryAction(project = {}) {
  const type = canonicalStandaloneActionType(project);
  const demoUrl = mediaUrl(project.demoVideo || project.video);
  const externalVideoUrl = cleanText(project.externalVideo?.embedUrl || mediaUrl(project.externalVideo) || project.externalVideoUrl || project.youtubeUrl);
  const pdfUrl = mediaUrl(project.pdfAsset || project.pdfDocument);
  const sourceUrl = mediaUrl(project.sourceFile) || mediaUrl(project.sourceFiles?.[0]);
  const destinations = {
    github: cleanText(project.githubUrl),
    "live-site": cleanText(project.liveUrl),
    "uploaded-mp4": demoUrl,
    "external-video": externalVideoUrl,
    pdf: pdfUrl,
    "source-file": sourceUrl,
    "internal-section": cleanText(project.destination),
    "custom-url": cleanText(project.destination)
  };
  const defaultLabels = {
    "project-preview": "View Project",
    github: "View Source Code",
    "live-site": "Open Live Website",
    "uploaded-mp4": "Watch Video",
    "external-video": "Open Video",
    pdf: "Open PDF",
    "source-file": "Download Source",
    "internal-section": "View Section",
    "custom-url": "Open Link"
  };

  if (type === "project-preview") {
    return {
      type: "preview",
      projectId: project.id,
      label: normalizeProjectButtonLabel(project.buttonLabel) || defaultLabels[type]
    };
  }

  const destination = destinations[type] || "";
  const validDestination = type === "internal-section"
    ? /^#[A-Za-z][\w-]*$/.test(destination)
    : type === "custom-url"
      ? /^https:\/\//i.test(destination)
      : Boolean(destination);

  if (!validDestination) {
    return { type: "preview", projectId: project.id, label: "View Project" };
  }

  if (type === "uploaded-mp4") {
    return { type: "video", url: destination, label: cleanText(project.buttonLabel) || defaultLabels[type] };
  }

  return {
    type: type === "internal-section" ? "anchor" : "external",
    url: destination,
    download: type === "source-file",
    label: normalizeProjectButtonLabel(project.buttonLabel) || defaultLabels[type]
  };
}

function resolveLinkedPrimaryAction(project = {}, module = {}, documentId = "") {
  const label = normalizeProjectButtonLabel(project.buttonLabel) || module.defaultButtonLabel || "View Details";
  const moduleScope = cleanText(project.linkedScope || module.linkScope).toLowerCase() === "module";
  if (moduleScope) {
    if (module.publicAvailable === false || !cleanText(module.publicDestination)) return { type: "unavailable", label: "" };
    return { type: "anchor", url: module.publicDestination, label };
  }
  const token = label.toLowerCase();
  const resourceBacked = ["watch demo", "watch video", "watch animation", "open live website", "view pdf", "open pdf", "download", "download source", "github"].includes(token);
  if (!resourceBacked) return { type: "linked", moduleKey: module.key, documentId, label };
  const resourceProject = { ...project, buttonLabel: label };
  return resolveStandalonePrimaryAction(resourceProject);
}

function normalizeStandaloneProject(project) {
  const cover =
    mediaUrl(project.coverImage) ||
    cleanText(project.coverImageUrl) ||
    mediaUrl(project.image) ||
    (typeof project.image === "string" ? cleanText(project.image) : "") ||
    cleanText(project.imageUrl);
  const github = project.githubSecondaryEnabled !== false ? cleanText(project.githubUrl) : "";
  const capabilities = projectCardCapabilities(project);
  const primaryAction = resolveStandalonePrimaryAction(project);
  return {
    id: project.id,
    projectType: "standalone",
    title: cleanText(project.title || project.standaloneProjectName || "Untitled Project"),
    description: cleanText(project.cardSummary || project.shortDescription || project.fullDescription || project.description),
    image: cover,
    tools: projectPublicTools(project),
    skills: projectPublicSkills(project),
    capabilities,
    tags: capabilities.map((capability) => cleanText(capability.item?.name)),
    source: null,
    sourceModule: null,
    primaryLabel: normalizeProjectButtonLabel(primaryAction.label || project.buttonLabel || "View Project"),
    primaryAction,
    additionalActions: resolveAdditionalProjectActions(project),
    githubUrl: github,
    liveUrl: cleanText(project.liveUrl),
    demoVideo: project.demoVideo || project.video || null,
    externalVideo: project.externalVideo || (project.youtubeUrl ? { url: project.youtubeUrl } : null),
    pdf: project.pdfAsset || project.pdfDocument || null,
    sourceFile: project.sourceFile || (Array.isArray(project.sourceFiles) ? project.sourceFiles[0] : null),
    galleryImages: Array.isArray(project.galleryImages) ? project.galleryImages : [],
    projectHours: normalizeHours(project.projectHours),
    raw: project
  };
}

function resolveAdditionalProjectActions(project = {}) {
  const sourceActions = Array.isArray(project.additionalActions) && project.additionalActions.length
    ? project.additionalActions
    : (Array.isArray(project.linkedActions) ? project.linkedActions.map((action) => ({ ...action, kind: "linked" })) : []);
  return sourceActions.map((action, index) => {
    const kind = cleanText(action.kind).toLowerCase() === "resource" ? "resource" : "linked";
    if (kind === "linked") {
      const module = getRegistryModule(action.moduleKey || action.linkedModuleKey);
      const documentId = cleanText(action.documentId || action.linkedDocumentId);
      if (!module || !documentId) return null;
      const source = sourceMaps.get(module.key)?.get(documentId);
      if (!source || !isPublicRecord(source)) return null;
      return {
        type: "linked", moduleKey: module.key, documentId,
        label: cleanText(action.label || action.buttonLabel) || module.defaultButtonLabel || "View Details",
        displayOrder: Number.isFinite(Number(action.displayOrder)) ? Number(action.displayOrder) : index
      };
    }
    const resourceType = cleanText(action.resourceType) || "project-preview";
    const label = cleanText(action.label || action.buttonLabel) || ({
      "project-preview":"View Project", "demo-video":"Watch Video", "live-website":"Open Live Website", pdf:"View PDF", download:"Download", "custom-resource":"Open Resource", github:"GitHub"
    })[resourceType] || "View Project";
    const demoUrl = mediaUrl(project.demoVideo || project.video) || cleanText(project.externalVideo?.embedUrl || mediaUrl(project.externalVideo) || project.externalVideoUrl || project.youtubeUrl);
    const resourceIndex = Math.max(0, Number.parseInt(action.resourceIndex, 10) || 0);
    const destinations = {
      "demo-video": demoUrl,
      "live-website": cleanText(project.liveUrl),
      pdf: mediaUrl(project.pdfAsset || project.pdfDocument),
      download: mediaUrl(project.sourceFiles?.[resourceIndex]) || mediaUrl(project.sourceFile),
      "custom-resource": mediaUrl(project.customAssets?.[resourceIndex]),
      github: cleanText(project.githubUrl)
    };
    if (resourceType === "project-preview") return { type:"preview", projectId: project.id, label, displayOrder:index };
    const url = destinations[resourceType] || "";
    if (!url) return null;
    if (resourceType === "demo-video") return { type:"video", url, label, displayOrder:index };
    return { type:"external", url, download: resourceType === "download", label, displayOrder:index };
  }).filter(Boolean).sort((a,b)=>(a.displayOrder||0)-(b.displayOrder||0));
}

function resolveAdditionalLinkedActions(project = {}) {
  return resolveAdditionalProjectActions(project).filter((action) => action.type === "linked");
}

function resolveLinkedProject(project) {
  const module = getRegistryModuleForProject(project);
  if (!module) {
    console.warn("Linked Project has an invalid source reference.", project.id || "unknown-project");
    return null;
  }
  const moduleScope = cleanText(project.linkedScope || module.linkScope).toLowerCase() === "module" || module.key === "photo-editing";
  const source = moduleScope ? null : sourceMaps.get(module.key)?.get(project.linkedDocumentId);
  if (!moduleScope && !project.linkedDocumentId) {
    console.warn("Linked Project has an invalid source reference.", project.id || "unknown-project");
    return null;
  }
  if (!moduleScope && !source) {
    console.warn(`Linked source is missing for Project ${project.id || "unknown-project"}.`);
    return null;
  }
  if (!moduleScope && !isPublicRecord(source)) return null;

  if (module.key === "experience") {
    const experience = normalizeExperience(source);
    return {
      id: project.id,
      projectType: "linked-module",
      sourceModule: module,
      source: experience,
      title: cleanText(project.title || project.standaloneProjectName) || experience.role,
      description: cleanText(project.cardSummary || project.shortDescription || project.description) || experience.details || experience.company,
      image: mediaUrl(project.coverImage) || mediaUrl(project.coverImageUrl) || mediaUrl(project.image) || experience.cover,
      tools: sourcePublicTools(source, source.tools || source.technologies || []),
      skills: sourcePublicSkills(source, source.skills || []),
      capabilities: projectCardCapabilities(project, source, source.tools || source.technologies || [], source.skills || source.skillsUsed || []),
      tags: projectCardCapabilities(project, source, source.tools || source.technologies || [], source.skills || source.skillsUsed || []).map((capability) => cleanText(capability.item?.name)),
      primaryLabel: cleanText(resolveLinkedPrimaryAction(project, module, source.id).label || linkedProjectPrimaryLabel(project, module)),
      primaryAction: resolveLinkedPrimaryAction(project, module, source.id),
      additionalActions: resolveAdditionalProjectActions(project),
      linkedActions: resolveAdditionalLinkedActions(project),
      githubUrl: project.githubSecondaryEnabled !== false ? cleanText(project.githubUrl) : "",
      raw: project
    };
  }

  if (module.dynamic === true) {
    const section = module.definition || publicFeatureSections.find((item) => item.key === module.sectionKey || item.key === module.key);
    if (!section) return null;
    const item = moduleScope
      ? { title: section.title, summary: section.subtitle, media: [] }
      : dynamicEntryPresentation(section, source);
    const sourceTools = !moduleScope && section.entryCapabilities?.tools === true ? sourcePublicTools(source) : [];
    const sourceSkills = !moduleScope && section.entryCapabilities?.skills === true ? sourcePublicSkills(source) : [];
    const projectCapabilities = moduleScope
      ? projectCardCapabilities(project)
      : resolvePublicProjectCapabilities({
          tools: sourceTools,
          skills: sourceSkills,
          mode: project.publicTagMode || project.publicToolMode || "automatic",
          refs: projectPublicTagRefs(project)
        });
    const primaryAction = resolveLinkedPrimaryAction(project, module, moduleScope ? "" : source.id);
    return {
      id: project.id,
      projectType: "linked-module",
      sourceModule: module,
      source: moduleScope ? null : source,
      title: cleanText(project.title || project.standaloneProjectName) || item.title,
      description: cleanText(project.cardSummary || project.shortDescription || project.description) || item.summary,
      image: mediaUrl(project.coverImage) || mediaUrl(project.coverImageUrl) || mediaUrl(project.image) || item.media?.[0] || "",
      tools: moduleScope ? projectPublicTools(project) : sourceTools,
      skills: moduleScope ? projectPublicSkills(project) : sourceSkills,
      capabilities: projectCapabilities,
      tags: projectCapabilities.map((capability) => cleanText(capability.item?.name)),
      primaryLabel: cleanText(primaryAction.label || linkedProjectPrimaryLabel(project, module)),
      primaryAction,
      additionalActions: resolveAdditionalProjectActions(project),
      linkedActions: resolveAdditionalLinkedActions(project),
      githubUrl: project.githubSecondaryEnabled !== false ? cleanText(project.githubUrl) : "",
      raw: project
    };
  }

  if (module.key === "photo-editing") {
    const groups = photoEditingModuleCapabilityGroups();
    return {
      id: project.id,
      projectType: "linked-module",
      sourceModule: module,
      source: null,
      title: cleanText(project.title || project.standaloneProjectName) || "Photo Editing Portfolio",
      description: cleanText(project.cardSummary || project.shortDescription || project.description) || "A curated collection of published photo editing work.",
      image: mediaUrl(project.coverImage) || mediaUrl(project.coverImageUrl) || mediaUrl(project.image) || "assets/images/photo-editing-portfolio-cover.jpg",
      tools: groups.tools,
      skills: groups.skills,
      capabilities: resolvePublicProjectCapabilities({ tools: groups.tools, skills: groups.skills, mode: project.publicTagMode || project.publicToolMode || "automatic", refs: projectPublicTagRefs(project) }),
      tags: resolvePublicProjectCapabilities({ tools: groups.tools, skills: groups.skills, mode: project.publicTagMode || project.publicToolMode || "automatic", refs: projectPublicTagRefs(project) }).map((capability) => cleanText(capability.item?.name)),
      primaryLabel: cleanText(resolveLinkedPrimaryAction(project, module, "").label || linkedProjectPrimaryLabel(project, module)),
      primaryAction: resolveLinkedPrimaryAction(project, module, ""),
      additionalActions: resolveAdditionalProjectActions(project),
      linkedActions: resolveAdditionalLinkedActions(project),
      githubUrl: project.githubSecondaryEnabled !== false ? cleanText(project.githubUrl) : "",
      raw: project
    };
  }

  return null;
}

function experienceItems() {
  return loadedPublicCollections.has("experiences")
    ? publicExperiences
    : (content.experience || []);
}

function photoItems() {
  if (loadedPublicCollections.has("photoEditingProjects")) return publicPhotoProjects;
  return (content.gallery || []).map((item, index) => ({
    id: `static-photo-${index}`,
    title: item.title,
    category: item.category,
    description: item.description,
    cover: item.image,
    displayType: "single",
    afterImage: { url: item.image },
    tags: []
  }));
}

function projectItems() {
  if (loadedPublicCollections.has("projects")) return resolvedProjects;
  return (content.projects || []).map((project, index) => ({
    id: `static-project-${index}`,
    projectType: "standalone",
    title: project.title,
    description: project.description,
    image: project.image,
    tags: project.tags,
    capabilities: (Array.isArray(project.tags) ? project.tags : []).map((name) => ({ type: "tool", item: { id: "", name: cleanText(name), icon: "" } })),
    primaryLabel: cleanText(project.primaryUrl) === "#photo-editing" && cleanText(project.primaryLabel).toLowerCase() === "view gallery"
      ? "View Portfolio"
      : (project.primaryLabel || "View Project"),
    primaryAction: project.mediaType === "video"
      ? { type: "video", url: project.primaryUrl }
      : project.primaryUrl?.startsWith("#")
        ? { type: "anchor", url: project.primaryUrl }
        : { type: "external", url: project.primaryUrl },
    githubUrl: project.secondaryUrl || "",
    raw: project
  }));
}

function sectionEnabled(key) {
  const sections = Array.isArray(content.home?.sections) ? content.home.sections : [];
  const section = sections.find((item) => cleanText(item.key) === key);
  return section ? section.enabled !== false : true;
}

function hasPublicAboutContent() {
  return Boolean(cleanText(content.about?.text || content.about?.shortText) || safeImageSource(content.about?.image));
}

function hasPublicContactContent() {
  const methods = Array.isArray(content.site?.contactMethods) ? content.site.contactMethods : [];
  return Boolean(
    cleanText(content.contact?.message) ||
    cleanText(content.contact?.availability) ||
    cleanText(content.site?.email) ||
    cleanText(content.site?.phone) ||
    cleanText(content.site?.location) ||
    cleanText(content.site?.linkedin) ||
    cleanText(content.site?.facebook) ||
    methods.some((method) => Boolean(contactMethodHref(method)))
  );
}

function builtInPublicEligibility(key, options = {}) {
  return publicSectionEligibility({
    enabled: sectionEnabled(key) && options.enabled !== false,
    records: options.records ?? null,
    contentAvailable: options.contentAvailable,
    navigation: options.navigation !== false
  });
}

function educationPublicTitle(item = {}) {
  const degree = cleanText(item.degreeShortName || item.degreeName || "Education");
  const major = cleanText(item.majorName);
  return major ? `${degree} — Major in ${major}` : degree;
}

function educationCardMarkup(item = {}) {
  const schoolName = escapeHtml(item.schoolName || "School / Institution");
  const degreeTitle = escapeHtml(educationPublicTitle(item));
  const date = item.date ? `<time>${escapeHtml(item.date)}</time>` : "";
  const logo = item.schoolLogoUrl
    ? `<img src="${escapeHtml(item.schoolLogoUrl)}" alt="${schoolName} logo" loading="lazy">`
    : icon("graduation-cap");
  const school = item.schoolWebsite
    ? `<a href="${escapeHtml(item.schoolWebsite)}" target="_blank" rel="noopener noreferrer">${schoolName}</a>`
    : `<strong>${schoolName}</strong>`;
  const details = [item.location].map(cleanText).filter(Boolean);
  return `<article class="education-public-card" data-education-id="${escapeHtml(item.id || "")}">
    <div class="education-public-logo">${logo}</div>
    <div class="education-public-body">
      <div class="education-public-head"><div><h3>${degreeTitle}</h3>${school}</div>${date}</div>
      ${details.length ? `<p class="education-public-details">${details.map(escapeHtml).join(" · ")}</p>` : ""}
    </div>
  </article>`;
}

function publicMediaFrameMarkup(source, alt = "", { className = "", fallbackLabel = "Media", loading = "lazy", purpose = "card", priority = "auto" } = {}) {
  const presentation = mediaPresentation(source, { family: "image", type: "image", access: "public-preview" });
  const deliveryPurpose = ["detail", "original"].includes(cleanText(purpose).toLowerCase()) ? cleanText(purpose).toLowerCase() : "card";
  const url = cleanText(
    deliveryPurpose === "original"
      ? (presentation.publicOriginalUrl || presentation.publicDisplayUrl)
      : deliveryPurpose === "detail"
        ? (presentation.publicDetailUrl || presentation.publicDisplayUrl)
        : (presentation.publicCardUrl || presentation.publicDisplayUrl)
  );
  const fallbackUrl = cleanText(
    deliveryPurpose === "original"
      ? ""
      : (presentation.publicOriginalUrl || presentation.publicDisplayUrl)
  );
  const deliveryFallback = fallbackUrl && fallbackUrl !== url ? fallbackUrl : "";
  const safeClass = cleanText(className).replace(/[^a-zA-Z0-9_-]+/g, " ").trim();
  const classes = ["public-media-frame", safeClass, url ? "media-loading" : "media-fallback"].filter(Boolean).join(" ");
  const fallback = `<span class="public-media-frame__fallback"><strong>LΛN</strong><small>${escapeHtml(fallbackLabel)}</small></span>`;
  if (!url) return `<span class="${classes}" data-public-media-frame>${fallback}</span>`;
  const priorityMode = ["high", "low"].includes(cleanText(priority).toLowerCase()) ? cleanText(priority).toLowerCase() : "";
  const requestedLoading = loading === "eager" ? "eager" : "lazy";
  const loadingMode = priorityMode === "high" ? "eager" : requestedLoading;
  const fallbackAttribute = deliveryFallback ? ` data-public-media-fallback-src="${escapeHtml(deliveryFallback)}"` : "";
  const priorityAttribute = priorityMode ? ` fetchpriority="${priorityMode}"` : "";
  return `<span class="${classes}" data-public-media-frame data-public-media-loading="${loadingMode}">${fallback}<img class="public-media-frame__image" data-public-media-image src="${escapeHtml(url)}"${fallbackAttribute} alt="${escapeHtml(alt)}" loading="${loadingMode}" decoding="auto"${priorityAttribute}></span>`;
}

function publicVideoFrameMarkup(source, label = "Video", { className = "", autoplay = true, loading = "lazy" } = {}) {
  const presentation = mediaPresentation(source, { family: "video", type: "video", access: "public-preview" });
  const url = cleanText(presentation.publicDisplayUrl);
  const safeClass = cleanText(className).replace(/[^a-zA-Z0-9_-]+/g, " ").trim();
  const classes = ["public-media-frame", "public-media-frame--video", safeClass, url ? "media-loading" : "media-fallback"].filter(Boolean).join(" ");
  const fallback = `<span class="public-media-frame__fallback"><strong>LΛN</strong><small>${escapeHtml(label)}</small></span>`;
  if (!url) return `<span class="${classes}" data-public-media-frame>${fallback}</span>`;
  const autoplayAttrs = autoplay ? " autoplay muted loop" : " controls";
  const loadingMode = loading === "eager" ? "eager" : "lazy";
  return `<span class="${classes}" data-public-media-frame data-public-media-loading="${loadingMode}">${fallback}<video class="public-media-frame__video" data-public-media-video data-public-media-src="${escapeHtml(url)}"${autoplayAttrs} playsinline preload="metadata"></video></span>`;
}

function bindPublicMediaFrames(root = document) {
  root?.querySelectorAll?.("[data-public-media-frame]").forEach((frame) => {
    if (!(frame instanceof HTMLElement) || frame.dataset.publicMediaBound === "true") return;
    frame.dataset.publicMediaBound = "true";
    const image = frame.querySelector("[data-public-media-image]");
    const video = frame.querySelector("[data-public-media-video]");
    if (!image && !video) return;

    let loadingTimer = 0;
    let observer = null;
    const clearLoadingTimer = () => {
      if (!loadingTimer) return;
      window.clearTimeout(loadingTimer);
      loadingTimer = 0;
    };
    const disconnectObserver = () => {
      observer?.disconnect?.();
      observer = null;
    };
    const fail = () => {
      clearLoadingTimer();
      disconnectObserver();
      frame.classList.remove("media-loading", "media-ready");
      frame.classList.add("media-fallback");
    };
    const ready = () => {
      clearLoadingTimer();
      disconnectObserver();
      frame.classList.remove("media-loading", "media-fallback");
      frame.classList.add("media-ready");
    };
    const isNearViewport = (multiplier = 1.8) => {
      const rect = frame.getBoundingClientRect?.();
      if (!rect) return true;
      const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
      return rect.top < viewportHeight * multiplier && rect.bottom > -viewportHeight * 0.35;
    };

    if (image) {
      const retryOriginal = () => {
        const fallbackSource = String(image.dataset.publicMediaFallbackSrc || "").trim();
        const currentSource = String(image.getAttribute("src") || "").trim();
        if (!fallbackSource || image.dataset.publicMediaFallbackTried === "true" || fallbackSource === currentSource) return false;
        image.dataset.publicMediaFallbackTried = "true";
        frame.classList.remove("media-ready", "media-fallback");
        frame.classList.add("media-loading");
        image.setAttribute("src", fallbackSource);
        return true;
      };
      image.addEventListener("error", () => { if (!retryOriginal()) fail(); });
      image.addEventListener("load", ready, { once: true });
      if (!String(image.getAttribute("src") || "").trim()) return fail();
      if (image.complete) image.naturalWidth > 0 ? ready() : (retryOriginal() || fail());
      return;
    }

    const startVideo = () => {
      if (frame.dataset.publicMediaStarted === "true") return;
      frame.dataset.publicMediaStarted = "true";
      disconnectObserver();
      frame.classList.remove("media-ready", "media-fallback");
      frame.classList.add("media-loading");
      video.addEventListener("error", fail, { once: true });
      video.addEventListener("loadeddata", ready, { once: true });
      const source = String(video.dataset.publicMediaSrc || video.getAttribute("src") || video.querySelector("source")?.getAttribute("src") || "").trim();
      if (!source) return fail();
      if (!video.getAttribute("src")) video.setAttribute("src", source);
      video.load();
      if (video.readyState >= 2) return ready();
      loadingTimer = window.setTimeout(() => {
        if (!frame.classList.contains("media-ready")) fail();
      }, 20000);
    };

    const loadingMode = String(frame.dataset.publicMediaLoading || "lazy").trim().toLowerCase();
    if (loadingMode === "eager" || isNearViewport(1.8) || typeof IntersectionObserver !== "function") {
      startVideo();
      return;
    }
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) startVideo();
    }, { rootMargin: "160% 0px" });
    observer.observe(frame);
  });
}

function projectCardMediaMarkup(project = {}) {
  const videoUrl = mediaUrl(project.demoVideo || project.raw?.demoVideo || project.raw?.video);
  const coverSource = project.raw?.coverImage || project.raw?.image || project.raw?.thumbnail || project.image || null;
  const poster = mediaUrl(coverSource, { family: "image", type: "image", access: "public-preview" });
  if (videoUrl) {
    return `<video class="project-card-video-preview" autoplay muted loop playsinline preload="metadata" poster="${escapeHtml(poster)}" aria-label="${escapeHtml(project.title)} silent video preview"><source src="${escapeHtml(videoUrl)}" type="video/mp4"></video>`;
  }
  return publicMediaFrameMarkup(coverSource, project.title, { className: "public-media-frame--cover", fallbackLabel: "Project media" });
}

function projectSingleActionMarkup(action = {}, label = "View Project", secondary = false, projectId = "") {
  const className = `btn small${secondary ? " ghost" : ""}`;
  if (action.type === "linked") {
    return `<button class="${className}" type="button" data-linked-module="${escapeHtml(action.moduleKey)}" data-linked-id="${escapeHtml(action.documentId)}">${escapeHtml(label)}</button>`;
  }
  if (action.type === "preview") {
    return `<button class="${className}" type="button" data-project-details="${escapeHtml(projectId)}">${escapeHtml(label)}</button>`;
  }
  if (action.type === "video") {
    return `<button class="${className}" type="button" data-project-video="${escapeHtml(projectId)}" data-project-video-url="${escapeHtml(action.url || "")}">${escapeHtml(label)}</button>`;
  }
  const url = cleanText(action.url);
  if (!url) return "";
  const externalAttributes = url.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : "";
  const downloadAttribute = action.download ? "download" : "";
  return `<a class="${className}" href="${escapeHtml(url)}" ${externalAttributes} ${downloadAttribute}>${escapeHtml(label)}</a>`;
}

function projectActionMarkup(project) {
  const primaryAction = project.primaryAction || { type: "preview", projectId: project.id };
  const actions = [{ action: primaryAction, label: project.primaryLabel || "View Project" }];
  (Array.isArray(project.additionalActions) ? project.additionalActions : (Array.isArray(project.linkedActions) ? project.linkedActions : [])).forEach((action) => {
    actions.push({ action, label: action.label || "View Details" });
  });

  const rendered = actions
    .map((item, index) => projectSingleActionMarkup(item.action, item.label, index > 0, project.id))
    .filter(Boolean)
    .join("");
  const primaryUsesGithub = primaryAction.type === "external" && cleanText(primaryAction.url) === cleanText(project.githubUrl);
  const additionalUsesGithub = (Array.isArray(project.additionalActions) ? project.additionalActions : []).some((action) => action.type === "external" && cleanText(action.url) === cleanText(project.githubUrl));
  const github = project.githubUrl && !primaryUsesGithub && !additionalUsesGithub
    ? `<a class="btn small ghost" target="_blank" rel="noopener noreferrer" href="${escapeHtml(project.githubUrl)}">${icon("github")} GitHub</a>`
    : "";
  return `${rendered}${github}`;
}

function photoGalleryShapeFromDimensions(width = 0, height = 0) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  if (!safeWidth || !safeHeight) return "unknown";
  const ratio = safeWidth / safeHeight;
  if (ratio >= 1.18) return "landscape";
  if (ratio <= 0.84) return "portrait";
  return "square";
}

function photoGalleryMediaDescriptors(item = {}) {
  const source = Array.isArray(item.galleryImages) ? item.galleryImages : [];
  return source.map((asset, index) => {
    const width = typeof asset === "object" && asset ? Math.max(0, Number(asset.width) || 0) : 0;
    const height = typeof asset === "object" && asset ? Math.max(0, Number(asset.height) || 0) : 0;
    const presentation = mediaPresentation(asset, { family: "image", type: "image", access: "public-preview" });
    return {
      asset,
      presentation,
      index,
      url: presentation.publicDisplayUrl,
      width,
      height,
      shape: photoGalleryShapeFromDimensions(width, height)
    };
  }).filter((media) => Boolean(media.asset));
}

function photoGalleryRepresentativeMedia(media = [], maxItems = 4) {
  const source = Array.isArray(media) ? media.filter((item) => item?.asset) : [];
  const limit = Math.max(1, Number(maxItems) || 4);
  if (source.length <= limit) return source;
  const indices = new Set();
  for (let step = 0; step < limit; step += 1) {
    indices.add(Math.round((step * (source.length - 1)) / (limit - 1)));
  }
  return [...indices].sort((a, b) => a - b).map((index) => source[index]).filter(Boolean).slice(0, limit);
}

function photoGalleryPreviewLayout(media = []) {
  const source = Array.isArray(media) ? media : [];
  const count = source.length;
  const ratioFor = (item) => {
    const width = Math.max(0, Number(item?.width) || 0);
    const height = Math.max(0, Number(item?.height) || 0);
    return width && height ? width / height : 1;
  };
  const shapeFor = (item) => item?.shape || photoGalleryShapeFromDimensions(item?.width, item?.height);
  if (count <= 1) return { variant: "single", featuredIndex: 0 };
  if (count === 2) {
    const landscapeCount = source.filter((item) => shapeFor(item) === "landscape").length;
    return { variant: landscapeCount === 2 ? "two-rows" : "two-columns", featuredIndex: -1 };
  }
  if (count === 3) {
    const portraitIndex = source.reduce((best, item, index) => ratioFor(item) < ratioFor(source[best]) ? index : best, 0);
    if (shapeFor(source[portraitIndex]) === "portrait") return { variant: "three-feature-left", featuredIndex: portraitIndex };
    const landscapeIndex = source.reduce((best, item, index) => ratioFor(item) > ratioFor(source[best]) ? index : best, 0);
    if (shapeFor(source[landscapeIndex]) === "landscape") return { variant: "three-feature-top", featuredIndex: landscapeIndex };
    return { variant: "three-feature-left", featuredIndex: 0 };
  }
  return { variant: "quad", featuredIndex: -1 };
}

function photoCardMediaMarkup(item) {
  const beforeAsset = item.beforeImage || cleanText(item.beforeImageUrl) || null;
  const afterAsset = item.afterImage || cleanText(item.afterImageUrl) || null;
  const displayType = cleanText(item.displayType || item.projectDisplayType).toLowerCase();
  const gallery = photoGalleryMediaDescriptors(item);

  if (displayType === "gallery" && gallery.length) {
    const preview = photoGalleryRepresentativeMedia(gallery, 4);
    const layout = photoGalleryPreviewLayout(preview);
    const remaining = Math.max(0, gallery.length - preview.length);
    return `<span class="photo-thumb-gallery" data-photo-gallery-preview data-gallery-count="${gallery.length}" data-gallery-layout="${escapeHtml(layout.variant)}">${preview.map((media, index) => `<span class="photo-thumb-gallery-tile${index === layout.featuredIndex ? " is-featured" : ""}" data-photo-gallery-tile data-gallery-shape="${escapeHtml(media.shape)}" data-media-width="${media.width}" data-media-height="${media.height}">${publicMediaFrameMarkup(media.presentation, `${item.title} gallery image ${index + 1}`, { className: "public-media-frame--gallery", fallbackLabel: "Gallery image" })}${remaining && index === preview.length - 1 ? `<small class="photo-thumb-gallery-more">+${remaining}</small>` : ""}</span>`).join("")}<small class="photo-thumb-gallery-badge">${icon("images")} Gallery · ${gallery.length}</small></span>`;
  }

  if (displayType === "comparison" && beforeAsset && afterAsset) {
    return `<span class="photo-thumb-comparison"><span>${publicMediaFrameMarkup(beforeAsset, `Before ${item.title}`, { className: "public-media-frame--comparison", fallbackLabel: "Before" })}<small>BEFORE</small></span><span>${publicMediaFrameMarkup(afterAsset, `After ${item.title}`, { className: "public-media-frame--comparison", fallbackLabel: "After" })}<small>AFTER</small></span></span>`;
  }

  const finalAsset = afterAsset || item.coverAsset || beforeAsset || gallery[0]?.asset || null;
  return `<span class="photo-thumb-final">${publicMediaFrameMarkup(finalAsset, item.title, { className: "public-media-frame--cover", fallbackLabel: "Photo editing media" })}</span>`;
}

function refreshPhotoGalleryPreviewLayout(preview) {
  if (!(preview instanceof HTMLElement)) return;
  const tiles = [...preview.querySelectorAll("[data-photo-gallery-tile]")];
  const media = tiles.map((tile) => ({
    width: Number(tile.dataset.mediaWidth) || 0,
    height: Number(tile.dataset.mediaHeight) || 0,
    shape: cleanText(tile.dataset.galleryShape) || "unknown"
  }));
  const layout = photoGalleryPreviewLayout(media);
  preview.dataset.galleryLayout = layout.variant;
  tiles.forEach((tile, index) => tile.classList.toggle("is-featured", index === layout.featuredIndex));
}

function setupPhotoGalleryMediaShapes(root = document) {
  root?.querySelectorAll?.('[data-gallery-shape="unknown"] [data-public-media-image]').forEach((image) => {
    const applyNaturalShape = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const owner = image.closest("[data-photo-gallery-tile], .public-photo-gallery-item");
      if (!owner) return;
      owner.dataset.mediaWidth = String(image.naturalWidth);
      owner.dataset.mediaHeight = String(image.naturalHeight);
      owner.dataset.galleryShape = photoGalleryShapeFromDimensions(image.naturalWidth, image.naturalHeight);
      const preview = owner.closest("[data-photo-gallery-preview]");
      if (preview) refreshPhotoGalleryPreviewLayout(preview);
    };
    if (image.complete && image.naturalWidth) applyNaturalShape();
    else image.addEventListener("load", applyNaturalShape, { once: true });
  });
}


function dynamicEntryData(entry = {}) {
  return {
    title: entry.title,
    shortSummary: entry.shortSummary,
    description: entry.description,
    coverImage: entry.coverImage || entry.coverImageUrl,
    category: entry.category,
    tags: entry.tags,
    ...(entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? entry.data : {})
  };
}

function dynamicEntryPresentation(section, entry) {
  const resolvedMedia = resolveModuleRecordMedia(section, entry);
  const semantics = resolvedMedia.semantics;
  const mediaAssets = resolvedMedia.items.map((item) => item.asset);
  const media = resolvedMedia.items.map((item) => item.publicUrl).filter(Boolean);
  return {
    title: semantics.title,
    summary: semantics.summary,
    category: semantics.category,
    tags: semantics.tags,
    media,
    mediaAssets,
    primaryMediaField: resolvedMedia.field,
    coverField: resolvedMedia.coverField || resolvedMedia.publicCoverField || null,
    coverPresentation: resolvedMedia.publicCoverItem || resolvedMedia.publicCoverCandidateItem || null,
    mediaPresentation: resolvedMedia,
    traits: semantics.traits,
    cardProfile: semantics.cardProfile || "structured",
    data: semantics.data
  };
}

function dynamicCardDateText(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  let match = raw.match(/^(\d{4})$/);
  if (match) return match[1];
  match = raw.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
  }
  match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) {
      return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
    }
  }
  return raw;
}

function dynamicCardMetadataValue(field, value) {
  if (value === null || value === undefined || value === "") return "";
  if (field.type === "hours") return formatHours(value);
  if (["boolean", "toggle"].includes(field.type)) return value === true ? "Yes" : "";
  if (Array.isArray(value)) {
    const values = value.map(cleanText).filter(Boolean);
    if (!values.length) return "";
    const visible = values.slice(0, 2);
    return `${visible.join(", ")}${values.length > visible.length ? ` +${values.length - visible.length} more` : ""}`;
  }
  return cleanText(value);
}

function dynamicCardMetadataItems(section, item) {
  const display = section.display || {};
  const displayKeys = new Set([display.titleField, display.summaryField, display.imageField, display.categoryField, display.tagsField].filter(Boolean));
  const compactTypes = ["text", "hours", "select", "multiselect"];
  const candidates = (section.fields || []).filter((field) => field.public !== false && !displayKeys.has(field.key));
  const populatedDates = candidates.filter((field) => resolveModuleFieldSemanticRole(field) !== "presentation-state" && field.type === "date" && dynamicCardDateText(item.data[field.key]));
  const pairedDateKeys = new Set(populatedDates.slice(0, 2).map((field) => field.key));
  const firstPairedDateKey = populatedDates.length >= 2 ? populatedDates[0].key : "";
  const items = [];

  for (const field of candidates) {
    const role = resolveModuleFieldSemanticRole(field);
    if (role === "presentation-state") continue;
    if (field.type === "date") {
      if (!dynamicCardDateText(item.data[field.key])) continue;
      if (populatedDates.length >= 2 && pairedDateKeys.has(field.key)) {
        if (field.key !== firstPairedDateKey) continue;
        const [startField, endField] = populatedDates;
        const start = dynamicCardDateText(item.data[startField.key]);
        const end = dynamicCardDateText(item.data[endField.key]);
        items.push({ role: "chronology-period", value: [start, end].filter(Boolean).join(" – ") });
      } else {
        items.push({ role, value: dynamicCardDateText(item.data[field.key]) });
      }
    } else if (compactTypes.includes(field.type)) {
      const value = dynamicCardMetadataValue(field, item.data[field.key]);
      if (value) items.push({ role, value });
    } else if (field.type === "number" && role === "reading-time") {
      const value = dynamicCardMetadataValue(field, item.data[field.key]);
      if (value) items.push({ role, value: `${value} min read` });
    }
    if (items.length >= 4) break;
  }
  return items;
}

function dynamicCardMetadataMarkup(items = []) {
  if (!items.length) return "";
  return `<div class="dynamic-module-card-meta">${items.map((item) => `<span class="dynamic-module-card-meta-item" data-semantic-role="${escapeHtml(item.role || "context")}">${escapeHtml(item.value)}</span>`).join("")}</div>`;
}

function dynamicModuleCardMediaMarkup(section, entry, item) {
  const media = item.mediaPresentation || resolveModuleRecordMedia(section, entry);
  const kind = media.cardMediaKind || "none";
  if (kind === "none") return "";

  if (kind === "gallery") {
    const items = (media.galleryPublicItems?.length ? media.galleryPublicItems : media.galleryPublicCandidateItems || []).slice(0, 4);
    if (!items.length) return "";
    const tiles = items.map((presentation, index) => {
      const more = index === 3 && (media.galleryPublicCandidateItems || []).length > 4
        ? `<span class="dynamic-module-gallery-preview__more">+${(media.galleryPublicCandidateItems || []).length - 4}</span>`
        : "";
      return `<span class="dynamic-module-gallery-preview__tile">${publicMediaFrameMarkup(presentation, `${item.title} gallery image ${index + 1}`, { className: "public-media-frame--cover", fallbackLabel: "Gallery image" })}${more}</span>`;
    }).join("");
    return `<div class="dynamic-module-media"><div class="dynamic-module-gallery-preview" data-gallery-count="${Math.min(items.length, 4)}">${tiles}</div></div>`;
  }

  if (kind === "comparison") {
    const before = media.comparison?.before || media.comparison?.publicBeforeCandidate || null;
    const after = media.comparison?.after || media.comparison?.publicAfterCandidate || null;
    if (!before && !after) return "";
    return `<div class="dynamic-module-media dynamic-module-media--comparison"><span>${publicMediaFrameMarkup(before, `${item.title} before`, { className: "public-media-frame--cover", fallbackLabel: "Before" })}<small>Before</small></span><span>${publicMediaFrameMarkup(after, `${item.title} after`, { className: "public-media-frame--cover", fallbackLabel: "After" })}<small>After</small></span></div>`;
  }

  if (kind === "video") {
    const presentation = media.publicItem || media.publicCandidateItem || null;
    if (!presentation) return "";
    return `<div class="dynamic-module-media dynamic-module-media--video">${publicVideoFrameMarkup(presentation, item.title || "Video", { className: "public-media-frame--cover" })}</div>`;
  }

  const presentation = media.publicItem || media.publicCandidateItem || media.publicCoverItem || media.publicCoverCandidateItem || null;
  if (!presentation && !media.usePublicFallbackCover) return "";
  const fallbackLabel = media.coverField ? `${section.title || "Module"} cover` : "Image";
  return `<div class="dynamic-module-media">${publicMediaFrameMarkup(presentation, item.title, { className: "public-media-frame--cover", fallbackLabel })}</div>`;
}

function dynamicModuleUsesContentBudget(section = {}, profile = "structured") {
  const presentation = cleanText(section.publicPresentation || "cards");
  const intent = cleanText(section.contentIntent || "automatic");
  const mediaProfile = profile === "media" || profile === "gallery";
  return mediaProfile && intent !== "showcase" && ["cards", "carousel", "featured-grid", "single-featured"].includes(presentation);
}

function dynamicModuleCardTagsMarkup(item = {}, usesContentBudget = false) {
  if (!item.tags?.length) return "";
  const budgetAttributes = usesContentBudget ? ' data-public-budget-group="tags"' : "";
  const items = item.tags.map((value) => `<span class="tag"${usesContentBudget ? " data-public-budget-item" : ""}>${escapeHtml(value)}</span>`).join("");
  const more = usesContentBudget ? '<span class="tag public-budget-more" data-public-budget-more hidden></span>' : "";
  return `<div class="tags dynamic-module-entry-tags"${budgetAttributes}>${items}${more}</div>`;
}

function dynamicModuleProfileMarkerMarkup(profile = "structured") {
  if (profile === "document") return `<span class="dynamic-module-profile-marker">${icon("file-text")}<small>Document</small></span>`;
  if (profile === "chronology") return `<span class="dynamic-module-profile-marker">${icon("calendar-days")}<small>Timeline</small></span>`;
  if (profile === "editorial") return `<span class="dynamic-module-profile-marker">${icon("align-left")}<small>Editorial</small></span>`;
  return "";
}

function dynamicModuleCardBodyMarkup(section, item, { profile = "structured", usesContentBudget = false } = {}) {
  const category = `<small class="dynamic-module-card-category">${escapeHtml(item.category)}</small>`;
  const title = `<h3${usesContentBudget ? ' class="public-content-budget-title"' : ""}>${escapeHtml(item.title)}</h3>`;
  const summary = item.summary ? `<p${usesContentBudget ? ' class="public-content-budget-summary"' : ""}>${escapeHtml(item.summary)}</p>` : "";
  const metadata = dynamicCardMetadataMarkup(dynamicCardMetadataItems(section, item));
  const tagsMarkup = dynamicModuleCardTagsMarkup(item, usesContentBudget);
  const marker = dynamicModuleProfileMarkerMarkup(profile);

  if (profile === "chronology") {
    return `<div class="dynamic-module-card-body dynamic-module-card-body--chronology">${category}${title}${metadata}${summary}${tagsMarkup}</div>`;
  }
  if (profile === "editorial") {
    return `<div class="dynamic-module-card-body dynamic-module-card-body--editorial">${category}${title}${metadata}${summary}${tagsMarkup}</div>`;
  }
  if (profile === "document") {
    return `<div class="dynamic-module-card-body dynamic-module-card-body--document">${marker}${category}${title}${summary}${metadata}${tagsMarkup}</div>`;
  }
  if (profile === "structured") {
    return `<div class="dynamic-module-card-body dynamic-module-card-body--structured">${category}${title}${summary}${metadata}${tagsMarkup}</div>`;
  }
  return `<div class="dynamic-module-card-body dynamic-module-card-body--media">${category}${title}${summary}${metadata}${tagsMarkup}</div>`;
}

function dynamicModuleCardMarkup(section, entry) {
  const item = dynamicEntryPresentation(section, entry);
  const showcase = section.contentIntent === "showcase";
  const profile = cleanText(item.cardProfile || "structured");
  const usesContentBudget = dynamicModuleUsesContentBudget(section, profile);
  const hasPrimaryMedia = Boolean(item.mediaPresentation?.supportsMedia);
  const bodyItem = showcase ? { ...item, summary: "" } : item;
  return `<article class="dynamic-module-card public-footprint-card dynamic-module-card--detail-trigger dynamic-module-card--profile-${escapeHtml(profile)}${showcase ? " dynamic-module-card--showcase" : ""}${usesContentBudget ? " public-content-budget-card" : ""}${hasPrimaryMedia ? "" : " dynamic-module-card--no-media"}" data-dynamic-entry-card="${escapeHtml(entry.id)}" data-open-dynamic-entry="${escapeHtml(entry.id)}" data-dynamic-section="${escapeHtml(section.key)}" data-card-profile="${escapeHtml(profile)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(item.title)} details">
    ${dynamicModuleCardMediaMarkup(section, entry, item)}
    ${dynamicModuleCardBodyMarkup(section, bodyItem, { profile, usesContentBudget })}
  </article>`;
}


function dynamicModuleBodyMarkup(section, records) {
  const presentation = cleanText(section.publicPresentation || "cards");
  const count = records.length;
  const cards = records.map((entry) => dynamicModuleCardMarkup(section, entry)).join("");
  if (presentation === "single-featured") return `<div class="dynamic-module-featured">${dynamicModuleCardMarkup(section, records[0])}</div>`;
  if (presentation === "featured-grid") {
    if (!records.length) return `<div class="dynamic-module-featured-grid"></div>`;
    const featured = records.find((entry) => entry.featured === true) || records[0];
    const remaining = records.filter((entry) => entry !== featured);
    const grid = remaining.length ? `<div class="dynamic-module-grid dynamic-module-featured-grid__grid dynamic-count-${Math.min(remaining.length, 4)}">${remaining.map((entry) => dynamicModuleCardMarkup(section, entry)).join("")}</div>` : "";
    return `<div class="dynamic-module-featured-grid"><div class="dynamic-module-featured-grid__feature">${dynamicModuleCardMarkup(section, featured)}</div>${grid}</div>`;
  }
  if (presentation === "list") return `<div class="dynamic-module-list">${cards}</div>`;
  if (presentation === "timeline") return `<div class="dynamic-module-timeline">${cards}</div>`;
  if (presentation === "text-section") return `<div class="dynamic-module-text-section">${cards}</div>`;
  if (presentation === "cta-contact") return `<div class="dynamic-module-cta-layout">${cards}</div>`;
  const carousel = presentation === "carousel" || (presentation === "media-gallery" && count >= 4);
  if (carousel) {
    return `<div class="dynamic-module-carousel-shell public-card-carousel-shell"><button class="carousel-arrow dynamic-module-arrow dynamic-module-left" type="button" aria-label="Previous ${escapeHtml(section.title)} entries">${icon("chevron-left")}</button><div class="dynamic-module-grid dynamic-module-carousel-track public-card-carousel-track dynamic-count-${count}" aria-label="${escapeHtml(section.title)} showcase">${cards}</div><button class="carousel-arrow dynamic-module-arrow dynamic-module-right" type="button" aria-label="Next ${escapeHtml(section.title)} entries">${icon("chevron-right")}</button></div>`;
  }
  return `<div class="dynamic-module-grid dynamic-count-${Math.min(count, 4)}">${cards}</div>`;
}

function dynamicModuleSectionMarkup(section, { inRow = false } = {}) {
  const records = Array.isArray(section.records) ? section.records.slice().sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0)) : [];
  const count = records.length;
  const presentation = cleanText(section.publicPresentation || "cards");
  const width = ["full", "half", "one-third", "two-thirds"].includes(section.width) ? section.width : "full";
  const side = ["left", "right"].includes(section.side) ? section.side : "auto";
  const outerClass = inRow ? "" : " wrap";
  const resolvedIcon = resolveModuleAdminIcon(section || {});
  return `<section id="${escapeHtml(section.slug || section.key)}" class="panel portfolio-panel dynamic-module-section dynamic-presentation-${escapeHtml(presentation)} dynamic-width-${escapeHtml(width)} dynamic-side-${escapeHtml(side)} dynamic-entry-count-${count}${outerClass}" data-dynamic-module="${escapeHtml(section.key)}" data-module-id="${escapeHtml(section.id || "")}">
    <div class="dynamic-module-heading"><div><h2>${renderSystemIcon(resolvedIcon, { className: "dynamic-module-heading-system-icon" })}${escapeHtml(section.title)}</h2></div></div>
    <div class="dynamic-module-body public-section-scroll">${dynamicModuleBodyMarkup(section, records)}</div>
  </section>`;
}

function formatPublicAssetSize(bytes = 0) {
  const size = Number(bytes) || 0;
  if (size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function dynamicFileDescriptor(field, asset, index = 0) {
  const source = typeof asset === "string"
    ? { url: asset, name: cleanText(asset.split("?")[0].split("/").pop()) || `Asset ${index + 1}` }
    : { ...(asset || {}) };
  const presentation = resolveModuleFieldAssetPresentation(field, asset);
  const info = classifyPortfolioFile({ ...source, fileFamily: source.fileFamily || presentation.family });
  const name = cleanText(source.originalFilename || source.displayName || source.name || `${info.label} ${index + 1}`);
  return {
    ...source,
    url: presentation.publicDisplayUrl,
    name,
    mimeType: cleanText(source.mimeType || source.mime || info.mime),
    fileFamily: cleanText(source.fileFamily || presentation.family || info.family),
    extension: cleanText(info.extension),
    access: presentation.access,
    publicPresentation: presentation
  };
}

function dynamicDocumentPreviewKind(descriptor = {}) {
  return resolvePortfolioFilePreview(descriptor, descriptor.access || "public-preview").kind;
}


function dynamicDocumentReference(field, asset, index = 0) {
  const descriptor = dynamicFileDescriptor(field, asset, index);
  return encodeURIComponent(JSON.stringify({
    url: descriptor.url,
    name: descriptor.name,
    mimeType: descriptor.mimeType,
    fileFamily: descriptor.fileFamily,
    extension: descriptor.extension,
    access: descriptor.access
  }));
}

function dynamicDocumentPreviewMarkup(descriptor = {}) {
  const url = cleanText(descriptor.url);
  const name = cleanText(descriptor.name || "Document");
  const kind = dynamicDocumentPreviewKind(descriptor);
  if (!url) return `<div class="dynamic-document-state"><strong>Preview unavailable</strong><p>This file does not have a public preview source.</p></div>`;
  if (kind === "pdf") {
    const viewer = browserPdfViewerSource(url);
    if (!viewer) return `<div class="dynamic-document-state"><strong>Preview unavailable</strong><p>This PDF does not have a valid public delivery URL.</p></div>`;
    return `<div class="dynamic-document-frame"><iframe src="${escapeHtml(viewer)}" title="${escapeHtml(name)}" loading="eager"></iframe></div>`;
  }
  if (kind === "office") {
    const viewer = buildMicrosoftOfficeEmbedUrl(url);
    if (!viewer) return `<div class="dynamic-document-state"><strong>Preview unavailable</strong><p>This Office file does not have a valid public delivery URL.</p></div>`;
    return `<div class="dynamic-document-frame"><iframe src="${escapeHtml(viewer)}" title="${escapeHtml(name)}" loading="eager" referrerpolicy="no-referrer"></iframe></div>`;
  }
  if (kind === "text") {
    return `<pre class="dynamic-public-text-preview" data-dynamic-public-text-preview="${escapeHtml(url)}">Loading text preview…</pre>`;
  }
  return `<div class="dynamic-document-state"><strong>Inline preview is not available for this file type.</strong><p>Use the download action when the author has enabled public downloads.</p></div>`;
}

async function loadDynamicPublicTextPreview(stage) {
  const source = cleanText(stage?.dataset?.dynamicPublicTextPreview);
  if (!source) return;
  try {
    const response = await fetch(source, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    stage.textContent = text.length > 300000 ? `${text.slice(0, 300000)}\n\n… Preview truncated …` : text;
  } catch (error) {
    stage.textContent = `Text preview could not be loaded in this browser.\n${cleanText(error?.message || "The file host blocked inline reading.")}`;
  }
}

function closeDynamicDocumentPreview(root = document) {
  const overlay = root?.querySelector?.("[data-dynamic-document-overlay]");
  if (!overlay) return;
  const viewer = root?.classList?.contains?.("dynamic-module-viewer") ? root : overlay.closest?.(".dynamic-module-viewer");
  overlay.remove?.();
  if (viewer) {
    const savedScrollTop = Number(viewer.dataset.dynamicDetailScrollTop || 0);
    viewer.classList.remove("is-document-viewing");
    delete viewer.dataset.dynamicDetailScrollTop;
    viewer.scrollTop = Number.isFinite(savedScrollTop) ? savedScrollTop : 0;
  }
}

function openDynamicDocumentPreview(descriptor = {}) {
  const viewer = document.querySelector("#modal .dynamic-module-viewer");
  if (!viewer) return;
  closeDynamicDocumentPreview(viewer);
  viewer.dataset.dynamicDetailScrollTop = String(viewer.scrollTop || 0);
  viewer.scrollTop = 0;
  viewer.classList.add("is-document-viewing");
  const overlay = document.createElement("section");
  overlay.className = "dynamic-document-overlay";
  overlay.dataset.dynamicDocumentOverlay = "true";
  const name = cleanText(descriptor.name || "Document");
  const kind = dynamicDocumentPreviewKind(descriptor);
  overlay.dataset.documentKind = kind;
  overlay.innerHTML = `<header class="dynamic-document-overlay-head"><button class="btn small ghost" type="button" data-dynamic-document-back>${icon("arrow-left")} Back to details</button><div><small>${escapeHtml(kind === "office" ? "OFFICE DOCUMENT" : kind === "pdf" ? "PDF DOCUMENT" : kind === "text" ? "TEXT FILE" : "FILE")}</small><strong>${escapeHtml(name)}</strong></div></header><div class="dynamic-document-overlay-body">${dynamicDocumentPreviewMarkup(descriptor)}</div>`;
  viewer.append(overlay);
  overlay.querySelector("[data-dynamic-document-back]")?.addEventListener("click", () => closeDynamicDocumentPreview(viewer));
  overlay.querySelectorAll("[data-dynamic-public-text-preview]").forEach((stage) => loadDynamicPublicTextPreview(stage));
  window.lucide?.createIcons();
}

function bindDynamicDocumentPreviews(root = document) {
  root?.querySelectorAll?.("[data-dynamic-document-preview]").forEach((button) => {
    if (button.dataset.dynamicDocumentBound === "true") return;
    button.dataset.dynamicDocumentBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        openDynamicDocumentPreview(JSON.parse(decodeURIComponent(button.dataset.dynamicDocumentPreview || "")));
      } catch {
        // Invalid preview descriptors are ignored instead of breaking the detail viewer.
      }
    });
  });
}

function dynamicAssetMarkup(field, asset, index = 0, options = {}) {
  if (!asset) return "";
  const descriptor = dynamicFileDescriptor(field, asset, index);
  if (!descriptor.publicPresentation?.publicBehavior?.public) return "";

  const info = classifyPortfolioFile(descriptor);
  const preview = resolvePortfolioFilePreview(descriptor, descriptor.access);
  const url = descriptor.url;
  const name = descriptor.name;
  const size = formatPublicAssetSize(descriptor.bytes || descriptor.size);
  const metaClass = options.gallery ? "dynamic-asset-meta public-media-gallery-meta" : "dynamic-asset-meta";
  const meta = `<span class="${metaClass}"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(info.label)}${size ? ` · ${escapeHtml(size)}` : ""}</small></span>`;

  if (preview.kind === "image") {
    const galleryCard = options.gallery ? " public-media-gallery-card" : "";
    const imageMarkup = options.gallery
      ? `<span class="public-media-gallery-stage">${publicMediaFrameMarkup(descriptor.publicPresentation, name, { className: "public-media-frame--gallery", fallbackLabel: "Gallery image", purpose: "detail" })}</span>`
      : publicMediaFrameMarkup(descriptor.publicPresentation, name, { className: "public-media-frame--detail", fallbackLabel: "Image asset", purpose: "detail" });
    return `<figure class="dynamic-asset-preview dynamic-asset-image${galleryCard}">${imageMarkup}${meta}</figure>`;
  }
  if (preview.kind === "video") {
    return `<figure class="dynamic-asset-preview dynamic-asset-video">${publicVideoFrameMarkup(descriptor.publicPresentation, name || "Video", { className: "public-media-frame--detail", autoplay: false })}${meta}</figure>`;
  }
  if (preview.inline && url) {
    if (preview.kind === "audio") return `<div class="dynamic-asset-preview dynamic-asset-audio">${meta}<audio controls preload="metadata" src="${escapeHtml(url)}"></audio></div>`;
    if (["pdf", "office", "text"].includes(preview.kind)) {
      const reference = dynamicDocumentReference(field, asset, index);
      return `<button class="dynamic-asset-preview dynamic-asset-file dynamic-document-card" type="button" data-dynamic-document-preview="${escapeHtml(reference)}">${meta}<span class="dynamic-document-card-action">${icon("eye")} Preview</span></button>`;
    }
  }

  if (preview.download && url) return `<div class="dynamic-asset-preview dynamic-asset-file">${meta}<a class="btn small ghost" href="${escapeHtml(url)}" download>Download file</a></div>`;
  return `<div class="dynamic-asset-preview dynamic-asset-file">${meta}</div>`;
}

function dynamicValueMarkup(field, value) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "";
  if (["image", "images", "gallery", "video", "audio", "pdf", "document", "file", "project-file", "files"].includes(field.type)) {
    const values = Array.isArray(value) ? value : [value];
    const gallery = ["images", "gallery"].includes(field.type);
    const rendered = values.map((asset, index) => dynamicAssetMarkup(field, asset, index, { gallery })).filter(Boolean);
    if (!rendered.length) return "";
    const galleryClass = gallery ? " dynamic-detail-gallery public-media-gallery" : "";
    const galleryCount = gallery ? ` data-gallery-count="${rendered.length}"` : "";
    return `<div class="dynamic-asset-group${galleryClass}"${galleryCount}>${rendered.join("")}</div>`;
  }
  if (field.type === "url") {
    const url = cleanText(value);
    return /^https?:\/\//i.test(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : "";
  }
  if (field.type === "email") return `<a href="mailto:${escapeHtml(cleanText(value))}">${escapeHtml(cleanText(value))}</a>`;
  if (["toggle", "boolean"].includes(field.type)) return value === true ? "Yes" : "No";
  if (field.type === "hours") { const formatted = formatHours(value); return formatted ? `<p>${escapeHtml(formatted)}</p>` : ""; }
  if (field.type === "date") { const formatted = dynamicCardDateText(value); return formatted ? `<p>${escapeHtml(formatted)}</p>` : ""; }
  if (Array.isArray(value)) return `<div class="tags">${tags(value.map(cleanText).filter(Boolean))}</div>`;
  return `<p>${escapeHtml(cleanText(value))}</p>`;
}

function dynamicDetailValueText(field, value) {
  if (value === null || value === undefined || value === "") return "";
  if (field.type === "date") return dynamicCardDateText(value);
  if (field.type === "hours") return formatHours(value);
  if (["toggle", "boolean"].includes(field.type)) return value === true ? "Yes" : value === false ? "No" : "";
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(", ");
  return cleanText(value);
}

function dynamicDetailModel(section, item, { consumedFieldKeys = [] } = {}) {
  const display = section.display || {};
  const displayKeys = new Set([display.titleField, display.summaryField, display.categoryField, display.tagsField].filter(Boolean));
  const consumed = new Set(consumedFieldKeys);
  const fields = (section.fields || []).filter((field) => field.public !== false && !displayKeys.has(field.key) && !consumed.has(field.key));
  const facts = [];
  const narratives = [];
  const chips = [];
  const rich = [];
  const categoryToken = cleanText(item.category).toLowerCase();

  for (const field of fields) {
    const value = item.data[field.key];
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    const role = resolveModuleFieldSemanticRole(field);
    if (role === "presentation-state") continue;
    const label = cleanText(field.label || field.key.replace(/[-_]+/g, " "));
    const mediaField = ["image", "images", "gallery", "video", "audio", "pdf", "document", "file", "project-file", "files"].includes(field.type);
    if (mediaField) {
      const markup = dynamicValueMarkup(field, value);
      if (markup) rich.push({ field, label, role, markup });
      continue;
    }
    if (["textarea", "rich-text"].includes(field.type) || ["lead", "narrative"].includes(role)) {
      const text = dynamicDetailValueText(field, value);
      if (text && text !== item.summary) narratives.push({ label, text, role });
      continue;
    }
    if (["tags", "multiselect"].includes(field.type) || Array.isArray(value)) {
      const values = (Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean);
      if (values.length) chips.push({ label, values, role });
      continue;
    }
    const text = dynamicDetailValueText(field, value);
    if (!text) continue;
    const duplicateCategory = categoryToken && text.toLowerCase() === categoryToken && (["select", "category", "text"].includes(field.type) || /(?:category|content\s*type|type)$/i.test(label));
    if (duplicateCategory) continue;
    facts.push({ field, label, value, text, role });
  }
  return { facts, narratives, chips, rich };
}

function dynamicDetailFactValueMarkup(item) {
  const { field, value, text } = item;
  if (field.type === "url") {
    return /^https?:\/\//i.test(text) ? `<a href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>` : escapeHtml(text);
  }
  if (field.type === "email") return `<a href="mailto:${escapeHtml(text)}">${escapeHtml(text)}</a>`;
  return escapeHtml(text);
}

function dynamicDetailFactsMarkup(model) {
  if (!model.facts.length) return "";
  return `<section class="dynamic-detail-facts" aria-label="Key information">${model.facts.map((item) => `<div class="dynamic-detail-fact"><small>${escapeHtml(item.label)}</small><strong>${dynamicDetailFactValueMarkup(item)}</strong></div>`).join("")}</section>`;
}

function dynamicDetailNarrativesMarkup(model) {
  if (!model.narratives.length && !model.chips.length) return "";
  const narratives = model.narratives.map((item) => `<section class="dynamic-detail-narrative"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.text)}</p></section>`).join("");
  const chips = model.chips.map((item) => `<section class="dynamic-detail-chip-group"><h3>${escapeHtml(item.label)}</h3><div class="tags">${tags(item.values)}</div></section>`).join("");
  return `<div class="dynamic-detail-supporting">${narratives}${chips}</div>`;
}

function dynamicDetailRichGroup(item = {}) {
  const type = cleanText(item.field?.type).toLowerCase();
  if (["image", "images", "gallery"].includes(type) || item.role === "gallery") return "gallery";
  if (["video", "audio"].includes(type) || ["primary-media", "supporting-media"].includes(item.role) && !["file", "files", "project-file"].includes(type)) return "media";
  if (["pdf", "document", "file", "project-file", "files"].includes(type) || item.role === "document") return "documents";
  return "media";
}

function dynamicDetailRichSectionsMarkup(model) {
  if (!model.rich.length) return "";
  const groups = { gallery: [], media: [], documents: [] };
  model.rich.forEach((item) => groups[dynamicDetailRichGroup(item)]?.push(item));
  const definitions = [
    ["gallery", "Gallery & Images"],
    ["media", "Media"],
    ["documents", "Documents & Resources"]
  ];
  const sections = definitions.map(([group, title]) => {
    const items = groups[group];
    if (!items?.length) return "";
    const content = items.map((item) => `<div class="dynamic-detail-rich-item" data-detail-role="${escapeHtml(item.role || "auto")}">${items.length > 1 ? `<h4>${escapeHtml(item.label)}</h4>` : ""}${item.markup}</div>`).join("");
    return `<section class="dynamic-detail-rich-section" data-detail-group="${group}"><header><h3>${title}</h3></header><div class="dynamic-detail-rich-group">${content}</div></section>`;
  }).filter(Boolean).join("");
  return sections ? `<div class="dynamic-detail-rich-sections">${sections}</div>` : "";
}

function publicRelationshipReferenceAvailable(moduleKey, documentId) {
  const key = cleanText(moduleKey).toLowerCase();
  const id = cleanText(documentId);
  if (!key || !id) return false;
  if (key === "projects") return resolvedProjects.some((project) => project.id === id);
  const module = getRegistryModule(key);
  return Boolean(module && sourceMaps.get(module.key)?.has(id));
}

function dynamicRelationshipMarkup(section, entry) {
  const relationships = entry.relationships && typeof entry.relationships === "object" ? entry.relationships : {};
  return (section.relationships || []).filter((relationship) => relationship.public !== false).map((relationship) => {
    const refs = (Array.isArray(relationships[relationship.key]) ? relationships[relationship.key] : [])
      .filter((reference) => publicRelationshipReferenceAvailable(reference.moduleKey || relationship.targetModule, reference.documentId));
    if (!refs.length) return "";
    return `<div class="dynamic-detail-relationship"><strong>${escapeHtml(relationship.label)}</strong><div>${refs.map((reference) => `<button class="btn small ghost" type="button" data-dynamic-relationship-module="${escapeHtml(reference.moduleKey || relationship.targetModule)}" data-dynamic-relationship-id="${escapeHtml(reference.documentId || "")}">${escapeHtml(reference.label || "View related entry")}</button>`).join("")}</div></div>`;
  }).join("");
}

function openDynamicEntry(sectionKey, documentId) {
  const section = publicFeatureSections.find((item) => item.key === cleanText(sectionKey));
  const entry = section?.records?.find((item) => item.id === cleanText(documentId));
  if (!section || !entry) return;
  const item = dynamicEntryPresentation(section, entry);
  const coverField = item.coverField || null;
  const coverPresentation = item.coverPresentation || null;
  const supportsCover = item.mediaPresentation?.supportsCover === true;
  const hero = supportsCover
    ? `<figure class="dynamic-asset-preview dynamic-asset-image dynamic-detail-cover" data-dynamic-cover-hero>${publicMediaFrameMarkup(coverPresentation, `${item.title} cover`, { className: "public-media-frame--detail", fallbackLabel: `${section.title || "Module"} cover`, purpose: "detail", loading: "eager", priority: "high" })}</figure>`
    : "";
  const model = dynamicDetailModel(section, item, { consumedFieldKeys: coverField?.key ? [coverField.key] : [] });
  const resolvedIcon = resolveModuleAdminIcon(section || {});
  const heading = `<div class="modal-heading dynamic-detail-heading"><div>${renderSystemIcon(resolvedIcon, { className: "dynamic-detail-heading-icon" })}</div><div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.category || section.title)}</p></div></div>`;
  const summary = item.summary ? `<p class="dynamic-detail-summary">${escapeHtml(item.summary)}</p>` : "";
  const entryTags = item.tags.length ? `<div class="tags dynamic-detail-entry-tags">${tags(item.tags)}</div>` : "";
  const identity = `<section class="dynamic-detail-identity">${heading}${summary}${entryTags}</section>`;
  show(`<div class="dynamic-detail-shell">${hero}${identity}${dynamicDetailFactsMarkup(model)}${dynamicDetailNarrativesMarkup(model)}${dynamicDetailRichSectionsMarkup(model)}${dynamicRelationshipMarkup(section, entry)}</div>`, "dynamic-module-viewer");
  const viewer = document.querySelector("#modal .dynamic-module-viewer");
  viewer?.querySelectorAll("[data-dynamic-relationship-module]").forEach((button) => button.addEventListener("click", () => openLinkedSource(button.dataset.dynamicRelationshipModule, button.dataset.dynamicRelationshipId)));
  bindDynamicDocumentPreviews(viewer);
}

function homeSectionRegistered(key = "") {
  const wanted = moduleSlug(key);
  if (!wanted) return false;
  const sections = Array.isArray(content.home?.sections) ? content.home.sections : [];
  return sections.some((item) => moduleSlug(item.key) === wanted);
}

function homeSectionComposition(key = "") {
  const wanted = moduleSlug(key);
  const sections = Array.isArray(content.home?.sections) ? content.home.sections : [];
  return sections.find((item) => moduleSlug(item.key) === wanted) || {};
}

function publicLayoutItemMarkup({ key = "", presentation = "", recordCount = 0, contentKind = "core", layoutMode = "auto", layoutPreset = "", overflowMode = "auto", rowPairing = "none", rowPairingExplicit = false, rowPartnerKey = "", order = 0, markup = "" } = {}) {
  const resolvedPreset = resolvePublicLayoutPreset({ key, presentation, recordCount, layoutMode, layoutPreset });
  const resolvedOverflow = resolvePublicOverflow({ key, presentation, recordCount, contentKind, layoutMode, layoutPreset, overflowMode, resolvedPreset });
  return {
    key,
    presentation,
    recordCount,
    contentKind,
    layoutMode: layoutMode === "manual" ? "manual" : "auto",
    preset: resolvedPreset,
    overflow: resolvedOverflow,
    order: Number(order) || 0,
    rowPairing,
    rowPairingExplicit,
    rowPartnerKey,
    content: markup
  };
}

function publicLayoutItemHtml(item, finalPreset = item.preset) {
  const fallback = finalPreset !== item.preset ? ` data-public-preferred-layout="${escapeHtml(item.preset)}"` : "";
  const span = publicLayoutSpan(finalPreset);
  return `<div class="public-layout-item public-layout-${escapeHtml(finalPreset)} public-overflow-${escapeHtml(item.overflow)}" data-public-layout="${escapeHtml(finalPreset)}" data-public-layout-mode="${escapeHtml(item.layoutMode)}" data-public-slot-columns="${span.columns}" data-public-slot-rows="${span.rows}"${fallback} data-public-key="${escapeHtml(item.key)}">${item.content}</div>`;
}

function renderPublicLayoutGrid(items = []) {
  const planned = planPublicLayoutRows(items.filter((item) => item?.content));
  if (!planned.length) return "";
  const chunks = planned.map((row) => row.kind === "cluster"
    ? `<div class="public-layout-cluster" data-public-layout-cluster>${row.items.map((item) => publicLayoutItemHtml(item, item.finalPreset)).join("")}</div>`
    : publicLayoutItemHtml(row.items[0], row.items[0].finalPreset));
  return `<section class="public-layout-grid wrap" aria-label="Portfolio sections">${chunks.join("")}</section>`;
}

function render() {
  const experiences = experienceItems();
  const photos = photoItems();
  const projects = projectItems();
  const categories = ["All", ...new Set(photos.map((item) => item.category).filter(Boolean))];
  if (!categories.includes(activeFilter)) activeFilter = "All";
  const gallery = activeFilter === "All" ? photos : photos.filter((item) => item.category === activeFilter);
  const aboutEligibility = builtInPublicEligibility("about", { enabled: content.about.visible !== false, contentAvailable: hasPublicAboutContent() });
  const experienceEligibility = builtInPublicEligibility("experience", { records: experiences });
  const projectsEligibility = builtInPublicEligibility("projects", { records: projects });
  const photoEditingEligibility = builtInPublicEligibility("photo-editing", { records: photos });
  const educationEligibility = builtInPublicEligibility("education", { records: content.education || [] });
  const certificatesEligibility = builtInPublicEligibility("certificates", { records: content.certificates || [] });
  const contactEligibility = builtInPublicEligibility("contact", { contentAvailable: hasPublicContactContent() });
  const resumeEligibility = builtInPublicEligibility("resume", { records: (content.resumes || []).filter((item) => cleanText(item.file)) });
  const aboutVisible = aboutEligibility.section;
  const experienceVisible = experienceEligibility.section;
  const projectsVisible = projectsEligibility.section;
  const photoEditingVisible = photoEditingEligibility.section;
  const educationVisible = educationEligibility.section;
  const certificatesVisible = certificatesEligibility.section;
  const contactVisible = contactEligibility.section;
  const resumeVisible = resumeEligibility.section;

  const coreSectionOrders = Object.fromEntries((content.home?.sections || []).map((item,index)=>[cleanText(item.key), Number(item.order)||((index+1)*100)]));
  const sectionOrder = (key, fallback) => Number(coreSectionOrders[key]) || fallback;
  const publicLayoutItems = [];
  const pushCore = (key, presentation, recordCount, fallbackOrder, markup) => {
    const composition = homeSectionComposition(key);
    publicLayoutItems.push(publicLayoutItemMarkup({ key, presentation, recordCount, layoutMode:composition.layoutMode||"auto", layoutPreset:composition.layoutPreset||"", overflowMode:composition.overflowMode||"auto", rowPairing:composition.rowPairing||"none", rowPairingExplicit:composition.rowPairingExplicit===true, rowPartnerKey:composition.rowPartnerKey||"", order:sectionOrder(key,fallbackOrder), markup }));
  };

  if (aboutVisible) pushCore('about','text-section',1,100,`<article id="about" class="panel portfolio-panel about-panel"><h2>${icon("user")} About Me</h2><div class="about public-section-scroll" data-about-layout>${content.about.image ? `<div class="about-photo" data-about-photo><img src="${escapeHtml(content.about.image)}" alt="${escapeHtml(content.about.imageAlt || "Rolando Lagmay Jr.")}"></div>` : ""}<div class="about-copy"><p>${escapeHtml(content.about.text || content.about.shortText)}</p></div></div></article>`);
  if (experienceVisible) pushCore('experience','timeline',experiences.length,200,`<article id="experience" class="panel portfolio-panel experience-panel"><h2>${icon("briefcase-business")} Experience</h2><div class="timeline public-section-scroll">${experiences.map((item) => `<div class="timeline-item" data-experience-id="${escapeHtml(item.id || "")}"><span></span><div><div class="exp-head"><h3>${escapeHtml(item.role)}</h3><time>${escapeHtml(item.date)}</time></div>${item.company ? `<a>${escapeHtml(item.company)}</a>` : ""}<p>${escapeHtml(item.details)}</p></div></div>`).join("")}</div></article>`);
  if (projectsVisible) pushCore('projects','carousel',projects.length,300,`<section id="projects" class="panel portfolio-panel projects-section"><h2>${icon("folder-git-2")} Projects</h2><div class="project-showcase-shell public-card-carousel-shell"><button class="carousel-arrow project-showcase-arrow project-showcase-left" type="button" aria-label="Previous projects">${icon("chevron-left")}</button><div class="projects project-showcase-track public-card-carousel-track" aria-label="Project showcase">${projects.map((project) => `<article class="card public-footprint-card public-content-budget-card project-content-budget-card"><button class="media" type="button" data-open-project="${escapeHtml(project.id)}">${projectCardMediaMarkup(project)}</button><div class="card-body"><h3 class="public-content-budget-title">${escapeHtml(project.title)}</h3><p class="public-content-budget-summary">${escapeHtml(project.description)}</p><div class="tags project-capabilities public-content-budget-flex${(project.capabilities || []).length ? " has-capabilities" : ""}" data-project-capabilities data-public-budget-group="capabilities" data-project-id="${escapeHtml(project.id)}">${projectCapabilityTagsMarkup(project.capabilities || [], true)}</div><div class="actions public-content-budget-actions">${projectActionMarkup(project)}</div></div></article>`).join("")}</div><button class="carousel-arrow project-showcase-arrow project-showcase-right" type="button" aria-label="Next projects">${icon("chevron-right")}</button></div></section>`);
  if (photoEditingVisible) pushCore('photo-editing','media-gallery',photos.length,400,`<section id="photo-editing" class="panel portfolio-panel photo-portfolio-section"><h2>${icon("camera")} Photo Editing Portfolio</h2><div class="filters">${categories.map((category) => `<button class="filter ${category === activeFilter ? "active" : ""}" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div><div class="editing-carousel-shell public-card-carousel-shell"><button class="carousel-arrow carousel-left" type="button" aria-label="Previous editing projects">${icon("chevron-left")}</button><div class="editing-carousel public-card-carousel-track" aria-label="Photo editing projects">${gallery.map((item) => `<button class="gallery-card public-footprint-card public-media-footprint-card" data-photo-source-id="${escapeHtml(item.id)}">${photoCardMediaMarkup(item)}<span class="view-full">${icon("zoom-in")} View Full</span><strong>${escapeHtml(item.title)}</strong></button>`).join("")}</div><button class="carousel-arrow carousel-right" type="button" aria-label="Next editing projects">${icon("chevron-right")}</button></div></section>`);
  if (educationVisible) pushCore('education','list',(content.education||[]).length,500,`<section id="education" class="panel portfolio-panel education-section education-section--compact"><div class="education-section-heading"><h2>${icon("graduation-cap")} Education</h2></div><div class="education-public-grid public-section-scroll">${(content.education || []).map(educationCardMarkup).join("")}</div></section>`);
  if (certificatesVisible) pushCore('certificates','list',(content.certificates||[]).length,700,`<article id="certificates" class="panel portfolio-panel certificates-panel"><h2>${icon("award")} Certificates</h2><div class="public-section-scroll">${(content.certificates || []).map((item) => { const meta = [item.year, formatHours(item.trainingHours)].filter(Boolean).join(" · "); return `<div class="cert"><span>${escapeHtml(item.title)}</span><time>${escapeHtml(meta)}</time></div>`; }).join("")}</div></article>`);
  if (contactVisible) pushCore('contact','cta-contact',1,1000,`<article id="contact" class="panel portfolio-panel contact-panel"><h2>${icon("send")} ${escapeHtml(content.contact?.heading || "Let's Work Together")}</h2><div class="public-section-scroll"><p>${escapeHtml(content.contact?.message || "I'm open to opportunities and meaningful projects. Let's create something useful together.")}</p><ul>${content.site.phone ? `<li>${icon("phone")} <a href="tel:${escapeHtml(content.site.phone)}">${escapeHtml(content.site.phone)}</a></li>` : ""}${content.site.email ? `<li>${icon("mail")} <a href="mailto:${escapeHtml(content.site.email)}">${escapeHtml(content.site.email)}</a></li>` : ""}${content.site.location ? `<li>${icon("map-pin")} ${escapeHtml(content.site.location)}</li>` : ""}${content.contact?.availability ? `<li>${icon("circle-check")} ${escapeHtml(content.contact.availability)}</li>` : ""}</ul><div class="actions">${content.site.email ? `<a class="btn" href="mailto:${escapeHtml(content.site.email)}">${icon("mail")} Send Email</a>` : ""}${content.site.linkedin ? `<a class="btn ghost" target="_blank" rel="noopener noreferrer" href="${escapeHtml(content.site.linkedin)}">${icon("linkedin")} LinkedIn</a>` : ""}${content.site.facebook ? `<a class="btn ghost" target="_blank" rel="noopener noreferrer" href="${escapeHtml(content.site.facebook)}">${icon("facebook")} Facebook</a>` : ""}${(content.site.contactMethods || []).filter((method) => !["phone","github","linkedin","facebook"].includes(method.type)).map((method) => { const href = contactMethodHref(method); return href ? `<a class="btn ghost" target="_blank" rel="noopener noreferrer" href="${escapeHtml(href)}">${icon("external-link")} ${escapeHtml(method.label)}</a>` : ""; }).join("")}</div></div></article>`);

  publicFeatureSections.forEach((section,index)=>{
    const order=placementOrder(section.placement,coreSectionOrders)+(index/1000);
    const homeComposition = homeSectionComposition(section.key);
    publicLayoutItems.push(publicLayoutItemMarkup({key:section.key,presentation:section.publicPresentation,recordCount:(section.records||[]).length,contentKind:'generated',layoutMode:homeComposition.layoutMode||section.layoutMode||section.composition?.layoutMode||'auto',layoutPreset:homeComposition.layoutPreset||section.layoutPreset||section.composition?.layoutPreset||'',overflowMode:homeComposition.overflowMode||section.overflowMode||section.composition?.overflowMode||'auto',rowPairing:homeComposition.rowPairing||'none',rowPairingExplicit:homeComposition.rowPairingExplicit===true,rowPartnerKey:homeComposition.rowPartnerKey||'',order,markup:dynamicModuleSectionMarkup(section,{inRow:true})}));
  });
  const publicLayout = renderPublicLayoutGrid(publicLayoutItems);

  app.dataset.sourceMode = publicDataMode;
  app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#home">${escapeHtml(content.site.brand || "LΛN")}</a>
    <button class="menu" aria-label="Open navigation">${icon("menu")}</button>
    <nav>
      ${[
        { label: "Home", visible: true },
        { label: "About", visible: aboutEligibility.navigation },
        { label: "Experience", visible: experienceEligibility.navigation },
        { label: "Education", visible: educationEligibility.navigation },
        { label: "Projects", visible: projectsEligibility.navigation },
        { label: "Photo Editing", visible: photoEditingEligibility.navigation },
        { label: "Certificates", visible: certificatesEligibility.navigation },
        { label: "Contact", visible: contactEligibility.navigation }
      ].filter((item) => item.visible).map((item) => `<a href="#${item.label.toLowerCase().replace(" ", "-")}">${item.label}</a>`).join("")}
      ${publicFeatureSections.filter((section) => modulePublicEligibility(section, section.records).navigation).map((section) => `<a href="#${escapeHtml(section.slug || section.key)}">${escapeHtml(section.title)}</a>`).join("")}
      ${resumeVisible ? `<button class="nav-resume" type="button">Resume</button>` : ""}
    </nav>
    <div class="head-actions"><button class="theme" aria-label="Toggle light mode">${icon("moon")}</button>${workWithMeAvailable() ? `<button class="btn small work-with-me-action" type="button" data-open-work-with-me aria-label="Work With Me" title="Work With Me">${icon("handshake")}<span class="work-with-me-label">Work With Me</span></button>` : ""}</div>
  </header>
  <main class="portfolio-main">
    <section id="home" class="hero premium-hero wrap">
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(content.hero.eyebrow)}</p>
        <h1>${escapeHtml(content.hero.name).replace(" Jr.", " <span>Jr.</span>")}</h1>
        <p class="roles">${(content.hero.roles || []).map(escapeHtml).join(" <b>|</b> ")}</p>
        <p class="lead">${escapeHtml(content.hero.intro)}</p>
        <div class="actions">
          ${resumeVisible ? `<button class="btn open-resumes" type="button">${icon("file-text")} View Resumes</button>` : ""}
          ${projectsVisible ? `<a class="btn ghost" href="#projects">View My Work ${icon("chevron-right")}</a>` : ""}
        </div>
        <div class="social">
          <span>Connect with me:</span>
          ${content.site.facebook ? `<a href="${escapeHtml(content.site.facebook)}" target="_blank" rel="noopener noreferrer" aria-label="Facebook">${icon("facebook")}</a>` : ""}
          ${content.site.linkedin ? `<a href="${escapeHtml(content.site.linkedin)}" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">${icon("linkedin")}</a>` : ""}
          ${content.site.github ? `<a href="${escapeHtml(content.site.github)}" target="_blank" rel="noopener noreferrer" aria-label="GitHub">${icon("github")}</a>` : ""}
          ${content.site.email ? `<a href="mailto:${escapeHtml(content.site.email)}" aria-label="Email Rolando">${icon("mail")}</a>` : ""}
        </div>
      </div>
      ${content.hero.image ? `<div class="hero-img"><img src="${escapeHtml(content.hero.image)}" alt="${escapeHtml(content.hero.imageAlt || "Rolando Lagmay Jr.")}"></div>` : ""}
    </section>

    ${publicLayout}
  </main>
  <footer class="wrap site-footer"><a class="brand" href="#home">${escapeHtml(content.site.brand || "LΛN")}</a><span>© ${new Date().getFullYear()} ${escapeHtml(content.site.name)}</span><span class="site-footer-links"><a href="#home">Back to top ↑</a><a class="footer-admin-link" href="admin/">${icon("lock-keyhole")} Admin</a></span></footer>
  <button class="public-message-launcher" id="publicMessageLauncher" type="button" aria-label="Open private message" title="Private message">${icon("message-circle")}<span class="public-message-launcher-dot" aria-hidden="true"></span></button><div id="modal"></div>`;

  bind();
  bindPublicMediaFrames(app);
  window.lucide?.createIcons();
}


const PUBLIC_MESSAGE_TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let publicMessageStop = null;
let publicMessagePushState = "unregistered";
let publicMessagePushError = "";
let publicMessageTurnstileScriptPromise = null;
let publicMessageTurnstileWidgetId = null;
let publicMessagePuzzleChallenge = null;
let publicMessagePuzzleAnswer = 0;
let publicMessagePendingSubmission = null;
let publicMessagePuzzleResizeObserver = null;
let publicMessagePuzzleWarmupPromise = null;
let publicMessagePuzzleWarmup = null;
const PUBLIC_MESSAGE_PUZZLE_WARMUP_MAX_AGE_MS = 2 * 60 * 1000;
const PUBLIC_MESSAGE_PUZZLE_NEXT_WARMUP_DELAY_MS = 120;

function publicMessageIconUrl() {
  const source = safeImageSource(content?.hero?.image) || "assets/images/hero.png";
  try { return new URL(source, location.href).href; } catch { return new URL("assets/images/hero.png", location.href).href; }
}

function publicMessageHeaderMarkup({ conversation = false, visitorName = "" } = {}) {
  return `<header class="public-private-message-head">
    <div><small>${conversation ? "PRIVATE CONVERSATION" : "PRIVATE MESSAGE"}</small><h2>LΛN Portfolio</h2><p>${conversation ? `${escapeHtml(visitorName)} · only this private browser conversation and the Admin can read it.` : "Only you and the portfolio owner can access this conversation on this browser."}</p></div>
    ${conversation ? `<span class="public-private-lock">${icon("lock-keyhole")} Private</span>` : ""}
    <button class="public-message-head-close" data-modal-close type="button" aria-label="Close private message">${icon("x")}</button>
  </header>`;
}

function publicMessagePuzzleMarkup() {
  return `<section class="public-message-puzzle-layer" data-public-puzzle-layer hidden aria-labelledby="publicPuzzleTitle">
    <div class="public-message-puzzle-card">
      <header class="public-message-puzzle-head">
        <div><small>HUMAN VERIFICATION</small><strong id="publicPuzzleTitle">Slide the piece into the matching space</strong></div>
        <button class="public-message-puzzle-close" data-public-puzzle-cancel type="button" aria-label="Cancel verification">${icon("x")}</button>
      </header>
      <div class="public-message-puzzle-scene" data-public-puzzle-scene aria-hidden="true">
        <svg class="public-message-puzzle-shape-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><clipPath id="publicMessagePuzzlePieceShape" clipPathUnits="objectBoundingBox"><path d="M.08,0 H.38 C.34,.07 .39,.18 .5,.18 C.61,.18 .66,.07 .62,0 H.92 C.964,0 1,.036 1,.08 V.38 C.93,.34 .82,.39 .82,.5 C.82,.61 .93,.66 1,.62 V.92 C1,.964 .964,1 .92,1 H.62 C.66,.93 .61,.82 .5,.82 C.39,.82 .34,.93 .38,1 H.08 C.036,1 0,.964 0,.92 V.62 C.07,.66 .18,.61 .18,.5 C.18,.39 .07,.34 0,.38 V.08 C0,.036 .036,0 .08,0 Z"/></clipPath></defs></svg>
        <img data-public-puzzle-image alt="" draggable="false"/>
        <span class="public-message-puzzle-target" data-public-puzzle-target></span>
        <span class="public-message-puzzle-piece" data-public-puzzle-piece><img data-public-puzzle-piece-image alt="" draggable="false"/></span>
      </div>
      <label class="public-message-puzzle-slider">
        <span class="sr-only">Slide the puzzle piece horizontally</span>
        <input data-public-puzzle-slider type="range" min="0" max="100" step="1" value="0" disabled aria-label="Slide puzzle piece"/>
        <span class="public-message-puzzle-track" aria-hidden="true"><span data-public-puzzle-label>Preparing puzzle…</span><span class="public-message-puzzle-thumb">${icon("chevron-right")}</span></span>
      </label>
      <div class="public-message-turnstile-slot" data-public-turnstile-slot></div>
      <div class="public-message-puzzle-foot"><small class="public-message-puzzle-status" data-public-puzzle-status aria-live="polite">Preparing a high-quality verification puzzle…</small></div>
    </div>
  </section>`;
}

function publicMessageStartMarkup(savedName = "") {
  return `<div class="public-private-message-app" data-public-message-app>
    ${publicMessageHeaderMarkup()}
    <form class="public-message-form public-message-start" id="publicMessageStartForm">
      <label><span>Your name</span><input autocomplete="name" maxlength="80" name="name" required type="text" value="${escapeHtml(savedName)}"/></label>
      <label><span>Message</span><textarea maxlength="2000" name="message" required rows="5" placeholder="Write your message…"></textarea></label>
      <label class="public-message-trap" aria-hidden="true"><span>Website</span><input autocomplete="off" name="website" tabindex="-1" type="text"/></label>
      <div class="public-message-submit"><button class="btn" data-public-message-send type="submit">${icon("message-circle")} Send Message</button><small aria-live="polite" data-public-message-status>Your conversation is private and is not listed publicly.</small></div>
    </form>
    ${publicMessagePuzzleMarkup()}
  </div>`;
}

function publicMessageLoadingMarkup() {
  return `<div class="public-private-message-app" data-public-message-app>${publicMessageHeaderMarkup()}<div class="public-private-loading">Opening private conversation…</div></div>`;
}

function publicMessageClosedMarkup() {
  return `<div class="public-private-message-app" data-public-message-app>${publicMessageHeaderMarkup()}<div class="public-private-message-closed"><strong>Conversation closed</strong><p>This conversation was removed by the portfolio owner.</p><button class="btn" data-start-new-private-message type="button">Start a new message</button></div></div>`;
}

function publicMessageTime(value) {
  const date = typeof value?.toDate === "function" ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Sending…";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(date);
}

function publicMessageConversationMarkup(thread, messages = []) {
  const permissionGranted = typeof Notification !== "undefined" && Notification.permission === "granted";
  const notificationRegistered = permissionGranted && publicMessagePushState === "registered";
  const notificationCopy = notificationRegistered
    ? "Reply notifications are registered on this browser. Delivery is verified only when a push actually reaches this device."
    : permissionGranted
      ? (publicMessagePushError || "Reply notifications need to reconnect on this browser.")
      : "Want a notification when LΛN Portfolio replies?";
  const notificationAction = notificationRegistered ? "Notifications registered" : permissionGranted ? "Reconnect notifications" : "Enable notifications";
  return `<div class="public-private-message-app is-conversation" data-public-message-app data-thread-id="${escapeHtml(thread.id)}">
    ${publicMessageHeaderMarkup({ conversation: true, visitorName: thread.visitorName })}
    <div class="public-private-message-list" id="publicPrivateMessageList" aria-live="polite">
      ${messages.length ? messages.map((item) => item.role === "system"
        ? `<article class="public-private-system-event"><span>${escapeHtml(item.text)}</span><time>${escapeHtml(publicMessageTime(item.createdAt))}</time></article>`
        : `<article class="public-private-bubble ${item.role === "admin" ? "is-admin" : "is-visitor"}"><div><strong>${item.role === "admin" ? "LΛN" : "You"}</strong><time>${escapeHtml(publicMessageTime(item.createdAt))}</time></div><p>${escapeHtml(item.text)}</p></article>`).join("") : '<div class="public-private-empty">Conversation ready.</div>'}
    </div>
    <div class="public-message-notification-row"><span>${escapeHtml(notificationCopy)}</span><button class="btn ghost" data-enable-reply-notifications type="button">${icon("bell")} ${escapeHtml(notificationAction)}</button></div>
    <div class="public-message-browser-memory" data-public-forget-control>
      <div><strong>Remembered on this browser</strong><span>Closing keeps this private conversation and reply notifications available here.</span></div>
      <div class="public-message-forget-actions">
        <button class="public-message-forget-trigger" data-forget-private-message type="button">Forget conversation</button>
        <div class="public-message-forget-choice" data-public-forget-choice hidden>
          <button class="public-message-forget-cancel" data-cancel-forget-private-message type="button">Keep</button>
          <button class="public-message-forget-confirm" data-confirm-forget-private-message type="button">Forget</button>
        </div>
      </div>
    </div>
    <form class="public-private-reply" id="publicMessageReplyForm"><textarea maxlength="2000" name="message" required rows="2" placeholder="Message LΛN Portfolio…"></textarea><button class="btn" type="submit" aria-label="Send reply">${icon("send")}</button><small aria-live="polite" data-public-message-status></small></form>
  </div>`;
}

function updatePublicMessageLauncherUnread(unread) {
  const button = document.querySelector("#publicMessageLauncher");
  if (!button) return;
  button.classList.toggle("has-unread", Boolean(unread));
  button.setAttribute("aria-label", unread ? "Open private message — new LΛN Portfolio reply" : "Open private message");
}

function loadPublicMessageTurnstileApi() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (publicMessageTurnstileScriptPromise) return publicMessageTurnstileScriptPromise;
  publicMessageTurnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PUBLIC_MESSAGE_TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.publicMessageTurnstile = "true";
    script.addEventListener("load", () => window.turnstile?.render ? resolve(window.turnstile) : reject(new Error("Secure browser verification did not initialize.")), { once: true });
    script.addEventListener("error", () => reject(new Error("Secure browser verification could not be loaded.")), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    publicMessageTurnstileScriptPromise = null;
    throw error;
  });
  return publicMessageTurnstileScriptPromise;
}

function preloadPublicMessagePuzzleImage(challenge) {
  const source = publicMessagePuzzleImageUrl(challenge);
  if (!source) return Promise.reject(new Error("Verification image is unavailable."));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(source), { once: true });
    image.addEventListener("error", () => reject(new Error("Verification image could not be prepared.")), { once: true });
    image.src = source;
    if (image.complete && image.naturalWidth > 0) resolve(source);
  });
}

function discardPublicMessagePuzzleWarmup() {
  publicMessagePuzzleWarmup = null;
  publicMessagePuzzleWarmupPromise = null;
}

function publicMessagePuzzleWarmupFresh() {
  return Boolean(
    publicMessagePuzzleWarmup?.challenge?.challengeId
    && Date.now() - Number(publicMessagePuzzleWarmup.preparedAt || 0) < PUBLIC_MESSAGE_PUZZLE_WARMUP_MAX_AGE_MS
  );
}

async function warmPublicMessagePuzzleChallenge() {
  if (publicMessagePuzzleWarmupFresh()) return publicMessagePuzzleWarmup;
  if (publicMessagePuzzleWarmupPromise) return publicMessagePuzzleWarmupPromise;
  publicMessagePuzzleWarmupPromise = (async () => {
    const [challenge, turnstile] = await Promise.all([createPrivateMessageChallenge(), loadPublicMessageTurnstileApi()]);
    if (!challenge?.challengeId || !challenge?.siteKey) throw new Error("Secure human verification is not configured.");
    await preloadPublicMessagePuzzleImage(challenge);
    publicMessagePuzzleWarmup = { challenge, turnstile, preparedAt: Date.now() };
    return publicMessagePuzzleWarmup;
  })().finally(() => { publicMessagePuzzleWarmupPromise = null; });
  return publicMessagePuzzleWarmupPromise;
}

async function takePublicMessagePuzzleWarmup() {
  if (!publicMessagePuzzleWarmupFresh()) {
    publicMessagePuzzleWarmup = null;
    return warmPublicMessagePuzzleChallenge();
  }
  const prepared = publicMessagePuzzleWarmup;
  publicMessagePuzzleWarmup = null;
  return prepared;
}

function destroyPublicMessagePuzzleVerification() {
  publicMessagePuzzleChallenge = null;
  publicMessagePuzzleAnswer = 0;
  publicMessagePendingSubmission = null;
  discardPublicMessagePuzzleWarmup();
  publicMessagePuzzleResizeObserver?.disconnect();
  publicMessagePuzzleResizeObserver = null;
  if (publicMessageTurnstileWidgetId != null && window.turnstile?.remove) window.turnstile.remove(publicMessageTurnstileWidgetId);
  publicMessageTurnstileWidgetId = null;
}

function publicMessagePuzzleImageUrl(challenge) {
  const raw = cleanText(challenge?.image?.url);
  if (!raw) return "";
  try {
    const url = new URL(raw, location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function syncPublicMessagePuzzleAspect(scene, image, metadata = {}) {
  if (!scene || !image) return;
  const naturalWidth = Number(image.naturalWidth) || Number(metadata?.width) || 0;
  const naturalHeight = Number(image.naturalHeight) || Number(metadata?.height) || 0;
  const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 16 / 9;
  const normalizedRatio = Math.max(1.35, Math.min(2.1, ratio));
  scene.style.setProperty("--public-puzzle-aspect", String(normalizedRatio));
}

function loadPublicMessagePuzzleImage(image, pieceImage, scene, challenge) {
  const source = publicMessagePuzzleImageUrl(challenge);
  if (!source) return Promise.reject(new Error("Verification image is unavailable."));
  return new Promise((resolve, reject) => {
    const finish = () => {
      syncPublicMessagePuzzleAspect(scene, image, challenge?.image);
      resolve();
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", () => reject(new Error("Verification image could not be loaded. Please try again.")), { once: true });
    image.src = source;
    pieceImage.src = source;
    if (image.complete && image.naturalWidth > 0) finish();
  });
}

function setPublicMessagePuzzleSlider(slider, value) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  slider.value = String(safeValue);
  slider.closest(".public-message-puzzle-card")?.style.setProperty("--public-puzzle-progress", `${safeValue}%`);
  publicMessagePuzzleAnswer = safeValue;
  syncPublicMessagePuzzleGeometry();
}

function syncPublicMessagePuzzleGeometry() {
  const challenge = publicMessagePuzzleChallenge;
  const scene = document.querySelector("[data-public-puzzle-scene]");
  const target = scene?.querySelector("[data-public-puzzle-target]");
  const piece = scene?.querySelector("[data-public-puzzle-piece]");
  const pieceImage = piece?.querySelector("[data-public-puzzle-piece-image]");
  if (!challenge || !scene || !target || !piece || !pieceImage) return;
  const rect = scene.getBoundingClientRect();
  const pieceScale = Math.max(.13, Math.min(.18, Number(challenge.pieceScalePercent || 16) / 100));
  const pieceSize = Math.max(34, Math.min(64, rect.width * pieceScale));
  const travel = Math.max(0, rect.width - pieceSize);
  const verticalTravel = Math.max(0, rect.height - pieceSize);
  const targetLeft = travel * (Number(challenge.targetPercent) / 100);
  const pieceLeft = travel * (publicMessagePuzzleAnswer / 100);
  const top = verticalTravel * (Number(challenge.topPercent) / 100);
  for (const node of [target, piece]) {
    node.style.width = `${pieceSize}px`;
    node.style.height = `${pieceSize}px`;
    node.style.top = `${top}px`;
  }
  target.style.left = `${targetLeft}px`;
  piece.style.left = `${pieceLeft}px`;
  pieceImage.style.width = `${rect.width}px`;
  pieceImage.style.height = `${rect.height}px`;
  pieceImage.style.left = `${-targetLeft}px`;
  pieceImage.style.top = `${-top}px`;
}

function closePublicMessagePuzzleVerification({ preserveSubmission = false } = {}) {
  const layer = document.querySelector("[data-public-puzzle-layer]");
  if (layer) layer.hidden = true;
  publicMessagePuzzleChallenge = null;
  publicMessagePuzzleAnswer = 0;
  publicMessagePuzzleResizeObserver?.disconnect();
  publicMessagePuzzleResizeObserver = null;
  if (!preserveSubmission) publicMessagePendingSubmission = null;
  if (publicMessageTurnstileWidgetId != null && window.turnstile?.remove) window.turnstile.remove(publicMessageTurnstileWidgetId);
  publicMessageTurnstileWidgetId = null;
}

async function loadPublicMessagePuzzleChallenge() {
  const layer = document.querySelector("[data-public-puzzle-layer]");
  const scene = layer?.querySelector("[data-public-puzzle-scene]");
  const image = layer?.querySelector("[data-public-puzzle-image]");
  const pieceImage = layer?.querySelector("[data-public-puzzle-piece-image]");
  const slider = layer?.querySelector("[data-public-puzzle-slider]");
  const label = layer?.querySelector("[data-public-puzzle-label]");
  const status = layer?.querySelector("[data-public-puzzle-status]");
  const slot = layer?.querySelector("[data-public-turnstile-slot]");
  if (!layer || !scene || !image || !pieceImage || !slider || !slot) return;

  publicMessagePuzzleChallenge = null;
  publicMessagePuzzleAnswer = 0;
  slider.disabled = true;
  scene.style.removeProperty("--public-puzzle-aspect");
  if (label) label.textContent = "Preparing puzzle…";
  if (status) { status.textContent = "Preparing a high-quality verification image…"; status.className = "public-message-puzzle-status"; }
  if (publicMessageTurnstileWidgetId != null && window.turnstile?.remove) window.turnstile.remove(publicMessageTurnstileWidgetId);
  publicMessageTurnstileWidgetId = null;

  try {
    const prepared = await takePublicMessagePuzzleWarmup();
    const challenge = prepared?.challenge;
    const turnstile = prepared?.turnstile || await loadPublicMessageTurnstileApi();
    if (!challenge?.challengeId || !challenge?.siteKey) throw new Error("Secure human verification is not configured.");
    publicMessagePuzzleChallenge = challenge;
    publicMessagePuzzleAnswer = 0;
    await loadPublicMessagePuzzleImage(image, pieceImage, scene, challenge);
    setPublicMessagePuzzleSlider(slider, 0);
    syncPublicMessagePuzzleGeometry();
    publicMessagePuzzleResizeObserver?.disconnect();
    publicMessagePuzzleResizeObserver = new ResizeObserver(syncPublicMessagePuzzleGeometry);
    publicMessagePuzzleResizeObserver.observe(scene);

    let pendingTurnstileResolve = null;
    let pendingTurnstileReject = null;
    const runTurnstile = () => new Promise((resolve, reject) => {
      pendingTurnstileResolve = resolve;
      pendingTurnstileReject = reject;
      turnstile.execute(publicMessageTurnstileWidgetId);
    });
    publicMessageTurnstileWidgetId = turnstile.render(slot, {
      sitekey: challenge.siteKey,
      theme: "dark",
      size: "flexible",
      appearance: "interaction-only",
      execution: "execute",
      action: challenge.action || "portfolio_message_create",
      callback: (token) => { pendingTurnstileResolve?.(cleanText(token)); pendingTurnstileResolve = null; pendingTurnstileReject = null; },
      "expired-callback": () => { pendingTurnstileReject?.(new Error("Secure browser verification expired.")); pendingTurnstileResolve = null; pendingTurnstileReject = null; },
      "error-callback": () => { pendingTurnstileReject?.(new Error("Secure browser verification could not complete.")); pendingTurnstileResolve = null; pendingTurnstileReject = null; },
      "timeout-callback": () => { pendingTurnstileReject?.(new Error("Secure browser verification timed out.")); pendingTurnstileResolve = null; pendingTurnstileReject = null; }
    });

    const resetSamePuzzle = (message = "Try the same puzzle again.", retryChallenge = null) => {
      if (retryChallenge && publicMessagePuzzleChallenge) {
        publicMessagePuzzleChallenge = { ...publicMessagePuzzleChallenge, ...retryChallenge };
      }
      turnstile.reset?.(publicMessageTurnstileWidgetId);
      setPublicMessagePuzzleSlider(slider, 0);
      syncPublicMessagePuzzleGeometry();
      slider.disabled = false;
      if (label) label.textContent = "Slide to complete the puzzle";
      if (status) { status.textContent = message; status.className = "public-message-puzzle-status is-error"; }
    };

    slider.disabled = false;
    if (label) label.textContent = "Slide to complete the puzzle";
    if (status) status.textContent = "Move the piece into the matching space, then release.";
    slider.oninput = () => setPublicMessagePuzzleSlider(slider, slider.value);
    slider.onchange = async () => {
      if (!publicMessagePuzzleChallenge) return;
      slider.disabled = true;
      if (label) label.textContent = "Checking…";
      if (status) status.textContent = "Verifying the puzzle securely…";
      try {
        const turnstileToken = await runTurnstile();
        const verified = await verifyPrivateMessageChallenge({
          challengeId: publicMessagePuzzleChallenge.challengeId,
          answer: Number(slider.value),
          turnstileToken
        });
        if (verified?.outcome === "retry") {
          resetSamePuzzle(verified.message || "Not quite. The matching space moved — try again.", verified.challenge);
          return;
        }
        if (verified?.outcome === "replace") {
          if (status) { status.textContent = verified.message || "Switching to the next prepared image…"; status.className = "public-message-puzzle-status is-error"; }
          await loadPublicMessagePuzzleChallenge();
          return;
        }
        if (!verified?.verificationToken) throw new Error("Verification did not return a secure proof.");
        if (label) label.textContent = "Verified";
        if (status) { status.textContent = "Verified. Sending your message…"; status.className = "public-message-puzzle-status is-success"; }
        await sendPendingPublicMessage(verified.verificationToken);
      } catch (error) {
        if (status) { status.textContent = error?.message || "Secure verification could not complete. Please try again."; status.className = "public-message-puzzle-status is-error"; }
        slider.disabled = false;
        if (label) label.textContent = "Slide to complete the puzzle";
      }
    };

    // Keep the next server challenge warm as soon as this one is usable so a
    // bounded failed-attempt rotation can switch images without visible fetch latency.
    window.setTimeout(() => warmPublicMessagePuzzleChallenge().catch(() => {}), PUBLIC_MESSAGE_PUZZLE_NEXT_WARMUP_DELAY_MS);
  } catch (error) {
    slider.disabled = true;
    if (label) label.textContent = "Verification unavailable";
    if (status) { status.textContent = error?.message || "Secure human verification is unavailable."; status.className = "public-message-puzzle-status is-error"; }
  }
}

async function openPublicMessagePuzzleVerification(submission) {
  publicMessagePendingSubmission = submission;
  const layer = document.querySelector("[data-public-puzzle-layer]");
  if (!layer) return;
  layer.hidden = false;
  layer.querySelector("[data-public-puzzle-cancel]")?.addEventListener("click", () => closePublicMessagePuzzleVerification(), { once: true });
  window.lucide?.createIcons();
  await loadPublicMessagePuzzleChallenge();
}

async function sendPendingPublicMessage(verificationToken) {
  const submission = publicMessagePendingSubmission;
  if (!submission) throw new Error("Message details are no longer available. Please try again.");
  const status = document.querySelector("[data-public-message-status]");
  const button = document.querySelector("[data-public-message-send]");
  if (button) button.disabled = true;
  try {
    const thread = await createPrivateVisitorThread({ ...submission, verificationToken });
    storeVisitorConversationIdentity(thread);
    closePublicMessagePuzzleVerification();
    await openPublicMessageComposer();
  } catch (error) {
    if (status) { status.textContent = error?.message || "Message could not be sent."; status.className = "public-message-status-error"; }
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

function bindPublicConversationActions(threadId) {
  const reply = document.querySelector("#publicMessageReplyForm");
  reply?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector("[data-public-message-status]");
    const button = form.querySelector("button[type=submit]");
    const body = cleanText(new FormData(form).get("message"));
    if (!body) return;
    if (button) button.disabled = true;
    try {
      await sendPrivateVisitorMessage(threadId, body);
      form.reset();
      if (status) status.textContent = "Sent";
    } catch (error) {
      if (status) status.textContent = error?.message || "Message could not be sent.";
    } finally { if (button) button.disabled = false; }
  });
  bindMessageComposerKeyboard(reply, reply?.querySelector('textarea[name="message"]'));

  document.querySelector("[data-enable-reply-notifications]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Enabling…";
    try {
      await enablePortfolioPush({ audience: "visitor", threadId, iconUrl: publicMessageIconUrl() });
      publicMessagePushState = "registered";
      publicMessagePushError = "";
      button.innerHTML = `${icon("bell-ring")} Notifications registered`;
      const copy = button.closest(".public-message-notification-row")?.querySelector("span");
      if (copy) copy.textContent = "Reply notifications are registered on this browser. Delivery will be verified when a push actually reaches this device.";
      window.lucide?.createIcons();
    } catch (error) {
      publicMessagePushState = "unregistered";
      publicMessagePushError = error?.message || "Notifications could not be enabled.";
      button.innerHTML = original;
      window.lucide?.createIcons();
      const copy = button.closest(".public-message-notification-row")?.querySelector("span");
      if (copy) copy.textContent = publicMessagePushError;
      const status = document.querySelector("#publicMessageReplyForm [data-public-message-status]");
      if (status) status.textContent = publicMessagePushError;
    } finally { button.disabled = false; }
  });

  const forgetTrigger = document.querySelector("[data-forget-private-message]");
  const forgetChoice = document.querySelector("[data-public-forget-choice]");
  const forgetCancel = document.querySelector("[data-cancel-forget-private-message]");
  const forgetConfirm = document.querySelector("[data-confirm-forget-private-message]");
  forgetTrigger?.addEventListener("click", () => {
    forgetTrigger.hidden = true;
    if (forgetChoice) forgetChoice.hidden = false;
    forgetConfirm?.focus();
  });
  forgetCancel?.addEventListener("click", () => {
    if (forgetChoice) forgetChoice.hidden = true;
    if (forgetTrigger) forgetTrigger.hidden = false;
    forgetTrigger?.focus();
  });
  forgetConfirm?.addEventListener("click", async () => {
    if (forgetConfirm) forgetConfirm.disabled = true;
    if (forgetCancel) forgetCancel.disabled = true;
    const replyStatus = document.querySelector("#publicMessageReplyForm [data-public-message-status]");
    if (replyStatus) replyStatus.textContent = "Forgetting this browser access…";
    try {
      await disablePortfolioPushForThread({ threadId });
      await forgetPrivateVisitorThread(threadId);
      publicMessageStop?.();
      publicMessageStop = null;
      clearVisitorConversationIdentity();
      updatePublicMessageLauncherUnread(false);
      closeModal();
    } catch (error) {
      if (replyStatus) replyStatus.textContent = error?.message || "This browser could not forget the conversation securely.";
      if (forgetConfirm) forgetConfirm.disabled = false;
      if (forgetCancel) forgetCancel.disabled = false;
    }
  });

}

function renderPublicPrivateConversation(thread, messages) {
  const dialog = document.querySelector(".public-message-dialog");
  if (!dialog || !thread) return;
  dialog.innerHTML = publicMessageConversationMarkup(thread, messages);
  bindPublicConversationActions(thread.id);
  window.lucide?.createIcons();
  const list = dialog.querySelector("#publicPrivateMessageList");
  if (list) list.scrollTop = list.scrollHeight;
}

function renderPublicMessageStart(dialog, savedName = "") {
  destroyPublicMessagePuzzleVerification();
  dialog.innerHTML = publicMessageStartMarkup(savedName);
  const startForm = dialog.querySelector("#publicMessageStartForm");
  startForm?.addEventListener("submit", submitPublicMessage);
  bindMessageComposerKeyboard(startForm, startForm?.querySelector('textarea[name="message"]'));
  window.lucide?.createIcons();
  warmPublicMessagePuzzleChallenge().catch(() => {});
}

async function openPublicMessageComposer() {
  publicMessageStop?.();
  publicMessageStop = null;
  const identity = loadVisitorConversationIdentity();
  show(`<div class="public-message-dialog">${publicMessageLoadingMarkup()}</div>`, "public-message-modal", { embeddedClose: true, onClose: destroyPublicMessagePuzzleVerification });
  const dialog = document.querySelector(".public-message-dialog");
  if (!dialog) return;

  if (!identity.id) {
    renderPublicMessageStart(dialog, identity.visitorName);
    return;
  }

  try {
    const thread = await getPrivateVisitorThread(identity.id);
    if (!thread) {
      clearVisitorConversationIdentity();
      updatePublicMessageLauncherUnread(false);
      renderPublicMessageStart(dialog, "");
      return;
    }
    publicMessagePushState = "unregistered";
    publicMessagePushError = "";
    if (("Notification" in window) && Notification.permission === "granted") {
      try {
        await rehydratePortfolioPush({ audience: "visitor", threadId: identity.id, iconUrl: publicMessageIconUrl() });
        publicMessagePushState = "registered";
      } catch (error) {
        publicMessagePushError = error?.message || "Reply notifications could not reconnect on this browser.";
        console.error("Visitor push registration could not be restored:", error);
      }
    }
    publicMessageStop = subscribePrivateVisitorThread(identity.id, async ({ thread: liveThread, messages }) => {
      if (!liveThread) {
        publicMessageStop?.();
        publicMessageStop = null;
        clearVisitorConversationIdentity();
        updatePublicMessageLauncherUnread(false);
        if (dialog.isConnected) dialog.innerHTML = publicMessageClosedMarkup();
        dialog.querySelector("[data-start-new-private-message]")?.addEventListener("click", () => renderPublicMessageStart(dialog, ""));
        window.lucide?.createIcons();
        return;
      }
      updatePublicMessageLauncherUnread(liveThread.visitorUnread);
      renderPublicPrivateConversation(liveThread, messages);
      if (liveThread.visitorUnread) markPrivateVisitorThreadRead(liveThread.id).catch(() => {});
    }, (error) => {
      if (dialog.isConnected) dialog.innerHTML = `<div class="public-private-error"><strong>Private messaging unavailable</strong><p>${escapeHtml(error?.message || "Please try again later.")}</p></div>`;
    });
  } catch (error) {
    dialog.innerHTML = `<div class="public-private-error"><strong>Private messaging unavailable</strong><p>${escapeHtml(error?.message || "Please try again later.")}</p></div>`;
  }
}

async function submitPublicMessage(event) {
  event?.preventDefault?.();
  const form = event?.currentTarget;
  if (!form) return;
  const status = form.querySelector("[data-public-message-status]");
  const data = new FormData(form);
  const name = cleanText(data.get("name"));
  const message = cleanText(data.get("message"));
  const website = cleanText(data.get("website"));
  if (!name || !message) {
    if (status) { status.textContent = "Enter your name and message first."; status.className = "public-message-status-error"; }
    return;
  }
  if (status) { status.textContent = "Complete the verification puzzle to send your message."; status.className = ""; }
  await openPublicMessagePuzzleVerification({ name, message, website });
}


function publicServicesValid(data = publicServices) {
  if (!data || !cleanText(data.heading) || !cleanText(data.intro)) return false;
  if (!(data.services || []).some((service) => cleanText(service.title) && cleanText(service.description))) return false;

  const contact = data.contact || {};
  const email = cleanText(contact.email);
  const linkedinUrl = cleanText(contact.linkedinUrl);
  if (contact.emailEnabled !== false && !email) return false;
  if (contact.copyEmailEnabled !== false && !email) return false;
  if (contact.linkedinEnabled !== false && !linkedinUrl) return false;

  return Boolean(
    (contact.emailEnabled !== false && email) ||
    (contact.copyEmailEnabled !== false && email) ||
    (contact.linkedinEnabled !== false && linkedinUrl)
  );
}

function workWithMeAvailable() {
  return Boolean(
    sectionEnabled("services") &&
    publicServices?.status === "published" &&
    publicServices?.visible !== false &&
    publicServicesValid(publicServices)
  );
}

function servicesEmailHref(data = publicServices) {
  const email = cleanText(data?.contact?.email);
  if (!email) return "";
  const params = new URLSearchParams();
  if (cleanText(data?.emailSubject)) params.set("subject", cleanText(data.emailSubject));
  if (String(data?.emailTemplate || "").trim()) params.set("body", String(data.emailTemplate).trim());
  const query = params.toString();
  return `mailto:${email}${query ? `?${query}` : ""}`;
}

function openWorkWithMe() {
  if (!workWithMeAvailable()) return;
  const data = publicServices;
  const availability = (data.availability || []).map((item) => `<span>${escapeHtml(item.label)}</span>`).join("");
  const serviceCards = (data.services || []).map((item) => `<article class="services-public-card"><span aria-hidden="true">${renderSystemIcon(item.icon, { className: "services-public-system-icon" })}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></article>`).join("");
  const emailHref = servicesEmailHref(data);
  const email = cleanText(data.contact?.email);
  const linkedinUrl = cleanText(data.contact?.linkedinUrl);
  const actions = [
    data.contact?.emailEnabled !== false && emailHref ? `<a class="btn" href="${escapeHtml(emailHref)}" data-services-email>${icon("mail")} ${escapeHtml(data.contact.emailLabel || "Email Me")}</a>` : "",
    data.contact?.linkedinEnabled !== false && linkedinUrl ? `<a class="btn ghost" href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener noreferrer">${icon("linkedin")} ${escapeHtml(data.contact.linkedinLabel || "LinkedIn")}</a>` : "",
    data.contact?.copyEmailEnabled !== false && email ? `<button class="btn ghost" type="button" data-copy-services-email="${escapeHtml(email)}">${icon("copy")} <span>${escapeHtml(data.contact.copyEmailLabel || "Copy Email")}</span></button>` : ""
  ].filter(Boolean).join("");
  show(`<div class="services-public-shell">
    <header class="services-public-head"><p class="eyebrow">Work With Me</p><h2>${escapeHtml(data.heading || "Work With Me")}</h2><p>${escapeHtml(data.intro || "")}</p></header>
    ${availability ? `<div class="services-public-availability" aria-label="Availability">${availability}</div>` : ""}
    <div class="services-public-grid">${serviceCards}</div>
    <footer class="services-public-contact"><div class="services-public-contact-copy"><strong>Ready to discuss your work?</strong><span>Choose the contact method that works best for you.</span></div><div class="services-public-actions">${actions}</div></footer>
  </div>`, "work-with-me-modal services-public-modal");
  const copyButton = document.querySelector("[data-copy-services-email]");
  copyButton?.addEventListener("click", async () => {
    const value = copyButton.dataset.copyServicesEmail || "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const label = copyButton.querySelector("span");
      if (label) label.textContent = "Email Copied";
      copyButton.classList.add("services-copy-confirmed");
      window.setTimeout(() => {
        if (label) label.textContent = data.contact?.copyEmailLabel || "Copy Email";
        copyButton.classList.remove("services-copy-confirmed");
      }, 1800);
    } catch {
      window.prompt("Copy email address:", value);
    }
  });
  window.lucide?.createIcons();
}

function setupAboutMediaFlow(root = document) {
  const about = root?.querySelector?.("[data-about-layout]");
  const photo = about?.querySelector?.("[data-about-photo]");
  const image = photo?.querySelector?.("img");
  if (!(about instanceof HTMLElement) || !(image instanceof HTMLImageElement)) return;

  const applyNaturalLayout = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const landscape = (image.naturalWidth / image.naturalHeight) >= 1.2;
    about.classList.toggle("about--landscape", landscape);
    about.classList.toggle("about--wrapped", !landscape);
    about.dataset.aboutImageShape = landscape ? "landscape" : "wrapped";
    requestAnimationFrame(() => refreshPublicVerticalViewport(about));
  };

  if (image.complete && image.naturalWidth) applyNaturalLayout();
  else image.addEventListener("load", applyNaturalLayout, { once: true });
}

function bind() {
  document.querySelector(".menu")?.addEventListener("click", () => document.querySelector("nav")?.classList.toggle("open"));
  document.querySelectorAll("nav a").forEach((link) => link.addEventListener("click", () => document.querySelector("nav")?.classList.remove("open")));
  document.querySelector(".nav-resume")?.addEventListener("click", () => { document.querySelector("nav")?.classList.remove("open"); openResumeChooser(); });
  document.querySelectorAll(".open-resumes").forEach((button) => button.addEventListener("click", openResumeChooser));
  document.querySelector(".theme")?.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
    const selectedTheme = document.documentElement.classList.contains("light") ? "light" : "dark";
    document.documentElement.dataset.theme = selectedTheme;
    document.documentElement.dataset.cmsThemeResolved = selectedTheme;
    localStorage.setItem("theme", selectedTheme);
    updateThemeIcon();
  });
  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => { activeFilter = button.dataset.filter; render(); }));
  document.querySelectorAll("[data-open-project]").forEach((button) => button.addEventListener("click", () => openProjectById(button.dataset.openProject)));
  document.querySelectorAll("[data-project-details]").forEach((button) => button.addEventListener("click", () => openProjectDetailsById(button.dataset.projectDetails)));
  document.querySelectorAll("[data-project-video]").forEach((button) => button.addEventListener("click", () => openProjectVideoResource(button.dataset.projectVideo, button.dataset.projectVideoUrl)));
  document.querySelectorAll("[data-linked-module]").forEach((button) => button.addEventListener("click", () => openLinkedSource(button.dataset.linkedModule, button.dataset.linkedId)));
  document.querySelectorAll("[data-photo-source-id]").forEach((button) => button.addEventListener("click", () => openPhotoEditingSource(button.dataset.photoSourceId)));
  document.querySelectorAll("[data-open-dynamic-entry]").forEach((trigger) => {
    trigger.addEventListener("click", () => openDynamicEntry(trigger.dataset.dynamicSection, trigger.dataset.openDynamicEntry));
    if (trigger.matches("[role=button]")) trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDynamicEntry(trigger.dataset.dynamicSection, trigger.dataset.openDynamicEntry);
    });
  });
  document.querySelectorAll("[data-open-work-with-me]").forEach((button) => button.addEventListener("click", openWorkWithMe));
  const publicMessageLauncher = document.querySelector("#publicMessageLauncher");
  publicMessageLauncher?.addEventListener("click", openPublicMessageComposer);
  const warmMessageVerification = () => {
    if (!loadVisitorConversationIdentity().id) warmPublicMessagePuzzleChallenge().catch(() => {});
  };
  publicMessageLauncher?.addEventListener("pointerenter", warmMessageVerification, { passive: true });
  publicMessageLauncher?.addEventListener("focus", warmMessageVerification, { passive: true });
  try { if (new URL(location.href).searchParams.get("message") === "open") queueMicrotask(() => openPublicMessageComposer()); } catch {}
  setupProjectShowcaseCarousel();
  setupEditingCarousel();
  setupPhotoGalleryMediaShapes();
  setupAboutMediaFlow();
  setupDynamicModuleCarousels();
  initPublicAdaptiveMode();
  setupPublicVerticalOverflow();
  setupPublicContentBudgetCards();
  setupProjectCapabilityOverflow();
  updateThemeIcon();
}

const PUBLIC_VERTICAL_SCROLL_INTERACTIVE_SELECTOR = 'a,button,input,textarea,select,option,label,video,audio,[contenteditable="true"],[role="button"]';
let activePublicVerticalViewport = null;
let publicVerticalOverflowObserver = null;
let publicVerticalKeydownInstalled = false;

function publicVerticalScrollUsesDocumentFlow() {
  return isPublicDocumentFlowMode();
}

function publicVerticalViewportOverflows(viewport) {
  return viewport instanceof HTMLElement && viewport.scrollHeight > viewport.clientHeight + 2;
}

function publicVerticalScrollCanMove(viewport, deltaY) {
  if (!(viewport instanceof HTMLElement) || !deltaY) return false;
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  if (deltaY > 0) return viewport.scrollTop < maxScrollTop - 1;
  return viewport.scrollTop > 1;
}

function setPublicVerticalViewportActive(viewport, active) {
  if (activePublicVerticalViewport && activePublicVerticalViewport !== viewport) {
    activePublicVerticalViewport.classList.remove("is-vertical-scroll-active", "is-vertical-scroll-grabbing");
  }
  if (!(viewport instanceof HTMLElement) || !active) {
    viewport?.classList?.remove("is-vertical-scroll-active", "is-vertical-scroll-grabbing");
    if (activePublicVerticalViewport === viewport || !viewport) activePublicVerticalViewport = null;
    return;
  }
  activePublicVerticalViewport = viewport;
  viewport.classList.add("is-vertical-scroll-active");
}

function refreshPublicVerticalViewport(viewport) {
  if (!(viewport instanceof HTMLElement)) return;
  const ready = !publicVerticalScrollUsesDocumentFlow() && publicVerticalViewportOverflows(viewport);
  viewport.classList.toggle("is-vertical-scroll-ready", ready);
  if (!ready && activePublicVerticalViewport === viewport) setPublicVerticalViewportActive(viewport, false);
}

function publicVerticalKeyboardDelta(event, viewport) {
  if (event.key === "ArrowDown") return 52;
  if (event.key === "ArrowUp") return -52;
  if (event.key === "PageDown") return Math.max(120, viewport.clientHeight * 0.82);
  if (event.key === "PageUp") return -Math.max(120, viewport.clientHeight * 0.82);
  return 0;
}

function setupPublicVerticalOverflow() {
  publicVerticalOverflowObserver?.disconnect?.();
  publicVerticalOverflowObserver = null;
  setPublicVerticalViewportActive(activePublicVerticalViewport, false);
  const viewports = [...document.querySelectorAll(".public-overflow-vertical .public-section-scroll")];
  if (!viewports.length) return;
  viewports.forEach((viewport) => viewport.classList.add("lan-vertical-scroll-surface"));

  const refresh = () => viewports.forEach(refreshPublicVerticalViewport);
  const dragThreshold = 7;

  viewports.forEach((viewport) => {
    let pointerId = null;
    let pointerStartY = 0;
    let pointerStartScrollTop = 0;
    let dragging = false;

    viewport.addEventListener("click", (event) => {
      if (publicVerticalScrollUsesDocumentFlow() || !publicVerticalViewportOverflows(viewport)) return;
      if (event.target instanceof Element && event.target.closest(PUBLIC_VERTICAL_SCROLL_INTERACTIVE_SELECTOR)) return;
      setPublicVerticalViewportActive(viewport, true);
    });

    viewport.addEventListener("pointerleave", () => {
      pointerId = null;
      dragging = false;
      viewport.classList.remove("is-vertical-scroll-grabbing");
      setPublicVerticalViewportActive(viewport, false);
    });

    viewport.addEventListener("wheel", (event) => {
      if (activePublicVerticalViewport !== viewport || publicVerticalScrollUsesDocumentFlow()) return;
      if (!publicVerticalScrollCanMove(viewport, event.deltaY)) return;
      event.preventDefault();
      viewport.scrollTop += event.deltaY;
    }, { passive: false });

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "touch" || publicVerticalScrollUsesDocumentFlow()) return;
      if (!publicVerticalViewportOverflows(viewport)) return;
      if (event.target instanceof Element && event.target.closest(PUBLIC_VERTICAL_SCROLL_INTERACTIVE_SELECTOR)) return;
      pointerId = event.pointerId;
      pointerStartY = event.clientY;
      pointerStartScrollTop = viewport.scrollTop;
      dragging = false;
    });

    viewport.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const deltaY = event.clientY - pointerStartY;
      if (!dragging && Math.abs(deltaY) >= dragThreshold) {
        dragging = true;
        setPublicVerticalViewportActive(viewport, true);
        viewport.classList.add("is-vertical-scroll-grabbing");
        viewport.setPointerCapture?.(event.pointerId);
      }
      if (!dragging) return;
      event.preventDefault();
      viewport.scrollTop = pointerStartScrollTop - deltaY;
    });

    const finishDrag = (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      dragging = false;
      viewport.classList.remove("is-vertical-scroll-grabbing");
      try { viewport.releasePointerCapture?.(event.pointerId); } catch {}
    };
    viewport.addEventListener("pointerup", finishDrag);
    viewport.addEventListener("pointercancel", finishDrag);
  });

  if (!publicVerticalKeydownInstalled) {
    publicVerticalKeydownInstalled = true;
    document.addEventListener("keydown", (event) => {
      const viewport = activePublicVerticalViewport;
      if (!viewport || publicVerticalScrollUsesDocumentFlow()) return;
      if (event.target instanceof Element && event.target.closest(PUBLIC_VERTICAL_SCROLL_INTERACTIVE_SELECTOR)) return;
      const deltaY = publicVerticalKeyboardDelta(event, viewport);
      if (!deltaY || !publicVerticalScrollCanMove(viewport, deltaY)) return;
      event.preventDefault();
      viewport.scrollBy({ top: deltaY, behavior: "smooth" });
    });
  }

  if ("ResizeObserver" in window) {
    publicVerticalOverflowObserver = new ResizeObserver(refresh);
    viewports.forEach((viewport) => publicVerticalOverflowObserver.observe(viewport));
  }
  window.addEventListener("resize", refresh, { passive: true, once: true });
  requestAnimationFrame(refresh);
}


let publicContentBudgetObserver = null;
let publicContentBudgetFrame = 0;
let publicContentBudgetModeListenerInstalled = false;
let publicContentBudgetSettleTimer = 0;
const publicBudgetHostWidths = new WeakMap();
const publicBudgetPendingCards = new Set();
const publicBudgetDirtyHosts = new Set();

function publicContentBudgetBody(card) {
  return card?.querySelector?.(".card-body, .dynamic-module-card-body") || null;
}

function publicContentBudgetOverflowing(card) {
  const body = publicContentBudgetBody(card);
  return body instanceof HTMLElement && body.clientHeight > 0 && body.scrollHeight > body.clientHeight + 1;
}

function resetPublicContentBudgetCard(card) {
  const summary = card.querySelector(".public-content-budget-summary");
  if (summary instanceof HTMLElement) summary.style.webkitLineClamp = "unset";
  card.querySelectorAll("[data-public-budget-item]").forEach((item) => { item.hidden = false; });
  card.querySelectorAll("[data-public-budget-more]").forEach((more) => {
    more.hidden = true;
    more.textContent = "";
  });
  card.removeAttribute("data-public-budget-unresolved");
}

function publicBudgetGroupItems(group) {
  return [...group.querySelectorAll(":scope > [data-public-budget-item]")];
}

function publicBudgetNodeFitsRegion(node, regionRect) {
  if (!(node instanceof HTMLElement)) return true;
  const rect = node.getBoundingClientRect();
  return rect.left >= regionRect.left - 1
    && rect.right <= regionRect.right + 1
    && rect.top >= regionRect.top - 1
    && rect.bottom <= regionRect.bottom + 1;
}

function fitPublicBudgetGroupToRegion(group) {
  if (!(group instanceof HTMLElement)) return;
  const items = publicBudgetGroupItems(group);
  const more = group.querySelector(":scope > [data-public-budget-more]");
  if (!items.length || !(more instanceof HTMLElement)) return;

  items.forEach((item) => { item.hidden = false; });
  more.hidden = true;
  more.textContent = "";

  const regionRect = group.getBoundingClientRect();
  if (regionRect.width <= 0 || regionRect.height <= 0) return;

  const visibleItemsFit = (count) => items.slice(0, count).every((item) => publicBudgetNodeFitsRegion(item, regionRect));
  let visible = items.length;
  while (visible > 0 && !visibleItemsFit(visible)) {
    visible -= 1;
    items[visible].hidden = true;
  }

  let hiddenCount = items.length - visible;
  if (!hiddenCount) return;

  more.hidden = false;
  more.textContent = `+${hiddenCount} more`;
  while (visible > 0 && (!publicBudgetNodeFitsRegion(more, regionRect) || !visibleItemsFit(visible))) {
    visible -= 1;
    items[visible].hidden = true;
    hiddenCount += 1;
    more.textContent = `+${hiddenCount} more`;
  }

  if (!publicBudgetNodeFitsRegion(more, regionRect)) more.hidden = true;
}

function collapsePublicBudgetGroupForCard(card, group) {
  if (!(group instanceof HTMLElement)) return;
  const items = publicBudgetGroupItems(group);
  const more = group.querySelector(":scope > [data-public-budget-more]");
  if (!items.length || !(more instanceof HTMLElement)) return;

  let visible = items.filter((item) => !item.hidden).length;
  let hiddenCount = items.length - visible;
  while (visible > 0 && publicContentBudgetOverflowing(card)) {
    visible -= 1;
    items[visible].hidden = true;
    hiddenCount += 1;
    more.hidden = false;
    more.textContent = `+${hiddenCount} more`;
  }
  if (!hiddenCount) more.hidden = true;
}

function fitPublicContentBudgetCard(card) {
  if (!(card instanceof HTMLElement)) return;
  const body = publicContentBudgetBody(card);
  if (!(body instanceof HTMLElement) || body.clientHeight <= 0) return;

  resetPublicContentBudgetCard(card);

  // Description/narrative owns the body. Flexible tags/tools are measured inside
  // the space that remains for their own region, even when the whole card itself
  // is not overflowing. This is the established Project behavior generalized for
  // generated and future record cards.
  const flexibleGroups = [...card.querySelectorAll('[data-public-budget-group="tags"], [data-public-budget-group="capabilities"], [data-public-budget-group="secondary"]')];
  flexibleGroups.forEach(fitPublicBudgetGroupToRegion);

  if (!publicContentBudgetOverflowing(card)) return;
  flexibleGroups.forEach((group) => {
    if (publicContentBudgetOverflowing(card)) collapsePublicBudgetGroupForCard(card, group);
  });

  if (!publicContentBudgetOverflowing(card)) return;
  const summary = card.querySelector(".public-content-budget-summary");
  if (summary instanceof HTMLElement) {
    for (const lines of [6, 5, 4, 3, 2, 1]) {
      if (!publicContentBudgetOverflowing(card)) break;
      summary.style.webkitLineClamp = String(lines);
    }
  }

  if (publicContentBudgetOverflowing(card)) card.setAttribute("data-public-budget-unresolved", "true");
}

function flushPublicContentBudgetCards() {
  publicContentBudgetFrame = 0;
  const cards = [...publicBudgetPendingCards];
  publicBudgetPendingCards.clear();
  cards.forEach((card) => {
    if (card.isConnected) fitPublicContentBudgetCard(card);
  });
}

function schedulePublicContentBudgetCards(cards) {
  cards.forEach((card) => {
    if (card instanceof HTMLElement && card.classList.contains("public-content-budget-card")) publicBudgetPendingCards.add(card);
  });
  if (publicContentBudgetFrame) return;
  publicContentBudgetFrame = requestAnimationFrame(flushPublicContentBudgetCards);
}

function schedulePublicContentBudgetRefresh() {
  schedulePublicContentBudgetCards([...document.querySelectorAll(".public-content-budget-card")]);
}

function settlePublicContentBudgets() {
  window.clearTimeout(publicContentBudgetSettleTimer);
  publicContentBudgetSettleTimer = window.setTimeout(() => {
    publicContentBudgetSettleTimer = 0;
    const hosts = [...publicBudgetDirtyHosts];
    publicBudgetDirtyHosts.clear();
    for (const host of hosts) {
      if (!host.isConnected) continue;
      schedulePublicContentBudgetCards([...host.querySelectorAll('.public-content-budget-card')]);
    }
  }, 90);
}

function setupPublicContentBudgetCards() {
  publicContentBudgetObserver?.disconnect?.();
  publicContentBudgetObserver = null;
  const cards = [...document.querySelectorAll(".public-content-budget-card")];
  if (!cards.length) return;
  schedulePublicContentBudgetCards(cards);

  if (!publicContentBudgetModeListenerInstalled) {
    publicContentBudgetModeListenerInstalled = true;
    // public-adaptive.js is the one viewport authority. Budgeting reacts to its
    // semantic mode event and to actual record-library width changes only.
    window.addEventListener("lan:public-adaptive-mode-change", schedulePublicContentBudgetRefresh);
  }

  if ("ResizeObserver" in window) {
    publicContentBudgetObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const nextWidth = Math.round(entry.contentRect.width);
        const previousWidth = publicBudgetHostWidths.get(entry.target);
        if (previousWidth === nextWidth) continue;
        publicBudgetHostWidths.set(entry.target, nextWidth);
        publicBudgetDirtyHosts.add(entry.target);
        changed = true;
      }
      if (changed) settlePublicContentBudgets();
    });
    const hosts = new Set(cards.map((card) => card.parentElement).filter((host) => host instanceof HTMLElement));
    hosts.forEach((host) => {
      publicBudgetHostWidths.set(host, Math.round(host.getBoundingClientRect().width));
      publicContentBudgetObserver.observe(host);
    });
  }
}

function setupProjectCapabilityOverflow() {
  document.querySelectorAll("[data-project-capabilities]").forEach((container) => {
    container.querySelector(".project-capability-more")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const projectId = event.currentTarget.dataset.projectDetails || container.dataset.projectId || "";
      if (projectId) openProjectDetailsById(projectId);
    });
  });
}

let projectShowcaseObserver = null;

function setupProjectShowcaseCarousel() {
  projectShowcaseObserver?.disconnect?.();
  projectShowcaseObserver = null;
  const track = document.querySelector(".project-showcase-track");
  const left = document.querySelector(".project-showcase-left");
  const right = document.querySelector(".project-showcase-right");
  if (!track || !left || !right) return;

  const gap = 15;
  const dragThreshold = 8;
  let activePointerId = null;
  let pointerStartX = 0;
  let pointerStartScrollLeft = 0;
  let isDragging = false;
  let suppressProjectShowcaseClick = false;
  let suppressResetTimer = 0;

  const cardStep = () => {
    const card = track.querySelector(".card");
    if (!card) return Math.max(240, Math.floor(track.clientWidth * 0.82));
    return card.getBoundingClientRect().width + gap;
  };
  const maxProjectShowcaseScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
  const updateArrows = () => {
    const maxScroll = maxProjectShowcaseScroll();
    left.hidden = track.scrollLeft <= 4 || maxScroll < 6;
    right.hidden = track.scrollLeft >= maxScroll - 4 || maxScroll < 6;
  };
  const snapProjectShowcaseToNearestCard = () => {
    const step = cardStep();
    if (!step) return;
    const maxScroll = maxProjectShowcaseScroll();
    const target = Math.min(maxScroll, Math.max(0, Math.round(track.scrollLeft / step) * step));
    track.scrollTo({ left: target, behavior: "smooth" });
  };
  const refresh = () => {
    requestAnimationFrame(updateArrows);
  };

  left.addEventListener("click", () => track.scrollBy({ left: -cardStep(), behavior: "smooth" }));
  right.addEventListener("click", () => track.scrollBy({ left: cardStep(), behavior: "smooth" }));
  track.addEventListener("scroll", updateArrows, { passive: true });
  track.addEventListener("dragstart", (event) => event.preventDefault());
  track.addEventListener("click", (event) => {
    if (!suppressProjectShowcaseClick) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    suppressProjectShowcaseClick = false;
  }, true);
  track.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    window.clearTimeout(suppressResetTimer);
    activePointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartScrollLeft = track.scrollLeft;
    isDragging = false;
    suppressProjectShowcaseClick = false;
    track.classList.add("is-pointer-down");
  });
  track.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStartX;
    if (!isDragging && Math.abs(deltaX) >= dragThreshold) {
      isDragging = true;
      suppressProjectShowcaseClick = true;
      track.classList.add("is-dragging");
      track.setPointerCapture?.(event.pointerId);
    }
    if (!isDragging) return;
    event.preventDefault();
    track.scrollLeft = pointerStartScrollLeft - deltaX;
  });
  const finishPointerDrag = (event) => {
    if (activePointerId !== event.pointerId) return;
    const didDrag = isDragging;
    activePointerId = null;
    isDragging = false;
    track.classList.remove("is-pointer-down", "is-dragging");
    try { track.releasePointerCapture?.(event.pointerId); } catch {}
    if (didDrag) {
      requestAnimationFrame(snapProjectShowcaseToNearestCard);
      suppressResetTimer = window.setTimeout(() => { suppressProjectShowcaseClick = false; }, 80);
    }
  };
  track.addEventListener("pointerup", finishPointerDrag);
  track.addEventListener("pointercancel", finishPointerDrag);

  if ("ResizeObserver" in window) {
    projectShowcaseObserver = new ResizeObserver(refresh);
    projectShowcaseObserver.observe(track);
  }
  requestAnimationFrame(refresh);
}

function setupEditingCarousel() {
  const track = document.querySelector(".editing-carousel");
  const left = document.querySelector(".carousel-left");
  const right = document.querySelector(".carousel-right");
  if (!track || !left || !right) return;

  const dragThreshold = 8;
  let activePointerId = null;
  let pointerStartX = 0;
  let pointerStartScrollLeft = 0;
  let isDragging = false;
  let suppressEditingClick = false;
  let suppressResetTimer = 0;

  const cardStep = () => {
    const card = track.querySelector(".gallery-card");
    if (!card) return Math.max(260, Math.floor(track.clientWidth * 0.82));
    const styles = getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "12") || 12;
    return card.getBoundingClientRect().width + gap;
  };
  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
  const updateArrows = () => {
    const maximum = maxScroll();
    left.hidden = track.scrollLeft <= 4 || maximum < 6;
    right.hidden = track.scrollLeft >= maximum - 4 || maximum < 6;
  };
  const snapToNearestCard = () => {
    const step = cardStep();
    if (!step) return;
    const target = Math.min(maxScroll(), Math.max(0, Math.round(track.scrollLeft / step) * step));
    track.scrollTo({ left: target, behavior: "smooth" });
  };

  left.addEventListener("click", () => track.scrollBy({ left: -cardStep(), behavior: "smooth" }));
  right.addEventListener("click", () => track.scrollBy({ left: cardStep(), behavior: "smooth" }));
  track.addEventListener("scroll", updateArrows, { passive: true });
  track.addEventListener("dragstart", (event) => event.preventDefault());
  track.addEventListener("click", (event) => {
    if (!suppressEditingClick) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    suppressEditingClick = false;
  }, true);
  track.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    window.clearTimeout(suppressResetTimer);
    activePointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartScrollLeft = track.scrollLeft;
    isDragging = false;
    suppressEditingClick = false;
    track.classList.add("is-pointer-down");
  });
  track.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStartX;
    if (!isDragging && Math.abs(deltaX) >= dragThreshold) {
      isDragging = true;
      suppressEditingClick = true;
      track.classList.add("is-dragging");
      track.setPointerCapture?.(event.pointerId);
    }
    if (!isDragging) return;
    event.preventDefault();
    track.scrollLeft = pointerStartScrollLeft - deltaX;
  });
  const finishPointerDrag = (event) => {
    if (activePointerId !== event.pointerId) return;
    const didDrag = isDragging;
    activePointerId = null;
    isDragging = false;
    track.classList.remove("is-pointer-down", "is-dragging");
    try { track.releasePointerCapture?.(event.pointerId); } catch {}
    if (didDrag) {
      requestAnimationFrame(snapToNearestCard);
      suppressResetTimer = window.setTimeout(() => { suppressEditingClick = false; }, 80);
    }
  };
  track.addEventListener("pointerup", finishPointerDrag);
  track.addEventListener("pointercancel", finishPointerDrag);

  // Do not capture wheel or keyboard input on the portfolio carousel.
  // Vertical wheel/trackpad scrolling must continue moving the public page.
  requestAnimationFrame(updateArrows);
}

function setupDynamicModuleCarousels() {
  document.querySelectorAll(".dynamic-module-carousel-shell").forEach((shell) => {
    const track = shell.querySelector(".dynamic-module-carousel-track");
    const left = shell.querySelector(".dynamic-module-left");
    const right = shell.querySelector(".dynamic-module-right");
    if (!track || !left || !right || track.dataset.dynamicCarouselBound === "true") return;
    track.dataset.dynamicCarouselBound = "true";
    const dragThreshold = 8;
    let activePointerId = null;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let suppressClick = false;
    let resetTimer = 0;
    const cardStep = () => {
      const card = track.querySelector(".dynamic-module-card");
      if (!card) return Math.max(240, Math.floor(track.clientWidth * .82));
      const styles = getComputedStyle(track);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "16") || 16;
      return card.getBoundingClientRect().width + gap;
    };
    const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
    const updateArrows = () => {
      const max = maxScroll();
      left.hidden = track.scrollLeft <= 4 || max < 6;
      right.hidden = track.scrollLeft >= max - 4 || max < 6;
    };
    const snap = () => {
      const step = cardStep();
      if (!step) return;
      const target = Math.min(maxScroll(), Math.max(0, Math.round(track.scrollLeft / step) * step));
      track.scrollTo({ left: target, behavior: "smooth" });
    };
    left.addEventListener("click", () => track.scrollBy({ left: -cardStep(), behavior: "smooth" }));
    right.addEventListener("click", () => track.scrollBy({ left: cardStep(), behavior: "smooth" }));
    track.addEventListener("scroll", updateArrows, { passive: true });
    track.addEventListener("dragstart", (event) => event.preventDefault());
    track.addEventListener("click", (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      suppressClick = false;
    }, true);
    track.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      clearTimeout(resetTimer);
      activePointerId = event.pointerId;
      startX = event.clientX;
      startScroll = track.scrollLeft;
      dragging = false;
      suppressClick = false;
      track.classList.add("is-pointer-down");
    });
    track.addEventListener("pointermove", (event) => {
      if (activePointerId !== event.pointerId) return;
      const delta = event.clientX - startX;
      if (!dragging && Math.abs(delta) >= dragThreshold) {
        dragging = true;
        suppressClick = true;
        track.classList.add("is-dragging");
        track.setPointerCapture?.(event.pointerId);
      }
      if (!dragging) return;
      event.preventDefault();
      track.scrollLeft = startScroll - delta;
    });
    const finish = (event) => {
      if (activePointerId !== event.pointerId) return;
      const didDrag = dragging;
      activePointerId = null;
      dragging = false;
      track.classList.remove("is-pointer-down", "is-dragging");
      try { track.releasePointerCapture?.(event.pointerId); } catch {}
      if (didDrag) {
        requestAnimationFrame(snap);
        resetTimer = setTimeout(() => { suppressClick = false; }, 80);
      }
    };
    track.addEventListener("pointerup", finish);
    track.addEventListener("pointercancel", finish);
    requestAnimationFrame(updateArrows);
  });
}

function updateThemeIcon() {
  const button = document.querySelector(".theme");
  if (!button) return;
  button.innerHTML = icon(document.documentElement.classList.contains("light") ? "sun" : "moon");
  window.lucide?.createIcons();
}

let modalOpener = null;
let modalCloseHook = null;
function closeModal() {
  const modal = document.querySelector("#modal");
  const video = modal?.querySelector("video");
  if (video) { video.pause(); video.currentTime = 0; }
  const closeHook = modalCloseHook;
  modalCloseHook = null;
  closeHook?.();
  if (modal) modal.innerHTML = "";
  document.body.classList.remove("public-modal-open");
  modalOpener?.focus?.();
  modalOpener = null;
}
function show(html, className = "", options = {}) {
  const modal = document.querySelector("#modal");
  if (!modal) return;
  const replacingOpenModal = document.body.classList.contains("public-modal-open");
  if (!replacingOpenModal) modalOpener = document.activeElement;
  if (replacingOpenModal && modalCloseHook) {
    const previousCloseHook = modalCloseHook;
    modalCloseHook = null;
    previousCloseHook();
  }
  const embeddedClose = options?.embeddedClose === true;
  const genericClose = embeddedClose ? "" : `<div class="public-modal-close-layer"><button class="close" type="button" aria-label="Close">${icon("x")}</button></div>`;
  modalCloseHook = typeof options?.onClose === "function" ? options.onClose : null;
  modal.innerHTML = `<div class="backdrop"><div class="modal-box lan-vertical-scroll-surface ${className}" role="dialog" aria-modal="true">${genericClose}${html}</div></div>`;
  document.body.classList.add("public-modal-open");
  const box = modal.querySelector(".modal-box");
  box?.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close], .public-modal-close-layer > .close")) closeModal();
  });
  modal.querySelector(".backdrop")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModal(); });
  modal.querySelector("[data-modal-close], .public-modal-close-layer > .close")?.focus();
  bindPublicMediaFrames(modal);
  window.lucide?.createIcons();
}
function handleModalKeydown(event) {
  const photoLightbox = document.querySelector("#modal [data-photo-gallery-lightbox]");
  if (photoLightbox) {
    if (event.key === "Escape") { photoLightbox.remove(); return; }
    if (event.key === "ArrowLeft") { photoLightbox.querySelector("[data-photo-gallery-prev]:not([disabled])")?.click(); return; }
    if (event.key === "ArrowRight") { photoLightbox.querySelector("[data-photo-gallery-next]:not([disabled])")?.click(); return; }
  }
  if (event.key === "Escape" && document.querySelector("#modal [data-dynamic-document-overlay]")) {
    closeDynamicDocumentPreview(document.querySelector("#modal .dynamic-module-viewer"));
    return;
  }
  if (event.key === "Escape" && document.querySelector("#modal .backdrop")) {
    closeModal();
    return;
  }
}
document.addEventListener("keydown", handleModalKeydown);

function runAfterSectionRender(hash, callback) {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(callback));
  if (location.hash === hash) {
    run();
    return;
  }
  window.addEventListener("hashchange", run, { once: true });
  location.hash = hash;
}

function openLinkedSource(moduleKey, documentId) {
  const key = cleanText(moduleKey).toLowerCase();
  const id = cleanText(documentId);
  if (!key) return;

  if (key === "projects") {
    if (!id) return;
    closeModal();
    openProjectById(id);
    return;
  }

  const module = getRegistryModule(key);
  if (!module) return;

  if (module.key === "experience") {
    closeModal();
    runAfterSectionRender(module.publicDestination || "#experience", () => {
      const item = document.querySelector(`[data-experience-id="${CSS.escape(documentId)}"]`);
      item?.scrollIntoView({ behavior: "smooth", block: "center" });
      item?.classList.add("source-highlight");
      setTimeout(() => item?.classList.remove("source-highlight"), 2200);
    });
    return;
  }

  if (module.key === "photo-editing") {
    closeModal();
    activeFilter = "All";
    render();
    runAfterSectionRender(module.publicDestination || "#photo-editing", () => {
      const item = id ? document.querySelector(`[data-photo-source-id="${CSS.escape(id)}"]`) : null;
      const target = item || document.querySelector(module.publicDestination || "#photo-editing");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      item?.classList.add("source-highlight");
      if (item) setTimeout(() => item.classList.remove("source-highlight"), 2200);
    });
    return;
  }

  if (module.dynamic === true) {
    closeModal();
    const sectionKey = module.sectionKey || module.key;
    const targetHash = module.publicDestination || `#${sectionKey}`;
    runAfterSectionRender(targetHash, () => {
      const card = document.querySelector(`[data-dynamic-module="${CSS.escape(sectionKey)}"] [data-dynamic-entry-card="${CSS.escape(id)}"]`);
      const target = card || document.querySelector(targetHash);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.classList.add("source-highlight");
      setTimeout(() => card?.classList.remove("source-highlight"), 2200);
      if (card) openDynamicEntry(sectionKey, id);
    });
  }
}

function hasPhotoModalMedia(item = {}) {
  const gallery = Array.isArray(item.galleryImages) ? item.galleryImages.filter(Boolean) : [];
  return Boolean(
    item.beforeImage
    || cleanText(item.beforeImageUrl)
    || item.afterImage
    || cleanText(item.afterImageUrl)
    || item.singleImage
    || cleanText(item.singleImageUrl)
    || item.coverAsset
    || item.coverImage
    || cleanText(item.coverImageUrl)
    || gallery.length
  );
}

function photoEditingMediaRole(item = {}) {
  const displayType = cleanText(item.displayType || item.projectDisplayType || "single").toLowerCase();
  if (displayType === "comparison") return { key: "comparison", label: "Before & After" };
  if (displayType === "gallery") {
    const count = photoGalleryMediaDescriptors(item).length;
    return { key: "gallery", label: `Gallery · ${count} ${count === 1 ? "image" : "images"}` };
  }
  return { key: "single", label: "Single Image" };
}

function photoEditingDetailFacts(source = {}, role = photoEditingMediaRole(source)) {
  const facts = [
    ["Category", cleanText(source.category)],
    ["Presentation", role.label]
  ];
  const techniques = Array.isArray(source.techniques) ? source.techniques.map(cleanText).filter(Boolean) : [];
  if (techniques.length) facts.push(["Techniques", techniques.join(" · ")]);
  return facts.filter(([, value]) => value);
}

function photoEditingDetailMediaMarkup(source = {}, role = photoEditingMediaRole(source)) {
  const beforeAsset = source.beforeImage || cleanText(source.beforeImageUrl) || null;
  const afterAsset = source.afterImage || cleanText(source.afterImageUrl) || null;
  const gallery = photoGalleryMediaDescriptors(source);

  if (role.key === "comparison" && beforeAsset && afterAsset) {
    return `<section class="photo-detail-media photo-detail-media--comparison" aria-label="Before and after comparison"><div class="public-comparison-pair"><figure class="public-comparison-panel">${publicMediaFrameMarkup(beforeAsset, `Before ${source.title}`, { className: "public-media-frame--detail", fallbackLabel: "Before", purpose: "detail" })}<figcaption class="public-comparison-label">BEFORE</figcaption></figure><figure class="public-comparison-panel">${publicMediaFrameMarkup(afterAsset, `After ${source.title}`, { className: "public-media-frame--detail", fallbackLabel: "After", purpose: "detail" })}<figcaption class="public-comparison-label">AFTER</figcaption></figure></div></section>`;
  }

  if (role.key === "gallery" && gallery.length) {
    return `<section class="photo-detail-media photo-detail-media--gallery" aria-label="${escapeHtml(role.label)}"><header class="photo-detail-section-head"><div><small>GALLERY & IMAGES</small><strong>${escapeHtml(role.label)}</strong></div><small class="photo-detail-gallery-hint">Select an image to view full size</small></header><div class="public-photo-gallery public-media-gallery" data-photo-detail-gallery data-gallery-count="${gallery.length}">${gallery.map((item, index) => `<button class="public-photo-gallery-item public-media-gallery-card" type="button" data-photo-gallery-open="${index}" data-gallery-shape="${escapeHtml(item.shape)}" data-media-width="${item.width}" data-media-height="${item.height}" aria-label="View image ${index + 1} of ${gallery.length}"><span class="public-photo-gallery-image public-media-gallery-stage">${publicMediaFrameMarkup(item.asset, `${source.title} image ${index + 1}`, { className: "public-media-frame--gallery", fallbackLabel: "Gallery image", purpose: "detail" })}</span><span class="public-photo-gallery-caption public-media-gallery-meta"><strong>Image ${String(index + 1).padStart(2, "0")}</strong><small>${escapeHtml(item.shape === "unknown" ? "Gallery image" : item.shape)}</small></span></button>`).join("")}</div></section>`;
  }

  const finalAsset = afterAsset || source.coverAsset || source.coverImage || cleanText(source.coverImageUrl) || beforeAsset || gallery[0]?.asset || source.singleImage || cleanText(source.singleImageUrl) || null;
  return `<section class="photo-detail-media photo-detail-media--single" aria-label="Single image showcase"><figure class="photo-detail-single-stage">${publicMediaFrameMarkup(finalAsset, source.title, { className: "public-media-frame--detail", fallbackLabel: "Photo editing media", purpose: "detail" })}</figure></section>`;
}

function photoEditingDetailNavigation(documentId) {
  const sources = photoItems().filter((item) => activeFilter === "All" || item.category === activeFilter);
  if (sources.length < 2) return "";
  const index = sources.findIndex((item) => item.id === documentId);
  if (index < 0) return "";
  const previous = sources[(index - 1 + sources.length) % sources.length];
  const next = sources[(index + 1) % sources.length];
  return `<button class="carousel-arrow photo-detail-record-nav is-prev" type="button" data-photo-record-nav="${escapeHtml(previous.id)}" aria-label="Previous photo editing sample">${icon("chevron-left")}</button><button class="carousel-arrow photo-detail-record-nav is-next" type="button" data-photo-record-nav="${escapeHtml(next.id)}" aria-label="Next photo editing sample">${icon("chevron-right")}</button>`;
}

function openPhotoEditingSource(documentId) {
  const linkedRawSource = sourceMaps.get("photo-editing")?.get(documentId);
  const linkedSource = linkedRawSource && isPublicRecord(linkedRawSource)
    ? normalizePhotoProject({ id: documentId, ...linkedRawSource })
    : null;
  const source = publicPhotoProjects.find((item) => item.id === documentId)
    || linkedSource
    || photoItems().find((item) => item.id === documentId);
  if (!source) return;

  const role = photoEditingMediaRole(source);
  const media = photoEditingDetailMediaMarkup(source, role);
  const facts = photoEditingDetailFacts(source, role);
  const description = cleanText(source.description);
  const factMarkup = facts.length
    ? `<section class="photo-detail-facts" aria-label="Photo editing details">${facts.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</section>`
    : "";
  const descriptionMarkup = description
    ? `<section class="photo-detail-about"><h3>ABOUT THIS EDIT</h3><p>${escapeHtml(description)}</p></section>`
    : "";
  const tagsMarkup = Array.isArray(source.tags) && source.tags.length
    ? `<section class="photo-detail-tags"><h3>SKILLS & TOOLS</h3><div class="tags">${tags(source.tags)}</div></section>`
    : "";

  const recordNavigation = photoEditingDetailNavigation(source.id);
  show(`${recordNavigation}<article class="photo-detail-shell" data-photo-detail-role="${escapeHtml(role.key)}"><header class="photo-detail-head"><div class="photo-detail-head-icon">${icon("camera")}</div><div><div class="photo-detail-kicker">PHOTO EDITING · ${escapeHtml(role.label.toUpperCase())}</div><h2>${escapeHtml(source.title)}</h2><p>${escapeHtml(source.category)}</p></div></header>${media}<div class="photo-detail-information">${factMarkup}${descriptionMarkup}${tagsMarkup}</div></article>`, "gallery-viewer photo-detail-viewer");

  const modal = document.querySelector("#modal");
  modal?.querySelectorAll?.("[data-photo-record-nav]").forEach((button) => {
    button.addEventListener("click", () => openPhotoEditingSource(button.dataset.photoRecordNav));
  });
  setupPhotoGalleryMediaShapes(modal);
  if (role.key === "gallery") setupPhotoDetailGalleryViewer(modal, source);
}

function setupPhotoDetailGalleryViewer(root, source = {}) {
  const viewer = root?.querySelector?.(".photo-detail-viewer");
  const gallery = photoGalleryMediaDescriptors(source);
  if (!viewer || !gallery.length) return;

  const open = (requestedIndex) => {
    const index = Math.max(0, Math.min(gallery.length - 1, Number(requestedIndex) || 0));
    const media = gallery[index];
    let overlay = viewer.querySelector("[data-photo-gallery-lightbox]");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "photo-gallery-lightbox";
      overlay.dataset.photoGalleryLightbox = "";
      overlay.innerHTML = `<button class="close photo-gallery-lightbox-close" type="button" data-photo-gallery-close aria-label="Close image viewer">${icon("x")}</button><button class="carousel-arrow photo-gallery-lightbox-nav is-prev" type="button" data-photo-gallery-prev aria-label="Previous gallery image">${icon("chevron-left")}</button><figure class="photo-gallery-lightbox-stage"><img data-photo-gallery-lightbox-image alt=""><figcaption data-photo-gallery-lightbox-caption></figcaption></figure><button class="carousel-arrow photo-gallery-lightbox-nav is-next" type="button" data-photo-gallery-next aria-label="Next gallery image">${icon("chevron-right")}</button>`;
      viewer.append(overlay);
      overlay.querySelector("[data-photo-gallery-close]")?.addEventListener("click", () => overlay.remove());
      overlay.querySelector("[data-photo-gallery-prev]")?.addEventListener("click", () => open(Number(overlay.dataset.galleryIndex) - 1));
      overlay.querySelector("[data-photo-gallery-next]")?.addEventListener("click", () => open(Number(overlay.dataset.galleryIndex) + 1));
    }
    overlay.dataset.galleryIndex = String(index);
    const image = overlay.querySelector("[data-photo-gallery-lightbox-image]");
    if (image) { image.src = media.url; image.alt = `${cleanText(source.title) || "Gallery"} image ${index + 1}`; }
    const caption = overlay.querySelector("[data-photo-gallery-lightbox-caption]");
    if (caption) caption.textContent = `Image ${index + 1} of ${gallery.length}`;
    overlay.querySelector("[data-photo-gallery-prev]")?.toggleAttribute("disabled", index === 0);
    overlay.querySelector("[data-photo-gallery-next]")?.toggleAttribute("disabled", index === gallery.length - 1);
    overlay.querySelector("[data-photo-gallery-close]")?.focus();
    window.lucide?.createIcons();
  };

  root.querySelectorAll("[data-photo-gallery-open]").forEach((button) => {
    button.addEventListener("click", () => open(button.dataset.photoGalleryOpen));
  });
}

function projectDetailGalleryMarkup(project = {}) {
  const raw = project.raw || project;
  const gallery = Array.isArray(raw.galleryImages)
    ? raw.galleryImages
        .map((asset, index) => ({ asset, index }))
        .filter((item) => Boolean(item.asset))
    : [];
  if (!gallery.length) return "";
  return `<section class="project-detail-gallery public-media-gallery" data-gallery-count="${gallery.length}" aria-label="Project screenshots">${gallery.map((item) => `<figure class="public-media-gallery-card"><span class="public-media-gallery-stage">${publicMediaFrameMarkup(item.asset, `Project screenshot ${item.index + 1}`, { className: "public-media-frame--gallery", fallbackLabel: "Project media", purpose: "detail" })}</span><figcaption class="public-media-gallery-meta"><strong>Screenshot ${String(item.index + 1).padStart(2, "0")}</strong></figcaption></figure>`).join("")}</section>`;
}

function projectDetailCapabilities(project = {}) {
  const rawProject = project.raw || project;
  const source = project.source && typeof project.source === "object" ? project.source : null;
  if (project.sourceModule?.key === "photo-editing") {
    return photoEditingModuleCapabilityGroups();
  }
  const sourceTools = source
    ? sourcePublicTools(source, firstNonEmptyArray(source.tools, source.toolsUsed, source.technologies, source.software))
    : [];
  const sourceSkills = source
    ? sourcePublicSkills(source, firstNonEmptyArray(source.skills, source.skillsUsed, source.techniques))
    : [];
  const tools = uniqueCapabilities([
    ...(Array.isArray(project.tools) ? project.tools : []),
    ...projectPublicTools(rawProject),
    ...sourceTools
  ]);
  const skills = uniqueCapabilities([
    ...(Array.isArray(project.skills) ? project.skills : []),
    ...projectPublicSkills(rawProject),
    ...sourceSkills
  ]);
  return { tools, skills };
}

function projectDetailCapabilityGroupsMarkup(groups = {}) {
  const tools = Array.isArray(groups.tools) ? groups.tools : [];
  const skills = Array.isArray(groups.skills) ? groups.skills : [];
  const markup = `${tools.length ? `<section class="project-detail-capability-group"><h3>Tools</h3><div class="tags">${projectCapabilityTagsMarkup(tools.map((item) => ({ type: "tool", item })))}</div></section>` : ""}${skills.length ? `<section class="project-detail-capability-group"><h3>Skills</h3><div class="tags">${projectCapabilityTagsMarkup(skills.map((item) => ({ type: "skill", item })))}</div></section>` : ""}`;
  return markup ? `<div class="project-detail-capabilities">${markup}</div>` : "";
}

function projectDetailHeaderMarkup(title, capabilityGroups = "", projectHours = "") {
  const hours = cleanText(projectHours);
  return `<header class="project-detail-header"><h2 class="project-detail-title">${escapeHtml(title)}</h2>${capabilityGroups}${hours ? `<p class="project-detail-meta"><strong>Project Hours:</strong><span>${escapeHtml(hours)}</span></p>` : ""}</header>`;
}

function projectLongDescriptionMarkup(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const paragraphs = text.split(/\r?\n\s*\r?\n+/).map((paragraph) => cleanText(paragraph)).filter(Boolean);
  const body = (paragraphs.length ? paragraphs : [text])
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
  return `<section class="project-detail-description"><span class="project-detail-description-label">Project overview</span><div class="project-detail-description-copy">${body}</div></section>`;
}

function bindProjectModalActions() {
  document.querySelectorAll("#modal [data-open-project]").forEach((button) => button.addEventListener("click", () => openProjectById(button.dataset.openProject)));
  document.querySelectorAll("#modal [data-project-details]").forEach((button) => button.addEventListener("click", () => openProjectDetailsById(button.dataset.projectDetails)));
  document.querySelectorAll("#modal [data-project-video]").forEach((button) => button.addEventListener("click", () => openProjectVideoResource(button.dataset.projectVideo, button.dataset.projectVideoUrl)));
  document.querySelectorAll("#modal [data-linked-module]").forEach((button) => button.addEventListener("click", () => openLinkedSource(button.dataset.linkedModule, button.dataset.linkedId)));
}

function normalizedVideoEmbedUrl(value = "") {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : "";
    }
    if (host.includes("youtube.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = url.searchParams.get("v") || (parts[0] === "shorts" || parts[0] === "embed" ? parts[1] : "");
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : "";
    }
    if (host.includes("vimeo.com")) {
      const id = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
      return id ? `https://player.vimeo.com/video/${id}` : "";
    }
    if (host === "drive.google.com") {
      const match = url.pathname.match(/\/file\/d\/([^/]+)/);
      return match?.[1] ? `https://drive.google.com/file/d/${encodeURIComponent(match[1])}/preview` : "";
    }
  } catch {}
  return "";
}

function openProjectVideoResource(projectId, requestedUrl = "") {
  const project = projectItems().find((item) => item.id === projectId);
  if (!project) return;
  const raw = project.raw || {};
  const url = cleanText(requestedUrl)
    || mediaUrl(project.demoVideo)
    || mediaUrl(raw.demoVideo || raw.video)
    || cleanText(raw.externalVideo?.embedUrl || raw.externalVideo?.url || raw.externalVideoUrl || raw.youtubeUrl);
  if (!url) {
    openProjectDetailsById(projectId);
    return;
  }
  const embed = normalizedVideoEmbedUrl(url) || (/\/embed\/|player\.vimeo\.com|drive\.google\.com\/file\/d\/.+\/preview/i.test(url) ? url : "");
  const media = embed
    ? `<iframe class="project-demo-embed" src="${escapeHtml(embed)}" title="${escapeHtml(project.title)} demo video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
    : `<video class="blender-player" controls playsinline autoplay preload="metadata" poster="${escapeHtml(project.image || "")}"><source src="${escapeHtml(url)}">Your browser cannot play this video.</video>`;
  show(`<div class="modal-heading"><div>${icon("play")}</div><div><h2>${escapeHtml(project.title)}</h2><p>Project video</p></div></div>${media}`, "project-video-viewer");
  const viewer = document.querySelector("#modal video.blender-player");
  if (viewer) {
    viewer.muted = false;
    viewer.volume = 1;
    viewer.play().catch(() => {});
  }
}

function openProjectDetailsById(projectId) {
  const project = projectItems().find((item) => item.id === projectId);
  if (!project) return;
  if (project.projectType !== "linked-module") {
    openProjectById(projectId);
    return;
  }
  const capabilityGroups = projectDetailCapabilityGroupsMarkup(projectDetailCapabilities(project));
  const description = cleanText(project.raw?.fullDescription || project.raw?.description || project.description);
  const coverSource = project.raw?.coverImage || project.raw?.image || project.raw?.thumbnail || project.image || null;
  const media = `<div class="full-image project-detail-cover-frame">${publicMediaFrameMarkup(coverSource, project.title, { className: "public-media-frame--detail", fallbackLabel: "Project media", loading: "eager", purpose: "detail", priority: "high" })}</div>`;
  show(`${media}${projectDetailHeaderMarkup(project.title, capabilityGroups)}${projectLongDescriptionMarkup(description)}<div class="actions public-project-actions">${projectActionMarkup(project)}</div>`, "project-viewer");
  bindProjectModalActions();
}

function openProjectById(projectId) {
  const project = projectItems().find((item) => item.id === projectId);
  if (!project) return;
  if (project.projectType === "linked-module") {
    if (project.primaryAction?.type === "linked" && project.primaryAction.documentId) {
      openLinkedSource(project.primaryAction.moduleKey, project.primaryAction.documentId);
      return;
    }
    if (project.primaryAction?.type === "anchor" && cleanText(project.primaryAction.url).startsWith("#")) {
      document.querySelector(project.primaryAction.url)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    openProjectDetailsById(projectId);
    return;
  }
  const raw = project.raw || {};
  const videoUrl = mediaUrl(project.demoVideo) || cleanText(project.primaryAction?.type === "video" ? project.primaryAction.url : "");
  const externalVideo = mediaUrl(project.externalVideo);
  const pdfUrl = mediaUrl(project.pdf);
  const sourceUrl = mediaUrl(project.sourceFile);
  const liveUrl = cleanText(project.liveUrl);
  const media = videoUrl
    ? `<video class="blender-player" controls playsinline preload="metadata" poster="${escapeHtml(project.image)}"><source src="${escapeHtml(videoUrl)}" type="video/mp4">Your browser cannot play this video.</video>`
    : `<div class="full-image project-detail-cover-frame">${publicMediaFrameMarkup(raw.coverImage || raw.image || raw.thumbnail || project.image || null, project.title, { className: "public-media-frame--detail", fallbackLabel: "Project media", loading: "eager", purpose: "detail", priority: "high" })}</div>`;
  const galleryMarkup = projectDetailGalleryMarkup(raw);
  const actions = [
    liveUrl ? `<a class="btn small" href="${escapeHtml(liveUrl)}" target="_blank" rel="noopener noreferrer">Live Website</a>` : "",
    project.githubUrl ? `<a class="btn small ghost" href="${escapeHtml(project.githubUrl)}" target="_blank" rel="noopener noreferrer">${icon("github")} GitHub</a>` : "",
    externalVideo ? `<a class="btn small ghost" href="${escapeHtml(externalVideo)}" target="_blank" rel="noopener noreferrer">Open Video</a>` : "",
    pdfUrl ? `<a class="btn small ghost" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer">Open PDF</a>` : "",
    sourceUrl ? `<a class="btn small ghost" href="${escapeHtml(sourceUrl)}" download>Download</a>` : ""
  ].filter(Boolean).join("");
  const capabilityGroups = projectDetailCapabilityGroupsMarkup(projectDetailCapabilities(project));
  const projectHours = formatHours(project.projectHours);
  const description = cleanText(raw.fullDescription || raw.description || project.description);
  show(`${media}${galleryMarkup}${projectDetailHeaderMarkup(project.title, capabilityGroups, projectHours)}${projectLongDescriptionMarkup(description)}${actions ? `<div class="actions public-project-actions">${actions}</div>` : ""}`, "project-viewer");
}

function openResumeChooser() {
  const resumes = Array.isArray(content.resumes) ? content.resumes.filter((item) => cleanText(item.file)) : [];
  if (!resumes.length) {
    show(`<div class="modal-heading"><div>${icon("file-text")}</div><div><h2>Resume</h2><p>No published resume is available yet.</p></div></div>`, "resume-chooser");
    return;
  }
  show(`<div class="modal-heading"><div>${icon("file-text")}</div><div><h2>Choose a Resume</h2><p>Select a resume to preview or download.</p></div></div><div class="resume-grid">${resumes.map((item, index) => `<button class="resume-choice" data-choice="${index}">${icon("file-text")}<span><strong>${escapeHtml(item.title)}</strong><small>Preview PDF or download a copy</small></span>${icon("chevron-right")}</button>`).join("")}</div>`, "resume-chooser");
  document.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", () => openResume(resumes[Number(button.dataset.choice)])));
}
function openResume(item) {
  show(`<div class="resume-view-head"><div><h2>${escapeHtml(item.title)}</h2><p>Preview the document below or open it in a new tab.</p></div><div class="actions"><a class="btn small" target="_blank" rel="noopener noreferrer" href="${escapeHtml(item.file)}">Open PDF</a><a class="btn small ghost" download href="${escapeHtml(item.file)}">Download</a></div></div><iframe title="${escapeHtml(item.title)}" src="${escapeHtml(browserPdfViewerSource(item.file))}"></iframe>`, "resume-viewer");
}

function isPortfolioSyncPayload(payload = null) {
  return Boolean(payload && typeof payload === "object" && payload.type === "portfolio-content-changed");
}

function schedulePublicPortfolioRefresh(payload = null) {
  if (!isPortfolioSyncPayload(payload) || publicDataMode !== "firestore" || !firebase?.db) return;
  window.clearTimeout(publicRefreshTimer);
  publicRefreshTimer = window.setTimeout(async () => {
    if (publicRefreshInFlight) {
      schedulePublicPortfolioRefresh(payload);
      return;
    }
    publicRefreshInFlight = true;
    const scrollTop = window.scrollY;
    try {
      await loadPublicPortfolioData();
      render();
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollTop, left: 0, behavior: "auto" }));
    } catch (error) {
      console.warn("Public portfolio live refresh failed; the next page load will retry.", error);
    } finally {
      publicRefreshInFlight = false;
    }
  }, 180);
}

function installPublicPortfolioSync() {
  if (publicSyncInstalled) return;
  publicSyncInstalled = true;

  window.addEventListener("storage", (event) => {
    if (event.key !== PUBLIC_SYNC_STORAGE_KEY || !event.newValue) return;
    try { schedulePublicPortfolioRefresh(JSON.parse(event.newValue)); } catch {}
  });

  try {
    if (typeof BroadcastChannel === "function") {
      publicSyncChannel = new BroadcastChannel(PUBLIC_SYNC_CHANNEL);
      publicSyncChannel.addEventListener("message", (event) => schedulePublicPortfolioRefresh(event.data));
    }
  } catch {
    publicSyncChannel = null;
  }
}

(async () => {
  if (localStorage.getItem("theme") === "light") document.documentElement.classList.add("light");
  document.documentElement.dataset.theme = document.documentElement.classList.contains("light") ? "light" : "dark";
  document.documentElement.dataset.cmsThemeResolved = document.documentElement.dataset.theme;
  installPublicPortfolioSync();

  try {
    const ready = await initFirebase();
    if (!ready) await loadEmergencyFallback("Firebase/Firestore initialization failed");
    render();
  } catch (error) {
    console.error("Public portfolio startup failed.", error);
    try {
      await loadEmergencyFallback(error);
      render();
      } catch (fallbackError) {
      console.error("Emergency portfolio recovery also failed.", fallbackError);
      app.innerHTML = `<main class="public-runtime-error"><h1>LΛN Portfolio</h1><p>The portfolio could not be loaded. Please try again shortly.</p></main>`;
    }
  } finally {
    requestAnimationFrame(() => document.querySelector("#siteLoader")?.classList.add("is-hidden"));
  }
})();
