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
  assert.equal((coordinator.match(/if \(op === "puzzle-cooldown-start" \|\| op === "puzzle-cooldown-check"\)/g)||[]).length,1,"Only one canonical coordinator cooldown branch may own security state");
});

test("LIVE published CSS outside approved canonical touch and slider declarations is preserved exactly",()=>{
  const css=read("styles.css");
  let frozenCss=css;
  const approved = [
    [";touch-action:manipulation}", "}"],
    ["font:inherit;font-size:16px;", "font:inherit;"],
    ["cursor:inherit;touch-action:none;appearance:none;background:transparent}.public-message-puzzle-slider input::-webkit-slider-thumb{appearance:none;width:2.75rem;height:2.75rem;margin:0;border:0;background:transparent}.public-message-puzzle-slider input::-moz-range-thumb{width:2.75rem;height:2.75rem;border:0;background:transparent}", "cursor:inherit}"],
    ["clip-path:url(#publicMessagePuzzlePieceShape)}.public-message-puzzle-target{",
     "clip-path:url(#publicMessagePuzzlePieceShape);transition:left .16s var(--ease),top .16s var(--ease),width .16s var(--ease),height .16s var(--ease)}.public-message-puzzle-target{"],
    [".public-message-puzzle-target{transition:left .16s var(--ease),top .16s var(--ease),width .16s var(--ease),height .16s var(--ease);background:",
     ".public-message-puzzle-target{background:"],
    [".public-message-puzzle-piece{transition:top .16s var(--ease),width .16s var(--ease),height .16s var(--ease);overflow:",
     ".public-message-puzzle-piece{overflow:"],
    ["box-shadow:0 .25rem .75rem rgba(8,120,227,.28)}.public-message-puzzle-thumb svg",
     "box-shadow:0 .25rem .75rem rgba(8,120,227,.28);transition:left .06s linear}.public-message-puzzle-thumb svg"]
  ];
  for(const [updated,original] of approved) {
    assert.equal(frozenCss.split(updated).length,2,"Exactly one approved existing CSS owner change: "+updated);
    frozenCss=frozenCss.replace(updated,original);
  }
  const marker=".public-message-puzzle-layer{";
  const start=frozenCss.indexOf(marker);
  const end=frozenCss.indexOf("\n",start);
  assert.ok(start>0 && end>start && frozenCss.split("\n").filter(line=>line.startsWith(marker)).length===1,"Exactly one top-level puzzle rule owner; media-query reuse is expected");
  const frozenFNV = text => {
    let h=2166136261;
    for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;
    return h.toString(16).padStart(8,"0");
  };
  assert.equal(frozenFNV(frozenCss.slice(0,start)),"7551b6c1","LIVE CSS before puzzle rules changed");
  assert.equal(frozenFNV(frozenCss.slice(end)),"47763787","LIVE footer/privacy/mobile CSS after puzzle rules changed");
  assert.match(css,/\.site-footer\.site-footer--storage\{/);
  assert.match(css,/\.storage-policy-panel/);
  // Index the candidate CSS independently: approved edits may change its length.
  // The reconstructed LIVE positions above remain the separate frozen-source guard.
  const candidateStart=css.indexOf(marker);
  const candidateEnd=css.indexOf("\n",candidateStart);
  assert.ok(candidateStart>0 && candidateEnd>candidateStart,"One complete candidate puzzle CSS owner");
  const puzzle=css.slice(candidateStart,candidateEnd);
  assert.match(puzzle,/\.public-message-puzzle-card\{[^}]*grid-auto-rows:max-content/);
  assert.match(puzzle,/\.public-message-puzzle-foot\{position:absolute;width:1px;height:1px;[^}]*overflow:hidden;clip-path:inset\(50%\)/,"The existing status footer is visually hidden without a duplicate CSS override");
  assert.match(puzzle,/\.public-message-turnstile-slot\{display:grid/);
});

test("published LIVE storage/privacy policy remains exact original release artifact",()=>{
  assert.equal(sha("storage-privacy.html"),"570c3d7db9c0cf16d281c662f3eb5b0bd13b20c9","Never replace the published Privacy Policy page with fallback or older content");
  const policy=read("storage-privacy.html");
  assert.match(policy,/LAN Portfolio Storage/);
  assert.match(app,/href="storage-privacy\.html"/,"LIVE footer must still link to the real policy page");
});
