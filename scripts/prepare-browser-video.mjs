#!/usr/bin/env node
/**
 * Prepare any site-hosted public video for broad browser playback.
 * Keeps its original file untouched. Requires FFmpeg on the developer machine.
 * Usage: node scripts/prepare-browser-video.mjs path/to/input.mp4 [path/to/output.mp4]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, join, parse, resolve } from "node:path";

const source = process.argv[2] ? resolve(process.argv[2]) : "";
const destination = process.argv[3]
  ? resolve(process.argv[3])
  : source ? join(dirname(source), parse(source).name + ".browser.mp4") : "";
if (!source || !existsSync(source) || extname(source).toLowerCase() !== ".mp4") {
  console.error("Provide an existing MP4: node scripts/prepare-browser-video.mjs input.mp4 [output.mp4]");
  process.exitCode = 2;
} else if (source === destination || existsSync(destination)) {
  console.error("Source and output must differ, and output must not exist. Original files are preserved.");
  process.exitCode = 2;
} else {
  const filter = "scale=w=1920:h=1080:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30";
  const args = [
    "-hide_banner", "-nostdin", "-v", "warning", "-n", "-i", source,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", filter,
    "-c:v", "libx264", "-profile:v", "main", "-level:v", "4.1",
    "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "22",
    "-maxrate", "6000k", "-bufsize", "12000k",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-movflags", "+faststart", destination
  ];
  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (result.error) {
    console.error("FFmpeg is required to prepare a compatible MP4:", result.error.message);
    process.exitCode = 1;
  } else if (result.status !== 0) {
    console.error("Video preparation failed. The original file was not modified.");
    process.exitCode = result.status || 1;
  } else {
    console.log("Prepared browser-compatible output:", destination);
    console.log("The original source remains unchanged; verify the output on actual devices before publishing.");
  }
}
