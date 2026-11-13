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


test("Google Drive upload folders follow content categories and avoid opaque record subfolders", () => {
  // Test the actual Worker folder planner, independent of OAuth or live Drive files.
  const worker = read("telemetry-worker/src/index.js").replace(/\r\n?/g, "\n");
  const begin = worker.indexOf("function driveLogicalSegments(");
  const end = worker.indexOf("\nasync function driveEnsureChildFolder(", begin);
  assert.ok(begin >= 0 && end > begin, "Canonical Worker folder planner must exist");
  const plan = runInNewContext(worker.slice(begin, end) + "\ndriveLogicalSegments", {});

  const firstPhoto = plan({
    ownerType: "photo-editing", ownerId: "opaque-photo-record-a", categoryName: "Product Ads"
  });
  assert.deepEqual(Array.from(firstPhoto, x => x.displayName), ["photo-editing", "Product Ads"]);
  assert.ok(firstPhoto.every(x => !x.displayName.includes("opaque-photo-record")));
  const sameCategoryDifferentRecord = plan({
    ownerType: "photo-editing", ownerId: "opaque-photo-record-b", categoryName: "Product Ads"
  });
  assert.deepEqual(Array.from(sameCategoryDifferentRecord, x => x.logicalKey),
    Array.from(firstPhoto, x => x.logicalKey),
    "Records in the same category must share one category folder");

  const projects = plan({
    ownerType: "project", ownerId: "opaque-project-id", pageName: "Projects", recordTitle: "Project A"
  });
  assert.deepEqual(Array.from(projects, x => x.displayName), ["Projects"],
    "Projects without an explicit category belong directly in Projects");

  const noCategoryPhoto = plan({ ownerType: "photo-editing", ownerId: "opaque-photo-record-c" });
  assert.deepEqual(Array.from(noCategoryPhoto, x => x.displayName), ["photo-editing"],
    "Missing category must never create a synthetic Record folder");

  const admin = read("admin/js/photo-editing.js").replace(/\r\n?/g, "\n");
  const uploadStart = admin.indexOf("async function uploadPendingImages(");
  const uploadEnd = admin.indexOf("\nasync function saveProject(", uploadStart);
  assert.ok(uploadStart >= 0 && uploadEnd > uploadStart);
  const uploadCode = admin.slice(uploadStart, uploadEnd);
  assert.match(uploadCode, /const categoryRouting\s*=\s*\{\s*context:\s*\{\s*categoryName:\s*resolvedCategoryValue\(\)/,
    "The Photo Editing upload caller must derive the selected CMS category once");
  assert.equal([...uploadCode.matchAll(/categoryRouting\s*\n\s*\)/g)].length, 2,
    "Comparison/single and gallery uploads must use the same category route");
  const photoService = read("admin/services/photoEditingService.js");
  assert.match(photoService, /context:\s*\{\s*\.\.\.\(routing\.context\s*\|\|\s*\{\}\)/,
    "Photo Editing upload service must forward context to the shared uploader");
  const provider = read("admin/services/storageProviders/googleDriveStorageProvider.js");
  assert.match(provider, /categoryName:\s*text\(context\.categoryName\)/,
    "Drive provider must forward the selected category, normalized, without local folder creation");
  assert.match(worker, /const DRIVE_CONTEXT_SCHEMA[\s\S]*?categoryName:\s*REQUEST_SCHEMA_ANY/,
    "Worker must explicitly validate the category field");
});


function createMockDriveFolderRuntime() {
  const worker = read("telemetry-worker/src/index.js").replace(/\r\n?/g, "\n");
  const start = worker.indexOf("async function driveEnsureRoot(");
  const end = worker.indexOf("\nasync function handleDriveConnectStart(", start);
  assert.ok(start >= 0 && end > start, "Use actual canonical Worker Drive folder functions");
  const stored = new Map();
  const folders = new Map();
  const operations = [];
  const transientFailures = new Set();
  let nextId = 0;
  const reply = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
  const driveApi = async (_profileId, _env, url, options = {}) => {
    const endpoint = new URL(url);
    const method = options.method || "GET";
    const parts = endpoint.pathname.split("/");
    const id = parts[parts.indexOf("files") + 1];
    if (id && id !== "files") {
      if (transientFailures.has(id)) return reply({ error: "temporarily unavailable" }, 503);
      if (parts.includes("permissions")) {
        const folder = folders.get(id);
        return folder && !folder.trashed
          ? reply({ permissions: folder.public ? [{ type: "anyone", role: "reader" }] : [] })
          : reply({ error: "notFound" }, 404);
      }
      if (method === "PATCH") {
        const folder = folders.get(id);
        if (!folder || folder.trashed) return reply({ error: "notFound" }, 404);
        const patch = JSON.parse(options.body);
        Object.assign(folder, patch);
        operations.push({ method, id, patch });
        return reply(folder);
      }
      const folder = folders.get(id);
      return folder ? reply(folder) : reply({ error: "notFound" }, 404);
    }
    if (method === "POST") {
      const attrs = JSON.parse(options.body);
      const folder = {
        id: "created-" + (++nextId),
        name: attrs.name, mimeType: attrs.mimeType,
        parents: attrs.parents || [], appProperties: attrs.appProperties || {},
        trashed: false, public: false
      };
      folders.set(folder.id, folder);
      operations.push({ method, folder: { ...folder } });
      return reply(folder);
    }
    const q = endpoint.searchParams.get("q") || "";
    const match = (expression) => expression.exec(q)?.[1] || "";
    const requestedName = match(/name = '([^']+)'/);
    const parent = match(/'([^']+)' in parents/);
    const logicalKey = match(/key='lanLogicalKey' and value='([^']+)'/);
    const profile = match(/key='lanStorageProfile' and value='([^']+)'/);
    const requireRoot = q.includes("key='lanStorageRoot'");
    return reply({ files: [...folders.values()].filter(folder =>
      !folder.trashed && folder.mimeType === "application/vnd.google-apps.folder" &&
      (!requestedName || folder.name === requestedName) &&
      (!parent || folder.parents.includes(parent)) &&
      (!logicalKey || folder.appProperties.lanLogicalKey === logicalKey) &&
      (!profile || folder.appProperties.lanStorageProfile === profile) &&
      (!requireRoot || folder.appProperties.lanStorageRoot === "1")
    ) });
  };
  const context = {
    DRIVE_ROOT_NAME: "LAN Portfolio CMS",
    DRIVE_FOLDER_MIME: "application/vnd.google-apps.folder",
    DRIVE_PUBLIC_VERIFY_TTL_MS: 300000,
    driveApi,
    kvJsonGet: async (_, key) => stored.get(key) || null,
    kvJsonPut: async (_, key, value) => { stored.set(key, value); },
    storageKv: () => ({ delete: async key => { stored.delete(key); operations.push({ method: "KV_DELETE", key }); } }),
    driveProfileKey: id => "drive-profile:" + id,
    driveFolderKey: (id, parent, key) => "drive-folder:" + id + ":" + parent + ":" + key,
    driveManagementUrl: id => "https://drive.google.com/drive/folders/" + id,
    escapeDriveQuery: value => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'"),
    serviceError: (message, attrs) => Object.assign(new Error(message), attrs),
    Date, URL, Response, encodeURIComponent
  };
  const actions = runInNewContext(worker.slice(start, end) +
    "\n({ driveEnsureRoot, driveCheckPublicAccess, driveEnsureChildFolder, driveEnsureContextFolder })", context);
  return { ...actions, stored, folders, operations, transientFailures, env: {} };
}

