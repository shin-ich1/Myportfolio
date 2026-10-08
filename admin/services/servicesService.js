import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { normalizeSystemIconName } from "../../icon-registry.js";

const SERVICES_REF = doc(db, "portfolio", "services");
const safe = (value = "") => String(value ?? "").trim();
const bool = (value, fallback = true) => value === undefined || value === null ? fallback : value === true || value === "true" || value === 1 || value === "1";
const slug = (value = "") => safe(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);

export const DEFAULT_SERVICES = Object.freeze({
  heading: "Work With Me",
  intro: "Practical support for data, administrative, and creative work — available for remote opportunities.",
  ctaLabel: "Work With Me",
  status: "draft",
  visible: true,
  services: Object.freeze([
    Object.freeze({ id: "data-entry", title: "Data Entry & Encoding", description: "Accurate data entry, record encoding, spreadsheet updates, PDF-to-Excel transfer, and structured information organization.", icon: "keyboard", visible: true, displayOrder: 10 }),
    Object.freeze({ id: "excel", title: "Excel & Spreadsheet Work", description: "Spreadsheet formatting, cleanup, formulas, validation, lookup functions, data organization, and basic automation.", icon: "table-2", visible: true, displayOrder: 20 }),
    Object.freeze({ id: "file-organization", title: "File & Data Organization", description: "Organizing digital files, folders, documents, photos, records, naming systems, and structured data.", icon: "folders", visible: true, displayOrder: 30 }),
    Object.freeze({ id: "research", title: "Online Research", description: "Web research, information gathering, source organization, data collection, and structured research results.", icon: "search", visible: true, displayOrder: 40 }),
    Object.freeze({ id: "admin-support", title: "Administrative Support", description: "Documentation, repetitive administrative tasks, record management, file handling, and written task support.", icon: "clipboard-list", visible: true, displayOrder: 50 }),
    Object.freeze({ id: "photo-editing", title: "Photo Editing", description: "Background removal, image cleanup, basic retouching, color correction, thumbnail preparation, and visual editing.", icon: "image", visible: true, displayOrder: 60 })
  ]),
  availability: Object.freeze([
    Object.freeze({ id: "one-time", label: "One-Time Tasks", enabled: true, displayOrder: 10 }),
    Object.freeze({ id: "part-time", label: "Part-Time", enabled: true, displayOrder: 20 }),
    Object.freeze({ id: "contract", label: "Contract / Project-Based", enabled: true, displayOrder: 30 }),
    Object.freeze({ id: "full-time", label: "Full-Time", enabled: true, displayOrder: 40 }),
    Object.freeze({ id: "ongoing", label: "Ongoing Freelance", enabled: true, displayOrder: 50 }),
    Object.freeze({ id: "remote", label: "Remote Work", enabled: true, displayOrder: 60 })
  ]),
  contact: Object.freeze({
    emailEnabled: true,
    emailLabel: "Email Me",
    email: "",
    linkedinEnabled: true,
    linkedinLabel: "LinkedIn",
    linkedinUrl: "",
    copyEmailEnabled: true,
    copyEmailLabel: "Copy Email"
  }),
  emailSubject: "Work Opportunity for Rolando Lagmay Jr.",
  emailTemplate: "Hi Rolando,\n\nI'm interested in discussing a work opportunity.\n\nType of work:\nWork arrangement:\nTask / project details:\nTimeline:\n"
});

function normalizeService(item = {}, index = 0) {
  const title = safe(item.title || item.name || `Service ${index + 1}`);
  return {
    id: slug(item.id || title) || `service-${index + 1}`,
    title,
    description: safe(item.description),
    icon: normalizeSystemIconName(item.icon || "sparkles"),
    visible: bool(item.visible, true),
    displayOrder: Number.isFinite(Number(item.displayOrder)) ? Number(item.displayOrder) : (index + 1) * 10
  };
}

function normalizeAvailability(item = {}, index = 0) {
  const label = safe(item.label || item.title || `Option ${index + 1}`);
  return {
    id: slug(item.id || label) || `availability-${index + 1}`,
    label,
    enabled: bool(item.enabled, true),
    displayOrder: Number.isFinite(Number(item.displayOrder)) ? Number(item.displayOrder) : (index + 1) * 10
  };
}

export function normalizeServices(raw = {}) {
  const fallbackServices = DEFAULT_SERVICES.services.map((item) => ({ ...item }));
  const fallbackAvailability = DEFAULT_SERVICES.availability.map((item) => ({ ...item }));
  const contactRaw = raw.contact && typeof raw.contact === "object" ? raw.contact : {};
  return {
    heading: safe(raw.heading || raw.title || DEFAULT_SERVICES.heading),
    intro: safe(raw.intro || raw.description || DEFAULT_SERVICES.intro),
    ctaLabel: safe(raw.ctaLabel || DEFAULT_SERVICES.ctaLabel),
    status: safe(raw.status).toLowerCase() === "published" ? "published" : "draft",
    visible: bool(raw.visible, true),
    services: (Array.isArray(raw.services) ? raw.services : fallbackServices).map(normalizeService).filter((item) => item.title).sort((a, b) => a.displayOrder - b.displayOrder),
    availability: (Array.isArray(raw.availability) ? raw.availability : fallbackAvailability).map(normalizeAvailability).filter((item) => item.label).sort((a, b) => a.displayOrder - b.displayOrder),
    contact: {
      emailEnabled: bool(contactRaw.emailEnabled, true),
      emailLabel: safe(contactRaw.emailLabel || DEFAULT_SERVICES.contact.emailLabel),
      email: safe(contactRaw.email),
      linkedinEnabled: bool(contactRaw.linkedinEnabled, true),
      linkedinLabel: safe(contactRaw.linkedinLabel || DEFAULT_SERVICES.contact.linkedinLabel),
      linkedinUrl: safe(contactRaw.linkedinUrl),
      copyEmailEnabled: bool(contactRaw.copyEmailEnabled, true),
      copyEmailLabel: safe(contactRaw.copyEmailLabel || DEFAULT_SERVICES.contact.copyEmailLabel)
    },
    emailSubject: safe(raw.emailSubject || DEFAULT_SERVICES.emailSubject),
    emailTemplate: String(raw.emailTemplate ?? DEFAULT_SERVICES.emailTemplate).trim()
  };
}

export async function loadServices() {
  const snapshot = await getDoc(SERVICES_REF);
  return normalizeServices(snapshot.exists() ? snapshot.data() : DEFAULT_SERVICES);
}

export async function saveServices(raw = {}, statusOverride = null) {
  const value = normalizeServices({ ...raw, ...(statusOverride ? { status: statusOverride } : {}) });
  if (!value.heading) throw new Error("Work With Me heading is required.");
  if (!value.intro) throw new Error("Intro text is required.");
  if (!value.services.some((item) => item.visible && item.title && item.description)) throw new Error("Add at least one visible service with a description.");
  if (value.status === "published") {
    if ((value.contact.emailEnabled || value.contact.copyEmailEnabled) && !value.contact.email) {
      throw new Error("Add the Services email address or disable Email Me and Copy Email before publishing.");
    }
    if (value.contact.linkedinEnabled && !value.contact.linkedinUrl) {
      throw new Error("Add the Services LinkedIn URL or disable LinkedIn before publishing.");
    }
    if (!value.contact.emailEnabled && !value.contact.copyEmailEnabled && !value.contact.linkedinEnabled) {
      throw new Error("Enable at least one Services contact method before publishing.");
    }
  }
  await setDoc(SERVICES_REF, { ...value, updatedAt: serverTimestamp() }, { merge: true });
  return value;
}
