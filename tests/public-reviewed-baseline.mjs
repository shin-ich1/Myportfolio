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
// Exact, reviewed Hero-only CSS delta permitted during cold-load geometry work.
// Every unrelated byte stays protected by the existing reviewed-main guards.
export function reviewedHeroReservedCssCandidate(baseline) {
  const changes = [
    [
      "  display: block;\n  width: auto;\n  max-width: min(100%, 560px);\n  height: auto;\n  max-height: 600px;",
      "  display: block;\n  --portrait-max-height: 600px;\n  width: var(--portrait-render-width, auto);\n  max-width: min(100%, 560px);\n  height: auto;\n  max-height: 600px;"
    ],
    [
      'html[data-lan-public-mode="compact"] .hero-img img,\nhtml[data-lan-public-mode="mobile"] .hero-img img { height:auto;max-height:500px; }',
      'html[data-lan-public-mode="compact"] .hero-img img,\nhtml[data-lan-public-mode="mobile"] .hero-img img { --portrait-max-height:500px;height:auto;max-height:500px; }'
    ],
    [
      'html[data-lan-public-mode="mobile"] .hero-img img { max-height:430px; }',
      'html[data-lan-public-mode="mobile"] .hero-img img { --portrait-max-height:430px;max-height:430px; }'
    ]
  ];
  let candidate = baseline;
  for (const [oldRule, newRule] of changes) {
    if (candidate.split(oldRule).length !== 2) throw new Error("Missing unique reviewed Hero CSS owner");
    candidate = candidate.replace(oldRule, newRule);
  }
  return candidate;
}
