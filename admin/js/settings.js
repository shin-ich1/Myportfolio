await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));

const systemHealth = window.parent?.LANAdminSystemHealth;
if (!systemHealth) {
  throw new Error("Persistent Admin system health owner is unavailable.");
}

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "../services/firebase.js";
import {
  initializeLegacyPortfolio,
  loadInitializationStatus,
  PORTFOLIO_INITIALIZATION_VERSION
} from "../services/portfolioInitializationService.js";
import { loadLegacy, summarizeLegacyContent } from "../../legacyFallbackLoader.js";
import { cloudinaryConfig, firebaseConfig } from "../../config.js";
import { listSections } from "../services/portfolioSectionService.js";
import {
  getModuleLifecycleStatus
} from "../services/moduleLifecycleService.js";
import { createModuleLifecycleConsole } from "./module-console.js";
import {
  loadStorageSettings,
  persistStorageProfileVerification,
  saveStorageDefaults,
  upsertStorageProfile,
  scanStorageProfileUsage,
  scanStorageUsageByProfile
} from "../services/storageSettingsService.js";
import { removeConnectedStorageProfile } from "../services/storageProfileLifecycleService.js";
import { createStorageProfileId, getStorageProfiles, getStorageProvider, registerStorageProvider, setStorageRegistrySnapshot } from "../services/storageProviderRegistry.js";
import { googleDriveStorageProvider } from "../services/storageProviders/googleDriveStorageProvider.js";
import { cloudinaryStorageProvider } from "../services/storageProviders/cloudinaryStorageProvider.js";
import { workerBridgeUrl } from "../services/storageBridgeService.js";
import { buildStorageTelemetry } from "../services/storageTelemetryService.js";
import { normalizeStorageAsset, storageAssetIdentityTokens, storageAssetUrl } from "../../storage-asset.js";
import { resolveAssetUrl } from "../../asset-resolver.js";
import { buildSettingsTelemetryFeatureDescriptors } from "./settings-telemetry-modules.js";
import { NAVIGATION_ICON_MAP, renderSystemIcon } from "../../icon-registry.js";
import { createQrMatrix } from "./qr-code.js";
import {
  buildDashboardGreeting,
  getDashboardGreetingName,
  saveDashboardGreetingName,
  sanitizeGreetingName,
  getPortfolioPassName,
  savePortfolioPassName,
  sanitizePortfolioPassName
} from "./dashboardGreeting.js";

const $ = (id) => document.getElementById(id);
const COLLECTIONS = ["experiences", "projects", "photoEditingProjects", "education", "skills", "certificates", "resumes", "portfolioSectionEntries", "portfolioSections"];
const SINGLETONS = [
  ["portfolio", "home"], ["portfolio", "profile"], ["portfolio", "contact"], ["portfolio", "initialization"]
];
const state = { latestReport: null, lastSync: null, health: [], healthScannedAt: 0, startupErrors: [], systemSnapshot: null };
const DASHBOARD_VISUAL_KEY = "lan-cms-dashboard-visual";
const DASHBOARD_VISUAL_NAME_KEY = "lan-cms-dashboard-visual-name";
const DASHBOARD_VISUAL_MODE_KEY = "lan-cms-dashboard-visual-mode";
const DEFAULT_DASHBOARD_VISUAL = "../../assets/images/editor-workstation.png";
const SIDEBAR_STATUS_VISIBLE_KEY = "lan-cms-sidebar-status-visible";

const STORAGE_FAMILIES = Object.freeze(["image", "video", "document", "file"]);
let storageHubSettings = null;
let storageHubUsage = new Map();
let storageHubTelemetry = null;
let storageConnectState = null;

registerStorageProvider(cloudinaryStorageProvider);
registerStorageProvider(googleDriveStorageProvider);

