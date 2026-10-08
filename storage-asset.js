const CLOUDINARY_HOST = 'res.cloudinary.com';
const text = (value = '') => String(value ?? '').trim();
const lower = (value = '') => text(value).toLowerCase();

export function isManagedCloudinaryUrl(value = '') {
  const url = text(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === CLOUDINARY_HOST;
  } catch {
    return false;
  }
}

function directUrl(value = {}) {
  if (!value || typeof value !== 'object') return '';
  return text(value.secureUrl || value.secure_url || value.url || value.fileUrl || value.imageUrl);
}

function googleDriveRouteIdentity(value = {}) {
  if (!value || typeof value !== 'object') return { storageProfileId: '', assetId: '' };
  const candidates = [
    value.secureUrl, value.secure_url, value.url, value.fileUrl, value.imageUrl,
    value.previewUrl, value.preview_url, value.cardUrl, value.card_url,
    value.detailUrl, value.detail_url, value.originalUrl, value.original_url,
    value.downloadUrl, value.download_url
  ].map(text).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate, 'https://lan.invalid');
      const match = parsed.pathname.match(/\/storage\/google-drive\/public\/([^/]+)\/([^/]+)/i);
      if (!match) continue;
      return {
        storageProfileId: decodeURIComponent(match[1] || ''),
        assetId: decodeURIComponent(match[2] || '')
      };
    } catch {
      // Keep scanning other persisted delivery aliases.
    }
  }
  return { storageProfileId: '', assetId: '' };
}

function inferCloudinaryFromUrl(value = '') {
  if (!isManagedCloudinaryUrl(value)) return {};
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const resourceType = ['image', 'video', 'raw'].includes(parts[1]) ? parts[1] : '';
    const deliveryType = parts[2] || 'upload';
    let payload = parts.slice(3);
    const versionIndex = payload.findIndex((part) => /^v\d+$/.test(part));
    if (versionIndex >= 0) payload = payload.slice(versionIndex + 1);
    let publicId = payload.join('/');
    if (resourceType && resourceType !== 'raw') publicId = publicId.replace(/\.[a-z0-9]+$/i, '');
    return { resourceType, type: deliveryType || 'upload', publicId };
  } catch {
    return {};
  }
}

function inferProvider(value = {}) {
  const explicit = lower(value.provider || value.storageProvider);
  if (explicit) return explicit;
  const driveIdentity = googleDriveRouteIdentity(value);
  if (driveIdentity.storageProfileId && driveIdentity.assetId) return 'google-drive';
  const url = directUrl(value);
  if (isManagedCloudinaryUrl(url)) return 'cloudinary';
  if (text(value.publicId || value.public_id) || text(value.resourceType || value.resource_type)) return 'cloudinary';
  if (text(value.assetId || value.asset_id) && !text(value.storageProfileId || value.storage_profile_id)) return 'cloudinary';
  return '';
}

function profileFor(provider = '', value = {}) {
  const explicit = text(value.storageProfileId || value.storage_profile_id);
  if (explicit && explicit.toLowerCase() !== 'automatic') return explicit;
  if (provider === 'google-drive') return googleDriveRouteIdentity(value).storageProfileId;
  if (provider === 'cloudinary') return 'cloudinary-default';
  return '';
}

