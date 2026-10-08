import {
  enableNetwork
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import {
  getAdministratorSessionEpoch,
  getAuthorizedAdministrator,
  getCurrentAdministratorUser,
  getCurrentAuthorizedAdministrator
} from "./adminAuthorizationService.js";
import {
  cloudinaryConfig,
  firebaseConfig
} from "../../config.js";
import { auditModuleRegistryIntegrity } from "./portfolioSectionService.js";
import { cloudinaryStorageProvider } from "./storageProviders/cloudinaryStorageProvider.js";
import { googleDriveStorageProvider } from "./storageProviders/googleDriveStorageProvider.js";
import {
  loadStorageSettings,
  persistStorageProfileVerification
} from "./storageSettingsService.js";

const HISTORY_KEY = "lan-cms-system-health-history";
const STATE_KEY = "lan-cms-system-health-state";
const STATE_SCHEMA_VERSION = 2;
const CLOUDINARY_USAGE_CACHE_KEY = "lan-cms-cloudinary-usage-cache-v1";
const CLOUDINARY_USAGE_CACHE_MS = 10 * 60 * 1000;
const CLOUDINARY_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const MONITOR_INTERVAL_MS = 90000;
const REQUEST_TIMEOUT_MS = 7000;
const HISTORY_LIMIT = 60;
const CORE_IDS = Object.freeze(["authentication", "firestore", "cloudinary", "public"]);
const SERVICE_IDS = Object.freeze([...CORE_IDS, "storage", "module-registry"]);
const FIRESTORE_TRANSIENT_CODES = Object.freeze([
  "unavailable",
  "deadline-exceeded",
  "network-request-failed",
  "internal",
  "unknown"
]);
const FIRESTORE_PROBE_RETRY_DELAYS_MS = Object.freeze([120, 420]);
const SYSTEM_HEALTH_PROOF_MAX_AGE_MS = 60 * 1000;
const STORAGE_PROVIDER_PROOF_MAX_AGE_MS = 10 * 60 * 1000;

function safe(value = "") {
  return String(value ?? "").trim();
}

const nowIso = () => new Date().toISOString();

let currentSnapshot = null;
let monitorTimer = 0;
let monitorPromise = null;
let pendingDiagnosticRequest = null;
let diagnosticQueued = false;
let lastDiagnosticExecutionErrorKey = "";
let cloudinaryRetryState = null;
let previousIssueMap = readStoredIssueMap();
const wait = (milliseconds = 0) => milliseconds > 0
  ? new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  : Promise.resolve();

function errorCode(error) {
  return safe(error?.code || error?.name || "unknown").toLowerCase();
}

function errorMessage(error, fallback = "Service check failed.") {
  return safe(error?.message || fallback) || fallback;
}

function diagnosticContext() {
  return Object.freeze({
    authEpoch: getAdministratorSessionEpoch(),
    uid: getCurrentAdministratorUser()?.uid || ""
  });
}

function diagnosticContextIsCurrent(context) {
  return Boolean(context)
    && context.authEpoch === getAdministratorSessionEpoch()
    && context.uid === (getCurrentAdministratorUser()?.uid || "");
}

function obsoleteDiagnosticError() {
  return Object.assign(new Error("System Health diagnostic belongs to an obsolete administrator session."), {
    code: "system-health/session-obsolete"
  });
}

function assertDiagnosticContextCurrent(context) {
  if (!diagnosticContextIsCurrent(context)) throw obsoleteDiagnosticError();
}

function isObsoleteDiagnostic(error) {
  return errorCode(error).includes("system-health/session-obsolete");
}

function result({
  id,
  name,
  severity = "healthy",
  code = "ok",
  summary = "Healthy",
  detail = "Service is available.",
  repairable = false,
  repairLabel = "Repair",
  action = "",
  meta = {}
}) {
  const normalizedSeverity = ["healthy", "info", "warning", "critical"].includes(severity) ? severity : "warning";
  return {
    id,
    name,
    ok: normalizedSeverity === "healthy" ? true : normalizedSeverity === "info" ? null : false,
    severity: normalizedSeverity,
    code,
    summary,
    detail,
    repairable: Boolean(repairable),
    repairLabel,
    action,
    checkedAt: nowIso(),
    meta
  };
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch (error) {
    console.warn(`System Health could not read persisted state for ${key}.`, error);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`System Health could not persist state for ${key}.`, error);
    return false;
  }
}

function readCloudinaryUsageCache() {
  const cached = readJson(CLOUDINARY_USAGE_CACHE_KEY, {});
  if (!cached || typeof cached !== "object" || Array.isArray(cached)) return {};
  const canonical = {
    usage: cached.usage && typeof cached.usage === "object" ? cached.usage : null,
    updatedAt: Number(cached.updatedAt) || 0
  };
  if ("retryAt" in cached || "errorCode" in cached || "errorMessage" in cached || "failureOwner" in cached) {
    writeJson(CLOUDINARY_USAGE_CACHE_KEY, canonical);
  }
  return canonical;
}

export function cacheCloudinaryUsageSnapshot(usage = null) {
  if (!usage || typeof usage !== "object") return;
  writeJson(CLOUDINARY_USAGE_CACHE_KEY, {
    usage,
    updatedAt: Date.now()
  });
}

