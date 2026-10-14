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

## Auth/MFA restoration decision — isolated only

If Firebase Auth still exists, Admin locked out: use the previously issued **offline Master Recovery Key** in the existing server-validated emergency process and fresh TOTP/trusted-device setup. Staging already tested this path; never spend the active Production key to rehearse.

If Firebase Auth project/identity provider is lost: privileged owner-controlled recovery needs independent UID, approved allowlist, user identity and project MFA settings, IAM/secret continuity. No Firebase password/TOTP secret backup is presumed. Recreate privileged identity and enroll new TOTP **in isolated test project first**, enforce no legacy session reactivation, then separately approve a forward-repair plan. Never turn off backend authorization or use a frontend-only override to regain access.

If Cloudflare Worker/KV/DO is lost: restore reviewed code, exact bindings and necessary owner-controlled secrets in an isolated environment, verify KV cryptographic archive and OAuth/message semantics, create fresh coordinator security challenge state, and require fresh user step-up rather than re-enabling spent challenges or expired sessions.

## Remaining DR acceptance criteria

- [x] Live Admin/TOTP/trust and live same-token server-denial.
- [x] Encrypted Firestore snapshot and synthetic staging restore.
- [x] Isolated Cloudflare SQLite DO PITR and cleanup.
- [ ] Owner has privately generated and separately verified the two-KV encrypted archive.
- [ ] Isolated full Auth/MFA + KV + credentials rebuild, with no revoked session resurrection.
- [ ] Full-stack fail-closed recovery plan authorized for a real incident.

The Production CMS is released. **Full disaster-recovery certification is not yet PASS.**

References: Cloudflare KV API https://developers.cloudflare.com/api/resources/kv/ and Firebase Auth user import https://firebase.google.com/docs/auth/admin/import-users.
