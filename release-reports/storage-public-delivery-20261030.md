# Storage public-delivery isolation: test report and audit

Date: 2026-10-30
Repository: shin-ich1/Myportfolio
Authorized baseline: main @ ef8ed543fb2184de40c0f197d5212bd6534d880b
Isolated branch: test/storage-public-delivery-resilience-20261030
Status: tested in source-level simulation; NOT runtime-verified or deployed

## Scope and ownership

- Canonical server-side media owner: telemetry-worker/src/index.js
- Public URL reference owner: asset-resolver.js
- Per-profile credential owner: Worker STORAGE_OAUTH KV, keyed by profile ID
- Admin status owner: admin/js/settings.js (separate draft PR #37)
- No production, Admin security, asset, token, KV, Firestore, or Google Cloud changes performed.

## Reproduction findings

The reviewed Worker already delivers a verified public-preview asset via Google public sharing without invoking Admin OAuth. If public sharing fails, it attempts a per-profile authenticated fallback. The public endpoint verifies the managed mapping and public-preview access before consulting its response cache.

No reproducible code defect was found in these specific protected, available-mapping scenarios; therefore no speculative application or Worker fix was applied.

Known availability limitation: if the managed KV mapping is missing while OAuth authorization is unavailable, authenticated ownership recovery cannot proceed. Serving cached content before confirming ownership or public access would create an authorization regression; it was deliberately not implemented.

Another availability limitation: inaccessible or deleted Google files cannot be made accessible by refresh-token or UI logic alone. Google public sharing and source-file availability remain dependencies.

The previously supplied Google Cloud Console screenshots show External + Testing, a configuration with documented refresh-token lifetime limits for Drive scopes. That is a strong candidate for the recurring Admin reconnect issue, but the actual disconnected account's OAuth error response has not been captured. PR #37 addresses incorrect status messages, not Google's policy.

## New regression coverage

- Publicly shared file delivery without Admin OAuth.
- OAuth fallback scoped to a single storage profile.
- Fail-safe response when both sharing and refresh authorization are unavailable.
- Independence of two Google Drive profiles.
- No cache bypass for missing/private media mapping.
- Previously verified public cache served without OAuth.
- Ownership recovery requirement for lost KV mapping.

## Automated verification

- GitHub Actions initial isolated run: https://github.com/shin-ich1/Myportfolio/actions/runs/41009210438
- Node test suite: 96 passed, 0 failed.
- JavaScript syntax checks: passed.
- Real browser/production/public media verification: NOT RUN.
- Empty real portfolio media inventory: no actual current published Drive asset was available to test.
- Google OAuth configuration was not modified; the seven-day policy is not resolved by code tests.
- Mobile Message puzzle: out of scope for this isolated change, separate draft PR #36.

## Files changed and diff/security audit

1. tests/storage-public-delivery-resilience.test.mjs: isolated mocks and security-preserving delivery/profile cases.
2. .github/workflows/media-regression.yml: allow only this isolated branch to run existing test suite and include test syntax check.
3. release-reports/storage-public-delivery-20261030.md: test report and limitations.

Source/runtime files changed: none.
Credentials/secrets in changes: none.
Duplicate handlers, state, CSS overrides, auth bypasses: none introduced.
Production deployment, Google Cloud publishing, merger: not performed.

## Remaining work before resolution

- Confirm actual Google OAuth publishing transition requirements and production Worker authorization error without exposing credentials.
- Preserve existing public file mapping/permissions; verify real-device public URLs using a future non-sensitive test asset in an approved staging environment.
- Reconcile the independent PR #36/#37 changes only after separate review and appropriate authorization.
- Do not describe the Google Drive disconnect incident as fixed until actual reconnect behavior is verified over time.
