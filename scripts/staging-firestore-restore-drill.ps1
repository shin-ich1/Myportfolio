# STAGING ONLY: synthetic Firestore document create -> read -> delete -> restore -> read -> cleanup.
# Does NOT restore Firebase Auth/MFA, Cloudflare Durable Objects/KV, secrets, or Production.
# Never outputs Google access token or any Firestore response body.
param([switch]$ConfirmStagingWrite)
$ErrorActionPreference = 'Stop'
$project = 'lan-portfolio-staging'
$collection = 'lanSecurityRestoreDrills'
if (-not $ConfirmStagingWrite) {
  throw 'Staging-only writes require -ConfirmStagingWrite. No calls were made.'
}
$gcloud = Get-Command 'gcloud.cmd' -ErrorAction SilentlyContinue
if ($null -eq $gcloud) { throw 'gcloud.cmd not found. No calls were made.' }
$tokens = @(& $gcloud.Source auth print-access-token 2>$null)
if ($LASTEXITCODE -ne 0 -or $tokens.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$tokens[0])) {
  throw 'Authenticated gcloud token unavailable. No writes were made.'
}
$headers = @{
  Authorization = 'Bearer ' + [string]$tokens[0]
  'X-Goog-User-Project' = $project
  Accept = 'application/json'
}
$docId = 'lan-drill-' + [guid]::NewGuid().ToString('N')
$uri = 'https://firestore.googleapis.com/v1/projects/' + $project +
  '/databases/(default)/documents/' + $collection + '/' + $docId
$marker = [guid]::NewGuid().ToString('N')
$body = @{
  fields = @{
    stagingRestoreDrillMarker = @{ stringValue = $marker }
    stagingRestoreDrillScope = @{ stringValue = 'lan-portfolio-staging-only' }
  }
} | ConvertTo-Json -Depth 8 -Compress
$created = $false
$cleanupError = $null
$failure = $null
try {
  Write-Host 'Target: lan-portfolio-staging | isolated synthetic Firestore record'
  Write-Host 'Phase 1: Create and read test-only record...'
  $null = Invoke-RestMethod -Method PATCH -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30
  $created = $true
  $before = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers -TimeoutSec 30
  if ($before.fields.stagingRestoreDrillMarker.stringValue -cne $marker) {
    throw 'FAIL: staged test document was not read back intact.'
  }
  Write-Host 'PASS: synthetic record created and verified'
  Write-Host 'Phase 2: Delete test record and verify absence...'
  $null = Invoke-RestMethod -Method DELETE -Uri $uri -Headers $headers -TimeoutSec 30
  $created = $false
  $deleted = $false
  try {
    $null = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers -TimeoutSec 30
  } catch {
    $status = $null
    if ($null -ne $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 404) { $deleted = $true } else { throw }
  }
  if (-not $deleted) { throw 'FAIL: test record remains readable after delete.' }
  Write-Host 'PASS: synthetic record deleted'
  Write-Host 'Phase 3: Restore exact test document content and verify...'
  $null = Invoke-RestMethod -Method PATCH -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30
  $created = $true
  $after = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers -TimeoutSec 30
  if ($after.fields.stagingRestoreDrillMarker.stringValue -cne $marker -or
      $after.fields.stagingRestoreDrillScope.stringValue -cne 'lan-portfolio-staging-only') {
    throw 'FAIL: staging restore content differs from original marker.'
  }
  Write-Host 'PASS: synthetic staging Firestore restore verified'
} catch {
  $failure = $_.Exception.Message
} finally {
  # Leave no staging drill test record behind, even when a probe fails.
  try {
    $null = Invoke-RestMethod -Method DELETE -Uri $uri -Headers $headers -TimeoutSec 30
    Write-Host 'PASS: staging drill record cleanup'
  } catch {
    $status = $null
    if ($null -ne $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 404 -and -not $created) {
      Write-Host 'PASS: staging drill record already absent'
    } else {
      $cleanupError = 'HOLD: staging synthetic record cleanup may require manual inspection. Collection: ' + $collection + '; ID: ' + $docId
    }
  }
  Remove-Variable tokens, headers, body, marker -ErrorAction SilentlyContinue
}
if ($failure) { throw ('HOLD: Staging restore drill did not pass. ' + $failure) }
if ($cleanupError) { throw $cleanupError }
Write-Host 'PASS: STAGING synthetic Firestore create/delete/restore/cleanup. NO PRODUCTION WRITES.'
Write-Host 'NOT TESTED: Firebase Auth/MFA backup/restore, Cloudflare Durable Object/KV recovery, runtime secrets.'
