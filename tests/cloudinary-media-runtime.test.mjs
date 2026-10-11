import test from "node:test";
import assert from "node:assert/strict";
import worker, { SecurityCoordinator } from "../telemetry-worker/src/index.js";
import { cloudinaryStorageProvider } from "../admin/services/storageProviders/cloudinaryStorageProvider.js";
import { cloudinaryConfig } from "../config.js";
import { storageAssetUrl } from "../storage-asset.js";

// Synthetic Cloudinary + Firebase only. Global fetch / XHR are intercepted;
// never contact live Cloudinary, real Firebase, or a deployed Worker.
const ORIGIN = "https://lan-portfolio-staging.web.app";
const TARGET = "https://lan-portfolio-staging.lagmayr2.workers.dev";
const UID = "isolated-cloudinary-admin", SID = "isolated-cloudinary-session";
const ASSET1 = "asset-test-media-000001", ASSET2 = "asset-test-media-000002";
const ADMIN_TOKEN = "mock." + Buffer.from(JSON.stringify({
  sub: UID, lanSecurityVerified: true, lanSessionId: SID,
  email: "isolated-cloudinary@example.invalid"
})).toString("base64url") + ".signature";
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", ...headers }
});
const fields = entries => ({
  fields: Object.fromEntries(Object.entries(entries).map(([k, v]) => [
    k, typeof v === "boolean" ? { booleanValue: v }
      : k === "expiresAt" ? { timestampValue: v }
      : { stringValue: String(v) }
  ]))
});
const cloudinaryAsset = (assetId, folder = "lan-portfolio/test-assets") => ({
  asset_id: assetId, public_id: folder + "/" + assetId,
  asset_folder: folder, secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1/" +
    folder + "/" + assetId + ".png",
  resource_type: "image", type: "upload", format: "png", bytes: 7,
  original_filename: assetId
});
const reference = assetId => ({ provider: "cloudinary", storageProfileId: "cloudinary-default",
  assetId, resourceType: "image", publicId: "lan-portfolio/test-assets/" + assetId });

