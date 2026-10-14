/* Canonical Admin workspace-document host contract.
   Workspace documents own page controllers only. The persistent Admin shell owns
   global navigation AND the single authenticated/authorized Admin session.

   Contract:
   - Direct workspace URLs immediately route through shell.html.
   - Embedded workspaces consume the shell's resolved Admin session.
   - Workspace documents never create their own Firebase Auth observer/guard. */
const normalizedPath = location.pathname.replace(/\\/g, "/");
const isPageRoute = /\/admin\/pages\//.test(normalizedPath);
const shellUrl = new URL(isPageRoute ? "../shell.html" : "shell.html", location.href);

if (window.top === window.self) {
  // Keep page controllers suspended while the browser replaces this standalone
  // document with the persistent shell. This prevents a direct page visit from
  // briefly starting a second Auth/data lifecycle before navigation completes.
  window.__LAN_ADMIN_READY__ = new Promise(() => {});
  const workspace = `${location.pathname.split("/admin/")[1] || "dashboard.html"}${location.search}${location.hash}`;
  shellUrl.searchParams.set("workspace", workspace);
  location.replace(shellUrl.href);
} else {
  const shellReady = window.parent?.__LAN_ADMIN_READY__;
  const shellSession = window.parent?.__LAN_ADMIN_AUTH__;
  if (!shellReady || typeof shellReady.then !== "function" || !shellSession) {
    throw new Error("Persistent Admin shell session bridge is unavailable.");
  }

  window.__LAN_ADMIN_AUTH__ = shellSession;
  for (const button of document.querySelectorAll("[data-admin-logout]")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const requestLogout = window.parent?.LANAdminLogout;
      if (typeof requestLogout !== "function") {
        throw new Error("Persistent Admin shell logout owner is unavailable.");
      }
      button.disabled = true;
      try {
        await requestLogout(button);
      } catch (error) {
        console.error("Workspace logout request failed:", error);
        button.disabled = false;
        window.LANNotice?.({ title: "Unable to log out", message: error?.message || "Logout failed. Please try again.", tone: "error" });
      }
    }, { capture: true });
  }

  const navigationApproval = window.parent?.LANAdminAwaitWorkspaceSecurity?.(window.frameElement);
  if (!navigationApproval || typeof navigationApproval.then !== "function") {
    throw new Error("Admin workspace navigation security approval is unavailable.");
  }

  window.__LAN_ADMIN_READY__ = Promise.all([shellReady, navigationApproval]).then(async ([startupSession, approved]) => {
    if (!approved) throw new Error("Admin workspace navigation was not approved by the Security Gateway.");
    const liveUser = shellSession.user || null;
    if (!startupSession?.authorized || !liveUser?.uid || startupSession.user?.uid !== liveUser.uid) {
      throw new Error("Persistent Admin shell session is not authorized.");
    }

    const { waitForLocalFirebaseCredential } = await import("../services/firebase.js");
    await waitForLocalFirebaseCredential(liveUser.uid);

    window.dispatchEvent(new CustomEvent("lan:admin-auth-ready", { detail: { user: startupSession } }));
    return startupSession;
  });
}