function formatRetryTime(timestamp = 0) {
  if (!(Number(timestamp) > Date.now())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(Number(timestamp)));
}

function normalizeTransitionState(value) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return /^(healthy|info|warning|critical):/.test(normalized) ? normalized : "";
  }
  if (!value || typeof value !== "object") return "";
  const severity = safe(value.severity).toLowerCase();
  const code = safe(value.code || value.status || "unknown");
  return ["healthy", "info", "warning", "critical"].includes(severity)
    ? `${severity}:${code}`
    : "";
}

function readStoredIssueMap() {
  const stored = readJson(STATE_KEY, {});
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const canonical = stored.version === STATE_SCHEMA_VERSION && stored.services && typeof stored.services === "object";
  const source = canonical ? stored.services : stored;
  const normalized = Object.fromEntries(
    Object.entries(source)
      .map(([id, value]) => [safe(id), normalizeTransitionState(value)])
      .filter(([id, value]) => id && value)
  );
  if (!canonical) writeJson(STATE_KEY, { version: STATE_SCHEMA_VERSION, services: normalized });
  return normalized;
}

function writeStoredIssueMap(services = {}) {
  writeJson(STATE_KEY, { version: STATE_SCHEMA_VERSION, services });
}

export function getHealthHistory() {
  const history = readJson(HISTORY_KEY, []);
  return Array.isArray(history) ? history : [];
}

function appendHistory(entry) {
  const history = getHealthHistory();
  history.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: nowIso(), ...entry });
  writeJson(HISTORY_KEY, history.slice(0, HISTORY_LIMIT));
  window.dispatchEvent(new CustomEvent("lan:system-health-history", { detail: history[0] }));
}

export function clearHealthHistory() {
  writeJson(HISTORY_KEY, []);
  window.dispatchEvent(new CustomEvent("lan:system-health-history-cleared"));
}


function isFirestoreTransient(error) {
  const code = errorCode(error);
  return FIRESTORE_TRANSIENT_CODES.some((candidate) => code.includes(candidate));
}

function handleDiagnosticExecutionError(error) {
  if (isObsoleteDiagnostic(error)) return;
  const code = errorCode(error);
  const message = errorMessage(error);
  const key = `${code}:${message}`;
  if (lastDiagnosticExecutionErrorKey === key) return;
  lastDiagnosticExecutionErrorKey = key;
  appendHistory({
    service: "system-health",
    severity: "critical",
    code,
    title: "System health diagnostic could not complete",
    message,
    state: "detected"
  });
  console.error("System health diagnostic execution failed:", error);
  window.dispatchEvent(new CustomEvent("lan:system-health-error", { detail: { code, message } }));
}

/*
 * System health consumes the ONE authorization/Firestore proof owned by
 * adminAuthorizationService. The shell guard is used only as the startup gate;
 * every runtime scan asks the same live owner for current session state and
 * refreshes its protected proof only when needed. No health-owned token refresh,
 * allowlist read, or readiness cache exists here.
 */
async function waitForSystemHealthReadiness({ forceLive = false } = {}) {
  const guard = window.__LAN_ADMIN_READY__;
  if (!guard || typeof guard.then !== "function") {
    throw new Error("Canonical Admin authorization readiness is unavailable to System Health.");
  }

  // The guard is a startup gate only. Runtime health never treats its resolved
  // session snapshot as current authentication state.
  await guard;

  try {
    const session = await getAuthorizedAdministrator({
      forceRefresh: false,
      maxProofAgeMs: forceLive ? 0 : SYSTEM_HEALTH_PROOF_MAX_AGE_MS
    });
    return { session, verificationError: null };
  } catch (verificationError) {
    const liveUser = getCurrentAdministratorUser();
    const current = getCurrentAuthorizedAdministrator();
    return {
      session: current || (liveUser ? { authorized: null, reason: "verification-pending", user: liveUser } : null),
      verificationError
    };
  }
}

/*
 * Supporting protected diagnostics reuse the already-authorized Admin session.
 * They may retry their own transport read once, but they never refresh Firebase
 * Auth, re-run authorization, or own a parallel Firestore readiness lifecycle.
 */
async function runProtectedFirestoreDiagnostic(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isFirestoreTransient(error)) throw error;
    await wait(FIRESTORE_PROBE_RETRY_DELAYS_MS[0]);
    return operation();
  }
}

/*
 * Firestore health never performs its own read. A READY administrator session
 * already contains the protected Firestore proof that authorized the workspace.
 */
function firestoreProofFromSession(session) {
  const proof = session?.firestoreProof;
  return proof
    && proof.protectedAdminAccess === true
    && proof.moduleRegistryCollectionsReadable === true
    && Number(proof.verifiedAt) > 0
    ? proof
    : null;
}

function dependencyStatus({ id, name, dependency, detail }) {
  return result({
    id,
    name,
    severity: "info",
    code: `waiting-for-${dependency}`,
    summary: "Checking",
    detail,
    repairable: false
  });
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    window.clearTimeout(timer);
  }
}

async function requestCloudinaryUsage() {
  return cloudinaryStorageProvider.getUsage();
}

