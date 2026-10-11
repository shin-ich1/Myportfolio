import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const yaml = readFileSync(new URL("../.github/workflows/pr11-staging-hosting.yml", import.meta.url), "utf8");

test("PR11 staging workflow runs on exactly one staging test branch", () => {
  assert.match(yaml, /staging\/pr11-turnstile-mobile-20261011/);
  assert.match(yaml, /github\.ref == 'refs\/heads\/staging\/pr11-turnstile-mobile-20261011'/);
  assert.match(yaml, /github\.event_name == 'push'/);
  assert.match(yaml, /environment: lan-security-staging/);
  assert.match(yaml, /LAN_PR11_STAGING_HOSTING_DEPLOY_APPROVED == 'true'/);
  assert.doesNotMatch(yaml, /branches:\s*\[\s*main\s*\]/);
});

test("PR11 Hosting deployment has independent validation and immutable source checks", () => {
  assert.match(yaml, /needs: validate/);
  assert.match(yaml, /git merge-base --is-ancestor/);
  assert.match(yaml, /git hash-object app\.js/);
  assert.match(yaml, /0b051406a79279b6801ef71adeefa88dcaa46cba/);
  assert.match(yaml, /698bebd0e94c249c9085b10fd89707cdc5b16a9b/);
  assert.match(yaml, /256952bbec753830254f6469347964a6de4a2745/);
  assert.match(yaml, /node --test tests\/public-messenger-conversation-lifecycle\.test\.mjs tests\/public-turnstile-mobile-regression\.test\.mjs tests\/public-turnstile-lifecycle-regression\.test\.mjs/);
  assert.match(yaml, /node --test tests\/public-security-source-isolation\.test\.mjs/);
  assert.match(yaml, /c1f46e3ae83687c6550fc539fc6c51773e53adb1/);
  assert.match(yaml, /node --test tests\/public-turnstile-mobile-regression\.test\.mjs/);
  assert.match(yaml, /node scripts\/prepare-staging\.mjs/);
  assert.match(yaml, /fbbe71500e856d0c553edf689bc2c293fbbc5079/);
  assert.match(yaml, /e6e9ef5a4099b00398b545007882254775920a77/);
  assert.match(yaml, /1182759b2c37fb6d201f78c0d6c67156d3b9fc32/);
  assert.match(yaml, /git hash-object message-service\\.js/);
  assert.match(yaml, /git hash-object \\.lan-staging\\/site\\/message-service\\.js/);
  assert.match(yaml, /message-service\\.js\\?pr13=/);
});

test("Only isolated Firebase Hosting may be deployed; no Worker, rules, or production project writes", () => {
  assert.match(yaml, /--only hosting --project lan-portfolio-staging --non-interactive/);
  assert.match(yaml, /working-directory: \.lan-staging/);
  assert.doesNotMatch(yaml, /wrangler deploy(?!\s+--dry-run)/);
  assert.doesNotMatch(yaml, /--only firestore|--only storage|--project rolando-portfolio-3f1a3/);
  assert.doesNotMatch(yaml, /lan-cloudinary-telemetry\.lagmayr2\.workers\.dev/);
});

test("GitHub deploy uses scoped keyless staging identity and refuses secrets in source", () => {
  assert.match(yaml, /id-token:\s*write/);
  assert.match(yaml, /google-github-actions\/auth@v3/);
  assert.match(yaml, /workload_identity_provider:\s*\$\{\{ vars\.LAN_STAGING_WIF_PROVIDER \}\}/);
  assert.match(yaml, /service_account:\s*\$\{\{ vars\.LAN_STAGING_DEPLOY_SERVICE_ACCOUNT \}\}/);
  assert.match(yaml, /project_id: lan-portfolio-staging/);
  assert.match(yaml, /LAN_STAGING_FIREBASE_WEB_API_KEY: \$\{\{ secrets\.LAN_STAGING_FIREBASE_WEB_API_KEY \}\}/);
  assert.match(yaml, /571587695468/);
  assert.doesNotMatch(yaml, /credentials_json:|PRIVATE_KEY=|TURNSTILE_SECRET_KEY:/);
});

test("Staging OIDC identity is verified separately, without enabling a Hosting deployment", () => {
  const start = yaml.indexOf("\n  oidc-preflight:");
  const end = yaml.indexOf("\n  deploy:", start);
  assert.ok(start > 0 && end > start, "The single canonical workflow must own the read-only identity preflight");
  const job = yaml.slice(start, end);
  assert.match(job, /needs: validate/);
  assert.match(job, /environment: lan-security-staging/);
  assert.match(job, /id-token:\s*write/);
  assert.match(job, /google-github-actions\/auth@v3/);
  assert.match(job, /google-github-actions\/setup-gcloud@v3/);
  assert.match(job, /gcloud auth print-access-token >\/dev\/null/);
  assert.match(job, /github\.ref == 'refs\/heads\/staging\/pr11-turnstile-mobile-20261011'/);
  assert.match(job, /projects\/571587695468/);
  assert.ok(job.includes("@lan-portfolio-staging.iam.gserviceaccount.com"), "Staging service account identity must be pinned");
  assert.doesNotMatch(job, /firebase-tools|wrangler deploy|deploy --only|\bgcloud (?:projects|iam) (?:add|set|update|create)/);
});
