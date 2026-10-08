import {
  ADMIN_WORKSPACE_ARCHETYPES,
  MODULE_FIELD_TYPES,
  PUBLIC_PRESENTATIONS,
  moduleSlug,
  normalizeEntryField,
  normalizeModuleDefinition
} from './module-platform.js';

const clean = (value = '') => String(value ?? '').trim();
const token = (value = '') => clean(value).toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[\/_–—-]+/g, '-')
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');
const FIELD_TYPE_ALIASES = Object.freeze({
  'multiple-images': 'images',
  'multiple-files': 'files',
  source: 'project-file',
  'source-file': 'project-file'
});
const MEDIA_PRESENTATIONS = new Set(['media-gallery', 'rich-showcase']);
const MEDIA_FIELD_TYPES = new Set(['image', 'images', 'gallery', 'video']);

function check(id, label, pass, reason, purposes) {
  return Object.freeze({ id, label, pass: Boolean(pass), reason: clean(reason), purposes: Object.freeze([...purposes]) });
}

function rawFieldType(raw = {}) {
  const requested = token(raw.type);
  return MODULE_FIELD_TYPES.includes(requested) ? requested : (FIELD_TYPE_ALIASES[requested] || '');
}

function fieldKey(raw = {}, index = 0) {
  return normalizeEntryField(raw, index).key;
}

function relationshipKey(raw = {}, index = 0) {
  const label = clean(raw.label || raw.name || `Relationship ${index + 1}`);
  return clean(raw.key) || moduleSlug(label).replace(/-/g, '_') || `relationship_${index + 1}`;
}

function schemaResult(raw = {}) {
  const seen = new Set();
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  for (const [index, field] of fields.entries()) {
    const key = fieldKey(field, index);
    if (!key) return { pass:false, reason:`Field ${index + 1} needs a stable key.` };
    if (seen.has(key)) return { pass:false, reason:`Field key “${key}” is already used in this module.` };
    seen.add(key);
    if (!rawFieldType(field)) return { pass:false, reason:`Field “${clean(field.label || key)}” uses an unsupported type.` };
  }
  return { pass:true, reason:'Schema field keys and types are valid.' };
}

function capabilitiesResult(raw = {}) {
  const config = raw.entryCapabilities;
  if (config === undefined || config === null) return { pass:true, reason:'Built-in capabilities use their default configuration.' };
  if (typeof config !== 'object' || Array.isArray(config)) return { pass:false, reason:'Entry capabilities must use a valid configuration object.' };
  if (config.category !== undefined) {
    if (typeof config.category !== 'object' || config.category === null || Array.isArray(config.category)) return { pass:false, reason:'Category capability configuration is invalid.' };
    if (config.category.options !== undefined && !Array.isArray(config.category.options)) return { pass:false, reason:'Category options must be stored as a list.' };
  }
  for (const name of ['skills', 'tools']) {
    if (config[name] !== undefined && typeof config[name] !== 'boolean') return { pass:false, reason:`${name === 'skills' ? 'Skills' : 'Tools'} capability must be enabled or disabled.` };
  }
  return { pass:true, reason:'Built-in capability configuration is valid.' };
}

function relationshipKeysResult(raw = {}) {
  const relationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  const seen = new Set();
  for (const [index, relationship] of relationships.entries()) {
    const key = relationshipKey(relationship, index);
    if (seen.has(key)) return { pass:false, reason:`Relationship key “${key}” is already used in this module.` };
    seen.add(key);
  }
  return { pass:true, reason:'Relationship keys are unique and stable.' };
}

function relationshipsResult(raw = {}) {
  const relationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  for (const [index, relationship] of relationships.entries()) {
    const key = relationshipKey(relationship, index);
    if (!moduleSlug(relationship.targetModule || relationship.moduleKey || relationship.module)) {
      return { pass:false, reason:`Relationship “${clean(relationship.label || key)}” needs a target module.` };
    }
  }
  return { pass:true, reason:'Relationship definitions are configured.' };
}

