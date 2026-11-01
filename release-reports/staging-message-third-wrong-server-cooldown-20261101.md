# STAGING Public Message — server cooldown after 3 wrong answers (2026-11-01)

**Status: implemented, automated-test verified; NOT deployed to staging or LIVE.**

## Correct baseline
- Repo: `shin-ich1/Myportfolio`. Source baseline: PR #46 `fix/message-puzzle-tight-alignment-20261101` commit `6eebea9190d417059bdf1d5ce42728d5d1159213`, matching the already deployed STAGING Worker correction (1% puzzle tolerance).
- Isolated worker source: draft PR #47 `fix/staging-puzzle-server-cooldown-20261101`.
- The PR #45 STAGING frontend is a **separate** source baseline; draft PR #48 carries its client change. Neither production source nor current STAGING was modified by these two draft PRs.

## Root cause
Existing Server `puzzle-check` returned outcome `replace` after the third rejected answer, and the existing frontend fetched another challenge immediately with no retry deadline. Meanwhile the client awaited a Turnstile token **before** submitting even an obviously wrong answer. Repeated misses caused re-render/wait cycles with no form-level countdown. This is separate from already fixed 1%-alignment acceptance.

## Canonical server implementation
- `telemetry-worker/src/security-coordinator.js`: reuse the existing atomic SQLite-backed SecurityCoordinator for `puzzle-cooldown-start` and `puzzle-cooldown-check` over one server-owned state record, keyed by canonical server-derived browser binding. A 10s cooldown returns HTTP 429 plus authoritative ISO `retryAt`; repeated starts cannot shorten it. No new state storage or public route.
- `telemetry-worker/src/index.js`: check cooldown before expensive puzzle image generation and before puzzle verification; on third wrong (existing challenge deleted) start the cooldown and return 429 rather than replacing image. Propagate `retryAt` from challenge and verify error paths. Preserve Turnstile Siteverify, origin/binding, nonce, one-use message proof, IP rate limits and 1% tolerance. No Firebase, Admin, image provider, asset, or LIVE settings edits.
- Intentional duration: **10 seconds**, matching the existing client local-image-failure delay while server authority governs this independent wrong-answer gate.

## Red → green
- New regression tests reproduce missing third-wrong cooldown and assert real coordinator state persists, blocks repeated requests, preserves deadline, expires, and checks on both challenge and verification routes. Validate server proof gate order.
- CI RED before implementation: isolated workflow runs on the branch failed expected new regression.
- Final passing no-deploy CI: [GitHub Actions run 41273384223](https://github.com/shin-ich1/Myportfolio/actions/runs/41273384223) — targeted **6/6 passed**, total available Node tests **124/124 passed** (overlapping totals), syntax passed and staging Wrangler `--dry-run` passed.
- Not run: provider-backed Turnstile and actual Cloudflare Worker runtime; Firestore emulator suites and browser integration with PR #48 remain separately unverified.

## Files and change audit
Only `telemetry-worker/src/index.js`, `telemetry-worker/src/security-coordinator.js`, `tests/message-puzzle-wrong-answer-cooldown.test.mjs`, isolated no-deploy workflow and this report change on PR #47. No Worker config, secrets, Firebase security rules, source layouts or Admin files.

## Release gate
1. Obtain separate STAGING Worker-only deployment approval. Confirm the current deployed Worker version, exact PR #46 baseline, configuration, secrets and Durable Object binding; dry-run the final source; deploy only `lan-portfolio-staging`. Keep version history/rollback.
2. Deploy paired frontend PR #48 **separately**, Hosting-only, after diff/manifest audit and owner approval.
3. Verify incorrect answer latency, three consecutive wrong attempts, modal close, accurate 10s countdown, blocked retry across reload/tab, correct answer + Turnstile + one-use proof, message/Admin receipt and desktop/mobile UI.
4. Never release LIVE solely based on passing tests. Image variety and intermittent upstream image availability are separate unresolved issues.