function storageHubEscape(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function formatStorageHubBytes(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
function storageProfileDefaultFamilies(profileId = "") {
  return STORAGE_FAMILIES.filter((family) => storageHubSettings?.defaults?.[family] === profileId);
}
function storageHubQuotaLabel(profileId = "") {
  const providerTelemetry = storageHubTelemetry?.providers?.find((item) => item.profileId === profileId);
  const quota = providerTelemetry?.quota || {};
  if (!quota.available) return "Unavailable";
  if (quota.unit === "credits") {
    const used = Number.isFinite(Number(quota.usage)) ? Number(quota.usage) : null;
    const limit = Number.isFinite(Number(quota.limit)) ? Number(quota.limit) : null;
    if (used != null && limit != null) return `${used.toFixed(used % 1 ? 1 : 0)} / ${limit.toFixed(limit % 1 ? 1 : 0)} credits`;
    if (used != null) return `${used.toFixed(used % 1 ? 1 : 0)} credits used`;
    return "Credits available";
  }
  if (quota.unit === "bytes") {
    if (quota.usage != null && quota.limit != null) return `${formatStorageHubBytes(quota.usage)} / ${formatStorageHubBytes(quota.limit)}`;
    if (quota.usage != null) return `${formatStorageHubBytes(quota.usage)} used`;
  }
  return "Available";
}

function storageHubProfileMarkup(profile = {}) {
  const usage = storageHubUsage.get(profile.id) || { assetCount: 0, bytes: 0 };
  const defaults = storageProfileDefaultFamilies(profile.id);
  const quotaLabel = storageHubQuotaLabel(profile.id);
  const drive = profile.provider === "google-drive";
  const connectionHealthy = profile.usageSnapshot?.healthy !== false;
  const ready = drive ? profile.publicReady === true : profile.enabled !== false;
  const stateLabel = profile.enabled === false
    ? "Disabled"
    : !connectionHealthy
      ? "Reconnect required"
      : ready
        ? "Ready"
        : drive
          ? "Public access required"
          : "Connected";
  const rootHelp = drive && !connectionHealthy
    ? "Existing public assets remain deliverable from the shared Drive folder. Reconnect this profile to restore uploads, quota checks and management operations."
    : drive && !ready
      ? "Open the managed folder, set General access to Anyone with the link · Viewer, then Test Public Access."
      : "Existing assets remain owned by this provider.";
  const managementButton = drive || profile.managementUrl ? `<button class="editor-secondary-button button-compact" data-storage-action="open" data-storage-profile="${storageHubEscape(profile.id)}" type="button">Open ${drive ? "Folder" : "Provider"}</button>` : "";
  const removeButton = profile.implicit ? "" : `<button class="editor-danger-button button-compact" data-storage-action="remove" data-storage-profile="${storageHubEscape(profile.id)}" type="button">Remove Storage</button>`;
  const testLabel = drive ? (connectionHealthy ? "Test Public Access" : "Reconnect Google Drive") : "Test Connection";
  return `<article class="storage-hub-profile" data-storage-provider="${storageHubEscape(profile.provider)}" data-storage-profile-card="${storageHubEscape(profile.id)}"><header><span><small>${storageHubEscape(profile.provider === "google-drive" ? "Google Drive" : profile.provider)}</small><strong>${storageHubEscape(profile.label || profile.id)}</strong></span><b data-storage-ready="${ready && connectionHealthy}">${storageHubEscape(stateLabel)}</b></header><div class="storage-hub-profile-metrics"><span><small>Managed assets</small><strong>${Number(usage.assetCount) || 0}</strong></span><span><small>Tracked storage</small><strong>${storageHubEscape(formatStorageHubBytes(usage.bytes))}</strong></span><span><small>Provider quota</small><strong data-storage-quota="${storageHubEscape(profile.id)}">${storageHubEscape(quotaLabel)}</strong></span></div><p>${storageHubEscape(rootHelp)}</p><div class="storage-hub-profile-defaults"><small>Default for</small><strong>${defaults.length ? storageHubEscape(defaults.join(" · ")) : "None"}</strong></div><footer><button class="editor-secondary-button button-compact" data-storage-action="test" data-storage-profile="${storageHubEscape(profile.id)}" type="button">${testLabel}</button>${managementButton}${removeButton}</footer></article>`;
}
async function refreshStorageHubUsage(profiles = []) {
  const ids = profiles.map((profile) => profile.id).filter(Boolean);
  storageHubUsage = await scanStorageUsageByProfile(ids);
  return storageHubUsage;
}
function syncStorageDefaultControls() {
  const profiles = getStorageProfiles().filter((profile) => profile.enabled !== false);
  document.querySelectorAll("[data-storage-default-family]").forEach((select) => {
    const family = select.dataset.storageDefaultFamily;
    select.innerHTML = profiles.map((profile) => `<option value="${storageHubEscape(profile.id)}">${storageHubEscape(profile.label)}</option>`).join("");
    select.value = storageHubSettings?.defaults?.[family] || profiles[0]?.id || "";
  });
}
function buildStorageHubTelemetrySnapshot(profiles = getStorageProfiles()) {
  const records = [...storageHubUsage.values()].flatMap((usage) => Array.isArray(usage?.references) ? usage.references : []);
  const providerUsage = Object.fromEntries(profiles.map((profile) => [profile.id, profile.usageSnapshot || {}]));
  const cloudinaryProfile = profiles.find((profile) => profile.provider === "cloudinary");
  if (cloudinaryProfile && cloudinaryTelemetryState?.usage) providerUsage[cloudinaryProfile.id] = cloudinaryTelemetryState.usage;
  storageHubTelemetry = buildStorageTelemetry({ profiles, records, providerUsage });
  syncStorageHubTelemetryLabels();
  return storageHubTelemetry;
}

function syncStorageHubTelemetryLabels() {
  document.querySelectorAll("[data-storage-quota]").forEach((node) => {
    node.textContent = storageHubQuotaLabel(node.dataset.storageQuota || "");
  });
}

function paintStorageHub(profiles = getStorageProfiles()) {
  buildStorageHubTelemetrySnapshot(profiles);
  const markup = profiles.length ? profiles.map(storageHubProfileMarkup).join("") : '<div class="lan-empty-state"><strong>No storage connected.</strong><p>Connect a storage provider to accept new uploads.</p></div>';
  const host = $("storageHubProfiles"); if (host) host.innerHTML = markup;
  syncStorageDefaultControls();
}

export async function renderStorageHub() {
  storageHubSettings = await loadStorageSettings();
  setStorageRegistrySnapshot(storageHubSettings);
  const profiles = getStorageProfiles();

  // Storage controls are local UI and must never wait for provider usage scans.
  // Paint the registry/defaults first, then hydrate remote usage independently.
  paintStorageHub(profiles);
  const hydrateUsage = () => refreshStorageHubUsage(profiles).then(() => {
    // Remote usage telemetry is deliberately outside the interactive control path.
    // Hydration updates provider cards only after the browser has had an idle turn,
    // so opening/changing a default selector cannot race a storage scan repaint.
    buildStorageHubTelemetrySnapshot(profiles);
    const markup = profiles.length ? profiles.map(storageHubProfileMarkup).join("") : '<div class="lan-empty-state"><strong>No storage connected.</strong><p>Connect a storage provider to accept new uploads.</p></div>';
    const host = $("storageHubProfiles"); if (host) host.innerHTML = markup;
  }).catch((error) => {
    console.error("Storage Hub usage scan failed.", error);
  });
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(hydrateUsage, { timeout: 2500 });
  else window.setTimeout(hydrateUsage, 400);
  return storageHubSettings;
}

function canonicalPublicPortfolioTarget() {
  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  const source = new URL("../../index.html", import.meta.url);
  const local = localHosts.has(source.hostname) || source.protocol === "file:";
  return Object.freeze({
    url: source.href,
    local,
    ready: !local && source.protocol === "https:",
    host: source.host || "Local preview"
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function qrLanAccentMask(row, col, count) {
  // LΛN is expressed only through the colour of modules that already belong to
  // the QR matrix. No module is added, removed, or covered, so branding never
  // changes the encoded payload or protected QR structures.
  const glyphs = [
    ["1000", "1000", "1000", "1000", "1000", "1000", "1111"],
    ["0110", "1001", "1001", "1111", "1001", "1001", "1001"],
    ["1001", "1101", "1101", "1011", "1011", "1001", "1001"]
  ];
  const glyphWidth = 4;
  const gap = 1;
  const patternWidth = glyphs.length * glyphWidth + (glyphs.length - 1) * gap;
  const patternHeight = 7;
  const unit = Math.max(1, Math.floor(Math.min(count * 0.46 / patternWidth, count * 0.32 / patternHeight)));
  const width = patternWidth * unit;
  const height = patternHeight * unit;
  const left = Math.floor((count - width) / 2);
  const top = Math.floor((count - height) / 2);
  if (col < left || col >= left + width || row < top || row >= top + height) return false;
  const localX = Math.floor((col - left) / unit);
  const localY = Math.floor((row - top) / unit);
  const stride = glyphWidth + gap;
  const glyphIndex = Math.floor(localX / stride);
  const glyphX = localX % stride;
  if (glyphIndex < 0 || glyphIndex >= glyphs.length || glyphX >= glyphWidth) return false;
  return glyphs[glyphIndex][localY]?.[glyphX] === "1";
}

function drawPublicPortfolioQr(canvas, url, size = 1200) {
  if (!canvas || !url) return;
  const matrix = createQrMatrix(url);
  const quiet = 5;
  const count = matrix.length;
  const units = count + quiet * 2;
  const outer = Math.round(size * 0.045);
  const codeArea = size - outer * 2;
  const scale = Math.max(1, Math.floor(codeArea / units));
  const drawn = scale * units;
  const codeX = Math.floor((size - drawn) / 2);
  const codeY = codeX;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Dark-blue portfolio identity. The frame is decorative and stays outside
  // the protected white QR plate / quiet zone.
  const shell = ctx.createRadialGradient(size * 0.18, size * 0.12, 0, size * 0.52, size * 0.5, size * 0.9);
  shell.addColorStop(0, "#0b3158");
  shell.addColorStop(0.38, "#071f3a");
  shell.addColorStop(0.72, "#061426");
  shell.addColorStop(1, "#040b17");
  ctx.fillStyle = shell;
  ctx.fillRect(0, 0, size, size);

  const accent = ctx.createLinearGradient(0, 0, size, size);
  accent.addColorStop(0, "#27c2ff");
  accent.addColorStop(0.5, "#1677e8");
  accent.addColorStop(1, "#344fc8");
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(3, Math.round(size * 0.006));
  roundedRect(ctx, outer * 0.42, outer * 0.42, size - outer * 0.84, size - outer * 0.84, Math.round(size * 0.045));
  ctx.stroke();

  const platePad = Math.round(size * 0.018);
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, codeX - platePad, codeY - platePad, drawn + platePad * 2, drawn + platePad * 2, Math.round(size * 0.025));
  ctx.fill();

  // Keep the functional QR pristine. Branding lives in the dark-blue shell;
  // every active QR module uses the same high-contrast portfolio navy.
  ctx.fillStyle = "#031426";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!matrix[row][col]) continue;
      ctx.fillRect(codeX + (col + quiet) * scale, codeY + (row + quiet) * scale, scale, scale);
    }
  }

}

function initializePublicPortfolioQr() {
  const canvas = $("publicPortfolioQrCanvas");
  if (!canvas) return;
  const target = canonicalPublicPortfolioTarget();
  drawPublicPortfolioQr(canvas, target.url);
  const label = $("publicPortfolioQrUrl");
  if (label) label.textContent = target.local ? "Local preview · not publicly accessible" : target.host;
  const status = $("publicPortfolioQrStatus");
  if (status) {
    status.textContent = target.ready ? "Public · Ready" : "Local Preview";
    status.dataset.ready = String(target.ready);
  }
  const downloadButton = $("downloadPublicPortfolioQrButton");
  if (downloadButton) {
    downloadButton.disabled = false;
    downloadButton.title = target.ready ? "Download the production portfolio QR" : "Download this local-preview QR for testing";
  }
  $("openPublicPortfolioQrButton")?.addEventListener("click", () => window.open(target.url, "_blank", "noopener,noreferrer"));
  downloadButton?.addEventListener("click", () => {
    const exportCanvas = document.createElement("canvas");
    drawPublicPortfolioQr(exportCanvas, target.url, 2000);
    const link = document.createElement("a");
    link.download = target.ready ? "LAN-Public-Portfolio-QR.png" : "LAN-Public-Portfolio-QR-LOCAL-PREVIEW.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });
}

function resolveExpectedWorkerOrigin() {
  const endpoint = workerBridgeUrl("/");
  try { return new URL(endpoint).origin; } catch { return ""; }
}
function setGoogleDriveSetupStatus(id, ready, readyLabel, missingLabel) {
  const node = $(id);
  if (!node) return;
  node.textContent = ready ? readyLabel : missingLabel;
  node.dataset.ready = String(Boolean(ready));
}
export async function showGoogleDriveSetup(setup = null) {
  const panel = $("googleDriveSetupPanel");
  if (!panel) return null;
  let readiness = setup;
  if (!readiness) {
    try { readiness = await googleDriveStorageProvider.getConnectionReadiness(); }
    catch (error) {
      readiness = { ready: false, storageOAuthConfigured: false, googleDriveOAuthConfigured: false, redirectUri: workerBridgeUrl("/storage/google-drive/connect/callback"), workerReachable: false, error: error.message };
    }
  }
  setGoogleDriveSetupStatus("googleDriveSetupKvStatus", readiness.storageOAuthConfigured, "Ready", "Missing STORAGE_OAUTH binding");
  setGoogleDriveSetupStatus("googleDriveSetupOAuthStatus", readiness.googleDriveOAuthConfigured, "Ready", "Client ID / Secret not configured");
  const callback = $("googleDriveSetupCallback");
  if (callback) callback.textContent = readiness.redirectUri || workerBridgeUrl("/storage/google-drive/connect/callback") || "Worker callback unavailable";
  const commands = $("googleDriveSetupCommands");
  if (commands) commands.textContent = "npx.cmd wrangler secret put GOOGLE_DRIVE_CLIENT_ID\nnpx.cmd wrangler secret put GOOGLE_DRIVE_CLIENT_SECRET";
  panel.hidden = false;
  const chooser = $("storageProviderChooser");
  if (chooser) chooser.hidden = true;
  return readiness;
}
function hideGoogleDriveSetup() {
  const panel = $("googleDriveSetupPanel");
  if (panel) panel.hidden = true;
}
async function handleGoogleDriveConnectRequest() {
  try {
    const result = await connectGoogleDriveStorage();
    hideGoogleDriveSetup();
    return result;
  } catch (error) {
    if (error?.code === "google-drive-setup-required") {
      await showGoogleDriveSetup(error.setup);
      window.LANNotice?.({ title: "Google Drive setup required", message: "Finish the secure Worker setup shown in Storage Hub, then check again.", tone: "warning" });
      return null;
    }
    throw error;
  }
}

export async function connectGoogleDriveStorage() {
  const profileId = createStorageProfileId("google-drive");
  const started = await googleDriveStorageProvider.startConnection(profileId);
  if (!started?.authorizationUrl || !started?.state) throw new Error("Google Drive authorization could not start.");
  storageConnectState = { profileId, state: started.state, origin: resolveExpectedWorkerOrigin() };
  const popup = window.open(started.authorizationUrl, "lan-google-drive-connect", "popup=yes,width=620,height=760");
  if (!popup) throw new Error("Allow pop-ups for this Admin page, then connect Google Drive again.");
  return started;
}
async function handleStorageConnectionMessage(event) {
  const expectedWorkerOrigin = storageConnectState?.origin || resolveExpectedWorkerOrigin();
  if (!expectedWorkerOrigin || event.origin !== expectedWorkerOrigin) return;
  const payload = event.data || {};
  if (payload.type !== "lan-storage-google-drive-connected" || !storageConnectState || payload.profileId !== storageConnectState.profileId) return;
  const emailAddress = String(payload.account?.emailAddress || "").trim();
  const displayName = String(payload.account?.displayName || "").trim();
  const fallbackSuffix = payload.profileId.slice(-8);
  const label = emailAddress ? `Google Drive · ${emailAddress}` : displayName ? `Google Drive · ${displayName}` : `Google Drive · ${fallbackSuffix}`;
  await upsertStorageProfile(payload.profileId, { provider: "google-drive", label, enabled: true, purpose: "public-storage", rootFolderId: payload.rootFolderId || "", rootFolderName: payload.rootFolderName || "LΛN Portfolio CMS - Public Storage", managementUrl: payload.managementUrl || "", publicReady: payload.publicReady === true, account: payload.account || null, usageSnapshot: { healthy: true, status: "healthy", code: "", message: "", account: payload.account || null, updatedAt: new Date().toISOString() } });
  storageConnectState = null;
  await renderStorageHub();
  await refreshSystemHealthAfterStorageVerification();
  window.LANNotice?.({ title: "Google Drive connected", message: "Open the managed folder, set Anyone with the link to Viewer, then run Test Public Access.", tone: "success" });
}
async function refreshSystemHealthAfterStorageVerification() {
  return systemHealth.runSystemDiagnostics({ includeSupporting: true, forceLive: false });
}

export async function testStorageProfilePublicAccess(profileId) {
  const profile = getStorageProfiles().find((item) => item.id === profileId);
  if (!profile) throw new Error("Storage profile was not found.");
  const provider = getStorageProvider(profile.provider);
  if (!provider?.testConnection) throw new Error("Storage provider does not support connection testing.");
  if (profile.provider === "google-drive") {
    let result;
    try {
      result = await provider.testConnection(profile);
    } catch (error) {
      const reconnectCodes = new Set(["google-drive-not-connected", "google-drive-refresh-missing", "google-drive-reconnect-required"]);
      await persistStorageProfileVerification(profile, { healthy: false, code: error?.code, message: error?.message });
      await renderStorageHub();
      await refreshSystemHealthAfterStorageVerification();
      if (!reconnectCodes.has(String(error?.code || ""))) throw error;
      const started = await provider.startConnection(profile.id);
      if (!started?.authorizationUrl || !started?.state) throw error;
      storageConnectState = { profileId: profile.id, state: started.state, origin: resolveExpectedWorkerOrigin() };
      const popup = window.open(started.authorizationUrl, "lan-google-drive-reconnect", "popup=yes,width=620,height=760");
      if (!popup) { storageConnectState = null; throw new Error("Allow pop-ups for this Admin page, then reconnect Google Drive again."); }
      window.LANNotice?.({ title: "Google Drive authorization required", message: "Google sign-in opened to restore this existing storage profile. Existing public assets remain available while the management authorization is restored.", tone: "warning" });
      return { reconnecting: true, profileId: profile.id };
    }
    await persistStorageProfileVerification(profile, { healthy: true, result });
    await renderStorageHub();
    await refreshSystemHealthAfterStorageVerification();
    window.LANNotice?.({ title: result.publicReady ? "Google Drive ready" : "Public access not ready", message: result.publicReady ? "The managed folder can serve Public Portfolio assets." : "Set the managed folder to Anyone with the link · Viewer and test again.", tone: result.publicReady ? "success" : "warning" });
    return result;
  }
  try {
    const result = await provider.testConnection(profile);
    await persistStorageProfileVerification(profile, { healthy: result?.ok !== false, result });
    await renderStorageHub();
    await refreshSystemHealthAfterStorageVerification();
    window.LANNotice?.({ title: "Storage connection", message: result?.ok === false ? "Connection requires attention." : "Storage connection is available.", tone: result?.ok === false ? "warning" : "success" });
    return result;
  } catch (error) {
    await persistStorageProfileVerification(profile, { healthy: false, code: error?.code, message: error?.message });
    await renderStorageHub();
    await refreshSystemHealthAfterStorageVerification();
    throw error;
  }
}
export function openStorageProfile(profileId) {
  const profile = getStorageProfiles().find((item) => item.id === profileId);
  if (!profile) return;
  const provider = getStorageProvider(profile.provider);
  const url = provider?.getManagementUrl?.(profile) || profile.managementUrl;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
export async function removeStorageProfile(profileId) {
  const usage = storageHubUsage.get(profileId) || await scanStorageProfileUsage(profileId);
  if (usage.assetCount > 0) throw new Error(`${usage.assetCount} managed asset${usage.assetCount === 1 ? "" : "s"} still depend on this storage.`);
  const defaults = storageProfileDefaultFamilies(profileId);
  if (defaults.length) throw new Error(`Choose a new default storage for: ${defaults.join(", ")}.`);
  const ok = await confirmAction({ title: "Remove storage connection?", message: "This disconnects the storage profile from the CMS. Remote folders and files are not deleted.", confirmLabel: "Remove Storage", danger: true });
  if (!ok) return false;
  await removeConnectedStorageProfile(profileId);
  await renderStorageHub();
  window.LANNotice?.({ title: "Storage removed", message: "The connection was removed. Remote files were preserved.", tone: "success" });
  return true;
}

let telemetryChartFrame = 0;
let telemetryRealtimeUnsubscribers = [];
let telemetryRealtimeModules = new Map();
let telemetryFeatureSections = [];
let telemetryFeatureEntries = [];
let telemetryMetric = "spectrum";
let telemetryPrimarySeries = "published";
let telemetryLiveModel = null;
let telemetryLiveStartedAt = 0;
let telemetryScaleMode = "auto";
let telemetryManualScaleMax = null;
let telemetryResolvedScaleMax = 100;
let telemetryRenderedModules = [];
let telemetryMediaRequestFrame = 0;
let telemetryHistory = [];
let telemetryRemoteStorageHistory = [];
let telemetryHistoryKey = "";
let telemetryStreamLastSampleAt = 0;
let telemetryPendingEvents = { storage: null, records: null };
let telemetryPendingStorageSource = null;
let telemetryModuleBaseline = new Map();
let telemetryBaselineReady = false;
let telemetryAccountBaseline = null;
let cloudinaryUsageRefreshTimer = 0;
let telemetryLegendSignature = "";
let telemetryScanMetricKey = "";
let telemetryScanVisiblePoints = [];
let telemetryScanActiveModule = "";
let telemetryFlowTargetPoints = [];
let telemetryFlowScale = { min: -100, max: 100 };
let telemetryFlowStartedAt = 0;
let telemetryAutoFollowHover = false;
let telemetryAutoFollowPausedUntil = 0;
const TELEMETRY_PRIMARY_SERIES_KEY = "lan-cms-telemetry-primary-series";
const TELEMETRY_PRIMARY_COLORS = Object.freeze({ published: "var(--telemetry-published)", draft: "var(--telemetry-draft)", storage: "var(--telemetry-storage)" });
const TELEMETRY_PRIMARY_LABELS = Object.freeze({ published: "Published", draft: "Draft", storage: "Storage" });
const TELEMETRY_PROFILE_TRANSITION_MS = 900;
const TELEMETRY_FLOW_MODULE_MS = 1200;
const TELEMETRY_FLOW_SIGMA = 0.62;
const CLOUDINARY_CONSOLE_STATE_KEY = "lan-cms-cloudinary-console-v3";
let cloudinaryConsoleDrag = null;
const TELEMETRY_HISTORY_LENGTH = 320;
const TELEMETRY_SAMPLE_MS = 650;
const CLOUDINARY_REFRESH_MS = 5 * 60 * 1000;
const CLOUDINARY_FAILURE_RETRY_MS = 5 * 60 * 1000;
const TELEMETRY_STORAGE_WINDOW_MS = 2 * 60 * 1000;
const TELEMETRY_RECORDS_WINDOW_MS = 45 * 1000;
const TELEMETRY_HISTORY_STORAGE_PREFIX = "lan-cms-telemetry-history-v2";
const TELEMETRY_AUTO_SCALE_LEVELS = Object.freeze([1, 2, 5, 10, 25, 50, 75, 100]);
const TELEMETRY_SERIES_COLORS = Object.freeze({
  projects: "#38bdf8",
  photoEditingProjects: "#a855f7",
  experiences: "#22c55e",
  education: "#f59e0b",
  skills: "#06b6d4",
  certificates: "#eab308",
  resumes: "#ef4444"
});
const TELEMETRY_SERIES_FALLBACK = Object.freeze(["#3b82f6", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#84cc16", "#f43f5e", "#0ea5e9"]);
const TELEMETRY_PLOT = Object.freeze({ width: 700, height: 190, left: 4, right: 696, top: 22, bottom: 154 });
const TELEMETRY_MODULE_SLOT_PX = 118;
const TELEMETRY_MODULE_EDGE_PX = 12;
const TELEMETRY_FOLLOW_FOCUS_RATIO = 0.78;
const TELEMETRY_FOLLOW_EASE = 0.14;
const TELEMETRY_FOLLOW_INTERACTION_PAUSE_MS = 2200;
const mediaTelemetryState = { resolvedAssets: new Map(), attempted: new Set(), pending: new Set() };
let cloudinaryTelemetryState = { available: null, pending: false, usage: null, lastFailureAt: 0, updatedAt: 0, errorCode: "", errorMessage: "", retryAt: 0 };
const CORE_TELEMETRY_MODULES = Object.freeze([
  Object.freeze({ key: "projects", collection: "projects", label: "Projects", iconName: NAVIGATION_ICON_MAP.projects }),
  Object.freeze({ key: "photoEditingProjects", collection: "photoEditingProjects", label: "Photos", iconName: NAVIGATION_ICON_MAP.photo }),
  Object.freeze({ key: "experiences", collection: "experiences", label: "Experience", iconName: NAVIGATION_ICON_MAP.experience }),
  Object.freeze({ key: "education", collection: "education", label: "Education", iconName: NAVIGATION_ICON_MAP.education }),
  Object.freeze({ key: "skills", collection: "skills", label: "Skills", iconName: NAVIGATION_ICON_MAP.skills }),
  Object.freeze({ key: "certificates", collection: "certificates", label: "Certificates", iconName: NAVIGATION_ICON_MAP.certificates }),
  Object.freeze({ key: "resumes", collection: "resumes", label: "Resumes", iconName: NAVIGATION_ICON_MAP.resume })
]);

window.addEventListener("error", (event) => state.startupErrors.push(event.message || "Unknown error"));
window.addEventListener("unhandledrejection", (event) => state.startupErrors.push(event.reason?.message || String(event.reason || "Unhandled rejection")));

function setText(id, value) {
  const display = value ?? "—";
  const node = $(id);
  if (node) node.textContent = display;
  document.querySelectorAll(`[data-settings-mirror="${id}"]`).forEach((mirror) => {
    mirror.textContent = display;
  });
}
function setBusy(button, busy, label) { if (!button) return; if (!button.dataset.label) button.dataset.label = button.textContent; button.disabled = busy; button.textContent = busy ? label : button.dataset.label; }
function formatDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}
function download(name, content, type = "application/json") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function log(message) {
  const list = $("initializationLog"); if (!list) return;
  if (list.children.length === 1 && list.firstElementChild?.textContent?.includes("No initialization")) list.innerHTML = "";
  const li = document.createElement("li"); li.textContent = `${new Date().toLocaleTimeString()} — ${message}`; list.prepend(li);
}

async function confirmAction({ title, message, confirmLabel = "Continue", danger = false }) {
  if (typeof window.LANConfirm === "function") {
    return window.LANConfirm({ title, message, confirmLabel, danger });
  }
  return false;
}

function setPortfolioOperation({ state: operationState = "idle", kicker, title, message, percent = null } = {}) {
  const stage = $("portfolioOperationStage");
  const pipeline = $("settingsPipelineEngine");
  if (stage) stage.dataset.state = operationState;
  if (pipeline) pipeline.dataset.state = operationState;
  if (kicker) setText("portfolioOperationKicker", kicker);
  if (title) setText("portfolioOperationTitle", title);
  if (message) setText("portfolioOperationMessage", message);

  const percentNode = $("portfolioOperationPercent");
  if (percentNode) {
    percentNode.textContent = Number.isFinite(percent) ? `${Math.max(0, Math.min(100, Math.round(percent)))}%` : (operationState === "idle" ? "Ready" : operationState === "success" ? "Done" : operationState === "error" ? "Issue" : "Working");
  }
  setText("pipelineAdminState", operationState === "working" ? "Processing" : operationState === "success" ? "Verified" : operationState === "error" ? "Attention" : "Ready");
  setText("pipelinePublicState", operationState === "working" ? "Receiving verification pulse" : operationState === "success" ? "Publication state verified" : operationState === "error" ? "Verification interrupted" : "Waiting for verification");
}

function updateGreetingPreview(value) {
  const name = sanitizeGreetingName(value || getDashboardGreetingName("Rolando"), "Rolando");
  const greeting = buildDashboardGreeting(name, new Date());
  setText("settingsGreetingPreview", greeting);
  setText("previewGreetingMirror", greeting);
}

function loadGreetingPreference() {
  const name = getDashboardGreetingName("Rolando");
  if ($("dashboardGreetingName")) $("dashboardGreetingName").value = name;
  updateGreetingPreview(name);
}

function saveGreetingPreference() {
  const input = $("dashboardGreetingName");
  if (!input) return;
  const name = saveDashboardGreetingName(input.value);
  input.value = name;
  updateGreetingPreview(name);
  window.dispatchEvent(new CustomEvent("lan:admin-identity-change", { detail: { displayName: name } }));
  window.LANNotice?.({ title: "Dashboard identity", message: `Admin display name saved as ${name}.`, tone: "success" });
}


function updatePortfolioPassNamePreview(value) {
  const name = sanitizePortfolioPassName(value || getPortfolioPassName("LΛN"), "LΛN");
  document.querySelectorAll("[data-portfolio-pass-name-preview]").forEach((node) => { node.textContent = name; });
}

function loadPortfolioPassNamePreference() {
  const name = getPortfolioPassName("LΛN");
  if ($("portfolioPassName")) $("portfolioPassName").value = name;
  updatePortfolioPassNamePreview(name);
}

function savePortfolioPassNamePreference() {
  const input = $("portfolioPassName");
  if (!input) return;
  const name = savePortfolioPassName(input.value);
  input.value = name;
  updatePortfolioPassNamePreview(name);
  window.dispatchEvent(new CustomEvent("lan:portfolio-pass-name-change", { detail: { name } }));
  window.LANNotice?.({ title: "Portfolio Pass", message: `Portfolio Pass name saved as ${name}.`, tone: "success" });
}

function loadSidebarStatusPreference() {
  const control = $("sidebarPortfolioStatusPreference");
  if (!control) return;
  let visible = true;
  try { visible = localStorage.getItem(SIDEBAR_STATUS_VISIBLE_KEY) !== "false"; } catch (error) { visible = true; }
  control.checked = visible;
}

function saveSidebarStatusPreference(visible) {
  try { localStorage.setItem(SIDEBAR_STATUS_VISIBLE_KEY, String(Boolean(visible))); } catch (error) {}
  window.dispatchEvent(new CustomEvent("lan:sidebar-status-visibility", { detail: { visible: Boolean(visible) } }));
}

function loadDashboardVisualPreference() {
  const preview = $("dashboardVisualPreview");
  if (!preview) return;
  let saved = "";
  let name = "";
  try {
    saved = localStorage.getItem(DASHBOARD_VISUAL_KEY) || "";
    name = localStorage.getItem(DASHBOARD_VISUAL_NAME_KEY) || "";
  } catch (error) {
    saved = "";
  }
  const source = saved || DEFAULT_DASHBOARD_VISUAL;
  const mode = saved ? (localStorage.getItem(DASHBOARD_VISUAL_MODE_KEY) || "subject") : "default";
  if (preview) preview.src = source;
  const frame = preview?.closest(".dashboard-visual-preview");
  if (frame) frame.dataset.visualMode = mode;
  setText("dashboardVisualName", name || "Default editor workstation");
  setText("dashboardVisualStatus", saved ? "Custom Admin Dashboard picture is active." : "Using the default Admin Dashboard image.");
}

function composeDashboardVisual(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) { reject(new Error("Choose a PNG, JPG, or WebP image.")); return; }
    if (file.size > 16 * 1024 * 1024) { reject(new Error("Choose an image smaller than 16 MB.")); return; }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("The selected file is not a valid image."));
      image.onload = () => {
        /* Dashboard media is now stored as one clean, aspect-preserved source.
           The Dashboard owns placement. We never bake a 16:9 blur, zoom copy,
           stretched edge strip, sampled-color side panel, or theme surface into
           the saved image. */
        const maxDimension = 1600;
        const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
        const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
        const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("The browser could not prepare the Dashboard picture.")); return; }
        context.drawImage(image, 0, 0, width, height);

        let quality = .9;
        let dataUrl = canvas.toDataURL("image/webp", quality);
        while (dataUrl.length > 2500000 && quality > .6) {
          quality -= .06;
          dataUrl = canvas.toDataURL("image/webp", quality);
        }
        if (dataUrl.length > 3400000) {
          reject(new Error("The image is still too large after optimization. Choose a smaller image."));
          return;
        }
        resolve({ dataUrl, mode: "source-v2" });
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

async function saveDashboardVisual(file) {
  const button = $("changeDashboardVisualButton");
  setBusy(button, true, "Preparing…");
  setText("dashboardVisualStatus", "Optimizing the Admin Dashboard picture…");
  try {
    const composed = await composeDashboardVisual(file);
    localStorage.setItem(DASHBOARD_VISUAL_KEY, composed.dataUrl);
    localStorage.setItem(DASHBOARD_VISUAL_NAME_KEY, file.name || "Custom dashboard image");
    localStorage.setItem(DASHBOARD_VISUAL_MODE_KEY, composed.mode);
    loadDashboardVisualPreference();
    window.LANNotice?.({ title: "Dashboard appearance", message: "Admin Dashboard picture updated. The public portfolio was not changed.", tone: "success" });
  } catch (error) {
    setText("dashboardVisualStatus", error.message || "Dashboard picture could not be updated.");
    window.LANNotice?.({ title: "Dashboard appearance", message: error.message || "Dashboard picture could not be updated.", tone: "error" });
  } finally {
    setBusy(button, false);
  }
}

function resetDashboardVisual() {
  try {
    localStorage.removeItem(DASHBOARD_VISUAL_KEY);
    localStorage.removeItem(DASHBOARD_VISUAL_NAME_KEY);
    localStorage.removeItem(DASHBOARD_VISUAL_MODE_KEY);
  } catch (error) {
    console.debug("Dashboard visual preference could not be cleared.", error);
  }
  loadDashboardVisualPreference();
  window.LANNotice?.({ title: "Dashboard appearance", message: "Default Admin Dashboard picture restored.", tone: "success" });
}

function applyTheme(preference) {
  if (!window.LANTheme?.applyTheme) return;
  window.LANTheme.applyTheme(preference);
}
function syncThemeChoices(preference) {
  const resolved = document.documentElement.dataset.theme || window.LANTheme?.resolveTheme?.(preference) || "dark";
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === preference;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    if (button.dataset.themeChoice === "system") {
      button.setAttribute("title", `Follow device appearance (currently ${resolved})`);
    }
  });
  const label = preference === "system"
    ? `System · ${resolved.charAt(0).toUpperCase() + resolved.slice(1)}`
    : preference.charAt(0).toUpperCase() + preference.slice(1);
  setText("themeModeLabel", label);
}
function syncAppearancePreview() {
  const preview = $("appearanceLivePreview");
  if (!preview) return;
  const preference = window.LANTheme?.getPreference?.() || "system";
  const resolved = document.documentElement.dataset.cmsThemeResolved || document.documentElement.dataset.theme || "dark";
  preview.dataset.previewTheme = preference === "system" ? resolved : preference;
  preview.dataset.previewCompact = String(localStorage.getItem("lan-cms-compact") === "true");
  preview.dataset.previewMotion = String(localStorage.getItem("lan-cms-reduced-motion") !== "true");
}
function applyPreferences() {
  const theme = window.LANTheme?.getPreference?.() || "system";
  const reduced = localStorage.getItem("lan-cms-reduced-motion") === "true";
  const compact = localStorage.getItem("lan-cms-compact") === "true";
  if ($("themePreference")) $("themePreference").value = theme;
  syncThemeChoices(theme);
  if ($("reducedMotionPreference")) $("reducedMotionPreference").checked = reduced;
  if ($("compactModePreference")) $("compactModePreference").checked = compact;
  document.documentElement.dataset.reducedMotion = String(reduced);
  document.documentElement.dataset.compact = String(compact);
  applyTheme(theme);
  window.requestAnimationFrame(syncAppearancePreview);
}

function updateReport(report = {}) {
  ["imported", "existing", "skipped", "linked", "standalone", "unresolved", "failed"].forEach((key) => setText(`${key}Count`, String(report[key] || 0)));
}
function reportText(report = {}) {
  return JSON.stringify({ generatedAt: new Date().toISOString(), schemaVersion: PORTFOLIO_INITIALIZATION_VERSION, ...report }, null, 2);
}
function displayReport(report) {
  state.latestReport = report; updateReport(report);
  if ($("migrationDetailsPanel")) $("migrationDetailsPanel").hidden = false;
  setText("migrationDetails", reportText(report));
  if ($("downloadMigrationReportButton")) $("downloadMigrationReportButton").disabled = false;
}

async function loadInitialization() {
  const data = await loadInitializationStatus();
  const completed = data.completed === true;
  setText("initializationStatus", completed ? `Production content initialized with schema version ${data.version || data.schemaVersion || PORTFOLIO_INITIALIZATION_VERSION}.` : "Portfolio initialization has not completed successfully.");
  setText("lastInitializationTime", formatDate(data.completedAt || data.updatedAt));
  setText("initializationVersion", data.version || data.schemaVersion || "—");
  setText("pipelineSchemaValue", `v${data.version || data.schemaVersion || PORTFOLIO_INITIALIZATION_VERSION}`);
  setText("lastSuccessfulInitialization", formatDate(data.completedAt));
  const pill = $("initializationHealth"); if (pill) { pill.textContent = completed ? "Ready" : "Action needed"; pill.className = `health-pill ${completed ? "success" : "warning"}`; }
  if ($("portfolioOperationStage")?.dataset.state === "idle") {
    setPortfolioOperation({
      state: "idle",
      kicker: completed ? "System ready" : "Action recommended",
      title: completed ? "Portfolio tools are standing by" : "Portfolio initialization needs attention",
      message: completed ? "Verify the live portfolio or repair missing records and watch the progress here." : "Use Verify Portfolio first, then repair missing records only if recovery is actually needed."
    });
  }
  updateReport(data); return data;
}

async function repairMissingPortfolioRecords() {
  const button = $("repairMissingButton");
  const ok = await confirmAction({
    title: "Repair missing portfolio records?",
    message: "This preserves existing records, normalizes legacy publication fields to the current Firestore schema, and creates only missing approved records.",
    confirmLabel: "Repair Missing Records",
    danger: false
  });
  if (!ok) return;
  setBusy(button, true, "Repairing…");
  const progress = $("initializationProgress"); if (progress) progress.style.width = "0%";
  setPortfolioOperation({
    state: "working",
    kicker: "Repair in progress",
    title: "Repairing missing portfolio records",
    message: "Preparing the approved content source and validating the current portfolio state.",
    percent: 4
  });
  try {
    log("Loading approved content source");
    const source = await loadLegacy({ purpose: "initialization", timeoutMs: 15000 });
    const summary = summarizeLegacyContent(source); log(`Validated ${summary.totalRecords} approved source records`);
    const report = await initializeLegacyPortfolio(source, (info) => {
      const total = Math.max(1, Number(info.total) || 1); const current = Number(info.current) || 0;
      const percent = Math.min(100, Math.round(current / total * 100));
      if (progress) progress.style.width = `${percent}%`;
      setText("initializationProgressLabel", `${current} of ${total}: ${info.label || "Processing"}`);
      setPortfolioOperation({
        state: "working",
        kicker: "Repair in progress",
        title: info.label || "Repairing portfolio records",
        message: `${current} of ${total} repair steps processed.`,
        percent
      });
      if (info.label) log(info.label); if (info.report) updateReport(info.report);
    }, { replaceProduction: false });
    displayReport(report); setText("initializationProgressLabel", report.failed ? "Completed with errors. Review the report." : "Repair completed successfully.");
    setPortfolioOperation({
      state: report.failed ? "error" : "success",
      kicker: report.failed ? "Review required" : "Repair complete",
      title: report.failed ? `Completed with ${report.failed} issue${report.failed === 1 ? "" : "s"}` : "Portfolio records are ready",
      message: report.failed ? "Review the initialization report before making more changes." : "Missing approved records were repaired without replacing production content.",
      percent: 100
    });
    log(report.failed ? `Completed with ${report.failed} failures` : "Repair completed successfully");
    await Promise.all([loadInitialization(), verifySynchronization()]);
  } catch (error) {
    console.error(error); setText("initializationProgressLabel", error.message || "Repair failed."); log(`Failed: ${error.message}`);
    setPortfolioOperation({ state: "error", kicker: "Operation stopped", title: "Repair could not finish", message: error.message || "Repair failed.", percent: 0 });
  } finally { setBusy(button, false); }
}

function isPublished(data = {}) {
  return String(data.status || "").toLowerCase() === "published"
    && data.visible === true
    && data.isDeleted !== true
    && data.archived !== true;
}
async function readModule(name) {
  const snapshot = await getDocs(collection(db, name));
  const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  return { name, records, total: records.length, published: records.filter((item) => isPublished(item, name)).length };
}
async function verifySynchronization(event = null) {
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const primaryButton = $("verifyPortfolioButton");
  const advancedButton = $("verifySynchronizationButton");
  const buttons = [primaryButton, advancedButton].filter(Boolean);
  buttons.forEach((button) => setBusy(button, true, "Verifying…"));

  const body = $("collectionVerificationBody");
  const progress = $("initializationProgress");
  if (body) body.innerHTML = `<tr><td colspan="5">Checking Firestore collections…</td></tr>`;
  if (progress) progress.style.width = "35%";
  setText("initializationProgressLabel", "Verifying Firestore collections and publication state…");
  setPortfolioOperation({ state: "working", kicker: "Verification running", title: "Checking portfolio records", message: "Reading live Firestore collections and validating publication state.", percent: 35 });

  try {
    const modules = await Promise.all(["experiences", "projects", "photoEditingProjects", "education", "skills", "certificates", "resumes"].map(readModule));
    if (body) body.innerHTML = modules.map((module) => {
      const hidden = module.total - module.published; const status = module.total ? "Ready" : "Empty";
      return `<tr><td>${module.name}</td><td>${module.total}</td><td>${module.published}</td><td>${hidden}</td><td><span class="health-pill ${module.total ? "success" : "warning"}">${status}</span></td></tr>`;
    }).join("");

    const total = modules.reduce((sum, item) => sum + item.total, 0);
    const published = modules.reduce((sum, item) => sum + item.published, 0);
    const hidden = total - published;
    state.lastSync = { at: new Date().toISOString(), total, published, modules };

    setText("synchronizationStatus", `${published} published of ${total} records`);
    setText("lastSynchronizationResult", `Verified ${published}/${total} published`);
    setText("initializationProgressLabel", `Verification complete — ${published} published, ${hidden} hidden/draft, ${total} total records.`);
    if (progress) progress.style.width = "100%";

    const pill = $("syncHealth");
    if (pill) { pill.textContent = "Verified"; pill.className = "health-pill success"; }
    setPortfolioOperation({ state: "success", kicker: "Verification complete", title: "Portfolio records verified", message: `${published} published, ${hidden} hidden or draft, ${total} total records.`, percent: 100 });
    log(`Portfolio verification complete: ${published}/${total} published`);
    await countAssets(modules);
    return state.lastSync;
  } catch (error) {
    console.error(error);
    if (body) body.innerHTML = `<tr><td colspan="5">Verification failed: ${error.message}</td></tr>`;
    setText("initializationProgressLabel", `Verification failed: ${error.message}`);
    if (progress) progress.style.width = "0%";
    const pill = $("syncHealth");
    if (pill) { pill.textContent = "Failed"; pill.className = "health-pill danger"; }
    setPortfolioOperation({ state: "error", kicker: "Verification stopped", title: "Portfolio verification failed", message: error.message || "Unable to verify Firestore collections.", percent: 0 });
    log(`Portfolio verification failed: ${error.message}`);
    throw error;
  } finally {
    buttons.forEach((button) => setBusy(button, false));
    if (trigger && trigger !== primaryButton && trigger !== advancedButton) setBusy(trigger, false);
  }
}
function settingsReducedMotion() {
  return document.documentElement.dataset.reducedMotion === "true"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function animateMetricNodes(nodes, value, { suffix = "", duration = 520, datasetKey = "metricValue" } = {}) {
  const targets = Array.from(nodes || []).filter(Boolean);
  if (!targets.length) return;
  const target = Math.max(0, Number(value) || 0);
  const primary = targets[0];
  if (primary._lanMetricAnimationFrame) window.cancelAnimationFrame(primary._lanMetricAnimationFrame);
  const previous = Number(primary.dataset[datasetKey]);
  const start = Number.isFinite(previous) ? previous : 0;
  targets.forEach((node) => { node.dataset[datasetKey] = String(target); });
  const render = (current) => targets.forEach((node) => { node.textContent = `${Math.round(current)}${suffix}`; });
  if (settingsReducedMotion() || duration <= 0 || start === target) {
    render(target);
    return;
  }
  const started = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    render(start + (target - start) * eased);
    if (progress < 1) primary._lanMetricAnimationFrame = window.requestAnimationFrame(tick);
    else primary._lanMetricAnimationFrame = 0;
  };
  primary._lanMetricAnimationFrame = window.requestAnimationFrame(tick);
}

function animateSettingsMetric(id, value, options = {}) {
  animateMetricNodes([
    $(id),
    ...document.querySelectorAll(`[data-settings-mirror="${id}"]`)
  ], value, options);
}

function animateMetricElement(element, value, options = {}) {
  if (!element) return;
  animateMetricNodes([element], value, { ...options, datasetKey: "telemetryValue" });
}

function telemetryPointSegments(points = []) {
  const segments = [];
  let current = [];
  points.forEach((point) => {
    if (point?.known !== false) {
      current.push(point);
      return;
    }
    if (current.length) segments.push(current);
    current = [];
  });
  if (current.length) segments.push(current);
  return segments;
}

function telemetrySegmentPath(points = []) {
  if (!points.length) return "";
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    path += ` L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`;
  }
  return path;
}

