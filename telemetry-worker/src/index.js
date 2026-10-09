import { SecurityCoordinator } from "./security-coordinator.js";
export { SecurityCoordinator };

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function serviceError(message, { status = 500, code = "internal", source = "worker", retryAt = "" } = {}) {
  return Object.assign(new Error(message), { status, code, source, retryAt });
}

function json(body, status = 200, origin = "") {
  const headers = new Headers(JSON_HEADERS);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}



const REQUEST_SCHEMA_ANY = Symbol("request-schema-any");

function validateStrictRequestValue(value, schema, path = "body") {
  if (schema === REQUEST_SCHEMA_ANY) return;
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) throw serviceError(`${path} must be an array.`, { status: 400, code: "request-schema-invalid", source: "worker" });
    const itemSchema = schema[0] ?? REQUEST_SCHEMA_ANY;
    value.forEach((item, index) => validateStrictRequestValue(item, itemSchema, `${path}[${index}]`));
    return;
  }
  if (!schema || typeof schema !== "object") return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw serviceError(`${path} must be an object.`, { status: 400, code: "request-schema-invalid", source: "worker" });
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      throw serviceError(`Unknown request field: ${path}.${key}`, { status: 400, code: "request-schema-unknown-field", source: "worker" });
    }
    validateStrictRequestValue(value[key], schema[key], `${path}.${key}`);
  }
}

async function readStrictJsonBody(request, schema = {}) {
  let body;
  try { body = await request.json(); }
  catch { throw serviceError("Request body must be valid JSON.", { status: 400, code: "request-json-invalid", source: "worker" }); }
  validateStrictRequestValue(body, schema, "body");
  return body;
}

function readStrictFormDataFields(form, allowedFields) {
  const allowed = new Set(allowedFields);
  for (const key of form.keys()) {
    if (!allowed.has(key)) throw serviceError(`Unknown request field: body.${key}`, { status: 400, code: "request-schema-unknown-field", source: "worker" });
  }
  return form;
}

const ASSET_REFERENCE_SCHEMA = Object.freeze({
  key: REQUEST_SCHEMA_ANY, assetId: REQUEST_SCHEMA_ANY, fileId: REQUEST_SCHEMA_ANY, url: REQUEST_SCHEMA_ANY, secureUrl: REQUEST_SCHEMA_ANY, secure_url: REQUEST_SCHEMA_ANY,
  publicId: REQUEST_SCHEMA_ANY, public_id: REQUEST_SCHEMA_ANY, resourceType: REQUEST_SCHEMA_ANY, provider: REQUEST_SCHEMA_ANY, storageProfileId: REQUEST_SCHEMA_ANY,
  name: REQUEST_SCHEMA_ANY, mimeType: REQUEST_SCHEMA_ANY, originalFilename: REQUEST_SCHEMA_ANY, bytes: REQUEST_SCHEMA_ANY, access: REQUEST_SCHEMA_ANY, folderId: REQUEST_SCHEMA_ANY,
  webViewLink: REQUEST_SCHEMA_ANY, createdAt: REQUEST_SCHEMA_ANY, context: REQUEST_SCHEMA_ANY
});
const DRIVE_CONTEXT_SCHEMA = Object.freeze({ moduleId: REQUEST_SCHEMA_ANY, ownerType: REQUEST_SCHEMA_ANY, ownerId: REQUEST_SCHEMA_ANY, fieldId: REQUEST_SCHEMA_ANY, pageName: REQUEST_SCHEMA_ANY, moduleName: REQUEST_SCHEMA_ANY, recordTitle: REQUEST_SCHEMA_ANY, ownerTitle: REQUEST_SCHEMA_ANY });
const PUBLIC_KEY_JWK_SCHEMA = Object.freeze({ kty: REQUEST_SCHEMA_ANY, crv: REQUEST_SCHEMA_ANY, x: REQUEST_SCHEMA_ANY, y: REQUEST_SCHEMA_ANY, key_ops: [REQUEST_SCHEMA_ANY], ext: REQUEST_SCHEMA_ANY });
const PUSH_SUBSCRIPTION_SCHEMA = Object.freeze({ endpoint: REQUEST_SCHEMA_ANY, expirationTime: REQUEST_SCHEMA_ANY, keys: { p256dh: REQUEST_SCHEMA_ANY, auth: REQUEST_SCHEMA_ANY } });
const SECURITY_BRANDING_SCHEMA = Object.freeze({ senderName: REQUEST_SCHEMA_ANY, logoUrl: REQUEST_SCHEMA_ANY, heading: REQUEST_SCHEMA_ANY, footer: REQUEST_SCHEMA_ANY });

function allowedOrigin(requestOrigin, env) {
  if (!requestOrigin) return "";
  let url;
  try { url = new URL(requestOrigin); } catch { return ""; }
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1"].includes(host)) return requestOrigin;
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim().toLowerCase();
  if (projectId) {
    if (host === `${projectId}.web.app` || host === `${projectId}.firebaseapp.com`) return requestOrigin;
    if (host.startsWith(`${projectId}--`) && host.endsWith(".web.app")) return requestOrigin;
  }
  return "";
}

function corsPreflight(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  });
}

function decodeJwtPayload(token = "") {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function basicAuth(env) {
  const key = String(env.CLOUDINARY_API_KEY || "");
  const secret = String(env.CLOUDINARY_API_SECRET || "");
  if (!key || !secret) throw serviceError("Cloudinary API secrets are not configured.", { status: 503, code: "cloudinary-config", source: "cloudinary" });
  return `Basic ${btoa(`${key}:${secret}`)}`;
}

function cloudinaryRetryAt(response, message = "") {
  const direct = response.headers.get("x-featureratelimit-reset") || response.headers.get("x-ratelimit-reset");
  if (direct) {
    const numeric = Number(direct);
    if (Number.isFinite(numeric)) {
      const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const date = new Date(direct);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return new Date(Date.now() + retryAfter * 1000).toISOString();
  const match = String(message).match(/try again on\s+(.+?)(?:\.|$)/i);
  if (match) {
    const date = new Date(match[1]);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return "";
}

async function cloudinaryGet(path, env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || "").trim();
  if (!cloudName) throw serviceError("CLOUDINARY_CLOUD_NAME is not configured.", { status: 503, code: "cloudinary-config", source: "cloudinary" });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}${path}`, {
    headers: { Authorization: basicAuth(env), Accept: "application/json" }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Cloudinary request failed with HTTP ${response.status}.`;
    const code = response.status === 401
      ? "cloudinary-auth-failed"
      : response.status === 403
        ? "cloudinary-permission-denied"
        : response.status === 420
          ? "cloudinary-rate-limited"
          : "cloudinary-api-error";
    const status = response.status === 420 ? 503 : response.status === 401 ? 502 : response.status;
    throw serviceError(message, { status, code, source: "cloudinary", retryAt: code === "cloudinary-rate-limited" ? cloudinaryRetryAt(response, message) : "" });
  }
  return body;
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFinite(...values) {
  for (const value of values.flat()) {
    const numeric = finiteOrNull(value);
    if (numeric != null) return numeric;
  }
  return null;
}

function usageMetric(value) {
  if (value == null) return null;
  if (typeof value === "number") return { usage: value, limit: null, usedPercent: null };
  if (typeof value !== "object") return null;
  const usage = firstFinite(value.usage, value.used, value.value, value.current, value.count);
  const limit = firstFinite(value.limit, value.quota, value.max, value.allowed);
  const reported = firstFinite(value.used_percent, value.usedPercent, value.percent, value.percentage);
  const usedPercent = reported != null ? reported : usage != null && limit != null && limit > 0 ? (usage / limit) * 100 : null;
  return { usage, limit, usedPercent };
}

function planLabel(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return String(value.name || value.display_name || value.displayName || value.label || value.id || "");
}

function normalizeUsage(usage, env) {
  return {
    cloudName: String(env.CLOUDINARY_CLOUD_NAME || ""),
    plan: planLabel(usage?.plan || usage?.plan_name || usage?.planName),
    storage: usageMetric(usage?.storage),
    bandwidth: usageMetric(usage?.bandwidth),
    credits: usageMetric(usage?.credits),
    transformations: usageMetric(usage?.transformations),
    resources: usageMetric(usage?.resources ?? usage?.objects),
    requests: usageMetric(usage?.requests),
    derivedResources: usageMetric(usage?.derived_resources ?? usage?.derivedResources),
    updatedAt: new Date().toISOString()
  };
}


function parseCloudinaryUrl(value, env) {
  try {
    const url = new URL(String(value));
    if (url.hostname !== "res.cloudinary.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== String(env.CLOUDINARY_CLOUD_NAME || "")) return null;
    const resourceType = parts[1];
    const deliveryType = parts[2];
    if (!["image", "video", "raw"].includes(resourceType) || !deliveryType) return null;
    let payload = parts.slice(3);
    if (deliveryType === "upload") {
      const versionIndex = payload.findIndex((segment) => /^v\d+$/.test(segment));
      if (versionIndex >= 0) payload = payload.slice(versionIndex + 1);
    }
    if (!payload.length) return null;
    let publicId = payload.join("/");
    if (resourceType !== "raw") publicId = publicId.replace(/\.[a-z0-9]+$/i, "");
    return { resourceType, deliveryType, publicId };
  } catch {
    return null;
  }
}

async function resolveAssetReference(reference, env) {
  const key = String(reference?.key || reference?.assetId || reference?.url || "").slice(0, 900);
  if (!key) return null;
  let asset;
  const assetId = String(reference?.assetId || "").trim();
  if (assetId && /^[A-Za-z0-9_-]{8,180}$/.test(assetId)) {
    asset = await cloudinaryGet(`/resources/${encodeURIComponent(assetId)}`, env);
  } else {
    const referenceUrl = String(reference?.url || "").trim();
    if (referenceUrl) {
      const parsed = parseCloudinaryUrl(referenceUrl, env);
      if (!parsed) return null;
      asset = await cloudinaryGet(`/resources/${parsed.resourceType}/${encodeURIComponent(parsed.deliveryType)}/${encodeURIComponent(parsed.publicId)}`, env);
    } else {
      const publicId = String(reference?.publicId || "").trim();
      const resourceType = ["image", "video", "raw"].includes(String(reference?.resourceType || "")) ? String(reference.resourceType) : "image";
      if (!publicId) return null;
      asset = await cloudinaryGet(`/resources/${resourceType}/upload/${encodeURIComponent(publicId)}`, env);
    }
  }
  return {
    key,
    bytes: Math.max(0, Number(asset?.bytes) || 0),
    assetId: String(asset?.asset_id || ""),
    publicId: String(asset?.public_id || ""),
    resourceType: String(asset?.resource_type || ""),
    deliveryType: String(asset?.type || "upload"),
    assetFolder: String(asset?.asset_folder || ""),
    secureUrl: String(asset?.secure_url || ""),
    format: String(asset?.format || ""),
    originalFilename: String(asset?.original_filename || asset?.display_name || "")
  };
}

function managedCloudinaryFolder(env) {
  return String(env.CLOUDINARY_MANAGED_FOLDER || "lan-portfolio").trim().replace(/^\/+|\/+$/g, "");
}

function assetBelongsToManagedFolder(asset, env) {
  const root = managedCloudinaryFolder(env);
  if (!root) return false;
  const folder = String(asset?.assetFolder || "").trim().replace(/^\/+|\/+$/g, "");
  const publicId = String(asset?.publicId || "").trim().replace(/^\/+/, "");
  return folder === root || folder.startsWith(`${root}/`) || publicId === root || publicId.startsWith(`${root}/`);
}


function safeDownloadFilename(value = "file") {
  const normalized = String(value || "file").trim().replace(/[\\/\r\n\0"]/g, "_");
  return normalized || "file";
}

function mediaContentType(reference = {}, asset = {}, upstream = "") {
  const declared = String(reference?.mimeType || reference?.mime || "").trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const received = String(upstream || "").split(";")[0].trim().toLowerCase();
  if (received && received !== "application/octet-stream") return received;
  const format = String(asset?.format || "").trim().toLowerCase();
  const known = {
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    json: "application/json",
    csv: "text/csv; charset=utf-8",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };
  return known[format] || "application/octet-stream";
}

async function sha1Hex(value = "") {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cloudinaryAssetDownload(asset, env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || "").trim();
  if (!cloudName || !apiKey || !apiSecret) throw serviceError("Cloudinary API secrets are not configured.", { status: 503, code: "cloudinary-config", source: "cloudinary" });
  if (!asset?.assetId) throw serviceError("Cloudinary asset ID is unavailable.", { status: 422, code: "cloudinary-asset-id", source: "cloudinary" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha1Hex(`asset_id=${asset.assetId}&timestamp=${timestamp}${apiSecret}`);
  const params = new URLSearchParams({
    asset_id: asset.assetId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature
  });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/asset/download?${params.toString()}`, {
    headers: { Accept: "*/*" }
  });
  if (!response.ok) {
    const message = (await response.text().catch(() => "")).trim() || `Cloudinary asset download failed with HTTP ${response.status}.`;
    throw serviceError(message, {
      status: response.status === 401 || response.status === 403 ? 502 : response.status,
      code: "cloudinary-download-failed",
      source: "cloudinary"
    });
  }
  return response;
}


const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_ROOT_NAME = "LΛN Portfolio CMS - Public Storage";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_PUBLIC_VERIFY_TTL_MS = 5 * 60 * 1000;
const DRIVE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DRIVE_PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;
const DRIVE_PUBLIC_BROWSER_TTL_SECONDS = 60 * 60;
const DRIVE_PUBLIC_EDGE_TTL_SECONDS = 7 * 24 * 60 * 60;

function storageKv(env) {
  if (!env?.STORAGE_OAUTH || typeof env.STORAGE_OAUTH.get !== "function") {
    throw serviceError("Storage OAuth KV is not configured.", { status: 503, code: "storage-kv-config", source: "storage" });
  }
  return env.STORAGE_OAUTH;
}

async function kvJsonGet(env, key) {
  const kv = storageKv(env);
  try {
    const direct = await kv.get(key, "json");
    if (direct != null) return direct;
  } catch {
    // Some KV-compatible test/runtime implementations expose only string reads.
  }
  const raw = await kv.get(key);
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function kvJsonPut(env, key, value, options = undefined) {
  const raw = JSON.stringify(value);
  if (options) return storageKv(env).put(key, raw, options);
  return storageKv(env).put(key, raw);
}

function driveTokenKey(profileId) { return `drive-token:${profileId}`; }
function driveProfileKey(profileId) { return `drive-profile:${profileId}`; }
function driveAssetKey(profileId, fileId) { return `drive-asset:${profileId}:${fileId}`; }
function driveFolderKey(profileId, parentId, logicalKey) { return `drive-folder:${profileId}:${parentId}:${logicalKey}`; }

function drivePublicCacheKey(profileId, fileId, download = false, variant = "original", format = "source") {
  const disposition = download ? "download" : "inline";
  const safeVariant = ["card", "detail"].includes(String(variant || "")) ? String(variant) : "original";
  const safeFormat = ["avif", "webp", "source"].includes(String(format || "")) ? String(format) : "source";
  return new Request(`https://lan-storage-cache.invalid/google-drive/${encodeURIComponent(profileId)}/${encodeURIComponent(fileId)}?disposition=${disposition}&variant=${safeVariant}&format=${safeFormat}`);
}

function drivePublicCacheStore() {
  try {
    return typeof caches !== "undefined" && caches?.default ? caches.default : null;
  } catch {
    return null;
  }
}

async function readDrivePublicCache(profileId, fileId, download = false, variant = "original", format = "source") {
  const cache = drivePublicCacheStore();
  if (!cache) return null;
  return cache.match(drivePublicCacheKey(profileId, fileId, download, variant, format));
}

async function writeDrivePublicCache(profileId, fileId, download, response, variant = "original", format = "source") {
  const cache = drivePublicCacheStore();
  if (!cache || !response || response.status !== 200) return;
  await cache.put(drivePublicCacheKey(profileId, fileId, download, variant, format), response);
}

async function purgeDrivePublicCache(profileId, fileId) {
  const cache = drivePublicCacheStore();
  if (!cache) return;
  const keys = [];
  for (const download of [false, true]) {
    for (const variant of ["original", "card", "detail"]) {
      for (const format of ["source", "webp", "avif"]) {
        keys.push(cache.delete(drivePublicCacheKey(profileId, fileId, download, variant, format)));
      }
    }
  }
  await Promise.all(keys);
}

function driveConfig(env) {
  const clientId = String(env.GOOGLE_DRIVE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw serviceError("Google Drive OAuth secrets are not configured.", { status: 503, code: "google-drive-config", source: "google-drive" });
  }
  return { clientId, clientSecret };
}

function randomToken(prefix = "") {
  // Never fall back to Math.random for OAuth state or upload capabilities.
  return String(prefix || "") + base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function driveRedirectUri(request, env) {
  const configured = String(env.GOOGLE_DRIVE_REDIRECT_URI || "").trim();
  if (configured) return configured;
  return `${new URL(request.url).origin}/storage/google-drive/connect/callback`;
}

function driveManagementUrl(folderId) {
  return folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` : "https://drive.google.com/drive/my-drive";
}

async function driveTokenExchange(params, env) {
  const { clientId, clientSecret } = driveConfig(env);
  const body = new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const oauthCode = String(payload?.error || "").trim().toLowerCase();
    const message = String(payload?.error_description || payload?.error || `Google OAuth failed with HTTP ${response.status}.`);
    const refreshFlow = String(params?.grant_type || "") === "refresh_token";
    const reconnectRequired = refreshFlow && ["invalid_grant", "invalid_client", "unauthorized_client"].includes(oauthCode);
    if (reconnectRequired) {
      throw serviceError("Google Drive authorization is no longer valid for this storage profile. Reconnect the existing profile to continue uploads and account operations.", {
        status: 409,
        code: "google-drive-reconnect-required",
        source: "google-drive"
      });
    }
    const temporarilyUnavailable = response.status === 429 || response.status >= 500;
    throw serviceError(message, {
      status: temporarilyUnavailable ? 503 : 502,
      code: temporarilyUnavailable ? "google-drive-oauth-unavailable" : "google-drive-oauth-failed",
      source: "google-drive"
    });
  }
  return payload;
}

async function driveAccessToken(profileId, env) {
  const record = await kvJsonGet(env, driveTokenKey(profileId));
  if (!record) throw serviceError("Google Drive is not connected.", { status: 409, code: "google-drive-not-connected", source: "google-drive" });
  const expiresAt = Number(record.accessTokenExpiresAt ?? record.expiresAt ?? 0);
  if (record.accessToken && expiresAt > Date.now() + 30_000) return String(record.accessToken);
  if (!record.refreshToken) throw serviceError("Google Drive refresh authorization is unavailable.", { status: 409, code: "google-drive-refresh-missing", source: "google-drive" });
  const payload = await driveTokenExchange({ grant_type: "refresh_token", refresh_token: String(record.refreshToken) }, env);
  const next = {
    ...record,
    accessToken: String(payload.access_token || ""),
    accessTokenExpiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    updatedAt: new Date().toISOString()
  };
  await kvJsonPut(env, driveTokenKey(profileId), next);
  return next.accessToken;
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveApi(profileId, env, url, init = {}) {
  const token = await driveAccessToken(profileId, env);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers });
  return response;
}

async function driveAccountSummary(profileId, env) {
  const response = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/about?fields=${encodeURIComponent("user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)")}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw serviceError(`Google Drive account lookup failed with HTTP ${response.status}.`, { status: 502, code: "google-drive-account-lookup", source: "google-drive" });
  return {
    account: payload?.user ? { displayName: String(payload.user.displayName || ""), emailAddress: String(payload.user.emailAddress || "") } : null,
    storageQuota: payload?.storageQuota || null
  };
}

async function driveEnsureRoot(profileId, env) {
  const existingProfile = await kvJsonGet(env, driveProfileKey(profileId));
  if (existingProfile?.rootFolderId) return existingProfile;
  const q = [
    `name = '${escapeDriveQuery(DRIVE_ROOT_NAME)}'`,
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    "trashed = false",
    "appProperties has { key='lanStorageRoot' and value='1' }",
    `appProperties has { key='lanStorageProfile' and value='${escapeDriveQuery(profileId)}' }`
  ].join(" and ");
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=${encodeURIComponent("files(id,name,webViewLink)")}&pageSize=10`;
  const listResponse = await driveApi(profileId, env, listUrl);
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) throw serviceError(`Google Drive root lookup failed with HTTP ${listResponse.status}.`, { status: 502, code: "google-drive-root-lookup", source: "google-drive" });
  let folder = Array.isArray(listPayload.files) ? listPayload.files[0] : null;
  if (!folder?.id) {
    const createResponse = await driveApi(profileId, env, "https://www.googleapis.com/drive/v3/files?fields=id%2Cname%2CwebViewLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: DRIVE_ROOT_NAME,
        mimeType: DRIVE_FOLDER_MIME,
        appProperties: { lanStorageRoot: "1", lanStorageProfile: profileId }
      })
    });
    folder = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || !folder?.id) throw serviceError(`Google Drive root creation failed with HTTP ${createResponse.status}.`, { status: 502, code: "google-drive-root-create", source: "google-drive" });
  }
  const profile = {
    profileId,
    provider: "google-drive",
    rootFolderId: String(folder.id),
    rootFolderName: String(folder.name || DRIVE_ROOT_NAME),
    managementUrl: String(folder.webViewLink || driveManagementUrl(folder.id)),
    publicReady: false,
    publicVerifiedAt: 0,
    connectedAt: existingProfile?.connectedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await kvJsonPut(env, driveProfileKey(profileId), profile);
  return profile;
}

async function driveCheckPublicAccess(profileId, env, { force = false } = {}) {
  // Reconcile the canonical managed root before verification. Local KV can be
  // recreated independently of the Drive folder; driveEnsureRoot recovers the
  // existing profile-owned folder by appProperties instead of treating a
  // missing cached profile record as a missing Drive root.
  const profile = await driveEnsureRoot(profileId, env);
  const verifiedAt = Number(profile.publicVerifiedAt || 0);
  // The Worker is the canonical owner of Google Drive delivery readiness.
  // A cached positive verification may be reused briefly; missing, negative, or
  // stale state is reconciled against Drive instead of becoming a client gate.
  if (!force && profile.publicReady === true && verifiedAt > 0 && Date.now() - verifiedAt < DRIVE_PUBLIC_VERIFY_TTL_MS) return profile;
  const permissionsUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(profile.rootFolderId)}/permissions?fields=${encodeURIComponent("permissions(id,type,role,allowFileDiscovery)")}`;
  const response = await driveApi(profileId, env, permissionsUrl);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw serviceError(`Google Drive permission verification failed with HTTP ${response.status}.`, { status: 502, code: "google-drive-permission-check", source: "google-drive" });
  const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  const publicReady = permissions.some((permission) => permission?.type === "anyone" && ["reader", "commenter"].includes(String(permission?.role || "")));
  const next = { ...profile, publicReady, publicVerifiedAt: Date.now(), updatedAt: new Date().toISOString() };
  await kvJsonPut(env, driveProfileKey(profileId), next);
  return next;
}

function driveLogicalSegments(context = {}) {
  // Physical Drive organization mirrors CMS content, not implementation internals.
  // Stable IDs remain in logical keys/appProperties; display names are human-readable.
  const key = (value, fallback) => String(value || fallback).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
  const label = (value, fallback) => String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 120) || fallback;
  const pageKey = context.moduleId ? `module:${key(context.moduleId, "module")}` : `page:${key(context.ownerType, "content")}`;
  const recordKey = `${pageKey}/record:${key(context.ownerId, "record")}`;
  return [
    { logicalKey: pageKey, displayName: label(context.pageName || context.moduleName || context.ownerType, "Content") },
    { logicalKey: recordKey, displayName: label(context.recordTitle || context.ownerTitle || context.ownerId, "Record") }
  ];
}

async function driveEnsureChildFolder(profileId, parentId, logicalKey, displayName, env) {
  const cacheKey = driveFolderKey(profileId, parentId, logicalKey);
  const cached = await kvJsonGet(env, cacheKey);
  let folder = null;
  if (cached?.folderId) {
    const verifyResponse = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cached.folderId)}?fields=${encodeURIComponent("id,name,parents,trashed,appProperties")}`);
    const verified = await verifyResponse.json().catch(() => ({}));
    if (verifyResponse.ok && verified?.id && !verified.trashed && Array.isArray(verified.parents) && verified.parents.includes(parentId)) folder = verified;
    else await storageKv(env).delete(cacheKey);
  }
  if (!folder?.id) {
    const q = [
      `'${escapeDriveQuery(parentId)}' in parents`,
      `mimeType = '${DRIVE_FOLDER_MIME}'`,
      "trashed = false",
      `appProperties has { key='lanLogicalKey' and value='${escapeDriveQuery(logicalKey)}' }`
    ].join(" and ");
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=${encodeURIComponent("files(id,name,parents,appProperties)")}&pageSize=10`;
    const listResponse = await driveApi(profileId, env, listUrl);
    const listPayload = await listResponse.json().catch(() => ({}));
    if (!listResponse.ok) throw serviceError(`Google Drive folder lookup failed with HTTP ${listResponse.status}.`, { status: 502, code: "google-drive-folder-lookup", source: "google-drive" });
    folder = Array.isArray(listPayload.files) ? listPayload.files[0] : null;
  }
  if (!folder?.id) {
    const createResponse = await driveApi(profileId, env, "https://www.googleapis.com/drive/v3/files?fields=id%2Cname%2Cparents%2CappProperties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: displayName,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [parentId],
        appProperties: { lanLogicalKey: logicalKey, lanStorageProfile: profileId }
      })
    });
    folder = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || !folder?.id) throw serviceError(`Google Drive folder creation failed with HTTP ${createResponse.status}.`, { status: 502, code: "google-drive-folder-create", source: "google-drive" });
  } else if (String(folder.name || "") !== displayName) {
    const renameResponse = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder.id)}?fields=id%2Cname`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName })
    });
    if (renameResponse.ok) folder = { ...folder, ...(await renameResponse.json().catch(() => ({}))) };
  }
  await kvJsonPut(env, cacheKey, { folderId: String(folder.id), logicalKey, parentId, name: String(folder.name || displayName) });
  return String(folder.id);
}

