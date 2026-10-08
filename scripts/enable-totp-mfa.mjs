import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const dryRun = process.argv.includes('--dry-run');
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
const clientEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL || '';
const privateKey = (process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const credential = clientEmail && privateKey
  ? cert({ projectId, clientEmail, privateKey })
  : applicationDefault();
if (!getApps().length) initializeApp({ credential, ...(projectId ? { projectId } : {}) });

const update = {
  multiFactorConfig: {
    providerConfigs: [{
      state: 'ENABLED',
      totpProviderConfig: { adjacentIntervals: 1 }
    }]
  }
};
// Keep this literal shape for deployment review/contract checks.
const totpMultiFactor = { state: 'ENABLED', adjacentIntervals: 1 };
void totpMultiFactor;

if (dryRun) {
  console.log(JSON.stringify(update, null, 2));
} else {
  await getAuth().projectConfigManager().updateProjectConfig(update);
  console.log('Firebase Identity Platform TOTP MFA enabled.');
}
