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

test("Security & Access initializes on demand without duplicate overview reads", async () => {
  const source = read("admin/js/settings-security.js");
  const start = source.indexOf("async function refresh() {");
  const end = source.indexOf("function stopEnrollmentApprovalWatch()", start);
  assert.ok(start >= 0 && end > start, "Use the existing Security refresh and tab handlers");

  let visible = false;
  let resolveOverview;
  const deferredOverview = new Promise(resolve => { resolveOverview = resolve; });
  const listeners = new Map();
  const calls = { overview: 0, access: 0, branding: 0, render: 0 };
  const on = (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]);
  const context = {
    overview: null,
    securityOverviewRefreshInFlight: null,
    securityAccessStateRefreshInFlight: false,
    window: { addEventListener: on },
    document: {
      visibilityState: "visible",
      querySelector: () => ({ classList: { contains: () => !visible } }),
      addEventListener: on
    },
    $: () => ({ textContent: "", className: "" }),
    getSecurityOverview: () => { calls.overview++; return deferredOverview; },
    getSecurityAccessState: async () => {
      calls.access++;
      return { devices: [], sessions: [], capabilities: { securityManagement: false } };
    },
    loadBranding: async () => { calls.branding++; },
    render: () => { calls.render++; },
    console
  };
  runInNewContext(source.slice(start, end), context);

  assert.equal(calls.overview, 0, "Control-only startup must not fetch the security overview");
  visible = true;
  const first = context.refreshSecurityAccessState();
  const duplicate = context.refreshSecurityAccessState();
  assert.equal(calls.overview, 1, "Concurrent Security activation must share one overview request");
  assert.equal(calls.branding, 1, "First activation must also initialize branding");
  resolveOverview({ devices: [], sessions: [], events: [], capabilities: {} });
  await Promise.all([first, duplicate]);
  assert.equal(calls.render, 1, "Complete overview must render on first activation");
  assert.equal(calls.access, 0, "First activation must not immediately refetch the same lists");

  const focus = listeners.get("focus")?.[0];
  const visibility = listeners.get("visibilitychange")?.[0];
  assert.equal(typeof focus, "function");
  assert.equal(typeof visibility, "function");
  focus();
  visibility();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.access, 1, "Concurrent focus and visibility events must share one access-state request");

  visible = false;
  focus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.access, 1, "Hidden Security panel must not refresh access-state lists");

  const boot = source.slice(source.indexOf("const incomingEnrollmentId ="));
  assert.match(boot, /if\s*\(incomingEnrollmentId\)\s*\{/,
    "Incoming trusted-device enrollment must retain an explicit startup path");
  assert.match(boot, /await Promise\.all\(\[refresh\(\), loadBranding\(\)\]\)/,
    "Incoming enrollment must initialize overview and branding before approval handling");
  assert.match(boot, /initializeIncomingEnrollment\(incomingEnrollmentId\)/);
  assert.doesNotMatch(boot, /await refresh\(\);\s*if\s*\(incomingEnrollmentId\)/,
    "Control-only startup must not eagerly load the overview");
});

test("Security startup skips hidden Control, but preserves active and enrollment routes", async () => {
  const security = read("admin/js/settings-security.js");
  const start = security.indexOf("const incomingEnrollmentId =");
  assert.ok(start >= 0);
  const boot = security.slice(start).replace(
    "void (async () => {", "globalThis.securityBoot = (async () => {"
  );
  const run = async (search, visible) => {
    const calls = [];
    const context = {
      URLSearchParams,
      window: { location: { search } },
      securityPanelIsLiveVisible: () => visible,
      refresh: async () => { calls.push("overview"); },
      loadBranding: async () => { calls.push("branding"); },
      refreshSecurityAccessState: async () => { calls.push("access"); },
      initializeIncomingEnrollment: async (id) => { calls.push("enroll:" + id); }
    };
    runInNewContext(boot, context);
    await context.securityBoot;
    return calls;
  };
  assert.deepEqual(await run("", false), [], "Hidden Control must not trigger security reads");
  assert.deepEqual(await run("", true), ["access"], "Direct Security opening must initialize");
  assert.deepEqual(await run("?approveDeviceEnrollment=challenge123", false),
    ["overview", "branding", "enroll:challenge123"],
    "Incoming trusted-device link must prepare Security before enrollment");
});

