# Public Message — visibly wrong slider accepted (1 Nov 2026)

## Status
**Implemented in isolated draft PR #46 and automated-test verified. NOT deployed to STAGING or LIVE. Real browser runtime verification pending.** No production claims or production settings change.

## Correct baseline and ownership
- Repository: `shin-ich1/Myportfolio`.
- Server Worker baseline: `fix/public-message-openverse-outage-20261031`, exact commit `db16d2d983ca8cc658c0cd43a6e0a0db9f2687ca` (PR #41), matching the source family previously deployed to the staging Worker version `3ce74b38-2f4b-4db7-b18e-0d165b5e260b`.
- Frontend staging Hosting remains separately deployed from PR #45. It contains an older Worker source tree; intentionally did **not** replace the staging Worker baseline with that copy.
- The canonical tolerance setting is in `telemetry-worker/src/index.js`; the existing SQLite Durable Object `SecurityCoordinator` performs the atomic answer comparison. Public UI is not the security authority.

## Reproduced root cause
Owner's 63-second 2026-11-01 staging recording shows visually offset puzzle pieces followed by successful Private Conversations. Server source configured `MESSAGE_PUZZLE_TOLERANCE = 4`. It sent this tolerance to canonical `puzzle-check`, where `Math.abs(answer - targetPercent) <= tolerance` could reserve a nonce even for a visible offset.

A read-only isolated execution of the **actual** coordinator source on the unmodified Worker confirmed the defect: target `55`, answer `52` (3 percentage points off) returned `outcome: pending` and reserved the nonce instead of `retry`. This established the mismatch without creating a real message or exposing credentials.

## Canonical fix
`telemetry-worker/src/index.js`: change the single tolerance constant from `4` to `1` slider percentage point (one unit of the existing integer-step range). Thus offsets of 2+ points are rejected; correctly aligned and 1-point rounding differences still pass so normal mouse/touch/keyboard use is not unreasonably strict.

Nothing changes the coordinator's server-side checks, origin/binding, three attempts/rotation, Turnstile Siteverify, one-use proof, rate limiting, Firestore, Admin, frontend, images, layout, security secrets, or Firebase configuration. No duplicate handler or CSS override was added.

## Test-first evidence
- [RED: GitHub Actions 41270719239](https://github.com/shin-ich1/Myportfolio/actions/runs/41270719239): **3 of 6 targeted tests failed** on the unmodified 4% Worker. The failures were precisely the visibly wrong +2/+3 percentage-point acceptance and the over-permissive tolerance contract. Existing non-emulator tests and syntax steps were skipped on that failing run.
- [GREEN: GitHub Actions 41270795693](https://github.com/shin-ich1/Myportfolio/actions/runs/41270795693): **6/6 targeted pass; 118/118 available branch Node tests pass; JS syntax checks pass; 0 failures or skips** in those two executed groups. Test totals overlap (the new 6 are included in the 118).
- The tests import the actual `security-coordinator.js` class, use isolated synchronous in-memory KV, and read the actual Worker tolerance source. They cover 2–3 point visibly wrong placements, exact and ±1 near alignment, wrong-answer/three-attempt rotation, denied browser binding, nonce authorization, one-use finalize, replay rejection, and proof gate order.
- An additional isolated direct coordinator exercise reproduced RED and confirmed GREEN with wrong 2–3 point offsets, exact/±1 behavior, binding, nonce, rotation, and replay.
- Not performed: isolated real Workerd Siteverify end-to-end, Firestore emulator-only suites (if configured separately), current PR #45 frontend full-suite against a combined branch, actual staging browser verification on new Worker, actual message/Admin delivery after the change, iOS/Android testing. Do not claim these passed.

## Diff and security audit
- `telemetry-worker/src/index.js`: one canonical tolerance constant and scoped explanatory comment.
- `tests/message-puzzle-alignment-security.test.mjs`: six regression tests, no network or cloud services.
- `.github/workflows/message-puzzle-alignment-regression.yml`: isolated no-deploy regression, available non-emulator suite and syntax checks.
- `release-reports/message-puzzle-tight-alignment-20261101.md`: this handoff.
- No PR #45 frontend files, Worker deployment config, Firebase rules, Admin source, credentials or production source were modified.

## Release gate
1. Approve **separately** an isolated staging Worker deployment of the exact reviewed source; preserve the staging Worker bindings, secrets, Durable Object, and existing version history. Do not deploy this branch's frontend; PR #45 frontend is already staged.
2. Test deliberately offset slider attempts (2+ points rejected, 3 wrong attempts rotate); near-exact pass; Cloudflare Turnstile; one-use proof; message creation and Admin receipt; console/network; mobile/tablet/desktop.
3. Confirm worker version/source in staging and repeat successful cross-browser behavior before any proposed LIVE release.
4. Original sporadic image-loading and image-variety concerns remain separate and unresolved; this Worker-only change does not claim to address them.