async function driveEnsureContextFolder(profileId, context, env) {
  const profile = await driveEnsureRoot(profileId, env);
  let parentId = profile.rootFolderId;
  const segments = driveLogicalSegments(context);
  for (const segment of segments) {
    parentId = await driveEnsureChildFolder(profileId, parentId, segment.logicalKey, segment.displayName, env);
  }
  return parentId;
}

async function handleDriveConnectStart(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const { uid } = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, uid, "drive-write");
    const body = await readStrictJsonBody(request, { profileId: REQUEST_SCHEMA_ANY });
    const profileId = String(body.profileId || "").trim().slice(0, 120);
    if (!profileId) throw serviceError("A storage profile ID is required.", { status: 422, code: "google-drive-profile", source: "google-drive" });
    const { clientId } = driveConfig(env);
    const state = randomToken("drv-");
    const redirectUri = driveRedirectUri(request, env);
    const stateRecord = { profileId, uid, origin, redirectUri, expiresAt: Date.now() + DRIVE_OAUTH_STATE_TTL_MS };
    await coordinateSecurity(env,securityChallengeOwner("drive-oauth-state",state),{
      op:"challenge-put",scope:"drive-oauth-state",id:state,
      record:{...stateRecord,scope:"drive-oauth-state"}
    });
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", DRIVE_FILE_SCOPE);
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("include_granted_scopes", "true");
    auth.searchParams.set("state", state);
    return json({ authorizationUrl: auth.toString(), state, profileId }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Google Drive connection could not start.", code: String(error?.code || "internal"), source: String(error?.source || "google-drive") }, Number(error?.status) || 500, origin);
  }
}

function htmlEscapeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

async function handleDriveConnectCallback(request, env) {
  const url = new URL(request.url);
  const state = String(url.searchParams.get("state") || "");
  const code = String(url.searchParams.get("code") || "");
  let stateRecord;
  try{
    if(!/^[A-Za-z0-9_-]{20,90}$/.test(state))
      return new Response("Invalid or expired Google Drive authorization state.",{
        status:400,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
      });
    // The state itself is the opaque one-use capability. Consumption is
    // strongly consistent across Worker instances and Cloudflare regions.
    stateRecord=await consumeSecurityChallenge(env,"drive-oauth-state",state);
  }catch(error){
    const invalid=["security-challenge-invalid","security-challenge-expired"].includes(error?.code);
    return new Response(invalid
      ?"Invalid or expired Google Drive authorization state."
      :"Google Drive authorization state service is unavailable.",{
      status:invalid?400:Number(error?.status)||503,
      headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
    });
  }
  if (!stateRecord || Number(stateRecord.expiresAt || 0) <= Date.now())
    return new Response("Invalid or expired Google Drive authorization state.", {
      status:400,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
    });
  if (!code) return new Response("Google Drive authorization code is missing.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  try {
    await enforceAdminServiceRateLimit(request, env, stateRecord.uid, "drive-write");
    const payload = await driveTokenExchange({ grant_type: "authorization_code", code, redirect_uri: String(stateRecord.redirectUri || driveRedirectUri(request, env)) }, env);
    const existing = await kvJsonGet(env, driveTokenKey(stateRecord.profileId));
    const refreshToken = String(payload.refresh_token || existing?.refreshToken || "");
    if (!refreshToken) throw serviceError("Google did not return a reusable Drive authorization. Reconnect and grant access again.", { status: 502, code: "google-drive-refresh-missing", source: "google-drive" });
    await kvJsonPut(env, driveTokenKey(stateRecord.profileId), {
      refreshToken,
      accessToken: String(payload.access_token || ""),
      accessTokenExpiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
      uid: stateRecord.uid,
      updatedAt: new Date().toISOString()
    });
    let profile = await driveEnsureRoot(stateRecord.profileId, env);
    try { profile = await driveCheckPublicAccess(stateRecord.profileId, env, { force: true }); } catch (_) { /* Connection remains valid; readiness is reconciled by the Worker on test/upload. */ }
    let identity = { account: null, storageQuota: null };
    try { identity = await driveAccountSummary(stateRecord.profileId, env); } catch (_) {}
    const enrichedProfile = { ...profile, account: identity.account, storageQuota: identity.storageQuota, updatedAt: new Date().toISOString() };
    await kvJsonPut(env, driveProfileKey(stateRecord.profileId), enrichedProfile);
    const result = { type: "lan-storage-google-drive-connected", profileId: stateRecord.profileId, rootFolderId: enrichedProfile.rootFolderId, rootFolderName: enrichedProfile.rootFolderName, managementUrl: enrichedProfile.managementUrl, publicReady: enrichedProfile.publicReady === true, publicVerifiedAt: enrichedProfile.publicVerifiedAt || 0, account: enrichedProfile.account };
    const html = `<!doctype html><meta charset="utf-8"><title>Google Drive connected</title><script>try{window.opener&&window.opener.postMessage(${htmlEscapeJson(result)},${htmlEscapeJson(stateRecord.origin)});}finally{window.close();}</script><p>Google Drive connected. You can close this window.</p>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(`Google Drive connection failed: ${String(error?.message || "Unknown error")}`, { status: Number(error?.status) || 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

async function handleDriveTest(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "drive-read");
    const body = await readStrictJsonBody(request, { profileId: REQUEST_SCHEMA_ANY });
    const profileId = String(body.profileId || "").trim();
    const profile = await driveCheckPublicAccess(profileId, env, { force: true });
    let account = null;
    let storageQuota = null;
    try {
      const aboutResponse = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/about?fields=${encodeURIComponent("user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)")}`);
      if (aboutResponse.ok) {
        const about = await aboutResponse.json().catch(() => ({}));
        account = about.user || null;
        storageQuota = about.storageQuota || null;
      }
    } catch { /* Usage metadata is optional. */ }
    return json({ profileId, publicReady: Boolean(profile.publicReady), rootFolderId: profile.rootFolderId, rootFolderName: profile.rootFolderName, managementUrl: profile.managementUrl || driveManagementUrl(profile.rootFolderId), publicVerifiedAt: profile.publicVerifiedAt, account, storageQuota }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Google Drive test failed.", code: String(error?.code || "internal"), source: String(error?.source || "google-drive") }, Number(error?.status) || 500, origin);
  }
}

async function handleDriveUploadSession(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "drive-write");
    const body = await readStrictJsonBody(request, { profileId: REQUEST_SCHEMA_ANY, access: REQUEST_SCHEMA_ANY, name: REQUEST_SCHEMA_ANY, mimeType: REQUEST_SCHEMA_ANY, bytes: REQUEST_SCHEMA_ANY, context: DRIVE_CONTEXT_SCHEMA });
    const profileId = String(body.profileId || "").trim();
    const access = String(body.access || "public-preview");
    if (access !== "public-preview") throw serviceError("This Google Drive storage profile accepts public portfolio assets only.", { status: 422, code: "google-drive-access-mode", source: "google-drive" });
    const profile = await driveCheckPublicAccess(profileId, env);
    if (!profile.publicReady) throw serviceError("Google Drive public access is not ready. Open the managed folder, set Anyone with the link to Viewer, then run Test Public Access.", { status: 409, code: "google-drive-public-not-ready", source: "google-drive" });
    const name = String(body.name || "file").trim().slice(0, 240) || "file";
    const mimeType = String(body.mimeType || "application/octet-stream").trim() || "application/octet-stream";
    const bytes = Math.max(0, Number(body.bytes) || 0);
    const folderId = await driveEnsureContextFolder(profileId, body.context || {}, env);
    const token = await driveAccessToken(profileId, env);
    const metadata = { name, parents: [folderId], appProperties: { lanStorageProfile: profileId, lanAccess: access } };
    const headers = new Headers({ Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8", "X-Upload-Content-Type": mimeType });
    if (bytes > 0) headers.set("X-Upload-Content-Length", String(bytes));
    const create = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id%2Cname%2CmimeType%2Csize%2CwebViewLink%2Cparents%2CappProperties", { method: "POST", headers, body: JSON.stringify(metadata) });
    const sessionUrl = create.headers.get("Location") || create.headers.get("location") || "";
    if (!create.ok || !sessionUrl) throw serviceError(`Google Drive resumable upload session failed with HTTP ${create.status}.`, { status: 502, code: "google-drive-upload-session", source: "google-drive" });
    const pendingToken = randomToken("up-");
    await coordinateSecurity(env,securityChallengeOwner("drive-upload",pendingToken),{
      op:"challenge-put",scope:"drive-upload",id:pendingToken,
      record:{
        scope:"drive-upload",profileId,pendingToken,folderId,name,mimeType,
        bytes,access,sessionUrl,context:body.context||{},
        expiresAt:Date.now()+DRIVE_PENDING_UPLOAD_TTL_MS
      }
    });
    return json({ profileId, sessionUrl, pendingToken }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Google Drive upload could not start.", code: String(error?.code || "internal"), source: String(error?.source || "google-drive") }, Number(error?.status) || 500, origin);
  }
}

async function drivePendingOperation(env, profileId, pendingToken, op, extra = {}) {
  const token = String(pendingToken || "").trim();
  if(!/^[A-Za-z0-9_-]{20,90}$/.test(token) || !String(profileId||"").trim()) {
    throw serviceError("Google Drive upload confirmation expired or is invalid.",{
      status:409,code:"google-drive-upload-pending",source:"google-drive"
    });
  }
  return coordinateSecurity(env,securityChallengeOwner("drive-upload",token),{
    op,scope:"drive-upload",id:token,profileId,...extra
  });
}

async function driveFinalizePending(profileId, pendingToken, fileId, env, uploadFile = null) {
  // One canonical lease serializes content upload and metadata-only finalize.
  // Failed upstream operations release it for retry; Worker crashes leave a
  // bounded lease that can be reclaimed after expiry.
  const claimId=randomCapability(24);
  const claim=await drivePendingOperation(env,profileId,pendingToken,"upload-claim",{claimId});
  const pending=claim.record;
  try {
    let verifiedFileId=String(fileId||"").trim();
    if(uploadFile){
      verifiedFileId=String(await uploadFile(pending)||"").trim();
    }
    if(!verifiedFileId) throw serviceError("Google Drive file ID is missing.",{
      status:422,code:"google-drive-file-id",source:"google-drive"
    });
    const response=await driveApi(profileId,env,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(verifiedFileId)}?fields=${encodeURIComponent("id,name,mimeType,size,webViewLink,parents,trashed,appProperties")}`);
    const file=await response.json().catch(()=>({}));
    if(!response.ok || !file?.id) throw serviceError(
      `Google Drive upload verification failed with HTTP ${response.status}.`,{
        status:502,code:"google-drive-upload-verify",source:"google-drive"
      });
    if(file.trashed || !Array.isArray(file.parents) ||
       !file.parents.includes(pending.folderId)){
      throw serviceError("Google Drive upload does not belong to the expected CMS folder.",{
        status:409,code:"google-drive-upload-ownership",source:"google-drive"
      });
    }
    const asset={
      provider:"google-drive",
      storageProfileId:profileId,
      assetId:String(file.id),
      fileId:String(file.id),
      name:String(file.name||pending.name||""),
      mimeType:String(file.mimeType||pending.mimeType||"application/octet-stream"),
      bytes:Math.max(0,Number(file.size??pending.bytes)||0),
      access:pending.access,
      context:pending.context||{},
      folderId:String(pending.folderId||""),
      webViewLink:String(file.webViewLink||""),
      createdAt:new Date().toISOString()
    };
    await kvJsonPut(env,driveAssetKey(profileId,verifiedFileId),asset);
    await drivePendingOperation(env,profileId,pendingToken,"upload-consume",{claimId});
    return asset;
  }catch(error){
    await drivePendingOperation(env,profileId,pendingToken,"upload-release",{claimId})
      .catch(()=>null);
    throw error;
  }
}

async function handleDriveUploadContent(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "drive-write");
    const form = readStrictFormDataFields(await request.formData(), ["profileId", "pendingToken", "file"]);
    const profileId = String(form.get("profileId") || "").trim();
    const pendingToken = String(form.get("pendingToken") || "").trim();
    const file = form.get("file");
    if(!file || typeof file.arrayBuffer!=="function") throw serviceError(
      "Google Drive upload file is missing.",{
        status:422,code:"google-drive-upload-file",source:"google-drive"
      });
    const asset=await driveFinalizePending(profileId,pendingToken,"",env,async pending=>{
      if(pending.bytes>0 && Number(file.size||0)!==Number(pending.bytes)){
        throw serviceError("Google Drive upload size does not match the prepared upload.",{
          status:409,code:"google-drive-upload-size",source:"google-drive"
        });
      }
      const session=String(pending.sessionUrl||"").trim();
      if(!session) throw serviceError("Google Drive upload session is missing.",{
        status:409,code:"google-drive-upload-session-missing",source:"google-drive"
      });
      const upload=await fetch(session,{
        method:"PUT",
        headers:{"Content-Type":pending.mimeType||file.type||"application/octet-stream"},
        body:file
      });
      const uploaded=await upload.json().catch(()=>({}));
      if(!upload.ok || !uploaded?.id) throw serviceError(
        `Google Drive upload failed with HTTP ${upload.status}.`,{
          status:502,code:"google-drive-upload-content",source:"google-drive"
        });
      return String(uploaded.id);
    });
    return json(asset,200,origin);
  } catch (error) {
    return json({ error: error?.message || "Google Drive upload failed.",
      code: String(error?.code || "internal"), source: String(error?.source || "google-drive") },
      Number(error?.status) || 500, origin);
  }
}

async function handleDriveFinalize(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "drive-read");
    const body = await readStrictJsonBody(request, { profileId: REQUEST_SCHEMA_ANY, pendingToken: REQUEST_SCHEMA_ANY, fileId: REQUEST_SCHEMA_ANY, assetId: REQUEST_SCHEMA_ANY });
    const profileId = String(body.profileId || "").trim();
    const pendingToken = String(body.pendingToken || "").trim();
    const fileId = String(body.fileId || body.assetId || "").trim();
    const asset = await driveFinalizePending(profileId, pendingToken, fileId, env);
    return json(asset, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Google Drive upload could not be finalized.", code: String(error?.code || "internal"), source: String(error?.source || "google-drive") }, Number(error?.status) || 500, origin);
  }
}

async function handleDriveDisconnect(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "drive-write");
    const body = await readStrictJsonBody(request, { profileId: REQUEST_SCHEMA_ANY });
    const profileId = String(body.profileId || "").trim();
    if (!profileId) throw serviceError("A Google Drive profile ID is required.", { status: 422, code: "google-drive-profile", source: "google-drive" });
    await storageKv(env).delete(driveTokenKey(profileId));
    await storageKv(env).delete(driveProfileKey(profileId));
    return json({ disconnected: true, profileId, remoteFilesPreserved: true }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Google Drive could not be disconnected.", code: String(error?.code || "internal"), source: String(error?.source || "google-drive") }, Number(error?.status) || 500, origin);
  }
}

function drivePreviewFormat(request) {
  const accept = String(request?.headers?.get?.("Accept") || "").toLowerCase();
  if (accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  return "source";
}

function driveImageTransform(variant = "card", format = "source") {
  const image = {
    fit: "scale-down",
    width: variant === "detail" ? 2400 : 1200,
    quality: "high",
    "origin-auth": "share-publicly"
  };
  if (format === "avif" || format === "webp") image.format = format;
  return image;
}

function isDriveImage(managed = {}) {
  return /^image\//i.test(String(managed?.mimeType || "").trim());
}

async function handleDrivePublic(request, env, profileId, fileId, context = null) {
  try {
    const requestUrl = new URL(request.url);
    const download = requestUrl.searchParams.get("download") === "1";
    const range = String(request.headers.get("Range") || "").trim();

    const managed = await resolveDriveManagedReference({ storageProfileId: profileId, assetId: fileId }, env);
    if (!managed || managed.access !== "public-preview") return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });

    const requestedVariant = String(requestUrl.searchParams.get("variant") || "").trim().toLowerCase();
    const imageVariant = !download && !range && isDriveImage(managed) && ["card", "detail"].includes(requestedVariant)
      ? requestedVariant
      : "original";
    const format = imageVariant === "original" ? "source" : drivePreviewFormat(request);

    if (!range) {
      const cached = await readDrivePublicCache(profileId, fileId, download, imageVariant, format);
      if (cached) return cached;
    }

    await enforcePublicServiceRateLimit(request, env, "drive-read");

    const localWorkerRuntime = ["localhost", "127.0.0.1", "::1"].includes(String(requestUrl.hostname || "").toLowerCase());
    const transformRequested = imageVariant !== "original" && !localWorkerRuntime;
    let read = transformRequested
      ? await driveManagedRead(
          { storageProfileId: profileId, assetId: fileId },
          env,
          { range, managedReference: managed, imageTransform: driveImageTransform(imageVariant, format) }
        )
      : await driveManagedRead(
          { storageProfileId: profileId, assetId: fileId },
          env,
          { range, managedReference: managed }
        );

    // Transformation is an optimization only. A provider response must still be
    // a real image; otherwise retry the exact managed asset. This keeps delivery
    // fallback separate from Cover/Gallery semantics and makes local Wrangler
    // testing deterministic even though edge image transforms are unavailable.
    if (transformRequested) {
      const transformedType = String(read.response.headers.get("Content-Type") || "").toLowerCase();
      const resizeHeader = String(read.response.headers.get("Cf-Resized") || "");
      const invalidTransform = !read.response.ok || !transformedType.startsWith("image/") || /\berr=/i.test(resizeHeader);
      if (invalidTransform) {
        read = await driveManagedRead(
          { storageProfileId: profileId, assetId: fileId },
          env,
          { managedReference: managed }
        );
      }
    }

    const upstream = read.response;
    const resizeState = String(upstream.headers.get("Cf-Resized") || "").trim();
    const optimizedPreview = imageVariant !== "original" && Boolean(resizeState) && !/\berr=/i.test(resizeState);
    const headers = new Headers();
    const transformedContentType = upstream.headers.get("Content-Type") || "";
    headers.set(
      "Content-Type",
      imageVariant !== "original"
        ? (transformedContentType || managed.mimeType || "image/jpeg")
        : (managed.mimeType || transformedContentType || "application/octet-stream")
    );
    headers.set(
      "Cache-Control",
      range
        ? "public, max-age=60"
        : imageVariant !== "original" && !optimizedPreview
          ? "public, max-age=60, s-maxage=60"
          : `public, max-age=${DRIVE_PUBLIC_BROWSER_TTL_SECONDS}, s-maxage=${DRIVE_PUBLIC_EDGE_TTL_SECONDS}`
    );
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Accept-Ranges", upstream.headers.get("Accept-Ranges") || "bytes");
    headers.set("Vary", imageVariant === "original" ? "Range" : "Accept");
    headers.set("X-LAN-Media-Variant", imageVariant);
    if (imageVariant !== "original") headers.set("X-LAN-Media-Optimized", optimizedPreview ? "true" : "false");
    const safeName = String(managed.name || "asset").replace(/[\r\n"\\]/g, "_");
    headers.set("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${safeName}"`);
    for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified", "Cf-Resized"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    const response = new Response(upstream.body, { status: upstream.status, headers });
    if (!range && response.status === 200 && (imageVariant === "original" || optimizedPreview)) {
      const write = writeDrivePublicCache(profileId, fileId, download, response.clone(), imageVariant, format);
      if (context?.waitUntil) context.waitUntil(write);
      else await write;
    }
    return response;
  } catch (error) {
    const status = Number(error?.status) === 404 ? 404 : 502;
    return new Response(status === 404 ? "Not found." : "Storage delivery failed.", { status, headers: { "Cache-Control": "no-store" } });
  }
}


async function resolveDriveManagedReference(reference, env) {
  const profileId = String(reference?.storageProfileId || reference?.profileId || "").trim();
  const fileId = String(reference?.assetId || reference?.fileId || "").trim();
  if (!profileId || !fileId) return null;
  let mapping = await kvJsonGet(env, driveAssetKey(profileId, fileId));
  if (!mapping) {
    // The Drive file itself carries the canonical ownership/access markers. KV is
    // an index/cache, not the source of truth: recover that index after a local
    // runtime reset instead of making otherwise valid managed assets unreadable.
    const response = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent("id,name,mimeType,size,webViewLink,trashed,appProperties")}`);
    const file = await response.json().catch(() => ({}));
    if (!response.ok || !file?.id || file.trashed) return null;
    const properties = file.appProperties && typeof file.appProperties === "object" ? file.appProperties : {};
    if (String(properties.lanStorageProfile || "").trim() !== profileId) return null;
    const access = String(properties.lanAccess || "").trim();
    if (!access) return null;
    mapping = {
      provider: "google-drive",
      storageProfileId: profileId,
      assetId: String(file.id),
      fileId: String(file.id),
      name: String(file.name || ""),
      mimeType: String(file.mimeType || "application/octet-stream"),
      bytes: Math.max(0, Number(file.size) || 0),
      access,
      webViewLink: String(file.webViewLink || ""),
      recoveredAt: new Date().toISOString()
    };
    await kvJsonPut(env, driveAssetKey(profileId, fileId), mapping);
  }
  const mappedProfileId = String(mapping.storageProfileId || "").trim();
  const mappedAssetId = String(mapping.assetId || "").trim();
  if (mappedProfileId !== profileId || mappedAssetId !== fileId) return null;
  return { ...mapping, profileId: mappedProfileId, fileId: mappedAssetId };
}

function drivePublicContentUrl(fileId) {
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", String(fileId || ""));
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", "t");
  return url.toString();
}

function drivePublicResponseUsable(response, managed = {}) {
  if (!response?.ok) return false;
  const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
  if (contentType.includes("text/html")) return false;
  if (isDriveImage(managed)) return contentType.startsWith("image/");
  return true;
}

async function drivePublicManagedRead(managed, { range = "", imageTransform = null } = {}) {
  const headers = new Headers();
  const normalizedRange = String(range || "").trim();
  if (/^bytes=\d*-\d*(?:,\d*-\d*)*$/i.test(normalizedRange)) headers.set("Range", normalizedRange);
  const init = { headers, redirect: "follow" };
  if (imageTransform && !normalizedRange && isDriveImage(managed)) init.cf = { image: imageTransform };
  return fetch(drivePublicContentUrl(managed.fileId), init);
}

async function driveManagedRead(reference, env, { range = "", managedReference = null, imageTransform = null } = {}) {
  const managed = managedReference || await resolveDriveManagedReference(reference, env);
  if (!managed) throw serviceError("The Google Drive asset could not be resolved.", { status: 404, code: "media-read-unresolved", source: "google-drive" });

  // Public Portfolio delivery must not depend on an Admin OAuth refresh token.
  // Once an asset has been validated into the canonical managed index and marked
  // public-preview, its Drive folder permission is the delivery authority. OAuth
  // remains the owner of uploads, metadata recovery and management operations.
  let publicDeliveryFailure = null;
  if (managed.access === "public-preview") {
    try {
      const publicResponse = await drivePublicManagedRead(managed, { range, imageTransform });
      if (drivePublicResponseUsable(publicResponse, managed)) return { response: publicResponse, managed, delivery: "public-share" };
      publicDeliveryFailure = serviceError(`Google Drive public-share delivery returned HTTP ${publicResponse.status}.`, {
        status: publicResponse.status === 404 ? 404 : 502,
        code: "google-drive-public-delivery-failed",
        source: "google-drive"
      });
    } catch (error) {
      publicDeliveryFailure = error instanceof Error
        ? error
        : serviceError("Google Drive public-share delivery failed.", { status: 502, code: "google-drive-public-delivery-failed", source: "google-drive" });
    }
  }

  const token = await driveAccessToken(managed.profileId, env);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (/^bytes=\d*-\d*(?:,\d*-\d*)*$/i.test(String(range || "").trim())) headers.set("Range", String(range).trim());
  const init = { headers };
  if (imageTransform && !range && isDriveImage(managed)) init.cf = { image: imageTransform };
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(managed.fileId)}?alt=media`, init);
  if (!response.ok && !imageTransform) {
    const error = serviceError(`Google Drive asset download failed with HTTP ${response.status}.`, { status: response.status === 404 ? 404 : 502, code: "google-drive-download-failed", source: "google-drive" });
    if (publicDeliveryFailure) error.publicDeliveryFailure = String(publicDeliveryFailure?.message || publicDeliveryFailure);
    throw error;
  }
  return { response, managed, delivery: "oauth" };
}

