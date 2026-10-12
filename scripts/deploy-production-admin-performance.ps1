# Scoped LΛN Production Firebase Hosting release. three approved Admin JS files only.
# Never touches Cloudflare Worker, Firestore Rules, Firebase Auth/MFA, Recovery or Public assets.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$site='rolando-portfolio-3f1a3'
$api='https://firebasehosting.googleapis.com/v1beta1'
$assets=@(
  @{ Path='/admin/js/settings.js'; OldBlob='717083f0d1504464ea4e275a9da4dd8f706ce179'; NewBlob='e3aca64c4662ea99457b44855b035ffb0b20a305' },
  @{ Path='/admin/js/dashboard.js'; OldBlob='e5dc478bdace7833686c387c8c4f6023f5156d28'; NewBlob='72983ce53fa9888cd77cd4c50ee1376a980ad750' },
  @{ Path='/admin/js/home.js'; OldBlob='9b088be12133c1871f39bd46ce2db6664285d1b3'; NewBlob='398d6a7ee4db0c44e604f79cc6498c9798756440' }
)
if($assets.Count -ne 3){Stop-Lan 'Approved Admin file count changed.'}
$work=Join-Path ([IO.Path]::GetTempPath()) ('lan-three-file-'+[guid]::NewGuid().ToString('N'))
$auth=$null
$token=$null

function Stop-Lan([string]$message) { throw "STOP (not deployed): $message" }
function Api([string]$method,[string]$url,[object]$body=$null) {
  # The release script executes in a temporary child ScriptBlock scope. Use
  # its locally populated credentials, NEVER the parent session's $script:auth.
  # Refuse all calls until the local Google OAuth token has been validated.
  if($null -eq $auth -or !$auth.ContainsKey('Authorization') -or
      [string]::IsNullOrWhiteSpace([string]$auth.Authorization)){
    Stop-Lan 'Production API request attempted without authorized local headers.'
  }
  if ($null -eq $body) { return Invoke-RestMethod -Uri $url -Headers $auth -Method $method -TimeoutSec 40 }
  $json=ConvertTo-Json -InputObject $body -Compress -Depth 90
  return Invoke-RestMethod -Uri $url -Headers $auth -Method $method -ContentType 'application/json' -Body $json -TimeoutSec 40
}
function Live-Release {
  $r=Api GET "$api/sites/$site/channels/live/releases?pageSize=1"
  if (!$r.releases -or @($r.releases).Count -ne 1) { Stop-Lan 'Missing latest Production Hosting release.' }
  return $r.releases[0]
}
function Version-Files([string]$name) {
  $files=@{}
  $next=''; $pages=0
  do {
    $uri="$api/$name/files?status=ACTIVE&pageSize=1000"
    if ($next) { $uri+='&pageToken='+[uri]::EscapeDataString($next) }
    $page=Api GET $uri
    foreach($f in @($page.files)) {
      if ($null -eq $f) { continue }
      $p=[string]$f.path; $hash=[string]$f.hash
      if (!$p.StartsWith('/') -or $hash -notmatch '^[0-9a-f]{64}$' -or $files.ContainsKey($p)) { Stop-Lan 'Unsafe Hosting manifest.' }
      $files[$p]=$hash
    }
    $next=if($page.PSObject.Properties.Name -contains 'nextPageToken'){[string]$page.nextPageToken}else{''}
    $pages++
    if($pages -gt 100 -or $files.Count -gt 50000){Stop-Lan 'Unexpected manifest pagination.'}
  }while($next)
  return $files
}
function Git-Blob([byte[]]$bytes) {
  $prefix=[Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)$([char]0)")
  $all=[byte[]]::new($prefix.Length+$bytes.Length)
  [Array]::Copy($prefix,0,$all,0,$prefix.Length)
  [Array]::Copy($bytes,0,$all,$prefix.Length,$bytes.Length)
  $sha=[Security.Cryptography.SHA1]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($all))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
# Read exact canonical Git blob bytes, avoiding Windows CRLF checkout normalization.
# The allowlisted HEAD:path argument is never derived from untrusted input.
function Get-ApprovedGitBlobBytes([string]$relativePath) {
  if($relativePath -notin @('admin/js/settings.js','admin/js/dashboard.js','admin/js/home.js')) {
    Stop-Lan 'Unapproved Git blob path.'
  }
  $gitExe=(Get-Command git.exe -ErrorAction Stop).Source
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$gitExe
  $psi.Arguments='cat-file blob HEAD:'+$relativePath
  $psi.WorkingDirectory=(Get-Location).Path
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $process=[Diagnostics.Process]::Start($psi)
  if($null -eq $process){Stop-Lan 'Git blob reader could not start.'}
  $memory=[IO.MemoryStream]::new()
  try{
    # Never use a PowerShell pipeline for binary output: Windows PowerShell 5
    # will decode/re-encode stdout and can silently alter CRLF or UTF-8.
    $process.StandardOutput.BaseStream.CopyTo($memory)
    $message=$process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if($process.ExitCode -ne 0){Stop-Lan 'Canonical Git blob read failed; no deployment.'}
    return ,$memory.ToArray()
  }finally{
    $memory.Dispose()
    $process.Dispose()
  }
}

