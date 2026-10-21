import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const owner = (name, nextName) => {
  const start = app.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " must have one existing public owner");
  const end = app.indexOf("\nfunction " + nextName + "(", start);
  assert.ok(end > start, "Expected " + nextName + " after " + name);
  return app.slice(start, end);
};

test("Project card covers fill their thumbnails, preserving original in full details", () => {
  assert.match(css, /\.media\s*\{[^}]*--public-media-fit:\s*cover;/);
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:\s*var\(--public-media-fit,\s*contain\)/);
  assert.match(css, /\.project-detail-cover-frame>\.public-media-frame\{width:100%;height:100%\}/);
  assert.doesNotMatch(css, /\.project-detail-cover-frame\{[^}]*--public-media-fit:\s*cover/);
});

test("Project video previews use the canonical public-media loader, not direct unobserved video tags", () => {
  const card = owner("projectCardMediaMarkup", "projectSingleActionMarkup");
  assert.match(card, /publicVideoFrameMarkup\(/);
  assert.doesNotMatch(card, /<video/);
  assert.match(card, /\{ className: "project-card-video-preview", poster \}/);
  const frame = owner("publicVideoFrameMarkup", "bindPublicMediaFrames");
  assert.match(frame, /autoplay muted loop/);
  assert.match(frame, /playsinline/);
  assert.match(frame, /data-public-media-video/);
  assert.match(frame, /poster=/);
  assert.match(frame, /public-media-frame__poster/);
  assert.match(css, /\.public-media-frame__poster\{/);
});

test("Arbitrary future projects use the same cover and silent-loop video behavior", () => {
  const card = owner("projectCardMediaMarkup", "projectSingleActionMarkup");
  const videoCalls = [];
  const imageCalls = [];
  const render = new Function("mediaUrl", "publicVideoFrameMarkup", "publicMediaFrameMarkup", "escapeHtml",
    card + "\nreturn projectCardMediaMarkup;"
  )(
    x => typeof x === "string" ? x : x?.url || "",
    (...args) => { videoCalls.push(args); return "<shared-video-preview />"; },
    (...args) => { imageCalls.push(args); return "<shared-cover-image />"; },
    s => String(s)
  );
  const withVideo = render({
    id: "unseen-future-project",
    title: "Future custom portfolio",
    demoVideo: { url: "/future/clip.mp4" },
    raw: { coverImage: { url: "/future/cover.jpg" } }
  });
  assert.equal(withVideo, "<shared-video-preview />");
  assert.equal(videoCalls.length, 1);
  assert.equal(videoCalls[0][1], "Future custom portfolio");
  assert.equal(videoCalls[0][2].poster, "/future/cover.jpg");
  const coverOnly = render({ title: "Future without video", raw: { coverImage: "/future/only-cover.jpg" } });
  assert.equal(coverOnly, "<shared-cover-image />");
  assert.equal(imageCalls.length, 1);
});

test("Project video actions share one controllable player with visible loading errors", () => {
  const shared = owner("projectVideoPlayerMarkup", "bindProjectVideoPlayer");
  assert.match(shared, /<video/);
  assert.match(shared, /controls playsinline/);
  assert.match(shared, /src=/);
  assert.doesNotMatch(shared, /autoplay/);
  assert.doesNotMatch(shared, /type="video\/mp4"/);
  const binder = owner("bindProjectVideoPlayer", "openProjectVideoResource");
  assert.match(binder, /addEventListener\("error"/);
  assert.match(binder, /addEventListener\("loadedmetadata"/);
  assert.match(binder, /data-project-video-failure/);
  assert.match(shared, /data-project-video-fallback/);
  const modal = owner("openProjectVideoResource", "openProjectDetailsById");
  assert.match(modal, /projectVideoPlayerMarkup\(/);
  assert.match(modal, /bindProjectVideoPlayer\(/);
  assert.doesNotMatch(modal, /\.play\(\)/);
  const detail = owner("openProjectById", "openResumeChooser");
  assert.match(detail, /projectVideoPlayerMarkup\(/);
  assert.match(detail, /bindProjectVideoPlayer\(/);
});

test("Existing video-source routing and custom-module owners remain unchanged", () => {
  assert.match(app, /function normalizedVideoEmbedUrl\(/);
  assert.match(app, /if \(kind === "video"\)[\s\S]*?publicVideoFrameMarkup\(presentation, item\.title/);
  assert.match(app, /function openDynamicEntry\(/);
});


test("Video previews are always silent/looping and preserve the cover poster on restricted phones", () => {
  const frameSource = owner("publicVideoFrameMarkup", "bindPublicMediaFrames");
  const render = new Function("mediaPresentation", "cleanText", "safeImageSource", "escapeHtml",
    frameSource + "\nreturn publicVideoFrameMarkup;"
  )(
    source => ({ publicDisplayUrl: source?.url || "" }),
    value => String(value || "").trim(),
    value => String(value || ""),
    value => String(value || "")
  );
  const markup = render({ url: "/future/a.mp4" }, "Future preview", { poster: "/future/a.jpg" });
  assert.match(markup, /autoplay muted loop/);
  assert.match(markup, /playsinline/);
  assert.match(markup, /data-public-media-src="\/future\/a\.mp4"/);
  assert.match(markup, /poster="\/future\/a\.jpg"/);
  assert.match(markup, /public-media-frame__poster/);
  assert.doesNotMatch(markup, /controls/);
});

test("Project modal video failure feedback appears on media error, clears on metadata", () => {
  const binderSource = owner("bindProjectVideoPlayer", "openProjectVideoResource");
  const events = {};
  const video = {
    error: null, readyState: 0,
    addEventListener(type, callback) { events[type] = callback; }
  };
  const message = { hidden: true };
  const frame = { querySelector(sel) {
    return sel === "video.blender-player" ? video : sel === "[data-project-video-failure]" ? message : null;
  } };
  const root = { querySelectorAll() { return [frame]; } };
  new Function("root", binderSource.replace("root = document", "root") + "\nbindProjectVideoPlayer(root);")(root);
  assert.equal(message.hidden, true);
  events.error();
  assert.equal(message.hidden, false);
  events.loadedmetadata();
  assert.equal(message.hidden, true);
});


test("Watch Video preserves one-click playback while project detail video stays manually controllable", () => {
  const binder = owner("bindProjectVideoPlayer", "openProjectVideoResource");
  assert.match(binder, /playOnOpen\s*=\s*false/);
  assert.match(binder, /if \(playOnOpen && !video\.error\)/);
  const watch = owner("openProjectVideoResource", "openProjectDetailsById");
  assert.match(watch, /bindProjectVideoPlayer\(document\.querySelector\("#modal"\), \{ playOnOpen: true \}\)/);
  const details = owner("openProjectById", "openResumeChooser");
  assert.doesNotMatch(details, /playOnOpen:\s*true/);
});


test("Project video fallback links allow ordinary media URLs but never executable URL schemes", () => {
  const markupOwner = owner("projectVideoPlayerMarkup", "bindProjectVideoPlayer");
  const markup = new Function("cleanText", "safeImageSource", "escapeHtml", "window",
    markupOwner + "\nreturn projectVideoPlayerMarkup;"
  )(
    value => String(value || "").trim(),
    value => String(value || ""),
    value => String(value || ""),
    { location: { href: "https://example.org/portfolio/" } }
  );
  assert.equal(markup("javascript:alert(1)"), "");
  assert.equal(markup("data:text/html,<script>alert(1)</script>"), "");
  assert.match(markup("assets/videos/clip.mp4"), /https:\/\/example\.org\/portfolio\/assets\/videos\/clip\.mp4/);
  assert.match(markup("https://cdn.example.org/clip.mp4"), /https:\/\/cdn\.example\.org\/clip\.mp4/);
});
