import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function owner(from, to) {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, "Missing canonical owner: " + from);
  return app.slice(start, end);
}

test("Browser discovers existing Firebase modules directly from HTML without duplicated reads", () => {
  const startup = owner("async function initFirebase() {", "\nasync function loadPublicPortfolioData(");
  for (const url of [
    "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js",
    "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js"
  ]) {
    assert.ok(startup.includes('import("' + url + '")'), "Keep existing imported Firebase version");
    assert.ok(html.includes('<link rel="modulepreload" href="' + url + '" crossorigin>'), "Warm module before app import graph");
    assert.equal(html.split('rel="modulepreload" href="' + url + '"').length - 1, 1, "No duplicate preloads");
  }
  assert.ok(html.indexOf('rel="modulepreload"') < html.indexOf('src="app.js"'));
  assert.ok(html.includes('rel="preconnect" href="https://www.gstatic.com" crossorigin'));
  assert.doesNotMatch(html, /rel="preload"[^>]+hero\.card\.webp/, "No hardcoded CMS image");
  assert.equal((startup.match(/loadPublicPortfolioData\(deadline\)/g) || []).length, 1, "No duplicate Firestore read sequence");
});

test("Noncritical lazy media starts low priority without weakening high-priority user-opened images", () => {
  const source = owner("function publicMediaFrameMarkup(", "\nfunction publicVideoPlaybackSources(");
  const make = new Function("mediaPresentation", "cleanText", "escapeHtml",
    source + "\nreturn publicMediaFrameMarkup;")(
      () => ({ publicDisplayUrl: "/media/full.png", publicCardUrl: "/media/card.webp",
               publicDetailUrl: "/media/detail.webp", publicOriginalUrl: "/media/full.png" }),
      value => String(value || "").trim(),
      value => String(value || "")
    );
  const lazy = make("public-image", "Preview");
  assert.match(lazy, /loading="lazy"/);
  assert.match(lazy, /fetchpriority="low"/);
  assert.equal((lazy.match(/fetchpriority=/g) || []).length, 1);
  const opened = make("public-image", "Full view", { purpose: "detail", priority: "high" });
  assert.match(opened, /loading="eager"/);
  assert.match(opened, /fetchpriority="high"/);
  assert.doesNotMatch(opened, /fetchpriority="low"/);
  assert.doesNotMatch(make("public-image", "Immediate", { loading: "eager" }), /fetchpriority="low"/);
});

test("Visibility owner restores normal priority to visible cards, high to modals, and leaves offscreen low", () => {
  const source = owner("function prioritizePublicMediaInView(", "\nfunction syncPublicIntrinsicMediaFrame(");
  const prioritize = new Function("window", "document", source + "\nreturn prioritizePublicMediaInView;")(
    { innerWidth: 1200, innerHeight: 800 },
    { documentElement: { clientWidth: 1200, clientHeight: 800 } }
  );
  const visible = { loading: "lazy", fetchPriority: "low" };
  const distant = { loading: "lazy", fetchPriority: "low" };
  function frame(node, top, bottom) {
    return {
      getBoundingClientRect: () => ({left:10,right:150,top,bottom}),
      querySelector: selector => selector === "[data-public-media-image]" ? node : null
    };
  }
  const near = frame(visible, 100, 220), far = frame(distant, 2000, 2400);
  prioritize({ querySelector: () => null, querySelectorAll: () => [near,far] });
  assert.equal(visible.loading, "eager");
  assert.equal(visible.fetchPriority, "auto");
  assert.equal(distant.loading, "lazy");
  assert.equal(distant.fetchPriority, "low");
  prioritize({
    querySelector: () => ({ getBoundingClientRect: () => ({left:0,right:500,top:0,bottom:500}) }),
    querySelectorAll: () => [near]
  });
  assert.equal(visible.fetchPriority, "high", "User-opened detail gets high priority");
});

test("Hero source remains eager/high, while About and native poster are low and videos stay deferred", () => {
  assert.match(app, /class="hero-img"><img[^\n]+loading="eager" fetchpriority="high" decoding="async"/);
  assert.match(app, /data-public-static-fallback="\$\{escapeHtml\(content\.about\.image\)\}" loading="lazy" decoding="async" fetchpriority="low"/);
  const video = owner("function publicVideoFrameMarkup(", "\nfunction prioritizePublicMediaInView(");
  assert.match(video, /data-public-media-poster[^\n]+loading="lazy" decoding="async" fetchpriority="low"/);
  assert.match(video, /playsinline preload="none"/);
  assert.doesNotMatch(owner("function publicMediaFrameMarkup(", "\nfunction publicVideoPlaybackSources("),
    /new Image\(|IntersectionObserver\(/, "No duplicate image scheduler or event handlers");
});
