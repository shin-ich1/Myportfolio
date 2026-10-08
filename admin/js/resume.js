await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));
import { loadResumes, createResume, reserveResumeId, updateResume, updateManyResumes, deleteResume } from "../services/resumeService.js";
import { uploadMedia, validateMediaFile } from "../services/storageUploadService.js";
import { discardTemporaryMediaAssets } from "../services/mediaAssetLifecycleService.js";
import { stageLocalMediaFile, releaseLocalMediaSelection, localMediaPreviewUrl } from "../services/pendingMediaSelectionService.js";
import { resolveAssetUrl } from "../../asset-resolver.js";
import { ADMIN_PREVIEW_BLOCK_TYPES, renderAdminPreview } from "./admin-preview.js";
import { createAdminRecordWorkspaceController } from "./admin-record-workspace.js";

const $ = (id) => document.getElementById(id);
const setSelectValue = (select, value, fallback = "") => window.LANSetSelectValue ? window.LANSetSelectValue(select, value, fallback) : ((select.value = value || fallback), true);
const form = $("resumeForm"), list = $("resumeList"), status = $("saveStatus");
const workspaceRoot = $("resumeRecordWorkspace");
const workspace = createAdminRecordWorkspaceController(workspaceRoot);
let records = [], editingId = "", uploadedAsset = null, pendingPdfSelection = null, uploadInProgress = false, previewId = "", reservedCreateId = "";
const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const safePdfUrl = (value = "") => {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.startsWith("blob:") || candidate.startsWith("data:")) return "";
  try {
    const parsed = /^[a-z][a-z0-9+.-]*:/i.test(candidate) ? new URL(candidate) : new URL(`../../${candidate.replace(/^\.\//, "")}`, import.meta.url);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
};
const fileUrl = (record = {}) => {
  const pendingUrl = localMediaPreviewUrl(record.pendingPdfSelection);
  return pendingUrl || safePdfUrl(resolveAssetUrl(record.uploadedAsset, "pdf-preview") || record.externalUrl || record.fileUrl || record.file);
};
const formatBytes = (bytes = 0) => bytes ? `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB` : "";
const formatDisplayLabel = (value = "") => String(value || "General")
  .trim()
  .replace(/[-_]+/g, " ")
  .replace(/\s+/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());
const setStatus = (message) => { if (status) status.textContent = message; };
function showError(error, fallback) { console.error(fallback, error); setStatus(error?.message || fallback); window.LANNotice?.({ title: "Resume", message: error?.message || fallback, tone: "error" }); }
function selectedSource() { return form.querySelector('input[name="sourceType"]:checked')?.value || "upload"; }
function setUploading(active) { uploadInProgress = active; $("saveResumeButton").disabled = active; $("browsePdfButton").disabled = active; setStatus(active ? "Uploading PDF…" : "Ready"); }
function updateSourcePanels() { const upload = selectedSource() === "upload"; $("uploadSourcePanel").hidden = !upload; $("externalSourcePanel").hidden = upload; $("externalUrl").required = !upload; }

function renderUploadedAsset() {
  const card = $("uploadedFileCard");
  const shownAsset = pendingPdfSelection?.descriptor || uploadedAsset;
  if (!shownAsset) { card.hidden = true; return; }
  card.hidden = false;
  $("uploadedFileName").textContent = shownAsset.originalFilename || shownAsset.displayName || "Uploaded resume.pdf";
  $("uploadedFileMeta").textContent = ["PDF", formatBytes(shownAsset.bytes)].filter(Boolean).join(" · ");
  const previewUrl = localMediaPreviewUrl(pendingPdfSelection) || safePdfUrl(resolveAssetUrl(uploadedAsset, "pdf-preview"));
  $("uploadedPreview").href = previewUrl || "#";
  $("uploadedPreview").toggleAttribute("aria-disabled", !previewUrl);
}

function currentDraftRecord() {
  return {
    id: editingId || "draft",
    title: $("title")?.value?.trim() || "Unsaved Resume",
    category: $("category")?.value?.trim() || "General",
    status: $("status")?.value || "draft",
    version: $("version")?.value?.trim() || "",
    uploadedAsset: selectedSource() === "upload" ? uploadedAsset : null,
    pendingPdfSelection: selectedSource() === "upload" ? pendingPdfSelection : null,
    externalUrl: selectedSource() === "external" ? $("externalUrl")?.value?.trim() : ""
  };
}

