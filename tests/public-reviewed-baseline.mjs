import {execFileSync} from "node:child_process";

// Pinned current main source, verified against the Analytics fix branch on
// 2026-11-09. Unlike earlier preview snapshots, this baseline includes the
// authorized Public Message touch/zoom and image-viewer changes.
// Do not move this pin automatically when main advances.
export const PUBLIC_REVIEWED_BASELINE = "1396225fa6cb004c2d874f8c754f940113321e59";

// Windows checkouts may translate LF to CRLF. Compare the same source content
// without ignoring any JS/CSS edits, whitespace, selectors, or security logic.
export const normalizeRepoText = source => source.replace(/\r\n/g, "\n");

export function readReviewedPublicSource(path) {
  if (!["app.js", "styles.css"].includes(path)) throw new Error("Unsupported public baseline path");
  return normalizeRepoText(execFileSync("git",
    ["show", PUBLIC_REVIEWED_BASELINE + ":" + path], {encoding: "utf8"}));
}
