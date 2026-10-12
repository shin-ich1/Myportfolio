$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Exercise the exact release-script classifier using SYNTHETIC bytes only.
# No Google/Firebase credentials or Production requests are made.
# The guarded release runs this test as an inline ScriptBlock, where
# $PSScriptRoot is empty. Both standalone -File and inline execution use
# the repository-root working directory required by the release script.
$path=Join-Path (Get-Location).Path 'scripts/deploy-production-security-admin.ps1'
if(-not (Test-Path -LiteralPath $path -PathType Leaf)){
  throw 'STOP: Production security tests must run from the repository root.'
}
$source=Get-Content -LiteralPath $path -Raw -Encoding UTF8
$start=$source.IndexOf('function Git-Blob(')
$end=$source.IndexOf('# Read exact canonical Git blob bytes', $start)
if($start -lt 0 -or $end -le $start){throw 'Approved baseline verifier was not found.'}
function Stop-Lan([string]$message){throw ('STOP (not deployed): '+$message)}
. ([ScriptBlock]::Create($source.Substring($start,$end-$start)))

$utf8=[Text.UTF8Encoding]::new($false,$true)
$plain=(@('/* approved UI */','const title = "LΛN";','') -join "`n")
$baseline=[byte[]]$utf8.GetBytes($plain)
$expected=Git-Blob $baseline
$converted=[byte[]]$utf8.GetBytes($plain.Replace("`n","`r`n"))
if((Git-Blob $converted) -ceq $expected){throw 'Fixture failed to distinguish CRLF from LF bytes.'}
if((Assert-ReviewedLiveAdminBaseline $baseline $expected '/admin/js/admin-ui.js') -cne 'exact'){throw 'Exact approved baseline rejected.'}
if((Assert-ReviewedLiveAdminBaseline $converted $expected '/admin/js/admin-ui.js') -cne 'strict-crlf'){throw 'Pure CRLF equivalent rejected.'}

function Assert-Rejected([byte[]]$value,[string]$description){
  $stopped=$false
  try{$null=Assert-ReviewedLiveAdminBaseline $value $expected '/admin/js/admin-ui.js'}
  catch{$stopped=$_.Exception.Message -match 'Production differs from reviewed baseline'}
  if(-not $stopped){throw ('Fail-closed regression: '+$description)}
}
Assert-Rejected ([byte[]]$utf8.GetBytes('const wrong = true;')) 'modified LF code'
Assert-Rejected ([byte[]]$utf8.GetBytes(($plain+'const wrong = true;').Replace("`n","`r`n"))) 'modified CRLF code'
Assert-Rejected ([byte[]]$utf8.GetBytes("first`r`nsecond`n")) 'mixed newline styles'
Assert-Rejected ([byte[]]$utf8.GetBytes("first`rsecond`r`n")) 'standalone carriage return'
Assert-Rejected ([byte[]](0xC3,0x28,0x0D,0x0A)) 'invalid UTF-8'
Assert-Rejected ([byte[]]$utf8.GetBytes('one line without CRLF')) 'unrelated one-line file'

Write-Host 'PASS: Production baseline accepts exact LF/strict CRLF only; drift and unsafe encodings denied.' -ForegroundColor Green
