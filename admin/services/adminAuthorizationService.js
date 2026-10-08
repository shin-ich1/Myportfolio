import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const AUTH_COLLECTION = "authorizedAdministrators";
const AUTH_RETRY_DELAYS = Object.freeze([0, 700, 1600]);
const AUTH_LOOKUP_TIMEOUT_MS = 12000;
const AUTH_PERMISSION_RESYNC_DELAY_MS = 320;
const ADMIN_CAPABILITY_PROBE_COLLECTIONS = Object.freeze(["portfolioSections", "portfolioSectionEntries"]);

let authObserverInstalled = false;
let authorizationPromise = null;
let authorizationPromiseUid = "";
let authorizationPromiseForceRefresh = false;
let authorizedSession = null;
let authSessionEpoch = 0;
let observedAuthUid;
const authStateSubscribers = new Set();

export class AdministratorAuthorizationError extends Error {
  constructor(message, { code = "authorization/verification-failed", cause = null, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AdministratorAuthorizationError";
    this.code = code;
    this.retryable = retryable;
  }
}

const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds = AUTH_LOOKUP_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const timer = window.setTimeout(() => reject(Object.assign(new Error("Administrator verification timed out."), { code: "deadline-exceeded" })), milliseconds);
  Promise.resolve(promise).then(
    (value) => { window.clearTimeout(timer); resolve(value); },
    (error) => { window.clearTimeout(timer); reject(error); }
  );
});
const errorCode = (error) => String(error?.code || "").toLowerCase();
const isRetryableLookupError = (error) => [
  "unavailable",
  "deadline-exceeded",
  "network-request-failed",
  "resource-exhausted",
  "internal",
  "unknown"
].some((code) => errorCode(error).includes(code));

function liveFirebaseUser() {
  return auth.currentUser || null;
}


function resetAuthorizationState() {
  authorizedSession = null;
  authorizationPromise = null;
  authorizationPromiseUid = "";
  authorizationPromiseForceRefresh = false;
}

function updateAuthSessionEpoch(user) {
  const uid = user?.uid || "";
  if (uid === observedAuthUid) return;
  observedAuthUid = uid;
  authSessionEpoch += 1;
}

function invalidateAuthorizedSessionIfIdentityChanged(user) {
  const uid = user?.uid || "";
  if (!uid || authorizedSession?.user?.uid !== uid) authorizedSession = null;
}

function notifyAuthStateSubscribers(user, error = null) {
  const state = Object.freeze({
    user: user || null,
    session: getCurrentAuthorizedAdministrator(),
    error
  });
  for (const subscriber of authStateSubscribers) {
    try { subscriber(state); }
    catch (subscriberError) { queueMicrotask(() => { throw subscriberError; }); }
  }
}

function ensureCanonicalAuthStateOwner() {
  if (authObserverInstalled) return;
  authObserverInstalled = true;

  onAuthStateChanged(
    auth,
    (user) => {
      updateAuthSessionEpoch(user);
      invalidateAuthorizedSessionIfIdentityChanged(user);
      notifyAuthStateSubscribers(user || null);
    },
    (error) => {
      updateAuthSessionEpoch(liveFirebaseUser());
      authorizedSession = null;
      notifyAuthStateSubscribers(liveFirebaseUser(), error);
      window.dispatchEvent(new CustomEvent("lan:admin-auth-state-error", { detail: { error } }));
    }
  );
}

export async function waitForAuthState() {
  ensureCanonicalAuthStateOwner();
  try {
    await auth.authStateReady();
  } catch (error) {
    throw new AdministratorAuthorizationError(
      "Firebase could not restore the administrator session.",
      { code: "authorization/auth-state-failed", cause: error, retryable: true }
    );
  }
  return liveFirebaseUser();
}

export function getCurrentAdministratorUser() {
  return liveFirebaseUser();
}

export function getAdministratorSessionEpoch() {
  return authSessionEpoch;
}

export function subscribeAdministratorAuthState(listener, { emitCurrent = false } = {}) {
  if (typeof listener !== "function") return () => {};
  ensureCanonicalAuthStateOwner();
  authStateSubscribers.add(listener);
  if (emitCurrent) queueMicrotask(() => listener(Object.freeze({
    user: liveFirebaseUser(),
    session: getCurrentAuthorizedAdministrator(),
    error: null
  })));
  return () => authStateSubscribers.delete(listener);
}

