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

test("Project screenshot covers remain uncropped in cards and details", () => {
  assert.doesNotMatch(css, /\.media\s*\{[^}]*--public-media-fit:\s*cover/);
  assert.match(css, /\.media\s*>\s*img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:\s*contain/);
  assert.match(css, /\.project-detail-cover-frame>\.public-media-frame\{width:100%;height:100%\}/);
});

test("Project detail cover uses landscape ratio rather than an oversized fixed-height box", () => {
  assert.match(css, /\.project-detail-cover-frame\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /\.project-detail-cover-frame\{[^}]*height:\s*auto/);
  assert.doesNotMatch(css, /\.project-detail-cover-frame\{[^}]*min-height:\s*280px/);
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
  const markup = new Function("cleanText", "safeImageSource", "escapeHtml", "window", "URL",
    markupOwner + "\nreturn projectVideoPlayerMarkup;"
  )(
    value => String(value || "").trim(),
    value => String(value || ""),
    value => String(value || ""),
    { location: { href: "https://example.org/portfolio/" } }, URL
  );
  assert.equal(markup("javascript:alert(1)"), "");
  assert.equal(markup("data:text/html,<script>alert(1)</script>"), "");
  assert.match(markup("assets/videos/clip.mp4"), /https:\/\/example\.org\/portfolio\/assets\/videos\/clip\.mp4/);
  assert.match(markup("https://cdn.example.org/clip.mp4"), /https:\/\/cdn\.example\.org\/clip\.mp4/);
});


test("Shared video frames always expose a real poster while loading on restricted mobile browsers", () => {
  const markup = owner("publicVideoFrameMarkup", "bindPublicMediaFrames");
  assert.match(markup, /data-public-media-poster/);
  assert.match(markup, /preload="none"/);
  const cssOwner = css.slice(css.indexOf(".public-media-frame__fallback"), css.indexOf(".card:hover .media"));
  assert.match(cssOwner, /\.public-media-frame__poster\{[^}]*z-index:\s*1/);
  assert.match(cssOwner, /media-loading[^}]*public-media-frame__video[^}]*opacity:\s*0/);
  assert.match(cssOwner, /media-ready[^}]*public-media-frame__poster[^}]*opacity:\s*0/);
});

