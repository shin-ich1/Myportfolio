import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../scripts/deploy-production-admin-performance.ps1',import.meta.url),'utf8');

test('Production release has exactly three reviewed Admin performance assets, old and new hashes pinned',()=>{
  const expected=[
    ['/admin/js/settings.js','717083f0d1504464ea4e275a9da4dd8f706ce179','e3aca64c4662ea99457b44855b035ffb0b20a305'],
    ['/admin/js/dashboard.js','e5dc478bdace7833686c387c8c4f6023f5156d28','72983ce53fa9888cd77cd4c50ee1376a980ad750'],
    ['/admin/js/home.js','9b088be12133c1871f39bd46ce2db6664285d1b3','398d6a7ee4db0c44e604f79cc6498c9798756440']
  ];
  for(const [path,oldSha,newSha] of expected) {
    assert.ok(script.includes("Path='"+path+"'"),'missing approved path '+path);
    assert.ok(script.includes("OldBlob='"+oldSha+"'"),'missing old live source identity '+path);
    assert.ok(script.includes("NewBlob='"+newSha+"'"),'missing new reviewed source identity '+path);
  }
  const declared=[...script.matchAll(/Path='(\/admin\/js\/[\w-]+\.js)'; OldBlob=/g)].map(x=>x[1]);
  assert.deepEqual(declared,expected.map(x=>x[0]),'no additional Admin or Public files permitted');
  assert.match(script,/\$assets\.Count -ne 3/);
  assert.match(script,/\$site='rolando-portfolio-3f1a3'/);
});

test('Release requires live source matches and double-checks Production live channel',()=>{
  assert.match(script,/Git-Blob \(\[IO\.File\]::ReadAllBytes\(\$livePath\)\)/);
  assert.match(script,/\$actual -cne \$asset\.OldBlob/);
  assert.match(script,/\$sourceBlob -cne \$asset\.NewBlob/);
  assert.match(script,/\$fileHashes\[\$asset\.Path\]=\$hash/);
  assert.match(script,/foreach\(\$p in \$fileHashes\.Keys\)\{\$files\[\$p\]=\$fileHashes\[\$p\]\}/);
  assert.match(script,/Require-SameLiveRelease \$original/g);
  assert.match(script,/channels\/live\/releases\?pageSize=1/);
  assert.match(script,/channels\/live\/releases\?versionName=/);
  assert.match(script,/\$draftFiles=Version-Files \$draft/);
  assert.match(script,/\$version\.config/);
});

test('Release is operator approved, tests source and cannot change Auth, Rules or Worker',()=>{
  assert.match(script,/Read-Host 'Type DEPLOY-ADMIN-PERFORMANCE/);
  assert.match(script,/\$confirm -cne 'DEPLOY-ADMIN-PERFORMANCE'/);
  assert.match(script,/node --test tests\/settings-telemetry-read-budget\.test\.mjs.*tests\/admin-home-startup-requests\.test\.mjs/);
  assert.doesNotMatch(script,/\bwrangler\s+deploy\b|\bfirebase\s+deploy\b|mfa\.state\s*=|accounts:update/i);
});
