await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));
import { loadCertificates, createCertificate, reserveCertificateId, updateCertificate, updateManyCertificates, deleteCertificate } from "../services/certificateService.js";
import { uploadImage } from "../services/storageUploadService.js";
import { discardTemporaryMediaAssets } from "../services/mediaAssetLifecycleService.js";
import { formatHours } from "../../hours-value.js";
import { ADMIN_PREVIEW_BLOCK_TYPES, renderAdminPreview } from "./admin-preview.js";
import { createAdminRecordWorkspaceController } from "./admin-record-workspace.js";
import { resolveAdminMediaAssetUrl } from "./admin-media-frame.js";

const $ = (id) => document.getElementById(id);
const setSelectValue = (select, value, fallback = "") => window.LANSetSelectValue ? window.LANSetSelectValue(select, value, fallback) : ((select.value = value || fallback), true);
const form = $("certificateForm"), list = $("certificateList"), status = $("saveStatus");
const workspaceRoot = $("certificateRecordWorkspace");
const workspace = createAdminRecordWorkspaceController(workspaceRoot);
let records = [], editingId = "", previewId = "", localCertificateImageUrl = "", reservedCreateId = "", savedCertificateImageAsset = null;
const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const setStatus = (message) => { if (status) status.textContent = message; };
const certificateBrandInitials = (value = "") => { const words = String(value || "").trim().split(/\s+/).filter(Boolean).filter((word) => !/^(of|the|and|for)$/i.test(word)); return (words.slice(0,4).map((word) => word[0]).join("").toUpperCase() || "CERT").slice(0,4); };
function certificateModuleEmblem() { return `<span class="lan-card-emblem lan-card-emblem--certificate" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><circle class="emblem-glow" cx="12" cy="12" r="9.2"/><circle class="emblem-stroke" cx="12" cy="10.2" r="4.1"/><path class="emblem-stroke" d="M8.9 14.2v5.3l3.1-1.9 3.1 1.9v-5.3"/><circle class="emblem-fill" cx="12" cy="10.2" r="1.25"/></svg></span>`; }
function showError(error, fallback) { console.error(fallback, error); setStatus(error?.message || fallback); window.LANNotice?.({ title: "Certificates", message: error?.message || fallback, tone: "error" }); }
function recordFromForm() { return { id: editingId || "draft", title: $("title")?.value?.trim(), issuer: $("issuer")?.value?.trim(), year: $("year")?.value?.trim(), trainingHours: $("trainingHours")?.value, expiryDate: $("expiryDate")?.value?.trim(), credentialId: $("credentialId")?.value?.trim(), credentialUrl: $("credentialUrl")?.value?.trim(), description: $("description")?.value?.trim(), imageAsset: savedCertificateImageAsset, imageUrl: $("imageUrl")?.value?.trim(), status: $("status")?.value, visible: $("visible")?.checked, featured: $("featured")?.checked }; }
function updateImagePreview() {
  const url = localCertificateImageUrl || resolveAdminMediaAssetUrl(savedCertificateImageAsset) || resolveAdminMediaAssetUrl($("imageUrl")?.value?.trim()) || "";
  const preview = $("certificateImagePreview"), image = $("certificateImagePreviewImage");
  if (!preview || !image) return;
  if (url) {
    image.src = url;
    preview.hidden = false;
  } else {
    image.removeAttribute("src");
    preview.hidden = true;
  }
}
function setCertificateFileState(message) { const node = $("certificateFileState"); if (node) node.textContent = message; }
function renderCertificatePreview(record = null) {
  const body = $("certificatePreviewBody"), statusNode = $("certificatePreviewStatus");
  if (!body || !statusNode) return;
  statusNode.textContent = record?.status ? String(record.status).replace(/^./, (character) => character.toUpperCase()) : "Ready";
  if (!record) {
    renderAdminPreview(body, {
      blocks: [
        { type: ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY, title: "Select a certificate", eyebrow: "Certificate preview", subtitle: "Choose Preview on a saved certificate or edit a record to inspect it here." }
      ]
    });
    return;
  }
  const blocks = [];
  const imageUrl = resolveAdminMediaAssetUrl(record.imageAsset) || resolveAdminMediaAssetUrl(record.imageUrl);
  if (imageUrl) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, src: imageUrl, alt: `${record.title || "Certificate"} preview` });
  blocks.push({
    type: ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY,
    role: "credential",
    title: record.title || "Certificate",
    eyebrow: record.issuer || "Certificate",
    chips: [record.status === "published" ? "Published" : "Draft", record.featured ? "Featured" : "", record.visible === false ? "Hidden" : "Visible"].filter(Boolean)
  });
  if (record.description) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW, title: "Overview", body: record.description });
  const facts = [
    record.year ? { label: "Issued", value: String(record.year) } : null,
    formatHours(record.trainingHours) ? { label: "Training hours", value: formatHours(record.trainingHours) } : null,
    record.expiryDate ? { label: "Expiry", value: String(record.expiryDate) } : null,
    record.credentialId ? { label: "Credential ID", value: String(record.credentialId) } : null
  ].filter(Boolean);
  if (facts.length) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.FACTS, title: "Credential details", items: facts });
  const credential = String(record.credentialUrl || "").trim();
  if (credential) blocks.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.ACTIONS, items: [{ label: "Open Credential", href: credential, primary: true }] });
  renderAdminPreview(body, { mode: imageUrl ? "media-first" : "structured", blocks });
}

