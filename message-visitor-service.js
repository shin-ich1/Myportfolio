import { storageBridgeUrl } from "./storage-bridge-url.js";

export const PUBLIC_MESSAGE_THREAD_KEY = "lan-private-message-thread-v1";
export const PUBLIC_MESSAGE_NAME_KEY = "lan-private-message-name-v1";

export const text = (value = "") => String(value ?? "").trim();

export function validateThreadId(value = "") {
  const id = text(value);
  return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : "";
}

export function normalizeMessageText(value = "") {
  return text(value).slice(0, 2000);
}

function workerEndpoint(pathname) {
  const url = storageBridgeUrl(pathname);
  if (!url) throw new Error("Secure messaging service is not configured.");
  return url;
}

async function workerJson(pathname, { method = "GET", body } = {}) {
  const response = await fetch(workerEndpoint(pathname), {
    method,
    cache: "no-store",
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Secure messaging request failed.");
    error.code = String(payload.code || "message-request-failed");
    error.status = response.status;
    error.retryAt = String(payload.retryAt || "");
    error.challenge = payload?.challenge && typeof payload.challenge === "object" ? payload.challenge : null;
    throw error;
  }
  return payload;
}

export async function createPrivateMessageChallenge() {
  return workerJson("/messages/security/challenge", { method: "POST" });
}

export async function verifyPrivateMessageChallenge({ challengeId, answer, turnstileToken }) {
  const id = text(challengeId);
  const response = text(turnstileToken);
  if (!id) throw new Error("Human verification challenge is missing.");
  if (!Number.isFinite(Number(answer))) throw new Error("Complete the puzzle first.");
  // A wrong answer is rejected by the Worker before Siteverify, so it may
  // be checked without waiting for a browser token. Correct answers still
  // require a real Turnstile token server-side before any proof is issued.
  return workerJson("/messages/security/verify", {
    method: "POST",
    body: { challengeId: id, answer: Number(answer), turnstileToken: response }
  });
}

export async function createPrivateVisitorThread({ name, message, verificationToken, website = "" }) {
  const visitorName = text(name).slice(0, 80);
  const body = normalizeMessageText(message);
  if (!visitorName) throw new Error("Enter your name.");
  if (!body) throw new Error("Write a message first.");
  if (!text(verificationToken)) throw new Error("Complete the human verification first.");
  const payload = await workerJson("/messages/public/thread", {
    method: "POST",
    body: { name: visitorName, message: body, verificationToken: text(verificationToken), website: text(website) }
  });
  const id = validateThreadId(payload.id);
  if (!id) throw new Error("Secure messaging returned an invalid conversation identity.");
  return {
    id,
    visitorName: text(payload.visitorName || visitorName).slice(0, 80) || visitorName,
    notification: payload.notification || null
  };
}

export async function sendPrivateVisitorMessage(threadId, message) {
  const id = validateThreadId(threadId);
  const body = normalizeMessageText(message);
  if (!id) throw new Error("Private conversation identity is invalid.");
  if (!body) throw new Error("Write a message first.");
  return workerJson("/messages/public/send", { method: "POST", body: { threadId: id, message: body } });
}

export async function markPrivateVisitorThreadRead(threadId) {
  const id = validateThreadId(threadId);
  if (!id) return;
  await workerJson("/messages/public/read", { method: "POST", body: { threadId: id } });
}

export async function forgetPrivateVisitorThread(threadId) {
  const id = validateThreadId(threadId);
  if (!id) throw new Error("Private conversation identity is invalid.");
  return workerJson("/messages/public/forget", { method: "POST", body: { threadId: id } });
}

export function storeVisitorConversationIdentity({ id, visitorName }) {
  const threadId = validateThreadId(id);
  if (!threadId) return;
  try {
    localStorage.setItem(PUBLIC_MESSAGE_THREAD_KEY, threadId);
    if (visitorName) localStorage.setItem(PUBLIC_MESSAGE_NAME_KEY, text(visitorName).slice(0, 80));
  } catch {}
}

export function loadVisitorConversationIdentity() {
  try {
    return {
      id: validateThreadId(localStorage.getItem(PUBLIC_MESSAGE_THREAD_KEY) || ""),
      visitorName: text(localStorage.getItem(PUBLIC_MESSAGE_NAME_KEY) || "")
    };
  } catch { return { id: "", visitorName: "" }; }
}

export function clearVisitorConversationIdentity() {
  try {
    localStorage.removeItem(PUBLIC_MESSAGE_THREAD_KEY);
    localStorage.removeItem(PUBLIC_MESSAGE_NAME_KEY);
  } catch {}
}
