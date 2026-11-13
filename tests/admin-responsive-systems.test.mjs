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

test("media deletion sends the exact Worker request contract, with no unapproved reason field", async () => {
  const service = read("admin/services/mediaAssetLifecycleService.js");
  const begin = service.indexOf("function deletionContractReference(");
  const end = service.indexOf("\nasync function requestDeletion(", begin);
  assert.ok(begin >= 0 && end > begin);
  const requests = [];
  runInNewContext(service.slice(begin, end), {
    AbortController,
    REQUEST_TIMEOUT_MS: 15000,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    authorizedWorkerRequest: async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return { deleted: [], skipped: [] };
    }
  });
  // Run the extracted actual deletion-batch implementation, not a substitute serializer.
  const actual = runInNewContext(service.slice(begin, end) + "\nrequestDeletionBatch", {
    AbortController,
    REQUEST_TIMEOUT_MS: 15000,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    authorizedWorkerRequest: async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return { deleted: [], skipped: [] };
    }
  });
  await actual([{ provider: "cloudinary", assetId: "file" }], "media-cleanup");
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0].body), ["assets"], "Worker accepts only body.assets");
});

test("Worker validates persisted references server-side before physical media deletion", () => {
  const worker = read("telemetry-worker/src/index.js");
  const start = worker.indexOf("async function handleMediaDelete(");
  const end = worker.indexOf("\nconst PRIVATE_MESSAGE_THREAD_RE", start);
  assert.ok(start >= 0 && end > start);
  const handler = worker.slice(start, end);
  assert.match(handler, /await (?:findUnreferencedDeletionTargets|filterUnreferencedMediaDeletionTargets)\(/,
    "Provider deletion must require a server-owned cross-record reference scan");
  assert.ok(handler.indexOf("findUnreferencedDeletionTargets(") < handler.indexOf("cloudinaryDeleteAssetIds("),
    "Guard must run before Cloudinary API deletion");
  assert.ok(handler.indexOf("findUnreferencedDeletionTargets(") < handler.indexOf("deleteDriveManagedReference("),
    "Guard must run before Google Drive API deletion");
});

test("media cleanup keeps provider-skipped and partially failed assets pending, not silently lost", () => {
  const service = read("admin/services/mediaAssetLifecycleService.js");
  assert.match(service, /already-missing/, "Confirmed absence must not remain pending");
  assert.match(service, /autoRetry/, "New failed deletions need automatic safe retry metadata");
  assert.match(service, /recoverMediaAssetLifecycle\(\)[\s\S]*await deleteAndForget\(eligible/,
    "Recovery must reuse the canonical guarded deletion and queue reconciliation path");
  const bridge = read("admin/services/storageBridgeService.js");
  assert.match(bridge, /error\.(?:deleted|result)\s*=/,
    "Partial Worker 502 outcomes must not be discarded by the bridge");
});

test("server-side media inventory protects restorable Photo Editing files and fails closed on Firestore errors", async () => {
  const { sameManagedMediaReference, unreferencedManagedMediaReferences,
    MANAGED_MEDIA_RECORD_COLLECTIONS, MANAGED_MEDIA_RECORD_SINGLETONS } =
    await import("../media-asset-lifecycle.js");
  const worker = read("telemetry-worker/src/index.js");
  const start = worker.indexOf("async function findUnreferencedDeletionTargets(");
  const end = worker.indexOf("\nasync function handleMediaDelete(", start);
  assert.ok(start >= 0 && end > start);
  const retained = {
    isDeleted: true, status: "draft",
    beforeImage: { provider: "cloudinary", storageProfileId: "cloudinary-default",
      assetId: "used-by-restorable-record", publicId: "lan-portfolio/photo-editing/a", resourceType: "image" }
  };
  const requested = [
    retained.beforeImage,
    { provider: "google-drive", storageProfileId: "drive-main", assetId: "orphan-file", fileId: "orphan-file" }
  ];
  let verified = false;
  const ctx = {
    MANAGED_MEDIA_RECORD_COLLECTIONS, MANAGED_MEDIA_RECORD_SINGLETONS,
    sameManagedMediaReference, unreferencedManagedMediaReferences,
    firebaseAdminAccessToken: async () => { verified = true; },
    securityQueryAll: async (_, collection) => collection === "photoEditingProjects" ? [retained] : [],
    firestoreAdminGetDocument: async () => null,
    fromFirestoreDoc: value => value
  };
  const guard = runInNewContext(worker.slice(start, end) + "\nfindUnreferencedDeletionTargets", ctx);
  const result = await guard(requested, {});
  assert.equal(verified, true);
  assert.deepEqual(Array.from(result.protected, x => x.assetId), ["used-by-restorable-record"]);
  assert.deepEqual(Array.from(result.deletable, x => x.assetId), ["orphan-file"]);
  ctx.securityQueryAll = async () => { throw new Error("Firestore unavailable"); };
  await assert.rejects(guard(requested, {}), /Firestore unavailable/,
    "An incomplete reference scan must never authorize provider deletion");
});

test("partial Cloudinary and Drive cleanup retries only unconfirmed files after provider validation", async () => {
  const service = read("admin/services/mediaAssetLifecycleService.js");
  const begin = service.indexOf("function deletionContractReference(");
  const end = service.indexOf("\nexport async function recoverMediaAssetLifecycle()", begin);
  assert.ok(begin >= 0 && end > begin);
  const store = new Map();
  const key = { TEMPORARY_ASSETS_KEY: "temporary", DELETE_QUEUE_KEY: "queue",
    LEGACY_DELETE_QUEUE_KEY: "legacy", MEDIA_LIFECYCLE_SESSION_ID: "current" };
  const cloudinary = id => ({ provider: "cloudinary", storageProfileId: "cloudinary-default", assetId: id });
  const drive = id => ({ provider: "google-drive", storageProfileId: "drive-main", assetId: id });
  const assets = [cloudinary("done"), cloudinary("shared"), drive("retry")];
  const calls = [];
  const ctx = {
    ...key, REQUEST_TIMEOUT_MS: 15000, AbortController,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    readList: name => JSON.parse(store.get(name) || "[]"),
    readDeletionQueue: () => JSON.parse(store.get("queue") || "[]"),
    writeList: (name, value) => { store.set(name, JSON.stringify(value)); return true; },
    readTemporaryEntries: () => [],
    removeTemporaryReferences: records => records,
    collectManagedMediaReferences: items => items,
    removedManagedMediaReferences: items => items,
    uniqueManagedMediaReferences: items => items,
    sameManagedMediaReference: (a, b) => a?.provider === b?.provider && a?.assetId === b?.assetId,
    authorizedWorkerRequest: async (_, options) => {
      calls.push(JSON.parse(options.body).assets.map(x => x.assetId));
      if (calls.length === 1) {
        const error = new Error("Partial provider response");
        error.result = { deleted: [cloudinary("done")],
          skipped: [{ reference: cloudinary("shared"), reason: "still-referenced" }],
          failed: [{ reference: drive("retry"), error: "Provider unavailable" }] };
        throw error;
      }
      return { deleted: [cloudinary("shared"), drive("retry")], skipped: [], failed: [] };
    }
  };
  const source = service.slice(begin, end).replaceAll("export async function", "async function")
    .replaceAll("export function", "function") +
    "\n" + service.slice(end).replace("export async function", "async function");
  runInNewContext(source, ctx);
  const result = await ctx.removeManagedMediaAssets(assets);
  assert.equal(result.deleted.length, 1, "Retain provider-confirmed partial success");
  assert.equal(result.queued, true);
  assert.equal(result.pendingCount, 2);
  const queue = JSON.parse(store.get("queue") || "[]");
  assert.deepEqual(queue.map(item => item.asset.assetId), ["shared", "retry"]);
  assert.ok(queue.every(item => item.autoRetry === true));
  const retry = await ctx.recoverMediaAssetLifecycle();
  assert.equal(retry.queued, false);
  assert.equal(JSON.parse(store.get("queue") || "[]").length, 0);
  assert.deepEqual(calls, [["done", "shared", "retry"], ["shared", "retry"]]);
});

test("hard deletion is ordered after reference-intent queueing; soft deletion remains restorable", () => {
  const projects = read("admin/services/projectService.js");
  const modules = read("admin/services/portfolioSectionService.js");
  const photos = read("admin/services/photoEditingService.js");
  const section = (code, marker, end) => code.slice(code.indexOf(marker), code.indexOf(end, code.indexOf(marker)));
  const projectDelete = section(projects, "export async function deleteProject(", "export async function loadProjects(");
  assert.ok(projectDelete.indexOf("queueManagedMediaCleanup(") < projectDelete.indexOf("await deleteDoc("));
  assert.ok(projectDelete.indexOf("await deleteDoc(") < projectDelete.indexOf("await cleanupDeletedRecordMedia("));
  const moduleDelete = section(modules, "export async function deleteSectionPermanently(", "export async function deleteSection(");
  assert.ok(moduleDelete.indexOf("queueManagedMediaCleanup(") < moduleDelete.indexOf("await deleteEntryDocumentsInChunks("));
  assert.ok(moduleDelete.indexOf("await deleteDoc(") < moduleDelete.indexOf("await cleanupModuleOwnedMedia("));
  const photoSoftDelete = section(photos, "export async function removePhotoEditingProject(", "export async function restorePhotoEditingProject(");
  assert.match(photoSoftDelete, /isDeleted: true/);
  assert.doesNotMatch(photoSoftDelete, /cleanup.*Media|queueManagedMediaCleanup/);
});

test("unavailable media recovery storage blocks hard delete instead of losing cleanup intent", async () => {
  const service = read("admin/services/mediaAssetLifecycleService.js");
  const start = service.indexOf("function readDeletionQueue() {");
  const end = service.indexOf("\nfunction normalizeTemporaryEntry(", start);
  assert.ok(start >= 0 && end > start);
  const load = runInNewContext(service.slice(start, end) + "\nreadDeletionQueue", {
    DELETE_QUEUE_KEY: "media-queue",
    localStorage: { getItem: () => { throw new Error("Storage disabled"); } }
  });
  assert.throws(() => load(), /Media cleanup recovery storage is unavailable/);
  const projects = read("admin/services/projectService.js");
  const first = projects.indexOf("export async function deleteProject(");
  const last = projects.indexOf("\nexport async function loadProjects()", first);
  let deleted = false;
  const ctx = {
    PROJECT_COLLECTION: "projects", db: {},
    doc: () => ({}),
    getDoc: async () => ({ exists: () => true, data: () => ({ coverImage: { assetId: "A" } }) }),
    projectOwnedMedia: doc => doc,
    queueManagedMediaCleanup: () => { throw new Error("Media cleanup recovery storage is unavailable"); },
    deleteDoc: async () => { deleted = true; },
    cleanupDeletedRecordMedia: async () => ({ deleted: [], skipped: [], queued: false }),
    announcePortfolioContentChanged: () => {}
  };
  runInNewContext(projects.slice(first, last).replace("export async function", "async function"), ctx);
  await assert.rejects(ctx.deleteProject("project-1"), /Media cleanup recovery storage is unavailable/);
  assert.equal(deleted, false, "Never hard-delete a record when its recovery intent cannot be persisted");
  const modules = read("admin/services/moduleLifecycleService.js");
  assert.doesNotMatch(modules, /deleteProject\(project\.id,\s*\{\s*strictMediaCleanup:\s*true/,
    "Linked modules cannot physically delete shared media before their owner entries are gone");
});

test("Worker physically deletes only references cleared by its server-side scan", async () => {
  const source = read("telemetry-worker/src/index.js");
  const start = source.indexOf("async function handleMediaDelete(");
  const end = source.indexOf("\nconst PRIVATE_MESSAGE_THREAD_RE", start);
  assert.ok(start >= 0 && end > start);
  const cloud = { provider: "cloudinary", assetId: "cloud-same", publicId: "lan-portfolio/photo-editing/image", resourceType: "image" };
  const drive = { provider: "google-drive", storageProfileId: "drive-main", assetId: "file-unused" };
  const requests = [cloud, drive];
  const actions = [];
  let protectedMode = true;
  let rejection = false;
  const ctx = {
    allowedOrigin: () => "https://portfolio.web.app",
    requireSecurityApprovedAdministrator: async () => ({ uid: "admin" }),
    enforceAdminServiceRateLimit: async () => {},
    readStrictJsonBody: async () => ({ assets: requests }),
    ASSET_REFERENCE_SCHEMA: {},
    findUnreferencedDeletionTargets: async submitted => {
      if (rejection) throw Object.assign(new Error("Cannot verify references"), { status: 503, code: "reference-scan-failed" });
      return protectedMode ? { deletable: [], protected: submitted } : { deletable: submitted, protected: [] };
    },
    mediaReferenceProvider: ref => ref.provider,
    resolveAssetReference: async ref => ({ ...ref, secureUrl: "https://res.cloudinary.com/test/image/upload/demo" }),
    assetBelongsToManagedFolder: () => true,
    cloudinaryDeleteAssetIds: async ids => {
      actions.push({ provider: "cloudinary", ids });
      return { deleted: Object.fromEntries(ids.map(id => [id, "deleted"])) };
    },
    deleteDriveManagedReference: async ref => {
      actions.push({ provider: "google-drive", id: ref.assetId });
      return { deleted: true, asset: ref };
    },
    json: (data, status) => ({ data, status }),
    serviceError: (...args) => { throw new Error(String(args[0])); }
  };
  const handler = runInNewContext(source.slice(start, end) + "\nhandleMediaDelete", ctx);
  const request = { headers: { get: () => "https://portfolio.web.app" } };
  const blocked = await handler(request, {});
  assert.equal(blocked.status, 200);
  assert.deepEqual(Array.from(blocked.data.skipped, item => item.reason), ["still-referenced", "still-referenced"]);
  assert.equal(actions.length, 0, "No provider calls while other CMS records still reference media");
  protectedMode = false;
  const safe = await handler(request, {});
  assert.equal(safe.status, 200);
  assert.equal(safe.data.deleted.length, 2);
  assert.deepEqual(actions.map(item => item.provider), ["cloudinary", "google-drive"]);
  rejection = true;
  const denied = await handler(request, {});
  assert.equal(denied.status, 503);
  assert.equal(actions.length, 2, "Reference scan outage must not trigger provider calls");
});


test("Project deletion notices distinguish pending storage cleanup from confirmed completion", async () => {
  // Git for Windows may check out CRLF; normalize only the test fixture so the
  // actual Admin handlers are extracted identically on Windows and Linux.
  const source = read("admin/js/projects.js").replace(/\r\n?/g, "\n");
  const helperStart = source.indexOf("function notifyProjectDeletionOutcomes(");
  const helperEnd = source.indexOf("\nfunction markAsChanged(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "Exercise the canonical Project notification owner");
  const notificationHelper = source.slice(helperStart, helperEnd);
  const singleStart = source.indexOf("async function confirmDelete() {");
  const singleEnd = source.indexOf("\nfunction setupDropZone(", singleStart);
  assert.ok(singleStart >= 0 && singleEnd > singleStart, "Use the real single-delete handler");

  async function runSingle(mediaCleanup) {
    const notices = [];
    const button = {
      textContent: "Delete Permanently",
      disabled: false,
      setAttribute() {},
      removeAttribute() {}
    };
    const context = {
      pendingDeleteId: "project-one",
      isDeleting: false,
      $: id => id === "confirmDeleteButton" ? button : null,
      deleteProject: async () => ({ id: "project-one", mediaCleanup }),
      notify: (message, type = "success") => notices.push({ message, type }),
      closeDelete() {},
      closeForm() {},
      refresh: async () => {},
      console
    };
    const deleteOne = runInNewContext(
      notificationHelper + "\n" + source.slice(singleStart, singleEnd) + "\nconfirmDelete", context
    );
    await deleteOne();
    return notices;
  }

  const pendingSingle = await runSingle({ queued: true, pendingCount: 1 });
  assert.equal(pendingSingle.length, 1);
  assert.equal(pendingSingle[0].type, "warning", "Pending provider cleanup is not full deletion success");
  assert.match(pendingSingle[0].message, /project.*delet/i);
  assert.match(pendingSingle[0].message, /(?:storage|media).*(?:pending|queued)|(?:pending|queued).*(?:storage|media)/i);

  const finishedSingle = await runSingle({ queued: false, pendingCount: 0 });
  assert.equal(finishedSingle.length, 1);
  assert.equal(finishedSingle[0].type, "success", "Confirmed cleanup keeps normal success feedback");

  const bulkStart = source.indexOf("onDelete: async (ids) => {");
  const bulkEnd = source.indexOf("\n    }\n  })?.sync();", bulkStart);
  assert.ok(bulkStart >= 0 && bulkEnd > bulkStart, "Use the real bulk-delete handler");
  const bulkFn = source.slice(
    bulkStart + "onDelete: ".length, bulkEnd + "\n    }".length
  );

  async function runBulk(pendingIds) {
    const notices = [];
    const context = {
      deleteProject: async id => ({ id, mediaCleanup: { queued: pendingIds.has(id) } }),
      idInput: { value: "" },
      closeForm() {},
      refresh: async () => {},
      notify: (message, type = "success") => notices.push({ message, type })
    };
    const bulkDelete = runInNewContext(notificationHelper + "\n(" + bulkFn + ")", context);
    await bulkDelete(["project-one", "project-two"]);
    return notices;
  }

  const pendingBulk = await runBulk(new Set(["project-two"]));
  assert.equal(pendingBulk.length, 1);
  assert.equal(pendingBulk[0].type, "warning", "Bulk deletion cannot report full success with queued assets");
  assert.match(pendingBulk[0].message, /(?:storage|media).*(?:pending|queued)|(?:pending|queued).*(?:storage|media)/i);

  const finishedBulk = await runBulk(new Set());
  assert.equal(finishedBulk.length, 1);
  assert.equal(finishedBulk[0].type, "success");
});
