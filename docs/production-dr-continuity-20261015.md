# LΛN — Production DR continuity, 2026-10-15

## Live status and proven checkpoints

Operational release: LIVE; GitHub main source aligned at commit 5138ef0. Verified live session revocation with the **same token**: Worker 200→403 and Firestore 200→403. Existing private encrypted Firestore snapshot (392 documents) passed integrity verification and synthetic staging restore. Disposable Cloudflare SQLite Durable Object PITR and cleanup also passed. Do not repeat these tests.

Production Coordinator DO was **not restored**; restoring spent challenges or rate-limit data is unsafe. Security Email is de-scoped; Security alerts use Web Push.

## Canonical DR ownership and limitations

- Firebase Authentication/Identity Platform: Auth users, administrator UID, project-level TOTP MFA settings, and enrollment metadata are **not included** in Firestore snapshots. TOTP shared secrets must never be exported. Fresh enrollment is required on a destructive emergency-recovery path. Firebase user import has collision/overwrite risks; never import users to Production without an approved isolated rehearsal.
- Firestore: the 392-document encrypted backup is not a cross-service point-in-time snapshot. Recovered revoked sessions must **never** be revived by a stale restore.
- Cloudflare SECURITY_COORDINATOR Durable Object: live one-time/replay/rate-limit authority. The isolated PITR test passed. Do not replay old Production challenge state as a rollback.
- Cloudflare STORAGE_OAUTH KV: Google Drive OAuth refresh tokens, private metadata. Preserve under private encryption; restored tokens may be stale.
- Cloudflare PORTFOLIO_MESSAGES KV: message/push/cache records. Restored push subscriptions or messages can be stale; avoid unreviewed live replay.
- Cloudflare Worker secrets, Google Cloud IAM, the Recovery Pepper, OAuth and Cloudinary credentials: keep continuity in an owner-controlled secret manager and private role inventory, **never GitHub, chat, frontend, or the KV backup**. The private Recovery Pepper must remain available for old Recovery Key hashes.

## Owner-operated READ-ONLY encrypted KV snapshot

Run only in an interactive local Node.js 22+ PowerShell terminal. A Cloudflare token scoped to Workers KV Storage **Read** (not Write) and the exact account ID are required. **No Production writes are made.** Keep the encrypted file outside the repo; keep the 16+ character secret passphrase separately. Never paste either into chat.

1. Create a private directory outside the repo, e.g. $HOME\LAN-Private-Backups.
2. Set LAN_CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the **current PowerShell session only**, not source control. Never put token values in commands shared with others. Prefer a new KV-read-only token.
3. Run this from the reviewed source after merge/pull:
   node scripts/secure-cloudflare-kv-backup.mjs backup --output "$HOME\LAN-Private-Backups\cloudflare-kv-20261015.lankv"
   Enter and confirm the hidden passphrase.
4. Verify separately:
   node scripts/secure-cloudflare-kv-backup.mjs verify --input "$HOME\LAN-Private-Backups\cloudflare-kv-20261015.lankv"
5. Output is only PASS/HOLD and per-namespace key counts. The script pins exactly two namespace IDs to telemetry-worker/wrangler.jsonc, does only Cloudflare GET requests, handles cursor pagination, preserves metadata, expiration and binary values, encrypts with AES-256-GCM and scrypt, authenticates archive on disk, uses an atomic no-overwrite publish, and cleans incomplete archives.

This is not a perfectly consistent snapshot if KV changes during enumeration. Missing keys and integrity failures cause HOLD; successful local authentication does not guarantee stale OAuth tokens will work after a restore. No automatic RESTORE operation exists, by design.

## Preferred operator path: existing Wrangler OAuth; no new Cloudflare API token

The owner confirmed `WRANGLER KV READ: PASS` with the authenticated pinned local Wrangler while freshly created Cloudflare API tokens returned HTTP 401 for Workers KV. **Do not roll/rotate tokens again.** Run from the detached `LAN-KV-Backup-Runner` worktree synced to main. The owner already has Wrangler installed in the adjacent `Myportfolio-Security-Latest/telemetry-worker/node_modules` directory. The encrypted backup owner will discover that pinned executable automatically.

