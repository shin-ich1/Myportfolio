import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";

const REF = doc(db, "portfolio", "contact");
const text = (value = "") => String(value ?? "").trim();
const legacyTypes = ["phone", "github", "linkedin", "facebook"];

function normalizeMethods(raw = {}) {
  const source = Array.isArray(raw.methods)
    ? raw.methods
    : Array.isArray(raw.contactMethods)
      ? raw.contactMethods
      : [];
  const normalized = source.map((method, index) => ({
    type: text(method?.type).toLowerCase() || "other",
    label: text(method?.label || method?.type || "Contact"),
    value: text(method?.value || method?.url),
    visible: method?.visible !== false,
    displayOrder: Number(method?.displayOrder) || ((index + 1) * 10)
  })).filter((method) => method.value);

  legacyTypes.forEach((type, index) => {
    const value = text(raw[type]);
    if (!value || normalized.some((method) => method.type === type)) return;
    normalized.push({
      type,
      label: type === "github" ? "GitHub" : type === "linkedin" ? "LinkedIn" : type === "facebook" ? "Facebook" : "Phone",
      value,
      visible: true,
      displayOrder: (index + 1) * 10
    });
  });

  return normalized.sort((a,b) => a.displayOrder - b.displayOrder);
}

export const normalizeContact = (raw = {}) => ({
  heading: text(raw.heading || raw.contactHeading || raw.title || "Let's Work Together"),
  message: text(raw.message || raw.contactMessage || raw.description),
  email: text(raw.email || raw.publicEmail || raw.contactEmail),
  phone: text(raw.phone || raw.phoneNumber || raw.contactPhone),
  location: text(raw.location || raw.contactLocation),
  github: text(raw.github || raw.githubUrl),
  linkedin: text(raw.linkedin || raw.linkedinUrl),
  facebook: text(raw.facebook || raw.facebookUrl),
  availability: text(raw.availability || raw.availabilityStatus),
  methods: normalizeMethods(raw),
  status: text(raw.status || raw.contactStatus).toLowerCase() === "draft" ? "draft" : "published",
  visible: typeof raw.visible === "boolean" ? raw.visible : raw.contactVisible !== false
});

export async function loadContact() {
  const snapshot = await getDoc(REF);
  return snapshot.exists() ? normalizeContact(snapshot.data()) : normalizeContact();
}

export async function saveContact(raw) {
  const data = normalizeContact(raw);
  if (!data.email) throw new Error("Public email is required.");
  await setDoc(REF, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return data;
}
