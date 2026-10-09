# LΛN Staging Security & Access — Readiness Review

**Scope:** testing branch only. This review records source-level and local Cloudflare runtime evidence. **Staging and production have not been deployed or live-authenticated.**

## Current staging environment

- Last observed deployment of `lan-portfolio-staging.lagmayr2.workers.dev/health` still returned **Hello World!** It is the placeholder, not the canonical gateway.
- Isolated staging Firebase (`lan-portfolio-staging`) and Identity Platform TOTP configuration were inspected previously. No staging Firebase service-account/IAM setup or end-to-end login was validated.
- The generated staging Worker configuration uses one `SECURITY_COORDINATOR` SQLite Durable Object and two unrelated KV bindings: `PORTFOLIO_MESSAGES` for nonsecurity message/push/image caches, and `STORAGE_OAUTH` for Drive profile/token/upload metadata. The old `SECURITY_STATE` KV security binding and runtime code have been removed.
- The Firebase Web API key is not in tracked staging config. No service account private key, recovery secret, OAuth client secret or access token is committed.

## Canonical ownership after both work pairs

1. **Recovery Kit issuance (emergency and normal):** `telemetry-worker/src/index.js` uses Firestore server-side update-time preconditions for atomic hash rotation. Pending emergency recoveries can restart only using a newly verified administrator password and the original key within a bounded window; activation rejects the old key permanently. Both emergency and signed-in kit rotation use **prepare → offline-save confirmation → activate**, storing only secure HMAC hashes and opaque IDs in the atomic coordinator before commit. Emergency Recovery revokes prior security access before preparation, while signed-in rotation keeps the existing active key until the new saved kit is activated. Firestore activation atomically writes the new key hash and required Security Activity. Emergency completion provides no-secret server status after uncertain responses; signed-in rotation permits idempotent same-challenge acknowledgement. Browser UI clears plaintext on confirmed activation. Real Firebase and browser flow verification remains mandatory.
2. **Public messaging:** Public puzzle challenge state, attempts and Turnstile finalization nonce, verification-proof redemption, and visitor rate counters are owned by `telemetry-worker/src/security-coordinator.js`, with strongly consistent synchronous Durable Object state. The public Worker route preserves existing UI request/response shape. Message image selection/history caching may still use KV but **not for challenge, verification or rate-limit authority**.
3. **Google Drive OAuth and pending uploads:** Authorization `state` uses a cryptographically random one-time credential persisted and consumed atomically by the same coordinator. The callback rejects replay, expired state and missing coordinator. Pending uploads now use coordinator-owned exclusive leases across upload-content and finalize, with retries after upstream failures and one-use consumption after asset metadata persistence. `STORAGE_OAUTH` owns Google refresh-token, profile, folder, and asset metadata; it is not an authorization-state owner.
4. **Trusted-device migration:** Before registering a newly approved device, the canonical backend validates historical active device credentials, idempotently backfills unique cryptographic-key claims, and marks old initial bootstrap as used. Duplicate old credentials and malformed active legacy records fail closed. No historical device is automatically trusted, unrevoked or deleted. New registration still atomically claims a unique key and device ID. Post-recovery/TOTP-reset bootstrap epochs, stale QR rejection and revoked approver checks remain enforced.

## Automated evidence

- **98/98** Node regression tests passed on the testing branch, including concurrent Recovery Key claims, emergency pre-display/confirmation, authenticated normal Recovery Kit rotation with no invalidation until activation, post-commit no-secret confirmation, Admin UI handoff, public puzzle/OAuth replay, legacy device migration, and Worker HTTP Drive upload concurrent/retry tests.
- **7/7** local Cloudflare `workerd` SQLite tests passed: 50-way Admin challenge replay, 36-way Admin rate limits, 40-way public puzzle verification/finalization, 40-way OAuth state consumption, exclusive pending-upload reservations and retries, Recovery challenge non-consuming reads/single consumption, and bounded hash-only Recovery Kit preparation.
- The generated isolated staging Worker bundle passed `wrangler deploy --dry-run`. **No deployment happened.**
- CI evidence: https://github.com/shin-ich1/Myportfolio/actions/runs/37882106606

