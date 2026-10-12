# Scoped LΛN Production Firebase Hosting release. ONLY /admin/js/settings.js changes.
# Never touches Cloudflare Worker, Firestore Rules, Firebase Auth/MFA, Recovery or Public assets.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$site='rolando-portfolio-3f1a3'
$api='https://firebasehosting.googleapis.com/v1beta1'
$target='/admin/js/settings.js'
$oldBlob='717083f0d1504464ea4e275a9da4dd8f706ce179'
$newBlob='e3aca64c4662ea99457b44855b035ffb0b20a305'
$work=Join-Path ([IO.Path]::GetTempPath()) ('lan-one-file-'+[guid]::NewGuid().ToString('N'))
$auth=$null
$token=$null

function Stop-Lan([string]$message) { throw "STOP (not deployed): $message" }
function Api([string]$method,[string]$url,[object]$body=$null) {
  if ($null -eq $body) { return Invoke-RestMethod -Uri $url -Headers $script:auth -Method $method -TimeoutSec 40 }
  $json=ConvertTo-Json -InputObject $body -Compress -Depth 90
  return Invoke-RestMethod -Uri $url -Headers $script:auth -Method $method -ContentType 'application/json' -Body $json -TimeoutSec 40
}
function Live-Release {
  $r=Api GET "$api/sites/$site/releases?pageSize=1"
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
function Require-SameLiveRelease([string]$expected) {
  if([string](Live-Release).version.name -cne $expected){Stop-Lan 'Concurrent Production deploy detected; no release.'}
}

New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  $sourceBlob=(& git rev-parse 'HEAD:admin/js/settings.js').Trim()
  if($LASTEXITCODE -ne 0 -or $sourceBlob -cne $newBlob){Stop-Lan 'Current branch is not pinned to approved Telemetry Settings source.'}
  if(@(& git status --porcelain --untracked-files=no).Count -gt 0){Stop-Lan 'Tracked local source has changes.'}
  $sourcePath=Join-Path (Get-Location).Path 'admin/js/settings.js'
  $candidate=[IO.File]::ReadAllBytes($sourcePath)
  if((Git-Blob $candidate) -cne $newBlob){Stop-Lan 'Checked-out source bytes do not match reviewed Git content.'}
  & node --check $sourcePath
  if($LASTEXITCODE -ne 0){Stop-Lan 'Settings JavaScript syntax check failed.'}
  & node --test tests/settings-telemetry-read-budget.test.mjs tests/settings-lazy-room-initialization.test.mjs tests/admin-settings-startup-requests.test.mjs
  if($LASTEXITCODE -ne 0){Stop-Lan 'Telemetry regression tests failed.'}
  Write-Host 'PASS: Pinned Telemetry source and local regression tests.' -ForegroundColor Green

  $gcloud=Get-Command gcloud.cmd -ErrorAction Stop
  $token=(& $gcloud.Source auth print-access-token 2>$null|Select-Object -First 1).Trim()
  if($LASTEXITCODE -ne 0 -or $token -notmatch '^[A-Za-z0-9_.-]{20,}$'){Stop-Lan 'No valid local Google Cloud authorization.'}
  $auth=@{Authorization="Bearer $token";Accept='application/json';'Cache-Control'='no-cache'}
  $original=[string](Live-Release).version.name
  if($original -notmatch '^sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+$'){Stop-Lan 'Wrong Production Hosting site/version.'}
  $version=Api GET "$api/$original"
  if([string]$version.status -cne 'FINALIZED' -or !$version.config){Stop-Lan 'Live Hosting serving config could not be preserved.'}
  $existing=Version-Files $original
  if($existing.Count -lt 30 -or !$existing.ContainsKey($target) -or !$existing.ContainsKey('/index.html') -or !$existing.ContainsKey('/admin/index.html')){Stop-Lan 'Live Hosting manifest incomplete.'}

  $oldFile=Join-Path $work 'settings-live.js'
  Invoke-WebRequest -Uri ("https://$site.web.app$target?preflight="+[guid]::NewGuid().ToString('N')) -OutFile $oldFile -UseBasicParsing -TimeoutSec 40|Out-Null
  $actualOld=Git-Blob ([IO.File]::ReadAllBytes($oldFile))
  if($actualOld -cne $oldBlob){
    if($actualOld -ceq $newBlob){Stop-Lan 'Approved Telemetry code is already live; no redeploy.'}
    Stop-Lan 'Production Settings is not the audited live version; do not overwrite it.'
  }

  # Firebase Hosting REST requires SHA256 of GZIP-compressed JS bytes.
  $zip=Join-Path $work 'settings.gz'
  $stream=[IO.File]::Create($zip)
  try {
    $gzip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionLevel]::Optimal,$true)
    try{$gzip.Write($candidate,0,$candidate.Length)}finally{$gzip.Dispose()}
  }finally{$stream.Dispose()}
  $hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if($hash -ceq $existing[$target]){Stop-Lan 'No change required.'}
  Write-Host "PASS: $($existing.Count) current Hosting paths and exact server serving config inspected." -ForegroundColor Green
  Write-Host 'SCOPE: /admin/js/settings.js ONLY. Worker, MFA, Recovery, Rules and Public UI unchanged.' -ForegroundColor Yellow
  Require-SameLiveRelease $original
  $confirm=Read-Host 'Type DEPLOY-TELEMETRY-ONLY to publish this ONE file (Enter cancels)'
  if($confirm -cne 'DEPLOY-TELEMETRY-ONLY'){Stop-Lan 'Deployment not authorized.'}
  Require-SameLiveRelease $original

  $created=Api POST "$api/sites/$site/versions" @{config=$version.config}
  $draft=[string]$created.name
  if($draft -notmatch '^sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+$'){Stop-Lan 'Invalid draft version name.'}
  $files=@{}
  foreach($p in $existing.Keys){$files[$p]=$existing[$p]}
  $files[$target]=$hash
  $paths=@($files.Keys|Sort-Object)
  $required=@();$uploadUrl=''
  for($i=0;$i -lt $paths.Count;$i+=500){
    $batch=@{}
    for($j=$i;$j -lt [Math]::Min($i+500,$paths.Count);$j++){$batch[$paths[$j]]=$files[$paths[$j]]}
    $populated=Api POST ($api+'/'+$draft+':populateFiles') @{files=$batch}
    if($populated.PSObject.Properties.Name -contains 'uploadRequiredHashes'){$required+=@($populated.uploadRequiredHashes|Where-Object {$_})}
    if($populated.PSObject.Properties.Name -contains 'uploadUrl'){$uploadUrl=[string]$populated.uploadUrl}
  }
  if($required.Count -gt 1 -or ($required.Count -eq 1 -and $required[0] -cne $hash)){Stop-Lan 'Unexpected uploaded assets; draft NOT released.'}
  if($required.Count -eq 1){
    if($uploadUrl -notmatch '^https://upload-firebasehosting\.googleapis\.com/upload/sites/rolando-portfolio-3f1a3/versions/[A-Za-z0-9_-]+/files$'){Stop-Lan 'Unexpected Firebase upload location.'}
    Invoke-RestMethod -Uri ($uploadUrl+'/'+$hash) -Method POST -Headers $auth -ContentType 'application/octet-stream' -InFile $zip -TimeoutSec 90 | Out-Null
  }
  $draftFiles=Version-Files $draft
  if($draftFiles.Count -ne $files.Count){Stop-Lan 'Draft asset count mismatch; NOT released.'}
  foreach($p in $files.Keys){if(!$draftFiles.ContainsKey($p) -or $draftFiles[$p] -cne $files[$p]){Stop-Lan "Draft differs at path $p; NOT released."}}
  Require-SameLiveRelease $original
  $final=Api PATCH ($api+'/'+$draft+'?update_mask=status') @{status='FINALIZED'}
  if([string]$final.status -cne 'FINALIZED'){Stop-Lan 'Draft not finalized; NOT released.'}
  Require-SameLiveRelease $original
  $encoded=[uri]::EscapeDataString($draft)
  $release=Api POST ("$api/sites/$site/releases?versionName="+$encoded)
  if([string]$release.version.name -cne $draft){Stop-Lan 'Release acknowledgement not confirmed. Check Hosting console before retrying.'}
  Write-Host 'PRODUCTION DEPLOY CONFIRMED: Firebase Hosting.' -ForegroundColor Green
  Write-Host "ONE UPDATED FILE: $target" -ForegroundColor Green
  Write-Host "ORIGINAL VERSION: $original"
  Write-Host "NEW VERSION: $draft"
  Write-Host 'Next: same trusted Chrome; verify Admin Settings, login and live reads. Quota may still need reset.' -ForegroundColor Cyan
} finally {
  $auth=$null;$token=$null
  if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}
