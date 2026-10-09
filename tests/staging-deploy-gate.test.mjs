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
  assert.match(workflow,/LAN_STAGING_WIF_PROVIDER/);
  assert.match(workflow,/LAN_STAGING_DEPLOY_SERVICE_ACCOUNT/);
  assert.match(workflow,/LAN_STAGING_CLOUDFLARE_API_TOKEN/);
  assert.match(workflow,/check-staging-worker-health\.mjs/);
  assert.doesNotMatch(workflow,/--project rolando-portfolio-3f1a3/);
  assert.doesNotMatch(workflow,/wrangler deploy --config wrangler\.jsonc/);
});

test("staging Firebase deploy uses GitHub OIDC identity federation instead of a service-account JSON key", () => {
  const job=workflow.slice(workflow.indexOf("  staging-deploy:"));
  assert.match(job,/id-token:\s*write/, "Only staging deploy job should request GitHub OIDC access");
  assert.match(job,/google-github-actions\/auth@v3/);
  assert.match(job,/workload_identity_provider:\s*\$\{\{\s*vars\.LAN_STAGING_WIF_PROVIDER\s*\}\}/);
  assert.match(job,/service_account:\s*\$\{\{\s*vars\.LAN_STAGING_DEPLOY_SERVICE_ACCOUNT\s*\}\}/);
  assert.match(job,/project_id:\s*lan-portfolio-staging/);
  assert.doesNotMatch(job,/LAN_STAGING_FIREBASE_SERVICE_ACCOUNT_B64|base64 --decode|\.lan-staging-firebase-deployer\.json|credentials_json:/,
    "Staging GitHub Actions must never reconstruct a long-lived Google service-account key");
  assert.ok(job.indexOf("google-github-actions/auth@v3") < job.indexOf("firebase-tools@"),
    "Staging Firebase credentials must be provisioned before Firebase CLI");
});

test("keyless staging deploy refuses unscoped federation identity and preserves the explicit gate", () => {
  const job=workflow.slice(workflow.indexOf("  staging-deploy:"));
  assert.match(job,/\$\{\{\s*vars\.LAN_STAGING_DEPLOY_APPROVED\s*\}\}\s*==\s*'true'/);
  assert.match(job,/github\.event_name == 'push'/);
  assert.match(job,/environment: lan-security-staging/);
  assert.match(job,/LAN_STAGING_WIF_PROVIDER/);
  assert.match(job,/571587695468/,
    "Pin identity federation to the actual staging GCP project number");
  assert.match(job,/workloadIdentityPools/,
    "Validate the provider resource pattern before requesting credentials");
  assert.match(job,/@lan-portfolio-staging/,
    "Require a staging-project service account, not a production service identity");
  assert.match(job,/roles?\/iam\.workloadIdentityUser|google-github-actions\/auth@v3/,
    "Use a WIF impersonation owner");
  assert.doesNotMatch(job,/--project\s+(?!lan-portfolio-staging)[a-z0-9-]+/);
});

test("Worker runtime Firebase signing remains a separate mandatory gate from keyless GitHub deploy", () => {
  const job=workflow.slice(workflow.indexOf("  staging-deploy:"));
  assert.match(job,/FIREBASE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(job,/FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(job,/SECURITY_RECOVERY_PEPPER/);
  assert.match(job,/wrangler secret list --config wrangler\.staging\.jsonc/);
});
