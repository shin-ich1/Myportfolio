import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const script = readFileSync(new URL('../scripts/deploy-production-public-quota-one-file.ps1', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url));
const sha = createHash('sha1').update(Buffer.from('blob ' + app.length + '\0')).update(app).digest('hex');

test('Production release is pinned to exactly one audited Public app.js file', () => {
  assert.equal(sha, '6971fde459ea2b59fc4868cae37bade0232e8765');
  assert.match(script, /Path='\/app\.js'; OldBlob='f156424e6adf216da6660648dc634319e340aa4a'; NewBlob='6971fde459ea2b59fc4868cae37bade0232e8765'/);
  const assets = script.match(/\$assets=@\(([\s\S]*?)\n\)/);
  assert.ok(assets);
  assert.equal((assets[1].match(/Path=/g)||[]).length, 1);
  assert.match(script, /if\(\$relativePath -cne 'app\.js'\)/);
  assert.match(script, /\$assets.Count -ne 1/);
});
test('Script requires operator-pinned live version, full Hosting manifest preservation and explicit confirmation', () => {
  assert.match(script, /\[switch\]\$PreflightOnly/);
  assert.match(script, /\$expectedLiveVersion=\$ExpectedLiveVersion/);
  assert.match(script, /\$original -cne \$expectedLiveVersion/);
  assert.match(script, /if\(\$PreflightOnly\)/);
  assert.ok(script.indexOf('if($PreflightOnly)') < script.indexOf("Read-Host 'Type DEPLOY-PUBLIC-QUOTA-ONE-FILE"), 'Preflight must be read only');
  assert.match(script, /\$confirm -cne 'DEPLOY-PUBLIC-QUOTA-ONE-FILE'/);
  assert.match(script, /Require-SameLiveRelease \$original/g);
  assert.match(script, /\$version\.config/);
  assert.match(script, /foreach\(\$p in \$existing\.Keys\)\{\$files\[\$p\]=\$existing\[\$p\]\}/);
  assert.match(script, /foreach\(\$p in \$files\.Keys\)\{if\(!\$draftFiles\.ContainsKey\(\$p\)/);
  assert.match(script, /\$needed\.Count -gt 1/);
});
test('Existing Admin Security assets and released performance owners are immutable', () => {
  assert.match(script, /\$protectedAdmin\.Count -ne 8/);
  assert.match(script, /\$performance\.Count -ne 3/);
  assert.match(script, /Path='\/admin\/js\/settings-security\.js'; Blob='d30d5f4d992098a79484c91e0ca6ccc1ef58bf59'/);
  assert.match(script, /Path='\/admin\/services\/adminAuthorizationService\.js'; Blob='f690cc65cbf685d82e4bdcc771e15a35f5069ea5'/);
  assert.match(script, /Assert-ReviewedLivePublicBaseline \$liveBytes \$asset\.OldBlob \$asset\.Path/);
  assert.match(script, /Get-ApprovedGitBlobBytes \$rel/);
  assert.doesNotMatch(script, /\bwrangler\s+deploy\b|\bfirebase\s+deploy\b/i);
});