## Staging deployment operator gate (not enabled automatically)

The canonical GitHub Actions workflow `.github/workflows/admin-performance-regression.yml` now contains a **default-off** `staging-deploy` job. It is eligible only for pushes to `perf/admin-workspace-investigation-20261008`, only after the existing source/runtime regression job passes, and only when repository variable `LAN_STAGING_DEPLOY_APPROVED` is set to the exact string `true`. It is bound to the GitHub environment `lan-security-staging`.

Before enabling the flag, configure the following **staging-only** GitHub Actions secrets using GitHub Settings. Do not paste their values into chat, logs, screenshots, source files, or commits:

- `LAN_STAGING_CLOUDFLARE_API_TOKEN`: scoped Cloudflare token allowed to manage the staging Worker only.
- `LAN_STAGING_CLOUDFLARE_ACCOUNT_ID`: exact staging Cloudflare account identifier.
- `LAN_STAGING_FIREBASE_WEB_API_KEY`: public Web API key for `lan-portfolio-staging`, supplied privately as an Actions secret to the isolated build.
- `LAN_STAGING_FIREBASE_SERVICE_ACCOUNT_B64`: base64-encoded JSON for a **dedicated staging** Firebase deploy identity. Preflight decodes it and checks `project_id === "lan-portfolio-staging"`. Assign least privileges needed for staging Firestore Rules and Hosting deployment; do not use production service identities.

Configure these encrypted runtime secrets **on the staging Worker** in Cloudflare before allowing the deploy job: `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_EMAIL`, `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`, and `SECURITY_RECOVERY_PEPPER`. Worker identity should have access only to `lan-portfolio-staging` and the specific Firestore collections required by the Worker. Use fresh unique staging pepper and secrets, never values from production. A staging-only Google Drive OAuth app is optional; absence must fail Drive access closed.

When authorized, the job regenerates the isolated staging bundle, verifies secret presence, publishes **only** `lan-portfolio-staging` Worker, checks its canonical `/health`, then publishes Firestore Rules and Hosting to **only** Firebase project `lan-portfolio-staging`. There is no production deployment command or automatic production promotion in this workflow. After a staging deployment, perform interactive authentication and authorization tests manually; the job's success does **not** certify the Security Gateway.

## Follow-up source security audit — 2026-10-09

**Audit scope:** the current testing branch, not deployed staging or production. No Firebase credentials, Recovery Keys, private device material or production resources were used.

- **Administrator allowlist authorization:** the old Firestore `admin:true` custom-claim path could write `authorizedAdministrators` without a security-approved session, and could keep authorizing CMS access after allowlist deactivation. Firestore Rules now require an active allowlist record plus an active security-approved session for CMS access; clients can no longer modify administrator allowlist records. Privileged Admin SDK provisioning remains the owner.
- **Emergency recovery overflow:** the old reset path enumerated at most 200 sessions and 100 devices. A failing HTTP-route regression demonstrated that older records would remain unrevoked. The canonical Worker now paginates the full set and performs bounded Firestore batch revocations. A simulation exercising 225 sessions and 125 devices passed in CI after the change.
- **Device and bulk session revocation:** individual device revoke and sign-out-all previously used similarly truncated lists. They now use the same exhaustive query and batch-revocation owner, and a revoked trusted device cannot retain Worker authorization through silent temporary-session downgrading. Bulk-revocation contract tests were added to CI.
- **Capacity guard:** exhaustive revocation fails closed if a single collection exceeds 10,000 enumerated security records; this is an explicit operational escalation, never partial-success reporting.
- **Testing provenance:** new regression files `tests/firestore-administrator-allowlist-gate.test.mjs` and `tests/security-bulk-revocation-contract.test.mjs`, plus expanded `tests/security-recovery-atomicity.test.mjs`. CI remains a local/source verification gate; direct Firestore denial, session revocation and recovery must be observed against isolated staging before release.

