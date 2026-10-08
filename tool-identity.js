/* LΛN Portfolio CMS - canonical shared Tool identity rules */

const clean = (value = "") => String(value ?? "").trim();

export function normalizeToolIdentityKey(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const localBrand = (file) => `/admin/assets/brands/${file}`;
const iconifyBrand = (prefix, name) => `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;

const IDENTITIES = new Map();
const register = (aliases, identity) => {
  for (const alias of aliases) IDENTITIES.set(normalizeToolIdentityKey(alias), Object.freeze({ ...identity }));
};

register(["PHP"], { id: "php", src: localBrand("php.svg") });
register(["JavaScript", "JS"], { id: "javascript", src: localBrand("javascript.svg") });
register(["HTML", "HTML5"], { id: "html", src: localBrand("html5.svg") });
register(["CSS", "CSS3"], { id: "css", src: localBrand("css3.svg") });
register(["HTML, CSS, and JavaScript", "HTML CSS and JavaScript", "HTML CSS JavaScript"], { id: "html-css-javascript", src: localBrand("javascript.svg") });
register(["Firebase"], { id: "firebase", src: localBrand("firebase.svg") });
register(["Firebase and Firestore", "Firebase Firestore"], { id: "firebase-and-firestore", src: localBrand("firebase.svg") });
register(["Firebase Authentication", "Firebase Auth"], { id: "firebase-authentication", src: localBrand("firebase.svg") });
register(["Cloud Firestore", "Firestore"], { id: "cloud-firestore", src: localBrand("firebase.svg") });
register(["Firebase Cloud Functions", "Cloud Functions"], { id: "firebase-cloud-functions", src: localBrand("firebase.svg") });
register(["Firebase Hosting"], { id: "firebase-hosting", src: localBrand("firebase.svg") });
register(["GitHub"], { id: "github", src: localBrand("github.svg") });
register(["Git/GitHub", "Git and GitHub"], { id: "git-github", src: localBrand("github.svg") });
register(["Git"], { id: "git", src: localBrand("github.svg") });
register(["Adobe Photoshop", "Photoshop"], { id: "photoshop", src: localBrand("photoshop.svg") });
register(["Microsoft Excel", "Excel", "MS Excel"], { id: "excel", src: localBrand("excel.svg") });
register(["MySQL"], { id: "mysql", src: localBrand("mysql.svg") });
register(["Google Workspace"], { id: "google-workspace", src: localBrand("google-workspace.svg") });
register(["Google Sheets"], { id: "google-sheets", src: localBrand("google-workspace.svg") });
register(["Google Docs"], { id: "google-docs", src: localBrand("google-workspace.svg") });
register(["Canva"], { id: "canva", src: localBrand("canva.svg") });
register(["Vue", "Vue.js", "Vue JS"], { id: "vue", src: iconifyBrand("logos", "vue") });
register(["Vite", "Vite.js", "Vite JS"], { id: "vite", src: iconifyBrand("logos", "vitejs") });
register(["Pinia"], { id: "pinia", src: iconifyBrand("logos", "pinia") });
register(["Vue Router"], { id: "vue-router", src: iconifyBrand("logos", "vue") });
register(["Bootstrap", "Bootstrap 5"], { id: "bootstrap", src: iconifyBrand("logos", "bootstrap") });
register(["Sass", "SCSS"], { id: "sass", src: iconifyBrand("logos", "sass") });
register(["Visual Studio Code", "VS Code", "VSCode"], { id: "vs-code", src: iconifyBrand("logos", "visual-studio-code") });
register(["Cloudinary"], { id: "cloudinary", src: iconifyBrand("logos", "cloudinary") });
register(["ESP32", "Espressif ESP32"], { id: "esp32", src: iconifyBrand("simple-icons", "espressif") });
register(["RFID", "Radio Frequency Identification"], { id: "rfid", systemIcon: "cpu" });

const FALLBACK_BY_CATEGORY = Object.freeze({
  "office-productivity": "table-2",
  "creative-media": "brush",
  "web-development": "globe",
  "developer-tools": "code-2",
  "database-cloud": "cloud",
  "data-analytics": "chart-column",
  "ai-automation": "workflow",
  collaboration: "handshake",
  "cms-platforms": "globe",
  "gis-spatial": "map-pinned",
  "hardware-embedded": "cpu",
  "surveying-gnss": "map-pinned",
  "systems-support": "wrench",
  security: "shield-check",
  other: "sparkles",
});

export function resolveKnownToolIdentity(name = "") {
  return IDENTITIES.get(normalizeToolIdentityKey(name)) || null;
}

export function toolIdentityMatchKey(name = "") {
  const known = resolveKnownToolIdentity(name);
  return known?.id ? `known:${known.id}` : `name:${normalizeToolIdentityKey(name)}`;
}

export function resolveToolIconSource(tool = {}, category = "") {
  const record = typeof tool === "string" ? { name: tool, category } : (tool || {});
  const known = resolveKnownToolIdentity(record.name);
  if (known) return known.src || "";
  const saved = clean(record.icon || record.logo || record.logoUrl);
  if (saved && /^(?:data:image\/svg\+xml|https?:\/\/|\.?\.?\/|\/|file:)/i.test(saved)) return saved;
  return "";
}

export function resolveToolFallbackIcon(name = "", category = "") {
  const known = resolveKnownToolIdentity(name);
  if (known?.systemIcon) return known.systemIcon;
  const categoryKey = clean(category).toLowerCase();
  if (FALLBACK_BY_CATEGORY[categoryKey]) return FALLBACK_BY_CATEGORY[categoryKey];
  const source = normalizeToolIdentityKey(`${name} ${category}`);
  if (/\b(?:esp32|rfid|arduino|microcontroller|embedded|hardware|electronics)\b/.test(source)) return "cpu";
  if (/\b(?:sinognss|gnss|rtk|survey|spatial|mapping|gis)\b/.test(source)) return "map-pinned";
  if (/\b(?:cloud|cloudinary|hosting|saas)\b/.test(source)) return "cloud";
  if (/\b(?:database|mysql|sql|firestore)\b/.test(source)) return "database";
  if (/\b(?:automation|workflow|script)\b/.test(source)) return "workflow";
  if (/\b(?:security|cyber)\b/.test(source)) return "shield-check";
  if (/\b(?:support|maintenance|troubleshoot)\b/.test(source)) return "wrench";
  if (/\b(?:photo|image|design|creative|media)\b/.test(source)) return "brush";
  if (/\b(?:web|code|development|programming)\b/.test(source)) return "code-2";
  if (/\b(?:spreadsheet|excel|office|table)\b/.test(source)) return "table-2";
  return "sparkles";
}

export const TOOL_IDENTITY_ALIASES = Object.freeze([...IDENTITIES.keys()]);
