# Staging-only Public Message expired puzzle recovery — 31 October 2026

## Status
**Isolated source patch implemented and tested; NOT deployed to staging Firebase Hosting or LIVE.** This is a temporary backport of the same canonical PR #42 `app.js` expired-challenge correction onto the **exact historical staging frontend**. It is NOT a competing runtime module, Worker change, production merge or broader site upgrade.

## Baseline provenance and owner-provided evidence
- Repo: `shin-ich1/Myportfolio`.
- Historical October 14 staging frontend branch: `review/staging-ui-live-first-20261014`, current source commit `cce57823565f8e1214a4fc36af92ee3c97378fcb`.
- User downloaded `https://lan-portfolio-staging.web.app/app.js` on 2026-10-31 with read-only curl; `git hash-object` returned **`127feef273a51d450bf0d280b0d98bc648cd2bbf`**, exactly the historical branch's app.js Git blob.
- The new source from PR #42 differs from historical staging across roughly 200 tracked files, including Admin and design. **It was intentionally not deployed to staging.**
- Existing staging Worker `lan-portfolio-staging` already runs the prior approved PR #41 backend deployment at version `3ce74b38-2f4b-4db7-b18e-0d165b5e260b` with stage-only Firebase/KV/DO/Turnstile bindings. This patch does not touch Worker or its resources.

## Reproduction → fix
- Actual user video showed a server-rejected wrong slider, followed by expiry response `Verification puzzle expired. Load a new puzzle.`, while the old frontend could re-enable the invalid slider.
- Canonical server coordinator rejects expired puzzle with HTTP **410 `message-puzzle-expired`** and deletes its record. Existing `message-service.js` already propagates both status and code.
- Original historical frontend's single `loadPublicMessagePuzzleChallenge` catch block resets Turnstile and **unconditionally enables slider**, including on terminal expiry.
- Two new real-controller regression tests intentionally **failed** on the exact historical source: see [expected red](https://github.com/shin-ich1/Myportfolio/actions/runs/41178170256). Initial full-suite run also had unrelated missing Firestore emulator dependencies and shallow Git history; that initial run is not a valid full-suite baseline.
- The staging-only `app.js` correction checks **HTTP 410 plus exact server code**, clears the invalid challenge, disables the slider, resets the current short-lived browser proof and invokes the **existing canonical** challenge loader. The new loader enables the slider only on a real prepared challenge. If the replacement fails, slider remains disabled.
- Wrong-answer retry with new geometry, third-attempt replacement, recoverable network error retry, and server-minted proof requirement are retained. No server, admin, layout, CSS, or image changes.

## Tests and audit
- Final isolated GitHub run: https://github.com/shin-ich1/Myportfolio/actions/runs/41178386718
- **19/19 targeted** expired-puzzle, messaging atomicity, Public-load, audited-source security tests passed.
- **247/247 non-emulator Node tests** passed across 42 files (including targeted tests); zero failures.
- `node --check app.js` passed.
- **Not run:** the two full Firestore emulator-only suites, requiring Firebase emulator, runtime dependencies and isolated demo project. They were explicitly omitted from this CI job, not deleted or weakened.
- Two existing *exact blob fingerprint* guards were updated to the **same reviewed new app.js SHA `5cad8585b26e41f6020e396b12707a8786a1db0b`**. All other pinned file SHA values and all outside-function comparisons remain unchanged. This accommodates a formally authorized correction within the permitted canonical Public Message owner; security guards remain strict.
- Source diff from historical staging baseline must remain limited to `app.js`, `tests/public-message-expired-puzzle-recovery.test.mjs`, exact-hash re-pins in `tests/production-public-security-integration.test.mjs` and `tests/production-candidate-contract.test.mjs`, the staging-only **NO DEPLOY** CI workflow and this report. No config, Firestore rule, Admin or production-hosting changes.

## Release gates / unresolved
1. **Before ANY staging Hosting deployment**, verify the full existing staged asset manifest / Hosting release baseline; matching `app.js` alone does not prove all other staging files match the historical branch. Use the historical tracked-only staging builder `scripts/prepare-staging.mjs` and staging-only Firebase config; never `firebase deploy` directly from the source root, because `.firebaserc` defaults to LIVE `rolando-portfolio-3f1a3`.
2. Publish only to `lan-portfolio-staging` with separate explicit staging Hosting deployment approval. Reconfirm complete prepared-site diff (not just `app.js`), preserve version history for rollback and do not change Firestore Rules or Worker.
3. Interactive staging browser verification: deliberately fail puzzle, test HTTP 410 expired replacement and blocked slider during reload failure, retry and 3-attempt rotation, Turnstile and valid message send / Admin receipt on staging.
4. This backport is an **isolated staging adaptation**, not the canonical long-term PR #42 release baseline. Do not overwrite newer LIVE source; separately rebase/verify production merge and obtain owner deployment approval.
5. Existing emergency landscape fallback variety issue is **separate and unresolved**.

**No claim that the LIVE portfolio's issue is fixed.**
