$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Execute the EXACT production token parser without touching Google Cloud.
# All test values below are synthetic and are never valid credentials.
$path=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/deploy-production-admin-performance.ps1'
$source=Get-Content -LiteralPath $path -Raw -Encoding UTF8
$begin=$source.IndexOf('function Resolve-GoogleCloudAccessToken(')
$end=$source.IndexOf('function Require-SameLiveRelease(', $begin)
if($begin -lt 0 -or $end -le $begin){throw 'Production OAuth parser owner not found.'}
function Stop-Lan([string]$message){throw "STOP: $message"}
. ([ScriptBlock]::Create($source.Substring($begin,$end-$begin)))

$sample=('ya29.'+('A'*42)+'/+~_=')
$result=Resolve-GoogleCloudAccessToken @('INFO: CLI initialized', $sample) 0
if($result -cne $sample){throw 'Valid token was not selected from mixed native CLI output.'}
$badCases=@(
  @{ Lines=@(); Exit=0 },
  @{ Lines=@('invalid'); Exit=0 },
  @{ Lines=@($sample); Exit=1 },
  @{ Lines=@($sample,$sample); Exit=0 }
)
foreach($item in $badCases){
  $rejected=$false
  try{$null=Resolve-GoogleCloudAccessToken $item.Lines $item.Exit}catch{$rejected=$true}
  if(-not $rejected){throw 'Invalid or ambiguous OAuth token input was not rejected.'}
}
Write-Host 'PASS: Production Google OAuth token parser (synthetic credentials only).' -ForegroundColor Green
