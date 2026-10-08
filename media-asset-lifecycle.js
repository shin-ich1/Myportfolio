import {
  isManagedCloudinaryUrl,
  normalizeStorageAsset,
  storageAssetIdentityTokens
} from './storage-asset.js';

const text = (value = '') => String(value ?? '').trim();
export { isManagedCloudinaryUrl };

function normalizeReference(value) {
  return normalizeStorageAsset(value);
}

export function sameManagedMediaReference(first = {}, second = {}) {
  const firstTokens = new Set(storageAssetIdentityTokens(first));
  return storageAssetIdentityTokens(second).some((token) => firstTokens.has(token));
}

function mergeReference(first = {}, second = {}) {
  const a = normalizeReference(first) || {};
  const b = normalizeReference(second) || {};
  return normalizeStorageAsset({
    ...b,
    ...a,
    schemaVersion: 2,
    provider: text(a.provider || b.provider),
    storageProfileId: text(a.storageProfileId || b.storageProfileId),
    assetId: text(a.assetId || b.assetId),
    publicId: text(a.publicId || b.publicId),
    resourceType: text(a.resourceType || b.resourceType),
    type: text(a.type || b.type || 'upload') || 'upload',
    url: text(a.url || b.url),
    secureUrl: text(a.secureUrl || b.secureUrl || a.url || b.url),
    previewUrl: text(a.previewUrl || b.previewUrl),
    downloadUrl: text(a.downloadUrl || b.downloadUrl),
    folder: text(a.folder || b.folder),
    bytes: Number(a.bytes || b.bytes || 0),
    name: text(a.name || b.name),
    originalFilename: text(a.originalFilename || b.originalFilename),
    mimeType: text(a.mimeType || b.mimeType),
    access: text(a.access || b.access),
    uploadedAt: text(a.uploadedAt || b.uploadedAt)
  }) || a || b;
}

export function uniqueManagedMediaReferences(references = []) {
  const unique = [];
  for (const candidate of references) {
    const reference = normalizeReference(candidate);
    if (!reference) continue;
    const existingIndex = unique.findIndex((item) => sameManagedMediaReference(item, reference));
    if (existingIndex >= 0) unique[existingIndex] = mergeReference(unique[existingIndex], reference);
    else unique.push(reference);
  }
  return unique;
}

export function collectManagedMediaReferences(value, { maxDepth = 10 } = {}) {
  const found = [];
  const visited = new WeakSet();

  function visit(current, depth) {
    if (current == null || depth > maxDepth) return;
    if (typeof current === 'string') {
      const reference = normalizeReference(current);
      if (reference) found.push(reference);
      return;
    }
    if (typeof current !== 'object') return;
    if (visited.has(current)) return;
    visited.add(current);

    const direct = normalizeReference(current);
    if (direct) {
      found.push(direct);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(current).forEach((item) => visit(item, depth + 1));
  }

  visit(value, 0);
  return uniqueManagedMediaReferences(found);
}

export function removedManagedMediaReferences(previousValue, nextValue) {
  const previous = collectManagedMediaReferences(previousValue);
  const next = collectManagedMediaReferences(nextValue);
  return previous.filter((reference) => !next.some((candidate) => sameManagedMediaReference(reference, candidate)));
}

export function unreferencedManagedMediaReferences(candidates = [], retainedValues = []) {
  const requested = uniqueManagedMediaReferences(candidates);
  if (!requested.length) return [];
  const retained = collectManagedMediaReferences(retainedValues);
  return requested.filter((reference) => !retained.some((candidate) => sameManagedMediaReference(reference, candidate)));
}
