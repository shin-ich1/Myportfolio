# LAN Portfolio — Startup Network Priority Investigation and Candidate

**Date:** 2026-11-11 (Asia/Manila)
**Repository:** shin-ich1/Myportfolio
**Branch:** perf/startup-network-priority-20261111 (isolated; draft)
**Verified source baseline:** fix/hero-cls-geometry-20261111 at f20280e3a11f0c3c1824de219cedec0b3e65daf9
**Production baseline:** main at 0211962c388cd3fd6191d295c60432c790e9d9a6
**Status:** Implemented, regression-tested and CI-audited; NOT hosted-runtime verified. NO LIVE DEPLOYMENT OR MERGE.

## Root-cause evidence: real Slow 4G HAR from the CLS-fix preview

The HAR capture was a 2026-11-11 fresh-network navigation of the owner's authorized Firebase preview (https://rolando-portfolio-3f1a3--hero-cls-1111-ir3f8plt.web.app/), with slow 4G and cache disabled. The actual network timeline relative to navigation start was:

- HTML first request: 0.00–0.58 s
- app.js: 0.60–1.90 s
- Existing Firebase module dynamic imports (firebase-app.js and firebase-firestore.js) requested only at 2.62 s; all modules completed at about 4.03 s
- First Firestore channel request: 4.14 s; additional startup reads began at around 5.89 s
- Native optimized Hero image **first requested at 5.95 s**; 32,376-byte Hero completed at 8.46 s
- Around 5.96 s, nine unrelated Cloudinary images also initiated, competing with the first-screen Hero request.

The HAR establishes the late module discovery and competing noncritical image requests. It does NOT isolate all causal factors for the Hero request timing, prove the loader-hide timestamp, or prove international latency. Browser-extension requests and the DevTools "Finish 36 s" counter are not proof of 36-second portfolio readiness.

Prior attempts:
- f20280e CLS-fix preview scored 87 Desktop/97 Mobile, CLS 0 in **one** Lighthouse run per profile.
- PR #69 early-CMS-image preload and PR #70 gallery tile candidate measured lower overall lab scores in separate one-off Lighthouse runs. Both are *unmerged and excluded* from this source candidate. One-off PageSpeed differences may reflect variability and incomplete Lighthouse runs; do not infer a causal regression without matched retests.

## Minimal canonical fix (no duplicate owners)

1. **index.html** — native rel=modulepreload for the **same two** already dynamically imported Firebase v12.2.1 URLs and the same cross-origin mode. Requests may begin during HTML parsing instead of waiting for app.js's complete local module dependency graph. The existing preconnect remains. No hardcoded CMS Hero URL or extra Firestore request.
2. **app.js: publicMediaFrameMarkup** — existing lazy image frames start with native fetchpriority=low, rather than competing with the eagerly rendered, high-priority Hero. Eager and explicitly high priority images remain untouched.
3. **app.js: prioritizePublicMediaInView** — the **existing canonical visibility owner** restores normal/auto priority to already visible cards and high priority to user-opened modal media. Offscreen lazy media stays low; no new observer, listener, manager, or independent state.
4. **app.js: publicVideoFrameMarkup / About portrait markup** — poster and below-the-fold About image are low-priority without changing their original source, quality, decoding, native lazy loading, or video playback settings.
5. **tests/public-startup-network-priority.test.mjs** — failing-first regression tests cover module preload discoverability, no duplicate imports/Firestore loads, lazy vs modal priority, visibility, Hero eager/high and video deferral.
6. **tests/live-message-release-regression.test.mjs** — extends existing strict source comparison with four EXACT authorized changes at the existing app.js owners. Other Public, Admin, security and message owner code remains byte-identical.
7. **.github/workflows/startup-network-priority-no-deploy.yml** — regression test, full suite, syntax checks, changed-file allowlist, build candidate ZIP. No deployment step.
8. **release-reports/startup-network-priority-20261111.md** — this evidence report.

## Regression-first evidence

- On the unmodified baseline, the four new regression tests **failed 0/4**, as expected (local before implementation; GitHub Actions run 43007869657).
- After the canonical source fix, new tests: **4/4 passed**.
- Final automated suite: **199/199 passed**, **0 failed / 0 skipped**, GitHub Actions run 43008114208.
- Syntax checks: passed.
- Protected diff audit: passed.
- Exact reviewed-source parity guard for Public/Message implementation: passed.
- Source packaging: passed, one candidate ZIP as GitHub Actions artifact.
- Both previously successful static Hero geometry regression and mobile/tablet adaptation tests retained.

## Security and release audit

Unchanged: Firestore query filters and deadline enforcement, Cloudflare Worker, Firebase rules, Cloudinary URL transforms, server-side verification, Message slider, Admin code, themes, animations, CSS, breakpoints, Hero size/geometry, responsive layouts, gallery full-view, Public content data, environment settings. Modulepreload sources use the same trusted HTTPS gstatic URLs that existing code already dynamically imports. No secrets or new credentials introduced.

## Limitations / acceptance gate

**This is implemented and automated-tested, NOT fixed-and-runtime-verified.** Browser modulepreload cache reuse, actual waterfall change, first-screen Hero completion, time to hide the LAN loader, Total Blocking Time, CLS, image quality, responsive layouts, PageSpeed and international visitor latency must be verified on a newly authorized **Firebase Hosting preview only** at matching viewports/content states, ideally comparing 3 cold visits per profile to the f20280e preview.

If the preview is neutral or worse, keep f20280e and do not release this optimization. No production deployment, merge, republish, secret, security setting, or user-data changes have been performed or authorized.
