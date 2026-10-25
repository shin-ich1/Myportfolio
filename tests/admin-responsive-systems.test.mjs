import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const layout = read("admin/css/admin-layout.css");
const settings = read("admin/js/settings.js");
const notify = read("notification-service.js");
const comms = read("admin/js/settings-communications.js");

test("radar core and sweep remain available inside fluid compact layout", () => {
  assert.doesNotMatch(layout, /\.settings-radar-disc,\.settings-radar-core,\.settings-radar-link\{display:none\}/);
  assert.match(layout, /\.settings-radar-stage\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-rows:/);
  assert.match(layout, /\.settings-radar-disc,\.settings-radar-core\{display:block\}/);
  assert.match(read("admin/css/settings.css"), /\.settings-radar-sweep\s*\{[^}]*animation:\s*settings-radar-sweep/s);
  assert.match(read("admin/pages/settings.html"), /id="radarScanButton"/);
});

test("reduced motion produces a completed still frame and resume restarts one animation loop", () => {
  assert.match(settings, /function syncTelemetryMotionPreference\(\)\s*\{/);
  assert.match(settings, /reducedMotionPreference[^\n]*addEventListener\("change"[^\n]*syncTelemetryMotionPreference\(\)/);
  assert.match(settings, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\?\.addEventListener\?\.\("change", syncTelemetryMotionPreference\)/);
  const extract = name => {
    const start = settings.indexOf("function " + name + "(");
    assert.ok(start !== -1);
    const from = settings.indexOf("{", start);
    let depth = 0;
    for (let i = from; i < settings.length; i++) {
      if (settings[i] === "{") depth++;
      if (settings[i] === "}" && --depth === 0 && settings[i] === "}") return settings.slice(start, i + 1);
      if (settings[i] !== "}") continue;
    }
    throw Error("Function extract failed");
  };
  const frames=[], cancelled=[];
  const ctx={
    performance:{now:()=>12000},
    TELEMETRY_PLAYBACK_DRAW_MS:5000,
    telemetryChartFrame:21,
    telemetryLiveStartedAt:0,
    telemetryLiveModel:{},
    document:{hidden:false,body:{dataset:{settingsRoom:"general"}}},
    window:{cancelAnimationFrame:id=>cancelled.push(id),requestAnimationFrame:cb=>{frames.push(cb);return 44;}},
    settingsReducedMotion:()=>true,
    telemetryRenderLiveFrame:now=>frames.push({renderedAt:now,from:ctx.telemetryLiveStartedAt})
  };
  runInNewContext(extract("renderTelemetryStillFrame") + "\n" + extract("syncTelemetryMotionPreference"),ctx);
  ctx.syncTelemetryMotionPreference();
  assert.deepEqual(cancelled,[21]);
  assert.equal(frames.length,1);
  assert.equal(frames[0].renderedAt - frames[0].from,5000);
  ctx.settingsReducedMotion=()=>false;
  ctx.syncTelemetryMotionPreference();
  assert.equal(frames[1],ctx.telemetryRenderLiveFrame);
  assert.equal(ctx.telemetryChartFrame,44);
  ctx.document.hidden=true;
  ctx.syncTelemetryMotionPreference();
  assert.equal(frames.length,2);
});

test("Admin installation is standalone without changing the Public portfolio entrypoint",()=>{
  const manifest=JSON.parse(read("admin/manifest.webmanifest"));
  assert.equal(manifest.display,"standalone");
  assert.equal(manifest.scope,"/admin/");
  assert.match(manifest.start_url,/^\/admin\//);
  assert.ok(manifest.icons.some(x=>x.src==="/assets/brand/lan-mark.svg"&&x.sizes==="any"));
  assert.ok(existsSync(new URL("../assets/brand/lan-mark.svg",import.meta.url)));
  assert.ok(existsSync(new URL("../assets/images/hero.png",import.meta.url)));
  assert.match(read("admin/index.html"),/rel="manifest" href="\/admin\/manifest\.webmanifest"/);
  assert.match(read("admin/shell.html"),/rel="manifest" href="\/admin\/manifest\.webmanifest"/);
  assert.doesNotMatch(read("index.html"),/rel="manifest"/);
});

test("unsupported browser receives actionable Web Push guidance instead of false success",()=>{
  assert.match(notify,/On iPhone\/iPad, add the Admin site to your Home Screen/);
  assert.match(comms,/reason === "unsupported"/);
  assert.match(comms,/Notification support is unavailable in this browser context/);
  assert.match(comms,/enablePortfolioPush\(/);
});

test("unsupported browser never creates a fake push subscription",async()=>{
  const {getAdminPortfolioPushState,enablePortfolioPush}=await import("../notification-service.js");
  const previous=globalThis.window;
  globalThis.window={};
  try{
    const state=await getAdminPortfolioPushState({authorization:"test-token-not-real"});
    assert.equal(state.registered,false);
    assert.equal(state.reason,"unsupported");
    await assert.rejects(()=>enablePortfolioPush({audience:"admin"}),/Home Screen/);
  }finally{
    if(previous===undefined)delete globalThis.window;
    else globalThis.window=previous;
  }
});
