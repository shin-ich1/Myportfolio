# Repository maintenance and publication safety

This is a **public source repository**. Closed pull requests and old commits remain accessible; closing a PR does not hide its code or comments.

## Checks in one place

GitHub Actions runs the following without deploying:
- The existing automated application and image-viewer tests.
- Real Chromium image-viewer smoke checks at desktop and mobile sizes.
- JavaScript syntax and diff checks.
- A read-only scan of tracked filenames and common high-confidence credential signatures.
- A read-only Firebase Hosting candidate manifest check.
- A read-only Cloudflare Web Analytics configuration check that distinguishes the public beacon token from the Worker reporting site tag.

To reproduce the new checks locally from the repository root:

```bash
node scripts/audit-repository-security.mjs
node scripts/check-analytics-config.mjs
node scripts/prepare-hosting-candidate.mjs --check
```

The filename/signature audit is not a complete secret-history scan. A `.gitignore` only prevents new accidental additions; it cannot make previously committed credentials private. If an actual private key or token is ever found in public Git history, **rotate or revoke it first** and investigate the exposure before editing history.

## Firebase Hosting: controlled future migration

The verified production release currently uses `firebase.json` with `hosting.public: "."` and an explicit ignore list. **Do not change this in the same step as these documentation/security checks.**

For a future dedicated-publish-directory migration, prepare an isolated candidate:

```bash
node scripts/prepare-hosting-candidate.mjs --build
```

This creates `.hosting-dist/` from an allowlisted set of web file types while excluding Worker source, scripts, tests, private files, and deployment configuration. The directory is Git-ignored. This operation **does not change Firebase configuration or publish a site**.

Before adopting the new directory in `firebase.json`, compare its contents against the current working Hosting release, including all HTML pages, JavaScript imports, Admin routes, user media, and custom modules. Test the candidate on a *separate* Hosting preview channel and a physical phone. Only after those checks and explicit approval should `hosting.public` be switched to `.hosting-dist`. This prevents a seemingly safe filesystem refactor from silently omitting important runtime assets.

A GitHub merge is **not** permission to deploy Firebase or Cloudflare Worker code.

## Cloudflare Web Analytics: resolved source identifiers (PR #60)

The public website's `config.js` defines the public beacon **`siteToken`** used by `beacon.min.js`. The Worker uses **`CF_ANALYTICS_SITE_TAG`** to filter `rumPageloadEventsAdaptiveGroups` in Cloudflare GraphQL. These two Cloudflare identifiers have **different meanings and must not be assumed equal**.

On November 6, 2026, [PR #60](https://github.com/shin-ich1/Myportfolio/pull/60) confirmed the correct Cloudflare GraphQL reporting `siteTag` from the dashboard and corrected the checked-in Worker configuration. The automated regression at `tests/analytics-site-tag-regression.test.mjs` explicitly confirms the verified Worker tag **differs** from the public beacon token. The combined release merged this source correction into `main`.

Run `node scripts/check-analytics-config.mjs` for a read-only sanity check. It validates public identifier syntax, preserves their intentional difference, and checks that the private analytics read token is **not** present in checked-in Wrangler `vars`. The test suite separately guards the verified GraphQL reporting tag.

The `CF_ANALYTICS_ACCOUNT_ID` is a separate account identifier. The private `CF_ANALYTICS_READ_TOKEN` must remain a Worker **secret**. Never copy it to `config.js` or any public frontend file.

**Source verification is not LIVE verification.** No repository test can confirm the currently active Cloudflare Worker environment variable or Admin visitor counts. If the Admin graph still shows zeros, check the live Worker setting and real GraphQL response with authenticated admin access instead of changing the public beacon token to match it.

References:
- [PR #60 — verified reporting siteTag fix](https://github.com/shin-ich1/Myportfolio/pull/60)
- [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare GraphQL filtering](https://developers.cloudflare.com/analytics/graphql-api/features/filtering/)
- [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config)

## Privacy and portfolio presentation

Keep sensitive user data, customer documents, service credentials, and unlicensed source assets out of public branches. Public project screenshots should be reviewed before upload to avoid exposing customer information. Maintain the professional root `README.md` as the entry point for visitors.
