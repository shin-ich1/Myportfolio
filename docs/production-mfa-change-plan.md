# Production Identity Platform MFA state change plan — PREPARED, NOT EXECUTED

**Project:** `rolando-portfolio-3f1a3` (production only)

**Approval scope:** The owner approved **preparing** the controlled change on 2026-10-11. This is **not** approval to update production Firebase, enable any service, deploy the Worker, deploy Rules/Hosting, or merge the draft PR. Separate explicit approval is required for each production operation.

**Current evidence (owner read-only Cloud Shell output, 2026-10-11):**

- `mfa.state = DISABLED`
- a TOTP `mfa.providerConfigs[]` entry has `state = ENABLED`
- Authentication Email/Password is enabled; the UI shows SMS MFA disabled.
- A production `authorizedAdministrators/{uid}` document has `active = true`, but independently matching that document's UID with the current sign-in identity is **not yet verified**.
- The prior read-only API call required `X-Goog-User-Project` to avoid a quota-project 403; adding that header yielded the read-only data above.
- A green candidate CI / staging runtime test is **not** proof of a working production MFA login.

## Intended change: exactly one field

Change `mfa.state` from `DISABLED` to `ENABLED` with an Identity Toolkit Admin v2 project-config PATCH **using the explicit `updateMask=mfa.state`**.

Do not use `MANDATORY`, do not enable SMS, do not re-enroll any user, and do not replace `mfa.providerConfigs` or other project authentication settings.

Reason: the Identity Platform API defines project MFA `DISABLED` as unusable, `ENABLED` as usable, and `MANDATORY` as forced. The TOTP provider currently being individually enabled is not sufficient while project MFA is disabled.

References:
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig
- https://docs.cloud.google.com/identity-platform/docs/reference/rpc/google.cloud.identitytoolkit.admin.v2
- https://docs.cloud.google.com/identity-platform/docs/admin/enabling-totp-mfa

## Release prerequisites — all required before write

1. Privately verify the Firebase Auth administrator UID corresponds to the existing **active** `authorizedAdministrators` document, the administrator email is verified, and working account access/recovery exists. **Do not publish UIDs, tokens, credentials, or TOTP secrets.**
2. Verify production Worker, service-account permissions, Identity Toolkit API, Recovery Key continuity, Firestore session enforcement, **Durable Object SECURITY_COORDINATOR readiness**, and rollback plan. Never assume the current production Worker can handle the new MFA requirement.
3. Confirm a tested rollback path / recovery access; no destructive reset or replacement of production security records.
4. Take a fresh **read-only** project MFA snapshot immediately before changing anything and inspect the complete MFA part (state, individual provider states, `enabledProviders`, TOTP tolerance), preserving the original state off-chat.
5. Obtain a **separate explicit production MFA change approval** with timing. Prefer a controlled coordinated release window; do not enable early while production login dependencies are unverified.

## Safe PRE-CHECK — read-only, allowed now

In the owner's authenticated Cloud Shell:

```bash
PROJECT=rolando-portfolio-3f1a3
curl -fsS \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: $PROJECT" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?fields=mfa" \
  | jq '{mfaState: .mfa.state, enabledProviders: .mfa.enabledProviders,
         totp: [.mfa.providerConfigs[]?
                  | select(.totpProviderConfig != null)
                  | {state, adjacentIntervals: .totpProviderConfig.adjacentIntervals}]}'
```

If the result differs from the verified baseline or displays an error, **STOP**. This command does not update settings or output bearer tokens.

## Proposed mutation — DO NOT EXECUTE without separate approval

The command below is documentation for a later, controlled release. **Not authorized in this preparation step.**

```bash
PROJECT=rolando-portfolio-3f1a3
curl --fail-with-body -sS -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: $PROJECT" \
  -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?updateMask=mfa.state" \
  -d '{"mfa":{"state":"ENABLED"}}' \
  | jq '{mfaState: .mfa.state, enabledProviders: .mfa.enabledProviders,
         totp: [.mfa.providerConfigs[]? | select(.totpProviderConfig != null) | .state]}'
```

### Post-write checks (only when later authorized)

- Re-run the read-only GET above; expected `mfaState=ENABLED`, TOTP still `ENABLED`; no new SMS provider.
- Confirm the current production Admin's password+TOTP sign-in is accepted server-side in a controlled session, and that a second-factor-free password-only sign-in cannot access protected Admin resources (unless the explicitly trusted device has its valid cryptographic proof).
- Verify active sessions, recovery safety, Security Activity, and unchanged public content. Failure to sign in is a **stop/rollback** event, not grounds to weaken Rules.

## Rollback — hold, do not run unless authorized

If changing `mfa.state` causes a confirmed production authentication regression and rollback is approved, PATCH **only** `mfa.state` back to the captured prechange `DISABLED` using the same `updateMask=mfa.state` and Google quota-project header; then recheck with GET. Rollback **can itself affect anyone who enrolled MFA after enabling**, so coordinate a login-safe window. Do not overwrite TOTP provider configs or downgrade Firestore session protections. If the project's initial state differs, stop rather than assuming DISABLED.

## Release gates

- [x] Candidate source CI: 159 Node / 10 Firestore emulator / 5 anonymous staging / 7 Worker runtime passed (PR #10)
- [x] Confirmed production administrator allowlist record active (identity match still pending)
- [x] Read-only production MFA state found: disabled project / enabled TOTP provider
- [ ] Identity and Worker/DO migration readiness confirmed
- [ ] Encrypted production deployment and rollback plan verified
- [ ] Separate production MFA change authorization
- [ ] Controlled mutation executed and **live runtime** validated
- [ ] Separate production deployment authorization and final ZIP release

**No changes have been made to production by preparing this plan.**
