import { normalizePublicLayoutConfig } from "./public-layout-contract.js";
import { publicSectionEligibility } from "./public-section-eligibility.js";
const clean = (value = '') => String(value ?? '').trim();
const bool = (value, fallback = false) => value === undefined || value === null ? fallback : value === true || value === 'true' || value === 1 || value === '1';
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const unique = (value = []) => [...new Set((Array.isArray(value) ? value : clean(value).split(',')).map(clean).filter(Boolean))];
const token = (value = '') => clean(value).toLowerCase().replace(/&/g, ' and ').replace(/[\/_–—-]+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const enumValue = (value, allowed, fallback) => allowed.includes(token(value)) ? token(value) : fallback;


function normalizeDisplayMapping(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const { buttonLabel: _legacyButtonLabel, actionLabel: _legacyActionLabel, ...display } = raw;
  return display;
}

export const MODULE_LIFECYCLES = Object.freeze(['building', 'promoted']);
export const ADMIN_WORKSPACE_ARCHETYPES = Object.freeze(['media-library', 'rich-records', 'gallery', 'timeline', 'simple-manager', 'text-content']);
export const ADMIN_WORKSPACE_MODES = Object.freeze(['auto', 'manual']);
export const MODULE_CONTENT_INTENTS = Object.freeze(['record', 'showcase', 'mixed']);
export const PUBLIC_PRESENTATIONS = Object.freeze(['cards', 'rich-showcase', 'media-gallery', 'timeline', 'list', 'text-section', 'cta-contact', 'single-featured', 'grid', 'carousel', 'featured-grid']);
export const MODULE_WIDTHS = Object.freeze(['full', 'half', 'one-third', 'two-thirds']);
export const MODULE_SIDES = Object.freeze(['auto', 'left', 'right']);
export const MODULE_FIELD_TYPES = Object.freeze([
  'text', 'textarea', 'rich-text', 'number', 'hours', 'date', 'url', 'email', 'boolean', 'toggle', 'category', 'tags',
  'image', 'images', 'gallery', 'video', 'audio', 'pdf', 'document', 'file', 'project-file', 'files',
  'skills', 'tools', 'relationship', 'select', 'multiselect'
]);
export const SOURCE_ACCESS_POLICIES = Object.freeze(['admin-only', 'metadata-only', 'public-preview', 'public-download']);
export const MODULE_DATE_PRECISIONS = Object.freeze(['auto', 'exact-date', 'month-year', 'year']);
export const MODULE_DATE_RANGES = Object.freeze(['auto', 'past-present', 'any', 'present-future']);
export const MODULE_PREVIEW_FIELD_ROLES = Object.freeze([
  'auto', 'primary-media', 'supporting-media', 'gallery', 'comparison-before', 'comparison-after',
  'narrative', 'lead', 'subtitle', 'byline', 'publication-date', 'reading-time', 'document', 'context', 'start-date', 'end-date'
]);
export const CUSTOM_MODULE_FIELD_TYPES = Object.freeze(MODULE_FIELD_TYPES.filter((type) => !['category', 'skills', 'tools'].includes(type)));

export const CORE_ENTRY_PROPERTIES = Object.freeze([
  Object.freeze({ key: 'title', label: 'Entry name', group: 'identity', editable: true }),
  Object.freeze({ key: 'slug', label: 'Slug', group: 'identity', editable: true }),
  Object.freeze({ key: 'shortSummary', label: 'Short summary', group: 'content', editable: true }),
  Object.freeze({ key: 'description', label: 'Full description', group: 'content', editable: true }),
  Object.freeze({ key: 'status', label: 'Status', group: 'publishing', editable: true }),
  Object.freeze({ key: 'visible', label: 'Visibility', group: 'publishing', editable: true }),
  Object.freeze({ key: 'displayOrder', label: 'Display order', group: 'publishing', editable: true }),
  Object.freeze({ key: 'featured', label: 'Featured', group: 'publishing', editable: true }),
  Object.freeze({ key: 'id', label: 'Entry ID', group: 'system', editable: false }),
  Object.freeze({ key: 'createdAt', label: 'Created at', group: 'system', editable: false }),
  Object.freeze({ key: 'updatedAt', label: 'Updated at', group: 'system', editable: false })
]);

const normalizePropertyKey = (value = '') => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const CORE_ENTRY_KEYS = new Set(CORE_ENTRY_PROPERTIES.map((item) => normalizePropertyKey(item.key)));
const CORE_ENTRY_ALIASES = new Set(['entryname', 'name', 'cardsummary', 'summary', 'shortdescription']);
const STANDARD_ENTRY_FIELD_KEYS = new Set(['shortsummary','cardsummary','summary','description']);
const PLACEHOLDER_FIELD_TYPES = new Set(['text', 'textarea', 'rich-text', 'number', 'hours', 'date', 'url', 'email', 'category', 'tags', 'select', 'multiselect']);
const OPTION_FIELD_TYPES = new Set(['category', 'select', 'multiselect']);
const FILE_PRESET_FIELD_TYPES = new Set(['pdf', 'document', 'file', 'project-file', 'files']);
const ASSET_ACCESS_FIELD_TYPES = new Set(['image', 'images', 'gallery', 'video', 'audio', 'pdf', 'document', 'file', 'project-file', 'files']);

const PREVIEW_ROLE_OPTIONS = Object.freeze({
  image: Object.freeze([['auto','Automatic'],['primary-media','Primary media'],['supporting-media','Supporting media'],['comparison-before','Comparison — Before'],['comparison-after','Comparison — After']]),
  images: Object.freeze([['auto','Automatic'],['gallery','Gallery'],['supporting-media','Supporting media']]),
  gallery: Object.freeze([['auto','Automatic'],['gallery','Gallery'],['supporting-media','Supporting media']]),
  video: Object.freeze([['auto','Automatic'],['primary-media','Primary media'],['supporting-media','Supporting media']]),
  audio: Object.freeze([['auto','Automatic'],['primary-media','Primary media'],['supporting-media','Supporting media']]),
  pdf: Object.freeze([['auto','Automatic'],['document','Document']]),
  document: Object.freeze([['auto','Automatic'],['document','Document']]),
  file: Object.freeze([['auto','Automatic'],['document','Document'],['supporting-media','Supporting file']]),
  'project-file': Object.freeze([['auto','Automatic'],['document','Document'],['supporting-media','Supporting file']]),
  files: Object.freeze([['auto','Automatic'],['document','Document'],['supporting-media','Supporting files']]),
  text: Object.freeze([['auto','Automatic'],['subtitle','Subtitle / deck'],['byline','Byline / author'],['context','Context']]),
  textarea: Object.freeze([['auto','Automatic'],['lead','Lead / summary'],['narrative','Narrative']]),
  'rich-text': Object.freeze([['auto','Automatic'],['lead','Lead / summary'],['narrative','Narrative']]),
  number: Object.freeze([['auto','Automatic'],['reading-time','Reading time / duration'],['context','Context']]),
  hours: Object.freeze([['auto','Automatic'],['reading-time','Reading time / duration'],['context','Context']]),
  date: Object.freeze([['auto','Automatic'],['start-date','Start date'],['end-date','End date'],['publication-date','Publication date'],['context','Context']])
});

export function moduleFieldPreviewRole(raw = {}) {
  const requested = token(raw.previewRole || raw.semanticRole);
  return MODULE_PREVIEW_FIELD_ROLES.includes(requested) ? requested : 'auto';
}

function moduleMediaFieldValue(record = {}, field = {}) {
  if (!record || !field?.key) return undefined;
  return record?.data?.[field.key] ?? record?.[field.key];
}

function moduleMediaValuePresent(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(moduleMediaValuePresent);
  if (typeof value === 'object') return Object.values(value).some(moduleMediaValuePresent);
  return true;
}

const MODULE_COVER_FIELD_TYPES = new Set(['image', 'file', 'project-file', 'document', 'pdf']);

function moduleCoverFieldScore(raw = {}, configuredKey = '') {
  const field = normalizeEntryField(raw);
  if (!MODULE_COVER_FIELD_TYPES.has(field.type)) return -1;
  const explicitRole = moduleFieldPreviewRole(raw);
  if (['supporting-media', 'comparison-before', 'comparison-after', 'document', 'gallery'].includes(explicitRole)) return -1;

  const signature = `${clean(field.key)} ${clean(field.label)}`.toLowerCase().replace(/[_-]+/g, ' ');
  const configured = Boolean(clean(configuredKey)) && clean(field.key) === clean(configuredKey);
  let score = -1;
  if (/\bcover\s*image\b/.test(signature) || /^cover\b/.test(signature) || /\bcover\b/.test(signature)) score = 160;
  else if (/\bthumbnail\b/.test(signature)) score = 130;
  else if (/\bposter\b/.test(signature)) score = 115;
  else if (/\bhero(?:\s*image)?\b/.test(signature)) score = 105;
  else if (/\bprimary\s*image\b/.test(signature)) score = 95;
  else if (configured) score = 80;
  if (score >= 0 && configured) score += 30;
  return score;
}

/**
 * Canonical generated-module Cover owner.
 *
 * Cover is a structural presentation slot, not "the first available media".
 * Gallery, video, audio, documents and other supporting media never take over
 * this slot automatically. A legacy configured display field is only accepted
 * when it is itself cover-capable; an explicit Cover/thumbnail/poster image
 * outranks it so field order cannot swap Cover with Gallery.
 */
export function resolveModuleCoverField(fields = [], { displayImageField = '' } = {}) {
  const source = Array.isArray(fields) ? fields : [];
  const configuredKey = clean(displayImageField);
  let winner = null;
  let winnerScore = -1;
  for (let index = 0; index < source.length; index += 1) {
    const field = source[index];
    const score = moduleCoverFieldScore(field, configuredKey);
    if (score < 0) continue;
    // Preserve schema order only as the final tie-breaker.
    if (score > winnerScore) {
      winner = field;
      winnerScore = score;
    }
  }
  return winner;
}

function modulePrimaryMediaCandidates(fields = [], { displayImageField = '' } = {}) {
  const source = Array.isArray(fields) ? fields : [];
  const output = [];
  const add = (field) => { if (field && !output.includes(field)) output.push(field); };

  // Cover is always the first presentation owner when the schema has one.
  add(resolveModuleCoverField(source, { displayImageField }));

  const configuredKey = clean(displayImageField);
  const configured = configuredKey
    ? source.find((field) => clean(field.key) === configuredKey && ASSET_ACCESS_FIELD_TYPES.has(normalizeEntryField(field).type))
    : null;

  // A dedicated single primary image is more intentional card media than a
  // collection field. Keep an explicitly configured single-media field early,
  // but do not let a configured/legacy Gallery mapping outrank a populated
  // image field merely because of schema order.
  if (configured && resolveModuleFieldSemanticRole(configured) === 'primary-media') add(configured);

  const explicit = source.filter((field) => moduleFieldPreviewRole(field) === 'primary-media');
  explicit.forEach(add);

  source.forEach((field) => {
    const explicitRole = moduleFieldPreviewRole(field);
    if (['supporting-media','comparison-before','comparison-after','document'].includes(explicitRole)) return;
    if (resolveModuleFieldSemanticRole(field) === 'primary-media') add(field);
  });

  if (configured && resolveModuleFieldSemanticRole(configured) === 'gallery') add(configured);
  source.forEach((field) => {
    const explicitRole = moduleFieldPreviewRole(field);
    if (explicitRole === 'supporting-media') return;
    if (resolveModuleFieldSemanticRole(field) === 'gallery') add(field);
  });
  return output;
}

export function resolveModulePrimaryMediaField(fields = [], options = {}) {
  return modulePrimaryMediaCandidates(fields, options)[0] || null;
}

export function resolveModulePrimaryMediaFieldForRecord(fields = [], record = {}, options = {}) {
  const coverField = resolveModuleCoverField(fields, options);
  // An empty Cover still owns the primary presentation slot. Record content
  // must never promote Gallery/Video/etc. into Cover merely because it exists.
  if (coverField) return coverField;
  const candidates = modulePrimaryMediaCandidates(fields, options);
  return candidates.find((field) => moduleMediaValuePresent(moduleMediaFieldValue(record, field))) || null;
}

export function moduleFieldPreviewRoleOptions(raw = {}) {
  const type = normalizeEntryField({ ...raw, previewRole: undefined, semanticRole: undefined }).type;
  return PREVIEW_ROLE_OPTIONS[type] || Object.freeze([['auto','Automatic'],['context','Context']]);
}

export function resolveModuleFieldSemanticRole(raw = {}) {
  const explicit = moduleFieldPreviewRole(raw);
  if (explicit !== 'auto') return explicit;
  const field = normalizeEntryField({ ...raw, previewRole: undefined, semanticRole: undefined });
  const signature = `${clean(field.key)} ${clean(field.label)}`.toLowerCase();
  const booleanPresentationState = ['boolean', 'toggle'].includes(field.type) && /\b(?:highlight(?:ed)?|feature(?:d)?|pin(?:ned)?|publish(?:ed)?|visibility|visible|hidden|promot(?:e|ed)|selected)\b/.test(signature);
  const orderedPresentationState = field.type === 'number' && /\b(?:display|sort)\s*order\b/.test(signature.replace(/[_-]+/g, ' '));
  if (booleanPresentationState || orderedPresentationState) return 'presentation-state';
  if (['gallery', 'images'].includes(field.type)) return 'gallery';
  if (field.type === 'image' || field.type === 'video' || field.type === 'audio') return 'primary-media';
  if (field.type === 'pdf' || field.type === 'document') return 'document';
  if (['file', 'files', 'project-file'].includes(field.type)) {
    return /\b(pdf|document|report|certificate|credential|attachment|resource|file)\b/.test(signature) ? 'document' : 'supporting-media';
  }
  if (field.type === 'date' && /\b(start|begin|from|started|since)\b/.test(signature)) return 'start-date';
  if (field.type === 'date' && /\b(end|finish|until|ended|to)\b/.test(signature)) return 'end-date';
  if (field.type === 'date' && /\b(publish|published|publication|issued|issue)\b/.test(signature)) return 'publication-date';
  if (field.type === 'text' && /\b(subtitle|deck|subhead)\b/.test(signature)) return 'subtitle';
  if (field.type === 'text' && /\b(author|byline|writer|creator)\b/.test(signature)) return 'byline';
  if ((field.type === 'number' || field.type === 'hours') && /\b(read|duration|minutes?|hours?)\b/.test(signature)) return 'reading-time';
  if (['textarea', 'rich-text'].includes(field.type) && /\b(summary|lead|overview|intro)\b/.test(signature)) return 'lead';
  if (['textarea', 'rich-text'].includes(field.type)) return 'narrative';
  return 'context';
}

const DEFAULT_FIELD_HELP = Object.freeze({
  text: 'Single-line text shown with this entry.',
  textarea: 'Multi-line text for summaries or longer details.',
  'rich-text': 'Formatted long-form content for this entry.',
  number: 'Numeric value stored with this entry.',
  hours: 'Actual training, project, or workload hours stored separately from calendar dates.',
  date: 'Date associated with this entry.',
  url: 'Web address associated with this entry.',
  email: 'Email address associated with this entry.',
  boolean: 'On/off value for this entry.',
  toggle: 'On/off value for this entry.',
  category: 'Category used to organize and filter entries.',
  tags: 'Reusable labels that describe this entry.',
  image: 'Single image asset for this entry.',
  images: 'Multiple image assets for this entry.',
  gallery: 'Image gallery owned by this entry.',
  video: 'Video preview or presentation asset for this entry.',
  audio: 'Audio asset for this entry.',
  pdf: 'PDF asset associated with this entry.',
  document: 'Document asset associated with this entry.',
  file: 'Generic downloadable or metadata-only file asset.',
  'project-file': 'Source or project file kept separate from its public preview.',
  files: 'Multiple file assets associated with this entry.',
  skills: 'Skills selected from the shared Skills & Tools library.',
  tools: 'Tools selected from the shared Skills & Tools library.',
  relationship: 'Reference to content owned by another module.',
  select: 'Choose one value from a configured list.',
  multiselect: 'Choose one or more values from a configured list.'
});

export function isCoreEntryPropertyKey(value = '') {
  const key = normalizePropertyKey(value);
  return CORE_ENTRY_KEYS.has(key) || CORE_ENTRY_ALIASES.has(key);
}

export function isStandardEntryPropertyKey(value = '') {
  const normalized = normalizePropertyKey(value);
  return STANDARD_ENTRY_FIELD_KEYS.has(normalized);
}

function defaultFieldHelp(field = {}) {
  const key = clean(field.key).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['shortsummary','cardsummary','summary'].includes(key)) return 'Short summary used by cards, lists, and compact previews.';
  if (key === 'description') return 'Primary description used when this entry needs fuller context.';
  return DEFAULT_FIELD_HELP[field.type] || 'Additional content stored with this entry.';
}

