import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';

const dryRun = process.argv.includes('--dry-run');
const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '').trim();
const clientEmail = String(process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL || '').trim();
const privateKey = String(process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const imageUrl = String(process.env.SECURITY_AUTH_EMAIL_IMAGE_URL || '').trim();
const replyTo = String(process.env.SECURITY_AUTH_EMAIL_REPLY_TO || '').trim();

function safeHttpsImage(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function verificationEmailBody(image = '') {
  const safeImage = safeHttpsImage(image);
  const imageMarkup = safeImage
    ? `<img src="${safeImage.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="LΛN Portfolio" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:999px;margin:0 auto 20px;border:2px solid #3795ff;">`
    : `<div style="font-size:28px;font-weight:800;letter-spacing:.12em;color:#5ab0ff;margin-bottom:18px;">LΛN</div>`;
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#07111f;font-family:Arial,Helvetica,sans-serif;color:#eaf4ff;">
  <div style="max-width:560px;margin:0 auto;background:#0d1d31;border:1px solid #24476a;border-radius:18px;padding:32px;text-align:center;">
    ${imageMarkup}
    <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#62b6ff;font-weight:700;">LΛN Portfolio Security</div>
    <h1 style="margin:12px 0 10px;font-size:28px;line-height:1.2;color:#ffffff;">Verify your administrator email</h1>
    <p style="margin:0 auto 22px;max-width:440px;color:#b7c9db;line-height:1.65;">Confirm <strong style="color:#ffffff;">%EMAIL%</strong> before authenticator enrollment can continue.</p>
    <p style="margin:26px 0;"><a href="%LINK%" style="display:inline-block;background:#258cff;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;">Verify administrator email</a></p>
    <p style="margin:22px 0 0;color:#7f97ae;font-size:12px;line-height:1.6;">If you did not request this verification, you can ignore this email. The verification link is generated and validated by Firebase Authentication.</p>
  </div>
</body></html>`;
}

const template = {
  senderDisplayName: 'LΛN Portfolio Security',
  subject: 'Verify your administrator email — LΛN Portfolio',
  body: verificationEmailBody(imageUrl),
  bodyFormat: 'HTML',
  ...(replyTo ? { replyTo } : {})
};

if (dryRun) {
  console.log(JSON.stringify({ notification: { sendEmail: { verifyEmailTemplate: template } } }, null, 2));
  process.exit(0);
}

if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required.');
const credential = clientEmail && privateKey
  ? cert({ projectId, clientEmail, privateKey })
  : applicationDefault();
if (!getApps().length) initializeApp({ credential, projectId });

const accessToken = await credential.getAccessToken();
const headers = {
  Authorization: `Bearer ${accessToken.access_token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': projectId
};
const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`;

const currentResponse = await fetch(configUrl, { headers: { Authorization: headers.Authorization, 'X-Goog-User-Project': projectId } });
const current = await currentResponse.json().catch(() => ({}));
if (!currentResponse.ok) {
  throw new Error(`Could not read Identity Platform email configuration (HTTP ${currentResponse.status}).`);
}

const currentTemplate = current?.notification?.sendEmail?.verifyEmailTemplate || {};
const mergedTemplate = { ...currentTemplate, ...template };
const patchUrl = `${configUrl}?updateMask=${encodeURIComponent('notification.sendEmail.verifyEmailTemplate')}`;
const response = await fetch(patchUrl, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ notification: { sendEmail: { verifyEmailTemplate: mergedTemplate } } })
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  const reason = payload?.error?.message || `HTTP ${response.status}`;
  throw new Error(`Firebase verification email branding could not be updated: ${reason}`);
}
console.log('Firebase administrator verification email branding configured.');