async function fixture({ statuses = {}, responseBody = null, errorStatus = 0,
  outOfFolder = [], downloadStatus = 200 } = {}) {
  const rsa = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const pem = "-----BEGIN PRIVATE KEY-----\\n" +
    Buffer.from(await crypto.subtle.exportKey("pkcs8", rsa.privateKey)).toString("base64") +
    "\\n-----END PRIVATE KEY-----";
  const objects = new Map();
  let cloudinaryGets = 0, deletionCalls = 0, downloadCalls = 0;
  const env = {
    FIREBASE_PROJECT_ID: "lan-portfolio-staging",
    FIREBASE_SERVICE_ACCOUNT_EMAIL: "isolated-cloudinary@example.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "isolated-fake-api-key",
    CLOUDINARY_API_SECRET: "isolated-fake-api-secret",
    CLOUDINARY_MANAGED_FOLDER: "lan-portfolio",
    SECURITY_COORDINATOR: {
      idFromName(name) { return name; },
      get(name) {
        if (!objects.has(name)) {
          const values = new Map();
          const coordinator = new SecurityCoordinator({ storage: { kv: {
            get: k => values.get(k),
            put: (k, v) => values.set(k, structuredClone(v)),
            delete: k => values.delete(k)
          } } });
          objects.set(name, { fetch(url, init) {
            return coordinator.fetch(new Request(url, init));
          } });
        }
        return objects.get(name);
      }
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token")
      return json({ access_token: "isolated-fake-oauth-token", expires_in: 3600 });
    if (url.hostname === "firestore.googleapis.com") {
      if (url.pathname.endsWith("/documents/authorizedAdministrators/" + UID))
        return json(fields({ active: true }));
      if (url.pathname.endsWith("/documents/adminSecuritySessions/" + SID))
        return json(fields({ uid: UID, sessionId: SID, active: true,
          trustLevel: "temporary", expiresAt: new Date(Date.now() + 600000).toISOString() }));
      if (url.pathname.endsWith("/documents/adminSecurityState/" + UID))
        return json({}, 404);
    }
    if (url.hostname === "api.cloudinary.com") {
      assert.ok(url.pathname.startsWith("/v1_1/test-cloud/"), "Must use isolated Cloudinary cloud");
      if (url.pathname === "/v1_1/test-cloud/resources" && init.method === "DELETE") {
        deletionCalls++;
        const body = new URLSearchParams(init.body);
        const ids = body.getAll("asset_ids[]");
        assert.ok(ids.length > 0);
        if (errorStatus)
          return json({ error: { message: "Simulated provider failure" } }, errorStatus);
        return json(responseBody ?? {
          deleted: Object.fromEntries(ids.map(id => [id, statuses[id] ?? "deleted"]))
        });
      }
      if (url.pathname.startsWith("/v1_1/test-cloud/resources/")) {
        cloudinaryGets++;
        const id = decodeURIComponent(url.pathname.slice("/v1_1/test-cloud/resources/".length));
        return json(cloudinaryAsset(id, outOfFolder.includes(id) ? "unmanaged/test-assets" : "lan-portfolio/test-assets"));
      }
      if (url.pathname === "/v1_1/test-cloud/asset/download") {
        downloadCalls++;
        if (downloadStatus !== 200) return new Response("Unavailable", { status: downloadStatus });
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26]), {
          status: 200, headers: { "Content-Type": "image/png" }
        });
      }
    }
    throw Error("Unexpected external network attempt: " + url.hostname + url.pathname);
  };
  async function request(path, body, { authorized = true, origin = ORIGIN } = {}) {
    const headers = { Origin: origin, "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.27" };
    if (authorized) headers.Authorization = "Bearer " + ADMIN_TOKEN;
    const r = await worker.fetch(new Request(TARGET + path, {
      method: "POST", headers, body: JSON.stringify(body)
    }), env, { waitUntil() {} });
    const contentType = r.headers.get("content-type") || "";
    return { status: r.status, headers: r.headers, body: contentType.includes("json")
      ? await r.json() : await r.arrayBuffer() };
  }
  return {
    request, get stats() { return { cloudinaryGets, deletionCalls, downloadCalls }; },
    restore() { globalThis.fetch = originalFetch; }
  };
}

test("only provider-confirmed Cloudinary deletions are reported as deleted", async () => {
  const f = await fixture({ statuses: { [ASSET1]: "deleted", [ASSET2]: "not_found" } });
  try {
    const r = await f.request("/media/delete", { assets: [reference(ASSET1), reference(ASSET2)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.deleted.map(x => x.assetId), [ASSET1]);
    assert.deepEqual(r.body.skipped.map(x => ({assetId:x.assetId,reason:x.reason})),
      [{ assetId: ASSET2, reason: "already-missing" }]);
    assert.equal(f.stats.deletionCalls, 1);
  } finally { f.restore(); }
});

test("HTTP 200 with missing Cloudinary deletion acknowledgement is a failure, not false success", async () => {
  const f = await fixture({ responseBody: {} });
  try {
    const r = await f.request("/media/delete", { assets: [reference(ASSET1)] });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, "media-delete-partial");
    assert.equal(r.body.deleted.length, 0);
    assert.equal(r.body.failed.length, 1);
  } finally { f.restore(); }
});

test("Cloudinary unknown deletion status cannot claim asset removal", async () => {
  const f = await fixture({ statuses: { [ASSET1]: "pending" } });
  try {
    const r = await f.request("/media/delete", { assets: [reference(ASSET1)] });
    assert.equal(r.status, 502);
    assert.equal(r.body.deleted.length, 0);
    assert.equal(r.body.failed.length, 1);
  } finally { f.restore(); }
});

test("authorized managed preview is private binary; unauthorized and outside-folder media are rejected", async () => {
  const f = await fixture({ outOfFolder: [ASSET2] });
  try {
    const anon = await f.request("/media/read", { asset: reference(ASSET1) }, { authorized: false });
    assert.equal(anon.status, 401);
    assert.equal(f.stats.cloudinaryGets, 0);
    const preview = await f.request("/media/read", { asset: reference(ASSET1) });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("Cache-Control"), "private, no-store");
    assert.equal(preview.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(preview.headers.get("Content-Type"), "image/png");
    assert.equal(preview.body.byteLength, 7);
    const outside = await f.request("/media/read", { asset: reference(ASSET2) });
    assert.equal(outside.status, 403);
    const denyDelete = await f.request("/media/delete", { assets: [reference(ASSET2)] });
    assert.equal(denyDelete.status, 200);
    assert.equal(denyDelete.body.deleted.length, 0);
    assert.equal(denyDelete.body.skipped[0].reason, "outside-managed-folder");
    assert.equal(f.stats.deletionCalls, 0);
    assert.equal(f.stats.downloadCalls, 1);
  } finally { f.restore(); }
});

test("Cloudinary upstream deletion outage fails closed, without false deletion success", async () => {
  const f = await fixture({ errorStatus: 503 });
  try {
    const r = await f.request("/media/delete", { assets: [reference(ASSET1)] });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, "media-delete-partial");
    assert.equal(r.body.deleted.length, 0);
    assert.equal(r.body.failed.length, 1);
  } finally { f.restore(); }
});

