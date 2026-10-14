# LΛN Production Telemetry scope — READ ONLY. Never deploys, writes, or changes credentials.
# The sole purpose is to verify the pinned candidate and the existing LIVE
# Firebase Hosting version before a separate, explicitly approved deployment.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$message) { throw "STOP (no Production change): $message" }

$site = 'rolando-portfolio-3f1a3'
$expectedCandidate = 'e3aca64c4662ea99457b44855b035ffb0b20a305'
$expectedLiveSource = '717083f0d1504464ea4e275a9da4dd8f706ce179'
$expectedCommit = '86634280d799a01a2b480b20ccf79835841a1dc2'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('lan-production-readonly-'+[Guid]::NewGuid().ToString('N')+'.js')
$token = $null
$auth = $null

try {
  $head = (& git rev-parse HEAD).Trim()
  $blob = (& git rev-parse 'HEAD:admin/js/settings.js').Trim()
  if ($LASTEXITCODE -ne 0 -or $blob -ne $expectedCandidate) {
    Fail 'The local Settings source differs from the audited candidate.'
  }
  if (($head -ne $expectedCommit) -and ((& git merge-base --is-ancestor $expectedCommit HEAD; $LASTEXITCODE) -ne 0)) {
    Fail 'The audited candidate is not an ancestor of this source.'
  }
  if (@(& git status --porcelain --untracked-files=no).Count -gt 0) {
    Fail 'Local tracked source has uncommitted changes.'
  }
  Write-Host 'PASS: Correct GitHub candidate; clean tracked source.' -ForegroundColor Green

  & node --check 'admin/js/settings.js'
  if ($LASTEXITCODE -ne 0) { Fail 'Settings JavaScript syntax failed.' }
  & node --test 'tests/settings-telemetry-read-budget.test.mjs' 'tests/settings-lazy-room-initialization.test.mjs' 'tests/admin-settings-startup-requests.test.mjs'
  if ($LASTEXITCODE -ne 0) { Fail 'Settings read-budget regression tests failed.' }
  Write-Host 'PASS: Settings syntax and targeted regressions.' -ForegroundColor Green

  $gcloud = Get-Command gcloud.cmd -ErrorAction Stop
  $token = (& $gcloud.Source auth print-access-token 2>$null | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $token -notmatch '^[A-Za-z0-9_.-]{20,}$') { Fail 'Google Cloud authorization failed.' }
  $auth = @{ Authorization = "Bearer $token"; Accept = 'application/json' }
  $api = "https://firebasehosting.googleapis.com/v1beta1/sites/$site"
  $releases = Invoke-RestMethod -Uri "$api/releases?pageSize=1" -Headers $auth -Method GET -TimeoutSec 35
  $versionName = [string]$releases.releases[0].version.name
  if ($versionName -notmatch '^sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+$') {
    Fail 'Unexpected Production Hosting release.'
  }
  $version = Invoke-RestMethod -Uri "https://firebasehosting.googleapis.com/v1beta1/$versionName" -Headers $auth -Method GET -TimeoutSec 35
  if ($version.status -ne 'FINALIZED' -or !$version.config) { Fail 'Live Hosting version is not finalized with preserved config.' }
  Write-Host "PASS: Live Production Hosting version $versionName" -ForegroundColor Green

  # Verify that the version contains active expected assets. ACTIVE explicitly
  # selects uploaded files, not pending upload records.
  $paths = @{}
  $pageToken = ''
  do {
    $url = "https://firebasehosting.googleapis.com/v1beta1/$versionName/files?status=ACTIVE&pageSize=1000"
    if ($pageToken) { $url += '&pageToken='+[Uri]::EscapeDataString($pageToken) }
    $page = Invoke-RestMethod -Uri $url -Headers $auth -Method GET -TimeoutSec 35
    foreach ($file in @($page.files)) {
      if (!$file.path -or [string]$file.hash -notmatch '^[0-9a-f]{64}$') { Fail 'Invalid file manifest entry.' }
      if ($paths.ContainsKey([string]$file.path)) { Fail 'Duplicate Hosting path.' }
      $paths[[string]$file.path] = [string]$file.hash
    }
    $pageToken = [string]$page.nextPageToken
    if ($paths.Count -gt 50000) { Fail 'Unexpected Hosting manifest size.' }
  } while ($pageToken)
  if ($paths.Count -lt 30 -or !$paths.ContainsKey('/admin/js/settings.js') -or
      !$paths.ContainsKey('/admin/index.html') -or !$paths.ContainsKey('/index.html')) {
    Fail 'Live Hosting manifest does not include the expected static assets.'
  }
  Write-Host "PASS: $($paths.Count) ACTIVE Hosting files; existing routes preserved." -ForegroundColor Green

  $live = "https://$site.web.app/admin/js/settings.js"
  Invoke-WebRequest -Uri ($live + '?read_only_preflight=' + [Guid]::NewGuid().ToString('N')) -UseBasicParsing -OutFile $tmp -TimeoutSec 35 | Out-Null
  $bytes = [IO.File]::ReadAllBytes($tmp)
  if ($bytes.Length -lt 100000) { Fail 'Production Settings content is too short.' }
  $gitHeader = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)$([char]0)")
  $all = [byte[]]::new($gitHeader.Length+$bytes.Length)
  [Array]::Copy($gitHeader,0,$all,0,$gitHeader.Length)
  [Array]::Copy($bytes,0,$all,$gitHeader.Length,$bytes.Length)
  $sha = [Security.Cryptography.SHA1]::Create()
  try {
    $gitBlob = ([BitConverter]::ToString($sha.ComputeHash($all))).Replace('-','').ToLowerInvariant()
  } finally { $sha.Dispose() }
  if ($gitBlob -ne $expectedLiveSource) {
    Fail 'Actual live Settings source differs from the inspected legacy baseline. Review before patching.'
  }
  Write-Host 'PASS: Live Production Settings source matches audited old baseline.' -ForegroundColor Green
  Write-Host ''
  Write-Host 'READ-ONLY PREFLIGHT PASS. ZERO PRODUCTION CHANGES.' -ForegroundColor Green
  Write-Host 'Reviewed change scope: admin/js/settings.js ONLY.' -ForegroundColor Cyan
  Write-Host 'Do not run firebase deploy --only hosting from this branch; it would include other pending Security/UI files.' -ForegroundColor Yellow
} finally {
  $token = $null
  $auth = $null
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
