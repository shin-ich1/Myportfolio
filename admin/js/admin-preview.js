import { adminMediaImageLayersMarkup } from "./admin-media-frame.js";
import { classifyPortfolioFile } from "../../file-type-registry.js";
import { resolveAssetUrl } from "../../asset-resolver.js";

export const ADMIN_PREVIEW_BLOCK_TYPES = Object.freeze({
  IMAGE: "image",
  GALLERY: "gallery",
  COMPARISON: "comparison",
  VIDEO: "video",
  AUDIO: "audio",
  DOCUMENT: "document",
  IDENTITY: "identity",
  OVERVIEW: "overview",
  FACTS: "facts",
  CHIPS: "chips",
  FILES: "files",
  ACTIONS: "actions",
  SYSTEM: "system"
});

const clean = (value = "") => String(value ?? "").trim();
const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[character]));
const safeUrl = (value = "") => {
  const url = clean(value);
  if (!url) return "";
  if (/^(https?:|blob:|data:image\/|data:video\/|data:audio\/|\/|\.\.?\/|#)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^\\/.test(url)) return "";
  return `/${url.replace(/^\/+/, "")}`;
};

export function resolveAdminPreviewMediaUrl(value = null) {
  return safeUrl(resolveAssetUrl(value, "admin-read"));
}


export function resolveAdminPreviewFileDescriptor(item = null) {
  const source = typeof item === "string" ? { href: item, label: item } : (item && typeof item === "object" ? item : {});
  const href = safeUrl(resolveAssetUrl(source, "download"));
  const label = clean(source.label || source.name || source.originalFilename || source.displayName || source.filename || "File");
  const explicitName = clean(source.name || source.originalFilename || source.displayName || source.filename);
  const hrefName = clean(href).split(/[?#]/)[0].split("/").filter(Boolean).at(-1) || "";
  const classificationName = /\.[a-z0-9]+$/i.test(explicitName) ? explicitName : (/\.[a-z0-9]+$/i.test(hrefName) ? hrefName : explicitName || label);
  const classified = classifyPortfolioFile({
    ...source,
    name: classificationName,
    url: href || source.url || source.href || ""
  });
  return {
    ...classified,
    href,
    label: label || classified.name || "File",
    kindLabel: classified.label || "File",
    bytes: Number(source.bytes || source.size || 0) || 0,
    assetId: clean(source.assetId || source.asset_id),
    publicId: clean(source.publicId || source.public_id),
    resourceType: clean(source.resourceType || source.resource_type),
    deliveryType: clean(source.deliveryType || source.delivery_type || source.type),
    mimeType: clean(source.mimeType || source.mime || source.contentType || classified.mime)
  };
}
const toArray = (value) => Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
const hasText = (value) => clean(value).length > 0;
const DATEISH_LABEL = /(?:^|\b)(date|year|month|period|start|end|from|to|duration)(?:\b|$)/i;
const DATE_SEMANTIC_ROLES = new Set(['start-date','end-date']);
const isDatePreviewFact = (item = {}) => DATE_SEMANTIC_ROLES.has(clean(item.semanticRole || item.role)) || DATEISH_LABEL.test(clean(item.label));

export function resolveAdminPreviewCapabilityLayout({ capabilityHeight = 0, primaryHeight = 0, availableWidth = 0 } = {}) {
  const capability = Math.max(0, Number(capabilityHeight) || 0);
  const primary = Math.max(0, Number(primaryHeight) || 0);
  const width = Math.max(0, Number(availableWidth) || 0);
  if (!capability) return "none";
  if (width && width < 760) return "band";
  if (!primary) return "rail";
  const verticalAllowance = Math.max(72, primary * 0.18);
  return capability <= primary + verticalAllowance ? "rail" : "band";
}

export function inferAdminPreviewProfile(blocks = []) {
  const normalized = toArray(blocks).filter(Boolean);
  const types = new Set(normalized.map((block) => clean(block.type)));
  const has = (type) => types.has(type);
  const identities = normalized.filter((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY);
  const semanticRoles = new Set(identities.map((block) => clean(block.role || block.semanticRole)).filter(Boolean));
  if (semanticRoles.has("credential")) return "credential";
  if (semanticRoles.has("work") || semanticRoles.has("portfolio")) return "portfolio";
  if (has(ADMIN_PREVIEW_BLOCK_TYPES.COMPARISON)) return "comparison";
  const richWork = identities.length > 0
    && has(ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW)
    && has(ADMIN_PREVIEW_BLOCK_TYPES.FACTS)
    && has(ADMIN_PREVIEW_BLOCK_TYPES.ACTIONS);
  if (richWork) return "portfolio";
  if (has(ADMIN_PREVIEW_BLOCK_TYPES.GALLERY)) return "gallery";
  if (has(ADMIN_PREVIEW_BLOCK_TYPES.DOCUMENT)) return "document";
  if (has(ADMIN_PREVIEW_BLOCK_TYPES.VIDEO) || has(ADMIN_PREVIEW_BLOCK_TYPES.AUDIO)) return "media";
  if (has(ADMIN_PREVIEW_BLOCK_TYPES.IMAGE)) return "media";
  const facts = normalized.filter((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.FACTS).flatMap((block) => toArray(block.items));
  const dateFacts = facts.filter((item) => isDatePreviewFact(item));
  if (dateFacts.length >= 2) return "chronology";
  if (has(ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW)) return "editorial";
  return "structured";
}

const PREVIEW_PROFILE_ORDER = Object.freeze({
  portfolio: ["image", "identity", "overview", "facts", "chips", "gallery", "video", "audio", "document", "files", "actions"],
  editorial: ["identity", "facts", "overview", "chips", "image", "gallery", "video", "audio", "document", "files", "actions"],
  chronology: ["identity", "facts", "overview", "chips", "image", "gallery", "video", "audio", "document", "files", "actions"],
  media: ["image", "video", "audio", "identity", "overview", "facts", "chips", "gallery", "document", "files", "actions"],
  gallery: ["gallery", "identity", "overview", "facts", "chips", "image", "video", "audio", "document", "files", "actions"],
  comparison: ["comparison", "identity", "overview", "facts", "chips", "gallery", "image", "video", "audio", "document", "files", "actions"],
  document: ["identity", "document", "overview", "facts", "chips", "files", "actions", "image", "gallery", "video", "audio"],
  credential: ["image", "document", "identity", "facts", "overview", "chips", "actions", "files", "gallery", "video", "audio"],
  structured: ["identity", "overview", "facts", "chips", "image", "gallery", "comparison", "video", "audio", "document", "files", "actions"]
});

function previewBlockRole(block = {}) {
  return clean(block.semanticRole || block.role);
}

function isCoverPreviewBlock(block = {}) {
  return block?.type === ADMIN_PREVIEW_BLOCK_TYPES.IMAGE && previewBlockRole(block) === "cover";
}

export function composeAdminPreviewBlocks(blocks = [], { profile = "", system = [] } = {}) {
  const source = toArray(blocks).filter(Boolean).filter((block) => block.type !== ADMIN_PREVIEW_BLOCK_TYPES.SYSTEM);
  const resolvedProfile = clean(profile) || inferAdminPreviewProfile(source);
  const order = PREVIEW_PROFILE_ORDER[resolvedProfile] || PREVIEW_PROFILE_ORDER.structured;
  const rank = new Map(order.map((type, index) => [type, index]));
  const composed = source
    // Cover is a structural presentation slot. Profile-specific ordering can
    // arrange supporting media, but it cannot promote Gallery/Video/etc. over
    // an explicit or automatic Cover.
    .map((block, index) => ({
      block,
      index,
      rank: isCoverPreviewBlock(block) ? -1 : (rank.has(block.type) ? rank.get(block.type) : order.length)
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ block }) => block);
  const systemItems = toArray(system).filter(Boolean);
  if (systemItems.length) composed.push({ type: ADMIN_PREVIEW_BLOCK_TYPES.SYSTEM, items: systemItems });
  return composed;
}

const PROFILE_SPOTLIGHT_PRIORITY = Object.freeze({
  portfolio: [ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, ADMIN_PREVIEW_BLOCK_TYPES.GALLERY, ADMIN_PREVIEW_BLOCK_TYPES.VIDEO, ADMIN_PREVIEW_BLOCK_TYPES.COMPARISON],
  media: [ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, ADMIN_PREVIEW_BLOCK_TYPES.VIDEO, ADMIN_PREVIEW_BLOCK_TYPES.AUDIO],
  gallery: [ADMIN_PREVIEW_BLOCK_TYPES.GALLERY, ADMIN_PREVIEW_BLOCK_TYPES.IMAGE],
  comparison: [ADMIN_PREVIEW_BLOCK_TYPES.COMPARISON, ADMIN_PREVIEW_BLOCK_TYPES.IMAGE],
  document: [ADMIN_PREVIEW_BLOCK_TYPES.DOCUMENT],
  credential: [ADMIN_PREVIEW_BLOCK_TYPES.IMAGE, ADMIN_PREVIEW_BLOCK_TYPES.DOCUMENT]
});

function firstBlockByPriority(blocks, priority = []) {
  for (const type of priority) {
    const found = blocks.find((block) => block.type === type);
    if (found) return found;
  }
  return null;
}

export function composeAdminPreviewLayout(blocks = [], { profile = "", system = [] } = {}) {
  const composed = composeAdminPreviewBlocks(blocks, { profile, system });
  const resolvedProfile = clean(profile) || inferAdminPreviewProfile(toArray(blocks).filter(Boolean));
  const rawContent = composed.filter((block) => block.type !== ADMIN_PREVIEW_BLOCK_TYPES.SYSTEM);
  const identitySource = rawContent.find((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY);
  const identitySemantics = new Set([
    identitySource?.eyebrow,
    identitySource?.subtitle,
    ...toArray(identitySource?.chips)
  ].map((value) => clean(value).toLocaleLowerCase()).filter(Boolean));
  const content = rawContent.map((block) => {
    if (block.type !== ADMIN_PREVIEW_BLOCK_TYPES.FACTS || !identitySemantics.size) return block;
    const items = toArray(block.items).filter((item) => {
      const value = clean(item?.value).toLocaleLowerCase();
      return !value || !identitySemantics.has(value);
    });
    return { ...block, items };
  }).filter((block) => block.type !== ADMIN_PREVIEW_BLOCK_TYPES.FACTS || toArray(block.items).some((item) => hasText(item?.value)));
  const footer = composed.filter((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.SYSTEM);
  const identityRole = clean(identitySource?.role || identitySource?.semanticRole);
  const variant = identityRole === "creative-work" ? "creative-work" : "";
  const regions = { spotlight: [], identity: [], context: [], main: [], aside: [], capabilities: [], supporting: [], footer };
  const assigned = new Set();

  const identity = content.find((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY);
  if (identity) { regions.identity.push(identity); assigned.add(identity); }

  const coverSpotlight = content.find((block) => isCoverPreviewBlock(block)) || null;
  const spotlight = coverSpotlight || firstBlockByPriority(content, PROFILE_SPOTLIGHT_PRIORITY[resolvedProfile] || []);
  if (spotlight) { regions.spotlight.push(spotlight); assigned.add(spotlight); }

  const overviewBlocks = content.filter((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW);
  overviewBlocks.forEach((block) => { regions.main.push(block); assigned.add(block); });

  const factBlocks = content.filter((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.FACTS);
  const contextFirst = resolvedProfile === "editorial" || resolvedProfile === "chronology" || resolvedProfile === "structured" || resolvedProfile === "credential";
  factBlocks.forEach((block) => {
    regions[contextFirst ? "context" : "aside"].push(block);
    assigned.add(block);
  });

  content.filter((block) => block.type === ADMIN_PREVIEW_BLOCK_TYPES.CHIPS && clean(block.role || block.semanticRole) === "capabilities").forEach((block) => {
    regions.capabilities.push(block);
    assigned.add(block);
  });

  content.forEach((block) => {
    if (assigned.has(block)) return;
    if (block.type === ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY) return;
    regions.supporting.push(block);
  });

  return {
    profile: resolvedProfile,
    variant,
    regions,
    hasSpotlight: regions.spotlight.length > 0,
    hasAside: regions.aside.length > 0,
    hasContext: regions.context.length > 0
  };
}

function narrativeHtml(value = "") {
  const text = clean(value);
  if (!text) return "";
  return text.split(/\n\s*\n+/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

function sectionHeading(title = "", eyebrow = "") {
  if (!hasText(title) && !hasText(eyebrow)) return "";
  return `<header class="lan-preview-section-heading">${eyebrow ? `<small>${escapeHtml(eyebrow)}</small>` : ""}${title ? `<h3>${escapeHtml(title)}</h3>` : ""}</header>`;
}

function renderImage(block = {}) {
  const src = resolveAdminPreviewMediaUrl(block.src);
  const fallbackSrc = resolveAdminPreviewMediaUrl(block.fallbackSrc);
  const coverSlot = clean(block.semanticRole || block.role) === "cover";
  const fallbackOnly = !src && (block.fallback === true || coverSlot);
  if (!src && !fallbackOnly) return "";
  const media = adminMediaImageLayersMarkup({
    src,
    fallbackSrc,
    alt: block.alt || "Preview image",
    title: block.title || "Preview image",
    context: coverSlot ? "Automatic cover" : (block.caption || "Preview media"),
    role: coverSlot ? "cover" : "preview",
    imageClass: "lan-admin-media-fit-image",
    loading: "eager",
    fetchPriority: "high"
  });
  return `<section class="lan-preview-block lan-preview-hero" data-preview-block="image" data-preview-media-state="${fallbackOnly ? "fallback" : "ready"}"${coverSlot ? ' data-preview-role="cover"' : ''}><figure class="lan-admin-media-frame lan-admin-media-frame--preview">${media}${!coverSlot && block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure></section>`;
}

function renderGallery(block = {}) {
  const items = toArray(block.items).map((item) => typeof item === "string" ? { src: item } : item).map((item) => ({ ...item, src: resolveAdminPreviewMediaUrl(item?.src || item) })).filter((item) => item.src);
  if (!items.length) return "";
  const visible = items.slice(0, Math.max(1, Number(block.limit) || 8));
  const count = visible.length;
  return `<section class="lan-preview-block lan-preview-gallery-block" data-preview-block="gallery">${sectionHeading(block.title || "Gallery", block.eyebrow || "Media")}<div class="lan-preview-gallery" data-preview-gallery data-count="${count}">${visible.map((item, index) => {
    const media = adminMediaImageLayersMarkup({
      src: item.src,
      alt: item.alt || `Gallery image ${index + 1}`,
      title: block.title || "Gallery",
      context: `Gallery image ${index + 1}`,
      role: "preview",
      imageClass: "lan-admin-media-fit-image",
      loading: "eager",
      fetchPriority: index === 0 ? "high" : "auto"
    });
    return `<button type="button" class="lan-preview-gallery__item lan-admin-media-frame lan-admin-media-frame--preview" data-preview-gallery-index="${index}" aria-label="Open gallery image ${index + 1} of ${items.length}">${media}${index === visible.length - 1 && items.length > visible.length ? `<span>+${items.length - visible.length}</span>` : ""}</button>`;
  }).join("")}</div></section>`;
}

function renderComparison(block = {}) {
  const before = safeUrl(block.before?.src || block.before);
  const after = safeUrl(block.after?.src || block.after);
  if (!before && !after) return "";
  if (!before || !after) return renderImage({ src: after || before, alt: block.alt || "Preview image", caption: block.caption });
  return `<section class="lan-preview-block lan-preview-comparison-block" data-preview-block="comparison">${sectionHeading(block.title || "Before & After", block.eyebrow || "Comparison")}<div class="lan-preview-comparison" data-preview-comparison style="--preview-position:${Number(block.position) || 50}%"><img class="lan-preview-comparison__after" src="${escapeHtml(after)}" alt="${escapeHtml(block.after?.alt || "After")}" loading="eager" decoding="async"><div class="lan-preview-comparison__before-wrap" data-preview-comparison-before><img class="lan-preview-comparison__before" src="${escapeHtml(before)}" alt="${escapeHtml(block.before?.alt || "Before")}" loading="eager" decoding="async"></div><span class="lan-preview-comparison__label is-before">${escapeHtml(block.beforeLabel || "BEFORE")}</span><span class="lan-preview-comparison__label is-after">${escapeHtml(block.afterLabel || "AFTER")}</span><button class="lan-preview-comparison__slider" type="button" role="slider" aria-label="Before and after comparison position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(block.position) || 50}" data-preview-comparison-slider><span aria-hidden="true">↔</span></button></div></section>`;
}

function renderVideo(block = {}) {
  const src = safeUrl(block.src);
  const embedUrl = safeUrl(block.embedUrl);
  if (!src && !embedUrl) return "";
  const media = embedUrl && block.embed !== false
    ? `<iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(block.title || "Video preview")}" loading="lazy" allowfullscreen></iframe>`
    : `<video controls preload="metadata"${block.poster ? ` poster="${escapeHtml(safeUrl(block.poster))}"` : ""} src="${escapeHtml(src || embedUrl)}"></video>`;
  return `<section class="lan-preview-block lan-preview-media-block" data-preview-block="video">${sectionHeading(block.title || "Video", block.eyebrow || "Media")}<div class="lan-preview-video">${media}</div></section>`;
}

function renderAudio(block = {}) {
  const src = safeUrl(block.src);
  if (!src) return "";
  return `<section class="lan-preview-block lan-preview-audio-block" data-preview-block="audio">${sectionHeading(block.title || "Audio", block.eyebrow || "Media")}<audio controls preload="metadata" src="${escapeHtml(src)}"></audio></section>`;
}

function formatPreviewFileSize(bytes = 0) {
  const size = Number(bytes) || 0;
  if (!(size > 0)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function previewFileReference(descriptor = {}) {
  return JSON.stringify({
    href: descriptor.href || "",
    label: descriptor.label || descriptor.name || "File",
    name: descriptor.name || descriptor.label || "File",
    mimeType: descriptor.mimeType || descriptor.mime || "",
    fileFamily: descriptor.family || "generic",
    assetId: descriptor.assetId || "",
    publicId: descriptor.publicId || "",
    resourceType: descriptor.resourceType || "",
    deliveryType: descriptor.deliveryType || ""
  });
}

function renderPreviewFileCard(item = null, { documentStage = false } = {}) {
  const descriptor = resolveAdminPreviewFileDescriptor(item);
  if (!descriptor.href && !descriptor.label) return "";
  const sizeLabel = formatPreviewFileSize(descriptor.bytes);
  const detail = [descriptor.kindLabel || descriptor.family || "File", sizeLabel].filter(Boolean).join(" · ");
  const reference = escapeHtml(previewFileReference(descriptor));
  const managed = Boolean(descriptor.assetId || descriptor.publicId || /^(?:https?:\/\/)?res\.cloudinary\.com\//i.test(descriptor.href));
  const pdfAction = descriptor.family === "pdf" && descriptor.href
    ? `<button type="button" class="lan-preview-file-card__action is-primary" data-preview-pdf-open="true" data-preview-pdf-ref="${reference}">View PDF</button>`
    : "";
  const openAction = descriptor.href
    ? managed
      ? `<button type="button" class="lan-preview-file-card__action" data-preview-file-open="true" data-preview-file-ref="${reference}">Open file <span aria-hidden="true">↗</span></button>`
      : `<a class="lan-preview-file-card__action" href="${escapeHtml(descriptor.href)}" target="_blank" rel="noopener noreferrer">Open in new tab <span aria-hidden="true">↗</span></a>`
    : "";
  const stage = documentStage && descriptor.family === "pdf" && descriptor.href
    ? `<div class="lan-preview-document" data-preview-pdf-stage="true" data-preview-pdf-fragment="page=1&zoom=page-width" data-preview-pdf-ref="${reference}"><div class="lan-preview-pdf-state"><strong>Loading PDF preview…</strong><small>The original file remains available below.</small></div></div>`
    : "";
  return `${stage}<article class="lan-preview-file-card" data-preview-file-family="${escapeHtml(descriptor.family || "generic")}"><span class="lan-preview-file-card__type" aria-hidden="true">${descriptor.family === "pdf" ? "PDF" : "FILE"}</span><span class="lan-preview-file-card__copy"><strong>${escapeHtml(descriptor.label || descriptor.name || "File")}</strong><small>${escapeHtml(detail)}</small></span><span class="lan-preview-file-card__actions">${pdfAction}${openAction}</span></article>`;
}

function renderDocument(block = {}) {
  const descriptor = resolveAdminPreviewFileDescriptor({
    ...(block.file && typeof block.file === "object" ? block.file : {}),
    href: block.src || block.href || block.url,
    label: block.title || block.label || block.file?.name || block.file?.originalFilename || "Document",
    fileFamily: block.fileFamily || block.file?.fileFamily || (clean(block.mimeType || block.file?.mimeType) === "application/pdf" ? "pdf" : "")
  });
  if (!descriptor.href) return "";
  return `<section class="lan-preview-block lan-preview-document-block" data-preview-block="document">${sectionHeading(block.title || "Document", block.eyebrow || "File")}${renderPreviewFileCard(descriptor, { documentStage: descriptor.family === "pdf" })}</section>`;
}

function renderIdentity(block = {}) {
  const chips = toArray(block.chips).map(clean).filter(Boolean);
  const logo = resolveAdminPreviewMediaUrl(block.logo);
  if (!logo && !hasText(block.title) && !hasText(block.subtitle) && !chips.length) return "";
  return `<section class="lan-preview-block lan-preview-identity" data-preview-block="identity">${logo ? `<div class="lan-preview-identity__logo"><img src="${escapeHtml(logo)}" alt="" loading="lazy" decoding="async"></div>` : ""}<div class="lan-preview-identity__copy">${block.eyebrow ? `<small>${escapeHtml(block.eyebrow)}</small>` : ""}${block.title ? `<h3>${escapeHtml(block.title)}</h3>` : ""}${block.subtitle ? `<p>${escapeHtml(block.subtitle)}</p>` : ""}${chips.length ? `<div class="lan-preview-inline-chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>` : ""}</div></section>`;
}

function renderOverview(block = {}) {
  if (!hasText(block.lead) && !hasText(block.body)) return "";
  return `<section class="lan-preview-block lan-preview-overview" data-preview-block="overview">${sectionHeading(block.title || "Overview", block.eyebrow || "")}${block.lead ? `<p class="lan-preview-overview__lead">${escapeHtml(block.lead)}</p>` : ""}${block.body ? `<div class="lan-preview-overview__body">${narrativeHtml(block.body)}</div>` : ""}</section>`;
}

function renderFacts(block = {}) {
  const items = toArray(block.items).filter((item) => item && hasText(item.value));
  if (!items.length) return "";
  return `<section class="lan-preview-block lan-preview-facts-block" data-preview-block="facts">${sectionHeading(block.title || "Key information", block.eyebrow || "")}<dl class="lan-preview-facts">${items.map((item) => { const label = item.label || "Detail"; const kind = isDatePreviewFact(item) ? "date" : "detail"; return `<div data-preview-fact-kind="${kind}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`; }).join("")}</dl></section>`;
}

function normalizePreviewChip(item = null) {
  if (item === null || item === undefined) return null;
  if (typeof item !== "object") {
    const label = clean(item);
    return label ? { label, category: "", icon: "", recordType: "" } : null;
  }
  const label = clean(item.label || item.name || item.title || item.value);
  if (!label) return null;
  return {
    label,
    category: clean(item.category || item.group || item.kind),
    icon: clean(item.icon || item.logo || item.iconUrl),
    recordType: clean(item.recordType || item.type || item.kind).toLowerCase()
  };
}

function previewCapabilityIconMarkup(item = {}) {
  if (typeof window !== "undefined" && typeof window.LANSkillIconMarkup === "function") {
    return window.LANSkillIconMarkup(item.label, item.category, item.icon, item.recordType);
  }
  if (item.icon && !/^(?:https?:|data:image\/|\.?\.?\/|\/)/i.test(item.icon)) {
    return `<span class="skill-custom-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>`;
  }
  return "";
}

function renderChips(block = {}) {
  const items = toArray(block.items).map(normalizePreviewChip).filter(Boolean);
  if (!items.length) return "";
  const capabilities = clean(block.role || block.semanticRole) === "capabilities";
  const chips = items.map((item) => {
    if (!capabilities) return `<span>${escapeHtml(item.label)}</span>`;
    const icon = previewCapabilityIconMarkup(item);
    return `<span class="lan-preview-capability-chip" data-capability-type="${escapeHtml(item.recordType || "capability")}">${icon ? `<span class="lan-preview-capability-chip__icon">${icon}</span>` : ""}<span class="lan-preview-capability-chip__label">${escapeHtml(item.label)}</span></span>`;
  }).join("");
  return `<section class="lan-preview-block lan-preview-chips-block${capabilities ? " is-capabilities" : ""}" data-preview-block="chips">${sectionHeading(block.title || "Tags", block.eyebrow || "")}<div class="lan-preview-chips">${chips}</div></section>`;
}

function renderFiles(block = {}) {
  const items = toArray(block.items).filter(Boolean).map(resolveAdminPreviewFileDescriptor);
  if (!items.length) return "";
  return `<section class="lan-preview-block lan-preview-files-block" data-preview-block="files">${sectionHeading(block.title || "Files", block.eyebrow || "")}<div class="lan-preview-files">${items.map((item) => renderPreviewFileCard(item)).join("")}</div></section>`;
}

function renderActions(block = {}) {
  const items = toArray(block.items).filter((item) => item && hasText(item.label));
  if (!items.length) return "";
  return `<section class="lan-preview-block lan-preview-actions" data-preview-block="actions">${items.map((item) => { const href = safeUrl(item.href || item.url); const className = item.primary ? "is-primary" : ""; return href ? `<a class="${className}" href="${escapeHtml(href)}" ${item.sameWindow ? "" : 'target="_blank" rel="noopener noreferrer"'}>${escapeHtml(item.label)}</a>` : `<button class="${className}" type="button" ${item.disabled ? "disabled" : ""}>${escapeHtml(item.label)}</button>`; }).join("")}</section>`;
}

function renderSystem(block = {}) {
  const items = toArray(block.items).filter((item) => item && hasText(item.value));
  if (!items.length) return "";
  return `<details class="lan-preview-system" data-preview-block="system"><summary>System info</summary><div class="lan-preview-system__items">${items.map((item) => `<span>${item.label ? `<b>${escapeHtml(item.label)}</b>` : ""}<em>${escapeHtml(item.value)}</em></span>`).join("")}</div></details>`;
}

function renderBlock(block = {}) {
  switch (block.type) {
    case ADMIN_PREVIEW_BLOCK_TYPES.IMAGE: return renderImage(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.GALLERY: return renderGallery(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.COMPARISON: return renderComparison(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.VIDEO: return renderVideo(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.AUDIO: return renderAudio(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.DOCUMENT: return renderDocument(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY: return renderIdentity(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW: return renderOverview(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.FACTS: return renderFacts(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.CHIPS: return renderChips(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.FILES: return renderFiles(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.ACTIONS: return renderActions(block);
    case ADMIN_PREVIEW_BLOCK_TYPES.SYSTEM: return renderSystem(block);
    default: return "";
  }
}

function renderPreviewRegion(name, blocks = []) {
  const html = toArray(blocks).map(renderBlock).filter(Boolean).join("");
  if (!html) return "";
  return `<div class="lan-preview-region lan-preview-region--${escapeHtml(name)}" data-preview-region="${escapeHtml(name)}">${html}</div>`;
}

function previewBlockOccupancyUnits(block = {}) {
  if (!block) return 0;
  switch (block.type) {
    case ADMIN_PREVIEW_BLOCK_TYPES.IDENTITY: {
      const text = [block.title, block.subtitle, block.eyebrow].map(clean).join(" ");
      return 1.7 + Math.min(1.6, text.length / 90) + Math.min(1.4, toArray(block.chips).length * 0.22);
    }
    case ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW: {
      const text = [block.lead, block.body].map(clean).join(" ");
      return 1.7 + Math.min(4.5, text.length / 170);
    }
    case ADMIN_PREVIEW_BLOCK_TYPES.FACTS:
      return 0.8 + Math.min(5.2, toArray(block.items).filter((item) => item && hasText(item.value)).length * 0.72);
    case ADMIN_PREVIEW_BLOCK_TYPES.CHIPS:
      return 0.65 + Math.min(8, toArray(block.items).filter(Boolean).length * 0.55);
    case ADMIN_PREVIEW_BLOCK_TYPES.FILES:
    case ADMIN_PREVIEW_BLOCK_TYPES.ACTIONS:
      return 0.7 + Math.min(3, toArray(block.items).filter(Boolean).length * 0.5);
    default:
      return 0.7;
  }
}

function previewRegionOccupancyUnits(blocks = []) {
  return toArray(blocks).reduce((total, block) => total + previewBlockOccupancyUnits(block), 0);
}

export function resolveAdminPreviewContentOccupancy(layout = {}) {
  const regions = layout.regions || {};
  const primary = previewRegionOccupancyUnits(regions.identity) + previewRegionOccupancyUnits(regions.main);
  const secondary = previewRegionOccupancyUnits(regions.context) + previewRegionOccupancyUnits(regions.aside) + previewRegionOccupancyUnits(regions.capabilities);
  if (!primary && !secondary) return "minimal";
  if (!secondary) return "wide";
  if (!primary) return "secondary-heavy";
  if (secondary >= 5.5 && secondary > primary * 1.35) return "secondary-heavy";
  return "balanced";
}

export function resolveAdminPreviewSurfaceDensity(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = toArray(regions.spotlight).length;
  const main = previewRegionOccupancyUnits(regions.main);
  const capabilities = previewRegionOccupancyUnits(regions.capabilities);
  const supporting = previewRegionOccupancyUnits(regions.supporting);
  const context = previewRegionOccupancyUnits(regions.context) + previewRegionOccupancyUnits(regions.aside);
  const identity = previewRegionOccupancyUnits(regions.identity);
  if (!spotlight && !main && !capabilities && !supporting && identity > 0 && context <= 2.8) return "sparse";
  if (spotlight || main + capabilities + supporting + context >= 8) return "rich";
  return "standard";
}

function compositionShell(profile = "structured", layout = {}, body = "") {
  const occupancy = resolveAdminPreviewContentOccupancy(layout);
  const density = resolveAdminPreviewSurfaceDensity(layout);
  return `<div class="lan-preview-composition" data-preview-composition="${escapeHtml(profile)}" data-preview-variant="${escapeHtml(layout.variant || "")}" data-preview-occupancy="${escapeHtml(occupancy)}" data-preview-density="${escapeHtml(density)}" data-has-spotlight="${layout.hasSpotlight ? "true" : "false"}" data-has-aside="${layout.hasAside ? "true" : "false"}">${body}</div>`;
}

function renderPortfolioComposition(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const identity = renderPreviewRegion("identity", regions.identity);
  const overview = toArray(regions.main)[0] || null;
  const extraMain = toArray(regions.main).slice(1);
  const capabilities = renderPreviewRegion("capabilities", regions.capabilities);
  const aside = renderPreviewRegion("aside", regions.aside);
  const lead = overview?.lead
    ? `<section class="lan-preview-portfolio-lead">${sectionHeading(overview.title || "Overview", overview.eyebrow || "")}<p>${escapeHtml(overview.lead)}</p></section>`
    : "";
  const rail = capabilities || aside;
  const primary = identity || lead ? `<div class="lan-preview-portfolio-primary">${identity}${lead}</div>` : "";
  const railHtml = rail ? `<aside class="lan-preview-portfolio-capabilities">${capabilities}${capabilities && aside ? `<div class="lan-preview-portfolio-secondary">${aside}</div>` : aside}</aside>` : "";
  const masthead = primary || railHtml
    ? `<div class="lan-preview-portfolio-masthead" data-has-lead="${lead ? "true" : "false"}" data-has-aside="${rail ? "true" : "false"}" data-capability-layout="${capabilities ? "auto" : "none"}">${primary}${railHtml}</div>`
    : "";
  const narrativeBody = overview?.body ? narrativeHtml(overview.body) : "";
  const narrativeHeading = overview?.body && !overview?.lead ? sectionHeading(overview.title || "Overview", overview.eyebrow || "") : "";
  const narrative = narrativeBody ? `<section class="lan-preview-portfolio-narrative">${narrativeHeading}<div class="lan-preview-overview__body">${narrativeBody}</div></section>` : "";
  const moreNarrative = extraMain.length ? `<div class="lan-preview-portfolio-more">${extraMain.map(renderBlock).filter(Boolean).join("")}</div>` : "";
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  return compositionShell("portfolio", layout, `${spotlight}${masthead}${narrative}${moreNarrative}${supporting}${footer}`);
}

const semanticToken = (value = "") => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const EDITORIAL_SUBTITLE_LABEL = /^(?:subtitle|subheading|deck|dek|standfirst)$/i;
const EDITORIAL_BYLINE_LABEL = /(?:author|writer|byline|organization|organisation)/i;
const EDITORIAL_PUBLICATION_LABEL = /(?:publish|publication|released?|posted?).*(?:date|on)?|^(?:date published|published date)$/i;
const EDITORIAL_READING_LABEL = /(?:read(?:ing)?\s*time|duration|length)/i;

function editorialFactKind(item = {}) {
  const role = semanticToken(item.semanticRole || item.role);
  if (["subtitle", "byline", "publication-date", "reading-time"].includes(role)) return role;
  const label = clean(item.label);
  if (EDITORIAL_SUBTITLE_LABEL.test(label)) return "subtitle";
  if (EDITORIAL_BYLINE_LABEL.test(label)) return "byline";
  if (EDITORIAL_PUBLICATION_LABEL.test(label)) return "publication-date";
  if (EDITORIAL_READING_LABEL.test(label)) return "reading-time";
  return "context";
}

function editorialFactParts(blocks = []) {
  const items = toArray(blocks)
    .filter((block) => block?.type === ADMIN_PREVIEW_BLOCK_TYPES.FACTS)
    .flatMap((block) => toArray(block.items))
    .filter((item) => item && hasText(item.value));
  const subtitle = items.find((item) => editorialFactKind(item) === "subtitle") || null;
  const metaItems = items.filter((item) => item !== subtitle);
  return { subtitle, metaItems };
}

function renderEditorialMeta(items = []) {
  const values = toArray(items).filter((item) => item && hasText(item.value));
  if (!values.length) return "";
  return `<div class="lan-preview-editorial-meta">${values.map((item) => `<span data-editorial-meta="${escapeHtml(editorialFactKind(item))}"><small>${escapeHtml(item.label || "Detail")}</small><strong>${escapeHtml(item.value)}</strong></span>`).join("")}</div>`;
}

function renderEditorialArticle(blocks = []) {
  const sections = toArray(blocks).filter(Boolean).map((block, index) => {
    if (block.type !== ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW) return renderBlock(block);
    const title = clean(block.title);
    const showHeading = title && !/^overview$/i.test(title);
    const heading = showHeading ? sectionHeading(title, block.eyebrow || "") : "";
    const lead = block.lead ? `<p class="lan-preview-editorial-lead">${escapeHtml(block.lead)}</p>` : "";
    const body = block.body ? `<div class="lan-preview-editorial-prose">${narrativeHtml(block.body)}</div>` : "";
    if (!heading && !lead && !body) return "";
    return `<section class="lan-preview-editorial-section" data-editorial-section="${index + 1}">${heading}${lead}${body}</section>`;
  }).filter(Boolean).join("");
  return sections ? `<article class="lan-preview-editorial-article">${sections}</article>` : "";
}

function renderEditorialComposition(layout = {}) {
  const regions = layout.regions || {};
  const identityBlock = toArray(regions.identity)[0] || null;
  const identity = renderPreviewRegion("identity", regions.identity);
  const { subtitle, metaItems } = editorialFactParts(regions.context);
  const dek = !hasText(identityBlock?.subtitle) && subtitle
    ? `<p class="lan-preview-editorial-dek">${escapeHtml(subtitle.value)}</p>`
    : "";
  const meta = renderEditorialMeta(metaItems);
  const article = renderEditorialArticle(regions.main);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  const masthead = identity || dek || meta ? `<header class="lan-preview-editorial-masthead">${identity}${dek}${meta}</header>` : "";
  const taxonomy = supporting ? `<footer class="lan-preview-editorial-taxonomy">${supporting}</footer>` : "";
  return compositionShell("editorial", layout, `${masthead}${article}${taxonomy}${footer}`);
}

function chronologyFactParts(blocks = []) {
  const factBlocks = toArray(blocks).filter((block) => block?.type === ADMIN_PREVIEW_BLOCK_TYPES.FACTS);
  const items = factBlocks.flatMap((block) => toArray(block.items)).filter((item) => item && hasText(item.value));
  return {
    dateItems: items.filter((item) => isDatePreviewFact(item)),
    detailItems: items.filter((item) => !isDatePreviewFact(item))
  };
}

function chronologyPeriodLabel(dateItems = []) {
  const values = [...new Set(toArray(dateItems).map((item) => clean(item?.value)).filter(Boolean))];
  if (!values.length) return "Undated";
  if (values.length === 1) return values[0];
  return `${values[0]} — ${values[values.length - 1]}`;
}

function renderChronologyComposition(layout = {}) {
  const regions = layout.regions || {};
  const identity = renderPreviewRegion("identity", regions.identity);
  const { dateItems, detailItems } = chronologyFactParts(regions.context);
  const period = chronologyPeriodLabel(dateItems);
  const details = detailItems.length ? renderFacts({ type: ADMIN_PREVIEW_BLOCK_TYPES.FACTS, title: "Context", items: detailItems }) : "";
  const main = renderPreviewRegion("main", regions.main);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  const masthead = `<div class="lan-preview-chronology-masthead"><div class="lan-preview-chronology-period"><small>Period</small><strong>${escapeHtml(period)}</strong></div>${identity}</div>`;
  const story = main || details ? `<div class="lan-preview-chronology-story" data-has-context="${details ? "true" : "false"}">${details ? `<aside class="lan-preview-chronology-context">${details}</aside>` : ""}${main ? `<div class="lan-preview-chronology-narrative">${main}</div>` : ""}</div>` : "";
  return compositionShell("chronology", layout, `${masthead}${story}${supporting}${footer}`);
}

function renderShowcaseDeck(identity = "", main = "", variant = "media") {
  if (!identity && !main) return "";
  return `<div class="lan-preview-showcase-deck" data-preview-showcase="${escapeHtml(variant)}" data-has-identity="${identity ? "true" : "false"}" data-has-main="${main ? "true" : "false"}">${identity}${main}</div>`;
}

function semanticContextItems(blocks = []) {
  return toArray(blocks)
    .filter((block) => block?.type === ADMIN_PREVIEW_BLOCK_TYPES.FACTS)
    .flatMap((block) => toArray(block.items))
    .filter((item) => item && hasText(item.value));
}

function renderSemanticContext(blocks = []) {
  const items = semanticContextItems(blocks);
  if (!items.length) return "";
  return `<div class="lan-preview-semantic-context">${items.map((item) => `<span data-context-kind="${isDatePreviewFact(item) ? "date" : "detail"}"><small>${escapeHtml(item.label || "Detail")}</small><strong>${escapeHtml(item.value)}</strong></span>`).join("")}</div>`;
}

function renderSemanticDescriptor(label = "", value = "", className = "") {
  if (!hasText(label) && !hasText(value)) return "";
  return `<div class="lan-preview-semantic-descriptor${className ? ` ${escapeHtml(className)}` : ""}">${label ? `<small>${escapeHtml(label)}</small>` : ""}${value ? `<strong>${escapeHtml(value)}</strong>` : ""}</div>`;
}

function renderSemanticArticle(blocks = [], className = "") {
  const content = toArray(blocks).map((block, index) => {
    if (block?.type !== ADMIN_PREVIEW_BLOCK_TYPES.OVERVIEW) return renderBlock(block);
    const title = clean(block.title);
    const showHeading = title && !/^overview$/i.test(title);
    return `<section class="lan-preview-semantic-section" data-semantic-section="${index + 1}">${showHeading ? sectionHeading(title, block.eyebrow || "") : ""}${block.lead ? `<p class="lan-preview-semantic-lead">${escapeHtml(block.lead)}</p>` : ""}${block.body ? `<div class="lan-preview-semantic-prose">${narrativeHtml(block.body)}</div>` : ""}</section>`;
  }).filter(Boolean).join("");
  return content ? `<article class="${escapeHtml(className)}">${content}</article>` : "";
}

function galleryImageCount(layout = {}) {
  const gallery = toArray(layout?.regions?.spotlight).find((block) => block?.type === ADMIN_PREVIEW_BLOCK_TYPES.GALLERY);
  return toArray(gallery?.items).filter(Boolean).length;
}

function creativeWorkDescriptor(layout = {}, variant = "media") {
  const spotlight = toArray(layout?.regions?.spotlight)[0] || null;
  if (variant === "gallery") {
    const count = toArray(spotlight?.items).filter(Boolean).length;
    return { label: "Gallery", value: `${count || 0} photo${count === 1 ? "" : "s"}` };
  }
  if (variant === "comparison") return { label: "Before & After", value: "Interactive comparison" };
  return { label: "Single Image", value: "Final artwork" };
}

function renderCreativeWorkDeck(layout = {}, variant = "media") {
  const regions = layout.regions || {};
  const identity = renderPreviewRegion("identity", regions.identity);
  const main = renderPreviewRegion("main", regions.main);
  const capabilities = renderPreviewRegion("capabilities", regions.capabilities);
  const facts = renderPreviewRegion("context", regions.context) || renderPreviewRegion("aside", regions.aside);
  if (!identity && !main && !capabilities && !facts) return "";
  const descriptor = creativeWorkDescriptor(layout, variant);
  const kind = `<div class="lan-preview-creative-kind"><small>${escapeHtml(descriptor.label)}</small><strong>${escapeHtml(descriptor.value)}</strong></div>`;
  const capabilitySection = capabilities ? `<div class="lan-preview-creative-capabilities">${capabilities}</div>` : "";
  const factSection = facts ? `<div class="lan-preview-creative-meta">${facts}</div>` : "";
  const story = main ? `<div class="lan-preview-creative-story">${main}</div>` : "";
  const support = capabilitySection || factSection ? `<aside class="lan-preview-creative-support">${capabilitySection}${factSection}</aside>` : "";
  const body = story || support ? `<div class="lan-preview-creative-body" data-has-story="${story ? "true" : "false"}" data-has-support="${support ? "true" : "false"}">${story}${support}</div>` : "";
  const kindClass = variant === "gallery" ? "lan-preview-creative-gallery" : variant === "comparison" ? "lan-preview-creative-comparison" : "lan-preview-creative-media";
  return `<section class="lan-preview-creative-deck ${kindClass}" data-creative-kind="${escapeHtml(variant)}"><div class="lan-preview-creative-caption">${identity}${kind}</div>${body}</section>`;
}

function renderMediaComposition(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  if (layout.variant === "creative-work") return compositionShell("media", layout, `${spotlight}${renderCreativeWorkDeck(layout, "media")}${supporting}${footer}`);
  const identity = renderPreviewRegion("identity", regions.identity);
  const contextBlocks = toArray(regions.context).length ? regions.context : regions.aside;
  const context = renderSemanticContext(contextBlocks);
  const article = renderSemanticArticle(regions.main, "lan-preview-media-article");
  const capabilities = renderPreviewRegion("capabilities", regions.capabilities);
  const mediaType = clean(toArray(regions.spotlight)[0]?.type || "media");
  const descriptor = renderSemanticDescriptor("Media showcase", mediaType === "image" ? "Primary image" : mediaType === "video" ? "Video" : mediaType === "audio" ? "Audio" : "Media", "lan-preview-media-mode");
  const masthead = identity || descriptor ? `<div class="lan-preview-media-masthead">${identity}${descriptor}</div>` : "";
  return compositionShell("media", layout, `${spotlight}${masthead}${context}${article}${capabilities}${supporting}${footer}`);
}

function renderGalleryComposition(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  if (layout.variant === "creative-work") return compositionShell("gallery", layout, `${spotlight}${renderCreativeWorkDeck(layout, "gallery")}${supporting}${footer}`);
  const identity = renderPreviewRegion("identity", regions.identity);
  const contextBlocks = toArray(regions.context).length ? regions.context : regions.aside;
  const context = renderSemanticContext(contextBlocks);
  const article = renderSemanticArticle(regions.main, "lan-preview-gallery-article");
  const capabilities = renderPreviewRegion("capabilities", regions.capabilities);
  const count = galleryImageCount(layout);
  const descriptor = renderSemanticDescriptor("Gallery", `${count} image${count === 1 ? "" : "s"}`, "lan-preview-gallery-count");
  const masthead = identity || descriptor ? `<div class="lan-preview-gallery-masthead">${identity}${descriptor}</div>` : "";
  return compositionShell("gallery", layout, `${spotlight}${masthead}${context}${article}${capabilities}${supporting}${footer}`);
}

function renderComparisonComposition(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  if (layout.variant === "creative-work") return compositionShell("comparison", layout, `${spotlight}${renderCreativeWorkDeck(layout, "comparison")}${supporting}${footer}`);
  const identity = renderPreviewRegion("identity", regions.identity);
  const contextBlocks = toArray(regions.context).length ? regions.context : regions.aside;
  const context = renderSemanticContext(contextBlocks);
  const article = renderSemanticArticle(regions.main, "lan-preview-comparison-article");
  const capabilities = renderPreviewRegion("capabilities", regions.capabilities);
  const descriptor = renderSemanticDescriptor("Comparison", "Interactive before / after", "lan-preview-comparison-mode");
  const masthead = identity || descriptor ? `<div class="lan-preview-comparison-masthead">${identity}${descriptor}</div>` : "";
  return compositionShell("comparison", layout, `${spotlight}${masthead}${context}${article}${capabilities}${supporting}${footer}`);
}

function renderCredentialComposition(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const identity = renderPreviewRegion("identity", regions.identity);
  const context = renderPreviewRegion("context", regions.context);
  const main = renderPreviewRegion("main", regions.main);
  const capabilities = renderPreviewRegion("capabilities", regions.capabilities);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  const details = identity || context || main || capabilities ? `<div class="lan-preview-credential-layout"><div class="lan-preview-credential-copy">${identity}${main}${capabilities}</div>${context ? `<aside class="lan-preview-credential-facts">${context}</aside>` : ""}</div>` : "";
  const stage = spotlight ? `<div class="lan-preview-credential-stage">${spotlight}${details}</div>` : details;
  return compositionShell("credential", layout, `${stage}${supporting}${footer}`);
}

function renderDocumentComposition(layout = {}) {
  const regions = layout.regions || {};
  const identity = renderPreviewRegion("identity", regions.identity);
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const context = renderPreviewRegion("context", regions.context);
  const main = renderPreviewRegion("main", regions.main);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  return compositionShell("document", layout, `${identity}${context}${spotlight}${main}${supporting}${footer}`);
}

function renderStructuredComposition(layout = {}) {
  const regions = layout.regions || {};
  const spotlight = renderPreviewRegion("spotlight", regions.spotlight);
  const identity = renderPreviewRegion("identity", regions.identity);
  const context = renderPreviewRegion("context", regions.context);
  const main = renderPreviewRegion("main", regions.main);
  const aside = renderPreviewRegion("aside", regions.aside);
  const supporting = renderPreviewRegion("supporting", regions.supporting);
  const footer = renderPreviewRegion("footer", regions.footer);
  const content = main || aside ? `<div class="lan-preview-content-grid" data-has-aside="${aside ? "true" : "false"}">${main}${aside}</div>` : "";
  return compositionShell(layout.profile || "structured", layout, `${spotlight}${identity}${context}${content}${supporting}${footer}`);
}

function renderPreviewComposition(layout = {}) {
  switch (layout.profile) {
    case "portfolio": return renderPortfolioComposition(layout);
    case "editorial": return renderEditorialComposition(layout);
    case "chronology": return renderChronologyComposition(layout);
    case "media": return renderMediaComposition(layout);
    case "gallery": return renderGalleryComposition(layout);
    case "comparison": return renderComparisonComposition(layout);
    case "document": return renderDocumentComposition(layout);
    case "credential": return renderCredentialComposition(layout);
    default: return renderStructuredComposition(layout);
  }
}

const previewPdfObjectUrls = new WeakMap();

function revokePreviewPdfUrls(host) {
  const urls = previewPdfObjectUrls.get(host);
  if (urls) urls.forEach((url) => URL.revokeObjectURL?.(url));
  previewPdfObjectUrls.delete(host);
}

export async function isAdminPreviewPdfPayload(blob) {
  if (!(blob instanceof Blob) || !blob.size) return false;
  try {
    const header = await blob.slice(0, 1024).text();
    return header.includes("%PDF-");
  } catch {
    return false;
  }
}

function trackPreviewPdfUrl(host, url) {
  if (!host || !url) return;
  const urls = previewPdfObjectUrls.get(host) || new Set();
  urls.add(url);
  previewPdfObjectUrls.set(host, urls);
}

function previewReferenceFromElement(element, key = "previewFileRef") {
  try {
    return resolveAdminPreviewFileDescriptor(JSON.parse(element?.dataset?.[key] || "{}"));
  } catch {
    return resolveAdminPreviewFileDescriptor({});
  }
}

function isManagedPreviewDescriptor(descriptor = {}) {
  if (descriptor.assetId || descriptor.publicId) return true;
  try { return new URL(descriptor.href).hostname.toLowerCase() === "res.cloudinary.com"; } catch { return false; }
}

async function fetchAdminPreviewFileBlob(descriptor = {}) {
  if (isManagedPreviewDescriptor(descriptor)) {
    const { fetchManagedMediaAssetBlob } = await import("../services/mediaDeliveryService.js");
    return fetchManagedMediaAssetBlob(descriptor);
  }
  const response = await fetch(descriptor.href, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`File request failed with ${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("File response was empty");
  return blob;
}

async function loadPreviewPdfDescriptor(host, descriptor, stage) {
  if (!descriptor?.href || !stage) return;
  stage.dataset.previewPdfState = "loading";
  try {
    const blob = await fetchAdminPreviewFileBlob(descriptor);
    if (!await isAdminPreviewPdfPayload(blob)) throw new Error("The file host did not return a valid PDF document");
    const objectUrl = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
    trackPreviewPdfUrl(host, objectUrl);
    stage.innerHTML = `<iframe src="${escapeHtml(objectUrl)}#page=1&zoom=page-width" title="${escapeHtml(descriptor.label || "PDF preview")}" loading="eager"></iframe>`;
    stage.dataset.previewPdfState = "ready";
  } catch (error) {
    stage.dataset.previewPdfState = "fallback";
    stage.innerHTML = `<div class="lan-preview-pdf-state is-fallback"><strong>PDF preview could not be loaded.</strong><small>${escapeHtml(error?.message || "Secure document access failed.")}</small><button type="button" class="lan-preview-file-card__action" data-preview-file-open="true" data-preview-file-ref="${escapeHtml(previewFileReference(descriptor))}">Try opening the file <span aria-hidden="true">↗</span></button></div>`;
    configurePreviewFileOpenActions(stage);
  }
}

function closePreviewPdfOverlay(host) {
  host?.querySelector?.("[data-preview-pdf-overlay]")?.remove?.();
}

function openPreviewPdfOverlay(host, descriptor) {
  if (!host?.append || !descriptor?.href) return;
  closePreviewPdfOverlay(host);
  const overlay = document.createElement("section");
  overlay.className = "lan-preview-pdf-overlay";
  overlay.dataset.previewPdfOverlay = "true";
  overlay.innerHTML = `<header><div><small>PDF DOCUMENT</small><strong>${escapeHtml(descriptor.label || "PDF")}</strong></div><button type="button" class="modal-close" data-preview-pdf-close aria-label="Close PDF preview">✕</button></header><div class="lan-preview-document" data-preview-pdf-stage="true"><div class="lan-preview-pdf-state"><strong>Loading PDF preview…</strong><small>Securely retrieving the original document.</small></div></div><footer><button type="button" class="lan-preview-file-card__action" data-preview-file-open="true" data-preview-file-ref="${escapeHtml(previewFileReference(descriptor))}">Open file <span aria-hidden="true">↗</span></button></footer>`;
  host.append(overlay);
  overlay.querySelector("[data-preview-pdf-close]")?.addEventListener("click", () => closePreviewPdfOverlay(host));
  configurePreviewFileOpenActions(overlay);
  loadPreviewPdfDescriptor(host, descriptor, overlay.querySelector("[data-preview-pdf-stage]"));
}

async function openPreviewFile(descriptor = {}) {
  if (!descriptor?.href) return;
  if (!isManagedPreviewDescriptor(descriptor)) {
    window.open(descriptor.href, "_blank", "noopener,noreferrer");
    return;
  }
  const popup = window.open("about:blank", "_blank");
  try {
    const blob = await fetchAdminPreviewFileBlob(descriptor);
    const objectUrl = URL.createObjectURL(blob);
    if (popup) {
      popup.opener = null;
      popup.location.replace(objectUrl);
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL?.(objectUrl), 60000);
  } catch (error) {
    popup?.close?.();
    window.LANNotice?.({ title: "File could not be opened", message: error?.message || "Secure file access failed.", tone: "error" });
  }
}

function configurePreviewFileOpenActions(host) {
  if (!host?.querySelectorAll) return;
  host.querySelectorAll("[data-preview-file-open]").forEach((button) => {
    if (button.dataset.previewFileBound === "true") return;
    button.dataset.previewFileBound = "true";
    button.addEventListener("click", () => openPreviewFile(previewReferenceFromElement(button, "previewFileRef")));
  });
}

function configurePreviewDocuments(host) {
  if (!host?.querySelectorAll) return;
  host.querySelectorAll("[data-preview-pdf-stage][data-preview-pdf-ref]").forEach((stage) => {
    loadPreviewPdfDescriptor(host, previewReferenceFromElement(stage, "previewPdfRef"), stage);
  });
  host.querySelectorAll("[data-preview-pdf-open]").forEach((button) => {
    button.addEventListener("click", () => openPreviewPdfOverlay(host, previewReferenceFromElement(button, "previewPdfRef")));
  });
  configurePreviewFileOpenActions(host);
}

const portfolioCapabilityObservers = new WeakMap();

function disconnectPortfolioCapabilityObserver(host) {
  const observer = portfolioCapabilityObservers.get(host);
  observer?.disconnect?.();
  portfolioCapabilityObservers.delete(host);
}

function measurePortfolioCapabilityRail(masthead) {
  const availableWidth = masthead?.getBoundingClientRect?.().width || masthead?.clientWidth || 0;
  const fallbackPrimary = masthead?.querySelector?.('.lan-preview-portfolio-primary');
  const fallbackCapabilities = masthead?.querySelector?.('.lan-preview-portfolio-capabilities .lan-preview-region--capabilities');
  const fallback = () => ({
    availableWidth,
    primaryHeight: fallbackPrimary?.scrollHeight || fallbackPrimary?.getBoundingClientRect?.().height || 0,
    capabilityHeight: fallbackCapabilities?.scrollHeight || fallbackCapabilities?.getBoundingClientRect?.().height || 0
  });
  if (!masthead || !availableWidth || typeof document === 'undefined' || !document.body || typeof masthead.cloneNode !== 'function') return fallback();

  const probe = masthead.cloneNode(true);
  probe.dataset.capabilityLayout = 'rail';
  probe.setAttribute?.('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'fixed',
    inset: '0 auto auto -100000px',
    width: `${availableWidth}px`,
    maxWidth: 'none',
    visibility: 'hidden',
    pointerEvents: 'none',
    contain: 'layout style',
    zIndex: '-1'
  });
  document.body.appendChild(probe);
  const primary = probe.querySelector?.('.lan-preview-portfolio-primary');
  const capabilityRail = probe.querySelector?.('.lan-preview-portfolio-capabilities .lan-preview-region--capabilities');
  const metrics = {
    availableWidth,
    primaryHeight: primary?.scrollHeight || primary?.getBoundingClientRect?.().height || 0,
    capabilityHeight: capabilityRail?.scrollHeight || capabilityRail?.getBoundingClientRect?.().height || 0
  };
  probe.remove?.();
  return metrics;
}

function configureCredentialMediaOrientation(host) {
  const composition = host?.querySelector?.('.lan-preview-composition[data-preview-composition="credential"]');
  const image = composition?.querySelector?.('.lan-preview-region--spotlight img');
  if (!composition || !image) return;
  const apply = () => {
    const width = Number(image.naturalWidth || 0);
    const height = Number(image.naturalHeight || 0);
    if (!width || !height) return;
    const ratio = width / height;
    composition.dataset.mediaOrientation = ratio > 1.15 ? 'landscape' : ratio < 0.85 ? 'portrait' : 'square';
  };
  if (image.complete) apply();
  else image.addEventListener?.('load', apply, { once: true });
}

function configurePortfolioCapabilityDensity(host) {
  disconnectPortfolioCapabilityObserver(host);
  if (!host?.querySelector) return;
  const composition = host.querySelector('.lan-preview-composition[data-preview-composition="portfolio"]');
  const masthead = composition?.querySelector?.('.lan-preview-portfolio-masthead');
  const capabilityRail = masthead?.querySelector?.('.lan-preview-portfolio-capabilities .lan-preview-region--capabilities');
  if (!masthead || !capabilityRail) return;

  let lastObservedWidth = -1;
  const measure = (force = false) => {
    const nextWidth = masthead.getBoundingClientRect?.().width || masthead.clientWidth || 0;
    if (!force && lastObservedWidth >= 0 && Math.abs(nextWidth - lastObservedWidth) < 1) return;
    lastObservedWidth = nextWidth;
    const metrics = measurePortfolioCapabilityRail(masthead);
    const nextLayout = resolveAdminPreviewCapabilityLayout(metrics);
    if (masthead.dataset.capabilityLayout !== nextLayout) masthead.dataset.capabilityLayout = nextLayout;
  };

  measure(true);
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => measure(true));
  if (typeof document !== 'undefined' && document.fonts?.ready?.then) document.fonts.ready.then(() => measure(true)).catch?.(() => {});
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(masthead);
    portfolioCapabilityObservers.set(host, observer);
  }
}

export function renderAdminPreview(host, { mode = "structured", profile = "", surface = "modal", blocks = [], system = [] } = {}) {
  if (!host) return null;
  revokePreviewPdfUrls(host);
  closePreviewPdfOverlay(host);
  const contentBlocks = toArray(blocks).filter(Boolean);
  const layout = composeAdminPreviewLayout(contentBlocks, { profile, system });
  const previewMode = clean(mode) || "structured";
  const previewSurface = clean(surface) || "modal";
  const previewDensity = resolveAdminPreviewSurfaceDensity(layout);
  const markup = renderPreviewComposition(layout);

  if (previewSurface === "embedded") {
    host.classList.remove("lan-admin-preview-body");
    delete host.dataset.previewMode;
    delete host.dataset.previewProfile;
    delete host.dataset.previewSurface;
    delete host.dataset.previewDensity;
    host.innerHTML = `<div class="lan-admin-preview-surface lan-admin-preview-body" data-preview-surface="embedded" data-preview-mode="${escapeHtml(previewMode)}" data-preview-profile="${escapeHtml(layout.profile)}" data-preview-density="${escapeHtml(previewDensity)}">${markup}</div>`;
    configurePortfolioCapabilityDensity(host);
    configureCredentialMediaOrientation(host);
    configurePreviewDocuments(host);
    return host.querySelector?.(".lan-admin-preview-surface") || host;
  }

  host.classList.add("lan-admin-preview-body");
  host.dataset.previewSurface = "modal";
  host.dataset.previewMode = previewMode;
  host.dataset.previewProfile = layout.profile;
  host.dataset.previewDensity = previewDensity;
  host.innerHTML = markup;
  configurePortfolioCapabilityDensity(host);
  configureCredentialMediaOrientation(host);
  configurePreviewDocuments(host);
  return host;
}

export function initializePreviewComparison(root, { position = 50 } = {}) {
  const container = root?.querySelector?.("[data-preview-comparison]") || (root?.matches?.("[data-preview-comparison]") ? root : null);
  const slider = container?.querySelector?.("[data-preview-comparison-slider]");
  const before = container?.querySelector?.("[data-preview-comparison-before]");
  if (!container || !slider || !before) return () => {};
  let value = Math.max(0, Math.min(100, Number(position) || 50));
  const apply = (next) => {
    value = Math.max(0, Math.min(100, Number(next) || 0));
    container.style.setProperty("--preview-position", `${value}%`);
    slider.style.left = `${value}%`;
    slider.setAttribute("aria-valuenow", String(Math.round(value)));
    before.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  };
  const updateFromPointer = (clientX) => {
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    apply(((clientX - rect.left) / rect.width) * 100);
  };
  const pointerDown = (event) => {
    event.preventDefault();
    slider.setPointerCapture?.(event.pointerId);
    updateFromPointer(event.clientX);
  };
  const pointerMove = (event) => {
    if (slider.hasPointerCapture?.(event.pointerId)) updateFromPointer(event.clientX);
  };
  const pointerUp = (event) => slider.releasePointerCapture?.(event.pointerId);
  const keyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") apply(0);
    else if (event.key === "End") apply(100);
    else apply(value + (event.key === "ArrowRight" ? 5 : -5));
  };
  slider.addEventListener("pointerdown", pointerDown);
  slider.addEventListener("pointermove", pointerMove);
  slider.addEventListener("pointerup", pointerUp);
  slider.addEventListener("pointercancel", pointerUp);
  slider.addEventListener("keydown", keyDown);
  apply(value);
  return () => {
    slider.removeEventListener("pointerdown", pointerDown);
    slider.removeEventListener("pointermove", pointerMove);
    slider.removeEventListener("pointerup", pointerUp);
    slider.removeEventListener("pointercancel", pointerUp);
    slider.removeEventListener("keydown", keyDown);
  };
}
