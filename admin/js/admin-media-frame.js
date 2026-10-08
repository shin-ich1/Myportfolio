import { resolveAssetUrl } from '../../asset-resolver.js';
const clean = (value = "") => String(value ?? "").trim();

const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[character]));

export function classifyAdminMediaGeometry(width = 0, height = 0) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!(w > 0) || !(h > 0)) return { orientation: "unknown", naturalRatio: 0, frameRatio: 0 };
  const naturalRatio = w / h;
  const orientation = naturalRatio < 0.9 ? "portrait" : naturalRatio > 1.15 ? "landscape" : "square";

  // Asset geometry is descriptive only. Layout owns the cover/Preview field size;
  // the foreground image fits inside that field without cropping or resizing the card.
  return { orientation, naturalRatio, frameRatio: 0 };
}

export function applyAdminMediaGeometry(image) {
  if (!(image instanceof HTMLImageElement)) return null;
  const frame = image.closest?.(".lan-admin-media-frame");
  if (!(frame instanceof HTMLElement)) return null;
  const geometry = classifyAdminMediaGeometry(image.naturalWidth, image.naturalHeight);
  if (!geometry.naturalRatio) return null;
  frame.dataset.mediaOrientation = geometry.orientation;
  frame.style.setProperty("--lan-admin-media-natural-ratio", String(geometry.naturalRatio));
  return geometry;
}

function bindAdminMediaGeometry(image) {
  if (!(image instanceof HTMLImageElement) || image.dataset.adminMediaGeometryBound === "true") return;
  image.dataset.adminMediaGeometryBound = "true";
  const apply = () => applyAdminMediaGeometry(image);
  if (image.complete && image.naturalWidth && image.naturalHeight) queueMicrotask(apply);
  else image.addEventListener("load", apply, { once: true });
}

export function resolveAdminMediaAssetUrl(value = null) {
  return clean(resolveAssetUrl(value, "admin-read"));
}

export function adminMediaFallbackMarkup({
  title = "Media",
  context = "Portfolio media",
  emblemHtml = "",
  role = "generic"
} = {}) {
  const normalizedRole = clean(role).toLowerCase();
  if (normalizedRole === "cover") {
    return `<span class="lan-admin-media-frame__fallback lan-admin-media-frame__fallback--cover" data-admin-media-layer="fallback"><span class="lan-admin-media-frame__fallback-brand" aria-hidden="true">LΛN</span><small>${escapeHtml(context || "Portfolio media")}</small></span>`;
  }
  const emblem = clean(emblemHtml)
    ? emblemHtml
    : '<span class="lan-admin-media-frame__fallback-brand" aria-hidden="true">LΛN</span>';
  return `<span class="lan-admin-media-frame__fallback" data-admin-media-layer="fallback"><span class="lan-admin-media-frame__fallback-emblem" aria-hidden="true">${emblem}</span><strong>${escapeHtml(title || "Media")}</strong><small>${escapeHtml(context || "Portfolio media")}</small></span>`;
}

export function adminMediaImageLayersMarkup({
  src = "",
  fallbackSrc = "",
  alt = "",
  title = "Media",
  context = "Portfolio media",
  emblemHtml = "",
  imageClass = "",
  imageAttributes = "",
  role = "generic",
  loading = "lazy",
  fetchPriority = ""
} = {}) {
  const resolved = resolveAdminMediaAssetUrl(src);
  if (!resolved) return adminMediaFallbackMarkup({ title, context, emblemHtml, role });
  const safeSrc = escapeHtml(resolved);
  const resolvedFallback = resolveAdminMediaAssetUrl(fallbackSrc);
  const safeFallback = resolvedFallback && resolvedFallback !== resolved ? escapeHtml(resolvedFallback) : "";
  const fallbackAttribute = safeFallback ? ` data-admin-media-fallback-src="${safeFallback}"` : "";
  const classes = ["lan-admin-media-frame__image", clean(imageClass)].filter(Boolean).join(" ");
  const safeLoading = ["eager", "lazy"].includes(clean(loading)) ? clean(loading) : "lazy";
  const priority = clean(fetchPriority);
  const priorityAttribute = ["high", "low", "auto"].includes(priority) ? ` fetchpriority="${priority}"` : "";
  const fallback = adminMediaFallbackMarkup({ title, context, emblemHtml, role }).replace('<span class="lan-admin-media-frame__fallback', '<span hidden class="lan-admin-media-frame__fallback');
  return `${fallback}<img class="lan-admin-media-frame__backdrop" src="${safeSrc}"${fallbackAttribute} alt="" aria-hidden="true" loading="lazy" decoding="async" data-admin-media-layer="backdrop"><img class="${escapeHtml(classes)}" src="${safeSrc}"${fallbackAttribute} alt="${escapeHtml(alt)}" loading="${safeLoading}" decoding="async"${priorityAttribute} data-admin-media-layer="foreground" data-admin-media-role="${escapeHtml(clean(role) || "generic")}" ${imageAttributes}>`;
}