export function fieldHelperText(raw = {}) {
  const field = normalizeEntryField(raw);
  return clean(raw.helpText) || defaultFieldHelp(field);
}

export function moduleFieldEditorProfile(raw = {}) {
  const field = normalizeEntryField(raw);
  return {
    placeholder: PLACEHOLDER_FIELD_TYPES.has(field.type),
    options: OPTION_FIELD_TYPES.has(field.type),
    filePreset: FILE_PRESET_FIELD_TYPES.has(field.type),
    customAccept: FILE_PRESET_FIELD_TYPES.has(field.type) && field.acceptPreset === 'custom',
    sourceAccess: ASSET_ACCESS_FIELD_TYPES.has(field.type),
    relationshipTarget: field.type === 'relationship',
    dateOptions: field.type === 'date',
    multiple: field.type === 'relationship',
    intrinsicMultiple: ['images', 'gallery', 'files', 'multiselect', 'skills', 'tools'].includes(field.type),
    previewRoleOptions: moduleFieldPreviewRoleOptions(field),
    defaultHelp: defaultFieldHelp(field)
  };
}

export function moduleSlug(value = '') {
  return token(value).slice(0, 64);
}

export function nextModuleDuplicateSlug(value = '', existingSlugs = []) {
  const base = moduleSlug(value) || 'entry';
  const used = new Set((Array.isArray(existingSlugs) ? existingSlugs : []).map(moduleSlug).filter(Boolean));
  let index = 1;
  while (index < 10000) {
    const suffix = index === 1 ? 'copy' : `copy-${index}`;
    const stemLimit = Math.max(1, 64 - suffix.length - 1);
    const stem = base.slice(0, stemLimit).replace(/-+$/g, '') || 'entry';
    const candidate = moduleSlug(`${stem}-${suffix}`);
    if (!used.has(candidate)) return candidate;
    index += 1;
  }
  throw new Error('Unable to create a unique duplicate slug.');
}

