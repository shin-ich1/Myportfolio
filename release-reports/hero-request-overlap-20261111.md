# LAN Portfolio — Hero request overlap candidate

**Date:** 2026-11-11 (Asia/Manila)
**Repository:** shin-ich1/Myportfolio
**Base:** fix/hero-cls-geometry-20261111 at f20280e3a11f0c3c1824de219cedec0b3e65daf9
**Scope:** Isolated source-only branch perf/hero-request-overlap-20261111; **NO MERGE OR DEPLOYMENT**.

## Confirmed issue and canonical owner

Lighthouse on the November 11 Firebase CLS-fix preview reported desktop Hero LCP 2.1 s with approximately 2,550 ms resource load delay. The Hero image is created by app.js only after initFirebase finishes loadPublicPortfolioData, which awaits other public collection/capability reads. Thus the Hero card request is not started while those independent reads remain pending. Lighthouse reports a late request, but per-region causality and this source change's performance impact remain **unverified on hosted runtime**.

app.js retains canonical ownership of Public startup, Hero media URL resolution and Hero rendering. Existing image fallback, CSS, themes, animations, first-screen composition, Firestore validation and public security must remain unchanged.

## Failing-first regression evidence

1. Wrote tests/public-hero-early-hint.test.mjs **before** implementation.
2. GitHub Actions run 42998248094 confirmed **0/3** new tests passed on the unmodified source. One failure specifically demonstrated the Hero request not beginning while independent collection reads were outstanding.
3. Added a first-load-only image preload hint after the validated core singleton content is normalized, before awaiting existing independent collection results.
4. GitHub Actions run 42998536462 passed **3/3** Hero request regression tests and **198/198** full repository automated tests, with **0 failed / 0 skipped**.

## Changed files and canonical rationale

- app.js: After applySingletonContent(home, profile, contact), when the initial startup deadline is active, reuse existing staticImageRendition + mediaUrl + safeImageSource for the current CMS Hero, then append one HTML preload link with image high priority. No extra Firestore query, event handler, stored cache or visual placeholder is introduced. The later renderer uses the same URL.
- tests/public-hero-early-hint.test.mjs: Deterministically delay public collection reads, assert early hint and URL, absence on refresh/empty/unsafe media, and unchanged query counts.
- tests/live-message-release-regression.test.mjs: Permit only the exact reviewed early-hint block in strict Public baseline comparison; unrelated Public/Message/Admin/security source remains protected.
- .github/workflows/hero-early-hint-no-deploy.yml: Failing-first regression, complete tests, syntax checks, isolated diff audit, and candidate ZIP assembly.
- release-reports/hero-request-overlap-20261111.md: This report.

## Tests and security/diff audit

- New regression tests: **3 passed**.
- Full repository node --test tests/*.test.mjs: **198 passed, 0 failed, 0 skipped**, GitHub run 42998536462.
- JavaScript syntax: **passed**.
- Changed-file scope audit relative to f20280e3: **passed**.
- No changes to styles.css, public-adaptive.js, storage-asset.js, asset-resolver.js, firebase.json, Firebase rules, Cloudflare Worker, Admin source or public-message implementation.
- The existing media URL safety gate remains in force. No new security decision is delegated to the browser.

## Limitations and follow-up

**Implemented and automated regression-tested — NOT hosted-runtime verified.** This candidate has not been deployed to a new Firebase preview. It is not yet proven to improve desktop PageSpeed 87, mobile PageSpeed 97, real Hero visibility/LCP or international loading. Any quantitative benefit needs a separately approved fresh preview and equivalent-view comparison.

Cloudinary image-delivery optimization remains **unresolved / unimplemented**: the canonical shared card delivery caps at 1200×1200 with q_auto:best. A global reduction risks visual fidelity and multiple other card consumers. Investigate actual thumbnail slots and card/detail ownership first.

The mobile Lighthouse 0.9 s LCP identifies LAN loader text, not loaded Hero content. It is not evidence that the portfolio itself appears at 0.9 s.

**Production unchanged. No PR merge or LIVE deployment authorized.**
