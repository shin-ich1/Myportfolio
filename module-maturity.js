import { normalizeModuleDefinition } from './module-platform.js';

const clean = (value = '') => String(value ?? '').trim();
const MEDIA_FIELD_TYPES = new Set(['image','images','gallery','video','audio','pdf','document','file','project-file','files']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    const item = value[key];
    if (item !== undefined) result[key] = stableValue(item);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashString(value = '') {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function structuralSnapshot(rawModule = {}) {
  const module = normalizeModuleDefinition(rawModule);
  return {
    key: module.key,
    contentMode: clean(rawModule.contentMode || rawModule.entryMode || 'standalone').toLowerCase(),
    adminWorkspace: module.adminWorkspace,
    fields: module.fields.map((field) => stableValue(field)),
    entryCapabilities: stableValue(module.entryCapabilities),
    relationships: (module.relationships || []).map((relationship) => stableValue({
      key: clean(relationship.key),
      label: clean(relationship.label || relationship.name),
      targetModule: clean(relationship.targetModule || relationship.moduleKey || relationship.module),
      multiple: relationship.multiple === true,
      required: relationship.required === true,
      public: relationship.public !== false
    })),
    projectLinking: stableValue(module.projectLinking),
    display: stableValue(module.display)
  };
}

export function structuralFingerprint(rawModule = {}) {
  return `smr-${hashString(stableStringify(structuralSnapshot(rawModule)))}`;
}

function blankMaturity(revision) {
  return {
    revision,
    persistenceVerified: false,
    persistenceVerifiedAt: '',
    persistenceSessionId: '',
    lastWriteSessionId: '',
    runtimeFailure: null
  };
}

export function reconcileModuleMaturityMeta(rawModule = {}, currentMeta = {}) {
  const previous = currentMeta && typeof currentMeta === 'object' && !Array.isArray(currentMeta) ? currentMeta : {};
  const fingerprint = structuralFingerprint(rawModule);
  const previousFingerprint = clean(previous.structuralFingerprint);
  const previousRevision = Math.max(0, Number(previous.structuralRevision) || 0);
  const changed = !previousFingerprint || previousFingerprint !== fingerprint;
  const structuralRevision = previousRevision > 0 ? (changed ? previousRevision + 1 : previousRevision) : 1;
  const currentMaturity = previous.maturity && typeof previous.maturity === 'object' && !Array.isArray(previous.maturity) ? previous.maturity : {};
  const preserveMaturity = !changed && Number(currentMaturity.revision) === structuralRevision;
  const maturity = preserveMaturity
    ? { ...blankMaturity(structuralRevision), ...currentMaturity, revision: structuralRevision }
    : blankMaturity(structuralRevision);
  return {
    changed,
    fingerprint,
    structuralRevision,
    meta: {
      ...previous,
      structuralFingerprint: fingerprint,
      structuralRevision,
      maturity
    }
  };
}

export function hasMaturityValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return clean(value).length > 0;
  if (Array.isArray(value)) return value.some(hasMaturityValue);
  if (typeof value === 'object') return Object.values(value).some(hasMaturityValue);
  return false;
}

function currentRevisionEntries(entries = [], revision = 0) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => Number(entry?.maturityRevision) === revision);
}

function relationshipUsed(entry = {}, key = '') {
  const value = entry?.relationships?.[key];
  return Array.isArray(value) ? value.length > 0 : hasMaturityValue(value);
}

function meaningfulEntry(entry = {}, module = {}) {
  if (!clean(entry.title || entry?.data?.title)) return false;
  if (clean(entry.shortSummary) || clean(entry.description)) return true;
  if ((module.fields || []).some((field) => hasMaturityValue(entry?.data?.[field.key]))) return true;
  if (module.entryCapabilities?.category?.enabled && clean(entry.category || entry?.data?.[module.entryCapabilities.category.key || 'category'])) return true;
  if (module.entryCapabilities?.skills && Array.isArray(entry.skillIds) && entry.skillIds.length) return true;
  if (module.entryCapabilities?.tools && Array.isArray(entry.toolIds) && entry.toolIds.length) return true;
  if ((module.relationships || []).some((relationship) => relationshipUsed(entry, relationship.key))) return true;
  return false;
}

function criterion(id, label, pass, reason = '') {
  return { id, label, pass: pass === true, reason: clean(reason) };
}

