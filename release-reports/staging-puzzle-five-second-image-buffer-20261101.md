# STAGING Public Message — five-second image preparation buffer (2026-11-01)

**Status:** Implemented in an isolated frontend branch; 9/9 targeted and 277/277 available Node tests passed. **NOT DEPLOYED to STAGING or LIVE.** Actual browser/video runtime for this new change pending.

## Evidence from owner's 102-second staging recording
- Around 53–66s the user waited out the server retry countdown; at 67s the puzzle opened as a blank/Preparing frame and the new image appeared at ~68s.
- Around 79–92s a second cooldown occurred; clicking Send at ~92s opened a blank/Preparing puzzle at ~93s and the new image appeared at ~94s.
- PR #49 did prevent the previous photo flashing, but started its optional next-challenge warmup only when the countdown ended **and** simultaneously enabled Send. A click while the same warmup was pending exposed the blank loading frame. The image source itself was not established as defective.

## Correct source and ownership
- GitHub `shin-ich1/Myportfolio`, last confirmed published STAGING Hosting source PR #49 `2722f54bc41b4381506a6e4feff78f4d2351c4d8`.
- STAGING Worker source remains deployed PR #47, with its server-side binding-scoped wrong-answer cooldown and 1% puzzle alignment. **No Worker code, environment, bindings, secrets or backend configuration edited.**
- Existing `app.js` form retry-countdown owner is the only changed runtime owner. No new puzzle engine, caching endpoint, CSS override, message sending path or Timer service.

## Narrow fix
- Only for an authoritative HTTP 429 with code `message-puzzle-cooldown`, display an additional 5-second client-side preparation buffer **after** the server's actual `retryAt`. Other 429 and image-error delays remain unchanged.
- At the server-provided retry deadline, begin the **existing** shared challenge/image/Turnstile API warmup exactly once. Do not request a fresh challenge while server cooldown is active.
- Keep Send disabled during the five-second buffer. If image warmup remains pending at its end, continue displaying `Preparing the next puzzle image…` in the **message form** and do not reveal a blank puzzle card. Enable Send only after warmup completes. If warmup fails, do not bypass security; expose ordinary retry after buffer, with clear explanation. The existing pending challenge promise and preloaded image are consumed by the original loader.
- Keep typed form fields, server-verified Turnstile, one-use proof, third-wrong cooldown, image source/cache and responsive design unchanged.

## Regression first
- RED: [run 41277791443](https://github.com/shin-ich1/Myportfolio/actions/runs/41277791443) — 4/9 targeted checks failed on unmodified PR #49, confirming missing five-second buffer, premature Send activation and pending image state.
- GREEN: [run 41277906345](https://github.com/shin-ich1/Myportfolio/actions/runs/41277906345) — **9/9 targeted, 277/277 available non-emulator Node tests, syntax checks passed** (targeted 9 are included in 277); zero failures.
- Existing real-controller fake-DOM tests were retained; updated one explicit countdown expectation from the original 10-second display to 10 seconds security + 5 seconds client readiness. Frozen Public app SHA checks updated to exact new blob; security assertions not disabled.
- Firestore emulator-only suites were not run (required isolated emulator not provisioned); real CDN cache, image provider timing, mobile rendering, Turnstile and Admin delivery are not yet runtime verified under this change.

## Changed files in isolated branch
1. `app.js` — one canonical countdown function: 5s buffer, one warmup at server expiry, readiness gating and form status.
2. `tests/public-message-cooldown-image-readiness.test.mjs` — nine targeted tests.
3. `tests/public-message-expired-puzzle-recovery.test.mjs` — exact new displayed-time contract.
4. `tests/production-candidate-contract.test.mjs` — exact frozen Public hash.
5. `tests/production-public-security-integration.test.mjs` — exact frozen Public hash.
6. `.github/workflows/staging-message-image-readiness.yml` — isolated no-deploy CI trigger.
7. This report.

## Release gate
Separate explicit approval is required for STAGING Firebase Hosting-only deployment. Use isolated worktree and tracked-only staging builder; compare all published files to confirmed PR #49 staging baseline and require **only `app.js` changed**. Check both public STAGING domains and hashes after release. Do not deploy a Worker or modify LIVE.

Runtime verify two repeated three-wrong sequences; confirm server cooldown, added 5 seconds, 1 warmup only after actual retryAt, pending image loading entirely in message area rather than blank puzzle card, valid Turnstile/one-use server proof, successful message/Admin receipt, mobile/tablet/desktop and failed-image fallback. Normal third-party image failures may still make loading last longer than five seconds; this implementation keeps that wait out of the puzzle overlay.
