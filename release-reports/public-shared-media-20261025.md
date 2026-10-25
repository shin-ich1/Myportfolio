# Public Media Visibility Policy — Canonical Refactor Handoff

Date: 2026-10-25 (Asia/Manila)
Repository: `shin-ich1/Myportfolio`
Branch: `fix/public-shared-media-priority-20261025`
Baseline: `59fe42345191c99a8d402e98e47078d90209562b` (includes Admin fixes, first Public performance fix, and Photo Editing loading fix)

## Owner's requirement

Performance improvements must not be a Photo Editing-only patch. They should automatically apply to **current and future image/video frames** using the established Public media pipeline, without extra Firestore requests or video bandwidth waste. Preserve working image fit, layouts, access controls, video playback and Admin behavior.

## Existing owners inspected

- `record-media.js`: canonical provider-independent asset presentation/access policy; unchanged.
- `asset-resolver.js`, `storage-asset.js`: canonical URL, card/detail, Cloudinary and Drive variants; unchanged.
- `app.js` `publicMediaFrameMarkup`, `publicVideoFrameMarkup`, `bindPublicMediaFrames`: canonical Public image/video markup and visibility behavior.
- `app.js` `photoEditingDetailMediaMarkup`: used module-specific eager/high flags on earlier branch; migrated back to shared owner.
- `app.js` `projectVideoPlayerMarkup`: manually controlled project modal video retains its separate, existing owner and controls; not replaced.

## Root cause and scope

Old module code decided selected photo loading priority for Photo Editing, rather than letting a single shared visibility policy handle all module media. Shared video poster markup remained lazy by default. This was an **architectural inconsistency**; it was not proof that every observed iPhone network delay was caused by the browser lazy loading.

## Changes

1. `app.js`: added `prioritizePublicMediaInView` next to `bindPublicMediaFrames`. It automatically gives eager loading to any image or video poster already visible in the viewport. Within an opened modal it also promotes visible images/posters to high fetch priority; offscreen media stay lazy, with no mass high-priority downloads. It does not alter video `src`, `preload`, or autoplay policy. Called by the one canonical binder.
2. `app.js`: removed per-Photo-Editing image priority overrides so the same policy applies to future custom modules and existing galleries that use shared frames.
3. `tests/public-shared-media-visibility-priority.test.mjs`: four new focused tests for any future modal image, video poster and no premature video download, in-viewport vs offscreen card media, and canonical ownership.
4. `tests/public-photo-media-visible-loading.test.mjs`: migrated the prior Photo Editing expectations to assert delegation to the shared owner; existing behavior is tested in the four new executable generic regressions.
5. `tests/public-project-cover-video.test.mjs` and `tests/public-cover-backdrop-ratio.test.mjs`: inject the new shared collaborator into isolated pre-existing media harnesses; existing video recovery and ambient image behaviors remain tested.
6. `.github/workflows/media-regression.yml`: run the full regression suite on this isolated branch, without enabling any production deployment.

## Regression-first evidence

- Before implementation: GitHub Actions run `40163997249`, **75 passed / 4 failed**; all four new future-media tests failed against the original behavior.
- After implementation and migration: GitHub Actions run `40164211588`, **79 passed / 0 failed / 0 skipped**, syntax-check stage passed.
- Final implementation CI: https://github.com/shin-ich1/Myportfolio/actions/runs/40164211588

## Security and performance boundaries

- No new Firestore reads, database subscriptions, mutations, credential access or changes to Firestore/Storage rules.
- No Admin files or Hosting settings changed; production and `main` unchanged.
- Private/unauthorized asset eligibility, canonical URLs and provider fallbacks stay unchanged.
- Videos remain viewport-triggered with `preload="none"` for shared previews. Autoplay-blocked browsers retain their poster; native/manual controlled project modal video stays unchanged.
- Ordinary above-fold cards receive only eager, not forced high priority. Visible media inside the opened modal receives high priority; offscreen gallery items remain lazy.
- Future modules must use the existing Public media frame components to inherit this policy. Raw `<img>` and unrelated external video embeds are not silently intercepted.

## Unverified

- Real iPhone/browser runtime metrics, network status codes, bandwidth reduction, source image compression and universal provider delivery.
- This change improves request scheduling / perceived loading, not the transfer size of large original PNGs or actual media server response times.
- No Firebase preview deployment or LIVE publishing has been performed for this branch. Separate authorization is required for each.

Status: **Implemented and CI-tested; iPhone/browser runtime verification pending.**
