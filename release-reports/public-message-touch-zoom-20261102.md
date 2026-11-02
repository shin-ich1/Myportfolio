# Public Message touch/zoom canonical fix — 2026-11-02

**Status: IMPLEMENTED / AUTOMATED-TEST VERIFIED in isolated branch, not deployed, mobile runtime NOT verified.**

## Authorization and baseline

- Owner authorized a source fix on 2026-11-02; deployment was **not** authorized.
- Repository: `shin-ich1/Myportfolio`.
- Verified production source baseline: `4d96a5314bbb060cd74a1cf7726b385e92f78b24` (LIVE release PR #51 source, production Hosting version `ec1419dc30fc9f66`).
- Working branch: `fix/public-message-touch-zoom-20261102`; `main` and `release/live-public-message-parity-20261101` unchanged.
- Existing LIVE Worker, Hosting, Firebase security, Admin logic, privacy page, and frontend behavior outside the Public Message CSS owners were left untouched.

## Root-cause assessment

Reported: accidental mobile double-tap/focus zoom and difficult native slider dragging in compact/phone layouts; wide desktop appeared fine.

Source inspection finds:
1. `index.html` correctly permits viewport scaling and user pinch zoom, but the Public Message dialog had **no** `touch-action` declaration. Thus browser double-tap zoom gestures were not explicitly excluded inside the dialog.
2. The real full-width native range input over the visual puzzle thumb lacked a specific `touch-action`, allowing mobile browser gesture arbitration to interfere with range dragging.
3. Actual text fields used `font:inherit` from a parent label with `font-size:.76rem` (about 12px at normal browser settings); Mobile Safari may zoom on focusing editable fields smaller than 16px.

No duplicate slider handlers were found. Actual iOS/Android browser behavior, including whether zoom or drag cancellation reliably reproduces, remains **unverified**; these are evidence-supported CSS risk factors rather than proven device measurements.

## Canonical change

`styles.css`: modified **only three existing selectors/declarations**, no new override layers or media-query forks:
- `.public-message-dialog`: `touch-action:manipulation` suppresses double-tap zoom **within the modal** while retaining normal panning and pinch zoom.
- `.public-message-form input,.public-message-form textarea,.public-private-reply textarea`: `font-size:16px` avoids tiny focusable text across all widths; labels stay at their original size. Visible text size in the desktop message form may be larger; this is the only intentional visual change.
- `.public-message-puzzle-slider input`: `touch-action:none` reserves gesture handling for the real native slider only, leaving page pinch zoom and scroll intact elsewhere. The existing range's `oninput` and `onchange` handling remains the single owner.

No JavaScript, verification rate limit, Turnstile, Workers, message payload, timing, animation, responsive breakpoints, Admin, or production deployment configuration changed.

## RED → GREEN regression / testing

- `tests/public-message-touch-zoom.test.mjs`: 4 targeted regression tests for form text, dialog gesture behavior, native range ownership, and exact preservation of LIVE CSS outside the three existing owners. Failing first on baseline (4/4 missing CSS behaviors). Parser was corrected for the pre-existing compacted CSS before interpreting failures.
- `tests/live-message-release-regression.test.mjs`: preserved the original hardcoded LIVE CSS prefix/suffix freeze by **reversing only those three approved declarations** before calculating the same frozen hash values. No security test weakened.
- [Initial RED](https://github.com/shin-ich1/Myportfolio/actions/runs/41371982083): 0/4 targeted tests, all four failing on the actual missing rules.
- [GREEN CI](https://github.com/shin-ich1/Myportfolio/actions/runs/41372321734): **4/4 targeted and 149/149 available Node tests**, 0 failures, 0 skipped. JS syntax checks and Wrangler dry-run succeeded. No production deployment.

## File and security audit

Expected differences from published baseline:
- `styles.css`: canonical 3 existing CSS rule changes.
- `tests/public-message-touch-zoom.test.mjs`: new regression suite.
- `tests/live-message-release-regression.test.mjs`: updated preserved-live-style invariant.
- `.github/workflows/public-message-touch-zoom-no-deploy.yml`: isolated no-deploy test workflow.
- This report and final ZIP packaging workflow update.

No production/backend/source JavaScript changed; no secrets, auth bypasses, security relaxation, new event handlers, CSS override layers, or deployment commands added. Existing LIVE and Admin code unchanged.

## Unverified / future release gates

- Touch/zoom runtime behavior in physical iPhone Safari and Android browsers.
- Browser-level responsive/manual testing at 320, 360, 390, 430px, compact tablet and wide desktop, portrait/landscape, including puzzle drag, focus zoom, accessibility pinch zoom, scrolling, cooldown and message send.
- No STAGING or LIVE deployment, publishing, merging, or production settings modification. Deployment requires separate permission.
- If device tests fail, investigate measured `pointercancel`, focus-zoom state and browser gesture handling; do not add device-specific patch layers without confirming cause.