function createFallbackNode({ title = "Media", context = "Portfolio media", emblemHtml = "", role = "generic" } = {}) {
  const wrapper = document.createElement("span");
  wrapper.innerHTML = adminMediaFallbackMarkup({ title, context, emblemHtml, role });
  return wrapper.firstElementChild;
}

export function mountAdminMediaFrame(container, {
  src = "",
  fallbackSrc = "",
  alt = "",
  title = "Media",
  context = "Portfolio media",
  emblemHtml = "",
  imageClass = "",
  role = "cover"
} = {}) {
  if (!(container instanceof HTMLElement)) return null;
  const normalizedRole = ["cover", "gallery", "preview"].includes(clean(role)) ? clean(role) : "cover";
  container.classList.add("lan-admin-media-frame", `lan-admin-media-frame--${normalizedRole}`);
  container.querySelectorAll(":scope > [data-admin-media-layer]").forEach((node) => node.remove());
  const resolved = resolveAdminMediaAssetUrl(src);
  const resolvedFallback = resolveAdminMediaAssetUrl(fallbackSrc);
  if (!resolved) {
    const fallback = createFallbackNode({ title, context, emblemHtml, role: normalizedRole });
    if (fallback) container.prepend(fallback);
    return null;
  }

  const backdrop = document.createElement("img");
  backdrop.className = "lan-admin-media-frame__backdrop";
  backdrop.alt = "";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.loading = "lazy";
  backdrop.decoding = "async";
  backdrop.dataset.adminMediaLayer = "backdrop";

  const image = document.createElement("img");
  image.className = ["lan-admin-media-frame__image", clean(imageClass)].filter(Boolean).join(" ");
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.dataset.adminMediaLayer = "foreground";
  image.dataset.adminMediaRole = normalizedRole;
  // Dynamically mounted frames own their retry/fallback lifecycle locally.
  // The delegated handler below owns static markup only, so the two paths do
  // not race on the same image error.
  image.dataset.adminMediaErrorOwner = "local";

  const showFallback = () => {
    backdrop.remove();
    image.remove();
    const fallback = createFallbackNode({ title, context, emblemHtml, role: normalizedRole });
    if (fallback && !container.querySelector(":scope > .lan-admin-media-frame__fallback")) container.prepend(fallback);
  };
  const retryOriginal = () => {
    if (!resolvedFallback || resolvedFallback === resolved || image.dataset.adminMediaFallbackTried === "true") return false;
    image.dataset.adminMediaFallbackTried = "true";
    backdrop.dataset.adminMediaFallbackTried = "true";
    backdrop.src = resolvedFallback;
    image.src = resolvedFallback;
    return true;
  };
  image.addEventListener("error", () => { if (!retryOriginal()) showFallback(); });
  backdrop.addEventListener("error", () => backdrop.remove(), { once: true });
  backdrop.src = resolved;
  image.src = resolved;
  container.prepend(backdrop, image);
  bindAdminMediaGeometry(image);
  return image;
}

function normalizeAdminMediaCardItems(items = []) {
  return (Array.isArray(items) ? items : [items])
    .map((item, index) => ({
      src: resolveAdminMediaAssetUrl(item?.src || item?.url || item),
      alt: clean(item?.alt) || `Gallery image ${index + 1}`
    }))
    .filter((item) => item.src);
}

