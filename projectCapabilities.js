/* LΛN Portfolio CMS - shared Project capability presentation rules */

const clean = (value = "") => String(value ?? "").trim();

export function normalizePublicTagMode(value = "automatic") {
  return clean(value).toLowerCase() === "custom" ? "custom" : "automatic";
}

export function normalizePublicTagRefs(value = [], legacyToolIds = []) {
  const refs = [];
  const seen = new Set();
  const source = Array.isArray(value) ? value : [];

  const add = (type, id) => {
    const normalizedType = clean(type).toLowerCase() === "skill" ? "skill" : "tool";
    const normalizedId = clean(id);
    if (!normalizedId) return;
    const key = `${normalizedType}:${normalizedId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ type: normalizedType, id: normalizedId });
  };

  source.forEach((entry) => {
    if (typeof entry === "string") {
      const match = entry.match(/^(tool|skill)\s*:\s*(.+)$/i);
      if (match) add(match[1], match[2]);
      return;
    }
    if (entry && typeof entry === "object") add(entry.type || entry.recordType, entry.id || entry.recordId);
  });

  if (!refs.length) {
    const legacy = Array.isArray(legacyToolIds)
      ? legacyToolIds
      : typeof legacyToolIds === "string"
        ? legacyToolIds.split(",")
        : [];
    legacy.forEach((id) => add("tool", id));
  }

  return refs;
}

export function capabilityRef(type = "tool", record = {}) {
  const id = clean(record?.id);
  if (!id) return null;
  return { type: type === "skill" ? "skill" : "tool", id };
}

export function resolvePublicProjectCapabilities({
  tools = [],
  skills = [],
  mode = "automatic",
  refs = []
} = {}) {
  const unique = (records = []) => {
    const seen = new Set();
    return (Array.isArray(records) ? records : []).filter((record) => {
      const id = clean(record?.id);
      const name = clean(record?.name).toLowerCase();
      const key = id || name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const availableTools = unique(tools);
  const availableSkills = unique(skills);
  const normalizedMode = normalizePublicTagMode(mode);

  if (normalizedMode !== "custom") {
    const preferred = availableTools.length ? availableTools : availableSkills;
    const type = availableTools.length ? "tool" : "skill";
    return preferred.map((item) => ({ type, item }));
  }

  const toolById = new Map(availableTools.map((item) => [clean(item.id), item]).filter(([id]) => id));
  const skillById = new Map(availableSkills.map((item) => [clean(item.id), item]).filter(([id]) => id));
  return normalizePublicTagRefs(refs).map((ref) => {
    const item = ref.type === "skill" ? skillById.get(ref.id) : toolById.get(ref.id);
    return item ? { type: ref.type, item } : null;
  }).filter(Boolean);
}

export function validPublicTagRefs({ tools = [], skills = [], refs = [] } = {}) {
  const toolIds = new Set((Array.isArray(tools) ? tools : []).map((item) => clean(item?.id)).filter(Boolean));
  const skillIds = new Set((Array.isArray(skills) ? skills : []).map((item) => clean(item?.id)).filter(Boolean));
  return normalizePublicTagRefs(refs).filter((ref) => ref.type === "skill" ? skillIds.has(ref.id) : toolIds.has(ref.id));
}
