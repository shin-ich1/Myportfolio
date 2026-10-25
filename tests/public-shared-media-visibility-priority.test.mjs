import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const start = app.indexOf("function prioritizePublicMediaInView(");
const end = app.indexOf("\nfunction bindPublicMediaFrames(", start);
function loadOwner() {
  assert.ok(start >= 0 && end > start, "Visibility-based priority must be owned once beside the canonical Public media binder");
  return new Function("window", "document", app.slice(start, end) + "\nreturn prioritizePublicMediaInView;")(
    { innerWidth: 400, innerHeight: 850 },
    { documentElement: { clientWidth: 400, clientHeight: 850 } }
  );
}

function rect(top, bottom, left = 0, right = 380) { return { top, bottom, left, right }; }
function mediaFrame(bounds, { image = false, poster = false, video = false } = {}) {
  const nodes = {
    "[data-public-media-image]": image ? { loading: "lazy", fetchPriority: "auto" } : null,
    "[data-public-media-poster]": poster ? { loading: "lazy", fetchPriority: "auto" } : null,
    "[data-public-media-video]": video ? { preload: "none", attrs: {}, getAttribute(name) { return this.attrs[name] || ""; } } : null
  };
  return {
    nodes,
    getBoundingClientRect() { return bounds; },
    querySelector(selector) { return nodes[selector] || null; }
  };
}
function root(frames, viewer = null) {
  return {
    querySelector(selector) { return selector === ".modal-box" ? viewer : null; },
    querySelectorAll(selector) { return selector === "[data-public-media-frame]" ? frames : []; }
  };
}

test("Any current or future modal image gets eager/high priority only when visible", () => {
  const prioritize = loadOwner();
  const visible = mediaFrame(rect(210, 520), { image: true });
  const offscreen = mediaFrame(rect(1250, 1600), { image: true });
  prioritize(root([visible, offscreen], { getBoundingClientRect: () => rect(120, 700) }));
  assert.equal(visible.nodes["[data-public-media-image]"].loading, "eager");
  assert.equal(visible.nodes["[data-public-media-image]"].fetchPriority, "high");
  assert.equal(offscreen.nodes["[data-public-media-image]"].loading, "lazy");
  assert.equal(offscreen.nodes["[data-public-media-image]"].fetchPriority, "auto");
});

test("Visible video posters prioritize quickly but never preload all future videos", () => {
  const prioritize = loadOwner();
  const visible = mediaFrame(rect(220, 480), { poster: true, video: true });
  const offscreen = mediaFrame(rect(900, 1100), { poster: true, video: true });
  prioritize(root([visible, offscreen], { getBoundingClientRect: () => rect(120, 700) }));
  assert.equal(visible.nodes["[data-public-media-poster]"].loading, "eager");
  assert.equal(visible.nodes["[data-public-media-poster]"].fetchPriority, "high");
  assert.equal(offscreen.nodes["[data-public-media-poster]"].loading, "lazy");
  assert.equal(visible.nodes["[data-public-media-video]"].preload, "none");
  assert.equal(visible.nodes["[data-public-media-video]"].getAttribute("src"), "");
});

test("Public card images and video posters become eager only when already visible", () => {
  const prioritize = loadOwner();
  const card = mediaFrame(rect(40, 240), { image: true });
  const videoPoster = mediaFrame(rect(260, 450), { poster: true, video: true });
  const far = mediaFrame(rect(2000, 2200), { image: true, poster: true, video: true });
  prioritize(root([card, videoPoster, far]));
  assert.equal(card.nodes["[data-public-media-image]"].loading, "eager");
  assert.equal(card.nodes["[data-public-media-image]"].fetchPriority, "auto", "Not every card should compete at high priority");
  assert.equal(videoPoster.nodes["[data-public-media-poster]"].loading, "eager");
  assert.equal(videoPoster.nodes["[data-public-media-video]"].preload, "none");
  assert.equal(far.nodes["[data-public-media-image]"].loading, "lazy");
  assert.equal(far.nodes["[data-public-media-poster]"].loading, "lazy");
});

test("Shared loader is the one owner for all frames; module markup is not the priority authority", () => {
  const bindStart = app.indexOf("function bindPublicMediaFrames(");
  const bindEnd = app.indexOf("\nfunction projectCardMediaMarkup(", bindStart);
  assert.ok(bindStart > 0 && bindEnd > bindStart);
  assert.match(app.slice(bindStart, bindEnd), /prioritizePublicMediaInView\(root\)/);
  const modalStart = app.indexOf("function photoEditingDetailMediaMarkup(");
  const modalEnd = app.indexOf("\nfunction photoEditingDetailNavigation(", modalStart);
  assert.ok(modalStart > 0 && modalEnd > modalStart);
  assert.doesNotMatch(app.slice(modalStart, modalEnd), /priority:\s*"high"|loading:\s*"eager"/,
    "Photo Editing must delegate visible priority to the shared media owner");
});