export const OTHER_CATEGORY_VALUE = '__other__';

export function moduleCategoryEntryState(options = [], currentValue = '') {
  const managed = unique(options).filter((value) => value.toLowerCase() !== 'other category');
  const current = clean(currentValue);
  const matched = managed.find((value) => value.toLowerCase() === current.toLowerCase()) || '';
  const showOther = Boolean(current && !matched);
  return {
    options: managed,
    selectedValue: showOther ? OTHER_CATEGORY_VALUE : matched,
    otherValue: showOther ? current : '',
    showOther
  };
}

export function resolveModuleEntryCategory(selectedValue = '', otherValue = '') {
  return clean(selectedValue) === OTHER_CATEGORY_VALUE ? clean(otherValue) : clean(selectedValue);
}

export function moduleTimelineProfile(raw = {}) {
  const enabled = token(raw.adminWorkspace || raw.workspaceArchetype) === 'timeline';
  const dateFields = (Array.isArray(raw.fields) ? raw.fields : []).map(normalizeEntryField).filter((field) => field.type === 'date');
  const matches = (field, pattern) => pattern.test(`${field.key} ${field.label}`.toLowerCase());
  const start = dateFields.find((field) => matches(field, /\b(start|begin|from|started|since)\b/))
    || dateFields.find((field) => !matches(field, /\b(end|finish|until|to|ended)\b/))
    || dateFields[0]
    || null;
  const end = dateFields.find((field) => field.key !== start?.key && matches(field, /\b(end|finish|until|to|ended)\b/))
    || dateFields.find((field) => field.key !== start?.key)
    || null;
  return { enabled, startField: start?.key || '', endField: end?.key || '', hasDate: Boolean(start) };
}