test("Shared video frame loader explicitly attempts muted inline autoplay and does not mislabel a policy block as a media error", () => {
  const binder = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  assert.match(binder, /video\.muted\s*=\s*true/);
  assert.match(binder, /video\.playsInline\s*=\s*true/);
  assert.match(binder, /video\.play\(\)/);
  assert.match(binder, /video\.addEventListener\("playing"/);
  assert.match(binder, /video\.addEventListener\("error",\s*fail/);
  assert.match(binder, /catch\([\s\S]*?showPoster\(/);
});

test("Shared video frame suspends offscreen playback without resetting the source or looping downloads", () => {
  const binder = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  assert.match(binder, /video\.pause\(\)/);
  assert.match(binder, /rootMargin:\s*"30% 0px"/);
  assert.match(binder, /if \(frame\.dataset\.publicMediaStarted === "true"\)/);
  assert.doesNotMatch(binder, /video\.src\s*=\s*[^;\n]+[?]/);
  assert.match(binder, /if \(autoplayVideo\)/);
});

test("Public media frame image loading remains owned by the original image branch", () => {
  const binder = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  assert.match(binder, /if \(image\) \{/);
  assert.match(binder, /image\.addEventListener\("error"/);
  assert.match(binder, /image\.addEventListener\("load", ready/);
});


test("Shared video loader starts only near viewport, shows poster on autoplay rejection and resumes when visible", async () => {
  const binderSource = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  const runCase = async (blocked) => {
    let observer;
    class Frame {
      constructor() {
        this.dataset = { publicMediaAutoplay: "true", publicMediaLoading: "lazy" };
        const tokens = new Set(["media-loading"]);
        this.classList = {
          contains: value => tokens.has(value),
          add: (...values) => values.forEach(value => tokens.add(value)),
          remove: (...values) => values.forEach(value => tokens.delete(value))
        };
      }
      querySelector(query) {
        if (query === "[data-public-media-image]") return null;
        if (query === "[data-public-media-video]") return video;
        return null;
      }
      getBoundingClientRect() { return { top: 2400, bottom: 2600 }; }
    }
    class Observer {
      constructor(callback) { this.callback = callback; observer = this; this.disconnected = false; }
      observe() {}
      disconnect() { this.disconnected = true; }
      fire(visible) { this.callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]); }
    }
    const handlers = {};
    const video = {
      dataset: { publicMediaSrc: "/media/future-video.webm" },
      muted: false, playsInline: false, paused: true, readyState: 0,
      playCalls: 0, pauseCalls: 0, attrs: {},
      hasAttribute(name) { return name === "autoplay"; },
      getAttribute(name) { return this.attrs[name] || ""; },
      setAttribute(name, value) { this.attrs[name] = value; },
      querySelector() { return null; },
      addEventListener(name, listener) { handlers[name] = listener; },
      load() { this.loadCalls = (this.loadCalls || 0) + 1; },
      play() {
        this.playCalls += 1;
        if (blocked) return Promise.reject(new Error("NotAllowedError"));
        this.paused = false;
        return Promise.resolve();
      },
      pause() { this.pauseCalls += 1; this.paused = true; }
    };
    const frame = new Frame();
    const doc = { documentElement: { clientHeight: 800 }, querySelectorAll() { return [frame]; } };
    const win = { innerHeight: 800, clearTimeout() {}, setTimeout() { return 1; } };
    const bind = new Function("document", "window", "HTMLElement", "IntersectionObserver",
      binderSource + "\nreturn bindPublicMediaFrames;"
    )(doc, win, Frame, Observer);
    bind(doc);
    assert.equal(video.loadCalls || 0, 0, "Offscreen videos must not fetch");
    assert.equal(video.playCalls, 0);
    observer.fire(true);
    assert.equal(video.loadCalls, 1);
    assert.equal(video.playCalls, 1);
    assert.equal(video.muted, true);
    assert.equal(video.playsInline, true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    if (blocked) {
      assert.equal(frame.classList.contains("media-loading"), true, "Autoplay block leaves poster visible");
      assert.equal(frame.classList.contains("media-fallback"), false, "Browser policy is not a corrupt video");
    } else {
      assert.equal(frame.classList.contains("media-ready"), true);
      assert.equal(observer.disconnected, false, "Visibility watcher remains for pause/resume");
      observer.fire(false);
      assert.equal(video.pauseCalls, 1);
      assert.equal(frame.classList.contains("media-loading"), true);
      observer.fire(true);
      assert.equal(video.loadCalls, 1, "Resume must not re-download source");
      assert.equal(video.playCalls, 2);
    }
  };
  await runCase(false);
  await runCase(true);
});


test("Canonical asset resolver serves browser-negotiated Cloudinary videos while preserving originals", () => {
  const assetSource = readFileSync(new URL("../storage-asset.js", import.meta.url), "utf8");
  const resolve = new Function("URL", assetSource.replaceAll("export function ", "function ") + "\nreturn storageAssetUrl;")(URL);
  const original = "https://res.cloudinary.com/demo/video/upload/v12345/future-project.mp4";
  const video = { provider: "cloudinary", resourceType: "video", type: "upload", access: "public-preview", url: original };
  const optimized = "https://res.cloudinary.com/demo/video/upload/q_auto/f_auto:video/v12345/future-project.mp4";
  assert.equal(resolve(video), optimized);
  assert.equal(resolve(video, "preview"), optimized);
  assert.equal(resolve(video, "card"), optimized);
  assert.equal(resolve(video, "detail"), optimized);
  assert.equal(resolve(video, "original"), original);
  assert.equal(resolve(video, "download"), original);
});

test("Canonical video optimization does not rewrite unrelated providers or private URLs", () => {
  const assetSource = readFileSync(new URL("../storage-asset.js", import.meta.url), "utf8");
  const resolve = new Function("URL", assetSource.replaceAll("export function ", "function ") + "\nreturn storageAssetUrl;")(URL);
  const original = "https://res.cloudinary.com/demo/video/upload/v12345/future-project.mp4";
  assert.equal(resolve({ provider: "cloudinary", resourceType: "video", type: "authenticated", url: original }), original);
  assert.equal(resolve({ provider: "cloudinary", resourceType: "video", type: "upload", access: "private", url: original }), original);
  assert.equal(resolve({ provider: "cloudinary", resourceType: "video", type: "upload", access: "metadata-only", url: original }), original);
  assert.equal(resolve({ provider: "cloudinary", resourceType: "video", type: "upload", access: "public-download", url: original }), original);
  const image = "https://res.cloudinary.com/demo/image/upload/v12345/project.jpg";
  assert.equal(resolve({ provider: "cloudinary", resourceType: "image", url: image }), image);
  const alreadyOptimized = "https://res.cloudinary.com/demo/video/upload/q_auto/f_auto:video/v1/clip.mp4";
  assert.equal(resolve({ provider: "cloudinary", resourceType: "video", url: alreadyOptimized }), alreadyOptimized);
  assert.equal(resolve("assets/videos/local-video.mp4"), "assets/videos/local-video.mp4");
});


test("Loading video frames cannot be exposed by a later generic media-loading CSS rule", () => {
  assert.match(css, /\.public-media-frame--video\.media-loading>\.public-media-frame__video\{opacity:0;visibility:hidden\}/);
  assert.doesNotMatch(css, /\.public-media-frame\.media-loading>:is\(\.public-media-frame__image,\.public-media-frame__video\)\{opacity:1;visibility:visible\}/);
  assert.match(css, /\.public-media-frame\.media-loading>\.public-media-frame__image\{opacity:1;visibility:visible\}/);
});

test("Project video poster picks the first publicly renderable cover, not merely a truthy inaccessible asset", () => {
  const card = owner("projectCardMediaMarkup", "projectSingleActionMarkup");
  const calls = [];
  const render = new Function("mediaUrl", "publicVideoFrameMarkup", "publicMediaFrameMarkup",
    card + "\nreturn projectCardMediaMarkup;"
  )(
    asset => asset?.denied ? "" : typeof asset === "string" ? asset : (asset?.url || ""),
    (_video, _title, options) => { calls.push(options); return "VIDEO"; },
    () => "IMAGE"
  );
  const result = render({
    title: "Any future Project",
    demoVideo: { url: "/video.mp4" },
    raw: { coverImage: { denied: true, url: "/private.jpg" } },
    image: "/public-cover.jpg"
  });
  assert.equal(result, "VIDEO");
  assert.equal(calls[0].poster, "/public-cover.jpg");
});


test("Shared image validator permits safe site-relative Project video posters without trusting executable URLs", () => {
  const start = app.indexOf('const safeImageSource = (value = "") => {');
  assert.ok(start >= 0);
  const end = app.indexOf("\n};", start);
  assert.ok(end > start);
  const getSafe = new Function("cleanText",
    app.slice(start, end + 3) + "\nreturn safeImageSource;"
  )(value => String(value || "").trim());
  for (const source of [
    "assets/images/future-project-cover.jpg",
    "my-folder/cover-2027.webp?size=small",
    "./assets/images/local.png",
    "../assets/images/local.png",
    "/assets/images/local.png",
    "https://cdn.example.com/cover.webp"
  ]) assert.equal(getSafe(source), source);
  for (const source of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//attacker.example.com/cover.png",
    "file:///private.jpg",
    "assets\\evil.jpg"
  ]) assert.equal(getSafe(source), "");
});


test("Project cover uses one resolved image URL for uncropped foreground and soft ambient fill", () => {
  const frame = owner("publicMediaFrameMarkup", "publicVideoFrameMarkup");
  const render = new Function("mediaPresentation","cleanText","escapeHtml",
    frame + "\nreturn publicMediaFrameMarkup;"
  )(
    source => ({ publicCardUrl: source, publicDisplayUrl: source, publicOriginalUrl: source }),
    value => String(value || "").trim(),
    value => String(value || "")
  );
  const src = "/assets/images/new-project-screenshot.webp";
  const markup = render(src, "Future Project", { className: "public-media-frame--project-cover", ambientBackdrop: true });
  assert.match(markup, /public-media-frame__ambient/);
  assert.match(markup, /aria-hidden="true"/);
  assert.equal(markup.split(src).length - 1, 2);
  assert.match(markup, /public-media-frame__image[^>]*alt="Future Project"/);
  const photoMarkup = render(src, "Photo Editing", { className:"public-media-frame--cover" });
  assert.doesNotMatch(photoMarkup, /public-media-frame__ambient/);
  const card = owner("projectCardMediaMarkup", "projectSingleActionMarkup");
  assert.match(card, /ambientBackdrop:\s*true/);
  assert.match(css, /\.public-media-frame__ambient\{[^}]*object-fit:cover/);
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:contain/);
  assert.match(css, /\.public-media-frame\.media-fallback>.public-media-frame__ambient\{display:none\}/);
});


test("Public video source resolution exposes original retry only for an allowed public media asset", () => {
  const resolver = owner("publicVideoPlaybackSources", "publicVideoFrameMarkup");
  const resolve = new Function("mediaPresentation", "cleanText", "window", resolver + "\nreturn publicVideoPlaybackSources;")(
    asset => asset,
    value => String(value || "").trim(),
    { location: { href: "https://portfolio.example/" } }
  );
  const optimized = "https://res.cloudinary.com/demo/video/upload/q_auto/f_auto:video/v1/clip.mp4";
  const original = "https://res.cloudinary.com/demo/video/upload/v1/clip.mp4";
  assert.deepEqual(resolve({ publicDisplayUrl: optimized, publicOriginalUrl: original }), { url: optimized, fallbackUrl: original });
  assert.deepEqual(resolve({ publicDisplayUrl: optimized, publicOriginalUrl: "" }), { url: optimized, fallbackUrl: "" });
  assert.deepEqual(resolve({ publicDisplayUrl: optimized, publicOriginalUrl: "javascript:alert(1)" }), { url: optimized, fallbackUrl: "" });
  assert.deepEqual(resolve({ publicDisplayUrl: original, publicOriginalUrl: original }), { url: original, fallbackUrl: "" });
});

test("Public card video retries failed optimized media once without adding a Firestore request", () => {
  const markup = owner("publicVideoFrameMarkup", "bindPublicMediaFrames");
  const binder = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  assert.match(markup, /data-public-media-fallback-src/);
  assert.match(binder, /publicMediaFallbackTried/);
  assert.match(binder, /video\.addEventListener\("error",\s*retryVideoSource\)/);
  assert.match(binder, /video\.setAttribute\("src", fallbackSource\)/);
  assert.match(binder, /video\.load\(\)/);
  assert.doesNotMatch(binder, /getDoc\(|getDocs\(|onSnapshot\(|query\(/);
});

test("Project detail player uses the same authorized one-time media retry and safe fallback link", () => {
  const markup = owner("projectVideoPlayerMarkup", "bindProjectVideoPlayer");
  const binder = owner("bindProjectVideoPlayer", "openProjectVideoResource");
  const action = owner("openProjectVideoResource", "openProjectDetailsById");
  assert.match(markup, /data-project-video-fallback-src/);
  assert.match(binder, /projectVideoFallbackTried/);
  assert.match(binder, /video\.addEventListener\("error",\s*retryVideoSource\)/);
  assert.match(binder, /video\.src\s*=\s*fallbackSource/);
  assert.match(binder, /failure\.hidden\s*=\s*false/);
  assert.match(action, /publicVideoPlaybackSources\(/);
  assert.doesNotMatch(binder, /getDoc\(|getDocs\(|onSnapshot\(/);
});
