import {
  getStorageProfiles,
  profileSupportsFamily,
  registerStorageProvider,
  setStorageRegistrySnapshot
} from '../services/storageProviderRegistry.js';
import { loadStorageSettings } from '../services/storageSettingsService.js';

const text = (value = '') => String(value ?? '').trim();

async function ensureKnownProvider(providerId) {
  if (providerId === 'cloudinary') {
    const module = await import('../services/storageProviders/cloudinaryStorageProvider.js');
    registerStorageProvider(module.cloudinaryStorageProvider || module.default);
  } else if (providerId === 'google-drive') {
    const module = await import('../services/storageProviders/googleDriveStorageProvider.js');
    registerStorageProvider(module.googleDriveStorageProvider || module.default);
  }
}

async function compatibleProfiles(family, access) {
  try { setStorageRegistrySnapshot(await loadStorageSettings()); } catch { /* implicit Cloudinary fallback remains available */ }
  const profiles = getStorageProfiles().filter((profile) => profile.enabled !== false);
  await Promise.all([...new Set(profiles.map((profile) => profile.provider))].map((providerId) => ensureKnownProvider(providerId).catch(() => {})));
  return getStorageProfiles().filter((profile) => profile.enabled !== false && profileSupportsFamily(profile, family, access));
}

export function mountStorageFieldControl(container, {
  family = 'file',
  access = 'public-preview',
  value = 'automatic',
  onChange = () => {}
} = {}) {
  if (!(container instanceof Element)) return null;
  const wrapper = document.createElement('label');
  wrapper.className = 'lan-storage-field-control';
  wrapper.setAttribute('data-storage-field-control', '');
  wrapper.innerHTML = `<span>Storage</span><select aria-label="Storage destination"><option value="automatic">Automatic</option></select><small>Automatic follows Storage Hub defaults.</small>`;
  container.appendChild(wrapper);
  const select = wrapper.querySelector('select');
  let current = text(value) || 'automatic';

  const refresh = async () => {
    const profiles = await compatibleProfiles(family, access);
    select.innerHTML = `<option value="automatic">Automatic</option>${profiles.map((profile) => `<option value="${profile.id}">${profile.label}</option>`).join('')}`;
    select.value = profiles.some((profile) => profile.id === current) ? current : 'automatic';
    current = select.value;
    return profiles;
  };

  select.addEventListener('change', () => {
    current = select.value || 'automatic';
    onChange(current);
  });
  void refresh();

  return {
    element: wrapper,
    select,
    get value() { return current; },
    setValue(next) {
      current = text(next) || 'automatic';
      if ([...select.options].some((option) => option.value === current)) select.value = current;
      else select.value = 'automatic';
    },
    refresh,
    destroy() { wrapper.remove(); }
  };
}