function renderResumePreview(record = null) {
  const frame = $("resumePreviewFrame"), title = $("resumePreviewTitle"), badge = $("resumePreviewStatus"), actions = $("resumePreviewActions");
  if (!frame || !title || !badge || !actions) return;
  const url = record ? fileUrl(record) : "";
  title.textContent = record?.title || "No resume selected";
  badge.textContent = record?.status ? String(record.status).replace(/^./, (character) => character.toUpperCase()) : "Ready";
  badge.className = `badge ${record?.status === "published" ? "is-published" : record?.status === "draft" ? "is-draft" : ""}`.trim();
  if (!url) {
    frame.classList.remove("has-document");
    renderAdminPreview(frame, {
      surface: "embedded",
      blocks: [{
        type: ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY,
        title: record ? "Preview unavailable" : "No PDF selected",
        eyebrow: "Resume preview",
        subtitle: record ? "This resume does not have a valid public PDF URL yet. Upload or select a PDF, then save the record." : "Select a saved resume and choose Preview, or upload a PDF, to view it here."
      }]
    });
    actions.hidden = true;
    actions.innerHTML = "";
    return;
  }
  frame.classList.add("has-document");
  renderAdminPreview(frame, {
    mode: "media-first",
    surface: "embedded",
    blocks: [{ type: ADMIN_PREVIEW_BLOCK_TYPES.DOCUMENT, title: record?.title || "Resume", src: `${url}#toolbar=1&navpanes=0` }]
  });
  actions.hidden = false;
  const fileName = record?.fileName || `${record?.title || "resume"}.pdf`;
  actions.innerHTML = `<span class="lan-resume-preview-file"><strong>PDF ready</strong><small>${escapeHtml(fileName)}</small></span><div class="lan-resume-preview-action-buttons"><button class="editor-secondary-button" type="button" data-preview-close>Close</button><a class="editor-secondary-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open PDF</a><button class="editor-secondary-button" type="button" data-preview-download="${escapeHtml(url)}" data-preview-name="${escapeHtml(fileName)}">Download</button></div>`;
  actions.querySelector("[data-preview-close]")?.addEventListener("click", closeResumePreview);
  actions.querySelector("[data-preview-download]")?.addEventListener("click", (event) => downloadPdf(event.currentTarget.dataset.previewDownload, event.currentTarget.dataset.previewName));
}


async function downloadPdf(url, fileName = "resume.pdf") {
  const safeUrl = safePdfUrl(url);
  if (!safeUrl) return;
  try {
    const response = await fetch(safeUrl, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`Download failed with status ${response.status}.`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = objectUrl; link.download = fileName || "resume.pdf"; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    console.warn("Direct PDF download was unavailable; opening the persisted file URL instead.", error);
    window.open(safeUrl, "_blank", "noopener,noreferrer");
  }
}

function render() {
  list.innerHTML = records.length ? records.map((record) => {
    const url = fileUrl(record), active = previewId === record.id ? " is-active" : "";
    return `<article class="simple-card resume-card${active}" data-record-id="${escapeHtml(record.id)}"><div class="resume-card-mark" aria-hidden="true"><span class="resume-card-emblem"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><path d="M6 2.75h8l4 4v14.5H6z"/><path d="M14 2.75v4.5h4"/><circle cx="10" cy="11" r="1.8"/><path d="M7.8 15c.6-1.5 3.8-1.5 4.4 0M14 11h2.2M14 14h2.2M8 18h8"/></svg></span></div><div class="resume-card-body"><div class="simple-card-head"><div><strong>${escapeHtml(record.title)}</strong><div class="simple-meta">${escapeHtml(formatDisplayLabel(record.category || "General"))}${record.version ? ` · v${escapeHtml(record.version)}` : ""}</div>${record.description ? `<p>${escapeHtml(record.description)}</p>` : ""}</div><div class="certificate-badges">${record.featured ? '<span class="certificate-badge featured">Featured</span>' : ""}${record.visible === false ? '<span class="certificate-badge is-hidden">Hidden</span>' : ""}<span class="certificate-badge ${record.status === "published" ? "is-published" : "is-draft"}">${escapeHtml(formatDisplayLabel(record.status || "draft"))}</span></div></div></div><div class="simple-card-actions resume-card-actions"><button class="editor-secondary-button button-compact" type="button" data-preview-id="${escapeHtml(record.id)}" ${url ? "" : "disabled"}>Preview</button>${url ? `<button class="editor-secondary-button button-compact" type="button" data-download-url="${escapeHtml(url)}" data-download-name="${escapeHtml(record.fileName || `${record.title || "resume"}.pdf`)}">Download</button>` : ""}<button type="button" data-edit="${escapeHtml(record.id)}" class="editor-secondary-button button-compact">Edit</button><button type="button" data-delete="${escapeHtml(record.id)}" class="editor-danger-button button-compact">Delete</button></div></article>`;
  }).join("") : '<div class="simple-empty"><strong>No resumes yet.</strong><span>Upload a PDF or add an external URL to create your first resume record.</span></div>';
  window.LANPinActiveRecordCard?.(list, editingId || "", { cardSelector: ".resume-card", idAttribute: "data-record-id" });
  window.LANCreateRecordSelection?.(list, {
    cardSelector: ".resume-card", idAttribute: "data-record-id", actionSelector: ".resume-card-actions", label: "resume",
    records,
    capabilities: { publishing: true, featured: true, visibility: false, deletion: true },
    onBulkPatch: async (ids, changes) => { await updateManyResumes(ids, changes); await load(); window.LANNotice?.({ title: "Resume", message: `${ids.length} resume record${ids.length === 1 ? "" : "s"} updated.`, tone: "success" }); },
    onDelete: async (ids) => { for (const id of ids) await deleteResume(id); if (ids.includes(editingId)) reset(); if (ids.includes(previewId)) previewId = ""; await load(); }
  })?.sync();
  list.querySelectorAll("[data-preview-id]").forEach((button) => button.addEventListener("click", () => preview(button.dataset.previewId)));
  list.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => edit(button.dataset.edit)));
  list.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => remove(button.dataset.delete)));
  list.querySelectorAll("[data-download-url]").forEach((button) => button.addEventListener("click", () => downloadPdf(button.dataset.downloadUrl, button.dataset.downloadName)));
}