test("Google Drive root reconciliation replaces deleted and legacy roots without restoring test media", async () => {
  const runtime = createMockDriveFolderRuntime();
  runtime.stored.set("drive-profile:profile-A", {
    profileId: "profile-A", rootFolderId: "old-deleted-id",
    rootFolderName: "LΛN Portfolio CMS - Public Storage", publicReady: true,
    publicVerifiedAt: Date.now()
  });
  const root = await runtime.driveEnsureRoot("profile-A", runtime.env);
  assert.equal(root.rootFolderName, "LAN Portfolio CMS");
  assert.notEqual(root.rootFolderId, "old-deleted-id");
  assert.equal(runtime.folders.get(root.rootFolderId)?.name, "LAN Portfolio CMS");
  assert.equal(runtime.folders.get(root.rootFolderId)?.appProperties?.lanStorageRoot, "1");
  await runtime.driveEnsureRoot("profile-A", runtime.env);
  assert.equal(runtime.operations.filter(x => x.method === "POST").length, 1,
    "Repeated uploads must reuse the one managed root");
  assert.equal(runtime.operations.filter(x => x.method === "DELETE").length, 0,
    "Root recovery must never erase or restore unrelated media");
});

test("Google Drive reuses modules and recreates only trashed categories, without record folders", async () => {
  const runtime = createMockDriveFolderRuntime();
  runtime.folders.set("root", {
    id: "root", name: "LAN Portfolio CMS",
    mimeType: "application/vnd.google-apps.folder", trashed: false,
    parents: [], appProperties: { lanStorageRoot: "1", lanStorageProfile: "p" }
  });
  runtime.stored.set("drive-profile:p", {
    profileId: "p", rootFolderId: "root", rootFolderName: "LAN Portfolio CMS", publicReady: true
  });
  runtime.folders.set("module", {
    id: "module", name: "photo-editing", parents: ["root"],
    mimeType: "application/vnd.google-apps.folder", trashed: false,
    appProperties: { lanLogicalKey: "page:photo-editing", lanStorageProfile: "p" }
  });
  runtime.folders.set("trashed-category", {
    id: "trashed-category", name: "Product Ads", parents: ["module"],
    mimeType: "application/vnd.google-apps.folder", trashed: true,
    appProperties: { lanLogicalKey: "page:photo-editing/category:product-ads", lanStorageProfile: "p" }
  });
  runtime.stored.set("drive-folder:p:module:page:photo-editing/category:product-ads", {
    folderId: "trashed-category", parentId: "module"
  });
  const context = { ownerType: "photo-editing", ownerId: "opaque-record-1", categoryName: "Product Ads" };
  const id = await runtime.driveEnsureContextFolder("p", context, runtime.env);
  assert.notEqual(id, "trashed-category");
  assert.deepEqual(Array.from(runtime.folders.get(id).parents), ["module"]);
  assert.equal(runtime.folders.get(id).name, "Product Ads");
  const reused = await runtime.driveEnsureContextFolder("p", { ...context, ownerId: "opaque-record-2" }, runtime.env);
  assert.equal(reused, id);
  assert.equal(runtime.operations.filter(x => x.method === "POST").length, 1);
  assert.ok(runtime.operations.some(x => x.method === "KV_DELETE" && x.key.includes("category:product-ads")));
  const projectsFolder = await runtime.driveEnsureContextFolder("p", { ownerType: "project", pageName: "Projects", ownerId: "record-8" }, runtime.env);
  assert.equal(runtime.folders.get(projectsFolder).name, "Projects");
  assert.deepEqual(Array.from(runtime.folders.get(projectsFolder).parents), ["root"]);
  assert.equal(runtime.operations.filter(x => x.method === "DELETE").length, 0);
});

