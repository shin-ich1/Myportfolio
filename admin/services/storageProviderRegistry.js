import { cloudinaryConfig } from '../../config.js';

const text = (value = '') => String(value ?? '').trim();
const providers = new Map();
let settingsLoader = null;
let snapshot = null;

const FAMILY_KEYS = Object.freeze(['image', 'video', 'document', 'file']);

export function createStorageProfileId(providerId = 'storage') {
  const provider = text(providerId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'storage';
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${provider}-${String(random).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 120);
}

export function storageFamilyKey(family = '') {
  const value = text(family).toLowerCase();
  if (value === 'image') return 'image';
  if (['video', 'audio'].includes(value)) return 'video';
  if (['pdf', 'document'].includes(value)) return 'document';
  return 'file';
}

export function buildImplicitCloudinarySettings() {
  return {
    version: 1,
    defaults: {
      image: 'cloudinary-default',
      video: 'cloudinary-default',
      document: 'cloudinary-default',
      file: 'cloudinary-default'
    },
    profiles: {
      'cloudinary-default': {
        provider: 'cloudinary',
        label: 'Cloudinary',
        enabled: true,
        purpose: 'public-media',
        implicit: true,
        cloudName: text(cloudinaryConfig?.cloudName)
      }
    }
  };
}

function normalizeProfile(id, profile = {}) {
  return {
    ...profile,
    id: text(id),
    provider: text(profile.provider).toLowerCase(),
    label: text(profile.label || profile.provider || id) || text(id),
    enabled: profile.enabled !== false,
    purpose: text(profile.purpose || 'public-storage'),
    publicReady: profile.publicReady === true,
    implicit: profile.implicit === true
  };
}

export function normalizeStorageSettings(value) {
  const hasProfiles = value && typeof value === 'object' && value.profiles && typeof value.profiles === 'object' && Object.keys(value.profiles).length;
  if (!hasProfiles) return buildImplicitCloudinarySettings();
  const profiles = {};
  for (const [id, profile] of Object.entries(value.profiles || {})) {
    const normalized = normalizeProfile(id, profile);
    if (normalized.id && normalized.provider) profiles[normalized.id] = normalized;
  }
  const defaults = {};
  const incomingDefaults = value.defaults && typeof value.defaults === 'object' ? value.defaults : {};
  for (const family of FAMILY_KEYS) {
    const selected = text(incomingDefaults[family]);
    defaults[family] = selected && profiles[selected] ? selected : (profiles['cloudinary-default'] ? 'cloudinary-default' : Object.keys(profiles)[0] || '');
  }
  return { version: 1, defaults, profiles };
}

export function registerStorageProvider(adapter) {
  const providerId = text(adapter?.providerId).toLowerCase();
  if (!providerId) throw new Error('Storage provider adapter requires providerId.');
  providers.set(providerId, Object.freeze({ ...adapter, providerId }));
  return providers.get(providerId);
}

export function getStorageProvider(providerId = '') {
  return providers.get(text(providerId).toLowerCase()) || null;
}

export function configureStorageSettingsLoader(loader) {
  settingsLoader = typeof loader === 'function' ? loader : null;
}

export function setStorageRegistrySnapshot(value) {
  snapshot = normalizeStorageSettings(value);
  return snapshot;
}

export async function refreshStorageRegistry() {
  const loaded = settingsLoader ? await settingsLoader() : null;
  return setStorageRegistrySnapshot(loaded);
}

export function getStorageRegistrySnapshot() {
  if (!snapshot) snapshot = buildImplicitCloudinarySettings();
  return snapshot;
}

export function getStorageProfiles() {
  const current = getStorageRegistrySnapshot();
  return Object.entries(current.profiles || {}).map(([id, profile]) => normalizeProfile(id, profile));
}

export function getStorageProfile(id = '') {
  const cleanId = text(id);
  const profile = getStorageRegistrySnapshot().profiles?.[cleanId];
  return profile ? normalizeProfile(cleanId, profile) : null;
}

function capabilityKey(family, access = 'public-preview') {
  const familyKey = storageFamilyKey(family);
  const isPrivate = text(access).toLowerCase() === 'admin-only';
  if (isPrivate) return 'privateAsset';
  if (familyKey === 'image') return 'publicImage';
  if (familyKey === 'video') return 'publicVideo';
  if (familyKey === 'document') return 'publicDocument';
  return 'publicFile';
}

export function profileSupportsFamily(profile, family, access = 'public-preview') {
  const adapter = getStorageProvider(profile?.provider);
  if (!adapter?.capabilities) return true;
  return adapter.capabilities[capabilityKey(family, access)] !== false;
}

export function resolveStorageProfileForFamily(family, overrideId = '', { access = 'public-preview' } = {}) {
  const current = getStorageRegistrySnapshot();
  const key = storageFamilyKey(family);
  const explicitId = text(overrideId && overrideId !== 'automatic' ? overrideId : '');
  const defaultId = text(current.defaults?.[key]);
  const candidateIds = explicitId ? [explicitId] : [defaultId];
  let lastReason = '';
  for (const id of candidateIds.filter(Boolean)) {
    const profile = getStorageProfile(id);
    if (!profile) { lastReason = `Storage profile "${id}" was not found.`; continue; }
    if (!profile.enabled) { lastReason = `Storage profile "${profile.label}" is disabled.`; if (explicitId) break; continue; }
    if (!profileSupportsFamily(profile, family, access)) { lastReason = `Storage profile "${profile.label}" does not support ${key} uploads with ${access} access.`; if (explicitId) break; continue; }
    return profile;
  }
  throw new Error(lastReason || `No compatible storage profile is configured for ${key} uploads.`);
}