async function driveCleanupEmptyGeneratedFolders(profileId, startFolderId, env) {
  let folderId = String(startFolderId || "").trim();
  while (folderId) {
    const folderResponse = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=${encodeURIComponent("id,name,parents,trashed,appProperties")}`);
    const folder = await folderResponse.json().catch(() => ({}));
    if (!folderResponse.ok || !folder?.id || folder.trashed) return;
    const properties = folder.appProperties && typeof folder.appProperties === "object" ? folder.appProperties : {};
    const logicalKey = String(properties.lanLogicalKey || "").trim();
    // The workspace root is protected. Page and record folders are disposable managed
    // organization and are pruned when empty; future saves recreate only what they need.
    if (String(properties.lanStorageProfile || "").trim() !== profileId || !logicalKey) return;
    const childrenQuery = `'${escapeDriveQuery(folderId)}' in parents and trashed = false`;
    const childrenResponse = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(childrenQuery)}&spaces=drive&fields=${encodeURIComponent("files(id)")}&pageSize=1`);
    const children = await childrenResponse.json().catch(() => ({}));
    if (!childrenResponse.ok || (Array.isArray(children.files) && children.files.length)) return;
    const parentId = Array.isArray(folder.parents) ? String(folder.parents[0] || "") : "";
    const deletion = await driveApi(profileId, env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`, { method: "DELETE" });
    if (!deletion.ok && deletion.status !== 404) return;
    if (parentId && logicalKey) await storageKv(env).delete(driveFolderKey(profileId, parentId, logicalKey));
    folderId = parentId;
  }
}

async function deleteDriveManagedReference(reference, env) {
  const managed = await resolveDriveManagedReference(reference, env);
  if (!managed) return { deleted: false, reason: "unresolved" };
  const parentFolderId = String(managed.folderId || "").trim();
  const token = await driveAccessToken(managed.profileId, env);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(managed.fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok && response.status !== 404) {
    throw serviceError(`Google Drive deletion failed with HTTP ${response.status}.`, { status: 502, code: "google-drive-delete-failed", source: "google-drive" });
  }
  await storageKv(env).delete(driveAssetKey(managed.profileId, managed.fileId));
  await purgeDrivePublicCache(managed.profileId, managed.fileId);
  if (parentFolderId) await driveCleanupEmptyGeneratedFolders(managed.profileId, parentFolderId, env);
  return {
    deleted: true,
    asset: {
      provider: "google-drive",
      storageProfileId: managed.profileId,
      assetId: managed.fileId,
      name: managed.name || "",
      mimeType: managed.mimeType || "",
      bytes: Math.max(0, Number(managed.bytes) || 0)
    }
  };
}

function mediaReferenceProvider(reference = {}) {
  const explicit = String(reference?.provider || "").trim().toLowerCase();
  if (explicit) return explicit;
  const url = String(reference?.url || reference?.secureUrl || reference?.secure_url || "").trim();
  if (url.includes("res.cloudinary.com") || reference?.publicId || reference?.public_id) return "cloudinary";
  return "";
}

async function handleMediaRead(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "cloudinary-read");
    const body = await readStrictJsonBody(request, { asset: ASSET_REFERENCE_SCHEMA });
    const reference = body?.asset && typeof body.asset === "object" ? body.asset : {};
    if (mediaReferenceProvider(reference) === "google-drive") {
      const { response: upstream, managed } = await driveManagedRead(reference, env);
      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Type", String(reference?.mimeType || managed?.mimeType || upstream.headers.get("Content-Type") || "application/octet-stream"));
      const filename = safeDownloadFilename(reference?.name || managed?.name || "file");
      headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return new Response(upstream.body, { status: 200, headers });
    }
    const asset = await resolveAssetReference(reference, env);
    if (!asset) throw serviceError("The media asset could not be resolved.", { status: 404, code: "media-read-unresolved", source: "cloudinary" });
    if (!assetBelongsToManagedFolder(asset, env)) throw serviceError("The media asset is outside the managed portfolio folder.", { status: 403, code: "media-read-forbidden", source: "cloudinary" });
    const upstream = await cloudinaryAssetDownload(asset, env);
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Type", mediaContentType(reference, asset, upstream.headers.get("Content-Type") || ""));
    const baseName = String(reference?.name || reference?.originalFilename || asset.originalFilename || asset.publicId.split("/").at(-1) || "file");
    const hasExtension = /\.[a-z0-9]+$/i.test(baseName);
    const filename = safeDownloadFilename(!hasExtension && asset.format ? `${baseName}.${asset.format}` : baseName);
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return json({
      error: error?.message || "Media access failed.",
      code: String(error?.code || "internal"),
      source: String(error?.source || "worker")
    }, Number(error?.status) || 500, origin);
  }
}

async function cloudinaryDeleteAssetIds(assetIds, env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || "").trim();
  if (!cloudName) throw serviceError("CLOUDINARY_CLOUD_NAME is not configured.", { status: 503, code: "cloudinary-config", source: "cloudinary" });
  const cleanIds = [...new Set((assetIds || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 100);
  if (!cleanIds.length) return { deleted: {} };
  const body = new URLSearchParams();
  cleanIds.forEach((assetId) => body.append("asset_ids[]", assetId));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources`, {
    method: "DELETE",
    headers: {
      Authorization: basicAuth(env),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Cloudinary deletion failed with HTTP ${response.status}.`;
    throw serviceError(message, {
      status: response.status === 420 ? 503 : response.status,
      code: response.status === 420 ? "cloudinary-rate-limited" : "cloudinary-delete-failed",
      source: "cloudinary",
      retryAt: response.status === 420 ? cloudinaryRetryAt(response, message) : ""
    });
  }
  return payload;
}

async function handleMediaDelete(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "cloudinary-delete");
    const body = await readStrictJsonBody(request, { assets: [ASSET_REFERENCE_SCHEMA] });
    const references = Array.isArray(body?.assets) ? body.assets.slice(0, 50) : [];
    if (!references.length) return json({ deleted: [], skipped: [], failed: [] }, 200, origin);

    const deleted = [];
    const skipped = [];
    const failed = [];
    const cloudinaryReferences = [];
    const driveReferences = [];

    for (const reference of references) {
      const provider = mediaReferenceProvider(reference);
      if (provider === "cloudinary") cloudinaryReferences.push(reference);
      else if (provider === "google-drive") driveReferences.push(reference);
      else skipped.push({ reference, reason: "unsupported-provider" });
    }

    const resolvedCloudinary = [];
    for (const reference of cloudinaryReferences) {
      try {
        const asset = await resolveAssetReference(reference, env);
        if (!asset) { skipped.push({ reference, reason: "unresolved" }); continue; }
        if (!assetBelongsToManagedFolder(asset, env)) { skipped.push({ reference, reason: "outside-managed-folder" }); continue; }
        if (!asset.assetId) { skipped.push({ reference, reason: "missing-asset-id" }); continue; }
        resolvedCloudinary.push(asset);
      } catch (error) {
        if (Number(error?.status) === 404) skipped.push({ reference, reason: "already-missing" });
        else failed.push({ reference, provider: "cloudinary", error: error?.message || "Cloudinary resolution failed." });
      }
    }

    if (resolvedCloudinary.length) {
      try {
        await cloudinaryDeleteAssetIds(resolvedCloudinary.map((asset) => asset.assetId), env);
        deleted.push(...resolvedCloudinary.map((asset) => ({
          provider: "cloudinary",
          storageProfileId: "cloudinary-default",
          assetId: asset.assetId,
          publicId: asset.publicId,
          resourceType: asset.resourceType,
          url: asset.secureUrl
        })));
      } catch (error) {
        resolvedCloudinary.forEach((asset) => failed.push({ provider: "cloudinary", assetId: asset.assetId, publicId: asset.publicId, error: error?.message || "Cloudinary deletion failed." }));
      }
    }

    for (const reference of driveReferences) {
      try {
        const result = await deleteDriveManagedReference(reference, env);
        if (result.deleted) deleted.push(result.asset);
        else skipped.push({ reference, reason: result.reason || "unresolved" });
      } catch (error) {
        failed.push({ reference, provider: "google-drive", error: error?.message || "Google Drive deletion failed." });
      }
    }

    if (failed.length) {
      return json({ error: "One or more managed assets could not be deleted.", code: "media-delete-partial", source: "worker", deleted, skipped, failed }, 502, origin);
    }
    return json({ deleted, skipped, failed: [] }, 200, origin);
  } catch (error) {
    return json({
      error: error?.message || "Media deletion failed.",
      code: String(error?.code || "internal"),
      source: String(error?.source || "worker"),
      retryAt: String(error?.retryAt || "")
    }, Number(error?.status) || 500, origin);
  }
}


const PRIVATE_MESSAGE_THREAD_RE = /^[A-Za-z0-9_-]{43}$/;
const PRIVATE_MESSAGE_ACTION = "portfolio_message_create";
const MESSAGE_NEW_THREAD_WINDOW_SECONDS = 10 * 60;
const MESSAGE_NEW_THREAD_LIMIT = 5;
const MESSAGE_NEW_THREAD_COOLDOWN_SECONDS = 4;
const MESSAGE_THREAD_WINDOW_SECONDS = 10 * 60;
const MESSAGE_THREAD_LIMIT = 20;
const MESSAGE_THREAD_COOLDOWN_SECONDS = 2;
const MESSAGE_CHALLENGE_WINDOW_SECONDS = 10 * 60;
const MESSAGE_CHALLENGE_LIMIT = 12;
const MESSAGE_CHALLENGE_COOLDOWN_SECONDS = 0; // Puzzle prewarming is governed by the challenge window; ordinary warmups must not self-throttle.
const MESSAGE_CHALLENGE_TTL_SECONDS = 180;
const MESSAGE_VERIFICATION_TTL_SECONDS = 90;
const MESSAGE_PUZZLE_TOLERANCE = 4;
const MESSAGE_PUZZLE_MAX_ATTEMPTS = 3;
const MESSAGE_PUZZLE_IMAGE_MIN_WIDTH = 1280;
const MESSAGE_PUZZLE_IMAGE_MIN_HEIGHT = 720;
const MESSAGE_PUZZLE_IMAGE_MIN_ASPECT = 1.45;
const MESSAGE_PUZZLE_IMAGE_MAX_ASPECT = 1.95;
const MESSAGE_PUZZLE_IMAGE_POOL_TTL_SECONDS = 6 * 60 * 60;
const MESSAGE_PUZZLE_IMAGE_HISTORY_TTL_SECONDS = 60 * 60;
const MESSAGE_PUZZLE_IMAGE_PAGE_SIZE = 20;
const MESSAGE_PUZZLE_QUALITY_SELECTION_LIMIT = 18;
const MESSAGE_PUZZLE_READY_POOL_TTL_SECONDS = 6 * 60 * 60;
const MESSAGE_PUZZLE_READY_POOL_TARGET = 8;
const MESSAGE_PUZZLE_READY_POOL_SEARCHES = 3;
const MESSAGE_PUZZLE_READY_POOL_PRIME_BATCH = 4;
const MESSAGE_PUZZLE_IMAGE_QUERIES = Object.freeze([
  "landscape photography",
  "nature photography",
  "city architecture photography",
  "mountain landscape photography",
  "forest landscape photography",
  "coast photography"
]);
const MESSAGE_PUZZLE_ALLOWED_LICENSES = new Set(["cc0", "pdm"]);
const OPENVERSE_IMAGE_SEARCH_URL = "https://api.openverse.org/v1/images/";
const TURNSTILE_LOCAL_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_LOCAL_SECRET_KEY = "1x0000000000000000000000000000000AA";
const PUSH_ADMIN_PREFIX = "push:admin:";
const PUSH_VISITOR_PREFIX = "push:visitor:";
const PUSH_VAPID_KEY = "push:vapid-keypair:v1";
const PUSH_DELIVERY_COLLECTION = "privatePushDeliveries";
const PUSH_RECEIPT_TIMEOUT_MS = 8000;
const PUSH_RECEIPT_POLL_MS = 200;
let firebaseAdminTokenCache = null;
let messagePuzzleReadyPoolPromise = null;

function pushStore(env) {
  const store = env?.PORTFOLIO_MESSAGES;
  if (!store || typeof store.get !== "function" || typeof store.put !== "function" || typeof store.list !== "function" || typeof store.delete !== "function") {
    throw serviceError("Portfolio message storage is not configured.", { status: 503, code: "message-storage-config", source: "worker" });
  }
  return store;
}

function base64Url(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlBytes(value = "") {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concatBytes(...parts) {
  const arrays = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part));
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}

function randomCapability(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function randomInteger(min, max) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) throw new Error("Invalid secure random range.");
  const range = high - low + 1;
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return low + (buffer[0] % range);
}

function randomPuzzleGeometry(previous = null) {
  let targetPercent = randomInteger(24, 82);
  let topPercent = randomInteger(8, 70);
  for (let attempt = 0; previous && attempt < 6 && Math.abs(targetPercent - Number(previous.targetPercent || 0)) < 14; attempt += 1) {
    targetPercent = randomInteger(24, 82);
  }
  for (let attempt = 0; previous && attempt < 6 && Math.abs(topPercent - Number(previous.topPercent || 0)) < 14; attempt += 1) {
    topPercent = randomInteger(8, 70);
  }
  return { targetPercent, topPercent, pieceScalePercent: randomInteger(14, 18) };
}

async function sha256Text(value = "") {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return base64Url(new Uint8Array(digest)).slice(0, 32);
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function hkdfExpand(prk, info, length) {
  let previous = new Uint8Array(0);
  let output = new Uint8Array(0);
  for (let counter = 1; output.length < length; counter += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([counter])));
    output = concatBytes(output, previous);
  }
  return output.slice(0, length);
}

function messageRequestContext(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) throw serviceError("Origin is not allowed.", { status: 403, code: "origin-denied", source: "worker" });
  const originUrl = new URL(origin);
  const host = originUrl.hostname.toLowerCase();
  return { origin, host, local: ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) };
}

function turnstileConfiguration(request, env) {
  const context = messageRequestContext(request, env);
  const siteKey = String(env.TURNSTILE_SITE_KEY || "").trim() || (context.local ? TURNSTILE_LOCAL_SITE_KEY : "");
  const secretKey = String(env.TURNSTILE_SECRET_KEY || "").trim() || (context.local ? TURNSTILE_LOCAL_SECRET_KEY : "");
  if (!siteKey || !secretKey) {
    throw serviceError("Public message human verification is not configured.", { status: 503, code: "message-human-config", source: "turnstile" });
  }
  return { ...context, siteKey, secretKey };
}

async function verifyTurnstile(request, env, token) {
  const config = turnstileConfiguration(request, env);
  const responseToken = String(token || "").trim();
  if (!responseToken) throw serviceError("Complete the human verification first.", { status: 400, code: "message-human-required", source: "turnstile" });
  const form = new FormData();
  form.set("secret", config.secretKey);
  form.set("response", responseToken);
  const ip = String(request.headers.get("CF-Connecting-IP") || "").trim();
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true) {
    throw serviceError("Human verification failed. Please slide again.", { status: 403, code: "message-human-failed", source: "turnstile" });
  }
  if (!config.local) {
    if (String(result.action || "") !== PRIVATE_MESSAGE_ACTION) {
      throw serviceError("Human verification action did not match.", { status: 403, code: "message-human-action", source: "turnstile" });
    }
    if (String(result.hostname || "").toLowerCase() !== config.host) {
      throw serviceError("Human verification hostname did not match.", { status: 403, code: "message-human-hostname", source: "turnstile" });
    }
  }
  return true;
}

function assertPrivateMessageRelayConfigured(env) {
  pushStore(env);
  firestoreProjectId(env);
  if (!String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "").trim() || !String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim()) {
    throw serviceError("Secure messaging server credentials are not configured.", { status: 503, code: "message-firestore-admin-config", source: "firebase" });
  }
}

async function privateMessageClientBinding(request) {
  const ip = String(request.headers.get("CF-Connecting-IP") || "local").trim() || "local";
  const agent = String(request.headers.get("User-Agent") || "unknown").slice(0, 240);
  return sha256Text(`${ip}|${agent}`);
}

function privateMessageImagePoolKey(queryIndex, page) {
  return `message:puzzle-image-pool:v1:${queryIndex}:${page}`;
}

function privateMessageImageHistoryKey(binding) {
  return `message:puzzle-image-history:v1:${binding}`;
}

function privateMessageReadyImagePoolKey() {
  return "message:puzzle-ready-pool:v2";
}

function safeExternalHttpUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeOpenversePuzzleImage(item = {}) {
  const id = String(item?.id || item?.identifier || "").trim();
  const sourceUrl = safeExternalHttpUrl(item?.url || item?.thumbnail);
  const previewUrl = safeExternalHttpUrl(item?.thumbnail || item?.url);
  const landingUrl = safeExternalHttpUrl(item?.foreign_landing_url);
  const width = Number(item?.width);
  const height = Number(item?.height);
  const ratio = width > 0 && height > 0 ? width / height : 0;
  const license = String(item?.license || "").trim().toLowerCase();
  const filetype = String(item?.filetype || "").trim().toLowerCase();
  const category = String(item?.category || "").trim().toLowerCase();
  if (!id || !sourceUrl || !MESSAGE_PUZZLE_ALLOWED_LICENSES.has(license)) return null;
  if (item?.watermarked === true) return null;
  if (filetype && !["jpg", "jpeg", "png", "webp"].includes(filetype)) return null;
  if (category && !["photograph", "photo", "image"].includes(category)) return null;
  if (ratio && (ratio < MESSAGE_PUZZLE_IMAGE_MIN_ASPECT || ratio > MESSAGE_PUZZLE_IMAGE_MAX_ASPECT)) return null;
  if (width > 0 && height > 0 && (width < MESSAGE_PUZZLE_IMAGE_MIN_WIDTH || height < MESSAGE_PUZZLE_IMAGE_MIN_HEIGHT)) return null;
  const pixels = width > 0 && height > 0 ? width * height : 0;
  return {
    id,
    sourceUrl,
    previewUrl,
    landingUrl,
    title: String(item?.title || "Openverse image").trim().slice(0, 160) || "Openverse image",
    creator: String(item?.creator || "").trim().slice(0, 120),
    license,
    licenseVersion: String(item?.license_version || "").trim().slice(0, 20),
    width: width > 0 ? Math.round(width) : 0,
    height: height > 0 ? Math.round(height) : 0,
    qualityScore: pixels
  };
}

async function loadOpenversePuzzleImagePool(env, queryIndex, page) {
  const store = pushStore(env);
  const key = privateMessageImagePoolKey(queryIndex, page);
  const cached = await store.get(key, "json").catch(() => null);
  if (Array.isArray(cached) && cached.length) return cached;

  const query = MESSAGE_PUZZLE_IMAGE_QUERIES[queryIndex];
  const url = new URL(OPENVERSE_IMAGE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(MESSAGE_PUZZLE_IMAGE_PAGE_SIZE));
  url.searchParams.set("aspect_ratio", "wide");
  url.searchParams.set("size", "large");
  const response = await fetch(url.href, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw serviceError("Verification image service is temporarily unavailable.", { status: 503, code: "message-puzzle-image-search", source: "openverse" });
  }
  const payload = await response.json().catch(() => ({}));
  const pool = (Array.isArray(payload?.results) ? payload.results : [])
    .map(normalizeOpenversePuzzleImage)
    .filter(Boolean)
    .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0));
  if (!pool.length) {
    throw serviceError("No suitable verification image was available. Please try again.", { status: 503, code: "message-puzzle-image-empty", source: "openverse" });
  }
  await store.put(key, JSON.stringify(pool), { expirationTtl: MESSAGE_PUZZLE_IMAGE_POOL_TTL_SECONDS });
  return pool;
}

async function buildReadyOpenversePuzzleImagePool(env) {
  const store = pushStore(env);
  const queryIndexes = [];
  while (queryIndexes.length < Math.min(MESSAGE_PUZZLE_READY_POOL_SEARCHES, MESSAGE_PUZZLE_IMAGE_QUERIES.length)) {
    const value = randomInteger(0, MESSAGE_PUZZLE_IMAGE_QUERIES.length - 1);
    if (!queryIndexes.includes(value)) queryIndexes.push(value);
  }
  const searchResults = await Promise.allSettled(queryIndexes.map((queryIndex) =>
    loadOpenversePuzzleImagePool(env, queryIndex, randomInteger(1, 2))
  ));
  const candidatesById = new Map();
  searchResults.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((image) => {
      const current = candidatesById.get(image.id);
      if (!current || Number(image.qualityScore || 0) > Number(current.qualityScore || 0)) candidatesById.set(image.id, image);
    });
  });
  const candidates = [...candidatesById.values()]
    .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0))
    .slice(0, MESSAGE_PUZZLE_QUALITY_SELECTION_LIMIT);
  const ready = [];
  for (let offset = 0; offset < candidates.length && ready.length < MESSAGE_PUZZLE_READY_POOL_TARGET; offset += MESSAGE_PUZZLE_READY_POOL_PRIME_BATCH) {
    const batch = candidates.slice(offset, offset + MESSAGE_PUZZLE_READY_POOL_PRIME_BATCH);
    const primed = await Promise.allSettled(batch.map((image) => primePuzzleImage(image)));
    primed.forEach((result) => {
      if (result.status === "fulfilled" && result.value && !ready.some((item) => item.id === result.value.id)) ready.push(result.value);
    });
  }
  if (!ready.length) {
    const failedSearch = searchResults.find((result) => result.status === "rejected");
    if (failedSearch?.reason) throw failedSearch.reason;
    throw serviceError("Verification image service is temporarily unavailable.", { status: 503, code: "message-puzzle-image-unavailable", source: "openverse" });
  }
  await store.put(privateMessageReadyImagePoolKey(), JSON.stringify(ready), { expirationTtl: MESSAGE_PUZZLE_READY_POOL_TTL_SECONDS });
  return ready;
}

async function readyOpenversePuzzleImagePool(env, { refresh = false } = {}) {
  const store = pushStore(env);
  if (!refresh) {
    const cached = await store.get(privateMessageReadyImagePoolKey(), "json").catch(() => null);
    if (Array.isArray(cached) && cached.length) return cached;
  }
  if (!messagePuzzleReadyPoolPromise) {
    messagePuzzleReadyPoolPromise = buildReadyOpenversePuzzleImagePool(env).finally(() => { messagePuzzleReadyPoolPromise = null; });
  }
  return messagePuzzleReadyPoolPromise;
}

async function chooseOpenversePuzzleImage(env, binding) {
  const store = pushStore(env);
  const historyKey = privateMessageImageHistoryKey(binding);
  const recent = await store.get(historyKey, "json").catch(() => []);
  const recentIds = new Set(Array.isArray(recent) ? recent.slice(-6).map((value) => String(value)) : []);

  for (let pass = 0; pass < 2; pass += 1) {
    const pool = await readyOpenversePuzzleImagePool(env, { refresh: pass > 0 });
    const unseen = pool.filter((image) => !recentIds.has(image.id));
    const candidates = [...(unseen.length ? unseen : pool)];
    while (candidates.length) {
      const index = randomInteger(0, candidates.length - 1);
      const [candidate] = candidates.splice(index, 1);
      const primed = await primePuzzleImage(candidate);
      if (!primed) continue;
      const nextRecent = [...recentIds, primed.id].slice(-6);
      await store.put(historyKey, JSON.stringify(nextRecent), { expirationTtl: MESSAGE_PUZZLE_IMAGE_HISTORY_TTL_SECONDS });
      return primed;
    }
  }

  throw serviceError("Verification image service is temporarily unavailable.", { status: 503, code: "message-puzzle-image-unavailable", source: "openverse" });
}

function puzzleImageCacheKey(imageId = "") {
  const safeId = String(imageId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return new Request(`https://lan-portfolio.invalid/message-puzzle/${safeId || "unknown"}`);
}

async function fetchPuzzleImageCandidate(image = {}) {
  const candidates = [image?.deliveryUrl, image?.sourceUrl, image?.previewUrl]
    .map(safeExternalHttpUrl)
    .filter((value, index, values) => value && values.indexOf(value) === index);
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      redirect: "follow"
    }).catch(() => null);
    const contentType = String(response?.headers?.get("Content-Type") || "").toLowerCase();
    if (response?.ok && contentType.startsWith("image/")) return { response, url: candidate };
  }
  return null;
}

