/**
 * Trusted one-time administrator authorization utility.
 *
 * Usage:
 *   npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json \
 *   ADMIN_UID=<firebase-auth-uid> \
 *   ADMIN_EMAIL=<optional-email> \
 *   npm run authorize-admin
 *
 * Never place the service-account file in this project or commit it.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const uid = String(process.env.ADMIN_UID || "").trim();
const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();

if (!uid) {
  console.error("ADMIN_UID is required.");
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();

const user = await auth.getUser(uid);
const existingClaims = user.customClaims || {};
await auth.setCustomUserClaims(uid, { ...existingClaims, admin: true });
await db.doc(`authorizedAdministrators/${uid}`).set({
  active: true,
  ...(email ? { email } : {}),
  updatedAt: FieldValue.serverTimestamp()
}, { merge: true });

console.log(`Administrator authorization enabled for UID ${uid}.`);
console.log("Sign out and sign in again so Firebase refreshes the ID token.");