function telemetryPath(points = []) {
  return telemetryPointSegments(points).map(telemetrySegmentPath).filter(Boolean).join(" ");
}

function telemetryAreaPath(points = [], bottom = TELEMETRY_PLOT.bottom) {
  return telemetryPointSegments(points).map((segment) => {
    if (segment.length < 2) return "";
    return `${telemetrySegmentPath(segment)} L ${segment[segment.length - 1].x.toFixed(2)} ${bottom} L ${segment[0].x.toFixed(2)} ${bottom} Z`;
  }).filter(Boolean).join(" ");
}


function escapeTelemetryHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatStorageBytes(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (!value) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 2 : 1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatUsageNumber(value, { maximumFractionDigits = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(numeric);
}

const MEDIA_FILE_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp|pdf|mp4|mov|webm|zip)(?:$|[?#])/i;

function trackedAssetUrl(value = "") {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.startsWith("data:") || candidate.startsWith("blob:") || candidate.startsWith("#")) return null;
  try {
    const canonical = String(resolveAssetUrl(candidate, "display") || "").trim();
    if (!canonical) return null;
    // A bare legacy filename has no canonical location. Do not accidentally
    // reinterpret it relative to /admin/pages and generate repeated 404 probes.
    if (!/^(?:https?:\/\/|\/|\.\.?\/)/i.test(canonical)) return null;
    const url = new URL(canonical, window.location.origin);
    if (url.hostname === "res.cloudinary.com" && url.pathname.includes(`/${cloudinaryConfig.cloudName}/`)) {
      return { url: url.href, source: "cloudinary" };
    }
    if (url.origin === window.location.origin && MEDIA_FILE_PATTERN.test(`${url.pathname}${url.search}`)) {
      return { url: url.href, source: "hosting" };
    }
    return null;
  } catch {
    return null;
  }
}

function assetCandidate(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const managed = normalizeStorageAsset(value);
  if (managed) {
    const tokens = storageAssetIdentityTokens(managed);
    const url = resolveAssetUrl(managed, "display") || storageAssetUrl(managed, "display");
    const key = tokens.find((token) => token.startsWith("asset:"))
      || tokens.find((token) => token.startsWith("public:"))
      || tokens.find((token) => token.startsWith("url:"))
      || `${managed.provider}:${managed.storageProfileId}:${managed.assetId || managed.publicId || url}`;
    const resolved = mediaTelemetryState.resolvedAssets.get(key)
      || mediaTelemetryState.resolvedAssets.get(url)
      || mediaTelemetryState.resolvedAssets.get(managed.assetId)
      || mediaTelemetryState.resolvedAssets.get(managed.publicId);
    return {
      key,
      url,
      assetId: managed.assetId || "",
      publicId: managed.publicId || "",
      resourceType: managed.resourceType || "",
      source: managed.provider,
      storageProfileId: managed.storageProfileId || "",
      bytes: Math.max(0, Number(managed.bytes) || Number(resolved?.bytes) || 0)
    };
  }

  const tracked = trackedAssetUrl(value.secureUrl || value.secure_url || value.url || value.imageUrl || value.fileUrl || value.pdfUrl || value.documentUrl || value.coverImageUrl || "");
  if (!tracked) return null;
  const resolved = mediaTelemetryState.resolvedAssets.get(tracked.url);
  return {
    key: tracked.url,
    url: tracked.url,
    assetId: "",
    publicId: "",
    resourceType: "",
    source: tracked.source,
    storageProfileId: "",
    bytes: Math.max(0, Number(value.bytes) || Number(value.fileSize) || Number(value.sizeBytes) || Number(resolved?.bytes) || 0)
  };
}

function summarizeTrackedMedia(records = []) {
  const assets = new Map();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      const candidate = assetCandidate(value);
      if (candidate) {
        const existing = assets.get(candidate.key);
        if (!existing || candidate.bytes > existing.bytes) assets.set(candidate.key, candidate);
        const assetFields = new Set(["schemaVersion", "provider", "storageProvider", "storageProfileId", "storage_profile_id", "secureUrl", "secure_url", "url", "previewUrl", "downloadUrl", "imageUrl", "fileUrl", "pdfUrl", "documentUrl", "coverImageUrl", "file", "assetId", "asset_id", "fileId", "file_id", "publicId", "public_id", "resourceType", "resource_type", "mimeType", "bytes", "fileSize", "sizeBytes"]);
        Object.entries(value).forEach(([key, nested]) => { if (!assetFields.has(key)) visit(nested); });
        return;
      }
      Object.values(value).forEach(visit);
      return;
    }
    if (typeof value !== "string") return;
    const tracked = trackedAssetUrl(value);
    if (!tracked) return;
    const resolved = mediaTelemetryState.resolvedAssets.get(tracked.url);
    const candidate = { key: tracked.url, url: tracked.url, assetId: "", publicId: "", resourceType: "", source: tracked.source, bytes: Math.max(0, Number(resolved?.bytes) || 0) };
    const existing = assets.get(candidate.key);
    if (!existing || candidate.bytes > existing.bytes) assets.set(candidate.key, candidate);
  };
  records.forEach(visit);
  const values = [...assets.values()];
  const cloudinary = values.filter((item) => item.source === "cloudinary");
  const hosted = values.filter((item) => item.source === "hosting");
  const unresolvedValues = values.filter((item) => item.bytes <= 0);
  const cloudinaryUnresolvedValues = cloudinary.filter((item) => item.bytes <= 0);
  const hostedUnresolvedValues = hosted.filter((item) => item.bytes <= 0);
  return {
    bytes: values.reduce((sum, item) => sum + item.bytes, 0),
    assetCount: values.length,
    knownAssetCount: values.length - unresolvedValues.length,
    unresolved: unresolvedValues.length,
    cloudinaryAssets: cloudinary.length,
    cloudinaryKnownAssetCount: cloudinary.length - cloudinaryUnresolvedValues.length,
    cloudinaryUnresolved: cloudinaryUnresolvedValues.length,
    cloudinaryBytes: cloudinary.reduce((sum, item) => sum + item.bytes, 0),
    hostedAssets: hosted.length,
    hostedKnownAssetCount: hosted.length - hostedUnresolvedValues.length,
    hostedUnresolved: hostedUnresolvedValues.length,
    hostedBytes: hosted.reduce((sum, item) => sum + item.bytes, 0),
    unresolvedReferences: unresolvedValues.map((item) => ({
      key: item.key,
      url: item.url,
      assetId: item.assetId,
      publicId: item.publicId,
      resourceType: item.resourceType,
      source: item.source
    }))
  };
}

function collectModuleLinks(value, links = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectModuleLinks(item, links));
    return links;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectModuleLinks(item, links));
    return links;
  }
  if (typeof value !== "string") return links;
  const matches = value.match(/https?:\/\/[^\s<>\"']+/gi) || [];
  matches.forEach((match) => {
    const candidate = match.replace(/[),.;!?]+$/g, "");
    if (!candidate || trackedAssetUrl(candidate)) return;
    try {
      const url = new URL(candidate);
      url.hash = "";
      links.add(url.href);
    } catch (_) {}
  });
  return links;
}

function summarizeModuleContent(records = []) {
  const list = Array.isArray(records) ? records : [];
  let mediaRecords = 0;
  let contentRecords = 0;
  const links = new Set();
  list.forEach((record) => {
    const media = summarizeTrackedMedia([record]);
    if (Math.max(0, Number(media.assetCount) || 0) > 0) mediaRecords += 1;
    else contentRecords += 1;
    collectModuleLinks(record, links);
  });
  return {
    mediaRecords,
    contentRecords,
    linkCount: links.size,
    links: [...links]
  };
}

function moduleRecord(name, label, iconName, records = [], extra = {}) {
  const list = Array.isArray(records) ? records : [];
  return {
    name,
    label,
    iconName,
    records: list,
    total: list.length,
    published: list.filter((item) => isPublished(item)).length,
    storage: summarizeTrackedMedia(list),
    content: summarizeModuleContent(list),
    ...extra
  };
}

function buildTelemetryModules() {
  const core = CORE_TELEMETRY_MODULES.map((definition) => {
    const current = telemetryRealtimeModules.get(definition.collection);
    return moduleRecord(definition.key, definition.label, definition.iconName, current?.records || []);
  });
  const featureDescriptors = buildSettingsTelemetryFeatureDescriptors(telemetryFeatureSections, telemetryFeatureEntries);
  const features = featureDescriptors.map((descriptor) => moduleRecord(
    descriptor.name,
    descriptor.label,
    descriptor.iconName,
    descriptor.records,
    {
      feature: Boolean(descriptor.feature),
      promoted: Boolean(descriptor.promoted),
      customAggregate: Boolean(descriptor.customAggregate),
      moduleCount: Number(descriptor.moduleCount || 0),
      sectionKey: descriptor.sectionKey || ""
    }
  ));
  telemetryRenderedModules = [...core, ...features];
  return telemetryRenderedModules;
}

function publicTelemetryGraphModules(modules = []) {
  return (Array.isArray(modules) ? modules : []).filter((module) => module?.name !== "skills");
}

function trackedStorageTotals(modules = telemetryRenderedModules) {
  const source = Array.isArray(modules) ? modules : [];
  return source.reduce((totals, module) => {
    const storage = module.storage || {};
    totals.bytes += Math.max(0, Number(storage.bytes) || 0);
    totals.cloudinaryBytes += Math.max(0, Number(storage.cloudinaryBytes) || 0);
    totals.hostedBytes += Math.max(0, Number(storage.hostedBytes) || 0);
    totals.assets += Math.max(0, Number(storage.assetCount) || 0);
    totals.cloudinaryAssets += Math.max(0, Number(storage.cloudinaryAssets) || 0);
    totals.hostedAssets += Math.max(0, Number(storage.hostedAssets) || 0);
    totals.unresolved += Math.max(0, Number(storage.unresolved) || 0);
    return totals;
  }, { bytes: 0, cloudinaryBytes: 0, hostedBytes: 0, assets: 0, cloudinaryAssets: 0, hostedAssets: 0, unresolved: 0 });
}

function optionalTelemetryNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function telemetryPlanSnapshotFromUsage(usage = null) {
  const credits = usage?.credits || null;
  const usedCredits = optionalTelemetryNumber(credits?.usage);
  const creditLimit = optionalTelemetryNumber(credits?.limit);
  const reportedPercent = optionalTelemetryNumber(credits?.usedPercent);
  const usedPercent = reportedPercent != null
    ? reportedPercent
    : usedCredits != null && creditLimit != null && creditLimit > 0
      ? (usedCredits / creditLimit) * 100
      : null;
  return {
    usage: usedCredits != null ? Math.max(0, usedCredits) : null,
    limit: creditLimit != null && Number.isFinite(creditLimit) && creditLimit > 0 ? creditLimit : null,
    usedPercent: usedPercent != null && Number.isFinite(usedPercent) ? Math.max(0, usedPercent) : null
  };
}

function telemetryPlanSnapshot() {
  return telemetryPlanSnapshotFromUsage(cloudinaryTelemetryState.usage);
}


function telemetryMetricValues(modules = []) {
  const source = Array.isArray(modules) ? modules : [];

  if (telemetryMetric === "spectrum") {
    const mediaBytes = source.map((module) => Math.max(0, Number(module.storage?.bytes) || 0));
    const mediaAssets = source.map((module) => Math.max(0, Number(module.storage?.assetCount) || 0));
    const contentCounts = source.map((module) => Math.max(0, Number(module.content?.contentRecords) || 0));
    const maxBytes = Math.max(0, ...mediaBytes);
    const maxAssets = Math.max(0, ...mediaAssets);
    const maxContent = Math.max(0, ...contentCounts);
    const totalLinks = source.reduce((sum, module) => sum + Math.max(0, Number(module.content?.linkCount) || 0), 0);

    const entries = source.map((module) => {
      const storage = module.storage || {};
      const content = module.content || {};
      const bytes = Math.max(0, Number(storage.bytes) || 0);
      const assets = Math.max(0, Number(storage.assetCount) || 0);
      const contentRecords = Math.max(0, Number(content.contentRecords) || 0);
      const mediaRecords = Math.max(0, Number(content.mediaRecords) || 0);
      const linkCount = Math.max(0, Number(content.linkCount) || 0);
      const byteStrength = maxBytes > 0 ? (bytes / maxBytes) * 100 : 0;
      const unresolvedStrength = maxAssets > 0 && assets > 0 ? (assets / maxAssets) * 28 : 0;
      const mediaStrength = Math.max(byteStrength, bytes <= 0 ? unresolvedStrength : 0);
      const contentStrength = maxContent > 0 ? (contentRecords / maxContent) * 100 : 0;
      const value = Math.max(-100, Math.min(100, mediaStrength - contentStrength));
      const side = value > 4 ? "media" : value < -4 ? "content" : "balanced";
      const fileText = assets
        ? `${storage.unresolved ? "≥ " : ""}${formatStorageBytes(bytes)} · ${assets} file${assets === 1 ? "" : "s"}`
        : "No stored media";
      const recordText = `${contentRecords} text-only record${contentRecords === 1 ? "" : "s"}`;
      const linkText = `${linkCount} link${linkCount === 1 ? "" : "s"}`;
      return {
        moduleName: module.name,
        label: module.label,
        value,
        known: true,
        recordCount: Math.max(0, Number(module.total) || 0),
        contentRecordCount: contentRecords,
        mediaRecordCount: mediaRecords,
        assetCount: assets,
        linkCount,
        mediaStrength,
        contentStrength,
        spectrumSide: side,
        activityWeight: Math.max(1, assets + contentRecords),
        detail: `${fileText} · ${recordText} · ${linkText}`
      };
    });

    const peak = entries.length ? Math.max(...entries.map((entry) => Math.abs(Number(entry.value) || 0))) : 0;
    const tracked = trackedStorageTotals(source);
    const totalContent = source.reduce((sum, module) => sum + Math.max(0, Number(module.content?.contentRecords) || 0), 0);
    const plan = telemetryPlanSnapshot();
    const planPercent = Number.isFinite(Number(plan.usedPercent)) ? Math.max(0, Math.min(100, Number(plan.usedPercent))) : null;
    return {
      entries,
      value: peak,
      known: true,
      signed: true,
      axisTitle: "Media ↕ Content",
      caption: `Real portfolio spectrum · ${formatStorageBytes(tracked.bytes)} across ${tracked.assets} tracked files · ${totalContent} content-only records · ${totalLinks} unique links`,
      currentLabel: `${tracked.assets} files · ${totalContent} content records · ${totalLinks} links`,
      accountPercent: planPercent,
      quota: plan,
      mode: "spectrum"
    };
  }

  if (telemetryMetric === "records") {
    const total = source.reduce((sum, module) => sum + Math.max(0, Number(module.total) || 0), 0);
    const entries = source.map((module) => {
      const count = Math.max(0, Number(module.total) || 0);
      const value = total > 0 ? (count / total) * 100 : 0;
      return {
        moduleName: module.name,
        label: module.label,
        value,
        known: true,
        recordCount: count,
        assetCount: Math.max(0, Number(module.storage?.assetCount) || 0),
        linkCount: Math.max(0, Number(module.content?.linkCount) || 0),
        activityWeight: Math.max(1, count),
        detail: total ? `${count} of ${total} managed records · ${Math.max(0, Number(module.content?.linkCount) || 0)} links` : "No managed records"
      };
    });
    const peak = entries.length ? Math.max(...entries.map((entry) => entry.value)) : 0;
    return {
      entries,
      value: peak,
      known: true,
      axisTitle: "Record load %",
      caption: total
        ? `Live module record distribution · ${total} real Firestore records · links counted separately`
        : "Live module record distribution · no managed records",
      currentLabel: total ? `${total} managed records` : "No managed records",
      accountPercent: null,
      mode: "records"
    };
  }

  const tracked = trackedStorageTotals(source);
  const totalBytes = Math.max(0, Number(tracked.bytes) || 0);
  const totalAssets = Math.max(0, Number(tracked.assets) || 0);
  const entries = source.map((module) => {
    const storage = module.storage || {};
    const bytes = Math.max(0, Number(storage.bytes) || 0);
    const assets = Math.max(0, Number(storage.assetCount) || 0);
    const known = assets === 0 || bytes > 0 || Number(storage.knownAssetCount) > 0;
    const value = totalBytes > 0 && known ? (bytes / totalBytes) * 100 : assets === 0 ? 0 : null;
    const sizeLabel = assets === 0
      ? "No stored files"
      : `${storage.unresolved ? "≥ " : ""}${formatStorageBytes(bytes)} · ${assets} file${assets === 1 ? "" : "s"}${storage.unresolved ? ` · ${storage.unresolved} pending` : ""}`;
    return {
      moduleName: module.name,
      label: module.label,
      value,
      known: Number.isFinite(Number(value)),
      recordCount: Math.max(0, Number(module.total) || 0),
      assetCount: assets,
      linkCount: Math.max(0, Number(module.content?.linkCount) || 0),
      activityWeight: Math.max(1, assets || Number(module.total) || 1),
      detail: Number.isFinite(Number(value))
        ? `${sizeLabel} · ${Number(value).toFixed(Number(value) < 10 ? 1 : 0)}% of tracked media · ${Math.max(0, Number(module.content?.linkCount) || 0)} links`
        : `${sizeLabel} · footprint still resolving`
    };
  });
  const knownValues = entries.filter((entry) => entry.known).map((entry) => Number(entry.value));
  const peak = knownValues.length ? Math.max(...knownValues) : 0;
  const plan = telemetryPlanSnapshot();
  const planPercent = Number.isFinite(Number(plan.usedPercent)) ? Math.max(0, Math.min(100, Number(plan.usedPercent))) : null;
  return {
    entries,
    value: peak,
    known: entries.some((entry) => entry.known),
    axisTitle: "Media load %",
    caption: totalAssets
      ? `Live module media distribution · ${formatStorageBytes(totalBytes)} across ${totalAssets} tracked files · links counted separately`
      : "Live module media distribution · no tracked media",
    currentLabel: totalAssets ? `${formatStorageBytes(totalBytes)} across ${totalAssets} tracked files` : "No tracked media",
    accountPercent: planPercent,
    quota: plan,
    mode: "storage"
  };
}

