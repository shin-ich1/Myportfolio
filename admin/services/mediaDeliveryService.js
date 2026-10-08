import { normalizeStorageAsset, isManagedStorageAsset } from '../../storage-asset.js';
import { authorizedWorkerFetch } from './storageBridgeService.js';

const REQUEST_TIMEOUT_MS = 30000;
const text = (value = '') => String(value ?? '').trim();

function normalizeReference(reference = {}) {
  const managed = normalizeStorageAsset(reference);
  if (managed) return managed;
  const source = reference && typeof reference === 'object' ? reference : {};
  return {
    provider: text(source.provider),
    storageProfileId: text(source.storageProfileId),
    assetId: text(source.assetId || source.asset_id),
    publicId: text(source.publicId || source.public_id),
    resourceType: text(source.resourceType || source.resource_type),
    deliveryType: text(source.deliveryType || source.delivery_type || source.type),
    url: text(source.href || source.url || source.secureUrl || source.secure_url || source.fileUrl),
    name: text(source.name || source.originalFilename || source.displayName || source.filename || source.label),
    mimeType: text(source.mimeType || source.mime || source.contentType)
  };
}

export function isManagedMediaAssetReference(reference = {}) {
  return isManagedStorageAsset(reference);
}

export async function fetchManagedMediaAssetBlob(reference = {}) {
  const asset = normalizeReference(reference);
  if (!asset.assetId && !asset.publicId && !asset.url) throw Object.assign(new Error('The media asset reference is incomplete.'), { code: 'media-read-reference' });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await authorizedWorkerFetch('/media/read', {
      method: 'POST',
      body: JSON.stringify({ asset }),
      signal: controller.signal
    });
    if (!response.ok) {
      const contentType = text(response.headers.get('Content-Type')).toLowerCase();
      const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
      throw Object.assign(new Error(payload?.error || `Secure media access returned HTTP ${response.status}.`), {
        code: text(payload?.code || `http-${response.status}`),
        source: text(payload?.source || 'worker')
      });
    }
    const blob = await response.blob();
    if (!blob.size) throw Object.assign(new Error('The secure media response was empty.'), { code: 'media-read-empty' });
    return blob;
  } finally {
    window.clearTimeout(timer);
  }
}
