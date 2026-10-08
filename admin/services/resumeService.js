import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { normalizeAssetReference, isManagedAssetReference, persistentAssetUrl, resolveAssetUrl } from "../../asset-resolver.js";
import { commitMediaAssets, cleanupDeletedRecordMedia, cleanupRemovedMediaAssets } from "./mediaAssetLifecycleService.js";

const COLLECTION = "resumes";
const resumesRef = collection(db, COLLECTION);
const text = (value = "") => String(value ?? "").trim();
const mediaUrl = (value) => text(persistentAssetUrl(value));
const projectPdfPath = (value = "") => {
  const candidate = text(value).replace(/^\.\//, "");
  if (!candidate || candidate.startsWith("blob:") || candidate.startsWith("data:")) return "";
  const normalized = candidate.replace(/^\/+/, "");
  return /^assets\/resumes\/[^?#]+\.pdf(?:[?#].*)?$/i.test(normalized) ? normalized : "";
};
const safeHttpUrl = (value = "") => {
  const candidate = text(value);
  if (!candidate || candidate.startsWith("blob:") || candidate.startsWith("data:")) return "";
  const localPdf = projectPdfPath(candidate);
  if (localPdf) return localPdf;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch { return ""; }
};
const normalizeAsset = (asset) => {
  const managed = normalizeAssetReference(asset);
  if (!managed || !isManagedAssetReference(managed)) return null;
  // A managed asset is persistent by provider/profile/asset identity. Its delivery URL
  // may be runtime-derived (for example the local Google Drive Worker), so never
  // reject the descriptor merely because that derived URL is not public HTTPS.
  const resolvedUrl = text(resolveAssetUrl(managed, "pdf-preview"));
  return {
    ...managed,
    url: safeHttpUrl(managed.url),
    secureUrl: safeHttpUrl(managed.secureUrl),
    previewUrl: safeHttpUrl(managed.previewUrl),
    resolvedPreviewUrl: resolvedUrl,
    originalFilename: text(managed.originalFilename || managed.displayName || managed.name),
    resourceType: text(managed.resourceType || "raw") || "raw",
    format: text(managed.format || "pdf") || "pdf"
  };
};

export function normalizeResume(raw = {}) {
  const uploadedAsset = normalizeAsset(raw.uploadedAsset || raw.uploadedFile || raw.pdfAsset || raw.asset);
  const externalUrl = safeHttpUrl(raw.externalUrl || raw.pdfUrl || raw.fileUrl || raw.file || raw.url);
  const uploadedUrl = uploadedAsset ? text(resolveAssetUrl(uploadedAsset, "pdf-preview")) : "";
  const requestedSource = text(raw.sourceType || raw.source).toLowerCase();
  const sourceType = requestedSource === "external"
    ? "external"
    : requestedSource === "upload" && uploadedUrl
      ? "upload"
      : uploadedUrl
        ? "upload"
        : externalUrl
          ? "external"
          : "upload";
  // Persist only provider-stable URLs. Managed providers such as Google Drive are
  // resolved at read time from uploadedAsset instead of storing a localhost/Worker URL.
  const resolvedUrl = sourceType === "upload" ? safeHttpUrl(mediaUrl(uploadedAsset)) : externalUrl;
  return {
    title: text(raw.title || raw.resumeTitle || raw.name),
    category: text(raw.category || raw.resumeCategory || raw.type),
    description: text(raw.description || raw.summary || raw.details),
    fileName: text(raw.fileName || raw.filename || uploadedAsset?.originalFilename || uploadedAsset?.displayName),
    sourceType,
    externalUrl,
    uploadedAsset,
    pdfUrl: resolvedUrl,
    fileUrl: resolvedUrl,
    file: resolvedUrl,
    version: text(raw.version || raw.resumeVersion),
    status: text(raw.status || raw.publicationStatus).toLowerCase() === "draft" ? "draft" : "published",
    visible: typeof raw.visible === "boolean" ? raw.visible : raw.isVisible !== false,
    featured: typeof raw.featured === "boolean" ? raw.featured : Boolean(raw.isFeatured),
    displayOrder: Number(raw.displayOrder ?? raw.order) || 0
  };
}

function validateResume(data) {
  if (!data.title) throw new Error("Resume title is required.");
  if (data.sourceType === "upload" && !data.uploadedAsset) throw new Error("Upload a PDF or provide an external PDF URL.");
  if (data.sourceType === "external" && !data.fileUrl) throw new Error("Upload a PDF or provide an external PDF URL.");
  if (data.sourceType === "external" && !projectPdfPath(data.externalUrl)) {
    try {
      const url = new URL(data.externalUrl);
      if (url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error("Enter a valid public HTTPS PDF URL.");
    }
  }
  return data;
}

export async function loadResumes() {
  const snapshot = await getDocs(resumesRef);
  return snapshot.docs
    .map((item) => ({ id: item.id, ...normalizeResume(item.data()) }))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title));
}

export function reserveResumeId() {
  return doc(resumesRef).id;
}

export async function createResume(raw, reservedResumeId = "") {
  const data = validateResume(normalizeResume(raw));
  const created = reservedResumeId ? doc(db, COLLECTION, text(reservedResumeId)) : doc(resumesRef);
  await setDoc(created, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  commitMediaAssets(data.uploadedAsset);
  return { id: created.id, ...data };
}

export async function updateResume(id, raw) {
  const data = validateResume(normalizeResume(raw));
  const reference = doc(db, COLLECTION, id);
  const previousSnapshot = await getDoc(reference);
  if (!previousSnapshot.exists()) throw new Error("Resume not found.");
  const previous = normalizeResume(previousSnapshot.data() || {});
  await updateDoc(reference, { ...data, updatedAt: serverTimestamp() });
  await cleanupRemovedMediaAssets(previous.uploadedAsset, data.uploadedAsset, { reason: "resume-file-updated" });
  return { id, ...data };
}

export async function updateManyResumes(ids = [], changes = {}) {
  const cleanIds = [...new Set((ids || []).map((id) => text(id)).filter(Boolean))];
  if (!cleanIds.length) return 0;
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(changes, "status")) patch.status = text(changes.status).toLowerCase() === "draft" ? "draft" : "published";
  if (Object.prototype.hasOwnProperty.call(changes, "featured")) patch.featured = Boolean(changes.featured);
  if (Object.prototype.hasOwnProperty.call(changes, "visible")) patch.visible = Boolean(changes.visible);
  if (!Object.keys(patch).length) throw new Error("No valid bulk Resume changes were provided.");
  await Promise.all(cleanIds.map((id) => updateDoc(doc(db, COLLECTION, id), { ...patch, updatedAt: serverTimestamp() })));
  return cleanIds.length;
}

export async function deleteResume(id) {
  const reference = doc(db, COLLECTION, id);
  const previousSnapshot = await getDoc(reference);
  const previous = previousSnapshot.exists() ? normalizeResume(previousSnapshot.data() || {}) : null;
  await deleteDoc(reference);
  if (previous) await cleanupDeletedRecordMedia(previous.uploadedAsset, { reason: "resume-deleted" });
}
