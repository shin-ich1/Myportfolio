# LΛN Staging Security Gateway — Readiness Review

**Scope:** staging performance/security investigation branch only. **Production is unchanged.** This is a source/configuration review, **not** a claim of runtime security verification.

## Confirmed by source and screenshots

- Staging Firebase project and Web App exist; Email/Password and Identity Platform TOTP were enabled.
- Staging Firestore was created with initial `allow read, write: if false` rules. The current repository's full `firestore.rules` have **not** been proven deployed to staging.
- Staging Cloudflare Worker is reachable but `GET /health` currently responds `Hello World!`, not the canonical Worker JSON.
- The prepared staging build pins the staging Firebase identifiers, three staging KV namespaces, and staging Worker URL. It does not deploy.
- The full source suite including 8 in-process canonical Worker route tests passed **39/39** in [GitHub Actions](https://github.com/shin-ich1/Myportfolio/actions/runs/37815525247). These are mock/in-process tests, not live Firebase or deployment tests.

## Backend authentication and ownership

The **canonical Worker owner** is `telemetry-worker/src/index.js`:

- `firebaseAdminAccessToken` creates a Google OAuth JWT assertion and signs it using `FIREBASE_SERVICE_ACCOUNT_EMAIL` and `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`.
- `mintSecurityCustomToken` signs a Firebase custom auth token using the same server-only private key.
- The Security Gateway additionally requires `SECURITY_RECOVERY_PEPPER` for Master Recovery Key hashing.
- `requireSecurityApprovedAdministrator` requires a Firebase ID token with security-session claims, verifies it through a protected Firestore read, and checks its backend session record.
- `firestore.rules` protects the security collections from direct browser reads/writes, and requires an active `adminSecuritySessions` record for Admin permissions.

**Implication:** Firebase Web App `apiKey` and a valid `projectId` cannot replace the backend signing identity. A staging Worker without its own valid server-side authorization cannot mint sessions or read/write protected Firestore data.

## Blocking security findings — resolve before declaring secure

1. **Non-atomic one-time challenge consumption.** `consumeSecurityChallenge` currently performs a KV `get` followed by `delete`. Simultaneous requests can both retrieve the same challenge before either deletion is observed. QR/device enrollment completion has an analogous read-then-delete sequence. One-time issuance and consumption need an atomic canonical owner (e.g., a transactional backend primitive) and concurrency/replay regression tests.
2. **Non-atomic distributed rate limiting.** `enforceSecurityRateLimit` uses KV read-modify-write, which does not guarantee strict cross-request or cross-location atomicity. Sensitive endpoints require a reliable enforcement strategy and high-concurrency attack tests.
3. **Staging backend credential model not approved.** No separate least-privilege staging runtime identity and secret-storage procedure has been verified. The Firebase Admin SDK *service agent* shown in IAM should not automatically be repurposed as an app's long-lived runtime key.
4. **Staging Firestore policies and initial admin user are not ready.** Before login testing, review/deploy staging-specific rules derived from the canonical `firestore.rules`, create a separate staging test administrator, and bootstrap authorized identity records using secure administrative operations. Do not copy production users, sessions, recovery records, Google Drive OAuth data, or passwords.
5. **No live auth or browser regression verification yet.** In-process unauthorized-route tests do not prove actual network IAM roles, TOTP enrollment, session revocation, trusted-device QR, recovery, backend Firestore denials, or UI performance.

## Security-preserving deployment gates

- [ ] Resolve one-time challenge and rate-limit atomicity in the canonical backend with failing tests first.
- [ ] Choose/validate **staging-only** server authentication: preferably a vetted keyless identity mechanism if compatible with Cloudflare; otherwise a dedicated least-privilege staging service account with its credentials stored **only** in Cloudflare encrypted Worker secrets, never in frontend, Git, chat, or logs.
- [ ] Review staging IAM permissions for Firebase Auth administration and Firestore server access. No broad Owner role.
- [ ] Apply reviewed staging-only Firestore rules and create isolated staging test administrator credentials.
- [ ] Verify Worker environment configuration and binding identifiers, plus secrets presence without printing their values.
- [ ] Deploy only staging Worker, never the production Worker, and verify JSON `GET /health` status.
- [ ] Test password/TOTP/trusted device/session/recovery/rate-limit/unauthorized API flows against **staging**, including replay and concurrency.
- [ ] Validate Admin/Public wide/compact/mobile navigation and data integrity, measure performance with a baseline, and run the full regression suite.
- [ ] Audit final diff and only later approve production migration.

**Do not run `wrangler deploy`, `firebase deploy`, or sign in to staging yet.** This file is a checklist of blockers, not deployment authorization.
