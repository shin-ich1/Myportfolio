await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin authorization guard did not initialize.")));
const adminSession = window.__LAN_ADMIN_AUTH__ || window.parent?.__LAN_ADMIN_AUTH__ || null;

import {
  deleteAdminPrivateThread,
  markAdminPrivateThreadRead,
  sendAdminPrivateReply,
  subscribeAdminPrivateThread,
  subscribeAdminPrivateThreads
} from "../../message-service.js";
import {
  enablePortfolioPush,
  getAdminPortfolioPushState,
  notifyVisitorOfAdminReply,
  purgeVisitorPushThread,
  testAdminPortfolioPush
} from "../../notification-service.js";
import { bindMessageComposerKeyboard } from "../../message-composer.js";
import { waitForLocalFirebaseCredential } from "../services/firebase.js";

const $ = (id) => document.getElementById(id);
const clean = (value = "") => String(value ?? "").trim();
const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));

let threads = [];
let selectedThreadId = "";
let stopThreads = null;
let stopConversation = null;

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compactWhen(value) {
  const date = toDate(value);
  if (!date) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay ? { hour:"numeric", minute:"2-digit" } : { month:"short", day:"numeric" }).format(date);
}

function fullWhen(value) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle:"medium", timeStyle:"short" }).format(date) : "Sending…";
}

function unreadCount() { return threads.filter((thread) => thread.adminUnread).length; }

function renderUnreadBadge() {
  const badge = $("settingsMessageUnreadBadge");
  if (!badge) return;
  const count = unreadCount();
  badge.textContent = String(Math.min(99, count));
  badge.hidden = count === 0;
}

function renderThreadList() {
  const host = $("settingsMessageThreadList");
  if (!host) return;
  const term = clean($("settingsMessageSearch")?.value).toLowerCase();
  const visible = threads.filter((thread) => !term || [thread.visitorName, thread.preview].some((value) => clean(value).toLowerCase().includes(term)));
  renderUnreadBadge();
  if (!visible.length) {
    host.innerHTML = `<div class="settings-message-empty"><strong>${term ? "No matching conversations" : "No messages yet"}</strong><p>${term ? "Try a different name or message phrase." : "A visitor conversation will appear here after someone uses the Public Portfolio message button."}</p></div>`;
    return;
  }
  host.innerHTML = visible.map((thread) => {
    const name = clean(thread.visitorName) || "Portfolio visitor";
    const initial = esc((name[0] || "?").toUpperCase());
    return `<button class="settings-message-thread-row${thread.adminUnread ? " is-unread" : ""}" type="button" data-message-thread-id="${esc(thread.id)}"><span class="settings-message-avatar">${initial}</span><span class="settings-message-thread-copy"><strong>${esc(name)}</strong><span>${esc(thread.preview || "Private portfolio conversation")}</span></span><span class="settings-message-thread-meta"><time>${esc(compactWhen(thread.updatedAt))}</time>${thread.adminUnread ? '<i aria-label="Unread"></i>' : ""}</span></button>`;
  }).join("");
}

function setMessageScreen(screen = "list") {
  const center = document.querySelector(".settings-message-center");
  const list = document.querySelector("[data-message-list-screen]");
  const conversation = document.querySelector("[data-message-conversation-screen]");
  const back = $("settingsMessageBackButton");
  const isConversation = screen === "conversation";
  if (center) center.dataset.messageScreen = isConversation ? "conversation" : "list";
  if (list) list.hidden = isConversation;
  if (conversation) conversation.hidden = !isConversation;
  if (back) back.hidden = !isConversation;
}

function renderConversation(thread, messages = []) {
  if (!thread) return;
  $("settingsMessageVisitorName").textContent = thread.visitorName || "Portfolio visitor";
  $("settingsMessageAvatar").textContent = (thread.visitorName?.[0] || "?").toUpperCase();
  $("settingsMessageConversationState").textContent = thread.adminUnread ? "New private message" : "Private conversation";
  const host = $("settingsMessageConversation");
  if (host) {
    host.innerHTML = messages.length ? messages.map((message) => message.role === "system"
      ? `<article class="settings-message-system-event"><span>${esc(message.text)}</span><time>${esc(fullWhen(message.createdAt))}</time></article>`
      : `<article class="settings-message-bubble ${message.role === "admin" ? "is-admin" : "is-visitor"}"><div><strong>${message.role === "admin" ? "You" : esc(thread.visitorName || "Visitor")}</strong><time>${esc(fullWhen(message.createdAt))}</time></div><p>${esc(message.text)}</p></article>`).join("") : '<div class="settings-message-empty"><strong>Conversation ready</strong><p>Replies will stay private between you and this visitor.</p></div>';
    requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
  }
}