function formatTelemetryAxisValue(value, scaleMax = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (numeric === 0) return "0";
  if (scaleMax <= 2) return numeric.toFixed(2).replace(/\.?0+$/, "");
  if (scaleMax <= 10) return numeric.toFixed(1).replace(/\.0$/, "");
  return String(Math.round(numeric));
}

function telemetryVisibleValues(history = telemetryHistory, nextSample = null, now = Date.now()) {
  const startAt = now - telemetryWindowMs();
  const values = history
    .filter((sample) => sample?.known && Number.isFinite(Number(sample.value)) && Number(sample.at || 0) >= startAt)
    .map((sample) => Math.max(0, Math.min(100, Number(sample.value))));
  if (nextSample?.known && Number.isFinite(Number(nextSample.value))) values.push(Math.max(0, Math.min(100, Number(nextSample.value))));
  return values;
}

function telemetryAutoScaleMax(values = []) {
  const peak = values.length ? Math.max(...values) : 0;
  if (peak >= 80) return 100;
  const target = Math.max(peak / .82, .5);
  return TELEMETRY_AUTO_SCALE_LEVELS.find((level) => level >= target) || 100;
}

function resolveTelemetryScale(history = telemetryHistory, nextSample = null, now = Date.now()) {
  const values = telemetryVisibleValues(history, nextSample, now);
  const peak = values.length ? Math.max(...values) : 0;
  const autoMax = telemetryAutoScaleMax(values);
  let max = autoMax;
  if (telemetryScaleMode === "full") max = 100;
  if (telemetryScaleMode === "manual") {
    const requested = Number(telemetryManualScaleMax);
    const minimumSafe = peak > 0 ? Math.min(100, peak * 1.12) : .5;
    max = Math.max(minimumSafe, Number.isFinite(requested) ? requested : autoMax);
    max = Math.min(100, max);
  }
  if (!Number.isFinite(max) || max <= 0) max = 1;
  return { min: 0, max, peak, autoMax };
}

function updateTelemetryAxis(scale = { min: 0, max: 100 }) {
  const signed = Number(scale.min) < 0;
  const max = Math.max(.0001, Number(scale.max) || 100);
  const values = signed ? [max, max / 2, 0, -max / 2, -max] : [max, max * .75, max * .5, max * .25, 0];
  document.querySelectorAll("[data-settings-telemetry-axis]").forEach((node, index) => {
    node.textContent = signed ? "" : formatTelemetryAxisValue(values[index] ?? 0, max);
  });
}

function updateTelemetryScaleControls(scale = { max: 100, peak: 0 }) {
  telemetryResolvedScaleMax = Number(scale.max) || 100;
  const signed = Number(scale.min) < 0;
  const label = $("settingsTelemetryScaleLabel");
  if (label) {
    const prefix = telemetryScaleMode === "full" ? "Full" : telemetryScaleMode === "manual" ? "Manual" : "Auto";
    label.textContent = signed
      ? `${prefix} · balanced ±${formatTelemetryAxisValue(telemetryResolvedScaleMax, telemetryResolvedScaleMax)}`
      : `${prefix} · 0–${formatTelemetryAxisValue(telemetryResolvedScaleMax, telemetryResolvedScaleMax)}%`;
  }
  document.querySelectorAll("[data-telemetry-scale]").forEach((button) => {
    const action = button.dataset.telemetryScale;
    const active = (action === "auto" && telemetryScaleMode === "auto") || (action === "full" && telemetryScaleMode === "full");
    if (action === "auto" || action === "full") {
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (action === "in") button.disabled = telemetryResolvedScaleMax <= Math.max(.5, Number(scale.peak || 0) * 1.13);
    if (action === "out") button.disabled = telemetryResolvedScaleMax >= 100;
  });
  const plot = $("settingsTelemetrySvg")?.closest(".settings-telemetry-plot");
  if (plot) {
    plot.dataset.scaleMode = telemetryScaleMode;
    plot.dataset.metric = telemetryMetric;
  }
}

function telemetryWindowMs(metric = telemetryMetric) {
  if (metric !== "storage") return TELEMETRY_RECORDS_WINDOW_MS;
  const verifiedTimes = telemetryRemoteStorageHistory
    .filter((sample) => sample?.verified === true && Number.isFinite(Number(sample.at)))
    .map((sample) => Number(sample.at))
    .sort((first, second) => first - second);
  if (verifiedTimes.length < 3) return TELEMETRY_STORAGE_WINDOW_MS;
  const span = verifiedTimes[verifiedTimes.length - 1] - verifiedTimes[0];
  const padded = span + Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, span * .08));
  return Math.max(TELEMETRY_STORAGE_WINDOW_MS, Math.min(30 * 24 * 60 * 60 * 1000, padded));
}

function formatTelemetryDuration(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes >= 24 * 60) return `${Math.max(1, Math.round(minutes / (24 * 60)))}d`;
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}


function telemetrySeriesColor(entry = {}, index = 0) {
  const name = String(entry.moduleName || entry.name || "");
  return TELEMETRY_SERIES_COLORS[name] || TELEMETRY_SERIES_FALLBACK[index % TELEMETRY_SERIES_FALLBACK.length];
}

function updateTelemetrySignalAxis() {
  const axis = $("settingsTelemetryModuleAxis");
  if (!axis) return;
  axis.style.setProperty("--telemetry-columns", "5");
  axis.innerHTML = ["−4s", "−3s", "−2s", "−1s", "NOW"].map((label) => `<span>${label}</span>`).join("");
}

function updateTelemetryGrid(width = TELEMETRY_PLOT.width, scale = { min: 0, max: 100 }) {
  const grid = $("settingsTelemetryGrid");
  if (!grid) return;
  const left = TELEMETRY_PLOT.left;
  const right = width - (TELEMETRY_PLOT.width - TELEMETRY_PLOT.right);
  const top = TELEMETRY_PLOT.top;
  const bottom = TELEMETRY_PLOT.bottom;
  const min = Number(scale.min) || 0;
  const max = Math.max(min + .0001, Number(scale.max) || 100);
  const signed = min < 0;
  const values = signed ? [max, max / 2, min / 2, min] : [max, max * .75, max * .5, max * .25, 0];
  const yFor = (value) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const horizontal = values.map((value) => {
    const y = yFor(value);
    return `<path d="M${left} ${y.toFixed(2)}H${right}"/>`;
  }).join("");
  const verticalStep = (right - left) / 8;
  const vertical = Array.from({ length: 10 }, (_, index) => {
    const x = left + verticalStep * index;
    return `<path d="M${x.toFixed(2)} ${top - 4}V${bottom + 4}"/>`;
  }).join("");
  let warning = "";
  if (!signed && max >= 80) {
    const warningRatio = Math.max(0, Math.min(1, 80 / max));
    const warningY = bottom - warningRatio * (bottom - top);
    warning = `<path class="settings-telemetry-warning-line" d="M${left} ${warningY.toFixed(2)}H${right}"/>`;
  }
  grid.style.setProperty("--telemetry-grid-step", `${verticalStep.toFixed(2)}px`);
  grid.innerHTML = horizontal + `<g class="settings-telemetry-grid-vertical">${vertical}</g>` + warning;
}

function configureTelemetryCanvas(scale = { min: 0, max: 100 }, moduleCount = CORE_TELEMETRY_MODULES.length) {
  const count = Math.max(1, Number(moduleCount) || 1);
  const naturalWidth = TELEMETRY_MODULE_EDGE_PX * 2 + Math.max(0, count - 1) * TELEMETRY_MODULE_SLOT_PX;
  const width = Math.max(TELEMETRY_PLOT.width, naturalWidth);
  const svg = $("settingsTelemetrySvg");
  const canvas = $("settingsTelemetryCanvas");
  if (svg) svg.setAttribute("viewBox", `0 0 ${width} ${TELEMETRY_PLOT.height}`);
  if (canvas) canvas.style.minWidth = width > TELEMETRY_PLOT.width ? `${width}px` : "100%";
  updateTelemetryGrid(width, scale);
  return width;
}

function telemetryPressureState(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 100) return "critical";
  if (value >= 80) return "warning";
  return "healthy";
}

function updateTelemetryPressureVisual(percent) {
  const plot = $("settingsTelemetrySvg")?.closest(".settings-telemetry-plot");
  if (!plot) return;
  plot.dataset.pressure = telemetryPressureState(percent);
  plot.removeAttribute("data-telemetry-unavailable");
  if (Number.isFinite(Number(percent))) plot.style.setProperty("--telemetry-account-pressure", `${Math.max(0, Math.min(100, Number(percent)))}%`);
  else plot.style.removeProperty("--telemetry-account-pressure");
}

function telemetryHistoryStorageKey(metric = telemetryMetric) {
  return `${TELEMETRY_HISTORY_STORAGE_PREFIX}:${metric}`;
}

function normalizeTelemetryHistorySample(sample = {}, metric = telemetryMetric) {
  if (metric === "storage") {
    const planMetric = sample.planUsage || sample.credits || null;
    const value = optionalTelemetryNumber(planMetric?.usedPercent);
    const usage = optionalTelemetryNumber(planMetric?.usage);
    const limit = optionalTelemetryNumber(planMetric?.limit);
    const known = value != null && sample.verified === true;
    const usageText = usage != null ? formatUsageNumber(usage, { maximumFractionDigits: 2 }) : "—";
    const limitText = limit != null ? formatUsageNumber(limit, { maximumFractionDigits: 2 }) : "—";
    return {
      value: known ? Math.max(0, Math.min(100, value)) : null,
      known,
      verified: known,
      source: String(sample.source || ""),
      at: Number(sample.atMs || sample.at || Date.now()),
      event: Boolean(sample.event),
      eventLabel: String(sample.eventLabel || "Cloudinary plan usage"),
      eventModuleName: String(sample.eventModuleName || ""),
      detail: known ? `${value.toFixed(value < 10 ? 1 : 0)}% plan usage · ${usageText}${limit != null ? ` / ${limitText} credits` : " credits"}` : "Verified plan usage unavailable"
    };
  }
  const value = sample.value == null ? null : Number(sample.value);
  return {
    value: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null,
    known: Number.isFinite(value) && sample.known !== false,
    at: Number(sample.at || sample.atMs || Date.now()),
    event: Boolean(sample.event),
    eventLabel: String(sample.eventLabel || ""),
    eventModuleName: String(sample.eventModuleName || ""),
    detail: String(sample.detail || "")
  };
}

function mergeCloudinaryHistory(history = []) {
  const normalized = (Array.isArray(history) ? history : [])
    .map((sample) => normalizeTelemetryHistorySample({ ...sample, verified: true, source: "cloudinary-worker" }, "storage"))
    .filter((sample) => sample.known && sample.verified && Number.isFinite(sample.at));
  if (!normalized.length) return;
  const pending = telemetryPendingEvents.storage;
  if (pending) {
    const latest = normalized[normalized.length - 1];
    latest.event = true;
    latest.eventLabel = pending.label || latest.eventLabel;
    latest.eventModuleName = pending.moduleName || "";
    latest.detail = pending.detail || latest.detail;
    telemetryPendingEvents.storage = null;
  }
  const existing = loadStoredTelemetryHistory("storage");
  const deduped = new Map([...existing, ...telemetryRemoteStorageHistory, ...normalized].map((sample) => [sample.at, sample]));
  telemetryRemoteStorageHistory = [...deduped.values()]
    .filter((sample) => sample.verified === true)
    .sort((first, second) => first.at - second.at)
    .slice(-TELEMETRY_HISTORY_LENGTH);
  if (telemetryMetric === "storage") {
    telemetryHistory = [...telemetryRemoteStorageHistory];
    telemetryHistoryKey = "storage";
    saveTelemetryHistory("storage");
  }
}

function loadStoredTelemetryHistory(metric = telemetryMetric) {
  try {
    const parsed = JSON.parse(localStorage.getItem(telemetryHistoryStorageKey(metric)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((sample) => normalizeTelemetryHistorySample(sample, metric))
      .filter((sample) => Number.isFinite(sample.at) && (sample.value == null || Number.isFinite(sample.value)) && (metric !== "storage" || sample.verified === true))
      .slice(-TELEMETRY_HISTORY_LENGTH);
  } catch {
    return [];
  }
}

function loadTelemetryHistory(metric = telemetryMetric) {
  if (metric === "storage" && telemetryRemoteStorageHistory.length) return [...telemetryRemoteStorageHistory];
  return loadStoredTelemetryHistory(metric);
}

function saveTelemetryHistory(metric = telemetryMetric) {
  try {
    localStorage.setItem(telemetryHistoryStorageKey(metric), JSON.stringify(telemetryHistory.slice(-TELEMETRY_HISTORY_LENGTH)));
  } catch (_) {}
}

function queueTelemetryEvent(metric, event) {
  if (!event || !["storage", "records"].includes(metric)) return;
  telemetryPendingEvents[metric] = {
    label: String(event.label || "System change"),
    moduleName: String(event.moduleName || ""),
    detail: String(event.detail || "Real telemetry changed"),
    at: Date.now()
  };
}

function telemetrySample(metric, { consumeEvent = false } = {}) {
  const pending = telemetryPendingEvents[telemetryMetric];
  const sample = {
    value: metric.known && Number.isFinite(Number(metric.value)) ? Math.max(0, Math.min(100, Number(metric.value))) : null,
    known: Boolean(metric.known && Number.isFinite(Number(metric.value))),
    at: Date.now(),
    event: Boolean(pending),
    eventLabel: pending?.label || (telemetryMetric === "storage" ? "Cloudinary storage" : "Portfolio readiness"),
    eventModuleName: pending?.moduleName || "",
    detail: pending?.detail || metric.currentLabel
  };
  if (consumeEvent && pending) telemetryPendingEvents[telemetryMetric] = null;
  return sample;
}

function resetTelemetryHistory(metric, key) {
  telemetryHistoryKey = key;
  telemetryHistory = loadTelemetryHistory(telemetryMetric);
  if (telemetryMetric !== "storage") {
    const current = telemetrySample(metric);
    if (!telemetryHistory.length && current.known) telemetryHistory = [current];
  }
  telemetryHistory = telemetryHistory.slice(-TELEMETRY_HISTORY_LENGTH);
  telemetryStreamLastSampleAt = 0;
}

function telemetryStreamPoints(history, nextSample, width = TELEMETRY_PLOT.width, now = Date.now(), scale = { min: 0, max: 100 }) {
  const left = TELEMETRY_PLOT.left;
  const right = width - (TELEMETRY_PLOT.width - TELEMETRY_PLOT.right);
  const top = TELEMETRY_PLOT.top;
  const bottom = TELEMETRY_PLOT.bottom;
  const windowMs = telemetryWindowMs();
  const startAt = now - windowMs;
  const scaleMin = Number(scale.min) || 0;
  const scaleMax = Math.max(scaleMin + .0001, Number(scale.max) || 100);
  const toPoint = (sample) => {
    const known = sample?.known !== false && Number.isFinite(Number(sample?.value));
    const value = known ? Math.max(0, Math.min(100, Number(sample.value))) : null;
    const ratio = known ? Math.max(0, Math.min(1, (value - scaleMin) / (scaleMax - scaleMin))) : 0;
    const at = Number(sample?.at || now);
    return {
      x: left + ((at - startAt) / windowMs) * (right - left),
      y: known ? bottom - ratio * (bottom - top) : (top + bottom) / 2,
      value,
      known,
      sample
    };
  };
  const source = [...history].filter((sample) => Number.isFinite(Number(sample?.at))).sort((first, second) => first.at - second.at);
  const visible = source.filter((sample) => sample.at >= startAt);
  const older = [...source].reverse().find((sample) => sample.at < startAt);
  const samples = older ? [older, ...visible] : visible;
  const points = samples.map(toPoint);
  if (nextSample?.known) points.push(toPoint({ ...nextSample, at: now }));
  return points;
}


function resolveTelemetryModuleScale(metric = null) {
  const signed = Boolean(metric?.signed || metric?.mode === "spectrum");
  const values = (metric?.entries || [])
    .filter((entry) => entry?.known && Number.isFinite(Number(entry.value)))
    .map((entry) => signed ? Math.abs(Number(entry.value)) : Math.max(0, Math.min(100, Number(entry.value))));
  const peak = values.length ? Math.max(...values) : 0;
  const autoMax = telemetryAutoScaleMax(values);
  let max = autoMax;
  if (telemetryScaleMode === "full") max = 100;
  if (telemetryScaleMode === "manual") {
    const requested = Number(telemetryManualScaleMax);
    const minimumSafe = peak > 0 ? Math.min(100, peak * 1.12) : .5;
    max = Math.max(minimumSafe, Number.isFinite(requested) ? requested : autoMax);
    max = Math.min(100, max);
  }
  if (!Number.isFinite(max) || max <= 0) max = 1;
  return signed ? { min: -max, max, peak, autoMax, signed: true } : { min: 0, max, peak, autoMax, signed: false };
}

function telemetryProfilePoints(metric = {}, width = TELEMETRY_PLOT.width, scale = { min: 0, max: 100 }) {
  const entries = Array.isArray(metric?.entries) ? metric.entries : [];
  const left = TELEMETRY_PLOT.left;
  const right = width - (TELEMETRY_PLOT.width - TELEMETRY_PLOT.right);
  const top = TELEMETRY_PLOT.top;
  const bottom = TELEMETRY_PLOT.bottom;
  const min = Number(scale.min) || 0;
  const max = Math.max(min + .0001, Number(scale.max) || 100);
  const span = Math.max(1, right - left);
  const step = entries.length > 1 ? span / (entries.length - 1) : 0;
  return entries.map((entry, index) => {
    const known = Boolean(entry?.known && Number.isFinite(Number(entry.value)));
    const value = known ? Math.max(min, Math.min(max, Number(entry.value))) : null;
    const ratio = known ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
    return {
      ...entry,
      index,
      known,
      value,
      x: entries.length > 1 ? left + step * index : left + span / 2,
      y: known ? bottom - ratio * (bottom - top) : bottom,
      color: telemetrySeriesColor(entry, index)
    };
  });
}

function telemetryProfilePath(points = []) {
  return telemetryPointSegments(points).map(telemetrySegmentPath).filter(Boolean).join(" ");
}

function telemetryProfileArea(points = []) {
  if (telemetryMetric === "spectrum") return "";
  return telemetryAreaPath(points, TELEMETRY_PLOT.bottom);
}

function setTelemetryActiveModule(moduleName = "") {
  if (telemetryScanActiveModule === moduleName) return;
  telemetryScanActiveModule = moduleName;
  document.querySelectorAll("[data-settings-module]").forEach((card) => {
    card.classList.toggle("is-live-module", Boolean(moduleName) && card.dataset.settingsModule === moduleName);
  });
}

function updateTelemetryProfileAxis(points = [], width = TELEMETRY_PLOT.width) {
  const axis = $("settingsTelemetryModuleAxis");
  if (!axis) return;
  const left = TELEMETRY_MODULE_EDGE_PX;
  const right = Math.max(left, width - TELEMETRY_MODULE_EDGE_PX);
  const labels = points
    .filter((point) => point.known && point.x >= left - 1 && point.x <= right + 1)
    .filter((point, index, source) => {
      const previous = source[index - 1];
      return !previous || previous.moduleName !== point.moduleName || Math.abs(previous.x - point.x) > 2;
    });
  axis.innerHTML = labels.map((point, index) => {
    const previousX = index > 0 ? labels[index - 1].x : 0;
    const nextX = index < labels.length - 1 ? labels[index + 1].x : width;
    const labelLeft = index === 0 ? 0 : (previousX + point.x) / 2;
    const labelRight = index === labels.length - 1 ? width : (point.x + nextX) / 2;
    const labelLeftPercent = (labelLeft / Math.max(1, width)) * 100;
    const labelWidthPercent = (Math.max(1, labelRight - labelLeft) / Math.max(1, width)) * 100;
    return `<span style="left:${labelLeftPercent.toFixed(3)}%;width:${labelWidthPercent.toFixed(3)}%;--series-color:${point.color}">${escapeTelemetryHtml(point.label || "Module")}</span>`;
  }).join("");
}

function telemetryNiceRecordMax(value = 0) {
  const numeric = Math.max(1, Number(value) || 0);
  if (numeric <= 5) return 5;
  if (numeric <= 10) return 10;
  if (numeric <= 20) return 20;
  if (numeric <= 50) return Math.ceil(numeric / 10) * 10;
  return Math.ceil(numeric / 25) * 25;
}

function telemetryLiveSeriesModel(modules = []) {
  const source = Array.isArray(modules) ? modules : [];
  const entries = source.map((module, index) => {
    const total = Math.max(0, Number(module.total) || 0);
    const published = Math.max(0, Math.min(total, Number(module.published) || 0));
    const draft = Math.max(0, total - published);
    const storageBytes = Math.max(0, Number(module.storage?.bytes) || 0);
    return {
      moduleName: module.name,
      label: module.label,
      color: telemetrySeriesColor({ moduleName: module.name }, index),
      total,
      published,
      draft,
      storageBytes,
      assetCount: Math.max(0, Number(module.storage?.assetCount) || 0),
      linkCount: Math.max(0, Number(module.content?.linkCount) || 0)
    };
  });
  const publishedTotal = entries.reduce((sum, entry) => sum + entry.published, 0);
  const draftTotal = entries.reduce((sum, entry) => sum + entry.draft, 0);
  const storageTotal = entries.reduce((sum, entry) => sum + entry.storageBytes, 0);
  const recordMax = telemetryNiceRecordMax(Math.max(1, ...entries.flatMap((entry) => [entry.published, entry.draft])));
  const storageMax = Math.max(1, ...entries.map((entry) => entry.storageBytes));
  return { entries, publishedTotal, draftTotal, storageTotal, recordMax, storageMax };
}

function telemetryPlaybackRatio(value, maxValue, { zeroFloor = 0.035 } = {}) {
  const numeric = Math.max(0, Number(value) || 0);
  const max = Math.max(1, Number(maxValue) || 0);
  if (!numeric) return zeroFloor;
  const ratio = Math.max(0, Math.min(1, numeric / max));
  return Math.min(0.94, 0.055 + 0.885 * Math.pow(ratio, 0.58));
}

function telemetryLiveAnchors(model, width = TELEMETRY_PLOT.width) {
  const entries = model?.entries || [];
  const left = TELEMETRY_MODULE_EDGE_PX;
  const right = Math.max(left, width - TELEMETRY_MODULE_EDGE_PX);
  const top = TELEMETRY_PLOT.top;
  const bottom = TELEMETRY_PLOT.bottom;
  const usable = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const recordMax = Math.max(1, Number(model?.recordMax) || 0);
  const storageMax = Math.max(1, Number(model?.storageMax) || 0);

  const step = entries.length > 1 ? usable / (entries.length - 1) : 0;
  return entries.map((entry, index) => {
    const x = entries.length > 1 ? left + step * index : left + usable / 2;
    const publishedRatio = telemetryPlaybackRatio(entry.published, recordMax);
    const draftRatio = telemetryPlaybackRatio(entry.draft, recordMax, { zeroFloor: 0.018 });
    const storageRatio = telemetryPlaybackRatio(entry.storageBytes, storageMax, { zeroFloor: 0.022 });
    return {
      ...entry,
      x,
      yPublished: bottom - publishedRatio * height,
      yDraft: bottom - draftRatio * height,
      yStorage: bottom - storageRatio * height,
      known: true
    };
  });
}

const TELEMETRY_PLAYBACK_DRAW_MS = 5600;
const TELEMETRY_PLAYBACK_HOLD_MS = 360;
const TELEMETRY_PLAYBACK_SEGMENT_SAMPLES = 13;

function telemetryPlaybackSeed(series = "published") {
  if (series === "draft") return 0x64726166;
  if (series === "storage") return 0x73746f72;
  return 0x7075626c;
}

function telemetryPlaybackNoise(seed = 1) {
  const numeric = Math.sin((Number(seed) || 1) * 12.9898 + 78.233) * 43758.5453123;
  return (numeric - Math.floor(numeric)) * 2 - 1;
}

function telemetryTraceRawValue(point, series = "published") {
  if (series === "draft") return Math.max(0, Number(point?.draft) || 0);
  if (series === "storage") return Math.max(0, Number(point?.storageBytes) || 0);
  return Math.max(0, Number(point?.published) || 0);
}

function telemetryReflectIntoPlot(y) {
  const top = TELEMETRY_PLOT.top;
  const bottom = TELEMETRY_PLOT.bottom;
  let next = y;
  if (next < top) next = top + (top - next) * 0.3;
  if (next > bottom) next = bottom - (next - bottom) * 0.3;
  return Math.max(top, Math.min(bottom, next));
}

function telemetryPlaybackTracePoints(anchors = [], series = "published", cycle = 0) {
  if (!anchors.length) return [];
  const yKey = series === "draft" ? "yDraft" : series === "storage" ? "yStorage" : "yPublished";
  const isPublished = series === "published";
  const isDraft = series === "draft";
  const isPrimarySeries = series === telemetryPrimarySeries;
  const seed = telemetryPlaybackSeed(series) + cycle * 104729;
  const points = [{ x: anchors[0].x, y: anchors[0][yKey], anchor: true }];
  let sampleIndex = 0;
  let walk = telemetryPlaybackNoise(seed) * 0.26;

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const point = anchors[index];
    const y0 = previous[yKey];
    const y1 = point[yKey];
    const raw0 = telemetryTraceRawValue(previous, series);
    const raw1 = telemetryTraceRawValue(point, series);
    const bothZero = raw0 === 0 && raw1 === 0;
    const width = Math.max(1, point.x - previous.x);
    const delta = Math.abs(y1 - y0);
    const steps = Math.max(10, Math.min(TELEMETRY_PLAYBACK_SEGMENT_SAMPLES, Math.round(width / 9.5)));

    for (let step = 1; step < steps; step += 1) {
      sampleIndex += 1;
      const t = step / steps;
      const x = previous.x + width * t;
      const baseY = y0 + (y1 - y0) * t;

      if (isDraft && bothZero) {
        points.push({ x, y: baseY, anchor: false });
        continue;
      }

      const impulse = telemetryPlaybackNoise(seed + sampleIndex * 17.31 + index * 41.9);
      const fine = telemetryPlaybackNoise(seed + sampleIndex * 53.17 + index * 9.3);
      const shock = Math.abs(impulse) > 0.76
        ? Math.sign(impulse) * (0.45 + Math.abs(fine) * 0.78)
        : 0;

      const persistence = isPrimarySeries ? 0.42 : isDraft ? 0.6 : isPublished ? 0.48 : 0.54;
      const impulseWeight = isPrimarySeries ? 0.84 : isPublished ? 0.58 : isDraft ? 0.24 : 0.34;
      const shockWeight = isPrimarySeries ? 0.72 : isPublished ? 0.42 : 0.12;
      walk = walk * persistence + impulse * impulseWeight + shock * shockWeight;
      walk = Math.max(isPrimarySeries ? -1.45 : -1.15, Math.min(isPrimarySeries ? 1.45 : 1.15, walk));

      const envelope = Math.pow(Math.sin(Math.PI * t), 0.34);
      let amplitude;
      if (isPrimarySeries) amplitude = Math.min(36, 15 + delta * 0.22);
      else if (isPublished) amplitude = Math.min(18, 7 + delta * 0.13);
      else if (isDraft) amplitude = Math.min(7.5, 2.4 + delta * 0.07);
      else amplitude = Math.min(11, 4.2 + delta * 0.09);

      let y = baseY + (walk * 0.8 + fine * 0.34) * amplitude * envelope;
      y = isPrimarySeries || isPublished
        ? telemetryReflectIntoPlot(y)
        : Math.max(TELEMETRY_PLOT.top, Math.min(TELEMETRY_PLOT.bottom, y));
      points.push({ x, y, anchor: false });
    }

    points.push({ x: point.x, y: point[yKey], anchor: true });
  }

  return points;
}

function telemetryPlaybackState(now = performance.now()) {
  if (!telemetryLiveStartedAt) telemetryLiveStartedAt = now;
  const cycleMs = TELEMETRY_PLAYBACK_DRAW_MS + TELEMETRY_PLAYBACK_HOLD_MS;
  const elapsed = Math.max(0, now - telemetryLiveStartedAt);
  const cycle = Math.floor(elapsed / cycleMs);
  const withinCycle = elapsed - cycle * cycleMs;
  const progress = Math.max(0, Math.min(1, withinCycle / TELEMETRY_PLAYBACK_DRAW_MS));
  return { cycle, progress, holding: withinCycle >= TELEMETRY_PLAYBACK_DRAW_MS };
}

function telemetryPauseAutoFollow(duration = TELEMETRY_FOLLOW_INTERACTION_PAUSE_MS) {
  telemetryAutoFollowPausedUntil = Math.max(telemetryAutoFollowPausedUntil, performance.now() + Math.max(0, Number(duration) || 0));
}

function telemetryFollowLiveHead(head, svgWidth = TELEMETRY_PLOT.width, now = performance.now()) {
  const scroll = document.querySelector(".settings-telemetry-scroll");
  const canvas = $("settingsTelemetryCanvas");
  if (!scroll || !canvas || !head || telemetryAutoFollowHover || now < telemetryAutoFollowPausedUntil || settingsReducedMotion()) return;
  const viewportWidth = Math.max(1, scroll.clientWidth);
  const maxScroll = Math.max(0, scroll.scrollWidth - viewportWidth);
  if (maxScroll <= 0.5) {
    scroll.scrollLeft = 0;
    return;
  }
  const canvasWidth = Math.max(1, canvas.scrollWidth);
  const headPx = (Math.max(0, Number(head.x) || 0) / Math.max(1, Number(svgWidth) || TELEMETRY_PLOT.width)) * canvasWidth;
  const desired = Math.max(0, Math.min(maxScroll, headPx - viewportWidth * TELEMETRY_FOLLOW_FOCUS_RATIO));
  scroll.scrollLeft += (desired - scroll.scrollLeft) * TELEMETRY_FOLLOW_EASE;
  if (Math.abs(desired - scroll.scrollLeft) < 0.35) scroll.scrollLeft = desired;
}

function telemetryPlaybackSlice(points = [], progress = 0) {
  if (!points.length) return { points: [], head: null };
  if (points.length === 1) return { points: [...points], head: points[0] };

  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;
  const headX = firstX + (lastX - firstX) * Math.max(0, Math.min(1, Number(progress) || 0));
  const visible = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];

    if (point.x <= headX + 0.001) {
      visible.push(point);
      continue;
    }

    const span = Math.max(0.0001, point.x - previous.x);
    const mix = Math.max(0, Math.min(1, (headX - previous.x) / span));
    if (mix > 0) {
      visible.push({
        x: headX,
        y: previous.y + (point.y - previous.y) * mix,
        anchor: false
      });
    }
    break;
  }

  const head = visible[visible.length - 1] || points[0];
  return { points: visible, head };
}

