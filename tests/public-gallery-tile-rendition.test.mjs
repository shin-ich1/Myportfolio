import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storageAssetUrl } from "../storage-asset.js";
import { resolveAssetUrl } from "../asset-resolver.js";
import { resolvePortfolioAssetPresentation } from "../record-media.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const previewAsset = {
  provider: "cloudinary",
  resourceType: "image",
  access: "public-preview",
  url: "https://res.cloudinary.com/example/image/upload/v1234/small-gallery-tile.png"
};

test("Small gallery tile has its own 480px managed Cloudinary delivery without changing card, detail, or original", () => {
  const tile = storageAssetUrl(previewAsset, "tile");
  const card = storageAssetUrl(previewAsset, "card");
  const detail = storageAssetUrl(previewAsset, "detail");
  const original = storageAssetUrl(previewAsset, "original");
  assert.match(tile, /\/c_limit,w_480,h_480,f_auto,q_auto:best\/v1234\//);
  assert.match(card, /\/c_limit,w_1200,h_1200,f_auto,q_auto:best\/v1234\//);
  assert.match(detail, /\/c_limit,w_2400,h_2400,f_auto,q_auto:best\/v1234\//);
  assert.equal(original, previewAsset.url);
  assert.equal(resolveAssetUrl(previewAsset, "tile"), tile);
  assert.equal(resolveAssetUrl(previewAsset, "card"), card);
  assert.equal(storageAssetUrl("https://example.com/image.png", "tile"), "https://example.com/image.png");
  assert.equal(storageAssetUrl({ ...previewAsset, resourceType: "video" }, "tile"), previewAsset.url,
    "Never apply an image transform to video");
});

test("Public tile URL inherits the canonical public-media authorization gate and prior presentation", () => {
  const allowed = resolvePortfolioAssetPresentation(previewAsset, { family: "image", type: "image", access: "public-preview" });
  assert.equal(allowed.publicTileUrl, resolveAssetUrl(previewAsset, "tile"));
  assert.equal(allowed.publicCardUrl, resolveAssetUrl(previewAsset, "card"));
  assert.equal(allowed.publicOriginalUrl, previewAsset.url);
  const roundtrip = resolvePortfolioAssetPresentation(allowed, { public: true });
  assert.equal(roundtrip.publicTileUrl, allowed.publicTileUrl);
  assert.equal(roundtrip.publicCardUrl, allowed.publicCardUrl);
  const hidden = resolvePortfolioAssetPresentation(previewAsset, {
    family: "image", type: "image", access: "private", public: false
  });
  assert.equal(hidden.publicTileUrl, "");
  assert.equal(hidden.publicCardUrl, "");
  const external = resolvePortfolioAssetPresentation("https://example.org/photo.png", {
    family: "image", type: "image", access: "public-preview"
  });
  assert.equal(external.publicTileUrl, external.publicCardUrl,
    "Non-managed URLs must not receive fabricated Cloudinary transforms");
});

test("Only truly small multi-image gallery tiles receive responsive srcset; full views and other cards stay unchanged", () => {
  const frameStart = app.indexOf("function publicMediaFrameMarkup(");
  const frameEnd = app.indexOf("\nfunction publicVideoPlaybackSources(", frameStart);
  const tileStart = app.indexOf("function photoCardMediaMarkup(");
  const tileEnd = app.indexOf("\nfunction photoGalleryCardsMarkup(", tileStart);
  assert.ok(frameStart >= 0 && frameEnd > frameStart && tileStart >= 0 && tileEnd > tileStart);
  const frame = app.slice(frameStart, frameEnd);
  const photo = app.slice(tileStart, tileEnd);
  assert.match(frame, /deliveryPurpose === "tile"/, "Canonical media frame must own tile delivery");
  assert.match(frame, /publicTileUrl/, "Must reuse authorized media presentation rather than rewrite a URL");
  assert.match(frame, /480w/, "Browser can use a lightweight Cloudinary derivative for small tiles");
  assert.match(frame, /1200w/, "Browser retains original card quality for large or high-DPR tiles");
  assert.match(frame, /srcset/, "Use responsive browser selection rather than forcing smaller images");
  assert.match(frame, /sizes=/, "Selection must account for actual image display size");
  assert.match(photo, /layout\.variant === "two-columns" \|\| layout\.variant === "quad"/,
    "Only small multi-tile layouts get responsive delivery");
  assert.match(photo, /purpose: tilePurpose/, "Photo gallery must delegate to existing media owner");
  assert.match(app, /data-public-static-fallback="\$\{escapeHtml\(content\.hero\.image\)\}"/);
});
