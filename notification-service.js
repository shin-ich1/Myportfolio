import { storageBridgeUrl } from "./storage-bridge-url.js";

const text = (value = "") => String(value ?? "").trim();
const PUSH_VAPID_STORAGE_KEY = "lan-portfolio-push-vapid-public-key-v1";
const registrationInFlight = new Map();

function base64UrlToBytes(value = "") {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || 0);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || 0);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function rememberedVapidKey() {
  try { return text(localStorage.getItem(PUSH_VAPID_STORAGE_KEY)); } catch { return ""; }
}

function rememberVapidKey(publicKey = "") {
  try { localStorage.setItem(PUSH_VAPID_STORAGE_KEY, text(publicKey)); } catch {}
}

function subscriptionMatchesVapidKey(subscription, publicKey) {
  if (!subscription) return false;
  const expected = base64UrlToBytes(publicKey);
  const actual = subscription.options?.applicationServerKey;
  if (actual) return bytesEqual(new Uint8Array(actual), expected);
  const remembered = rememberedVapidKey();
  return Boolean(remembered) && remembered === publicKey;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function normalizePortfolioPushDelivery(payload = {}) {
  const subscriptions = nonNegativeInteger(payload?.subscriptions);
  const accepted = nonNegativeInteger(payload?.accepted);
  const delivered = nonNegativeInteger(payload?.delivered);
  const failed = nonNegativeInteger(payload?.failed);
  const stale = nonNegativeInteger(payload?.stale);
  let state = "unregistered";
  if (delivered > 0) state = failed > 0 || stale > 0 || delivered < accepted ? "partial" : "delivered";
  else if (accepted > 0) state = "accepted";
  else if (failed > 0) state = "failed";
  else if (stale > 0) state = "stale";
  else if (subscriptions > 0) state = "undelivered";
  return Object.freeze({ state, subscriptions, accepted, delivered, failed, stale });
}

function notificationBridgeError() {
  const host = typeof location !== "undefined" ? text(location.hostname).toLowerCase() : "";
  const local = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host);
  return local ? "Notification bridge is not configured." : "Push bridge not configured for production.";
}

async function pushConfig() {
  const url = storageBridgeUrl("/messages/push/config");
  if (!url) throw new Error(notificationBridgeError());
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.publicKey) throw new Error(payload.error || "Notification service is unavailable.");
  return payload;
}

export async function ensurePortfolioServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("This browser does not support website notifications.");
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new Error("Device notifications require HTTPS (or localhost during local development).");
  }
  let registration = await navigator.serviceWorker.getRegistration("/").catch(() => null);
  if (!registration) registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await registration.update?.().catch(() => {});
  const ready = await navigator.serviceWorker.ready;
  return ready || registration;
}

async function registerPortfolioPushNow({ audience, threadId = "", iconUrl = "", authorization = "", requestPermission = false } = {}) {
  if (!("Notification" in window) || !("PushManager" in window)) throw new Error("Push notifications are not supported by this browser.");

  let permission = Notification.permission;
  if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
  if (permission !== "granted") {
    if (requestPermission) throw new Error("Notification permission was not granted.");
    return null;
  }

  const registration = await ensurePortfolioServiceWorker();
  const { publicKey } = await pushConfig();
  let subscription = await registration.pushManager.getSubscription();

  if (subscription && !subscriptionMatchesVapidKey(subscription, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey)
    });
  }

  const endpoint = storageBridgeUrl("/messages/push/register");
  if (!endpoint) throw new Error(notificationBridgeError());
  const headers = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ audience, threadId, iconUrl: text(iconUrl), subscription: subscription.toJSON() })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload.error || "Notification subscription could not be saved.");
  rememberVapidKey(publicKey);
  return subscription;
}

function registrationKey({ audience = "", threadId = "" } = {}) {
  return `${text(audience)}:${text(threadId)}`;
}

function registerPortfolioPush(options = {}) {
  const key = registrationKey(options);
  if (registrationInFlight.has(key)) return registrationInFlight.get(key);
  const promise = registerPortfolioPushNow(options).finally(() => {
    if (registrationInFlight.get(key) === promise) registrationInFlight.delete(key);
  });
  registrationInFlight.set(key, promise);
  return promise;
}

export function enablePortfolioPush(options = {}) {
  return registerPortfolioPush({ ...options, requestPermission: true });
}

export function rehydratePortfolioPush(options = {}) {
  return registerPortfolioPush({ ...options, requestPermission: false });
}

export async function getAdminPortfolioPushState({ authorization } = {}) {
  if (!authorization) return Object.freeze({ registered: false, permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission, reason: "unauthorized" });
  if (!("Notification" in window) || !("PushManager" in window)) return Object.freeze({ registered: false, permission: "unsupported", reason: "unsupported" });
  const permission = Notification.permission;
  if (permission !== "granted") return Object.freeze({ registered: false, permission, reason: "permission" });
  const registration = await navigator.serviceWorker?.getRegistration?.("/").catch(() => null);
  const subscription = await registration?.pushManager?.getSubscription?.().catch(() => null);
  if (!subscription?.endpoint) return Object.freeze({ registered: false, permission, reason: "subscription" });
  const endpoint = storageBridgeUrl("/messages/push/status");
  if (!endpoint) throw new Error(notificationBridgeError());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload.error || "Device notification status could not be verified.");
  return Object.freeze({ registered: payload.registered === true, permission, reason: payload.registered === true ? "registered" : "server" });
}

export async function testAdminPortfolioPush({ authorization } = {}) {
  const endpoint = storageBridgeUrl("/messages/push/test");
  if (!endpoint) throw new Error(notificationBridgeError());
  if (!authorization) throw new Error("Administrator authorization is required for the notification test.");
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: authorization } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload.error || "Device notification test could not be sent.");
  return normalizePortfolioPushDelivery(payload);
}

export async function disablePortfolioPushForThread({ threadId } = {}) {
  const id = text(threadId);
  if (!id) return true;
  const registration = await navigator.serviceWorker?.getRegistration?.("/").catch(() => null);
  const subscription = await registration?.pushManager?.getSubscription?.().catch(() => null);
  if (!subscription?.endpoint) return true;
  const endpoint = storageBridgeUrl("/messages/push/unregister");
  if (!endpoint) throw new Error(notificationBridgeError());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId: id, endpoint: subscription.endpoint })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload.error || "Reply notifications could not be disconnected.");
  return true;
}

export async function notifyVisitorOfAdminReply({ threadId, authorization }) {
  const endpoint = storageBridgeUrl("/messages/push/reply");
  if (!endpoint) throw new Error(notificationBridgeError());
  if (!authorization) throw new Error("Administrator authorization is required for device notifications.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({ threadId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload.error || "Reply notification could not be sent.");
  return normalizePortfolioPushDelivery(payload);
}

export async function purgeVisitorPushThread({ threadId, authorization }) {
  const endpoint = storageBridgeUrl("/messages/push/thread-delete");
  if (!endpoint) throw new Error(notificationBridgeError());
  if (!authorization) throw new Error("Administrator authorization is required to remove notification registrations.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({ threadId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload.error || "Notification registrations could not be removed.");
  return true;
}