async function primePuzzleImage(image = {}) {
  const cache = globalThis.caches?.default || null;
  const cacheKey = puzzleImageCacheKey(image?.id);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached?.ok) return { ...image, deliveryUrl: image.deliveryUrl || image.sourceUrl || image.previewUrl };
  const fetched = await fetchPuzzleImageCandidate(image);
  if (!fetched) return null;
  const contentType = String(fetched.response.headers.get("Content-Type") || "image/jpeg");
  if (cache) {
    const cachedResponse = new Response(fetched.response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${MESSAGE_PUZZLE_IMAGE_POOL_TTL_SECONDS}`,
        "X-Content-Type-Options": "nosniff"
      }
    });
    await cache.put(cacheKey, cachedResponse.clone()).catch(() => {});
  } else {
    try { await fetched.response.body?.cancel?.(); } catch {}
  }
  return { ...image, deliveryUrl: fetched.url };
}

function publicPuzzleImageUrl(request, challengeId) {
  const url = new URL(request.url);
  url.pathname = `/messages/security/challenge/${encodeURIComponent(challengeId)}/image`;
  url.search = "";
  url.hash = "";
  return url.href;
}

async function handleMessagePuzzleImage(request, env, challengeId) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(String(challengeId || "")))
    return new Response("Not found.", { status: 404 });
  let image;
  try {
    const record = await coordinateSecurity(env,
      securityChallengeOwner("message-puzzle", challengeId), {
        op: "puzzle-image-read", scope: "message-puzzle", id: challengeId
      });
    image = record.image || {};
  } catch (error) {
    return new Response(error?.code === "message-puzzle-expired"
      ? "Challenge expired." : "Puzzle image unavailable.", {
      status: error?.code === "message-puzzle-expired" ? 410 : Number(error?.status) || 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
  const cache = globalThis.caches?.default || null;
  const cacheKey = puzzleImageCacheKey(image?.id || challengeId);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached?.ok) {
    const headers = new Headers(cached.headers);
    headers.set("Cache-Control", `private, max-age=${MESSAGE_CHALLENGE_TTL_SECONDS}`);
    return new Response(cached.body, { status: 200, headers });
  }
  const fetched = await fetchPuzzleImageCandidate(image);
  if (!fetched) {
    return new Response("Verification image is no longer available. Request a new challenge.", {
      status: 410,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  const contentType = String(fetched.response.headers.get("Content-Type") || "image/jpeg");
  const cacheResponse = new Response(fetched.response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${MESSAGE_PUZZLE_IMAGE_POOL_TTL_SECONDS}`,
      "X-Content-Type-Options": "nosniff"
    }
  });
  if (cache) await cache.put(cacheKey, cacheResponse.clone()).catch(() => {});
  const headers = new Headers(cacheResponse.headers);
  headers.set("Cache-Control", `private, max-age=${MESSAGE_CHALLENGE_TTL_SECONDS}`);
  return new Response(cacheResponse.body, { status: 200, headers });
}

// Verification tokens are never stored raw. Their SHA-256 derived identifiers
// select exactly one canonical atomic Coordinator record.
async function privateMessageProofId(token) {
  return sha256Text(token);
}

