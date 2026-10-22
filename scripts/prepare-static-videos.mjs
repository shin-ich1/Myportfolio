#!/usr/bin/env node
/**
 * Prepare all tracked site-hosted MP4 assets for predictable direct playback.
 * Isolated GitHub Actions branch ONLY; leaves production/main unchanged.
 * Source bytes remain available in Git history, while URLs remain stable.
 *
 * Never run this on the production branch. The upload path for future
 * Admin-managed media is owned separately by storageUploadService.js.
 */
import { File } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { inspectBrowserVideoFile } from "../video-compatibility.js";

const ISOLATED_REF = "refs/heads/fix/media-compatibility-canonical-20261022";
const ROOT = resolve("assets/videos");
const OUTPUT_DIR = resolve(".lan-staging/static-video-preparation");

function execute(command, args, options = {}) {
  const processResult = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024, ...options });
  if (processResult.error || processResult.status !== 0) {
    throw new Error(command + " failed: " + (processResult.stderr || processResult.error?.message || processResult.status));
  }
  return processResult.stdout || "";
}

function probe(filePath) {
  const raw = execute("ffprobe", [
    "-v", "error", "-show_entries",
    "stream=codec_type,codec_name,profile,level,pix_fmt,width,height,avg_frame_rate:format=duration",
    "-of", "json", filePath
  ]);
  const metadata = JSON.parse(raw);
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const video = streams.find(stream => stream.codec_type === "video");
  const audio = streams.filter(stream => stream.codec_type === "audio");
  const [num, den] = String(video?.avg_frame_rate || "0/1").split("/").map(Number);
  const fps = den > 0 ? num / den : Infinity;
  const ready = Boolean(video
    && video.codec_name === "h264"
    && ["Main", "High", "Constrained Baseline", "Baseline"].includes(video.profile)
    && Number(video.level) <= 41
    && video.pix_fmt === "yuv420p"
    && Number(video.width) > 0 && Number(video.height) > 0
    && Number(video.width) <= 1920 && Number(video.height) <= 1080
    && fps > 0 && fps <= 30.01
    && audio.every(stream => stream.codec_name === "aac")
    && Number(metadata.format?.duration) > 0);
  return { ready, video, audioCount: audio.length, fps };
}

async function mediaFile(path) {
  const bytes = await readFile(path);
  return new File([bytes], basename(path), { type: "video/mp4" });
}

async function* videos(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* videos(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) yield path;
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== ISOLATED_REF) {
    throw new Error("This video preparation operation is restricted to the authorized isolated GitHub Actions branch.");
  }
  execute("ffmpeg", ["-version"]);
  execute("ffprobe", ["-version"]);
  if (!existsSync(ROOT)) throw new Error("Static video directory is absent.");
  await mkdir(OUTPUT_DIR, { recursive: true });
  let total = 0, transformed = 0;
  for await (const path of videos(ROOT)) {
    total++;
    const name = relative(ROOT, path).replaceAll("\\", "/");
    const before = await inspectBrowserVideoFile(await mediaFile(path));
    const sourceProperties = probe(path);
    if (before.compatible && sourceProperties.ready) {
      console.log("Already compatible:", name);
      continue;
    }
    const output = join(OUTPUT_DIR, name);
    await mkdir(resolve(output, ".."), { recursive: true });
    // Do not edit checked-in media until the candidate passes both checks.
    await rm(output, { force: true });
    try {
      execute(process.execPath, [
        "scripts/prepare-browser-video.mjs", path, output
      ], { stdio: "inherit", encoding: "utf8" });
      const candidate = await inspectBrowserVideoFile(await mediaFile(output));
      const candidateProperties = probe(output);
      const size = (await stat(output)).size;
      if (!candidate.compatible || !candidateProperties.ready || size <= 0) {
        throw new Error("Prepared video failed compatibility inspection: " + name + " (" + candidate.code + ")");
      }
      await rename(output, path);
      transformed++;
      console.log("Prepared compatible static MP4:", name, "bytes:", size);
    } finally {
      await rm(output, { force: true });
    }
  }
  console.log("Static video preparation completed:", total, "inspected;", transformed, "updated.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
