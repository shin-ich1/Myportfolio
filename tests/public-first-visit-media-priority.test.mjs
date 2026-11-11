import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function owner(name, next) {
  const start = app.indexOf(name);
  const end = app.indexOf(next, start);
  assert.ok(start >= 0 && end > start, "Expected canonical Public owner boundaries");
  return app.slice(start, end);
}

test("Public video card posters use the existing card rendition, not the full display image", () => {
  const urlOwner = owner("const mediaUrl =", "\nfunction browserPdfViewerSource(");
  const mediaUrl = new Function("mediaPresentation", "cleanText",
    urlOwner + "\nreturn mediaUrl;"
  )(
    () => ({ publicDisplayUrl: "/media/original-large.png", publicCardUrl: "/media/optimized-card.webp" }),
    value => String(value || "").trim()
  );
  assert.equal(mediaUrl("image"), "/media/original-large.png", "Other callers retain the existing display source");
  assert.equal(mediaUrl("image", { delivery: "card" }), "/media/optimized-card.webp");
  assert.equal(mediaUrl("image", { delivery: "card" }), "/media/optimized-card.webp", "No cache-busting URL variation");
  const card = owner("function projectCardMediaMarkup(", "\nfunction projectSingleActionMarkup(");
  assert.match(card, /delivery:\s*"card"/, "Video-card poster must request the existing card rendition");
});

test("Public first-screen portrait uses optimized card delivery, original fallback, and browser priority", () => {
  assert.match(app, /class="hero-img"><img src="\$\{escapeHtml\(mediaUrl\(staticImageRendition\(content\.hero\.image, "card"\), \{ delivery: "card" \}\)\)\}"[^>]*data-public-static-fallback="\$\{escapeHtml\(content\.hero\.image\)\}"[^>]*loading="eager"[^>]*fetchpriority="high"[^>]*decoding="async"/);
});

test("Public document warms media and Firebase module origins without preloading videos", () => {
  assert.match(html, /rel="preconnect" href="https:\/\/res\.cloudinary\.com"/);
  assert.match(html, /rel="preconnect" href="https:\/\/www\.gstatic\.com"/);
  assert.doesNotMatch(html, /rel="preload"[^>]+as="video"/);
});


function webpDimensions(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  const codec = bytes.toString("ascii", 12, 16);
  if (codec === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (codec === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (codec === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error("Unexpected WebP format for prepared Hero");
}

test("Prepared Hero publishes its exact intrinsic dimensions for layout reservation", async () => {
  const { STATIC_IMAGE_RENDITIONS } = await import("../static-image-renditions.js");
  const image = STATIC_IMAGE_RENDITIONS["assets/images/hero.png"];
  assert.ok(image, "Hero rendition must exist");
  const actual = webpDimensions("../assets/images/hero.card.webp");
  assert.deepEqual({ width: image.width, height: image.height }, actual,
    "Hero dimension hints must match actual published card bytes without distorting the portrait");
});

test("Public Hero markup reserves portrait dimensions before loading without a new fixed-size CSS override", () => {
  assert.match(app, /function portraitIntrinsicDimensions\(/, "Canonical portrait metadata owner must exist");
  assert.match(app, /portraitDimensions:\s*portraitIntrinsicDimensions\(/,
    "Preserve source image width and height before converting its reference to a URL");
  assert.match(app, /imageDimensions:\s*home\.portraitDimensions/,
    "Hero renderer must receive intrinsic metadata");
  const hero = app.split("\n").find(line => line.includes('class="hero-img"><img')) || "";
  assert.ok(hero.includes('${portraitDimensionAttributes(content.hero.imageDimensions)} data-public-static-fallback'),
    "Native image must receive width and height before its first paint");
  assert.doesNotMatch(app, /hero-img[^\n]*style="(?:width|height|aspect-ratio)/,
    "Keep existing responsive layout rather than inventing a CSS override");
});


test("Managed replacement portraits inherit their own dimensions and legacy unknown URLs are not guessed", async () => {
  const { normalizeStorageAsset } = await import("../storage-asset.js");
  const { staticImageDimensions } = await import("../static-image-renditions.js");
  const source = owner("function portraitIntrinsicDimensions(", "\nfunction browserPdfViewerSource(");
  const helpers = new Function("normalizeStorageAsset", "staticImageDimensions",
    source + "\nreturn { portraitIntrinsicDimensions, portraitDimensionAttributes };"
  )(normalizeStorageAsset, staticImageDimensions);
  assert.deepEqual(helpers.portraitIntrinsicDimensions("assets/images/hero.png"), {width:960,height:1443});
  assert.deepEqual(helpers.portraitIntrinsicDimensions("./assets/images/hero.png"), {width:960,height:1443});
  const portrait = {provider:"cloudinary", resourceType:"image",
    url:"https://res.cloudinary.com/lan/image/upload/v1/hero.png",
    width:1800, height:2700};
  assert.deepEqual(helpers.portraitIntrinsicDimensions(portrait), {width:1800,height:2700});
  assert.equal(helpers.portraitDimensionAttributes(helpers.portraitIntrinsicDimensions(portrait)),
    ' width="1800" height="2700" style="--portrait-render-width:min(1802px,calc(2px + (var(--portrait-max-height) - 2px) * 1800 / 2700))"');
  assert.equal(helpers.portraitIntrinsicDimensions("https://example.com/unknown.jpg"), null,
    "Do not invent geometry for dimensionless external images");
  assert.equal(helpers.portraitDimensionAttributes({width:0,height:2700}), "");
  assert.equal(helpers.portraitDimensionAttributes({width:Infinity,height:2700}), "");
  assert.equal(helpers.portraitDimensionAttributes({width:90000,height:2700}), "");
});
