# LAN Portfolio — False Retry Prompt During Valid Slow Startup

Date: 2026-11-12 (Asia/Manila)
Repository: shin-ich1/Myportfolio
Canonical parent baseline: perf/startup-network-priority-20261111, commit 10c4bd64d0adb6bd0dad4553a133b34ab06624c5
Isolated branch: fix/loader-progress-stall-20261112
Status: Implemented and automated regression-verified; not hosted runtime verified; no LIVE changes.

## Confirmed behavior and root cause

The owner provided a phone screenshot of the startup-network Firebase preview displaying "The portfolio is taking longer to load" and "Retry loading." The owner confirmed the portfolio subsequently opens *without pressing Retry*. Inspection of index.html shows a fixed 7,000 ms callback that displays both the failure-like text and retry control whenever the loader is still visible. That callback does not inspect any failed network or startup state and therefore treats a legitimate slow load as a failure-like condition.

Separately, app.js initFirebase uses a 15-second startup deadline, and the emergency fallback may take additional time. This investigation does not establish that those paths failed or that this change accelerates startup.

## Minimal canonical source change

- index.html: leave the one existing loader owner and its existing click listener in place. At 7 seconds, show neutral progress ("Still loading portfolio…") but no Retry button. A separate 35-second stall watchdog within that same owner offers the optional manual Retry, using the existing reload handler. Both callbacks first check whether the canonical loader has already been hidden; a successfully rendered portfolio stays hidden.
- tests/public-loader-progress-regression.test.mjs: execute the actual inline script under deterministic mocked timers/DOM; assert pending 7-second progress, 35-second optional recovery, successful completion suppression, and one unchanged reload event handler.
- .github/workflows/public-loader-regression-no-deploy.yml: run failing-first regression, full tests, syntax, protected diff scope audit and package source artifact. No deploy action.
- release-reports/public-loader-progress-20261112.md: this report.

No changes to app.js rendering, Firestore query policy, Cloudflare Worker, server security, Admin, Firebase settings, media delivery, CSS, animations, breakpoints, or content.

## Regression-first evidence

- Before index.html source change: GitHub Actions run 43121819668 showed **1/4 new tests passed; 3/4 failed**. These failures reproduced the premature 7-second retry and missing stalled-versus-successful behavior.
- After canonical fix: run 43121921373 passed **4/4 new tests** and **203/203 complete repository tests**, 0 failures, 0 skipped.
- JavaScript syntax checks: passed.
- Changed-file and security scope audit against 10c4bd64: passed.
- One source archive package: passed.

## Verification boundaries and risks

- The retry is intentionally user initiated; no automatic re-fetch or reload is introduced.
- A 35-second timeout is a prolonged *stall indicator*, not proof that Firebase has failed. A very slow request may still finish after 35 seconds, and a user may optionally retry.
- No claimed improvement in actual time-to-Hero, loader-hide, remote requests, or international PageSpeed, because the source has not undergone a new hosted runtime comparison.
- The previous PR #71 startup-network candidate itself is not independently verified for the reported phone scenario or globally.
- Testing required before production: preview-only deployment (separate authorization), phone Safari/Chrome and desktop/wide/compact cold reloads, confirm loader clears on completion and retry only displays after 35 seconds if stalled; check browser console and network errors, actual content and interactions; no LIVE deployment without owner approval.

**Release status: implemented and automated-tested, not runtime-verified.** No production deployment, merge, hosting configuration, user-data or security change was performed.
