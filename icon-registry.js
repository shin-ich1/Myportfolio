/*
 * LΛN shared system icon registry.
 * One canonical resolver is used by Admin navigation, Services Admin,
 * and the public Work With Me renderer. Icons are intentionally system
 * symbols, not brand logos.
 */

const ICONS = Object.freeze({
  "layout-dashboard": { label: "Dashboard", keywords: "grid panels overview", body: '<rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="4" rx="1.6"/><rect x="14" y="11" width="7" height="10" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/>' },
  "house": { label: "Home", keywords: "home studio", body: '<path d="m3 11 9-7 9 7"/><path d="M5.5 10.5V21h13V10.5"/><path d="M9.5 21v-6h5v6"/>' },
  "user-round": { label: "Person", keywords: "user profile about assistant", body: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-4.2 3.4-6.5 7.5-6.5s6.8 2.3 7.5 6.5"/>' },
  "briefcase-business": { label: "Briefcase", keywords: "work job services business", body: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"/><path d="M3 12h18"/><path d="M10 12v2h4v-2"/>' },
  "graduation-cap": { label: "Education", keywords: "school graduation education", body: '<path d="m2 9 10-5 10 5-10 5-10-5Z"/><path d="M6 12v4c3.5 2.6 8.5 2.6 12 0v-4"/><path d="M21 9v6"/>' },
  "star": { label: "Skills", keywords: "skill favorite capability", body: '<path d="m12 2.5 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.1l6.2-.9L12 2.5Z"/>' },
  "panels-top-left": { label: "Projects", keywords: "project panels layout work", body: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>' },
  "camera": { label: "Camera", keywords: "photo camera image editing", body: '<path d="M5 7h3l1.3-2h5.4L16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/>' },
  "blocks": { label: "Modules", keywords: "blocks custom modules layers", body: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 14v6M14 17h6"/>' },
  "award": { label: "Award", keywords: "certificate award badge", body: '<circle cx="12" cy="8" r="5"/><path d="m8.5 12-1 9 4.5-2.5 4.5 2.5-1-9"/><path d="m12 5.2.8 1.6 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3.8-1.6Z"/>' },
  "file-text": { label: "Document", keywords: "resume file document text", body: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>' },
  "mail": { label: "Mail", keywords: "contact email mail", body: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4.5 8 7.5 5.5L19.5 8"/>' },
  "handshake": { label: "Services", keywords: "services handshake client work", body: '<path d="m8.5 12 2.5 2.5a2 2 0 0 0 2.8 0l2.7-2.7"/><path d="m3 10 4.5-4 3 2.5M21 10l-4.5-4-3 2.5"/><path d="m6.5 13 4 4a2 2 0 0 0 2.8 0l4.2-4"/><path d="M3 8v7M21 8v7"/>' },
  "settings": { label: "Settings", keywords: "gear settings configuration", body: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>' },

  "keyboard": { label: "Data / Keyboard", keywords: "data typing encoding keyboard", body: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M6 10h1M10 10h1M14 10h1M18 10h.1M6 14h1M10 14h1M14 14h4"/>' },
  "table-2": { label: "Spreadsheet", keywords: "excel spreadsheet table sheet", body: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/>' },
  "folders": { label: "Files", keywords: "folder files organization records", body: '<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2h7v2"/>' },
  "search": { label: "Research", keywords: "search research find web", body: '<circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/>' },
  "clipboard-list": { label: "Administration", keywords: "admin support clipboard tasks assistant", body: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/>' },
  "image": { label: "Image", keywords: "image photo graphic design", body: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9" r="1.7"/><path d="m5 18 5-5 3 3 2-2 4 4"/>' },
  "video": { label: "Video", keywords: "video editing film media", body: '<rect x="3" y="5" width="14" height="14" rx="2.5"/><path d="m17 10 4-2v8l-4-2Z"/>' },
  "code-2": { label: "Code", keywords: "code web development programming", body: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>' },
  "database": { label: "Database", keywords: "database data analysis sql records work", body: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>' },
  "chart-column": { label: "Analytics", keywords: "analytics analysis chart reporting", body: '<path d="M4 20V10h4v10M10 20V5h4v15M16 20v-7h4v7"/><path d="M3 20h18"/>' },
  "palette": { label: "Design", keywords: "graphic design palette creative", body: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h2.5A6.5 6.5 0 0 0 21 7.5C21 5 17 3 12 3Z"/><circle cx="7.5" cy="9" r="1"/><circle cx="10" cy="6.5" r="1"/><circle cx="14" cy="6.5" r="1"/>' },
  "map-pinned": { label: "GIS / Mapping", keywords: "gis map mapping spatial location", body: '<path d="M3 6.5 8 4l8 3 5-2.5v13L16 20l-8-3-5 2.5v-13Z"/><path d="M8 4v13M16 7v13"/><circle cx="16" cy="8" r="2"/>' },
  "headset": { label: "Virtual Assistant", keywords: "virtual assistant support headset", body: '<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="12" width="4" height="6" rx="2"/><rect x="17" y="12" width="4" height="6" rx="2"/><path d="M17 18c0 2-2 3-5 3"/>' },
  "calculator": { label: "Calculation", keywords: "calculator accounting numbers", body: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 18h5"/>' },
  "pen-tool": { label: "Writing", keywords: "writing content documentation pen", body: '<path d="m12 3 5 5-8 8-4 1 1-4 8-8Z"/><path d="m11 5 5 5"/>' },

  "shield-check": { label: "Cybersecurity", keywords: "cybersecurity security shield protection audit", body: '<path d="M12 3 19 6v5c0 4.6-2.7 8-7 10-4.3-2-7-5.4-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>' },
  "cloud": { label: "Cloud", keywords: "cloud aws azure hosting infrastructure remote work", body: '<path d="M6.5 18H18a4 4 0 0 0 .7-7.9A6.5 6.5 0 0 0 6.2 8.8 4.7 4.7 0 0 0 6.5 18Z"/>' },
  "workflow": { label: "Automation", keywords: "automation workflow process integration apps script", body: '<rect x="3" y="4" width="6" height="5" rx="1.5"/><rect x="15" y="15" width="6" height="5" rx="1.5"/><path d="M9 6.5h3a3 3 0 0 1 3 3V15M15 17.5h-3a3 3 0 0 1-3-3V9"/>' },
  "bot": { label: "AI / Assistant", keywords: "ai assistant bot virtual automation support", body: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.1M16 12h.1M8 16h8"/>' },
  "globe": { label: "Web", keywords: "web website internet development online", body: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>' },
  "server": { label: "Server", keywords: "server hosting backend infrastructure api", body: '<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.1M8 17h.1M12 7h5M12 17h5"/>' },
  "network": { label: "Network", keywords: "network infrastructure lan wifi connectivity systems", body: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v4M5 16v-2h14v2M12 11H5v3M12 11h7v3"/>' },
  "wrench": { label: "Technical Support", keywords: "support repair maintenance technical troubleshooting", body: '<path d="M14.5 6.5a5 5 0 0 0-6.8 6.8L3 18l3 3 4.7-4.7a5 5 0 0 0 6.8-6.8l-3 3-3-3 3-3Z"/>' },
  "cpu": { label: "Hardware / Embedded", keywords: "hardware embedded microcontroller cpu chip esp32 rfid electronics", body: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>' },
  "brush": { label: "Creative Editing", keywords: "design graphic editing creative brush", body: '<path d="m14 4 6 6-8 8H6v-6l8-8Z"/><path d="m12 6 6 6M6 18c-2 0-3 1-3 3 2 0 4-.5 5-2"/>' },
  "sparkles": { label: "General", keywords: "general other sparkles", body: '<path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3ZM18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13ZM6 14l.8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8L6 14Z"/>' },
  "menu": { label: "Menu", keywords: "menu sidebar navigation", body: '<path d="M4 7h16M4 12h16M4 17h16"/>' },
  "panel-left-close": { label: "Collapse sidebar", keywords: "sidebar collapse panel", body: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 9l-3 3 3 3"/>' },
  "panel-left-open": { label: "Expand sidebar", keywords: "sidebar expand panel", body: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M12 9l3 3-3 3"/>' },
  "eye": { label: "Preview", keywords: "preview view visibility", body: '<path d="M2.8 12s3.4-5.2 9.2-5.2S21.2 12 21.2 12 17.8 17.2 12 17.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/>' },
  "refresh-cw": { label: "Refresh", keywords: "refresh reload sync", body: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6.2 6.2L4 8M5.5 15A7 7 0 0 0 17.8 17.8L20 16"/>' },
  "arrow-left": { label: "Back", keywords: "back previous return", body: '<path d="M19 12H5M11 6l-6 6 6 6"/>' },
  "external-link": { label: "Open", keywords: "open external link public", body: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>' },
  "save": { label: "Save", keywords: "save commit store", body: '<path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>' },
  "plus": { label: "Create", keywords: "add create new plus", body: '<path d="M12 5v14M5 12h14"/>' },
  "send": { label: "Publish", keywords: "publish send launch", body: '<path d="m3 11 18-8-7 18-3-7-8-3Z"/><path d="m11 14 10-11"/>' }
});

export const NAVIGATION_ICON_MAP = Object.freeze({
  dashboard: "layout-dashboard",
  home: "house",
  about: "user-round",
  experience: "briefcase-business",
  education: "graduation-cap",
  skills: "star",
  projects: "panels-top-left",
  photo: "camera",
  custom: "blocks",
  certificates: "award",
  resume: "file-text",
  contact: "mail",
  services: "handshake",
  settings: "settings"
});

export const SYSTEM_ICON_CATALOG = Object.freeze(Object.entries(ICONS).map(([id, item]) => Object.freeze({ id, label: item.label, keywords: item.keywords || "" })));

const MODULE_ICON_FAMILIES = Object.freeze({
  video: Object.freeze(["video", "workflow", "sparkles", "folders"]),
  media: Object.freeze(["folders", "image", "palette", "video"]),
  gallery: Object.freeze(["image", "folders", "palette", "sparkles"]),
  data: Object.freeze(["database", "table-2", "chart-column", "clipboard-list"]),
  web: Object.freeze(["globe", "code-2", "server", "network"]),
  document: Object.freeze(["file-text", "pen-tool", "folders", "clipboard-list"]),
  relationship: Object.freeze(["network", "workflow", "folders", "clipboard-list"]),
  timeline: Object.freeze(["clipboard-list", "briefcase-business", "file-text", "sparkles"]),
  general: Object.freeze(["sparkles", "folders", "clipboard-list", "blocks"])
});

function moduleSemanticText(module = {}) {
  return [module.title, module.subtitle, module.adminWorkspace, module.publicPresentation, module.contentMode]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function moduleAdminIconCandidates(module = {}) {
  const fields = Array.isArray(module.fields) ? module.fields : [];
  const types = new Set(fields.map((field) => String(field?.type || "").trim().toLowerCase()).filter(Boolean));
  const semantic = moduleSemanticText(module);
  const families = [];
  const add = (family) => { if (!families.includes(family)) families.push(family); };

  if (types.has("video") || /\b(video|motion|film|cinematic)\b/.test(semantic)) add("video");
  if (["image","images","gallery"].some((type) => types.has(type)) || /\b(media|photo|image|gallery|portfolio)\b/.test(semantic) || /media-library|gallery/.test(semantic)) add("media");
  if (types.has("gallery") || types.has("images")) add("gallery");
  if (["number","table","spreadsheet"].some((type) => types.has(type)) || /\b(data|database|records|inventory|analytics|spreadsheet)\b/.test(semantic)) add("data");
  if (/\b(web|website|code|development|api|server)\b/.test(semantic)) add("web");
  if (["document","pdf","file","project-file","files"].some((type) => types.has(type)) || /\b(document|resume|article|writing|file|archive)\b/.test(semantic)) add("document");
  if (types.has("relationship") || (Array.isArray(module.relationships) && module.relationships.length)) add("relationship");
  if (/timeline/.test(semantic)) add("timeline");
  add("general");

  const candidates = [];
  for (const family of families) {
    for (const icon of MODULE_ICON_FAMILIES[family] || []) {
      const normalized = normalizeSystemIconName(icon);
      if (!candidates.includes(normalized)) candidates.push(normalized);
    }
  }
  return Object.freeze(candidates);
}

export function resolveModuleAdminIcon(module = {}, options = {}) {
  const theme = module?.theme && typeof module.theme === "object" ? module.theme : {};
  const mode = String(theme.iconMode || "auto").trim().toLowerCase();
  if (mode === "manual" && String(theme.icon || "").trim()) return normalizeSystemIconName(theme.icon);
  const occupied = new Set((options.occupied || []).map((icon) => normalizeSystemIconName(icon)));
  const candidates = moduleAdminIconCandidates(module);
  return candidates.find((icon) => !occupied.has(icon)) || candidates[0] || "sparkles";
}

const ALIASES = Object.freeze({
  "table": "table-2",
  "spreadsheet": "table-2",
  "folder": "folders",
  "file-spreadsheet": "table-2",
  "briefcase": "briefcase-business",
  "user": "user-round",
  "home": "house",
  "project": "panels-top-left",
  "photo": "image",
  "layers": "blocks",
  "admin": "clipboard-list",
  "analytics": "chart-column",
  "map": "map-pinned",
  "code": "code-2",
  "web": "globe",
  "website": "globe",
  "cybersecurity": "shield-check",
  "security": "shield-check",
  "cloud-work": "cloud",
  "automation": "workflow",
  "virtual-assistant": "headset",
  "gis": "map-pinned",
  "mapping": "map-pinned",
  "data-analysis": "chart-column",
  "database-work": "database"
});

function escapeAttr(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function normalizeSystemIconName(name = "sparkles") {
  const raw = String(name ?? "").trim().toLowerCase();
  const key = ALIASES[raw] || raw;
  return ICONS[key] ? key : "sparkles";
}

export function getSystemIconMeta(name = "sparkles") {
  const id = normalizeSystemIconName(name);
  const item = ICONS[id];
  return Object.freeze({ id, label: item.label, keywords: item.keywords || "" });
}

export function searchSystemIcons(query = "") {
  const tokens = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return SYSTEM_ICON_CATALOG;
  return SYSTEM_ICON_CATALOG.filter((item) => {
    const haystack = `${item.id} ${item.label} ${item.keywords}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function renderSystemIcon(name = "sparkles", options = {}) {
  const id = normalizeSystemIconName(name);
  const item = ICONS[id];
  const className = ["lan-system-icon", options.className || ""].filter(Boolean).join(" ");
  const title = options.title === true ? item.label : String(options.title || "").trim();
  const titleMarkup = title ? `<title>${escapeAttr(title)}</title>` : "";
  const aria = title ? ` role="img" aria-label="${escapeAttr(title)}"` : ' aria-hidden="true"';
  return `<svg class="${escapeAttr(className)}" data-system-icon="${escapeAttr(id)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${aria}>${titleMarkup}${item.body}</svg>`;
}
