import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const app = read("app.js");
const css = read("styles.css");
const owner = (name, next) => {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(`\nfunction ${next}(`, start);
  assert.ok(start >= 0 && end > start, `canonical ${name} owner must exist`);
  return app.slice(start, end);
};

function renderImage({ fillBackdrop = false, publicCardUrl = "/covers/future-portrait.png" } = {}) {
  const fn = new Function("mediaPresentation", "cleanText", "escapeHtml", `${owner("publicMediaFrameMarkup", "publicVideoPlaybackSources")}\nreturn publicMediaFrameMarkup;`)(
    () => ({ publicCardUrl, publicDisplayUrl: publicCardUrl, publicOriginalUrl: publicCardUrl }),
    String,
    (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  );
  return fn({ url: publicCardUrl }, "Portrait cover", { className: "public-media-frame--cover", fillBackdrop });
}

test("Standalone Project and dynamic-module single covers request the same opt-in ambient treatment", () => {
  const project = owner("projectCardMediaMarkup", "projectSingleActionMarkup");
  const moduleCard = owner("dynamicModuleCardMediaMarkup", "dynamicModuleUsesContentBudget");
  assert.match(project, /publicMediaFrameMarkup\(coverSource, project\.title, \{[^}]*fillBackdrop:\s*true/);
  assert.match(moduleCard, /publicMediaFrameMarkup\(presentation, item\.title, \{[^}]*fillBackdrop:\s*true/);
  assert.doesNotMatch(project, /publicVideoFrameMarkup\([^\n]*fillBackdrop/);
  assert.doesNotMatch(moduleCard, /publicVideoFrameMarkup\([^\n]*fillBackdrop/);
});

test("Shared image renderer supplies a decorative backdrop only on opted-in covers, without an eager duplicate image URL", () => {
  const requested = renderImage({ fillBackdrop: true });
  assert.match(requested, /data-public-media-ambient/);
  assert.match(requested, /public-media-frame__image[^>]*src="\/covers\/future-portrait.png"/);
  assert.doesNotMatch(requested, /data-public-media-ambient[^>]*\bsrc=/);
  assert.doesNotMatch(renderImage(), /data-public-media-ambient/);
});

test("Foreground retains entire screenshot and backdrop stays decorative, hidden on image failure", () => {
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:contain/);
  assert.match(css, /\.public-media-frame__ambient\{[^}]*object-fit:cover/);
  assert.match(css, /\.public-media-frame\.media-fallback[^\n]*\.public-media-frame__ambient/);
  const binder = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  assert.match(binder, /data-public-media-ambient/);
  assert.match(binder, /image\.addEventListener\("load",/);
  assert.match(binder, /ambient\.setAttribute\("src", image\.currentSrc \|\| image\.src\)/);
});
