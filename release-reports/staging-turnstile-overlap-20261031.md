# Staging Public Message — Cloudflare Turnstile overlap (2026-10-31)

## Status
**Fixed in an isolated branch, automated-test verified; NOT deployed to staging or LIVE. Actual staging-browser runtime verification is pending.**

- Repository: `shin-ich1/Myportfolio`
- Staging baseline: `fix/staging-message-expired-puzzle-only-20261031` at commit `5d3e4966c897d9f3b0978f69482909165caca771` (the staging-only October 14 frontend with exact expiry correction, already approved and deployed to staging Hosting).
- Isolated branch: `fix/staging-turnstile-puzzle-overlap-20261031`.
- Existing Cloudflare Staging Worker remains separately deployed at version `3ce74b38-2f4b-4db7-b18e-0d165b5e260b`; this patch **does not change Worker**.
- Owner's 39-second October 31 staging video records a Turnstile checkbox appearing over the bird puzzle/slider during a wrong-answer flow (not an expiry test). After a server-rejected answer, bird replacement and subsequent geometry retry appear as intended. No verified proof bypass was observed.

## Root cause and real reproduction
- The single canonical `styles.css` puzzle owner defines a `display:grid` card with `max-height:100%` and `overflow:auto`. When a dynamically rendered 300×65px (or compact 150×140px) Turnstile challenge occupies its own row, default implicit grid row sizing can **shrink/overlap row placement rather than keeping the scene above the slider**.
- In headless Chromium, a constrained 360px-high modal using the **actual production `styles.css` and `publicMessagePuzzleMarkup()` HTML** reproduced `scene.bottom > slider.top` with normal/expanded Turnstile at desktop, 375px mobile, 320px compact, and short landscape viewport.
- **Failing regression before fix:** [GitHub Actions 41180536346](https://github.com/shin-ich1/Myportfolio/actions/runs/41180536346) — **4/4 real-CSS Chromium overlap cases failed** and contained bounding rectangle evidence matching the user's recording.
- Cloudflare documents the visible Turnstile fixed/flexible/compact widget sizes and `interaction-only` rendering: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/. The website retains the **existing** `turnstile.render` and server-verified Siteverify logic.

## Minimal canonical fix
Within the **existing `.public-message-puzzle-card` CSS declaration**, add **`grid-auto-rows:max-content;`** (one property) to prevent the scene/image row from being visually compressed when an interactive Turnstile widget enters the grid. The card's preexisting `max-height` and `overflow:auto` allow the extra widget height to scroll inside the card without overlapping or clipping the slider. No competing stylesheet/override, new handler or duplicate verification system is created.

**Unchanged:** all Public/Admin markup, JavaScript, Cloudflare Worker, Firebase configuration/Rules, image providers, puzzle image ratio, animations, challenge lifetimes, Turnstile validation, anti-bot proof, wrong-answer counts, and LIVE environment.

## Red → green verification
- **Four Chromium scenarios now PASS**: desktop constrained (528px modal), 375px mobile (343px modal), 320px compact (288px modal), and short-landscape 432px modal. Bounding-box assertions verify scene above slider, slider above widget, widget above status, and stable 16:9 image geometry.
- **30/30 targeted Public Message/security tests pass**.
- **251/251 available non-emulator tests pass** on 43 files, including Chromium layout cases. Two Firestore emulator-only test files were **not run** because they require their isolated Firestore emulator (do not claim them as passing). JS syntax checks pass.
- [Passing full test CI run 41180724094](https://github.com/shin-ich1/Myportfolio/actions/runs/41180724094).
- Exact static SHA guard for `styles.css` updated to `4c53ce386c1a9630f01f1f1b316903b6805b0bdb`. Existing security comparison still requires source equality to audited main after normalizing **only the existing reviewed Turnstile slot and this one exact canonical grid property**. It does not waive any other UI/source security lock.

## Changed files and ownership audit
- `styles.css`: 1 CSS declaration with a single new property.
- `tests/public-turnstile-overlay-browser.test.mjs`: real Chrome geometry regression using canonical current Public Message markup/styles and local fixture (no cloud calls).
- `tests/production-candidate-contract.test.mjs`: strict exact reviewed CSS SHA re-pin.
- `tests/production-public-security-integration.test.mjs`: strict SHA re-pin plus narrow audited owner-change normalization, no broad exemption.
- `.github/workflows/staging-turnstile-overlap-test.yml`: browser test + full available non-emulator suite; no deployment or secrets.
- `release-reports/staging-turnstile-overlap-20261031.md`: this report.

No related production assets or security owners were edited. No live customer data or staging records were touched.

## Remaining release gates
1. **No deployment authorization received** for this latest Turnstile CSS fix. Do not deploy to Firebase Staging Hosting until owner separately approves; never use repo root's default LIVE `.firebaserc`.
2. Rebuild isolated staging using existing `scripts/prepare-staging.mjs`, review staged site diff and verify staging project/Worker/keys; deployment target **`lan-portfolio-staging` Hosting only**, not Firestore Rules, Cloudflare Worker or LIVE.
3. After approved staging deployment, verify actual interactive Turnstile challenge with real provider in desktop, compact/mobile and landscape; ensure checkbox fully accessible via scrolling, slider visible, retries/3-attempt rotation, expiration recovery, successful proof and message/Admin receipt.
4. The emergency landscape image variety concern is an independent unresolved item. This CSS-only patch does not change image sourcing.
5. Separate explicit authorization is required for LIVE publication, after verified staging behavior.
