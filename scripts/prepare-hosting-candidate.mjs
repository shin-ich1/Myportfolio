// Stages a review-only Hosting candidate. Does not change firebase.json or deploy.
// Usage: node scripts/prepare-hosting-candidate.mjs --check
//        node scripts/prepare-hosting-candidate.mjs --build
import { readdir, mkdir, copyFile, rm, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".hosting-dist");
const mode = process.argv[2] || "--check";
if (!["--check", "--build"].includes(mode)) {
  console.error("Usage: node scripts/prepare-hosting-candidate.mjs [--check|--build]");
  process.exit(2);
}

const excludedDirs = new Set([
  ".git", ".github", ".firebase", ".vscode", ".wrangler", "node_modules",
  "telemetry-worker", "scripts", "tests", "__tests__", "docs",
  ".lan-staging", ".hosting-dist", ".hosting-preview"
]);
const excludedNames = new Set([
  "firebase.json", ".firebaserc", "firestore.rules", "storage.rules",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "wrangler.json", "wrangler.jsonc", "readme.md", "license",
  ".gitignore", ".npmrc"
]);
const extensions = new Set([
  ".html", ".htm", ".js", ".mjs", ".css", ".json", ".webmanifest",
  ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp4", ".webm", ".mp3", ".ogg", ".pdf", ".xml", ".wasm"
]);
const sensitiveName = /(?:secret|credential|service.account|private.key|access.token)/i;
const candidates = [];
let excluded = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(root, path).split(sep).join("/");
    const lower = entry.name.toLowerCase();
    if (entry.isSymbolicLink()) throw new Error(`Symlink needs explicit manual review: ${rel}`);
    if (lower.startsWith(".") || excludedDirs.has(lower)) { excluded++; continue; }
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!entry.isFile()) { excluded++; continue; }
    if (excludedNames.has(lower) || sensitiveName.test(rel) || !extensions.has(extname(lower))) {
      excluded++; continue;
    }
    const info = await stat(path);
    if (info.size > 100 * 1024 * 1024) {
      throw new Error(`File over 100 MB needs manual review: ${rel}`);
    }
    candidates.push({ rel, path });
  }
}

await walk(root);
candidates.sort((a, b) => a.rel.localeCompare(b.rel));
for (const mustHave of ["index.html", "app.js", "styles.css"]) {
  if (!candidates.some(({ rel }) => rel === mustHave)) {
    throw new Error(`Required public file missing: ${mustHave}`);
  }
}
if (candidates.some(({ rel }) => /(?:^|\/)(?:telemetry-worker|scripts|tests|docs)\//.test(rel))) {
  throw new Error("Non-public source unexpectedly selected for Hosting");
}
console.log(`Candidate: ${candidates.length} web assets selected; ${excluded} paths excluded.`);
if (mode === "--build") {
  await rm(output, { recursive: true, force: true });
  for (const { rel, path } of candidates) {
    const target = join(output, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await copyFile(path, target);
  }
  console.log("Created .hosting-dist/ (candidate only; no deployment or firebase.json changes).");
  console.log("Compare it with the current Hosting release and test on a preview channel before activating.");
} else {
  console.log("Read-only check: no files generated and no Hosting changes.");
}
