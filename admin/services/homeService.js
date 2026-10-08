import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { cleanupRemovedMediaAssets } from "./mediaAssetLifecycleService.js";
import { PUBLIC_LAYOUT_PRESETS, PUBLIC_LAYOUT_MODES, defaultPublicLayoutPreset, normalizePublicRowPairing } from "../../public-layout-contract.js";
import { normalizeAssetReference, assetReferenceIdentity } from "../../asset-resolver.js";

const HOME_REF = doc(db, "portfolio", "home");
const PROFILE_REF = doc(db, "portfolio", "profile");
const text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const list = (value) => Array.isArray(value)
  ? value.map((item) => text(item)).filter(Boolean)
  : text(value).split(",").map((item) => item.trim()).filter(Boolean);

function mediaValue(value) {
  return normalizeAssetReference(value) || "";
}


function sameMediaReference(first, second) {
  if (!first || !second) return false;
  const left = assetReferenceIdentity(first);
  const right = assetReferenceIdentity(second);
  return Boolean(left && right && left === right);
}


export const defaultSectionOrder = ["about", "experience", "projects", "photo-editing", "education", "skills", "certificates", "resume", "services", "contact"];
export const defaultHomeData = Object.freeze({
  eyebrow: "Hello, I'm", displayName: "Rolando Lagmay Jr.", brand: "LΛN", headline: "Information Technology Professional",
  roles: [], introduction: "", portrait: "", portraitAlt: "Portfolio portrait", primaryCtaLabel: "View My Work",
  primaryCtaDestination: "#projects", secondaryCtaLabel: "View Resumes", secondaryCtaDestination: "#resumes",
  status: "published", visible: true, footerText: "", aboutImage: "", aboutImageAlt: "About portrait",
  aboutTitleOverride: "", aboutSubtitle: "", aboutVisible: true, aboutOrder: 100,
  sections: defaultSectionOrder.map((key, index) => ({ key, enabled: true, order: (index + 1) * 100, layoutMode: "auto", layoutPreset: defaultPublicLayoutPreset(key), overflowMode: "auto", rowPairing: "none", rowPairingExplicit: true, rowPartnerKey: "" }))
});

export function normalizeHomeData(raw = {}) {
  const sections = Array.isArray(raw.sections) ? raw.sections : defaultHomeData.sections;
  return {
    eyebrow: text(raw.eyebrow, defaultHomeData.eyebrow),
    displayName: text(raw.displayName || raw.name, defaultHomeData.displayName),
    brand: text(raw.brand, defaultHomeData.brand),
    headline: text(raw.headline || raw.professionalHeadline, defaultHomeData.headline),
    roles: list(raw.roles),
    introduction: text(raw.introduction || raw.intro),
    portrait: mediaValue(raw.portrait || raw.image),
    portraitAlt: text(raw.portraitAlt || raw.imageAlt, defaultHomeData.portraitAlt),
    primaryCtaLabel: text(raw.primaryCtaLabel, defaultHomeData.primaryCtaLabel),
    primaryCtaDestination: text(raw.primaryCtaDestination, defaultHomeData.primaryCtaDestination),
    secondaryCtaLabel: text(raw.secondaryCtaLabel, defaultHomeData.secondaryCtaLabel),
    secondaryCtaDestination: text(raw.secondaryCtaDestination, defaultHomeData.secondaryCtaDestination),
    status: text(raw.status, "published") === "draft" ? "draft" : "published",
    visible: raw.visible !== false,
    footerText: text(raw.footerText),
    aboutImage: mediaValue(raw.aboutImage || raw.homeAboutImage),
    aboutImageAlt: text(raw.aboutImageAlt || raw.homeAboutImageAlt, "About portrait"),
    aboutTitleOverride: text(raw.aboutTitleOverride),
    aboutSubtitle: text(raw.aboutSubtitle),
    aboutVisible: raw.aboutVisible !== false,
    aboutOrder: Number(raw.aboutOrder) || 100,
    sections: sections
      .map((section, index) => ({
        key: text(section.key), enabled: section.enabled !== false, order: Number(section.order) || ((index + 1) * 100),
        layoutMode: PUBLIC_LAYOUT_MODES.includes(text(section.layoutMode).toLowerCase()) ? text(section.layoutMode).toLowerCase() : "auto",
        layoutPreset: PUBLIC_LAYOUT_PRESETS.includes(text(section.layoutPreset).toLowerCase()) ? text(section.layoutPreset).toLowerCase() : defaultPublicLayoutPreset(section.key),
        overflowMode: ["auto","vertical","horizontal","show-more","natural"].includes(text(section.overflowMode).toLowerCase()) ? text(section.overflowMode).toLowerCase() : "auto",
        ...(() => { const pairing = normalizePublicRowPairing(section); return { rowPairing: pairing.mode, rowPairingExplicit: true, rowPartnerKey: pairing.partnerKey }; })()
      }))
      .filter((section) => section.key)
  };
}

export async function loadHome() {
  const [homeSnapshot, profileSnapshot] = await Promise.all([getDoc(HOME_REF), getDoc(PROFILE_REF)]);
  const rawHome = homeSnapshot.exists() ? homeSnapshot.data() : null;
  const data = rawHome ? normalizeHomeData(rawHome) : { ...defaultHomeData };
  if (!data.aboutImage && profileSnapshot.exists()) {
    const profile = profileSnapshot.data();
    data.aboutImage = mediaValue(profile.profileImage || profile.image);
  }
  return { ...data, id: "home", legacyAboutImageFallback: !rawHome || !mediaValue(rawHome.aboutImage) };
}

export async function saveHomeSections(value = []) {
  const normalized = normalizeHomeData({ sections: value }).sections;
  await setDoc(HOME_REF, { sections: normalized, updatedAt: serverTimestamp() }, { merge: true });
  return normalized;
}

export async function removeHomeSectionRegistration(sectionKey = "") {
  const target = text(sectionKey).toLowerCase();
  if (!target) return false;
  const snapshot = await getDoc(HOME_REF);
  if (!snapshot.exists()) return false;
  const raw = snapshot.data() || {};
  const current = Array.isArray(raw.sections) ? raw.sections : [];
  const next = current.filter((section) => text(section?.key).toLowerCase() !== target);
  if (next.length === current.length) return false;
  const normalized = normalizeHomeData({ sections: next }).sections;
  await setDoc(HOME_REF, { sections: normalized, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

export async function saveHome(raw) {
  const data = normalizeHomeData(raw);
  if (!data.displayName) throw new Error("Display name is required.");
  if (!data.introduction) throw new Error("Hero introduction is required.");
  const [previousSnapshot, profileSnapshot] = await Promise.all([getDoc(HOME_REF), getDoc(PROFILE_REF)]);
  const previous = previousSnapshot.exists() ? normalizeHomeData(previousSnapshot.data() || {}) : {};
  const profileImage = profileSnapshot.exists() ? mediaValue(profileSnapshot.data()?.profileImage || profileSnapshot.data()?.image) : "";
  const previousOwnedAboutImage = previous.aboutImage && !sameMediaReference(previous.aboutImage, profileImage) ? previous.aboutImage : "";
  await setDoc(HOME_REF, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  await cleanupRemovedMediaAssets(
    { portrait: previous.portrait || "", aboutImage: previousOwnedAboutImage },
    { portrait: data.portrait || "", aboutImage: data.aboutImage || "" },
    { reason: "home-media-updated" }
  );
  return data;
}