function preview(id) {
  const record = records.find((item) => item.id === id); if (!record) return;
  previewId = id;
  render();
  renderResumePreview(record);
  workspace.openPreview();
  requestAnimationFrame(() => $("resumePreviewPane")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
}

async function load() {
  setStatus("Loading…");
  try {
    records = await loadResumes();
    if (previewId && !records.some((record) => record.id === previewId)) {
      previewId = "";
      workspace.closePreview();
    }
    render();
    if (previewId) renderResumePreview(records.find((record) => record.id === previewId) || null);
    setStatus("Ready");
  } catch (error) { showError(error, "Unable to load resumes."); }
}

function edit(id) {
  const record = records.find((item) => item.id === id); if (!record) return;
  editingId = id; previewId = ""; ["title", "category", "description", "version", "displayOrder", "externalUrl"].forEach((key) => { $(key).value = record[key] ?? ""; });
  setSelectValue($("status"), record.status, "published");
  releaseLocalMediaSelection(pendingPdfSelection); pendingPdfSelection = null;
  uploadedAsset = record.uploadedAsset || null;
  const source = record.sourceType === "upload" && uploadedAsset ? "upload" : "external";
  const sourceControl = form.querySelector(`input[name="sourceType"][value="${source}"]`);
  if (sourceControl) sourceControl.checked = true;
  $("visible").checked = record.visible !== false; $("featured").checked = Boolean(record.featured);
  updateSourcePanels(); renderUploadedAsset(); render(); renderResumePreview(null);
  $("resumeEditorTitle").textContent = "Edit Resume";
  workspace.startEdit();
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearEditorState({ openEditor = false } = {}) {
  void discardTemporaryMediaAssets(uploadedAsset, { reason: "resume-editor-cancelled" });
  releaseLocalMediaSelection(pendingPdfSelection); pendingPdfSelection = null;
  editingId = ""; previewId = ""; uploadedAsset = null; reservedCreateId = ""; form.reset(); form.querySelector('input[name="sourceType"][value="upload"]').checked = true;
  $("visible").checked = true; $("status").value = "published"; $("resumeUploadProgress").hidden = true; renderUploadedAsset(); updateSourcePanels(); setStatus("Ready"); render(); renderResumePreview(null);
  $("resumeEditorTitle").textContent = "New Resume";
  if (openEditor) workspace.startCreate(); else workspace.showIdle();
}
function reset() { clearEditorState(); }
function startCreate() { clearEditorState({ openEditor: true }); requestAnimationFrame(() => form?.scrollIntoView({ behavior: "smooth", block: "nearest" })); }

async function remove(id) {
  if (!await window.LANConfirm({ title: "Delete resume record?", message: "The CMS record and its owned managed upload will be removed permanently.", confirmLabel: "Delete record", danger: true })) return;
  setStatus("Deleting…");
  try { await deleteResume(id); if (previewId === id) previewId = ""; await load(); }
  catch (error) { showError(error, "Unable to delete the resume."); }
}

async function handlePdf(file) {
  try {
    validateMediaFile(file, "pdf", "resume");
    releaseLocalMediaSelection(pendingPdfSelection);
    pendingPdfSelection = stageLocalMediaFile(file, { family: "pdf" });
    if (!pendingPdfSelection) throw new Error("The PDF could not be staged for preview.");
    $("resumeUploadProgress").hidden = false;
    $("resumeProgressBar").style.width = "0%";
    $("resumeProgressText").textContent = "Ready to upload when you save this resume.";
    renderUploadedAsset();
    setStatus("PDF ready. Save the resume to upload it.");
    renderResumePreview(currentDraftRecord());
  } catch (error) {
    releaseLocalMediaSelection(pendingPdfSelection); pendingPdfSelection = null;
    renderUploadedAsset(); $("resumeUploadProgress").hidden = true;
    showError(error, "Unable to prepare the PDF.");
  }
}

form?.addEventListener("change", (event) => { if (event.target.name === "sourceType") { updateSourcePanels(); if (editingId) renderResumePreview(currentDraftRecord()); } });
["title", "category", "version", "externalUrl", "status"].forEach((id) => $(id)?.addEventListener("input", () => { if (editingId) renderResumePreview(currentDraftRecord()); }));
$("browsePdfButton")?.addEventListener("click", () => $("pdfFile").click());
$("replacePdfButton")?.addEventListener("click", () => $("pdfFile").click());
$("removePdfButton")?.addEventListener("click", () => { releaseLocalMediaSelection(pendingPdfSelection); pendingPdfSelection = null; uploadedAsset = null; $("pdfFile").value = ""; $("resumeUploadProgress").hidden = true; renderUploadedAsset(); renderResumePreview(currentDraftRecord()); setStatus("PDF removed from this record. Save to confirm."); });
$("pdfFile")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) handlePdf(file); });
const dropZone = $("resumeDropZone");
["dragenter", "dragover"].forEach((type) => dropZone?.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); }));
["dragleave", "drop"].forEach((type) => dropZone?.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); }));
dropZone?.addEventListener("drop", (event) => { const file = event.dataTransfer?.files?.[0]; if (file) handlePdf(file); });
dropZone?.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("pdfFile").click(); } });
form?.addEventListener("submit", async (event) => {
  event.preventDefault(); if (uploadInProgress || (window.LANValidateForm ? !window.LANValidateForm(form, { title: "Complete Resume" }) : !form.reportValidity())) return;
  const data = Object.fromEntries(new FormData(form)); data.visible = $("visible").checked; data.featured = $("featured").checked; data.displayOrder = Number(data.displayOrder || 0); data.uploadedAsset = selectedSource() === "upload" ? uploadedAsset : null; data.externalUrl = selectedSource() === "external" ? $("externalUrl").value.trim() : "";
  setStatus("Saving…"); $("saveResumeButton").disabled = true;
  try {
    if (selectedSource() === "upload" && pendingPdfSelection?.file) {
      setUploading(true);
      const ownerId = editingId || reservedCreateId || (reservedCreateId = reserveResumeId());
      const file = pendingPdfSelection.file;
      const nextAsset = await uploadMedia(file, { kind: "pdf", module: "resume", family: "document", folder: "resume", resourceType: "raw", access: "public-preview", context: { ownerType: "resume", ownerId, fieldId: "pdf", pageName: "Resume", recordTitle: String(data.title || $("title")?.value || "Resume").trim() }, onProgress(progress) { $("resumeProgressBar").style.width = `${progress}%`; $("resumeProgressText").textContent = `Uploading ${file.name}: ${progress}%`; } });
      const deliveryUrl = safePdfUrl(resolveAssetUrl(nextAsset, "pdf-preview"));
      if (!deliveryUrl) throw new Error("Storage provider did not return a resolvable persistent PDF asset.");
      data.uploadedAsset = { ...nextAsset, originalFilename: nextAsset.originalFilename || file.name, displayName: nextAsset.displayName || file.name, format: nextAsset.format || "pdf", resourceType: nextAsset.resourceType || "raw" };
    }
    if (editingId) await updateResume(editingId, data); else await createResume(data, reservedCreateId || (reservedCreateId = reserveResumeId()));
    releaseLocalMediaSelection(pendingPdfSelection); pendingPdfSelection = null;
    reset(); await load(); window.LANNotice?.({ title: "Resume saved", message: "The resume record was saved successfully.", tone: "success" }); }
  catch (error) { showError(error, "Unable to save the resume."); }
  finally { setUploading(false); $("saveResumeButton").disabled = false; }
});
$("cancelButton")?.addEventListener("click", reset);
workspaceRoot?.addEventListener("lan:recordcreate", startCreate);
workspaceRoot?.addEventListener("lan:recordpreviewclose", closeResumePreview);
function closeResumePreview() { previewId = ""; render(); renderResumePreview(null); workspace.closePreview(); }
updateSourcePanels(); renderResumePreview(null); workspace.showIdle(); await load();