export function evaluateModuleMaturity(sectionRaw = {}, entries = []) {
  const module = normalizeModuleDefinition(sectionRaw);
  const meta = sectionRaw.lifecycleMeta && typeof sectionRaw.lifecycleMeta === 'object' && !Array.isArray(sectionRaw.lifecycleMeta)
    ? sectionRaw.lifecycleMeta
    : {};
  const currentRevision = Math.max(0, Number(meta.structuralRevision) || 0);
  const maturityMeta = meta.maturity && typeof meta.maturity === 'object' && !Array.isArray(meta.maturity)
    ? meta.maturity
    : {};
  const revisionEntries = currentRevisionEntries(entries, currentRevision);
  const meaningfulEntries = revisionEntries.filter((entry) => meaningfulEntry(entry, module));
  const criteria = [];

  criteria.push(criterion(
    'usage.representative',
    'Representative real usage',
    meaningfulEntries.length >= 3,
    meaningfulEntries.length >= 3 ? 'At least three meaningful entries were exercised on this structural revision.' : `Save ${Math.max(0, 3 - meaningfulEntries.length)} more meaningful ${Math.max(0, 3 - meaningfulEntries.length) === 1 ? 'entry' : 'entries'} on this structural revision.`
  ));

  const typeGroups = new Map();
  (module.fields || []).forEach((field) => {
    if (!typeGroups.has(field.type)) typeGroups.set(field.type, []);
    typeGroups.get(field.type).push(field);
  });
  const fieldTypeCriteria = [];
  for (const [type, fields] of typeGroups) {
    const pass = revisionEntries.some((entry) => fields.some((field) => hasMaturityValue(entry?.data?.[field.key])));
    const item = criterion(`field-type.${type}`, `${type} field coverage`, pass, pass ? `${type} field data saved successfully.` : `Use and save at least one configured ${type} field.`);
    fieldTypeCriteria.push(item);
    criteria.push(item);
  }

  const category = module.entryCapabilities?.category;
  if (category?.enabled) {
    const categoryPass = revisionEntries.some((entry) => clean(entry.category || entry?.data?.[category.key || 'category']));
    criteria.push(criterion('capability.category', 'Categories exercised', categoryPass, categoryPass ? 'Category data was saved.' : 'Save at least one entry with a category.'));
  }
  if (module.entryCapabilities?.skills) {
    const pass = revisionEntries.some((entry) => Array.isArray(entry.skillIds) && entry.skillIds.length > 0);
    criteria.push(criterion('capability.skills', 'Skills exercised', pass, pass ? 'Skills were saved.' : 'Save at least one entry with a Skill.'));
  }
  if (module.entryCapabilities?.tools) {
    const pass = revisionEntries.some((entry) => Array.isArray(entry.toolIds) && entry.toolIds.length > 0);
    criteria.push(criterion('capability.tools', 'Tools exercised', pass, pass ? 'Tools were saved.' : 'Save at least one entry with a Tool.'));
  }
  for (const relationship of module.relationships || []) {
    const pass = revisionEntries.some((entry) => relationshipUsed(entry, relationship.key));
    criteria.push(criterion(`relationship.${relationship.key}`, `${relationship.label || relationship.key} relationship exercised`, pass, pass ? 'Relationship data was saved.' : `Save at least one entry using ${relationship.label || relationship.key}.`));
  }

  const mediaTypeChecks = fieldTypeCriteria.filter((item) => MEDIA_FIELD_TYPES.has(item.id.replace('field-type.', '')));
  if (mediaTypeChecks.length) {
    const pass = mediaTypeChecks.every((item) => item.pass);
    criteria.push(criterion('capability.media', 'Media exercised', pass, pass ? 'Configured media types were saved successfully.' : 'Exercise every configured media field type.'));
  }

  const publishingPass = revisionEntries.some((entry) => entry.status === 'published');
  criteria.push(criterion('capability.publishing', 'Publishing exercised', publishingPass, publishingPass ? 'At least one current-revision entry was published.' : 'Publish at least one current-revision entry.'));
  const featuredPass = revisionEntries.some((entry) => entry.featured === true);
  criteria.push(criterion('capability.featured', 'Featured exercised', featuredPass, featuredPass ? 'Featured state was saved.' : 'Mark and save at least one current-revision entry as Featured.'));

  const persistencePass = Number(maturityMeta.revision) === currentRevision && maturityMeta.persistenceVerified === true;
  criteria.push(criterion('persistence.reopen', 'Persistence proven after reopen', persistencePass, persistencePass ? 'Saved data hydrated successfully in a later runtime session.' : 'Leave/refresh/reopen the module after saving current-revision entries.'));

  const editResavePass = revisionEntries.some((entry) => Number(entry.maturitySaveCount) >= 2);
  criteria.push(criterion('usage.edit-resave', 'Edit/resave proven', editResavePass, editResavePass ? 'An existing current-revision entry was edited and saved again.' : 'Edit and resave at least one current-revision entry.'));

  const runtimeFailure = Number(maturityMeta.revision) === currentRevision ? maturityMeta.runtimeFailure : null;
  criteria.push(criterion('runtime.stable', 'No unresolved runtime failure', !runtimeFailure, runtimeFailure ? (runtimeFailure.message || 'Resolve the current module runtime failure.') : 'No unresolved runtime failure is recorded for this revision.'));

  const missing = criteria.filter((item) => !item.pass);
  return {
    currentRevision,
    currentRevisionEntryCount: revisionEntries.length,
    meaningfulEntryCount: meaningfulEntries.length,
    total: criteria.length,
    passed: criteria.length - missing.length,
    failed: missing.length,
    ready: currentRevision > 0 && missing.length === 0,
    checks: criteria,
    missing
  };
}
