/**
 * Staging-only read-only Wrangler 4.131.2 metadata diagnostic.
 * Mirrors the service lookup and six GETs in fetchWorkerConfig.
 * CI prints only fixed labels, numeric statuses and numeric Cloudflare codes.
 * Never print response bodies, headers, URLs, credentials or caught errors.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const STAGING_WORKER = 'lan-portfolio-staging';
const API_ORIGIN = 'https://api.cloudflare.com/client/v4';
export const checks = Object.freeze([
  'bindings', 'routes', 'custom-domains',
  'subdomain', 'service-environment', 'cron-schedules'
]);

export function diagnosticApproved(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_REPOSITORY === 'shin-ich1/Myportfolio' &&
    env.GITHUB_EVENT_NAME === 'push' &&
    env.GITHUB_REF === 'refs/heads/perf/admin-workspace-investigation-20261008' &&
    env.LAN_STAGING_DEPLOY_APPROVED === 'false' &&
    env.LAN_STAGING_DIAGNOSTIC_APPROVED === 'true';
}

async function readMetadata({ label, path, token, http, log }) {
  try {
    const response = await http(API_ORIGIN + path, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    const status = Number.isInteger(response.status) &&
      response.status >= 100 && response.status <= 599 ? response.status : null;
    let envelope = null;
    try { envelope = await response.json(); } catch { /* Never print untrusted response. */ }
    const code = envelope?.errors?.[0]?.code;
    const cfCode = Number.isSafeInteger(code) && code >= 0 ? code : null;
    const valid = response.ok && status !== null && envelope?.success === true &&
      envelope?.result !== undefined && envelope.result !== null;
    log(label + ': ' + (status === null ? 'invalid-http-status' : 'HTTP ' + status) +
      (cfCode === null ? '' : ' / CF code ' + cfCode) +
      (response.ok && !valid ? ' / api-response-invalid' : ''));
    return { valid, result: valid ? envelope.result : null };
  } catch {
    log(label + ': transport-error');
    return { valid: false, result: null };
  }
}

export async function diagnose({ accountId, token, http = fetch, log = console.log }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '') || typeof token !== 'string' || !token) {
    throw new Error('Missing or invalid staging credentials.');
  }

  // Wrangler first discovers the default environment and last deploy source.
  const service = '/accounts/' + accountId + '/workers/services/' + STAGING_WORKER;
  const discovered = await readMetadata({
    label: 'service-metadata', path: service, token, http, log
  });
  if (!discovered.valid) return false;

  const source = discovered.result?.default_environment?.script?.last_deployed_from;
  if (source === 'api') {
    // Wrangler does not download dashboard configuration for API-deployed Workers.
    log('remote-config-path: skipped-non-dashboard');
    return true;
  }
  if (source !== 'dash') {
    log('remote-config-path: unknown');
    return false;
  }

  const environment = discovered.result?.default_environment?.environment;
  if (typeof environment !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(environment)) {
    log('remote-config-path: unsafe-environment');
    return false;
  }

  // Exact six API paths from Cloudflare workers-sdk Wrangler 4.131.2.
  // Read sequentially to pinpoint independent failures, without mutating anything.
  const envBase = service + '/environments/' + environment;
  const requests = [
    [checks[0], envBase + '/bindings'],
    [checks[1], envBase + '/routes?show_zonename=true'],
    [checks[2], '/accounts/' + accountId + '/workers/domains/records?page=0&per_page=5&service=' + STAGING_WORKER + '&environment=' + environment],
    [checks[3], envBase + '/subdomain'],
    [checks[4], envBase],
    [checks[5], '/accounts/' + accountId + '/workers/scripts/' + STAGING_WORKER + '/schedules']
  ];

  let allValid = true;
  for (const [label, path] of requests) {
    const response = await readMetadata({ label, path, token, http, log });
    if (!response.valid) allValid = false;
  }
  return allValid;
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