async function handleMessagePuzzleChallenge(request, env) {
  let context;
  try {
    context = messageRequestContext(request, env);
    assertPrivateMessageRelayConfigured(env);
    const turnstile = turnstileConfiguration(request, env);
    await enforceMessageRateLimit(request, env, {
      scope: "puzzle-challenge",
      limit: MESSAGE_CHALLENGE_LIMIT,
      windowSeconds: MESSAGE_CHALLENGE_WINDOW_SECONDS,
      cooldownSeconds: MESSAGE_CHALLENGE_COOLDOWN_SECONDS
    });
    const challengeId = randomCapability(18);
    const geometry = randomPuzzleGeometry();
    const binding = await privateMessageClientBinding(request);
    const image = await chooseOpenversePuzzleImage(env, binding);
    const now = Date.now();
    await coordinateSecurity(env,securityChallengeOwner("message-puzzle",challengeId),{
      op:"challenge-put",scope:"message-puzzle",id:challengeId,
      record:{
        scope:"message-puzzle",...geometry,origin:context.origin,binding,
        image,attempts:0,createdAt:now,
        expiresAt:now+MESSAGE_CHALLENGE_TTL_SECONDS*1000
      }
    });
    return json({
      challengeId,
      ...geometry,
      image: {
        url: publicPuzzleImageUrl(request, challengeId),
        title: image.title,
        creator: image.creator,
        license: image.license,
        licenseVersion: image.licenseVersion,
        landingUrl: image.landingUrl,
        width: image.width,
        height: image.height,
        source: "Openverse"
      },
      siteKey: turnstile.siteKey,
      action: PRIVATE_MESSAGE_ACTION,
      expiresIn: MESSAGE_CHALLENGE_TTL_SECONDS
    }, 201, context.origin);
  } catch (error) {
    const origin = context?.origin || allowedOrigin(request.headers.get("Origin") || "", env);
    return json({ error: error?.message || "Verification puzzle could not be created.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePuzzleVerify(request, env) {
  let context;
  try {
    context = messageRequestContext(request, env);
    assertPrivateMessageRelayConfigured(env);
    const body = await readStrictJsonBody(request, {
      challengeId: REQUEST_SCHEMA_ANY, answer: REQUEST_SCHEMA_ANY,
      turnstileToken: REQUEST_SCHEMA_ANY
    });
    const challengeId = String(body?.challengeId || "").trim();
    const answer = Number(body?.answer);
    if (!/^[A-Za-z0-9_-]{24}$/.test(challengeId))
      throw serviceError("Verification puzzle is invalid.",{
        status:400,code:"message-puzzle-invalid",source:"worker"
      });
    if (!Number.isFinite(answer) || answer < 0 || answer > 100)
      throw serviceError("Complete the verification puzzle first.",{
        status:400,code:"message-puzzle-answer",source:"worker"
      });
    const binding = await privateMessageClientBinding(request);
    const reply = await coordinateSecurity(env,
      securityChallengeOwner("message-puzzle",challengeId), {
        op:"puzzle-check",scope:"message-puzzle",id:challengeId,
        origin:context.origin,binding,answer,
        tolerance:MESSAGE_PUZZLE_TOLERANCE,
        maxAttempts:MESSAGE_PUZZLE_MAX_ATTEMPTS,
        nextGeometry:randomPuzzleGeometry(),
        verificationNonce:securityRandomId(24)
      });
    if (reply.outcome === "replace") {
      return json({
        ok:false,outcome:"replace",code:"message-puzzle-reset-required",
        message:"That puzzle did not match. Switching to the next prepared image…"
      },200,context.origin);
    }
    if (reply.outcome === "retry") {
      return json({
        ok:false,outcome:"retry",code:"message-puzzle-retry",
        message:"Not quite. The matching space moved — try again.",
        challenge:reply.challenge,attempts:reply.attempts,
        attemptsRemaining:reply.attemptsRemaining
      },200,context.origin);
    }
    if (reply.outcome !== "pending") {
      throw serviceError("Puzzle verification could not be completed.",{
        status:503,code:"message-puzzle-state",source:"worker"
      });
    }
    // The puzzle is now reserved by one nonce. Even if Turnstile is slow or
    // fails, concurrent puzzle solves cannot issue another proof.
    await verifyTurnstile(request,env,body?.turnstileToken);
    await coordinateSecurity(env,securityChallengeOwner("message-puzzle",challengeId),{
      op:"puzzle-finalize",scope:"message-puzzle",id:challengeId,
      verificationNonce:reply.verificationNonce
    });
    const verificationToken=randomCapability(24);
    const proofId=await privateMessageProofId(verificationToken);
    const now=Date.now();
    await coordinateSecurity(env,securityChallengeOwner("message-proof",proofId),{
      op:"challenge-put",scope:"message-proof",id:proofId,
      record:{
        scope:"message-proof",origin:context.origin,binding,createdAt:now,
        expiresAt:now+MESSAGE_VERIFICATION_TTL_SECONDS*1000
      }
    });
    return json({ok:true,verificationToken,expiresIn:MESSAGE_VERIFICATION_TTL_SECONDS},200,context.origin);
  } catch (error) {
    const origin=context?.origin||allowedOrigin(request.headers.get("Origin")||"",env);
    return json({error:error?.message||"Verification puzzle could not be completed.",
      code:error?.code||"internal"},Number(error?.status)||500,origin);
  }
}

async function consumePrivateMessageVerification(request,env,token) {
  const value=String(token||"").trim();
  if(!/^[A-Za-z0-9_-]{32}$/.test(value)) throw serviceError(
    "Complete human verification before sending.",{
      status:403,code:"message-verification-required",source:"worker"
    });
  const proofId=await privateMessageProofId(value);
  let proof;
  try{
    proof=await consumeSecurityChallenge(env,"message-proof",proofId);
  }catch(error){
    if(["security-challenge-invalid","security-challenge-expired"].includes(error?.code)){
      throw serviceError("Human verification expired. Complete the puzzle again.",{
        status:403,code:"message-verification-expired",source:"worker"
      });
    }
    throw error;
  }
  const context=messageRequestContext(request,env);
  const binding=await privateMessageClientBinding(request);
  if(proof.origin!==context.origin||proof.binding!==binding){
    throw serviceError("Human verification does not belong to this browser session.",{
      status:403,code:"message-verification-binding",source:"worker"
    });
  }
  return true;
}

async function enforceMessageRateLimit(request,env,{
  scope,limit,windowSeconds,cooldownSeconds
}){
  const identity=securityIp(request);
  const owner=await rateCoordinatorOwner("public-message:"+scope,identity);
  await coordinateSecurity(env,owner,{
    op:"rate-hit",category:"message",
    policy:{limit,windowSeconds,cooldownSeconds},now:Date.now()
  });
}

function pemPrivateKeyBytes(value = "") {
  const normalized = String(value || "").replace(/\\n/g, "\n").trim();
  const match = normalized.match(/^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PRIVATE KEY-----$/);
  if (!match) {
    throw serviceError("Firebase server private key format is invalid. Check the dedicated service-account value in Worker secrets.", { status: 503, code: "message-firestore-admin-key-format", source: "firebase" });
  }
  const body = match[1].replace(/\s+/g, "");
  if (!body || body.length % 4 !== 0) {
    throw serviceError("Firebase server private key format is invalid. Check the dedicated service-account value in Worker secrets.", { status: 503, code: "message-firestore-admin-key-format", source: "firebase" });
  }
  try {
    const binary = atob(body);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw serviceError("Firebase server private key format is invalid. Check the dedicated service-account value in Worker secrets.", { status: 503, code: "message-firestore-admin-key-format", source: "firebase" });
  }
}

async function firebaseAdminAccessToken(env) {
  const now = Date.now();
  if (firebaseAdminTokenCache?.token && firebaseAdminTokenCache.expiresAt > now + 60_000) return firebaseAdminTokenCache.token;
  const clientEmail = String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKeyPem = String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim();
  if (!clientEmail || !privateKeyPem) {
    throw serviceError("Firebase server credentials are not configured for secure Public messaging.", { status: 503, code: "message-firestore-admin-config", source: "firebase" });
  }
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600
  })));
  const unsigned = `${header}.${payload}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemPrivateKeyBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token?.access_token) {
    throw serviceError("Firebase server authorization failed.", { status: 503, code: "message-firestore-admin-auth", source: "firebase" });
  }
  const expiresIn = Math.max(120, Number(token.expires_in) || 3600);
  firebaseAdminTokenCache = { token: String(token.access_token), expiresAt: now + expiresIn * 1000 };
  return firebaseAdminTokenCache.token;
}

function firestoreProjectId(env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw serviceError("FIREBASE_PROJECT_ID is not configured.", { status: 503, code: "firebase-config", source: "firebase" });
  return projectId;
}

async function identityPlatformAdminUpdateUser(env, uid, updates = {}) {
  const token = await firebaseAdminAccessToken(env);
  const projectId = firestoreProjectId(env);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ localId: String(uid || ""), returnSecureToken: false, ...updates })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw serviceError(payload?.error?.message || "Firebase administrator account update failed.", { status: 502, code: "security-firebase-admin-update", source: "firebase" });
  return payload;
}

async function clearFirebaseMfaForRecovery(env, uid) {
  return identityPlatformAdminUpdateUser(env, uid, {
    mfa: { enrollments: [] },
    validSince: String(Math.floor(Date.now() / 1000))
  });
}

function firestoreDocumentName(env, ...segments) {
  return `projects/${firestoreProjectId(env)}/databases/(default)/documents/${segments.map((segment) => encodeURIComponent(String(segment))).join("/")}`;
}

async function firestoreAdminCommit(env, writes) {
  const token = await firebaseAdminAccessToken(env);
  const projectId = firestoreProjectId(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ writes })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const conflict = [409, 412].includes(response.status) ||
      ["ABORTED", "FAILED_PRECONDITION"].includes(String(payload?.error?.status || ""));
    if (conflict) {
      throw serviceError("Firestore write precondition was not satisfied.", {
        status: 409, code: "firestore-precondition-failed", source: "firebase"
      });
    }
    throw serviceError(payload?.error?.message || "Private message could not be stored.", { status: 502, code: "message-firestore-write", source: "firebase" });
  }
  return payload;
}

async function firestoreAdminGetDocument(env, ...segments) {
  const token = await firebaseAdminAccessToken(env);
  const projectId = firestoreProjectId(env);
  const path = segments.map((segment) => encodeURIComponent(String(segment))).join("/");
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw serviceError(payload?.error?.message || "Firestore document could not be read.", { status: 502, code: "message-firestore-read", source: "firebase" });
  return payload;
}

async function firestoreAdminGetThread(threadId, env) {
  if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) return null;
  return firestoreAdminGetDocument(env, "privateMessageThreads", threadId);
}

async function firestoreAdminGetPushDelivery(id, env) {
  if (!/^[A-Za-z0-9_-]{18,80}$/.test(String(id || ""))) return null;
  return firestoreAdminGetDocument(env, PUSH_DELIVERY_COLLECTION, id);
}

function firestoreString(value = "") { return { stringValue: String(value) }; }
function firestoreBoolean(value) { return { booleanValue: Boolean(value) }; }
function firestoreInteger(value) { return { integerValue: String(Math.trunc(Number(value) || 0)) }; }
function firestoreTimestamp(value) { return { timestampValue: value instanceof Date ? value.toISOString() : String(value) }; }
function firestoreNull() { return { nullValue: null }; }


// --- Canonical Admin Security Gateway -------------------------------------------------
const SECURITY_COLLECTIONS = Object.freeze({
  devices: 'adminSecurityDevices', sessions: 'adminSecuritySessions', recovery: 'adminSecurityRecovery',
  events: 'adminSecurityEvents', challenges: 'adminSecurityChallenges', stepUps: 'adminSecurityStepUps'
});
const SECURITY_LIFETIMES = Object.freeze({
  temporary: 8 * 60 * 60, trusted: 7 * 24 * 60 * 60, recovery: 15 * 60, stepUp: 10 * 60, challenge: 5 * 60
});
const ADMIN_SERVICE_RATE_POLICIES = Object.freeze({
  "cloudinary-read": { limit: 60, windowSeconds: 60 },
  "cloudinary-delete": { limit: 20, windowSeconds: 10 * 60 },
  "cloudinary-telemetry": { limit: 30, windowSeconds: 60 },
  "drive-read": { limit: 90, windowSeconds: 60 },
  "drive-write": { limit: 30, windowSeconds: 10 * 60 }
});

// One canonical coordinator backs all sensitive Admin, Cloudinary and Drive
// rate limits. It must be bound as a SQLite-backed Durable Object.
function securityCoordinatorNamespace(env) {
  const namespace = env?.SECURITY_COORDINATOR;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw serviceError("Atomic security coordinator is not configured.", {
      status: 503, code: "security-coordinator-not-configured", source: "worker"
    });
  }
  return namespace;
}

async function coordinateSecurity(env, owner, operation) {
  const namespace = securityCoordinatorNamespace(env);
  const stub = namespace.get(namespace.idFromName(owner));
  if (!stub || typeof stub.fetch !== "function") {
    throw serviceError("Atomic security coordinator is unavailable.", {
      status: 503, code: "security-coordinator-not-configured", source: "worker"
    });
  }
  let response;
  try {
    response = await stub.fetch("https://security-coordinator.internal/operation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation)
    });
  } catch {
    throw serviceError("Atomic security coordinator could not be reached.", {
      status: 503, code: "security-coordinator-unavailable", source: "worker"
    });
  }
  const result = await response.json().catch(() => null);
  if (!result || (!response.ok && !result.code)) {
    throw serviceError("Atomic security coordinator response was invalid.", {
      status: 503, code: "security-coordinator-unavailable", source: "worker"
    });
  }
  if (!response.ok) {
    throw serviceError(result.error || "Sensitive operation was rejected.", {
      status: response.status, code: result.code, source: "worker", retryAt: result.retryAt || ""
    });
  }
  return result;
}

async function rateCoordinatorOwner(scope, subject) {
  const digest = await sha256Text(scope + ":" + String(subject || "unknown"));
  return "security-rate:" + scope + ":" + digest;
}

async function enforceServiceRateLimit(request, env, scope, policy, identity = "") {
  const owner = await rateCoordinatorOwner("service:" + scope,
    String(identity || securityIp(request) || "unknown").slice(0, 180));
  await coordinateSecurity(env, owner, {
    op: "rate-hit", category: "service",
    policy: policy || { limit: 30, windowSeconds: 60 },
    now: Date.now()
  });
}

async function enforceAdminServiceRateLimit(request, env, uid, scope) {
  return enforceServiceRateLimit(request, env, scope, ADMIN_SERVICE_RATE_POLICIES[scope],
    "admin:" + String(uid || ""));
}

async function enforcePublicServiceRateLimit(request, env, scope) {
  return enforceServiceRateLimit(request, env, scope, ADMIN_SERVICE_RATE_POLICIES[scope]);
}

const SECURITY_RATE_POLICIES = Object.freeze({
  password:{limit:7,windowSeconds:15*60,cooldownSeconds:15*60}, totp:{limit:8,windowSeconds:10*60,cooldownSeconds:15*60},
  recovery:{limit:5,windowSeconds:30*60,cooldownSeconds:30*60}, enrollment:{limit:10,windowSeconds:15*60,cooldownSeconds:10*60},
  'device-proof':{limit:10,windowSeconds:15*60,cooldownSeconds:15*60}
});
function securityRandomId(bytes=24){ const out=new Uint8Array(bytes); crypto.getRandomValues(out); return base64Url(out); }
// The rate identity must come from Cloudflare's controlled client address
// header, not user-supplied X-Forwarded-For. Missing means one shared bucket.
function securityIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || "unknown").trim().slice(0, 96) || "unknown";
}

function securityChallengeOwner(scope, id) {
  return "security-challenge:" + String(scope) + ":" + String(id);
}

async function putSecurityChallenge(env, scope, data, ttl = SECURITY_LIFETIMES.challenge) {
  const id = securityRandomId();
  const now = Date.now();
  await coordinateSecurity(env, securityChallengeOwner(scope, id), {
    op: "challenge-put", scope, id, record: {
      ...data, scope, createdAt: now, expiresAt: now + ttl * 1000
    }
  });
  return id;
}

async function consumeSecurityChallenge(env, scope, id) {
  const outcome = await coordinateSecurity(env, securityChallengeOwner(scope, id), {
    op: "challenge-consume", scope, id: String(id || "")
  });
  return outcome.record;
}

async function readPendingRecoveryChallenge(env, id, scope="recovery") {
  const result = await coordinateSecurity(env, securityChallengeOwner(scope, id), {
    op: "recovery-read", scope, id: String(id || "")
  });
  return result.record;
}

async function savePreparedRecoveryKit(env, id, prepared, scope="recovery") {
  await coordinateSecurity(env,securityChallengeOwner(scope,id),{
    op:"recovery-prepare",scope,id,prepared
  });
}


async function readSecurityEnrollmentChallenge(env, id, uid) {
  const result = await coordinateSecurity(env, securityChallengeOwner("device-enroll", id), {
    op: "challenge-read", scope: "device-enroll", id: String(id || ""), uid
  });
  return result.record;
}

async function approveSecurityEnrollmentChallenge(env, id, uid, approvedByDeviceId) {
  return coordinateSecurity(env, securityChallengeOwner("device-enroll", id), {
    op: "challenge-approve", scope: "device-enroll", id: String(id || ""),
    uid, approvedByDeviceId
  });
}

async function consumeSecurityEnrollmentChallenge(env, id, uid, deviceId, publicKeyJwk, requiresApproval) {
  const result = await coordinateSecurity(env, securityChallengeOwner("device-enroll", id), {
    op: "enrollment-consume", scope: "device-enroll", id: String(id || ""),
    uid, deviceId, publicKeyJwk, requiresApproval
  });
  return result.record;
}

async function enforceSecurityRateLimit(request, env, scope,
    policy = SECURITY_RATE_POLICIES[scope] || { limit: 10, windowSeconds: 900, cooldownSeconds: 900 }) {
  const ip = securityIp(request);
  const owner = await rateCoordinatorOwner("security:" + scope, ip);
  try {
    await coordinateSecurity(env, owner, {
      op: "rate-hit", category: "security", policy, now: Date.now()
    });
  } catch (error) {
    if (error?.code === "security-rate-limited") {
      await writeSecurityEvent(env, {
        type: "rate-limited", success: false, ip,
        summary: scope + " security rate limit blocked the request"
      }).catch(() => null);
    }
    throw error;
  }
}

async function clearSecurityRateLimit(request, env, scope) {
  const owner = await rateCoordinatorOwner("security:" + scope, securityIp(request));
  await coordinateSecurity(env, owner, { op: "rate-clear" });
}

function firestoreValue(value){
  if(value===null || value===undefined) return firestoreNull();
  if(value instanceof Date) return firestoreTimestamp(value);
  if(typeof value==='boolean') return firestoreBoolean(value);
  if(typeof value==='number') return Number.isInteger(value)?firestoreInteger(value):{doubleValue:value};
  if(Array.isArray(value)) return {arrayValue:{values:value.map(firestoreValue)}};
  if(typeof value==='object') return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,firestoreValue(v)]))}};
  return firestoreString(value);
}
function firestoreFields(record){ return Object.fromEntries(Object.entries(record).map(([k,v])=>[k,firestoreValue(v)])); }
function fromFirestoreValue(v){ if(!v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);if('timestampValue'in v)return v.timestampValue;if('nullValue'in v)return null;if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,fromFirestoreValue(x)]));if(v.arrayValue)return(v.arrayValue.values||[]).map(fromFirestoreValue);return null; }
function fromFirestoreDoc(doc){ if(!doc)return null; const id=decodeURIComponent(String(doc.name||'').split('/').pop()||''); return {id,...Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,fromFirestoreValue(v)])),_updateTime:doc.updateTime||''}; }
async function securityWriteDoc(env,collection,id,record){ return firestoreAdminCommit(env,[{update:{name:firestoreDocumentName(env,collection,id),fields:firestoreFields(record)}}]); }
async function securityPatchDoc(env,collection,id,record,fieldPaths=Object.keys(record)){ return firestoreAdminCommit(env,[{update:{name:firestoreDocumentName(env,collection,id),fields:firestoreFields(record)},updateMask:{fieldPaths}}]); }
async function securityGetDoc(env,collection,id){ return fromFirestoreDoc(await firestoreAdminGetDocument(env,collection,id)); }

// Recovery is owned by one versioned Firestore document per Admin, not KV or
// browser state. All security-sensitive recovery transitions use Firestore's
// server-evaluated updateTime precondition, preventing parallel replay and stale
// completion from overwriting a more recent recovery key.
async function writeRecoveryConditional(env, uid, version, record, {
  merge = false, conflictCode = "security-recovery-state-changed"
} = {}) {
  const updateTime = String(version || "").trim();
  if (!updateTime || !Number.isFinite(Date.parse(updateTime))) {
    throw serviceError("Recovery version could not be verified.", {
      status: 503, code: "security-recovery-version-missing", source: "firebase"
    });
  }
  const write = {
    update: {
      name: firestoreDocumentName(env, SECURITY_COLLECTIONS.recovery, uid),
      fields: firestoreFields(record)
    },
    ...(merge ? { updateMask: { fieldPaths: Object.keys(record) } } : {}),
    currentDocument: { updateTime }
  };
  try {
    return await firestoreAdminCommit(env, [write]);
  } catch (error) {
    if (error?.code === "firestore-precondition-failed") {
      throw serviceError("Recovery state changed; the previous key or challenge is no longer valid.", {
        status: 409, code: conflictCode, source: "worker"
      });
    }
    throw error;
  }
}

const RECOVERY_RESET_LEASE_MS = 30 * 1000;
const RECOVERY_INTERRUPTED_MAX_AGE_MS = 60 * 60 * 1000;

async function claimMasterRecoveryKey(env, uid, recoveryRecord, recoverySessionId) {
  const now = Date.now();
  // A prepared-but-not-activated recovery is still pending. If its browser
  // challenge expired or was lost, the SAME offline Master Key plus a fresh
  // verified password may restart the incomplete ceremony within its bounded
  // recovery window. A successful activation writes active:true and rejects
  // the old key permanently.
  const resuming = recoveryRecord?.active === false;
  if (resuming) {
    const age = now - Date.parse(String(recoveryRecord.usedAt || ""));
    if (!Number.isFinite(age) || age < 0 || age > RECOVERY_INTERRUPTED_MAX_AGE_MS) {
      throw serviceError("Interrupted recovery has expired; account access remains locked.", {
        status: 403, code: "security-recovery-resume-expired", source: "worker"
      });
    }
    if (Number(recoveryRecord.recoveryResetLeaseUntil || 0) > now) {
      throw serviceError("A security recovery reset is already in progress.", {
        status: 409, code: "security-recovery-in-progress", source: "worker"
      });
    }
  }
  return writeRecoveryConditional(env, uid, recoveryRecord?._updateTime, {
    active: false,
    ...(!resuming ? { usedAt: new Date(now).toISOString() } : {}),
    pendingRecoverySessionId: recoverySessionId,
    recoveryResetsComplete: false,
    recoveryResetLeaseUntil: now + RECOVERY_RESET_LEASE_MS
  }, { merge: true, conflictCode: "security-recovery-key-already-used" });
}

async function finalizeRecoveryResetPreparation(env, uid, recoverySessionId, completed) {
  const record = await securityGetDoc(env, SECURITY_COLLECTIONS.recovery, uid);
  if (!record || record.active !== false ||
      record.recoveryResetsComplete === true ||
      record.pendingRecoverySessionId !== recoverySessionId) {
    throw serviceError("Recovery state changed during reset.", {
      status: 409, code: "security-recovery-state-changed", source: "worker"
    });
  }
  return writeRecoveryConditional(env, uid, record._updateTime, completed
    ? { recoveryResetsComplete: true, recoveryResetAt: new Date().toISOString(),
        recoveryResetLeaseUntil: 0 }
    : { recoveryResetLeaseUntil: 0 },
    { merge: true, conflictCode: "security-recovery-state-changed" });
}

async function finishMasterRecoveryKey(env, uid, recoveryRecord, replacementRecord) {
  if (recoveryRecord?.active !== false || recoveryRecord?.recoveryResetsComplete !== true) {
    throw serviceError("Recovery must revoke prior security access before issuing a new key.", {
      status: 403, code: "security-recovery-not-ready", source: "worker"
    });
  }
  const updateTime=String(recoveryRecord._updateTime||"").trim();
  if(!updateTime || !Number.isFinite(Date.parse(updateTime))){
    throw serviceError("Recovery version could not be verified.",{
      status:503,code:"security-recovery-version-missing",source:"firebase"
    });
  }
  // A replacement key is disclosed only if both its secure hash and the audit
  // event were committed together. An Activity outage cannot strand the admin
  // with a key already changed but never displayed.
  const eventId=securityRandomId(18);
  const writes=[
    {
      update:{
        name:firestoreDocumentName(env,SECURITY_COLLECTIONS.recovery,uid),
        fields:firestoreFields(replacementRecord)
      },
      currentDocument:{updateTime}
    },
    {
      update:{
        name:firestoreDocumentName(env,SECURITY_COLLECTIONS.events,eventId),
        fields:firestoreFields({
          uid,type:"recovery-reset-complete",success:true,sessionId:"",
          deviceId:"",summary:"Fresh security bootstrap and Recovery Kit required.",
          ip:"",createdAt:new Date().toISOString()
        })
      },
      currentDocument:{exists:false}
    }
  ];
  try{
    await firestoreAdminCommit(env,writes);
  }catch(error){
    if(error?.code==="firestore-precondition-failed"){
      throw serviceError("Recovery state changed; the previous challenge is no longer valid.",{
        status:409,code:"security-recovery-state-changed",source:"worker"
      });
    }
    throw error;
  }
  return {eventId};
}

async function securityQuery(env,collection,filters=[],limit=100,offset=0){
  const token=await firebaseAdminAccessToken(env),projectId=firestoreProjectId(env); const fieldFilters=filters.map(([field,op,value])=>({fieldFilter:{field:{fieldPath:field},op,value:firestoreValue(value)}}));
  const structuredQuery={from:[{collectionId:collection}],limit,...(offset?{offset}:{})}; if(fieldFilters.length===1) structuredQuery.where=fieldFilters[0]; else if(fieldFilters.length>1) structuredQuery.where={compositeFilter:{op:'AND',filters:fieldFilters}};
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery})});
  const payload=await response.json().catch(()=>[]); if(!response.ok) throw serviceError('Security records could not be queried.',{status:502,code:'security-firestore-query',source:'firebase'}); return payload.map(x=>fromFirestoreDoc(x.document)).filter(Boolean);
}
// Destructive operations must enumerate the complete server-side set, never
// silently accept a UI-sized query limit as proof that all access was revoked.
async function securityQueryAll(env,collection,filters=[]){
  const pageSize=200,maxRecords=10000,records=[];
  for(let offset=0;offset<=maxRecords;offset+=pageSize){
    const page=await securityQuery(env,collection,filters,pageSize,offset);
    records.push(...page);
    if(page.length<pageSize)return records;
  }
  throw serviceError('Too many security records to safely finish revocation.',{
    status:503,code:'security-revocation-set-too-large',source:'firebase'
  });
}
async function writeSecurityEvent(env,event,{context=null,alertOrigin=''}={}){
  const eventId=securityRandomId(18),now=new Date().toISOString();
  await securityWriteDoc(env,SECURITY_COLLECTIONS.events,eventId,{uid:event.uid||'',type:event.type||'security-event',success:event.success!==false,sessionId:event.sessionId||'',deviceId:event.deviceId||'',summary:String(event.summary||'').slice(0,280),ip:String(event.ip||'').slice(0,96),createdAt:now});
  if(event.alert!==false && event.success!==false){
    const deliver=async()=>{
      try{
        const result=await dispatchSecurityAlerts(env,event,{alertOrigin});
        const push=result?.push||{};
        await securityPatchDoc(env,SECURITY_COLLECTIONS.events,eventId,{alertPushState:String(push.state||'unknown'),alertPushSubscriptions:Number(push.subscriptions||0),alertPushAccepted:Number(push.accepted||0),alertPushDelivered:Number(push.delivered||0),alertPushFailed:Number(push.failed||0),alertPushStale:Number(push.stale||0),alertEmailState:String(result?.email?.state||'unknown')}).catch(()=>null);
        return result;
      }catch(error){
        console.error('Security alert dispatch failed:',error);
        await securityPatchDoc(env,SECURITY_COLLECTIONS.events,eventId,{alertPushState:'failed',alertEmailState:'failed'}).catch(()=>null);
        return null;
      }
    };
    if(context?.waitUntil) context.waitUntil(deliver()); else await deliver();
  }
  return eventId;
}

async function verifyAuthorizedAdminUid(uid,env){ const record=await firestoreAdminGetDocument(env,'authorizedAdministrators',uid); if(record?.fields?.active?.booleanValue!==true) throw serviceError('Administrator access is required.',{status:403,code:'firebase-permission-denied',source:'firebase'}); return true; }
async function identityToolkit(path,body,env,version='v1'){ const key=String(env.FIREBASE_WEB_API_KEY||'').trim(); if(!key) throw serviceError('FIREBASE_WEB_API_KEY is not configured.',{status:503,code:'firebase-config',source:'firebase'}); const apiVersion=version==='v2'?'v2':'v1'; const response=await fetch(`https://identitytoolkit.googleapis.com/${apiVersion}/${path}?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const payload=await response.json().catch(()=>({})); return {response,payload}; }
function mfaRequiredData(payload){ const details=payload?.error?.details; const detail=Array.isArray(details)?details.find(x=>x?.mfaPendingCredential):details; return {mfaPendingCredential:payload?.mfaPendingCredential||detail?.mfaPendingCredential||'',mfaInfo:payload?.mfaInfo||detail?.mfaInfo||[]}; }
async function verifyFirebasePassword(email,password,env){
  const {response,payload}=await identityToolkit('accounts:signInWithPassword',{email:String(email||'').trim(),password:String(password||''),returnSecureToken:true},env);
  const mfa=mfaRequiredData(payload); if(!response.ok && String(payload?.error?.message||'')!=='MFA_REQUIRED') throw serviceError('Email or password is incorrect.',{status:401,code:'security-password-invalid',source:'firebase'});
  if(!response.ok && !mfa.mfaPendingCredential) throw serviceError('Multi-factor sign-in could not be started.',{status:401,code:'security-mfa-start-failed',source:'firebase'});
  let uid=String(payload?.localId||mfa?.mfaInfo?.[0]?.uid||''),resolvedEmail=String(payload?.email||email||''),emailVerified=false;
  if(payload?.idToken){ const account=await verifyFirebaseIdToken(payload.idToken,env); uid=account.uid||uid; resolvedEmail=account.email||resolvedEmail; emailVerified=account.emailVerified===true; }
  else if(uid) await verifyAuthorizedAdminUid(uid,env);
  return {uid,email:resolvedEmail,emailVerified,idToken:payload?.idToken||'',mfaPendingCredential:mfa.mfaPendingCredential,mfaInfo:mfa.mfaInfo};
}
async function verifyFirebaseIdToken(idToken,env){
  const {response,payload}=await identityToolkit('accounts:lookup',{idToken:String(idToken||'')},env); if(!response.ok || !payload?.users?.[0]) throw serviceError('Firebase session is invalid.',{status:401,code:'firebase-unauthenticated',source:'firebase'}); const user=payload.users[0]; await verifyAuthorizedAdminUid(user.localId,env); return {uid:user.localId,email:user.email||'',emailVerified:user.emailVerified===true,user};
}
async function mintSecurityCustomToken({uid,sessionId,trustLevel,deviceId=''},env){
  const clientEmail=String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL||'').trim(),privateKeyPem=String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY||'').trim(); if(!clientEmail||!privateKeyPem) throw serviceError('Firebase service-account signing credentials are not configured.',{status:503,code:'security-signing-config',source:'firebase'});
  const now=Math.floor(Date.now()/1000),header=base64Url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),claims={lanSecurityVerified:true,lanSessionId:sessionId,lanTrustLevel:trustLevel,...(deviceId?{lanDeviceId:deviceId}:{})};
  const payload=base64Url(new TextEncoder().encode(JSON.stringify({iss:clientEmail,sub:clientEmail,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid,claims}))),unsigned=`${header}.${payload}`;
  const key=await crypto.subtle.importKey('pkcs8',pemPrivateKeyBytes(privateKeyPem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']); const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned)); return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}
async function exchangeCustomToken(customToken,env){ const {response,payload}=await identityToolkit('accounts:signInWithCustomToken',{token:customToken,returnSecureToken:true},env); if(!response.ok||!payload?.idToken) throw serviceError('Security-approved Firebase session could not be created.',{status:502,code:'security-custom-token-exchange',source:'firebase'}); return payload; }
async function createSecuritySession(env,{uid,trustLevel='temporary',deviceId='',userAgent='',ip=''}){ const sessionId=securityRandomId(24),now=Date.now(),normalizedTrust=trustLevel==='trusted'?'trusted':'temporary',normalizedDeviceId=normalizedTrust==='trusted'?String(deviceId||''):'',ttl=SECURITY_LIFETIMES[normalizedTrust]||SECURITY_LIFETIMES.temporary,expiresAt=new Date(now+ttl*1000).toISOString(); const record={sessionId,uid,trustLevel:normalizedTrust,deviceId:normalizedDeviceId,active:true,createdAt:new Date(now),lastActivityAt:new Date(now),expiresAt:new Date(now+ttl*1000),userAgent:String(userAgent||'').slice(0,240),ip:String(ip||'').slice(0,96)}; await securityWriteDoc(env,SECURITY_COLLECTIONS.sessions,sessionId,record); return record; }
function activeTrustedDeviceIds(devices){ return new Set((devices||[]).filter(device=>device?.active===true).map(device=>String(device?.deviceId||'')).filter(Boolean)); }
function effectiveSecuritySessionTrustLevel(session,activeDeviceIds){ const deviceId=String(session?.deviceId||''); return session?.trustLevel==='trusted'&&Boolean(deviceId)&&activeDeviceIds.has(deviceId)?'trusted':'temporary'; }
function serializeSecuritySessions(sessions,currentSessionId,devices){ const activeDeviceIds=activeTrustedDeviceIds(devices); return (sessions||[]).map(session=>({...session,trustLevel:effectiveSecuritySessionTrustLevel(session,activeDeviceIds),current:session.sessionId===currentSessionId})); }
async function buildSecurityAccessState(admin,env){ const [devices,sessions]=await Promise.all([securityQuery(env,SECURITY_COLLECTIONS.devices,[['uid','EQUAL',admin.uid]],100),securityQuery(env,SECURITY_COLLECTIONS.sessions,[['uid','EQUAL',admin.uid]],200)]); const currentDevice=devices.find(device=>device.deviceId===admin.session.deviceId); return {devices:devices.map(({publicKeyJwk,_updateTime,...device})=>({...device,current:device.deviceId===admin.session.deviceId})),sessions:serializeSecuritySessions(sessions,admin.session.sessionId,devices),capabilities:{securityManagement:canManageTrustedSecurity(admin,currentDevice)}}; }
async function canonicalizeActiveSecuritySessionTrust(uid,session,env){
  if(session?.trustLevel!=='trusted')return {...session,trustLevel:'temporary',deviceId:''};
  const deviceId=String(session?.deviceId||'');
  const device=deviceId?await securityGetDoc(env,SECURITY_COLLECTIONS.devices,deviceId):null;
  if(device && device.uid===uid && device.active===true)return session;
  // Revocation must invalidate the existing session, not silently convert
  // its signed-in Firebase token into a still-authorized temporary session.
  throw serviceError('Administrator security session has expired or was revoked.',{
    status:401,code:'security-session-expired',source:'worker'
  });
}
async function requireActiveSecuritySession(uid,sessionId,env){ const s=await securityGetDoc(env,SECURITY_COLLECTIONS.sessions,sessionId); if(!s||s.uid!==uid||s.active!==true||Date.parse(s.expiresAt)<=Date.now()) throw serviceError('Administrator security session has expired or was revoked.',{status:401,code:'security-session-expired',source:'worker'}); return canonicalizeActiveSecuritySessionTrust(uid,s,env); }
async function requireSecurityApprovedAdministrator(request,env,{trustLevels=null,allowLockdown=false}={}){
  const match=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i);
  if(!match) throw serviceError('Administrator security session is required.',{status:401,code:'firebase-unauthenticated',source:'firebase'});
  const token=match[1],decoded=decodeJwtPayload(token);
  const uid=String(decoded?.user_id||decoded?.sub||'').trim(),sessionId=String(decoded?.lanSessionId||'').trim();
  if(!uid || decoded?.lanSecurityVerified!==true || !sessionId) throw serviceError('Password-only Firebase sessions cannot access Admin resources.',{status:403,code:'security-session-required',source:'worker'});
  // Firestore verifies the Firebase JWT cryptographically and the Rules require
  // this exact lanSessionId to resolve to an active, unexpired backend session.
  const projectId=firestoreProjectId(env);
  const proof=await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/authorizedAdministrators/${encodeURIComponent(uid)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  if(!proof.ok){ const status=proof.status===401?401:403; throw serviceError('Administrator security session could not be verified.',{status,code:status===401?'firebase-unauthenticated':'security-session-expired',source:'firebase'}); }
  const record=await proof.json().catch(()=>({}));
  if(record?.fields?.active?.booleanValue!==true) throw serviceError('Administrator access is required.',{status:403,code:'firebase-permission-denied',source:'firebase'});
  // Firestore Rules are a second enforcement layer, not the Worker session owner.
  // Every protected Worker request re-checks the authoritative backend session
  // record so a revoke takes effect even if the browser still holds a valid
  // Firebase ID token or deployed Rules lag behind the local Worker build.
  const session=await requireActiveSecuritySession(uid,sessionId,env);
  if(trustLevels&&!trustLevels.includes(String(session.trustLevel||'temporary'))) throw serviceError('This security session cannot perform that operation.',{status:403,code:'security-session-scope',source:'worker'});
  const securityState=await securityGetDoc(env,'adminSecurityState',uid);
  if(securityState?.lockdown===true && !allowLockdown) throw serviceError('Security Lockdown is active. Use the Security & Access recovery controls to exit lockdown.',{status:423,code:'security-lockdown-active',source:'worker'});
  return {uid,email:String(decoded?.email||''),session,token};
}
async function verifyStepUp(uid,sessionId,proofId,env){ const p=await securityGetDoc(env,SECURITY_COLLECTIONS.stepUps,String(proofId||'')); if(!p||p.uid!==uid||p.sessionId!==sessionId||p.active!==true||Date.parse(p.expiresAt)<=Date.now()) throw serviceError('Recent password + authenticator verification is required.',{status:403,code:'security-step-up-required',source:'worker'}); return p; }
function canManageTrustedSecurity(admin,device){ return admin?.session?.trustLevel==='trusted'&&Boolean(admin?.session?.deviceId)&&device?.deviceId===admin.session.deviceId&&device?.uid===admin.uid&&device?.active===true; }
async function requireTrustedSecurityManagement(admin,env){ const device=admin?.session?.deviceId?await securityGetDoc(env,SECURITY_COLLECTIONS.devices,admin.session.deviceId):null; if(!canManageTrustedSecurity(admin,device)) throw serviceError('A trusted device session is required to manage trusted devices or other Admin sessions.',{status:403,code:'security-trusted-session-required',source:'worker'}); return device; }
function sameEnrollmentPublicKey(expected,actual){ return ['kty','crv','x','y'].every(field=>String(expected?.[field]||'')===String(actual?.[field]||'')); }
async function promoteSecuritySessionToTrusted(admin,deviceId,env){
  const now=Date.now(),expiresAt=new Date(now+SECURITY_LIFETIMES.trusted*1000);
  const session={...admin.session,trustLevel:'trusted',deviceId,lastActivityAt:new Date(now),expiresAt};
  const customToken=await mintSecurityCustomToken({uid:admin.uid,sessionId:admin.session.sessionId,trustLevel:'trusted',deviceId},env);
  await securityPatchDoc(env,SECURITY_COLLECTIONS.sessions,admin.session.sessionId,{trustLevel:'trusted',deviceId,lastActivityAt:new Date(now),expiresAt});
  return {customToken,session};
}

// This migration is part of the canonical trusted-device registration owner.
// Existing active devices retain their trust and identity; we only backfill
// server-owned uniqueness claims. Never auto-enroll, un-revoke, or erase a key.
// Interrupted migration can run again safely because each claim is verified.
async function migrateHistoricalTrustedDeviceClaims(env,uid,devices,epoch){
  if(devices.length>=100){
    throw serviceError("Too many device records for a complete security migration.",{
      status:503,code:"security-device-migration-required",source:"worker"
    });
  }
  const active=devices.filter(device=>device.active===true);
  const candidates=[],unique=new Set();
  for(const device of active){
    const jwk=device.publicKeyJwk;
    if(device.uid!==uid || !device.deviceId ||
        jwk?.kty!=="EC" || jwk?.crv!=="P-256" ||
        typeof jwk.x!=="string" || !jwk.x ||
        typeof jwk.y!=="string" || !jwk.y){
      throw serviceError("A historical trusted device needs verified security migration.",{
        status:503,code:"security-device-migration-required",source:"worker"
      });
    }
    const credentialId=await sha256Text(JSON.stringify([
      jwk.kty,jwk.crv,jwk.x,jwk.y
    ]));
    if(unique.has(credentialId)){
      throw serviceError("Existing trusted devices share a cryptographic key.",{
        status:409,code:"security-device-credential-duplicate",source:"worker"
      });
    }
    unique.add(credentialId);
    candidates.push({deviceId:device.deviceId,credentialId});
  }

  for(const candidate of candidates){
    let claim=await securityGetDoc(env,"adminSecurityDeviceCredentials",candidate.credentialId);
    if(!claim){
      try{
        await firestoreAdminCommit(env,[{
          update:{
            name:firestoreDocumentName(env,"adminSecurityDeviceCredentials",candidate.credentialId),
            fields:firestoreFields({
              uid,deviceId:candidate.deviceId,
              migratedAt:new Date().toISOString()
            })
          },
          currentDocument:{exists:false}
        }]);
      }catch(error){
        if(error?.code!=="firestore-precondition-failed")throw error;
      }
      claim=await securityGetDoc(env,"adminSecurityDeviceCredentials",candidate.credentialId);
    }
    if(!claim || claim.uid!==uid || claim.deviceId!==candidate.deviceId){
      throw serviceError("Trusted-device credential claim is inconsistent.",{
        status:409,code:"security-device-credential-duplicate",source:"worker"
      });
    }
  }

  if(devices.length>0 && !epoch){
    const markerId=await sha256Text(uid+"|trusted-device-bootstrap|initial");
    let marker=await securityGetDoc(env,"adminSecurityDeviceBootstrap",markerId);
    if(!marker){
      try{
        await firestoreAdminCommit(env,[{
          update:{
            name:firestoreDocumentName(env,"adminSecurityDeviceBootstrap",markerId),
            fields:firestoreFields({
              uid,epoch:"initial",deviceId:devices[0].deviceId,
              migratedAt:new Date().toISOString()
            })
          },
          currentDocument:{exists:false}
        }]);
      }catch(error){
        if(error?.code!=="firestore-precondition-failed")throw error;
      }
      marker=await securityGetDoc(env,"adminSecurityDeviceBootstrap",markerId);
    }
    if(!marker || marker.uid!==uid || marker.epoch!=="initial"){
      throw serviceError("First trusted-device bootstrap claim is inconsistent.",{
        status:409,code:"security-device-migration-required",source:"worker"
      });
    }
  }
}

// The initial trusted-device claim and the device document must become visible
// in ONE Firestore commit. The marker's exists:false precondition ensures that
// two independent QR challenges cannot both initialize the same security epoch.
// The epoch changes ONLY after an authenticated emergency recovery or an
// explicitly verified TOTP reset, never when all devices are merely revoked.
async function completeTrustedDeviceEnrollment(request,env,admin,body){
  const deviceId=String(body.deviceId||'');
  const [existingDevices,recovery]=await Promise.all([
    securityQuery(env,SECURITY_COLLECTIONS.devices,[['uid','EQUAL',admin.uid]],100),
    securityGetDoc(env,SECURITY_COLLECTIONS.recovery,admin.uid)
  ]);
  const epoch=String(recovery?.deviceBootstrapEpoch||'');
  // Historical devices from older builds must never reopen unapproved first
  // enrollment. A new epoch exists only after a verified security reset.
  const requiresApproval=existingDevices.some(device=>device.active===true) ||
    (existingDevices.length>0 && !epoch);
  const enrollment=await consumeSecurityEnrollmentChallenge(
    env,body.challengeId,admin.uid,deviceId,body.publicKeyJwk,requiresApproval
  );
  if(String(enrollment.deviceBootstrapEpoch||'')!==epoch){
    throw serviceError('Trusted-device enrollment was invalidated by a security reset.',{
      status:403,code:'security-enrollment-epoch-changed',source:'worker'
    });
  }
  // Enforce one cryptographic keypair per registered device. This check covers
  // devices created before the credential-claim collection was introduced.
  // The atomic claim below covers simultaneous new registrations.
  if(existingDevices.some(device =>
      sameEnrollmentPublicKey(device.publicKeyJwk,enrollment.publicKeyJwk))){
    throw serviceError('A device with this public key is already registered.',{
      status:409,code:'security-device-credential-duplicate',source:'worker'
    });
  }
  // Protect existing devices during migration without introducing a second
  // state owner or trusting browser-supplied migration data.
  await migrateHistoricalTrustedDeviceClaims(env,admin.uid,existingDevices,epoch);
  if(enrollment.approved===true){
    // Revoking the approving device also revokes its outstanding approvals.
    const approverId=String(enrollment.approvedByDeviceId||'');
    const approver=approverId
      ? await securityGetDoc(env,SECURITY_COLLECTIONS.devices,approverId) : null;
    if(!approver||approver.uid!==admin.uid||approver.active!==true){
      throw serviceError('The approving trusted device is no longer active.',{
        status:403,code:'security-enrollment-approver-revoked',source:'worker'
      });
    }
  }
  const now=new Date().toISOString();
  const record={
    deviceId,uid:admin.uid,publicKeyJwk:enrollment.publicKeyJwk,
    displayName:String(body.displayName||'Trusted device').slice(0,80),
    browserSummary:String(request.headers.get('User-Agent')||'').slice(0,180),
    active:true,createdAt:now,lastUsedAt:now
  };
  const writes=[];
  if(enrollment.approved!==true){
    const markerId=await sha256Text(admin.uid+'|trusted-device-bootstrap|'+(epoch||'initial'));
    writes.push({
      update:{
        name:firestoreDocumentName(env,'adminSecurityDeviceBootstrap',markerId),
        fields:firestoreFields({uid:admin.uid,epoch:epoch||'initial',deviceId,createdAt:now})
      },
      currentDocument:{exists:false}
    });
  }
  // Key identity is hashed server-side; no credential/public-key material is
  // written to the uniqueness index. The index is never released on revoke.
  const credentialId=await sha256Text(JSON.stringify([
    record.publicKeyJwk.kty,record.publicKeyJwk.crv,
    record.publicKeyJwk.x,record.publicKeyJwk.y
  ]));
  writes.push({
    update:{
      name:firestoreDocumentName(env,'adminSecurityDeviceCredentials',credentialId),
      fields:firestoreFields({uid:admin.uid,deviceId,createdAt:now})
    },
    currentDocument:{exists:false}
  });
  writes.push({
    update:{
      name:firestoreDocumentName(env,SECURITY_COLLECTIONS.devices,deviceId),
      fields:firestoreFields(record)
    },
    currentDocument:{exists:false}
  });
  try{
    await firestoreAdminCommit(env,writes);
  }catch(error){
    if(error?.code==='firestore-precondition-failed'){
      throw serviceError('Trusted-device bootstrap was already used, or this device ID exists.',{
        status:409,
        code:enrollment.approved===true
          ?'security-device-credential-duplicate'
          :'security-device-bootstrap-already-used',
        source:'worker'
      });
    }
    throw error;
  }
  const promoted=await promoteSecuritySessionToTrusted(admin,deviceId,env);
  await writeSecurityEvent(env,{uid:admin.uid,type:'trusted-device-enrolled',
    deviceId,success:true,sessionId:promoted.session.sessionId});
  return {ok:true,deviceId,customToken:promoted.customToken,session:promoted.session};
}

async function createApprovedSessionResponse(request,env,{uid,trustLevel,deviceId=''},context=null){ const session=await createSecuritySession(env,{uid,trustLevel,deviceId,userAgent:request.headers.get('User-Agent')||'',ip:securityIp(request)}); const customToken=await mintSecurityCustomToken({uid,sessionId:session.sessionId,trustLevel,deviceId},env); const type=trustLevel==='temporary'?'new-temporary-login':'login-success'; await writeSecurityEvent(env,{uid,type,success:true,sessionId:session.sessionId,deviceId,ip:securityIp(request),summary:`${trustLevel} administrator session created`},{context,alertOrigin:new URL(request.url).origin}); return {customToken,session}; }

async function verifyDeviceSignature(publicKeyJwk,nonce,signature){ try{ const key=await crypto.subtle.importKey('jwk',publicKeyJwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']); const normalized=String(signature||'').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(signature||'').length/4)*4,'='); const bytes=Uint8Array.from(atob(normalized),c=>c.charCodeAt(0)); return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes,new TextEncoder().encode(nonce)); }catch{return false;} }
async function recoveryHmac(value,env){ const pepper=String(env.SECURITY_RECOVERY_PEPPER||''); if(!pepper) throw serviceError('SECURITY_RECOVERY_PEPPER is not configured.',{status:503,code:'security-recovery-config',source:'worker'}); const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']); return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(String(value||'').trim())))); }
function recoveryKey(){ const bytes=new Uint8Array(32); crypto.getRandomValues(bytes); const token=base64Url(bytes).toUpperCase(); return token.match(/.{1,6}/g).join('-'); }
function backupCode(){ const b=new Uint8Array(8); crypto.getRandomValues(b); return base64Url(b).toUpperCase().slice(0,12).match(/.{1,4}/g).join('-'); }
// One backend-only batch writer for all destructive device/session revocation.
async function revokeSecurityDocuments(env,records){
  const ids=records.map(({collection,id})=>({
    collection,id:String(id||'').trim()
  }));
  if(ids.some(({id})=>!id))throw serviceError('Security revocation identity is incomplete.',{
    status:503,code:'security-revocation-record-invalid',source:'worker'
  });
  const fields=firestoreFields({active:false,revokedAt:new Date().toISOString()});
  const writes=ids.map(({collection,id})=>({
    update:{name:firestoreDocumentName(env,collection,id),fields},
    updateMask:{fieldPaths:['active','revokedAt']},
    currentDocument:{exists:true}
  }));
  // A Firestore commit supports at most 500 writes. Partial batch failures
  // leave the operation retryable; a caller must not report success.
  for(let start=0;start<writes.length;start+=450)
    await firestoreAdminCommit(env,writes.slice(start,start+450));
}
async function revokeUserSecurityState(uid,env){
  // Never confuse truncated management lists with complete security records.
  const [sessions,devices]=await Promise.all([
    securityQueryAll(env,SECURITY_COLLECTIONS.sessions,[['uid','EQUAL',uid]]),
    securityQueryAll(env,SECURITY_COLLECTIONS.devices,[['uid','EQUAL',uid]])
  ]);
  await revokeSecurityDocuments(env,[
    ...sessions.map(s=>({collection:SECURITY_COLLECTIONS.sessions,id:s.sessionId})),
    ...devices.map(d=>({collection:SECURITY_COLLECTIONS.devices,id:d.deviceId}))
  ]);
}


const SECURITY_REQUEST_SCHEMAS = Object.freeze({
  "/security/login/password": { email: REQUEST_SCHEMA_ANY, password: REQUEST_SCHEMA_ANY, deviceId: REQUEST_SCHEMA_ANY },
  "/security/login/totp": { challengeId: REQUEST_SCHEMA_ANY, code: REQUEST_SCHEMA_ANY },
  "/security/totp/enrollment/start": { email: REQUEST_SCHEMA_ANY, password: REQUEST_SCHEMA_ANY },
  "/security/totp/enrollment/complete": { challengeId: REQUEST_SCHEMA_ANY, code: REQUEST_SCHEMA_ANY, displayName: REQUEST_SCHEMA_ANY },
  "/security/email-verification/send": { email: REQUEST_SCHEMA_ANY, password: REQUEST_SCHEMA_ANY },
  "/security/device/login-complete": { challengeId: REQUEST_SCHEMA_ANY, deviceId: REQUEST_SCHEMA_ANY, signature: REQUEST_SCHEMA_ANY },
  "/security/recovery/start": { email: REQUEST_SCHEMA_ANY, password: REQUEST_SCHEMA_ANY, recoveryKey: REQUEST_SCHEMA_ANY },
  "/security/recovery/prepare": { recoverySessionId: REQUEST_SCHEMA_ANY },
  "/security/recovery/rotate/activate": { rotationId: REQUEST_SCHEMA_ANY, preparedKitId: REQUEST_SCHEMA_ANY, proofId: REQUEST_SCHEMA_ANY },
  "/security/recovery/complete": { recoverySessionId: REQUEST_SCHEMA_ANY, preparedKitId: REQUEST_SCHEMA_ANY, newEmail: REQUEST_SCHEMA_ANY },
  "/security/recovery/status": { recoverySessionId: REQUEST_SCHEMA_ANY, preparedKitId: REQUEST_SCHEMA_ANY },
  "/security/session/end": {},
  "/security/step-up/start": { password: REQUEST_SCHEMA_ANY },
  "/security/step-up/complete": { challengeId: REQUEST_SCHEMA_ANY, code: REQUEST_SCHEMA_ANY },
  "/security/device/enrollment/create": { proofId: REQUEST_SCHEMA_ANY, deviceId: REQUEST_SCHEMA_ANY, publicKeyJwk: PUBLIC_KEY_JWK_SCHEMA },
  "/security/device/enrollment/status": { challengeId: REQUEST_SCHEMA_ANY },
  "/security/device/enrollment/approve": { challengeId: REQUEST_SCHEMA_ANY, proofId: REQUEST_SCHEMA_ANY },
  "/security/device/enrollment/complete": { challengeId: REQUEST_SCHEMA_ANY, deviceId: REQUEST_SCHEMA_ANY, publicKeyJwk: PUBLIC_KEY_JWK_SCHEMA, displayName: REQUEST_SCHEMA_ANY },
  "/security/device/rename": { deviceId: REQUEST_SCHEMA_ANY, displayName: REQUEST_SCHEMA_ANY },
  "/security/device/revoke": { deviceId: REQUEST_SCHEMA_ANY, proofId: REQUEST_SCHEMA_ANY },
  "/security/account/password": { proofId: REQUEST_SCHEMA_ANY, newPassword: REQUEST_SCHEMA_ANY },
  "/security/totp/reset": { proofId: REQUEST_SCHEMA_ANY },
  "/security/recovery/generate": { proofId: REQUEST_SCHEMA_ANY },
  "/security/session/revoke": { sessionId: REQUEST_SCHEMA_ANY },
  "/security/session/revoke-others": { proofId: REQUEST_SCHEMA_ANY },
  "/security/session/revoke-temporary": { proofId: REQUEST_SCHEMA_ANY },
  "/security/email-branding": { branding: SECURITY_BRANDING_SCHEMA },
  "/security/lockdown/enter": { proofId: REQUEST_SCHEMA_ANY },
  "/security/lockdown/exit": { proofId: REQUEST_SCHEMA_ANY }
});

async function handleSecurityRoute(request,env,url,context){
  const origin=allowedOrigin(request.headers.get('Origin')||'',env); if(!origin) return json({error:'Origin is not allowed.',code:'origin-not-allowed'},403);
  try{
    const path=url.pathname,method=request.method,body=method==='GET'?{}:await readStrictJsonBody(request,SECURITY_REQUEST_SCHEMAS[path]||{});
    if(path==='/security/login/password'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'password');
      let first;
      try { first=await verifyFirebasePassword(body.email,body.password,env); }
      catch(error){ await writeSecurityEvent(env,{type:'login-failure',success:false,ip:securityIp(request),summary:'Administrator password login rejected.'}).catch(()=>null); throw error; }
      const loginState=await securityGetDoc(env,'adminSecurityState',first.uid);
      if(loginState?.lockdown===true) throw serviceError('Security Lockdown is active. Use emergency recovery or an existing verified session to exit lockdown.',{status:423,code:'security-lockdown-active',source:'worker'});
      if(first.uid && body.deviceId){ const device=await securityGetDoc(env,SECURITY_COLLECTIONS.devices,String(body.deviceId)); if(device?.uid===first.uid&&device?.active===true){ const nonce=securityRandomId(32),challengeId=await putSecurityChallenge(env,'device-login',{uid:first.uid,deviceId:device.deviceId,nonce}); const fallbackChallengeId=first.mfaPendingCredential?await putSecurityChallenge(env,'totp-login',{uid:first.uid,mfaPendingCredential:first.mfaPendingCredential,mfaInfo:first.mfaInfo}):''; return json({state:'trusted-device-challenge',challenge:{challengeId,deviceId:device.deviceId,nonce},fallbackChallengeId},200,origin); } }
      if(first.mfaPendingCredential){ const challengeId=await putSecurityChallenge(env,'totp-login',{uid:first.uid,mfaPendingCredential:first.mfaPendingCredential,mfaInfo:first.mfaInfo}); await clearSecurityRateLimit(request,env,'password'); return json({state:'totp-required',challengeId},200,origin); }
      if(!first.emailVerified) return json({state:'email-verification-required'},200,origin);
      const challengeId=await putSecurityChallenge(env,'totp-bootstrap',{uid:first.uid,idToken:first.idToken,email:first.email}); return json({state:'totp-enrollment-required',challengeId},200,origin);
    }
    if(path==='/security/login/totp'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'totp'); const c=await consumeSecurityChallenge(env,'totp-login',body.challengeId); const enrollmentId=String(c.mfaInfo?.find?.(x=>x?.totpInfo)?.mfaEnrollmentId||c.mfaInfo?.[0]?.mfaEnrollmentId||''); const {response,payload}=await identityToolkit('accounts/mfaSignIn:finalize',{mfaPendingCredential:c.mfaPendingCredential,mfaEnrollmentId:enrollmentId,totpVerificationInfo:{verificationCode:String(body.code||'')}},env,'v2'); if(!response.ok||!payload?.idToken){ await writeSecurityEvent(env,{uid:c.uid,type:'totp-failure',success:false,ip:securityIp(request)}); throw serviceError('Authenticator code is invalid or expired.',{status:401,code:'security-totp-invalid',source:'firebase'}); } const verified=await verifyFirebaseIdToken(payload.idToken,env); await clearSecurityRateLimit(request,env,'totp'); return json(await createApprovedSessionResponse(request,env,{uid:verified.uid,trustLevel:'temporary'},context),200,origin);
    }
    if(path==='/security/totp/enrollment/start'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'enrollment'); const first=await verifyFirebasePassword(body.email||'',body.password,env); if(!first.uid||!first.idToken) throw serviceError('A password-verified non-MFA Firebase session is required for bootstrap.',{status:400,code:'security-bootstrap-state',source:'firebase'}); if(!first.emailVerified) throw serviceError('Verify the administrator email before enrolling an authenticator.',{status:403,code:'security-email-unverified',source:'firebase'}); const {response,payload}=await identityToolkit('accounts/mfaEnrollment:start',{idToken:first.idToken,totpEnrollmentInfo:{}},env,'v2'); if(!response.ok) throw serviceError('Authenticator enrollment could not be started.',{status:502,code:'security-totp-enrollment-start',source:'firebase'}); const info=payload?.totpSessionInfo||payload?.totpEnrollmentInfo||payload; const secret=String(info?.sharedSecretKey||''); const sessionInfo=String(info?.sessionInfo||payload?.sessionInfo||''); const challengeId=await putSecurityChallenge(env,'totp-enroll',{uid:first.uid,idToken:first.idToken,sessionInfo,secret}); const issuer=encodeURIComponent('LΛN Portfolio CMS'),account=encodeURIComponent(first.email||'Admin'); return json({challengeId,manualSecret:secret,totpUri:`otpauth://totp/${issuer}:${account}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&digits=6&period=30`},200,origin);
    }
    if(path==='/security/totp/enrollment/complete'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'enrollment');
      const c=await consumeSecurityChallenge(env,'totp-enroll',body.challengeId);
      const {response,payload}=await identityToolkit('accounts/mfaEnrollment:finalize',{idToken:c.idToken,displayName:String(body.displayName||'Authenticator').slice(0,60),totpVerificationInfo:{sessionInfo:c.sessionInfo,verificationCode:String(body.code||'')}},env,'v2');
      if(!response.ok||!payload?.idToken) throw serviceError('Authenticator code was not accepted.',{status:400,code:'security-totp-enrollment-invalid',source:'firebase'});
      const verified=await verifyFirebaseIdToken(payload.idToken,env);
      if(verified.uid!==c.uid) throw serviceError('Authenticator enrollment identity changed unexpectedly.',{status:403,code:'security-totp-enrollment-identity',source:'worker'});
      await clearSecurityRateLimit(request,env,'enrollment');
      await writeSecurityEvent(env,{uid:c.uid,type:'totp-enrolled',success:true,ip:securityIp(request)});
      return json(await createApprovedSessionResponse(request,env,{uid:verified.uid,trustLevel:'temporary'},context),200,origin);
    }
    if(path==='/security/email-verification/send'&&method==='POST'){ const first=await verifyFirebasePassword(body.email||'',body.password,env); if(!first.idToken) throw serviceError('Email verification requires a password-only bootstrap state.',{status:400,code:'security-email-verification-state'}); const {response}=await identityToolkit('accounts:sendOobCode',{requestType:'VERIFY_EMAIL',idToken:first.idToken},env); if(!response.ok) throw serviceError('Verification email could not be requested.',{status:502,code:'security-email-verification-send'}); return json({ok:true},200,origin); }
    if(path==='/security/device/login-complete'&&method==='POST'){ await enforceSecurityRateLimit(request,env,'device-proof'); const c=await consumeSecurityChallenge(env,'device-login',body.challengeId); if(c.deviceId!==String(body.deviceId||'')) throw serviceError('Device challenge does not match.',{status:403,code:'security-device-proof-invalid'}); const device=await securityGetDoc(env,SECURITY_COLLECTIONS.devices,c.deviceId); if(!device||device.uid!==c.uid||device.active!==true||!await verifyDeviceSignature(device.publicKeyJwk,c.nonce,body.signature)){ await writeSecurityEvent(env,{uid:c.uid,type:'device-proof-failure',success:false,deviceId:c.deviceId,ip:securityIp(request)}); throw serviceError('Trusted-device proof is invalid or revoked.',{status:403,code:'security-device-proof-invalid'}); } await securityPatchDoc(env,SECURITY_COLLECTIONS.devices,c.deviceId,{lastUsedAt:new Date().toISOString()}); await clearSecurityRateLimit(request,env,'device-proof'); return json(await createApprovedSessionResponse(request,env,{uid:c.uid,trustLevel:'trusted',deviceId:c.deviceId},context),200,origin); }

    if(path==='/security/recovery/start'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'recovery');
      const first=await verifyFirebasePassword(body.email,body.password,env);
      if(!first.uid) throw serviceError('Recovery requires the administrator password.',{status:401,code:'security-recovery-password'});
      const rec=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,first.uid);
      const digest=await recoveryHmac(body.recoveryKey,env);
      // The old key stays inactive after an interrupted reset. Resumption
      // requires the SAME Master Key plus a fresh Firebase password check,
      // is rate limited and may run only within a bounded server-side window.
      // Neither other keys nor a finished recovery may reopen the reset.
      const resumable=rec?.active===false;
      if(!rec || rec.masterKeyHash!==digest || (!resumable && rec.active!==true)){
        await writeSecurityEvent(env,{uid:first.uid,type:'recovery-attempt',success:false,ip:securityIp(request)}).catch(()=>null);
        throw serviceError('Recovery key is invalid.',{status:401,code:'security-recovery-key-invalid'});
      }
      const recoverySessionId=await putSecurityChallenge(env,'recovery',{uid:first.uid,email:first.email},SECURITY_LIFETIMES.recovery);
      await claimMasterRecoveryKey(env,first.uid,rec,recoverySessionId);
      try{
        // Both operations are idempotent: a failed reset can retry revoking
        // already-revoked sessions and clearing already-cleared MFA.
        await Promise.all([
          revokeUserSecurityState(first.uid,env),
          clearFirebaseMfaForRecovery(env,first.uid)
        ]);
        await finalizeRecoveryResetPreparation(env,first.uid,recoverySessionId,true);
      }catch(error){
        // Do not disclose an incomplete recovery challenge. Release the short
        // lease if possible; otherwise it expires after a Worker crash.
        await finalizeRecoveryResetPreparation(env,first.uid,recoverySessionId,false).catch(()=>null);
        throw serviceError('Security reset was interrupted. Retry using the same administrator password and Master Recovery Key.',{
          status:503,code:'security-recovery-interrupted',source:'worker'
        });
      }
      // An activity-email/provider outage must never turn an already-completed
      // reset into an unclaimable response. Capture audit failures separately.
      await writeSecurityEvent(env,{uid:first.uid,type:'recovery-used',success:true,ip:securityIp(request),summary:'Recovery key accepted; prior sessions, trusted devices, Firebase tokens, and MFA enrollment were invalidated.'}).catch(()=>null);
      return json({state:'recovery',recoverySessionId,expiresAt:new Date(Date.now()+SECURITY_LIFETIMES.recovery*1000).toISOString()},200,origin);
    }
    if(path==='/security/recovery/prepare'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'recovery-prepare',{limit:5,windowSeconds:900,cooldownSeconds:300});
      const id=String(body.recoverySessionId||'');
      const c=await readPendingRecoveryChallenge(env,id);
      const rec=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,c.uid);
      if(!rec || rec.active!==false || rec.pendingRecoverySessionId!==id ||
          rec.recoveryResetsComplete!==true) {
        throw serviceError('The security reset must finish before preparing a new Recovery Kit.',{
          status:403,code:'security-recovery-not-ready',source:'worker'
        });
      }
      const key=recoveryKey(),codes=Array.from({length:8},backupCode);
      const preparedKitId=securityRandomId(24);
      const prepared={
        preparedKitId,masterKeyHash:await recoveryHmac(key,env),
        backupCodeHashes:await Promise.all(codes.map(code=>recoveryHmac(code,env)))
      };
      // Only hashes and an opaque ID enter Durable Object state. This is the
      // sole plaintext display of this generated kit: no persistent secret.
      await savePreparedRecoveryKit(env,id,prepared);
      return json({
        state:'kit-prepared',preparedKitId,
        masterKey:key,backupCodes:codes,
        expiresAt:c.expiresAt
      },200,origin);
    }
    if(path==='/security/recovery/complete'&&method==='POST'){
      const id=String(body.recoverySessionId||'');
      const preparedKitId=String(body.preparedKitId||'');
      if(!/^[A-Za-z0-9_-]{20,90}$/.test(preparedKitId)){
        throw serviceError('Prepare and save the new Recovery Kit before activation.',{
          status:400,code:'security-recovery-kit-required',source:'worker'
        });
      }
      const c=await readPendingRecoveryChallenge(env,id);
      if(!c.prepared || c.prepared.preparedKitId!==preparedKitId) {
        throw serviceError('Prepared Recovery Kit does not match this recovery session.',{
          status:403,code:'security-recovery-kit-mismatch',source:'worker'
        });
      }
      const rec=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,c.uid);
      if(rec?.active===true && rec.completedRecoverySessionId===id &&
         rec.completedPreparedKitId===preparedKitId){
        // An uncertain network response after the successful Firestore commit
        // can be checked without issuing the secret again.
        return json({
          state:'bootstrap-required',alreadyCompleted:true,
          email:rec.recoveryEmail||c.email||'',
          requireEmailVerification:Boolean(rec.recoveryEmailChanged),
          requireTotpEnrollment:true,requireTrustedDeviceEnrollment:true
        },200,origin);
      }
      if(!rec || rec.pendingRecoverySessionId!==id || rec.active!==false ||
          rec.recoveryResetsComplete!==true){
        throw serviceError('Recovery challenge is no longer valid or the security reset is incomplete.',{
          status:403,code:'security-recovery-not-ready',source:'worker'
        });
      }
      const replacementEmail=String(body.newEmail||'').trim();
      if(replacementEmail){
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replacementEmail))
          throw serviceError('Replacement email is invalid.',{
            status:400,code:'security-recovery-email-invalid',source:'worker'
          });
        await identityPlatformAdminUpdateUser(env,c.uid,{
          email:replacementEmail,emailVerified:false,
          validSince:String(Math.floor(Date.now()/1000))
        });
      }
      // Firestore CAS makes the prepared kit active exactly once. Its hashes
      // are the same ones displayed to the Admin BEFORE this operation began.
      await finishMasterRecoveryKey(env,c.uid,rec,{
        uid:c.uid,active:true,
        masterKeyHash:c.prepared.masterKeyHash,
        backupCodeHashes:c.prepared.backupCodeHashes,
        completedRecoverySessionId:id,completedPreparedKitId:preparedKitId,
        recoveryEmail:replacementEmail||c.email||'',
        recoveryEmailChanged:Boolean(replacementEmail),
        deviceBootstrapEpoch:securityRandomId(18),
        createdAt:new Date().toISOString()
      });
      // Retain the short-lived nonsecret challenge for status confirmation;
      // Firestore's authoritative active=true record prevents a second reset.
      return json({
        state:'bootstrap-required',email:replacementEmail||c.email||'',
        requireEmailVerification:Boolean(replacementEmail),
        requireTotpEnrollment:true,requireTrustedDeviceEnrollment:true
      },200,origin);
    }
    if(path==='/security/recovery/status'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'recovery-status',{limit:30,windowSeconds:900,cooldownSeconds:120});
      const id=String(body.recoverySessionId||'');
      const preparedKitId=String(body.preparedKitId||'');
      if(!/^[A-Za-z0-9_-]{20,90}$/.test(preparedKitId)){
        throw serviceError('Prepared Recovery Kit ID is required.',{
          status:400,code:'security-recovery-kit-required',source:'worker'
        });
      }
      const c=await readPendingRecoveryChallenge(env,id);
      if(!c.prepared || c.prepared.preparedKitId!==preparedKitId){
        throw serviceError('Recovery Kit confirmation does not match.',{
          status:403,code:'security-recovery-kit-mismatch',source:'worker'
        });
      }
      const rec=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,c.uid);
      if(rec?.active===true && rec.completedRecoverySessionId===id &&
         rec.completedPreparedKitId===preparedKitId) {
        return json({
          state:'bootstrap-required',email:rec.recoveryEmail||c.email||'',
          requireEmailVerification:Boolean(rec.recoveryEmailChanged),
          requireTotpEnrollment:true,requireTrustedDeviceEnrollment:true
        },200,origin);
      }
      if(rec?.active===false && rec.pendingRecoverySessionId===id &&
         rec.recoveryResetsComplete===true) {
        return json({state:'pending-activation'},200,origin);
      }
      throw serviceError('Recovery state is no longer valid.',{
        status:403,code:'security-recovery-not-ready',source:'worker'
      });
    }

    const allowLockdown=path==='/security/overview'||path==='/security/lockdown/exit';
    const admin=await requireSecurityApprovedAdministrator(request,env,{allowLockdown});
    if(path==='/security/session/validate'&&method==='GET'){ return json({ok:true,session:{sessionId:admin.session.sessionId,trustLevel:admin.session.trustLevel||'temporary',deviceId:admin.session.deviceId||'',expiresAt:admin.session.expiresAt||''}},200,origin); }
    if(path==='/security/session/end'&&method==='POST'){ await securityPatchDoc(env,SECURITY_COLLECTIONS.sessions,admin.session.sessionId,{active:false,revokedAt:new Date().toISOString()}); await writeSecurityEvent(env,{uid:admin.uid,type:'session-revoked',sessionId:admin.session.sessionId,success:true}); return json({ok:true},200,origin); }
    if(path==='/security/step-up/start'&&method==='POST'){ const first=await verifyFirebasePassword(admin.email,body.password,env); if(!first.mfaPendingCredential) throw serviceError('Authenticator verification is required for sensitive actions.',{status:400,code:'security-step-up-mfa-required'}); const challengeId=await putSecurityChallenge(env,'step-up',{uid:admin.uid,sessionId:admin.session.sessionId,mfaPendingCredential:first.mfaPendingCredential,mfaInfo:first.mfaInfo}); return json({challengeId},200,origin); }
    if(path==='/security/step-up/complete'&&method==='POST'){ const c=await consumeSecurityChallenge(env,'step-up',body.challengeId); if(c.uid!==admin.uid||c.sessionId!==admin.session.sessionId) throw serviceError('Step-up challenge does not belong to this session.',{status:403,code:'security-step-up-invalid'}); const enrollmentId=String(c.mfaInfo?.find?.(x=>x?.totpInfo)?.mfaEnrollmentId||c.mfaInfo?.[0]?.mfaEnrollmentId||''); const {response}=await identityToolkit('accounts/mfaSignIn:finalize',{mfaPendingCredential:c.mfaPendingCredential,mfaEnrollmentId:enrollmentId,totpVerificationInfo:{verificationCode:String(body.code||'')}},env,'v2'); if(!response.ok) throw serviceError('Authenticator code is invalid or expired.',{status:401,code:'security-step-up-invalid'}); const proofId=securityRandomId(18),expiresAt=new Date(Date.now()+SECURITY_LIFETIMES.stepUp*1000).toISOString(); await securityWriteDoc(env,SECURITY_COLLECTIONS.stepUps,proofId,{proofId,uid:admin.uid,sessionId:admin.session.sessionId,active:true,createdAt:new Date(),expiresAt:new Date(Date.parse(expiresAt))}); return json({proofId,expiresAt},200,origin); }
    if(path==='/security/device/enrollment/create'&&method==='POST'){ await enforceSecurityRateLimit(request,env,'enrollment'); await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env); const requestingDeviceId=String(body.deviceId||''); if(!requestingDeviceId||!body.publicKeyJwk) throw serviceError('Device public key is required.',{status:400,code:'security-device-key-required'}); const recovery=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,admin.uid); const challengeId=await putSecurityChallenge(env,'device-enroll',{uid:admin.uid,requestingDeviceId,publicKeyJwk:body.publicKeyJwk,deviceBootstrapEpoch:String(recovery?.deviceBootstrapEpoch||''),approved:false}); return json({challengeId,expiresAt:new Date(Date.now()+SECURITY_LIFETIMES.challenge*1000).toISOString()},200,origin); }
    if(path==='/security/device/enrollment/status'&&method==='POST'){ const c=await readSecurityEnrollmentChallenge(env,body.challengeId,admin.uid); return json({state:c.approved?'approved':'pending',expiresAt:new Date(Number(c.expiresAt)).toISOString()},200,origin); }
    if(path==='/security/device/enrollment/approve'&&method==='POST'){ await requireTrustedSecurityManagement(admin,env); await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env); await approveSecurityEnrollmentChallenge(env,body.challengeId,admin.uid,admin.session.deviceId||''); return json({ok:true,state:'approved'},200,origin); }
    if(path==='/security/device/enrollment/complete'&&method==='POST'){ return json(await completeTrustedDeviceEnrollment(request,env,admin,body),200,origin); }
    if(path==='/security/device/rename'&&method==='POST'){ await requireTrustedSecurityManagement(admin,env); const d=await securityGetDoc(env,SECURITY_COLLECTIONS.devices,String(body.deviceId||'')); if(!d||d.uid!==admin.uid) throw serviceError('Trusted device was not found.',{status:404,code:'security-device-not-found'}); await securityPatchDoc(env,SECURITY_COLLECTIONS.devices,d.deviceId,{displayName:String(body.displayName||'Trusted device').slice(0,80)}); return json({ok:true},200,origin); }
    if(path==='/security/device/revoke'&&method==='POST'){
      await requireTrustedSecurityManagement(admin,env);
      await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env);
      const d=await securityGetDoc(env,SECURITY_COLLECTIONS.devices,String(body.deviceId||''));
      if(!d||d.uid!==admin.uid)throw serviceError('Trusted device was not found.',{status:404,code:'security-device-not-found'});
      const currentDeviceRevoked=d.deviceId===admin.session.deviceId;
      const sessions=await securityQueryAll(env,SECURITY_COLLECTIONS.sessions,[
        ['uid','EQUAL',admin.uid],['deviceId','EQUAL',d.deviceId],['active','EQUAL',true]
      ]);
      // Revoke the device and every related session in the same batch when possible.
      await revokeSecurityDocuments(env,[
        {collection:SECURITY_COLLECTIONS.devices,id:d.deviceId},
        ...sessions.map(x=>({collection:SECURITY_COLLECTIONS.sessions,id:x.sessionId}))
      ]);
      await removeAdminPushSubscriptionsForDevice(env,d.deviceId).catch(error=>{
        console.error('Admin revoked-device subscription cleanup failed:',error);
      });
      await writeSecurityEvent(env,{uid:admin.uid,type:'trusted-device-revoked',deviceId:d.deviceId,success:true});
      return json({ok:true,currentDeviceRevoked},200,origin);
    }
    if(path==='/security/account/password'&&method==='POST'){ await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env); const {response}=await identityToolkit('accounts:update',{idToken:admin.token,password:String(body.newPassword||''),returnSecureToken:false},env); if(!response.ok) throw serviceError('Password could not be changed.',{status:400,code:'security-password-change-failed',source:'firebase'}); await writeSecurityEvent(env,{uid:admin.uid,type:'password-changed',success:true}); return json({ok:true},200,origin); }
    if(path==='/security/totp/reset'&&method==='POST'){
      await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env);
      await Promise.all([
        revokeUserSecurityState(admin.uid,env),
        clearFirebaseMfaForRecovery(env,admin.uid)
      ]);
      // A verified MFA reset is a deliberate full security-reset event, not an
      // ordinary device revoke. Rotate the authoritative bootstrap generation
      // only AFTER prior sessions/devices and Firebase MFA are invalidated.
      await securityPatchDoc(env,SECURITY_COLLECTIONS.recovery,admin.uid,{
        deviceBootstrapEpoch:securityRandomId(18)
      });
      await writeSecurityEvent(env,{uid:admin.uid,type:'totp-reset',success:true,summary:'Authenticator enrollment reset; all sessions and trusted devices were revoked.'});
      return json({ok:true,bootstrapRequired:true},200,origin);
    }
    if(path==='/security/recovery/generate'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'recovery-rotate',{limit:5,windowSeconds:900,cooldownSeconds:300});
      await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env);
      const existing=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,admin.uid);
      if(existing?.active===false){
        throw serviceError('Emergency recovery is in progress; a normal kit rotation cannot replace it.',{
          status:409,code:'security-recovery-in-progress',source:'worker'
        });
      }
      const rotationId=await putSecurityChallenge(env,'recovery-rotate',{
        uid:admin.uid,sessionId:admin.session.sessionId
      },SECURITY_LIFETIMES.recovery);
      const key=recoveryKey(),codes=Array.from({length:8},backupCode);
      const preparedKitId=securityRandomId(24);
      await savePreparedRecoveryKit(env,rotationId,{
        preparedKitId,masterKeyHash:await recoveryHmac(key,env),
        backupCodeHashes:await Promise.all(codes.map(x=>recoveryHmac(x,env)))
      },'recovery-rotate');
      // No recovery record changes until the Admin sees and saves the kit.
      return json({
        state:'kit-prepared',rotationId,preparedKitId,
        masterKey:key,backupCodes:codes
      },200,origin);
    }
    if(path==='/security/recovery/rotate/activate'&&method==='POST'){
      await enforceSecurityRateLimit(request,env,'recovery-activate',{limit:15,windowSeconds:900,cooldownSeconds:300});
      await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env);
      const rotationId=String(body.rotationId||'');
      const kitId=String(body.preparedKitId||'');
      const challenge=await readPendingRecoveryChallenge(env,rotationId,'recovery-rotate');
      if(challenge.uid!==admin.uid || challenge.sessionId!==admin.session.sessionId ||
         !challenge.prepared || challenge.prepared.preparedKitId!==kitId) {
        throw serviceError('Prepared Recovery Kit is not valid for the current Admin session.',{
          status:403,code:'security-recovery-kit-mismatch',source:'worker'
        });
      }
      const existing=await securityGetDoc(env,SECURITY_COLLECTIONS.recovery,admin.uid);
      if(existing?.active===true && existing?.lastRotationId===rotationId &&
         existing?.lastPreparedKitId===kitId){
        return json({ok:true,state:'recovery-kit-active',alreadyCompleted:true},200,origin);
      }
      if(existing?.active===false){
        throw serviceError('Emergency Recovery cannot be overridden by a normal kit rotation.',{
          status:409,code:'security-recovery-in-progress',source:'worker'
        });
      }
      const fields={
        uid:admin.uid,active:true,
        masterKeyHash:challenge.prepared.masterKeyHash,
        backupCodeHashes:challenge.prepared.backupCodeHashes,
        lastRotationId:rotationId,lastPreparedKitId:kitId,
        createdAt:new Date().toISOString()
      };
      const writes=[{
        update:{
          name:firestoreDocumentName(env,SECURITY_COLLECTIONS.recovery,admin.uid),
          fields:firestoreFields(fields)
        },
        updateMask:{fieldPaths:Object.keys(fields)},
        currentDocument:existing?{updateTime:existing._updateTime}:{exists:false}
      },{
        update:{
          name:firestoreDocumentName(env,SECURITY_COLLECTIONS.events,securityRandomId(18)),
          fields:firestoreFields({
            uid:admin.uid,type:'recovery-kit-rotated',success:true,
            summary:'Recovery Kit activated after offline-save confirmation.',
            sessionId:admin.session.sessionId,
            createdAt:new Date().toISOString()
          })
        },currentDocument:{exists:false}
      }];
      try{
        await firestoreAdminCommit(env,writes);
      }catch(error){
        if(error?.code==='firestore-precondition-failed'){
          throw serviceError('Recovery Kit changed during activation; verify current state before retrying.',{
            status:409,code:'security-recovery-state-changed',source:'worker'
          });
        }
        throw error;
      }
      return json({ok:true,state:'recovery-kit-active'},200,origin);
    }
    if(path==='/security/devices'&&method==='GET'){ const devices=await securityQuery(env,SECURITY_COLLECTIONS.devices,[['uid','EQUAL',admin.uid]],100); return json({devices:devices.map(({publicKeyJwk,_updateTime,...d})=>({...d,current:d.deviceId===admin.session.deviceId}))},200,origin); }
    if(path==='/security/access-state'&&method==='GET'){ return json(await buildSecurityAccessState(admin,env),200,origin); }
    if(path==='/security/sessions'&&method==='GET'){ const access=await buildSecurityAccessState(admin,env); return json({sessions:access.sessions},200,origin); }
    if(path==='/security/session/revoke'&&method==='POST'){ await requireTrustedSecurityManagement(admin,env); const s=await securityGetDoc(env,SECURITY_COLLECTIONS.sessions,String(body.sessionId||'')); if(!s||s.uid!==admin.uid) throw serviceError('Security session was not found.',{status:404,code:'security-session-not-found'}); if(s.sessionId===admin.session.sessionId) throw serviceError('Use logout to end the current session.',{status:400,code:'security-current-session'}); await securityPatchDoc(env,SECURITY_COLLECTIONS.sessions,s.sessionId,{active:false,revokedAt:new Date().toISOString()}); await writeSecurityEvent(env,{uid:admin.uid,type:'session-revoked',sessionId:s.sessionId,success:true}); return json({ok:true},200,origin); }
    if(path==='/security/session/revoke-others'&&method==='POST'){
      await requireTrustedSecurityManagement(admin,env);
      await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env);
      const sessions=await securityQueryAll(env,SECURITY_COLLECTIONS.sessions,[['uid','EQUAL',admin.uid],['active','EQUAL',true]]);
      await revokeSecurityDocuments(env,sessions.filter(x=>x.sessionId!==admin.session.sessionId).map(x=>({
        collection:SECURITY_COLLECTIONS.sessions,id:x.sessionId
      })));
      return json({ok:true},200,origin);
    }
    if(path==='/security/session/revoke-temporary'&&method==='POST'){
      await requireTrustedSecurityManagement(admin,env);
      await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env);
      const [sessions,devices]=await Promise.all([
        securityQueryAll(env,SECURITY_COLLECTIONS.sessions,[['uid','EQUAL',admin.uid],['active','EQUAL',true]]),
        securityQueryAll(env,SECURITY_COLLECTIONS.devices,[['uid','EQUAL',admin.uid]])
      ]);
      const activeDeviceIds=activeTrustedDeviceIds(devices);
      const temporarySessions=sessions.filter(x=>x.sessionId!==admin.session.sessionId&&effectiveSecuritySessionTrustLevel(x,activeDeviceIds)!=='trusted');
      await revokeSecurityDocuments(env,temporarySessions.map(x=>({
        collection:SECURITY_COLLECTIONS.sessions,id:x.sessionId
      })));
      return json({ok:true,revoked:temporarySessions.length},200,origin);
    }
    if(path==='/security/activity'&&method==='GET'){ const events=await securityQuery(env,SECURITY_COLLECTIONS.events,[['uid','EQUAL',admin.uid]],200); events.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)); return json({events:events.slice(0,100)},200,origin); }
    if(path==='/security/email-branding'&&method==='GET'){ const cfg=await securityGetDoc(env,'adminSecurityPreferences',admin.uid); return json({branding:cfg?.branding||{},provider:securityEmailProviderStatus(env)},200,origin); }
    if(path==='/security/email-branding'&&method==='POST'){ const branding={senderName:String(body.branding?.senderName||'LΛN Portfolio CMS').slice(0,80),logoUrl:String(body.branding?.logoUrl||'').slice(0,500),heading:String(body.branding?.heading||'Security alert').slice(0,100),footer:String(body.branding?.footer||'').slice(0,240)}; await securityWriteDoc(env,'adminSecurityPreferences',admin.uid,{uid:admin.uid,branding,updatedAt:new Date().toISOString()}); return json({ok:true,branding},200,origin); }
    if(path==='/security/alert-status'&&method==='GET') return json({email:securityEmailProviderStatus(env),webPush:'configured'},200,origin);
    if(path==='/security/lockdown/enter'&&method==='POST'){ await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env); await securityWriteDoc(env,'adminSecurityState',admin.uid,{uid:admin.uid,lockdown:true,updatedAt:new Date().toISOString()}); await writeSecurityEvent(env,{uid:admin.uid,type:'lockdown-entered',success:true}); return json({ok:true},200,origin); }
    if(path==='/security/lockdown/exit'&&method==='POST'){ await verifyStepUp(admin.uid,admin.session.sessionId,body.proofId,env); await securityWriteDoc(env,'adminSecurityState',admin.uid,{uid:admin.uid,lockdown:false,updatedAt:new Date().toISOString()}); await writeSecurityEvent(env,{uid:admin.uid,type:'lockdown-exited',success:true}); return json({ok:true},200,origin); }
    if(path==='/security/overview'&&method==='GET'){ const [access,events,recovery,status,account]=await Promise.all([buildSecurityAccessState(admin,env),securityQuery(env,SECURITY_COLLECTIONS.events,[['uid','EQUAL',admin.uid]],100),securityGetDoc(env,SECURITY_COLLECTIONS.recovery,admin.uid),securityGetDoc(env,'adminSecurityState',admin.uid),verifyFirebaseIdToken(admin.token,env)]); events.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)); return json({...access,events:events.slice(0,50),recovery:{configured:recovery?.active===true,createdAt:recovery?.createdAt||''},account:{email:account.email||'',emailVerified:account.emailVerified===true,totpEnrolled:Array.isArray(account.user?.mfaInfo)&&account.user.mfaInfo.some(info=>Boolean(info?.totpInfo))},lockdown:status?.lockdown===true,emailProvider:securityEmailProviderStatus(env)},200,origin); }
    return json({error:'Security endpoint not found.',code:'not-found'},404,origin);
  }catch(error){ return json({error:error?.message||'Security request failed.',code:error?.code||'internal',retryAt:error?.retryAt||''},Number(error?.status)||500,origin); }
}
// --- End Canonical Admin Security Gateway ---------------------------------------------