async function requestCloudinaryHealth() {
  return cloudinaryStorageProvider.testConnection();
}
function retryTimestamp(error = null) {
  const direct = Date.parse(safe(error?.retryAt));
  if (Number.isFinite(direct)) return direct;
  const match = errorMessage(error, "").match(/try again on\s+(.+?)(?:\.|$)/i);
  if (match) {
    const parsed = Date.parse(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + CLOUDINARY_FAILURE_BACKOFF_MS;
}

async function diagnoseAuthentication(session = null, verificationError = null) {
  if (!session?.user) {
    return result({
      id: "authentication",
      name: "Authentication",
      severity: "critical",
      code: "signed-out",
      summary: "Administrator session unavailable",
      detail: "Sign in again to restore protected Admin access.",
      repairable: false,
      action: "sign-in"
    });
  }

  const verificationCode = errorCode(verificationError);
  if (verificationError && /token|auth-state|persistence|session-changed/.test(verificationCode)) {
    return result({
      id: "authentication",
      name: "Authentication",
      severity: verificationError?.retryable === false ? "critical" : "info",
      code: verificationCode,
      summary: verificationError?.retryable === false ? "Authentication requires attention" : "Checking",
      detail: errorMessage(verificationError),
      repairable: verificationError?.retryable !== false,
      repairLabel: "Refresh session"
    });
  }

  if (session.authorized === false) {
    return result({
      id: "authentication",
      name: "Authentication",
      severity: "critical",
      code: "not-authorized",
      summary: "Administrator authorization failed",
      detail: "The signed-in Firebase account is not currently authorized for this Admin workspace.",
      repairable: true,
      repairLabel: "Refresh authorization"
    });
  }

  // Firestore proof failures belong to the Firestore diagnostic. A live Firebase
  // user with a valid token must not be mislabeled as signed out merely because
  // the authorization capability proof is temporarily unavailable or denied.
  if (session.authorized !== true && verificationError) {
    return result({
      id: "authentication",
      name: "Authentication",
      summary: "Online",
      detail: `Signed in as ${session.user.email || session.user.uid}. Protected data access is reported separately by Firestore.`,
      meta: { method: "firebase-session", user: session.user.email || session.user.uid }
    });
  }

  if (session.authorized !== true) {
    return result({
      id: "authentication",
      name: "Authentication",
      severity: "info",
      code: "authorization-checking",
      summary: "Checking",
      detail: "Firebase authentication is available while administrator authorization is being verified.",
      repairable: false,
      meta: { user: session.user.email || session.user.uid }
    });
  }

  return result({
    id: "authentication",
    name: "Authentication",
    summary: "Online",
    detail: `Signed in as ${session.user.email || session.user.uid}.`,
    meta: { method: session.method || "verified", user: session.user.email || session.user.uid }
  });
}

async function diagnoseFirestore(session = null, verificationError = null) {
  if (!navigator.onLine) {
    return result({
      id: "firestore",
      name: "Firestore",
      severity: "critical",
      code: "offline",
      summary: "Browser is offline",
      detail: "Firestore cannot reconnect until this device has an internet connection.",
      repairable: false
    });
  }

  if (verificationError) {
    const code = errorCode(verificationError);
    const permission = code.includes("permission-denied") || code.includes("rules-denied") || code.includes("allowlist-inactive");
    const retryable = verificationError?.retryable !== false || isFirestoreTransient(verificationError) || code.includes("lookup-failed");

    if (retryable && !permission) {
      return result({
        id: "firestore",
        name: "Firestore",
        severity: "info",
        code: "synchronizing",
        summary: "Checking",
        detail: "The canonical Admin session is refreshing its protected Firestore proof.",
        repairable: false,
        meta: { pendingCode: code }
      });
    }

    return result({
      id: "firestore",
      name: "Firestore",
      severity: "critical",
      code,
      summary: permission ? "Firestore access denied" : "Firestore connection failed",
      detail: errorMessage(verificationError),
      repairable: !permission,
      repairLabel: "Reconnect Firestore",
      action: permission ? "review-rules" : ""
    });
  }

  const proof = firestoreProofFromSession(session);
  if (!proof) {
    return result({
      id: "firestore",
      name: "Firestore",
      severity: "info",
      code: "synchronizing",
      summary: "Checking",
      detail: "Waiting for the canonical administrator Firestore proof.",
      repairable: false
    });
  }

  return result({
    id: "firestore",
    name: "Firestore",
    summary: "Online",
    detail: "Protected Firestore access was verified by the canonical Admin authorization owner.",
    meta: {
      proofVerifiedAt: new Date(Number(proof.verifiedAt)).toISOString(),
      administratorRecordPresent: Boolean(proof.administratorRecordPresent),
      administratorRecordActive: Boolean(proof.administratorRecordActive),
      protectedAdminAccess: true,
      moduleRegistryCollectionsReadable: true
    }
  });
}

async function diagnoseCloudinary({ forceLive = false, context = null } = {}) {
  assertDiagnosticContextCurrent(context);
  const cloudName = safe(cloudinaryConfig.cloudName);
  const preset = safe(cloudinaryConfig.uploadPreset);
  if (!cloudName || !preset) {
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      severity: "critical",
      code: "configuration-incomplete",
      summary: "Upload configuration is incomplete",
      detail: !cloudName ? "Cloudinary cloud name is missing." : "Cloudinary unsigned upload preset is missing.",
      repairable: false,
      action: "configuration"
    });
  }

  let bridge;
  try {
    bridge = await requestCloudinaryHealth();
    assertDiagnosticContextCurrent(context);
  } catch (error) {
    if (isObsoleteDiagnostic(error) || !diagnosticContextIsCurrent(context)) throw obsoleteDiagnosticError();
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      severity: "warning",
      code: errorCode(error),
      summary: "Cloudinary telemetry bridge unavailable",
      detail: `${errorMessage(error)} Upload configuration remains ready for ${cloudName}.`,
      repairable: true,
      repairLabel: "Retry connection",
      meta: { cloudName, uploadPreset: preset, telemetryAvailable: false, usage: readCloudinaryUsageCache().usage || null }
    });
  }

  if (bridge?.cloudinaryConfigured === false) {
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      severity: "warning",
      code: "telemetry-secrets-missing",
      summary: "Telemetry credentials need configuration",
      detail: `Uploads remain configured for ${cloudName}, but the telemetry Worker is missing its Cloudinary API credentials.`,
      repairable: false,
      action: "configuration",
      meta: { cloudName, uploadPreset: preset, telemetryAvailable: false, usage: readCloudinaryUsageCache().usage || null }
    });
  }

  const cached = readCloudinaryUsageCache();
  const cachedUsage = cached.usage && typeof cached.usage === "object" ? cached.usage : null;
  const cacheFresh = cachedUsage && Date.now() - Number(cached.updatedAt || 0) < CLOUDINARY_USAGE_CACHE_MS;
  if (cloudinaryRetryState?.retryAt > Date.now()) {
    const retry = formatRetryTime(cloudinaryRetryState.retryAt);
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      severity: "warning",
      code: safe(cloudinaryRetryState.code || "cloudinary-rate-limited"),
      summary: "Cloudinary account telemetry rate-limited",
      detail: `${safe(cloudinaryRetryState.message || "Cloudinary account telemetry is temporarily rate-limited.")}${retry ? ` The CMS will retry after ${retry}.` : ""} Upload configuration remains ready.`,
      repairable: false,
      meta: { cloudName, uploadPreset: preset, telemetryAvailable: false, usage: cachedUsage, retryAt: Number(cloudinaryRetryState.retryAt) }
    });
  }

  if (cacheFresh && !forceLive) {
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      summary: "Online",
      detail: `Upload configuration is ready for ${cloudName}; account telemetry is using a recent verified snapshot.`,
      meta: { cloudName, uploadPreset: preset, telemetryAvailable: true, usage: cachedUsage, cached: true }
    });
  }

  try {
    const usage = await requestCloudinaryUsage();
    assertDiagnosticContextCurrent(context);
    cloudinaryRetryState = null;
    if (usage) cacheCloudinaryUsageSnapshot(usage);
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      summary: "Online",
      detail: `Upload configuration is ready for ${cloudName} and account telemetry is connected.`,
      meta: { cloudName, uploadPreset: preset, telemetryAvailable: Boolean(usage), usage: usage || cachedUsage }
    });
  } catch (error) {
    if (isObsoleteDiagnostic(error) || !diagnosticContextIsCurrent(context)) throw obsoleteDiagnosticError();
    const code = errorCode(error);
    const rateLimited = code.includes("cloudinary-rate-limited");
    const retryAt = rateLimited ? retryTimestamp(error) : 0;
    if (rateLimited) {
      cloudinaryRetryState = { code, message: errorMessage(error), retryAt };
      const retry = formatRetryTime(retryAt);
      return result({
        id: "cloudinary",
        name: "Cloudinary",
        severity: "warning",
        code,
        summary: "Cloudinary account telemetry rate-limited",
        detail: `${errorMessage(error)}${retry ? ` The CMS will retry after ${retry}.` : ""} Upload configuration remains ready.`,
        repairable: false,
        meta: { cloudName, uploadPreset: preset, telemetryAvailable: false, usage: cachedUsage, retryAt }
      });
    }
    const credentials = /cloudinary-auth-failed|cloudinary-permission-denied|cloudinary-config/.test(code);
    return result({
      id: "cloudinary",
      name: "Cloudinary",
      severity: credentials ? "critical" : "warning",
      code,
      summary: credentials ? "Cloudinary telemetry credentials failed" : "Cloudinary account telemetry unavailable",
      detail: `${errorMessage(error)} Upload configuration remains ready for ${cloudName}.`,
      repairable: false,
      action: credentials ? "configuration" : "",
      meta: { cloudName, uploadPreset: preset, telemetryAvailable: false, usage: cachedUsage }
    });
  }
}

