/**
 * Read-only, staging-only Cloudflare metadata diagnosis.
 * Intentionally emits only fixed labels, numeric HTTP statuses and numeric CF error codes.
 * Never log response bodies, headers, URLs containing credentials, or caught errors.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const STAGING_WORKER = 'lan-portfolio-staging';
export const checks = Object.freeze([
  Object.freeze(['worker-settings', 'settings']),
  Object.freeze(['script-metadata', 'script-settings']),
  Object.freeze(['worker-subdomain', 'subdomain']),
  Object.freeze(['deployments', 'deployments'])
]);

export function diagnosticApproved(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_REPOSITORY === 'shin-ich1/Myportfolio' &&
    env.GITHUB_EVENT_NAME === 'push' &&
    env.GITHUB_REF === 'refs/heads/perf/admin-workspace-investigation-20261008' &&
    env.LAN_STAGING_DEPLOY_APPROVED === 'false' &&
    env.LAN_STAGING_DIAGNOSTIC_APPROVED === 'true';
}

export async function diagnose({ accountId, token, http = fetch, log = console.log }) {
  if (!/^[0-9a-f]{32}$/i.test(accountId || '') || typeof token !== 'string' || !token) {
    throw new Error('Missing or invalid staging credentials.');
  }

  let failed = false;
  for (const [label, suffix] of checks) {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${STAGING_WORKER}/${suffix}`;
    try {
      const response = await http(endpoint, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });

      // Only network-derived integer status/error codes are permitted in stdout.
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status : null;
      let cfCode = null;
      if (!response.ok) {
        failed = true;
        try {
          const envelope = await response.json();
          const code = envelope?.errors?.[0]?.code;
          if (Number.isSafeInteger(code) && code >= 0) cfCode = code;
        } catch {
          // The API response can contain sensitive data. Never print it.
        }
      } else if (response.body && typeof response.body.cancel === 'function') {
        await response.body.cancel().catch(() => {});
      }
      if (status === null) failed = true;
      log(`${label}: ${status === null ? 'invalid-http-status' : `HTTP ${status}`}` +
        (cfCode === null ? '' : ` / CF code ${cfCode}`));
    } catch {
      failed = true;
      log(`${label}: transport-error`);
    }
  }
  return !failed;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!diagnosticApproved()) {
    console.error('Read-only diagnostic safety gate denied.');
    process.exitCode = 1;
  } else {
    diagnose({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN
    }).then(success => {
      if (!success) process.exitCode = 1;
    }).catch(() => {
      console.error('Diagnostic failed without exposing details.');
      process.exitCode = 1;
    });
  }
}
