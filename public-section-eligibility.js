export const PUBLIC_LAYOUT_SECTION_KEYS = Object.freeze([
  "about",
  "experience",
  "projects",
  "photo-editing",
  "education",
  "certificates",
  "contact"
]);

export function isPublicLayoutSectionKey(key = "") {
  return PUBLIC_LAYOUT_SECTION_KEYS.includes(String(key || "").trim());
}

export function publicSectionEligibility({ enabled = true, records = null, contentAvailable, navigation = true } = {}) {
  const list = Array.isArray(records) ? records : null;
  const entryCount = list ? list.length : 0;
  const hasContent = typeof contentAvailable === 'boolean' ? contentAvailable : entryCount > 0;
  const section = enabled !== false && hasContent;
  return {
    section,
    navigation: section && navigation !== false,
    contentAvailable: hasContent,
    entryCount
  };
}
