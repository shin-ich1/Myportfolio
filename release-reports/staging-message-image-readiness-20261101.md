# STAGING Public Message — image readiness after puzzle cooldown (2026-11-01)

## Status
**Implemented in isolated frontend branch; regression and available Node suites passed. NOT DEPLOYED to STAGING or LIVE; browser runtime still unverified.**

## Baseline and ownership
- Repository: `shin-ich1/Myportfolio`.
- Frontend baseline: deployed PR #48 STAGING Hosting source commit `c509d311636cb5246eeee3ac971c47852dcd99b0`.
- Existing staging Worker: deployed PR #47 version `a42dfdb2-77d3-4d32-8054-be6c338907a4`, with authoritative 10-second wrong-answer cooldown and 1%-alignment verification inherited from PR #46. **Worker source and configuration are not modified.**
- Canonical owners stay in `app.js`: the existing form countdown, existing shared challenge warmup, existing puzzle scene loader. No parallel caching endpoint, CSS override, duplicate handler or source provider change.

## Root cause and constrained solution
After three wrong answers, the Worker returns HTTP 429 plus `retryAt` and the UI closes the puzzle for 10 seconds. The old countdown handler simply enabled Send at expiry; it did not initiate a fresh preloaded challenge. Only clicking Send called the existing warmup, so image retrieval latency remained visible. During new puzzle preparation, the DOM could still show the previous image, leading to a stale-photo flash.

The frontend now starts **one optional existing challenge/image warmup** at the first countdown tick after the server-supplied retry deadline has elapsed. It never attempts server challenge creation while cooldown is active. This is not preloading the *new security challenge* before expiry; doing that would violate the Worker-enforced gate. If the user clicks immediately at expiry, the existing warmup promise is shared. Warmup errors fail normally and future Send still retries through canonical security controls.

The existing `loadPublicMessagePuzzleChallenge` owner now sets the puzzle scene invisible while loading, revealing it only after the new image finishes loading. Slider remains disabled until prepared; no layout, image source, Turnstile behavior or design change. Typed message persists.

## Regression-first evidence
- [RED GitHub CI](https://github.com/shin-ich1/Myportfolio/actions/runs/41276251528): 3/6 new tests fail on unmodified PR #48 — exactly the post-deadline warmup and stale-photo visibility gap.
- [GREEN GitHub CI](https://github.com/shin-ich1/Myportfolio/actions/runs/41276359734): **6/6 targeted**, **274/274 available non-emulator Node tests**, JS syntax passed; target tests overlap with the suite total. A functional fake-DOM test exercises actual old-image hide / new-image reveal while a loading Promise is held.
- Two Firestore emulator-only suites intentionally not run (no isolated emulator provisioned), not waived.
- No staging Worker remote image-timing instrumentation, real Cloudflare Turnstile response, message/Admin delivery, iOS/Android browser, or deployment runtime verification was performed on these new changes.

## Changed paths
1. `app.js` — precisely scoped cooldown-expiry optional warmup and scene hiding until current image loaded (10 added lines, no removals).
2. `tests/public-message-cooldown-image-readiness.test.mjs` — six regression tests for no premature challenge, exactly one expiry warmup, disconnected form, outage fallback, unrelated cooldowns, and visual guard.
3. `tests/public-message-expired-puzzle-recovery.test.mjs` — actual puzzle controller runtime-style test for the new image transition with deferred loading.
4. `tests/production-candidate-contract.test.mjs` — exact new audited app hash.
5. `tests/production-public-security-integration.test.mjs` — exact new audited app hash, all other guard assertions retained.
6. `.github/workflows/staging-message-image-readiness.yml` — isolated no-deploy regression/suite/syntax workflow.
7. This report.

## Release gate
1. No more Worker deployment should be necessary. Confirm deployed PR #47 Worker, staging Hosting PR #48 source, and keep the latter reference build.
2. After **separate STAGING Hosting-only approval**, build isolated frontend from this exact branch with existing staging-only public key. Audit all publishable files; only `app.js` should differ from PR #48's staging site. Confirm hosting project target before any deploy and retain rollback.
3. In browser, exercise three wrong answers, exact server countdown, Send immediately after expiry (may still wait for image), Send a few seconds later after warmup (should usually be quicker), no stale photo, no double challenge request, correctly aligned valid Turnstile proof and message receipt, compact/mobile responsive rendering, and network/console.
4. If image retrieval still stalls, inspect source cache vs Openverse request timing; do not invent a bypass or guarantee instant loading. The known image diversity/fallback repetition concern remains independent and unresolved.
5. LIVE release requires separate approval after actual runtime verification. This branch is not production-ready solely because automated tests pass.
