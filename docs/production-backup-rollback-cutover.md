# LΛN production backup, rollback, and security cutover — PLAN ONLY

**2026-10-11 · Release candidate PR #10 · NOT DEPLOYED · ENCRYPTED FIRESTORE SNAPSHOT VERIFIED; AUTH/CLOUDFLARE RESTORE STILL BLOCKED**

This document is an operator-controlled plan to preserve production access during a security-owner migration. It does **not** authorize executing any production operation. Production targets: Firebase `rolando-portfolio-3f1a3`, Cloudflare Worker `lan-cloudinary-telemetry`. Staging `lan-portfolio-staging` is isolated, not a production backup or restore destination.

## Observed production baseline (owner screenshots / read-only checks)

- Production Firestore administrator allowlist record is `active: true`; owner compared its document ID to the current Firebase Authentication UID and reported **MATCH**. This does **not** prove a working full MFA / recovery login.
- Production Identity Platform: `mfa.state = DISABLED`, TOTP provider entry `state = ENABLED`. Email/password enabled; SMS disabled. These are independent settings. **No change was made**.
- Production Cloudflare Worker health JSON reports `ok: true`, `firebaseConfigured: true`, `cloudinaryConfigured: true`, `storageOAuthConfigured: true`, `messagePushConfigured: true`, `messageSecurityConfigured: true`, `googleDriveOAuthConfigured: true`. The current deployed health JSON does not contain `securityCoordinatorConfigured`.
- Production Worker currently binds KV `STORAGE_OAUTH`, `PORTFOLIO_MESSAGES`, and legacy `SECURITY_STATE`. There is **no** `SECURITY_COORDINATOR` Durable Object binding yet.
- Production Cloudflare account supports Durable Objects / SQLite, but the dashboard shows **only the staging** Durable Object namespace.
- Production Worker dashboard reports active version prefix `cbb87c06`, 100% traffic. **One deployed version** appears in rollout history; no verified older rollback target. A prefix is not a full version ID.
- Production encrypted secret names exist for Firebase service account, Recovery Pepper, Cloudinary, Google Drive; their values, IAM scopes, validity and recovery continuity were **not** inspected or verified. **Never retrieve values for chat, frontend, CI logs or GitHub.**
- Firebase screenshot shows **Spark plan**. Firestore managed export/import **requires billing and Blaze**; it cannot be treated as an existing free backup option. Source: https://firebase.google.com/docs/firestore/manage-data/export-import .

## Confirmed offline production Firestore backup evidence (owner-operated)

- User separately approved the read-only production backup. The candidate's owner-run `scripts/secure-firestore-backup.mjs` captured **392 Firestore document resources** into encrypted `production-firestore-2026-10-11-v2.lanfbak`. This is sensitive user-owned material; it has **not** been uploaded to GitHub, ChatGPT, staging, or CI.
- The script verified the v2 encrypted archive's authenticated data/tag, manifest digest and 392-record count on Cloud Shell. Windows local download SHA-256 **matched** the original; the owner moved the downloaded archive out of the GitHub folder into a private folder and reported deleting old v1 from Cloud Shell.
- The v2 encryption passphrase is stored separately by the owner (never provided here). Do not display, request or collect it.
- A **synthetic-only** encrypted backup restore was run against an isolated Firestore emulator: no production data, real identities, backup bytes or credentials were loaded. This proves the synthetic type round trip—not the ability to restore 392 private documents or Firebase Authentication.
- Limitations: inventory isn't a transactionally consistent point-in-time snapshot; Firestore rules, indexes, Firebase Auth/MFA users, IAM, Cloudflare KV/DO, and Worker secrets are **not** covered. A verified storage file is not an approved disaster recovery rehearsal.
- Cloud Shell v2 copy can be retained until an independent owner-controlled second copy is secured. Never store an unencrypted backup in source control or the public directory.

## Critical rollback constraint