export function moduleTimelineEntryMeta(section = {}, entry = {}) {
  const profile = moduleTimelineProfile(section);
  const data = entry && typeof entry.data === 'object' && entry.data ? entry.data : {};
  const start = clean(profile.startField ? (data[profile.startField] ?? entry[profile.startField]) : '');
  const end = clean(profile.endField ? (data[profile.endField] ?? entry[profile.endField]) : '');
  const sortableStart = /^\d{4}$/.test(start) ? `${start}-01-01T00:00:00Z`
    : /^\d{4}-\d{2}$/.test(start) ? `${start}-01T00:00:00Z`
      : /^\d{4}-\d{2}-\d{2}$/.test(start) ? `${start}T00:00:00Z` : start;
  const parsed = start ? Date.parse(sortableStart) : NaN;
  return {
    ...profile,
    start,
    end,
    year: /^\d{4}/.test(start) ? start.slice(0, 4) : '',
    sortTime: Number.isFinite(parsed) ? parsed : 0
  };
}


export function normalizeEntryField(raw = {}, index = 0) {
  const label = clean(raw.label || raw.name || `Field ${index + 1}`);
  const key = clean(raw.key) || moduleSlug(label).replace(/-/g, '_') || `field_${index + 1}`;
  const requestedType = token(raw.type);
  const aliases = { 'multiple-images': 'images', 'multiple-files': 'files', source: 'project-file', 'source-file': 'project-file' };
  const type = MODULE_FIELD_TYPES.includes(requestedType) ? requestedType : (aliases[requestedType] || 'text');
  return {
    key,
    label: label || key,
    type,
    required: bool(raw.required, false),
    public: bool(raw.public, true),
    placeholder: clean(raw.placeholder),
    helpText: clean(raw.helpText),
    options: unique(raw.options),
    acceptPreset: clean(raw.acceptPreset || 'any').toLowerCase(),
    accept: clean(raw.accept),
    access: enumValue(raw.access || raw.accessPolicy, SOURCE_ACCESS_POLICIES, type === 'project-file' ? 'admin-only' : 'public-preview'),
    targetModule: moduleSlug(raw.targetModule || raw.relationshipModule || ''),
    multiple: bool(raw.multiple, ['images', 'gallery', 'files', 'multiselect', 'skills', 'tools'].includes(type)),
    ...(moduleFieldPreviewRole(raw) !== 'auto' ? { previewRole: moduleFieldPreviewRole(raw) } : {}),
    ...(type === 'date' ? {
      datePrecision: enumValue(raw.datePrecision || raw.precision, MODULE_DATE_PRECISIONS, 'auto'),
      dateRange: enumValue(raw.dateRange || raw.allowedRange, MODULE_DATE_RANGES, 'auto')
    } : {})
  };
}

export function normalizeModuleRelationship(raw = {}) {
  const scope = enumValue(raw.scope || raw.linkScope, ['entry', 'module'], 'entry');
  return {
    moduleId: clean(raw.moduleId || raw.sectionId),
    moduleKey: moduleSlug(raw.moduleKey || raw.sectionKey || raw.module),
    scope,
    documentId: scope === 'module' ? '' : clean(raw.documentId || raw.linkedDocumentId),
    label: clean(raw.label)
  };
}

