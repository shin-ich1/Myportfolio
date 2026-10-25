import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function owner(name, next) {
  const start = app.indexOf("function " + name + "(");
  const end = app.indexOf("\nfunction " + next + "(", start);
  assert.ok(start >= 0 && end > start, "Expected canonical function boundaries: " + name);
  return app.slice(start, end);
}

test("Shared Public image binder publishes intrinsic aspect for landscape, square, portrait and every future image", () => {
  const source = owner("syncPublicIntrinsicMediaFrame", "bindPublicMediaFrames");
  const update = new Function(source + "\nreturn syncPublicIntrinsicMediaFrame;")();
  for (const [width, height] of [[1600, 900], [1000, 1000], [900, 1600], [2400, 800]]) {
    const props = new Map();
    const frame = {
      classList: { contains: name => name === "public-media-frame--intrinsic" },
      style: { setProperty: (name, value) => props.set(name, value) }
    };
    update(frame, { naturalWidth: width, naturalHeight: height });
    assert.equal(props.get("--public-media-intrinsic-aspect"), width + " / " + height);
    assert.equal(Number(props.get("--public-media-intrinsic-ratio")), width / height);
    // For every viewport, the fitted frame can never exceed the available width or height.
    for (const [availableWidth, availableHeight] of [[350, 600], [750, 700], [1100, 640]]) {
      const ratio = Number(props.get("--public-media-intrinsic-ratio"));
      const fittedWidth = Math.min(availableWidth, availableHeight * ratio);
      const fittedHeight = fittedWidth / ratio;
      assert.ok(fittedWidth <= availableWidth + .001 && fittedHeight <= availableHeight + .001);
    }
  }
});

test("Shared media intrinsic geometry is opt-in, ignores invalid dimensions and works on image-load retries", () => {
  const source = owner("syncPublicIntrinsicMediaFrame", "bindPublicMediaFrames");
  const update = new Function(source + "\nreturn syncPublicIntrinsicMediaFrame;")();
  const properties = [];
  const frame = {
    classList: { contains: name => name === "public-media-frame--intrinsic" },
    style: { setProperty: (name, value) => properties.push([name, value]) }
  };
  update(frame, { naturalWidth: 0, naturalHeight: 0 });
  assert.equal(properties.length, 0);
  update(frame, { naturalWidth: 800, naturalHeight: 600 });
  update(frame, { naturalWidth: 1920, naturalHeight: 1080 });
  assert.equal(properties.at(-2)[1], "1920 / 1080", "Fallback image may have a new intrinsic ratio");
  const nonIntrinsic = { classList: { contains: () => false }, style: { setProperty: () => { throw Error("should not run"); } } };
  update(nonIntrinsic, { naturalWidth: 1920, naturalHeight: 1080 });
  const binder = owner("bindPublicMediaFrames", "projectCardMediaMarkup");
  assert.match(binder, /syncPublicIntrinsicMediaFrame\(frame, image\)/);
  assert.match(binder, /image\.addEventListener\("load", syncAmbient\)/,
    "Reuse existing load listener and do not add competing media handlers");
});

test("One reusable intrinsic frame layout constrains width and height without forced portrait/landscape letterbox", () => {
  assert.match(css, /\.public-media-frame--intrinsic\s*\{[^}]*aspect-ratio:\s*var\(--public-media-intrinsic-aspect/);
  assert.match(css, /\.public-media-frame--intrinsic\s*\{[^}]*--public-media-intrinsic-ratio/);
  assert.match(css, /\.public-media-frame--intrinsic\s*\{[^}]*height:\s*auto/);
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:contain/);
  assert.doesNotMatch(css, /\.photo-detail-single-stage\s*>\s*\.public-media-frame\s*\{[^}]*(?:height:min\(|min-height:)/,
    "Remove the previous fixed-height stage at its original owner");
  assert.doesNotMatch(css, /html\[data-lan-public-mode="mobile"\]\s+\.photo-detail-single-stage\s*>\s*\.public-media-frame/,
    "No mobile-only dimensions overriding the shared responsive media contract");
  assert.doesNotMatch(css, /html\[data-lan-public-mode="mobile"\]\s+\.photo-detail-media--single\s*\{[^}]*min-height:/,
    "No oversized mobile minimum height on natural media stages");
});

test("Single-image modal uses shared intrinsic sizing, while comparisons and galleries retain their existing semantic media owners", () => {
  const view = owner("photoEditingDetailMediaMarkup", "photoEditingDetailNavigation");
  assert.match(view, /sizing:\s*"intrinsic"/);
  assert.equal((view.match(/sizing:\s*"intrinsic"/g) || []).length, 1,
    "Only the unconstrained single media stage needs intrinsic sizing");
  const frame = owner("publicMediaFrameMarkup", "publicVideoPlaybackSources");
  assert.match(frame, /sizing\s*=\s*"fixed"/);
  assert.match(frame, /public-media-frame--intrinsic/);
  assert.match(frame, /public-media-frame__image/);
});

test("Photo Editing navigation owns a layout row, not floating buttons over the image", () => {
  const view = owner("openPhotoEditingSource", "setupPhotoDetailGalleryViewer");
  assert.match(view, /photo-detail-record-nav-row/);
  assert.doesNotMatch(view, /show\(\x60\$\{recordNavigation\}<article/,
    "Previous/next buttons must not be modal siblings positioned over the picture");
  assert.match(css, /\.photo-detail-record-nav-row\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.photo-detail-record-nav\s*\{[^}]*position:\s*static/);
  assert.doesNotMatch(css, /\.photo-detail-record-nav\s*\{[^}]*top:\s*50%/,
    "Remove the old competing absolute vertical-centering owner");
});
