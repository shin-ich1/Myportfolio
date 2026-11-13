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
  } catch {}
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

async function requestDeletionBatch(assets = [], reason = "media-cleanup") {
  if (!assets.length) return { deleted: [], skipped: [] };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await authorizedWorkerRequest("/media/delete", {
      method: "POST",
      body: JSON.stringify({ assets, reason }),
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function requestDeletion(references = [], reason = "media-cleanup") {
  const assets = uniqueManagedMediaReferences(references);
  if (!assets.length) return { deleted: [], skipped: [] };
  const deleted = [];
  const skipped = [];
  for (let index = 0; index < assets.length; index += 50) {
    const result = await requestDeletionBatch(assets.slice(index, index + 50), reason);
    if (Array.isArray(result?.deleted)) deleted.push(...result.deleted);
    if (Array.isArray(result?.skipped)) skipped.push(...result.skipped);
  }
  return { deleted, skipped };
}

function queueDeletion(references = [], reason = "media-cleanup") {
  const current = [...readList(LEGACY_DELETE_QUEUE_KEY), ...readList(DELETE_QUEUE_KEY)];
  const pending = uniqueManagedMediaReferences([
    ...current.map((item) => item?.asset || item),
    ...references
  ]).map((asset) => ({ asset, reason, queuedAt: new Date().toISOString() }));
  writeList(DELETE_QUEUE_KEY, pending);
  return pending.length;
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
  try {
    const result = await requestDeletion(targets, reason);
    const queue = readList(DELETE_QUEUE_KEY);
    writeList(DELETE_QUEUE_KEY, queue.filter((item) =>
      !targets.some((target) => sameManagedMediaReference(item?.asset || item, target))
    ));
    return { ...result, queued: false };
  } catch (error) {
    if (strict) {
      error.queued = false;
      throw error;
    }
    queueDeletion(targets, reason);
    return { deleted: [], skipped: [], queued: true, error };
  }
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
  const temporary = readTemporaryEntries();
  const currentSessionTemporary = temporary.filter((entry) => entry.sessionId === MEDIA_LIFECYCLE_SESSION_ID);
  const abandonedTemporary = temporary
    .filter((entry) => entry.sessionId !== MEDIA_LIFECYCLE_SESSION_ID)
    .map((entry) => entry.asset);
  const queued = readList(DELETE_QUEUE_KEY).map((item) => item?.asset || item);
  const targets = uniqueManagedMediaReferences([...abandonedTemporary, ...queued]);
  if (!targets.length) return { deleted: [], skipped: [], queued: false };
  writeList(TEMPORARY_ASSETS_KEY, currentSessionTemporary);
  try {
    const result = await requestDeletion(targets, "recover-abandoned-media");
    writeList(DELETE_QUEUE_KEY, []);
    return { ...result, queued: false };
  } catch (error) {
    queueDeletion(targets, "recover-abandoned-media");
    return { deleted: [], skipped: [], queued: true, error };
  }
}
