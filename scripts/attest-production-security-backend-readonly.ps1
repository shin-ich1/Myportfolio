# LΛN Production Security release attestation — READ-ONLY.
# No deployment, config mutation, session access, secret output, or recovery changes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$project = 'rolando-portfolio-3f1a3'
$workerName = 'lan-cloudinary-telemetry'
$expectedRulesBlob = '2b67f1322118e51b848f49fca24b986559c34a64'
$accessToken = $null
$headers = $null

function Stop-Release([string]$message) { throw "RELEASE HOLD (zero changes): $message" }
function Git-Blob([byte[]]$bytes) {
  $prefix = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)$([char]0)")
  $data = [byte[]]::new($prefix.Length + $bytes.Length)
  [Array]::Copy($prefix, 0, $data, 0, $prefix.Length)
  [Array]::Copy($bytes, 0, $data, $prefix.Length, $bytes.Length)
  $sha = [Security.Cryptography.SHA1]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($data))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

try {
  if (-not (Test-Path -LiteralPath 'firestore.rules' -PathType Leaf)) {
    Stop-Release 'Run from the reviewed GitHub release repository root.'
  }
  # Capture Git exit status before any PowerShell pipeline processing can
  # overwrite the native-command result. Keep the exact SHA match mandatory.
  $gitOutput = @(& git rev-parse --verify 'HEAD:firestore.rules' 2>$null)
  $gitExit = $LASTEXITCODE
  $headRules = if ($gitOutput.Count -eq 1) { [string]$gitOutput[0] } else { '' }
  $headRules = $headRules.Trim()
  if ($gitExit -ne 0 -or $headRules -cne $expectedRulesBlob) {
    $observed = if ($headRules -match '^[0-9a-f]{40}
  if (@(& git status --porcelain --untracked-files=no).Count -gt 0) {
    Stop-Release 'Tracked workspace is modified. Use a clean release worktree.'
  }

  $gcloud = Get-Command 'gcloud.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $gcloud) { Stop-Release 'gcloud.cmd is required for authorized READ-ONLY Firebase Rules inspection.' }
  $accessToken = [string](& $gcloud.Source auth print-access-token 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or $accessToken -notmatch '^[A-Za-z0-9_.-]{20,}$') {
    Stop-Release 'Google Cloud authorization is unavailable.'
  }
  $headers = @{Authorization = "Bearer $accessToken"; Accept = 'application/json'; 'X-Goog-User-Project' = $project}
  $rulesApi = 'https://firebaserules.googleapis.com/v1'
  try {
    $live = Invoke-RestMethod -Method GET -Uri "$rulesApi/projects/$project/releases/cloud.firestore" -Headers $headers -TimeoutSec 35
  } catch { Stop-Release 'Cannot read current Firebase Rules release with available authorization.' }
  $rulesetName = [string]$live.rulesetName
  if ($rulesetName -notmatch '^projects/rolando-portfolio-3f1a3/rulesets/[A-Za-z0-9_-]+$') {
    Stop-Release 'Firebase Rules release references an unexpected project or ruleset.'
  }
  try {
    $ruleset = Invoke-RestMethod -Method GET -Uri "$rulesApi/$rulesetName" -Headers $headers -TimeoutSec 35
  } catch { Stop-Release 'Cannot read selected deployed Firebase Ruleset source.' }
  $files = @($ruleset.source.files)
  if ($files.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$files[0].content)) {
    Stop-Release 'Unexpected number of deployed Firebase Rules source files.'
  }
  $normalized = ([string]$files[0].content).Replace("`r`n", "`n")
  $actual = Git-Blob ([Text.Encoding]::UTF8.GetBytes($normalized))
  if ($actual -cne $expectedRulesBlob) {
    Write-Host "FAIL: deployed Firestore Rules differs; expected $expectedRulesBlob ; observed $actual" -ForegroundColor Red
    Stop-Release 'Do not merge or deploy any Security changes until this discrepancy is reviewed.'
  }
  Write-Host "PASS: deployed Firestore Rules EXACT reviewed source hash $actual" -ForegroundColor Green

  # Cloudflare CLI metadata only: no secrets, raw response bodies, or deploy calls logged.
  $wrangler = Join-Path (Get-Location).Path 'telemetry-worker/node_modules/.bin/wrangler.cmd'
  if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) {
    Stop-Release 'Wrangler is missing. npm ci --prefix telemetry-worker (local install only) before this read-only check.'
  }
  $deployment = & $wrangler deployments status --name $workerName --json 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($deployment)) {
    Stop-Release 'Authorized Cloudflare deployment metadata is unavailable.'
  }
  try { $null = ConvertFrom-Json -InputObject $deployment -ErrorAction Stop }
  catch { Stop-Release 'Cloudflare deployment metadata was not valid JSON.' }
  $ids = [regex]::Matches($deployment, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b')
  if ($ids.Count -eq 0) { Stop-Release 'Cannot identify an active Cloudflare Worker deployment version.' }
  Write-Host "OBSERVED: Cloudflare Worker active deployment version $($ids[0].Value)" -ForegroundColor Cyan
  Write-Host 'NOTE: Version ID is metadata only. It does NOT prove Worker bundle/source equality.' -ForegroundColor Yellow
  Write-Host 'PASS: authenticated read-only backend metadata check completed. No Production writes.' -ForegroundColor Green
} finally {
  $accessToken = $null
  $headers = $null
}
) { $headRules } else { 'not-a-single-valid-Git-blob' }
    Stop-Release "Checked-out Rules blob mismatch. Expected $expectedRulesBlob; observed $observed; git exit $gitExit."
  }
  if (@(& git status --porcelain --untracked-files=no).Count -gt 0) {
    Stop-Release 'Tracked workspace is modified. Use a clean release worktree.'
  }

  $gcloud = Get-Command 'gcloud.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $gcloud) { Stop-Release 'gcloud.cmd is required for authorized READ-ONLY Firebase Rules inspection.' }
  $accessToken = [string](& $gcloud.Source auth print-access-token 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or $accessToken -notmatch '^[A-Za-z0-9_.-]{20,}$') {
    Stop-Release 'Google Cloud authorization is unavailable.'
  }
  $headers = @{Authorization = "Bearer $accessToken"; Accept = 'application/json'; 'X-Goog-User-Project' = $project}
  $rulesApi = 'https://firebaserules.googleapis.com/v1'
  try {
    $live = Invoke-RestMethod -Method GET -Uri "$rulesApi/projects/$project/releases/cloud.firestore" -Headers $headers -TimeoutSec 35
  } catch { Stop-Release 'Cannot read current Firebase Rules release with available authorization.' }
  $rulesetName = [string]$live.rulesetName
  if ($rulesetName -notmatch '^projects/rolando-portfolio-3f1a3/rulesets/[A-Za-z0-9_-]+$') {
    Stop-Release 'Firebase Rules release references an unexpected project or ruleset.'
  }
  try {
    $ruleset = Invoke-RestMethod -Method GET -Uri "$rulesApi/$rulesetName" -Headers $headers -TimeoutSec 35
  } catch { Stop-Release 'Cannot read selected deployed Firebase Ruleset source.' }
  $files = @($ruleset.source.files)
  if ($files.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$files[0].content)) {
    Stop-Release 'Unexpected number of deployed Firebase Rules source files.'
  }
  $normalized = ([string]$files[0].content).Replace("`r`n", "`n")
  $actual = Git-Blob ([Text.Encoding]::UTF8.GetBytes($normalized))
  if ($actual -cne $expectedRulesBlob) {
    Write-Host "FAIL: deployed Firestore Rules differs; expected $expectedRulesBlob ; observed $actual" -ForegroundColor Red
    Stop-Release 'Do not merge or deploy any Security changes until this discrepancy is reviewed.'
  }
  Write-Host "PASS: deployed Firestore Rules EXACT reviewed source hash $actual" -ForegroundColor Green

  # Cloudflare CLI metadata only: no secrets, raw response bodies, or deploy calls logged.
  $wrangler = Join-Path (Get-Location).Path 'telemetry-worker/node_modules/.bin/wrangler.cmd'
  if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) {
    Stop-Release 'Wrangler is missing. npm ci --prefix telemetry-worker (local install only) before this read-only check.'
  }
  $deployment = & $wrangler deployments status --name $workerName --json 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($deployment)) {
    Stop-Release 'Authorized Cloudflare deployment metadata is unavailable.'
  }
  try { $null = ConvertFrom-Json -InputObject $deployment -ErrorAction Stop }
  catch { Stop-Release 'Cloudflare deployment metadata was not valid JSON.' }
  $ids = [regex]::Matches($deployment, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b')
  if ($ids.Count -eq 0) { Stop-Release 'Cannot identify an active Cloudflare Worker deployment version.' }
  Write-Host "OBSERVED: Cloudflare Worker active deployment version $($ids[0].Value)" -ForegroundColor Cyan
  Write-Host 'NOTE: Version ID is metadata only. It does NOT prove Worker bundle/source equality.' -ForegroundColor Yellow
  Write-Host 'PASS: authenticated read-only backend metadata check completed. No Production writes.' -ForegroundColor Green
} finally {
  $accessToken = $null
  $headers = $null
}
