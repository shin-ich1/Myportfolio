# Public cold-load performance — consolidated release and verification handoff

**Date:** 2026-10-25 (Asia/Manila)
**Repository:** `shin-ich1/Myportfolio`
**Isolated branch:** `fix/public-static-renditions-startup-20261025`
**Approved baseline:** `e0a35263b6f7542afc96c4f29c01597aea0970d0` (previous universal Public media candidate; includes prior Public performance and Admin fixes)
**Main when audited:** `c5399fa9c792c3e6a00eadfb86c26bf1959e05f6`

## Root-cause evidence and limits

On the owner's desktop screen recording of the Firebase preview, the portfolio loader and images remain visibly delayed even on PC. GitHub's baseline asset inventory contains 39 bundled PNG/JPEG files totaling approximately **74.32 MB**, 35 over 1 MB. `hero.png` was **2,320,081 bytes** and `about.png` **2,609,240 bytes**. The initial Public data path also serialized capability reads behind the collection reads, even though the workloads are independent. Existing priority-only patches did not shrink source image bytes.

The recording did not include an HTTP waterfall, measured Firestore query timings, or server responses. A provider outage, unsupported video codec, or network-specific failure is **not conclusively excluded**.

## Canonical owners and changes

- `app.js`: The original Public `mediaPresentation` owner now substitutes optimized same-origin card/detail URLs **only when the generated exact-file allowlist contains that bundled image**. It does not transform arbitrary user URLs or provider-managed assets. All existing Public galleries and future custom modules that use the shared media frame inherit this behavior. The existing frame's one-shot original fallback remains intact.
- `app.js`: The Home hero and About native images receive the same optional static rendition, with their original source kept as a one-time fallback inside the existing Public binder. Hero keeps high fetch priority; About stays lazy/offscreen. No CSS or layout change.
- `app.js`: `loadPublicCapabilities(deadline)` now starts **alongside** the existing collection calls after required public singletons have succeeded. Rejection is observed immediately by `Promise.allSettled` and rethrown at the original dependency boundary. The *same query calls* are made once each; no extra listeners, reads, writes, or repeated background refreshes.
- `static-image-renditions.js`: Generated exact-file allowlist and shared helper; leaves external, unknown, private/relative traversal, and tokenized URLs unmodified.
- `assets/images/**/*.card.webp` and `assets/images/**/*.detail.webp`: 76 measured, generated WebP variants for 38 of 39 static originals. Existing originals remain byte-for-byte unchanged and can be used for high-quality fallback.
- `scripts/prepare-static-images.mjs`: Reproducible offline, ICC-aware `cwebp` conversion. Keeps aspect ratio, validates actual image dimensions, size savings and both variants before publishing. Refuses to run outside the explicitly authorized isolated GitHub Actions branch.
- `.github/workflows/prepare-public-static-images.yml`: Exact isolated-branch guard; builds and commits variants **only into this fix branch**. No Firebase deploy or rules writes.
- `.github/workflows/media-regression.yml`: Extends existing full-suite CI to this fix branch, without changing production branches.
- `tests/public-static-image-startup.test.mjs`: Validates actual physical RIFF/WebP output files, total size savings, preserved originals, safe URL rewrite scope, shared Public integration, and executes the startup request schedule with controlled promises.
- `tests/public-first-visit-media-priority.test.mjs`: Keeps the existing hero-priority regression checking the new prepared source.

## Measured image-size improvement

**CI conversion log:** https://github.com/shin-ich1/Myportfolio/actions/runs/40166500179

| Item | Original | Prepared card variant |
| --- | ---: | ---: |
| Home hero | 2,320,081 bytes | 32,376 bytes |
| About photo | 2,609,240 bytes | 52,690 bytes |

- 39 source PNG/JPEG files checked, **38 converted**; one already-efficient image left on its original URL.
- 76 derivative WebP files committed on the isolated branch.
- Combined card-variant savings compared with downloading all corresponding originals: **68.47 MiB**. This is an aggregate file-size comparison, **not** a claim that every visitor downloads all images or saves this much on each visit.
- Full-size originals stay available in Git and through fallback; prepared detail images are separate, at higher quality than card renditions.
- WebP variants use cwebp ICC color-profile preservation and no aspect-ratio/cropping change. Browser visual parity has not been independently measured.

## Test-first results and security audit

- **Before prepared files existed**, the new tests failed on absent allowlisted image variants while existing functionality tests passed. The source-level parallel startup assertions passed.
- Image-conversion workflow generated and verified actual WebP files and ran **83/83 tests** successfully (run `40166500179`).
- Final, post-hardening full GitHub Actions run `40166710362`: **84/84 passed, zero failed, zero skipped**, including WebP magic bytes and a behavioral test of concurrent existing Firestore work.
- Run: https://github.com/shin-ich1/Myportfolio/actions/runs/40166710362
- JS syntax checking succeeded. No ESLint/build-specific alternative or browser E2E checks are configured in this CI.
- No changes to Admin implementation, Firestore rules, Storage rules, auth/trusted-device flow, worker, video codec/playback logic, Firebase Hosting configuration, or production data. No new database queries or listeners.
- Asset identity, authorized public accessibility, original fallback paths, and existing object-fit/container styling are preserved. The **static allowlist** applies only to exact prepared local image paths.
- No new CSS override layers, competing media delivery owner, or duplicate video fetching mechanism introduced.

## Unresolved and verification gates

**Status: implemented, assets generated, 84/84 CI passed — not browser/runtime verified.**

- Cold-cache Firefox/Chrome/Safari network waterfall, real iPhone render timings, failed media HTTP responses, and image visual comparison remain unverified.
- Original static MP4 `assets/videos/blender-animation.mp4` is 4.63 MB and unchanged; shared video previews still use existing deferred loading, poster and browser-compatible fallback. Actual video startup under slow networks is unmeasured.
- Managed provider uploads (Cloudinary/Google Drive) follow their existing canonical card/detail contracts; this static WebP conversion workflow does **not** process private/remote uploads. Future bundled PNG/JPEG files need the preparation workflow to run again on an authorized branch before deployment. This workflow intentionally cannot write to production/main.
- The LIVE Firebase release is unchanged by this work, and the branch is not merged into `main`. No preview or LIVE deployment has been performed for this candidate.
- Separate owner approval is required for any new Firebase Hosting preview, merge or production deployment.
- Test on equivalent Public routes and viewport widths (mobile/tablet/desktop), compare cold/warm network behavior and screenshots, and monitor Firestore Usage to confirm quota neutrality before release.