async function notifyAdminOfStoredVisitorMessage(request, env, threadId, name) {
  const url = `/admin/shell.html?workspace=${encodeURIComponent(`pages/settings.html?messageThread=${threadId}`)}`;
  try {
    const result = await sendTrustedAdminNotification(env, { title: "LΛN Portfolio CMS", body: `New message from ${name}`, tag: `lan-admin-message-${threadId}`, url }, { ackOrigin: new URL(request.url).origin, waitForReceiptMs: PUSH_RECEIPT_TIMEOUT_MS });
    return { ...result, error: "" };
  } catch (error) {
    console.error("Admin device notification fanout failed:", error);
    return { state: "error", accepted: 0, delivered: 0, subscriptions: 0, failed: 0, stale: 0, authFailed: 0, error: String(error?.message || "Admin notification failed.") };
  }
}

async function handlePublicMessageThreadCreate(request, env) {
  let context;
  try {
    context = messageRequestContext(request, env);
    const body = await readStrictJsonBody(request, { name: REQUEST_SCHEMA_ANY, message: REQUEST_SCHEMA_ANY, website: REQUEST_SCHEMA_ANY, verificationToken: REQUEST_SCHEMA_ANY });
    const visitorName = String(body?.name || "").trim().slice(0, 80);
    const message = String(body?.message || "").trim().slice(0, 2000);
    const honeypot = String(body?.website || "").trim();
    if (honeypot) throw serviceError("Message could not be accepted.", { status: 400, code: "message-abuse-rejected", source: "worker" });
    if (!visitorName) throw serviceError("Enter your name.", { status: 400, code: "message-name-required", source: "worker" });
    if (!message) throw serviceError("Write a message first.", { status: 400, code: "message-text-required", source: "worker" });
    assertPrivateMessageRelayConfigured(env);
    await consumePrivateMessageVerification(request, env, body?.verificationToken);
    await enforceMessageRateLimit(request, env, { scope: "new-thread", limit: MESSAGE_NEW_THREAD_LIMIT, windowSeconds: MESSAGE_NEW_THREAD_WINDOW_SECONDS, cooldownSeconds: MESSAGE_NEW_THREAD_COOLDOWN_SECONDS });

    const threadId = randomCapability(32);
    const messageId = randomCapability(15);
    const now = new Date().toISOString();
    const threadName = firestoreDocumentName(env, "privateMessageThreads", threadId);
    const messageName = firestoreDocumentName(env, "privateMessageThreads", threadId, "messages", messageId);
    await firestoreAdminCommit(env, [
      {
        update: {
          name: threadName,
          fields: {
            version: firestoreInteger(1),
            visitorName: firestoreString(visitorName),
            status: firestoreString("open"),
            adminUnread: firestoreBoolean(true),
            visitorUnread: firestoreBoolean(false),
            preview: firestoreString(message.slice(0, 160)),
            createdAt: firestoreTimestamp(now),
            updatedAt: firestoreTimestamp(now),
            lastVisitorMessageAt: firestoreTimestamp(now),
            lastAdminMessageAt: firestoreNull()
          }
        },
        currentDocument: { exists: false }
      },
      {
        update: { name: messageName, fields: { role: firestoreString("visitor"), text: firestoreString(message), createdAt: firestoreTimestamp(now) } },
        currentDocument: { exists: false }
      }
    ]);
    const notification = await notifyAdminOfStoredVisitorMessage(request, env, threadId, visitorName);
    return json({ ok: true, id: threadId, visitorName, notification }, 201, context.origin);
  } catch (error) {
    const origin = context?.origin || allowedOrigin(request.headers.get("Origin") || "", env);
    return json({ error: error?.message || "Message could not be sent.", code: error?.code || "internal", retryAt: error?.retryAt || "" }, Number(error?.status) || 500, origin);
  }
}