function presentationResult(raw = {}, module = {}) {
  const rawWorkspace = clean(raw.adminWorkspace || raw.workspaceArchetype);
  if (rawWorkspace && !ADMIN_WORKSPACE_ARCHETYPES.includes(token(rawWorkspace))) return { pass:false, reason:'Choose a supported Admin workspace.' };
  const rawPresentation = clean(raw.publicPresentation || raw.presentation);
  if (rawPresentation && !PUBLIC_PRESENTATIONS.includes(token(rawPresentation))) return { pass:false, reason:'Choose a supported public presentation.' };
  if (MEDIA_PRESENTATIONS.has(module.publicPresentation) && !module.fields.some(field => MEDIA_FIELD_TYPES.has(field.type))) {
    return { pass:false, reason:'Add at least one image, gallery, or video field for this media presentation.' };
  }
  return { pass:true, reason:'Admin and public presentation mappings are renderable.' };
}

function studioResult(raw = {}, schema = { pass:true }, capabilities = { pass:true }, relationshipKeys = { pass:true }, relationships = { pass:true }) {
  if (!schema.pass) return { pass:false, reason:schema.reason };
  if (!capabilities.pass) return { pass:false, reason:capabilities.reason };
  if (!relationshipKeys.pass) return { pass:false, reason:relationshipKeys.reason };
  if (!relationships.pass) return { pass:false, reason:relationships.reason };
  return { pass:true, reason:'The generic schema-driven Entry Studio can render this module.' };
}

export function evaluateModuleChecks(rawModule = {}) {
  const module = normalizeModuleDefinition(rawModule);
  const rawKey = moduleSlug(rawModule.key || rawModule.internalKey || rawModule.title || rawModule.publicTitle);
  const identityPass = Boolean(clean(rawModule.title || rawModule.publicTitle) && rawKey);
  const schema = schemaResult(rawModule);
  const capabilities = capabilitiesResult(rawModule);
  const relationshipKeys = relationshipKeysResult(rawModule);
  const relationships = relationshipsResult(rawModule);
  const presentation = presentationResult(rawModule, module);
  const studio = studioResult(rawModule, schema, capabilities, relationshipKeys, relationships);
  const checks = [
    check('identity.valid', 'Module identity valid', identityPass, identityPass ? 'Module title and stable key are available.' : 'Add a module title and stable key.', ['structural','runtimeSafety','public']),
    check('setup.persisted', 'Module setup saved', rawModule.setupComplete === true || module.setupComplete === true, (rawModule.setupComplete === true || module.setupComplete === true) ? 'Module setup is persisted.' : 'Complete and save the module setup.', ['structural']),
    check('schema.valid', 'Schema valid', schema.pass, schema.reason, ['structural','runtimeSafety','persistenceSafety']),
    check('capabilities.valid', 'Capabilities valid', capabilities.pass, capabilities.reason, ['structural','runtimeSafety']),
    check('relationships.keys', 'Relationship keys valid', relationshipKeys.pass, relationshipKeys.reason, ['structural','runtimeSafety','persistenceSafety']),
    check('relationships.valid', 'Relationships configured', relationships.pass, relationships.reason, ['structural','runtimeSafety']),
    check('presentation.valid', 'Presentation configured', presentation.pass, presentation.reason, ['structural','public']),
    check('studio.renderable', 'Entry Studio renderable', studio.pass, studio.reason, ['structural','runtimeSafety'])
  ];
  return { module, checks };
}

export function selectModuleChecks(resultOrChecks, purpose = 'structural') {
  const checks = Array.isArray(resultOrChecks) ? resultOrChecks : (resultOrChecks?.checks || []);
  return checks.filter(checkItem => Array.isArray(checkItem.purposes) && checkItem.purposes.includes(purpose));
}

export function summarizeModuleChecks(resultOrChecks, purpose = 'structural') {
  const checks = selectModuleChecks(resultOrChecks, purpose);
  const missing = checks.filter(checkItem => !checkItem.pass);
  return {
    total: checks.length,
    passed: checks.length - missing.length,
    failed: missing.length,
    ready: missing.length === 0,
    checks,
    missing
  };
}