function telemetryPolylinePath(points = []) {
  if (points.length < 2) return "";
  return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function telemetryStepPath(points = []) {
  if (points.length < 2) return "";
  let path = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const middle = previous.x + (point.x - previous.x) * 0.56;
    path += ` H${middle.toFixed(2)} V${point.y.toFixed(2)} H${point.x.toFixed(2)}`;
  }
  return path;
}

function telemetryPrimaryWicks(points = [], series = "published", cycle = 0) {
  const commands = [];
  const seed = telemetryPlaybackSeed(series) + cycle * 1499;
  const baseHeight = 5;
  const rangeHeight = 17;
  points.forEach((point, index) => {
    if (point.anchor || index < 2 || index >= points.length - 1 || index % 2 !== 0) return;
    const strength = Math.abs(telemetryPlaybackNoise(seed + index * 23.41));
    const height = baseHeight + strength * rangeHeight;
    const asymmetry = telemetryPlaybackNoise(seed + index * 47.13) * 0.24;
    const top = Math.max(TELEMETRY_PLOT.top, point.y - height * (0.62 + asymmetry));
    const bottom = Math.min(TELEMETRY_PLOT.bottom, point.y + height * (0.48 - asymmetry));
    commands.push(`M${point.x.toFixed(2)} ${top.toFixed(2)}V${bottom.toFixed(2)}`);
  });
  return commands.join(" ");
}

function telemetryMarketTraceFrame(anchors = [], series = "published", now = performance.now()) {
  if (!anchors.length) return { path: "", wicks: "", points: [], head: null, progress: 0, cycle: 0 };
  const playback = telemetryPlaybackState(now);
  const fullPoints = telemetryPlaybackTracePoints(anchors, series, playback.cycle);
  const visible = telemetryPlaybackSlice(fullPoints, playback.progress);
  return {
    path: series === "draft" && series !== telemetryPrimarySeries ? telemetryStepPath(visible.points) : telemetryPolylinePath(visible.points),
    wicks: telemetryPrimaryWicks(visible.points, series, playback.cycle),
    points: visible.points,
    head: visible.head,
    progress: playback.progress,
    cycle: playback.cycle,
    holding: playback.holding
  };
}

function telemetryEnsureLivePaths() {
  const group = $("settingsTelemetrySeries");
  if (!group) return null;
  let primaryWicks = $("settingsTelemetryPrimaryWicks");
  let published = $("settingsTelemetryPublishedLine");
  let draft = $("settingsTelemetryDraftLine");
  let storage = $("settingsTelemetryStorageLine");
  let headHalo = $("settingsTelemetryPlaybackHeadHalo");
  let head = $("settingsTelemetryPlaybackHead");

  if (!primaryWicks || !published || !draft || !storage || !headHalo || !head) {
    group.innerHTML = `<path class="settings-live-wicks settings-live-wicks-primary" id="settingsTelemetryPrimaryWicks"></path><path class="settings-live-trace settings-live-trace-storage" id="settingsTelemetryStorageLine"></path><path class="settings-live-trace settings-live-trace-draft" id="settingsTelemetryDraftLine"></path><path class="settings-live-trace settings-live-trace-published" id="settingsTelemetryPublishedLine"></path><circle class="settings-live-playback-head-halo" id="settingsTelemetryPlaybackHeadHalo" r="7"></circle><rect class="settings-live-playback-head" id="settingsTelemetryPlaybackHead" width="4.4" height="4.4" rx=".55"></rect>`;
    primaryWicks = $("settingsTelemetryPrimaryWicks");
    published = $("settingsTelemetryPublishedLine");
    draft = $("settingsTelemetryDraftLine");
    storage = $("settingsTelemetryStorageLine");
    headHalo = $("settingsTelemetryPlaybackHeadHalo");
    head = $("settingsTelemetryPlaybackHead");
  }

  return { primaryWicks, published, draft, storage, headHalo, head, group };
}

function telemetryPrimaryValue(anchor = {}, series = telemetryPrimarySeries) {
  if (series === "draft") return Number(anchor.draft) || 0;
  if (series === "storage") return Number(anchor.storageBytes) || 0;
  return Number(anchor.published) || 0;
}

function telemetryPrimaryY(anchor = {}, series = telemetryPrimarySeries) {
  if (series === "draft") return anchor.yDraft;
  if (series === "storage") return anchor.yStorage;
  return anchor.yPublished;
}

