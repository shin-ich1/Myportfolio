# LAN Portfolio CMS — guarded local password audit reconciliation.
# REVIEW ONLY. No credentials, Git commits, cloud writes or deployments.
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$patch = Join-Path $PSScriptRoot 'LAN_Password_Audit_Consistency_GUARDED_REVIEW.patch'
$expectedPatch = 'f6c53991d4a8bfd76f21e029232878d801f6dc78ec0e5de29b89ac080cb27fca'
$tracked = [ordered]@{
  'admin/js/settings-security.js' = '25985b151a980b0c35e11bdb0076b02b959d132e'
  'telemetry-worker/src/index.js' = '8f448f5178d5c8e7c390cf81219a1f8deef9cd53'
  'tests/security-step-up-runtime.test.mjs' = '02802bffa9fe2496beb8b20d3df58b4b20e21486'
}
$newTest = 'tests/security-password-audit-ui.test.mjs'
$backup = Join-Path $env:TEMP ('LAN-PASSWORD-AUDIT-BACKUP-' + [guid]::NewGuid().ToString('N'))
$applied = $false
$passed = $false

if (!(Test-Path -LiteralPath '.git') -or !(Test-Path -LiteralPath 'package.json')) {
  throw 'STOP: Open the correct Portfolio repository root before running.'
}
if (!(Test-Path -LiteralPath $patch -PathType Leaf)) { throw 'STOP: Review patch missing.' }
if ((Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedPatch) {
  throw 'STOP: Patch checksum mismatch.'
}
if (Test-Path -LiteralPath $newTest) { throw 'STOP: Target test already exists; manual review required.' }

foreach ($path in $tracked.Keys) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "STOP: Missing $path" }
  $hash = (& git hash-object --no-filters -- $path).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $hash -cne $tracked[$path]) {
    throw "STOP: Existing local source has changed since reviewed diff: $path"
  }
}

& git apply --check -- $patch
if ($LASTEXITCODE -ne 0) { throw 'STOP: Patch does not apply cleanly.' }

New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($path in $tracked.Keys) {
  $copy = Join-Path $backup ($path -replace '/', '__')
  Copy-Item -LiteralPath $path -Destination $copy -ErrorAction Stop
}

try {
  & git apply -- $patch
  if ($LASTEXITCODE -ne 0) { throw 'STOP: Git apply failed.' }
  $applied = $true
  foreach ($path in @('telemetry-worker/src/index.js','admin/js/settings-security.js', $newTest)) {
    & node --check $path
    if ($LASTEXITCODE -ne 0) { throw "STOP: JavaScript syntax failed: $path" }
  }
  # Re-run the previous consolidated release batch plus the new UI audit tests.
  $tests = @(
    'tests/admin-home-startup-requests.test.mjs',
    'tests/admin-pending-navigation-lifecycle.test.mjs',
    'tests/admin-settings-startup-requests.test.mjs',
    'tests/admin-shared-navigation-performance.test.mjs',
    'tests/admin-workspace-security-gate.test.mjs',
    'tests/public-message-atomicity.test.mjs',
    'tests/public-message-load-regression.test.mjs',
    'tests/public-messenger-conversation-lifecycle.test.mjs',
    'tests/public-turnstile-lifecycle-regression.test.mjs',
    'tests/public-turnstile-mobile-regression.test.mjs',
    'tests/settings-lazy-room-initialization.test.mjs',
    'tests/settings-telemetry-read-budget.test.mjs',
    'tests/production-candidate-contract.test.mjs',
    'tests/production-cutover-preflight.test.mjs',
    'tests/production-public-security-integration.test.mjs',
    'tests/security-access-live-read-budget.test.mjs',
    'tests/security-recovery-atomicity.test.mjs',
    'tests/security-step-up-runtime.test.mjs',
    'tests/security-password-audit-ui.test.mjs'
  )
  foreach ($t in $tests) {
    if (!(Test-Path -LiteralPath $t -PathType Leaf)) { throw "STOP: Missing test: $t" }
  }
  $log = Join-Path $env:TEMP 'LAN-Password-Audit-Review-Tests.log'
  & node --test --test-reporter=tap @tests > $log 2>&1
  $rc = $LASTEXITCODE
  Get-Content $log | Where-Object { $_ -match '^not ok \d+ - |^# (tests|pass|fail|skipped|cancelled) ' } |
    ForEach-Object { Write-Host $_ }
  if ($rc -ne 0) { throw "STOP: Security regression failed. Log: $log" }
  & git diff --check
  if ($LASTEXITCODE -ne 0) { throw 'STOP: Git diff integrity failed.' }
  $passed = $true
  Write-Host 'LOCAL CANONICAL AUDIT FIX: VERIFIED' -ForegroundColor Green
  Write-Host 'PRODUCTION AND STAGING: NOT DEPLOYED'
  Write-Host "ROLLBACK BACKUP: $backup"
} catch {
  if ($applied) {
    foreach ($path in $tracked.Keys) {
      Copy-Item -LiteralPath (Join-Path $backup ($path -replace '/', '__')) -Destination $path -Force
    }
    if (Test-Path -LiteralPath $newTest) { Remove-Item -LiteralPath $newTest -Force }
    Write-Host 'LOCAL REVIEW FILES RESTORED' -ForegroundColor Yellow
  }
  throw
}
