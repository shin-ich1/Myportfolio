#!/usr/bin/env node
/**
 * Prepare small, color-profile-preserving WebP card/detail renditions of every
 * bundled static PNG/JPEG. Original files remain untouched (and usable as a
 * fallback). Regenerate this exact allowlist whenever static assets change.
 *
 * This script can only run in GitHub Actions on the authorized isolated branch.
 * It never deploys, writes user data or contacts Firestore/Cloudinary.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const AUTHORIZED_REF = "refs/heads/fix/public-static-renditions-startup-20261025";
const ROOT = resolve("assets/images");
const STAGE = resolve(".lan-staging/public-image-renditions");
const MANIFEST = resolve("static-image-renditions.js");

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(command + " failed: " + (result.stderr || result.error?.message || result.status));
  }
  return result.stdout || "";
}

function dimensions(path) {
  const raw = execute("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "json", path]);
  const stream = JSON.parse(raw).streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("Unable to inspect image dimensions: " + path);
  return { width: stream.width, height: stream.height };
}

async function* imageSources(folder) {
  const entries = (await readdir(folder, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = join(folder, entry.name);
    if (entry.isDirectory()) yield* imageSources(absolute);
    else if (entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name)) yield absolute;
  }
}

async function encode(source, destination, width, quality) {
  await mkdir(dirname(destination), { recursive: true });
  const args = ["-quiet", "-mt", "-q", String(quality), "-metadata", "icc"];
  if (width) args.push("-resize", String(width), "0");
  args.push(source, "-o", destination);
  execute("cwebp", args);
  const meta = dimensions(destination);
  if (!meta.width || !meta.height) throw new Error("Invalid WebP image: " + destination);
  const size = (await stat(destination)).size;
  if (size <= 0) throw new Error("Empty rendition: " + destination);
  return { size, ...meta };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== AUTHORIZED_REF) {
    throw new Error("Static image preparation is allowed only on the isolated GitHub Actions fix branch.");
  }
  if (!existsSync(ROOT) || !existsSync(MANIFEST)) throw new Error("Media source or canonical manifest is missing.");
  execute("cwebp", ["-version"]);
  execute("ffprobe", ["-version"]);
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  const planned = [];
  const manifest = {};
  let savedCardBytes = 0;
  let scanned = 0;
  try {
    for await (const absolute of imageSources(ROOT)) {
      scanned++;
      const original = await stat(absolute);
      const { width, height } = dimensions(absolute);
      const basename = relative(ROOT, absolute).replaceAll(sep, "/");
      const source = "assets/images/" + basename;
      const stem = basename.replace(/\.(png|jpe?g)$/i, "");
      const card = "assets/images/" + stem + ".card.webp";
      const detail = "assets/images/" + stem + ".detail.webp";
      const cardTemp = join(STAGE, stem + ".card.webp");
      const detailTemp = join(STAGE, stem + ".detail.webp");
      const cardResult = await encode(absolute, cardTemp, width > 960 ? 960 : 0, 84);
      const detailResult = await encode(absolute, detailTemp, width > 2400 ? 2400 : 0, 90);
      const cardAspect = cardResult.width / cardResult.height;
      const detailAspect = detailResult.width / detailResult.height;
      const sourceAspect = width / height;
      if (Math.abs(cardAspect / sourceAspect - 1) > .003 || Math.abs(detailAspect / sourceAspect - 1) > .003) {
        throw new Error("Rendition aspect ratio changed for " + source);
      }
      // Only publish a variant when both sizes are genuinely smaller than the
      // original. Small already-efficient JPEGs keep their original URLs.
      if (cardResult.size >= original.size || detailResult.size >= original.size) {
        console.log("Keep original (already compact):", source);
        continue;
      }
      planned.push({ card, detail, cardTemp, detailTemp });
      manifest[source] = { card, detail };
      savedCardBytes += original.size - cardResult.size;
      console.log("Optimized:", source, "original:", original.size,
        "card:", cardResult.size, "detail:", detailResult.size);
    }

    if (!manifest["assets/images/hero.png"] || !manifest["assets/images/about.png"]) {
      throw new Error("Critical first-screen media did not yield usable optimized renditions.");
    }
    if (Object.keys(manifest).length < 35 || savedCardBytes <= 20_000_000) {
      throw new Error("Static media did not reach the required measurable savings threshold.");
    }

    // Publish derived files only after all conversions, dimensions and transfer
    // savings have been validated; original images are never overwritten.
    for (const job of planned) {
      for (const [source, temporary] of [[job.card, job.cardTemp], [job.detail, job.detailTemp]]) {
        const output = resolve(source);
        await mkdir(dirname(output), { recursive: true });
        await rm(output, { force: true });
        await rename(temporary, output);
      }
    }
    const existing = await readFile(MANIFEST, "utf8");
    const markerStart = existing.indexOf("export const STATIC_IMAGE_RENDITIONS = Object.freeze(");
    const markerEnd = existing.indexOf("\n\nexport function staticImageRendition", markerStart);
    if (markerStart < 0 || markerEnd < 0) throw new Error("Cannot locate the canonical rendition map in " + MANIFEST);
    const mapping = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
    const next = existing.slice(0, markerStart) +
      "export const STATIC_IMAGE_RENDITIONS = Object.freeze(" + JSON.stringify(mapping, null, 2) + ");" +
      existing.slice(markerEnd);
    await writeFile(MANIFEST, next);
    console.log("Prepared", Object.keys(manifest).length, "source images of", scanned,
      "scanned; card delivery saves", (savedCardBytes / 1048576).toFixed(2), "MiB.");
  } finally {
    await rm(STAGE, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
