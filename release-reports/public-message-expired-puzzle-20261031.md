# Public Message expired-puzzle recovery — 2026-10-31

## Status
**Implemented and automated-test verified on an isolated GitHub branch. NOT merged and NOT deployed to Firebase Hosting or either Cloudflare Worker. Browser-level end-to-end runtime verification is still pending.**

- Repository: `shin-ich1/Myportfolio`
- Source baseline: `db16d2d983ca8cc658c0cd43a6e0a0db9f2687ca`, the authorized PR #41 branch `fix/public-message-openverse-outage-20261031`
- Isolated patch branch: `fix/public-message-expired-puzzle-recovery-20261031`
- Staging Cloudflare Worker source had been deployed **separately** by owner at version `3ce74b38`. That does **not** mean the updated frontend `app.js` has been deployed to staging. The staging frontend may still have the older October 14 version.

## Failure reproduction and underlying owner

The owner's recorded staged browser test intentionally slid the puzzle incorrectly. The server responded with a retry, then eventually showed `Verification puzzle expired. Load a new puzzle.`. In the currently authorized `app.js` version, the canonical `loadPublicMessagePuzzleChallenge` controller catches any `verifyPrivateMessageChallenge` exception and unconditionally re-enables the old slider.

The `message-service.js` canonical HTTP wrapper already propagates server `error.code` and `error.status`; the `telemetry-worker/src/security-coordinator.js` canonical server owner emits HTTP **410** with code **`message-puzzle-expired`**, deletes expired state and continues to reject it. The defect was client-side lifecycle recovery, not weak server enforcement; changing server verification was unnecessary.

## Reproduced red → green regression

1. Red on original isolated source: [GitHub CI run 41175323295](https://github.com/shin-ich1/Myportfolio/actions/runs/41175323295) — **116/118 passing, 2 expected failures**: expiration did not fetch a replacement, and a failed replacement left the invalid slider usable.
2. The two target regressions and four adjacent cases passed after the minimal canonical fix: [GitHub CI run 41175419210](https://github.com/shin-ich1/Myportfolio/actions/runs/41175419210) — **118/118 passing, 0 failed**.
3. Headless Chromium DOM smoke still passes at **375×812, 430×932, 1440×900** using the isolated fixture. JavaScript syntax checks passed. Staging Worker dry-run was intentionally skipped on this branch since the fix changes only the public frontend.

## Exact source change
In `app.js`, the existing puzzle controller now treats the server's **`code=message-puzzle-expired` + `status=410`** as terminal for that challenge:
- clear the old challenge identity, disable the slider, and show the existing status/label area;
- invoke the **same canonical** `loadPublicMessagePuzzleChallenge()` loader for new challenge/image, session-safe geometry and fresh Cloudflare Turnstile widget;
- enable the slider only when the new challenge is usable;
- leave it disabled with `Verification unavailable` if reloading fails.

Other recoverable errors still reset the Turnstile proof and allow retry of the current valid puzzle. Server-signed verification proof is still mandatory before `sendPendingPublicMessage`. Wrong-answer retry geometry, third-attempt replacement, window layout, styles, UI wording outside the expiration state, image source and Admin behavior are unchanged. No extra event listeners or alternate puzzle implementation were added.

## Changed files / audit
- `app.js`: canonical frontend expired-puzzle state correction.
- `tests/public-message-expired-puzzle-recovery.test.mjs`: six real-controller tests with simulated backend results; includes expiry, failed replacement, retry, replacement, transient error, valid proof.
- `.github/workflows/media-regression.yml`: run these tests and existing Chromium viewport smoke on the isolated branch.
- `release-reports/public-message-expired-puzzle-20261031.md`: root cause, test results, limits and audit.

No Worker, Firebase config/rules, Admin, asset, media layout or production hosting file was changed. No private messages, secrets or LIVE settings were touched.

## Required before release
- Verify the actual **staging frontend** deployment baseline and, with separate owner approval, publish only the authorized staging frontend revision (do not infer staging Worker deployment updated Hosting).
- In staging browser, intentionally submit an expired puzzle and verify the old slider is disabled until the new challenge/image loads. Verify retry and three-attempt reset and successful message delivery in an isolated conversation, including Admin receipt. Test on actual mobile browsers/in-app contexts where feasible.
- Existing issue of repetitive first-party emergency landscape artwork is **separate and unresolved**; this patch does not redesign image sourcing.
- Obtain **separate approval before any LIVE Firebase Hosting / Cloudflare production deployment**.
