import { authorizedWorkerFetch, authorizedWorkerRequest, publicWorkerUrl } from '../storageBridgeService.js';
import { normalizeStorageAsset } from '../../../storage-asset.js';

const text = (value = '') => String(value ?? '').trim();

async function uploadThroughWorker(profileId, pendingToken, file, onProgress = () => {}) {
  const form = new FormData();
  form.set('profileId', profileId);
  form.set('pendingToken', pendingToken);
  form.set('file', file, file.name || 'file');

  // The Worker owns the Google resumable-session PUT. Keeping that request
  // server-side avoids browser CORS/network failures against Google's upload URL.
  const response = await authorizedWorkerFetch('/storage/google-drive/upload-content', {
    method: 'POST',
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `Google Drive upload failed with HTTP ${response.status}.`);
    error.code = String(payload?.code || `http-${response.status}`);
    error.source = String(payload?.source || 'google-drive');
    throw error;
  }
  onProgress(100);
  return payload;
}

export const googleDriveStorageProvider = Object.freeze({
  providerId: 'google-drive',
  capabilities: Object.freeze({
    publicImage: true,
    publicVideo: true,
    publicDocument: true,
    publicFile: true,
    privateAsset: false,
    resumableUpload: true,
    usageTelemetry: true
  }),
  validateProfile(profile = {}) {
    if (profile.enabled === false) throw new Error('Google Drive storage profile is disabled.');
    return true;
  },
  async getConnectionReadiness() {
    const healthUrl = publicWorkerUrl('/health');
    const fallbackRedirect = publicWorkerUrl('/storage/google-drive/connect/callback');
    if (!healthUrl) return { ready: false, storageOAuthConfigured: false, googleDriveOAuthConfigured: false, redirectUri: fallbackRedirect, workerReachable: false };
    const response = await fetch(healthUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Storage Worker health check failed with HTTP ${response.status}.`);
    const health = await response.json().catch(() => ({}));
    const readiness = {
      ready: health.storageOAuthConfigured !== false && health.googleDriveOAuthConfigured !== false,
      storageOAuthConfigured: health.storageOAuthConfigured !== false,
      googleDriveOAuthConfigured: health.googleDriveOAuthConfigured !== false,
      redirectUri: text(health.googleDriveRedirectUri) || fallbackRedirect,
      workerReachable: true
    };
    return readiness;
  },
  async startConnection(profileId = '') {
    const id = text(profileId);
    if (!id) throw new Error('Google Drive storage profile ID is required.');
    const readiness = await this.getConnectionReadiness();
    if (!readiness.ready) {
      const missing = [];
      if (!readiness.storageOAuthConfigured) missing.push('STORAGE_OAUTH');
      if (!readiness.googleDriveOAuthConfigured) missing.push('GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET');
      const error = new Error(`Google Drive setup is required before connecting. Missing: ${missing.join(', ')}.`);
      error.code = 'google-drive-setup-required';
      error.setup = { ...readiness, missing };
      throw error;
    }
    return authorizedWorkerRequest('/storage/google-drive/connect/start', { method: 'POST', body: JSON.stringify({ profileId: id }) });
  },
  async upload(file, context = {}, onProgress = () => {}) {
    const profileId = text(context.storageProfileId || context.profile?.id);
    if (!profileId) throw new Error('Google Drive storage profile ID is required.');
    if (context.access === 'admin-only') throw new Error('Google Drive public storage cannot accept Admin-only files.');
    const session = await authorizedWorkerRequest('/storage/google-drive/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        profileId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytes: Number(file.size) || 0,
        access: context.access || 'public-preview',
        context: {
          ownerType: context.ownerType || '',
          ownerId: context.ownerId || '',
          moduleId: context.moduleId || '',
          fieldId: context.fieldId || '',
          pageName: context.pageName || '',
          moduleName: context.moduleName || '',
          recordTitle: context.recordTitle || '',
          ownerTitle: context.ownerTitle || ''
        }
      })
    });
    onProgress(8);
    const finalized = await uploadThroughWorker(profileId, session.pendingToken, file, onProgress);
    return normalizeStorageAsset(finalized);
  },
  async delete(asset) {
    const normalized = normalizeStorageAsset(asset);
    if (!normalized) return { deleted: [], skipped: [{ asset, reason: 'invalid-reference' }] };
    return authorizedWorkerRequest('/media/delete', { method: 'POST', body: JSON.stringify({ assets: [normalized], reason: 'provider-delete' }) });
  },
  resolve(asset) {
    return normalizeStorageAsset(asset);
  },
  async testConnection(profile = {}) {
    return authorizedWorkerRequest('/storage/google-drive/test', { method: 'POST', body: JSON.stringify({ profileId: profile.id || profile.profileId }) });
  },
  async getUsage(profile = {}) {
    return this.testConnection(profile);
  },
  getManagementUrl(profile = {}) {
    return text(profile.managementUrl) || (profile.rootFolderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(profile.rootFolderId)}` : 'https://drive.google.com/');
  },
  async disconnect(profile = {}) {
    return authorizedWorkerRequest('/storage/google-drive/disconnect', { method: 'POST', body: JSON.stringify({ profileId: profile.id || profile.profileId }) });
  }
});

export default googleDriveStorageProvider;
