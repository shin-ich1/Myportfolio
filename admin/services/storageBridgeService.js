import { storageBridgeUrl } from '../../storage-bridge-url.js';

export function workerBridgeUrl(pathname = '/') {
  return storageBridgeUrl(pathname);
}

export function publicWorkerUrl(pathname = '/') {
  return workerBridgeUrl(pathname);
}

function canonicalAdminSessionBridge() {
  return window.__LAN_ADMIN_AUTH__ || window.parent?.__LAN_ADMIN_AUTH__ || null;
}

async function authorizedAdminToken() {
  const readiness = window.__LAN_ADMIN_READY__ || window.parent?.__LAN_ADMIN_READY__;
  if (!readiness || typeof readiness.then !== 'function') {
    throw Object.assign(new Error('Canonical Admin authorization readiness is unavailable.'), { code: 'authorization-readiness-unavailable' });
  }

  await readiness;
  const session = canonicalAdminSessionBridge();
  if (!session?.user?.uid || typeof session.getIdToken !== 'function') {
    throw Object.assign(new Error('Administrator authorization is required.'), { code: 'authorization-required' });
  }

  return session.getIdToken(false);
}

export async function authorizedWorkerFetch(pathname, options = {}) {
  const endpoint = workerBridgeUrl(pathname);
  if (!endpoint) throw Object.assign(new Error('Secure storage bridge URL is not configured.'), { code: 'storage-bridge-not-configured' });
  const token = await authorizedAdminToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(endpoint, { ...options, headers, cache: options.cache || 'no-store' });
}

export async function authorizedWorkerRequest(pathname, options = {}) {
  const response = await authorizedWorkerFetch(pathname, options);
  const contentType = response.headers.get('Content-Type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;
  if (!response.ok) {
    const error = new Error(payload?.error || `Storage bridge returned HTTP ${response.status}.`);
    error.code = String(payload?.code || `http-${response.status}`);
    error.source = String(payload?.source || 'worker');
    throw error;
  }
  return payload ?? response;
}
