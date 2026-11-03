# Combined Storage + Public Message Puzzle release candidate — 2026-11-03

**Status:** implemented and automated-test-verified on an isolated candidate; **NOT merged, NOT deployed, NOT real-device runtime-verified**.

## Immutable source provenance

- Repo: `shin-ich1/Myportfolio`
- Authorized GitHub main: `4ca4fcfedc7959335d78517702638c1dda51f6f4`
- Candidate: `release/combined-storage-puzzle-candidate-20261103`
- PR #55 source baseline: `3d74d9c995ddc238e0cd77a8f53e470c47ce55d3`
- PR #56 source baseline: `af58f50867eb6849ea9b10a6a36b9b6a55e5255f`
- No merges into main, Firebase deploys, Cloudflare deploys, Google OAuth changes, or production database modifications.

## Demonstrated root causes and changes

1. **Google Drive Admin health label:** `admin/js/settings.js` used to call any unhealthy snapshot "Reconnect required", including temporary network/Worker failures. Carries forward the exact approved PR #55 blob and seven tests; a transient failure displays "Connection check failed" / "Retry Connection Check". True missing/revoked authorization still displays reconnect. No token storage or backend auth changes.
2. **Public puzzle image warmup:** `app.js` previously awaited Turnstile JavaScript with the challenge, needlessly delaying image preparation. PR #56's canonical warmup decouples them; server verification is still mandatory.
3. **Cross-browser resize:** the same Public controller used `ResizeObserver` unconditionally. PR #56 adds one start/stop geometry watcher with a browser-resize fallback and cleanup. No CSS or layout changes.
4. **Cancel/close race, reproduced on combined baseline:** closing during a pending browser proof left the async slider work unresolved until its watchdog; closing during delayed Turnstile loading could render a stale widget. The canonical owner now aborts the pending proof, clears its timer, disregards late tokens, tracks current puzzle generation across async awaits, and avoids Worker requests or UI mutation for a closed/stale challenge. Preserves the newer `execution: "render"`, token single-consumption, 45s timeout, 429 security countdown, and server Siteverify gates.

## Regression-first automated evidence

- PR #55 storage regression initial failure, then 158/158 PASS:
  - https://github.com/shin-ich1/Myportfolio/actions/runs/41558993343
  - https://github.com/shin-ich1/Myportfolio/actions/runs/41559368874
- PR #56 browser/resize regression initial failure (5 target failures), then 156/156 PASS:
  - https://github.com/shin-ich1/Myportfolio/actions/runs/41561654009
  - https://github.com/shin-ich1/Myportfolio/actions/runs/41561986972
- Combined candidate before cancellation fix: **163/165 passed**, precisely two new cancellation regression tests failed:
  - https://github.com/shin-ich1/Myportfolio/actions/runs/41563257443
- Candidate after canonical cancellation correction and test-harness update: **165/165 PASS; 0 failed, 0 skipped**, syntax and source ZIP integrity PASS:
  - https://github.com/shin-ich1/Myportfolio/actions/runs/41563571411
- Source-only mocks are not equivalent to real Cloudflare browser proof or real-device UI testing. No false claims of production fix.

## Changed-file ownership and security audit

- `admin/js/settings.js`: Google Drive Admin status renderer and shared reconnect classifier
- `app.js`: canonical Public puzzle warmup, browser geometry fallback and cancellation generation owner
- `tests/storage-drive-connection-state.test.mjs`: seven storage regression cases, exact PR #55 test content
- `tests/public-message-browser-warmup-resize.test.mjs`: five browser/resize and mandatory server-proof assertions, exact PR #56 test content
- `tests/public-message-expired-puzzle-recovery.test.mjs`: existing runtime test harness updated for real geometry/cancellation owners, plus two red/green cancellation regressions
- `tests/public-message-image-failure-retry-ui.test.mjs`: fake runtime includes canonical geometry and cancellation state; existing assertion behavior unchanged
- `.github/workflows/media-regression.yml`: isolated test trigger, complete Git history for baseline tests, full Node suite/syntax checks, diff allowlist and source archive; **NO DEPLOY**
- `release-reports/combined-storage-puzzle-20261103.md`: this source/test/security handoff

Existing `styles.css`, Firebase/Firestore, `telemetry-worker/`, Google OAuth/credentials, Admin security, Public media/gallery owners, and disaster recovery source or backups remain unmodified. No duplicate Turnstile owner, CSS override, security bypass, exposed secret, data deletion, or branch deletion introduced. No new server access decisions are implemented in frontend JavaScript.

## Exact source archive

The combined workflow archives HEAD as a single complete source ZIP, verifies `unzip -t`, and publishes one GitHub Actions artifact. The final artifact's exact ID and hash must be read from the **latest successful workflow run**, not from an earlier pre-report run. Artifact retention is 30 days; keep your own private offline copy.

## Still unresolved or not verified

- Actual iPhone Safari/Android Chrome, compact/tablet/wide browser measurements and real Public Message → Worker → Admin receipt after deployment: **NOT TESTED**.
- Admin authenticated real Google Drive status and long-term OAuth refresh stability: **NOT TESTED**.
- The Worker OAuth classification of `invalid_client`/`unauthorized_client` is outside this source fix.
- Historical PRs #11, #21, #36 and #39 and their branches remain preserved for separate regression-test reconciliation.
- Do not merge or deploy without separately approved release gates.
