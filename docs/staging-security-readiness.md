# LΛN Staging Security & Access — Readiness Review

**Scope:** testing branch only. This review records source-level and local Cloudflare runtime evidence. **Staging and production have not been deployed or live-authenticated.**

## Current staging environment

- Last observed deployment of `lan-portfolio-staging.lagmayr2.workers.dev/health` still returned **Hello World!** It is the placeholder, not the canonical gateway.
- Isolated staging Firebase (`lan-portfolio-staging`) and Identity Platform TOTP configuration were inspected previously. No staging Firebase service-account/IAM setup or end-to-end login was validated.
- The generated staging Worker configuration uses one `SECURITY_COORDINATOR` SQLite Durable Object and two unrelated KV bindings: `PORTFOLIO_MESSAGES` for nonsecurity message/push/image caches, and `STORAGE_OAUTH` for Drive profile/token/upload metadata. The old `SECURITY_STATE` KV security binding and runtime code have been removed.
- The Firebase Web API key is not in tracked staging config. No service account private key, recovery secret, OAuth client secret or access token is committed.

## Canonical ownership after both work pairs

1. **Recovery:** `telemetry-worker/src/index.js` uses Firestore server-side update-time preconditions for the single-use Master Recovery Key. An interrupted Firebase MFA/session reset may resume only with a freshly verified administrator password plus the original key, inside a bounded server-side window and with an exclusive short lease. The key remains inactive during recovery; on successful completion it is replaced. A fresh key's hash and the mandatory Security Activity event share a single atomic Firestore commit so an event-write failure cannot lose an already-issued one-time key.
2. **Public messaging:** Public puzzle challenge state, attempts and Turnstile finalization nonce, verification-proof redemption, and visitor rate counters are owned by `telemetry-worker/src/security-coordinator.js`, with strongly consistent synchronous Durable Object state. The public Worker route preserves existing UI request/response shape. Message image selection/history caching may still use KV but **not for challenge, verification or rate-limit authority**.
3. **Google Drive OAuth:** Authorization `state` uses a cryptographically random one-time credential persisted and consumed atomically by the same coordinator. The callback rejects replay, expired state and missing coordinator. `STORAGE_OAUTH` still owns Google refresh-token, profile and upload metadata; it is not an OAuth state authority.
4. **Trusted-device migration:** Before registering a newly approved device, the canonical backend validates historical active device credentials, idempotently backfills unique cryptographic-key claims, and marks old initial bootstrap as used. Duplicate old credentials and malformed active legacy records fail closed. No historical device is automatically trusted, unrevoked or deleted. New registration still atomically claims a unique key and device ID. Post-recovery/TOTP-reset bootstrap epochs, stale QR rejection and revoked approver checks remain enforced.

## Automated evidence

- **81/81** Node regression tests passed on the testing branch, including five parallel Recovery Key claims (one accepted), interrupted-reset recovery, lost-key/audit regression, public puzzle proof/attempt concurrency, 25-way OAuth callback replay (one accepted) and historical trusted-device migration.
- **4/4** local Cloudflare `workerd` SQLite tests passed: 50-way Admin challenge replay, 36-way Admin rate limits, 40-way public puzzle verification/finalization, and 40-way OAuth state consumption.
- The generated isolated staging Worker bundle passed `wrangler deploy --dry-run`. **No deployment happened.**
- CI evidence: https://github.com/shin-ich1/Myportfolio/actions/runs/37830871311

## Remaining blockers before any staging deployment

- **Live Firebase/Cloudflare authorization:** Approve staging-only least-privilege service identity, secure Worker secrets, Firestore Rules and authorized test administrator bootstrap. Run real TOTP, QR trusted-device, session and recovery tests and direct unauthorized Firestore/backend request rejection.
- **Interrupted completion delivery:** Recovery completion consumes its one-time challenge before the final Firestore/optional account-update operations. If those later operations fail, the challenge is lost and no replacement is issued. Design a crash-safe same-challenge retry protocol with server-validated single-use commit before calling this production-ready. The start/reset retry path is tested, but completion recovery remains an explicit blocker.
- **Legacy device data migration at scale:** Staging tests cover valid/malformed/duplicate active records and idempotent claims. Historical migrations with 100+ records deliberately fail closed. Production data must be audited for collisions/invalid keys and reviewed before any promotion.
- **Drive upload pending-token lifecycle:** Resumable upload completion still uses KV read-and-delete; review its idempotency/replay behavior separately from the OAuth authorization state. Do not claim the entire Drive asset pipeline is atomic.
- **End-to-end messaging and alert delivery:** Real Turnstile, visitor messages, branded security-alert email provider and public media availability were not live-tested. Email delivery must remain **not configured** unless the provider confirms it.
- **Browser performance and layout:** Re-measure the Admin's navigation/Firestore requests and Photo Editing media loads in isolated staging. Run wide/compact/mobile Admin and frozen Public regressions before promotion.

## Release gates

- [x] Test and remediate Admin challenge replay, rate-limiting and initial trusted-device races in source/local workerd
- [x] Test Recovery Key concurrent claims and interrupted Firebase reset initiation
- [x] Migrate public puzzle/proof/rate state, Google OAuth state, and historical trusted-device claims to canonical server owners
- [x] Run the full source regression list and local Cloudflare Worker dry-run
- [ ] Resolve interrupted recovery **completion** and Drive upload pending-token replay lifecycle
- [ ] Approve isolated staging credentials and deploy/test staging Firestore Rules
- [ ] Explicitly authorize staging Worker deployment; verify `/health` JSON replaces placeholder
- [ ] Complete live auth/recovery/revocation/attack and unauthorized-access tests
- [ ] Measure browser performance and Admin/Public layout regression, inspect final diff
- [ ] Approve a separate production promotion and deliver one audited final ZIP

Never promote on the strength of source/CI tests alone. Do not copy production accounts, sessions, recovery keys or signing credentials to staging.
