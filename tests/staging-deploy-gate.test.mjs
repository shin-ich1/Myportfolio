import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const workflow=await readFile(new URL("../.github/workflows/admin-performance-regression.yml",import.meta.url),"utf8");

test("staging deployment is disabled unless explicit staging flag is enabled and CI passes",()=>{
  assert.match(workflow,/staging-deploy:/);
  assert.match(workflow,/needs: shared-admin-regression/);
  assert.match(workflow,/LAN_STAGING_DEPLOY_APPROVED/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/perf\/admin-workspace-investigation-20261008'/);
  assert.match(workflow,/environment: lan-security-staging/);
});
test("staging deployment targets only exact Firebase and Cloudflare staging resources",()=>{
  assert.match(workflow,/lan-portfolio-staging/);
  assert.match(workflow,/wrangler\.staging\.jsonc/);
  assert.match(workflow,/--project lan-portfolio-staging/);
  assert.match(workflow,/LAN_STAGING_FIREBASE_SERVICE_ACCOUNT_B64/);
  assert.match(workflow,/LAN_STAGING_CLOUDFLARE_API_TOKEN/);
  assert.match(workflow,/check-staging-worker-health\.mjs/);
  assert.doesNotMatch(workflow,/--project rolando-portfolio-3f1a3/);
  assert.doesNotMatch(workflow,/wrangler deploy --config wrangler\.jsonc/);
});
