const clean = (value = "") => String(value ?? "").trim();

export function definitionKey(value = "") {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function uniqueDefinitionKey(value = "", usedKeys = new Set(), fallback = "field") {
  const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys || []);
  const base = definitionKey(value) || definitionKey(fallback) || "field";
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const suffixText = `_${suffix}`;
    const candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`.slice(0, 64);
}

export function resolveSmartDefinitionKey({
  label = "",
  currentKey = "",
  persisted = false,
  usedKeys = new Set(),
  fallback = "field"
} = {}) {
  if (persisted && definitionKey(currentKey)) return definitionKey(currentKey);
  return uniqueDefinitionKey(label, usedKeys, fallback);
}
