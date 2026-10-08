import {
  uploadImageRaw,
  uploadVideoRaw,
  uploadMediaRaw
} from '../cloudinaryService.js';
import { normalizeStorageAsset } from '../../../storage-asset.js';
import { authorizedWorkerRequest } from '../storageBridgeService.js';

export const cloudinaryStorageProvider = Object.freeze({
  providerId: 'cloudinary',
  capabilities: Object.freeze({
    publicImage: true,
    publicVideo: true,
    publicDocument: true,
    publicFile: true,
    privateAsset: true,
    resumableUpload: false,
    usageTelemetry: true
  }),
  validateProfile(profile = {}) {
    if (profile.enabled === false) throw new Error('Cloudinary storage profile is disabled.');
    return true;
  },
  async upload(file, context = {}, onProgress = () => {}) {
    const family = String(context.family || '').toLowerCase();
    const folder = String(context.folder || '').trim();
    let uploaded;
    if (family === 'image') uploaded = await uploadImageRaw(file, folder, onProgress);
    else if (family === 'video') uploaded = await uploadVideoRaw(file, folder, onProgress);
    else uploaded = await uploadMediaRaw(file, {
      kind: context.kind || (family === 'document' ? 'pdf' : 'asset'),
      module: context.module || 'global',
      folder,
      resourceType: context.resourceType || 'auto',
      onProgress
    });
    return normalizeStorageAsset({
      ...uploaded,
      schemaVersion: 2,
      provider: 'cloudinary',
      storageProfileId: context.storageProfileId || 'cloudinary-default',
      access: context.access || uploaded.access || 'public-preview'
    });
  },
  async delete(asset) {
    const normalized = normalizeStorageAsset(asset);
    if (!normalized) return { deleted: [], skipped: [{ asset, reason: 'invalid-reference' }] };
    return authorizedWorkerRequest('/media/delete', { method: 'POST', body: JSON.stringify({ assets: [normalized], reason: 'provider-delete' }) });
  },
  resolve(asset) {
    return normalizeStorageAsset(asset);
  },
  async testConnection() {
    const health = await authorizedWorkerRequest('/health', { method: 'GET' });
    return { ok: health?.cloudinaryConfigured === true, ...health };
  },
  async getUsage({ references = [] } = {}) {
    return authorizedWorkerRequest('/telemetry', { method: 'POST', body: JSON.stringify({ references }) });
  },
  getManagementUrl() {
    return 'https://console.cloudinary.com/console';
  },
  async disconnect(profile = {}) {
    return { disconnected: true, profileId: profile.id || profile.profileId || 'cloudinary-default', remoteFilesPreserved: true };
  }
});

export default cloudinaryStorageProvider;
