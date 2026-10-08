import { disconnectStorageProfile, loadStorageSettings, scanStorageProfileUsage } from './storageSettingsService.js';
import { getStorageProvider, registerStorageProvider } from './storageProviderRegistry.js';

const text = (value = '') => String(value ?? '').trim();

async function ensureProvider(providerId) {
  let provider = getStorageProvider(providerId);
  if (provider) return provider;
  if (providerId === 'google-drive') {
    const module = await import('./storageProviders/googleDriveStorageProvider.js');
    provider = registerStorageProvider(module.googleDriveStorageProvider || module.default);
  } else if (providerId === 'cloudinary') {
    const module = await import('./storageProviders/cloudinaryStorageProvider.js');
    provider = registerStorageProvider(module.cloudinaryStorageProvider || module.default);
  }
  return provider;
}

export async function removeConnectedStorageProfile(profileId) {
  const id = text(profileId);
  if (!id) throw new Error('Storage profile ID is required.');
  const settings = await loadStorageSettings();
  const profile = settings.profiles?.[id];
  if (!profile) return { removed: false, missing: true, profileId: id };
  const usage = await scanStorageProfileUsage(id);
  if (usage.assetCount > 0) {
    const error = new Error(`${usage.assetCount} managed asset${usage.assetCount === 1 ? '' : 's'} still depend on this storage.`);
    error.code = 'STORAGE_PROFILE_IN_USE';
    error.usage = usage;
    throw error;
  }
  const defaultFamilies = Object.entries(settings.defaults || {}).filter(([, value]) => value === id).map(([family]) => family);
  if (defaultFamilies.length) {
    const error = new Error(`Choose a new default storage for: ${defaultFamilies.join(', ')}.`);
    error.code = 'STORAGE_PROFILE_DEFAULT';
    error.defaultFamilies = defaultFamilies;
    throw error;
  }
  const provider = await ensureProvider(profile.provider);
  if (provider?.disconnect) await provider.disconnect({ id, ...profile });
  const next = await disconnectStorageProfile(id, { referenceCount: 0 });
  return { removed: true, profileId: id, remoteFilesPreserved: true, settings: next };
}
