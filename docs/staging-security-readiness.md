# LΛN Staging Security Gateway — Readiness

**Scope:** investigation branch only. No Cloudflare/Firebase deployment, no live security certification.

## Verified isolated work

- Staging Worker still returned "Hello World!" at the last live browser check; the canonical Worker was NOT deployed.
- Admin one-time challenge and QR approval/consumption now use the canonical SQLite Durable Object in telemetry-worker/src/security-coordinator.js, routed via telemetry-worker/src/index.js. Admin, Cloudinary and Google Drive sensitive rate-limit counters use the same canonical coordinator. The competing SECURITY_STATE KV runtime binding and handlers were removed.
- The Worker checks Firebase Security Gateway sessions and direct Firestore authorization server-side. No client-only authentication decision was introduced.
- Wrangler staging configuration declares SECURITY_COORDINATOR with SQLite storage and retains PORTFOLIO_MESSAGES and STORAGE_OAUTH KV bindings. It does not retain the obsolete SECURITY_STATE KV binding.
- 61 source/regression tests (including Master Recovery Key concurrent replay) plus 2 actual local Cloudflare workerd SQLite tests passed. In one test, 50 simultaneous challenge redemption attempts yielded exactly 1 success; in another, 36 simultaneous rate-limit calls with limit 4 yielded exactly 4 accepted calls.
- Pinned Wrangler staging bundle passed deploy --dry-run only. See GitHub Actions run 37825328526.
- Missing coordinator binding fails closed (HTTP 503), rather than falling back to old KV state. Staging Web API key is local-only for build input and never committed in staging manifest.

## Remaining blockers before staging deployment

1. **Recovery-key replay race resolved in source and isolated tests, not live staging:** recovery/start now claims the existing Firestore record using its server updateTime as a write precondition. A synchronized five-request Worker HTTP regression failed against the old implementation (5 accepted) and passed after the migration (1 accepted, 4 rejected). Recovery completion checks the matching pending challenge and completed session/device + Firebase MFA reset, then conditionally writes the replacement key against the current Firestore version. **Still requires live Firebase/Firestore testing.** Partial reset failures currently invalidate the old key before the reset finishes, so operational recovery/retry policy must be reviewed without introducing a bypass. Check how recovery Activity logging failures are handled after a replacement key has already been stored.
2. Public message verification, visitor puzzle, visitor rate limits, and Google Drive OAuth callback state include separate KV read-then-delete/read-modify-write paths. Review and remediate as separate public-message/OAuth canonical owners.
3. First trusted-device enrollment has a bootstrap race if two distinct challenges simultaneously observe no existing trusted devices. Needs authoritative serialized or transactional initial enrollment.
4. Staging-only Firebase server identity, least-privilege IAM, encrypted Worker secrets, Firestore Rules rollout, isolated admin bootstrap, and direct backend authorization have not been verified.
5. Full live TOTP, device/session revocation, recovery, rate/attack, wide/compact/mobile Admin/Public regression and navigation speed tests have not been run.

## Required release gates

- [x] Atomic Admin challenge and sensitive rate-limit implementation with failing-before/green-after tests
- [x] Wrangler staging configuration and local workerd runtime concurrency checks
- [x] Remediate recovery-key concurrent claim and verify deterministic failing-before/green-after Worker HTTP test
- [ ] Review partial-failure recovery restart behavior, public-message/OAuth replay and first-device bootstrap concurrency
- [ ] Approve staging-only backend credentials and deploy/test staging-only Firestore Rules
- [ ] Deploy staging Worker ONLY after separate authorization; GET /health must return canonical JSON with securityCoordinatorConfigured true
- [ ] Live-test complete authentication and revocation flows and unauthorized Firestore/Worker API requests
- [ ] Measure before/after performance and review final diff
- [ ] Separate production promotion approval after security audit

Never deploy, grant privileges, sign in, or declare the service secure based on local tests alone. No production configurations or live resources were deployed by this branch.
