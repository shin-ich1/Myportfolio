import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Inert simulation of the existing Worker owners. No network, credentials or files.
const worker = readFileSync(new URL("../telemetry-worker/src/index.js", import.meta.url), "utf8");
function part(start, end) {
  const a = worker.indexOf(start), b = worker.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Missing Worker owner: " + start);
  return worker.slice(a, b);
}
const image = part("function isDriveImage(", "\nasync function handleDrivePublic(");
const response = part("function drivePublicResponseUsable(", "\nasync function drivePublicManagedRead(");
const delivery = part("async function driveManagedRead(", "\nasync function driveCleanupEmptyGeneratedFolders(");
const route = part("async function handleDrivePublic(", "\nasync function resolveDriveManagedReference(");
const mapping = part("async function resolveDriveManagedReference(", "\nfunction drivePublicContentUrl(");
const asset = (profileId, fileId, access = "public-preview") => ({
  provider: "google-drive", storageProfileId: profileId, profileId, assetId: fileId,
  fileId, mimeType: "image/jpeg", access
});
function createDelivery({ publicFetch, access, fetchAuthed } = {}) {
  const oauthProfiles = [];
  const read = new Function(
    "resolveDriveManagedReference", "serviceError", "drivePublicManagedRead",
    "driveAccessToken", "fetch",
    image + "\n" + response + "\n" + delivery + "\nreturn driveManagedRead;"
  )(
    async () => { throw Error("Unexpected index lookup"); },
    (message, detail = {}) => Object.assign(new Error(message), detail),
    publicFetch || (async () => new Response("public-file", { status: 200, headers: { "Content-Type": "image/jpeg" } })),
    async id => { oauthProfiles.push(id); if (access) return access(id); throw Error("OAuth must not be needed"); },
    fetchAuthed || (async () => { throw Error("Unexpected authenticated request"); })
  );
  return { read, oauthProfiles };
}
test("Public share delivers a file even if Admin OAuth is unavailable", async () => {
  const { read, oauthProfiles } = createDelivery();
  const result = await read({ storageProfileId: "drive-one", assetId: "file-one" }, {}, {
    managedReference: asset("drive-one", "file-one")
  });
  assert.equal(result.delivery, "public-share");
  assert.equal(await result.response.text(), "public-file");
  assert.deepEqual(oauthProfiles, []);
});
test("Fallback authenticates only the affected profile when sharing is unavailable", async () => {
  const requests = [];
  const { read, oauthProfiles } = createDelivery({
    publicFetch: async () => new Response("denied", { status: 403 }),
    access: async id => "token-for-" + id,
    fetchAuthed: async (url, opts) => {
      requests.push({ url, token: opts.headers.get("Authorization") });
      return new Response("private-response", { status: 200 });
    }
  });
  const result = await read({ storageProfileId: "drive-two", assetId: "file-two" }, {}, {
    managedReference: asset("drive-two", "file-two")
  });
  assert.equal(result.delivery, "oauth");
  assert.deepEqual(oauthProfiles, ["drive-two"]);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /file-two/);
  assert.equal(requests[0].token, "Bearer token-for-drive-two");
});
test("Revoked authorization cannot falsely claim successful delivery when sharing also fails", async () => {
  const { read, oauthProfiles } = createDelivery({
    publicFetch: async () => new Response("denied", { status: 403 }),
    access: async () => { throw Object.assign(Error("Revoked"), { code: "google-drive-reconnect-required" }); }
  });
  await assert.rejects(read({ storageProfileId: "drive-one", assetId: "file-one" }, {}, {
    managedReference: asset("drive-one", "file-one")
  }), { code: "google-drive-reconnect-required" });
  assert.deepEqual(oauthProfiles, ["drive-one"]);
});
test("Two Google Drive profiles keep independent public and OAuth paths", async () => {
  const calls = [];
  const { read, oauthProfiles } = createDelivery({
    publicFetch: async managed => managed.profileId === "drive-one"
      ? new Response("public-one", { status: 200, headers: { "Content-Type": "image/jpeg" } })
      : new Response("denied", { status: 403 }),
    access: async id => "token-for-" + id,
    fetchAuthed: async (url, opts) => {
      calls.push({ url, auth: opts.headers.get("Authorization") });
      return new Response("file-two", { status: 200 });
    }
  });
  const one = await read({ storageProfileId: "drive-one", assetId: "file-one" }, {}, {
    managedReference: asset("drive-one", "file-one")
  });
  const two = await read({ storageProfileId: "drive-two", assetId: "file-two" }, {}, {
    managedReference: asset("drive-two", "file-two")
  });
  assert.equal(one.delivery, "public-share");
  assert.equal(two.delivery, "oauth");
  assert.deepEqual(oauthProfiles, ["drive-two"]);
  assert.match(calls[0].url, /file-two/);
  assert.equal(calls[0].auth, "Bearer token-for-drive-two");
});
function createRoute(resolve, cache = async () => null) {
  return new Function("resolveDriveManagedReference", "readDrivePublicCache", "isDriveImage",
    route + "\nreturn handleDrivePublic;"
  )(resolve, cache, () => true);
}
const sample = new Request("https://worker.invalid/storage/google-drive/public/drive-one/file-one");
test("Public media route never serves cache without a public-preview mapping", async () => {
  let cacheReads = 0;
  const cache = async () => { cacheReads++; return new Response("old-private-bytes"); };
  for (const item of [null, asset("drive-one", "file-one", "admin-only")]) {
    const handler = createRoute(async () => item, cache);
    assert.equal((await handler(sample, {}, "drive-one", "file-one")).status, 404);
  }
  assert.equal(cacheReads, 0);
});
test("Public route uses verified cache without requiring Admin OAuth", async () => {
  let calls = 0;
  const handler = createRoute(async () => asset("drive-one", "file-one"),
    async () => { calls++; return new Response("cached-public-file"); });
  const result = await handler(sample, {}, "drive-one", "file-one");
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "cached-public-file");
  assert.equal(calls, 1);
});
test("Lost KV mapping cannot be trusted without ownership recovery; limitation is explicit", async () => {
  let lookups = 0;
  const recover = new Function("kvJsonGet", "driveAssetKey", "driveApi", "kvJsonPut",
    mapping + "\nreturn resolveDriveManagedReference;"
  )(
    async () => null,
    (profile, file) => profile + ":" + file,
    async () => { lookups++; throw Error("Admin OAuth unavailable"); },
    async () => { throw Error("Must not persist unverified ownership"); }
  );
  await assert.rejects(recover({ storageProfileId: "drive-one", assetId: "file-one" }, {}), /OAuth unavailable/);
  assert.equal(lookups, 1);
});