```powershell
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
git switch --detach FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw "Update failed" }

Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$HOME\LAN-Private-Backups" | Out-Null
$file = "$HOME\LAN-Private-Backups\cloudflare-kv-20261015.lankv"
node .\scripts\secure-cloudflare-kv-backup.mjs backup --output $file --wrangler
if ($LASTEXITCODE -ne 0) { throw "Backup HOLD (do not rerun)" }
node .\scripts\secure-cloudflare-kv-backup.mjs verify --input $file
if ($LASTEXITCODE -ne 0) { throw "Verify HOLD (do not rerun)" }
```

Enter your own private 16+ character backup passphrase at the local hidden prompts. It is **not** your Admin/Cloudflare password. Wrangler reads exact canonical remote namespaces with `kv key list` and `kv key get` (all read-only) through its existing OAuth login; stdout binary values are consumed in memory, never printed to the terminal or stored plaintext. As before, all data are saved only in the private authenticated encrypted vault. The vault reports only counts and integrity PASS/HOLD. **The owner completed the live read-only encrypted snapshot and independent verification on 2026-10-15; the two namespaces contained 10 and 5 records. Do **not** rerun this backup procedure as part of routine release sign-off.**

## Isolated encrypted KV reconstruction — no cloud writes

The owner already completed and verified the real encrypted snapshot: **STORAGE_OAUTH 10** and **PORTFOLIO_MESSAGES 5** records. Do not back up again.

After pulling this reviewed source into the existing `LAN-KV-Backup-Runner` worktree, the canonical backup tool can reconstruct each encrypted binary value, metadata and expiration **into bounded process memory only**, authenticate the archive and manifest, compare every restored count and wipe the temporary bytes. It does not connect to Cloudflare, Firebase or a server, write plaintext, or import stale OAuth/push records. This is a **rehydration proof**, not a live KV namespace restoration or an Auth/MFA test.

```powershell
$file = "$HOME\LAN-Private-Backups\cloudflare-kv-20261015.lankv"
node .\scripts\secure-cloudflare-kv-backup.mjs rehearse --input $file
```

Enter the same original, private 16+ character vault passphrase. Console output contains only PASS/HOLD and namespace counts. Never send the archive, passphrase or OAuth values to the repository, CI or chat.

## Auth/MFA restoration decision — isolated only

If Firebase Auth still exists, Admin locked out: use the previously issued **offline Master Recovery Key** in the existing server-validated emergency process and fresh TOTP/trusted-device setup. Staging already tested this path; never spend the active Production key to rehearse.

If Firebase Auth project/identity provider is lost: privileged owner-controlled recovery needs independent UID, approved allowlist, user identity and project MFA settings, IAM/secret continuity. No Firebase password/TOTP secret backup is presumed. Recreate privileged identity and enroll new TOTP **in isolated test project first**, enforce no legacy session reactivation, then separately approve a forward-repair plan. Never turn off backend authorization or use a frontend-only override to regain access.

If Cloudflare Worker/KV/DO is lost: restore reviewed code, exact bindings and necessary owner-controlled secrets in an isolated environment, verify KV cryptographic archive and OAuth/message semantics, create fresh coordinator security challenge state, and require fresh user step-up rather than re-enabling spent challenges or expired sessions.

## Fail-closed Firestore forward-repair rehearsal (new)

The Firestore archive includes `authorizedAdministrators`, old trusted devices, sessions,
security recovery hashes, challenges, step-ups and other security records. **Never replay these
into a recovered project.** The canonical restore policy is
`scripts/security-dr-restore-policy.mjs`; the existing encrypted Firestore verifier owns
its only consumer.

After syncing the reviewed source, if the private Firestore backup remains available,
run this **offline, read-only** command on the private machine:

```powershell
node .\scripts\secure-firestore-backup.mjs rehearse --input "ABSOLUTE_PRIVATE_FIRESTORE_BACKUP_PATH.lanfbak"
```