function normalizeFields(value = []) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list.map(normalizeEntryField).filter((field) => {
    if (!field.key || seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
}



export function resolveModuleAdminWorkspace(raw = {}) {
  const fields = normalizeFields(raw.fields);
  const roles = new Set(fields.map((field) => moduleFieldPreviewRole(field)).filter((role) => role !== 'auto'));
  const types = new Set(fields.map((field) => field.type));
  const dateFields = fields.filter((field) => field.type === 'date');
  const labelIntent = fields.map((field) => `${field.key} ${field.label}`.toLowerCase()).join(' ');
  const hasDocument = roles.has('document') || fields.some((field) => ['pdf', 'document'].includes(field.type));
  const hasGallery = roles.has('gallery') || types.has('gallery') || types.has('images');
  const hasComparison = roles.has('comparison-before') && roles.has('comparison-after');
  const hasPrimaryMedia = roles.has('primary-media') || fields.some((field) => ['image', 'video', 'audio'].includes(field.type));
  const hasChronology = (roles.has('start-date') && roles.has('end-date')) || (dateFields.length >= 2 && /start|begin|from/.test(labelIntent) && /end|finish|until|to/.test(labelIntent));
  const narrativeCount = fields.filter((field) => ['textarea', 'rich-text'].includes(field.type) || ['lead', 'narrative'].includes(moduleFieldPreviewRole(field))).length;
  const contextCount = fields.filter((field) => !['image','images','gallery','video','audio','pdf','document','file','project-file','files','textarea','rich-text'].includes(field.type)).length;
  const mediaCount = fields.filter((field) => ['image','images','gallery','video','audio'].includes(field.type)).length;
  const documentDominant = hasDocument && !hasChronology && !hasGallery && !hasComparison && mediaCount === 0;

  let workspace = 'simple-manager';
  let reason = 'General record library is the safest fit for this schema.';
  if (hasChronology) {
    workspace = 'timeline';
    reason = 'Start/end date semantics make chronology the dominant Admin workflow.';
  } else if (hasGallery) {
    workspace = 'gallery';
    reason = 'Gallery or multi-image semantics make a visual gallery workspace the strongest fit.';
  } else if (hasComparison || mediaCount >= 2) {
    workspace = 'media-library';
    reason = 'Multiple media roles make a media-first workspace the strongest fit.';
  } else if (hasPrimaryMedia && narrativeCount <= 1 && contextCount <= 3 && !hasDocument) {
    workspace = 'media-library';
    reason = narrativeCount > 0
      ? 'Primary media remains dominant with only a light supporting narrative.'
      : 'Primary media is the dominant content in this schema.';
  } else if (!hasDocument && narrativeCount > 0 && contextCount <= 3 && mediaCount === 0) {
    workspace = 'text-content';
    reason = 'Narrative fields dominate this schema, so a text/content workspace is recommended.';
  } else if (!hasDocument && contextCount >= 5) {
    workspace = 'rich-records';
    reason = 'The schema contains many structured fields, so a rich-record workspace is recommended.';
  }

  const traits = Object.freeze({
    recordWorkspace: documentDominant,
    document: hasDocument,
    documentDominant,
    gallery: hasGallery,
    comparison: hasComparison,
    media: hasPrimaryMedia || mediaCount > 0 || hasGallery || hasComparison,
    chronology: hasChronology,
    editorial: narrativeCount > 0 && mediaCount === 0 && !hasDocument,
    richRecord: contextCount >= 5,
    capabilities: raw.entryCapabilities?.skills === true || raw.entryCapabilities?.tools === true
  });
  return Object.freeze({ workspace, traits, reason });
}

function normalizeEntryCapabilities(raw = {}, fields = [], legacyCategories = []) {
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const categoryField = fields.find((field) => field.type === 'category' || normalizePropertyKey(field.key) === 'category');
  const skillField = fields.find((field) => field.type === 'skills' || normalizePropertyKey(field.key) === 'skills');
  const toolField = fields.find((field) => field.type === 'tools' || normalizePropertyKey(field.key) === 'tools');
  const categoryConfig = config.category && typeof config.category === 'object' && !Array.isArray(config.category) ? config.category : {};
  const categoryOptions = unique(categoryConfig.options?.length ? categoryConfig.options : (categoryField?.options?.length ? categoryField.options : legacyCategories));
  return {
    category: {
      enabled: categoryConfig.enabled === undefined ? Boolean(categoryField || categoryOptions.length) : bool(categoryConfig.enabled, false),
      options: categoryOptions,
      key: clean(categoryConfig.key || categoryField?.key || 'category') || 'category'
    },
    skills: config.skills === undefined ? Boolean(skillField) : bool(config.skills, false),
    tools: config.tools === undefined ? Boolean(toolField) : bool(config.tools, false)
  };
}

function isBuiltInCapabilityField(field = {}) {
  const key = normalizePropertyKey(field.key);
  return ['category', 'skills', 'tools'].includes(field.type) || ['category', 'skills', 'tools'].includes(key);
}

function isDisposableCustomField(field = {}) {
  return !isCoreEntryPropertyKey(field.key) && !isBuiltInCapabilityField(field);
}

function normalizeTheme(raw = {}) {
  return {
    accent: clean(raw.accent || raw.accentColor || '#7c5cff'),
    icon: clean(raw.icon || ''),
    iconMode: enumValue(raw.iconMode, ['auto', 'manual'], raw.icon ? 'manual' : 'auto'),
    heroStyle: enumValue(raw.heroStyle || raw.decorativeHero, ['plain', 'soft-glow', 'gradient', 'media'], 'soft-glow')
  };
}

function normalizeProjectLinking(raw = {}, legacy = {}) {
  return {
    enabled: bool(raw.enabled, legacy.linkableToProjects === true),
    scope: enumValue(raw.scope || raw.linkScope, ['entry', 'module'], 'module')
  };
}

export function inferModuleContentIntent(raw = {}) {
  const workspace = enumValue(raw.adminWorkspace || raw.workspaceArchetype, ADMIN_WORKSPACE_ARCHETYPES, 'simple-manager');
  const fields = normalizeFields(raw.fields);
  const mediaTypes = new Set(['image', 'images', 'gallery', 'video', 'audio']);
  const narrativeTypes = new Set(['textarea', 'rich-text']);
  const mediaCount = fields.filter((field) => mediaTypes.has(field.type)).length;
  const narrativeCount = fields.filter((field) => narrativeTypes.has(field.type)).length;
  if (['gallery', 'media-library'].includes(workspace) || mediaCount >= 2 || fields.some((field) => ['images', 'gallery'].includes(field.type))) return 'showcase';
  if (['timeline', 'rich-records', 'text-content'].includes(workspace)) return 'record';
  if (mediaCount > 0 && narrativeCount === 0) return 'showcase';
  return 'mixed';
}

export function suggestModulePublicPresentation(raw = {}) {
  const workspace = enumValue(raw.adminWorkspace || raw.workspaceArchetype, ADMIN_WORKSPACE_ARCHETYPES, 'simple-manager');
  const fields = normalizeFields(raw.fields);
  const fieldTypes = new Set(fields.map((field) => field.type));
  const dateFields = fields.filter((field) => field.type === 'date');
  const dateIntent = dateFields.map((field) => `${field.key} ${field.label}`.toLowerCase()).join(' ');
  if (workspace === 'timeline' || (dateFields.length >= 2 && /start|begin|from/.test(dateIntent) && /end|finish|until|to/.test(dateIntent))) return 'timeline';
  if (['gallery', 'media-library'].includes(workspace) || fieldTypes.has('gallery') || fieldTypes.has('images')) return 'media-gallery';
  if (workspace === 'text-content') return 'list';
  if (workspace === 'rich-records') return 'rich-showcase';
  return 'cards';
}

export function modulePublicPresentationCompatibility(raw = {}) {
  const workspace = enumValue(raw.adminWorkspace || raw.workspaceArchetype, ADMIN_WORKSPACE_ARCHETYPES, 'simple-manager');
  const fields = normalizeFields(raw.fields);
  const fieldTypes = new Set(fields.map((field) => field.type));
  const dateFields = fields.filter((field) => field.type === 'date');
  const mediaTypes = new Set(['image', 'images', 'gallery', 'video', 'audio', 'pdf', 'document', 'file', 'project-file', 'files']);
  const imageTypes = new Set(['image', 'images', 'gallery']);
  const hasMedia = fields.some((field) => mediaTypes.has(field.type));
  const hasImageMedia = fields.some((field) => imageTypes.has(field.type));
  const recommended = suggestModulePublicPresentation({ ...raw, adminWorkspace: workspace, fields });
  const compatibility = {
    cards: { compatible: true, reason: 'Structured records can always use the shared card presentation.' },
    timeline: {
      compatible: workspace === 'timeline' || dateFields.length > 0,
      reason: workspace === 'timeline' || dateFields.length > 0
        ? `${dateFields.length || 1} compatible date field${dateFields.length === 1 ? '' : 's'} available.`
        : 'Add at least one public date field for chronological presentation.'
    },
    'media-gallery': {
      compatible: ['gallery', 'media-library'].includes(workspace) || hasImageMedia,
      reason: ['gallery', 'media-library'].includes(workspace) || hasImageMedia
        ? 'Image or gallery media is available for a visual grid.'
        : 'Gallery requires an image, images, or gallery field.'
    },
    list: { compatible: true, reason: 'Structured records can always use the compact vertical list.' },
    carousel: { compatible: true, reason: 'Records can be browsed horizontally using the shared card surface.' },
    'rich-showcase': {
      compatible: hasMedia || ['gallery', 'media-library'].includes(workspace),
      reason: hasMedia || ['gallery', 'media-library'].includes(workspace)
        ? 'Primary media is available for a media-first showcase.'
        : 'Showcase needs at least one public media field.'
    },
    'featured-grid': { compatible: true, reason: 'One record can lead while remaining records use the shared grid.' }
  };
  return { recommended, compatibility };
}

function normalizeComposition(raw = {}, legacy = {}, recommendedPresentation = 'cards') {
  const publicPresentationMode = enumValue(raw.publicPresentationMode ?? legacy.publicPresentationMode ?? legacy.presentationMode, ['auto', 'manual'], 'auto');
  const storedPresentation = enumValue(raw.publicPresentation ?? legacy.publicPresentation ?? legacy.presentation, PUBLIC_PRESENTATIONS, recommendedPresentation);
  const legacyWidth = enumValue(raw.width, MODULE_WIDTHS, 'full');
  const layout = normalizePublicLayoutConfig({ layoutMode: raw.layoutMode ?? legacy.layoutMode, layoutPreset: raw.layoutPreset ?? legacy.layoutPreset, overflowMode: raw.overflowMode ?? legacy.overflowMode, width: legacyWidth, presentation: recommendedPresentation });
  return {
    publicEnabled: bool(raw.publicEnabled, legacy.publicEnabled ?? legacy.enabled ?? false),
    hideWhenEmpty: bool(raw.hideWhenEmpty, true),
    placement: moduleSlug(raw.placement || legacy.placement || legacy.placementAfter || 'after-photo-editing') || 'after-photo-editing',
    publicPresentationMode,
    publicPresentation: publicPresentationMode === 'auto' ? recommendedPresentation : storedPresentation,
    layoutMode: layout.layoutMode,
    layoutPreset: layout.layoutPreset,
    overflowMode: layout.overflowMode,
    width: legacyWidth,
    shareRowWith: clean(raw.shareRowWith),
    side: enumValue(raw.side, MODULE_SIDES, 'auto'),
    navigationLink: bool(raw.navigationLink, false)
  };
}

export function normalizeModuleDefinition(raw = {}) {
  const title = clean(raw.title || raw.publicTitle);
  const key = moduleSlug(raw.key || raw.internalKey || title);
  const normalizedFields = normalizeFields(raw.fields);
  const entryCapabilities = normalizeEntryCapabilities(raw.entryCapabilities, normalizedFields, raw.categories);
  const fields = normalizedFields.filter(isDisposableCustomField);
  const storedWorkspace = enumValue(raw.adminWorkspace || raw.workspaceArchetype, ADMIN_WORKSPACE_ARCHETYPES, '');
  const adminWorkspaceMode = enumValue(raw.adminWorkspaceMode || raw.workspaceMode, ADMIN_WORKSPACE_MODES, storedWorkspace ? 'manual' : 'auto');
  const automaticWorkspace = resolveModuleAdminWorkspace({ ...raw, fields: normalizedFields, entryCapabilities });
  const frozenAutomaticWorkspace = raw.lifecycle === 'promoted' || raw.promoted === true
    ? enumValue(raw.resolvedAdminWorkspace, ADMIN_WORKSPACE_ARCHETYPES, '')
    : '';
  const adminWorkspace = adminWorkspaceMode === 'manual'
    ? (storedWorkspace || 'simple-manager')
    : (frozenAutomaticWorkspace || automaticWorkspace.workspace);
  const resolvedAdminWorkspace = adminWorkspace;
  const workspaceTraits = Object.freeze({
    ...automaticWorkspace.traits,
    recordWorkspace: automaticWorkspace.traits.documentDominant === true && adminWorkspace === 'simple-manager'
  });
  const explicitContentIntent = enumValue(raw.contentIntent, MODULE_CONTENT_INTENTS, '');
  const contentIntentMode = enumValue(raw.contentIntentMode, ['auto', 'manual'], explicitContentIntent ? 'manual' : 'auto');
  const inferredContentIntent = inferModuleContentIntent({ ...raw, adminWorkspace, fields: normalizedFields });
  const contentIntent = contentIntentMode === 'manual' && explicitContentIntent ? explicitContentIntent : inferredContentIntent;
  const recommendedPresentation = suggestModulePublicPresentation({ ...raw, adminWorkspace, fields: normalizedFields });
  const storedComposition = raw.composition || raw.publicComposition || {};
  const composition = normalizeComposition({
    ...storedComposition,
    publicEnabled: raw.publicEnabled ?? storedComposition.publicEnabled,
    hideWhenEmpty: raw.hideWhenEmpty ?? storedComposition.hideWhenEmpty,
    placement: raw.placement ?? storedComposition.placement,
    publicPresentationMode: raw.publicPresentationMode ?? storedComposition.publicPresentationMode ?? raw.presentationMode,
    publicPresentation: raw.publicPresentation ?? storedComposition.publicPresentation ?? raw.presentation,
    layoutMode: raw.layoutMode ?? storedComposition.layoutMode,
    layoutPreset: raw.layoutPreset ?? storedComposition.layoutPreset,
    overflowMode: raw.overflowMode ?? storedComposition.overflowMode,
    width: raw.width ?? storedComposition.width,
    shareRowWith: raw.shareRowWith ?? storedComposition.shareRowWith,
    side: raw.side ?? storedComposition.side,
    navigationLink: raw.navigationLink ?? storedComposition.navigationLink
  }, raw, recommendedPresentation);
  const status = enumValue(raw.status || raw.publicationStatus, ['draft', 'published'], 'draft');
  const rawLifecycle = token(raw.lifecycle || raw.promotionState || (raw.promoted === true ? 'promoted' : 'building')) || 'building';
  const lifecycle = rawLifecycle === 'promoted' || raw.promoted === true ? 'promoted' : 'building';
  return {
    id: clean(raw.id), key, title, subtitle: clean(raw.subtitle), slug: moduleSlug(raw.slug || key),
    lifecycle, rawLifecycle, legacyLifecycle: rawLifecycle === 'ready' ? 'ready' : '',
    adminWorkspaceMode, adminWorkspace, resolvedAdminWorkspace, workspaceTraits, workspaceResolutionReason: automaticWorkspace.reason,
    contentIntentMode, contentIntent,
    publicPresentationMode: composition.publicPresentationMode, publicPresentation: composition.publicPresentation,
    theme: normalizeTheme(raw.theme || { accent: raw.accentColor, icon: raw.icon, heroStyle: raw.heroStyle }),
    projectLinking: normalizeProjectLinking(raw.projectLinking || {}, raw),
    composition,
    publicEnabled: composition.publicEnabled, hideWhenEmpty: composition.hideWhenEmpty, placement: composition.placement,
    layoutMode: composition.layoutMode,
    layoutPreset: composition.layoutPreset, overflowMode: composition.overflowMode,
    width: composition.width, shareRowWith: composition.shareRowWith, side: composition.side, navigationLink: composition.navigationLink,
    status, visible: raw.visible !== false, enabled: raw.enabled !== false,
    setupComplete: bool(raw.setupComplete, fields.length > 0), displayOrder: number(raw.displayOrder, 500),
    fields, entryCapabilities, relationships: Array.isArray(raw.relationships) ? raw.relationships.map((item) => ({ ...item })) : [],
    display: normalizeDisplayMapping(raw.display),
    categories: entryCapabilities.category.options, emptyStateText: clean(raw.emptyStateText)
  };
}


function firstModuleCardField(fields = [], predicate = () => false, preferredKeys = []) {
  for (const key of preferredKeys) {
    const wanted = clean(key).toLowerCase();
    const preferred = fields.find((field) => clean(field.key).toLowerCase() === wanted && predicate(field));
    if (preferred) return preferred;
  }
  return fields.find(predicate) || null;
}

function moduleEntryCardData(entry = {}, fields = []) {
  const data = {
    title: entry.title,
    shortSummary: entry.shortSummary,
    description: entry.description,
    coverImage: entry.coverImage || entry.coverImageUrl,
    category: entry.category,
    tags: entry.tags,
    ...(entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data : {})
  };

  // Older/generated records may persist schema-owned values at the entry root
  // while newer records keep them under entry.data. Normalize both shapes here
  // once so Admin, Public and future module renderers resolve identical content.
  for (const field of Array.isArray(fields) ? fields : []) {
    const key = clean(field?.key);
    if (!key || data[key] !== undefined) continue;
    if (entry[key] !== undefined) data[key] = entry[key];
  }
  return data;
}

function moduleEntryCardText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(moduleEntryCardText).filter(Boolean).join(', ');
  if (typeof value === 'object') return clean(value.label || value.name || value.title || value.value || value.originalFilename || value.displayName || value.url);
  return clean(value);
}

/**
 * Shared visual composition family for generated records. The schema/record
 * traits choose a family; individual module names never participate. Admin and
 * Public both consume this resolver so future modules inherit a stable
 * foundation without being forced into a Project-shaped card.
 */
export function resolveModuleCardProfile(traits = [], options = {}) {
  const set = new Set(Array.isArray(traits) ? traits : []);
  const module = options?.module && typeof options.module === 'object' ? options.module : {};
  const workspace = token(options?.workspace || module.adminWorkspace || module.resolvedAdminWorkspace);
  const workspaceTraits = options?.workspaceTraits && typeof options.workspaceTraits === 'object'
    ? options.workspaceTraits
    : (module.workspaceTraits && typeof module.workspaceTraits === 'object' ? module.workspaceTraits : {});

  // Schema/workspace dominance is resolved before record-level decoration. This
  // prevents a Timeline record with an optional image from turning into a media
  // card, while media-first schemas (including future video modules) remain
  // media-first even when they also carry a short narrative.
  if (workspace === 'timeline' || workspaceTraits.chronology === true) return 'chronology';
  if (workspace === 'gallery' || workspaceTraits.gallery === true) return 'gallery';
  if (workspace === 'media-library' || workspaceTraits.comparison === true) {
    return set.has('gallery') || workspaceTraits.gallery === true ? 'gallery' : 'media';
  }
  if (workspaceTraits.documentDominant === true) return 'document';
  if (workspace === 'text-content' || workspaceTraits.editorial === true) return 'editorial';
  if (workspace === 'rich-records' || workspaceTraits.richRecord === true) return 'structured';

  // Record traits remain the safe fallback for legacy/unconfigured modules.
  if (set.has('chronology')) return 'chronology';
  if (set.has('gallery')) return 'gallery';
  if (set.has('media')) return 'media';
  if (set.has('document')) return 'document';
  if (set.has('editorial')) return 'editorial';
  return 'structured';
}

export function resolveModuleEntryCardSemantics(sectionRaw = {}, entry = {}) {
  const module = normalizeModuleDefinition(sectionRaw);
  const fields = module.fields || [];
  const display = module.display || {};
  const data = moduleEntryCardData(entry, fields);

  const titleField = fields.find((field) => clean(field.key) === clean(display.titleField))
    || firstModuleCardField(fields, (field) => ['text','textarea','rich-text'].includes(field.type), ['title','name']);
  const summaryField = fields.find((field) => clean(field.key) === clean(display.summaryField))
    || firstModuleCardField(
      fields,
      (field) => ['lead','narrative'].includes(resolveModuleFieldSemanticRole(field)) || ['textarea','rich-text'].includes(field.type),
      ['shortSummary','short_summary','summary','description']
    );
  const categoryField = fields.find((field) => clean(field.key) === clean(display.categoryField))
    || firstModuleCardField(fields, (field) => field.type === 'category' || clean(field.key).toLowerCase() === 'category', ['category']);
  const tagsField = fields.find((field) => clean(field.key) === clean(display.tagsField))
    || firstModuleCardField(fields, (field) => field.type === 'tags', ['tags']);
  const configuredDisplayMediaField = clean(display.imageField);
  const coverField = resolveModuleCoverField(fields, { displayImageField: configuredDisplayMediaField });
  const automaticDisplayMediaField = clean(coverField?.key || firstModuleCardField(fields, (field) => ['image','images','gallery','video','audio'].includes(field.type), ['thumbnail','coverImage','cover_image','image'])?.key);
  const displayImageField = clean(coverField?.key) || configuredDisplayMediaField || automaticDisplayMediaField;

  const primaryMediaField = resolveModulePrimaryMediaFieldForRecord(
    fields,
    { ...entry, data },
    { displayImageField }
  );
  const primaryMediaValue = primaryMediaField ? moduleMediaFieldValue({ ...entry, data }, primaryMediaField) : undefined;
  const rawTags = tagsField ? (data[tagsField.key] ?? entry.tags ?? []) : (entry.tags ?? []);
  const tags = (Array.isArray(rawTags) ? rawTags : clean(rawTags).split(',')).map(moduleEntryCardText).filter(Boolean);
  const categoryEnabled = module.entryCapabilities?.category?.enabled === true;
  const category = categoryEnabled && categoryField
    ? moduleEntryCardText(data[categoryField.key] ?? entry.category)
    : clean(module.title || sectionRaw.title || sectionRaw.key);
  const configuredSummary = clean(display.summaryField) ? moduleEntryCardText(data[display.summaryField]) : '';
  const summary = configuredSummary
    || clean(entry.shortSummary || entry.description)
    || moduleEntryCardText(summaryField ? data[summaryField.key] : '');
  const configuredTitle = clean(display.titleField) ? moduleEntryCardText(data[display.titleField]) : '';
  const title = configuredTitle
    || clean(entry.title)
    || moduleEntryCardText(titleField ? data[titleField.key] : '')
    || 'Untitled entry';

  const traits = new Set();
  if (primaryMediaField) {
    const role = resolveModuleFieldSemanticRole(primaryMediaField);
    traits.add('media');
    if (role === 'gallery' || ['images','gallery'].includes(primaryMediaField.type)) traits.add('gallery');
  }
  for (const field of fields) {
    const value = data[field.key];
    if (!moduleMediaValuePresent(value)) continue;
    const role = resolveModuleFieldSemanticRole(field);
    if (role === 'document' || ['pdf','document','file','project-file','files'].includes(field.type)) traits.add('document');
    if (['start-date','end-date'].includes(role)) traits.add('chronology');
    if (['subtitle','byline','publication-date','reading-time'].includes(role)) traits.add('editorial');
    if (role === 'context') traits.add('context');
  }
  if (summary) traits.add('narrative');
  if (tags.length) traits.add('tags');

  const traitList = [...traits];
  return {
    module,
    data,
    title,
    summary,
    category,
    tags,
    primaryMediaField,
    primaryMediaValue,
    displayImageField,
    configuredDisplayMediaField,
    traits: traitList,
    cardProfile: resolveModuleCardProfile(traitList, { module })
  };
}

export function projectLinkDescriptorFromModule(moduleRaw = {}) {
  const module = normalizeModuleDefinition(moduleRaw);
  return {
    key: module.key,
    moduleId: module.id,
    label: module.title || module.key,
    publicDestination: `#${module.slug || module.key}`,
    linkScope: module.projectLinking.scope,
    active: module.projectLinking.enabled && module.enabled
  };
}

export function eligibleModuleEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry?.status === 'published' && entry?.visible !== false);
}

