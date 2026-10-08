/* =========================================================
   LΛN PORTFOLIO CMS
   Shared Firebase Service

   Architecture:
   - Initializes Firebase only once.
   - Shares Authentication and Firestore instances.
   - Firebase Storage is intentionally not used.
   ========================================================= */

   import {
    getApps,
    initializeApp
  } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
  
  import {
    browserSessionPersistence,
    initializeAuth
  } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
  
  import {
    getFirestore
  } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
  
  import {
    firebaseConfig
  } from "../../config.js";
  
  /* =========================================================
     CONFIGURATION VALIDATION
     ========================================================= */
  
  function validateFirebaseConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error(
        "Firebase configuration is missing. Check config.js."
      );
    }
  
    const requiredKeys = [
      "apiKey",
      "authDomain",
      "projectId",
      "appId"
    ];
  
    for (const key of requiredKeys) {
      if (
        typeof config[key] !== "string" ||
        config[key].trim() === ""
      ) {
        throw new Error(
          `Missing Firebase configuration value: ${key}`
        );
      }
    }
  }
  
  validateFirebaseConfig(firebaseConfig);
  
  /* =========================================================
     INITIALIZE FIREBASE
     ========================================================= */
  
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp(firebaseConfig);
  
  /* =========================================================
     SHARED SERVICES
     ========================================================= */
  
  export const auth = initializeAuth(app, {
    persistence: browserSessionPersistence
  });
  
  export const db = getFirestore(app);

  /* =========================================================
     LOCAL FIREBASE CREDENTIAL READINESS

     The Admin shell is the only authorization owner for the current browser tab session.
     Each same-origin workspace iframe still has its own Firebase SDK
     runtime, however, and Firestore must not issue protected reads until
     that local runtime has restored the already-authorized Firebase user
     from browser-session persistence.

     This boundary does not authorize the administrator and it does not
     install another Auth observer. It only waits for the SDK's built-in
     initialization promise and verifies that the hydrated local identity
     matches the shell identity before workspace controllers are released.
     ========================================================= */

  export async function waitForLocalFirebaseCredential(expectedUid = "") {
    await auth.authStateReady();
    const requiredUid = String(expectedUid || "").trim();
    let user = auth.currentUser || null;

    if (!user) {
      throw Object.assign(
        new Error("The workspace Firebase runtime could not restore the signed-in administrator credential."),
        { code: "firebase/workspace-credential-unavailable" }
      );
    }

    if (requiredUid && user.uid !== requiredUid) {
      throw Object.assign(
        new Error("The workspace Firebase identity does not match the persistent Admin shell identity."),
        { code: "firebase/workspace-identity-mismatch" }
      );
    }

    await user.getIdToken(false);
    user = auth.currentUser || null;

    if (!user) {
      throw Object.assign(
        new Error("The workspace Firebase credential became unavailable while it was being verified."),
        { code: "firebase/workspace-credential-unavailable" }
      );
    }

    if (requiredUid && user.uid !== requiredUid) {
      throw Object.assign(
        new Error("The workspace Firebase identity changed while it was being verified."),
        { code: "firebase/workspace-identity-mismatch" }
      );
    }

    return user;
  }
  
  export default app;