import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Project video frame cannot be reset to block layout by a legacy selector", () => {
  const css = source("styles.css");
  const app = source("app.js");
  assert.match(app, /publicVideoFrameMarkup\(videoSource, project\.title/);
  assert.match(css, /\.public-media-frame\{[^}]*display:grid/);
  assert.doesNotMatch(css, /\.media\s+\.project-card-video-preview\s*\{/);
});

test("An already-failed modal media element takes the same fallback path as an error event", () => {
  const app = source("app.js");
  const fn = app.slice(app.indexOf("function bindProjectVideoPlayer("), app.indexOf("function openProjectVideoResource("));
  assert.match(fn, /video\.addEventListener\("error", retryVideoSource\)/);
  assert.match(fn, /if\s*\(video\.error\)\s*retryVideoSource\(\)/);
});

test("Cloudinary's managed public compatible video has an explicit H264 level while original remains intact", () => {
  const assets = source("storage-asset.js");
  assert.match(assets, /vc_h264:main:4\.1/);
  assert.match(assets, /lower\(asset\.provider\)\s*!==\s*'cloudinary'/);
  assert.match(assets, /asset\.access/);
});

test("Upload route checks browser decode suitability before a public video is saved", () => {
  const upload = source("admin/services/storageUploadService.js");
  assert.match(upload, /inspectBrowserVideoFile/);
  assert.match(upload, /route\.family === 'video'/);
  assert.match(upload, /route\.profile\.provider/);
});

test("Browser compatibility inspector is shared and rejects unsuitable files", async () => {
  const { inspectBrowserVideoFile } = await import("../video-compatibility.js");
  const box = (kind, payload) => {
    const arr = new Uint8Array(8 + payload.length);
    const view = new DataView(arr.buffer);
    view.setUint32(0, arr.length);
    for (let i=0; i<4; i++) arr[4+i] = kind.charCodeAt(i);
    arr.set(payload, 8);
    return arr;
  };
  const merge = (...pieces) => {
    const out = new Uint8Array(pieces.reduce((n,x) => n+x.length,0));
    let k=0; for(const p of pieces) {out.set(p,k);k+=p.length;}
    return out;
  };
  const sample = (profile, level, { fastStart=true, codec="avc1" }={}) => {
    const codecTag = new Uint8Array([...codec].map((c)=>c.charCodeAt(0)));
    const config = box("avcC", new Uint8Array([1,profile,0,level,255,225]));
    const moov = box("moov", merge(codecTag, config));
    const mdat = box("mdat", new Uint8Array(80));
    const ftyp = box("ftyp", new Uint8Array(12));
    const bytes = merge(ftyp, ...(fastStart?[moov,mdat]:[mdat,moov]));
    const blob = new Blob([bytes], { type:"video/mp4" });
    blob.name="sample.mp4";
    return blob;
  };
  assert.equal((await inspectBrowserVideoFile(sample(100,41))).compatible, true);
  assert.equal((await inspectBrowserVideoFile(sample(100,60))).compatible, false);
  assert.equal((await inspectBrowserVideoFile(sample(100,41,{fastStart:false}))).compatible, false);
  assert.equal((await inspectBrowserVideoFile(sample(100,41,{codec:"hvc1"}))).compatible, false);
});
