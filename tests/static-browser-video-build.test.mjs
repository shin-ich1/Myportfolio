import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Every static MP4 gets a generic web-readiness gate without project-specific names", () => {
  const script = read("scripts/prepare-static-videos.mjs");
  assert.match(script, /inspectBrowserVideoFile/);
  assert.match(script, /readdir/);
  assert.match(script, /ffprobe/);
  assert.match(script, /prepare-browser-video\.mjs/);
  assert.match(script, /rename\(/);
  assert.doesNotMatch(script, /ferrari|blender-animation/i);
});

test("The GitHub media preparation only writes inside the isolated branch and never deploys", () => {
  const workflow = read(".github/workflows/prepare-static-media.yml");
  assert.match(workflow, /refs\/heads\/fix\/media-compatibility-canonical-20261022/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /prepare-static-videos\.mjs/);
  assert.doesNotMatch(workflow, /firebase.*deploy|hosting:channel:deploy|--force/i);
});
