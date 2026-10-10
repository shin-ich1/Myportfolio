/**
 * Read-only preflight for the isolated staging Worker.
 *
 * This only establishes that the canonical Worker /health route responds with
 * the expected public configuration flags. It does NOT authenticate a user,
 * verify staging Firebase identity, test TOTP, or authorize deployment.
 *
 * The endpoint is intentionally fixed. Do not accept arbitrary URLs, tokens,
 * credentials, or production project overrides.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const STAGING_HEALTH_URL = "https://lan-portfolio-staging.lagmayr2.workers.dev/health";

// Edge propagation after a successful deployment is not instantaneous.
// Retry only known, temporary readiness responses; authorization and binding
// failures remain immediate errors, and every successful probe is fully checked.
const READINESS_ATTEMPTS = 10;
const READINESS_DELAY_MS = 2000;

function healthFailure(message, readinessPending = false) {
  return Object.assign(new Error(message), { readinessPending });
}

export async function inspectStagingWorkerHealth({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(STAGING_HEALTH_URL, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response?.ok) {
    const status = Number(response?.status) || 0;
    throw healthFailure("Staging Worker /health returned HTTP " + status + ".",
      [404, 429, 502, 503, 504].includes(status));
  }
  if (!/^application\/json\b/i.test(response.headers?.get("Content-Type") || "")) {
    throw healthFailure("Staging /health did not return canonical staging Worker JSON (placeholder Worker may still be deployed).", true);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || payload.ok !== true || payload.service !== "lan-cloudinary-telemetry") {
    throw healthFailure("Staging /health did not match the canonical Worker identity.", true);
  }
  if (payload.firebaseConfigured !== true) {
    throw new Error("Staging Worker is missing Firebase project configuration.");
  }
  if (payload.securityCoordinatorConfigured !== true) {
    throw new Error("Staging Worker is missing atomic Security Coordinator binding.");
  }
  if (payload.storageOAuthConfigured !== true || payload.messagePushConfigured !== true) {
    throw new Error("Staging Worker is missing required staging KV bindings.");
  }
  return Object.freeze({
    canonicalWorkerResponding: true,
    firebaseProjectVariablePresent: true,
    atomicSecurityCoordinatorBindingPresent: true,
    storageOAuthKvPresent: true,
    portfolioMessagesKvPresent: true,
    serverCredentialPresenceReported: payload.messageSecurityConfigured === true,
    runtimeSecurityVerified: false
  });
}

/**
 * Deployment-only readiness polling, still using the one canonical /health
 * validator above. No alternate URL, identity, or degraded-success path.
 * sleepImpl is injectable solely so regression tests run without wall-clock waits.
 */
export async function waitForStagingWorkerHealth({
  fetchImpl = fetch,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt++) {
    try {
      return await inspectStagingWorkerHealth({ fetchImpl });
    } catch (error) {
      if (error?.readinessPending !== true || attempt === READINESS_ATTEMPTS) throw error;
      await sleepImpl(READINESS_DELAY_MS);
    }
  }
  throw new Error("Staging readiness attempts exhausted.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/check-staging-worker-health.mjs (no options or secrets).");
    process.exitCode = 1;
  } else {
    try {
      const result = await inspectStagingWorkerHealth();
      console.log(JSON.stringify(result, null, 2));
      console.log("READ-ONLY /health CHECK PASSED. Security/auth and staging Firebase identity are NOT verified. Do not deploy or sign in based on this result.");
    } catch (error) {
      console.error("STAGING HEALTH CHECK BLOCKED: " + (error?.message || "Network response could not be verified."));
      process.exitCode = 1;
    }
  }
}
