# STAGING Public Message — fast wrong answers and form countdown (2026-11-01)

**Status: implemented, automated-test verified; NOT deployed to staging or LIVE.**

## Correct baseline
- Repo: `shin-ich1/Myportfolio`. Frontend baseline: last deployed STAGING PR #45 commit `e993d505de0ccc5934737c14b035cfd48f17854e`.
- Isolated frontend source: draft PR #48 `fix/staging-puzzle-fast-retry-countdown-ui-20261101`.
- Server Worker baseline stays at deployed PR #46; draft PR #47 adds authoritative server cooldown without overwriting the PR #45 frontend.

## Root cause
For every wrong slider release, client `slider.onchange` blocked on `runTurnstile()` before contacting the authoritative Worker, potentially waiting 45 seconds. A wrong-answer retry reset an unspent Cloudflare token. After three incorrect answers the backend gave `outcome:replace` and client immediately fetched another image, not closing the puzzle or showing countdown.

## Canonical minimal fix
- `app.js`: only attempts within one slider step of the displayed target await/consume Turnstile. All answers still go through the canonical Worker verification endpoint; a correct answer **cannot** send without server Siteverify and server-issued one-use token. Wrong attempts no longer reset unspent browser proofs. Existing HTTP 429 error path closes the overlay, discards warmup and uses the existing form-level countdown to show **Three incorrect puzzle attempts. Retry in Ns** for the new Worker code. Existing typed fields remain intact.
- `message-service.js`: allow empty Turnstile token to reach the Worker for **wrong-answer checking only**; it is impossible to receive the successful server proof with an empty token because the Worker verifies Turnstile before minting one. No duplicate backend, handler or bypass of server authorization.
- No CSS, animations, responsive layout, image provider, Admin or Firebase configuration changes.

## Tests and audit
- New targeted tests for conditional Turnstile wait, authoritative Worker request and countdown handling. Existing controller functional fixture now covers wrong answer with no Turnstile wait/reset, third-wrong 429 close and form countdown, correct answer with consumed Turnstile, legacy 410 recovery, image-load failure, server 429 deadline and single use proof.
- RED expected failing fast-answer/new countdown regression on PR #45 baseline; GREEN final [GitHub Actions 41273335663](https://github.com/shin-ich1/Myportfolio/actions/runs/41273335663): **5/5 targeted passed; 267/267 available non-emulator tests passed**, zero failures (counts overlap), JS syntax passed. Two emulator-only suites explicitly not run because no isolated Firebase emulator was provisioned. Do not describe this as a full emulator pass.
- Frozen Public and message-service SHA tests re-pinned to the exact new assets. Audited main-source comparison remains strict; the one removed frontend-only no-token guard is normalized by an exact, one-occurrence assertion; server-required Turnstile assertions remain. No generic security test exclusions.
- Changed: `app.js`, `message-service.js`, the two exact-source contracts, existing expired puzzle/controller and Turnstile lifecycle tests, new targeted test, isolated CI workflow and this report.

## Release gates
1. Obtain separate STAGING Hosting-only deployment authorization; build via tracked-only staging builder with known staging-only project and API key, diff entire 199-file publishable tree against deployed PR #45 and ensure only `app.js` and `message-service.js` are changed.
2. Pair with PR #47 **Worker-only** deployment, with separate approval and security/binding audit. Mixed versions may have old `replace` behavior until both are deployed.
3. Runtime verify three incorrect slider attempts, immediate feedback, server 429 exact countdown, no message creation, retry expiry, valid alignment, Turnstile, Admin receipt and mobile/compact/desktop layouts.
4. No LIVE deployment without separate approval. Image failures and photo variety remain unresolved.
