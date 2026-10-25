# Public Photo Editing Mobile Image Loading — Release Handoff

Date: 2026-10-25 (Asia/Manila)
Repository: `shin-ich1/Myportfolio`
Fix branch: `fix/public-photo-media-visible-loading-20261025`
Authorized baseline: `1dce2f2e180db4fc1b603a50393f9af26c647653`
Implementation commit: `dff2bf76207cd942d943084297605d091b536831`

## Problem observed

Owner's LIVE iPhone recording shows delayed/empty Photo Editing cards and modal images. Network request outcomes (including HTTP status, transfer timing, and CDN/provider failures) are not yet captured. The recording does not establish a failed upload or missing database record.

## Confirmed source-level contributors

- The shared Public media fallback was visually hidden during an in-progress image request, exposing an empty image canvas instead of a meaningful loading state.
- A user-opened Photo Editing single-image modal used the shared lazy-loading default.
- Both visible comparison images and the first modal gallery image inherited lazy loading, despite being the media the user had just opened.
- Shared image decode preference was automatic, not explicitly asynchronous.

These are source-level deficiencies reproduced independently of network response times; they do **not** prove the cause of every media request delay or failure.

## Canonical changes

- `app.js`: The single-image modal loads eagerly with high priority; visible comparison images load eagerly; the first gallery image loads eagerly with high priority; the remaining gallery images continue to load lazily. The shared image-frame markup requests asynchronous image decoding.
- `styles.css`: The existing loading fallback stays visible while an image is pending. Loaded and failed-state owners remain unchanged.
- `tests/public-photo-media-visible-loading.test.mjs`: Four behavior regressions for user-opened single image, comparison, gallery, shared fallback/decode and preserved offscreen lazy loading.
- `.github/workflows/media-regression.yml`: Includes the isolated fix branch in the existing CI trigger. No production auto-deploy.

## Regression-first verification

- Before implementation: GitHub Actions run `40163395833`, **71 passed / 4 failed** (the four new tests). No existing tests failed.
- After implementation: GitHub Actions run `40163459005`, **75 passed / 0 failed / 0 skipped**. Syntax-check job step passed.
- Workflow: https://github.com/shin-ich1/Myportfolio/actions/runs/40163459005

## Security, data, and diff audit

- No Firebase security rules, Firestore records, auth/trusted-device logic, Admin JavaScript, worker settings, hosting configuration, or private data modified.
- No new Firestore queries, listeners, media API calls, or repeated retries.
- Original image URLs, provider permissions and fallbacks remain the canonical owners. No additional handlers or duplicate media modules added.
- Rendering layout, image object-fit/cropping, video autoplay behavior and existing responsive breakpoints were not changed.
- Compare this branch against `fix/public-mobile-media-cold-load-20261025`; product changes are limited to `app.js` and `styles.css`, with the regression test and one CI trigger addition.

## Known gaps and release gating

- **Not LIVE-verified**: iPhone production request timings and actual failed image HTTP statuses are unknown.
- **Not yet preview-verified**: Real iPhone modal navigation, image loads, bandwidth and cold-cache behavior must be checked before a production release.
- Large original static PNG files remain unchanged; this patch does not compress source images or guarantee instant loads on constrained networks.
- Preview Hosting deployment requires separate authorization. LIVE deployment and GitHub main merge require their own separate authorization.
- Production may read from the same Firestore project when a preview is tested. Avoid destructive testing.

Status: **Implemented and CI-tested; mobile runtime verification pending.**
