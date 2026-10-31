# Public Message first-image loading and cross-browser reliability — 2026-10-30

## Release status

**Implemented and source-test verified; NOT runtime-verified; NOT merged or deployed.**

Repository: `shin-ich1/Myportfolio`
Known-good deployed Firebase Hosting source baseline: `bf959a647b18a75b0826de0bbdcbef9bccc68e22` (Privacy Policy PR #38).
GitHub default `main` remains at `ef8ed543fb2184de40c0f197d5212bd6534d880b`, so this work was intentionally based on the **deployed** version, not the older default branch.
Isolated branch: `fix/public-message-first-image-browser-20261030`.
Existing historical overlapping drafts: PR #36 and PR #11; canonical pieces reconciled, not stacked as independent runtime owners.

## Reproduced source defects

- The original first challenge image preload awaited the external Turnstile JavaScript Promise via `Promise.all`. A slow, blocked or pending verification script delayed the **first puzzle image** unnecessarily.
- The existing controller constructed `new ResizeObserver(...)` unconditionally. Browsers/WebViews without that API could throw before the puzzle became interactive.
- The original Turnstile `execute` callback Promise could wait indefinitely when callbacks were absent.
- The original Turnstile `size: "flexible"` could be unsuitable for the narrow mobile puzzle parent; the hidden `:empty` widget slot itself cannot provide a valid pre-render width.
- The script loader could also stay pending if a browser extension/network/browser never fired script load or error.

## Minimal canonical implementation

1. `app.js`
   - Fetch challenge and preload its first image independently of external Turnstile readiness; start the script download in parallel.
   - Display the image before waiting for the verification library; **do not bypass** mandatory Turnstile verification.
   - Use the imported canonical `isPublicDocumentFlowMode` and measurable **parent** width to choose `compact` on narrow/mobile surfaces and `flexible` on wide desktop.
   - Use one `ResizeObserver` owner, with a removable window-resize fallback when unavailable.
   - Add bounded 60-second Turnstile execution settlement, cancellation on modal close, cleanup and reset on failed verification.
   - Add bounded 20-second **script load** watchdog with script cleanup and retry through the existing single loader Promise.
   - Preserve existing Public Message modal appearance, server challenge calls, message sending and security proof checks.
2. `tests/public-message-first-image-cross-browser.test.mjs`
   - Source-level regression for image warmup independent of delayed Turnstile.
   - Fallback geometry/cleanup tests.
   - Responsive compact/flexible selection tests.
   - Backend action, hostname and verified proof requirements unchanged.
   - External script watchdog, shared in-flight Promise, simulated timeout cleanup and successful retry.
3. `.github/workflows/media-regression.yml`
   - CI trigger restricted to isolated branch; added syntax check of new test.

## Evidence and verification

- Red baseline: https://github.com/shin-ich1/Myportfolio/actions/runs/41071280962 — 99 passed, 4 failed (targeted first-image, geometry, timeout/retry, compact sizing).
- Additional red regression: https://github.com/shin-ich1/Myportfolio/actions/runs/41071716714 — 104 passed, 1 failed (stalled script loader).
- Latest fully passing automated run: https://github.com/shin-ich1/Myportfolio/actions/runs/41072291651 — **106/106 passed, 0 failed, 0 skipped**; syntax checks passed.
- Diff from deployed source: `app.js`, `tests/public-message-first-image-cross-browser.test.mjs`, `.github/workflows/media-regression.yml` only (plus this report).
- Source browser mocks DO NOT establish actual iPhone Safari, Android Chrome, Firefox, Edge, or Cloudflare Turnstile widget compatibility.
- First image is **not guaranteed instant**: a cold Openverse image pool, Worker/image network, and browser cache can still delay initial challenge/image fetch. Worker image-pool logic was not changed without an observed runtime bottleneck.
- If a browser/network blocks Turnstile entirely, verification must fail safely and may require unblocking/retry. No client-side bypass is allowed.

## Security and regression audit

- No modification to `telemetry-worker`, Durable Object, challenge ownership, Turnstile Siteverify, server hostname/action validation, Firebase/Firestore rules, Admin, storage, OAuth, uploaded files or production.
- Existing Privacy Policy and footer, live Public Portfolio appearance, video/media system and Admin preserved in the branch's deployed baseline.
- No duplicate handlers, extra mobile implementation, duplicate Turnstile script loader, or redundant CSS overrides.
- Only the existing puzzle controller and loader gained failure handling. Single settling owner for pending execute callbacks.
- A passing CI run does not replace browser/device integration testing. Source status remains **implemented but not runtime-verified**.

## Required before a future release

1. Stage and verify first image appearance and slider operation at iPhone 375/393/430px (Safari), Android Chrome, desktop Chrome/Edge/Firefox, small tablets and wide desktops; include emulated and real device results when available.
2. Verify blocked/slow third-party script shows error and permits reopening/retry, without bypassing Turnstile.
3. Verify full challenge solve, server-side verification and Public Message delivery plus Admin inbox receipt with a safe test message.
4. Inspect browser Console/Network timings for `/messages/security/challenge`, image endpoint and Turnstile script. Measure first-image performance versus the current production reference before claiming a performance gain.
5. Revalidate latest GitHub/production baseline, reconcile dependent PR branches, run full tests, audit final diff, and obtain **separate explicit approval** for merge and production deployment.


## Isolated real-browser smoke verification (2026-10-31)

The owner approved a test-only browser harness. Rather than creating another Firebase project or accessing existing staging security records, added \`tests/public-message-browser-smoke.html\` plus an offline \`tests/puzzle-browser-fixture.svg\`. Both are ignored by Firebase Hosting through the existing \`tests/**\` deployment exclusion.

The fixture fetches the **actual branch \`app.js\` text** from its own local web server and executes extracted canonical image preloader, warmup, image-renderer, responsive Turnstile-size expression, and script loader with local test-only values. It never performs real challenge, Turnstile, Firebase or production message network calls.

- Passing CI run: https://github.com/shin-ich1/Myportfolio/actions/runs/41162605472
- **106/106 Node tests passed** (0 failed/skipped).
- **Actual headless Chromium** smoke test passed at requested window sizes **375 × 812**, **430 × 932**, **1440 × 900**.
- Checks in each run: actual SVG fixture loads and paints into an image element despite an unresolved mock Turnstile Promise, responsive compact/flexible selection from canonical source, script-load watchdog, script cancellation on timeout, and successful retry.
- CI syntax checks passed. No changes made to application behavior or security controls as part of this test harness.
- This is browser-executed simulation, **not** a proof that live Cloudflare Turnstile challenge rendering, actual iPhone Safari, Android WebView, Facebook/Messenger/Instagram/TikTok in-app browser, Google API image fetch, or delivery to the Admin inbox succeeds.
- A passing local fixture gives no reliable latency number for the Openverse/production image path. A controlled runtime test with authorized nonproduction credentials and a compatible Turnstile host remains required for a complete release signoff.

No production hosting/Worker deploy, merge, Cloudflare settings, Google Drive, Firebase records or private-message writes were performed.
