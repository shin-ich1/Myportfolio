import { storageBridgeOrigin } from './storage-bridge-url.js';
import { normalizeStorageAsset, storageAssetIdentityTokens, storageAssetUrl } from './storage-asset.js';

const text = (value = '') => String(value ?? '').trim();

function normalizeExternalAssetUrl(value = '') {
  const raw = text(value).replace(/\\/g, '/');
  if (!raw) return '';
  if (/^(?:https?:|data:|blob:|file:|mailto:|tel:|#|\/\/)/i.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  // Legacy portfolio records commonly persist site-owned media as assets/... or
  // ../assets/.... Those references must resolve from the portfolio root, never
  // relative to the current Admin page (/admin/pages/...).
  const siteAsset = raw.match(/^(?:\.\.\/|\.\/)*(assets\/.+)$/i);
  if (siteAsset) return `/${siteAsset[1]}`;
  return raw;
}
const MEDIA_WRAPPER_KEYS = Object.freeze([
  'asset', 'media', 'image', 'file', 'imageAsset', 'uploadedAsset', 'uploadedFile', 'pdfAsset',
  'coverImage', 'certificateImage', 'thumbnail', 'previewImage', 'primaryImage',
  'singleImage', 'beforeImage', 'afterImage', 'logoAsset', 'projectLogo', 'demoVideo',
  'pdfDocument', 'sourceFile', 'galleryImages', 'sourceFiles', 'customAssets',
  'cover', 'source', 'document', 'video', 'audio', 'pdf', 'logo', 'gallery', 'images', 'files', 'resources'
]);
const MEDIA_URL_KEYS = Object.freeze([
  'url', 'secureUrl', 'secure_url', 'fileUrl', 'imageUrl', 'coverImageUrl', 'thumbnailUrl',
  'certificateUrl', 'previewUrl', 'downloadUrl', 'downloadURL', 'src', 'href'
]);
let configuredWorkerBase = null;

export function configureAssetResolverWorkerBase(value) {
  configuredWorkerBase = value === null ? null : text(value);
}

function runtimeWorkerBase() {
  if (configuredWorkerBase !== null) return configuredWorkerBase.replace(/\/$/, '');
  return storageBridgeOrigin();
}

function managedAssetIsImage(asset = {}) {
  const mimeType = text(asset?.mimeType || asset?.mime || asset?.contentType).toLowerCase();
  const resourceType = text(asset?.resourceType || asset?.resource_type).toLowerCase();
  if (mimeType.startsWith('image/')) return true;
  if (resourceType === 'image') return true;
  const url = text(asset?.secureUrl || asset?.url || asset?.previewUrl || asset?.originalUrl);
  return /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i.test(url);
}

function driveUrls(asset) {
  const base = runtimeWorkerBase();
  if (!base || !asset?.storageProfileId || !asset?.assetId) return { url: '', previewUrl: '', cardUrl: '', detailUrl: '', originalUrl: '', downloadUrl: '' };
  const root = `${base}/storage/google-drive/public/${encodeURIComponent(asset.storageProfileId)}/${encodeURIComponent(asset.assetId)}`;
  const image = managedAssetIsImage(asset);
  return {
    url: root,
    // Images use the same provider-neutral card/detail delivery contract as
    // Cloudinary. Non-image assets keep the normal inline stream. The original
    // Drive object is never rewritten or replaced.
    previewUrl: image ? `${root}?variant=card` : `${root}?disposition=inline`,
    cardUrl: image ? `${root}?variant=card` : root,
    detailUrl: image ? `${root}?variant=detail` : root,
    originalUrl: root,
    downloadUrl: `${root}?download=1`
  };
}

function findManagedReference(value, depth, maxDepth, seen) {
  if (!value || depth > maxDepth) return null;
  const managed = normalizeStorageAsset(value);
  if (managed) return managed;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = findManagedReference(item, depth + 1, maxDepth, seen);
      if (resolved) return resolved;
    }
    return null;
  }
  for (const key of MEDIA_WRAPPER_KEYS) {
    const resolved = findManagedReference(value[key], depth + 1, maxDepth, seen);
    if (resolved) return resolved;
  }
  return null;
}

function findExternalReference(value, depth, maxDepth, seen) {
  if (!value || depth > maxDepth) return '';
  if (typeof value === 'string') return text(value);
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = findExternalReference(item, depth + 1, maxDepth, seen);
      if (resolved) return resolved;
    }
    return '';
  }
  for (const key of MEDIA_URL_KEYS) {
    const direct = value[key];
    if (typeof direct === 'string' && text(direct)) return text(direct);
  }
  for (const key of MEDIA_WRAPPER_KEYS) {
    const resolved = findExternalReference(value[key], depth + 1, maxDepth, seen);
    if (resolved) return resolved;
  }
  return '';
}