function Resolve-GoogleCloudAccessToken([object[]]$lines,[int]$exitCode) {
  if($exitCode -ne 0){Stop-Lan 'Google Cloud token command failed. Check gcloud account and active project.'}
  # RFC 6750 bearer alphabet includes + / ~ and optional trailing equals.
  # Ignore CLI informational lines; never print or log credential values.
  $matches=@($lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -cmatch '^[A-Za-z0-9._~+/-]{20,}={0,2}$' })
  if($matches.Count -ne 1){Stop-Lan 'No unique Google OAuth token found in CLI output. Nothing was deployed.'}
  return [string]$matches[0]
}

function Require-SameLiveRelease([string]$expected) {
  if([string](Live-Release).version.name -cne $expected){Stop-Lan 'Concurrent Production deploy detected; no release.'}
}

New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  if(@(& git status --porcelain --untracked-files=no).Count -gt 0){Stop-Lan 'Tracked local source has changes.'}
  $payloads=@{}
  foreach($asset in $assets) {
    $rel=$asset.Path.TrimStart('/')
    $sourceBlob=(& git rev-parse ('HEAD:'+$rel)).Trim()
    if($LASTEXITCODE -ne 0 -or $sourceBlob -cne $asset.NewBlob){Stop-Lan "Current Git source differs from approved file: $rel"}
    $sourcePath=Join-Path (Get-Location).Path ($rel.Replace('/',[IO.Path]::DirectorySeparatorChar))
    # Local Git status and HEAD blob SHA above guard against modified files.
    # Deploy exact canonical blob bytes rather than line-ending-converted checkout.
    $bytes=Get-ApprovedGitBlobBytes $rel
    if((Git-Blob $bytes) -cne $asset.NewBlob){Stop-Lan "Canonical Git blob bytes differ from approved source: $rel"}
    $verifiedSource=Join-Path $work ($rel.Replace('/','-')+'.js')
    [IO.File]::WriteAllBytes($verifiedSource,$bytes)
    & node --check $verifiedSource
    if($LASTEXITCODE -ne 0){Stop-Lan "JavaScript syntax check failed: $rel"}
    $payloads[$asset.Path]=$bytes
  }
  & node --test tests/settings-telemetry-read-budget.test.mjs tests/settings-lazy-room-initialization.test.mjs tests/admin-settings-startup-requests.test.mjs tests/admin-home-startup-requests.test.mjs tests/admin-shared-navigation-performance.test.mjs
  if($LASTEXITCODE -ne 0){Stop-Lan 'Admin page-performance tests failed.'}
  Write-Host 'PASS: Three pinned Admin files and page-loading tests.' -ForegroundColor Green

  # Consume the entire native gcloud stdout; Select-Object -First 1 can
  # terminate a native pipeline prematurely on Windows PowerShell.
  $gcloud=Get-Command gcloud.cmd -ErrorAction Stop
  $authLines=@(& $gcloud.Source auth print-access-token --quiet 2>$null)
  $gcloudExit=$LASTEXITCODE
  $token=Resolve-GoogleCloudAccessToken $authLines $gcloudExit
  # Google OAuth user credentials must explicitly attribute API quota to
  # the authorized Production project for Firebase Hosting REST.
  # This is a request-scoped header; no global credential, IAM or billing change.
  $auth=@{
    Authorization="Bearer $token"
    'X-Goog-User-Project'=$site
    Accept='application/json'
    'Cache-Control'='no-cache'
  }
  $original=[string](Live-Release).version.name
  if($original -notmatch '^sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+$'){Stop-Lan 'Wrong Production Hosting site/version.'}
  $version=Api GET "$api/$original"
  if([string]$version.status -cne 'FINALIZED' -or !$version.config){Stop-Lan 'Live Hosting serving config could not be preserved.'}
  $existing=Version-Files $original
  if($existing.Count -lt 30 -or !$existing.ContainsKey('/index.html') -or !$existing.ContainsKey('/admin/index.html')){Stop-Lan 'Live Hosting manifest incomplete.'}
  foreach($asset in $assets){if(!$existing.ContainsKey($asset.Path)){Stop-Lan "Live Admin asset missing: $($asset.Path)"}}
  $fileHashes=@{}; $compressedFiles=@{}
  foreach($asset in $assets){
    $livePath=Join-Path $work ($asset.Path.TrimStart('/').Replace('/','-')+'.live')
    Invoke-WebRequest -Uri ("https://$site.web.app$($asset.Path)?preflight="+[guid]::NewGuid().ToString('N')) -OutFile $livePath -UseBasicParsing -TimeoutSec 40 | Out-Null
    $actual=Git-Blob ([IO.File]::ReadAllBytes($livePath))
    if($actual -cne $asset.OldBlob){
      if($actual -ceq $asset.NewBlob){Stop-Lan "Asset already live: $($asset.Path); refuse mixed deployment."}
      Stop-Lan "Production differs from reviewed baseline: $($asset.Path)"
    }
    $zip=Join-Path $work ($asset.Path.TrimStart('/').Replace('/','-')+'.gz')
    $stream=[IO.File]::Create($zip)
    try{
      $gzip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionLevel]::Optimal,$true)
      try{$gzip.Write($payloads[$asset.Path],0,$payloads[$asset.Path].Length)}finally{$gzip.Dispose()}
    }finally{$stream.Dispose()}
    $hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if($hash -ceq $existing[$asset.Path]){Stop-Lan "Already identical Hosting asset: $($asset.Path)"}
    $fileHashes[$asset.Path]=$hash
    $compressedFiles[$hash]=$zip
  }
  Write-Host "PASS: $($existing.Count) current Hosting paths/config and approved old Admin sources inspected." -ForegroundColor Green
  Write-Host 'SCOPE: three Admin JS files (Settings, Dashboard, Home); Worker, MFA, Recovery, Rules, Public unchanged.' -ForegroundColor Yellow
  Require-SameLiveRelease $original
  $confirm=Read-Host 'Type DEPLOY-ADMIN-PERFORMANCE to publish THREE approved files (Enter cancels)'
  if($confirm -cne 'DEPLOY-ADMIN-PERFORMANCE'){Stop-Lan 'Deployment not authorized.'}
  Require-SameLiveRelease $original

  $created=Api POST "$api/sites/$site/versions" @{config=$version.config}
  $draft=[string]$created.name
  if($draft -notmatch '^sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+$'){Stop-Lan 'Invalid draft version name.'}
  $files=@{}
  foreach($p in $existing.Keys){$files[$p]=$existing[$p]}
  foreach($p in $fileHashes.Keys){$files[$p]=$fileHashes[$p]}
  $paths=@($files.Keys|Sort-Object)
  $required=@();$uploadUrl=''
  for($i=0;$i -lt $paths.Count;$i+=500){
    $batch=@{}
    for($j=$i;$j -lt [Math]::Min($i+500,$paths.Count);$j++){$batch[$paths[$j]]=$files[$paths[$j]]}
    $populated=Api POST ($api+'/'+$draft+':populateFiles') @{files=$batch}
    if($populated.PSObject.Properties.Name -contains 'uploadRequiredHashes'){$required+=@($populated.uploadRequiredHashes|Where-Object {$_})}
    if($populated.PSObject.Properties.Name -contains 'uploadUrl'){$uploadUrl=[string]$populated.uploadUrl}
  }
  $needed=@($required | Sort-Object -Unique)
  foreach($item in $needed){if(!$compressedFiles.ContainsKey($item)){Stop-Lan 'Unapproved file upload requested; draft NOT released.'}}
  if($needed.Count -gt $assets.Count){Stop-Lan 'Unexpected asset count; draft NOT released.'}
  if($needed.Count -gt 0){
    if($uploadUrl -notmatch '^https://upload-firebasehosting\.googleapis\.com/upload/sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+/files$'){Stop-Lan 'Unexpected Firebase upload location.'}
    foreach($item in $needed){
      Invoke-RestMethod -Uri ($uploadUrl+'/'+$item) -Method POST -Headers $auth -ContentType 'application/octet-stream' -InFile $compressedFiles[$item] -TimeoutSec 90 | Out-Null
    }
  }
  $draftFiles=Version-Files $draft
  if($draftFiles.Count -ne $files.Count){Stop-Lan 'Draft asset count mismatch; NOT released.'}
  foreach($p in $files.Keys){if(!$draftFiles.ContainsKey($p) -or $draftFiles[$p] -cne $files[$p]){Stop-Lan "Draft differs at path $p; NOT released."}}
  Require-SameLiveRelease $original
  $final=Api PATCH ($api+'/'+$draft+'?update_mask=status') @{status='FINALIZED'}
  if([string]$final.status -cne 'FINALIZED'){Stop-Lan 'Draft not finalized; NOT released.'}
  Require-SameLiveRelease $original
  $encoded=[uri]::EscapeDataString($draft)
  $release=Api POST ("$api/sites/$site/channels/live/releases?versionName="+$encoded)
  if([string]$release.version.name -cne $draft){Stop-Lan 'Release acknowledgement not confirmed. Check Hosting console before retrying.'}
  Write-Host 'PRODUCTION DEPLOY CONFIRMED: Firebase Hosting.' -ForegroundColor Green
  foreach($asset in $assets){Write-Host "UPDATED ADMIN FILE: $($asset.Path)" -ForegroundColor Green}
  Write-Host "ORIGINAL VERSION: $original"
  Write-Host "NEW VERSION: $draft"
  Write-Host 'Next: same trusted Chrome; verify Home, Dashboard, Settings, login and live reads. Quota may still need reset.' -ForegroundColor Cyan
} finally {
  $auth=$null;$token=$null
  if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}
