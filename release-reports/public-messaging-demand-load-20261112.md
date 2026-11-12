# LAN Portfolio — Defer Private Messaging Firebase SDK at Public Startup

Date: 2026-11-12 (Asia/Manila)
Repository: `shin-ich1/Myportfolio`
Baseline: draft PR #72 branch `fix/loader-progress-stall-20261112`, commit `cacc5ef931e77f9fd0d8d71f5fd369adeaa442dc`
Isolated branch: `perf/defer-public-message-firebase-20261112`
Status: **Implemented and automated-tested; not hosted runtime-verified.**
Production: **unchanged**. No Firebase or Cloudflare configuration or billing change. No deployment.

## Scope and independently observed root cause

Previously recorded Slow-4G preview timing:
- Firebase module downloads started about 2.62 s.
- First Firestore request started about 4.14 s.
- Hero image request started about 5.95 s and completed about 8.46 s.

Code inspection and the independent GPT Work report confirmed that `app.js` statically imported `./message-service.js`, whose module-level imports included the Firebase App and full Firestore SDK and created a Firestore instance at module evaluation. That dependency loaded on every first visit even without opening the private-message composer.

The code already prewarms the anti-bot puzzle when the visitor approaches/focuses the launcher, so merely postponing all messaging work would change the existing behavior. A clean ownership separation is required: Worker-based challenge, send, and local browser identity operations must not import Firestore, while real-time private thread listeners and Admin conversation operations must continue to use the Firestore SDK.

## Implemented canonical change

- `message-visitor-service.js` — extracted the **unchanged underlying Worker communication and visitor identity implementation** from the previous service into its sole lightweight owner. Includes server-authoritative challenge, verification, thread creation, message send, read and forget operations. It imports only the canonical existing `storage-bridge-url.js` bridge; no Firebase imports or Firestore read/write listeners.
- `message-service.js` — remains the one canonical owner for Firestore thread listeners, admin replies, read and deletion. Imports the shared visitor text/ID normalization helpers from the lightweight owner; duplicate Worker handler and local identity ownership removed.
- `app.js` — imports lightweight Worker and visitor identity functions statically; imports the full `message-service.js` only inside the already-established private conversation open action, before creating one Firestore subscription. Existing puzzle warmup, Worker validation, response handlers and Admin code remain otherwise unchanged. A cancelled/timed-out messaging modal does not subscribe if the module finishes late.
- `tests/public-messaging-demand-load.test.mjs` — seven targeted checks: full static import graph, sole Worker/identity owner, correct delayed thread listener import, unchanged challenge and visitor identity runtime behavior, listener cancellation guard, and retained Admin Firestore API.
- `tests/public-message-fast-retry-cooldown.test.mjs` — redirected original strict Worker verifier checks to their **new canonical source**; did not weaken puzzle or Turnstile requirements.
- `tests/live-message-release-regression.test.mjs` — added exact byte-for-byte reconstruction of the small authorized source changes against the reviewed main baseline; unrelated app, security, message slider and layout remain protected.
- `.github/workflows/public-messaging-on-demand-no-deploy.yml` — failing-first test, complete regression, syntax, changed-file audit and single source ZIP. No deploy operation.
- This report — findings, verification, and limitations.

## Regression-first evidence

1. Failing-first run `43132212599`: **4 of 5 targeted tests failed** on the untouched source because the public SDK import graph was eager and the visitor service did not exist yet.
2. Initial implementation: new targeted tests passed, but three existing tests failed because they referenced Worker code at its old canonical path or pinned the pre-refactor source. The strict checks were updated to point at the correct code and reconstruct only the precise authorized delta; no security checks were removed.
3. Latest pre-report run `43133024882`: **7/7 targeted tests passed, 210/210 full tests passed, 0 failed, 0 skipped**. JavaScript syntax and scope audit passed. One ZIP package created by CI.
4. A final report-included CI execution after this report must pass before the package can be called final.

## Critical performance limitation

**This change does NOT remove Firebase from the overall initial render critical path yet.** The public `initFirebase()` still dynamically imports the Firebase App/Firestore SDK and directly queries Firestore to obtain the portfolio data. Moreover, PR #71's existing `index.html` continues to issue native `modulepreload` hints for these Firebase modules. Both behaviors are intentionally preserved because changing them without a replacement public-data transport would break the portfolio.

Consequently:
- No reduction in first-visit Hero reveal time, LCP, CLS, Firestore reads, Firebase transfer, or worldwide responsiveness is claimed.
- This change cleanly separates private messaging so a separately authorized future snapshot experiment can remove public Firebase startup without breaking puzzle warmup or private conversations.
- The next meaningful speed candidate is an all-at-once public JSON snapshot with server-side validated publication state; free delivery and safe, coherent cross-region revision invalidation remain architectural research, not implementation.

## Required before any merge or production release

1. The owner must separately approve **preview-only** hosting deployment of this branch.
2. Compare candidate against exact PR #72 baseline on equivalent desktop, compact, mobile and iPhone Safari sessions, including cold and warm loads, console errors, network waterfall, user-opened private messages, challenge/puzzle, push notification permissions, and Admin thread subscriptions.
3. Verify no visual/animation/CLS regressions and that privacy, unpublished records and security controls are unchanged.
4. If actual speed is unchanged (plausible because public Firestore still loads), do not claim a performance win or merge solely on that basis.
5. No production merge, Hosting/Worker deploy, Firebase billing upgrade, secrets/configuration, user-data, or Admin security change is authorized.

**Release classification: implemented and automated-tested, not runtime-verified; production unchanged.**