function anonymousPortfolioDocumentUrl() {
  const projectId = safe(firebaseConfig.projectId);
  const apiKey = safe(firebaseConfig.apiKey);
  if (!projectId || !apiKey) return "";
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/portfolio/home?key=${encodeURIComponent(apiKey)}`;
}

async function diagnosePublicPortfolio() {
  try {
    const publicUrl = new URL("../../index.html", import.meta.url);
    const documentUrl = anonymousPortfolioDocumentUrl();
    if (!documentUrl) {
      return result({
        id: "public",
        name: "Public portfolio",
        severity: "critical",
        code: "public-firestore-config-missing",
        summary: "Public Firestore verification is unavailable",
        detail: "Firebase projectId or apiKey is missing, so anonymous public access cannot be verified.",
        repairable: false,
        action: "configuration"
      });
    }

    // This request intentionally carries no Firebase ID token. A 200 response
    // therefore proves that the exact portfolio/home document is readable under
    // the anonymous Firestore Rules path used by real public visitors.
    const [pageResponse, publicRecordResponse] = await Promise.all([
      fetchWithTimeout(publicUrl.href, { method: "GET" }),
      fetchWithTimeout(documentUrl, { method: "GET" })
    ]);

    if (!pageResponse.ok) {
      return result({
        id: "public",
        name: "Public portfolio",
        severity: "critical",
        code: `http-${pageResponse.status}`,
        summary: "Public entry point is unavailable",
        detail: `The public portfolio returned HTTP ${pageResponse.status}.`,
        repairable: false,
        action: "deployment"
      });
    }

    if (publicRecordResponse.status === 404) {
      return result({
        id: "public",
        name: "Public portfolio",
        severity: "warning",
        code: "home-record-not-public",
        summary: "Home portfolio record is not publicly available",
        detail: "The public entry point loads, but an anonymous visitor cannot read portfolio/home.",
        repairable: true,
        repairLabel: "Repair missing records",
        action: "repair-missing-records"
      });
    }

    if (!publicRecordResponse.ok) {
      const denied = publicRecordResponse.status === 401 || publicRecordResponse.status === 403;
      return result({
        id: "public",
        name: "Public portfolio",
        severity: "critical",
        code: denied ? "public-firestore-access-denied" : `public-firestore-http-${publicRecordResponse.status}`,
        summary: denied ? "Anonymous portfolio access denied" : "Public Firestore verification failed",
        detail: denied
          ? "Firestore Rules do not currently allow an anonymous visitor to read portfolio/home."
          : `Anonymous Firestore verification returned HTTP ${publicRecordResponse.status}.`,
        repairable: false,
        action: denied ? "review-rules" : ""
      });
    }

    return result({
      id: "public",
      name: "Public portfolio",
      summary: "Online",
      detail: "Public entry point and anonymous Firestore delivery for portfolio/home are available.",
      meta: { anonymousFirestoreVerified: true }
    });
  } catch (error) {
    return result({
      id: "public",
      name: "Public portfolio",
      severity: "critical",
      code: errorCode(error),
      summary: "Public portfolio check failed",
      detail: errorMessage(error),
      repairable: false
    });
  }
}

async function diagnoseModuleRegistry(context = null) {
  assertDiagnosticContextCurrent(context);
  try {
    const audit = await runProtectedFirestoreDiagnostic(() => auditModuleRegistryIntegrity());
    assertDiagnosticContextCurrent(context);
    if (audit.orphanEntries) {
      return result({
        id: "module-registry",
        name: "Module registry",
        severity: "warning",
        code: "orphan-entries",
        summary: `${audit.orphanEntries} custom-module ${audit.orphanEntries === 1 ? "entry needs" : "entries need"} review`,
        detail: "Some portfolioSectionEntries reference a module that is no longer registered.",
        repairable: false,
        action: "review-module-registry",
        meta: audit
      });
    }
    return result({
      id: "module-registry",
      name: "Module registry",
      summary: "Healthy",
      detail: `${audit.sections} custom ${audit.sections === 1 ? "module" : "modules"} and ${audit.entries} ${audit.entries === 1 ? "entry" : "entries"} verified.`,
      meta: audit
    });
  } catch (error) {
    if (isObsoleteDiagnostic(error) || !diagnosticContextIsCurrent(context)) throw obsoleteDiagnosticError();
    return result({
      id: "module-registry",
      name: "Module registry",
      severity: "warning",
      code: errorCode(error),
      summary: "Module registry could not be verified",
      detail: errorMessage(error),
      repairable: false
    });
  }
}

function storageQuotaPercent(quota = null) {
  if (!quota || typeof quota !== "object") return null;
  const direct = Number(quota.usedPercent ?? quota.percent);
  if (Number.isFinite(direct)) return direct;
  const used = Number(quota.usage);
  const limitValue = Number(quota.limit);
  return Number.isFinite(used) && Number.isFinite(limitValue) && limitValue > 0
    ? (used / limitValue) * 100
    : null;
}

function persistedStorageProof(profile = {}) {
  const usage = profile.usageSnapshot && typeof profile.usageSnapshot === "object" ? profile.usageSnapshot : null;
  const verifiedAt = Date.parse(safe(usage?.updatedAt));
  if (!usage || !Number.isFinite(verifiedAt) || Date.now() - verifiedAt > STORAGE_PROVIDER_PROOF_MAX_AGE_MS) return null;
  return {
    ok: usage.healthy !== false,
    publicReady: profile.provider === "google-drive" ? profile.publicReady === true : true,
    verifiedAt,
    usage,
    code: safe(usage.code),
    message: safe(usage.message),
    source: "persisted-provider-proof"
  };
}

async function googleDriveStorageProof(profile, { forceLive = false, context = null } = {}) {
  assertDiagnosticContextCurrent(context);
  const persisted = !forceLive ? persistedStorageProof(profile) : null;
  if (persisted) return persisted;

  try {
    const response = await googleDriveStorageProvider.testConnection(profile);
    assertDiagnosticContextCurrent(context);
    const persistedProfile = await persistStorageProfileVerification(profile, {
      healthy: true,
      result: response
    });
    return persistedStorageProof(persistedProfile) || {
      ok: true,
      publicReady: response?.publicReady === true,
      verifiedAt: Date.now(),
      usage: response || {},
      source: "live-provider-proof"
    };
  } catch (error) {
    if (isObsoleteDiagnostic(error) || !diagnosticContextIsCurrent(context)) throw obsoleteDiagnosticError();
    try {
      await persistStorageProfileVerification(profile, {
        healthy: false,
        code: errorCode(error),
        message: errorMessage(error)
      });
    } catch (persistError) {
      return {
        ok: false,
        publicReady: false,
        verifiedAt: Date.now(),
        error: persistError,
        usage: {},
        code: "storage-verification-persist-failed",
        message: `Google Drive verification failed and its canonical state could not be saved. ${errorMessage(persistError)}`,
        source: "live-provider-proof"
      };
    }
    return {
      ok: false,
      publicReady: false,
      verifiedAt: Date.now(),
      error,
      usage: {},
      code: errorCode(error),
      message: errorMessage(error),
      source: "live-provider-proof"
    };
  }
}

async function diagnoseStorage(cloudinary, { forceLive = false, context = null } = {}) {
  assertDiagnosticContextCurrent(context);
  let settings;
  try {
    settings = await runProtectedFirestoreDiagnostic(() => loadStorageSettings());
    assertDiagnosticContextCurrent(context);
  } catch (error) {
    if (isObsoleteDiagnostic(error) || !diagnosticContextIsCurrent(context)) throw obsoleteDiagnosticError();
    return result({
      id: "storage",
      name: "Storage",
      severity: "warning",
      code: errorCode(error),
      summary: "Storage registry could not be verified",
      detail: errorMessage(error),
      repairable: false,
      action: "review-storage"
    });
  }

  const profiles = Object.values(settings?.profiles || {}).filter((profile) => profile?.enabled !== false);
  if (!profiles.length) {
    return result({
      id: "storage",
      name: "Storage",
      severity: "warning",
      code: "no-storage-providers",
      summary: "No storage provider is enabled",
      detail: "Connect or enable a storage provider before accepting managed uploads.",
      repairable: false,
      action: "review-storage"
    });
  }

  const providerStates = await Promise.all(profiles.map(async (profile) => {
    if (profile.provider === "cloudinary") {
      return {
        profileId: profile.id,
        provider: profile.provider,
        label: profile.label || "Cloudinary",
        state: cloudinary.severity,
        code: cloudinary.code,
        detail: cloudinary.detail,
        publicReady: cloudinary.severity === "healthy",
        quotaPercent: storageQuotaPercent(cloudinary?.meta?.usage?.storage),
        verifiedAt: Date.parse(safe(cloudinary?.meta?.usage?.updatedAt)) || Date.now()
      };
    }

    if (profile.provider === "google-drive") {
      const proof = await googleDriveStorageProof(profile, { forceLive, context });
      const quotaPercent = storageQuotaPercent(proof.usage?.storageQuota);
      const failed = proof.ok !== true;
      const publicNotReady = proof.ok === true && proof.publicReady !== true;
      return {
        profileId: profile.id,
        provider: profile.provider,
        label: profile.label || "Google Drive",
        state: failed || publicNotReady ? "warning" : "healthy",
        code: failed ? (safe(proof.code) || errorCode(proof.error)) : publicNotReady ? "google-drive-public-not-ready" : "ok",
        detail: failed
          ? (safe(proof.message) || errorMessage(proof.error, "Google Drive connection could not be verified."))
          : publicNotReady
            ? "The managed Google Drive folder is connected but is not verified for public delivery."
            : "Google Drive connection and public delivery are verified.",
        publicReady: proof.publicReady === true,
        quotaPercent,
        verifiedAt: proof.verifiedAt,
        source: proof.source
      };
    }

    return {
      profileId: profile.id,
      provider: profile.provider,
      label: profile.label || profile.provider,
      state: "info",
      code: "provider-health-unsupported",
      detail: "This storage provider does not expose a canonical health verifier yet.",
      publicReady: false,
      quotaPercent: null,
      verifiedAt: 0
    };
  }));

  assertDiagnosticContextCurrent(context);
  const failed = providerStates.filter((provider) => provider.state === "warning" || provider.state === "critical");
  const pending = providerStates.filter((provider) => provider.state === "info");
  const healthy = providerStates.filter((provider) => provider.state === "healthy");
  const quotaValues = providerStates.map((provider) => provider.quotaPercent).filter(Number.isFinite);
  const worstQuota = quotaValues.length ? Math.max(...quotaValues) : null;
  const providerSummary = `${healthy.length}/${providerStates.length} enabled storage provider${providerStates.length === 1 ? "" : "s"} verified`;

  if (failed.length) {
    return result({
      id: "storage",
      name: "Storage",
      severity: healthy.length ? "warning" : "critical",
      code: failed[0].code || "provider-attention",
      summary: healthy.length ? "Storage provider needs attention" : "Storage delivery is unavailable",
      detail: `${providerSummary}. ${failed.map((provider) => `${provider.label}: ${provider.detail}`).join(" ")}`,
      action: "review-storage",
      meta: { providers: providerStates, connectedProviders: providerStates.length, healthyProviders: healthy.length, usedPercent: worstQuota }
    });
  }

  if (pending.length) {
    return result({
      id: "storage",
      name: "Storage",
      severity: "info",
      code: "provider-verification-pending",
      summary: "Checking",
      detail: `${providerSummary}. ${pending.length} provider verifier is not available yet.`,
      meta: { providers: providerStates, connectedProviders: providerStates.length, healthyProviders: healthy.length, usedPercent: worstQuota }
    });
  }

  if (Number.isFinite(worstQuota) && worstQuota >= 95) {
    return result({
      id: "storage",
      name: "Storage",
      severity: worstQuota >= 100 ? "critical" : "warning",
      code: worstQuota >= 100 ? "storage-full" : "storage-critical",
      summary: worstQuota >= 100 ? "Storage capacity reached" : "Storage is almost full",
      detail: `${providerSummary}. Highest provider usage is ${Math.round(worstQuota * 10) / 10}%.`,
      action: "review-storage",
      meta: { providers: providerStates, connectedProviders: providerStates.length, healthyProviders: healthy.length, usedPercent: worstQuota }
    });
  }

  return result({
    id: "storage",
    name: "Storage",
    summary: "Healthy",
    detail: `${providerSummary}. Connection and public-delivery readiness were verified by their canonical providers.`,
    meta: { providers: providerStates, connectedProviders: providerStates.length, healthyProviders: healthy.length, usedPercent: worstQuota }
  });
}

function transitionKey(item) {
  return `${item.severity}:${item.code}`;
}

function trackTransitions(snapshot) {
  const nextMap = { ...previousIssueMap };
  snapshot.items.forEach((item) => {
    const key = transitionKey(item);
    const previous = previousIssueMap[item.id] || "";
    const isIssue = item.severity === "warning" || item.severity === "critical";
    const wasIssue = previous.startsWith("warning:") || previous.startsWith("critical:");

    if (isIssue) {
      nextMap[item.id] = key;
      if (previous !== key) {
        appendHistory({ service: item.id, severity: item.severity, code: item.code, title: item.summary, message: item.detail, state: "detected" });
      }
      return;
    }

    if (item.severity === "healthy") {
      nextMap[item.id] = key;
      if (wasIssue) {
        appendHistory({ service: item.id, severity: "healthy", code: "resolved", title: `${item.name} restored`, message: item.detail, state: "resolved" });
      }
      return;
    }

    // INFO is unresolved/pending. Keep the last issue key so a later HEALTHY
    // result records the actual recovery instead of falsely resolving on
    // "Checking" or dependency synchronization.
    if (!previous) nextMap[item.id] = key;
  });
  previousIssueMap = nextMap;
  writeStoredIssueMap(nextMap);
}

function mergeDiagnosticRequest(current, incoming) {
  if (!current) return { ...incoming };
  return {
    includeSupporting: current.includeSupporting !== false || incoming.includeSupporting !== false,
    forceLive: current.forceLive === true || incoming.forceLive === true
  };
}

async function executeSystemDiagnostics({ includeSupporting = true, forceLive = false } = {}) {
  const context = diagnosticContext();
  const readiness = await waitForSystemHealthReadiness({ forceLive });
  assertDiagnosticContextCurrent(context);
  const session = readiness?.session || null;
  const verificationError = readiness?.verificationError || null;
  const authentication = await diagnoseAuthentication(session, verificationError);
  const authReady = authentication.severity === "healthy";
  const firestore = authReady
    ? await diagnoseFirestore(session, verificationError)
    : dependencyStatus({
        id: "firestore",
        name: "Firestore",
        dependency: "authentication",
        detail: "Protected Firestore verification will resume after administrator authentication is ready."
      });
  const firestoreReady = firestore.severity === "healthy";

  const cloudinaryPromise = authReady
    ? diagnoseCloudinary({ forceLive, context })
    : Promise.resolve(dependencyStatus({
        id: "cloudinary",
        name: "Cloudinary",
        dependency: "authentication",
        detail: "Cloudinary verification will resume after administrator authentication is ready."
      }));
  const publicPromise = diagnosePublicPortfolio();
  const cloudinary = await cloudinaryPromise;
  const publicPortfolio = await publicPromise;

  const core = [authentication, firestore, cloudinary, publicPortfolio];
  const supporting = includeSupporting
    ? [
        firestoreReady && authReady
          ? await diagnoseStorage(cloudinary, { forceLive, context })
          : dependencyStatus({
              id: "storage",
              name: "Storage",
              dependency: firestoreReady ? "authentication" : "firestore",
              detail: "Storage verification will resume after protected Admin access is ready."
            }),
        firestoreReady
          ? await diagnoseModuleRegistry(context)
          : dependencyStatus({
              id: "module-registry",
              name: "Module registry",
              dependency: "firestore",
              detail: "Module registry verification will resume after protected Firestore access is ready."
            })
      ]
    : [];

  assertDiagnosticContextCurrent(context);
  const items = [...core, ...supporting];
  const issues = items.filter((item) => item.severity === "warning" || item.severity === "critical");
  const pending = items.filter((item) => item.severity === "info");
  const snapshot = {
    checkedAt: nowIso(),
    readiness: pending.length ? "checking" : "ready",
    core: CORE_IDS.map((id) => items.find((item) => item.id === id)).filter(Boolean),
    supporting: items.filter((item) => !CORE_IDS.includes(item.id)),
    items,
    issues,
    pending,
    criticalCount: issues.filter((item) => item.severity === "critical").length,
    warningCount: issues.filter((item) => item.severity === "warning").length,
    pendingCount: pending.length,
    healthyCoreCount: CORE_IDS.filter((id) => items.find((entry) => entry.id === id)?.severity === "healthy").length,
    coreCount: CORE_IDS.length,
    healthyServiceCount: SERVICE_IDS.filter((id) => items.find((entry) => entry.id === id)?.severity === "healthy").length,
    serviceCount: includeSupporting ? SERVICE_IDS.length : CORE_IDS.length
  };
  currentSnapshot = snapshot;
  lastDiagnosticExecutionErrorKey = "";
  trackTransitions(snapshot);
  window.dispatchEvent(new CustomEvent("lan:system-health", { detail: snapshot }));
  return snapshot;
}

export async function runSystemDiagnostics({ includeSupporting = true, forceLive = false } = {}) {
  pendingDiagnosticRequest = mergeDiagnosticRequest(pendingDiagnosticRequest, { includeSupporting, forceLive });
  if (monitorPromise) return monitorPromise;

  monitorPromise = (async () => {
    let snapshot = currentSnapshot;
    while (pendingDiagnosticRequest) {
      const request = pendingDiagnosticRequest;
      pendingDiagnosticRequest = null;
      snapshot = await executeSystemDiagnostics(request);
    }
    return snapshot;
  })().finally(() => {
    monitorPromise = null;
  });

  return monitorPromise;
}

export function getCurrentSystemHealth() {
  return currentSnapshot;
}

export async function repairSystemService(serviceId) {
  const id = safe(serviceId).toLowerCase();
  appendHistory({ service: id, severity: "info", code: "repair-started", title: "Repair started", message: `Recovery requested for ${id}.`, state: "repair" });
  try {
    if (id === "authentication") {
      const session = await getAuthorizedAdministrator({ forceRefresh: true, maxProofAgeMs: 0 });
      if (!session?.authorized) throw new Error("Administrator authorization could not be restored automatically.");
    } else if (id === "firestore") {
      await enableNetwork(db);
      const session = await getAuthorizedAdministrator({ forceRefresh: true, maxProofAgeMs: 0 });
      if (!session?.authorized || firestoreProofFromSession(session) == null) throw new Error("Protected Firestore access could not be restored automatically.");
    } else if (id === "cloudinary") {
      if (!safe(cloudinaryConfig.cloudName) || !safe(cloudinaryConfig.uploadPreset)) {
        throw Object.assign(new Error("Cloudinary configuration is incomplete and must be corrected in configuration."), { code: "manual-configuration-required" });
      }
      await requestCloudinaryHealth();
    } else {
      throw Object.assign(new Error("This issue does not have a safe automatic repair procedure."), { code: "manual-action-required" });
    }
    const snapshot = await runSystemDiagnostics();
    const item = snapshot.items.find((entry) => entry.id === id);
    const repaired = item?.severity === "healthy";
    appendHistory({ service: id, severity: repaired ? "healthy" : "warning", code: repaired ? "repair-success" : "repair-incomplete", title: repaired ? "Repair successful" : "Repair needs attention", message: item?.detail || "Recovery completed; review the latest diagnostic result.", state: "repair" });
    return { ok: repaired, item, snapshot };
  } catch (error) {
    appendHistory({ service: id, severity: "critical", code: errorCode(error), title: "Repair could not complete", message: errorMessage(error), state: "repair" });
    throw error;
  }
}

function scheduleImmediateDiagnostic() {
  if (diagnosticQueued) return;
  diagnosticQueued = true;
  queueMicrotask(() => {
    diagnosticQueued = false;
    runSystemDiagnostics().catch(handleDiagnosticExecutionError);
  });
}

export function startSystemHealthMonitor({ immediate = true } = {}) {
  if (monitorTimer) return () => stopSystemHealthMonitor();
  if (immediate) scheduleImmediateDiagnostic();
  monitorTimer = window.setInterval(() => {
    if (document.hidden) return;
    runSystemDiagnostics().catch(handleDiagnosticExecutionError);
  }, MONITOR_INTERVAL_MS);
  return () => stopSystemHealthMonitor();
}

export function stopSystemHealthMonitor() {
  if (monitorTimer) window.clearInterval(monitorTimer);
  monitorTimer = 0;
}

window.addEventListener("online", scheduleImmediateDiagnostic);
window.addEventListener("offline", scheduleImmediateDiagnostic);
