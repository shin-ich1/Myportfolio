import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";

const read = relative => readFileSync(new URL("../"+relative,import.meta.url),"utf8");
const app=read("app.js"), service=read("message-service.js");
const worker=read("telemetry-worker/src/index.js");
const coordinator=read("telemetry-worker/src/security-coordinator.js");
const mainConfig=read("telemetry-worker/wrangler.jsonc");
const fbConfig=read("config.js");
const mainRegion=app.slice(app.indexOf("const PUBLIC_MESSAGE_TURNSTILE_SRC"),app.indexOf("\nfunction publicServicesValid("));
const verify=worker.slice(worker.indexOf("async function handleMessagePuzzleVerify("),worker.indexOf("\nasync function consumePrivateMessageVerification("));
const challenge=worker.slice(worker.indexOf("async function handleMessagePuzzleChallenge("),worker.indexOf("\nasync function handleMessagePuzzleVerify("));
const sha = path => execFileSync("git",["hash-object",path],{encoding:"utf8"}).trim();
const frozenLiveRegionHash = text => {
  let h=2166136261;
  for (let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;
  return h.toString(16).padStart(8,"0");
};
test("ALL actual LIVE Public source outside the canonical messaging region remains byte-for-byte unchanged",()=>{
  const begin=app.indexOf("const PUBLIC_MESSAGE_TURNSTILE_SRC");
  const end=app.indexOf("\nfunction publicServicesValid(",begin);
  assert.ok(begin > 0 && end > begin,"Canonical message owner boundaries must be unique");
  assert.equal(begin,143684,"Do not alter any live functionality or footer before message owner");
  assert.equal(frozenLiveRegionHash(app.slice(0,begin)),"81403db9");
  assert.equal(frozenLiveRegionHash(app.slice(end)),"c8365446","Do not alter live sections and startup code after message owner");
  assert.equal((app.match(/const PUBLIC_MESSAGE_TURNSTILE_SRC/g)||[]).length,1);
});

test("release preserves the actual LIVE footer and production media/startup owners",()=>{
  assert.match(app,/site-footer--storage/);
  assert.match(app,/storage-privacy\.html/);
  assert.match(app,/LAN Portfolio Storage uses Google Drive access/);
  assert.match(app,/import \{ storageAssetUrl \} from "\.\/storage-asset\.js"/);
  assert.match(app,/import \{ staticImageRendition \} from "\.\/static-image-renditions\.js"/);
  assert.match(app,/function withPublicStartupDeadline\(/);
  assert.match(app,/initPublicAdaptiveMode\(\)/);
});

test("release includes the canonical Public Message cooldown and five-second image readiness",()=>{
  assert.match(mainRegion,/function beginPublicMessageRetryCountdown\(/);
  assert.match(mainRegion,/error\?\.code === "message-puzzle-cooldown"/);
  assert.match(mainRegion,/serverRetryAt \+ imagePreparationMs/);
  assert.match(mainRegion,/imagePreparationMs = isWrongAnswerCooldown \? 5_000 : 0/);
  assert.match(mainRegion,/warmPublicMessagePuzzleChallenge\(\)/);
  assert.match(mainRegion,/warmupState === "pending"/);
  assert.match(mainRegion,/Preparing the next puzzle image/);
  assert.match(mainRegion,/scene\.style\.visibility = "hidden"/);
  assert.match(mainRegion,/scene\.style\.visibility = ""/);
});

test("fast wrong-answer path never bypasses server-required Turnstile",()=>{
  assert.match(mainRegion,/requiresBrowserProof \? await runTurnstile\(\) : ""/);
  assert.match(service,/workerJson\("\/messages\/security\/verify"/);
  assert.doesNotMatch(service,/if \(!response\) throw new Error\("Secure browser verification is still running/);
  assert.match(verify,/await verifyTurnstile\(request,env,body\?\.turnstileToken\)/);
  assert.match(verify,/op:"puzzle-finalize"/);
  assert.match(verify,/const verificationToken=randomCapability\(24\)/);
});

test("Worker accepts only one-slider-step alignment, starts authoritative 10s cooldown on third wrong",()=>{
  assert.match(worker,/const MESSAGE_PUZZLE_TOLERANCE = 1;/);
  assert.match(worker,/const MESSAGE_PUZZLE_WRONG_COOLDOWN_SECONDS = 10;/);
  assert.match(verify,/enforceMessagePuzzleCooldown\(env, binding\)/);
  assert.match(verify,/op: "puzzle-cooldown-start"/);
  assert.match(verify,/code: "message-puzzle-cooldown"/);
  assert.match(verify,/,429,context\.origin/);
  assert.match(challenge,/await enforceMessagePuzzleCooldown\(env, binding\)/);
  assert.match(verify,/retryAt:error\?\.retryAt/);
});

test("canonical SecurityCoordinator durably owns retry; browser cannot shorten a server deadline",()=>{
  assert.match(coordinator,/op === "puzzle-cooldown-start"/);
  assert.match(coordinator,/op === "puzzle-cooldown-check"/);
  assert.match(coordinator,/Math\.max\(previousUntil, now \+ seconds \* 1000\)/);
  assert.match(coordinator,/code|message-puzzle-cooldown/);
  assert.match(coordinator,/blockedUntil/);
});

test("LIVE Firebase project and Worker config are not replaced with STAGING",()=>{
  const cfg=JSON.parse(mainConfig);
  assert.equal(cfg.name,"lan-cloudinary-telemetry");
  assert.equal(cfg.vars.FIREBASE_PROJECT_ID,"rolando-portfolio-3f1a3");
  assert.ok(fbConfig.includes("rolando-portfolio-3f1a3"));
  assert.doesNotMatch(mainConfig,/lan-portfolio-staging/);
});

test("Admin/Public message collection and one-use server proof remain consistent",()=>{
  assert.match(service,/PRIVATE_MESSAGE_COLLECTION = "privateMessageThreads"/);
  assert.match(service,/subscribeAdminPrivateThreads\(/);
  assert.match(worker,/async function handlePublicMessageThreadCreate\(/);
  assert.match(worker,/await consumePrivateMessageVerification\(request, env, body\?\.verificationToken\)/);
  assert.match(worker,/await firestoreAdminCommit\(env, \[/);
});

test("no placeholder or hidden duplicate verifier is introduced",()=>{
  assert.equal((app.match(/function beginPublicMessageRetryCountdown\(/g)||[]).length,1);
  assert.equal((worker.match(/async function handleMessagePuzzleVerify\(/g)||[]).length,1);
  assert.equal((worker.match(/async function enforceMessagePuzzleCooldown\(/g)||[]).length,1);
});

test("obsolete delayed-warmup constant is removed; one canonical message owner remains",()=>{
  assert.doesNotMatch(mainRegion,/PUBLIC_MESSAGE_PUZZLE_NEXT_WARMUP_DELAY_MS/);
  assert.equal((app.match(/function beginPublicMessageRetryCountdown\(/g)||[]).length,1);
  assert.equal((app.match(/function loadPublicMessagePuzzleChallenge\(/g)||[]).length,1);
  assert.equal((app.match(/function warmPublicMessagePuzzleChallenge\(/g)||[]).length,1);
  assert.equal((worker.match(/async function handleMessagePuzzleVerify\(/g)||[]).length,1);
  assert.equal((coordinator.match(/op === "puzzle-cooldown-start"/g)||[]).length,1);
});
