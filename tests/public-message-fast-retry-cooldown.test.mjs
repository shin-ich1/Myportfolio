// Regression first on deployed PR45 Public Message canonical owners.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const service=readFileSync(new URL("../message-service.js",import.meta.url),"utf8");
const begin=app.indexOf("async function loadPublicMessagePuzzleChallenge(");
const end=app.indexOf("\nasync function openPublicMessagePuzzleVerification(",begin);
assert.ok(begin>=0&&end>begin);
const controller=app.slice(begin,end);
test("Wrong answers go to authoritative Worker without waiting for Cloudflare browser proof",()=>{
 assert.match(controller,/const (?:needsBrowserProof|requiresBrowserProof)\s*=/);
 assert.match(controller,/const turnstileToken\s*=\s*(?:needsBrowserProof|requiresBrowserProof)\s*\?\s*await runTurnstile\(\)\s*:\s*""/);
 assert.match(controller,/verifyPrivateMessageChallenge\(/);
});
test("The message service permits empty token only for server-side checking; Worker remains security authority",()=>{
 const start=service.indexOf("export async function verifyPrivateMessageChallenge(");
 const stop=service.indexOf("\nexport async function createPrivateVisitorThread(",start);
 const method=service.slice(start,stop);
 assert.ok(start>0&&stop>start);
 assert.doesNotMatch(method,/if \(!response\) throw/);
 assert.match(method,/workerJson\("\/messages\/security\/verify"/);
});
test("Wrong answer target rotation retains any pending Turnstile token and avoids reset churn",()=>{
 const a=controller.indexOf("const resetSamePuzzle =");
 const b=controller.indexOf("\n    slider.disabled = false;",a);
 const reset=controller.slice(a,b);
 assert.ok(a>0&&b>a);
 assert.doesNotMatch(reset,/turnstile\.reset/);
 assert.doesNotMatch(reset,/completedTurnstileToken = ""/);
});
test("Server 429 closes puzzle and uses existing countdown; typed form is not reset",()=>{
 assert.match(controller,/if \(error\?\.status === 429\)[\s\S]*?closePublicMessagePuzzleVerification\(\);[\s\S]*?beginPublicMessageRetryCountdown\(error\)/);
 const countdown=app.slice(app.indexOf("function beginPublicMessageRetryCountdown("),app.indexOf("\nfunction closePublicMessagePuzzleVerification("));
 assert.match(countdown,/error\?\.code === "message-puzzle-cooldown"/);
 assert.match(countdown,/serverRetryAt/);
 assert.match(app,/if \(publicMessageRetryUntil > Date\.now\(\)\) return;/);
});
test("Correct slider still requires Turnstile before any message is sent",()=>{
 assert.match(controller,/await runTurnstile\(\)/);
 const verified=controller.indexOf('if (!verified?.verificationToken) throw');
 const sent=controller.indexOf("await sendPendingPublicMessage(verified.verificationToken)");
 assert.ok(verified>0&&sent>verified);
});

test("Public startup must not eagerly import Firebase via messaging", () => {
  assert.match(app, /from ["']\.\/message-service\.js["']/);
  assert.doesNotMatch(
    service,
    /from\s+["']https:\/\/www\.gstatic\.com\/firebasejs\//,
    "Messaging must not statically import Firebase SDK"
  );
  assert.doesNotMatch(
    service,
    /^const db = getFirestore\(app\);/m,
    "Messaging must not initialize Firestore at module startup"
  );
  assert.match(service, /export function subscribeAdminPrivateThreads\(/);
  assert.match(service, /export function subscribePrivateVisitorThread\(/);
});

test("Partial Firestore listener failure closes previously opened listener", async () => {
  const source = service
    .replace(/^import [^\n]*;$/gm, "")
    .replace(/^export /gm, "")
    .replaceAll(
      'import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js")',
      "loadFirebaseApp()"
    )
    .replaceAll(
      'import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js")',
      "loadFirebaseDb()"
    );

  let started = 0;
  let closed = 0;
  const errors = [];

  const firestore = {
    getFirestore: () => ({}),
    doc: () => ({}),
    collection: () => ({}),
    orderBy: () => ({}),
    query: () => ({}),
    onSnapshot: () => {
      started++;
      if (started === 2) {
        throw new Error("Second listener failed");
      }
      return () => { closed++; };
    }
  };

  const factory = new Function(
    "firebaseConfig",
    "storageBridgeUrl",
    "loadFirebaseApp",
    "loadFirebaseDb",
    source + "\nreturn { subscribePrivateVisitorThread };"
  );

  const runtime = factory(
    {},
    () => "https://worker.invalid",
    async () => ({
      getApps: () => [],
      initializeApp: () => ({})
    }),
    async () => firestore
  );

  const stop = runtime.subscribePrivateVisitorThread(
    "a".repeat(43),
    () => {},
    error => errors.push(error)
  );

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(started, 2);
  assert.equal(errors.length, 1);
  assert.equal(
    closed,
    1,
    "First listener must close if the second one fails"
  );

  stop();
});



test("Async Firestore listener error closes both subscriptions", async () => {
  const executable = service
    .replace(/^import [^\n]*;$/gm, "")
    .replace(/^export /gm, "")
    .replaceAll(
      'import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js")',
      "loadFirebaseApp()"
    )
    .replaceAll(
      'import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js")',
      "loadFirebaseDb()"
    );

  const errorHandlers = [];
  const errors = [];
  let closed = 0;

  const firestore = {
    getFirestore: () => ({}),
    doc: () => ({}),
    collection: () => ({}),
    query: () => ({}),
    orderBy: () => ({}),
    onSnapshot: (ref, onChange, onError) => {
      errorHandlers.push(onError);
      return () => { closed++; };
    }
  };

  const factory = new Function(
    "firebaseConfig",
    "storageBridgeUrl",
    "loadFirebaseApp",
    "loadFirebaseDb",
    executable + "\nreturn { subscribePrivateVisitorThread };"
  );

  const runtime = factory(
    {},
    () => "https://worker.invalid",
    async () => ({
      getApps: () => [],
      initializeApp: () => ({})
    }),
    async () => firestore
  );

  const stop = runtime.subscribePrivateVisitorThread(
    "a".repeat(43),
    () => {},
    error => errors.push(error)
  );

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(errorHandlers.length, 2);

  errorHandlers[0](new Error("Firestore listener failed"));

  assert.equal(errors.length, 1);
  assert.equal(
    closed,
    2,
    "Both listeners must close after an asynchronous failure"
  );

  stop();
});


// Deferred messaging lifecycle regression
function createLifecycleHarness(loadApp, loadDb) {
  const executable = service
    .replace(/^import [^\n]*;$/gm, "")
    .replace(/^export /gm, "")
    .replaceAll(
      'import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js")',
      "loadFirebaseApp()"
    )
    .replaceAll(
      'import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js")',
      "loadFirebaseDb()"
    );

  return new Function(
    "firebaseConfig",
    "storageBridgeUrl",
    "loadFirebaseApp",
    "loadFirebaseDb",
    executable + "\nreturn { subscribePrivateVisitorThread };"
  )({}, () => "https://worker.invalid", loadApp, loadDb);
}

const mockFirebaseApp = async () => ({
  getApps: () => [],
  initializeApp: () => ({})
});

function mockFirestore(onSnapshot) {
  return {
    getFirestore: () => ({}),
    doc: () => ({}),
    collection: () => ({}),
    query: () => ({}),
    orderBy: () => ({}),
    onSnapshot
  };
}

test("Cancellation before Firebase initialization prevents late listeners", async () => {
  let resolveFirestore;
  const pending = new Promise(resolve => {
    resolveFirestore = resolve;
  });

  let opened = 0;
  const errors = [];
  const runtime = createLifecycleHarness(
    mockFirebaseApp,
    () => pending
  );

  const stop = runtime.subscribePrivateVisitorThread(
    "a".repeat(43),
    () => {},
    error => errors.push(error)
  );

  stop();

  resolveFirestore(mockFirestore(() => {
    opened++;
    return () => {};
  }));

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(opened, 0);
  assert.equal(errors.length, 0);
});

test("Firebase initialization failure permits a clean retry", async () => {
  let attempts = 0;
  let opened = 0;
  let closed = 0;
  const errors = [];

  const runtime = createLifecycleHarness(
    async () => {
      attempts++;
      if (attempts === 1) throw Error("Temporary Firebase failure");
      return mockFirebaseApp();
    },
    async () => mockFirestore(() => {
      opened++;
      return () => { closed++; };
    })
  );

  runtime.subscribePrivateVisitorThread(
    "a".repeat(43),
    () => {},
    error => errors.push(error)
  );

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 1);

  const stop = runtime.subscribePrivateVisitorThread(
    "a".repeat(43),
    () => {},
    error => errors.push(error)
  );

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(attempts, 2);
  assert.equal(opened, 2);
  assert.equal(errors.length, 1);

  stop();
  assert.equal(closed, 2);
});

test("Concurrent subscriptions share one Firebase initialization", async () => {
  let appLoads = 0;
  let firestoreLoads = 0;
  let opened = 0;
  let closed = 0;

  const runtime = createLifecycleHarness(
    async () => {
      appLoads++;
      return mockFirebaseApp();
    },
    async () => {
      firestoreLoads++;
      return mockFirestore(() => {
        opened++;
        return () => { closed++; };
      });
    }
  );

  const stopFirst = runtime.subscribePrivateVisitorThread(
    "a".repeat(43), () => {}, () => {}
  );

  const stopSecond = runtime.subscribePrivateVisitorThread(
    "b".repeat(43), () => {}, () => {}
  );

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(appLoads, 1);
  assert.equal(firestoreLoads, 1);
  assert.equal(opened, 4);

  stopFirst();
  stopSecond();

  assert.equal(closed, 4);
});