function applyTelemetryPrimarySeries({ restart = false } = {}) {
  if (!TELEMETRY_PRIMARY_COLORS[telemetryPrimarySeries]) telemetryPrimarySeries = "published";
  const color = TELEMETRY_PRIMARY_COLORS[telemetryPrimarySeries];
  const label = TELEMETRY_PRIMARY_LABELS[telemetryPrimarySeries];
  const plot = $("settingsTelemetrySvg")?.closest(".settings-telemetry-plot");
  const chart = $("settingsDistributionChart");
  [plot, chart].forEach((node) => {
    if (!node) return;
    node.dataset.primarySeries = telemetryPrimarySeries;
    node.style.setProperty("--telemetry-primary", color);
  });

  document.querySelectorAll("[data-telemetry-primary]").forEach((button) => {
    const active = button.dataset.telemetryPrimary === telemetryPrimarySeries;
    button.classList.toggle("is-primary", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", `${TELEMETRY_PRIMARY_LABELS[button.dataset.telemetryPrimary] || "Telemetry"}${active ? ", main telemetry line" : ", make main telemetry line"}`);
  });

  setText("settingsTelemetryPrimaryLabel", `${label} · MAIN`);
  setText("settingsTelemetryHistoryState", `${label.toUpperCase()} · LIVE DRAW`);
  if (restart) telemetryLiveStartedAt = performance.now();
}

function telemetryRenderAxes() {
  const recordAxis = $("settingsTelemetryRecordAxis");
  const storageAxis = $("settingsTelemetryStorageAxis");
  if (recordAxis) recordAxis.innerHTML = "";
  if (storageAxis) storageAxis.innerHTML = "";
}

function telemetryRenderLiveGrid(width = TELEMETRY_PLOT.width) {
  const grid = $("settingsTelemetryGrid");
  if (!grid) return;
  const left = TELEMETRY_PLOT.left;
  const right = width - (TELEMETRY_PLOT.width - TELEMETRY_PLOT.right);
  const top = TELEMETRY_PLOT.top;
  const bottom = TELEMETRY_PLOT.bottom;
  const horizontal = Array.from({ length: 7 }, (_, index) => {
    const y = top + ((bottom - top) * index) / 6;
    return `<path d="M${left} ${y.toFixed(2)}H${right}"/>`;
  }).join("");
  const vertical = Array.from({ length: 13 }, (_, index) => {
    const x = left + ((right - left) * index) / 12;
    return `<path d="M${x.toFixed(2)} ${top}V${bottom}"/>`;
  }).join("");
  grid.innerHTML = horizontal + `<g>${vertical}</g>`;
}

function telemetryRenderLiveFrame(now) {
  if (!telemetryLiveModel) {
    telemetryChartFrame = 0;
    return;
  }

  const paths = telemetryEnsureLivePaths();
  if (!paths) {
    telemetryChartFrame = 0;
    return;
  }

  const svg = $("settingsTelemetrySvg");
  const width = Number(svg?.viewBox?.baseVal?.width) || TELEMETRY_PLOT.width;
  const anchors = telemetryLiveAnchors(telemetryLiveModel, width);
  const frames = {
    published: telemetryMarketTraceFrame(anchors, "published", now),
    draft: telemetryMarketTraceFrame(anchors, "draft", now),
    storage: telemetryMarketTraceFrame(anchors, "storage", now)
  };

  paths.published.setAttribute("d", frames.published.path);
  paths.draft.setAttribute("d", frames.draft.path);
  paths.storage.setAttribute("d", frames.storage.path);

  const primaryPath = paths[telemetryPrimarySeries] || paths.published;
  const primaryFrame = frames[telemetryPrimarySeries] || frames.published;
  paths.primaryWicks.setAttribute("d", primaryFrame.wicks);
  paths.primaryWicks.hidden = false;

  [paths.published, paths.draft, paths.storage].forEach((path) => {
    const series = path === paths.published ? "published" : path === paths.draft ? "draft" : "storage";
    const primary = series === telemetryPrimarySeries;
    path.classList.toggle("is-primary", primary);
    path.classList.toggle("is-secondary", !primary);
    if (primary) path.setAttribute("filter", "url(#settingsTelemetryPrimaryGlow)");
    else path.removeAttribute("filter");
  });

  if (primaryPath && paths.group && primaryPath.nextSibling !== paths.headHalo) paths.group.insertBefore(primaryPath, paths.headHalo);
  if (paths.primaryWicks && paths.group && paths.primaryWicks.nextSibling !== primaryPath) paths.group.insertBefore(paths.primaryWicks, primaryPath);

  const head = primaryFrame.head;
  if (head) {
    telemetryFollowLiveHead(primaryFrame.head, width, now);
    paths.headHalo.setAttribute("cx", head.x.toFixed(2));
    paths.headHalo.setAttribute("cy", head.y.toFixed(2));
    paths.head.setAttribute("x", (head.x - 2.2).toFixed(2));
    paths.head.setAttribute("y", (head.y - 2.2).toFixed(2));
    paths.head.removeAttribute("hidden");
    paths.headHalo.removeAttribute("hidden");
  } else {
    paths.head.hidden = true;
    paths.headHalo.hidden = true;
  }

  telemetryScanVisiblePoints = anchors.map((anchor) => ({
    ...anchor,
    y: telemetryPrimaryY(anchor),
    value: telemetryPrimaryValue(anchor),
    detail: `Published ${anchor.published} · Draft ${anchor.draft} · ${formatStorageBytes(anchor.storageBytes)} storage`
  }));

  if (!settingsReducedMotion()) telemetryChartFrame = window.requestAnimationFrame(telemetryRenderLiveFrame);
  else telemetryChartFrame = 0;
}

function clearTelemetryPlot() {
  if (telemetryChartFrame) window.cancelAnimationFrame(telemetryChartFrame);
  telemetryChartFrame = 0;
  const group = $("settingsTelemetrySeries");
  if (group) group.innerHTML = "";
  telemetryLiveModel = null;
  telemetryLiveStartedAt = 0;
  telemetryScanVisiblePoints = [];
  setTelemetryActiveModule("");
}

function stopTelemetryAnimation({ resetHistory = false } = {}) {
  if (telemetryChartFrame) window.cancelAnimationFrame(telemetryChartFrame);
  telemetryChartFrame = 0;
  telemetryLiveStartedAt = 0;
  setTelemetryActiveModule("");
  if (resetHistory) {
    telemetryHistory = [];
    telemetryHistoryKey = "";
    clearTelemetryPlot();
  }
}

function animateTelemetryChart(modules = []) {
  const validModules = Array.isArray(modules) ? modules : [];
  telemetryLiveModel = telemetryLiveSeriesModel(validModules);
  if (telemetryChartFrame) window.cancelAnimationFrame(telemetryChartFrame);
  telemetryChartFrame = 0;

  const width = configureTelemetryCanvas({ min: 0, max: 100 }, validModules.length || 1);
  const telemetryScroll = document.querySelector(".settings-telemetry-scroll");
  if (telemetryScroll) telemetryScroll.scrollLeft = 0;
  telemetryRenderLiveGrid(width);
  const anchors = telemetryLiveAnchors(telemetryLiveModel, width);
  updateTelemetryProfileAxis(anchors.map((anchor) => ({ ...anchor, color: anchor.color })), width);
  telemetryRenderAxes(telemetryLiveModel);
  updateTelemetryPressureVisual(telemetryPlanSnapshot().usedPercent);

  setText("settingsTelemetryPublishedTotal", telemetryLiveModel.publishedTotal);
  setText("settingsTelemetryDraftTotal", telemetryLiveModel.draftTotal);
  setText("settingsTelemetryStorageTotal", formatStorageBytes(telemetryLiveModel.storageTotal));
  setText("settingsTelemetryCaption", `Real public modules · ${telemetryLiveModel.publishedTotal} published · ${telemetryLiveModel.draftTotal} draft · ${formatStorageBytes(telemetryLiveModel.storageTotal)} tracked storage`);

  const statePill = $("settingsDistributionState");
  if (statePill) {
    statePill.textContent = "Live";
    statePill.className = "health-pill success";
  }

  telemetryEnsureLivePaths();
  applyTelemetryPrimarySeries();
  if (settingsReducedMotion()) telemetryRenderLiveFrame(performance.now());
  else telemetryChartFrame = window.requestAnimationFrame(telemetryRenderLiveFrame);
}

function snapshotTelemetryModules(modules = []) {
  return new Map(modules.map((module) => [module.name, {
    label: module.label,
    total: Math.max(0, Number(module.total) || 0),
    published: Math.max(0, Number(module.published) || 0),
    cloudinaryAssets: Math.max(0, Number(module.storage?.cloudinaryAssets) || 0),
    cloudinaryBytes: Math.max(0, Number(module.storage?.cloudinaryBytes) || 0)
  }]));
}

function detectTelemetryModuleChanges(modules = []) {
  const next = snapshotTelemetryModules(modules);
  if (!telemetryBaselineReady || !telemetryModuleBaseline.size) {
    telemetryModuleBaseline = next;
    return;
  }

  let storageCandidate = null;
  let recordsCandidate = null;
  next.forEach((current, name) => {
    const previous = telemetryModuleBaseline.get(name);
    if (!previous) {
      if (current.cloudinaryAssets > 0) storageCandidate = { score: current.cloudinaryAssets, label: current.label, moduleName: name, detail: `${current.cloudinaryAssets} Cloudinary file${current.cloudinaryAssets === 1 ? "" : "s"} added` };
      if (current.total > 0) recordsCandidate = { score: current.total, label: current.label, moduleName: name, detail: `${current.total} record${current.total === 1 ? "" : "s"} added` };
      return;
    }
    const assetDelta = current.cloudinaryAssets - previous.cloudinaryAssets;
    const byteDelta = current.cloudinaryBytes - previous.cloudinaryBytes;
    const recordDelta = current.total - previous.total;
    const publishedDelta = current.published - previous.published;
    if (assetDelta !== 0 || (byteDelta !== 0 && recordDelta !== 0)) {
      const score = Math.max(Math.abs(byteDelta), Math.abs(assetDelta));
      if (!storageCandidate || score > storageCandidate.score) {
        const direction = byteDelta < 0 || assetDelta < 0 ? "removed" : "added";
        const byteText = byteDelta ? formatStorageBytes(Math.abs(byteDelta)) : `${Math.abs(assetDelta)} file${Math.abs(assetDelta) === 1 ? "" : "s"}`;
        storageCandidate = { score, label: current.label, moduleName: name, detail: `${byteText} ${direction}` };
      }
    }
    if (recordDelta !== 0 || publishedDelta !== 0) {
      const score = Math.max(Math.abs(recordDelta), Math.abs(publishedDelta));
      if (!recordsCandidate || score > recordsCandidate.score) {
        const parts = [];
        if (recordDelta) parts.push(`${recordDelta > 0 ? "+" : ""}${recordDelta} record${Math.abs(recordDelta) === 1 ? "" : "s"}`);
        if (publishedDelta) parts.push(`${publishedDelta > 0 ? "+" : ""}${publishedDelta} published`);
        recordsCandidate = { score, label: current.label, moduleName: name, detail: parts.join(" · ") };
      }
    }
  });

  if (storageCandidate) {
    telemetryPendingStorageSource = storageCandidate;
    if (cloudinaryTelemetryState.available === true && !cloudinaryTelemetryState.pending) {
      window.setTimeout(() => {
        if (!document.hidden && cloudinaryTelemetryState.available === true && !cloudinaryTelemetryState.pending) fetchCloudinaryTelemetry([]);
      }, 12000);
    }
  }
  if (recordsCandidate) queueTelemetryEvent("records", recordsCandidate);
  telemetryModuleBaseline = next;
}

function detectTelemetryAccountChange(payload = null) {
  const next = telemetryPlanSnapshotFromUsage(payload);
  const previous = telemetryAccountBaseline;
  telemetryAccountBaseline = next;
  if (!previous || !Number.isFinite(Number(previous.usedPercent)) || !Number.isFinite(Number(next.usedPercent))) return;
  const percentDelta = Number(next.usedPercent) - Number(previous.usedPercent);
  const limitChanged = Number.isFinite(Number(previous.limit)) && Number.isFinite(Number(next.limit)) && Math.abs(Number(next.limit) - Number(previous.limit)) > 1;
  if (limitChanged) {
    const increased = Number(next.limit) > Number(previous.limit);
    telemetryPendingStorageSource = null;
    queueTelemetryEvent("storage", {
      label: increased ? "Cloudinary plan upgrade" : "Cloudinary plan capacity change",
      detail: `${Number(previous.usedPercent).toFixed(1)}% → ${Number(next.usedPercent).toFixed(1)}% plan usage`
    });
    return;
  }
  if (Math.abs(percentDelta) >= .01) {
    const source = telemetryPendingStorageSource;
    telemetryPendingStorageSource = null;
    queueTelemetryEvent("storage", source ? {
      label: source.label,
      moduleName: source.moduleName,
      detail: `${source.detail} · ${Number(previous.usedPercent).toFixed(2)}% → ${Number(next.usedPercent).toFixed(2)}%`
    } : {
      label: percentDelta > 0 ? "Plan usage increased" : "Plan usage decreased",
      detail: `${Number(previous.usedPercent).toFixed(2)}% → ${Number(next.usedPercent).toFixed(2)}%`
    });
  }
}

function renderTelemetryModuleCards(modules = []) {
  const container = $("settingsTelemetryModules");
  if (!container) return;
  const model = telemetryLiveSeriesModel(modules);
  container.innerHTML = model.entries.map((entry, index) => {
    const seriesColor = telemetrySeriesColor({ moduleName: entry.moduleName }, index);
    const publishedShare = model.recordMax > 0 ? Math.max(0, Math.min(100, (entry.published / model.recordMax) * 100)) : 0;
    const storageText = entry.assetCount ? `${formatStorageBytes(entry.storageBytes)} · ${entry.assetCount} file${entry.assetCount === 1 ? "" : "s"}` : "No stored media";
    const moduleMeta = modules[index]?.customAggregate ? `${Math.max(0, Number(modules[index]?.moduleCount) || 0)} module${Number(modules[index]?.moduleCount) === 1 ? "" : "s"} · ` : "";
    const detail = `${moduleMeta}Published ${entry.published} · Draft ${entry.draft} · ${storageText} · ${entry.linkCount} link${entry.linkCount === 1 ? "" : "s"}`;
    const status = entry.draft > 0 ? `${entry.draft} draft` : "";
    const iconMarkup = renderSystemIcon(modules[index]?.iconName || NAVIGATION_ICON_MAP.custom, { className:"settings-module-system-icon" });
    return `<article data-settings-module="${escapeTelemetryHtml(entry.moduleName)}" data-market-index="${index}" style="--share:${publishedShare.toFixed(2)}%;--series-color:${seriesColor}"><span class="settings-module-glyph" aria-hidden="true">${iconMarkup}</span><div><small>${escapeTelemetryHtml(entry.label)}</small><strong data-settings-count="${escapeTelemetryHtml(entry.moduleName)}">${entry.total}</strong><span class="settings-module-footprint">${escapeTelemetryHtml(detail)}</span><span class="settings-module-status${status ? " is-attention" : ""}" ${status ? "" : "hidden"}>${escapeTelemetryHtml(status)}</span></div><i><b style="--share:${publishedShare.toFixed(2)}%"></b></i></article>`;
  }).join("");
}

function renderPortfolioDistribution(modules = []) {
  const validModules = Array.isArray(modules) ? modules : [];
  if (telemetryBaselineReady) detectTelemetryModuleChanges(validModules);
  const total = validModules.reduce((sum, module) => sum + (Number(module.total) || 0), 0);
  const published = validModules.reduce((sum, module) => sum + (Number(module.published) || 0), 0);
  const hidden = Math.max(0, total - published);
  const publishedShare = total > 0 ? Math.round((published / total) * 100) : 0;

  animateSettingsMetric("settingsPortfolioRecords", total, { duration: 720 });
  animateSettingsMetric("settingsPublishedRecords", published, { duration: 720 });
  animateSettingsMetric("settingsPublishedShare", publishedShare, { suffix: "%", duration: 680 });
  animateSettingsMetric("settingsPublishedLegend", published, { duration: 560 });
  animateSettingsMetric("settingsPortfolioHealthTotal", total, { duration: 560 });
  animateSettingsMetric("settingsHealthReadyCount", published, { duration: 560 });
  animateSettingsMetric("settingsHiddenLegend", hidden, { duration: 520 });
  const managedModuleCount = validModules.reduce((sum, module) => sum + (module.customAggregate ? Math.max(0, Number(module.moduleCount) || 0) : 1), 0);
  animateSettingsMetric("settingsHealthModuleCount", managedModuleCount, { duration: 460 });
  animateSettingsMetric("settingsHealthCoverage", publishedShare, { suffix: "%", duration: 680 });

  const statePill = $("settingsDistributionState");
  if (statePill) {
    statePill.textContent = total ? "Live" : "Empty";
    statePill.className = `health-pill ${total ? "success" : "warning"}`;
  }
  const readinessBadge = $("settingsReadinessBadge");
  if (readinessBadge) {
    const label = readinessBadge.querySelector("span");
    const healthy = total > 0 && hidden === 0;
    readinessBadge.classList.toggle("warning", !healthy);
    if (label) label.textContent = total ? (healthy ? "Healthy" : "Attention") : "No data";
  }
  $("settingsReadinessProgress")?.style.setProperty("--readiness", `${publishedShare}%`);
  const healthNote = $("settingsHealthNote");
  if (healthNote) {
    healthNote.textContent = !total
      ? "No portfolio records are available yet."
      : hidden === 0
        ? "All managed records are Published + Visible."
        : `${hidden} record${hidden === 1 ? " is" : "s are"} draft, hidden, or not publicly ready.`;
  }
  setText("settingsHealthProfileLabel", total ? `${publishedShare}% coverage` : "Waiting for data");

  const graphModules = publicTelemetryGraphModules(validModules);
  renderTelemetryModuleCards(graphModules);
  renderCloudinaryUsage(cloudinaryTelemetryState.usage);
  const coverageBars = $("settingsHealthCoverageBars");
  if (coverageBars) {
    coverageBars.innerHTML = validModules.map((module) => {
      const coverage = module.total > 0 ? Math.max(0, Math.min(100, (module.published / module.total) * 100)) : 0;
      return `<i style="--coverage:${coverage.toFixed(1)}%"><b></b></i>`;
    }).join("");
  }
  animateTelemetryChart(graphModules);
  scheduleMediaTelemetryResolution(validModules);
}

function collectUnresolvedReferences(modules = []) {
  const references = new Map();
  modules.forEach((module) => {
    (module.storage?.unresolvedReferences || []).forEach((reference) => {
      if (!reference.key || mediaTelemetryState.attempted.has(reference.key) || mediaTelemetryState.pending.has(reference.key)) return;
      references.set(reference.key, reference);
    });
  });
  return [...references.values()].slice(0, 24);
}

function rememberResolvedMediaAsset(asset = {}) {
  if (!asset?.key || !(Number(asset.bytes) > 0)) return;
  const normalized = { ...asset, bytes: Number(asset.bytes) };
  mediaTelemetryState.resolvedAssets.set(asset.key, normalized);
  if (asset.url) mediaTelemetryState.resolvedAssets.set(asset.url, normalized);
  if (asset.secureUrl) mediaTelemetryState.resolvedAssets.set(asset.secureUrl, normalized);
  if (asset.assetId) mediaTelemetryState.resolvedAssets.set(asset.assetId, normalized);
  if (asset.publicId) mediaTelemetryState.resolvedAssets.set(asset.publicId, normalized);
}

async function resolvePublicAssetSize(reference = {}) {
  if (!reference.url) return null;
  try {
    const canonical = String(resolveAssetUrl(reference.url, "display") || "").trim();
    if (!canonical || !/^(?:https?:\/\/|\/)/i.test(canonical)) return null;
    const url = new URL(canonical, window.location.origin);
    const response = await fetch(url.href, { method: "HEAD", cache: "no-store", credentials: url.origin === window.location.origin ? "same-origin" : "omit" });
    if (!response.ok) return null;
    const bytes = Number(response.headers.get("content-length"));
    if (!(bytes > 0)) return null;
    return { ...reference, url: url.href, bytes };
  } catch {
    return null;
  }
}

function metricPercent(metric = null) {
  const explicit = optionalTelemetryNumber(metric?.usedPercent);
  if (explicit != null) return Math.max(0, explicit);
  const usage = optionalTelemetryNumber(metric?.usage);
  const limit = optionalTelemetryNumber(metric?.limit);
  return usage != null && limit != null && limit > 0 ? Math.max(0, (usage / limit) * 100) : null;
}

function cloudinaryRetryAt(error = null) {
  const explicit = Date.parse(String(error?.retryAt || ""));
  if (Number.isFinite(explicit)) return explicit;
  const message = String(error?.message || "");
  const match = message.match(/try again on\s+(.+?)(?:\.|$)/i);
  if (match) {
    const parsed = Date.parse(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + CLOUDINARY_FAILURE_RETRY_MS;
}

function cloudinaryRetryLabel() {
  const retryAt = Number(cloudinaryTelemetryState.retryAt) || 0;
  if (!retryAt || retryAt <= Date.now()) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(retryAt));
}

function renderUsageMeter(id, metric = null) {
  const node = $(id);
  if (!node) return;
  const percent = metricPercent(metric);
  node.style.setProperty("--usage", `${Math.max(0, Math.min(100, Number(percent) || 0))}%`);
  node.closest("article")?.toggleAttribute("data-usage-known", Number.isFinite(percent));
}

function cloudinaryAccountStatus() {
  if (cloudinaryTelemetryState.pending) return { label: "Connecting…", tone: "checking" };
  if (cloudinaryTelemetryState.available === true) return { label: "Connected", tone: "success" };
  const code = String(cloudinaryTelemetryState.errorCode || "");
  if (code.includes("not-found") || code.includes("unimplemented")) return { label: "Secure telemetry bridge is not connected", tone: "warning" };
  if (code.includes("firebase-unauthenticated")) return { label: "Administrator session expired · sign in again", tone: "warning" };
  if (code.includes("firebase-permission-denied")) return { label: "Administrator permission denied", tone: "danger" };
  if (code.includes("cloudinary-auth-failed")) return { label: "Cloudinary API key or secret rejected", tone: "danger" };
  if (code.includes("cloudinary-permission-denied")) return { label: "Cloudinary API key lacks Admin API permission", tone: "danger" };
  if (code.includes("cloudinary-rate-limited")) {
    const retry = cloudinaryRetryLabel();
    return { label: retry ? `Account telemetry paused until ${retry}` : "Cloudinary Admin API rate limit reached", tone: "warning" };
  }
  if (code.includes("bridge-unavailable") || code.includes("internal") || code.includes("failed-precondition")) return { label: "Secure telemetry bridge unavailable", tone: "warning" };
  if (cloudinaryTelemetryState.available === false) return { label: "Cloudinary account totals unavailable", tone: "warning" };
  return { label: "Checking connection", tone: "checking" };
}

function renderCloudinaryUsage(payload = null) {
  if (payload) {
    detectTelemetryAccountChange(payload);
    cloudinaryTelemetryState.usage = payload;
    cloudinaryTelemetryState.updatedAt = Date.now();
  }
  if (storageHubSettings) buildStorageHubTelemetrySnapshot();
  const activePayload = payload || cloudinaryTelemetryState.usage || null;
  const storage = activePayload?.storage || null;
  const bandwidth = activePayload?.bandwidth || null;
  const credits = activePayload?.credits || null;
  const transformations = activePayload?.transformations || null;
  const resources = activePayload?.resources || null;
  const requests = activePayload?.requests || null;
  const tracked = trackedStorageTotals();
  const status = cloudinaryAccountStatus();

  const rateLimited = String(cloudinaryTelemetryState.errorCode || "").includes("cloudinary-rate-limited");
  setText("storageStatus", rateLimited
    ? "Account telemetry paused; uploads remain configured"
    : activePayload ? "Account telemetry connected" : cloudinaryConfig.uploadPreset ? "Uploads configured" : "Upload configuration incomplete");
  setText("cloudinaryAccountState", status.label);
  const stateNode = $("cloudinaryAccountState");
  if (stateNode) stateNode.dataset.state = status.tone;
  const retryLabel = cloudinaryRetryLabel();
  setText("cloudinaryAccountUpdated", retryLabel
    ? `Automatic retry after ${retryLabel}`
    : activePayload?.updatedAt ? `Updated ${formatDate(activePayload.updatedAt)}` : activePayload ? "Verified totals" : "CMS media totals available");

  setText("cloudinaryPlan", activePayload?.plan || "—");
  setText("cloudinaryAccountAssets", resources?.usage != null ? formatUsageNumber(resources.usage) : "—");
  setText("cloudinaryAccountAssetsLimit", resources?.limit != null ? `of ${formatUsageNumber(resources.limit)}` : "Cloudinary total assets");

  setText("cloudinaryStorageUsage", storage?.usage != null ? formatStorageBytes(storage.usage) : tracked.cloudinaryBytes ? formatStorageBytes(tracked.cloudinaryBytes) : "—");
  setText("cloudinaryStorageLimit", storage?.limit != null ? `of ${formatStorageBytes(storage.limit)}` : tracked.cloudinaryBytes ? "tracked CMS Cloudinary files" : "Account capacity unavailable");
  setText("cloudinaryStoragePercent", metricPercent(storage) != null ? `${Math.round(metricPercent(storage))}%` : "");

  setText("cloudinaryBandwidthUsage", bandwidth?.usage != null ? formatStorageBytes(bandwidth.usage) : "—");
  setText("cloudinaryBandwidthLimit", bandwidth?.limit != null ? `of ${formatStorageBytes(bandwidth.limit)}` : "Rolling account bandwidth");
  setText("cloudinaryBandwidthPercent", metricPercent(bandwidth) != null ? `${Math.round(metricPercent(bandwidth))}%` : "");

  setText("cloudinaryCreditsUsage", credits?.usage != null ? formatUsageNumber(credits.usage, { maximumFractionDigits: 2 }) : "—");
  setText("cloudinaryCreditsLimit", credits?.limit != null ? `of ${formatUsageNumber(credits.limit, { maximumFractionDigits: 2 })}` : "Current plan credits");
  setText("cloudinaryCreditsPercent", metricPercent(credits) != null ? `${Math.round(metricPercent(credits))}%` : "");

  setText("cloudinaryTransformationsUsage", transformations?.usage != null ? formatUsageNumber(transformations.usage) : "—");
  setText("cloudinaryTransformationsLimit", transformations?.limit != null ? `of ${formatUsageNumber(transformations.limit)}` : "Rolling transformations");
  setText("cloudinaryTransformationsPercent", metricPercent(transformations) != null ? `${Math.round(metricPercent(transformations))}%` : "");

  setText("cloudinaryRequestsUsage", requests?.usage != null ? formatUsageNumber(requests.usage) : "—");
  setText("cloudinaryRequestsLimit", requests?.limit != null ? `of ${formatUsageNumber(requests.limit)}` : "Admin API requests");
  setText("cloudinaryTrackedStorage", tracked.bytes ? formatStorageBytes(tracked.bytes) : "—");
  setText("cloudinaryTrackedStorageDetail", `${tracked.assets} CMS file${tracked.assets === 1 ? "" : "s"}${tracked.unresolved ? ` · ${tracked.unresolved} size${tracked.unresolved === 1 ? "" : "s"} resolving` : ""}`);

  renderUsageMeter("cloudinaryStorageMeter", storage);
  renderUsageMeter("cloudinaryBandwidthMeter", bandwidth);
  renderUsageMeter("cloudinaryCreditsMeter", credits);
  renderUsageMeter("cloudinaryTransformationsMeter", transformations);

  if (["storage", "spectrum"].includes(telemetryMetric) && telemetryRenderedModules.length) animateTelemetryChart(publicTelemetryGraphModules(telemetryRenderedModules));
}

async function fetchCloudinaryTelemetry(references = []) {
  if (cloudinaryTelemetryState.pending) return cloudinaryTelemetryState.usage;
  if (cloudinaryTelemetryState.retryAt > Date.now()) {
    renderCloudinaryUsage(cloudinaryTelemetryState.usage);
    return cloudinaryTelemetryState.usage;
  }
  cloudinaryTelemetryState.pending = true;
  cloudinaryTelemetryState.errorCode = "";
  cloudinaryTelemetryState.errorMessage = "";
  renderCloudinaryUsage(cloudinaryTelemetryState.usage);
  try {
    const payload = await cloudinaryStorageProvider.getUsage({ references });
    if (!payload || !payload.updatedAt) throw Object.assign(new Error("Telemetry bridge returned an invalid Cloudinary payload."), { code: "bridge-unavailable" });
    cloudinaryTelemetryState.available = true;
    cloudinaryTelemetryState.lastFailureAt = 0;
    cloudinaryTelemetryState.retryAt = 0;
    cloudinaryTelemetryState.errorCode = "";
    cloudinaryTelemetryState.errorMessage = "";
    systemHealth.cacheCloudinaryUsageSnapshot(payload);
    (payload?.assets || []).forEach((asset) => rememberResolvedMediaAsset({
      ...asset,
      url: asset.secureUrl || "",
      assetId: asset.assetId || "",
      publicId: asset.publicId || "",
      source: "cloudinary"
    }));
    renderCloudinaryUsage(payload);
    mergeCloudinaryHistory(payload?.history || []);
    return payload;
  } catch (error) {
    cloudinaryTelemetryState.available = false;
    cloudinaryTelemetryState.lastFailureAt = Date.now();
    cloudinaryTelemetryState.errorCode = String(error?.code || "");
    cloudinaryTelemetryState.errorMessage = String(error?.message || "Cloudinary account telemetry unavailable");
    cloudinaryTelemetryState.retryAt = cloudinaryTelemetryState.errorCode.includes("cloudinary-rate-limited")
      ? cloudinaryRetryAt(error)
      : Date.now() + CLOUDINARY_FAILURE_RETRY_MS;
    console.info("Cloudinary account telemetry request failed; automatic retries are paused until the retry window.", error);
    renderCloudinaryUsage(cloudinaryTelemetryState.usage);
    return null;
  } finally {
    cloudinaryTelemetryState.pending = false;
    renderCloudinaryUsage(cloudinaryTelemetryState.usage);
  }
}

async function resolveMediaReferences(references = []) {
  if (!references.length) {
    if (cloudinaryTelemetryState.available === null) await fetchCloudinaryTelemetry([]);
    return;
  }
  references.forEach((reference) => mediaTelemetryState.pending.add(reference.key));
  const headerResults = await Promise.allSettled(references.map(resolvePublicAssetSize));
  headerResults.forEach((result) => {
    if (result.status === "fulfilled" && result.value) rememberResolvedMediaAsset(result.value);
  });

  const stillUnresolved = references.filter((reference) => !mediaTelemetryState.resolvedAssets.get(reference.key)?.bytes);
  const cloudinaryReferences = stillUnresolved.filter((reference) => reference.source === "cloudinary");
  const canRetryAccountApi = cloudinaryTelemetryState.available !== false
    || (Date.now() >= cloudinaryTelemetryState.retryAt && Date.now() - cloudinaryTelemetryState.lastFailureAt > CLOUDINARY_FAILURE_RETRY_MS);
  if (cloudinaryReferences.length && canRetryAccountApi) await fetchCloudinaryTelemetry(cloudinaryReferences.slice(0, 20));
  else if (cloudinaryTelemetryState.available === null) await fetchCloudinaryTelemetry([]);

  references.forEach((reference) => {
    mediaTelemetryState.pending.delete(reference.key);
    mediaTelemetryState.attempted.add(reference.key);
  });
}

function scheduleMediaTelemetryResolution(modules = []) {
  const references = collectUnresolvedReferences(modules);
  if (!references.length && cloudinaryTelemetryState.available !== null) return;
  if (telemetryMediaRequestFrame) window.clearTimeout(telemetryMediaRequestFrame);
  telemetryMediaRequestFrame = window.setTimeout(async () => {
    telemetryMediaRequestFrame = 0;
    await resolveMediaReferences(references);
    if (references.length) renderPortfolioDistribution(buildTelemetryModules());
  }, 240);
}

function stopTelemetryRealtime() {
  telemetryRealtimeUnsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) {}
  });
  telemetryRealtimeUnsubscribers = [];
  telemetryRealtimeModules = new Map();
  telemetryFeatureSections = [];
  telemetryFeatureEntries = [];
  telemetryModuleBaseline = new Map();
  telemetryBaselineReady = false;
  telemetryPendingStorageSource = null;
  stopTelemetryAnimation();
  if (telemetryMediaRequestFrame) window.clearTimeout(telemetryMediaRequestFrame);
  telemetryMediaRequestFrame = 0;
  if (cloudinaryUsageRefreshTimer) window.clearInterval(cloudinaryUsageRefreshTimer);
  cloudinaryUsageRefreshTimer = 0;
}

