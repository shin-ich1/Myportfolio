$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Run the real API handler inside the SAME child ScriptBlock scope used by
# the production operator, with only fake credentials and fake REST responses.
# Neither gcloud nor the Firebase Hosting network can be accessed by this test.
$releaseScript = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/deploy-production-admin-performance.ps1') -Raw -Encoding UTF8
$start = $releaseScript.IndexOf('function Api(')
$end = $releaseScript.IndexOf('function Live-Release {', $start)
if ($start -lt 0 -or $end -le $start) { throw 'Canonical Hosting API owner missing.' }
$apiSource = $releaseScript.Substring($start, $end-$start)

$setup = @'
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$auth=$null
$site='rolando-portfolio-3f1a3'
function Stop-Lan([string]$message){throw ("STOP: "+$message)}
function Invoke-RestMethod {
  param([string]$Uri,[hashtable]$Headers,[string]$Method,[int]$TimeoutSec,[string]$ContentType,[string]$Body)
  if ($Uri -ne 'https://testing.invalid/hosting') {throw 'Unexpected network destination.'}
  if ($Headers.Authorization -cne 'Bearer SYNTHETIC_ACCESS_TOKEN_1234567890') {throw 'Missing local synthetic authorization.'}
  if ($Headers['X-Goog-User-Project'] -cne 'rolando-portfolio-3f1a3') {throw 'Missing required Production quota attribution.'}
  if ($Method -ceq 'POST' -and ($Body | ConvertFrom-Json).health -cne 'check') {throw 'POST request body incorrect.'}
  return [pscustomobject]@{method=$Method;checked=$true}
}
'@
$checks = @'
$rejected = $false
try { $null = Api GET 'https://testing.invalid/hosting' }
catch { $rejected = $_.Exception.Message -match 'without authorized local headers' }
if (!$rejected) { throw 'Unauthenticated API request was not blocked.' }

$auth = @{Authorization='Bearer SYNTHETIC_ACCESS_TOKEN_1234567890';Accept='application/json'}
$missingQuotaRejected=$false
try { $null=Api GET 'https://testing.invalid/hosting' }
catch { $missingQuotaRejected=$_.Exception.Message -match 'quota project' }
if(!$missingQuotaRejected){throw 'Missing quota project must fail closed.'}
$auth['X-Goog-User-Project']='lan-portfolio-staging'
$wrongQuotaRejected=$false
try { $null=Api GET 'https://testing.invalid/hosting' }
catch { $wrongQuotaRejected=$_.Exception.Message -match 'quota project' }
if(!$wrongQuotaRejected){throw 'Staging quota project must fail closed.'}
$auth['X-Goog-User-Project']=$site
$get = Api GET 'https://testing.invalid/hosting'
$post = Api POST 'https://testing.invalid/hosting' @{health='check'}
if (!$get.checked -or $get.method -cne 'GET' -or
    !$post.checked -or $post.method -cne 'POST') {
  throw 'Canonical Hosting GET/POST did not use child-scope authorization.'
}
'@
& ([ScriptBlock]::Create($setup + [Environment]::NewLine + $apiSource + [Environment]::NewLine + $checks))
Write-Host 'PASS: Hosting GET/POST API caller uses local-only OAuth headers, fail-closed.' -ForegroundColor Green