async function handlePublicMessageSend(request, env) {
  let context;
  try {
    context = messageRequestContext(request, env);
    const body = await readStrictJsonBody(request, { threadId: REQUEST_SCHEMA_ANY, message: REQUEST_SCHEMA_ANY });
    const threadId = String(body?.threadId || "").trim();
    const message = String(body?.message || "").trim().slice(0, 2000);
    if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) throw serviceError("Private conversation identity is invalid.", { status: 400, code: "message-thread-invalid", source: "worker" });
    if (!message) throw serviceError("Write a message first.", { status: 400, code: "message-text-required", source: "worker" });
    assertPrivateMessageRelayConfigured(env);
    await enforceMessageRateLimit(request, env, { scope: `thread:${threadId}`, limit: MESSAGE_THREAD_LIMIT, windowSeconds: MESSAGE_THREAD_WINDOW_SECONDS, cooldownSeconds: MESSAGE_THREAD_COOLDOWN_SECONDS });
    const thread = await firestoreAdminGetThread(threadId, env);
    if (!thread || thread?.fields?.status?.stringValue !== "open") throw serviceError("This private conversation is no longer available.", { status: 404, code: "message-thread-missing", source: "worker" });
    const visitorName = String(thread?.fields?.visitorName?.stringValue || "Portfolio visitor").slice(0, 80) || "Portfolio visitor";
    const messageId = randomCapability(15);
    const now = new Date().toISOString();
    const threadName = firestoreDocumentName(env, "privateMessageThreads", threadId);
    const messageName = firestoreDocumentName(env, "privateMessageThreads", threadId, "messages", messageId);
    await firestoreAdminCommit(env, [
      {
        update: { name: messageName, fields: { role: firestoreString("visitor"), text: firestoreString(message), createdAt: firestoreTimestamp(now) } },
        currentDocument: { exists: false }
      },
      {
        update: {
          name: threadName,
          fields: {
            adminUnread: firestoreBoolean(true),
            preview: firestoreString(message.slice(0, 160)),
            updatedAt: firestoreTimestamp(now),
            lastVisitorMessageAt: firestoreTimestamp(now)
          }
        },
        updateMask: { fieldPaths: ["adminUnread", "preview", "updatedAt", "lastVisitorMessageAt"] },
        currentDocument: thread.updateTime ? { updateTime: thread.updateTime } : { exists: true }
      }
    ]);
    const notification = await notifyAdminOfStoredVisitorMessage(request, env, threadId, visitorName);
    return json({ ok: true, notification }, 200, context.origin);
  } catch (error) {
    const origin = context?.origin || allowedOrigin(request.headers.get("Origin") || "", env);
    return json({ error: error?.message || "Message could not be sent.", code: error?.code || "internal", retryAt: error?.retryAt || "" }, Number(error?.status) || 500, origin);
  }
}