## Remaining blockers before any staging deployment

- **Live Firebase/Cloudflare authorization:** Approve staging-only least-privilege service identity, secure Worker secrets, Firestore Rules and authorized test administrator bootstrap. Run real TOTP, QR trusted-device, session and recovery tests and direct unauthorized Firestore/backend request rejection.
- **Recovery flows still need live tests:** Emergency Recovery now displays the prepared kit before activation and confirms the exact commit server-side after uncertain responses. Normal authenticated Recovery Kit rotation likewise only prepares hash-only one-time challenges until the Admin confirms the offline saved kit, then atomically commits its hash and Security Activity entry; its original key remains valid until confirmed activation. No plaintext key is kept in backend state or logged. Real Firebase MFA revocation, expiry, browser close/reload, email verification, uncertain network responses, and browser-visible secret handling must be verified in staging.
- **Legacy device data migration at scale:** Staging tests cover valid/malformed/duplicate active records and idempotent claims. Historical migrations with 100+ records deliberately fail closed. Production data must be audited for collisions/invalid keys and reviewed before any promotion.
- **Google Drive upload pending-token lifecycle improved but not live verified:** Creation, reads and exclusive finalize/content leases now use the canonical Durable Object; authorization for the same upload cannot be consumed by parallel finalize/upload requests. A failed upstream call releases its lease, and successful metadata persistence consumes the state once. Drive asset/profile/refresh-token metadata stays in its distinct `STORAGE_OAUTH` KV owner. Recovery after ambiguous Google Drive uploads, a Worker crash during lease ownership, and eventual KV consistency still need real staging tests. A 30-minute lease bounds crash recovery and must be assessed against the largest supported uploads.
- **End-to-end messaging and alert delivery:** Real Turnstile, visitor messages, branded security-alert email provider and public media availability were not live-tested. Email delivery must remain **not configured** unless the provider confirms it.
- **Browser performance and layout:** Re-measure the Admin's navigation/Firestore requests and Photo Editing media loads in isolated staging. Run wide/compact/mobile Admin and frozen Public regressions before promotion.

## Release gates

- [x] Test and remediate Admin challenge replay, rate-limiting and initial trusted-device races in source/local workerd
- [x] Test Recovery Key concurrent claims and interrupted Firebase reset initiation
- [x] Migrate public puzzle/proof/rate state, Google OAuth state, and historical trusted-device claims to canonical server owners
- [x] Run the full source regression list and local Cloudflare Worker dry-run
- [x] Preserve recovery completion challenge after pre-commit failure; test Firestore retry, bad email and concurrent requests
- [x] Atomic Drive upload authorization leases, one-time finalize, upstream retry, and real Worker HTTP route tests
- [x] Add Emergency Recovery pre-commit display, explicit offline-save confirmation, atomic activation and no-secret postcommit status check
- [x] Apply the same pre-display offline-save gate to signed-in Recovery Kit rotation, with backend CAS and no-secret idempotent acknowledgment
- [ ] Live-test Emergency Recovery browser loss scenarios and ambiguous Google Drive upload recovery
- [ ] Approve isolated staging credentials and deploy/test staging Firestore Rules
- [ ] Explicitly authorize staging Worker deployment; verify `/health` JSON replaces placeholder
- [ ] Complete live auth/recovery/revocation/attack and unauthorized-access tests
- [ ] Measure browser performance and Admin/Public layout regression, inspect final diff
- [ ] Approve a separate production promotion and deliver one audited final ZIP

Never promote on the strength of source/CI tests alone. Do not copy production accounts, sessions, recovery keys or signing credentials to staging.