export function normalizeStorageAsset(value) {
  if (typeof value === 'string') {
    const url = text(value);
    if (!isManagedCloudinaryUrl(url)) return null;
    const inferred = inferCloudinaryFromUrl(url);
    return {
      schemaVersion: 2,
      provider: 'cloudinary',
      storageProfileId: 'cloudinary-default',
      assetId: '',
      publicId: text(inferred.publicId),
      resourceType: text(inferred.resourceType),
      type: text(inferred.type || 'upload') || 'upload',
      url,
      secureUrl: url,
      previewUrl: '',
      downloadUrl: '',
      name: '',
      originalFilename: '',
      mimeType: '',
      bytes: 0,
      width: 0,
      height: 0,
      folder: '',
      access: '',
      uploadedAt: ''
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const provider = inferProvider(value);
  if (!provider) return null;
  const url = directUrl(value);
  const inferred = provider === 'cloudinary' ? inferCloudinaryFromUrl(url) : {};
  const driveIdentity = provider === 'google-drive' ? googleDriveRouteIdentity(value) : { storageProfileId: '', assetId: '' };
  const assetId = text(value.assetId || value.asset_id || value.fileId || value.file_id || driveIdentity.assetId);
  const publicId = text(value.publicId || value.public_id || value.path || inferred.publicId);
  const profileId = profileFor(provider, value);
  if (!assetId && provider !== 'cloudinary' && !profileId) return null;
  if (provider === 'cloudinary' && !assetId && !publicId && !isManagedCloudinaryUrl(url)) return null;

  const secureUrl = text(value.secureUrl || value.secure_url || value.url || value.fileUrl || value.imageUrl);
  return {
    ...value,
    schemaVersion: 2,
    provider,
    storageProfileId: profileId,
    assetId,
    publicId,
    resourceType: text(value.resourceType || value.resource_type || inferred.resourceType),
    type: text(value.type || value.deliveryType || value.delivery_type || inferred.type || 'upload') || 'upload',
    url: secureUrl,
    secureUrl,
    previewUrl: text(value.previewUrl || value.preview_url),
    cardUrl: text(value.cardUrl || value.card_url),
    detailUrl: text(value.detailUrl || value.detail_url),
    originalUrl: text(value.originalUrl || value.original_url || secureUrl),
    downloadUrl: text(value.downloadUrl || value.download_url),
    name: text(value.name || value.filename || value.originalFilename || value.original_filename || value.displayName || value.display_name),
    originalFilename: text(value.originalFilename || value.original_filename || value.name || value.filename),
    mimeType: text(value.mimeType || value.mime || value.fileType),
    bytes: Math.max(0, Number(value.bytes || value.size) || 0),
    width: Math.max(0, Number(value.width) || 0),
    height: Math.max(0, Number(value.height) || 0),
    folder: text(value.folder || value.assetFolder || value.asset_folder),
    access: text(value.access || value.accessMode || value.accessPolicy),
    uploadedAt: text(value.uploadedAt || value.createdAt || value.created_at)
  };
}

export function storageAssetProvider(value) {
  return normalizeStorageAsset(value)?.provider || '';
}

export function isManagedStorageAsset(value) {
  return Boolean(normalizeStorageAsset(value));
}

export function storageAssetIdentityTokens(value) {
  const asset = normalizeStorageAsset(value);
  if (!asset) return [];
  const tokens = [];
  const provider = lower(asset.provider);
  const profileId = text(asset.storageProfileId);
  const assetId = text(asset.assetId);
  if (provider && profileId && assetId) tokens.push(`asset:${provider}:${profileId}:${assetId}`);
  else if (provider && assetId) tokens.push(`asset:${provider}:${assetId}`);
  if (provider === 'cloudinary' && asset.publicId) {
    tokens.push(`public:cloudinary:${lower(asset.resourceType || 'image')}:${lower(asset.type || 'upload')}:${asset.publicId}`);
  }
  for (const url of [asset.url, asset.secureUrl, asset.previewUrl, asset.downloadUrl]) {
    const cleanUrl = text(url);
    if (cleanUrl) tokens.push(`url:${cleanUrl}`);
  }
  return [...new Set(tokens)];
}


function cloudinaryImageDeliveryUrl(asset = {}, purpose = 'display') {
  const base = text(asset.secureUrl || asset.url || asset.previewUrl);
  if (!base || lower(asset.provider) !== 'cloudinary') return '';
  const resourceType = lower(asset.resourceType || 'image');
  if (resourceType && resourceType !== 'image') return base;
  const kind = lower(purpose);
  const transform = kind === 'card'
    ? 'c_limit,w_1200,h_1200,f_auto,q_auto:best'
    : kind === 'detail'
      ? 'c_limit,w_2400,h_2400,f_auto,q_auto:best'
      : '';
  if (!transform || !base.includes('/upload/')) return base;
  return base.replace('/upload/', `/upload/${transform}/`);
}

export function storageAssetUrl(value, purpose = 'display') {
  const asset = normalizeStorageAsset(value);
  if (!asset) return typeof value === 'string' ? text(value) : directUrl(value);
  const kind = lower(purpose);
  if (kind === 'download') return text(asset.downloadUrl || asset.originalUrl || asset.url || asset.secureUrl);
  if (kind === 'original') return text(asset.originalUrl || asset.url || asset.secureUrl || asset.downloadUrl);
  if (kind === 'card') return text(asset.cardUrl || cloudinaryImageDeliveryUrl(asset, 'card') || asset.previewUrl || asset.url || asset.secureUrl);
  if (kind === 'detail') return text(asset.detailUrl || cloudinaryImageDeliveryUrl(asset, 'detail') || asset.previewUrl || asset.url || asset.secureUrl);
  if (['preview', 'pdf-preview', 'office-preview'].includes(kind)) return text(asset.previewUrl || asset.cardUrl || asset.url || asset.secureUrl);
  return text(asset.url || asset.secureUrl || asset.previewUrl || asset.downloadUrl);
}
