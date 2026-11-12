// Regression first on deployed PR45 Public Message canonical owners.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const service=readFileSync(new URL("../message-visitor-service.js",import.meta.url),"utf8");
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