export function resolveModulePublicRecords(moduleRaw = {}, entries = []) {
  const module = normalizeModuleDefinition(moduleRaw);
  const wantedKey = moduleSlug(module.key);
  return eligibleModuleEntries(entries).filter((entry) => moduleSlug(entry?.sectionKey) === wantedKey);
}

export function moduleDateFieldProfile(moduleRaw = {}, fieldRaw = {}, now = new Date()) {
  const module = normalizeModuleDefinition(moduleRaw);
  const field = normalizeEntryField(fieldRaw);
  const current = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const currentYear = current.getFullYear();
  const currentMonth = current.getMonth() + 1;
  const currentDay = current.getDate();
  const precision = field.datePrecision && field.datePrecision !== 'auto'
    ? field.datePrecision
    : module.adminWorkspace === 'timeline' ? 'month-year' : 'exact-date';
  const range = field.dateRange && field.dateRange !== 'auto'
    ? field.dateRange
    : 'past-present';
  return {
    precision,
    range,
    currentYear,
    currentMonth,
    currentDay,
    minYear: range === 'present-future' ? currentYear : 1900,
    maxYear: range === 'past-present' ? currentYear : currentYear + 100,
    minMonth: range === 'present-future' ? currentMonth : 1,
    maxMonth: range === 'past-present' ? currentMonth : 12
  };
}

