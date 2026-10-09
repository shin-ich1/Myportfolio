import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const login=await readFile(new URL("../admin/js/admin.js",import.meta.url),"utf8");
const service=await readFile(new URL("../admin/services/adminSecurityService.js",import.meta.url),"utf8");
const page=await readFile(new URL("../admin/index.html",import.meta.url),"utf8");

test("recovery login requires a visible save-and-confirm step before the server activation call",()=>{
  const prepare=login.indexOf("await prepareRecoveryKit(recovery.recoverySessionId)");
  const display=login.indexOf("recoveryResult.append(title,key,codes,explanation,savedLabel,activate,state)");
  const button=login.indexOf("activate.addEventListener('click'");
  const complete=login.indexOf("await completeRecoveryReset(recovery.recoverySessionId");
  assert.ok(prepare>=0 && button>prepare && complete>button && display>complete);
  assert.match(login,/saved\.type='checkbox'/);
  assert.match(login,/activate\.disabled=!saved\.checked/);
  assert.match(login,/if\(!saved\.checked \|\| !recoveryActivationPending\)return/);
  assert.match(page,/Start recovery and prepare new key/);
});

test("postcommit status check never generates a second Recovery Kit or assumes a lost response failed",()=>{
  const idx=login.indexOf("await completeRecoveryReset(recovery.recoverySessionId");
  const check=login.indexOf("await getRecoveryResetStatus(recovery.recoverySessionId",idx);
  assert.ok(idx>=0 && check>idx);
  assert.match(login,/if\(checked\?\.state!=='bootstrap-required'\)throw error/);
  assert.match(login,/if\(!recoveryActivationPending\)return;/);
  assert.match(login,/key\.textContent=''/);
  assert.match(login,/codes\.textContent=''/);
  assert.match(login,/window\.addEventListener\('beforeunload'/);
  assert.match(service,/export const prepareRecoveryKit=/);
  assert.match(service,/export const getRecoveryResetStatus=/);
  assert.doesNotMatch(service,/localStorage\.setItem\([^)]*[Kk]ey/);
});

test("normal signed-in Recovery Kit rotation also prepares before activating and retains prior key until acknowledgment",async()=>{
  const settings=await readFile(new URL("../admin/js/settings-security.js",import.meta.url),"utf8");
  const index=settings.indexOf("await generateRecoveryKit()");
  const activate=settings.indexOf("await activatePreparedRecoveryKit(",index);
  assert.ok(index>=0 && activate>index);
  assert.match(settings,/recoveryRotationSavedConfirmation/);
  assert.match(settings,/activationButton\.disabled=!saved\.checked/);
  assert.match(settings,/if\(!saved\.checked\)return/);
  assert.match(settings,/recoveryKitOutput/);
  assert.match(service,/export async function activatePreparedRecoveryKit/);
});
