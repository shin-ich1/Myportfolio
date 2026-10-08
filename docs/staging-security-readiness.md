# LΛN Staging Security & Access — Readiness Review

**Scope:** testing branch only. This review records source-level and local Cloudflare runtime evidence. **Staging and production have not been deployed or live-authenticated.**

## Current staging environment

- Last observed deployment of `lan-portfolio-staging.lagmayr2.workers.dev/health` still returned **Hello World!** It is the placeholder, not the canonical gateway.
- Isolated staging Firebase (`lan-portfolio-staging`) and Identity Platform TOTP configuration were inspected previously. No staging Firebase service-account/IAM setup or end-to-end login was validated.
- The generated staging Worker configuration uses one `SECURITY_COORDINATOR` SQLite Durable Object and two unrelated KV bindings: `PORTFOLIO_MESSAGES` for nonsecurity message/push/image caches, and `STORAGE_OAUTH` for Drive profile/token/upload metadata. The old `SECURITY_STATE` KV security binding and runtime code have been removed.
- The Firebase Web API key is not in tracked staging config. No service account private key, recovery secret, OAuth client secret or access token is committed.

## Canonical ownership after both work pairs

1. **Recovery:** `telemetry-worker/src/index.js` uses Firestore server-side update-time preconditions for the single-use Master Recovery Key. An interrupted Firebase MFA/session reset may resume only with a freshly verified administrator password plus the original key, inside a bounded server-side window and with an exclusive short lease. Completion keeps its challenge pending through input validation, Identity Platform updates and the Firestore CAS, permitting retriable failures **before commit**; it is consumed after success. A fresh key's hash and the mandatory Security Activity event share one atomic Firestore commit. The post-commit response-loss problem remains open and must not be mistaken for a completed key acknowledgment.
2. **Public messaging:** Public puzzle challenge state, attempts and Turnstile finalization nonce, verification-proof redemption, and visitor rate counters are owned by `telemetry-worker/src/security-coordinator.js`, with strongly consistent synchronous Durable Object state. The public Worker route preserves existing UI request/response shape. Message image selection/history caching may still use KV but **not for challenge, verification or rate-limit authority**.
3. **Google Drive OAuth and pending uploads:** Authorization `state` uses a cryptographically random one-time credential persisted and consumed atomically by the same coordinator. The callback rejects replay, expired state and missing coordinator. Pending uploads now use coordinator-owned exclusive leases across upload-content and finalize, with retries after upstream failures and one-use consumption after asset metadata persistence. `STORAGE_OAUTH` owns Google refresh-token, profile, folder, and asset metadata; it is not an authorization-state owner.
4. **Trusted-device migration:** Before registering a newly approved device, the canonical backend validates historical active device credentials, idempotently backfills unique cryptographic-key claims, and marks old initial bootstrap as used. Duplicate old credentials and malformed active legacy records fail closed. No historical device is automatically trusted, unrevoked or deleted. New registration still atomically claims a unique key and device ID. Post-recovery/TOTP-reset bootstrap epochs, stale QR rejection and revoked approver checks remain enforced.

## Automated evidence

- **89/89** Node regression tests passed on the testing branch, including five parallel Recovery Key claims (one accepted), bounded interruption retries, replacement-key/audit atomicity, recovery completion Firestore-failure retries, invalid-email recovery retry, public puzzle concurrency, 25-way OAuth callback replay (one accepted), historical device migration, plus actual Worker HTTP Google Drive finalize/upload-content concurrency and upstream-failure retries.
- **6/6** local Cloudflare `workerd` SQLite tests passed: 50-way Admin challenge replay, 36-way Admin rate limits, 40-way public puzzle verification/finalization, 40-way OAuth state consumption, exclusive pending-upload reservations and retries, and Recovery challenge non-consuming reads/single consumption.
- The generated isolated staging Worker bundle passed `wrangler deploy --dry-run`. **No deployment happened.**
- CI evidence: https://github.com/shin-ich1/Myportfolio/actions/runs/37834317131

## Remaining blockers before any staging deployment

- **Live Firebase/Cloudflare authorization:** Approve staging-only least-privilege service identity, secure Worker secrets, Firestore Rules and authorized test administrator bootstrap. Run real TOTP, QR trusted-device, session and recovery tests and direct unauthorized Firestore/backend request rejection.
- **Recovery delivery after successful commit remains an explicit blocker:** Completion now reads the recovery challenge without consuming it, validates the optional replacement email, and commits the new key hash together with its audit record using a Firestore CAS. Transient failure **before** the commit allows retry with the same pending challenge, and concurrent attempts cannot both change the key. However, an uncertain network response or Worker crash **after** a successful Firestore commit but **before** the one-time new key reaches the browser can still strand the Admin without the undisclosed key. This cannot be solved by casually reissuing a consumed Recovery Key. Design and verify an explicit key-display/acknowledgment ceremony before release. No plaintext Master Recovery Key is stored or logged.
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
- [ ] Design explicit post-commit Recovery Key display/acknowledgment protocol and live-test ambiguous Drive upload recovery
- [ ] Approve isolated staging credentials and deploy/test staging Firestore Rules
- [ ] Explicitly authorize staging Worker deployment; verify `/health` JSON replaces placeholder
- [ ] Complete live auth/recovery/revocation/attack and unauthorized-access tests
- [ ] Measure browser performance and Admin/Public layout regression, inspect final diff
- [ ] Approve a separate production promotion and deliver one audited final ZIP

Never promote on the strength of source/CI tests alone. Do not copy production accounts, sessions, recovery keys or signing credentials to staging.