/**
 * Canonical persistence/read reference for any portfolio media value.
 * Managed provider identity wins over stale legacy URL fallbacks. Legacy external
 * media remains a string so existing Firestore records keep their established shape.
 */
export function normalizeAssetReference(value, { maxDepth = 4 } = {}) {
  const managed = findManagedReference(value, 0, maxDepth, new WeakSet());
  if (managed) return managed;
  return normalizeExternalAssetUrl(findExternalReference(value, 0, maxDepth, new WeakSet())) || null;
}

export function isManagedAssetReference(value) {
  const reference = normalizeAssetReference(value);
  return Boolean(reference && normalizeStorageAsset(reference));
}

export function hasAssetReference(value) {
  const reference = normalizeAssetReference(value);
  if (!reference) return false;
  if (typeof reference === 'string') return Boolean(text(reference));
  return Boolean(normalizeStorageAsset(reference));
}

export function assetReferenceIdentity(value) {
  const reference = normalizeAssetReference(value);
  if (!reference) return '';
  const managed = normalizeStorageAsset(reference);
  if (managed) {
    const token = storageAssetIdentityTokens(managed)[0];
    if (token) return token;
    const provider = text(managed.provider).toLowerCase();
    const profile = text(managed.storageProfileId);
    const id = text(managed.assetId || managed.publicId);
    return provider && id ? `asset:${provider}:${profile ? `${profile}:` : ''}${id}` : '';
  }
  const url = text(reference);
  return url ? `url:${url}` : '';
}


export function persistentAssetUrl(value) {
  const reference = normalizeAssetReference(value);
  if (!reference) return '';
  if (typeof reference === 'string') return normalizeExternalAssetUrl(reference);
  const managed = normalizeStorageAsset(reference);
  return managed ? storageAssetUrl(managed, 'display') : '';
}

export function resolveAsset(asset, purpose = 'display') {
  const reference = normalizeAssetReference(asset);
  if (!reference) return null;
  if (typeof reference === 'string') {
    const url = normalizeExternalAssetUrl(reference);
    return { provider: 'external', schemaVersion: 0, url, secureUrl: url, previewUrl: url, downloadUrl: url };
  }
  const normalized = normalizeStorageAsset(reference);
  if (!normalized) return null;
  if (normalized.provider === 'google-drive') {
    const urls = driveUrls(normalized);
    const canonicalUrl = text(urls.url || normalized.url || normalized.secureUrl || normalized.previewUrl || normalized.downloadUrl);
    const canonicalPreview = text(urls.previewUrl || normalized.previewUrl || canonicalUrl);
    const canonicalDownload = text(urls.downloadUrl || normalized.downloadUrl || canonicalUrl);
    return {
      ...normalized,
      url: canonicalUrl,
      secureUrl: canonicalUrl,
      previewUrl: canonicalPreview,
      cardUrl: text(urls.cardUrl || canonicalPreview),
      detailUrl: text(urls.detailUrl || canonicalUrl),
      originalUrl: text(urls.originalUrl || canonicalUrl),
      downloadUrl: canonicalDownload
    };
  }
  return normalized;
}

export function resolveAssetUrl(asset, purpose = 'display') {
  const resolved = resolveAsset(asset, purpose);
  if (!resolved) return '';
  const kind = text(purpose).toLowerCase();
  if (kind === 'download') return text(resolved.downloadUrl || resolved.originalUrl || resolved.url || resolved.secureUrl);
  if (kind === 'original') return text(resolved.originalUrl || resolved.url || resolved.secureUrl || resolved.downloadUrl);
  if (kind === 'card') return text(resolved.cardUrl || storageAssetUrl(resolved, 'card') || resolved.previewUrl || resolved.url || resolved.secureUrl);
  if (kind === 'detail') return text(resolved.detailUrl || storageAssetUrl(resolved, 'detail') || resolved.previewUrl || resolved.url || resolved.secureUrl);
  if (['preview', 'pdf-preview', 'office-preview', 'admin-read'].includes(kind)) return text(resolved.previewUrl || resolved.cardUrl || resolved.url || resolved.secureUrl);
  if (resolved.provider === 'external') return text(resolved.url);
  return storageAssetUrl(resolved, kind) || text(resolved.url || resolved.secureUrl);
}
