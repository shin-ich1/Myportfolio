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

test("Public first-screen portrait gets browser download priority without changing its source", () => {
  assert.match(app, /class="hero-img"><img src="\$\{escapeHtml\(content\.hero\.image\)\}"[^>]*loading="eager"[^>]*fetchpriority="high"[^>]*decoding="async"/);
});

test("Public document warms media and Firebase module origins without preloading videos", () => {
  assert.match(html, /rel="preconnect" href="https:\/\/res\.cloudinary\.com"/);
  assert.match(html, /rel="preconnect" href="https:\/\/www\.gstatic\.com"/);
  assert.doesNotMatch(html, /rel="preload"[^>]+as="video"/);
});
