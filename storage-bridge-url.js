import { telemetryBridgeConfig } from './config.js';

const text = (value = '') => String(value ?? '').trim();

export const STORAGE_BRIDGE_OVERRIDE_KEY = 'lan-cms-telemetry-bridge-url';

function runtimeLocation() {
  return typeof location !== 'undefined' ? location : null;
}

function runtimeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function isLocalPortfolioRuntime(locationRef = runtimeLocation()) {
  if (!locationRef) return false;
  const protocol = text(locationRef.protocol).toLowerCase();
  const host = text(locationRef.hostname).toLowerCase();
  if (protocol === 'file:') return true;
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
}

/**
 * Canonical Storage/telemetry bridge configuration.
 *
 * Settings, Admin media and Public media all read the same persisted override,
 * then fall back to the environment default. This keeps a connected Google
 * Drive profile renderable on every surface instead of allowing Admin and
 * Public to disagree about where the Worker lives.
 */
export function configuredStorageBridgeUrl({ locationRef = runtimeLocation(), storage = runtimeStorage() } = {}) {
  // A generated staging build must never use a persisted production URL override.
  // The canonical bridge owner enforces this without changing production behavior.
  if (telemetryBridgeConfig.enforceConfiguredBridge === true) {
    return text(telemetryBridgeConfig.productionUrl);
  }
  let override = '';
  try { override = text(storage?.getItem?.(STORAGE_BRIDGE_OVERRIDE_KEY)); } catch {}
  if (override) return override;
  return text(isLocalPortfolioRuntime(locationRef) ? telemetryBridgeConfig.localUrl : telemetryBridgeConfig.productionUrl);
}

export function storageBridgeOrigin(options = {}) {
  const configured = configuredStorageBridgeUrl(options);
  if (!configured) return '';
  try {
    const locationRef = options.locationRef || runtimeLocation();
    const baseHref = text(locationRef?.href) || 'http://127.0.0.1/';
    return new URL(configured, baseHref).origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function storageBridgeUrl(pathname = '/', options = {}) {
  const configured = configuredStorageBridgeUrl(options);
  if (!configured) return '';
  try {
    const locationRef = options.locationRef || runtimeLocation();
    const baseHref = text(locationRef?.href) || 'http://127.0.0.1/';
    const url = new URL(configured, baseHref);
    url.pathname = String(pathname || '/').startsWith('/') ? pathname : `/${pathname}`;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}