async function refreshFirebaseToken(user) {
  try {
    await user.getIdTokenResult(true);
  } catch (error) {
    throw new AdministratorAuthorizationError(
      "The signed-in session could not be synchronized.",
      { code: "authorization/token-failed", cause: error, retryable: true }
    );
  }
}

async function readFirestoreVerification(operation, context) {
  let lastError = null;

  for (let index = 0; index < AUTH_RETRY_DELAYS.length; index += 1) {
    const retryDelay = AUTH_RETRY_DELAYS[index];
    if (retryDelay) await delay(retryDelay);
    try {
      return await withTimeout(operation());
    } catch (error) {
      lastError = error;
      const code = errorCode(error);
      const permissionDenied = code.includes("permission-denied");

      if (permissionDenied && !context.tokenResynchronized) {
        context.tokenResynchronized = true;
        await refreshFirebaseToken(context.user);
        await delay(AUTH_PERMISSION_RESYNC_DELAY_MS);
        continue;
      }

      if (permissionDenied && index < AUTH_RETRY_DELAYS.length - 1) continue;
      if (!isRetryableLookupError(error)) break;
    }
  }

  const code = errorCode(lastError);
  if (code.includes("permission-denied")) {
    throw new AdministratorAuthorizationError(
      "Administrator verification is blocked by Firestore Rules.",
      { code: "authorization/rules-denied", cause: lastError, retryable: false }
    );
  }

  if (code.includes("failed-precondition") || code.includes("not-found")) {
    throw new AdministratorAuthorizationError(
      "The Firestore database or administrator authorization record is not ready for this project.",
      { code: "authorization/firestore-not-ready", cause: lastError, retryable: false }
    );
  }

  throw new AdministratorAuthorizationError(
    "Administrator access could not be verified because Firestore is temporarily unavailable.",
    { code: "authorization/lookup-failed", cause: lastError, retryable: true }
  );
}

function readAllowlistRecord(context) {
  return readFirestoreVerification(
    () => getDoc(doc(db, AUTH_COLLECTION, context.user.uid)),
    context
  );
}

async function readAdminFirestoreCapability(context) {
  const probes = await readFirestoreVerification(
    () => Promise.all([
      getDoc(doc(db, "settings", "storage")),
      ...ADMIN_CAPABILITY_PROBE_COLLECTIONS.map((collectionName) =>
        getDocs(query(collection(db, collectionName), limit(1)))
      )
    ]),
    context
  );

  return {
    settingsDocumentPresent: probes[0].exists(),
    moduleRegistryCollectionsReadable: true
  };
}

export async function verifyAdministrator(user, forceRefresh = false) {
  if (!user) return { authorized: false, reason: "signed-out", user: null };

  let token;
  try {
    token = await user.getIdTokenResult(forceRefresh);
  } catch (error) {
    throw new AdministratorAuthorizationError(
      "The signed-in session could not be verified.",
      { code: "authorization/token-failed", cause: error, retryable: true }
    );
  }

  const verificationContext = { user, tokenResynchronized: forceRefresh };
  const snapshot = await readAllowlistRecord(verificationContext);
  const record = snapshot.exists() ? snapshot.data() : null;
  const securityApproved = token.claims?.lanSecurityVerified === true && String(token.claims?.lanSessionId || "").trim().length > 0;
  const claimAuthorized = token.claims?.admin === true;
  const allowlistAuthorized = record?.active === true;
  const authorized = securityApproved && (claimAuthorized || allowlistAuthorized);
  const verifiedAt = Date.now();

  if (!authorized) {
    return {
      authorized: false,
      method: "none",
      reason: "unauthorized",
      user,
      verifiedAt,
      firestoreProof: null
    };
  }

  const capability = await readAdminFirestoreCapability(verificationContext);

  return {
    authorized: true,
    method: "security-approved-session",
    reason: "authorized",
    user,
    verifiedAt,
    firestoreProof: {
      verifiedAt,
      administratorRecordPresent: snapshot.exists(),
      administratorRecordActive: allowlistAuthorized,
      protectedAdminAccess: true,
      ...capability
    }
  };
}

export function getCurrentAuthorizedAdministrator() {
  const user = liveFirebaseUser();
  if (!user || authorizedSession?.authorized !== true || authorizedSession.user?.uid !== user.uid) return null;
  return authorizedSession;
}

