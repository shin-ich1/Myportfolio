import {
  collection,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { db } from './firebase.js';
import { normalizeStorageSettings } from './storageProviderRegistry.js';
import { collectManagedMediaReferences, uniqueManagedMediaReferences } from '../../media-asset-lifecycle.js';

const STORAGE_DOC = doc(db, 'settings', 'storage');
const text = (value = '') => String(value ?? '').trim();

export async function loadStorageSettings() {
  const snapshot = await getDoc(STORAGE_DOC);
  return snapshot.exists() ? normalizeStorageSettings(snapshot.data()) : normalizeStorageSettings(null);
}

export async function saveStorageSettings(settings) {
  const normalized = normalizeStorageSettings(settings);
  const serializable = {
    version: 1,
    defaults: normalized.defaults,
    profiles: Object.fromEntries(Object.entries(normalized.profiles).map(([id, profile]) => {
      const { id: ignoredId, implicit, ...safe } = profile;
      return [id, safe];
    }))
  };
  await setDoc(STORAGE_DOC, serializable, { merge: false });
  return normalizeStorageSettings(serializable);
}


export async function persistStorageProfileVerification(profile = {}, { healthy, code = "", message = "", result = null } = {}) {
  const id = text(profile.id || profile.profileId);
  if (!id) throw new Error('Storage profile ID is required.');

  const next = {
    ...profile,
    ...(result?.rootFolderId ? { rootFolderId: result.rootFolderId } : {}),
    ...(result?.rootFolderName ? { rootFolderName: result.rootFolderName } : {}),
    ...(result?.managementUrl ? { managementUrl: result.managementUrl } : {}),
    ...(profile.provider === 'google-drive' && result ? {
      publicReady: result.publicReady === true,
      publicVerifiedAt: result.publicVerifiedAt || ''
    } : {}),
    usageSnapshot: {
      ...(profile.usageSnapshot || {}),
      ...(result?.storageQuota ? { storageQuota: result.storageQuota } : {}),
      ...(result?.account ? {
        account: {
          displayName: result.account.displayName || '',
          emailAddress: result.account.emailAddress || ''
        }
      } : {}),
      healthy: healthy === true,
      status: healthy === true ? 'healthy' : 'warning',
      code: text(code),
      message: text(message),
      updatedAt: new Date().toISOString()
    }
  };

  const { id: ignoredId, implicit, ...serializable } = next;
  await setDoc(STORAGE_DOC, { profiles: { [id]: serializable } }, { mergeFields: [new FieldPath('profiles', id)] });
  return { ...next, id };
}

export async function saveStorageDefaults(defaults = {}) {
  const current = await loadStorageSettings();
  return saveStorageSettings({ ...current, defaults: { ...current.defaults, ...defaults } });
}

export async function upsertStorageProfile(profileId, profile = {}) {
  const id = text(profileId);
  if (!id) throw new Error('Storage profile ID is required.');
  const current = await loadStorageSettings();
  return saveStorageSettings({
    ...current,
    profiles: {
      ...current.profiles,
      [id]: { ...current.profiles?.[id], ...profile, implicit: false }
    }
  });
}

export async function disconnectStorageProfile(profileId, { referenceCount = 0 } = {}) {
  const id = text(profileId);
  if (!id) throw new Error('Storage profile ID is required.');
  if (Number(referenceCount) > 0) throw new Error(`Storage profile still owns ${Number(referenceCount)} managed asset${Number(referenceCount) === 1 ? '' : 's'}.`);
  const current = await loadStorageSettings();
  const requiredBy = Object.entries(current.defaults || {}).filter(([, value]) => value === id).map(([family]) => family);
  if (requiredBy.length) throw new Error(`Storage profile is still the default for: ${requiredBy.join(', ')}.`);
  if (!current.profiles?.[id]) return current;
  const profiles = { ...current.profiles };
  delete profiles[id];
  return saveStorageSettings({ ...current, profiles, includeImplicitCloudinary: id !== 'cloudinary-default' });
}


const STORAGE_SCAN_COLLECTIONS = Object.freeze([
  'projects', 'photoEditingProjects', 'experiences', 'education', 'skills', 'certificates', 'resumes', 'portfolioSectionEntries'
]);
const STORAGE_SCAN_SINGLETONS = Object.freeze([
  ['portfolio', 'home'], ['portfolio', 'profile'], ['portfolio', 'contact'], ['portfolio', 'services']
]);

export async function scanStorageUsageByProfile(profileIds = []) {
  const requestedIds = [...new Set((profileIds || []).map(text).filter(Boolean))];
  const usageByProfile = new Map(requestedIds.map((id) => [id, { assetCount: 0, bytes: 0, references: [] }]));

  const [collectionSnapshots, singletonSnapshots] = await Promise.all([
    Promise.all(STORAGE_SCAN_COLLECTIONS.map((name) => getDocs(collection(db, name)))),
    Promise.all(STORAGE_SCAN_SINGLETONS.map(([collectionName, documentName]) => getDoc(doc(db, collectionName, documentName))))
  ]);

  const values = [];
  collectionSnapshots.forEach((snapshot) => snapshot.docs.forEach((item) => values.push(item.data() || {})));
  singletonSnapshots.forEach((snapshot) => { if (snapshot.exists()) values.push(snapshot.data() || {}); });

  const references = uniqueManagedMediaReferences(values.flatMap((value) => collectManagedMediaReferences(value)));
  references.forEach((asset) => {
    const profileId = text(asset.storageProfileId || (asset.provider === 'cloudinary' ? 'cloudinary-default' : ''));
    if (!profileId || (requestedIds.length && !usageByProfile.has(profileId))) return;
    if (!usageByProfile.has(profileId)) usageByProfile.set(profileId, { assetCount: 0, bytes: 0, references: [] });
    const usage = usageByProfile.get(profileId);
    usage.references.push(asset);
    usage.assetCount += 1;
    usage.bytes += Math.max(0, Number(asset.bytes) || 0);
  });

  return usageByProfile;
}

export async function scanStorageProfileUsage(profileId) {
  const id = text(profileId);
  if (!id) return { assetCount: 0, bytes: 0, references: [] };
  const usageByProfile = await scanStorageUsageByProfile([id]);
  return usageByProfile.get(id) || { assetCount: 0, bytes: 0, references: [] };
}
