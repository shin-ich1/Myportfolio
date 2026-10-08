await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));
const adminSession = window.__LAN_ADMIN_AUTH__ || null;

import { subscribeAdminPrivateThreads } from "../../message-service.js";
import { rehydratePortfolioPush } from "../../notification-service.js";

const badge = document.querySelector("[data-admin-message-unread]");
const visitorMessageVersions = new Map();
let initialized = false;

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value?.toDate === "function") return Number(value.toDate()?.getTime?.()) || 0;
  if (Number.isFinite(Number(value?.seconds))) return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderUnread(threads = []) {
  const unread = threads.filter((thread) => thread.adminUnread).length;
  if (badge) {
    badge.hidden = unread === 0;
    badge.textContent = String(Math.min(99, unread));
    badge.setAttribute("aria-label", `${unread} unread message${unread === 1 ? "" : "s"}`);
  }

  const activeIds = new Set();
  const arrivals = [];
  for (const thread of threads) {
    const id = String(thread?.id || "");
    if (!id) continue;
    activeIds.add(id);
    const nextVersion = timestampMillis(thread.lastVisitorMessageAt);
    const previousVersion = visitorMessageVersions.get(id) || 0;
    if (initialized && nextVersion > previousVersion && thread.adminUnread) {
      arrivals.push({ thread, version: nextVersion });
    }
    visitorMessageVersions.set(id, nextVersion);
  }
  for (const id of visitorMessageVersions.keys()) if (!activeIds.has(id)) visitorMessageVersions.delete(id);

  if (initialized && arrivals.length) {
    const newest = arrivals.sort((left, right) => right.version - left.version)[0].thread;
    window.LANNotice?.({
      title: "LΛN Portfolio CMS",
      message: newest?.visitorName ? `New message from ${newest.visitorName}.` : "New private portfolio message.",
      tone: "info"
    });
  }
  initialized = true;
}

async function rehydrateAdminPushRegistration() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !adminSession?.user || typeof adminSession.getIdToken !== "function") return;
  const authorization = `Bearer ${await adminSession.getIdToken(false)}`;
  await rehydratePortfolioPush({
    audience: "admin",
    iconUrl: new URL("../../assets/images/hero.png", location.href).href,
    authorization
  });
}

// Push permission is user-controlled, but once the browser has granted it the
// Admin notification owner silently restores the Worker registration on every
// authenticated shell startup. No bell click is required after a new build.
rehydrateAdminPushRegistration().catch((error) => {
  console.error("Admin push registration could not be restored:", error);
  window.LANNotice?.({
    title: "Device notifications unavailable",
    message: error?.message || "This browser could not restore the Admin device notification subscription.",
    tone: "warning"
  });
});

subscribeAdminPrivateThreads(renderUnread, () => {
  if (badge) badge.hidden = true;
});
