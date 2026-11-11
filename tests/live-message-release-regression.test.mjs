import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {withoutAuthorizedPreviewAppOwners, withoutAuthorizedPreviewCssOwners} from "./public-preview-owner-allowlist.mjs";
import {normalizeRepoText, readReviewedPublicSource} from "./public-reviewed-baseline.mjs";

const read = relative => normalizeRepoText(readFileSync(new URL("../"+relative,import.meta.url),"utf8"));
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
// Only the two authorized source attributes may differ from the pinned reviewed
// Public baseline in this performance branch. Keep all other Public, Message,
// Admin and security source byte-identical after existing preview exclusions.
function reviewedPortraitDeliveryCandidate(baseline) {
  const replacements = [
    ["src=\"${escapeHtml(staticImageRendition(content.hero.image, \"card\"))}\"", "src=\"${escapeHtml(mediaUrl(staticImageRendition(content.hero.image, \"card\"), { delivery: \"card\" }))}\""],
    ["src=\"${escapeHtml(staticImageRendition(content.about.image, \"card\"))}\"", "src=\"${escapeHtml(mediaUrl(staticImageRendition(content.about.image, \"card\"), { delivery: \"card\" }))}\""]
  ];
  let expected = baseline;
  for (const [original, optimized] of replacements) {
    assert.equal(expected.split(original).length - 1, 1, "Reviewed baseline must contain one canonical portrait source");
    assert.equal(app.split(optimized).length - 1, 1, "Optimized source must not duplicate a portrait owner");
    expected = expected.replace(original, optimized);
  }
  return expected;
}
test("Public Message and unrelated app source match the reviewed main baseline outside preview owners",()=>{
  const liveBase=readReviewedPublicSource("app.js");
  const begin=app.indexOf("const PUBLIC_MESSAGE_TURNSTILE_SRC");
  const end=app.indexOf("\nfunction publicServicesValid(",begin);
  const baseBegin=liveBase.indexOf("const PUBLIC_MESSAGE_TURNSTILE_SRC");
  const baseEnd=liveBase.indexOf("\nfunction publicServicesValid(",baseBegin);
  assert.ok(begin>0 && end>begin && baseBegin>0 && baseEnd>baseBegin,"Canonical message boundaries must exist");
  assert.equal(app.slice(begin,end),liveBase.slice(baseBegin,baseEnd),"Message/slider logic must remain byte-identical");
  assert.equal(withoutAuthorizedPreviewAppOwners(app),withoutAuthorizedPreviewAppOwners(reviewedPortraitDeliveryCandidate(liveBase)),
    "Only explicit preview/media owners may change; protect all other Public, startup and security source");
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

test("Unrelated Public CSS matches the reviewed main baseline outside preview owners",()=>{
  const css=read("styles.css");
  const baseline=readReviewedPublicSource("styles.css");
  assert.equal(withoutAuthorizedPreviewCssOwners(css),withoutAuthorizedPreviewCssOwners(baseline),
    "No message puzzle, slider, footer, Admin, or unrelated responsive CSS may change");
  const marker=".public-message-puzzle-layer{";
  const start=css.indexOf(marker);
  const end=css.indexOf("\n",start);
  assert.ok(start>0 && end>start && css.split("\n").filter(line=>line.startsWith(marker)).length===1);
  const puzzle=css.slice(start,end);
  assert.match(puzzle,/\.public-message-puzzle-card\{[^}]*grid-auto-rows:max-content/);
  assert.match(puzzle,/\.public-message-puzzle-foot\{position:absolute;width:1px;height:1px;[^}]*overflow:hidden;clip-path:inset\(50%\)/);
  assert.match(puzzle,/\.public-message-turnstile-slot\{display:grid/);
  assert.match(css,/\.site-footer\.site-footer--storage\{/);
  assert.match(css,/\.storage-policy-panel/);
});

test("published LIVE storage/privacy policy remains exact original release artifact",()=>{
  assert.equal(sha("storage-privacy.html"),"570c3d7db9c0cf16d281c662f3eb5b0bd13b20c9","Never replace the published Privacy Policy page with fallback or older content");
  const policy=read("storage-privacy.html");
  assert.match(policy,/LAN Portfolio Storage/);
  assert.match(app,/href="storage-privacy\.html"/,"LIVE footer must still link to the real policy page");
});
