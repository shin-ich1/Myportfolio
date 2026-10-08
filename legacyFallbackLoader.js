/**
 * Initialization/emergency loader for the bundled official Version 1 portfolio.
 *
 * Normal public startup never imports this module. app.js dynamically imports it
 * only after Firebase/Firestore startup genuinely fails. The protected Settings
 * controller imports it only when Portfolio Initialization is explicitly run.
 */
let legacyContentPromise = null;

const REQUIRED_OBJECTS = Object.freeze(["site", "hero", "about"]);
const REQUIRED_ARRAYS = Object.freeze([
  "experience",
  "projects",
  "gallery",
  "certificates",
  "resumes"
]);

// Education and Skills already have dedicated CMS collections. Older approved
// content.js builds did not include these arrays, so initialization must not
// fail merely because they are absent. When present, they are still imported.
const OPTIONAL_ARRAYS = Object.freeze(["education", "skills"]);

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function summarizeLegacyContent(candidate = {}) {
  const source = candidate?.PORTFOLIO_CONTENT || candidate?.default || candidate;
  const summary = {
    validObject: Boolean(source && typeof source === "object" && !Array.isArray(source)),
    objects: {},
    arrays: {},
    totalRecords: 0
  };

  for (const key of REQUIRED_OBJECTS) {
    summary.objects[key] = Boolean(source?.[key] && typeof source[key] === "object" && !Array.isArray(source[key]));
  }
  for (const key of [...REQUIRED_ARRAYS, ...OPTIONAL_ARRAYS]) {
    const isRequired = REQUIRED_ARRAYS.includes(key);
    const count = Array.isArray(source?.[key]) ? source[key].length : (isRequired ? -1 : 0);
    summary.arrays[key] = count;
    if (count > 0) summary.totalRecords += count;
  }
  return summary;
}

export function validateLegacyContent(candidate = {}) {
  const source = candidate?.PORTFOLIO_CONTENT || candidate?.default || candidate;
  const summary = summarizeLegacyContent(source);
  const missingObjects = REQUIRED_OBJECTS.filter((key) => !summary.objects[key]);
  const invalidArrays = REQUIRED_ARRAYS.filter((key) => summary.arrays[key] < 0);

  if (!summary.validObject || missingObjects.length || invalidArrays.length) {
    throw new Error(
      `Official content.js payload is incomplete. Missing objects: ${missingObjects.join(", ") || "none"}; invalid arrays: ${invalidArrays.join(", ") || "none"}.`
    );
  }
  if (!String(source.hero?.name || source.site?.name || "").trim() || summary.totalRecords === 0) {
    throw new Error("Official content.js payload contains no usable portfolio records.");
  }
  const normalizedSource = {
    ...source,
    education: Array.isArray(source.education) ? source.education : [],
    skills: Array.isArray(source.skills) ? source.skills : []
  };
  return { source: normalizedSource, summary };
}

/**
 * Loads and validates content.js without coupling it to normal public startup.
 * @param {{ purpose?: "initialization"|"emergency", timeoutMs?: number }} options
 */
export function loadLegacy(options = {}) {
  const purpose = options.purpose === "initialization" ? "initialization" : "emergency";
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;

  if (legacyContentPromise) {
    console.info("[LΛN initialization pipeline] Reusing legacy loader promise", { purpose });
    return legacyContentPromise.then(({ source }) => clone(source));
  }

  legacyContentPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;
    const scriptUrl = new URL("./content.js", import.meta.url).href;

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener("lan:portfolio-content-ready", onReady);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const resolveCandidate = (candidate) => finish(() => {
      try {
        const validated = validateLegacyContent(candidate || window.PORTFOLIO_CONTENT);
        console.info("[LΛN initialization pipeline] Legacy object loaded", {
          purpose,
          url: scriptUrl,
          completeObject: true,
          ...validated.summary
        });
        console.assert(validated.summary.totalRecords > 0, "[LΛN initialization pipeline] Legacy inventory must be non-zero");
        resolve(validated);
      } catch (error) {
        reject(error);
      }
    });
    const rejectLoad = () => finish(() => reject(new Error(`Unable to load official content.js from ${scriptUrl}.`)));
    const onReady = (event) => resolveCandidate(event.detail);

    if (window.PORTFOLIO_CONTENT && typeof window.PORTFOLIO_CONTENT === "object") {
      queueMicrotask(() => resolveCandidate(window.PORTFOLIO_CONTENT));
      return;
    }

    window.addEventListener("lan:portfolio-content-ready", onReady, { once: true });
    let script = document.querySelector('script[data-lan-legacy-content-source]');
    if (!script) {
      script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.dataset.lanLegacyContentSource = purpose;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolveCandidate(window.PORTFOLIO_CONTENT), { once: true });
    script.addEventListener("error", rejectLoad, { once: true });

    timeoutId = window.setTimeout(() => finish(() => reject(new Error(
      `Loading official content.js timed out after ${timeoutMs}ms. Verify that ${scriptUrl} is deployed and accessible.`
    ))), timeoutMs);
  }).catch((error) => {
    legacyContentPromise = null;
    throw error;
  });

  return legacyContentPromise.then(({ source }) => clone(source));
}

export function loadLegacyFallbackContent() {
  return loadLegacy({ purpose: "emergency" });
}