**Do not rely on the Cloudflare Rollback UI to restore the older Worker.** Introducing a Durable Object class via the new `exports.SecurityCoordinator` lifecycle can prevent rollbacks across that class lifecycle change. KV/Firestore/Durable Object state is **not** rolled back with a Worker version. Sources:

- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/

The release fallback must be a **reviewed, tested forward corrective deployment** that keeps the security coordinator class, existing server-authorized session checks, and all data schemas. Do not publish a patch layer, second KV security owner, weakened Firestore Rules, or an untested `main` Worker rollback. Preserve an immutable source copy of the pre-release Worker bundle/config, but **do not claim it can be redeployed safely after a DO lifecycle change**.

## Backup ownership and inventory

| Source of truth | Minimum pre-release snapshot | Verification / safe handling |
| --- | --- | --- |
| GitHub production source | `main` commit `2cc642e1190469dbe8ee77f130413dae09f1ab6d` and immutable Git tree, current `firebase.json` and `firestore.rules` | Compare exact hashes and preserve separate candidate PR SHA. Public UI byte-identical. |
| Cloudflare Worker | Full deployed version ID, code bundle, Wrangler config, route/domain bindings, secret **names**, KV namespace IDs, DO namespace inventory | Retrieve metadata in the owner's privileged environment; avoid logging secret values. Cloudflare rollback across new DO class is not guaranteed. |
| Firestore (server security documents) | Private, access-controlled, encrypted restorable backup of `authorizedAdministrators`, `adminSecurityDevices`, `adminSecuritySessions`, `adminSecurityRecovery`, `adminSecurityState`, `adminSecurityDeviceBootstrap`, `adminSecurityDeviceCredentials`, `adminSecurityStepUps`, `adminSecurityPreferences`, and other active security owners + dependent records | Snapshot verified counts, types, timestamps, restore integrity **without rendering contents**. Hash of Recovery Key is a sensitive record: backup must remain encrypted, least-privilege and offline from this chat. Firestore direct client Rules must remain fail-closed. |
| Firestore public content | Existing `portfolio` singleton and published collection records, plus indexes and Rules version | Ensure Public remains byte-identical in UI and populated from production data, not staging fixtures. Restore operations can overwrite records. |
| Firebase Authentication / Identity Platform | Administrator UID metadata, MFA enrollment/status metadata, project-level `mfa` state/provider configs and approved domain list; user/token revocation state | Document account identity and authorized restore procedure via privileged admin tools. A Firestore export **does not back up Firebase Auth MFA enrollment**. Never export TOTP shared secrets or Auth credentials. |
| Cloudflare KV | Identify whether old `SECURITY_STATE` holds **pending login/recovery/enrollment challenges** or active rate-limit windows; inventory `STORAGE_OAUTH` and `PORTFOLIO_MESSAGES` | Do not copy expired one-time challenges to the new DO, replay tokens, or delete old KV before new behavior is verified. OAuth/message KV state must remain on same canonical namespaces. |
| Runtime secrets | Presence, least privilege and continuity of `FIREBASE_SERVICE_ACCOUNT_EMAIL`, `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`, `SECURITY_RECOVERY_PEPPER`, Cloudinary, OAuth secrets | **Never expose secret values**. Do not rotate Recovery Pepper as part of migration; changing it breaks verification of previously hashed Recovery Keys. Secrets are not included in Git history or Firestore export. |

### Backup method decision — Spark selected; implementation PREPARED, execution BLOCKED

**Option A: Managed Firestore export.** Requires explicit owner authorization to upgrade the Firebase project to Blaze/enable billing and an owner-controlled Cloud Storage bucket. Follow documented export/verify/import process. Firestore export isn't necessarily a point-in-time snapshot if writes continue; set a safe release window. This option must not be silently selected.

