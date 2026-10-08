import { collectManagedMediaReferences, uniqueManagedMediaReferences } from '../../media-asset-lifecycle.js';
import { normalizeStorageAsset, storageAssetIdentityTokens } from '../../storage-asset.js';

const text = (value = '') => String(value ?? '').trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizeProfiles(profiles = {}) {
  const source = Array.isArray(profiles)
    ? profiles
    : Object.entries(profiles || {}).map(([id, profile]) => ({ id, ...(profile || {}) }));
  const map = new Map();
  source.forEach((profile = {}) => {
    const provider = text(profile.provider);
    if (!provider) return;
    const id = text(profile.id || profile.profileId || profile.storageProfileId)
      || (provider === 'cloudinary' ? 'cloudinary-default' : '');
    if (!id) return;
    map.set(id, { ...profile, id, profileId: id, provider });
  });
  return map;
}

function profileIdForAsset(asset = {}) {
  return text(asset.storageProfileId) || (asset.provider === 'cloudinary' ? 'cloudinary-default' : '');
}

function strongestAssetKey(asset = {}) {
  const tokens = storageAssetIdentityTokens(asset);
  return tokens.find((token) => token.startsWith('asset:'))
    || tokens.find((token) => token.startsWith('public:'))
    || tokens.find((token) => token.startsWith('url:'))
    || '';
}

function quotaFromUsage(usage = {}) {
  const credits = usage?.credits;
  if (credits && typeof credits === 'object') {
    const used = number(credits.usage, NaN);
    const limit = number(credits.limit, NaN);
    if (Number.isFinite(used) || Number.isFinite(limit)) {
      const percent = Number.isFinite(number(credits.usedPercent, NaN))
        ? number(credits.usedPercent, NaN)
        : (Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? (used / limit) * 100 : null);
      return {
        available: true,
        unit: 'credits',
        usage: Number.isFinite(used) ? used : null,
        limit: Number.isFinite(limit) ? limit : null,
        percent: Number.isFinite(percent) ? percent : null
      };
    }
  }

  const quota = usage?.storageQuota;
  if (quota && typeof quota === 'object') {
    const used = number(quota.usage, NaN);
    const limit = number(quota.limit, NaN);
    if (Number.isFinite(used) || Number.isFinite(limit)) {
      return {
        available: true,
        unit: 'bytes',
        usage: Number.isFinite(used) ? used : null,
        limit: Number.isFinite(limit) ? limit : null,
        percent: Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? (used / limit) * 100 : null
      };
    }
  }

  return { available: false, unit: '', usage: null, limit: null, percent: null };
}

function healthFrom(profile = {}, usage = {}) {
  if (profile.enabled === false) return 'disabled';
  const status = text(usage.status || usage.health || profile.health).toLowerCase();
  if (['error', 'critical', 'offline', 'failed'].includes(status)) return 'error';
  if (['warning', 'degraded'].includes(status)) return 'warning';
  if (usage.healthy === false) return 'warning';
  return 'healthy';
}

export function buildStorageTelemetry({ profiles = {}, records = [], providerUsage = {} } = {}) {
  const profileMap = normalizeProfiles(profiles);
  const references = uniqueManagedMediaReferences(collectManagedMediaReferences(records));
  const assetIndex = new Map();

  references.forEach((reference) => {
    const asset = normalizeStorageAsset(reference);
    if (!asset) return;
    const profileId = profileIdForAsset(asset);
    const key = strongestAssetKey(asset) || `${asset.provider}:${profileId}:${asset.assetId || asset.publicId || asset.url}`;
    if (!key || assetIndex.has(key)) return;
    assetIndex.set(key, asset);

    if (profileId && !profileMap.has(profileId)) {
      profileMap.set(profileId, {
        id: profileId,
        profileId,
        provider: asset.provider,
        label: asset.provider === 'cloudinary' ? 'Cloudinary' : asset.provider,
        enabled: true,
        discovered: true
      });
    }
  });

  const providers = [...profileMap.values()].map((profile) => {
    const usage = providerUsage?.[profile.id] || providerUsage?.[profile.profileId] || {};
    const assets = [...assetIndex.values()].filter((asset) => profileIdForAsset(asset) === profile.id);
    const trackedBytes = assets.reduce((total, asset) => total + Math.max(0, number(asset.bytes)), 0);
    const health = healthFrom(profile, usage);
    return {
      profileId: profile.id,
      provider: profile.provider,
      label: text(profile.label || profile.name) || profile.provider,
      enabled: profile.enabled !== false,
      publicReady: profile.publicReady === true,
      trackedAssets: assets.length,
      trackedBytes,
      health,
      quota: quotaFromUsage(usage),
      usage
    };
  });

  const enabledProviders = providers.filter((item) => item.enabled);
  const totals = {
    assets: assetIndex.size,
    bytes: [...assetIndex.values()].reduce((total, asset) => total + Math.max(0, number(asset.bytes)), 0),
    connectedProviders: enabledProviders.length,
    healthyProviders: enabledProviders.filter((item) => item.health === 'healthy').length,
    warningProviders: enabledProviders.filter((item) => item.health === 'warning' || item.health === 'error').length
  };

  return { totals, providers, assetIndex };
}
