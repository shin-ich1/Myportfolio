import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const release = readFileSync(new URL('../scripts/deploy-production-admin-authorization.ps1', import.meta.url), 'utf8');
const authorization = readFileSync(new URL('../admin/services/adminAuthorizationService.js', import.meta.url), 'utf8');
const normalized = Buffer.from(authorization.replace(/\r\n/g, '\n'), 'utf8');
const blobSha = createHash('sha1')
  .update(Buffer.from('blob ' + normalized.length + '\0', 'utf8'))
  .update(normalized)
  .digest('hex');

test('single-file authorization release hashes the actual reviewed canonical owner', () => {
  assert.equal(blobSha, 'f690cc65cbf685d82e4bdcc771e15a35f5069ea5');
  assert.match(authorization, /const authorized = securityApproved && allowlistAuthorized;/);
  assert.doesNotMatch(authorization, /claimAuthorized|claimAuthorized\s*\|\|\s*allowlistAuthorized/);
  const assetsBlock = release.match(/\$assets=@\(\s*([\s\S]*?)\n\)/);
  assert.ok(assetsBlock, 'Missing explicit asset manifest');
  const changed = [...assetsBlock[1].matchAll(/Path='([^']+)'; OldBlob='([a-f0-9]{40})'; NewBlob='([a-f0-9]{40})'/g)].map((m) => m.slice(1));
  assert.deepEqual(changed, [[
    '/admin/services/adminAuthorizationService.js',
    '24f1bbed02beccd73d28b95a4455f26e390eedee',
    'f690cc65cbf685d82e4bdcc771e15a35f5069ea5'
  ]]);
  assert.equal((assetsBlock[1].match(/Path='/g) || []).length, 1);
  assert.match(release, /\$assets.Count -ne 1/);
  assert.match(release, /\$relativePath -cne 'admin\/services\/adminAuthorizationService\.js'/);
});

test('releases only from the reviewed Production Hosting version, never from another site', () => {
  assert.match(release, /\$site='rolando-portfolio-3f1a3'/);
  assert.match(release, /\$expectedLiveVersion='sites\/rolando-portfolio-3f1a3\/versions\/1c93538a992422be'/);
  assert.match(release, /\$original -cne \$expectedLiveVersion/);
  assert.match(release, /Require-SameLiveRelease \$original/g);
  assert.match(release, /\$version\.config/);
  assert.match(release, /\$draftFiles=Version-Files \$draft/);
  assert.match(release, /\$draftFiles\[\$p\] -cne \$files\[\$p\]/);
  assert.match(release, /\$needed.Count -gt 1/);
  assert.match(release, /\$existing\[\$asset\.Path\]/);
  assert.match(release, /\$actual -cne \$asset\.OldBlob/);
  assert.match(release, /Assert-ReviewedLiveAdminBaseline \$liveBytes \$asset\.OldBlob \$asset\.Path/);
});

test('seven published Admin security files and three performance files are read-only and hash-verified', () => {
  const admin = [
    ['/admin/index.html','ec6fc8fa15531cf59df6e9cbf90d17bfc69c16da'],
    ['/admin/js/admin-shell.js','e5e3a689ae382630c4d12ebfe76395e2e4482a69'],
    ['/admin/js/admin-ui.js','28679d7c3739213f5d4186b3469feb00621a3571'],
    ['/admin/js/admin.js','7f1b9efc280c913a8b4c93b7e59897e1c8bcb0a2'],
    ['/admin/js/settings-security.js','225706fbec049326fa091d112c8983a8f144dfca'],
    ['/admin/js/workspace-host.js','5b4beef65b37099b1e485740a9e0d838cb4d4861'],
    ['/admin/services/adminSecurityService.js','fc6c5700dc7286228265c58b38df16f58111f612']
  ];
  const performance = [
    ['/admin/js/settings.js','e3aca64c4662ea99457b44855b035ffb0b20a305'],
    ['/admin/js/dashboard.js','72983ce53fa9888cd77cd4c50ee1376a980ad750'],
    ['/admin/js/home.js','398d6a7ee4db0c44e604f79cc6498c9798756440']
  ];
  for (const [path, sha] of [...admin,...performance]) {
    assert.ok(release.includes("Path='" + path + "'; Blob='" + sha + "'"), 'Read-only protected asset not pinned: '+path);
  }
  assert.match(release, /\$protectedAdmin.Count -ne 7/);
  assert.match(release, /\$performance.Count -ne 3/);
  assert.match(release, /Protected Admin asset differs from approved deployed version/);
  assert.match(release, /Deployed performance asset differs from approved version/);
  assert.match(release, /foreach\(\$p in \$existing.Keys\)\{\$files\[\$p\]=\$existing\[\$p\]\}/);
});

test('requires interactive approval and cannot deploy Firestore, Worker, MFA, Recovery or Public', () => {
  assert.match(release, /Read-Host 'Type DEPLOY-ADMIN-AUTH/);
  assert.match(release, /\$confirm -cne 'DEPLOY-ADMIN-AUTH'/);
  assert.match(release, /Get-ApprovedGitBlobBytes \$rel/);
  assert.match(release, /StandardOutput\.BaseStream\.CopyTo\(\$memory\)/);
  assert.match(release, /\[Text\.UTF8Encoding\]::new\(\$false,\$true\)/);
  assert.match(release, /\(Git-Blob \$normalized\) -cne \$expected/);
  assert.match(release, /\$token=Resolve-GoogleCloudAccessToken/);
  assert.match(release, /X-Goog-User-Project/);
  assert.match(release, /Production TOTP MFA configuration is not as approved/);
  assert.doesNotMatch(release, /\bwrangler\s+deploy\b|\bfirebase\s+deploy\b|mfa\.state\s*=|accounts:update/i);
});
