# STAGING Public Message — image-error recovery and retry countdown (2026-10-31)

## Status
**Implemented and automated-test verified in an isolated branch; NOT deployed to STAGING or LIVE.** This is the latest user-requested UI behavior on top of PR #44's deployed staging frontend. It is not a Cloudflare or Firebase security change, not a message data edit, and not a LIVE release.

- Repo: `shin-ich1/Myportfolio`
- Exact source baseline: PR #44 `fix/staging-turnstile-puzzle-overlap-20261031` commit `a1173618e341f0fb8ce5f67a7dc98cbe9f1b587c`, corresponding to the last owner-approved staging Firebase Hosting deployment.
- Isolated branch: `fix/staging-public-message-retry-ux-20261031`.

## Owner's evidence and root cause
The owner uploaded a 38-second staging video and screenshot, reproducing:
1. Initially, a valid bird photo and slider. Wrong answers rotate puzzle geometry/image as designed.
2. Around 24–31s, an image becomes blank with `Verification image could not be loaded. Please try again.`; the modal retains an unusable slider and clipped status/footer text while the Send form sits behind.
3. The vertical scrollbar is prominent after earlier correct `grid-auto-rows:max-content` fix.
This was NOT evidence of a server HTTP 429 rate limit. The canonical `loadPublicMessagePuzzleImage` rejects on a failing HTMLImageElement; the canonical `loadPublicMessagePuzzleChallenge` catch only disabled the slider and displayed an error **inside the still-open overlay**. The form had no retry-time state, though `message-service.js` already passes through authoritative error `retryAt` for Worker 429.

## Exact behavior implemented
- The **existing** failed challenge-loading catch in `app.js` disables the slider, closes the puzzle layer on any initialization/image-loading failure and opens an inline retry status in the **existing** `[data-public-message-status]` element.
- A **10-second local retry delay** starts for image load failures and other non-429 challenge initialization failures. This is explicitly a client UX throttle, **not** a server-guaranteed reset time or claim that an inaccessible service becomes available after 10 seconds.
- For an actual Worker HTTP **429** including a valid future `retryAt`, the UI uses that exact server deadline, not the local default, and prevents form submission during the countdown; this also applies to a 429 returned during puzzle verification/message submission.
- The existing typed name and message remain in the same form; no automatic send or message creation occurs.
- On countdown expiry, the Send button is restored and the visitor may explicitly initiate a **new** secure puzzle. Server Turnstile and one-use challenge/proof requirements are unchanged.
- An intentional wrong answer with a valid image still uses the server's canonical retry/rotation, with a brief visible `Try again — target moved` slider label.
- The redundant clipped footer status is now **visually hidden but retained for `aria-live` screen readers**. The puzzle card's scrollbar is visually hidden but wheel/touch/keyboard scrolling remains enabled to access expanded Turnstile on smaller screens. The visible slider label now says **Complete browser check below** whenever Cloudflare requires a manual interaction, so the hidden scrollbar does not hide the required action. The previous `grid-auto-rows:max-content` CSS overlap fix remains intact.

## Regression before and after
- New targeted test first failed on original source because no form-level image error recovery owner existed: [expected RED CI run 41182117938](https://github.com/shin-ich1/Myportfolio/actions/runs/41182117938).
- Automated fixture tests cover image-load failure closing the puzzle, disabled Send button, local 10-second countdown and expiry, 429 server deadline, modal unmount/timer cleanup, accessible footer, retry label and guarded form submit.
- Adjacent existing canonical puzzle tests still verify expired 410 retry, wrong answer, three wrong-answer image replacement, valid proof, and fail-closed state when replacement cannot load.
- Latest [passing CI run 41182882556](https://github.com/shin-ich1/Myportfolio/actions/runs/41182882556): **6/6 new UX tests; 4/4 real-CSS Chromium desktop/mobile/compact/landscape geometry tests; 32/32 targeted messaging/security tests; 259/259 total available non-emulator Node tests across 44 test files.** JavaScript syntax checks passed. These counts overlap; do not add them as separate independent tests.
- **Not run**: two Firestore emulator-only suites requiring a separately isolated emulator. Real Turnstile and end-to-end browser flows remain unverified after this code-only fix.
- Existing exact blob SHA and audited-source structural guards updated narrowly to permit only reviewed canonical retry UX and visually hidden footer/scrollbar; no general security exclusions.

## Changed files / diff audit
- `app.js`: form-level retry state and countdown in the existing message owner, failure close, 429 handling, retry submit guard, timer lifecycle, concise retry label.
- `styles.css`: visually hide clipped footer and scrollbar in existing puzzle CSS; preserve scrolling and status live region.
- `tests/public-message-image-failure-retry-ui.test.mjs`: new failing-then-passing functional UX tests.
- `tests/public-message-expired-puzzle-recovery.test.mjs`: update canonical fake DOM to include new close/countdown path confirm 429 behavior, and verify the visible manual Cloudflare instruction; does not remove previous assertions.
- `tests/public-turnstile-overlay-browser.test.mjs`: retain real browser scene/slider/widget separation checks while accounting for explicitly sr-only footer; still verify widget remains within card scroll content.
- `tests/production-public-security-integration.test.mjs`: strict SHA pins and exact-change scoped normalization, no weakened server security assertion.
- `tests/production-candidate-contract.test.mjs`: strict reviewed app and stylesheet SHA updates.
- `.github/workflows/staging-turnstile-overlap-test.yml`: invoke UX regression in full no-deploy CI run.
- `release-reports/staging-message-image-error-retry-ux-20261031.md`: this report.

No `telemetry-worker`, Firebase Rules, Firebase project configuration, Admin runtime, image source selection, Cloudflare settings or deployed environment was modified.

## Unverified / release gates
1. Validate the **full isolated staging build** using `scripts/prepare-staging.mjs`, owner-provided staging public Firebase config, and exact target checks; prior successful worktree deployment is not proof this new source has shipped.
2. Obtain **separate explicit STAGING Firebase Hosting deployment authorization**. Do not use LIVE repo-root default `.firebaserc`. Deploy Hosting-only after source/asset diff audit.
3. Runtime staging browser verify failed-image path closes; countdown updates and can retry; existing form content survives; 429 display is accurate; manual Turnstile fits mobile/landscape; three wrong answers, expired challenge, successful verified message and Admin receipt remain functional. Check browser console/network.
4. **Underlying sporadic image serving/network failure remains independently unresolved**. This patch fixes the user-requested error recovery, not the underlying upstream image availability.
5. Emergency fallback image variety is a separate unresolved item. **No LIVE deployment or production merge** without separate owner authorization and verified staging.
