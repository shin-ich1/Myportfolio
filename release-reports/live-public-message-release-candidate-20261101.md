# LIVE Public Message release candidate — 2026-11-01

> **CURRENT STATUS 2026-11-01 (supersedes older status lines below):** LIVE Cloudflare Worker PR #51 published as version `bd89f743-1dfc-40b9-839a-f09e388a21cd` at 100%. LIVE Firebase Hosting **NOT deployed**: guarded preflight discovered LIVE CSS differs from GitHub main. Corrected clean candidate preserves actual published LIVE CSS and passed 11/11 release checks and 144/144 available tests. Full Hosting publish and runtime checks pending.

**Status: implemented and automated-test verified in an isolated draft branch. NOT deployed to LIVE or STAGING. Runtime parity and production-worker source provenance are NOT verified. Release HOLD.**

## 1. Provenance and baseline

Repository: `shin-ich1/Myportfolio`. Release candidate branch: `release/live-public-message-parity-20261101`, based on current GitHub `main` commit `ef8ed543fb2184de40c0f197d5212bd6534d880b` (reconfirmed unchanged during audit).

Actual user-supplied **LIVE Hosting** read-only SHA audit:
- `app.js`: Git blob `d570bfd036fb6dc2a9b5a1de94c5f2cac0031257` (not equal to GitHub `main`).
- `message-service.js`: `764a353722a63067b0335f80c17c09fbbfc00a06`.
- `styles.css`: `fe7db31f32c0cbe85e144fb67e713723325303e7`.
- `index.html`: `866e6f18329496f31e7d2bdf5a713ed3771f29c0`.
- `admin/index.html`: `0f9dbf11ecdf707cbfbe4f8308823ac93e0ffa92`.

GitHub `main` matches the latter four. Actual published LIVE `app.js` differs only from `main` in the improved storage/privacy footer (four live lines replacing one line); **the exact LIVE app is the true merge baseline.** The candidate app preserves the entire actual LIVE source outside the canonical Public Message section (frozen prefix fingerprint `81403db9`, suffix `c8365446`; includes storage/privacy footer, static media variants, video, animations, responsive and startup code). This was audited before writing and enforced by a CI regression guard.

Actual user-supplied Cloudflare production deployment: Worker `lan-cloudinary-telemetry`, version `7dbe1cae-6933-42e0-86ec-e1ed37f1bbb3`, 100% traffic. **The exact deployed Worker script for that version has not been retrieved or byte-verified.** GitHub `main` Worker is only a candidate source baseline, NOT proof of runtime parity. Do not deploy until actual production Worker source/config/bindings are independently verified against the release baseline.

Verified STAGING source inputs:
- Firebase Hosting PR #50 source `675bb8fedd94931ab360a30695e3797d5d8e11dc`, staging image-ready cooldown in `app.js` (including prior PR #48 verification and challenge reliability).
- Cloudflare Worker PR #47 source `4202c568711ce8fed416dac462cbe16cc2605c71`, with canonical SecurityCoordinator cooldown owner, 1% strict puzzle verification, 10s server retry, offline landscape fallback.
- Staging code-run/owner videos: repeat wrong puzzle cooldown and 5s wait; new image displays; two successful private-conversation messages. **Staging Admin inbox receipt was not observed.** LIVE behavior was not tested.

## 2. Root cause and exact migrations

GitHub main originally contained 4% slider tolerance; no server wrong-answer cooldown; frontend awaiting Turnstile on every wrong slider release; no 5s image-readiness gate; stale image/blank puzzle while preparing. Those are production candidate source discrepancies versus verified STAGING.

