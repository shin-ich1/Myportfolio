# Repository maintenance and publication safety

This is a **public source repository**. Closed pull requests and old commits remain accessible; closing a PR does not hide its code or comments.

## Checks in one place

GitHub Actions runs the following without deploying:
- The existing automated application and image-viewer tests.
- Real Chromium image-viewer smoke checks at desktop and mobile sizes.
- JavaScript syntax and diff checks.
- A read-only scan of tracked filenames and common high-confidence credential signatures.
- A read-only Firebase Hosting candidate manifest check.
- A read-only Cloudflare Web Analytics site-tag comparison.

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

## Cloudflare Web Analytics: property identity review

The browser's `config.js` defines the public beacon `siteToken`; the Worker's checked-in Wrangler variables define `CF_ANALYTICS_SITE_TAG` used for the account's RUM GraphQL filter. As reviewed on 2026-11-06, **these values do not match**.

Both are public 32-character property identifiers, but they ordinarily should reference the *same Web Analytics property* if browser collection is to appear in the dashboard's visitor graph. The `CF_ANALYTICS_ACCOUNT_ID` is a separate account identifier. The `CF_ANALYTICS_READ_TOKEN` is a **private server-side token**, and must never be added to `config.js`, public JS, or Wrangler `vars`.

Run `node scripts/check-analytics-config.mjs` for a non-mutating warning. To resolve the mismatch correctly, verify the actual site's beacon snippet/property tag in the authorized Cloudflare dashboard, confirm the Worker GraphQL account/site configuration, and only then change the erroneous property identifier. **Do not guess which existing tag is correct, and do not change a live Worker secret solely to make values look equal.**

Official references:
- [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare GraphQL filtering](https://developers.cloudflare.com/analytics/graphql-api/features/filtering/)
- [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config)

## Privacy and portfolio presentation

Keep sensitive user data, customer documents, service credentials, and unlicensed source assets out of public branches. Public project screenshots should be reviewed before upload to avoid exposing customer information. Maintain the professional root `README.md` as the entry point for visitors.
