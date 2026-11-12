import { firebaseConfig } from "./config.js";
import { storageBridgeUrl } from "./storage-bridge-url.js";

let db = null;
let firebaseLoad = null;
let addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
    orderBy, query, serverTimestamp, updateDoc, writeBatch;

function ensureMessagingFirestore() {
  if (!firebaseLoad) {
    firebaseLoad = Promise.all([
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js")
    ]).then(([appModule, firestoreModule]) => {
      const firebaseApp = appModule.getApps().length
        ? appModule.getApps()[0]
        : appModule.initializeApp(firebaseConfig);
      db = firestoreModule.getFirestore(firebaseApp);
      ({ addDoc, collection, deleteDoc, doc, getDoc, getDocs,
         onSnapshot, orderBy, query, serverTimestamp,
         updateDoc, writeBatch } = firestoreModule);
    }).catch(error => {
      firebaseLoad = null;
      throw error;
    });
  }
  return firebaseLoad;
}

function deferredFirestoreSubscription(start, onError) {
  let cancelled = false;
  let unsubscribe = null;
  void ensureMessagingFirestore().then(() => {
    if (cancelled) return;
    unsubscribe = start();
    if (cancelled) {
      unsubscribe?.();
      unsubscribe = null;
    }
  }).catch(error => {
    if (!cancelled) onError?.(error);
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
    unsubscribe = null;
  };
}

export const PRIVATE_MESSAGE_COLLECTION = "privateMessageThreads";
export const PUBLIC_MESSAGE_THREAD_KEY = "lan-private-message-thread-v1";
export const PUBLIC_MESSAGE_NAME_KEY = "lan-private-message-name-v1";

const text = (value = "") => String(value ?? "").trim();

function validateThreadId(value = "") {
  const id = text(value);
  return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : "";
}

function normalizeMessageText(value = "") {
  return text(value).slice(0, 2000);
}

function threadRef(threadId) {
  const id = validateThreadId(threadId);
  if (!id) throw new Error("Private conversation identity is invalid.");
  return doc(db, PRIVATE_MESSAGE_COLLECTION, id);
}

function messagesRef(threadId) {
  const id = validateThreadId(threadId);
  if (!id) throw new Error("Private conversation identity is invalid.");
  return collection(db, PRIVATE_MESSAGE_COLLECTION, id, "messages");
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

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePrivateThread(snapshotOrData, id = "") {
  const data = typeof snapshotOrData?.data === "function" ? snapshotOrData.data() : (snapshotOrData || {});
  const threadId = id || snapshotOrData?.id || "";
  return {
    id: threadId,
    visitorName: text(data.visitorName || "Portfolio visitor") || "Portfolio visitor",
    adminUnread: data.adminUnread === true,
    visitorUnread: data.visitorUnread === true,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    lastVisitorMessageAt: data.lastVisitorMessageAt || null,
    lastAdminMessageAt: data.lastAdminMessageAt || null,
    status: text(data.status || "open") || "open",
    preview: text(data.preview || "")
  };
}

export function normalizePrivateMessage(snapshotOrData, id = "") {
  const data = typeof snapshotOrData?.data === "function" ? snapshotOrData.data() : (snapshotOrData || {});
  const role = data.role === "admin" ? "admin" : data.role === "system" ? "system" : "visitor";
  return {
    id: id || snapshotOrData?.id || "",
    role,
    text: text(data.text),
    createdAt: data.createdAt || null,
    createdAtMs: timestampMs(data.createdAt)
  };
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

export async function getPrivateVisitorThread(threadId) {
  await ensureMessagingFirestore();
  const snapshot = await getDoc(threadRef(threadId));
  if (!snapshot.exists()) return null;
  return normalizePrivateThread(snapshot);
}

export async function getPrivateThreadMessages(threadId) {
  await ensureMessagingFirestore();
  const snapshot = await getDocs(query(messagesRef(threadId), orderBy("createdAt", "asc")));
  return snapshot.docs.map((entry) => normalizePrivateMessage(entry));
}

export function subscribePrivateVisitorThread(threadId, onChange, onError) {
  const id = validateThreadId(threadId);
  if (!id) return () => {};
  return deferredFirestoreSubscription(() => {
  let latestThread = null;
  let latestMessages = [];
  let initialThreadReceived = false;
  // The messages listener can fire first. Absence of an initial thread
  // snapshot is not evidence of deletion, so it must never revoke UI access.
  const emit = () => {
    if (initialThreadReceived) onChange?.({ thread: latestThread, messages: latestMessages });
  };
  let stopThread = null;
  let stopMessages = null;
  let closed = false;

  const stopBoth = () => {
    if (closed) return;
    closed = true;
    const subscriptions = [stopThread, stopMessages];
    stopThread = null;
    stopMessages = null;
    for (const stop of subscriptions) {
      try {
        stop?.();
      } catch (cleanupError) {
        console.error("Private messaging listener cleanup failed.", cleanupError);
      }
    }
  };

  const handleListenerError = (error) => {
    if (closed) return;
    stopBoth();
    onError?.(error);
  };

  const startListener = (subscribe) => {
    const stop = subscribe();
    if (closed) {
      try {
        stop?.();
      } catch (cleanupError) {
        console.error("Private messaging listener cleanup failed.", cleanupError);
      }
      return null;
    }
    return stop;
  };

  try {
    stopThread = startListener(() => onSnapshot(threadRef(id), (snapshot) => {
      if (closed) return;
      latestThread = snapshot.exists() ? normalizePrivateThread(snapshot) : null;
      initialThreadReceived = true;
      emit();
    }, handleListenerError));

    if (!closed) {
      stopMessages = startListener(() => onSnapshot(query(messagesRef(id), orderBy("createdAt", "asc")), (snapshot) => {
        if (closed) return;
        latestMessages = snapshot.docs.map((entry) => normalizePrivateMessage(entry));
        emit();
      }, handleListenerError));
    }
  } catch (error) {
    stopBoth();
    throw error;
  }

  return stopBoth;
  }, onError);
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

export function subscribeAdminPrivateThreads(onChange, onError) {
  return deferredFirestoreSubscription(() =>
    onSnapshot(query(collection(db, PRIVATE_MESSAGE_COLLECTION), orderBy("updatedAt", "desc")), (snapshot) => {
      onChange?.(snapshot.docs.map((entry) => normalizePrivateThread(entry)));
    }, onError), onError);
}

export function subscribeAdminPrivateThread(threadId, onChange, onError) {
  return subscribePrivateVisitorThread(threadId, onChange, onError);
}

export async function sendAdminPrivateReply(threadId, message) {
  await ensureMessagingFirestore();
  const body = normalizeMessageText(message);
  if (!body) throw new Error("Write a reply first.");
  const ref = threadRef(threadId);
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error("This conversation no longer exists.");
  await addDoc(messagesRef(threadId), { role: "admin", text: body, createdAt: serverTimestamp() });
  await updateDoc(ref, {
    visitorUnread: true,
    preview: body.slice(0, 160),
    updatedAt: serverTimestamp(),
    lastAdminMessageAt: serverTimestamp()
  });
}

export async function markAdminPrivateThreadRead(threadId) {
  await ensureMessagingFirestore();
  const ref = threadRef(threadId);
  const current = await getDoc(ref);
  if (!current.exists()) return;
  await updateDoc(ref, { adminUnread: false });
}

export async function deleteAdminPrivateThread(threadId) {
  await ensureMessagingFirestore();
  const id = validateThreadId(threadId);
  if (!id) throw new Error("Conversation identity is invalid.");
  const messageSnapshot = await getDocs(messagesRef(id));
  const docs = messageSnapshot.docs;
  for (let offset = 0; offset < docs.length; offset += 450) {
    const batch = writeBatch(db);
    docs.slice(offset, offset + 450).forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  await deleteDoc(threadRef(id));
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