test("isolated browser Cloudinary upload normalizes saved media and rejects provider or malformed responses", async () => {
  const originalXHR = globalThis.XMLHttpRequest;
  const calls = [];
  const replies = [
    { status: 200, body: {
      asset_id: ASSET1, public_id: "lan-portfolio/test-assets/image",
      asset_folder: "lan-portfolio/test-assets",
      secure_url: "https://res.cloudinary.com/" + cloudinaryConfig.cloudName +
        "/image/upload/v1/lan-portfolio/test-assets/image.png",
      resource_type: "image", type: "upload", bytes: 8, format: "png"
    } },
    { status: 503, body: { error: { message: "Simulated upload overload" } } },
    { status: 200, body: { asset_id: ASSET2 } }
  ];
  class FakeXHR {
    constructor() { this.events = {}; this.upload = { addEventListener() {} }; }
    addEventListener(name, cb) { this.events[name] = cb; }
    open(method, url) { this.method = method; this.url = url; }
    send(body) {
      calls.push({ method: this.method, url: this.url,
        fields: [...body.entries()].map(([name]) => name) });
      const reply = replies.shift();
      queueMicrotask(() => {
        this.status = reply.status;
        this.responseText = JSON.stringify(reply.body);
        this.events.load();
      });
    }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  const file = new File([new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3])],
    "isolated-image.png", { type: "image/png" });
  try {
    const asset = await cloudinaryStorageProvider.upload(file, {
      family: "image", storageProfileId: "cloudinary-default",
      access: "public-preview", folder: "test-assets"
    });
    assert.equal(asset.provider, "cloudinary");
    assert.equal(asset.assetId, ASSET1);
    assert.equal(asset.storageProfileId, "cloudinary-default");
    assert.equal(asset.access, "public-preview");
    assert.ok(storageAssetUrl(asset, "preview").startsWith("https://res.cloudinary.com/"));
    assert.ok(storageAssetUrl(asset, "card").includes("/c_limit,w_1200,h_1200,f_auto,q_auto:best/"));
    await assert.rejects(() => cloudinaryStorageProvider.upload(file, { family: "image" }),
      /Simulated upload overload/);
    await assert.rejects(() => cloudinaryStorageProvider.upload(file, { family: "image" }),
      /incomplete upload response/);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.method === "POST" &&
      c.url.startsWith("https://api.cloudinary.com/v1_1/") &&
      c.fields.includes("upload_preset") && c.fields.includes("file")));
  } finally {
    if (originalXHR === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXHR;
  }
});