test("Google Drive upload session gracefully retries category context against a legacy Worker", async () => {
  const source = read("admin/services/storageProviders/googleDriveStorageProvider.js");
  const providerSource = source.replace(/^import .*;\r?\n/gm, "")
    .replace("export const googleDriveStorageProvider =", "const googleDriveStorageProvider =")
    .replace("export default googleDriveStorageProvider;", "");
  const requests = [];
  const provider = runInNewContext(providerSource + "\ngoogleDriveStorageProvider", {
    FormData, Error,
    authorizedWorkerRequest: async (path, options) => {
      const payload = JSON.parse(options.body);
      requests.push({ path, payload });
      if (requests.length === 1) {
        const error = new Error("Unknown request field: body.context.categoryName");
        error.code = "request-schema-unknown-field";
        throw error;
      }
      return { pendingToken: "pending-token" };
    },
    authorizedWorkerFetch: async () => ({ ok: true, json: async () => ({
      provider: "google-drive", assetId: "fresh-image", storageProfileId: "p"
    }) }),
    publicWorkerUrl: () => "",
    normalizeStorageAsset: asset => asset,
    fetch: async () => { throw new Error("unexpected fetch"); }
  });
  const file = new File(["safe"], "photo.png", { type: "image/png" });
  const saved = await provider.upload(file, {
    storageProfileId: "p", ownerType: "photo-editing", categoryName: "Product Ads"
  });
  assert.equal(saved.assetId, "fresh-image");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].payload.context.categoryName, "Product Ads");
  assert.equal(Object.hasOwn(requests[1].payload.context, "categoryName"), false);
});