export function mountAdminMediaCardGallery(container, {
  items = [],
  title = "Gallery",
  context = "Gallery media"
} = {}) {
  if (!(container instanceof HTMLElement)) return { images: [], visibleCount: 0, totalCount: 0 };

  container.replaceChildren();
  container.classList.add("lan-admin-media-frame", "lan-admin-media-frame--cover");

  const normalizedItems = normalizeAdminMediaCardItems(items);
  const visibleItems = normalizedItems.slice(0, 4);
  const gallery = document.createElement("div");
  gallery.className = "lan-admin-media-card-gallery";
  gallery.dataset.count = String(Math.max(visibleItems.length, 1));
  gallery.setAttribute("aria-label", `${title}, ${normalizedItems.length} images`);

  const images = [];
  visibleItems.forEach((item, index) => {
    const tile = document.createElement("div");
    tile.className = "lan-admin-media-card-gallery__tile lan-admin-media-frame lan-admin-media-frame--gallery";
    const image = mountAdminMediaFrame(tile, {
      src: item.src,
      alt: item.alt,
      title,
      context: `${context} ${index + 1}`,
      role: "gallery"
    });
    if (image) {
      image.draggable = false;
      images.push(image);
    }

    if (index === visibleItems.length - 1 && normalizedItems.length > visibleItems.length) {
      const more = document.createElement("span");
      more.className = "lan-admin-media-card-gallery__more";
      more.textContent = `+${normalizedItems.length - visibleItems.length}`;
      tile.append(more);
    }
    gallery.append(tile);
  });

  if (!visibleItems.length) {
    const tile = document.createElement("div");
    tile.className = "lan-admin-media-card-gallery__tile lan-admin-media-frame lan-admin-media-frame--gallery";
    mountAdminMediaFrame(tile, { title, context, role: "gallery" });
    gallery.append(tile);
  }

  container.append(gallery);
  return { images, visibleCount: visibleItems.length, totalCount: normalizedItems.length, gallery };
}

export function mountAdminMediaCardComparison(container, {
  before = "",
  after = "",
  title = "Before & After",
  beforeLabel = "BEFORE",
  afterLabel = "AFTER",
  showLabels = false
} = {}) {
  if (!(container instanceof HTMLElement)) return { images: [] };

  container.replaceChildren();
  container.classList.add("lan-admin-media-frame", "lan-admin-media-frame--cover");

  const comparison = document.createElement("div");
  comparison.className = "lan-admin-media-card-comparison";
  comparison.setAttribute("aria-label", `${title}, before and after comparison`);

  const images = [];
  [
    { kind: "before", src: before, label: beforeLabel },
    { kind: "after", src: after, label: afterLabel }
  ].forEach(({ kind, src, label }) => {
    const pane = document.createElement("div");
    pane.className = `lan-admin-media-card-comparison__pane is-${kind} lan-admin-media-frame lan-admin-media-frame--gallery`;
    const image = mountAdminMediaFrame(pane, {
      src,
      alt: `${label}: ${title}`,
      title,
      context: `${label} media`,
      role: "gallery"
    });
    if (image) {
      image.draggable = false;
      images.push(image);
    }
    if (showLabels && label) {
      const badge = document.createElement("span");
      badge.className = "lan-admin-media-card-comparison__label";
      badge.textContent = label;
      pane.append(badge);
    }
    comparison.append(pane);
  });

  container.append(comparison);
  return { images, comparison };
}

if (typeof document !== "undefined") {
  document.addEventListener("error", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.matches?.(".lan-admin-media-frame__image[data-admin-media-layer=\"foreground\"]")) return;
    if (target.dataset.adminMediaErrorOwner === "local") return;
    const frame = target.closest?.(".lan-admin-media-frame");
    if (!(frame instanceof HTMLElement)) return;
    const fallbackSource = clean(target.dataset.adminMediaFallbackSrc);
    const currentSource = clean(target.getAttribute("src"));
    if (fallbackSource && target.dataset.adminMediaFallbackTried !== "true" && fallbackSource !== currentSource) {
      target.dataset.adminMediaFallbackTried = "true";
      const backdrop = frame.querySelector(":scope > .lan-admin-media-frame__backdrop");
      if (backdrop instanceof HTMLImageElement) {
        backdrop.dataset.adminMediaFallbackTried = "true";
        backdrop.src = fallbackSource;
      }
      target.src = fallbackSource;
      return;
    }
    frame.querySelectorAll(":scope > .lan-admin-media-frame__image, :scope > .lan-admin-media-frame__backdrop").forEach((node) => node.remove());
    const fallback = frame.querySelector(":scope > .lan-admin-media-frame__fallback");
    if (fallback instanceof HTMLElement) fallback.hidden = false;
  }, true);
  document.addEventListener("load", (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.matches?.(".lan-admin-media-frame__image[data-admin-media-layer=\"foreground\"]")) applyAdminMediaGeometry(target);
  }, true);
  queueMicrotask(() => {
    document.querySelectorAll?.(".lan-admin-media-frame__image[data-admin-media-layer=\"foreground\"]").forEach(bindAdminMediaGeometry);
  });
}

