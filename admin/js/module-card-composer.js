import { isCoreEntryPropertyKey, resolveModuleFieldSemanticRole, resolveModuleEntryCardSemantics, resolveModuleCardProfile } from '../../module-platform.js';
import { resolveModuleRecordMedia } from '../../record-media.js';

const clean = (value = '') => String(value ?? '').trim();
const MEDIA_TYPES = new Set(['image', 'images', 'gallery', 'video', 'audio']);
const DOCUMENT_TYPES = new Set(['pdf', 'document', 'file', 'project-file', 'files']);
const NARRATIVE_TYPES = new Set(['textarea', 'rich-text']);
const TAG_TYPES = new Set(['tags']);

function valueFor(entry = {}, field = {}) {
  return entry?.data?.[field.key] ?? entry?.[field.key];
}

function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return !value.some((item) => !isEmpty(item));
  if (typeof value === 'object') return !Object.values(value).some((item) => !isEmpty(item));
  return false;
}

function displayText(value) {
  if (isEmpty(value)) return '';
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join(', ');
  if (typeof value === 'object') return clean(value.label || value.name || value.title || value.originalFilename || value.displayName || value.value || value.url);
  return clean(value);
}

function autoRole(field = {}) {
  return resolveModuleFieldSemanticRole(field);
}


function formatHumanDate(value = "") {
  const raw = clean(value);
  if (!raw) return "";
  if (/^\d{4}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(year, Math.max(0, month - 1), 1));
  }
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function humanMetaValue(fact = {}) {
  const role = clean(fact.role);
  if (role === "publication-date") return formatHumanDate(fact.value);
  if (role === "reading-time") {
    const raw = clean(fact.value);
    if (!raw) return "";
    if (/\b(?:min|minute|minutes|hour|hours|read)\b/i.test(raw)) return raw;
    const number = Number(raw);
    return Number.isFinite(number) ? `${number} min read` : raw;
  }
  return clean(fact.value);
}

function metaShowsLabel(role = "") {
  return !["byline", "publication-date", "reading-time"].includes(clean(role));
}

function traitSetForField(field = {}, value) {
  if (isEmpty(value)) return [];
  const role = autoRole(field);
  const traits = [];
  if (role === 'gallery') traits.push('gallery', 'media');
  if (['primary-media', 'supporting-media', 'comparison-before', 'comparison-after'].includes(role) || MEDIA_TYPES.has(field.type)) traits.push('media');
  if (role === 'document' || DOCUMENT_TYPES.has(field.type)) traits.push('document');
  if (['start-date', 'end-date'].includes(role)) traits.push('chronology');
  if (['subtitle', 'byline', 'publication-date', 'reading-time'].includes(role)) traits.push('editorial');
  if (role === 'context') traits.push('context');
  return traits;
}

function fieldPriority(field = {}) {
  const role = autoRole(field);
  const ranks = {
    subtitle: 10,
    byline: 20,
    'publication-date': 30,
    'reading-time': 40,
    'start-date': 50,
    'end-date': 60,
    context: 70
  };
  return ranks[role] ?? 100;
}

function factPresentation(field = {}, role = 'context') {
  if (role !== 'context') return 'metadata';
  const type = clean(field.type).toLowerCase();
  if (['select', 'multi-select', 'multiselect', 'choice', 'radio'].includes(type)) return 'relationship';
  return 'metadata';
}


function factShowsLabel(field = {}, role = 'context', value = '') {
  if (role !== 'context') return true;
  const type = clean(field.type).toLowerCase();
  if (['select', 'multi-select', 'multiselect', 'choice', 'radio'].includes(type)) return false;
  const signature = `${clean(field.key)} ${clean(field.label)}`.toLowerCase();
  const valueFirstContext = /\b(?:organization|organisation|location|place|venue|city|province|region|country)\b/;
  if (valueFirstContext.test(signature)) return false;
  // Unknown contextual values keep a compact schema label so their meaning is
  // not lost. Recognizable identity/location context is already self-describing
  // and reads more naturally value-first on a finished saved card.
  return true;
}

function factOccupancy(value = '') {
  const length = clean(value).replace(/\s+/g, ' ').length;
  if (length <= 12) return 'compact';
  if (length <= 28) return 'balanced';
  return 'wide';
}

function chronologyPeriodFact(facts = []) {
  const start = facts.find((fact) => fact.role === 'start-date');
  const end = facts.find((fact) => fact.role === 'end-date');
  if (!start && !end) return null;
  const startValue = start ? formatHumanDate(start.value) : '';
  const endValue = end ? formatHumanDate(end.value) : '';
  const value = startValue && endValue && startValue !== endValue
    ? `${startValue} – ${endValue}`
    : (startValue || endValue);
  if (!value) return null;
  return {
    key: 'chronology-period',
    label: '',
    value,
    role: 'chronology-period',
    presentation: 'metadata',
    occupancy: factOccupancy(value),
    showLabel: false,
    priority: 50
  };
}

