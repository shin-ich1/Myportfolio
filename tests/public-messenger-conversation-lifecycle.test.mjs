import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const service = readFileSync(new URL("../message-service.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function composerHarness() {
  const match = app.match(/async function openPublicMessageComposer\(\) \{[\s\S]*?\n\}\n\nasync function submitPublicMessage\(/);
  assert.ok(match, "The existing canonical conversation opener must remain unique");
  const source = match[0].slice(0, -("\nasync function submitPublicMessage(".length));
  const state = { dialog: { innerHTML: "", isConnected: true, querySelector: () => null }, subscription: null, rendered: [], timeouts: [], closed: 0, notices: [] };
  const Notification = { permission: "granted" };
  const ctx = {
    Notification,
    window: {
      Notification,
      setTimeout(fn, delay) { state.timeouts.push({ fn, delay }); return state.timeouts.length; },
      clearTimeout() {},
      lucide: { createIcons() {} }
    },
    document: { querySelector: () => state.dialog },
    show: () => {},
    loadVisitorConversationIdentity: () => ({ id: "valid-visitor-thread", visitorName: "Visitor" }),
    publicMessageLoadingMarkup: () => "Opening private conversation…",
    destroyPublicMessagePuzzleVerification: () => {},
    getPrivateVisitorThread: () => new Promise(() => {}), // Firestore getDoc never settles in a webview
    rehydratePortfolioPush: () => new Promise(() => {}), // Notification setup never settles
    publicMessageIconUrl: () => "/assets/images/hero.png",
    subscribePrivateVisitorThread(id, onChange, onError) {
      state.subscription = { id, onChange, onError };
      return () => { state.closed++; };
    },
    renderPublicPrivateConversation: (thread, messages) => { state.rendered.push({ thread, messages }); },
    updatePublicMessageLauncherUnread: () => {},
    markPrivateVisitorThreadRead: () => Promise.resolve(),
    clearVisitorConversationIdentity: () => { state.clearedIdentity = true; },
    publicMessageClosedMarkup: () => "Closed",
    renderPublicMessageStart: () => { state.startedNew = true; },
    escapeHtml: value => value
  };
  const api = vm.runInNewContext(`let publicMessageStop = null, publicMessagePushState = "unregistered", publicMessagePushError = ""; ${source}; ({ openPublicMessageComposer });`, ctx);
  return { ...api, state };
}

test("In-app browser subscribes to Firestore without awaiting stalled getDoc or push setup", async () => {
  const h = composerHarness();
  void h.openPublicMessageComposer();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(h.state.subscription, "Must subscribe even if initial getDoc and push setup stall");
  await h.state.subscription.onChange({ thread: { id: "valid-visitor-thread", visitorUnread: false }, messages: [{ text: "Hello" }] });
  assert.equal(h.state.rendered.length, 1, "First authorized snapshot opens conversation");
});

test("Conversation-loading has a bounded failure state and actionable retry", async () => {
  const h = composerHarness();
  void h.openPublicMessageComposer();
  await Promise.resolve();
  assert.ok(h.state.timeouts.some(t => t.delay >= 8000 && t.delay <= 20000), "Prevent infinite Opening private conversation spinner");
  const timeout = h.state.timeouts.find(t => t.delay >= 8000 && t.delay <= 20000);
  timeout.fn();
  assert.match(h.state.dialog.innerHTML, /retry|try again/i);
  assert.notEqual(h.state.clearedIdentity, true, "A timeout must never erase a valid visitor identity");
});

test("Firestore snapshot owner must not confuse first messages snapshot with a deleted conversation", () => {
  const match = service.match(/export function subscribePrivateVisitorThread\(threadId, onChange, onError\) \{[\s\S]*?\n\}\n\nexport async function sendPrivateVisitorMessage\(/);
  assert.ok(match, "Single canonical Firestore subscription owner required");
  const fn = match[0].slice(0, -("\nexport async function sendPrivateVisitorMessage(".length)).replace("export function ", "function ");
  const observers = [];
  const received = [];
  const ctx = {
    validateThreadId: id => id,
    threadRef: () => "thread",
    messagesRef: () => "messages",
    query: (...args) => args[0],
    orderBy: () => "createdAt",
    onSnapshot(ref, next, error) {
      observers.push({ ref, next, error });
      return () => {};
    },
    normalizePrivateThread: snapshot => snapshot.data(),
    normalizePrivateMessage: item => item.data()
  };
  const api = vm.runInNewContext(fn + "; ({ subscribePrivateVisitorThread });", ctx);
  api.subscribePrivateVisitorThread("valid-id", result => received.push(result), error => { throw error; });
  assert.equal(observers.length, 2);
  const msg = observers.find(o => o.ref === "messages");
  const thread = observers.find(o => o.ref === "thread");
  msg.next({ docs: [{ data: () => ({ role: "visitor", text: "Hello" }) }] });
  assert.equal(received.length, 0, "Messages arriving before thread cannot trigger destructive null-thread path");
  thread.next({ exists: () => true, data: () => ({ id: "valid-id", visitorUnread: false }) });
  assert.equal(received.length, 1);
  assert.equal(received[0].thread.id, "valid-id");
  assert.equal(received[0].messages.length, 1);
});
