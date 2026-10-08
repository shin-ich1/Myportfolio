const SYNC_STORAGE_KEY = "lan.portfolio.contentChanged";
const SYNC_CHANNEL = "lan-portfolio-sync";

export function announcePortfolioContentChanged(scope = "portfolio") {
  const payload = {
    type: "portfolio-content-changed",
    scope: String(scope || "portfolio"),
    at: Date.now()
  };

  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }

  try {
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(SYNC_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // BroadcastChannel is an enhancement; Firestore remains the source of truth.
  }

  return payload;
}

export const portfolioSyncConstants = Object.freeze({
  storageKey: SYNC_STORAGE_KEY,
  channelName: SYNC_CHANNEL
});