function startTelemetryRealtime() {
  stopTelemetryRealtime();
  const loadedCore = new Set();
  let sectionsLoaded = false;
  let entriesLoaded = false;
  const publish = () => {
    if (!loadedCore.size) return;
    const modules = buildTelemetryModules();
    const complete = loadedCore.size === CORE_TELEMETRY_MODULES.length && sectionsLoaded && entriesLoaded;
    if (complete && !telemetryBaselineReady) {
      telemetryModuleBaseline = snapshotTelemetryModules(modules);
      telemetryBaselineReady = true;
    }
    renderPortfolioDistribution(modules);
    if (!complete) setText("settingsHealthProfileLabel", "Loading remaining sources");
  };

  telemetryRealtimeUnsubscribers = CORE_TELEMETRY_MODULES.map((definition) => onSnapshot(
    collection(db, definition.collection),
    (snapshot) => {
      const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      telemetryRealtimeModules.set(definition.collection, { records });
      loadedCore.add(definition.collection);
      publish();
    },
    (error) => {
      console.warn(`Telemetry listener failed for ${definition.collection}`, error);
      telemetryRealtimeModules.set(definition.collection, { records: [], error: error?.message || "Read failed" });
      loadedCore.add(definition.collection);
      publish();
    }
  ));

  telemetryRealtimeUnsubscribers.push(onSnapshot(
    collection(db, "portfolioSections"),
    (snapshot) => {
      telemetryFeatureSections = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      sectionsLoaded = true;
      publish();
    },
    (error) => {
      console.warn("Telemetry listener failed for portfolioSections", error);
      telemetryFeatureSections = [];
      sectionsLoaded = true;
      publish();
    }
  ));

  telemetryRealtimeUnsubscribers.push(onSnapshot(
    collection(db, "portfolioSectionEntries"),
    (snapshot) => {
      telemetryFeatureEntries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      entriesLoaded = true;
      publish();
    },
    (error) => {
      console.warn("Telemetry listener failed for portfolioSectionEntries", error);
      telemetryFeatureEntries = [];
      entriesLoaded = true;
      publish();
    }
  ));

  cloudinaryUsageRefreshTimer = window.setInterval(() => {
    if (document.hidden || cloudinaryTelemetryState.pending || cloudinaryTelemetryState.retryAt > Date.now()) return;
    fetchCloudinaryTelemetry([]);
  }, CLOUDINARY_REFRESH_MS);
}

function walkValues(value, visitor) { if (Array.isArray(value)) value.forEach((item) => walkValues(item, visitor)); else if (value && typeof value === "object") Object.values(value).forEach((item) => walkValues(item, visitor)); else visitor(value); }
async function countAssets(modules = null) {
  const source = modules
    ? [...modules, await readModule("portfolioSectionEntries")]
    : await Promise.all([...CORE_TELEMETRY_MODULES.map((item) => item.collection), "portfolioSectionEntries"].map(readModule));
  const imageRefs = new Set();
  const pdfRefs = new Set();

  source.forEach((module) => module.records.forEach((record) => walkValues(record, (value) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    const lower = normalized.toLowerCase();
    if (/\.(png|jpe?g|webp|gif)(\?|$)/.test(lower) || lower.includes("/image/upload/")) imageRefs.add(normalized);
    if (/\.pdf(\?|$)/.test(lower) || lower.includes("/raw/upload/")) pdfRefs.add(normalized);
  })));

  const images = imageRefs.size;
  const pdfs = pdfRefs.size;
  setText("uploadedImageCount", images);
  setText("uploadedPdfCount", pdfs);
  setText("settingsMediaTotal", images + pdfs);
  document.querySelectorAll("[data-media-total-mirror]").forEach((element) => { element.textContent = String(images + pdfs); });

  const total = images + pdfs;
  const imageShare = total > 0 ? Math.round((images / total) * 100) : 0;
  $("settingsMediaRing")?.style.setProperty("--image-share", `${imageShare}%`);
  syncAppearancePreview();
}

function diagnosticServiceGlyph(id = "") {
  return ({ authentication: "A", firestore: "F", cloudinary: "C", public: "P", storage: "S", "module-registry": "M" })[id] || "•";
}

function diagnosticStatusLabel(item = {}) {
  if (item.severity === "critical") return "Critical";
  if (item.severity === "warning") return "Attention";
  if (item.severity === "info") return "Checking";
  return "Healthy";
}

function setRepairStage(stateName = "idle", title = "Recovery engine ready", message = "Safe repairs run only when a known recovery procedure exists.") {
  const stage = $("settingsRepairStage");
  if (stage) stage.dataset.state = stateName;
  setText("settingsRepairTitle", title);
  setText("settingsRepairMessage", message);
}

function renderDiagnosticHistory() {
  const list = $("diagnosticHistoryList");
  if (!list) return;
  const history = systemHealth.getHealthHistory();
  if (!history.length) {
    list.innerHTML = '<p class="settings-diagnostic-empty">No diagnostic events recorded yet.</p>';
    return;
  }
  list.innerHTML = history.slice(0, 20).map((item) => `
    <article class="settings-history-item" data-severity="${escapeTelemetryHtml(item.severity || "info")}">
      <time datetime="${escapeTelemetryHtml(item.at || "")}">${escapeTelemetryHtml(formatDate(item.at))}</time>
      <div><strong>${escapeTelemetryHtml(item.title || "System event")}</strong><span>${escapeTelemetryHtml(item.message || "")}</span></div>
      <b>${escapeTelemetryHtml(item.state || item.severity || "info")}</b>
    </article>`).join("");
}

function renderDiagnosticConsole(snapshot, focusId = "") {
  if (!snapshot) return;
  const services = $("diagnosticServiceGrid");
  const issues = $("diagnosticIssueList");
  const storage = snapshot.items.find((item) => item.id === "storage");
  const storagePercent = Number(storage?.meta?.usedPercent);
  const issueCount = snapshot.issues.length;
  const critical = snapshot.criticalCount;
  const statePill = $("systemDiagnosticState");

  setText("diagnosticCoreScore", `${snapshot.healthyServiceCount} / ${snapshot.serviceCount}`);
  setText("diagnosticIssueCount", issueCount);
  setText("diagnosticIssueSummary", issueCount ? `${critical ? `${critical} critical` : "No critical"} · ${snapshot.warningCount} warning` : snapshot.pendingCount ? `${snapshot.pendingCount} verification${snapshot.pendingCount === 1 ? "" : "s"} pending` : "No active issues");
  setText("diagnosticLastScan", formatDate(snapshot.checkedAt));
  setText("diagnosticStorageState", Number.isFinite(storagePercent) ? `${storagePercent.toFixed(1)}%` : "—");
  setText("diagnosticStorageDetail", storage?.detail || "Storage telemetry unavailable.");

  if (statePill) {
    const checking = snapshot.pendingCount > 0;
    statePill.className = `health-pill ${critical ? "danger" : snapshot.warningCount ? "warning" : checking ? "neutral" : "success"}`;
    statePill.textContent = critical ? "Critical" : snapshot.warningCount ? "Attention" : checking ? "Checking" : "Healthy";
  }

  if (services) {
    services.innerHTML = snapshot.items.map((item) => {
      const repair = item.repairable ? `<button class="editor-secondary-button" data-diagnostic-repair="${escapeTelemetryHtml(item.id)}" type="button">${escapeTelemetryHtml(item.repairLabel || "Repair")}</button>` : "";
      const action = !item.repairable && item.action ? `<button class="editor-secondary-button" data-diagnostic-action="${escapeTelemetryHtml(item.action)}" data-diagnostic-service="${escapeTelemetryHtml(item.id)}" type="button">Review</button>` : "";
      return `
        <article class="settings-diagnostic-service${item.id === focusId ? " is-focused" : ""}" data-diagnostic-service-card="${escapeTelemetryHtml(item.id)}" data-severity="${escapeTelemetryHtml(item.severity)}">
          <span class="settings-diagnostic-service-icon">${escapeTelemetryHtml(diagnosticServiceGlyph(item.id))}</span>
          <div class="settings-diagnostic-service-copy"><div><strong>${escapeTelemetryHtml(item.name)}</strong><b>${escapeTelemetryHtml(diagnosticStatusLabel(item))}</b></div><span>${escapeTelemetryHtml(item.detail)}</span></div>
          <div class="settings-diagnostic-service-actions">${repair}${action}</div>
        </article>`;
    }).join("");
  }

  if (issues) {
    if (!snapshot.issues.length) {
      issues.innerHTML = snapshot.pendingCount
        ? '<div class="settings-diagnostic-empty"><strong>Verification still in progress</strong><span>No failure is confirmed, but one or more services are not yet verified healthy.</span></div>'
        : '<div class="settings-diagnostic-empty"><strong>All monitored systems are healthy</strong><span>All six monitored services completed verification successfully.</span></div>';
    } else {
      issues.innerHTML = snapshot.issues.map((item) => {
        const repair = item.repairable ? `<button class="editor-secondary-button" data-diagnostic-repair="${escapeTelemetryHtml(item.id)}" type="button">${escapeTelemetryHtml(item.repairLabel || "Repair")}</button>` : "";
        const action = item.action ? `<button class="editor-secondary-button" data-diagnostic-action="${escapeTelemetryHtml(item.action)}" data-diagnostic-service="${escapeTelemetryHtml(item.id)}" type="button">Review details</button>` : "";
        return `
          <article class="settings-diagnostic-issue" data-severity="${escapeTelemetryHtml(item.severity)}">
            <i aria-hidden="true"></i><div><strong>${escapeTelemetryHtml(item.name)} · ${escapeTelemetryHtml(item.summary)}</strong><span>${escapeTelemetryHtml(item.detail)}</span><div class="settings-diagnostic-issue-actions">${repair}${action}</div></div>
          </article>`;
      }).join("");
    }
  }

  renderDiagnosticHistory();
  if (focusId) focusDiagnosticService(focusId, { scroll: false });
}

function focusDiagnosticService(serviceId = "", { scroll = true } = {}) {
  const id = String(serviceId || "").toLowerCase();
  document.querySelectorAll("[data-diagnostic-service-card]").forEach((card) => card.classList.toggle("is-focused", card.dataset.diagnosticServiceCard === id));
  const card = document.querySelector(`[data-diagnostic-service-card="${CSS.escape(id)}"]`);
  if (card && scroll) card.scrollIntoView({ behavior: document.documentElement.dataset.reducedMotion === "true" ? "auto" : "smooth", block: "center" });
}

async function repairDiagnosticService(serviceId) {
  const snapshot = state.systemSnapshot;
  const item = snapshot?.items?.find((entry) => entry.id === serviceId);
  if (!item) return;
  setRepairStage("working", `Repairing ${item.name}`, "Running the safe recovery procedure, then verifying the service again.");
  try {
    if (item.action === "repair-missing-records" && serviceId === "public") {
      await runInitialization({ replaceProduction: false });
    } else {
      await systemHealth.repairSystemService(serviceId);
    }
    const next = await refreshHealth({ focusId: serviceId, preferCurrent: true });
    const resultItem = state.systemSnapshot?.items?.find((entry) => entry.id === serviceId);
    const fixed = resultItem?.severity === "healthy";
    setRepairStage(fixed ? "success" : "error", fixed ? `${resultItem.name} restored` : `${resultItem?.name || item.name} still needs attention`, resultItem?.detail || "Verification completed.");
    window.LANNotice?.({ title: fixed ? "Repair successful" : "Repair incomplete", message: resultItem?.detail || "Review the latest diagnostic result.", tone: fixed ? "success" : "warning" });
    return next;
  } catch (error) {
    setRepairStage("error", "Automatic repair could not complete", error.message || "This issue requires manual configuration or external service action.");
    window.LANNotice?.({ title: "Repair could not complete", message: error.message || "Review Diagnostics for the required action.", tone: "error" });
  } finally {
    renderDiagnosticHistory();
  }
}

function handleDiagnosticAction(action = "", serviceId = "") {
  if (action === "review-storage") {
    document.querySelector('[data-lan-tab="general"]')?.click();
    window.setTimeout(() => $("cloudinaryConsole")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return;
  }
  if (action === "configuration") {
    document.querySelector('[data-lan-tab="general"]')?.click();
    window.setTimeout(() => $("cloudinaryConsole")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return;
  }
  if (action === "repair-missing-records") {
    repairDiagnosticService(serviceId);
    return;
  }
  if (action === "review-module-registry") {
    window.location.href = "home.html?panel=future";
    return;
  }
  if (action === "sign-in") {
    window.location.href = "../index.html";
    return;
  }
  if (action === "review-rules") {
    setRepairStage("error", "Firestore permission requires configuration", "Diagnostics confirmed that the browser cannot safely rewrite Firestore Security Rules. Review the deployed rules and administrator authorization, then run the diagnostic again.");
    return;
  }
  if (action === "deployment") {
    setRepairStage("error", "Public deployment requires attention", "The Admin cannot rewrite or redeploy Hosting from the browser. Verify the production build and Firebase Hosting deployment, then run the diagnostic again.");
    return;
  }
  setRepairStage("error", "Manual action required", "This condition cannot be changed safely from the browser. Review the diagnostic detail before changing configuration or security rules.");
}

function renderProductionRadar({ checking = false } = {}) {
  const orb = $("productionStatusOrb");
  if (!orb) return;
  const nodes = Array.from(orb.querySelectorAll("[data-health-node]"));
  orb.dataset.state = checking ? "checking" : (state.health.every((item) => item?.ok) ? "ready" : "warning");
  nodes.forEach((node, index) => {
    const item = state.health[index];
    const label = orb.querySelector(`[data-health-label="${index}"]`);
    node.classList.remove("is-ready", "is-issue", "is-checking");
    if (!item || item.ok === null) {
      if (checking) node.classList.add("is-checking");
      if (label) label.textContent = checking ? "Checking" : "Waiting";
      node.title = item?.name ? `${item.name}: checking` : "Checking service";
      return;
    }
    if (item.ok) {
      node.classList.add("is-ready");
      if (label) label.textContent = "Online";
    } else {
      node.classList.add("is-issue");
      if (label) label.textContent = "Issue";
    }
    node.title = `${item.name}: ${item.detail}`;
  });
}

function setRadarNodeState(index, status, item = null) {
  const node = document.querySelector(`[data-health-node="${index}"]`);
  const link = document.querySelector(`[data-health-link="${index}"]`);
  if (node) {
    node.dataset.health = status;
    const stateLabel = node.querySelector("[data-radar-service-state]");
    const label = status === "ready" ? "Online" : status === "issue" ? "Attention" : "Checking";
    if (stateLabel) stateLabel.textContent = label;
    const serviceName = item?.name || node.dataset.serviceName || "Service";
    const detail = item?.detail ? ` — ${item.detail}` : "";
    node.setAttribute("aria-label", `${serviceName} status: ${label}${detail}`);
    node.title = item ? `${serviceName}: ${item.ok ? "Online" : item.detail}` : `${serviceName}: checking`;
  }
  if (link) link.dataset.health = status;
}

function updateHealthScanAge() {
  if (!state.healthScannedAt) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - state.healthScannedAt) / 1000));
  let label = "Last scan just now";
  if (elapsed >= 60) label = `Last scan ${Math.floor(elapsed / 60)}m ago`;
  else if (elapsed >= 10) label = `Last scan ${elapsed}s ago`;
  setText("settingsLastHealthScan", label);
}

async function refreshHealth({ focusId = "", forceLive = false, preferCurrent = false } = {}) {
  const list = $("healthList");
  const monitor = $("settingsRadarMonitor");
  const scanButton = $("radarScanButton");
  const refreshButton = $("refreshHealthButton");
  const fullButton = $("runFullDiagnosticButton");
  if (scanButton) scanButton.disabled = true;
  if (refreshButton) refreshButton.disabled = true;
  if (fullButton) fullButton.disabled = true;
  if (monitor) monitor.dataset.radarState = "checking";
  if ($("settingsServicesMetric")) $("settingsServicesMetric").dataset.state = "checking";
  setText("productionStatusText", "Running live diagnostics");
  setText("settingsLastHealthScan", "Scanning services…");
  for (let index = 0; index < 4; index += 1) setRadarNodeState(index, "checking");

  try {
    const snapshot = (preferCurrent ? systemHealth.getCurrentSystemHealth() : null)
      || await systemHealth.runSystemDiagnostics({ forceLive });
    state.systemSnapshot = snapshot;
    state.health = snapshot.core;
    state.healthScannedAt = Date.now();

    state.health.forEach((item, index) => setRadarNodeState(index, item.severity === "healthy" ? "ready" : ["warning", "critical"].includes(item.severity) ? "issue" : "checking", item));
    const glyphs = { Authentication: "A", Firestore: "F", Cloudinary: "C", "Public portfolio": "P" };
    if (list) {
      list.innerHTML = state.health.map((item) => `
        <article class="settings-health-tile ${item.severity === "healthy" ? "ready" : ["warning", "critical"].includes(item.severity) ? "issue" : "checking"}">
          <span class="settings-health-glyph">${glyphs[item.name] || "•"}</span>
          <div><strong>${escapeTelemetryHtml(item.name)}</strong><small>${escapeTelemetryHtml(item.detail)}</small></div>
          <span class="settings-health-signal" aria-hidden="true"><i></i><i></i><i></i></span>
        </article>`).join("");
    }

    const healthyCount = snapshot.healthyCoreCount;
    const healthy = snapshot.criticalCount === 0 && snapshot.warningCount === 0 && snapshot.pendingCount === 0;
    if (monitor) monitor.dataset.radarState = healthy ? "healthy" : "attention";
    if ($("settingsServicesMetric")) $("settingsServicesMetric").dataset.state = healthy ? "healthy" : "attention";
    setText("settingsHealthScore", `${healthyCount} of ${snapshot.coreCount} online`);
    setText("settingsHealthScoreCard", `${healthyCount}`);
    setText("productionStatusText", healthy ? "Systems nominal" : "Service attention required");
    updateHealthScanAge();

    const statusSummary = $("productionStatusSummary");
    if (statusSummary) {
      statusSummary.innerHTML = state.health.map((item) => `
        <span class="${item.severity === "healthy" ? "is-ready" : ["warning", "critical"].includes(item.severity) ? "is-issue" : "is-checking"}" data-service-name="${escapeTelemetryHtml(item.name)}">
          <i aria-hidden="true"></i><b>${escapeTelemetryHtml(item.name)}</b><small>${item.severity === "healthy" ? "Online" : ["warning", "critical"].includes(item.severity) ? "Check" : "Checking"}</small>
        </span>`).join("");
    }

    renderDiagnosticConsole(snapshot, focusId);
    setText("firestoreConnectionState", snapshot.items.find((item) => item.id === "firestore")?.detail || "Unknown");
    return healthy;
  } finally {
    if (scanButton) scanButton.disabled = false;
    if (refreshButton) refreshButton.disabled = false;
    if (fullButton) fullButton.disabled = false;
  }
}

function setBackupCoreState(mode = "ready", message = "") {
  const core = $("settingsBackupCore");
  if (core) core.dataset.state = mode;
  const labels = { ready: "READY", working: "WORKING", success: "COMPLETE", error: "ATTENTION" };
  setText("backupCoreState", labels[mode] || "READY");
  const pill = $("backupCorePill");
  if (pill) {
    pill.textContent = labels[mode] || "READY";
    pill.className = `health-pill ${mode === "error" ? "danger" : mode === "working" ? "neutral" : "success"}`;
  }
  if (message) setText("backupCoreMessage", message);
}