export async function getAuthorizedAdministrator({ forceRefresh = false, maxProofAgeMs = Infinity } = {}) {
  await waitForAuthState();
  let user = liveFirebaseUser();
  if (!user) {
    authorizedSession = null;
    return { authorized: false, reason: "signed-out", user: null };
  }

  const current = getCurrentAuthorizedAdministrator();
  const proofAge = current ? Date.now() - Number(current.firestoreProof?.verifiedAt || current.verifiedAt || 0) : Infinity;
  if (current && !forceRefresh && proofAge <= Number(maxProofAgeMs)) return current;

  if (authorizationPromise) {
    const sameIdentity = authorizationPromiseUid === user.uid;
    const inFlightSatisfiesRequest = sameIdentity && (!forceRefresh || authorizationPromiseForceRefresh);
    if (inFlightSatisfiesRequest) return authorizationPromise;

    // A stronger force-refresh request, or an identity change, must never be
    // collapsed into an older verification that cannot satisfy it. Finish the
    // active verification, then re-evaluate the live Auth owner before starting
    // the requested proof.
    await authorizationPromise.catch(() => null);
    user = liveFirebaseUser();
    if (!user) return { authorized: false, reason: "signed-out", user: null };
    const refreshedCurrent = getCurrentAuthorizedAdministrator();
    const refreshedAge = refreshedCurrent ? Date.now() - Number(refreshedCurrent.firestoreProof?.verifiedAt || refreshedCurrent.verifiedAt || 0) : Infinity;
    if (refreshedCurrent && !forceRefresh && refreshedAge <= Number(maxProofAgeMs)) return refreshedCurrent;
  }

  const verificationUser = user;
  authorizationPromiseUid = verificationUser.uid;
  authorizationPromiseForceRefresh = forceRefresh;
  authorizationPromise = (async () => {
    const result = await verifyAdministrator(verificationUser, forceRefresh);
    const liveUser = liveFirebaseUser();
    if (liveUser?.uid !== verificationUser.uid) {
      throw new AdministratorAuthorizationError(
        "The administrator identity changed while verification was running.",
        { code: "authorization/session-changed", retryable: true }
      );
    }
    authorizedSession = result.authorized ? result : null;
    return result;
  })().finally(() => {
    authorizationPromise = null;
    authorizationPromiseUid = "";
    authorizationPromiseForceRefresh = false;
  });

  return authorizationPromise;
}

export const administratorSession = Object.freeze({
  get user() {
    return getCurrentAdministratorUser();
  },
  get authorized() {
    return getCurrentAuthorizedAdministrator()?.authorized === true;
  },
  get method() {
    return getCurrentAuthorizedAdministrator()?.method || "";
  },
  get firestoreProof() {
    return getCurrentAuthorizedAdministrator()?.firestoreProof || null;
  },
  get verifiedAt() {
    return Number(getCurrentAuthorizedAdministrator()?.verifiedAt || 0);
  },
  getSession(options = {}) {
    return getAuthorizedAdministrator(options);
  },
  async getIdToken(forceRefresh = false) {
    await waitForAuthState();
    const user = liveFirebaseUser();
    if (!user) {
      throw new AdministratorAuthorizationError(
        "Administrator sign-in is required.",
        { code: "authorization/signed-out", retryable: false }
      );
    }
    try {
      return await user.getIdToken(forceRefresh);
    } catch (error) {
      throw new AdministratorAuthorizationError(
        "The signed-in session token is unavailable.",
        { code: "authorization/token-failed", cause: error, retryable: true }
      );
    }
  },
  subscribe(listener, options = {}) {
    return subscribeAdministratorAuthState(listener, options);
  }
});

function ensureAuthorizationState() {
  let panel = document.getElementById("adminAuthorizationState");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "adminAuthorizationState";
  panel.className = "admin-authorization-state";
  panel.setAttribute("role", "alert");
  panel.innerHTML = `<div class="admin-authorization-card"><span class="admin-authorization-logo">LΛN</span><h1>Administrator verification</h1><p data-auth-message>Verifying your secure session...</p><button class="editor-secondary-button" type="button" data-auth-retry hidden>Retry verification</button></div>`;
  document.body.append(panel);
  return panel;
}

function showAuthError(message, retryHandler, retryable = true) {
  const panel = ensureAuthorizationState();
  panel.hidden = false;
  panel.querySelector("[data-auth-message]").textContent = message;
  const retry = panel.querySelector("[data-auth-retry]");
  retry.hidden = !retryable;
  retry.onclick = retryable ? retryHandler : null;
}

