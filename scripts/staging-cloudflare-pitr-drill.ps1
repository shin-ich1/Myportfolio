# Staging-only disposable Worker & SQLite DO PITR rehearsal.
# Never references current CMS Workers, production secrets, Firebase or KV.
param([switch]$ApprovedIsolatedDeploy)
$ErrorActionPreference = 'Stop'
if (-not $ApprovedIsolatedDeploy) { throw 'Requires -ApprovedIsolatedDeploy.' }
$root = Split-Path -Parent $PSScriptRoot
$tests = Join-Path $root 'tests'
$wrangler = Join-Path $root 'telemetry-worker\node_modules\.bin\wrangler.cmd'
if (-not (Test-Path $wrangler)) {
  & npm.cmd ci --prefix (Join-Path $root 'telemetry-worker') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Pinned Wrangler install failed.' }
}
if (-not (Test-Path $wrangler)) { throw 'Wrangler unavailable.' }
$fixture = Join-Path $tests 'cloudflare-isolated-pitr-drill-worker.mjs'
$base = Join-Path $tests 'cloudflare-isolated-pitr-drill-wrangler.jsonc'
$cleanupBase = Join-Path $tests 'cloudflare-isolated-pitr-drill-cleanup.jsonc'
$retired = Join-Path $tests 'cloudflare-isolated-pitr-drill-retired.mjs'
foreach ($p in @($fixture,$base,$cleanupBase,$retired)) {
  if (-not (Test-Path $p)) { throw 'Missing isolated drill file. Run git pull first.' }
}
& node.exe --check $fixture
if ($LASTEXITCODE -ne 0) { throw 'Test fixture syntax failed.' }
$name = 'lan-dr-pitr-' + ([guid]::NewGuid().ToString('N').Substring(0,16))
if ($name -notmatch '^lan-dr-pitr-[0-9a-f]{16}$') { throw 'Invalid test-only Worker name.' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('lan-pitr-test-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
$liveCfg = Join-Path $temp 'wrangler.jsonc'
$cleanupCfg = Join-Path $temp 'cleanup.jsonc'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$deployed=$false; $passed=$false; $cleaned=$false; $failure=''; $stage='preflight'
try {
  [IO.File]::Copy($fixture,(Join-Path $temp 'cloudflare-isolated-pitr-drill-worker.mjs'))
  [IO.File]::Copy($retired,(Join-Path $temp 'cloudflare-isolated-pitr-drill-retired.mjs'))
  foreach ($pair in @(@($base,$liveCfg),@($cleanupBase,$cleanupCfg))) {
    $raw=[IO.File]::ReadAllText($pair[0])
    if ($raw -notlike '*lan-dr-pitr-test-20261015*') { throw 'Test name mismatch.' }
    if ($raw -match 'lan-cloudinary-telemetry|lan-portfolio-staging|rolando-portfolio-3f1a3|STORAGE_OAUTH|PORTFOLIO_MESSAGES') {
      throw 'Forbidden shared CMS binding.' 
    }
    [IO.File]::WriteAllText($pair[1],$raw.Replace('lan-dr-pitr-test-20261015',$name),$utf8)
  }
  $stage='dry-run'
  & $wrangler deploy --dry-run --config $liveCfg | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Dry-run failed.' }
  Write-Host 'PASS: test-only Worker dry-run; no CMS bindings.'
  $stage='deploy'
  Write-Host "Deploying new disposable Worker $name"
  # Use Wrangler's actual deployed URL; avoid guessing the account's workers.dev subdomain.
  $deployOutput=@(& $wrangler deploy --config $liveCfg 2>&1 | ForEach-Object { [string]$_ })
  if ($LASTEXITCODE -ne 0) { throw 'Isolated deploy failed; check test Worker name.' }
  $deployed=$true
  $deployText=$deployOutput -join [Environment]::NewLine
  $urlMatch=[regex]::Match($deployText,'https://(?<worker>[a-z0-9-]+)\.(?<subdomain>[a-z0-9-]+)\.workers\.dev(?:/|\s|$)','IgnoreCase')
  if (-not $urlMatch.Success -or $urlMatch.Groups['worker'].Value -cne $name) {
    throw 'Wrangler did not confirm the exact disposable workers.dev URL; refusing to guess endpoint.'
  }
  $baseUri='https://'+$urlMatch.Groups['worker'].Value+'.'+$urlMatch.Groups['subdomain'].Value+'.workers.dev'
  Write-Host "Deployed test-only Worker at $baseUri"
  $uri="$baseUri/drill"
  $stage='pre-secret-route'
  # The fixture always returns 401 without PITR_TEST_TOKEN.
  # This isolates first-deploy routing from any subsequent secret update.
  $initialRouteStatus=0
  for ($routeAttempt=1;$routeAttempt -le 12;$routeAttempt++) {
    try {
      $response=Invoke-WebRequest -Uri $uri -Method POST -Body '{}' -ContentType 'application/json' -TimeoutSec 12 -UseBasicParsing
      $initialRouteStatus=[int]$response.StatusCode
    } catch {
      $initialRouteStatus=0
      if ($_.Exception.Response) { $initialRouteStatus=[int]$_.Exception.Response.StatusCode }
    }
    if ($initialRouteStatus -eq 401) { break }
    if ($initialRouteStatus -ne 404 -and $initialRouteStatus -ne 503) {
      throw "Unexpected first-deploy route status: HTTP $initialRouteStatus."
    }
    if ($routeAttempt -lt 12) { Start-Sleep -Seconds 2 }
  }
  if ($initialRouteStatus -ne 401) {
    throw "INITIAL_DEPLOY_ROUTE_404: Worker deployed but direct workers.dev route returned HTTP $initialRouteStatus BEFORE any secret update. Check per-script workers.dev enabled flag; not a PITR failure."
  }
  Write-Host 'PASS: first-deploy Workers.dev route serves isolated test Worker (401 before secret).'
  $stage='temporary-auth'
  $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes=New-Object byte[] 32
  $rng.GetBytes($bytes); $rng.Dispose()
  $token=[Convert]::ToBase64String($bytes)
  # Use Wrangler's supported --secrets-file path, NOT a PowerShell pipeline.
  # Windows PowerShell's native-command stdin encoding/line endings can alter
  # the exact value consumed by "secret put" compared with our HTTP header.
  # This ephemeral test-only token is written only inside the random OS temp
  # directory and wiped with it in finally; never printed or sent to GitHub.
  $ephemeralSecrets=Join-Path $temp 'disposable-drill-secrets.json'
  $jsonSecrets=@{ PITR_TEST_TOKEN=$token } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($ephemeralSecrets,$jsonSecrets,$utf8)
  Remove-Variable jsonSecrets -ErrorAction SilentlyContinue
  # Code + secret atomically join the same isolated Worker deployment.
  & $wrangler deploy --config $liveCfg --secrets-file $ephemeralSecrets | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Test-only Worker redeploy with ephemeral secret failed.' }
  $stage='secret-binding-metadata'
  # Metadata check lists NAMES only, never secret values.
  $listedSecrets=@(& $wrangler secret list --config $liveCfg 2>&1 | ForEach-Object { [string]$_ })
  if ($LASTEXITCODE -ne 0 -or ($listedSecrets -join ' ') -notmatch 'PITR_TEST_TOKEN') {
    throw 'Disposable Worker secret NAME not found after deployment.'
  }
  Write-Host 'PASS: isolated Worker secret name present; secret value never logged.'
  Remove-Variable listedSecrets -ErrorAction SilentlyContinue
  $headers=@{ Authorization="Bearer $token" }
  function Invoke-Drill([string]$action,[string]$bookmark='') {
    $body=@{action=$action;bookmark=$bookmark}|ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 25
  }
  $stage='anonymous-denial'
  $denied=$false
  $lastHttpStatus=0
  # Wait for propagation of the isolated route and its ephemeral secret.
  # Do not treat a transient 404 as passing the authentication test.
  for ($attempt=1;$attempt -le 20;$attempt++) {
    try {
      $null=Invoke-RestMethod -Uri $uri -Method POST -Body '{}' -ContentType 'application/json' -TimeoutSec 15
      throw 'Unauthenticated request unexpectedly succeeded.'
    } catch {
      $lastHttpStatus=0
      if ($_.Exception.Response) { $lastHttpStatus=[int]$_.Exception.Response.StatusCode }
      if ($lastHttpStatus -eq 401) { $denied=$true;break }
      if ($lastHttpStatus -ne 404 -and $lastHttpStatus -ne 503) {
        throw "Unexpected isolated Worker auth HTTP $lastHttpStatus."
      }
    }
    if ($attempt -lt 20) { Start-Sleep -Seconds 3 }
  }
  if (-not $denied) { throw "Isolated Worker never served its auth gate; last HTTP $lastHttpStatus." }
  Write-Host 'PASS: disposable Worker denied anonymous request (401).'
  $stage='baseline-and-mutate'
  $before=Invoke-Drill 'baseline'
  if ($before.marker -cne 'before' -or [string]::IsNullOrEmpty($before.bookmark)) { throw 'No baseline bookmark.' }
  $after=Invoke-Drill 'mutate'
  if ($after.marker -cne 'after') { throw 'Mutation not persisted.' }
  Write-Host 'PASS: disposable SQLite DO baseline and mutation.'
  $stage='PITR'
  try { $null=Invoke-Drill 'restore' $before.bookmark } catch { }
  $stage='restore-confirmation'
  for($i=0;$i -lt 12;$i++){
    Start-Sleep -Seconds 2
    try { if ((Invoke-Drill 'state').marker -ceq 'before') { $passed=$true;break } } catch { }
  }
  if (-not $passed) { throw 'Restored state was not observed.' }
  Write-Host 'PASS: isolated SQLite DO point-in-time restore verified.'
} catch {
  $failure=('{0}: {1}' -f $stage,$_.Exception.Message)
} finally {
  if($deployed){
    try {
      $stage='retire-disposable-namespace'
      & $wrangler deploy --config $cleanupCfg | Out-Null
      if($LASTEXITCODE -ne 0){throw 'Disposable class deletion failed.'}
      Write-Host 'PASS: disposable DO namespace retired.'
      $stage='delete-disposable-worker'
      & $wrangler delete --config $cleanupCfg --name $name --force | Out-Null
      if($LASTEXITCODE -ne 0){throw 'Disposable Worker deletion failed.'}
      $cleaned=$true
      Write-Host 'PASS: disposable Worker deleted.'
    }catch{
      Write-Host "HOLD: check/delete TEST ONLY Worker $name ($stage)." -ForegroundColor Red
    }
  }elseif($stage -eq 'deploy'){
    Write-Host "HOLD: possible partial deploy; check TEST ONLY Worker $name." -ForegroundColor Red
  }
  Remove-Variable token,headers,bytes -ErrorAction SilentlyContinue
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
if($failure){ Write-Host "HOLD: $failure" -ForegroundColor Red }
if(-not $passed -or -not $cleaned){throw 'HOLD: isolated PITR or cleanup failed. Production unchanged.'}
Write-Host 'PASS: ISOLATED CLOUDFLARE SQLITE PITR + CLEANUP. NO PRODUCTION WRITES.'
Write-Host 'NOT TESTED: existing Production DO/KV, Firebase Auth/MFA, runtime secrets.'
