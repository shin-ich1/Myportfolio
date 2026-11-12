import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const app = read("app.js");
const full = read("message-service.js");
const visitorUrl = new URL("../message-visitor-service.js", import.meta.url);
const visitor = () => existsSync(visitorUrl) ? readFileSync(visitorUrl, "utf8") : "";

test("Initial Public app graph has no static full messaging/Firestore SDK dependency", () => {
  assert.doesNotMatch(app.slice(0, app.indexOf("const app =")), /from ["']\.\/message-service\.js["']/);
  assert.match(app.slice(0, app.indexOf("const app =")), /from "\.\/message-visitor-service\.js"/);
  assert.ok(existsSync(visitorUrl), "Browser-safe visitor messaging must have an independent lightweight owner");
  assert.doesNotMatch(visitor(), /www\.gstatic\.com\/firebasejs|from ["']\.\/message-service\.js|onSnapshot\(|getFirestore\(/);
  assert.match(app, /await import\("\.\/message-service\.js"\)/, "Import full messaging only when existing thread is opened");
  assert.equal((app.match(/import\("\.\/message-service\.js"\)/g)||[]).length, 1);
  assert.doesNotMatch(app.slice(app.indexOf("async function initFirebase()"), app.indexOf("async function loadPublicPortfolioData(")),
    /message-service\.js/, "Main portfolio initialization must remain separate from messaging");
});

test("Canonical visitor worker bridge owns challenges and browser identity without duplicating them in Firestore owner", () => {
  const light = visitor();
  assert.match(light, /createPrivateMessageChallenge\(/);
  assert.match(light, /verifyPrivateMessageChallenge\(/);
  assert.match(light, /createPrivateVisitorThread\(/);
  assert.match(light, /sendPrivateVisitorMessage\(/);
  assert.match(light, /storeVisitorConversationIdentity\(/);
  assert.match(light, /loadVisitorConversationIdentity\(/);
  assert.match(light, /clearVisitorConversationIdentity\(/);
  assert.match(light, /markPrivateVisitorThreadRead\(/);
  assert.match(light, /forgetPrivateVisitorThread\(/);
  assert.match(light, /workerJson\("\/messages\/security\/verify"/);
  assert.match(light, /workerJson\("\/messages\/public\/thread"/);
  for (const name of ["createPrivateMessageChallenge", "verifyPrivateMessageChallenge", "createPrivateVisitorThread",
    "sendPrivateVisitorMessage", "loadVisitorConversationIdentity", "clearVisitorConversationIdentity"]) {
    assert.doesNotMatch(full, new RegExp("(?:export\\s+)?(?:async\\s+)?function\\s+" + name + "\\s*\\("));
  }
  assert.match(full, /subscribeAdminPrivateThreads\(/);
  assert.match(full, /subscribePrivateVisitorThread\(/);
  assert.match(full, /from "\.\/message-visitor-service\.js"/);
});

test("Existing puzzle prewarm remains Worker-only; no altered retry, anti-bot, or visibility owners", () => {
  const puzzle=app.slice(app.indexOf("const PUBLIC_MESSAGE_TURNSTILE_SRC"),app.indexOf("\nfunction publicServicesValid("));
  assert.match(puzzle, /const \[challenge, turnstile\] = await Promise\.all\(\[createPrivateMessageChallenge\(\), loadPublicMessageTurnstileApi\(\)\]\)/);
  assert.match(puzzle, /warmPublicMessagePuzzleChallenge\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(app, /addEventListener\("pointerenter", warmMessageVerification/);
  assert.match(app, /addEventListener\("focus", warmMessageVerification/);
  assert.match(puzzle, /await verifyPrivateMessageChallenge\(/);
  assert.match(puzzle, /await sendPendingPublicMessage\(verified\.verificationToken\)/);
  assert.match(puzzle, /const \{ subscribePrivateVisitorThread \} = await import\("\.\/message-service\.js"\)/);
  assert.match(puzzle, /publicMessageStop = subscribePrivateVisitorThread\(identity\.id/);
  assert.match(puzzle, /clearVisitorConversationIdentity\(\)/);
});

test("Canonical visitor challenge and identity behavior remains unchanged in executing source", async () => {
  const source=visitor();
  assert.ok(source);
  const executable=source.replace(/^import .*;\s*$/gm,"").replace(/^export /gm,"");
  const memory=new Map(), paths=[];
  const service=new Function("storageBridgeUrl","fetch","localStorage",
    executable + "\nreturn { createPrivateMessageChallenge, verifyPrivateMessageChallenge, createPrivateVisitorThread, storeVisitorConversationIdentity, loadVisitorConversationIdentity, clearVisitorConversationIdentity };")(
      path=> "https://worker.invalid"+path,
      async (url, options)=>{
        paths.push({url,options});
        const payload=url.endsWith("/messages/public/thread")
          ? {id:"a".repeat(43),visitorName:"Test Visitor"} : {challengeId:"challenge",siteKey:"site"};
        return {ok:true,status:200,json:async()=>payload};
      },
      {getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)}
    );
  assert.deepEqual(Array.from(Object.keys(service.loadVisitorConversationIdentity())),["id","visitorName"]);
  const challenge=await service.createPrivateMessageChallenge();
  assert.equal(challenge.challengeId,"challenge");
  await service.verifyPrivateMessageChallenge({challengeId:"challenge",answer:42,turnstileToken:"token"});
  assert.equal(paths.at(-1).options.body,JSON.stringify({challengeId:"challenge",answer:42,turnstileToken:"token"}));
  const thread=await service.createPrivateVisitorThread({name:"Test Visitor",message:"Hello",verificationToken:"proof"});
  service.storeVisitorConversationIdentity(thread);
  assert.equal(service.loadVisitorConversationIdentity().id,"a".repeat(43));
  service.clearVisitorConversationIdentity();
  assert.equal(service.loadVisitorConversationIdentity().id,"");
  assert.deepEqual(paths.map(x=>new URL(x.url).pathname),[
    "/messages/security/challenge","/messages/security/verify","/messages/public/thread"
  ]);
});

test("Admin subscriptions remain on original authenticated Firestore owner", () => {
  assert.match(full,/export function subscribeAdminPrivateThreads\(/);
  assert.match(full,/export function subscribeAdminPrivateThread\(/);
  assert.match(full,/export async function sendAdminPrivateReply\(/);
  assert.match(full,/export async function deleteAdminPrivateThread\(/);
  const admin=read("admin/js/settings-communications.js");
  assert.match(admin,/from "\.\.\/\.\.\/message-service\.js"/);
  assert.match(full,/onSnapshot\(/);
});


test("Every local static import reachable before first Public render stays free of Firebase SDK", () => {
  const visited = new Set();
  const directImports = [];
  const visit = url => {
    const key = url.href;
    if (visited.has(key)) return;
    visited.add(key);
    const code = readFileSync(url, "utf8");
    const pattern = /^import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["'];/gm;
    for (const match of code.matchAll(pattern)) {
      const target = match[1];
      directImports.push({from: url.pathname.split("/").at(-1), target});
      assert.doesNotMatch(target, /^https:\/\/www\.gstatic\.com\/firebasejs\//,
        "Initial Public graph must not statically load the Firebase SDK: " + key);
      if (target.startsWith("./") || target.startsWith("../")) visit(new URL(target, url));
    }
  };
  visit(new URL("../app.js", import.meta.url));
  assert.ok(visited.size > 12, "Walk must cover the real initial Public dependency graph");
  assert.ok(directImports.some(item => item.target === "./message-visitor-service.js"));
  assert.ok(!directImports.some(item => item.target === "./message-service.js"));
});

test("Conversation listener import is cancellable after timeout or modal closure", () => {
  const begin = app.indexOf("async function openPublicMessageComposer() {");
  const end = app.indexOf("\nasync function submitPublicMessage(", begin);
  assert.ok(begin >= 0 && end > begin);
  const source = app.slice(begin,end);
  assert.match(source,/let messagingLoadTimedOut = false;/);
  assert.match(source,/messagingLoadTimedOut = true;/);
  assert.match(source,/if \(messagingLoadTimedOut \|\| !dialog\.isConnected\) return;/);
  assert.ok(source.indexOf('await import("./message-service.js")') < source.indexOf('publicMessageStop = subscribePrivateVisitorThread'));
  assert.match(source,/publicMessageStop\?\.\(\);/);
});
