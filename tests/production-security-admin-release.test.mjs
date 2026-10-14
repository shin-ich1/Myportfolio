import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../scripts/deploy-production-security-admin.ps1',import.meta.url),'utf8');
const lineEndingTest=readFileSync(new URL('./production-security-hosting-line-endings.test.ps1',import.meta.url),'utf8');

test('Line-ending verifier resolves its source from the operator repository root in both file and inline modes',()=>{
  assert.match(lineEndingTest,/Join-Path \(Get-Location\)\.Path 'scripts\/deploy-production-security-admin\.ps1'/);
  assert.doesNotMatch(lineEndingTest,/Split-Path -Parent \$PSScriptRoot/);
  assert.match(lineEndingTest,/Test-Path -LiteralPath \$path -PathType Leaf/);
  assert.match(script,/\& \(\[ScriptBlock\]::Create\(\$lineEndingTest\)\)/);
});


test('Security Admin release has exactly seven pre-reviewed files and both source identities',()=>{
  const approved=[
  [
    "/admin/index.html",
    "fcb4814b7259b370d2031679d5495cb1e778990c",
    "ec6fc8fa15531cf59df6e9cbf90d17bfc69c16da"
  ],
  [
    "/admin/js/admin-shell.js",
    "6e5071252023d97089878695baca213f8f4e43f6",
    "e5e3a689ae382630c4d12ebfe76395e2e4482a69"
  ],
  [
    "/admin/js/admin-ui.js",
    "b7e3e2a609542d9643914f1105a77558a1f9a03d",
    "28679d7c3739213f5d4186b3469feb00621a3571"
  ],
  [
    "/admin/js/admin.js",
    "235f43674530dc35aa46171ef47f160f7465d609",
    "7f1b9efc280c913a8b4c93b7e59897e1c8bcb0a2"
  ],
  [
    "/admin/js/settings-security.js",
    "48033218a689eec8f988b4bf7b5126a48b918eba",
    "225706fbec049326fa091d112c8983a8f144dfca"
  ],
  [
    "/admin/js/workspace-host.js",
    "4b1257470021d58c5d87d6620bee40a6ea5d0f91",
    "5b4beef65b37099b1e485740a9e0d838cb4d4861"
  ],
  [
    "/admin/services/adminSecurityService.js",
    "c2a04be7a8454a0e0f5e8c218529061362393a0a",
    "fc6c5700dc7286228265c58b38df16f58111f612"
  ]
];
  const declared=[...script.matchAll(/Path='(\/admin\/(?:js\/|services\/)?[\w.-]+)'; OldBlob='([a-f0-9]{40})'; NewBlob='([a-f0-9]{40})'/g)].map(x=>x.slice(1));
  assert.deepEqual(declared,approved,'no additional Admin or Public files permitted');
  assert.match(script,/\$assets\.Count -ne 7/);
  assert.match(script,/\$site='rolando-portfolio-3f1a3'/);
});

test('Already published performance/Telemetry files are read-only and byte-verified',()=>{
  const preserved=[
    ['/admin/js/settings.js','e3aca64c4662ea99457b44855b035ffb0b20a305'],
    ['/admin/js/dashboard.js','72983ce53fa9888cd77cd4c50ee1376a980ad750'],
    ['/admin/js/home.js','398d6a7ee4db0c44e604f79cc6498c9798756440']
  ];
  for(const [path,sha] of preserved){
    assert.ok(script.includes("Path='"+path+"'; Blob='"+sha+"'"));
    assert.ok(!script.includes("Path='"+path+"'; OldBlob="),'Already published source MUST not be uploaded again');
  }
  assert.match(script,/Deployed performance asset differs from approved version/);
});

test('Live production source, complete manifest and serving config are preserved',()=>{
  for(const pattern of [
    /\$actual -cne \$asset\.OldBlob/,
    /\$sourceBlob -cne \$asset\.NewBlob/,
    /\$liveBytes=\[IO\.File\]::ReadAllBytes\(\$livePath\)/,
    /\$actual=Git-Blob \$liveBytes/,
    /Assert-ReviewedLiveAdminBaseline \$liveBytes \$asset\.OldBlob \$asset\.Path/,
    /\$actual -ceq \$asset\.NewBlob/,
    /\$fileHashes\[\$asset\.Path\]=\$hash/,
    /\$draftFiles=Version-Files \$draft/,
    /Require-SameLiveRelease \$original/,
    /\$version\.config/,
    /channels\/live\/releases\?versionName=/,
    /Production Security Worker is not ready/,
    /mfaConfig\.mfa\.state -cne 'ENABLED'/
  ])assert.match(script,pattern);
});

test('Release requires explicit operator approval and cannot change Public, Worker, Auth, or Rules',()=>{
  assert.match(script,/DEPLOY-SECURITY-ADMIN/);
  assert.match(script,/Read-Host 'Type DEPLOY-SECURITY-ADMIN/);
  assert.match(script,/\$confirm -cne 'DEPLOY-SECURITY-ADMIN'/);
  assert.doesNotMatch(script,/\bwrangler\s+deploy\b|\bfirebase\s+deploy\b|mfa\.state\s*=|accounts:update/i);
  assert.match(script,/function Get-ApprovedGitBlobBytes\(/);
  assert.match(script,/\.StandardOutput\.BaseStream\.CopyTo\(\$memory\)/);
  assert.match(script,/\$bytes=Get-ApprovedGitBlobBytes \$rel/);
  assert.doesNotMatch(script,/Select-Object -First 1\)\.Trim\(\)/);
  assert.match(script,/X-Goog-User-Project/);
});

test('CRLF normalization is allowed only for exact reviewed bytes and never bypasses production scope',()=>{
  assert.match(script,/function Assert-ReviewedLiveAdminBaseline\(/);
  assert.match(script,/\[Text\.UTF8Encoding\]::new\(\$false,\$true\)/);
  assert.match(script,/\$source\.Replace\("`r`n","`n"\)/);
  assert.match(script,/\(Git-Blob \$normalized\) -cne \$expected/);
  assert.match(script,/\$baseline -cne 'strict-crlf'/);
  assert.match(script,/production-security-hosting-line-endings\.test\.ps1/);
  assert.match(script,/Production differs from reviewed baseline/);
  assert.doesNotMatch(script,/\$asset\.OldBlob\s*=\s*\$actual|OldBlob='46089b44/);
});