1. `app.js`: STARTED from the actual published LIVE file, then replaced **only** the canonical Public Message section between `const PUBLIC_MESSAGE_TURNSTILE_SRC` and `function publicServicesValid` with the verified final STAGING message owner. No changes outside those boundaries. Preserves all LIVE-only footer/media/startup functionality and imports.
2. `message-service.js`: exact STAGING file; only two differences from `main`: delegate obviously wrong-answer verification to server without client-side Turnstile delay; prevent an initial messages snapshot arriving before thread from incorrectly closing conversation.
3. `styles.css`: NOT copied wholesale. Migrated only the existing canonical puzzle card/footer/Turnstile selectors and hidden WebKit scroll bar, to match tested STAGING clipped-footer fix. ALL other LIVE CSS retained.
4. `telemetry-worker/src/index.js`: exact PR #47 source; line-based comparison to `main` found only 17 hunks, all within the Public Message puzzle/image owners. Includes 4% → 1% verification tolerance, 10-second Worker-enforced third-wrong cooldown/429/retryAt, image provider timeouts, offline fallbacks, and origin-protected single-use proof unchanged. No Firebase Admin gateway or production configuration changes.
5. `telemetry-worker/src/security-coordinator.js`: exact PR #47 owner; one new 28-line cooldown command block in the existing durable security owner. No duplicate state owner or authentication bypass.

## 3. Regression-first verification

