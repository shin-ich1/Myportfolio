# LAN Portfolio — Gallery Tile Performance Candidate

**Date:** 2026-11-11, Asia/Manila  
**Repository:** shin-ich1/Myportfolio  
**Baseline:** f20280e3a11f0c3c1824de219cedec0b3e65daf9 on fix/hero-cls-geometry-20261111 (known-good CLS-fix preview)  
**Working branch:** perf/public-gallery-tile-srcset-20261111  
**Status:** Implemented and automated tests passed; hosted performance and actual mobile/desktop runtime **NOT YET VERIFIED**. No LIVE deployment or merge.

## Evidence and root cause

The November 11 CLS-fix preview measured Desktop PageSpeed 87, Mobile 97, CLS 0 for both. A later one-off early-Hero-preload experiment (draft PR #69) measured Desktop 80 and Mobile 92, with mixed submetric results: desktop LCP improved 2.1 to 1.7 seconds, but Speed Index and Total Blocking Time worsened. These single Lighthouse runs warned of incomplete results. That change is **not demonstrated to improve overall performance**, so this candidate starts from the earlier f20280e CLS-fix baseline, not PR #69.

A separate, concrete inefficiency is visible in Lighthouse's **Improve image delivery** report: a Cloudinary photo gallery tile is delivered at up to 1200x1200 despite appearing around 114x114 CSS pixels on desktop. The original centralized image-card delivery in storage-asset.js uses c_limit,w_1200,h_1200,f_auto,q_auto:best for all cards and photo gallery tiles alike. Lighthouse estimated ~3,325 KiB potential desktop savings across Cloudinary images, not a guaranteed actual saving. Shared full-view and normal cards require high-fidelity sources; globally shrinking all cards would be unsafe.

## Canonical fix

Only small tiles in multi-image photo editing gallery layouts (two-columns and quad) now receive a responsive HTML srcset with 480w and the **unchanged 1200w high-fidelity card rendition**. Browser sizes is (max-width: 760px) 50vw, 135px. Browsers may download the small source when appropriate and retain the full high-quality variant at large/high-DPR widths. Layout, visible content, CSS, card original/fallback paths, and full view remain unchanged. Non-managed URLs and private/unpublished media do not gain unauthorized Cloudinary transformations.

## Changed files

1. storage-asset.js — add one 480px tile rendition to the existing Cloudinary image URL owner. Existing card/detail/original paths unchanged.
2. asset-resolver.js — route the tile delivery purpose through the canonical storage-asset owner without new URL rewriting.
3. record-media.js — expose authorized publicTileUrl in the canonical public-media presentation, with same access gating as publicCardUrl and same handling for prior presentations.
4. app.js — native srcset selection only for small multi-image preview layouts using existing public-media frame owner. No animation, breakpoint, CSS or full-view rewrite.
5. tests/public-gallery-tile-rendition.test.mjs — prove bounded Cloudinary output, preserve original/card/detail/video and private gating, and test narrow preview-only use.
6. tests/live-message-release-regression.test.mjs — exact five reviewed app.js delta exceptions while maintaining strict byte-for-byte protection of unrelated Public and Message owners.
7. .github/workflows/gallery-tile-no-deploy.yml — fails-first test, entire test suite, syntax check, changed-file audit, source ZIP artifact; no deployment.
8. release-reports/gallery-tile-renditions-20261111.md — this report.

## Tests and sequence

- **Regression first:** run 43002517582, new regression failed 0/3 against previous source.
- **After canonical fix:** run 43002883768, targeted 3/3 passed and repository-wide 198/198 passed; 0 failures, 0 skipped.
- Syntax checks: passed on app.js, record-media.js, asset-resolver.js, storage-asset.js, and targeted test.
- Strict diff scope audit: passed.
- ZIP packaging: passed.
- Message, SecurityCoordinator, Cloudflare Worker, Firebase rules, Admin implementation, hosting config, animations and all CSS files: unchanged.
- Known CLS fix retained from baseline f20280e.
- **Not tested:** real hosted Lighthouse performance, HTTP network/console errors in a browser, Safari, actual image sharpness at every responsive viewport, international load variation, Cloudinary initial transformation creation latency. These remain unverified; a passing Node test is not proof of runtime success.

## Release decision

**Do not merge or deploy LIVE yet.** PR #69 remains an unverified experiment and is not part of this candidate. Test this candidate only on a separately authorized Firebase Hosting preview channel, compare cold and warm loads with the original CLS-fix preview at matched mobile/desktop/compact viewports, validate browser network and Hero/portrait/gallery full-view appearance, and rerun PageSpeed at least three times per profile. If no measurable improvement or any visual regression, retain f20280e without this experiment.

No deployment, hosting setting, secrets or user data changes authorized or performed.