**Option B — OWNER SELECTED, FILE CREATED AND VERIFIED: Encrypted, least-privilege, owner-operated backup utility.** The owner chose to retain Spark and ran the dedicated read-only Firestore REST export tool. It uses authenticated least-privilege Cloud Shell credentials, explicit collection allowlist, authenticated encryption with a random nonce, verified manifest/hash, and separate private passphrase. The downloaded file matched SHA-256; a synthetic-only emulator restoration passed. It must not write any private production data into repo, CI artifacts, public site, staging project, assistant context, browser/localStorage, or GitHub. A backup is **not considered available** until the owner has actually generated it, stored it privately, and tested restoration safely. A custom backup does not equal the managed Google export and must cover subcollections, Firestore types, indexes/rules, and Auth metadata separately.

**Release remains NO-GO until production Auth/MFA, Worker/DO/KV recovery controls and a safe, authorized restore strategy are verified.** The v2 encrypted Firestore snapshot exists, but neither production backup completeness at one point in time nor actual production restore has been proven.


### Spark (free) backup utility prepared — NOT RUN against production

The owner chose to remain on **Spark**. The candidate now includes one canonical backup-only owner, `scripts/secure-firestore-backup.mjs`, with synthetic regression tests in `tests/secure-firestore-backup.test.mjs` and CI. This does **not** constitute an existing Firestore backup or a verified restoration.

- Uses a short-lived `gcloud auth print-access-token` credential for read-only Firestore REST `listDocuments`/`listCollectionIds` calls, an explicit quota project, exact project ID gate, and an interactive non-echoed passphrase. No service-account private key is exported or logged.
- Enumerates known root collections plus the reviewed `privateMessageThreads/{id}/messages` nested collection, including missing ancestor document resources; any unexpected collection/depth/pagination failure **aborts** instead of silently dropping records. The live collection inventory may differ; stop and review names before any authorized execution.
- Streams raw Firestore document representations (preserving REST field types) through AES-256-GCM encryption and a key derived with scrypt; encrypted files are created outside the repository with owner-only `0600` permissions, authenticated manifest/count/checksum, never plaintext on disk. Offline verification is implemented without writing plaintext or logging records.
- Read-only mode has **no restore or mutation command**. On any partial failure, the temporary encrypted artifact is removed. Existing backups are not overwritten.
- Does **NOT** back up Firebase Authentication accounts, TOTP enrollments, Cloudflare KV/DO, Worker versions, runtime secrets, Firestore Rules/indexes, or IAM. Those sources still require separately verified continuity/restore planning.
- Firestore list pagination is **not a transactionally consistent point-in-time export** while documents are changing. A controlled quiet window and document/inventory counts must be checked; an encrypted archive alone is not proof of a correct restoration.
- Release blocker remains open until the owner separately approves the production read, holds the archive privately **and separately from its passphrase**, verifies its authenticity offline, and tests a safe offline/emulator restoration. Do not attach or paste backup bytes, a password, Firebase tokens, or security documents in ChatGPT/GitHub.
- The utility uses Google Cloud Firestore document read quotas. Free-tier quotas/permissions still apply; this is not Google-managed Firestore export/import.

**Commands are documented for later controlled execution only, not authorized now.** Do not run these yet or pass real passphrases in a command line:
```bash
node scripts/secure-firestore-backup.mjs backup \
  --output /ABSOLUTE/PRIVATE-LOCATION/production-firestore.lanfbak \
  --confirm-production-read true
node scripts/secure-firestore-backup.mjs verify \
  --input /ABSOLUTE/PRIVATE-LOCATION/production-firestore.lanfbak
```
The first command prompts twice for a unique backup passphrase, the second prompts once. Never run with production credentials from public/CI environments.

## Old owner → new owner transition