test("Security branding initialization shares one request and reuses loaded result", async () => {
  const security = read("admin/js/settings-security.js");
  const start = security.indexOf("async function loadBranding() {");
  const end = security.indexOf("\n$('securityEmailBrandingForm')", start);
  assert.ok(start >= 0 && end > start);
  const fields = new Map();
  let resolveBranding;
  let fetches = 0;
  const gate = new Promise(resolve => { resolveBranding = resolve; });
  const context = {
    securityBrandingInFlight: null,
    securityBrandingLoaded: false,
    getSecurityEmailBranding: () => { fetches++; return gate; },
    $: id => {
      if (!fields.has(id)) fields.set(id, { value: "", textContent: "" });
      return fields.get(id);
    }
  };
  runInNewContext(security.slice(start, end), context);
  const first = context.loadBranding();
  const duplicate = context.loadBranding();
  assert.equal(fetches, 1, "Concurrent activation must not repeat branding requests");
  resolveBranding({ branding: { heading: "Security ready" }, provider: "configured" });
  await Promise.all([first, duplicate]);
  await context.loadBranding();
  assert.equal(fetches, 1, "Already-loaded branding must not be fetched again");
  assert.equal(fields.get("securityEmailHeading").value, "Security ready");
});

test("media delete outbound payload matches the strict Worker asset schema", async () => {
  const service = read("admin/services/mediaAssetLifecycleService.js");
  const worker = read("telemetry-worker/src/index.js");
  const schema = worker.match(/const ASSET_REFERENCE_SCHEMA = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(schema, "Read the canonical Worker schema rather than weakening it");
  const allowed = new Set([...schema[1].matchAll(/(\w+): REQUEST_SCHEMA_ANY/g)].map((match) => match[1]));
  const begin = service.indexOf("async function requestDeletionBatch(");
  const end = service.indexOf("\nasync function requestDeletion(", begin);
  assert.ok(begin >= 0 && end > begin);

  const requests = [];
  const context = {
    AbortController,
    window: { setTimeout: () => 10, clearTimeout: () => {} },
    REQUEST_TIMEOUT_MS: 15000,
    authorizedWorkerRequest: async (path, options) => {
      requests.push({ path, data: JSON.parse(options.body) });
      return { deleted: [], skipped: [] };
    }
  };
  runInNewContext(service.slice(begin, end), context);
  const assets = [
    { provider: "cloudinary", assetId: "asset-one", publicId: "lan-portfolio/a", resourceType: "image",
      url: "https://res.cloudinary.com/example/image/upload/a", uploadedAt: "yesterday",
      schemaVersion: 2, width: 1280, height: 720, cardUrl: "derived" },
    { provider: "google-drive", storageProfileId: "profile", fileId: "managed-file",
      assetId: "managed-file", context: { ownerId: "test-only" }, uploadedAt: "yesterday" }
  ];
  await context.requestDeletionBatch(assets, "explicit-media-remove");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/media/delete");
  assert.equal(requests[0].data.reason, "explicit-media-remove");
  assert.equal(requests[0].data.assets.length, 2);
  for (const asset of requests[0].data.assets) {
    assert.ok(Object.keys(asset).every(key => allowed.has(key)),
      "Do not send display metadata rejected by the existing strict Worker schema");
  }
  assert.equal(requests[0].data.assets[0].assetId, "asset-one");
  assert.equal(requests[0].data.assets[1].fileId, "managed-file");
  assert.equal(requests[0].data.assets[1].storageProfileId, "profile");
});

test("Admin startup never silently deletes preexisting queued or abandoned media", async () => {
  const service = read("admin/services/mediaAssetLifecycleService.js");
  const begin = service.indexOf("export async function recoverMediaAssetLifecycle() {");
  assert.ok(begin >= 0);
  const writes = [];
  let deletions = 0;
  const abandoned = { provider: "cloudinary", assetId: "old-temporary-asset" };
  const queued = { provider: "google-drive", assetId: "old-managed-file", storageProfileId: "profile" };
  const context = {
    MEDIA_LIFECYCLE_SESSION_ID: "current-session",
    TEMPORARY_ASSETS_KEY: "temporary",
    DELETE_QUEUE_KEY: "queue",
    readTemporaryEntries: () => [{ asset: abandoned, sessionId: "previous-session" }],
    readList: key => key === "queue" ? [{ asset: queued }] : [],
    uniqueManagedMediaReferences: values => values,
    writeList: (key, value) => { writes.push({ key, value }); },
    requestDeletion: async () => { deletions++; return { deleted: [], skipped: [] }; },
    queueDeletion: () => { writes.push({ key: "queue-retry" }); }
  };
  runInNewContext(service.slice(begin).replace("export async function", "async function"), context);
  const state = await context.recoverMediaAssetLifecycle();
  assert.equal(deletions, 0, "Auto-recovery cannot verify that old assets are unreferenced");
  assert.equal(writes.length, 0, "Preserve pending records for later explicit verification");
  assert.equal(state.queued, true, "Existing entries remain pending");
  assert.equal(state.reviewRequired, true, "Require ownership review before deletion");
});

test("Explicit CMS media removal still sends real provider deletion requests", async () => {
  const source = read("admin/services/mediaAssetLifecycleService.js");
  const start = source.indexOf("async function requestDeletionBatch(");
  const end = source.indexOf("\nexport async function recoverMediaAssetLifecycle()", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    AbortController,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    REQUEST_TIMEOUT_MS: 15000,
    TEMPORARY_ASSETS_KEY: "temporary",
    DELETE_QUEUE_KEY: "queue",
    readTemporaryEntries: () => [],
    readList: () => [],
    writeList: () => {},
    removeTemporaryReferences: entries => entries,
    sameManagedMediaReference: (first, second) => first?.assetId === second?.assetId,
    collectManagedMediaReferences: assets => assets,
    removedManagedMediaReferences: (before) => before,
    uniqueManagedMediaReferences: assets => assets,
    authorizedWorkerRequest: async (path, options) => {
      const data = JSON.parse(options.body);
      calls.push({ path, method: options.method, data });
      return { deleted: data.assets, skipped: [] };
    }
  };
  runInNewContext(source.slice(start, end).replaceAll("export async function", "async function")
    .replaceAll("export function", "function"), context);
  const cloudinary = { provider: "cloudinary", assetId: "cloudinary-file", publicId: "lan-portfolio/test", uploadedAt: "old" };
  const drive = { provider: "google-drive", storageProfileId: "managed-profile", assetId: "drive-file", fileId: "drive-file" };
  const manual = await context.removeManagedMediaAssets([cloudinary]);
  const deletedRecord = await context.cleanupDeletedRecordMedia([drive], { reason: "record-deleted", strict: true });
  assert.equal(calls.length, 2, "User-requested removal and record deletion must both invoke storage deletion");
  assert.deepEqual(calls.map(c => c.path), ["/media/delete", "/media/delete"]);
  assert.ok(calls.every(c => c.method === "POST"));
  assert.equal(calls[0].data.assets[0].assetId, "cloudinary-file");
  assert.equal(calls[1].data.assets[0].assetId, "drive-file");
  assert.equal(calls[1].data.assets[0].storageProfileId, "managed-profile");
  assert.equal(manual.queued, false);
  assert.equal(manual.deleted.length, 1);
  assert.equal(deletedRecord.queued, false);
  assert.equal(deletedRecord.deleted.length, 1);
});

test("hard-deleting a Project reports failed storage cleanup rather than claiming provider deletion", async () => {
  const source = read("admin/services/projectService.js");
  const start = source.indexOf("export async function deleteProject(");
  const end = source.indexOf("\nexport async function loadProjects()", start);
  assert.ok(start >= 0 && end > start);
  let recordDeleted = false;
  const context = {
    db: {},
    PROJECT_COLLECTION: "projects",
    doc: (_, collection, id) => ({ collection, id }),
    getDoc: async () => ({ exists: () => true, data: () => ({ coverImage: { assetId: "test-cover" } }) }),
    projectOwnedMedia: data => [data.coverImage],
    cleanupDeletedRecordMedia: async () => ({ deleted: [], skipped: [], queued: true, error: new Error("Provider unavailable") }),
    deleteDoc: async () => { recordDeleted = true; },
    announcePortfolioContentChanged: () => {}
  };
  runInNewContext(source.slice(start, end).replace("export async function", "async function"), context);
  const result = await context.deleteProject("project-1");
  assert.equal(recordDeleted, true, "Keep existing hard-delete semantics");
  assert.equal(result?.mediaCleanup?.queued, true, "Report pending storage deletion to caller");
  assert.equal(result?.id, "project-1");
  const ui = read("admin/js/projects.js");
  assert.match(ui, /function projectMediaCleanupPending\(result\)/,
    "A single Admin status owner must identify incomplete provider deletions");
  assert.match(ui, /const cleanup = result\?\.mediaCleanup/,
    "Project Admin must read the actual provider deletion outcome");
  assert.match(ui, /projectMediaCleanupPending\(result\)/,
    "Manual Project deletion must check provider completion before showing success");
  assert.match(ui, /outcomes\.some\(projectMediaCleanupPending\)/,
    "Bulk Project deletion must report incomplete provider cleanup too");
  assert.match(ui, /storage cleanup pending|storage deletion pending|storage file deletion is pending/i);
});