- [RED CI #41280994449](https://github.com/shin-ich1/Myportfolio/actions/runs/41280994449): 6/8 new LIVE release checks failed on the unmodified GitHub `main` baseline; expected missing LIVE footer, message countdown, strict Worker tolerance, durable cooldown.
- [GREEN CI #41281356953](https://github.com/shin-ich1/Myportfolio/actions/runs/41281356953): **10/10 LIVE-specific checks and 143/143 available Node tests passed**, zero failures or skips within those executed groups (nine checks are included in 142).
- Original staged security and interaction regressions were copied into the candidate (6 strict-alignment, 6 durable-cooldown, 9 image-ready, 5 fast-retry, expired-puzzle actual controller, image-error recovery).
- Production-config Wrangler 4.156.0 **dry-run bundle successful**; JS syntax checks passed.
- Not run: Firestore emulator-only/other suites not present in `main`, real Workerd Siteverify, live Firebase security emulator, Cloudflare Worker runtime, provider availability, live cross-browser message delivery, actual Admin inbox, iOS/Android responsive browser. Passing CI is not runtime verification.

## 4. Diff and security audit

Expected application source changes: exactly `app.js`, `message-service.js`, `styles.css`, `telemetry-worker/src/index.js`, `telemetry-worker/src/security-coordinator.js`. Other changes are tests, isolated **no-deploy** CI workflow and this report.

Unchanged: `config.js`, `.firebaserc`, `firebase.json`, `telemetry-worker/wrangler.jsonc` (production Worker `lan-cloudinary-telemetry` / Firebase `rolando-portfolio-3f1a3`), `index.html`, `admin/index.html`, all other Admin code, Firestore rules, asset files and Public CSS unrelated to the puzzle. No credentials, private keys, tokens, service account material or secrets were created in source. A published Firebase web API key in existing config is a client-side identifier, NOT a newly added private secret.

Turnstile Siteverify remains server-side; correct slider must obtain a browser proof; proof is server-issued, bound to origin/session, atomic, expires and is consumed once. Unaligned wrong answers never receive a proof. The 10-second server deadline cannot be shortened from the browser. The extra five seconds are client UI readiness, not security enforcement. Do not claim secure production until authenticated runtime and actual Worker secrets/bindings verified.

## 5. Mandatory release gates — HOLD

1. Independently verify the **actual LIVE Worker version's source/config and secret/binding names** against the approved production baseline. A GitHub `main` Worker source hash does not establish what the 100%-traffic version contains. If the deployed version has newer work, reconcile it in this isolated candidate rather than overwriting it.
2. Audit all files in a production-equivalent Hosting build against the actual LIVE host, not only GitHub `main`. Require no unintended changes to Public design, media, Admin, Firestore rules or runtime configuration. Do not use STAGING's Firebase web keys, KV IDs, Durable Object IDs or Turnstile key.
3. Perform optional isolated production-parity browser test (no production deployment), source compatibility across desktop/tablet/mobile and correct message/Admin receipt in an authorized environment. Follow through on any unresolved errors, particularly external Openverse slow-failure/image repetition.
4. Re-run full available suite and Worker dry-run on final reviewed commit. If tests cannot run, report as unverified; do not silently waive security tests.
5. Request **separate explicit permission for LIVE Worker deployment and LIVE Firebase Hosting deployment** and follow a reviewed rollback plan. Do not deploy from this draft branch automatically, merge into production, or update production security settings.

**Deliverable:** isolated source release candidate, tests and this report. **Release status: NOT DEPLOYED; production runtime unverified.**

## 6. Canonical code clean-up (owner-approved, no deployment)

After the original release candidate was prepared, audited the complete Public Message function/variable ownership graph in `app.js` and the Worker/Coordinator. All 32 named Public Message functions were referenced, and each canonical countdown, puzzle loader, image warmer and verification handler had one declaration. The coordinator has one `if (op === "puzzle-cooldown-start" || op === "puzzle-cooldown-check")` owner branch with an additional legitimate start-specific subcheck. Media query rules reuse existing puzzle CSS selectors intentionally and are not competing owners.

**Removed** one genuinely dead declaration: `PUBLIC_MESSAGE_PUZZLE_NEXT_WARMUP_DELAY_MS = 120` from the canonical Public Message section. It had zero references and was a leftover from the older warmup timing. No alternate implementation, compatibility wrapper, duplicate handler or CSS override was added. No other code was removed speculatively.

- [Cleanup RED](https://github.com/shin-ich1/Myportfolio/actions/runs/41282170855): new cleanup regression failed on obsolete constant.
- [Cleanup GREEN](https://github.com/shin-ich1/Myportfolio/actions/runs/41282268322): **10/10 release checks, 143/143 available Node tests, Worker production-config dry-run and syntax passed** (10 checks included within 143).
- Failing intermediate run after removal was due to an invalid test expectation treating two legitimate conditional checks inside **one** coordinator owner as duplicate handlers; corrected the test, not the secure runtime logic.

The original LIVE source outside the messaging boundary remains byte-preserved; hosting and Worker are NOT deployed and old production code still runs until a separately approved live release. Historical deployment versions remain available for rollback even once a new build is published.

**Current RELEASE HOLD unchanged:** deployed production Worker exact source and runtime parity remain unverified, so clean code does not equal production release approval.

## 7. LIVE CSS root cause and final corrected baseline (supersedes earlier CSS/source status)

User's first PR #51 LIVE Hosting command **stopped before deployment** on `styles.css` mismatch. Two independent Firebase domains returned the same old LIVE CSS Git blob `fce337ffba12417d122a73a5cbbc86ae2a8e11a4`, which differs from GitHub `main` blob `fe7db31f32c0cbe85e144fb67e713723325303e7`. Other audited LIVE files matched expected values. This is a real production-only CSS change, not a caching delay. The current LIVE CSS includes 60 more lines, among them newer footer/storage/privacy styling.

**Canonical correction:** candidate `styles.css` now starts from the exact LIVE blob, replaces **only one existing top-level compressed Public Message puzzle-owner rule line** from verified STAGING, and preserves every other LIVE CSS byte. New candidate blob `978dd048b3a5a029b4cbb9436774e9bdac2ec1d6`; frozen pre-rule FNV1a `7551b6c1`, post-rule FNV1a `47763787`. No duplicate selector, patch layer, or visual redesign. Responsive media query behavior and LIVE footer styling are preserved.

- [LIVE CSS RED regression](https://github.com/shin-ich1/Myportfolio/actions/runs/41286546534): 10/11 targeted tests; missing LIVE CSS production-preservation guarantee identified.
- [Corrected LIVE CSS GREEN](https://github.com/shin-ich1/Myportfolio/actions/runs/41286899300): **11/11 LIVE-specific and 144/144 available Node tests** passed; JS syntax and production-config Worker dry-run passed. The 11 release checks are part of 144. Test implementation corrected two overly restrictive assertions about existing responsive selectors and visually-hidden status footer; runtime security code was not weakened.
- LIVE Worker **already deployed** (new version `bd89f743-1dfc-40b9-839a-f09e388a21cd`) after source-bundle parity and binding audit. Original rollback version `7dbe1cae-6933-42e0-86ec-e1ed37f1bbb3`.
- **LIVE Hosting NOT deployed:** all future commands must use the updated candidate commit (not obsolete `e061bb11`), compare actual remote CSS against `fce337ff...`, and verify all unchanged production site assets before upload. If any other production-only source or asset is discovered, STOP without overwriting. Firebase Hosting previous release remains rollback reference.

**Current release gate:** guarded LIVE Hosting deploy and post-release browser/server/message/Admin regression remain pending. This report's earlier statements that LIVE Worker was unverified or undeployed are historical and superseded by this section.
