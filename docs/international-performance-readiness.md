# International public portfolio speed verification — measurement first

**Status:** PREPARED / NOT YET MEASURED. This is an investigation kit, **not** an optimization patch or a release candidate.

**Protected baseline:** GitHub main at the PR base (the published Dashboard Analytics fix is retained); the known-good localhost and LIVE portfolio appearance, interactions, public content, animations and Admin experience must remain unchanged. No device-specific, region-specific, or CSS override fix is authorized.

**Public test URL:** https://rolando-portfolio-3f1a3.web.app/

## Scope and safety
- Public portfolio only. Do **not** run speed tests against /admin, logged-in pages, private Worker URLs, password/recovery/TOTP pages, Firestore access-controlled endpoints, or the message puzzle submission.
- This PR adds an optional **read-only local GET/header probe** and an **offline Lighthouse JSON summarizer**. Neither authenticates, updates data, uploads a file, writes a report to disk, deploys, or changes existing application files.
- Probe target allowlist: the public origin /, /styles.css, /app.js, /static-image-renditions.js. The script is **opt-in**, not run in CI against LIVE.
- The probe reflects the physical machine/network executing it. A run in the Philippines is **not** evidence of speed in London, New York, or Sydney.
- Save measurements privately if they include full network HAR, query strings, cookies, IDs, client IPs, tokens, or other visitor data. Redact those values before sharing. Lighthouse summaries produced by this helper omit raw URLs and responses.
- Production release, code fixes, security configuration and changes to caching require separate owner authorization.

## Already present in approved source (NOT measured abroad yet)
- Firebase Hosting global CDN for hosted static files; firebase.json sets Cache-Control: no-cache, max-age=0, must-revalidate for HTML/JS/CSS, so repeat-request behavior should be **measured**, not assumed to be a long-lived browser cache.
- index.html has Cloudinary and gstatic preconnect hints, a deferred icon script and ES module entry scripts.
- app.js uses lazy image loading / IntersectionObserver, eagerly prioritizes the hero image, and has asynchronous Firestore public startup requests.
- static-image-renditions.js maps bundled assets to prepared .card.webp and .detail.webp variants; config.js contains Cloudinary automatic format/quality image delivery settings.
- The frontend also depends on dynamic Firestore content and remote media; the static CDN alone cannot establish their international latency.
- **No international WebPageTest / PageSpeed results have been collected or verified** in this PR.

## Run the evidence-gathering commands (optional, READ ONLY)

Run from the repository root in VS Code PowerShell, with Node.js 22+:

    node scripts/public-performance-readonly.mjs --help

For basic public static response latency/headers on **your current network only**:

    node scripts/public-performance-readonly.mjs --probe

The output includes status, runner-observed first-response/total duration, decoded body bytes and cache/content headers. **Decoded bytes are not wire transfer size.** A successful response is **not** a Core Web Vitals performance pass. No DNS/regional testing, browser rendering or Firestore waterfall is simulated.

When you have a **saved** Lighthouse report JSON (from Chrome DevTools Lighthouse export or PageSpeed Insights API), analyze locally:

    node scripts/public-performance-readonly.mjs --report "C:\path\report.json" --label "desktop / local / run 1"

The helper accepts either a Lighthouse JSON object or PageSpeed API JSON containing lighthouseResult. Output includes lab performance score, FCP, LCP, Speed Index, TBT and CLS. **TBT is a lab proxy; it is not INP.** This command does not contact the internet.

## Actual overseas test plan

1. Run [PageSpeed Insights](https://pagespeed.web.dev/) on the **public** URL, once for Mobile and once for Desktop. Save the dated results (ideally Lighthouse JSON) and note field data availability. PageSpeed Insights does **not** let you claim a chosen test country from its UI.
2. Run [WebPageTest](https://www.webpagetest.org/) in **Singapore**, **United States (East Coast)** and **Europe (Frankfurt or London)**. Use a comparable browser + mobile network profile for the mobile runs; repeat for desktop. Record chosen actual locations and throttling profiles rather than assuming them.
3. Record **cold first navigation** and **repeat navigation** for each profile, ideally 3 runs. Save screenshots, filmstrips/waterfalls, cache status, errors, and final URL. The same content state and interactions must be used across locations.
4. Capture and compare: first response timing, LCP, CLS, FCP, TBT (lab), total downloaded bytes, largest requests, failed requests, content rendering, and external media latency. Capture INP from **real-user field data** if available; do not substitute TBT.
5. If international samples are slow, inspect the exact slow request/owner before proposing any change. Distinguish Firebase static delivery, Firestore queries/region, Cloudinary/Drive media, third-party icons, and the public JS startup path. Identify one canonical owner, write an evidence-backed regression, then request separate implementation authorization.
6. After any separately authorized fix: verify public desktop, tablet, compact/mobile portrait/landscape, interactive gallery/media, Admin if any shared owner is touched, and repeat the original overseas test profile. Do not deploy until separately approved.

### Blank observation matrix — fill from actual results only

| Location / service | Device / network | Cold LCP | Repeat LCP | CLS | TBT (lab) | TTFB | Dominant slow request | Evidence |
|---|---|---|---|---|---|---|---|---|
| Philippines / local | Mobile / Wi-Fi | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Singapore / WebPageTest | Mobile / selected profile | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| US East / WebPageTest | Mobile / same profile | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Europe / WebPageTest | Mobile / same profile | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| US/EU/Asia / WebPageTest | Desktop / comparable profile | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

Useful Core Web Vitals **field** thresholds at the 75th percentile: LCP <= 2,500 ms, INP <= 200 ms, CLS <= 0.1. Lab metrics and one-off cold tests are diagnostics, not substitutes for real-user performance. More information: https://web.dev/articles/vitals

## Triage AFTER evidence (do not pre-implement any of these)

| If evidence shows | Canonical owner to inspect | Minimum regression proof needed |
|---|---|---|
| Large same-origin script is a rendering bottleneck | Public startup in index.html / app.js | Before/after transfer and main-thread timing, same viewport |
| Slow long-distance Firestore content | Public Firestore load path in app.js and database region | Regional waterfall/query budget and unchanged content/access |
| Media dominates first paint | static-image-renditions.js, canonical media resolver/Cloudinary delivery | Card/detail asset bytes, correct source and unchanged gallery behavior |
| Browser revalidation is costly | firebase.json Hosting cache headers and versioning strategy | Repeat-visit request evidence and safe invalidation plan |
| Third-party icon/font/media request delays paint | Exact vendor dependency in index.html / styles | Third-party critical-path proof and fallback behavior |

**Do not** apply a blanket cache rule, arbitrarily remove scripts, rewrite Firebase startup, introduce CSS overrides, switch hosting providers, change a database region, or install a second CDN without confirming the measured root cause.

### Exit criteria for this preparation PR

- [ ] Read-only helper parses representative Lighthouse JSON without revealing raw URLs
- [ ] Probe targets only public GETs and avoids credentialed requests / writes
- [ ] Full GitHub CI passed or failures individually documented
- [ ] No UI, data, security, Firebase/Cloudflare config, or production changes
- [ ] PR remains unmerged until the owner decides how to use the measurement kit
- [ ] **Performance improvements not claimed until actual international data exist**
