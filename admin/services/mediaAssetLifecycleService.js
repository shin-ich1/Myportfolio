import {
  collectManagedMediaReferences,
  removedManagedMediaReferences,
  sameManagedMediaReference,
  uniqueManagedMediaReferences
} from "../../media-asset-lifecycle.js";
import { authorizedWorkerRequest } from "./storageBridgeService.js";

const TEMPORARY_ASSETS_KEY = "lan-cms-temporary-storage-assets-v2";
const DELETE_QUEUE_KEY = "lan-cms-storage-delete-queue-v2";
const LEGACY_TEMPORARY_ASSETS_KEY = "lan-cms-temporary-cloudinary-assets-v1";
const LEGACY_DELETE_QUEUE_KEY = "lan-cms-cloudinary-delete-queue-v1";
const REQUEST_TIMEOUT_MS = 15000;
const MEDIA_LIFECYCLE_SESSION_ID = globalThis.crypto?.randomUUID?.() || `media-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const text = (value = "") => String(value ?? "").trim();

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeList(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
    return true;
  } catch {
    return false;
  }
}

function readDeletionQueue() {
  // A damaged or unavailable recovery queue must never be silently treated as
  // empty and overwritten when a destructive record transition is requested.
  try {
    const queue = JSON.parse(localStorage.getItem(DELETE_QUEUE_KEY) || "[]");
    if (!Array.isArray(queue)) throw new Error("Invalid media cleanup queue.");
    return queue;
  } catch {
    const error = new Error("Media cleanup recovery storage is unavailable. No record was deleted.");
    error.code = "media-cleanup-queue-unavailable";
    throw error;
  }
}

function normalizeTemporaryEntry(item) {
  if (item?.asset) {
    const asset = uniqueManagedMediaReferences([item.asset])[0];
    return asset ? {
      asset,
      sessionId: text(item.sessionId || "legacy"),
      createdAt: text(item.createdAt)
    } : null;
  }
  const asset = uniqueManagedMediaReferences([item])[0];
  return asset ? { asset, sessionId: "legacy", createdAt: "" } : null;
}

function readTemporaryEntries() {
  return [...readList(LEGACY_TEMPORARY_ASSETS_KEY), ...readList(TEMPORARY_ASSETS_KEY)].map(normalizeTemporaryEntry).filter(Boolean);
}

function temporaryEntryMatches(entry, references = []) {
  return references.some((reference) => sameManagedMediaReference(entry.asset, reference));
}

function removeTemporaryReferences(entries = [], removals = []) {
  const references = uniqueManagedMediaReferences(removals);
  return entries.filter((entry) => !temporaryEntryMatches(entry, references));
}

// One deletion-reference contract for outbound requests and retry persistence.
function deletionContractReference({
  provider, storageProfileId, assetId, fileId, key, publicId,
  resourceType, url, secureUrl, folderId, context
} = {}) {
  return {
    provider, storageProfileId, assetId, fileId, key, publicId,
    resourceType, url, secureUrl, folderId, context
  };
}

async function requestDeletionBatch(assets = [], reason = "media-cleanup") {
  if (!assets.length) return { deleted: [], skipped: [] };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Send only the Worker deletion contract. Normalized media records contain
    // display/derivative metadata (uploadedAt, dimensions, URLs for previews)
    // that its strict request validator must reject.
    const references = assets.map(deletionContractReference);
    return await authorizedWorkerRequest("/media/delete", {
      method: "POST",
      body: JSON.stringify({ assets: references }),
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timer);
  }
}

// Only a provider-confirmed deletion or already-missing response is complete.
// A 200 with "still-referenced", "unresolved", or other skipped results is
// never evidence that a file was physically deleted.
function completedDeletionReferences(result = {}) {
  return [
    ...(Array.isArray(result.deleted) ? result.deleted : []),
    ...(Array.isArray(result.skipped) ? result.skipped : [])
      .filter((item) => item?.reason === "already-missing")
      .map((item) => item?.reference || item)
  ];
}

function unresolvedDeletionReferences(assets = [], result = {}) {
  const complete = completedDeletionReferences(result);
  return uniqueManagedMediaReferences(assets)
    .filter((asset) => !complete.some((entry) => sameManagedMediaReference(asset, entry)));
}

async function requestDeletion(references = [], reason = "media-cleanup") {
  const assets = uniqueManagedMediaReferences(references);
  if (!assets.length) return { deleted: [], skipped: [], failed: [] };
  const deleted = [];
  const skipped = [];
  for (let index = 0; index < assets.length; index += 50) {
    try {
      const result = await requestDeletionBatch(assets.slice(index, index + 50), reason);
      if (Array.isArray(result?.deleted)) deleted.push(...result.deleted);
      if (Array.isArray(result?.skipped)) skipped.push(...result.skipped);
    } catch (error) {
      // 502 may mean *partial* success. Preserve confirmed responses from the
      // failed batch and every earlier batch before deciding what may be retried.
      const partial = error?.result || {};
      if (Array.isArray(partial.deleted)) deleted.push(...partial.deleted);
      if (Array.isArray(partial.skipped)) skipped.push(...partial.skipped);
      error.result = {
        deleted, skipped,
        failed: Array.isArray(partial.failed) ? partial.failed : []
      };
      throw error;
    }
  }
  return { deleted, skipped, failed: [] };
}

function queueDeletion(references = [], reason = "media-cleanup", { explicitIntent = false } = {}) {
  const assets = uniqueManagedMediaReferences(references);
  if (!assets.length) return 0;
  const current = readDeletionQueue();
  const now = new Date().toISOString();
  for (const asset of assets) {
    const existing = current.find((item) =>
      sameManagedMediaReference(item?.asset || item, asset)
    );
    if (existing) {
      // A fresh, explicit record deletion may upgrade its own stale queue
      // entry. Merely recovering old entries never upgrades them.
      if (explicitIntent) existing.autoRetry = true;
    } else {
      current.push({ asset: deletionContractReference(asset), reason, queuedAt: now, autoRetry: true });
    }
  }
  if (!writeList(DELETE_QUEUE_KEY, current)) {
    const error = new Error("Media cleanup recovery storage is unavailable. No record was deleted.");
    error.code = "media-cleanup-queue-unavailable";
    throw error;
  }
  return current.length;
}

function forgetCompletedDeletions(result = {}) {
  const complete = completedDeletionReferences(result);
  if (!complete.length) return;
  writeList(DELETE_QUEUE_KEY, readDeletionQueue().filter((item) =>
    !complete.some((asset) => sameManagedMediaReference(item?.asset || item, asset))
  ));
}

// Persist intent BEFORE a destructive Firestore record transition. Recovery
// can then complete provider deletion after the owner record disappears, and
// Worker-side reference checks protect any other retained CMS consumers.
export function queueManagedMediaCleanup(value, reason = "record-deleted") {
  return queueDeletion(collectManagedMediaReferences(value), reason, { explicitIntent: true });
}

export function registerTemporaryMediaAsset(value) {
  const references = collectManagedMediaReferences(value);
  if (!references.length) return [];
  let current = readTemporaryEntries();
  for (const reference of references) {
    current = removeTemporaryReferences(current, [reference]);
    current.push({
      asset: reference,
      sessionId: MEDIA_LIFECYCLE_SESSION_ID,
      createdAt: new Date().toISOString()
    });
  }
  writeList(TEMPORARY_ASSETS_KEY, current);
  return references;
}

export function commitMediaAssets(value) {
  const committed = collectManagedMediaReferences(value);
  if (!committed.length) return [];
  writeList(TEMPORARY_ASSETS_KEY, removeTemporaryReferences(readTemporaryEntries(), committed));
  return committed;
}

export function isTemporaryMediaAsset(value) {
  const references = collectManagedMediaReferences(value);
  const current = readTemporaryEntries();
  return references.some((reference) => current.some((entry) => sameManagedMediaReference(reference, entry.asset)));
}

async function deleteAndForget(references, { reason = "media-cleanup", temporaryOnly = false, strict = false } = {}) {
  const requested = uniqueManagedMediaReferences(references);
  if (!requested.length) return { deleted: [], skipped: [], queued: false };
  const temporary = readTemporaryEntries();
  const targets = temporaryOnly
    ? requested.filter((reference) => temporary.some((entry) => sameManagedMediaReference(reference, entry.asset)))
    : requested;
  if (!targets.length) return { deleted: [], skipped: [], queued: false };

  writeList(TEMPORARY_ASSETS_KEY, removeTemporaryReferences(temporary, targets));
  let result;
  let failure = null;
  try {
    result = await requestDeletion(targets, reason);
  } catch (error) {
    failure = error;
    result = error?.result || { deleted: [], skipped: [], failed: [] };
  }
  forgetCompletedDeletions(result);
  const pending = unresolvedDeletionReferences(targets, result);
  if (pending.length) queueDeletion(pending, reason);
  const outcome = {
    deleted: result.deleted || [], skipped: result.skipped || [],
    failed: result.failed || [], queued: pending.length > 0,
    pendingCount: pending.length
  };
  if (strict && (failure || pending.length)) {
    const error = failure || new Error("Storage provider did not confirm deletion of all managed files.");
    error.code ||= "media-delete-unconfirmed";
    error.queued = pending.length > 0;
    error.result = outcome;
    throw error;
  }
  return failure ? { ...outcome, error: failure } : outcome;
}

export async function removeManagedMediaAssets(value, options = {}) {
  return deleteAndForget(collectManagedMediaReferences(value), {
    reason: options.reason || "explicit-media-remove",
    temporaryOnly: false,
    strict: options.strict === true
  });
}

export async function discardTemporaryMediaAssets(value, options = {}) {
  return deleteAndForget(collectManagedMediaReferences(value), {
    reason: options.reason || "discard-temporary-upload",
    temporaryOnly: true
  });
}

export async function cleanupRemovedMediaAssets(previousValue, nextValue, options = {}) {
  const removed = removedManagedMediaReferences(previousValue, nextValue);
  const result = await deleteAndForget(removed, {
    reason: options.reason || "record-media-replaced",
    temporaryOnly: false
  });
  commitMediaAssets(nextValue);
  return result;
}

export async function cleanupDeletedRecordMedia(record, options = {}) {
  return deleteAndForget(collectManagedMediaReferences(record), {
    reason: options.reason || "record-deleted",
    temporaryOnly: false,
    strict: options.strict === true
  });
}

export async function cleanupModuleOwnedMedia(value, options = {}) {
  return deleteAndForget(collectManagedMediaReferences(value), {
    reason: options.reason || "custom-module-deleted",
    temporaryOnly: false,
    strict: options.strict !== false
  });
}

export async function recoverMediaAssetLifecycle() {
  const abandonedTemporary = readTemporaryEntries()
    .filter((entry) => entry.sessionId !== MEDIA_LIFECYCLE_SESSION_ID)
    .map((entry) => entry.asset);
  const queued = readDeletionQueue();
  const legacy = readList(LEGACY_DELETE_QUEUE_KEY);
  // Historical unverified entries must never be
  // silently migrated into automatic deletion. New, explicit deletion intents
  // are retried through the same Worker-side reference guard as manual deletes.
  const eligible = queued.filter((item) => item?.autoRetry === true)
    .map((item) => item.asset).filter(Boolean);
  let outcome = { deleted: [], skipped: [], queued: false };
  if (eligible.length) {
    outcome = await deleteAndForget(eligible, {
      reason: "retry-queued-media", temporaryOnly: false
    });
  }
  const remaining = readDeletionQueue();
  const held = [
    ...abandonedTemporary, ...legacy.map((item) => item?.asset || item),
    ...remaining.filter((item) => item?.autoRetry !== true).map((item) => item?.asset || item)
  ];
  const pending = uniqueManagedMediaReferences([
    ...held, ...remaining.map((item) => item?.asset || item)
  ]);
  return {
    ...outcome,
    queued: pending.length > 0,
    reviewRequired: held.length > 0,
    pendingCount: pending.length
  };
}
