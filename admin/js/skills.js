import {
  createSkill,
  createTool,
  ensureCapabilityByName,
  deleteSkill,
  deleteTool,
  loadSkills,
  syncToolSkillLinks,
  updateSkill,
  updateTool,
} from "../services/skillService.js";

const CATEGORY_LABELS = {
  "web-development": "Web Development",
  "software-development": "Software / System Development",
  database: "Database",
  "data-office": "Data and Office",
  "it-support": "IT Support",
  multimedia: "Multimedia and Creative",
  ecommerce: "E-commerce",
  administration: "Administration",
  "gis-spatial": "GIS / Spatial",
  other: "Other",
};

const state = {
  skills: [],
  editingId: "",
  pendingDeleteId: "",
  search: "",
  category: "all",
  status: "all",
  sort: "order",
  saving: false,
  selectedId: "",
  editingToolId: "",
  pendingDeleteToolId: "",
  editingSkillToolIds: [],
  editingSkillLegacyTools: [],
  editingToolSkillIds: [],
  toolSearch: "",
  toolCategory: "all",
  toolStatus: "all",
};

const $ = (id) => document.getElementById(id);
const setSelectValue = (select, value, fallback = "") => {
  if (window.LANSetSelectValue) return window.LANSetSelectValue(select, value, fallback);
  if (!select) return false;
  const option = [...select.options].find((item) => item.value === String(value ?? ""));
  select.value = option?.value ?? fallback;
  return Boolean(option);
};

const elements = {
  saveStatus: $("saveStatus"),

  addSkillButton: $("addSkillButton"),
  addToolButton: $("addToolButton"),
  skillRelatedToolsPicker: $("skillRelatedToolsPicker"),
  emptyStateAddSkillButton:
    $("emptyStateAddSkillButton"),

  totalSkillCount: $("totalSkillCount"),
  activeSkillCount: $("activeSkillCount"),
  featuredSkillCount: $("featuredSkillCount"),
  categorySkillCount: $("categorySkillCount"),

  search: $("skillSearch"),
  categoryFilter: $("skillCategoryFilter"),
  statusFilter: $("skillStatusFilter"),
  sortFilter: $("skillSortFilter"),

  list: $("skillsList"),
  emptyState: $("skillsEmptyState"),

  form: $("skillForm"),
  formTitle: $("skillFormTitle"),
  id: $("skillId"),
  name: $("skillName"),
  category: $("skillCategory"),
  customCategoryField: $("skillCustomCategoryField"),
  customCategory: $("skillCustomCategory"),
  icon: $("skillIcon"),
  displayOrder: $("skillDisplayOrder"),
  proficiency: $("skillProficiency"),
  description: $("skillDescription"),
  descriptionCount:
    $("skillDescriptionCount"),
  tools: $("skillTools"),
  years: $("skillYears"),
  active: $("skillActive"),
  featured: $("skillFeatured"),

  liveIcon: $("liveSkillIcon"),
  liveName: $("liveSkillName"),
  liveCategory: $("liveSkillCategory"),
  liveLevel: $("liveSkillLevel"),
  livePercentage: $("liveSkillPercentage"),
  liveSegments: $("liveSkillSegments"),
  levelPicker: $("skillLevelPicker"),

  cancelButton: $("cancelSkillButton"),
  deleteButton: $("deleteSkillButton"),
  saveButton: $("saveSkillButton"),
  saveButtonText: $("saveSkillButtonText"),
  saveButtonLoader:
    $("saveSkillButtonLoader"),

  notification: $("notification"),
  notificationMessage:
    $("notificationMessage"),
  toolsShelf: $("skillsToolShelf"),
  editorDialog: $("skillEditorDialog"),
  cancelHeaderButton: $("cancelSkillHeaderButton"),

  toolEditorDialog: $("toolEditorDialog"),
  toolForm: $("toolForm"),
  toolId: $("toolId"),
  toolName: $("toolName"),
  toolCategory: $("toolCategory"),
  toolCustomCategoryField: $("toolCustomCategoryField"),
  toolCustomCategory: $("toolCustomCategory"),
  toolIcon: $("toolIcon"),
  toolDisplayOrder: $("toolDisplayOrder"),
  toolDescription: $("toolDescription"),
  toolActive: $("toolActive"),
  toolRelatedSkillsPicker: $("toolRelatedSkillsPicker"),
  skillToolSuggestions: $("skillToolSuggestions"),
  toolSkillSuggestions: $("toolSkillSuggestions"),
  toolLibrarySearch: $("toolLibrarySearch"),
  toolLibraryCategoryFilter: $("toolLibraryCategoryFilter"),
  toolLibraryStatusFilter: $("toolLibraryStatusFilter"),
  toolFormTitle: $("toolFormTitle"),
  cancelToolHeaderButton: $("cancelToolHeaderButton"),
  cancelToolButton: $("cancelToolButton"),
  deleteToolButton: $("deleteToolButton"),
  saveToolButton: $("saveToolButton"),
  deleteToolModal: $("deleteToolModal"),
  cancelDeleteToolButton: $("cancelDeleteToolButton"),
  confirmDeleteToolButton: $("confirmDeleteToolButton"),

  deleteModal: $("deleteSkillModal"),
  cancelDeleteButton:
    $("cancelDeleteSkillButton"),
  confirmDeleteButton:
    $("confirmDeleteSkillButton"),
};

let notificationTimer;
let skillRelatedToolsPicker = null;
let toolRelatedSkillsPicker = null;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categoryLabel(value, customCategory = "") {
  value = String(value || "other").trim().toLowerCase();
  if (value === "other" && String(customCategory).trim()) {
    return String(customCategory).trim();
  }

  return CATEGORY_LABELS[value] || "Other";
}

function skillCategoryLabel(skill = {}) {
  return categoryLabel(skill.category, skill.customCategory);
}

