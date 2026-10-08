import { classifyPortfolioFile } from '../../file-type-registry.js';
import { normalizeStorageAsset } from '../../storage-asset.js';
import {
  getStorageProvider,
  registerStorageProvider,
  resolveStorageProfileForFamily,
  storageFamilyKey
} from './storageProviderRegistry.js';

const text = (value = '') => String(value ?? '').trim();
let temporaryAssetRegistrar = null;

export function configureStorageTemporaryAssetRegistrar(registrar) {
  temporaryAssetRegistrar = typeof registrar === 'function' ? registrar : null;
}

async function ensureProvider(providerId) {
  let provider = getStorageProvider(providerId);
  if (provider) return provider;
  if (providerId === 'cloudinary') {
    const module = await import('./storageProviders/cloudinaryStorageProvider.js');
    provider = registerStorageProvider(module.cloudinaryStorageProvider || module.default);
  } else if (providerId === 'google-drive') {
    const module = await import('./storageProviders/googleDriveStorageProvider.js');
    provider = registerStorageProvider(module.googleDriveStorageProvider || module.default);
  }
  return provider;
}


async function refreshStorageRegistryForUpload() {
  if (typeof window === 'undefined') return;
  const [{ loadStorageSettings }, registry] = await Promise.all([
    import('./storageSettingsService.js'),
    import('./storageProviderRegistry.js')
  ]);
  registry.setStorageRegistrySnapshot(await loadStorageSettings());
}

async function registerTemporaryAsset(asset) {
  if (temporaryAssetRegistrar) return temporaryAssetRegistrar(asset);
  if (typeof window === 'undefined') return [];
  const module = await import('./mediaAssetLifecycleService.js');
  return module.registerTemporaryMediaAsset(asset);
}

function familyForFile(file = {}, requested = '') {
  const explicit = text(requested).toLowerCase();
  if (explicit) return storageFamilyKey(explicit);
  return storageFamilyKey(classifyPortfolioFile(file).family);
}

export function resolveUploadRoute(file, options = {}) {
  const context = options.context && typeof options.context === 'object' ? options.context : {};
  const family = familyForFile(file, options.family || context.family);
  const access = text(options.access || context.access || 'public-preview') || 'public-preview';
  const profile = resolveStorageProfileForFamily(family, options.storageProfileId, { access });
  const provider = getStorageProvider(profile.provider);
  if (!provider) throw new Error(`Storage provider "${profile.provider}" is not registered.`);
  provider.validateProfile?.(profile);
  return { family, access, profile, provider, context };
}

export async function uploadMedia(file, options = {}) {
  await refreshStorageRegistryForUpload();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  let route;
  try {
    route = resolveUploadRoute(file, options);
  } catch (error) {
    if (!/not registered/i.test(String(error?.message || ''))) throw error;
    const contextForRoute = options.context && typeof options.context === 'object' ? options.context : {};
    const family = familyForFile(file, options.family || contextForRoute.family);
    const access = text(options.access || contextForRoute.access || 'public-preview') || 'public-preview';
    const profile = resolveStorageProfileForFamily(family, options.storageProfileId, { access });
    const provider = await ensureProvider(profile.provider);
    if (!provider) throw error;
    route = { family, access, profile, provider, context: contextForRoute };
  }
  const context = {
    ...route.context,
    family: route.family,
    access: route.access,
    storageProfileId: route.profile.id,
    profile: route.profile,
    folder: text(options.folder || route.context.folder),
    kind: options.kind || route.context.kind,
    module: options.module || route.context.module,
    resourceType: options.resourceType || route.context.resourceType
  };
  const raw = await route.provider.upload(file, context, onProgress);
  const normalized = normalizeStorageAsset({
    ...raw,
    schemaVersion: 2,
    provider: raw?.provider || route.profile.provider,
    storageProfileId: raw?.storageProfileId || route.profile.id,
    name: raw?.name || file?.name || '',
    originalFilename: raw?.originalFilename || file?.name || '',
    mimeType: raw?.mimeType || file?.type || '',
    bytes: Number(raw?.bytes || file?.size || 0),
    access: raw?.access || route.access
  });
  if (!normalized) throw new Error('Storage provider returned an invalid managed asset descriptor.');
  await registerTemporaryAsset(normalized);
  return normalized;
}

export function uploadImage(file, folder = '', onProgress = () => {}, routing = {}) {
  return uploadMedia(file, {
    ...routing,
    family: 'image',
    folder,
    onProgress
  });
}

export function uploadVideo(file, folder = '', onProgress = () => {}, routing = {}) {
  return uploadMedia(file, {
    ...routing,
    family: 'video',
    folder,
    onProgress
  });
}

// Provider-neutral compatibility facade for existing media UX helpers.
// Feature pages import this shared service instead of a provider implementation.
export {
  detectExternalVideoProvider,
  getMediaSettings,
  getThumbnailUrl,
  validateMediaFile
} from './cloudinaryService.js';
