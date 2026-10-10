import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "admin/js/workspace-host.js"), "utf8");

// Execute the actual canonical workspace host in an isolated, non-browser test
// context. Replace only its Firebase import with a controlled test dependency.
// Nothing in the production source is changed or mocked by this test file.
const injectableSource = source.replace(
  'import("../services/firebase.js")',
  "Promise.resolve({ waitForLocalFirebaseCredential: __waitForCredential })"
);
assert.notEqual(injectableSource, source, "Firebase credential seam must exist in the canonical host");

const runWorkspaceHost = new Function(
  "window", "document", "location", "URL", "CustomEvent", "__waitForCredential",
  injectableSource
);

async function exerciseWorkspace({
  approval = true,
  provideGateway = true,
  authorized = true,
  shellUid = "admin-test",
  startupUid = "admin-test",
  localUid = "admin-test",
  wrongFrame = false
} = {}) {
  let credentialCalls = 0;
  let presentedFrame = null;
  const frame = { id: "workspace-fixture" };
  const parent = {
    __LAN_ADMIN_READY__: Promise.resolve({ authorized, user: { uid: startupUid } }),
    __LAN_ADMIN_AUTH__: { user: { uid: shellUid } }
  };
  if (provideGateway) {
    parent.LANAdminAwaitWorkspaceSecurity = (frameArgument) => {
      presentedFrame = frameArgument;
      return Promise.resolve(!wrongFrame && approval && frameArgument === frame);
    };
  }
  const window = {
    top: {},
    self: {},
    parent,
    frameElement: frame,
    dispatchEvent() {}
  };
  const document = { querySelectorAll: () => [] };
  const location = {
    pathname: "/admin/pages/about.html",
    href: "https://example.test/admin/pages/about.html",
    search: "",
    hash: ""
  };
  let outcome = "approved";
  let error = null;
  try {
    runWorkspaceHost(
      window, document, location, URL,
      class CustomEvent { constructor(name, options) { this.type = name; this.detail = options?.detail; } },
      async (uid) => {
        credentialCalls += 1;
        if (uid !== localUid) throw new Error("Local Firebase credential mismatch");
      }
    );
    await window.__LAN_ADMIN_READY__;
  } catch (caught) {
    outcome = "denied";
    error = caught;
  }
  return { outcome, error, credentialCalls, presentedFrame, frame };
}

test("approved navigation waits for exactly one local Firebase credential", async () => {
  const result = await exerciseWorkspace();
  assert.equal(result.outcome, "approved");
  assert.equal(result.credentialCalls, 1);
  assert.equal(result.presentedFrame, result.frame);
});

for (const [scenario, options] of [
  ["denied Security Gateway approval", { approval: false }],
  ["missing per-frame Security Gateway owner", { provideGateway: false }],
  ["wrong-frame approval", { wrongFrame: true }],
  ["unauthorized shell startup", { authorized: false }],
  ["shell identity mismatch", { shellUid: "other-user" }],
  ["local Firebase credential mismatch", { localUid: "other-user" }]
]) {
  test(`refuses ${scenario}`, async () => {
    const result = await exerciseWorkspace(options);
    assert.equal(result.outcome, "denied");
    assert.ok(result.error, "authorization failure must not be silent");
    assert.equal(result.credentialCalls, options.localUid ? 1 : 0,
      "denied or mismatched sessions must not access a usable Admin credential");
  });
}