1. **Before cutover:** Legacy production Worker reads/writes `SECURITY_STATE` KV for one-time challenges and security rate limits. Security sessions/devices/recovery hashes are in Firestore. Old Worker also uses `PORTFOLIO_MESSAGES` and `STORAGE_OAUTH` KV for separate responsibilities.
2. **After cutover:** Candidate `telemetry-worker/src/index.js` uses `SECURITY_COORDINATOR` Durable Object with SQLite for atomic challenges and rates; server-validated sessions/devices/recovery remain Firestore-owned. `SECURITY_STATE` cannot remain an active competing security owner. Separate message/OAuth KV bindings remain.
3. **Controlled release window:** Do not start a sensitive login/recovery/device-enrollment action immediately before migration. Avoid issuing new one-time challenges during deployment; let in-flight challenges finish or expire according to their scoped TTL. The known old default challenge is 5 minutes, recovery challenge 15 minutes; consult **actual** old route TTLs and rate windows (up to 30+ minutes). Do not silently reset cooldowns by migrating early.
4. **Continuity checks:** Verify production trust records, revocation, old Recovery Key hash continuity using the same server pepper, and authorized administrator/session binding before any write. Never test a live recovery by consuming a real recovery key.
5. **DO lifecycle:** Cloudflare's current declarative Wrangler `exports.SecurityCoordinator` (SQLite) is valid and is **mutually exclusive** with legacy `migrations`. It adds the class on the first production deployment; this is a forward-only lifecycle boundary. Test the exact production Worker deploy config and permissions in an isolated dry-run. **Staging Durable Object storage is separate and never copied.**
6. **Backend readiness:** Ensure Worker JWT/custom-token issuance + Identity Toolkit permissions, active Firestore session claims, exact list of Firebase Rules under candidate, and the user's existing trusted-session proof remain valid. No bypass of direct Firestore access checks.
7. **Production MFA sequencing:** MFA project-level `DISABLED → ENABLED` change must be separately authorized, one-field update mask `mfa.state`, only when Worker and Rules/Hosting release dependencies are ready; **never `MANDATORY`** without a new design and approval. Preserve enabled TOTP provider and disabled SMS. See `docs/production-mfa-change-plan.md`.
8. **Health + smoke:** After each **separately approved** production mutation, test current protected Admin session, new untrusted/TOTP login, trusted-device cryptographic proof, logout/login behavior, expired/reused QR, individual device revoke, targeted sessions revoke, recovery metadata continuity, direct unauthorized Firestore denial, Public rendering & QR, and security logs. Source/CI tests are not sufficient.
9. **Forward repair only:** If new code fails after the DO class is created, restore service with an auditable corrective release that maintains the existing DO class and server-side security checks. Do not delete DO storage, re-enable legacy KV as a second owner, or overwrite security records from stale copies.
10. **No unsafe rollback:** Do not restore `mfa.state = DISABLED` or loosen production Rules merely to pass a test. Any emergency Auth configuration rollback requires a **separate security impact assessment and explicit approval**, because disabling MFA changes authentication guarantees. Never implicitly revoke users/devices, erase recovery, or overwrite public content.

## Proposed release window and stop/go sequence — planning only

**No part of this sequence is approved for execution.** Require explicit, separate user authorization for each production-changing operation. Before the window, verify full backup custody and plan for a forward-corrective Worker redeployment; an old pre-DO version cannot be assumed rollback-compatible.