test("Google Drive recovers a trashed root without silently inheriting stale sharing approval", async () => {
  const r = createMockDriveFolderRuntime();
  r.folders.set("trashed-root", {
    id: "trashed-root", name: "LAN Portfolio CMS",
    mimeType: "application/vnd.google-apps.folder", trashed: true,
    parents: [], appProperties: { lanStorageRoot: "1", lanStorageProfile: "p" }
  });
  r.stored.set("drive-profile:p", {
    profileId: "p", rootFolderId: "trashed-root",
    rootFolderName: "LAN Portfolio CMS", publicReady: true, publicVerifiedAt: Date.now()
  });
  const recovered = await r.driveEnsureRoot("p", r.env);
  assert.notEqual(recovered.rootFolderId, "trashed-root");
  assert.equal(recovered.publicReady, false,
    "New root must require fresh permission verification, not reuse cached approval");
  assert.equal(recovered.publicVerifiedAt, 0);
  assert.equal(r.folders.get("trashed-root").trashed, true, "Old root remains untouched");
  assert.equal(r.operations.filter(x => x.method === "POST").length, 1);
});

test("Google Drive restores missing module/category folders generically and preserves unrelated folders", async () => {
  const r = createMockDriveFolderRuntime();
  r.folders.set("root", {
    id: "root", name: "LAN Portfolio CMS",
    mimeType: "application/vnd.google-apps.folder", trashed: false,
    parents: [], appProperties: { lanStorageRoot: "1", lanStorageProfile: "p" }
  });
  r.folders.set("unrelated", {
    id: "unrelated", name: "Personal Files", parents: [],
    mimeType: "application/vnd.google-apps.folder", trashed: false,
    appProperties: {}
  });
  r.stored.set("drive-profile:p", { profileId: "p", rootFolderId: "root", publicReady: true });
  const cms = { moduleId: "custom-future-module", pageName: "Future Module", categoryName: "Screenshots", ownerId: "different-records" };
  const category = await r.driveEnsureContextFolder("p", cms, r.env);
  assert.equal(r.folders.get(category).name, "Screenshots");
  const moduleId = r.folders.get(category).parents[0];
  assert.equal(r.folders.get(moduleId).name, "Future Module");
  assert.deepEqual(Array.from(r.folders.get(moduleId).parents), ["root"]);
  assert.equal(await r.driveEnsureContextFolder("p", { ...cms, ownerId: "second" }, r.env), category);
  assert.equal(r.operations.filter(x => x.method === "POST").length, 2);
  assert.equal(r.folders.get("unrelated").name, "Personal Files");
  assert.equal(r.operations.filter(x => ["DELETE", "PATCH"].includes(x.method)).length, 0);
});

test("Google Drive cache validation fails closed on transient Drive errors instead of creating duplicates", async () => {
  const r = createMockDriveFolderRuntime();
  r.folders.set("root", {
    id: "root", name: "LAN Portfolio CMS",
    mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [],
    appProperties: { lanStorageRoot: "1", lanStorageProfile: "p" }
  });
  r.stored.set("drive-profile:p", { profileId: "p", rootFolderId: "root", publicReady: true });
  r.transientFailures.add("root");
  await assert.rejects(() => r.driveEnsureRoot("p", r.env), error => {
    assert.equal(error.code, "google-drive-root-verify");
    return true;
  });
  assert.equal(r.operations.filter(x => x.method === "POST").length, 0,
    "Provider outages must not be mistaken for deleted folders");
  r.transientFailures.clear();
  const folder = await r.driveEnsureContextFolder("p", { ownerType: "project", pageName: "Projects" }, r.env);
  const folderKey = "drive-folder:p:root:page:project";
  r.stored.set(folderKey, { folderId: folder, parentId: "root" });
  r.transientFailures.add(folder);
  await assert.rejects(() =>
    r.driveEnsureContextFolder("p", { ownerType: "project", pageName: "Projects" }, r.env),
    error => error.code === "google-drive-folder-verify"
  );
  assert.equal(r.operations.filter(x => x.method === "POST").length, 1);
});