export function modulePublicCompositionState(moduleRaw = {}) {
  const module = normalizeModuleDefinition(moduleRaw);
  const composition = module.composition || {};
  const hasPlacement = Boolean(clean(composition.placement || module.placement));
  const hasPresentation = Boolean(clean(composition.publicPresentation || module.publicPresentation));
  const configured = composition.publicEnabled === true && hasPlacement && hasPresentation;
  const active = configured && module.enabled !== false && module.visible !== false;
  return {
    configured,
    active,
    publicEnabled: composition.publicEnabled === true,
    placement: clean(composition.placement || module.placement),
    publicPresentation: clean(composition.publicPresentation || module.publicPresentation),
    reason: configured ? '' : 'Configure and enable this module in Home / Studio before it can appear on the public portfolio.'
  };
}

export function modulePublicEligibility(moduleRaw = {}, entries = []) {
  const module = normalizeModuleDefinition(moduleRaw);
  const eligibleEntries = eligibleModuleEntries(entries);
  const compositionState = modulePublicCompositionState(module);
  const released = module.status === 'published';
  const eligibility = publicSectionEligibility({
    enabled: compositionState.active && released,
    records: eligibleEntries,
    navigation: module.navigationLink
  });
  return { eligible: eligibility.section, released, ...eligibility };
}

