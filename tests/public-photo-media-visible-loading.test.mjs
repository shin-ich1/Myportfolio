import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function owner(first, next) {
  const start = app.indexOf("function " + first + "(");
  assert.ok(start >= 0, "Missing canonical Public owner: " + first);
  const end = app.indexOf("\nfunction " + next + "(", start);
  assert.ok(end > start, "Missing owner boundary: " + next);
  return app.slice(start, end);
}

test("Photo Editing open viewer prioritizes its one selected full image, not a lazy thumbnail", () => {
  const sources = owner("photoEditingDetailMediaMarkup", "photoEditingDetailNavigation");
  const calls = [];
  const view = new Function("cleanText", "photoGalleryMediaDescriptors", "escapeHtml", "publicMediaFrameMarkup", "photoEditingMediaRole",
    sources + "\nreturn photoEditingDetailMediaMarkup;"
  )(
    value => String(value || "").trim(),
    () => [],
    value => String(value || ""),
    (source, label, options) => { calls.push({ source, label, options }); return "<image-frame/>"; },
    () => ({ key: "single", label: "Single Image" })
  );
  const markup = view({ title: "Portrait", afterImage: { url: "/photo.png" } }, { key: "single", label: "Single Image" });
  assert.match(markup, /photo-detail-single-stage/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.purpose, "detail");
  assert.equal(calls[0].options.loading, "eager", "User-opened picture should start loading immediately");
  assert.equal(calls[0].options.priority, "high", "Selected viewer image is a critical interaction");
});

test("Photo Editing comparison opens both visible images without delayed lazy loads", () => {
  const calls = [];
  const view = new Function("cleanText", "photoGalleryMediaDescriptors", "escapeHtml", "publicMediaFrameMarkup", "photoEditingMediaRole",
    owner("photoEditingDetailMediaMarkup", "photoEditingDetailNavigation") + "\nreturn photoEditingDetailMediaMarkup;"
  )(
    value => String(value || "").trim(),
    () => [],
    value => String(value || ""),
    (source, label, options) => { calls.push(options); return "<image-frame/>"; },
    () => ({ key: "comparison", label: "Before & After" })
  );
  view({ title: "Sample", beforeImage: "/before.png", afterImage: "/after.png" }, { key: "comparison", label: "Before & After" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(options => options.purpose === "detail" && options.loading === "eager"),
    "Comparison images are both visible when the modal opens");
});

test("Photo Editing gallery loads first visible image before offscreen images", () => {
  const calls = [];
  const gallery = ["/one.png", "/two.png", "/three.png", "/four.png"].map((asset, index) => ({ asset, index, shape: "landscape", width: 100, height: 60 }));
  const view = new Function("cleanText", "photoGalleryMediaDescriptors", "escapeHtml", "publicMediaFrameMarkup", "photoEditingMediaRole",
    owner("photoEditingDetailMediaMarkup", "photoEditingDetailNavigation") + "\nreturn photoEditingDetailMediaMarkup;"
  )(
    value => String(value || "").trim(),
    () => gallery,
    value => String(value || ""),
    (source, label, options) => { calls.push(options); return "<image-frame/>"; },
    () => ({ key: "gallery", label: "Gallery · 4 images" })
  );
  view({ title: "Samples" }, { key: "gallery", label: "Gallery · 4 images" });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].loading, "eager");
  assert.equal(calls[0].priority, "high");
  assert.ok(calls.slice(1).every(options => options.loading !== "eager"),
    "Do not download all high-resolution gallery images eagerly on phones");
});

test("Shared Public image media frame keeps a visible loading placeholder and asynchronous decoding", () => {
  const ownerMarkup = owner("publicMediaFrameMarkup", "publicVideoPlaybackSources");
  const frame = new Function("mediaPresentation", "cleanText", "escapeHtml",
    ownerMarkup + "\nreturn publicMediaFrameMarkup;"
  )(
    value => ({ publicCardUrl: String(value), publicDisplayUrl: String(value), publicOriginalUrl: String(value), publicDetailUrl: String(value) }),
    value => String(value || "").trim(),
    value => String(value || "")
  );
  const photo = frame("/image.png", "Portrait", { loading: "eager", priority: "high" });
  assert.match(photo, /loading="eager"/);
  assert.match(photo, /fetchpriority="high"/);
  assert.match(photo, /decoding="async"/);
  assert.match(css, /\.public-media-frame\.media-loading>\.public-media-frame__fallback\{opacity:1;visibility:visible\}/,
    "Keep fallback visible while the image is pending, instead of an empty canvas");
  const lazy = frame("/offscreen.png", "Other");
  assert.match(lazy, /loading="lazy"/, "Existing offscreen lazy loading is preserved");
  assert.doesNotMatch(lazy, /fetchpriority="high"/);
});