1. **Source-only checks, no production writes:** exact-SHA CI including the canonical Rules emulator, Worker runtime tests, production Wrangler `deploy --dry-run` with `exports.SecurityCoordinator`, and byte-identity Public layout contract. Log only metadata, never secrets or recovery material.
2. **Read-only live preflight:** confirm matching active Admin allowlist UID, email verification and usable approved login/recovery method; no destructive recovery tests. Snapshot Firebase MFA status (currently overall `DISABLED`, TOTP provider `ENABLED`), full Worker version ID (observed prefix `cbb87c06`), existing bindings, and presence-only encrypted secrets. Confirm IAM roles and service-account abilities without disclosing keys. Confirm snapshot custody and independent recovery route.
3. **Controlled drain window:** stop starting new security-sensitive login/device enrollment/recovery operations and allow live **legacy one-use security challenges and cooldowns** to expire. Old password/TOTP/enrollment windows are several minutes; recovery window 15 minutes, rate windows may extend to **60 minutes**. Confirm actual KV TTL coverage or use a longer controlled window; never silently reset an active lockout or copy a one-use challenge.
4. **Canonical security backend cutover (separately authorized):** use the exact production candidate with pre-reviewed Cloudflare Durable Object `exports` and binding to publish Worker `lan-cloudinary-telemetry`. This deploy creates the first production `SecurityCoordinator` class and removes the active `SECURITY_STATE` KV binding from the Worker. Preserve `STORAGE_OAUTH`, `PORTFOLIO_MESSAGES`, Cloudinary and Google Drive. Do **not** delete the legacy KV namespace. Immediately verify `/health` returns `securityCoordinatorConfigured:true` and existing public message/Cloudinary/Drive behavior. **Stop the release if it fails; fix forward preserving the DO class, not by weakening security.**
5. **Identity Platform MFA (separately authorized):** only after Worker access and privileged identity/config continuity are confirmed, use the reviewed one-field `mfa.state: DISABLED → ENABLED` updateMask; retain TOTP `ENABLED`, SMS disabled, and email/password primary. Do not enable `MANDATORY`. Do not activate earlier or independently of the Worker window. Reread the project config.
6. **Firestore Rules and Admin Hosting (separately authorized):** publish the exact audited candidate Rules and Admin release in a coordinated short window, after verifying the Admin account can complete required TOTP bootstrap. Rollout/verify security-session claims immediately. Do not expose private backend docs by loosening Rules and do not touch the frozen Public UI content/layout.
7. **Live authorization checkpoint:** test temporary/untrusted login requiring TOTP, trusted-device cryptographic proof and repeated login, one-time enrollment QR expiry/replay, individual session/device revoke and real direct Firestore denial with revoked identity, suspicious/rate-limited event handling, Recovery Kit existence **without consuming it**, and authenticated direct Rules checks. Include wide/compact/mobile Admin layout, Public media/QR and contact actions. Stop on any server-side grant discrepancy.
8. **Email alerts:** provider is unconfigured in staging. Verify production provider status; report “not configured” until delivery provider confirms acceptance/delivery. Do not claim sent merely because branding saves.
9. **Review:** request explicit production security audit and user approval for final release. Verify exactly the final SHA; deliver one ZIP only after completed runtime evidence.

**Abort conditions:** missing Cloudflare DO binding, unknown administrator UID, unverified Auth/TOTP bootstrap, missing recovery continuity, private Firestore access without a valid session, failed one-time challenge replay check, missing backup/recovery route, unreviewed secret change, production public regression, or any unexpected Worker deployment mutation. No emergency bypass.

## Preflight stop/go matrix (current)

- [x] Candidate branch and draft PR #10; tests green at previously reviewed commit.
- [x] Production Admin `authorizedAdministrators/{uid}` active, and owner reported Auth UID MATCH.
- [x] Production MFA read-only state documented; *not changed*.
- [x] Production Worker health read-only baseline documented.
- [x] Legacy `SECURITY_STATE` KV and absent production DO confirmed by screenshots.
- [x] Cloudflare staging Durable Object SQLite exists; proves account capability only.
- [x] Current production Worker version prefix and one-row history documented.
- [ ] Full Worker version ID and independent recovery/redeploy route safely verified.
- [x] Spark-compatible encrypted Firestore backup v2 created, authenticated archive verified, matching local SHA-256, moved to private folder; **392 document resources**.
- [x] Synthetic-only restore rehearsal passed in Firestore emulator.
- [ ] Actual production snapshot completeness and privileged restore plan, plus Firebase Auth / Cloudflare state recovery: **still unverified**.
- [ ] Production Firebase Auth metadata and live session / TOTP runtime readiness tested without destructive recovery.
- [ ] Complete old challenge/cooldown window inventoried or safely drained.
- [ ] First production DO class lifecycle and forward-corrective release strategy tested.
- [ ] Confirm no secrets leaked to CI/frontend/GitHub and no producer changes to public layout.
- [ ] Separate production MFA mutation approval, separate production deployments approval, then final exact-SHA CI and live verification.
- [ ] Final ZIP produced from exact verified release build.

**Release decision: HOLD. Read-only production Firestore backup was expressly approved and performed; no production data/configuration writes or deployments occurred.**
