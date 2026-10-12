import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/deploy-production-security-read-budget.ps1',import.meta.url),'utf8');
const ui=readFileSync(new URL('../admin/js/settings-security.js',import.meta.url),'utf8');
const canonical=Buffer.from(ui.replace(/\r\n/g,'\n'));
const actualBlob=createHash('sha1').update(Buffer.from('blob '+canonical.length+'\0')).update(canonical).digest('hex');

test('release scope is exactly the CI-validated single Admin Security UI owner',()=>{
  assert.equal(actualBlob,'d30d5f4d992098a79484c91e0ca6ccc1ef58bf59');
  const block=script.match(/\$assets=@\(\s*([\s\S]*?)\n\)/);
  assert.ok(block);
  const files=[...block[1].matchAll(/Path='([^']+)'; OldBlob='([0-9a-f]{40})'; NewBlob='([0-9a-f]{40})'/g)];
  assert.deepEqual(files.map(v=>v.slice(1)),[[
    '/admin/js/settings-security.js',
    '225706fbec049326fa091d112c8983a8f144dfca',
    actualBlob
  ]]);
  assert.equal((block[1].match(/Path=/g)||[]).length,1);
  assert.match(script,/\$assets.Count -ne 1/);
  assert.match(script,/\$relativePath -cne 'admin\/js\/settings-security\.js'/);
});

test('live release must equal previously verified Production version, and manifest must be retained',()=>{
  assert.match(script,/\$site='rolando-portfolio-3f1a3'/);
  assert.match(script,/\$expectedLiveVersion='sites\/rolando-portfolio-3f1a3\/versions\/2f189387399ecf17'/);
  // This exact 16-character version is from the operator's live Firebase Hosting
  // release history. A previously transcribed 15-character pin blocked deploy.
  assert.doesNotMatch(script,/versions\/2f18938799ecf17/);
  assert.equal('2f189387399ecf17'.length,16);
  assert.match(script,/\$liveRelease=Live-Release/);
  assert.match(script,/\$original=\[string\]\$liveRelease\.version\.name/);
  assert.match(script,/\$original -cne \$expectedLiveVersion/);
  assert.match(script,/Production Hosting version mismatch; expected='/);
  assert.match(script,/observed='/);
  assert.match(script,/Require-SameLiveRelease \$original/);
  assert.match(script,/\$version\.config/);
  assert.match(script,/\$draftFiles=Version-Files \$draft/);
  assert.match(script,/\$draftFiles\[\$p\] -cne \$files\[\$p\]/);
  assert.match(script,/\$needed.Count -gt 1/);
  assert.match(script,/Assert-ReviewedLiveAdminBaseline \$liveBytes \$asset\.OldBlob \$asset\.Path/);
});

test('existing Security Admin, canonical authorization and performance assets remain immutable',()=>{
  const protectedAssets=[
    ['/admin/index.html','ec6fc8fa15531cf59df6e9cbf90d17bfc69c16da'],
    ['/admin/js/admin-shell.js','e5e3a689ae382630c4d12ebfe76395e2e4482a69'],
    ['/admin/js/admin-ui.js','28679d7c3739213f5d4186b3469feb00621a3571'],
    ['/admin/js/admin.js','7f1b9efc280c913a8b4c93b7e59897e1c8bcb0a2'],
    ['/admin/js/workspace-host.js','5b4beef65b37099b1e485740a9e0d838cb4d4861'],
    ['/admin/services/adminSecurityService.js','fc6c5700dc7286228265c58b38df16f58111f612'],
    ['/admin/services/adminAuthorizationService.js','f690cc65cbf685d82e4bdcc771e15a35f5069ea5'],
    ['/admin/js/settings.js','e3aca64c4662ea99457b44855b035ffb0b20a305'],
    ['/admin/js/dashboard.js','72983ce53fa9888cd77cd4c50ee1376a980ad750'],
    ['/admin/js/home.js','398d6a7ee4db0c44e604f79cc6498c9798756440']
  ];
  for(const [path,sha] of protectedAssets){
    assert.ok(script.includes("Path='"+path+"'; Blob='"+sha+"'"),'Unpinned immutable asset: '+path);
  }
  assert.match(script,/\$protectedAdmin.Count -ne 7/);
  assert.match(script,/\$performance.Count -ne 3/);
  assert.match(script,/\$observed -cne \$item\.Blob/);
  assert.match(script,/\$existing\[\$p\]/);
});

test('explicit operator confirmation and fail-closed backend checks are preserved',()=>{
  assert.match(script,/Read-Host 'Type DEPLOY-SECURITY-READ-BUDGET/);
  assert.match(script,/\$confirm -cne 'DEPLOY-SECURITY-READ-BUDGET'/);
  assert.match(script,/\$health\.securityCoordinatorConfigured/);
  assert.match(script,/\$mfaConfig\.mfa\.state/);
  assert.match(script,/\$original -cne \$expectedLiveVersion/);
  assert.match(script,/Get-ApprovedGitBlobBytes \$rel/);
  assert.match(script,/StandardOutput\.BaseStream\.CopyTo\(\$memory\)/);
  assert.match(script,/\$token=Resolve-GoogleCloudAccessToken/);
  assert.match(script,/X-Goog-User-Project/);
  assert.doesNotMatch(script,/\bwrangler\s+deploy\b|\bfirebase\s+deploy\b/i);
});
