import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, Timestamp
} from 'firebase/firestore';

// Real Firestore Rules interpreter, isolated emulator-only identities and
// documents. Never connects to a live Firebase project or requests credentials.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host)) {
  throw Error('Firestore Rules tests require a local emulator; refusing live Firestore.');
}
const [emulatorHost, emulatorPort] = host.split(':');
const uid = 'security-rules-test-admin';
const stranger = 'security-rules-test-stranger';
const now = Date.now();
const expiryFuture = Timestamp.fromMillis(now + 7 * 24 * 60 * 60 * 1000);
const expiryPast = Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
let env;
const dbFor = (user, claims = {}) =>
  env.authenticatedContext(user, claims).firestore();
const granted = (sessionId = 'active') =>
  dbFor(uid, { lanSecurityVerified: true, lanSessionId: sessionId });
const denied = (sessionId, extra = {}) =>
  dbFor(uid, { lanSecurityVerified: true, lanSessionId: sessionId, ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'lan-security-rules-emulator-only',
    firestore: {
      host: emulatorHost, port: Number(emulatorPort),
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
    }
  });
  await env.withSecurityRulesDisabled(async admin => {
    const db = admin.firestore();
    await Promise.all([
      setDoc(doc(db, 'authorizedAdministrators', uid), { active: true }),
      setDoc(doc(db, 'authorizedAdministrators', stranger), { active: false }),
      setDoc(doc(db, 'adminSecuritySessions', 'active'), {
        uid, active: true, trustLevel: 'trusted', expiresAt: expiryFuture
      }),
      setDoc(doc(db, 'adminSecuritySessions', 'temporary'), {
        uid, active: true, trustLevel: 'temporary', expiresAt: expiryFuture
      }),
      setDoc(doc(db, 'adminSecuritySessions', 'revocation-transition'), {
        uid, active: true, trustLevel: 'trusted', expiresAt: expiryFuture
      }),
      setDoc(doc(db, 'authorizedAdministrators', 'admin-deactivation-transition'), {
        active: true
      }),
      setDoc(doc(db, 'adminSecuritySessions', 'deactivation-transition'), {
        uid: 'admin-deactivation-transition', active: true,
        trustLevel: 'temporary', expiresAt: expiryFuture
      }),
      setDoc(doc(db, 'adminSecuritySessions', 'revoked'), {
        uid, active: false, trustLevel: 'trusted', expiresAt: expiryFuture
      }),
      setDoc(doc(db, 'adminSecuritySessions', 'expired'), {
        uid, active: true, trustLevel: 'trusted', expiresAt: expiryPast
      }),
      setDoc(doc(db, 'adminSecuritySessions', 'other-user'), {
        uid: stranger, active: true, trustLevel: 'trusted', expiresAt: expiryFuture
      }),
      setDoc(doc(db, 'adminSecurityRecovery', uid), {
        active: true, masterKeyHash: 'emulator-only-hash'
      }),
      setDoc(doc(db, 'adminSecurityDevices', 'emulator-device'), {
        uid, active: true
      }),
      setDoc(doc(db, 'adminSecurityEvents', 'emulator-event'), {
        uid, type: 'emulator-only'
      }),
      setDoc(doc(db, 'settings', 'emulator-secret'), { value: 'private' }),
      setDoc(doc(db, 'projects', 'emulator-draft'), {
        status: 'draft', visible: false, title: 'Not public'
      }),
      setDoc(doc(db, 'projects', 'emulator-published'), {
        status: 'published', visible: true, title: 'Public'
      })
    ]);
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test('a server-approved active administrator session can read and update protected CMS data', async () => {
  const db = granted('active');
  const snapshot = await assertSucceeds(getDoc(doc(db, 'settings', 'emulator-secret')));
  assert.equal(snapshot.data().value, 'private');
  await assertSucceeds(setDoc(doc(db, 'settings', 'emulator-owned'), { value: 'allowed' }));
  await assertSucceeds(updateDoc(doc(db, 'settings', 'emulator-owned'), { value: 'updated' }));
});

test('a temporary but verified and active administrator session is still allowed CMS access', async () => {
  await assertSucceeds(getDoc(doc(granted('temporary'), 'settings', 'emulator-secret')));
});

test('missing, password-only and forged admin:true claims are denied private CMS data', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'settings', 'emulator-secret')));
  for (const claims of [
    { lanSecurityVerified: false, lanSessionId: 'active' },
    { lanSessionId: 'active', admin: true },
    { lanSecurityVerified: false, lanSessionId: 'active', admin: true },
    { lanSecurityVerified: true },
    { lanSecurityVerified: true, lanSessionId: 'missing-session' }
  ]) {
    await assertFails(getDoc(doc(dbFor(uid, claims), 'settings', 'emulator-secret')));
  }
});