function openThread(threadId) {
  const thread = threads.find((item) => item.id === String(threadId || ""));
  if (!thread) return;
  selectedThreadId = thread.id;
  stopConversation?.();
  stopConversation = subscribeAdminPrivateThread(thread.id, ({ thread: liveThread, messages }) => {
    if (!liveThread) {
      closeThread();
      return;
    }
    renderConversation(liveThread, messages);
    if (liveThread.adminUnread) markAdminPrivateThreadRead(liveThread.id).catch(() => {});
  }, (error) => {
    $("settingsMessageReplyStatus").textContent = error?.message || "Conversation could not be read.";
  });
  setMessageScreen("conversation");
  markAdminPrivateThreadRead(thread.id).catch(() => {});
}

function closeThread() {
  selectedThreadId = "";
  stopConversation?.();
  stopConversation = null;
  setMessageScreen("list");
  renderThreadList();
}

async function adminAuthorizationHeader() {
  if (!adminSession?.user || typeof adminSession.getIdToken !== "function") {
    throw new Error("Administrator sign-in is required.");
  }
  return `Bearer ${await adminSession.getIdToken(false)}`;
}

async function sendReply(event) {
  event.preventDefault();
  if (!selectedThreadId) return;
  const input = $("settingsMessageReplyInput");
  const button = $("settingsMessageReplyButton");
  const status = $("settingsMessageReplyStatus");
  const body = clean(input?.value);
  if (!body) return;
  if (button) button.disabled = true;
  if (status) status.textContent = "Sending…";
  try {
    await sendAdminPrivateReply(selectedThreadId, body);
    if (input) input.value = "";
    if (status) status.textContent = "Sent · checking device notification…";

    try {
      const authorization = await adminAuthorizationHeader();
      const delivery = await notifyVisitorOfAdminReply({ threadId: selectedThreadId, authorization });
      if (delivery.delivered > 0) {
        if (status) status.textContent = delivery.state === "partial" ? "Sent · device receipt partially verified" : "Sent · device receipt verified";
      } else if (delivery.accepted > 0) {
        if (status) status.textContent = "Sent · push service accepted notification · device receipt pending";
      } else if (delivery.subscriptions === 0) {
        if (status) status.textContent = "Sent · visitor device notifications are not enabled";
      } else {
        if (status) status.textContent = "Sent · device notification could not be sent";
        window.LANNotice?.({ title:"Device notification not sent", message:"The reply was saved, but the push service did not accept the visitor notification. The visitor can still read the reply in the private conversation.", tone:"warning" });
      }
    } catch (notificationError) {
      if (status) status.textContent = "Sent · device notification check failed";
      window.LANNotice?.({ title:"Device notification unavailable", message:notificationError?.message || "The reply was saved, but the device notification service could not be reached.", tone:"warning" });
    }
  } catch (error) {
    if (status) status.textContent = error?.message || "Reply could not be sent.";
  } finally { if (button) button.disabled = false; }
}

async function deleteConversation() {
  const threadId = selectedThreadId;
  if (!threadId) return;
  const thread = threads.find((item) => item.id === threadId);
  const confirmed = window.LANConfirm
    ? await window.LANConfirm({ title:"Delete private conversation?", message:`Delete the complete conversation with ${thread?.visitorName || "this visitor"}? The visitor will no longer be able to reopen it.`, confirmLabel:"Delete Conversation", danger:true })
    : window.confirm("Delete this private conversation permanently?");
  if (!confirmed) return;
  const button = $("settingsDeleteConversationButton");
  if (button) button.disabled = true;
  try {
    await deleteAdminPrivateThread(threadId);
    const authorization = await adminAuthorizationHeader();
    await purgeVisitorPushThread({ threadId, authorization });
    if (selectedThreadId === threadId) closeThread();
    window.LANNotice?.({ title:"Messages", message:"Conversation deleted permanently.", tone:"success" });
  } catch (error) {
    window.LANNotice?.({ title:"Messages", message:error?.message || "Conversation could not be deleted.", tone:"error" });
  } finally { if (button) button.disabled = false; }
}