export function resolveModuleAction(moduleRaw = {}, entries = []) {
  const module = normalizeModuleDefinition(moduleRaw);
  const eligibility = modulePublicEligibility(module, entries);
  if (!module.projectLinking.enabled || !eligibility.section) return { available: false, target: '' };
  return { available: true, target: `#${module.slug || module.key}` };
}

export function moduleRecordBulkCapabilities(moduleRaw = {}) {
  normalizeModuleDefinition(moduleRaw);
  const coreKeys = new Set(CORE_ENTRY_PROPERTIES.map((item) => item.key));
  return {
    publishing: coreKeys.has('status'),
    visibility: coreKeys.has('visible'),
    featured: coreKeys.has('featured'),
    deletion: true
  };
}


const ENTRY_STUDIO_MEDIA_TYPES = new Set(['image', 'images', 'gallery', 'video', 'audio', 'pdf', 'document', 'file', 'project-file', 'files']);
const ENTRY_STUDIO_NARRATIVE_TYPES = new Set(['textarea', 'rich-text', 'tags']);

export function moduleEntryStudioProfile(raw = {}) {
  const module = normalizeModuleDefinition(raw);
  const fields = module.fields.filter((field) => !isCoreEntryPropertyKey(field.key));
  const mediaFields = fields.filter((field) => ENTRY_STUDIO_MEDIA_TYPES.has(field.type));
  const nonMediaFields = fields.filter((field) => !ENTRY_STUDIO_MEDIA_TYPES.has(field.type));
  const groups = {
    context: nonMediaFields.filter((field) => field.type !== 'date' && !ENTRY_STUDIO_NARRATIVE_TYPES.has(field.type)),
    dates: nonMediaFields.filter((field) => field.type === 'date'),
    narrative: nonMediaFields.filter((field) => ENTRY_STUDIO_NARRATIVE_TYPES.has(field.type))
  };
  const mediaHeavy = ['media-library', 'gallery'].includes(module.adminWorkspace)
    || mediaFields.length >= 2
    || mediaFields.some((field) => ['video', 'images', 'gallery'].includes(field.type));
  const composition = mediaHeavy ? (nonMediaFields.length ? 'hybrid' : 'media') : 'structured';
  const timeline = module.adminWorkspace === 'timeline';
  const textContent = module.adminWorkspace === 'text-content';
  const showcase = module.contentIntent === 'showcase';
  const labels = {
    identity: { title: 'Basic information', hint: 'Core identity and classification' },
    context: {
      title: timeline ? 'Role & context' : textContent ? 'Content metadata' : 'Entry information',
      hint: timeline ? 'Describe where this timeline item belongs.' : 'Structured details generated from this module schema.'
    },
    dates: {
      title: timeline ? 'Dates & timeline' : 'Dates',
      hint: timeline ? 'Chronological fields drive the Timeline workspace.' : 'Date fields configured by this module.'
    },
    narrative: {
      title: timeline ? 'Description & achievements' : textContent ? 'Content' : showcase ? 'Optional description' : 'Description & details',
      hint: timeline ? 'Summaries, achievements and supporting context.' : showcase ? 'Optional supporting context; showcase samples can be complete with identity and configured media.' : 'Long-form content and descriptive fields.'
    },
    media: {
      title: composition === 'media' ? 'Media workspace' : 'Media & assets',
      hint: composition === 'structured' ? 'Supporting media configured by this module.' : 'Preview and source assets use the canonical media workflow.'
    }
  };
  const profileLabel = composition === 'media' ? 'Media workspace' : composition === 'hybrid' ? 'Hybrid content workspace' : timeline ? 'Timeline workspace' : 'Structured content workspace';
  return { composition, profileLabel, workspace: module.adminWorkspace, groups, mediaFields, labels };
}

export function moduleStudioTabs(moduleRaw = {}) {
  const module = normalizeModuleDefinition(moduleRaw);
  const tabs = ['details'];
  if (module.fields.some((field) => ENTRY_STUDIO_MEDIA_TYPES.has(field.type))) tabs.push('media');
  if (module.entryCapabilities.skills || module.entryCapabilities.tools) tabs.push('skills-tools');
  tabs.push('publishing');
  return tabs;
}
