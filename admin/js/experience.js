/* =========================================================
   LΛN PORTFOLIO CMS
   Experience Manager
   File: admin/js/experience.js
   ========================================================= */

  import {
    createExperience,
    deleteExperience,
    loadExperiences,
    updateExperience,
    updateManyExperiences
  } from "../services/experienceService.js";
  
  /* =========================================================
     1. APPLICATION STATE
     ========================================================= */
  
  let experiences = [];
  let hasUnsavedChanges = false;
  let authenticationResolved = false;
  let isSaving = false;
  let isDeleting = false;
  let pendingDeleteId = "";
  let experienceSkillsLibrary = [];
  let experienceSkillServiceModule = null;
  let experienceCapabilityRefreshAt = 0;
  let selectedExperienceSkillIds = [];
  let selectedExperienceToolIds = [];
  let experienceSkillPicker = null;
  let experienceToolPicker = null;
  
  /* =========================================================
     2. DOM ELEMENTS
     ========================================================= */
  
  const experienceForm =
    document.getElementById("experienceForm");
  
  const experienceIdInput =
    document.getElementById("experienceId");
  
  const experienceFormTitle =
    document.getElementById("experienceFormTitle");
  
  const saveStatus =
    document.getElementById("saveStatus");
  
  const addExperienceButton =
    document.getElementById("addExperienceButton");
  
  const emptyStateAddButton =
    document.getElementById("emptyStateAddButton");
  
  const cancelExperienceButton =
    document.getElementById("cancelExperienceButton");
  
  const deleteExperienceButton =
    document.getElementById("deleteExperienceButton");
  
  const saveExperienceButton =
    document.getElementById("saveExperienceButton");
  
  const saveExperienceButtonText =
    document.getElementById("saveExperienceButtonText");
  
  const saveExperienceButtonLoader =
    document.getElementById("saveExperienceButtonLoader");
  
  const experienceList =
    document.getElementById("experienceList");
  
  const experienceEmptyState =
    document.getElementById("experienceEmptyState");
  
  const experienceSearch =
    document.getElementById("experienceSearch");
  
  const statusFilter =
    document.getElementById("statusFilter");
  
  const totalExperienceCount =
    document.getElementById("totalExperienceCount");
  
  const publishedExperienceCount =
    document.getElementById("publishedExperienceCount");
  
  const draftExperienceCount =
    document.getElementById("draftExperienceCount");
  
  const currentlyWorking =
    document.getElementById("currentlyWorking");
  
  const startMonth =
    document.getElementById("startMonth");

  const startYear =
    document.getElementById("startYear");

  const endMonth =
    document.getElementById("endMonth");

  const endYear =
    document.getElementById("endYear");
  
  const experienceSummary =
    document.getElementById("experienceSummary");
  
  const experienceSummaryCount =
    document.getElementById("experienceSummaryCount");
  
  const responsibilityList =
    document.getElementById("responsibilityList");
  
  const achievementList =
    document.getElementById("achievementList");
  
  const addResponsibilityButton =
    document.getElementById("addResponsibilityButton");
  
  const addAchievementButton =
    document.getElementById("addAchievementButton");

  const experienceSkillPickerHost = getElement("experienceSkillPicker");
  const experienceToolPickerHost = getElement("experienceToolPicker");
  
  const deleteConfirmationModal =
    document.getElementById("deleteConfirmationModal");
  
  const cancelDeleteButton =
    document.getElementById("cancelDeleteButton");
  
  const confirmDeleteButton =
    document.getElementById("confirmDeleteButton");
  
  const comingSoonLinks =
    document.querySelectorAll("[data-coming-soon]");
  
  const publicCompanyDisplay = getElement("publicCompanyDisplay");
  const employmentType = getElement("employmentType");
  const employmentTypeOther = getElement("employmentTypeOther");
  const employmentTypeOtherField = getElement("employmentTypeOtherField");
  const experienceCategory = getElement("experienceCategory");
  const experienceCategoryOther = getElement("experienceCategoryOther");
  const experienceCategoryOtherField = getElement("experienceCategoryOtherField");
  const workSetup = getElement("workSetup");
  const workSetupOther = getElement("workSetupOther");
  const workSetupOtherField = getElement("workSetupOtherField");

  /* =========================================================
     3. BASIC HELPERS
     ========================================================= */
  
  function getElement(id) {
    return document.getElementById(id);
  }
  
  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  
  function formatLabel(value = "") {
    if (!value) {
      return "";
    }
  
    return String(value)
      .replaceAll("-", " ")
      .replace(/\b\w/g, (character) =>
        character.toUpperCase()
      );
  }
  
  function updateExperienceOtherFields() {
    const configurations = [
      [employmentType, employmentTypeOtherField, employmentTypeOther],
      [experienceCategory, experienceCategoryOtherField, experienceCategoryOther],
      [workSetup, workSetupOtherField, workSetupOther]
    ];

    configurations.forEach(([select, field, input]) => {
      const custom = select?.value === "other";
      field?.classList.toggle("hidden", !custom);
      if (input) {
        input.required = custom;
        input.disabled = !custom;
      }
    });
  }

  function experienceValueLabel(value, customValue, formatter) {
    if (value === "other" && String(customValue || "").trim()) {
      return String(customValue).trim();
    }
    return formatter(value);
  }

  function formatEmploymentType(value = "") {
    const labels = {
      "full-time": "Full-time",
      "part-time": "Part-time",
      contract: "Contract",
      freelance: "Freelance",
      internship: "Internship / OJT",
      temporary: "Temporary",
      volunteer: "Volunteer",
      "self-employed": "Self-employed",
      project: "Project-based",
      other: "Other"
    };

    return labels[value] || formatLabel(value);
  }

  function formatExperienceCategory(value = "") {
    const labels = {
      "data-administration": "Data and Administration",
      technology: "Technology and IT",
      multimedia: "Multimedia and Creative",
      ecommerce: "E-commerce and Retail",
      sales: "Sales and Business Development",
      "customer-service": "Customer Service",
      operations: "Operations and Logistics",
      government: "Government Service",
      education: "Education and Training",
      other: "Other Industry"
    };

    return labels[value] || formatLabel(value);
  }

  function formatWorkSetup(value = "") {
    const labels = {
      onsite: "On-site",
      remote: "Remote",
      hybrid: "Hybrid"
    };

    return labels[value] || formatLabel(value);
  }

  function formatMonth(value = "") {
    if (!value) {
      return "";
    }
  
    const [year, month] = value.split("-");
  
    if (!year || !month) {
      return value;
    }
  
    const date = new Date(
      Number(year),
      Number(month) - 1,
      1
    );
  
    return new Intl.DateTimeFormat(
      "en-US",
      {
        month: "short",
        year: "numeric"
      }
    ).format(date);
  }


  const EXPERIENCE_MIN_YEAR = 1980;

  function getCurrentExperiencePeriod() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1
    };
  }

  function syncSelectValue(select, value = "") {
    if (!select) {
      return;
    }

    if (window.LANSetSelectValue) {
      window.LANSetSelectValue(select, value, "");
    } else {
      select.value = value;
      select.dispatchEvent(new Event("lan:select-sync"));
    }
  }

  function populateYearSelect(
    select,
    { minYear = EXPERIENCE_MIN_YEAR, maxYear, preserveValue = true } = {}
  ) {
    if (!select) {
      return;
    }

    const previousValue = preserveValue ? String(select.value || "") : "";
    const placeholder = select.querySelector('option[value=""]');

    [...select.options].forEach((option) => {
      if (option !== placeholder) {
        option.remove();
      }
    });

    for (let year = maxYear; year >= minYear; year -= 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      select.appendChild(option);
    }

    const canRestore = previousValue && [...select.options].some((option) =>
      option.value === previousValue
    );

    syncSelectValue(select, canRestore ? previousValue : "");
  }

  function setMonthRange(select, minMonth = 1, maxMonth = 12) {
    if (!select) {
      return;
    }

    const selectedMonth = Number(select.value || 0);

    [...select.options].forEach((option) => {
      if (!option.value) {
        option.disabled = false;
        return;
      }

      const month = Number(option.value);
      option.disabled = month < minMonth || month > maxMonth;
    });

    if (
      selectedMonth &&
      (selectedMonth < minMonth || selectedMonth > maxMonth)
    ) {
      syncSelectValue(select, "");
    } else {
      select.dispatchEvent(new Event("lan:select-sync"));
    }
  }

  function syncExperienceDateRules() {
    if (!startYear || !startMonth || !endYear || !endMonth) {
      return;
    }

    const { year: currentYear, month: currentMonth } =
      getCurrentExperiencePeriod();
    const selectedStartYear = Number(startYear.value || 0);
    const selectedStartMonth = Number(startMonth.value || 0);

    setMonthRange(
      startMonth,
      1,
      selectedStartYear === currentYear ? currentMonth : 12
    );

    const endMinimumYear = selectedStartYear || EXPERIENCE_MIN_YEAR;
    populateYearSelect(endYear, {
      minYear: endMinimumYear,
      maxYear: currentYear,
      preserveValue: true
    });

    const selectedEndYear = Number(endYear.value || 0);
    let minimumEndMonth = 1;
    let maximumEndMonth = 12;

    if (
      selectedEndYear &&
      selectedStartYear &&
      selectedEndYear === selectedStartYear &&
      selectedStartMonth
    ) {
      minimumEndMonth = selectedStartMonth;
    }

    if (selectedEndYear === currentYear) {
      maximumEndMonth = currentMonth;
    }

    setMonthRange(
      endMonth,
      minimumEndMonth,
      maximumEndMonth
    );
  }

  function populateYearOptions() {
    const { year: currentYear } = getCurrentExperiencePeriod();
    const dateRules = getElement("experienceDateRules");

    if (dateRules) {
      dateRules.textContent =
        `Start dates cannot be later than ${currentExperiencePeriodLabel()}. ` +
        "End dates must be on or after the start date and cannot be in the future. " +
        'Use “Currently working here” for active roles.';
    }

    populateYearSelect(startYear, {
      minYear: EXPERIENCE_MIN_YEAR,
      maxYear: currentYear,
      preserveValue: false
    });

    populateYearSelect(endYear, {
      minYear: EXPERIENCE_MIN_YEAR,
      maxYear: currentYear,
      preserveValue: false
    });

    syncExperienceDateRules();
  }

  function combineMonthAndYear(
    monthSelect,
    yearSelect
  ) {
    const month = monthSelect?.value || "";
    const year = yearSelect?.value || "";

    if (!month || !year) {
      return "";
    }

    return `${year}-${month}`;
  }

  function splitMonthValue(value = "") {
    const [year = "", month = ""] =
      String(value).split("-");

    return { year, month };
  }

  function experiencePeriodNumber(value = "") {
    const { year, month } = splitMonthValue(value);
    const numericYear = Number(year);
    const numericMonth = Number(month);

    if (!numericYear || !numericMonth) {
      return 0;
    }

    return numericYear * 12 + numericMonth;
  }

  function currentExperiencePeriodNumber() {
    const { year, month } = getCurrentExperiencePeriod();
    return year * 12 + month;
  }

  function currentExperiencePeriodLabel() {
    const { year, month } = getCurrentExperiencePeriod();
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric"
    }).format(new Date(year, month - 1, 1));
  }
  
  /* =========================================================
     4. STATUS AND NOTIFICATIONS
     ========================================================= */
  
  function setManagerStatus(status = "ready") {
    if (!saveStatus) {
      return;
    }
  
    const statusLabels = {
      ready: "Ready",
      editing: "Unsaved changes",
      loading: "Loading...",
      saving: "Saving...",
      saved: "Saved",
      deleting: "Deleting...",
      error: "Error"
    };
  
    saveStatus.textContent =
      statusLabels[status] || "Ready";
  
    saveStatus.dataset.status = status;
  }
  
  let notificationTimer = null;
  
  function showNotification(message, type = "success") {
  const tone = type === "error" ? "error" : type === "warning" ? "warning" : "success";
  window.LANNotice?.({ title: "Experience", message, tone });
}
  
  /* =========================================================
     5. DYNAMIC RESPONSIBILITIES AND ACHIEVEMENTS
     ========================================================= */
  
  function createDynamicEntryRow(
    container,
    placeholder,
    value = ""
  ) {
    if (!container) {
      return;
    }
  
    const row = document.createElement("div");
  
    row.className = "dynamic-entry-row";
  
    const input = document.createElement("input");
  
    input.type = "text";
    input.className = "dynamic-entry-input";
    input.placeholder = placeholder;
    input.maxLength = 300;
    input.value = value;
  
    const removeButton =
      document.createElement("button");
  
    removeButton.type = "button";
    removeButton.className =
      "dynamic-entry-remove";
    removeButton.textContent = "Remove";
    removeButton.setAttribute(
      "aria-label",
      "Remove entry"
    );
  
    removeButton.addEventListener(
      "click",
      () => {
        const rows =
          container.querySelectorAll(
            ".dynamic-entry-row"
          );
  
        if (rows.length <= 1) {
          input.value = "";
        } else {
          row.remove();
        }
  
        markUnsaved();
      }
    );
  
    input.addEventListener(
      "input",
      markUnsaved
    );
  
    row.append(input, removeButton);
    container.appendChild(row);
  }
  
  function resetDynamicLists() {
    if (responsibilityList) {
      responsibilityList.innerHTML = "";
  
      createDynamicEntryRow(
        responsibilityList,
        "Enter a responsibility"
      );
    }
  
    if (achievementList) {
      achievementList.innerHTML = "";
  
      createDynamicEntryRow(
        achievementList,
        "Enter an achievement"
      );
    }
  }
  
  function getDynamicValues(container) {
    if (!container) {
      return [];
    }
  
    return Array.from(
      container.querySelectorAll(
        ".dynamic-entry-input"
      )
    )
      .map((input) => input.value.trim())
      .filter(Boolean);
  }
  
  /* =========================================================
     6. SUMMARY CHARACTER COUNT
     ========================================================= */
  
  function updateSummaryCount() {
    if (
      !experienceSummary ||
      !experienceSummaryCount
    ) {
      return;
    }
  
    experienceSummaryCount.textContent =
      `${experienceSummary.value.length} / 700`;
  }
  
  /* =========================================================
     7. CURRENTLY WORKING TOGGLE
     ========================================================= */
  
  function updateEndDateState() {
    if (
      !currentlyWorking ||
      !endMonth ||
      !endYear
    ) {
      return;
    }

    const isCurrent =
      currentlyWorking.checked;

    endMonth.disabled = isCurrent;
    endYear.disabled = isCurrent;

    if (isCurrent) {
      if (window.LANSetSelectValue) {
        window.LANSetSelectValue(endMonth, "", "");
        window.LANSetSelectValue(endYear, "", "");
      } else {
        endMonth.value = "";
        endYear.value = "";
      }
    }
  }
  
  /* =========================================================
     7B. SKILLS & TOOLS REFERENCES
     Existing library records are linked by Firestore document ID.
     ========================================================= */

  function uniqueCapabilityNames(values = []) {
    const seen = new Set();
    return (Array.isArray(values) ? values : String(values || "").split(","))
      .map((value) => String(value || "").trim())
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  async function getExperienceSkillServiceModule() {
    if (!experienceSkillServiceModule) {
      experienceSkillServiceModule = await import("../services/skillService.js");
    }
    return experienceSkillServiceModule;
  }

  async function loadExperienceSkillsLibrary() {
    try {
      const module = await getExperienceSkillServiceModule();
      const records = module?.SkillService?.getAll ? await module.SkillService.getAll() : [];
      experienceSkillsLibrary = (Array.isArray(records) ? records : [])
        .filter((record) => record?.name && record.active !== false)
        .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || String(a.name).localeCompare(String(b.name)));
    } catch (error) {
      console.warn("Experience Skills Library could not be loaded:", error);
      experienceSkillsLibrary = [];
    }
    syncExperienceCapabilityPickers();
  }

  function capabilitySource(kind) {
    const expectedType = kind === "tools" ? "tool" : "skill";
    return experienceSkillsLibrary.filter((record) => String(record.recordType || "skill").toLowerCase() === expectedType);
  }

  function selectedCapabilityIds(kind) {
    return kind === "skills" ? selectedExperienceSkillIds : selectedExperienceToolIds;
  }

  function selectedCapabilityRecords(kind) {
    const byId = new Map(capabilitySource(kind).map((item) => [String(item.id || ""), item]));
    return selectedCapabilityIds(kind).map((id) => byId.get(String(id || ""))).filter(Boolean);
  }

  function uniqueCapabilityIds(values = []) {
    return [...new Set((Array.isArray(values) ? values : String(values || "").split(","))
      .map((value) => String(value || "").trim())
      .filter(Boolean))];
  }

  function inferCapabilityIds(kind, names = []) {
    const wanted = new Set(uniqueCapabilityNames(names).map((value) => value.toLowerCase()));
    return capabilitySource(kind)
      .filter((item) => wanted.has(String(item.name || "").toLowerCase()))
      .map((item) => item.id);
  }

  function experienceCapabilityMeta(record = {}, kind = "skills") {
    const category = String(record.customCategory || record.category || (kind === "tools" ? "Tools Used" : "Capability"))
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return formatLabel(category);
  }

  function experienceToolIconSource(record = {}) {
    const resolved = window.LANResolveSkillIcon?.(record.name || "", record.category || "technology");
    const canonical = String(resolved?.src || "").trim();
    if (canonical) return canonical;
    const saved = String(record.icon || "").trim();
    return /^(?:data:image\/|https?:\/\/|\.?\.?\/|\/)/i.test(saved) ? saved : "";
  }

  function syncCapabilityFields(kind) {
    const ids = uniqueCapabilityIds(selectedCapabilityIds(kind));
    if (kind === "skills") selectedExperienceSkillIds = ids;
    else selectedExperienceToolIds = ids;
    const idField = getElement(kind === "skills" ? "skillIds" : "toolIds");
    const nameField = getElement(kind === "skills" ? "skillsUsed" : "toolsUsed");
    if (idField) idField.value = ids.join(",");
    if (nameField) nameField.value = selectedCapabilityRecords(kind).map((item) => item.name).join(", ");
  }

  function experiencePickerOptions(kind) {
    const isTool = kind === "tools";
    return {
      type: isTool ? "tool" : "skill",
      records: capabilitySource(kind),
      selectedIds: selectedCapabilityIds(kind),
      inputId: isTool ? "experienceToolSearch" : "experienceSkillSearch",
      placeholder: isTool ? "Search or add a Tool…" : "Search or add a Skill…",
      emptyTitle: `No matching ${isTool ? "Tool" : "Skill"} found.`,
      emptyHint: "Try another search.",
      compactAdd: true,
      dense: true,
      relationshipStyle: true,
      collapsedLimit: 6,
      addLabel: isTool ? "+ Link Tool" : "+ Link Skill",
      getIcon: isTool ? experienceToolIconSource : null,
      getMeta: (record) => experienceCapabilityMeta(record, kind),
      onChange(ids) {
        if (isTool) selectedExperienceToolIds = uniqueCapabilityIds(ids);
        else selectedExperienceSkillIds = uniqueCapabilityIds(ids);
        syncCapabilityFields(kind);
        markUnsaved();
      },
      async onCommit(value) {
        return commitExperienceCapabilitySearch(kind, value);
      }
    };
  }

  function syncExperienceCapabilityPickers() {
    if (experienceSkillPickerHost && typeof window.LANCreateCapabilityPicker === "function") {
      const options = experiencePickerOptions("skills");
      if (!experienceSkillPicker) experienceSkillPicker = window.LANCreateCapabilityPicker(experienceSkillPickerHost, options);
      else experienceSkillPicker.update(options);
    }
    if (experienceToolPickerHost && typeof window.LANCreateCapabilityPicker === "function") {
      const options = experiencePickerOptions("tools");
      if (!experienceToolPicker) experienceToolPicker = window.LANCreateCapabilityPicker(experienceToolPickerHost, options);
      else experienceToolPicker.update(options);
    }
    syncCapabilityFields("skills");
    syncCapabilityFields("tools");
  }

  function setExperienceCapabilities(kind, ids = [], legacyNames = []) {
    const valid = new Set(capabilitySource(kind).map((item) => String(item.id || "")));
    const normalizedIds = uniqueCapabilityIds(ids).filter((id) => valid.has(id));
    const resolvedIds = normalizedIds.length ? normalizedIds : inferCapabilityIds(kind, legacyNames);
    if (kind === "skills") selectedExperienceSkillIds = resolvedIds;
    else selectedExperienceToolIds = resolvedIds;
    syncCapabilityFields(kind);
    syncExperienceCapabilityPickers();
  }

  async function commitExperienceCapabilitySearch(kind, rawName) {
    const label = kind === "skills" ? "Skill" : "Tool";
    try {
      const module = await getExperienceSkillServiceModule();
      if (typeof module?.ensureCapabilityByName !== "function") {
        throw new Error("Skills & Tools quick entry is unavailable.");
      }
      const result = await module.ensureCapabilityByName(kind === "tools" ? "tool" : "skill", rawName);
      await loadExperienceSkillsLibrary();
      showNotification(
        result.created
          ? `${label} “${result.name || rawName}” added to the shared library and linked.`
          : `${label} “${result.name || rawName}” linked from the shared library.`,
        "success"
      );
      return result;
    } catch (error) {
      console.error(`Unable to add ${label}:`, error);
      showNotification(error.message || `Unable to add ${label}.`, "error");
      throw error;
    }
  }

  /* =========================================================
     8. FORM RESET
     ========================================================= */
  
  function resetExperienceForm() {
    if (!experienceForm) {
      return;
    }
  
    experienceForm.reset();
  
    if (experienceIdInput) {
      experienceIdInput.value = "";
    }
  
    if (deleteExperienceButton) {
      deleteExperienceButton.classList.add(
        "hidden"
      );
    }
  
    const statusInput =
      getElement("experienceStatus");
  
    const orderInput =
      getElement("displayOrder");
  
    const visibleInput =
      getElement("experienceVisible");
  
    if (statusInput) {
      statusInput.value = "draft";
    }
  
    if (orderInput) {
      orderInput.value = "0";
    }
  
    if (visibleInput) {
      visibleInput.checked = true;
    }

    if (publicCompanyDisplay) {
      publicCompanyDisplay.value = "full";
    }

    updateExperienceOtherFields();
  
    resetDynamicLists();
    setExperienceCapabilities("skills", []);
    setExperienceCapabilities("tools", []);
    experienceSkillPicker?.clearSearch();
    experienceToolPicker?.clearSearch();
    window.LANCloseActiveCapabilityPicker?.();
    updateSummaryCount();
    updateEndDateState();
    syncExperienceDateRules();
  
    hasUnsavedChanges = false;
  }
  
  /* =========================================================
     9. OPEN AND CLOSE FORM
     ========================================================= */
  
  function openExperienceForm(
    experience = null
  ) {
    if (!experienceForm) {
      return;
    }
  
    if (experience) {
      populateExperienceForm(experience);
    } else {
      resetExperienceForm();
    }
  
    experienceForm.classList.remove(
      "hidden"
    );
  
    if (experienceFormTitle) {
      experienceFormTitle.textContent =
        experience
          ? "Edit experience"
          : "Add experience";
    }
  
    if (saveExperienceButtonText) {
      saveExperienceButtonText.textContent =
        experience
          ? "Update Experience"
          : "Save Experience";
    }
  
    if (deleteExperienceButton) {
      deleteExperienceButton.classList.toggle(
        "hidden",
        !experience
      );
    }
  
    setManagerStatus("editing");
    renderExperienceList();
  
    experienceForm.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  
  function closeExperienceForm() {
    if (!experienceForm) {
      return;
    }
  
    experienceForm.classList.add(
      "hidden"
    );
  
    resetExperienceForm();
    renderExperienceList();
  
    hasUnsavedChanges = false;
    setManagerStatus("ready");
  }
  
  /* =========================================================
     10. COLLECT FORM DATA
     ========================================================= */
  
  function collectExperienceData() {
    const formData =
      new FormData(experienceForm);
  
    return {
      id: String(
        formData.get("experienceId") || ""
      ),
  
      jobTitle: String(
        formData.get("jobTitle") || ""
      ).trim(),
  
      company: String(
        formData.get("company") || ""
      ).trim(),

      publicCompanyDisplay: String(
        formData.get("publicCompanyDisplay") || "full"
      ),

      employmentType: String(
        formData.get("employmentType") || ""
      ),

      employmentTypeOther: String(
        formData.get("employmentTypeOther") || ""
      ).trim(),

      category: String(
        formData.get("experienceCategory") || ""
      ),

      categoryOther: String(
        formData.get("experienceCategoryOther") || ""
      ).trim(),

      workSetup: String(
        formData.get("workSetup") || ""
      ),

      workSetupOther: String(
        formData.get("workSetupOther") || ""
      ).trim(),
  
      location: String(
        formData.get("location") || ""
      ).trim(),
  
      startDate: combineMonthAndYear(
        startMonth,
        startYear
      ),

      endDate: currentlyWorking?.checked
        ? ""
        : combineMonthAndYear(
            endMonth,
            endYear
          ),
  
      isCurrent:
        currentlyWorking?.checked ?? false,
  
      summary: String(
        formData.get(
          "experienceSummary"
        ) || ""
      ).trim(),
  
      responsibilities:
        getDynamicValues(
          responsibilityList
        ),
  
      achievements:
        getDynamicValues(
          achievementList
        ),
  
      skillIds: uniqueCapabilityIds(formData.get("skillIds") || ""),
      toolIds: uniqueCapabilityIds(formData.get("toolIds") || ""),
      skills: selectedCapabilityRecords("skills").map((item) => item.name),
      tools: selectedCapabilityRecords("tools").map((item) => item.name),
  
      status: String(
        formData.get(
          "experienceStatus"
        ) || "draft"
      ),
  
      displayOrder: Number(
        formData.get("displayOrder") || 0
      ),
  
      featured:
        getElement(
          "featuredExperience"
        )?.checked ?? false,
  
      visible:
        getElement(
          "experienceVisible"
        )?.checked ?? true
    };
  }
  
  /* =========================================================
     11. POPULATE FORM
     ========================================================= */
  
  function setExperienceSelectValue(id, value, fallback = "") {
    const select = getElement(id);
    if (window.LANSetSelectValue) return window.LANSetSelectValue(select, value, fallback);
    if (!select) return false;
    const option = [...select.options].find((item) => item.value === String(value ?? ""));
    select.value = option?.value ?? fallback;
    return Boolean(option);
  }

  function populateExperienceForm(data) {
    if (!data) {
      return;
    }
  
    experienceIdInput.value =
      data.id || "";
  
    getElement("jobTitle").value =
      data.jobTitle || "";
  
    getElement("company").value =
      data.company || "";

    setExperienceSelectValue(
      "publicCompanyDisplay",
      data.publicCompanyDisplay || data.companyDisplayMode || "full",
      "full"
    );
  
    setExperienceSelectValue(
      "employmentType",
      data.employmentType || "",
      ""
    );
  
    setExperienceSelectValue(
      "experienceCategory",
      data.category || data.experienceCategory || "",
      ""
    );
  
    setExperienceSelectValue(
      "workSetup",
      data.workSetup || "",
      ""
    );

    if (employmentTypeOther) employmentTypeOther.value = data.employmentTypeOther || data.customEmploymentType || "";
    if (experienceCategoryOther) experienceCategoryOther.value = data.categoryOther || data.experienceCategoryOther || data.customCategory || "";
    if (workSetupOther) workSetupOther.value = data.workSetupOther || data.customWorkSetup || "";
    updateExperienceOtherFields();
  
    getElement("location").value =
      data.location || "";
  
    const startDateParts =
      splitMonthValue(
        data.startDate || ""
      );

    const endDateParts =
      splitMonthValue(
        data.endDate || ""
      );

    if (window.LANSetSelectValue) {
      window.LANSetSelectValue(startMonth, startDateParts.month, "");
      window.LANSetSelectValue(startYear, startDateParts.year, "");
      window.LANSetSelectValue(endMonth, endDateParts.month, "");
      window.LANSetSelectValue(endYear, endDateParts.year, "");
    } else {
      startMonth.value = startDateParts.month;
      startYear.value = startDateParts.year;
      endMonth.value = endDateParts.month;
      endYear.value = endDateParts.year;
    }
  
    currentlyWorking.checked =
      Boolean(
        data.isCurrent ??
        data.currentlyWorking
      );
  
    experienceSummary.value =
      data.summary ||
      data.experienceSummary ||
      "";
  
    setExperienceCapabilities(
      "skills",
      data.skillIds || [],
      Array.isArray(data.skills ?? data.skillsUsed) ? (data.skills ?? data.skillsUsed) : []
    );

    setExperienceCapabilities(
      "tools",
      data.toolIds || [],
      Array.isArray(data.tools ?? data.toolsUsed) ? (data.tools ?? data.toolsUsed) : []
    );
  
    setExperienceSelectValue("experienceStatus", data.status || "draft", "draft");
  
    getElement("displayOrder").value =
      Number(data.displayOrder || 0);
  
    getElement(
      "featuredExperience"
    ).checked =
      Boolean(data.featured);
  
    getElement(
      "experienceVisible"
    ).checked =
      data.visible !== false;
  
    responsibilityList.innerHTML = "";
    achievementList.innerHTML = "";
  
    const responsibilities =
      Array.isArray(data.responsibilities) &&
      data.responsibilities.length
        ? data.responsibilities
        : [""];
  
    const achievements =
      Array.isArray(data.achievements) &&
      data.achievements.length
        ? data.achievements
        : [""];
  
    responsibilities.forEach((item) => {
      createDynamicEntryRow(
        responsibilityList,
        "Enter a responsibility",
        item
      );
    });
  
    achievements.forEach((item) => {
      createDynamicEntryRow(
        achievementList,
        "Enter an achievement",
        item
      );
    });
  
    updateSummaryCount();
    updateEndDateState();
  
    hasUnsavedChanges = false;
  }
  
  /* =========================================================
     12. UNSAVED CHANGES
     ========================================================= */
  
  function markUnsaved() {
    hasUnsavedChanges = true;
    setManagerStatus("editing");
  }
  
  /* =========================================================
     13. BUTTON STATES
     ========================================================= */
  
  function setSaveButtonState(saving) {
    isSaving = saving;
  
    if (saveExperienceButton) {
      saveExperienceButton.disabled = saving;
    }
  
    if (saveExperienceButtonLoader) {
      saveExperienceButtonLoader.classList.toggle(
        "active",
        saving
      );
    }
  
    if (saveExperienceButtonText) {
      saveExperienceButtonText.textContent =
        saving
          ? "Saving..."
          : experienceIdInput?.value
            ? "Update Experience"
            : "Save Experience";
    }
  }
  
  function setDeleteButtonsState(deleting) {
    isDeleting = deleting;
  
    if (deleteExperienceButton) {
      deleteExperienceButton.disabled =
        deleting;
    }
  
    if (confirmDeleteButton) {
      confirmDeleteButton.disabled =
        deleting;
  
      confirmDeleteButton.textContent =
        deleting
          ? "Deleting..."
          : "Delete Permanently";
    }
  
    experienceList
      ?.querySelectorAll("[data-delete-id]")
      .forEach((button) => {
        button.disabled = deleting;
      });
  }
  
  /* =========================================================
     14. LOAD EXPERIENCES
     ========================================================= */
  
  async function refreshExperiences() {
    setManagerStatus("loading");
  
    try {
      experiences =
        await loadExperiences();
  
      renderExperienceList();
      setManagerStatus("ready");
    } catch (error) {
      console.error(
        "Experience loading failed:",
        error
      );
  
      experiences = [];
      renderExperienceList();
      setManagerStatus("error");
  
      showNotification(
        error.message ||
        "Unable to load experience entries.",
        "error"
      );
    }
  }
  
  /* =========================================================
     15. DELETE MODAL
     ========================================================= */
  
  function openDeleteModal(experienceId) {
    if (
      !experienceId ||
      !deleteConfirmationModal
    ) {
      return;
    }
  
    pendingDeleteId = experienceId;
  
    deleteConfirmationModal.classList.remove(
      "hidden"
    );
  
  
    confirmDeleteButton?.focus();
  }
  
  function closeDeleteModal() {
    pendingDeleteId = "";
  
    deleteConfirmationModal?.classList.add(
      "hidden"
    );
  
  }
  
  async function confirmExperienceDeletion() {
    if (
      !pendingDeleteId ||
      isDeleting
    ) {
      return;
    }
  
    const experienceId =
      pendingDeleteId;
  
    setDeleteButtonsState(true);
    setManagerStatus("deleting");
  
    try {
      await deleteExperience(
        experienceId
      );
  
      if (
        experienceIdInput?.value ===
        experienceId
      ) {
        closeExperienceForm();
      }
  
      closeDeleteModal();
  
      await refreshExperiences();
  
      showNotification(
        "Experience deleted successfully."
      );
    } catch (error) {
      console.error(
        "Experience deletion failed:",
        error
      );
  
      setManagerStatus("error");
  
      showNotification(
        error.message ||
        "Unable to delete the experience.",
        "error"
      );
    } finally {
      setDeleteButtonsState(false);
    }
  }
  
  async function runBulkExperienceUpdate(ids = [], changes = {}, successMessage = "Experience records updated.") {
    const cleanIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!cleanIds.length) return false;

    try {
      await updateManyExperiences(cleanIds, changes);
      await refreshExperiences();
      experienceList?.__lanRecordSelection?.clear();
      showNotification(successMessage);
      return true;
    } catch (error) {
      console.error("Bulk Experience update failed:", error);
      showNotification(error?.message || "Unable to update the selected experience records.", "error");
      return false;
    }
  }

  /* =========================================================
     16. RENDER EXPERIENCE LIST
     ========================================================= */
  

  function experienceModuleEmblem() { return `<span class="lan-card-emblem lan-card-emblem--experience" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><rect class="emblem-stroke" x="4" y="7" width="16" height="11" rx="2.4"/><path class="emblem-stroke" d="M9 7V5.8c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7"/><path class="emblem-stroke" d="M4 11.2h16"/><path class="emblem-stroke" d="M10 11.2v1.4h4v-1.4"/></svg></span>`; }