async function handlePublicMessageRead(request, env) {
  let context;
  try {
    context = messageRequestContext(request, env);
    const body = await readStrictJsonBody(request, { threadId: REQUEST_SCHEMA_ANY });
    const threadId = String(body?.threadId || "").trim();
    if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) throw serviceError("Private conversation identity is invalid.", { status: 400, code: "message-thread-invalid", source: "worker" });
    assertPrivateMessageRelayConfigured(env);
    const thread = await firestoreAdminGetThread(threadId, env);
    if (!thread) return json({ ok: true, missing: true }, 200, context.origin);
    if (thread?.fields?.visitorUnread?.booleanValue !== true) return json({ ok: true, unchanged: true }, 200, context.origin);
    const threadName = firestoreDocumentName(env, "privateMessageThreads", threadId);
    await firestoreAdminCommit(env, [{
      update: { name: threadName, fields: { visitorUnread: firestoreBoolean(false) } },
      updateMask: { fieldPaths: ["visitorUnread"] },
      currentDocument: thread.updateTime ? { updateTime: thread.updateTime } : { exists: true }
    }]);
    return json({ ok: true }, 200, context.origin);
  } catch (error) {
    const origin = context?.origin || allowedOrigin(request.headers.get("Origin") || "", env);
    return json({ error: error?.message || "Conversation state could not be updated.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handlePublicMessageForget(request, env) {
  let context;
  try {
    context = messageRequestContext(request, env);
    const body = await readStrictJsonBody(request, { threadId: REQUEST_SCHEMA_ANY });
    const threadId = String(body?.threadId || "").trim();
    if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) throw serviceError("Private conversation identity is invalid.", { status: 400, code: "message-thread-invalid", source: "worker" });
    assertPrivateMessageRelayConfigured(env);
    await enforceMessageRateLimit(request, env, { scope: `forget:${threadId}`, limit: 3, windowSeconds: 10 * 60, cooldownSeconds: 2 });
    const thread = await firestoreAdminGetThread(threadId, env);
    if (!thread) return json({ ok: true, missing: true }, 200, context.origin);
    const now = new Date().toISOString();
    const messageId = randomCapability(15);
    const threadName = firestoreDocumentName(env, "privateMessageThreads", threadId);
    const messageName = firestoreDocumentName(env, "privateMessageThreads", threadId, "messages", messageId);
    const eventText = "Visitor forgot this conversation on this browser.";
    await firestoreAdminCommit(env, [
      {
        update: { name: messageName, fields: { role: firestoreString("system"), text: firestoreString(eventText), createdAt: firestoreTimestamp(now) } },
        currentDocument: { exists: false }
      },
      {
        update: {
          name: threadName,
          fields: {
            adminUnread: firestoreBoolean(true),
            preview: firestoreString(eventText),
            updatedAt: firestoreTimestamp(now)
          }
        },
        updateMask: { fieldPaths: ["adminUnread", "preview", "updatedAt"] },
        currentDocument: thread.updateTime ? { updateTime: thread.updateTime } : { exists: true }
      }
    ]);
    return json({ ok: true }, 200, context.origin);
  } catch (error) {
    const origin = context?.origin || allowedOrigin(request.headers.get("Origin") || "", env);
    return json({ error: error?.message || "Conversation access could not be forgotten securely.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function ensureVapidKeyPair(env) {
  const store = pushStore(env);
  const saved = await store.get(PUSH_VAPID_KEY, "json");
  if (saved?.privateJwk && saved?.publicJwk && saved?.publicKey) return saved;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const [privateJwk, publicJwk, rawPublic] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("raw", pair.publicKey)
  ]);
  const record = { privateJwk, publicJwk, publicKey: base64Url(new Uint8Array(rawPublic)), createdAt: new Date().toISOString() };
  await store.put(PUSH_VAPID_KEY, JSON.stringify(record));
  return record;
}

async function vapidAuthorization(endpoint, env, vapid) {
  const endpointUrl = new URL(endpoint);
  const aud = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const subjectHost = String(env.FIREBASE_PROJECT_ID || "lan-portfolio").trim();
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ aud, exp: now + 12 * 60 * 60, sub: `https://${subjectHost}.web.app` })));
  const unsigned = `${header}.${payload}`;
  const privateKey = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${base64Url(signature)}, k=${vapid.publicKey}`;
}

async function encryptPushPayload(subscription, payload) {
  const userPublic = base64UrlBytes(subscription?.keys?.p256dh || "");
  const authSecret = base64UrlBytes(subscription?.keys?.auth || "");
  if (userPublic.length !== 65 || !authSecret.length) throw serviceError("Push subscription keys are invalid.", { status: 400, code: "push-subscription-invalid", source: "worker" });

  const userKey = await crypto.subtle.importKey("raw", userPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverPair.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, serverPair.privateKey, 256));

  const authPrk = await hmacSha256(authSecret, shared);
  const keyInfo = concatBytes(new TextEncoder().encode("WebPush: info\0"), userPublic, serverPublic);
  const ikm = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const plain = concatBytes(new TextEncoder().encode(JSON.stringify(payload)), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plain));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concatBytes(salt, rs, new Uint8Array([serverPublic.length]), serverPublic, ciphertext);
}

function validPushSubscription(value) {
  try {
    const endpoint = new URL(String(value?.endpoint || ""));
    return endpoint.protocol === "https:" && String(value?.keys?.p256dh || "").length > 20 && String(value?.keys?.auth || "").length > 8;
  } catch { return false; }
}

async function sendWebPush(subscription, payload, env) {
  if (!validPushSubscription(subscription)) return { ok: false, stale: true, status: 400 };
  const vapid = await ensureVapidKeyPair(env);
  const body = await encryptPushPayload(subscription, payload);
  const authorization = await vapidAuthorization(subscription.endpoint, env, vapid);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal"
    },
    body
  });
  return {
    ok: response.ok,
    stale: [404, 410].includes(response.status),
    authFailed: [401, 403].includes(response.status),
    status: response.status
  };
}

async function listKvRecords(store, prefix) {
  const results = [];
  let cursor;
  do {
    const page = await store.list({ prefix, cursor, limit: 1000 });
    for (const key of page.keys || []) {
      const value = await store.get(key.name, "json");
      if (value) results.push({ key: key.name, value });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return results;
}

async function storePushSubscription(env, { audience, threadId = "", subscription, iconUrl = "", deviceId = "" }) {
  if (!validPushSubscription(subscription)) throw serviceError("Push subscription is invalid.", { status: 400, code: "push-subscription-invalid", source: "worker" });
  const store = pushStore(env);
  const vapid = await ensureVapidKeyPair(env);
  const hash = await sha256Text(subscription.endpoint);
  const key = audience === "admin" ? `${PUSH_ADMIN_PREFIX}${hash}` : `${PUSH_VISITOR_PREFIX}${threadId}:${hash}`;
  await store.put(key, JSON.stringify({
    audience,
    threadId,
    subscription,
    vapidPublicKey: vapid.publicKey,
    iconUrl: String(iconUrl || "").slice(0, 800),
    deviceId: String(deviceId || "").slice(0, 96),
    updatedAt: new Date().toISOString()
  }));
}

async function removeVisitorPushSubscription(env, threadId, endpoint) {
  if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) throw serviceError("Private conversation identity is invalid.", { status: 400, code: "message-thread-invalid", source: "worker" });
  let parsed;
  try { parsed = new URL(String(endpoint || "")); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== "https:") throw serviceError("Notification subscription is invalid.", { status: 400, code: "push-subscription-invalid", source: "worker" });
  const hash = await sha256Text(parsed.href);
  await pushStore(env).delete(`${PUSH_VISITOR_PREFIX}${threadId}:${hash}`);
}

async function purgePushPrefix(env, prefix) {
  const store = pushStore(env);
  const records = await listKvRecords(store, prefix);
  await Promise.all(records.map(({ key }) => store.delete(key)));
  return records.length;
}

async function createPushDelivery(env, ackOrigin) {
  if (!ackOrigin) return null;
  const id = randomCapability(18);
  const token = randomCapability(24);
  const now = new Date().toISOString();
  await firestoreAdminCommit(env, [{
    update: {
      name: firestoreDocumentName(env, PUSH_DELIVERY_COLLECTION, id),
      fields: {
        token: firestoreString(token),
        state: firestoreString("pending"),
        createdAt: firestoreTimestamp(now)
      }
    },
    currentDocument: { exists: false }
  }]);
  return { id, token, ackUrl: `${ackOrigin.replace(/\/$/, "")}/messages/push/ack` };
}

async function deletePushDeliveries(env, deliveryIds) {
  const ids = deliveryIds.filter((id) => /^[A-Za-z0-9_-]{18,80}$/.test(String(id || "")));
  if (!ids.length) return;
  await firestoreAdminCommit(env, ids.map((id) => ({ delete: firestoreDocumentName(env, PUSH_DELIVERY_COLLECTION, id) }))).catch((error) => { console.error("Push delivery cleanup failed:", error); });
}

async function waitForPushDeliveries(env, deliveryIds, timeoutMs = 0) {
  const ids = deliveryIds.filter(Boolean);
  if (!ids.length || timeoutMs <= 0) return 0;
  const deadline = Date.now() + timeoutMs;
  do {
    let delivered = 0;
    for (const id of ids) {
      const record = await firestoreAdminGetPushDelivery(id, env);
      if (record?.fields?.state?.stringValue === "delivered") delivered += 1;
    }
    if (delivered >= ids.length || Date.now() >= deadline) return delivered;
    await new Promise((resolve) => setTimeout(resolve, PUSH_RECEIPT_POLL_MS));
  } while (Date.now() < deadline);
  return 0;
}

async function fanoutPushRecords(env, records, payload, { ackOrigin = "", waitForReceiptMs = 0 } = {}) {
  const store = pushStore(env);
  const vapid = await ensureVapidKeyPair(env);
  let accepted = 0;
  let failed = 0;
  let stale = 0;
  let authFailed = 0;
  const deliveryIds = [];
  await Promise.all(records.map(async ({ key, value }) => {
    if (value?.vapidPublicKey && value.vapidPublicKey !== vapid.publicKey) {
      stale += 1;
      await store.delete(key);
      return;
    }
    const delivery = waitForReceiptMs > 0 ? await createPushDelivery(env, ackOrigin) : null;
    try {
      const result = await sendWebPush(value.subscription, { ...payload, icon: value.iconUrl || payload.icon || "", delivery }, env);
      if (result.ok) {
        accepted += 1;
        if (delivery) deliveryIds.push(delivery.id);
      } else {
        failed += 1;
        if (delivery) await deletePushDeliveries(env, [delivery.id]);
      }
      if (result.authFailed) authFailed += 1;
      if (result.stale) {
        stale += 1;
        await store.delete(key);
      }
    } catch {
      failed += 1;
      if (delivery) await deletePushDeliveries(env, [delivery.id]);
    }
  }));
  const delivered = await waitForPushDeliveries(env, deliveryIds, waitForReceiptMs);
  if (deliveryIds.length) await deletePushDeliveries(env, deliveryIds);
  let state = "unregistered";
  if (delivered > 0) state = failed > 0 || stale > 0 || delivered < accepted ? "partial" : "delivered";
  else if (accepted > 0) state = "accepted";
  else if (failed > 0) state = "failed";
  else if (stale > 0) state = "stale";
  else if (records.length > 0) state = "undelivered";
  return { state, accepted, delivered, subscriptions: records.length, failed, stale, authFailed };
}

async function fanoutPush(env, prefix, payload, options = {}) {
  return fanoutPushRecords(env, await listKvRecords(pushStore(env), prefix), payload, options);
}

async function trustedAdminPushRecords(env) {
  const store = pushStore(env);
  const records = await listKvRecords(store, PUSH_ADMIN_PREFIX);
  const trusted = [];
  for (const record of records) {
    const deviceId = String(record.value?.deviceId || "");
    if (!deviceId) {
      await store.delete(record.key);
      continue;
    }
    const device = await securityGetDoc(env, SECURITY_COLLECTIONS.devices, deviceId).catch(() => null);
    if (device?.active === true) trusted.push(record);
    else await store.delete(record.key);
  }
  return trusted;
}

async function fanoutTrustedAdminPush(env, payload, options = {}) {
  return fanoutPushRecords(env, await trustedAdminPushRecords(env), payload, options);
}

async function sendTrustedAdminNotification(env, payload, { ackOrigin = "", waitForReceiptMs = PUSH_RECEIPT_TIMEOUT_MS } = {}) {
  return fanoutTrustedAdminPush(env, payload, { ackOrigin, waitForReceiptMs: ackOrigin ? waitForReceiptMs : 0 });
}

async function removeAdminPushSubscriptionsForDevice(env, deviceId) {
  const id = String(deviceId || "");
  if (!id) return 0;
  const store = pushStore(env);
  const records = await listKvRecords(store, PUSH_ADMIN_PREFIX);
  const matching = records.filter((record) => String(record.value?.deviceId || "") === id);
  await Promise.all(matching.map((record) => store.delete(record.key)));
  return matching.length;
}

function securityEmailProviderStatus(env) {
  return String(env.RESEND_API_KEY||'').trim() && String(env.SECURITY_ALERT_FROM_EMAIL||'').trim() && String(env.SECURITY_ALERT_TO_EMAIL||'').trim() ? 'configured' : 'not-configured';
}
function escapeEmailHtml(value=''){ return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function sendSecurityEmailAlert(env,event) {
  if (securityEmailProviderStatus(env) !== 'configured') return { state:'not-configured' };
  const prefs=await securityGetDoc(env,'adminSecurityPreferences',event.uid).catch(()=>null),b=prefs?.branding||{};
  const senderName=String(b.senderName||'LΛN Portfolio CMS').slice(0,80),heading=String(b.heading||'Security alert').slice(0,100),footer=String(b.footer||'Review Security & Access in the Admin CMS.').slice(0,240),logoUrl=String(b.logoUrl||'').slice(0,500);
  const safeLink=String(env.SECURITY_ALERT_ADMIN_URL||'').trim();
  const html=`<div style="font-family:system-ui,sans-serif;max-width:640px;margin:auto"><header>${logoUrl?`<img src="${escapeEmailHtml(logoUrl)}" alt="" style="max-height:72px;max-width:160px">`:''}<h1>${escapeEmailHtml(heading)}</h1></header><p><strong>${escapeEmailHtml(String(event.type||'Security event').replaceAll('-',' '))}</strong></p><p>${escapeEmailHtml(event.summary||'A security event was recorded for your administrator account.')}</p><p>${escapeEmailHtml(new Date().toISOString())}</p>${safeLink?`<p><a href="${escapeEmailHtml(safeLink)}">Open Security &amp; Access</a></p>`:''}<footer><small>${escapeEmailHtml(footer)}</small></footer></div>`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${String(env.RESEND_API_KEY)}`,'Content-Type':'application/json'},body:JSON.stringify({from:`${senderName} <${String(env.SECURITY_ALERT_FROM_EMAIL).trim()}>`,to:[String(env.SECURITY_ALERT_TO_EMAIL).trim()],subject:`LΛN security: ${String(event.type||'alert').replaceAll('-',' ')}`,html})});
  const payload=await response.json().catch(()=>({})); if(!response.ok||!payload?.id) return {state:'failed',error:payload?.message||`HTTP ${response.status}`}; return {state:'sent',providerId:String(payload.id)};
}
async function dispatchSecurityAlerts(env,event,{alertOrigin=''}={}) {
  const title='LΛN Security Alert', body=String(event.summary||String(event.type||'Security event').replaceAll('-',' ')).slice(0,180);
  const [push,email]=await Promise.allSettled([
    sendTrustedAdminNotification(env,{title,body,tag:`lan-security-${String(event.type||'event')}`,url:'/admin/shell.html?workspace=pages/settings.html'},{ackOrigin:alertOrigin,waitForReceiptMs:PUSH_RECEIPT_TIMEOUT_MS}),
    sendSecurityEmailAlert(env,event)
  ]);
  return { push:push.status==='fulfilled'?push.value:{state:'failed',accepted:0,delivered:0,subscriptions:0,failed:1,stale:0}, email:email.status==='fulfilled'?email.value:{state:'failed'} };
}

async function publicThreadExists(threadId, env) {
  if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) return false;
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const apiKey = String(env.FIREBASE_WEB_API_KEY || "").trim();
  if (!projectId || !apiKey) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/privateMessageThreads/${encodeURIComponent(threadId)}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  return response.ok;
}

async function handleMessagePushConfig(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const vapid = await ensureVapidKeyPair(env);
    return json({ publicKey: vapid.publicKey }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Notification service is unavailable.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePushRegister(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const body = await readStrictJsonBody(request, { audience: REQUEST_SCHEMA_ANY, threadId: REQUEST_SCHEMA_ANY, iconUrl: REQUEST_SCHEMA_ANY, subscription: PUSH_SUBSCRIPTION_SCHEMA });
    const audience = body?.audience === "admin" ? "admin" : body?.audience === "visitor" ? "visitor" : "";
    if (!audience) throw serviceError("Notification audience is invalid.", { status: 400, code: "push-audience-invalid" });
    let threadId = String(body?.threadId || "").trim();
    let deviceId = "";
    if (audience === "admin") {
      const admin = await requireSecurityApprovedAdministrator(request, env);
      threadId = "";
      if (admin.session.trustLevel !== "trusted" || !admin.session.deviceId) {
        throw serviceError("Trust this device before enabling persistent Admin notifications.", { status: 403, code: "push-admin-trusted-device-required", source: "worker" });
      }
      const device = await securityGetDoc(env, SECURITY_COLLECTIONS.devices, admin.session.deviceId);
      if (!device || device.uid !== admin.uid || device.active !== true) {
        throw serviceError("Trusted device approval is no longer active.", { status: 403, code: "push-admin-device-revoked", source: "worker" });
      }
      deviceId = String(admin.session.deviceId);
    } else if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId) || !(await publicThreadExists(threadId, env))) {
      throw serviceError("Private conversation could not be verified.", { status: 403, code: "message-thread-denied" });
    }
    await storePushSubscription(env, { audience, threadId, subscription: body?.subscription, iconUrl: body?.iconUrl, deviceId });
    return json({ ok: true }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Notification subscription could not be saved.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePushStatus(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env, { trustLevels: ["trusted"] });
    const body = await readStrictJsonBody(request, { endpoint: REQUEST_SCHEMA_ANY });
    let parsed;
    try { parsed = new URL(String(body?.endpoint || "")); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== "https:") throw serviceError("Notification subscription is invalid.", { status: 400, code: "push-subscription-invalid", source: "worker" });
    const hash = await sha256Text(parsed.href);
    const key = `${PUSH_ADMIN_PREFIX}${hash}`;
    const record = await pushStore(env).get(key, "json");
    const registered = Boolean(record && record.audience === "admin" && record.deviceId === admin.session.deviceId);
    return json({ ok: true, registered }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Device notification status could not be verified.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePushUnregister(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const body = await readStrictJsonBody(request, { threadId: REQUEST_SCHEMA_ANY, endpoint: REQUEST_SCHEMA_ANY });
    await removeVisitorPushSubscription(env, String(body?.threadId || "").trim(), String(body?.endpoint || "").trim());
    return json({ ok: true }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Reply notifications could not be disconnected.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePushReply(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    await requireSecurityApprovedAdministrator(request, env);
    const body = await readStrictJsonBody(request, { threadId: REQUEST_SCHEMA_ANY });
    const threadId = String(body?.threadId || "").trim();
    if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) throw serviceError("Private conversation identity is invalid.", { status: 400, code: "message-thread-invalid" });
    const result = await fanoutPush(env, `${PUSH_VISITOR_PREFIX}${threadId}:`, { title: "LΛN Portfolio Reply", body: "", tag: `lan-portfolio-reply-${threadId}`, url: "/?message=open" }, { ackOrigin: new URL(request.url).origin, waitForReceiptMs: PUSH_RECEIPT_TIMEOUT_MS });
    return json({ ok: true, ...result }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Reply notification could not be sent.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}


async function handleMessagePushTest(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    await requireSecurityApprovedAdministrator(request, env);
    const result = await sendTrustedAdminNotification(env, {
      title: "LΛN Portfolio CMS",
      body: "Admin device notification test.",
      tag: "lan-admin-notification-test",
      url: "/admin/shell.html"
    }, { ackOrigin: new URL(request.url).origin, waitForReceiptMs: PUSH_RECEIPT_TIMEOUT_MS });
    return json({ ok: true, ...result }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Device notification test could not be sent.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePushAck(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const body = await readStrictJsonBody(request, { id: REQUEST_SCHEMA_ANY, token: REQUEST_SCHEMA_ANY });
    const id = String(body?.id || "").trim();
    const token = String(body?.token || "").trim();
    if (!/^[A-Za-z0-9_-]{18,80}$/.test(id) || !token) throw serviceError("Push delivery acknowledgment is invalid.", { status: 400, code: "push-ack-invalid", source: "worker" });
    const record = await firestoreAdminGetPushDelivery(id, env);
    if (!record || record?.fields?.token?.stringValue !== token) throw serviceError("Push delivery acknowledgment was not recognized.", { status: 403, code: "push-ack-denied", source: "worker" });
    const deliveredAt = new Date().toISOString();
    await firestoreAdminCommit(env, [{
      update: {
        name: firestoreDocumentName(env, PUSH_DELIVERY_COLLECTION, id),
        fields: { state: firestoreString("delivered"), deliveredAt: firestoreTimestamp(deliveredAt) }
      },
      updateMask: { fieldPaths: ["state", "deliveredAt"] },
      currentDocument: record.updateTime ? { updateTime: record.updateTime } : { exists: true }
    }]);
    return json({ ok: true }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Push delivery could not be acknowledged.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}

async function handleMessagePushThreadDelete(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    await requireSecurityApprovedAdministrator(request, env);
    const body = await readStrictJsonBody(request, { threadId: REQUEST_SCHEMA_ANY });
    const threadId = String(body?.threadId || "").trim();
    if (!PRIVATE_MESSAGE_THREAD_RE.test(threadId)) throw serviceError("Private conversation identity is invalid.", { status: 400, code: "message-thread-invalid" });
    const purged = await purgePushPrefix(env, `${PUSH_VISITOR_PREFIX}${threadId}:`);
    return json({ ok: true, purged }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Conversation notification state could not be removed.", code: error?.code || "internal" }, Number(error?.status) || 500, origin);
  }
}


async function handleTelemetry(request, env) {
  const origin = allowedOrigin(request.headers.get("Origin") || "", env);
  if (!origin) return json({ error: "Origin is not allowed." }, 403);
  try {
    const admin = await requireSecurityApprovedAdministrator(request, env);
    await enforceAdminServiceRateLimit(request, env, admin.uid, "cloudinary-telemetry");
    const body = await readStrictJsonBody(request, { references: [ASSET_REFERENCE_SCHEMA] });
    const usage = normalizeUsage(await cloudinaryGet("/usage", env), env);
    const references = Array.isArray(body?.references) ? body.references.slice(0, 12) : [];
    const resolved = await Promise.allSettled(references.map((reference) => resolveAssetReference(reference, env)));
    const assets = resolved.filter((item) => item.status === "fulfilled" && item.value).map((item) => item.value);
    const atMs = Date.now();
    const history = usage.credits?.usedPercent == null
      ? []
      : [{ atMs, planUsage: usage.credits, verified: true, source: "cloudinary-worker" }];
    return json({ ...usage, history, assets }, 200, origin);
  } catch (error) {
    return json({
      error: error?.message || "Telemetry request failed.",
      code: String(error?.code || "internal"),
      source: String(error?.source || "worker"),
      retryAt: String(error?.retryAt || "")
    }, Number(error?.status) || 500, origin);
  }
}

export default {
  async fetch(request, env, context) {
    if (request.method === "OPTIONS") return corsPreflight(request, env);
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get("Origin") || "", env);
    if (url.pathname.startsWith("/security/")) return handleSecurityRoute(request, env, url, context);
    if (url.pathname === "/health") return json({
      ok: true,
      service: "lan-cloudinary-telemetry",
      firebaseConfigured: Boolean(String(env.FIREBASE_PROJECT_ID || "").trim()),
      securityCoordinatorConfigured: Boolean(
        env?.SECURITY_COORDINATOR &&
        typeof env.SECURITY_COORDINATOR.idFromName === "function" &&
        typeof env.SECURITY_COORDINATOR.get === "function"
      ),
      cloudinaryConfigured: Boolean(
        String(env.CLOUDINARY_CLOUD_NAME || "").trim() &&
        String(env.CLOUDINARY_API_KEY || "").trim() &&
        String(env.CLOUDINARY_API_SECRET || "").trim()
      ),
      storageOAuthConfigured: Boolean(env?.STORAGE_OAUTH && typeof env.STORAGE_OAUTH.get === "function" && typeof env.STORAGE_OAUTH.put === "function"),
      messagePushConfigured: Boolean(env?.PORTFOLIO_MESSAGES && typeof env.PORTFOLIO_MESSAGES.get === "function" && typeof env.PORTFOLIO_MESSAGES.put === "function"),
      messageSecurityConfigured: Boolean(
        env?.PORTFOLIO_MESSAGES &&
        String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "").trim() &&
        String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim()
      ),
      googleDriveOAuthConfigured: Boolean(
        String(env.GOOGLE_DRIVE_CLIENT_ID || "").trim() &&
        String(env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim()
      ),
      googleDriveRedirectUri: driveRedirectUri(request, env)
    }, 200, origin);
    const messagePuzzleImageMatch = url.pathname.match(/^\/messages\/security\/challenge\/([A-Za-z0-9_-]{24})\/image$/);
    if (messagePuzzleImageMatch && request.method === "GET") return handleMessagePuzzleImage(request, env, messagePuzzleImageMatch[1]);
    if (url.pathname === "/messages/security/challenge" && request.method === "POST") return handleMessagePuzzleChallenge(request, env);
    if (url.pathname === "/messages/security/verify" && request.method === "POST") return handleMessagePuzzleVerify(request, env);
    if (url.pathname === "/messages/public/thread" && request.method === "POST") return handlePublicMessageThreadCreate(request, env);
    if (url.pathname === "/messages/public/send" && request.method === "POST") return handlePublicMessageSend(request, env);
    if (url.pathname === "/messages/public/read" && request.method === "POST") return handlePublicMessageRead(request, env);
    if (url.pathname === "/messages/public/forget" && request.method === "POST") return handlePublicMessageForget(request, env);
    if (url.pathname === "/messages/push/config" && request.method === "GET") return handleMessagePushConfig(request, env);
    if (url.pathname === "/messages/push/register" && request.method === "POST") return handleMessagePushRegister(request, env);
    if (url.pathname === "/messages/push/status" && request.method === "POST") return handleMessagePushStatus(request, env);
    if (url.pathname === "/messages/push/unregister" && request.method === "POST") return handleMessagePushUnregister(request, env);
    if (url.pathname === "/messages/push/reply" && request.method === "POST") return handleMessagePushReply(request, env);
    if (url.pathname === "/messages/push/test" && request.method === "POST") return handleMessagePushTest(request, env);
    if (url.pathname === "/messages/push/ack" && request.method === "POST") return handleMessagePushAck(request, env);
    if (url.pathname === "/messages/push/thread-delete" && request.method === "POST") return handleMessagePushThreadDelete(request, env);
    if (url.pathname === "/telemetry" && request.method === "POST") return handleTelemetry(request, env);
    if (url.pathname === "/media/read" && request.method === "POST") return handleMediaRead(request, env);
    if (url.pathname === "/media/delete" && request.method === "POST") return handleMediaDelete(request, env);
    if (url.pathname === "/storage/google-drive/connect/start" && request.method === "POST") return handleDriveConnectStart(request, env);
    if (url.pathname === "/storage/google-drive/connect/callback" && request.method === "GET") return handleDriveConnectCallback(request, env);
    if (url.pathname === "/storage/google-drive/test" && request.method === "POST") return handleDriveTest(request, env);
    if (url.pathname === "/storage/google-drive/upload-session" && request.method === "POST") return handleDriveUploadSession(request, env);
    if (url.pathname === "/storage/google-drive/upload-content" && request.method === "POST") return handleDriveUploadContent(request, env);
    if (url.pathname === "/storage/google-drive/finalize" && request.method === "POST") return handleDriveFinalize(request, env);
    if (url.pathname === "/storage/google-drive/disconnect" && request.method === "POST") return handleDriveDisconnect(request, env);
    const drivePublicMatch = url.pathname.match(/^\/storage\/google-drive\/public\/([^/]+)\/([^/]+)$/);
    if (drivePublicMatch && request.method === "GET") return handleDrivePublic(request, env, decodeURIComponent(drivePublicMatch[1]), decodeURIComponent(drivePublicMatch[2]), context);
    return json({ error: "Not found." }, 404, origin);
  }
};
