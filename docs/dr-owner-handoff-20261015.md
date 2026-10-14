# LΛN — Morning disaster recovery handoff (2026-10-15)

## What is already complete

Production Public, Admin and Security & Access are LIVE. Do not redeploy just for DR.

Default GitHub main contains only the 207 preserved Production source/config files. The entire tested source, backup tools, docs and CI are retained at [archive/security-release-tests-dr-20261015](https://github.com/shin-ich1/Myportfolio/tree/archive/security-release-tests-dr-20261015).

Prior real evidence: encrypted Firestore snapshot (392 documents), synthetic isolated Firestore restore, encrypted 10+5-record Cloudflare KV backup and its private memory-only rehydration, isolated Cloudflare SQLite Durable Object PITR, and the previously valid Production session token denied by BOTH Worker and Firestore after revocation. Do not repeat these already passed tests.

This branch adds an automated **read-only source isolation preflight**. Execute from the archive-based DR branch:

    node scripts/dr-isolation-preflight.mjs

It inspects only repository source/config and makes zero Cloud requests or filesystem writes. PASS means the separation assumptions are intact, **not** that the full DR rehearsal passed.

## Exactly what needs owner-approved cloud access

1. **Firebase Auth/Identity Platform:** through official Firebase sign-in, confirm an **isolated disposable Firebase project** with TOTP MFA enabled, IAM scoped only to that project, and a new test administrator with a fresh password. Do not reuse Production UID, backup Recovery Key or authenticator seed. The owner must scan the fresh authenticator QR and confirm an actual code.
2. **Cloudflare Worker/DO/KV:** use official Cloudflare auth to provision a new isolated Worker, new namespace IDs and fresh SQLite SECURITY_COORDINATOR. Configure needed test-only Worker encrypted secrets from the owner's private manager; never reveal values to GitHub/chat. Preserve Production Worker, KV, coordinator, service-account credentials and Recovery Pepper.
3. **Content-only Firestore restore:** confirm the production encrypted backup's offline dry run and perform an approved, isolated import of reviewed portfolio content only. Strictly exclude historical authorizedAdministrators, adminSecurity* records, sessions, devices, recovery hashes, private messages and settings. Verify counts and typed values; a scan alone is not an actual restore.
4. **End-to-end tests on the NEW environment:** fresh TOTP + QR enrollment, untrusted and trusted login, old/expired OTP denial, revoked device isolation, all-other-session signout, fresh recovery key and old-key rejection, denial on both Worker and Firestore using the **same previously valid test token after revocation**, and brand-new coordinator rejecting old/reused challenges.
5. **Storage integration/cleanup:** verify isolated OAuth consent and storage read/write with disposable data, without replaying stale Production refresh tokens or push subscriptions. Owner reviews and approves cleanup of disposable test resources only.

## Do not do

Do not reset or test a destructive recovery on the real Production Firebase or Cloudflare services. Never weaken backend permission rules for testing. Do not download or paste credentials, TOTP seeds, backups, recovery keys, passwords or OAuth tokens into ChatGPT or GitHub. Do not destroy existing staging until its dependencies are checked. Do not claim FULL DR CERTIFIED based only on source CI, docs or offline vault verification.

## Honest final state

- Source, security-backup and separation checks: ready for automated verification
- Production: LIVE and unchanged
- Real isolated Auth/MFA/Worker/IAM/content restore: awaiting owner-authorized cloud operations and human authenticator approval
- Full disaster-recovery certification: **PENDING** until those actual runtime tests are observed and recorded

The handoff is deliberately precise so the owner only has to provide the **required official-account connection/consent and TOTP verification**, never secret values in chat.