async function collectBackup() {
  const backup = { format: "lan-portfolio-backup", version: 1, createdAt: new Date().toISOString(), collections: {}, singletons: {} };
  for (const name of COLLECTIONS) { const snapshot = await getDocs(collection(db, name)); backup.collections[name] = snapshot.docs.map((item) => ({ id: item.id, data: item.data() })); }
  for (const [name, id] of SINGLETONS) { const snapshot = await getDoc(doc(db, name, id)); if (snapshot.exists()) backup.singletons[`${name}/${id}`] = snapshot.data(); }
  return backup;
}
async function exportPortfolio() {
  const button = $("exportPortfolioButton");
  setBusy(button, true, "Exporting…");
  setBackupCoreState("working", "Building a protected JSON snapshot from the current CMS records.");
  try {
    const backup = await collectBackup();
    download(`lan-portfolio-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2));
    setText("backupStatus", "Portfolio backup exported successfully.");
    setBackupCoreState("success", "Backup snapshot exported successfully. The live portfolio was not modified.");
  } catch (error) {
    setText("backupStatus", `Export failed: ${error.message}`);
    setBackupCoreState("error", error.message || "Backup export failed.");
  } finally {
    setBusy(button, false);
  }
}
async function importPortfolio(file) {
  const data = JSON.parse(await file.text()); if (data.format !== "lan-portfolio-backup") throw new Error("This is not a valid LΛN Portfolio backup.");
  const ok = await confirmAction({ title: "Import portfolio backup?", message: "Existing documents with matching IDs will be merged with the backup. This action changes live Firestore data.", confirmLabel: "Import Backup", danger: true }); if (!ok) return;
  setBackupCoreState("working", "Validating and restoring the selected backup into supported Firestore records.");
  let count = 0;
  for (const [name, records] of Object.entries(data.collections || {})) for (const record of records || []) { await setDoc(doc(db, name, record.id), { ...record.data, restoredAt: serverTimestamp() }, { merge: true }); count += 1; }
  for (const [path, value] of Object.entries(data.singletons || {})) { const [name, id] = path.split("/"); await setDoc(doc(db, name, id), { ...value, restoredAt: serverTimestamp() }, { merge: true }); count += 1; }
  setText("backupStatus", `Imported ${count} documents successfully.`);
  setBackupCoreState("success", `Restored ${count} supported documents and refreshed portfolio verification.`);
  await Promise.all([loadInitialization(), verifySynchronization()]);
}
function fillSystemInformation() {
  const items = [
    ["CMS", "LΛN Portfolio CMS"], ["Firebase project", firebaseConfig.projectId], ["Browser", navigator.userAgent], ["Viewport", `${innerWidth} × ${innerHeight}`], ["Language", navigator.language], ["Online", navigator.onLine ? "Yes" : "No"]
  ];
  if ($("systemInformation")) $("systemInformation").innerHTML = items.map(([key,value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("");
  setText("storageCloudName", cloudinaryConfig.cloudName || "Not configured"); setText("storageStatus", cloudinaryConfig.uploadPreset ? "Configured" : "Incomplete");
  setText("securityAdministrator", window.__LAN_ADMIN_AUTH__?.user?.email || window.__LAN_ADMIN_AUTH__?.user?.uid || "—"); setText("authorizationStatus", window.__LAN_ADMIN_AUTH__?.authorized ? "Authorized" : "Not verified"); setText("sessionStatus", window.__LAN_ADMIN_AUTH__?.user ? "Active" : "No active session");
  setText("startupErrorCount", state.startupErrors.length); setText("firestoreConnectionState", navigator.onLine ? "Online — pending protected read" : "Offline");
}


function cloudinaryConsoleState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOUDINARY_CONSOLE_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCloudinaryConsoleState(next = {}) {
  try { localStorage.setItem(CLOUDINARY_CONSOLE_STATE_KEY, JSON.stringify(next)); } catch {}
}

function clampCloudinaryConsole(left, top) {
  const panel = $("cloudinaryConsole");
  if (!panel) return { left, top };
  const rect = panel.getBoundingClientRect();
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(window.innerWidth - rect.width - margin, left)),
    top: Math.max(margin, Math.min(window.innerHeight - rect.height - margin, top))
  };
}

function dockCloudinaryConsole({ persist = true } = {}) {
  const panel = $("cloudinaryConsole");
  if (!panel) return;
  panel.classList.remove("is-floating", "is-dragging");
  panel.dataset.consoleState = "docked";
  panel.style.removeProperty("left");
  panel.style.removeProperty("top");
  panel.style.removeProperty("right");
  panel.style.removeProperty("bottom");
  const button = $("cloudinaryConsoleDockButton");
  if (button) {
    button.textContent = "Float";
    button.title = "Float Cloudinary media console";
    button.setAttribute("aria-label", "Float Cloudinary media console");
  }
  if (persist) saveCloudinaryConsoleState({ floating: false });
}

function floatCloudinaryConsole(left, top, { persist = true } = {}) {
  const panel = $("cloudinaryConsole");
  if (!panel || window.matchMedia("(max-width: 48rem)").matches) return;
  panel.classList.add("is-floating");
  panel.dataset.consoleState = "floating";
  const next = clampCloudinaryConsole(left, top);
  panel.style.left = `${next.left}px`;
  panel.style.top = `${next.top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  const button = $("cloudinaryConsoleDockButton");
  if (button) {
    button.textContent = "Dock";
    button.title = "Dock Cloudinary media console";
    button.setAttribute("aria-label", "Dock Cloudinary media console");
  }
  if (persist) saveCloudinaryConsoleState({ floating: true, left: next.left, top: next.top });
}


function bindTelemetryMarketInteractions() {
  try {
    const savedPrimary = String(localStorage.getItem(TELEMETRY_PRIMARY_SERIES_KEY) || "");
    if (TELEMETRY_PRIMARY_COLORS[savedPrimary]) telemetryPrimarySeries = savedPrimary;
  } catch {}
  applyTelemetryPrimarySeries();

  document.querySelectorAll("[data-telemetry-primary]").forEach((button) => button.addEventListener("click", () => {
    const series = String(button.dataset.telemetryPrimary || "");
    if (!TELEMETRY_PRIMARY_COLORS[series] || series === telemetryPrimarySeries) return;
    telemetryPrimarySeries = series;
    telemetryPauseAutoFollow();
    try { localStorage.setItem(TELEMETRY_PRIMARY_SERIES_KEY, series); } catch {}
    applyTelemetryPrimarySeries({ restart: true });
    if (telemetryLiveModel && settingsReducedMotion()) telemetryRenderLiveFrame(performance.now());
  }));

  const canvas = $("settingsTelemetryCanvas");
  const crosshair = $("settingsTelemetryCrosshair");
  const telemetryScroll = canvas?.closest(".settings-telemetry-scroll");
  if (!canvas || !crosshair) return;
  telemetryScroll?.addEventListener("pointerenter", () => { telemetryAutoFollowHover = true; });
  telemetryScroll?.addEventListener("pointerleave", () => { telemetryAutoFollowHover = false; telemetryPauseAutoFollow(450); });
  telemetryScroll?.addEventListener("pointerdown", () => telemetryPauseAutoFollow());
  telemetryScroll?.addEventListener("wheel", () => telemetryPauseAutoFollow(), { passive: true });
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !telemetryLiveModel?.entries?.length) return;
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    crosshair.hidden = false;
    crosshair.style.left = `${x}px`;
    const svgWidth = Number($("settingsTelemetrySvg")?.viewBox?.baseVal?.width) || TELEMETRY_PLOT.width;
    const svgX = (x / Math.max(1, rect.width)) * svgWidth;
    const anchors = telemetryLiveAnchors(telemetryLiveModel, svgWidth);
    const entry = anchors.reduce((nearest, point) => !nearest || Math.abs(point.x - svgX) < Math.abs(nearest.x - svgX) ? point : nearest, null);
    if (!entry) return;
    const yRatio = telemetryPrimaryY(entry) / TELEMETRY_PLOT.height;
    crosshair.style.setProperty("--crosshair-y", `${Math.max(0, Math.min(100, yRatio * 100)).toFixed(2)}%`);
    setText("settingsTelemetryCrosshairLabel", `${entry.label} · Published ${entry.published} · Draft ${entry.draft} · Storage ${formatStorageBytes(entry.storageBytes)} · ${entry.linkCount} link${entry.linkCount === 1 ? "" : "s"}`);
  });
  canvas.addEventListener("pointerleave", () => { crosshair.hidden = true; });
}


function escapeLifecycleHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}

async function renderModuleLifecycleSummary() {
  const host = $("moduleLifecycleList");
  if (!host) return;
  host.setAttribute("aria-busy", "true");
  try {
    const modules = await listSections();
    if (!modules.length) {
      host.innerHTML = '<div class="lan-empty-state"><strong>No Custom Modules</strong><p>Create a module in Custom Modules to begin its lifecycle.</p></div>';
      return;
    }
    const statuses = await Promise.all(modules.map((module) => getModuleLifecycleStatus(module.key, { includeEntries:true })));
    host.innerHTML = statuses.map((status) => {
      const lifecycle = status.lifecycle === "promoted" ? "Promoted" : status.structural.ready ? "Testing" : "Building";
      const tone = status.lifecycle === "promoted" ? "success" : status.automaticPromotionEligible ? "success" : "neutral";
      const maturity = status.lifecycle === "promoted" ? "Promotion complete" : `${status.maturity.passed} / ${status.maturity.total} maturity checks`;
      return `<article class="module-lifecycle-summary-card" data-module-lifecycle-summary="${escapeLifecycleHtml(status.moduleKey)}"><div><strong>${escapeLifecycleHtml(status.title || status.moduleKey)}</strong><small>${status.structural.passed} / ${status.structural.total} structural · ${maturity}</small></div><span class="health-pill ${tone}">${lifecycle}</span><button class="editor-secondary-button button-compact" type="button" data-open-module-lifecycle="${escapeLifecycleHtml(status.moduleKey)}">Open Lifecycle Console</button></article>`;
    }).join("");
  } catch (error) {
    host.innerHTML = `<div class="lan-empty-state"><strong>Lifecycle status unavailable</strong><p>${escapeLifecycleHtml(error.message || "Unable to read module lifecycle state.")}</p></div>`;
  } finally {
    host.removeAttribute("aria-busy");
  }
}

let moduleLifecycleConsoleController = null;

function ensureModuleLifecycleConsole() {
  if (moduleLifecycleConsoleController) return moduleLifecycleConsoleController;
  const host = $("moduleLifecycleConsoleHost");
  if (!host) throw new Error("Module Lifecycle Console host is unavailable.");
  moduleLifecycleConsoleController = createModuleLifecycleConsole(host, {
    onChanged: () => renderModuleLifecycleSummary(),
    onDeleted: () => renderModuleLifecycleSummary()
  });
  return moduleLifecycleConsoleController;
}

async function openModuleLifecycleConsole(moduleKey) {
  return ensureModuleLifecycleConsole().open(moduleKey);
}


function bind() {
  $("moduleLifecycleList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-module-lifecycle]");
    if (!button) return;
    openModuleLifecycleConsole(button.dataset.openModuleLifecycle).catch((error) => window.LANNotice?.({ title:"Module Lifecycle", message:error.message || "Unable to open lifecycle console.", tone:"error" }));
  });
  window.addEventListener("lan:portfolio-sections-updated", () => renderModuleLifecycleSummary());
  const setHealthDetailsOpen = (open, serviceName = "") => {
    const panel = $("productionStatusDetails");
    const toggle = $("productionStatusToggle");
    if (!panel) return;
    panel.hidden = !open;
    toggle?.setAttribute("aria-expanded", String(open));
    panel.querySelectorAll("[data-service-name]").forEach((item) => {
      item.classList.toggle("is-selected", Boolean(serviceName) && item.dataset.serviceName === serviceName);
    });
  };
  $("productionStatusToggle")?.addEventListener("click", () => {
    const panel = $("productionStatusDetails");
    setHealthDetailsOpen(Boolean(panel?.hidden));
  });
  $("radarScanButton")?.addEventListener("click", () => refreshHealth({ forceLive: true }));
  const settingsRoomNav = $("settingsRoomNav");
  const settingsRoomPanels = Array.from(document.querySelectorAll("[data-lan-panel]"));

  const replaySettingsRoomMotion = (panel) => {
    const animated = panel.querySelectorAll([
      ".settings-live-trace",
      ".settings-health-signal i",
      ".greeting-energy i",
      ".settings-brand-beacon i",
      ".settings-operation-visual i",
      ".settings-backup-vault>span",
      ".settings-backup-vault>.vault-transfer",
      ".metric-motion i",
      ".pipeline-rail i",
      ".preview-metrics i",
      ".preview-dashboard-grid i",
      ".appearance-glow"
    ].join(","));
    animated.forEach((node) => { node.style.animation = "none"; });
    void panel.offsetWidth;
    animated.forEach((node) => node.style.removeProperty("animation"));
  };

  let settingsRoomMotionEnabled = true;
  const activateSettingsRoom = (room, { focus = false, animate = true, reveal = true } = {}) => {
    const targetRoom = settingsRoomPanels.some((panel) => panel.dataset.lanPanel === room) ? room : "general";
    settingsRoomMotionEnabled = animate;
    window.LANTabs?.activate(settingsRoomNav, targetRoom, { focus, reveal });
    return targetRoom;
  };

  settingsRoomNav?.addEventListener("lan:tabchange", (event) => {
    const room = event.detail?.key || "general";
    document.body.dataset.settingsRoom = room;
    const panel = event.detail?.panel || settingsRoomPanels.find((candidate) => candidate.dataset.lanPanel === room);
    const reduceMotion = document.documentElement.dataset.reducedMotion === "true";
    if (panel && settingsRoomMotionEnabled && !reduceMotion) {
      panel.classList.remove("settings-room-enter");
      replaySettingsRoomMotion(panel);
      void panel.offsetWidth;
      panel.classList.add("settings-room-enter");
      window.setTimeout(() => panel.classList.remove("settings-room-enter"), 820);
    }
    settingsRoomMotionEnabled = true;
    const url = new URL(window.location.href);
    if (room === "advanced") url.searchParams.set("room", "advanced");
    else url.searchParams.delete("room");
    if (room !== "advanced") url.searchParams.delete("service");
    window.history.replaceState({}, "", url);
  });
  const healthServiceId = (name = "") => ({
    authentication: "authentication",
    firestore: "firestore",
    cloudinary: "cloudinary",
    "public portfolio": "public"
  })[String(name || "").trim().toLowerCase()] || "";

  const openDiagnostics = (serviceId = "", { updateUrl = true } = {}) => {
    const id = String(serviceId || "").trim().toLowerCase();
    activateSettingsRoom("advanced", { animate: true });
    if (state.systemSnapshot) renderDiagnosticConsole(state.systemSnapshot, id);
    window.requestAnimationFrame(() => focusDiagnosticService(id));
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("room", "advanced");
      if (id) url.searchParams.set("service", id);
      else url.searchParams.delete("service");
      window.history.replaceState({}, "", url);
    }
  };

  document.querySelectorAll("[data-health-node]").forEach((node) => node.addEventListener("click", () => {
    setHealthDetailsOpen(false);
    openDiagnostics(healthServiceId(node.dataset.serviceName));
  }));

  window.addEventListener("lan:open-diagnostics", (event) => openDiagnostics(event.detail?.service || ""));
  window.addEventListener("lan:system-health", (event) => {
    const snapshot = event.detail;
    if (!snapshot) return;
    state.systemSnapshot = snapshot;
    state.health = snapshot.core || [];
    state.healthScannedAt = Date.now();
    const focused = new URLSearchParams(window.location.search).get("service") || "";
    renderDiagnosticConsole(snapshot, focused);
    snapshot.core?.forEach((item, index) => setRadarNodeState(index, item.severity === "healthy" ? "ready" : ["warning", "critical"].includes(item.severity) ? "issue" : "checking", item));
    setText("settingsHealthScore", `${snapshot.healthyCoreCount} of ${snapshot.coreCount} online`);
    setText("settingsHealthScoreCard", `${snapshot.healthyCoreCount}`);
    setText("productionStatusText", snapshot.criticalCount || snapshot.warningCount ? "Service attention required" : snapshot.pendingCount ? "Verifying services" : "Systems nominal");
    updateHealthScanAge();
  });
  window.addEventListener("lan:system-health-history", renderDiagnosticHistory);
  window.addEventListener("lan:system-health-history-cleared", renderDiagnosticHistory);

  $("runFullDiagnosticButton")?.addEventListener("click", () => {
    const focused = new URLSearchParams(window.location.search).get("service") || "";
    refreshHealth({ focusId: focused, forceLive: true });
  });
  $("settingsDiagnosticsConsole")?.addEventListener("click", (event) => {
    const repair = event.target.closest("[data-diagnostic-repair]");
    if (repair) { repairDiagnosticService(repair.dataset.diagnosticRepair); return; }
    const action = event.target.closest("[data-diagnostic-action]");
    if (action) { handleDiagnosticAction(action.dataset.diagnosticAction, action.dataset.diagnosticService || ""); return; }
    const card = event.target.closest("[data-diagnostic-service-card]");
    if (card) focusDiagnosticService(card.dataset.diagnosticServiceCard);
  });
  $("clearDiagnosticHistoryButton")?.addEventListener("click", async () => {
    const ok = await confirmAction({
      title: "Clear diagnostic history?",
      message: "This clears the local service event history from this browser only. It does not change Firebase, Cloudinary, or portfolio data.",
      confirmLabel: "Clear History"
    });
    if (!ok) return;
    systemHealth.clearHealthHistory();
    renderDiagnosticHistory();
    window.LANNotice?.({ title: "Diagnostic history cleared", message: "The local event history was removed.", tone: "success" });
  });


  window.addEventListener("message", (event) => { handleStorageConnectionMessage(event).catch((error) => window.LANNotice?.({ title: "Storage connection failed", message: error.message || "Unable to finish the storage connection.", tone: "error" })); });
  $("connectStorageButton")?.addEventListener("click", () => { const chooser = $("storageProviderChooser"); if (chooser) chooser.hidden = !chooser.hidden; });
  $("storageProviderChooser")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-storage-provider-close]")) { event.currentTarget.hidden = true; return; }
    const connect = event.target.closest("[data-connect-storage-provider]");
    if (!connect) return;
    event.currentTarget.hidden = true;
    if (connect.dataset.connectStorageProvider === "google-drive") handleGoogleDriveConnectRequest().catch((error) => window.LANNotice?.({ title: "Google Drive connection failed", message: error.message, tone: "error" }));
  });
  $("googleDriveSetupPanel")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-google-drive-setup-close]")) { hideGoogleDriveSetup(); return; }
    if (event.target.closest("[data-google-drive-setup-check]")) {
      showGoogleDriveSetup().then((readiness) => {
        if (readiness?.ready) window.LANNotice?.({ title: "Google Drive setup ready", message: "Click Google Drive again to open the official Google account chooser.", tone: "success" });
        else window.LANNotice?.({ title: "Google Drive setup incomplete", message: readiness?.error || "Complete the missing Worker prerequisites shown above.", tone: "warning" });
      });
    }
  });
  document.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-storage-default-family]");
    if (!select) return;
    saveStorageDefaults({ [select.dataset.storageDefaultFamily]: select.value }).then((nextSettings) => {
      storageHubSettings = nextSettings;
      setStorageRegistrySnapshot(storageHubSettings);
      paintStorageHub(getStorageProfiles());
    }).catch((error) => window.LANNotice?.({ title: "Storage default not saved", message: error.message, tone: "error" }));
  });
  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-storage-action]");
    if (!action) return;
    const profileId = action.dataset.storageProfile;
    if (action.dataset.storageAction === "open") { openStorageProfile(profileId); return; }
    if (action.dataset.storageAction === "test") { testStorageProfilePublicAccess(profileId).catch((error) => window.LANNotice?.({ title: "Storage test failed", message: error.message, tone: "error" })); return; }
    if (action.dataset.storageAction === "remove") { removeStorageProfile(profileId).catch((error) => window.LANNotice?.({ title: "Storage cannot be removed", message: error.message, tone: "warning" })); }
  });
  const initialParams = new URLSearchParams(window.location.search);
  const initialRoom = initialParams.get("room") || "general";
  const initialService = initialParams.get("service") || "";
  activateSettingsRoom(initialRoom, { animate: true });
  if (initialRoom === "advanced") window.requestAnimationFrame(() => focusDiagnosticService(initialService));
  $("dashboardGreetingName")?.addEventListener("input", (event) => updateGreetingPreview(event.target.value));
  $("dashboardGreetingName")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); saveGreetingPreference(); } });
  $("saveGreetingNameButton")?.addEventListener("click", saveGreetingPreference);
  $("portfolioPassName")?.addEventListener("input", (event) => updatePortfolioPassNamePreview(event.target.value));
  $("portfolioPassName")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); savePortfolioPassNamePreference(); } });
  $("savePortfolioPassNameButton")?.addEventListener("click", savePortfolioPassNamePreference);
  $("themePreference")?.addEventListener("change", (event) => { applyTheme(event.target.value); });
  document.addEventListener("lan:themechange", (event) => {
    const preference = event.detail?.preference || window.LANTheme?.getPreference?.() || "system";
    if ($("themePreference")) $("themePreference").value = preference;
    syncThemeChoices(preference);
    window.requestAnimationFrame(syncAppearancePreview);
  });
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
    const preference = button.dataset.themeChoice || "system";
    if ($("themePreference")) $("themePreference").value = preference;
    applyTheme(preference);
  }));
  $("reducedMotionPreference")?.addEventListener("change", (event) => { localStorage.setItem("lan-cms-reduced-motion", String(event.target.checked)); document.documentElement.dataset.reducedMotion = String(event.target.checked); syncAppearancePreview(); });
  $("compactModePreference")?.addEventListener("change", (event) => { localStorage.setItem("lan-cms-compact", String(event.target.checked)); document.documentElement.dataset.compact = String(event.target.checked); syncAppearancePreview(); });
  $("sidebarPortfolioStatusPreference")?.addEventListener("change", (event) => saveSidebarStatusPreference(event.target.checked));
  $("changeDashboardVisualButton")?.addEventListener("click", () => $("dashboardVisualInput")?.click());
  $("dashboardVisualInput")?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (file) await saveDashboardVisual(file); event.target.value = ""; });
  $("resetDashboardVisualButton")?.addEventListener("click", resetDashboardVisual);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || cloudinaryTelemetryState.pending) return;
    if (cloudinaryTelemetryState.retryAt > Date.now()) return;
    if (Date.now() - cloudinaryTelemetryState.updatedAt > CLOUDINARY_REFRESH_MS) fetchCloudinaryTelemetry([]);
  });
  $("refreshHealthButton")?.addEventListener("click", () => refreshHealth({ forceLive: true }));
  $("refreshCloudinaryUsageButton")?.addEventListener("click", () => {
    if (cloudinaryTelemetryState.retryAt > Date.now()) {
      const retry = cloudinaryRetryLabel();
      window.LANNotice?.({ title: "Cloudinary telemetry is cooling down", message: retry ? `The Admin API rate limit resets around ${retry}. The CMS will retry automatically.` : "The CMS will retry automatically after the rate-limit window.", tone: "warning" });
      return;
    }
    fetchCloudinaryTelemetry([]);
  });
  $("verifyPortfolioButton")?.addEventListener("click", (event) => verifySynchronization(event));
  $("verifySynchronizationButton")?.addEventListener("click", (event) => verifySynchronization(event));
  $("repairMissingButton")?.addEventListener("click", repairMissingPortfolioRecords);
  $("downloadMigrationReportButton")?.addEventListener("click", () => state.latestReport && download(`portfolio-initialization-report-v${PORTFOLIO_INITIALIZATION_VERSION}.json`, reportText(state.latestReport)));
  $("exportPortfolioButton")?.addEventListener("click", exportPortfolio);
  $("importPortfolioButton")?.addEventListener("click", () => $("importPortfolioInput")?.click());
  $("importPortfolioInput")?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; try { await importPortfolio(file); } catch (error) { setText("backupStatus", `Import failed: ${error.message}`); setBackupCoreState("error", error.message || "Backup import failed."); } finally { event.target.value = ""; } });
  $("downloadDiagnosticsButton")?.addEventListener("click", () => {
    setBackupCoreState("working", "Preparing runtime and environment diagnostics.");
    download(`lan-cms-diagnostics-${Date.now()}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), health: state.health, lastSync: state.lastSync, startupErrors: state.startupErrors, browser: navigator.userAgent, firebaseProject: firebaseConfig.projectId, cloudinaryCloud: cloudinaryConfig.cloudName }, null, 2));
    setText("backupStatus", "Diagnostics downloaded.");
    setBackupCoreState("success", "Diagnostics package downloaded successfully.");
  });
}

async function start() {
  bind(); bindTelemetryMarketInteractions(); applyPreferences(); loadGreetingPreference(); loadPortfolioPassNamePreference(); loadSidebarStatusPreference(); loadDashboardVisualPreference(); fillSystemInformation();
  initializePublicPortfolioQr();

  const startupTasks = [
    ["initialization state", loadInitialization],
    ["system health", () => refreshHealth({ preferCurrent: true })],
    ["module lifecycle", renderModuleLifecycleSummary],
    ["storage hub", renderStorageHub],
    ["asset inventory", countAssets]
  ];
  const results = await Promise.allSettled(startupTasks.map(([, task]) => task()));
  const failures = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    const [name] = startupTasks[index];
    const message = result.reason?.message || String(result.reason || "Startup task failed.");
    console.error(`Settings startup task failed: ${name}`, result.reason);
    return [`${name}: ${message}`];
  });

  if (failures.length) {
    state.startupErrors.push(...failures);
    setRepairStage("error", "Settings diagnostics need attention", failures.join(" · "));
    window.LANNotice?.({
      title: "Settings diagnostics issue",
      message: `${failures.length} startup ${failures.length === 1 ? "check needs" : "checks need"} attention. Open Diagnostics for details.`,
      tone: "error"
    });
  }

  startTelemetryRealtime();
  syncAppearancePreview();
  window.setInterval(updateHealthScanAge, 10000);
}


window.addEventListener("pagehide", stopTelemetryRealtime, { once: true });
await start();
