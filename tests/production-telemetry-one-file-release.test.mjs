import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script=readFileSync(new URL('../scripts/deploy-production-telemetry-only.ps1',import.meta.url),'utf8');
test('One-file Production release refuses source drift and preserves complete current Hosting config/manifest',()=>{
  assert.match(script,/\$site='rolando-portfolio-3f1a3'/);
  assert.match(script,/\$target='\/admin\/js\/settings\.js'/);
  assert.match(script,/\$oldBlob='717083f0d1504464ea4e275a9da4dd8f706ce179'/);
  assert.match(script,/\$newBlob='e3aca64c4662ea99457b44855b035ffb0b20a305'/);
  assert.match(script,/Git-Blob \$candidate/);
  assert.match(script,/Git-Blob \(\[IO\.File\]::ReadAllBytes\(\$oldFile\)\)/);
  assert.match(script,/Require-SameLiveRelease \$original/g);
  assert.match(script,/\$created=Api POST "\$api\/sites\/\$site\/versions" @\{config=\$version\.config\}/);
  assert.match(script,/foreach\(\$p in \$existing\.Keys\)\{\$files\[\$p\]=\$existing\[\$p\]\}/);
  assert.match(script,/\$files\[\$target\]=\$hash/);
  assert.match(script,/\$draftFiles=Version-Files \$draft/);
  assert.match(script,/\$release=Api POST \("\$api\/sites\/\$site\/releases\?versionName="\+\$encoded\)/);
});
test('Production release gates explicit user approval and never calls other deployment paths',()=>{
  assert.match(script,/Read-Host 'Type DEPLOY-TELEMETRY-ONLY/);
  assert.match(script,/\$confirm -cne 'DEPLOY-TELEMETRY-ONLY'/);
  assert.match(script,/node --test tests\/settings-telemetry-read-budget\.test\.mjs tests\/settings-lazy-room-initialization\.test\.mjs tests\/admin-settings-startup-requests\.test\.mjs/);
  assert.doesNotMatch(script,/wrangler\s+deploy|firebase\s+deploy|firestore\.rules|mfa\.state\s*=|accounts:update/i);
});