function factFromField(field = {}, value) {
  if (isEmpty(value)) return null;
  const role = autoRole(field);
  if (MEDIA_TYPES.has(field.type) || DOCUMENT_TYPES.has(field.type) || NARRATIVE_TYPES.has(field.type) || TAG_TYPES.has(field.type)) return null;
  if (isCoreEntryPropertyKey(field.key)) return null;
  const text = displayText(value);
  if (!text) return null;
  return {
    key: field.key,
    label: clean(field.label) || field.key,
    value: text,
    role,
    presentation: factPresentation(field, role),
    occupancy: factOccupancy(text),
    showLabel: factShowsLabel(field, role, text),
    priority: fieldPriority(field)
  };
}

function firstNarrative(section = {}, entry = {}) {
  const direct = clean(entry.shortSummary || entry.description);
  if (direct) return direct;
  const fields = Array.isArray(section.fields) ? section.fields : [];
  const explicit = fields
    .filter((field) => ['lead', 'narrative'].includes(autoRole(field)))
    .map((field) => displayText(valueFor(entry, field)))
    .find(Boolean);
  if (explicit) return explicit;
  return fields
    .filter((field) => NARRATIVE_TYPES.has(field.type))
    .map((field) => displayText(valueFor(entry, field)))
    .find(Boolean) || '';
}

function tagValues(section = {}, entry = {}) {
  const field = (section.fields || []).find((candidate) => TAG_TYPES.has(candidate.type) && !isEmpty(valueFor(entry, candidate)));
  if (!field) return [];
  const raw = valueFor(entry, field);
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map(displayText).filter(Boolean);
}

function capabilityValues(entry = {}, capabilities = []) {
  const byId = new Map((Array.isArray(capabilities) ? capabilities : []).map((item) => [item.id, item]));
  const output = [];
  for (const [recordType, ids] of [['skill', entry.skillIds || []], ['tool', entry.toolIds || []]]) {
    for (const id of ids) {
      const record = byId.get(id) || {};
      const label = clean(record.name || record.title || record.label || id);
      if (!label) continue;
      output.push({
        id,
        label,
        category: clean(record.category),
        icon: clean(record.icon),
        recordType
      });
    }
  }
  return output;
}

export function composeGeneratedAdminCard(section = {}, entry = {}, { capabilities = [] } = {}) {
  const fields = Array.isArray(section.fields) ? section.fields : [];
  const semantics = resolveModuleEntryCardSemantics(section, entry);
  const mediaPresentation = resolveModuleRecordMedia(section, entry);
  const traits = new Set(semantics.traits || []);
  if (mediaPresentation.supportsMedia) traits.add('media');
  if (['images', 'gallery'].includes(mediaPresentation.field?.type)) traits.add('gallery');
  let mediaFieldKey = mediaPresentation.field?.key || semantics.primaryMediaField?.key || '';
  let documentFieldKey = '';

  for (const field of fields) {
    const value = valueFor(entry, field);
    if (isEmpty(value)) continue;
    const role = autoRole(field);
    traitSetForField(field, value).forEach((trait) => traits.add(trait));
    if (!documentFieldKey && (role === 'document' || DOCUMENT_TYPES.has(field.type))) documentFieldKey = field.key;
  }

  const resolvedCapabilities = capabilityValues(entry, capabilities);
  if (resolvedCapabilities.length) traits.add('capabilities');

  const allFacts = fields
    .map((field) => factFromField(field, valueFor(entry, field)))
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority);
  const deckFact = allFacts.find((fact) => fact.role === 'subtitle') || null;
  const editorialMetaRoles = new Set(['byline', 'publication-date', 'reading-time']);
  const meta = allFacts
    .filter((fact) => editorialMetaRoles.has(fact.role))
    .slice(0, 3)
    .map(({ priority, ...fact }) => ({ ...fact, value: humanMetaValue(fact), showLabel: metaShowsLabel(fact.role) }));
  const chronologyPeriod = chronologyPeriodFact(allFacts);
  const facts = [
    ...(chronologyPeriod ? [chronologyPeriod] : []),
    ...allFacts.filter((fact) => !['start-date', 'end-date'].includes(fact.role))
  ]
    .filter((fact) => fact !== deckFact && !editorialMetaRoles.has(fact.role))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4)
    .map(({ priority, ...fact }) => fact);
  if (facts.length) traits.add('context');

  const summary = semantics.summary || firstNarrative(section, entry);
  const tags = semantics.tags?.length ? semantics.tags : tagValues(section, entry);
  if (tags.length) traits.add('context');

  const traitList = [...traits];
  const profile = resolveModuleCardProfile(traitList, { module: semantics.module });
  const hasRichDetails = Boolean(
    deckFact?.value || summary || meta.length || facts.length || tags.length || resolvedCapabilities.length
  );
  const footprint = (profile === "media" || profile === "gallery") && hasRichDetails
    ? "media-rich"
    : profile === "gallery"
      ? "media-gallery"
      : profile === "media"
        ? "schema-media"
        : "schema-content";
  return {
    profile,
    footprint,
    traits: traitList,
    deck: deckFact?.value || '',
    meta,
    summary,
    facts,
    tags,
    capabilities: resolvedCapabilities,
    mediaFieldKey,
    documentFieldKey
  };
}
