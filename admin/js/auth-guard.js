import {
  administratorSession,
  requireAuthorizedAdmin,
  subscribeAdministratorAuthState
} from "../services/adminAuthorizationService.js";
import { logoutAdministrator } from "../services/adminSecurityService.js";

const loginUrl = location.pathname.includes("/admin/pages/") ? "../index.html" : "index.html";
const deniedLoginUrl = `${loginUrl}${loginUrl.includes("?") ? "&" : "?"}error=unauthorized`;
const embeddedWorkspace = window.top !== window.self;
let startupSession;
let loginRedirectStarted = false;
let logoutStarted = false;

function redirectToLogin(target = loginUrl) {
  if (loginRedirectStarted) return;
  loginRedirectStarted = true;
  window.location.replace(target);
}

async function performCanonicalLogout(button = null) {
  if (logoutStarted) return;
  logoutStarted = true;
  if (button) button.disabled = true;
  try {
    await logoutAdministrator();
    redirectToLogin();
  } catch (error) {
    console.error("Logout failed:", error);
    logoutStarted = false;
    if (button) button.disabled = false;
    window.LANNotice?.("Logout failed. Please try again.", { title: "Unable to log out", tone: "error" });
  }
}

function bindLogoutButton(button) {
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    await performCanonicalLogout(button);
  }, { capture: true });
}

if (embeddedWorkspace) {
  const shellReady = window.parent?.__LAN_ADMIN_READY__;
  const shellSession = window.parent?.__LAN_ADMIN_AUTH__;
  if (!shellReady || typeof shellReady.then !== "function" || !shellSession) {
    throw new Error("Persistent Admin shell authorization owner is unavailable.");
  }
  window.__LAN_ADMIN_AUTH__ = shellSession;
  window.__LAN_ADMIN_READY__ = Promise.resolve(shellReady);
  startupSession = await window.__LAN_ADMIN_READY__;
} else {
  window.__LAN_ADMIN_AUTH__ = administratorSession;
  window.__LAN_ADMIN_READY__ = (async () => {
    const session = await requireAuthorizedAdmin();
    if (!session?.user) {
      redirectToLogin();
      return new Promise(() => {});
    }
    if (!session.authorized) {
      redirectToLogin(deniedLoginUrl);
      return new Promise(() => {});
    }
    return session;
  })();
  startupSession = await window.__LAN_ADMIN_READY__;

  const startupUid = startupSession?.user?.uid || "";
  subscribeAdministratorAuthState(({ user }) => {
    if (!user) {
      if (!logoutStarted) redirectToLogin();
      return;
    }
    if (startupUid && user.uid !== startupUid) window.location.reload();
  });
}

if (!embeddedWorkspace) window.LANAdminLogout = performCanonicalLogout;

window.dispatchEvent(new CustomEvent("lan:admin-auth-ready", { detail: { user: startupSession } }));

if (!embeddedWorkspace) {
  for (const button of document.querySelectorAll("#logoutButton, #sidebarLogoutButton, #topbarLogoutButton, [data-admin-logout]")) {
    bindLogoutButton(button);
  }
}