Use the existing **Firestore** backup passphrase (24+ characters), not the separate KV
passphrase. Nothing is uploaded. The validator authenticates the entire archive and
classifies every document. Only reviewed portfolio content can become **restore
candidates**; `authorizedAdministrators`, all `adminSecurity*` roots, private messages,
settings and migrations are quarantined. This command makes **zero remote/local data
writes**, displays counts but no record contents, and **does not restore anything**.
Missing records, malformed paths, duplicate documents and authentication failures
fail closed. Old sessions and trusted devices must never come back from a snapshot.
The content candidates still require reviewed isolated target restoration later.

## Isolated complete-infrastructure rebuild — not yet certified

**A full certificate requires an actual isolated environment**, not a synthetic test:

1. Create a separate disposable Firebase project and Identity Platform test Auth
   tenant/project with TOTP MFA enabled; never reuse the Production Firebase UID,
   enrollment secret or Recovery Key. Rebuild a fresh, nonprivileged test identity
   with a new password and enroll *new* TOTP on an authenticator; verify wrong code,
   temporary login, trusted enrollment and logout/login behavior.
2. Restore **only reviewed content candidates** into isolated Firestore. Keep
   `authorizedAdministrators` and every historical `adminSecurity*` record excluded.
   Owner-controlled IAM then provisions the **new** authorized UID through the
   audited `authorize-admin.mjs` flow. This is the only Admin authorization
   mechanism, not an allow-all rule or frontend bypass.
3. Recreate an isolated Worker with an **isolated SECURITY_COORDINATOR SQLite
   Durable Object**, its own KV namespace IDs and isolated secret inventory;
   never attach any production KV/DO binding or automatically copy credentials.
   Verify staging Worker `FIREBASE_PROJECT_ID`, service-account secret names,
   `SECURITY_RECOVERY_PEPPER`, push/VAPID config and Google OAuth/Cloudinary
   integration requirements from owner-held private manager. Secret values must
   never enter GitHub, logs, archive summaries or chat.
4. Confirm that all old session/device identifiers and previously issued Firebase
   credentials fail **both** Worker and Firestore access. Even if a historical
   archive contains `active:true`, it is never imported. Re-enroll trusted devices
   only after fresh TOTP; issue and privately store a **new** Master Recovery Key.
5. The old KV encrypted archive supports authenticated in-memory rehydration, but
   OAuth refresh tokens and push subscriptions may be expired or invalid after
   disaster. Do **not** replay OAuth or push endpoints into an isolated project
   without a privacy and scope review; test new OAuth consent/reauthorization.
6. Record separate operator evidence for the actual new Auth+TOTP, authorized
   Firestore permission denial, Worker route/session revocation, fresh DO challenge
   rejection, KV integration, bounded restore time, and cleanup. Only then mark
   **full-stack DR certified**. Cloudflare DO PITR from old live state is not a
   safe substitute; past challenges must remain spent.

No current connector has been authorized to create isolated Firebase Auth projects,
configure Cloudflare secrets or perform an MFA QR challenge for the owner. These
steps cannot be claimed PASS by source tests or simulated HTTP responses. A
production-wide reset must never be used to accelerate the rehearsal.

## Remaining DR acceptance criteria

- [x] Live Admin/TOTP/trust and live same-token server-denial.
- [x] Encrypted Firestore snapshot and synthetic staging restore.
- [x] Isolated Cloudflare SQLite DO PITR and cleanup.
- [x] Owner privately generated and separately verified the two-KV encrypted archive (10 and 5 records).
- [ ] Isolated full Auth/MFA + KV + credentials rebuild, with no revoked session resurrection.
- [ ] Full-stack fail-closed recovery plan authorized for a real incident.

The Production CMS is released. **Full disaster-recovery certification is not yet PASS.**

References: Cloudflare KV API https://developers.cloudflare.com/api/resources/kv/ and Firebase Auth user import https://firebase.google.com/docs/auth/admin/import-users.