function renderAdminNotificationStatus(state = {}) {
  const button = $("settingsEnableMessageNotifications");
  if (!button) return;
  if (state.registered === true) {
    button.textContent = "✓";
    button.title = "Message and security notifications are registered for this trusted device";
    button.setAttribute("aria-label", "Device notifications registered");
    return;
  }
  button.textContent = "🔔";
  button.title = state.permission === "denied"
    ? "Browser notifications are blocked for this site"
    : "Enable and test device notifications";
  button.setAttribute("aria-label", "Enable message notifications");
}

async function hydrateAdminNotificationStatus() {
  try {
    const authorization = await adminAuthorizationHeader();
    const state = await getAdminPortfolioPushState({ authorization });
    renderAdminNotificationStatus(state);
  } catch (error) {
    renderAdminNotificationStatus({ registered: false, permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission });
    if (String(error?.message || "").includes("Trust this device")) return;
    console.error("Admin notification status could not be verified:", error);
  }
}

async function enableAdminNotifications() {
  const button = $("settingsEnableMessageNotifications");
  if (button) button.disabled = true;
  try {
    const authorization = await adminAuthorizationHeader();
    await enablePortfolioPush({ audience:"admin", iconUrl:new URL("../../assets/images/hero.png", location.href).href, authorization });
    const delivery = await testAdminPortfolioPush({ authorization });
    if (delivery.delivered > 0) {
      renderAdminNotificationStatus({ registered: true, permission: "granted" });
      window.LANNotice?.({ title:"Messages", message:"Admin device notifications are enabled and a test notification was delivered.", tone:"success" });
    } else if (delivery.accepted > 0) {
      if (button) { button.textContent = "…"; button.title = "Message notifications registered; device receipt pending"; }
      window.LANNotice?.({ title:"Notifications", message:"The test notification was accepted; its device receipt is still pending.", tone:"warning" });
    } else {
      throw new Error(delivery.subscriptions === 0
        ? "This browser has no registered device notification subscription."
        : "The device notification subscription was saved, but the push service did not accept the test notification.");
    }
  } catch (error) {
    window.LANNotice?.({ title:"Notifications", message:error?.message || "Notifications could not be enabled.", tone:"error" });
  } finally { if (button) button.disabled = false; }
}

function openRequestedThread() {
  let requested = "";
  try { requested = new URL(location.href).searchParams.get("messageThread") || ""; } catch {}
  if (requested && threads.some((thread) => thread.id === requested)) openThread(requested);
}

function initCommunications() {
  $("settingsMessageSearch")?.addEventListener("input", renderThreadList);
  $("settingsMessageBackButton")?.addEventListener("click", closeThread);
  const replyForm = $("settingsMessageReplyForm");
  replyForm?.addEventListener("submit", sendReply);
  bindMessageComposerKeyboard(replyForm, $("settingsMessageReplyInput"));
  $("settingsDeleteConversationButton")?.addEventListener("click", deleteConversation);
  $("settingsEnableMessageNotifications")?.addEventListener("click", enableAdminNotifications);
  hydrateAdminNotificationStatus();
  $("settingsMessageThreadList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-message-thread-id]");
    if (row) openThread(row.dataset.messageThreadId);
  });

  stopThreads?.();
  stopThreads = subscribeAdminPrivateThreads((nextThreads) => {
    threads = nextThreads;
    renderThreadList();
    if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) closeThread();
    openRequestedThread();
  }, (error) => {
    const host = $("settingsMessageThreadList");
    if (host) host.innerHTML = `<div class="settings-message-empty"><strong>Messages unavailable</strong><p>${esc(error?.message || "Unable to read private conversations.")}</p></div>`;
  });
}

initCommunications();