function render() {
  if (!list) return;
  list.innerHTML = records.length ? records.map((record) => {
    const recordStatus = record.status === "published" ? "published" : "draft";
    const resolvedImageUrl = resolveAdminMediaAssetUrl(record.imageAsset) || resolveAdminMediaAssetUrl(record.imageUrl) || "";
    const image = resolvedImageUrl ? `<img src="${escapeHtml(resolvedImageUrl)}" alt="${escapeHtml(record.title)} certificate" loading="lazy" decoding="async"><span class="certificate-media-fallback">${certificateModuleEmblem()}</span>` : `<span class="certificate-media-mark">${certificateModuleEmblem()}</span>`;
    return `<article class="simple-card certificate-card${previewId === record.id ? " is-active" : ""}" data-certificate-id="${escapeHtml(record.id)}"><div class="certificate-card-media">${image}</div><div class="certificate-card-body"><div class="simple-card-head"><div><strong>${escapeHtml(record.title)}</strong><div class="simple-meta">${escapeHtml(record.issuer || "Issuer not specified")}${record.year ? ` · ${escapeHtml(record.year)}` : ""}${formatHours(record.trainingHours) ? ` · ${escapeHtml(formatHours(record.trainingHours))}` : ""}</div></div><div class="certificate-badges"><span class="certificate-badge is-${recordStatus}">${escapeHtml(recordStatus.replace(/^./, (character) => character.toUpperCase()))}</span>${record.visible === false ? '<span class="certificate-badge is-hidden">Hidden</span>' : ""}${record.featured ? '<span class="certificate-badge featured">Featured</span>' : ""}</div></div>${record.description ? `<p class="certificate-card-description">${escapeHtml(record.description)}</p>` : ""}</div><div class="simple-card-actions certificate-card-actions"><button type="button" data-preview="${escapeHtml(record.id)}" class="editor-secondary-button button-compact">Preview</button>${record.credentialUrl ? `<a class="editor-secondary-button button-compact" href="${escapeHtml(record.credentialUrl)}" target="_blank" rel="noopener noreferrer">Credential</a>` : ""}<button type="button" data-edit="${escapeHtml(record.id)}" class="editor-secondary-button button-compact">Edit</button><button type="button" data-delete="${escapeHtml(record.id)}" class="editor-danger-button button-compact">Delete</button></div></article>`;
  }).join("") : '<div class="simple-empty"><span class="certificate-media-mark">LΛN</span><strong>No certificates yet.</strong><span>Add a certificate or run Portfolio Initialization from Settings.</span></div>';
  window.LANPinActiveRecordCard?.(list, editingId || "", { cardSelector: ".certificate-card", idAttribute: "data-certificate-id" });
  window.LANCreateRecordSelection?.(list, {
    cardSelector: ".certificate-card", idAttribute: "data-certificate-id", actionSelector: ".certificate-card-actions", label: "certificate",
    records,
    capabilities: { publishing: true, featured: true, visibility: false, deletion: true },
    onBulkPatch: async (ids, changes) => { await updateManyCertificates(ids, changes); await load(); window.LANNotice?.({ title: "Certificates", message: `${ids.length} certificate${ids.length === 1 ? "" : "s"} updated.`, tone: "success" }); },
    onDelete: async (ids) => { for (const id of ids) await deleteCertificate(id); if (ids.includes(editingId)) reset(); await load(); }
  })?.sync();
  list.querySelectorAll(".certificate-card-media img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
  list.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => preview(button.dataset.preview)));
  list.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => edit(button.dataset.edit)));
  list.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => remove(button.dataset.delete)));
}
function preview(id) { const record = records.find((item) => item.id === id); if (!record) return; previewId = id; render(); renderCertificatePreview(record); workspace.openPreview(); requestAnimationFrame(() => $("certificatePreviewPane")?.scrollIntoView({ behavior: "smooth", block: "nearest" })); }
async function load() { setStatus("Loading..."); try { records = await loadCertificates(); if (previewId && !records.some((r) => r.id === previewId)) { previewId = ""; workspace.closePreview(); } render(); renderCertificatePreview(previewId ? records.find((r) => r.id === previewId) || null : null); setStatus("Ready"); } catch (error) { showError(error, "Unable to load certificates."); } }
function edit(id) { const record = records.find((item) => item.id === id); if (!record) return; editingId = id; previewId = ""; savedCertificateImageAsset = record.imageAsset || null; ["title", "issuer", "year", "trainingHours", "expiryDate", "credentialId", "credentialUrl", "description", "imageUrl", "displayOrder"].forEach((key) => { const element = $(key); if (element) element.value = record[key] ?? ""; }); setSelectValue($("status"), record.status, "published"); $("visible").checked = record.visible !== false; $("featured").checked = Boolean(record.featured); updateImagePreview(); render(); renderCertificatePreview(null); $("certificateEditorTitle").textContent = "Edit Certificate"; workspace.startEdit(); form?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
function clearEditorState({ openEditor = false } = {}) { void discardTemporaryMediaAssets(savedCertificateImageAsset || $("imageUrl")?.value?.trim(), { reason: "certificate-editor-cancelled" }); savedCertificateImageAsset = null; editingId = ""; reservedCreateId = ""; previewId = ""; if (localCertificateImageUrl) URL.revokeObjectURL(localCertificateImageUrl); localCertificateImageUrl = ""; form?.reset(); $("visible").checked = true; $("status").value = "published"; updateImagePreview(); setCertificateFileState("No local image selected."); setStatus("Ready"); render(); renderCertificatePreview(null); $("certificateEditorTitle").textContent = "New Certificate"; if (openEditor) workspace.startCreate(); else workspace.showIdle(); }
function reset() { clearEditorState(); }
function startCreate() { clearEditorState({ openEditor: true }); requestAnimationFrame(() => form?.scrollIntoView({ behavior: "smooth", block: "nearest" })); }
function closeCertificatePreview() { previewId = ""; render(); renderCertificatePreview(null); workspace.closePreview(); }
async function remove(id) { if (!await window.LANConfirm({ title: "Delete certificate?", message: "This certificate record will be permanently removed.", confirmLabel: "Delete certificate", danger: true })) return; setStatus("Deleting..."); try { await deleteCertificate(id); if (previewId === id) previewId = ""; await load(); } catch (error) { showError(error, "Unable to delete the certificate."); } }
form?.addEventListener("submit", async (event) => { event.preventDefault(); if (window.LANValidateForm ? !window.LANValidateForm(form, { title: "Complete Certificate" }) : !form.reportValidity()) return; const data = Object.fromEntries(new FormData(form)); data.imageAsset = savedCertificateImageAsset; data.visible = $("visible").checked; data.featured = $("featured").checked; data.displayOrder = Number(data.displayOrder || 0); setStatus("Saving..."); try { if (editingId) await updateCertificate(editingId, data); else await createCertificate(data, reservedCreateId || (reservedCreateId = reserveCertificateId())); reset(); await load(); window.LANNotice?.({ title: "Certificate saved", message: "The certificate record was saved successfully.", tone: "success" }); } catch (error) { showError(error, "Unable to save the certificate."); } });
["title","issuer","year","trainingHours","credentialId","description","imageUrl","status"].forEach((id) => $(id)?.addEventListener("input", () => renderCertificatePreview(recordFromForm())));
$("uploadCertificateImageButton")?.addEventListener("click", async () => { const file = $("certificateImageFile")?.files?.[0]; if (!file) { setStatus("Choose an image first."); setCertificateFileState("Choose an image before uploading."); return; } const button = $("uploadCertificateImageButton"); button.disabled = true; setStatus("Uploading image..."); try { const previousImage = savedCertificateImageAsset || $("imageUrl")?.value?.trim() || ""; const ownerId = editingId || reservedCreateId || (reservedCreateId = reserveCertificateId()); const uploaded = await uploadImage(file, "certificates", () => {}, { access: "public-preview", context: { ownerType: "certificate", ownerId, fieldId: "image", pageName: "Certificates", recordTitle: String($("title")?.value || "Certificate").trim() } }); savedCertificateImageAsset = uploaded; $("imageUrl").value = ""; await discardTemporaryMediaAssets(previousImage, { reason: "certificate-temp-image-replaced" }); if (localCertificateImageUrl) URL.revokeObjectURL(localCertificateImageUrl); localCertificateImageUrl = ""; updateImagePreview(); renderCertificatePreview(recordFromForm()); setCertificateFileState(`${file.name} · upload complete`); setStatus("Image uploaded. Save the certificate to keep it."); } catch (error) { showError(error, "Unable to upload certificate image."); } finally { button.disabled = false; } });
$("removeCertificateImageButton")?.addEventListener("click", async () => { await discardTemporaryMediaAssets(savedCertificateImageAsset || $("imageUrl")?.value?.trim(), { reason: "certificate-temp-image-removed" }); savedCertificateImageAsset = null; if (localCertificateImageUrl) URL.revokeObjectURL(localCertificateImageUrl); localCertificateImageUrl = ""; $("imageUrl").value = ""; if ($("certificateImageFile")) $("certificateImageFile").value = ""; updateImagePreview(); renderCertificatePreview(recordFromForm()); setCertificateFileState("No local image selected."); setStatus("Image removed from this record. Save to confirm."); });
$("certificateImageFile")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (localCertificateImageUrl) URL.revokeObjectURL(localCertificateImageUrl);
  localCertificateImageUrl = file ? URL.createObjectURL(file) : "";
  updateImagePreview();
  setCertificateFileState(file ? `${file.name} · ready to upload` : "No local image selected.");
});
$("imageUrl")?.addEventListener("input", () => { savedCertificateImageAsset = null; localCertificateImageUrl = ""; updateImagePreview(); }); $("cancelButton")?.addEventListener("click", reset); workspaceRoot?.addEventListener("lan:recordcreate", startCreate); $("closeCertificatePreviewAction")?.addEventListener("click", closeCertificatePreview); updateImagePreview(); renderCertificatePreview(null); workspace.showIdle(); await load();