function isLegacyToolRecord(skill = {}) {
  return Boolean(window.LANCapabilitySemantics?.isLegacyToolRecord?.(skill.name));
}

function isManagedToolRecord(record = {}) {
  return String(record.recordType || "").toLowerCase() === "tool" || isLegacyToolRecord(record);
}

function primarySkills() {
  return state.skills.filter((skill) => !isManagedToolRecord(skill));
}

function managedTools() {
  return state.skills.filter(isManagedToolRecord).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

function toolsUsed() {
  return window.LANCapabilitySemantics?.collectTools?.(state.skills) || [];
}

function updateCustomCategoryVisibility() {
  const isOther = elements.category.value === "other";

  elements.customCategoryField.classList.toggle("hidden", !isOther);
  elements.customCategory.required = isOther;

  if (!isOther) {
    elements.customCategory.value = "";
  }

  updateLivePreview();
}

const SKILL_LEVELS = [
  { key: "beginner", label: "Beginner", value: 20, segments: 1 },
  { key: "developing", label: "Developing", value: 40, segments: 2 },
  { key: "intermediate", label: "Intermediate", value: 60, segments: 3 },
  { key: "advanced", label: "Advanced", value: 80, segments: 4 },
  { key: "expert", label: "Expert", value: 95, segments: 5 },
];

function getSkillLevel(value) {
  const number = Number(value || 0);

  return SKILL_LEVELS.reduce((closest, level) => {
    return Math.abs(level.value - number) < Math.abs(closest.value - number)
      ? level
      : closest;
  }, SKILL_LEVELS[0]);
}

function setStatus(value) {
  const labels = {
    ready: "Ready",
    loading: "Loading...",
    saving: "Saving...",
    saved: "Saved",
    deleting: "Deleting...",
    error: "Error",
  };

  elements.saveStatus.textContent =
    labels[value] || labels.ready;

  elements.saveStatus.dataset.status = value;
}

function notify(message, type = "success") {
  const tone = type === "error" ? "error" : type === "warning" ? "warning" : "success";
  window.LANNotice?.({ title: "Skills", message, tone });
}

const isResolvedIconSource = (value = "") => /^(?:data:image\/svg\+xml|https?:\/\/|\.?\.?\/|\/)/i.test(String(value || "").trim());

async function resolveIconAsset(name, category, recordType) {
  if (typeof window.LANResolveIconAsset !== "function") return "";
  try {
    return String(await window.LANResolveIconAsset(name, category, recordType) || "").trim();
  } catch (error) {
    console.info(`[LΛN icons] Unable to resolve ${recordType} icon for ${name}.`, error);
    return "";
  }
}

function normalizeSkill(skill = {}) {
  const recordType = String(skill.recordType || (isLegacyToolRecord(skill) ? "tool" : "skill")).trim().toLowerCase();
  const rawIcon = String(skill.icon || "").trim();
  const icon = recordType === "tool"
    ? rawIcon
    : (rawIcon === "✦" || isResolvedIconSource(rawIcon) ? "" : rawIcon);

  return {
    id: skill.id || "",
    recordType,
    name: String(skill.name || "").trim(),
    category: String(skill.category || "other").trim().toLowerCase(),
    customCategory:
      String(skill.customCategory || "").trim(),
    icon,
    proficiency: Math.min(
      100,
      Math.max(
        0,
        Number(skill.proficiency || 0)
      )
    ),
    years: Number(skill.years || 0),
    description:
      String(skill.description || "").trim(),
    toolIds: Array.isArray(skill.toolIds)
      ? skill.toolIds
      : [],
    tools: Array.isArray(skill.tools)
      ? skill.tools
      : [],
    displayOrder:
      Number(skill.displayOrder || 0),
    active: skill.active !== false,
    featured: Boolean(skill.featured),
    createdAt: skill.createdAt || null,
  };
}

function updateStatistics() {
  const skills = primarySkills();
  elements.totalSkillCount.textContent = skills.length;
  elements.activeSkillCount.textContent = skills.filter((skill) => skill.active && skill.proficiency >= 80).length;
  elements.featuredSkillCount.textContent = toolsUsed().length;
  elements.categorySkillCount.textContent = skills.filter((skill) => skill.active && skill.proficiency < 50).length;
}

function toolCategoryLabel(value = "", customCategory = "") {
  const labels = {
    "office-productivity": "Office / Productivity",
    "creative-media": "Creative / Media",
    "web-development": "Web Development",
    "developer-tools": "Developer Tools",
    "database-cloud": "Database / Cloud",
    "data-analytics": "Data / Analytics",
    "ai-automation": "AI / Automation",
    collaboration: "Collaboration",
    "cms-platforms": "CMS / Web Platforms",
    "gis-spatial": "GIS / Spatial",
    "hardware-embedded": "Hardware / Embedded",
    "surveying-gnss": "Surveying / GNSS",
    "systems-support": "Systems / Support",
    security: "Security",
    other: String(customCategory || "").trim() || "Other / Custom",
  };
  return labels[String(value || "other").toLowerCase()] || String(customCategory || "").trim() || "Other / Custom";
}

function syncToolAutomaticCategory() {
  if (elements.toolCategory) elements.toolCategory.value = "other";
  if (elements.toolCustomCategory) elements.toolCustomCategory.value = "";
}

function linkedSkillNamesForTool(tool = {}) {
  const linkedIds = new Set(deriveToolSkillIds(tool));
  return primarySkills()
    .filter((skill) => linkedIds.has(skill.id))
    .map((skill) => skill.name);
}

function linkedToolNamesForSkill(skill = {}) {
  const managed = managedTools();
  const byId = new Map(managed.map((tool) => [tool.id, tool.name]));
  const names = [];
  const seen = new Set();

  for (const id of Array.isArray(skill.toolIds) ? skill.toolIds : []) {
    const name = String(byId.get(id) || "").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }

  for (const value of Array.isArray(skill.tools) ? skill.tools : []) {
    const name = String(value || "").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }

  return names;
}

function relationshipTags(names = [], className = "") {
  if (!names.length) return "";
  const unique = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  const visible = unique.slice(0, 2);
  const remaining = unique.length - visible.length;
  return `<span class="skills-card-links ${className}" aria-label="Linked relationships">${visible.map((name) => `<span class="skills-card-link-tag">${escapeHtml(name)}</span>`).join("")}${remaining > 0 ? `<span class="skills-card-link-tag is-more">+${remaining}</span>` : ""}</span>`;
}

function filteredManagedTools() {
  const query = state.toolSearch.toLowerCase();
  return managedTools().filter((tool) => {
    const haystack = [tool.name, toolCategoryLabel(tool.category, tool.customCategory), tool.description].join(" ").toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const categoryKey = String(tool.category || "other");
    const matchesCategory = state.toolCategory === "all" || categoryKey === state.toolCategory;
    const matchesStatus = state.toolStatus === "all" || (state.toolStatus === "active" ? tool.active !== false : tool.active === false);
    return matchesSearch && matchesCategory && matchesStatus;
  });
}

function updateToolLibraryCategoryFilter() {
  if (!elements.toolLibraryCategoryFilter) return;
  const current = state.toolCategory;
  const categories = [...new Set(managedTools().map((tool) => String(tool.category || "other")))].sort((a,b) => toolCategoryLabel(a).localeCompare(toolCategoryLabel(b)));
  elements.toolLibraryCategoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(toolCategoryLabel(category))}</option>`).join("");
  elements.toolLibraryCategoryFilter.value = categories.includes(current) ? current : "all";
  state.toolCategory = elements.toolLibraryCategoryFilter.value;
}

function smartRelationshipSuggestions(sourceType = "skill") {
  const skills = primarySkills();
  const tools = managedTools();
  if (typeof window.LANSuggestCapabilityRelationships !== "function") return [];
  if (sourceType === "skill") {
    const sourceRecord = {
      id: state.editingId,
      name: elements.name?.value || "",
      category: elements.category?.value || "",
      customCategory: elements.customCategory?.value || "",
      description: elements.description?.value || "",
      toolIds: [...state.editingSkillToolIds]
    };
    return window.LANSuggestCapabilityRelationships({ sourceType: "skill", sourceRecord, skills, tools, excludeIds: state.editingSkillToolIds, limit: 6 });
  }
  const sourceRecord = {
    id: state.editingToolId,
    name: elements.toolName?.value || "",
    category: elements.toolCategory?.value || "",
    customCategory: elements.toolCustomCategory?.value || "",
    description: elements.toolDescription?.value || ""
  };
  return window.LANSuggestCapabilityRelationships({ sourceType: "tool", sourceRecord, skills, tools, excludeIds: state.editingToolSkillIds, limit: 6 });
}

function renderSmartSuggestions(sourceType = "skill") {
  const host = sourceType === "skill" ? elements.skillToolSuggestions : elements.toolSkillSuggestions;
  if (!host) return;
  const suggestions = smartRelationshipSuggestions(sourceType);
  const noun = sourceType === "skill" ? "Tools" : "Skills";
  if (!suggestions.length) {
    host.innerHTML = `<div class="skills-smart-suggestions-empty"><strong>No suggestions yet</strong><span>Start typing a name or add relationships and the CMS will surface relevant existing ${noun.toLowerCase()}.</span></div>`;
    return;
  }
  host.innerHTML = `<div class="skills-smart-suggestions-head"><div><strong>Suggested ${noun}</strong><span>Existing library matches — choose only what genuinely applies.</span></div></div><div class="skills-smart-suggestion-list">${suggestions.map((record) => `<button type="button" class="skills-smart-suggestion" data-smart-source="${sourceType}" data-smart-id="${escapeHtml(record.id)}"><span aria-hidden="true">+</span><strong>${escapeHtml(record.name)}</strong></button>`).join("")}</div>`;
}

function renderToolsShelf() {
  if (!elements.toolsShelf) return;
  const allManaged = managedTools();
  const managed = filteredManagedTools();
  const collected = toolsUsed();
  const managedNames = new Set(allManaged.map((tool) => tool.name.toLowerCase()));
  const derived = state.toolSearch || state.toolCategory !== "all" || state.toolStatus !== "all"
    ? []
    : collected.filter((tool) => !managedNames.has(String(tool.name || "").toLowerCase()));

  const managedMarkup = managed.map((tool) => {
    const linkedSkillsMarkup = relationshipTags(linkedSkillNamesForTool(tool), "is-skill-links");
    return `
    <article class="skills-tool-card is-managed${linkedSkillsMarkup ? " has-links" : ""}" data-tool-id="${escapeHtml(tool.id)}">
      <span class="skills-tool-card-icon">${window.LANSkillIconMarkup ? window.LANSkillIconMarkup(tool.name, tool.category || "technology", tool.icon, "tool") : "⌘"}</span>
      <span class="skills-tool-card-copy"><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(toolCategoryLabel(tool.category, tool.customCategory))}</small></span>
      <span class="skills-tool-card-state ${tool.active === false ? "is-inactive" : "is-active"}">${tool.active === false ? "Inactive" : "Active"}</span>
      ${linkedSkillsMarkup}
      <span class="skills-tool-card-actions">
        <button class="editor-secondary-button button-compact" type="button" data-tool-action="edit" data-tool-id="${escapeHtml(tool.id)}">Edit</button>
        <button class="editor-danger-button button-compact" type="button" data-tool-action="remove" data-tool-id="${escapeHtml(tool.id)}">Remove</button>
      </span>
    </article>`;
  }).join("");
  const derivedMarkup = derived.map((tool) => `<span class="skills-tool-card is-derived"><span class="skills-tool-card-icon">↗</span><span class="skills-tool-card-copy"><strong>${escapeHtml(tool.name)}</strong><small>Linked from ${escapeHtml(tool.owner || "skill")}</small></span><span class="skills-tool-card-state">Legacy</span></span>`).join("");
  elements.toolsShelf.innerHTML = managedMarkup || derivedMarkup
    ? `${managedMarkup}${derivedMarkup}`
    : '<div class="skills-tool-shelf-empty"><strong>No tools configured yet.</strong><span>Add Microsoft Excel, Adobe Photoshop, Firebase, Google Workspace, PAIS, or another tool.</span></div>';

  window.LANPinActiveRecordCard?.(elements.toolsShelf, state.editingToolId || "", {
    cardSelector: ".skills-tool-card.is-managed",
    idAttribute: "data-tool-id"
  });
  window.LANCreateRecordSelection?.(elements.toolsShelf, {
    cardSelector: ".skills-tool-card.is-managed", idAttribute: "data-tool-id", actionSelector: ".skills-tool-card-actions", label: "tool",
    records: managedTools(),
    capabilities: { publishing: false, featured: false, visibility: false, deletion: true },
    onDelete: async (ids) => { for (const id of ids) await deleteTool(id); if (ids.includes(state.editingToolId)) closeToolForm(); await refresh(); }
  })?.sync();
  renderSkillToolPicker();
}

function selectedSkillToolRecords() {
  const selectedIds = new Set(state.editingSkillToolIds);
  return managedTools().filter((tool) => selectedIds.has(tool.id));
}

function selectedSkillToolNames() {
  return [
    ...selectedSkillToolRecords().map((tool) => tool.name),
    ...state.editingSkillLegacyTools,
  ];
}

function syncSkillToolsField() {
  if (elements.tools) elements.tools.value = selectedSkillToolNames().join(", ");
}

function renderSkillToolPicker() {
  syncSkillToolsField();
  if (!elements.skillRelatedToolsPicker || typeof window.LANCreateCapabilityPicker !== "function") {
    renderSmartSuggestions("skill");
    return;
  }
  const options = {
    type: "tool",
    records: managedTools().filter((tool) => tool.active !== false),
    selectedIds: state.editingSkillToolIds,
    placeholder: "Search or add a related Tool…",
    compactAdd: true,
    relationshipStyle: true,
    addLabel: "+ Link Tool",
    emptyTitle: "No matching Tool found.",
    emptyHint: "Try another search.",
    getIcon: (tool) => {
      const saved = String(tool?.icon || "").trim();
      if (/^(?:data:image\/|https?:\/\/|\.?\.?\/|\/)/i.test(saved)) return saved;
      const resolved = window.LANResolveSkillIcon?.(tool?.name, tool?.category || "technology");
      return String(resolved?.src || "").trim();
    },
    getMeta: (tool) => toolCategoryLabel(tool.category, tool.customCategory),
    onChange(ids) {
      state.editingSkillToolIds = [...new Set(ids)];
      syncSkillToolsField();
      renderSmartSuggestions("skill");
    },
    async onCommit(value) {
      return commitLinkedCapability("tools", value);
    }
  };
  if (!skillRelatedToolsPicker) skillRelatedToolsPicker = window.LANCreateCapabilityPicker(elements.skillRelatedToolsPicker, options);
  else skillRelatedToolsPicker.update(options);
  renderSmartSuggestions("skill");
}

function setEditingSkillTools(values = [], toolIds = []) {
  const tools = managedTools();
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const byName = new Map(tools.map((tool) => [tool.name.toLowerCase(), tool]));
  const selectedIds = [];
  const legacy = [];

  for (const id of Array.isArray(toolIds) ? toolIds : []) {
    const key = String(id || "").trim();
    if (key && byId.has(key) && !selectedIds.includes(key)) selectedIds.push(key);
  }

  const names = Array.isArray(values) ? values : String(values || "").split(",");
  for (const value of names) {
    const name = String(value || "").trim();
    if (!name) continue;
    const managed = byName.get(name.toLowerCase());
    if (managed) {
      if (!selectedIds.includes(managed.id)) selectedIds.push(managed.id);
      continue;
    }
    if (!legacy.some((item) => item.toLowerCase() === name.toLowerCase())) legacy.push(name);
  }

  state.editingSkillToolIds = selectedIds;
  state.editingSkillLegacyTools = legacy;
  renderSkillToolPicker();
}

function deriveToolSkillIds(tool = {}) {
  const toolId = String(tool.id || "").trim();
  const toolName = String(tool.name || "").trim().toLowerCase();
  return primarySkills()
    .filter((skill) => {
      if (toolId && Array.isArray(skill.toolIds) && skill.toolIds.includes(toolId)) return true;
      return toolName && Array.isArray(skill.tools) && skill.tools.some((name) => String(name || "").trim().toLowerCase() === toolName);
    })
    .map((skill) => skill.id);
}

function renderToolSkillPicker() {
  if (!elements.toolRelatedSkillsPicker || typeof window.LANCreateCapabilityPicker !== "function") {
    renderSmartSuggestions("tool");
    return;
  }
  const options = {
    type: "skill",
    records: primarySkills().filter((skill) => skill.active !== false),
    selectedIds: state.editingToolSkillIds,
    placeholder: "Search or add a related Skill…",
    compactAdd: true,
    relationshipStyle: true,
    addLabel: "+ Link Skill",
    emptyTitle: "No matching Skill found.",
    emptyHint: "Try another search.",
    getMeta: skillCategoryLabel,
    onChange(ids) {
      state.editingToolSkillIds = [...new Set(ids)];
      renderSmartSuggestions("tool");
    },
    async onCommit(value) {
      return commitLinkedCapability("skills", value);
    }
  };
  if (!toolRelatedSkillsPicker) toolRelatedSkillsPicker = window.LANCreateCapabilityPicker(elements.toolRelatedSkillsPicker, options);
  else toolRelatedSkillsPicker.update(options);
  renderSmartSuggestions("tool");
}

function setEditingToolSkills(ids = []) {
  const validIds = new Set(primarySkills().map((skill) => skill.id));
  state.editingToolSkillIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter((id) => id && validIds.has(id)))];
  renderToolSkillPicker();
}


async function commitLinkedCapability(kind, rawName) {
  const targetType = kind === "tools" ? "tool" : "skill";
  const label = targetType === "tool" ? "Tool" : "Skill";
  try {
    const result = await ensureCapabilityByName(targetType, rawName);
    state.skills = (await loadSkills()).map(normalizeSkill);
    renderAll();
    notify(result.created
      ? `${label} “${result.name || rawName}” added to the shared library.`
      : `${label} “${result.name || rawName}” reused from the shared library.`);
    return result;
  } catch (error) {
    console.error(`Unable to add ${label}:`, error);
    notify(error.message || `Unable to add ${label}.`, "error");
    throw error;
  }
}

function updateCategoryFilter() {
  const current =
    elements.categoryFilter.value || "all";

  const categories = [
    ...new Set(
      primarySkills().map(
        (skill) => skill.category
      )
    ),
  ].sort((a, b) =>
    categoryLabel(a).localeCompare(
      categoryLabel(b)
    )
  );

  elements.categoryFilter.innerHTML =
    '<option value="all">All categories</option>';

  for (const category of categories) {
    const option =
      document.createElement("option");

    option.value = category;
    option.textContent =
      categoryLabel(category);

    elements.categoryFilter.append(option);
  }

  elements.categoryFilter.value =
    categories.includes(current)
      ? current
      : "all";

  state.category =
    elements.categoryFilter.value;
}

function filteredSkills() {
  const query =
    state.search.toLowerCase();

  const result = primarySkills().filter(
    (skill) => {
      const searchable = [
        skill.name,
        skillCategoryLabel(skill),
        skill.description,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query ||
        searchable.includes(query);

      const matchesCategory =
        state.category === "all" ||
        skill.category === state.category;

      const matchesStatus =
        state.status === "all" ||
        (
          state.status === "active" &&
          skill.active
        ) ||
        (
          state.status === "inactive" &&
          !skill.active
        );

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStatus
      );
    }
  );

  const sorted = [...result];

  switch (state.sort) {
    case "name":
      sorted.sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      break;

    case "proficiency":
      sorted.sort(
        (a, b) =>
          b.proficiency - a.proficiency ||
          a.name.localeCompare(b.name)
      );
      break;

    case "newest":
      sorted.sort(
        (a, b) =>
          new Date(
            b.createdAt?.toDate?.() ||
            b.createdAt ||
            0
          ) -
          new Date(
            a.createdAt?.toDate?.() ||
            a.createdAt ||
            0
          )
      );
      break;

    default:
      sorted.sort(
        (a, b) =>
          a.displayOrder -
            b.displayOrder ||
          a.name.localeCompare(b.name)
      );
  }

  return sorted;
}

function renderSkills() {
  const skills = filteredSkills();

  elements.list.innerHTML = "";

  elements.emptyState.classList.toggle(
    "hidden",
    skills.length > 0
  );

  for (const skill of skills) {
    const card =
      document.createElement("article");
    const linkedToolsMarkup = relationshipTags(linkedToolNamesForSkill(skill), "is-tool-links");

    card.className = `skill-card${state.selectedId === skill.id ? " is-selected" : ""}${linkedToolsMarkup ? " has-links" : ""}`;
    card.dataset.skillId = skill.id;
    card.innerHTML = `
      <div class="skill-card-identity">
        <div class="skill-card-icon" title="${escapeHtml(skill.name)}">
          ${window.LANSkillIconMarkup ? window.LANSkillIconMarkup(skill.name, skillCategoryLabel(skill), skill.icon, "skill") : escapeHtml(skill.icon)}
        </div>
        <div class="skill-card-copy">
          <h3>${escapeHtml(skill.name)}</h3>
        </div>
      </div>
      <div class="skill-card-meta"><span class="skill-card-badge category">${escapeHtml(skillCategoryLabel(skill))}</span><span class="skill-card-badge ${skill.active ? "active" : "inactive"}">${skill.active ? "Active" : "Inactive"}</span>${skill.featured ? '<span class="skill-card-badge featured">Featured</span>' : ""}</div>
      <div class="skill-card-progress-row"><div class="skill-card-progress"><span style="width:${skill.proficiency}%"></span></div><strong>${skill.proficiency}%</strong></div>
      ${linkedToolsMarkup}
      <div class="skill-card-actions">
        <button class="editor-secondary-button button-compact" type="button" data-action="edit" data-id="${escapeHtml(skill.id)}">Edit</button>
        <button class="editor-danger-button button-compact" type="button" data-action="delete" data-id="${escapeHtml(skill.id)}">Remove</button>
      </div>
    `;

    elements.list.append(card);
  }

  window.LANPinActiveRecordCard?.(elements.list, state.editingId || "", {
    cardSelector: ".skill-card",
    idAttribute: "data-skill-id"
  });
  window.LANCreateRecordSelection?.(elements.list, {
    cardSelector: ".skill-card", idAttribute: "data-skill-id", actionSelector: ".skill-card-actions", label: "skill",
    records: primarySkills(),
    capabilities: { publishing: false, featured: false, visibility: false, deletion: true },
    onDelete: async (ids) => { for (const id of ids) await deleteSkill(id); if (ids.includes(state.editingId)) closeForm(); await refresh(); }
  })?.sync();
}

function renderAll() {
  updateStatistics();
  updateCategoryFilter();
  updateToolLibraryCategoryFilter();
  renderToolsShelf();
  const skills = primarySkills();
  if (state.selectedId && !skills.some((skill) => skill.id === state.selectedId)) state.selectedId = "";
  if (!state.selectedId && skills.length) state.selectedId = skills[0].id;
  renderSkills();
}

function updateDescriptionCount() {
  elements.descriptionCount.textContent =
    `${elements.description.value.length} / 500`;
}

function updateLivePreview() {
  const proficiency = Number(elements.proficiency.value || 80);
  const level = getSkillLevel(proficiency);

  elements.liveLevel.textContent = level.label;
  elements.livePercentage.textContent = `${level.value}%`;

  elements.liveName.textContent =
    elements.name.value.trim() || "Skill preview";

  const liveCategory = elements.category.value
    ? categoryLabel(elements.category.value, elements.customCategory.value)
    : "Select a category";

  elements.liveIcon.innerHTML = window.LANSkillIconMarkup
    ? window.LANSkillIconMarkup(elements.name.value.trim(), liveCategory, elements.icon.value.trim(), "skill")
    : escapeHtml(elements.icon.value.trim() || "✦");

  elements.liveCategory.textContent = liveCategory;

  elements.liveSegments.setAttribute(
    "aria-label",
    `${level.label} skill level`
  );

  [...elements.liveSegments.children].forEach((segment, index) => {
    segment.classList.toggle("is-filled", index < level.segments);
  });

  elements.levelPicker.querySelectorAll("[data-value]").forEach((button) => {
    const selected = Number(button.dataset.value) === level.value;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
}

function selectSkillLevel(value) {
  const level = getSkillLevel(value);
  elements.proficiency.value = String(level.value);
  updateLivePreview();
}

function setSaving(saving) {
  state.saving = saving;

  elements.saveButton.disabled = saving;

  elements.saveButtonLoader?.classList.toggle(
    "show",
    saving
  );

  elements.saveButtonText.textContent =
    saving
      ? "Saving..."
      : state.editingId
        ? "Update Skill"
        : "Save Skill";
}

function resetForm() {
  elements.form.reset();

  state.editingId = "";

  elements.id.value = "";
  elements.displayOrder.value = "0";
  elements.proficiency.value = "80";
  elements.active.checked = true;
  elements.featured.checked = false;
  elements.customCategory.value = "";
  elements.customCategoryField.classList.add("hidden");
  elements.customCategory.required = false;
  state.editingSkillToolIds = [];
  state.editingSkillLegacyTools = [];
  renderSkillToolPicker();

  elements.formTitle.textContent =
    "Add skill";

  elements.deleteButton.classList.add(
    "hidden"
  );

  updateDescriptionCount();
  updateLivePreview();
  setSaving(false);
}

function openForm(skill = null) {
  resetForm();

  if (skill) {
    state.editingId = skill.id;

    elements.id.value = skill.id;
    elements.name.value = skill.name;
    setSelectValue(elements.category, skill.category, "other");

    elements.customCategory.value =
      skill.customCategory || "";

    updateCustomCategoryVisibility();

    elements.icon.value = isResolvedIconSource(skill.icon) ? "" : skill.icon;
    elements.displayOrder.value =
      skill.displayOrder;

    elements.proficiency.value =
      skill.proficiency;

    elements.description.value =
      skill.description;

    setEditingSkillTools(skill.tools, skill.toolIds);

    elements.years.value =
      skill.years || "";

    elements.active.checked =
      skill.active;

    elements.featured.checked =
      skill.featured;

    elements.formTitle.textContent =
      "Edit skill";

    elements.deleteButton.classList.remove(
      "hidden"
    );
  }

  updateDescriptionCount();
  updateLivePreview();

  elements.form.classList.remove("hidden");
  elements.editorDialog?.classList.remove("hidden");
  renderSkills();
  window.setTimeout(() => elements.name.focus({ preventScroll: true }), 80);
}

function closeForm() {
  elements.editorDialog?.classList.add("hidden");
  elements.form.classList.add("hidden");
  resetForm();
  renderSkills();
}

function dataFromForm() {
  return {
    name: elements.name.value,
    category: elements.category.value,
    customCategory:
      elements.category.value === "other"
        ? elements.customCategory.value
        : "",
    icon: elements.icon.value,
    displayOrder:
      elements.displayOrder.value,
    proficiency:
      elements.proficiency.value,
    description:
      elements.description.value,
    toolIds: [...state.editingSkillToolIds],
    tools: [...state.editingSkillLegacyTools],
    years: elements.years.value,
    active: elements.active.checked,
    featured:
      elements.featured.checked,
  };
}

function resetToolForm() {
  if (!elements.toolForm) return;
  elements.toolForm.reset();
  state.editingToolId = "";
  elements.toolId.value = "";
  elements.toolDisplayOrder.value = "0";
  if (elements.toolCustomCategory) elements.toolCustomCategory.value = "";
  elements.toolActive.checked = true;
  state.editingToolSkillIds = [];
  renderToolSkillPicker();
  elements.toolFormTitle.textContent = "Add tool";
  elements.deleteToolButton.classList.add("hidden");
  elements.saveToolButton.textContent = "Save Tool";
}

function openToolForm(tool = null) {
  resetToolForm();
  if (tool) {
    state.editingToolId = tool.id;
    elements.toolId.value = tool.id;
    elements.toolName.value = tool.name;
    syncToolAutomaticCategory();
    elements.toolIcon.value = isResolvedIconSource(tool.icon) ? "" : (tool.icon || "");
    elements.toolDisplayOrder.value = String(tool.displayOrder || 0);
    elements.toolDescription.value = tool.description || "";
    elements.toolActive.checked = tool.active !== false;
    setEditingToolSkills(deriveToolSkillIds(tool));
    elements.toolFormTitle.textContent = "Edit tool";
    elements.deleteToolButton.classList.remove("hidden");
    elements.saveToolButton.textContent = "Update Tool";
  }
  syncToolAutomaticCategory();
  renderToolSkillPicker();
  elements.toolEditorDialog?.classList.remove("hidden");
  renderToolsShelf();
  window.setTimeout(() => elements.toolName?.focus({ preventScroll: true }), 80);
}

function closeToolForm() {
  elements.toolEditorDialog?.classList.add("hidden");
  resetToolForm();
  renderToolsShelf();
}

function toolDataFromForm() {
  return {
    recordType: "tool",
    name: elements.toolName.value,
    category: "other",
    customCategory: "",
    icon: elements.toolIcon.value,
    displayOrder: elements.toolDisplayOrder.value,
    description: elements.toolDescription.value,
    active: elements.toolActive.checked,
    status: "published",
    visible: elements.toolActive.checked,
  };
}

async function saveTool(event) {
  event.preventDefault();
  if (window.LANValidateForm ? !window.LANValidateForm(elements.toolForm, { title: "Complete Tool" }) : !elements.toolForm.reportValidity()) return;
  setStatus("saving");
  elements.saveToolButton.disabled = true;
  try {
    const data = toolDataFromForm();
    const existingTool = state.editingToolId
      ? state.skills.find((item) => item.id === state.editingToolId && isManagedToolRecord(item))
      : null;
    if (!String(data.icon || "").trim()) {
      elements.saveToolButton.textContent = "Finding logo…";
      const resolvedIcon = await resolveIconAsset(
        data.name,
        data.customCategory || data.category || "software tool",
        "tool"
      );
      data.icon = resolvedIcon || (isResolvedIconSource(existingTool?.icon) ? existingTool.icon : "");
    }
    const previousName = existingTool?.name || "";
    const toolId = state.editingToolId
      ? state.editingToolId
      : await createTool(data);
    if (state.editingToolId) {
      await updateTool(toolId, data);
    }
    await syncToolSkillLinks(toolId, data.name, [...state.editingToolSkillIds], previousName);
    notify(state.editingToolId ? "Tool and Skill links updated successfully." : "Tool added and linked to the selected Skills.");
    await refresh();
    closeToolForm();
    setStatus("saved");
  } catch (error) {
    console.error(error);
    setStatus("error");
    notify(error.message || "Unable to save tool.", "error");
  } finally {
    elements.saveToolButton.disabled = false;
    elements.saveToolButton.textContent = state.editingToolId ? "Update Tool" : "Save Tool";
  }
}

function openToolDelete(toolId) {
  if (!toolId) return;
  state.pendingDeleteToolId = toolId;
  elements.deleteToolModal?.classList.remove("hidden");
}

function closeToolDelete() {
  state.pendingDeleteToolId = "";
  elements.deleteToolModal?.classList.add("hidden");
}

async function confirmToolDelete() {
  const toolId = state.pendingDeleteToolId;
  if (!toolId) return;
  const tool = state.skills.find((item) => item.id === toolId && isManagedToolRecord(item));
  if (!tool) { closeToolDelete(); return; }
  setStatus("deleting");
  try {
    await deleteTool(toolId);
    closeToolDelete();
    await refresh();
    closeToolForm();
    setStatus("saved");
    notify(`${tool.name} removed from the managed Tools Used library.`);
  } catch (error) {
    console.error(error);
    setStatus("error");
    notify(error.message || "Unable to delete tool.", "error");
  }
}

async function refresh() {
  setStatus("loading");

  try {
    const skills = await loadSkills();

    state.skills =
      skills.map(normalizeSkill);

    renderAll();
    setStatus("ready");
  } catch (error) {
    console.error(error);
    setStatus("error");

    notify(
      error.message ||
      "Unable to load skills.",
      "error"
    );
  }
}

async function saveSkill(event) {
  event.preventDefault();

  if (
    state.saving ||
    (window.LANValidateForm ? !window.LANValidateForm(elements.form, { title: "Complete Skill" }) : !elements.form.reportValidity())
  ) {
    return;
  }

  setSaving(true);
  setStatus("saving");

  try {
    const data = dataFromForm();

    if (state.editingId) {
      await updateSkill(
        state.editingId,
        data
      );

      notify(
        "Skill updated successfully."
      );
    } else {
      await createSkill(data);

      notify(
        "Skill added successfully."
      );
    }

    await refresh();
    closeForm();
    setStatus("saved");
  } catch (error) {
    console.error(error);
    setStatus("error");

    notify(
      error.message ||
      "Unable to save skill.",
      "error"
    );
  } finally {
    setSaving(false);
  }
}

function openDelete(skillId) {
  state.pendingDeleteId = skillId;
  elements.deleteModal.classList.remove("hidden");
}

function closeDelete() {
  state.pendingDeleteId = "";
  elements.deleteModal.classList.add("hidden");
}

async function confirmDelete() {
  if (!state.pendingDeleteId) {
    return;
  }

  try {
    setStatus("deleting");

    await deleteSkill(
      state.pendingDeleteId
    );

    if (
      state.editingId ===
      state.pendingDeleteId
    ) {
      closeForm();
    }

    closeDelete();
    await refresh();
    setStatus("saved");

    notify(
      "Skill deleted successfully."
    );
  } catch (error) {
    console.error(error);
    setStatus("error");

    notify(
      error.message ||
      "Unable to delete skill.",
      "error"
    );
  }
}

function handleListClick(event) {
  const button = event.target.closest("button[data-action]");

  if (button) {
    event.stopPropagation();

    const { action, id } = button.dataset;

    if (id) {
      state.selectedId = id;
    }

    if (action === "edit") {
      const skill = state.skills.find(
        (item) => item.id === id
      );

      if (skill) {
        openForm(skill);
      }
      return;
    }


    if (action === "delete") {
      openDelete(id);
      return;
    }
  }


  const row = event.target.closest(".skill-card");

  if (row?.dataset.skillId) {
    state.selectedId = row.dataset.skillId;
    renderSkills();
  }
}

function bindEvents() {
  elements.addSkillButton.addEventListener(
    "click",
    () => openForm()
  );

  elements.addToolButton?.addEventListener("click", () => openToolForm());
  elements.toolsShelf?.addEventListener("click", (event) => {
    const control = event.target.closest("[data-tool-action][data-tool-id]");
    if (!control) return;
    const tool = state.skills.find((item) => item.id === control.dataset.toolId && isManagedToolRecord(item));
    if (!tool) return;
    if (control.dataset.toolAction === "edit") openToolForm(tool);
    if (control.dataset.toolAction === "remove") openToolDelete(tool.id);
  });
  elements.toolForm?.addEventListener("submit", saveTool);
  elements.cancelToolButton?.addEventListener("click", closeToolForm);
  elements.cancelToolHeaderButton?.addEventListener("click", closeToolForm);
  elements.deleteToolButton?.addEventListener("click", () => openToolDelete(state.editingToolId));
  elements.cancelDeleteToolButton?.addEventListener("click", closeToolDelete);
  elements.confirmDeleteToolButton?.addEventListener("click", confirmToolDelete);
  elements.deleteToolModal?.addEventListener("click", (event) => { if (event.target === elements.deleteToolModal) closeToolDelete(); });
  elements.toolEditorDialog?.addEventListener("click", (event) => { if (event.target === elements.toolEditorDialog) closeToolForm(); });

  elements.emptyStateAddSkillButton.addEventListener(
    "click",
    () => openForm()
  );

  elements.form.addEventListener(
    "submit",
    saveSkill
  );

  elements.cancelButton.addEventListener(
    "click",
    closeForm
  );

  elements.deleteButton.addEventListener(
    "click",
    () => openDelete(
      state.editingId
    )
  );

  elements.list.addEventListener(
    "click",
    handleListClick
  );
  elements.cancelHeaderButton?.addEventListener("click", closeForm);
  elements.editorDialog?.addEventListener("click", (event) => { if (event.target === elements.editorDialog) closeForm(); });

  elements.cancelDeleteButton.addEventListener(
    "click",
    closeDelete
  );

  elements.confirmDeleteButton.addEventListener(
    "click",
    confirmDelete
  );

  elements.deleteModal.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        elements.deleteModal
      ) {
        closeDelete();
      }
    }
  );

  elements.search.addEventListener(
    "input",
    () => {
      state.search =
        elements.search.value.trim();

      renderSkills();
    }
  );

  elements.categoryFilter.addEventListener(
    "change",
    () => {
      state.category =
        elements.categoryFilter.value;

      renderSkills();
    }
  );

  elements.statusFilter.addEventListener(
    "change",
    () => {
      state.status =
        elements.statusFilter.value;

      renderSkills();
    }
  );

  elements.sortFilter.addEventListener(
    "change",
    () => {
      state.sort =
        elements.sortFilter.value;

      renderSkills();
    }
  );

  elements.name.addEventListener(
    "input",
    updateLivePreview
  );

  elements.icon.addEventListener(
    "input",
    updateLivePreview
  );

  elements.category.addEventListener(
    "change",
    updateCustomCategoryVisibility
  );

  elements.customCategory.addEventListener(
    "input",
    updateLivePreview
  );

  elements.levelPicker.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-value]");

      if (!button) {
        return;
      }

      selectSkillLevel(button.dataset.value);
    }
  );

  elements.description.addEventListener(
    "input",
    updateDescriptionCount
  );

  [elements.skillToolSuggestions, elements.toolSkillSuggestions].forEach((host) => host?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-smart-source][data-smart-id]");
    if (!button) return;
    const id = String(button.dataset.smartId || "");
    if (!id) return;
    if (button.dataset.smartSource === "skill") {
      state.editingSkillToolIds = [...new Set([...state.editingSkillToolIds, id])];
      renderSkillToolPicker();
    } else {
      state.editingToolSkillIds = [...new Set([...state.editingToolSkillIds, id])];
      renderToolSkillPicker();
    }
  }));

  elements.toolLibrarySearch?.addEventListener("input", () => { state.toolSearch = elements.toolLibrarySearch.value.trim(); renderToolsShelf(); });
  elements.toolLibraryCategoryFilter?.addEventListener("change", () => { state.toolCategory = elements.toolLibraryCategoryFilter.value; renderToolsShelf(); });
  elements.toolLibraryStatusFilter?.addEventListener("change", () => { state.toolStatus = elements.toolLibraryStatusFilter.value; renderToolsShelf(); });

  elements.toolName?.addEventListener("input", () => renderSmartSuggestions("tool"));
  elements.toolDescription?.addEventListener("input", () => renderSmartSuggestions("tool"));
  elements.name?.addEventListener("input", () => renderSmartSuggestions("skill"));
  elements.category?.addEventListener("change", () => renderSmartSuggestions("skill"));
  elements.customCategory?.addEventListener("input", () => renderSmartSuggestions("skill"));
  elements.description?.addEventListener("input", () => renderSmartSuggestions("skill"));



  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        if (elements.deleteToolModal && !elements.deleteToolModal.classList.contains("hidden")) closeToolDelete();
        else if (!elements.deleteModal.classList.contains("hidden")) closeDelete();
        else if (elements.toolEditorDialog && !elements.toolEditorDialog.classList.contains("hidden")) closeToolForm();
        else if (elements.editorDialog && !elements.editorDialog.classList.contains("hidden")) closeForm();
      }
    }
  );
}

async function initialize() {
  bindEvents();
  resetForm();
  resetToolForm();

  try {
    await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin shell session bridge did not initialize.")));
    await refresh();
  } catch (error) {
    console.error("Admin workspace session could not be consumed:", error);
    setStatus("error");
    notify("Administrator session could not be verified.", "error");
  }
}

await initialize();
