# LΛN Security & Access — Staging Readiness (current)

**As of 2026-10-11. Scope: staging only. Release decision: NOT PRODUCTION-READY.**

## Authoritative status

- **Staging deployed** at commit `7c12ae960d5b9b246036ca6d17f11a734b8f8629` on `perf/admin-workspace-investigation-20261008`, via [GitHub Actions 38060497807](https://github.com/shin-ich1/Myportfolio/actions/runs/38060497807). Worker, Firestore Rules and Firebase Hosting deployed successfully. Health checks passed. Production/main remains separate.
- **Current hardening is NOT deployed**: the security closeout PR is a staging-test branch layered over unmerged [test-only PR #8](https://github.com/shin-ich1/Myportfolio/pull/8). It adds step-up/password/email-verification rate limits, failure audits, HTTPS logo validation, verified email-branding step-up, honest email provider acceptance, and a pre-request irreversible Emergency Recovery warning.
- **Latest completed prior test evidence**: [GitHub Actions 38066275091](https://github.com/shin-ich1/Myportfolio/actions/runs/38066275091): 142/142 Node tests, 10/10 real Firestore Rules emulator tests, 5/5 live staging anonymous-denial checks, 7/7 local Worker atomic runtime tests. These are PR-only tests and not evidence of a live authenticated revoked-token probe.
- **Observed live browser flows**: new/untrusted login requires TOTP; repeated temporary login after logout requires TOTP; post-recovery TOTP re-enrollment succeeded; trusted-device enrollment and logout/login without TOTP worked; individual revoked session automatically redirected without refresh; Security Activity logged session revocation. Successful recovery revoked trusted devices and authenticator, requiring reset.
- **Confirmed staging gaps**: real Security Email delivery not configured; production sender/domain/provider acceptance and recipient delivery cannot be claimed. Exposed staging credentials should be rotated through verified security flows after testing; never ship in releases.
- **Still pending**: live authenticated revoked-token direct Firestore request (emulator proves it, browser auto-logout prevented direct probe); specific old-key live rejection safely after confirmed activation; staging deployment/live verification of hardening; wide/compact/mobile Security settings and full Admin/Public visual regression; production UID/IAM/data/backup/rollback readiness.
- **Deployment gates**: last user screenshot showed `LAN_STAGING_DEPLOY_APPROVED=false` and `LAN_STAGING_DIAGNOSTIC_APPROVED=false`. Never set these without distinct authorization. PR CI uses no staging deploy and never deploys production.
- **Public QR**: canonical target derives from current public site's URL in `admin/js/settings.js` without invented production domain. Public files remain frozen; original baseline ZIP is pre-security and cannot substitute for the latest staging branch.

## Canonical owners

- `telemetry-worker/src/index.js`: the sole server Gateway for Firebase Identity Platform password/TOTP, verified sessions, cryptographic device trust, Recovery Key hash/atomic transitions, defensive rate limits and email provider outcomes.
- `telemetry-worker/src/security-coordinator.js`: atomic one-time challenges, anti-replay, bounded rate counters, and Recovery Kit preparation hashes.
- `admin/services/adminSecurityService.js`: browser API client and nonextractable local device credentials (not authoritative trust).
- `admin/services/adminAuthorizationService.js`: Firebase authorization bridge; `admin/js/admin.js`: login/recovery screen; `admin/js/settings-security.js`: Security & Access settings.
- `firestore.rules`: backend session-validated client access and direct denial of security collections.

## Release gates

1. Fail-first regression → canonical fixes → full CI plus Worker runtime and Firestore emulator.
2. Separate staging deploy approval, then live test step-up limit/retry, Recovery confirmation/cancel/interruption, branding validation, Security Activity.
3. Verify live authorized/revoked-token Firestore denial with a safe controlled test; ensure full Admin/Public layout/regression on final exact build.
4. Configure and verify an approved security email provider and sender, or explicitly defer with **NOT CONFIGURED** status. Provider acceptance is not recipient delivery.
5. Rotate staging test credentials if exposed, inventory production identities and Firebase claims, backup/rollback and IAM, then obtain **separate production authorization**. Do not deploy restrictive Rules before verified production Admin bootstrap.
6. Produce one final sanitized ZIP only after the exact source passes functional and security gates.

---

## Archived historical staging review (2026-10-09 to 2026-10-10, superseded)

**Every status claim below is historical and must NOT be interpreted as the current deployed state or an instruction to deploy.** The live Worker no longer returns the original placeholder; the earlier 116/116 and 98/98 test counts are retained only to document history.

# Historical staging security review (archived)

**Scope:** testing branch only. This review records source-level and local Cloudflare runtime evidence. **Staging and production have not been deployed or live-authenticated.**

## Historical staging environment (before deployment)

- Last observed deployment of `lan-portfolio-staging.lagmayr2.workers.dev/health` still returned **Hello World!** It is the placeholder, not the canonical gateway.
- Staging Firebase (`lan-portfolio-staging`) has Email/Password and Identity Platform TOTP enabled. Staging service-account IAM roles, encrypted Worker secrets, and the test Admin allowlist are configured. End-to-end authentication remains unverified.
- The generated staging Worker configuration uses one `SECURITY_COORDINATOR` SQLite Durable Object and two unrelated KV bindings: `PORTFOLIO_MESSAGES` for nonsecurity message/push/image caches, and `STORAGE_OAUTH` for Drive profile/token/upload metadata. The old `SECURITY_STATE` KV security binding and runtime code have been removed.
- The Firebase Web API key is not in tracked staging config. No service account private key, recovery secret, OAuth client secret or access token is committed.

### Staging operator verification — 2026-10-10

- Latest GitHub CI: 116/116 regression tests and 7/7 local Cloudflare runtime tests passed. Worker dry run passed. Live authentication remains unverified.
- Firebase staging: Email/Password and Identity Platform TOTP MFA enabled. A dedicated staging test user and active authorizedAdministrators allowlist record were created.
- Google Cloud: staging Worker runtime and Firebase deployer IAM roles assigned and verified in the console.
- Cloudflare staging: four required encrypted Worker secrets are present. Secret values and runtime authentication have not been verified.
- GitHub staging: deployment secrets and Workload Identity configuration are present. LAN_STAGING_DEPLOY_APPROVED is true for the approved staging-only deployment.
- Firestore currently denies all direct client reads and writes until canonical security rules are deployed.
- Pending: real GitHub OIDC authentication, Durable Object deployment, Worker health verification, Firebase Hosting/Rules deployment, and live TOTP, trusted-device, session, recovery, and unauthorized-access tests.
- Production Rolando Portfolio is excluded from staging deployment. No production promotion is approved.

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
- **No deploy JSON private-key secret is required.** The old `LAN_STAGING_FIREBASE_SERVICE_ACCOUNT_B64` input was deleted from the canonical GitHub deployment job. Do not generate or upload a service-account key for GitHub Actions.
- `LAN_STAGING_WIF_PROVIDER` (**GitHub environment variable**, not a secret): exact Workload Identity Federation provider resource, **in staging project number `571587695468`**, format `projects/571587695468/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`. Do not use the production GCP project or an account-wide shared pool.
- `LAN_STAGING_DEPLOY_SERVICE_ACCOUNT` (**GitHub environment variable**, not a secret): a **dedicated least-privilege staging deployment service account**, ending in `@lan-portfolio-staging.iam.gserviceaccount.com`, authorized only for required staging Hosting and Firestore Rules operations; do not reuse the Firebase Admin SDK runtime service account.
- Provision the Workload Identity pool/provider in **`lan-portfolio-staging`**, with OIDC issuer `https://token.actions.githubusercontent.com`. Map `google.subject=assertion.sub` and restrict its provider attribute condition to **all** of `assertion.repository == 'shin-ich1/Myportfolio'`, `assertion.ref == 'refs/heads/perf/admin-workspace-investigation-20261008'`, `assertion.environment == 'lan-security-staging'`, and `assertion.event_name == 'push'`. Bind `roles/iam.workloadIdentityUser` on the **dedicated staging deploy service account** to that specific pool's repository principal, not to an unrestricted `principalSet`. Assign only the minimum staging resource permissions needed by the two Firebase deploys. Review both the IAM binding and provider condition before enabling the deploy gate.
- The **deploy job alone** receives GitHub `id-token: write`. After checkout, `google-github-actions/auth@v3` creates temporary federated ADC credentials for the staging deploy identity, and a GCP access-token/project check runs before deployment. The credentials file is ignored by Git; the site builder publishes only tracked site files. The job rejects missing/unexpected GitHub repo/ref, provider project number or staging account email. **This is source-level configuration only; actual IAM/token exchange and Firebase CLI compatibility remain unverified until a separately approved staging run.**

Configure these encrypted runtime secrets **on the staging Worker** in Cloudflare before allowing the deploy job: `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_EMAIL`, `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`, and `SECURITY_RECOVERY_PEPPER`. Worker identity should have access only to `lan-portfolio-staging` and the specific Firestore collections required by the Worker. Use fresh unique staging pepper and secrets, never values from production. A staging-only Google Drive OAuth app is optional; absence must fail Drive access closed.

When authorized, the job regenerates the isolated staging bundle, verifies secret presence, publishes **only** `lan-portfolio-staging` Worker, checks its canonical `/health`, then publishes Firestore Rules and Hosting to **only** Firebase project `lan-portfolio-staging`. There is no production deployment command or automatic production promotion in this workflow. After a staging deployment, perform interactive authentication and authorization tests manually; the job's success does **not** certify the Security Gateway.


### Separate Cloudflare Worker authentication — not solved by GitHub OIDC

GitHub OIDC only authorizes **GitHub Actions to deploy Firebase**; it cannot automatically authenticate the Cloudflare Worker at runtime. The canonical Worker currently requires `FIREBASE_SERVICE_ACCOUNT_EMAIL` plus `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` to sign custom Firebase tokens and obtain server-authorized Firestore/Identity Platform access. A signing-key-free Worker design would need a separately verified, staging-scoped Google identity and supported remote signing/token acquisition flow; no invented bypass or shared production key is permitted. **Until implemented and live-tested, this is an independent blocking runtime credential requirement.** Keep `FIREBASE_WEB_API_KEY` and `SECURITY_RECOVERY_PEPPER` staging-only, and never put Worker signing keys into GitHub deployment credentials, frontend assets, committed files, screenshots or chat.

The current Cloudflare token is scoped to the individual staging Worker; whether that limited token can apply SQLite Durable Object migrations must be confirmed in a staging-only approved deploy. **Do not broaden its Cloudflare account scope automatically** if that action is denied. Token expiry and renewal remain operator responsibilities.

## Follow-up source security audit — 2026-10-09

**Audit scope:** the current testing branch, not deployed staging or production. No Firebase credentials, Recovery Keys, private device material or production resources were used.

- **Administrator allowlist authorization:** the old Firestore `admin:true` custom-claim path could write `authorizedAdministrators` without a security-approved session, and could keep authorizing CMS access after allowlist deactivation. Firestore Rules now require an active allowlist record plus an active security-approved session for CMS access; clients can no longer modify administrator allowlist records. Privileged Admin SDK provisioning remains the owner.
- **Emergency recovery overflow:** the old reset path enumerated at most 200 sessions and 100 devices. A failing HTTP-route regression demonstrated that older records would remain unrevoked. The canonical Worker now paginates the full set and performs bounded Firestore batch revocations. A simulation exercising 225 sessions and 125 devices passed in CI after the change.
- **Device and bulk session revocation:** individual device revoke and sign-out-all previously used similarly truncated lists. They now use the same exhaustive query and batch-revocation owner, and a revoked trusted device cannot retain Worker authorization through silent temporary-session downgrading. Bulk-revocation contract tests were added to CI.
- **Capacity guard:** exhaustive revocation fails closed if a single collection exceeds 10,000 enumerated security records; this is an explicit operational escalation, never partial-success reporting.
- **Testing provenance:** new regression files `tests/firestore-administrator-allowlist-gate.test.mjs` and `tests/security-bulk-revocation-contract.test.mjs`, plus expanded `tests/security-recovery-atomicity.test.mjs`. CI remains a local/source verification gate; direct Firestore denial, session revocation and recovery must be observed against isolated staging before release.

## Historical blockers before first staging deployment (now superseded)

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
