# Public Message Openverse search outage — 2026-10-31

## Status
**Implemented and automated-test verified; NOT deployed, merged, or fully runtime-verified.**

Repository: `shin-ich1/Myportfolio`.
Isolated branch: `fix/public-message-openverse-outage-20261031`, based on existing verified PR #40 head `5691624f33f59e4190040b756ee85087581888b6`; known-good LIVE Hosting source is `bf959a647b18a75b0826de0bbdcbef9bccc68e22`. Keep PR #40 browser loading improvements as a single ancestor, not competing feature owners.

## Confirmed root-cause evidence
- Owner supplied LIVE Chrome Network screenshots from `rolando-portfolio-3f1a3.web.app`: multiple `/messages/security/challenge` requests were pending for roughly **1.1–1.4 minutes**, then HTTP **503**; a later challenge succeeded with **201**, and its image arrived in about **723 ms**.
- 503 response JSON included `"code":"message-puzzle-image-search"`. Canonical Worker `loadOpenversePuzzleImagePool` throws this exact code only when Openverse `GET /v1/images/` returns non-OK. A stalled search had no explicit fetch deadline.
- Open upstream incident: https://github.com/WordPress/openverse/issues/5649 (opened October 20; corroborated October 30). Other clients report uncached search requests timing out or returning 502. **The screenshot does not expose the upstream HTTP status**, so do not claim this LIVE request necessarily received a 502 upstream.

## Canonical correction — Worker only
- `telemetry-worker/src/index.js`: retain existing Openverse/KV/Cache API owners and implement a 5-second deadline on Openverse searches, 3.5-second deadline per candidate image fetch, and a 2-minute cached fallback when searching cannot produce a ready image pool.
- Fallback uses existing browser-friendly Worker image endpoint, existing caching and image validation, and a **small fixed catalog of genuine public-domain/CC0 photographic landscapes**, published independently on Wikimedia Commons. A successful challenge must still have an actually retrievable image, not just metadata.
- The Openverse pool resumes automatically after the short fallback TTL when upstream recovers. Do not repeatedly request a failed pool on every visitor challenge.
- Server-side puzzle answer, nonce, cryptographic proof, anti-replay binding, rate limits, Turnstile Siteverify and hostname/action validation, Firebase Admin, Firestore rules, OAuth, Public/Admin styling and content are untouched. Fail closed if all photos are unavailable.

## Public-domain fallback image provenance
All fallback images retain creator/title/landing-page metadata and only use existing `cc0` or `pdm` license values:
1. CC0 snowy mountains by troubletrace ux: https://commons.wikimedia.org/wiki/File:Landscape-3773899_1280.jpg
2. Public-domain Chitkul photo by Prolaykundu: https://commons.wikimedia.org/wiki/File:Chitkul.JPG
3. Public-domain aerial Clackamas River by U.S. Bureau of Land Management: https://commons.wikimedia.org/wiki/File:Aerial_view_of_the_Clackamas_Wild_and_Scenic_River_(48009760882).jpg
4. Public-domain Yosemite Valley photo by Jon Sullivan: https://commons.wikimedia.org/wiki/File:Yosemite_valley_and_half_dome_from_glacier_point.jpg

## Reproduced regression and successful test evidence
- **Red baseline** on original PR #40 Worker code (no fallback/abort): https://github.com/shin-ich1/Myportfolio/actions/runs/41164929962; **107/109 passed, 2 expected failures**: non-OK Openverse results stop challenge; never-settling search blocks beyond the test deadline. The third test confirms fail-closed behavior.
- **Green branch**: https://github.com/shin-ich1/Myportfolio/actions/runs/41164811623; **109/109 passed**, browser DOM simulation on Chromium at **375×812, 430×932, 1440×900** passed; three checked Wikimedia image redirect endpoints returned **200 image/jpeg**; JS syntax checks passed.
- CI workflow now also checks all four fallback photo URLs (see subsequent final run).
- The Chromium simulation uses an offline fixture and stub Turnstile/Worker calls; it is **not** end-to-end production browser verification. Curl reachability from GitHub runner is not proof of fetch from a Cloudflare Worker region.

## Changed files
- `telemetry-worker/src/index.js`: canonical outage resilience and fallback, no duplicate verification owners.
- `tests/public-message-openverse-outage.test.mjs`: upstream 502, hung fetch with abort, source-license/cache and fail-closed regressions.
- `.github/workflows/media-regression.yml`: run tests on isolated branch, worker syntax and Chromium smoke test, validate fallback URLs; no release/deploy step.
- `release-reports/public-message-openverse-outage-20261031.md`: evidence, audit and limitations.

## Runtime signoff required before deployment
1. With explicit owner authorization and **nonproduction** Worker/Firebase credentials, verify challenge response under Openverse failure, verify SVG/photo delivery and slider, solve Turnstile, send an isolated message, and confirm Admin receipt without touching existing LIVE messages.
2. Test on actual iOS Safari and Android Chrome, then representative in-app browsers. Test normal cold-path and fallback latency from Worker; do not claim exact speed until measured.
3. Verify upstream response timings, no new network errors, and unchanged Admin/Public responsive layout.
4. Confirm latest deploy baseline, tests and final diff. Obtain **separate explicit production deployment approval**; no production deployment performed during this investigation/implementation.
