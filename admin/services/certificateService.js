import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { commitMediaAssets, cleanupDeletedRecordMedia, cleanupRemovedMediaAssets } from "./mediaAssetLifecycleService.js";
import { normalizeHours } from "../../hours-value.js";
import { normalizeAssetReference, isManagedAssetReference } from "../../asset-resolver.js";

const COLLECTION_NAME = "certificates";
const certificateCollection = collection(db, COLLECTION_NAME);
const text = (value = "") => String(value ?? "").trim();

function certificateMediaReference(record = {}) {
  return normalizeAssetReference({
    imageAsset: record.imageAsset,
    image: record.image,
    certificateImage: record.certificateImage,
    media: record.media,
    asset: record.asset,
    uploadedAsset: record.uploadedAsset,
    file: record.file,
    thumbnail: record.thumbnail,
    previewImage: record.previewImage,
    coverImage: record.coverImage,
    imageUrl: record.imageUrl,
    certificateUrl: record.certificateUrl
  });
}

function certificateImageAsset(record = {}) {
  const reference = certificateMediaReference(record);
  return reference && isManagedAssetReference(reference) ? reference : null;
}

function certificateLegacyImageUrl(record = {}) {
  const reference = certificateMediaReference(record);
  return typeof reference === "string" ? reference : "";
}


export const normalizeCertificate = (record = {}) => ({
  title: text(record.title || record.certificateName || record.name),
  issuer: text(record.issuer || record.organization || record.provider || record.issuedBy),
  year: text(record.year || record.issueDate || record.dateIssued),
  trainingHours: normalizeHours(record.trainingHours ?? record.contactHours ?? record.hours),
  expiryDate: text(record.expiryDate || record.expirationDate || record.expiresAt),
  credentialId: text(record.credentialId || record.credentialID || record.certificateId),
  credentialUrl: text(record.credentialUrl || record.credentialURL || record.verificationUrl || record.verifyUrl),
  description: text(record.description || record.summary || record.details),
  imageAsset: certificateImageAsset(record),
  imageUrl: certificateLegacyImageUrl(record),
  status: text(record.status || record.publicationStatus).toLowerCase() === "draft" ? "draft" : "published",
  visible: typeof record.visible === "boolean" ? record.visible : record.isVisible !== false,
  featured: typeof record.featured === "boolean" ? record.featured : Boolean(record.isFeatured),
  displayOrder: Number(record.displayOrder ?? record.order) || 0
});

export async function loadCertificates() {
  const snapshot = await getDocs(certificateCollection);
  return snapshot.docs
    .map((item) => ({ id: item.id, ...normalizeCertificate(item.data()) }))
    .sort((first, second) => first.displayOrder - second.displayOrder);
}

export function reserveCertificateId() {
  return doc(certificateCollection).id;
}

export async function createCertificate(raw, reservedCertificateId = "") {
  const data = normalizeCertificate(raw);
  if (!data.title) throw new Error("Certificate title is required.");
  const created = await addDoc(certificateCollection, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  commitMediaAssets(data.imageAsset || data.imageUrl);
  return { id: created.id, ...data };
}

export async function updateCertificate(id, raw) {
  const data = normalizeCertificate(raw);
  if (!data.title) throw new Error("Certificate title is required.");
  const reference = doc(db, COLLECTION_NAME, id);
  const previousSnapshot = await getDoc(reference);
  if (!previousSnapshot.exists()) throw new Error("Certificate not found.");
  const previous = normalizeCertificate(previousSnapshot.data() || {});
  await updateDoc(reference, {
    ...data,
    updatedAt: serverTimestamp()
  });
  await cleanupRemovedMediaAssets(previous.imageAsset || previous.imageUrl, data.imageAsset || data.imageUrl, { reason: "certificate-image-updated" });
  return { id, ...data };
}

export async function updateManyCertificates(ids = [], changes = {}) {
  const cleanIds = [...new Set((ids || []).map((id) => text(id)).filter(Boolean))];
  if (!cleanIds.length) return 0;
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(changes, "status")) patch.status = text(changes.status).toLowerCase() === "draft" ? "draft" : "published";
  if (Object.prototype.hasOwnProperty.call(changes, "featured")) patch.featured = Boolean(changes.featured);
  if (Object.prototype.hasOwnProperty.call(changes, "visible")) patch.visible = Boolean(changes.visible);
  if (!Object.keys(patch).length) throw new Error("No valid bulk Certificate changes were provided.");
  await Promise.all(cleanIds.map((id) => updateDoc(doc(db, COLLECTION_NAME, id), { ...patch, updatedAt: serverTimestamp() })));
  return cleanIds.length;
}

export async function deleteCertificate(id) {
  const reference = doc(db, COLLECTION_NAME, id);
  const previousSnapshot = await getDoc(reference);
  const previous = previousSnapshot.exists() ? normalizeCertificate(previousSnapshot.data() || {}) : null;
  await deleteDoc(reference);
  if (previous) await cleanupDeletedRecordMedia(previous.imageAsset || previous.imageUrl, { reason: "certificate-deleted" });
}