function experienceBrandInitials(value = "") {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean).filter((word) => !/^(of|the|and|for|inc|corp|ltd)$/i.test(word));
    const letters = words.slice(0, 4).map((word) => word[0]).join("").toUpperCase();
    return (letters || "ORG").slice(0, 4);
  }

  function renderExperienceList() {
    if (
      !experienceList ||
      !experienceEmptyState
    ) {
      return;
    }
  
    const searchTerm =
      experienceSearch?.value
        .trim()
        .toLowerCase() || "";
  
    const selectedStatus =
      statusFilter?.value || "all";
  
    const filteredExperiences =
      experiences.filter((experience) => {
        const searchableText = [
          experience.jobTitle,
          experience.company,
          experience.category,
          experience.employmentType,
          experience.workSetup,
          experience.location,
          ...(experience.skills || []),
          ...(experience.tools || [])
        ]
          .join(" ")
          .toLowerCase();
  
        const matchesSearch =
          searchableText.includes(
            searchTerm
          );
  
        const matchesStatus =
          selectedStatus === "all" ||
          experience.status ===
            selectedStatus;
  
        return (
          matchesSearch &&
          matchesStatus
        );
      });
  
    experienceList
      .querySelectorAll(
        ".experience-card"
      )
      .forEach((card) => card.remove());
  
    experienceEmptyState.classList.toggle(
      "hidden",
      filteredExperiences.length > 0
    );
  
    filteredExperiences.forEach(
      (experience) => {
        const card =
          document.createElement(
            "article"
          );
  
        card.className =
          "experience-card";
        card.dataset.experienceId = String(experience.id || "");
        card.dataset.lanRecordCard = "true";
        card.dataset.lanRecordFootprint = "content-rich";
        card.dataset.lanRecordFlow = "grid";
        card.dataset.lanRecordHasMedia = "false";
  
        const startLabel =
          formatMonth(
            experience.startDate
          );
  
        const endLabel =
          experience.isCurrent
            ? "Present"
            : formatMonth(
                experience.endDate
              );
  
        const workSetupLabel = experienceValueLabel(
          experience.workSetup,
          experience.workSetupOther,
          formatWorkSetup
        );

        const employmentTypeLabel = experienceValueLabel(
          experience.employmentType,
          experience.employmentTypeOther,
          formatEmploymentType
        );

        const categoryLabel = experienceValueLabel(
          experience.category,
          experience.categoryOther,
          formatExperienceCategory
        );

        const capabilityLabels = [...new Map([
          ...(Array.isArray(experience.skills) ? experience.skills : []),
          ...(Array.isArray(experience.tools) ? experience.tools : [])
        ]
          .map((label) => String(label || "").trim())
          .filter(Boolean)
          .map((label) => [label.toLocaleLowerCase(), label])).values()];

        const periodLabel = startLabel && endLabel
          ? `${startLabel} – ${endLabel}`
          : startLabel || endLabel || "";
  
        card.innerHTML = `
          <div class="experience-card-content" data-lan-record-content="true">
            <div class="experience-card-logo" aria-label="${escapeHtml(experience.company || "Experience")} emblem">${experienceModuleEmblem()}</div>
            <div class="experience-card-main">
            <div class="experience-card-title-row">
              <h3 class="experience-card-title" data-lan-record-identity="title">
                ${escapeHtml(experience.jobTitle)}
              </h3>
              <div class="experience-card-badges">
                <span class="experience-status ${escapeHtml(experience.status)}">${escapeHtml(formatLabel(experience.status))}</span>
                ${experience.featured ? '<span class="badge experience-featured-badge">Featured</span>' : ""}
                ${experience.linkedProjectId ? `<span class="badge experience-linked-badge" title="${escapeHtml(experience.linkedProjectTitle || "Linked Project")}" aria-label="Linked to Project${experience.linkedProjectTitle ? `: ${escapeHtml(experience.linkedProjectTitle)}` : ""}"><span>Linked</span></span>` : ""}
              </div>
            </div>

            <p class="experience-card-company" data-lan-record-identity="context">
              ${escapeHtml(experience.company)}
            </p>

            ${
              experience.summary
                ? `
                  <p class="experience-card-summary" data-lan-record-summary="true">
                    ${escapeHtml(experience.summary)}
                  </p>
                `
                : ""
            }

            <div class="experience-card-meta" data-lan-record-overflow-group="metadata">
              ${periodLabel ? `<span>${escapeHtml(periodLabel)}</span>` : ""}

              ${
                categoryLabel
                  ? `
                    <span>
                      ${escapeHtml(categoryLabel)}
                    </span>
                  `
                  : ""
              }

              ${
                employmentTypeLabel
                  ? `
                    <span>
                      ${escapeHtml(employmentTypeLabel)}
                    </span>
                  `
                  : ""
              }

              ${
                workSetupLabel
                  ? `
                    <span>
                      ${escapeHtml(workSetupLabel)}
                    </span>
                  `
                  : ""
              }

              ${
                experience.location
                  ? `
                    <span>
                      ${escapeHtml(experience.location)}
                    </span>
                  `
                  : ""
              }
            </div>

            ${
              capabilityLabels.length
                ? `
                  <div class="experience-card-capabilities" data-lan-record-overflow-group="capabilities">
                    ${capabilityLabels
                      .map((label) => `<span>${escapeHtml(label)}</span>`)
                      .join("")}
                  </div>
                `
                : ""
            }
            </div>
          </div>

          <div class="experience-card-actions" data-lan-record-actions="true">
            <button
              type="button"
              class="experience-edit-button editor-secondary-button button-compact"
              data-edit-id="${escapeHtml(experience.id)}"
            >
              Edit
            </button>

            <button
              type="button"
              class="experience-card-delete-button editor-danger-button button-compact"
              data-delete-id="${escapeHtml(experience.id)}"
            >
              Delete
            </button>
          </div>
        `;

        experienceList.appendChild(card);
      }
    );
  
    window.LANPinActiveRecordCard?.(experienceList, experienceIdInput?.value || "", {
      cardSelector: ".experience-card",
      idAttribute: "data-experience-id"
    });
    window.LANCreateRecordSelection?.(experienceList, {
      cardSelector: ".experience-card",
      idAttribute: "data-experience-id",
      actionSelector: ".experience-card-actions",
      label: "experience",
      records: experiences,
      capabilities: { publishing: true, featured: true, visibility: false, deletion: true },
      onBulkPatch: (ids, changes) => runBulkExperienceUpdate(
        ids,
        changes,
        `${ids.length} experience record${ids.length === 1 ? "" : "s"} updated.`
      ),
      onDelete: async (ids) => {
        for (const id of ids) await deleteExperience(id);
        if (ids.includes(experienceIdInput?.value || "")) closeExperienceForm();
        await refreshExperiences();
        showNotification(`${ids.length} experience record${ids.length === 1 ? "" : "s"} deleted.`);
      }
    })?.sync();

    updateStatistics();
  }
  
  /* =========================================================
     17. STATISTICS
     ========================================================= */
  
  function updateStatistics() {
    if (totalExperienceCount) {
      totalExperienceCount.textContent =
        experiences.length;
    }
  
    if (publishedExperienceCount) {
      publishedExperienceCount.textContent =
        experiences.filter(
          (experience) =>
            experience.status ===
            "published"
        ).length;
    }
  
    if (draftExperienceCount) {
      draftExperienceCount.textContent =
        experiences.filter(
          (experience) =>
            experience.status ===
            "draft"
        ).length;
    }
  }
  
  /* =========================================================
     18. FORM EVENTS
     ========================================================= */
  
  addExperienceButton?.addEventListener(
    "click",
    () => openExperienceForm()
  );
  
  emptyStateAddButton?.addEventListener(
    "click",
    () => openExperienceForm()
  );
  
  cancelExperienceButton?.addEventListener(
    "click",
    async () => {
      if (hasUnsavedChanges) {
        const confirmed = await window.LANConfirm({
          title: "Discard changes?",
          message: "Your unsaved Experience changes will be lost.",
          confirmLabel: "Discard changes",
          danger: true
        });
        if (!confirmed) return;
      }
      closeExperienceForm();
    }
  );
  
  experienceForm?.addEventListener(
    "input",
    (event) => {
      if (!event.target.closest?.("#experienceSkillSearch,#experienceToolSearch")) {
        markUnsaved();
      }
      updateSummaryCount();
    }
  );
  
  experienceForm?.addEventListener(
    "change",
    () => {
      markUnsaved();
      updateSummaryCount();
    }
  );
  
  currentlyWorking?.addEventListener(
    "change",
    () => {
      updateEndDateState();
      syncExperienceDateRules();
    }
  );

  [startMonth, startYear, endMonth, endYear].forEach((select) => {
    select?.addEventListener("change", syncExperienceDateRules);
  });
  
  addResponsibilityButton?.addEventListener(
    "click",
    () => {
      createDynamicEntryRow(
        responsibilityList,
        "Enter a responsibility"
      );
  
      markUnsaved();
    }
  );
  
  addAchievementButton?.addEventListener(
    "click",
    () => {
      createDynamicEntryRow(
        achievementList,
        "Enter an achievement"
      );
  
      markUnsaved();
    }
  );
  
  getElement("openSkillsToolsLibrary")?.addEventListener("click", () => {
    window.LANCloseActiveCapabilityPicker?.();
  });

  const refreshCapabilityLibraryOnReturn = () => {
    const now = Date.now();
    if (now - experienceCapabilityRefreshAt < 700) return;
    experienceCapabilityRefreshAt = now;
    void loadExperienceSkillsLibrary();
  };
  window.addEventListener("focus", refreshCapabilityLibraryOnReturn);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCapabilityLibraryOnReturn();
  });

  [employmentType, experienceCategory, workSetup].forEach((select) => {
    select?.addEventListener("change", () => {
      updateExperienceOtherFields();
      markUnsaved();
    });
  });

  publicCompanyDisplay?.addEventListener("change", markUnsaved);

  /* =========================================================
     19. SAVE OR UPDATE EXPERIENCE
     ========================================================= */
  
  const experienceRequiredFields = [
    ["jobTitle", "Job title"],
    ["company", "Company or organization"],
    ["employmentType", "Employment type"],
    ["experienceCategory", "Category"],
    ["workSetup", "Work setup"],
    ["startMonth", "Start month"],
    ["startYear", "Start year"],
    ["experienceSummary", "Experience summary"]
  ];

  function reportMissingExperienceFields() {
    const missingFields = experienceRequiredFields
      .map(([id, label]) => ({
        element: getElement(id),
        label
      }))
      .filter(({ element }) =>
        element &&
        !String(element.value || "").trim()
      );

    [
      [employmentType?.value === "other", employmentTypeOther, "Custom employment type"],
      [experienceCategory?.value === "other", experienceCategoryOther, "Custom category"],
      [workSetup?.value === "other", workSetupOther, "Custom work setup"]
    ].forEach(([required, element, label]) => {
      if (required && element && !String(element.value || "").trim()) {
        missingFields.push({ element, label });
      }
    });

    if (!currentlyWorking?.checked) {
      [
        ["endMonth", "End month"],
        ["endYear", "End year"]
      ].forEach(([id, label]) => {
        const element = getElement(id);
        if (
          element &&
          !String(element.value || "").trim()
        ) {
          missingFields.push({
            element,
            label
          });
        }
      });
    }

    if (!missingFields.length) {
      return true;
    }

    showNotification(
      `Complete the required Experience fields before saving: ${missingFields.map(({ label }) => label).join(", ")}.`,
      "warning"
    );

    const firstField =
      missingFields[0].element;

    firstField?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    firstField?.focus();

    return false;
  }

  saveExperienceButton?.addEventListener(
    "click",
    (event) => {
      if (
        isSaving ||
        reportMissingExperienceFields()
      ) {
        return;
      }

      event.preventDefault();
    }
  );

  experienceForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
  
      if (isSaving) {
        return;
      }
  
      if (window.LANValidateForm ? !window.LANValidateForm(experienceForm, { title: "Complete Experience" }) : !experienceForm.reportValidity()) {
        return;
      }
  
      const experienceData =
        collectExperienceData();

      const currentPeriod = currentExperiencePeriodNumber();
      const startPeriod = experiencePeriodNumber(experienceData.startDate);
      const endPeriod = experiencePeriodNumber(experienceData.endDate);

      if (startPeriod > currentPeriod) {
        showNotification(
          `The start date cannot be later than ${currentExperiencePeriodLabel()}.`,
          "error"
        );

        startMonth?.focus();
        return;
      }

      if (!experienceData.isCurrent && endPeriod > currentPeriod) {
        showNotification(
          `The end date cannot be later than ${currentExperiencePeriodLabel()}.`,
          "error"
        );

        endMonth?.focus();
        return;
      }
  
      if (
        !experienceData.isCurrent &&
        experienceData.endDate &&
        startPeriod > endPeriod
      ) {
        showNotification(
          "The end date cannot be earlier than the start date.",
          "error"
        );
  
        endMonth?.focus();
        return;
      }
  
      const experienceId =
        experienceData.id;
  
      delete experienceData.id;
  
      setSaveButtonState(true);
      setManagerStatus("saving");
  
      try {
        if (experienceId) {
          await updateExperience(
            experienceId,
            experienceData
          );
  
          showNotification(
            "Experience updated successfully."
          );
        } else {
          await createExperience(
            experienceData
          );
  
          showNotification(
            "Experience added successfully."
          );
        }
  
        hasUnsavedChanges = false;
  
        closeExperienceForm();
        await refreshExperiences();
  
        setManagerStatus("saved");
      } catch (error) {
        console.error(
          "Experience save failed:",
          error
        );
  
        setManagerStatus("error");
  
        showNotification(
          error.message ||
          "Unable to save the experience.",
          "error"
        );
      } finally {
        setSaveButtonState(false);
      }
    }
  );
  
  /* =========================================================
     20. EXPERIENCE LIST ACTIONS
     ========================================================= */
  
  experienceList?.addEventListener(
    "click",
    (event) => {
      const editButton =
        event.target.closest(
          "[data-edit-id]"
        );
  
      const deleteButton =
        event.target.closest(
          "[data-delete-id]"
        );
  
      if (editButton) {
        const experience =
          experiences.find(
            (item) =>
              item.id ===
              editButton.dataset.editId
          );
  
        if (experience) {
          openExperienceForm(
            experience
          );
        }
  
        return;
      }
  
      if (deleteButton) {
        openDeleteModal(
          deleteButton.dataset.deleteId
        );
      }
    }
  );
  
  deleteExperienceButton?.addEventListener(
    "click",
    () => {
      openDeleteModal(
        experienceIdInput?.value
      );
    }
  );
  
  /* =========================================================
     21. DELETE MODAL EVENTS
     ========================================================= */
  
  cancelDeleteButton?.addEventListener(
    "click",
    closeDeleteModal
  );
  
  confirmDeleteButton?.addEventListener(
    "click",
    confirmExperienceDeletion
  );
  
  deleteConfirmationModal?.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        deleteConfirmationModal
      ) {
        closeDeleteModal();
      }
    }
  );
  
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !deleteConfirmationModal
          ?.classList.contains("hidden")
      ) {
        closeDeleteModal();
      }
    }
  );
  
  /* =========================================================
     22. SEARCH AND FILTER
     ========================================================= */
  
  experienceSearch?.addEventListener(
    "input",
    renderExperienceList
  );
  
  statusFilter?.addEventListener(
    "change",
    renderExperienceList
  );
  
  /* =========================================================
     23. COMING-SOON LINKS
     ========================================================= */
  
  comingSoonLinks.forEach((link) => {
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
  
        showNotification(
          `${link.dataset.comingSoon} editor will be added next.`
        );
      }
    );
  });
  
  populateYearOptions();

  /* =========================================================
     24. CANONICAL ADMIN SESSION
     The persistent shell owns Authentication/Authorization.
     ========================================================= */

  try {
    await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin shell session bridge did not initialize.")));
    authenticationResolved = true;
    resetExperienceForm();
    loadExperienceSkillsLibrary();
    refreshExperiences();
  } catch (error) {
    authenticationResolved = true;
    console.error("Admin workspace session could not be consumed:", error);
    setManagerStatus("error");
    showNotification("Administrator session could not be verified.", "error");
  }

  /* =========================================================
     26. BEFORE-LEAVING WARNING
     ========================================================= */
  
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (
        !authenticationResolved ||
        !hasUnsavedChanges
      ) {
        return;
      }
  
      event.preventDefault();
      event.returnValue = "";
    }
  );