export function authorizationMessage(error) {
  const messages = {
    "authorization/rules-denied": "Administrator verification is blocked by Firestore Rules. Deploy the included rules and verify your administrator UID record, then retry.",
    "authorization/firestore-not-ready": "Administrator access is not configured in this Firebase project. Create authorizedAdministrators/{your Firebase UID} with active: true, then retry.",
    "authorization/token-failed": "Your signed-in session could not be verified. Check your connection and retry.",
    "authorization/auth-state-failed": "Firebase could not restore your session. Check your connection and retry.",
    "authorization/lookup-failed": "We could not verify administrator access. Check your connection and retry.",
    "authorization/session-changed": "The administrator account changed while access was being verified. Retry verification.",
    "authorization/allowlist-inactive": "This administrator account is no longer active in the authorization record."
  };
  return messages[error?.code] || "We could not verify administrator access. Check your connection and retry.";
}

export async function signInSecurityCustomToken(customToken) {
  ensureCanonicalAuthStateOwner();
  await auth.authStateReady();
  resetAuthorizationState();
  const credential = await signInWithCustomToken(auth, String(customToken || ""));
  const user = credential?.user || liveFirebaseUser();
  if (!user) throw new AdministratorAuthorizationError("Security custom-token sign-in did not produce a Firebase user.", { code:"authorization/sign-in-incomplete", retryable:true });
  try {
    const result = await getAuthorizedAdministrator({ forceRefresh:true, maxProofAgeMs:0 });
    if (!result?.authorized) { await signOutFirebaseAdministrator(); throw new AdministratorAuthorizationError("This security session is not authorized.", { code:"authorization/allowlist-inactive", retryable:false }); }
    return result;
  } catch (error) {
    if (liveFirebaseUser()) await signOutFirebaseAdministrator().catch(()=>{});
    throw error;
  }
}

export function requireAuthorizedAdmin() {
  document.documentElement.classList.add("auth-verifying");
  const panel = ensureAuthorizationState();
  panel.hidden = true;
  let panelTimer = window.setTimeout(() => {
    if (document.documentElement.classList.contains("auth-verifying")) panel.hidden = false;
  }, 350);

  return new Promise((resolve) => {
    const verifyAndReveal = async (forceRefresh = false) => {
      panel.querySelector("[data-auth-message]").textContent = "Verifying your administrator access...";
      const retry = panel.querySelector("[data-auth-retry]");
      retry.hidden = true;
      retry.onclick = null;

      try {
        const result = await getAuthorizedAdministrator({ forceRefresh, maxProofAgeMs: 0 });
        if (!result.user || !result.authorized) {
          window.clearTimeout(panelTimer);
          panel.hidden = true;
          document.documentElement.classList.remove("auth-verifying");
          resolve(result);
          return;
        }

        window.clearTimeout(panelTimer);
        panel.hidden = true;
        document.documentElement.classList.remove("auth-verifying");
        document.documentElement.classList.add("auth-authorized");
        resolve(result);
      } catch (error) {
        const signature = `${error?.code || "authorization/error"}:${error?.message || "verification failed"}`;
        if (panel.dataset.lastErrorSignature !== signature) {
          panel.dataset.lastErrorSignature = signature;
          console.error("Administrator authorization check failed:", error);
        }
        window.clearTimeout(panelTimer);
        panel.hidden = false;
        showAuthError(
          authorizationMessage(error),
          () => verifyAndReveal(true),
          error?.retryable !== false
        );
      }
    };

    verifyAndReveal(false);
  });
}

export async function signOutFirebaseAdministrator() {
  ensureCanonicalAuthStateOwner();
  // Invalidate every session-scoped consumer before any asynchronous sign-out
  // work begins. Diagnostics and provider checks captured under the old epoch
  // must not be allowed to commit a failure while this session is tearing down.
  authSessionEpoch += 1;
  await auth.authStateReady();

  resetAuthorizationState();
  await signOut(auth);

  if (liveFirebaseUser()) {
    throw new AdministratorAuthorizationError(
      "Administrator sign-out did not complete.",
      { code: "authorization/logout-incomplete", retryable: true }
    );
  }
}

export const logoutAdministrator = signOutFirebaseAdministrator;
export const requireAdministrator = requireAuthorizedAdmin;