test('revoked and expired sessions lose private read and write access immediately', async () => {
  for (const session of ['revoked', 'expired']) {
    const db = denied(session);
    await assertFails(getDoc(doc(db, 'settings', 'emulator-secret')));
    await assertFails(setDoc(doc(db, 'settings', 'blocked-' + session), { attempted: true }));
    await assertFails(updateDoc(doc(db, 'projects', 'emulator-draft'), { title: 'Blocked' }));
  }
});

test('the SAME formerly-authorized session token loses access as soon as the server revokes its session', async () => {
  const db = granted('revocation-transition');
  await assertSucceeds(getDoc(doc(db, 'settings', 'emulator-secret')));
  await env.withSecurityRulesDisabled(async admin => {
    await updateDoc(doc(admin.firestore(), 'adminSecuritySessions', 'revocation-transition'), {
      active: false, revokedAt: Timestamp.now()
    });
  });
  // No reauthentication, browser reload, or new claim. The original context
  // must no longer have read or write access after the server-side change.
  await assertFails(getDoc(doc(db, 'settings', 'emulator-secret')));
  await assertFails(setDoc(doc(db, 'settings', 'revoked-replay-write'), { blocked: true }));
  // Revocation must not affect a separate approved session.
  await assertSucceeds(getDoc(doc(granted('active'), 'settings', 'emulator-secret')));
});

test('deactivating the administrator allowlist denies the SAME formerly-valid token immediately', async () => {
  const subject = 'admin-deactivation-transition';
  const db = dbFor(subject, { lanSecurityVerified: true, lanSessionId: 'deactivation-transition' });
  await assertSucceeds(getDoc(doc(db, 'settings', 'emulator-secret')));
  await env.withSecurityRulesDisabled(async admin => {
    await updateDoc(doc(admin.firestore(), 'authorizedAdministrators', subject), {
      active: false
    });
  });
  await assertFails(getDoc(doc(db, 'settings', 'emulator-secret')));
  await assertFails(updateDoc(doc(db, 'projects', 'emulator-draft'), { title: 'Blocked' }));
});

test('wrong-owner sessions and inactive administrator records cannot gain access', async () => {
  await assertFails(getDoc(doc(denied('other-user'), 'settings', 'emulator-secret')));
  const strangerDb = dbFor(stranger, { lanSecurityVerified: true, lanSessionId: 'other-user' });
  await assertFails(getDoc(doc(strangerDb, 'settings', 'emulator-secret')));
  await assertFails(setDoc(doc(strangerDb, 'settings', 'stranger-write'), { attempted: true }));
});

test('even approved admins cannot directly read or write backend-owned security documents', async () => {
  for (const path of [
    ['adminSecurityRecovery', uid], ['adminSecuritySessions', 'active'],
    ['adminSecurityDevices', 'emulator-device'], ['adminSecurityEvents', 'emulator-event'],
    ['adminSecurityDeviceCredentials', 'inaccessible'], ['adminSecurityState', uid]
  ]) {
    const db = granted('active');
    await assertFails(getDoc(doc(db, ...path)));
    await assertFails(setDoc(doc(db, ...path), { active: false }));
    await assertFails(deleteDoc(doc(db, ...path)));
  }
});

test('authorized administrator allowlist cannot be modified through client credentials', async () => {
  const db = granted('active');
  await assertSucceeds(getDoc(doc(db, 'authorizedAdministrators', uid)));
  await assertFails(getDoc(doc(db, 'authorizedAdministrators', stranger)));
  await assertFails(getDocs(collection(db, 'authorizedAdministrators')));
  await assertFails(setDoc(doc(db, 'authorizedAdministrators', 'new-admin'), { active: true }));
  await assertFails(updateDoc(doc(db, 'authorizedAdministrators', uid), { active: false }));
  await assertFails(deleteDoc(doc(db, 'authorizedAdministrators', uid)));
});

test('public published portfolio remains readable, drafts and anonymous writes remain denied', async () => {
  const db = env.unauthenticatedContext().firestore();
  const published = await assertSucceeds(getDoc(doc(db, 'projects', 'emulator-published')));
  assert.equal(published.data().title, 'Public');
  await assertFails(getDoc(doc(db, 'projects', 'emulator-draft')));
  await assertFails(setDoc(doc(db, 'projects', 'malicious-public-write'), {
    status: 'published', visible: true, title: 'Forged'
  }));
  await assertFails(updateDoc(doc(db, 'projects', 'emulator-published'), { title: 'Changed' }));
});
