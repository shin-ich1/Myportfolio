import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function owner(name, next) {
  const start = app.indexOf("function " + name + "(");
  assert.ok(start >= 0, "Missing canonical owner: " + name);
  const end = app.indexOf("\nfunction " + next + "(", start);
  assert.ok(end > start, "Missing owner boundary: " + next);
  return app.slice(start, end);
}

function detailMarkup(role, gallery = []) {
  const sources = owner("photoEditingDetailMediaMarkup", "photoEditingDetailNavigation");
  const render = new Function(
    "cleanText", "photoGalleryMediaDescriptors", "escapeHtml", "publicMediaFrameMarkup", "photoEditingMediaRole",
    sources + "\nreturn photoEditingDetailMediaMarkup;"
  )(
    value => String(value || "").trim(),
    () => gallery,
    value => String(value ?? ""),
    (asset, label) => `<span data-asset="${typeof asset === "string" ? asset : asset?.url || ""}">${label}</span>`,
    () => role
  );
  return render({
    title: "Proof",
    afterImage: "/after.jpg",
    beforeImage: "/before.jpg",
    galleryImages: gallery
  }, role);
}

test("detail layer remains informational and each photo type opens a separate image-only preview", () => {
  const single = detailMarkup({ key: "single", label: "Single Image" });
  const comparison = detailMarkup({ key: "comparison", label: "Before & After" });
  const gallery = detailMarkup({ key: "gallery", label: "Gallery" }, [
    { asset: "/one.jpg", index: 0, shape: "square", width: 800, height: 800 },
    { asset: "/two.jpg", index: 1, shape: "square", width: 800, height: 800 }
  ]);
  assert.match(single, /data-photo-preview-open/, "Single needs an image-only second level");
  assert.match(comparison, /data-photo-preview-open/, "Comparison needs an image-only second level");
  assert.match(comparison, /\/before\.jpg/);
  assert.match(comparison, /\/after\.jpg/);
  assert.match(gallery, /data-photo-gallery-open="0"/);
  assert.match(gallery, /data-photo-gallery-open="1"/);
  const detail = owner("openPhotoEditingSource", "setupPhotoDetailGalleryViewer");
  assert.match(detail, /photo-detail-information/, "Details and description stay at the first level");
  assert.match(detail, /photo-detail-record-nav-row/, "Record navigation stays in the detail view");
});

test("shared image-only layer is viewport-bound and exclusively owns its close button", () => {
  const stage = owner("openPublicImagePreview", "closePublicImagePreview");
  assert.match(stage, /public-image-preview/, "Shared full viewer missing");
  assert.match(stage, /publicMediaFrameMarkup/, "Do not bypass canonical delivery, loading or fallback");
  assert.doesNotMatch(stage, /photo-gallery-lightbox/, "No competing Photo Editing overlay");
  assert.match(css, /\.public-image-preview\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.public-image-preview-stage[^}]*min-height:\s*0/);
  assert.doesNotMatch(app, /data-photo-gallery-lightbox/, "Remove the old overlay and its second close owner");
});

test("shared gallery navigation stops at both ends; no wraparound or dead arrows", () => {
  const nav = owner("publicImagePreviewNavigation", "openPublicImagePreview");
  const resolve = new Function(nav + "\nreturn publicImagePreviewNavigation;")();
  assert.deepEqual(resolve(0, 2), { index: 0, hasPrevious: false, hasNext: true });
  assert.deepEqual(resolve(1, 2), { index: 1, hasPrevious: true, hasNext: false });
  assert.deepEqual(resolve(5, 6), { index: 5, hasPrevious: true, hasNext: false });
  assert.deepEqual(resolve(-2, 2), { index: 0, hasPrevious: false, hasNext: true });
  const open = owner("openPublicImagePreview", "closePublicImagePreview");
  assert.match(open, /hidden/, "Unavailable arrows should disappear, not merely dim");
});

test("comparison full preview is one composition with both complete images", () => {
  const open = owner("openPublicImagePreview", "closePublicImagePreview");
  assert.match(open, /public-image-preview-comparison/);
  assert.match(open, /BEFORE/);
  assert.match(open, /AFTER/);
  assert.match(css, /\.public-image-preview-comparison\s*\{/);
  assert.match(css, /\.public-image-preview-stage[^}]*overflow:\s*hidden/);
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:contain/);
  assert.doesNotMatch(open, /canvas\.|drawImage|clip-path/, "Never combine by slicing or permanently rewriting source images");
});

test("gallery overview distributes two images evenly, without an empty third column", () => {
  const galleryRule = css.match(/\.public-photo-gallery\s*\{([^}]*)\}/)?.[1] || "";
  assert.ok(galleryRule, "Missing shared detail gallery container");
  assert.doesNotMatch(galleryRule, /repeat\(3\s*,/, "The existing fixed three columns strand a pair on the left");
  assert.match(galleryRule, /grid-template-columns/);
  assert.match(detailMarkup({ key: "gallery", label: "Gallery" }, [
    { asset: "/one.jpg", index: 0, shape: "square", width: 800, height: 800 },
    { asset: "/two.jpg", index: 1, shape: "square", width: 800, height: 800 }
  ]), /data-gallery-count="2"/);
});

test("generated future module images reuse the same image-only entrypoint", () => {
  const dynamic = owner("dynamicAssetMarkup", "dynamicValueMarkup");
  assert.match(dynamic, /data-public-image-preview/, "Future modules must not need a Photo Editing special case");
  const binder = owner("bindPublicImagePreviewTriggers", "publicImagePreviewNavigation");
  assert.match(binder, /openPublicImagePreview/);
});

test("image-only viewer declares its focus owner before use in strict JavaScript modules", () => {
  const section = app.slice(app.indexOf("function publicImagePreviewNavigation("), app.indexOf("\nlet modalOpener = null;", app.indexOf("function publicImagePreviewNavigation(")));
  assert.match(section, /(?:const|let)\s+publicImagePreviewReturnFocus\s*=\s*null\s*;/,
    "An undeclared focus state throws ReferenceError on gallery, single and comparison clicks in the real ES module");
  assert.match(section, /publicImagePreviewReturnFocus\s*=\s*opener\s*\|\|\s*document\.activeElement/);
});

test("single-image details use the outer modal as the sole scroll owner", () => {
  const viewer = css.match(/\.photo-detail-viewer\s*\{([^}]*)\}/)?.[1] || "";
  const shell = css.match(/\.photo-detail-shell\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(viewer, /overflow-y:\s*auto/, "The outer Photo Editing detail modal must remain scrollable");
  assert.doesNotMatch(shell, /max-height|overflow-y:\s*auto/, "A nested scroll/height owner shrinks the portrait media row beneath its image");
  assert.doesNotMatch(css, /html\[data-lan-public-mode="mobile"\]\s+\.photo-detail-shell\s*\{[^}]*max-height/,
    "Mobile uses the same canonical scroll geometry rather than a second height constraint");
});
