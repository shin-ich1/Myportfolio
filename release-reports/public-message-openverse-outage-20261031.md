# Public Message puzzle outage — root cause, isolated fix and runtime tests (2026-10-31)

## Release status
**Source fix implemented; source tests and isolated real-Worker challenge/image runtime tests passed. NOT merged, NOT deployed, NOT verified against actual production messaging delivery.**

Repo: `shin-ich1/Myportfolio`. Isolated branch: `fix/public-message-openverse-outage-20261031`, based on frontend PR #40 at `5691624f33f59e4190040b756ee85087581888b6`. Known-good LIVE Firebase Hosting source is `bf959a647b18a75b0826de0bbdcbef9bccc68e22`. Both frontend and backend fixes must be reconciled before any separately authorized release.

## Observed LIVE failure and exact cause
- Owner-provided Chrome Network evidence: `/messages/security/challenge` returned **503** after roughly 1.1–1.4 minutes; other attempts succeeded with **201**; an actual puzzle image returned 200 in about **723 ms** when the challenge succeeded.
- Owner-provided 503 JSON error code was **`message-puzzle-image-search`**. Its canonical Worker owner is `loadOpenversePuzzleImagePool`, which requests the external Openverse image search API before returning the challenge.
- An independently reported [Openverse upstream incident](https://github.com/WordPress/openverse/issues/5649) describes uncached search hangs and occasional 502 responses (October 20–30). The owner screenshot does **not** disclose the upstream HTTP status; only the Worker's 503 is confirmed.
- Original application required waiting for Turnstile script alongside image challenge; browser-side first-image improvements are covered by predecessor PR #40 and remain untouched here.

## Root-cause-specific correction
- Canonical file: `telemetry-worker/src/index.js`. Bound Openverse search requests to **5 seconds** and external photo fetches to **3.5 seconds**, preserving existing shared ready-image pool, KV and Worker Cache semantics.
- On Openverse pool failure, cache a small **120-second first-party emergency landscape pool** in the existing canonical KV namespace.
- The final emergency image is an **original, deterministic, self-contained SVG generated and served on the existing secured Worker challenge-image route**, no Wikimedia/photo host, no extra external API, no new puzzle or verification owner.
- Original artwork is labeled `LAN Portfolio` / `original` and generated without scripts, user content or remote image URLs. The normal Openverse photo system remains the preferred source. SVG artwork appears **only if the Openverse photo-ready pool fails**.
- Server-owned puzzle geometry, challenge TTL and origin binding, IP/UA binding, rate limits, Durable Object challenge state, challenge answer verification, anti-replay nonce, Turnstile token verification and hostname/action checks remain in place. Firestore, Admin, Google Drive, Firebase hosting config and existing layouts are unchanged.

## Why the originally proposed Wikimedia fallback was removed
- Three Wikimedia photo redirects answered HTTP 200 to ordinary GitHub-host `curl` checks, but the **same requests from an actual local Cloudflare Workerd runtime** returned **403** (including direct upload URLs), so they were NOT dependable.
- Original isolated Worker runtime run reproduced **503 `message-puzzle-image-unavailable`**, despite passing 109/109 mocked tests. See https://github.com/shin-ich1/Myportfolio/actions/runs/41165852843.
- Workerd 403 diagnostic: https://github.com/shin-ich1/Myportfolio/actions/runs/41165971729. Diagnostic-only files and third-party fallback were removed from final source.

## Evidence and actual tests
- **Expected-red regression against original source:** https://github.com/shin-ich1/Myportfolio/actions/runs/41164929962 — **107/109 passed**, two targeted failures for 502 and indefinitely blocked Openverse search.
- A separate regression added after the Workerd 403 evidence ensures the final fallback image is self-contained and served by canonical Worker route.
- **Green source tests:** complete Node suite; original Chrome DOM smoke tests at **375×812, 430×932, 1440×900** using an offline fixture. This is Chromium-only and is not real Safari or in-app browser verification.
- **Green actual isolated local Cloudflare Workerd runtime** using Wrangler 4.156.0, dummy project ID, dummy credentials, local KV and Durable Object storage, and official localhost Turnstile test site key: https://github.com/shin-ich1/Myportfolio/actions/runs/41166276705.
  - Normal Openverse puzzle `POST /messages/security/challenge` → **201**, `GET .../image` → **200 image/jpeg**. Sample time **9,142 ms** (another passing run sampled 5,400 ms). These are observational, not performance guarantees.
  - After seeding the real generated-art catalog into **isolated local KV only**, new challenge `201` in **27 ms**, real first-party image `200 image/svg+xml` with 6,996 bytes. SVG was inspected for safe structure.
  - No real Firebase, Firestore or message-send endpoint was called, no private message or data was created, and no production settings changed.
- Every GitHub Actions job is test-only, contains no deploy or merge step.

## Files and scope
- `telemetry-worker/src/index.js` — single canonical source owner for Openverse outage fallback and image route.
- `tests/public-message-openverse-outage.test.mjs` — target regressions, fail-closed rule, original artwork/HTML-independent SVG safety.
- `tests/message-worker-runtime-smoke.mjs` — real local Workerd challenge and image flow checks; **never** sends a message.
- `tests/wrangler-message-runtime-smoke.jsonc` — fully isolated local-only Worker/KV/DO with explicit dummy values, **not production secrets**.
- `.github/workflows/message-worker-runtime-smoke.yml` — local Workerd smoke, forced local KV fallback, no deployment.
- `.github/workflows/media-regression.yml` — full Node and Chromium checks on isolated branch.
- `release-reports/public-message-openverse-outage-20261031.md` — this record.

## Unverified / release blockers
1. Live Cloudflare Worker request latency, Wikimedia-independent fallback image delivery from production Cloudflare edge and real visitor networks.
2. End-to-end actual Cloudflare Turnstile solve, server-side verification proof, private message creation and Admin inbox receipt against an **authorized nonproduction** backend.
3. Actual Safari on iPhone, Android Chrome and Facebook/Messenger/Instagram/TikTok in-app browsers.
4. Final release baseline and rollback plan. **Separate owner approval is required for merging or deploying LIVE hosting/Worker**.

**No claim that production messaging is fixed.**

## Staging-only preparation (2026-10-31, approved; NOT deployed)
- Owner authorized use/update of existing `lan-portfolio-staging` Worker for **staging-only** testing. No authorization to change the LIVE `lan-cloudinary-telemetry` Worker or LIVE Firebase Hosting.
- Owner's Cloudflare dashboard screenshot showed staging Worker `FIREBASE_PROJECT_ID=lan-portfolio-staging`, encrypted staging Firebase service-account credentials, staging Turnstile key/secret, `LAN_STAGING_PORTFOLIO_MESSAGES` and `LAN_STAGING_STORAGE_OAUTH` KV and its own `SECURITY_COORDINATOR`.
- Recovered the **historical** staging-only namespace IDs from `scripts/staging-targets.json` in `fix/staging-turnstile-variable-preservation-20261011`. Restored staging Wrangler config in `telemetry-worker/wrangler.staging.jsonc` with `keep_vars: true`, `preview_urls: false`, staging-specific KV/DO bindings and only `FIREBASE_PROJECT_ID` plain var. No staging secrets copied into GitHub.
- Added `tests/staging-worker-release-preflight.test.mjs` to reject production worker name, Firebase project, KV reuse, missing `keep_vars`, accidentally re-enabled preview URLs and committed secrets. This check **cannot verify actual remote namespace IDs/remote source version**.
- `node --test tests/*.test.mjs` **112/112 pass**, Chrome smoke passes at 375×812, 430×932, 1440×900, and Wrangler `deploy --dry-run --config telemetry-worker/wrangler.staging.jsonc` succeeds with **no cloud deployment**: https://github.com/shin-ich1/Myportfolio/actions/runs/41168644115.
- **Release blocker before staging deployment:** confirm the exact remote Staging Worker version/bindings/source baseline (latest owner screenshot displays `a3f7d379` manually deployed roughly 16 days earlier). The archived manifest is not proof that the IDs are unchanged. Must preserve existing staging security sessions, inbox records, secrets, observability and rollback/version information.
- The current Chat connection cannot deploy to Cloudflare or directly inspect Cloudflare account metadata. Production Wrangler config `telemetry-worker/wrangler.jsonc` is NOT a safe staging deployment target. Do not run ordinary `wrangler deploy` without explicit staging configuration and metadata verification.
