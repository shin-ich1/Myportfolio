import {
  educationService
} from "../services/educationService.js";

const setSelectValue = (select, value, fallback = "") => {
  if (window.LANSetSelectValue) return window.LANSetSelectValue(select, value, fallback);
  if (!select) return false;
  const option = [...select.options].find((item) => item.value === String(value ?? ""));
  select.value = option?.value ?? fallback;
  return Boolean(option);
};

const state = {
  educationRecords: [],
  selectedEducationId: null,
  pendingDeleteEducationId: null,
  searchTerm: "",
  statusFilter: "all",
  sortFilter: "order",
  pendingSchoolLogoValue: "",
  schoolLogoSource: "none",
};

const elements = {
  addEducationButton:
    document.querySelector("#addEducationButton"),

  emptyStateAddEducationButton:
    document.querySelector("#emptyStateAddEducationButton"),

  educationForm:
    document.querySelector("#educationForm"),

  educationFormTitle:
    document.querySelector("#educationFormTitle"),

  educationId:
    document.querySelector("#educationId"),

  schoolName:
    document.querySelector("#schoolName"),

  degreeName:
    document.querySelector("#degreeName"),

  degreeShortName:
    document.querySelector("#degreeShortName"),

  majorName:
    document.querySelector("#majorName"),

  educationLevel:
    document.querySelector("#educationLevel"),

  educationLevelOtherField:
    document.querySelector("#educationLevelOtherField"),

  educationLevelOther:
    document.querySelector("#educationLevelOther"),

  educationLocation:
    document.querySelector("#educationLocation"),

  schoolWebsite:
    document.querySelector("#schoolWebsite"),

  startMonth:
    document.querySelector("#startMonth"),

  startYear:
    document.querySelector("#startYear"),

  endMonth:
    document.querySelector("#endMonth"),

  endYear:
    document.querySelector("#endYear"),

  currentlyStudying:
    document.querySelector("#currentlyStudying"),

  educationSummary:
    document.querySelector("#educationSummary"),

  educationSummaryCount:
    document.querySelector("#educationSummaryCount"),

  educationAchievementList:
    document.querySelector("#educationAchievementList"),

  addEducationAchievementButton:
    document.querySelector("#addEducationAchievementButton"),

  courseworkList:
    document.querySelector("#courseworkList"),

  addCourseworkButton:
    document.querySelector("#addCourseworkButton"),

  schoolLogoUrl:
    document.querySelector("#schoolLogoUrl"),

  schoolLogoFile:
    document.querySelector("#schoolLogoFile"),

  uploadSchoolLogoButton:
    document.querySelector("#uploadSchoolLogoButton"),

  replaceSchoolLogoButton:
    document.querySelector("#replaceSchoolLogoButton"),

  schoolLogoStatus:
    document.querySelector("#schoolLogoStatus"),

  schoolLogoPreview:
    document.querySelector("#schoolLogoPreview"),

  schoolLogoPlaceholder:
    document.querySelector("#schoolLogoPlaceholder"),

  previewSchoolLogoButton:
    document.querySelector("#previewSchoolLogoButton"),

  removeSchoolLogoButton:
    document.querySelector("#removeSchoolLogoButton"),

  educationStatus:
    document.querySelector("#educationStatus"),

  educationDisplayOrder:
    document.querySelector("#educationDisplayOrder"),

  featuredEducation:
    document.querySelector("#featuredEducation"),

  educationVisible:
    document.querySelector("#educationVisible"),

  saveEducationButton:
    document.querySelector("#saveEducationButton"),

  saveEducationButtonText:
    document.querySelector("#saveEducationButtonText"),

  saveEducationButtonLoader:
    document.querySelector("#saveEducationButtonLoader"),

  cancelEducationButton:
    document.querySelector("#cancelEducationButton"),

  deleteEducationButton:
    document.querySelector("#deleteEducationButton"),

  educationList:
    document.querySelector("#educationList"),

  educationEmptyState:
    document.querySelector("#educationEmptyState"),

  educationSearch:
    document.querySelector("#educationSearch"),

  educationStatusFilter:
    document.querySelector("#educationStatusFilter"),

  educationSortFilter:
    document.querySelector("#educationSortFilter"),

  totalEducationCount:
    document.querySelector("#totalEducationCount"),

  publishedEducationCount:
    document.querySelector("#publishedEducationCount"),

  draftEducationCount:
    document.querySelector("#draftEducationCount"),

  featuredEducationCount:
    document.querySelector("#featuredEducationCount"),

  saveStatus:
    document.querySelector("#saveStatus"),

  notification:
    document.querySelector("#notification"),

  notificationMessage:
    document.querySelector("#notificationMessage"),

  deleteEducationConfirmationModal:
    document.querySelector("#deleteEducationConfirmationModal"),

  cancelDeleteEducationButton:
    document.querySelector("#cancelDeleteEducationButton"),

  confirmDeleteEducationButton:
    document.querySelector("#confirmDeleteEducationButton"),

  logoutButton:
    document.querySelector("#logoutButton"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showNotification(message, type = "success") {
  const tone = type === "error" ? "error" : type === "warning" ? "warning" : "success";
  window.LANNotice?.({ title: "Education", message, tone });
}

function updateSaveStatus(message) {
  elements.saveStatus.textContent = message;
}

function setSavingState(isSaving) {
  elements.saveEducationButton.disabled = isSaving;

  elements.saveEducationButtonLoader?.classList.toggle(
    "visible",
    isSaving
  );

  elements.saveEducationButtonText.textContent = isSaving
    ? "Saving..."
    : state.selectedEducationId
      ? "Update Education"
      : "Save Education";
}

function populateYearOptions() {
  const currentYear = new Date().getFullYear();
  const firstYear = 1950;

  [elements.startYear, elements.endYear].forEach((selectElement) => {
    const originalValue = selectElement.value;

    selectElement.innerHTML = `
      <option value="">
        Select year
      </option>
    `;

    for (let year = currentYear; year >= firstYear; year -= 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      selectElement.appendChild(option);
    }

    selectElement.value = originalValue;
  });
}

function createDynamicEntryRow(value = "", placeholder = "") {
  const row = document.createElement("div");
  row.className = "dynamic-entry-row";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 220;
  input.placeholder = placeholder;
  input.value = value;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "dynamic-entry-remove";
  removeButton.textContent = "Remove";

  removeButton.addEventListener("click", () => {
    row.remove();
  });

  row.append(input, removeButton);
  return row;
}

function addAchievement(value = "") {
  elements.educationAchievementList.appendChild(
    createDynamicEntryRow(
      value,
      "Public Relations Officer for the BSIT department"
    )
  );
}

function addCoursework(value = "") {
  elements.courseworkList.appendChild(
    createDynamicEntryRow(
      value,
      "Database Management"
    )
  );
}

function collectDynamicEntries(container) {
  return Array.from(
    container.querySelectorAll("input")
  )
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function updateSummaryCount() {
  const currentLength =
    elements.educationSummary.value.length;

  elements.educationSummaryCount.textContent =
    `${currentLength} / 700`;
}

function updateCurrentlyStudyingState() {
  const isCurrentlyStudying =
    elements.currentlyStudying.checked;

  elements.endMonth.disabled = isCurrentlyStudying;
  elements.endYear.disabled = isCurrentlyStudying;

  if (isCurrentlyStudying) {
    setSelectValue(elements.endMonth, "", "");
    setSelectValue(elements.endYear, "", "");
  }
}

function setSchoolLogoStatus(message, type = "") {
  elements.schoolLogoStatus.textContent = message;
  elements.schoolLogoStatus.classList.remove("success", "error");

  if (type) {
    elements.schoolLogoStatus.classList.add(type);
  }
}

function setSchoolLogoActionState(hasLogo) {
  elements.uploadSchoolLogoButton.classList.toggle(
    "hidden",
    hasLogo
  );

  elements.replaceSchoolLogoButton.classList.toggle(
    "hidden",
    !hasLogo
  );
}

function clearSchoolLogoPreview() {
  elements.schoolLogoPreview.onload = null;
  elements.schoolLogoPreview.onerror = null;
  elements.schoolLogoPreview.removeAttribute("src");
  elements.schoolLogoPreview.hidden = true;
  elements.schoolLogoPlaceholder.hidden = false;
  const previewStage = document.querySelector("#schoolLogoPreviewStage");
  if (previewStage) previewStage.hidden = true;
  setSchoolLogoActionState(false);
}

function setSchoolLogoPreview(url, source = "url") {
  const cleanedUrl = String(url || "").trim();

  if (!cleanedUrl) {
    clearSchoolLogoPreview();
    setSchoolLogoStatus("No logo has been selected.");
    return;
  }

  elements.schoolLogoPreview.hidden = true;
  elements.schoolLogoPlaceholder.hidden = false;
  const pendingPreviewStage = document.querySelector("#schoolLogoPreviewStage");
  if (pendingPreviewStage) pendingPreviewStage.hidden = true;

  elements.schoolLogoPreview.onload = () => {
    elements.schoolLogoPreview.hidden = false;
    elements.schoolLogoPlaceholder.hidden = true;
    const previewStage = document.querySelector("#schoolLogoPreviewStage");
    if (previewStage) previewStage.hidden = false;
    setSchoolLogoActionState(true);

    setSchoolLogoStatus(
      source === "upload"
        ? "Uploaded logo is ready and will be saved with this record."
        : "Logo URL loaded successfully.",
      "success"
    );
  };

  elements.schoolLogoPreview.onerror = () => {
    state.pendingSchoolLogoValue = "";
    state.schoolLogoSource = "none";
    clearSchoolLogoPreview();

    setSchoolLogoStatus(
      "The selected logo could not be loaded.",
      "error"
    );
  };

  elements.schoolLogoPreview.src = cleanedUrl;
}

const EDUCATION_LEVEL_LABELS = Object.freeze({
  preschool: "Preschool / Kindergarten",
  elementary: "Elementary / Primary School (Grades 1–6)",
  "junior-high": "Junior High / Secondary School (Grades 7–10)",
  "senior-high": "Senior High School (Grades 11–12)",
  associate: "Associate Degree",
  college: "Bachelor’s Degree",
  masters: "Master’s Degree",
  doctoral: "Doctoral Degree",
  postgraduate: "Postgraduate / Graduate Study (Other)",
  vocational: "Vocational / Technical",
  certification: "Certification Program",
  "high-school": "High School / Secondary School",
});

function educationLevelLabel(education = {}) {
  if (education.educationLevel === "other") {
    return education.educationLevelOther || "Other";
  }
  return EDUCATION_LEVEL_LABELS[education.educationLevel] || education.educationLevel || "";
}

function updateEducationLevelOtherState() {
  const usesCustomLevel = elements.educationLevel.value === "other";
  elements.educationLevelOtherField.classList.toggle("hidden", !usesCustomLevel);
  elements.educationLevelOther.required = usesCustomLevel;
  elements.educationLevelOther.disabled = !usesCustomLevel;
  if (!usesCustomLevel) elements.educationLevelOther.value = "";
}

function resetEducationForm() {
  elements.educationForm.reset();

  state.selectedEducationId = null;

  elements.educationId.value = "";
  elements.educationFormTitle.textContent = "Add education";
  elements.educationStatus.value = "draft";
  elements.educationDisplayOrder.value = "0";
  elements.educationVisible.checked = true;

  state.pendingSchoolLogoValue = "";
  state.schoolLogoSource = "none";
  elements.schoolLogoFile.value = "";
  elements.schoolLogoUrl.value = "";

  elements.educationAchievementList.innerHTML = "";
  elements.courseworkList.innerHTML = "";

  addAchievement();
  addCoursework();

  elements.deleteEducationButton.classList.add("hidden");

  updateSummaryCount();
  updateCurrentlyStudyingState();
  updateEducationLevelOtherState();
  setSchoolLogoPreview("");

  elements.saveEducationButtonText.textContent =
    "Save Education";
}

function showEducationForm() {
  elements.educationForm.classList.remove("hidden");

  window.setTimeout(() => {
    elements.schoolName.focus();
  }, 100);

  elements.educationForm.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function hideEducationForm() {
  elements.educationForm.classList.add("hidden");
  resetEducationForm();
  renderEducationRecords();
  updateSaveStatus("Ready");
}

function openCreateEducationForm() {
  resetEducationForm();
  showEducationForm();
  updateSaveStatus("Adding education");
}

async function openEditEducationForm(educationId) {
  const education =
    await educationService.getEducationById(educationId);

  if (!education) {
    showNotification(
      "Education record could not be found.",
      "error"
    );

    return;
  }

  resetEducationForm();

  state.selectedEducationId = education.id;

  elements.educationId.value = education.id;
  elements.schoolName.value = education.schoolName;
  elements.degreeName.value = education.degreeName;
  elements.degreeShortName.value = education.degreeShortName || "";
  elements.majorName.value = education.majorName;
  setSelectValue(
    elements.educationLevel,
    education.educationLevel === "high-school" ? "junior-high" : education.educationLevel,
    education.educationLevelOther ? "other" : ""
  );
  elements.educationLevelOther.value = education.educationLevelOther || "";
  updateEducationLevelOtherState();
  if (elements.educationLevel.value === "other") {
    elements.educationLevelOther.value = education.educationLevelOther || "";
  }
  elements.educationLocation.value =
    education.educationLocation;
  elements.schoolWebsite.value = education.schoolWebsite;

  setSelectValue(elements.startMonth, education.startMonth, "");
  setSelectValue(elements.startYear, education.startYear, "");
  setSelectValue(elements.endMonth, education.endMonth, "");
  setSelectValue(elements.endYear, education.endYear, "");
  elements.currentlyStudying.checked =
    education.currentlyStudying;

  elements.educationSummary.value =
    education.educationSummary;

  elements.educationAchievementList.innerHTML = "";
  elements.courseworkList.innerHTML = "";

  if (education.achievements.length > 0) {
    education.achievements.forEach(addAchievement);
  } else {
    addAchievement();
  }

  if (education.coursework.length > 0) {
    education.coursework.forEach(addCoursework);
  } else {
    addCoursework();
  }

  state.pendingSchoolLogoValue =
    education.schoolLogoUrl;

  state.schoolLogoSource =
    education.schoolLogoUrl ? "saved" : "none";

  elements.schoolLogoUrl.value =
    education.schoolLogoUrl &&
    !education.schoolLogoUrl.startsWith("data:")
      ? education.schoolLogoUrl
      : "";

  setSchoolLogoPreview(
    education.schoolLogoUrl,
    education.schoolLogoUrl?.startsWith("data:")
      ? "upload"
      : "url"
  );

  setSelectValue(
    elements.educationStatus,
    education.educationStatus || education.status,
    "draft"
  );

  elements.educationDisplayOrder.value =
    String(education.educationDisplayOrder);

  elements.featuredEducation.checked =
    education.featuredEducation;

  elements.educationVisible.checked =
    education.educationVisible;

  elements.educationFormTitle.textContent =
    "Edit education";

  elements.saveEducationButtonText.textContent =
    "Update Education";

  elements.deleteEducationButton.classList.remove("hidden");

  updateSummaryCount();
  updateCurrentlyStudyingState();
  renderEducationRecords();
  showEducationForm();
  updateSaveStatus("Editing education");
}

function validateEducationForm() {
  if (!elements.schoolName.value.trim()) {
    showNotification(
      "Please enter the school or institution.",
      "error"
    );

    elements.schoolName.focus();
    return false;
  }

  if (!elements.degreeName.value.trim()) {
    showNotification(
      "Please enter the degree or qualification.",
      "error"
    );

    elements.degreeName.focus();
    return false;
  }

  if (!elements.educationLevel.value) {
    showNotification(
      "Please select the education level.",
      "error"
    );

    elements.educationLevel.focus();
    return false;
  }

  if (
    elements.educationLevel.value === "other" &&
    !elements.educationLevelOther.value.trim()
  ) {
    showNotification(
      "Please enter the custom education level.",
      "error"
    );

    elements.educationLevelOther.focus();
    return false;
  }

  if (!elements.startYear.value) {
    showNotification(
      "Please select the start year.",
      "error"
    );

    elements.startYear.focus();
    return false;
  }

  if (!elements.currentlyStudying.checked) {
    const startYear = Number(elements.startYear.value);
    const endYear = Number(elements.endYear.value);

    if (
      elements.endYear.value &&
      endYear < startYear
    ) {
      showNotification(
        "End year cannot be earlier than the start year.",
        "error"
      );

      elements.endYear.focus();
      return false;
    }
  }

  if (!elements.educationSummary.value.trim()) {
    showNotification(
      "Please enter the education summary.",
      "error"
    );

    elements.educationSummary.focus();
    return false;
  }

  return true;
}

function collectEducationPayload() {
  return {
    schoolName:
      elements.schoolName.value.trim(),

    degreeName:
      elements.degreeName.value.trim(),

    degreeShortName:
      elements.degreeShortName.value.trim(),

    majorName:
      elements.majorName.value.trim(),

    educationLevel:
      elements.educationLevel.value,

    educationLevelOther:
      elements.educationLevel.value === "other"
        ? elements.educationLevelOther.value.trim()
        : "",

    educationLocation:
      elements.educationLocation.value.trim(),

    schoolWebsite:
      elements.schoolWebsite.value.trim(),

    startMonth:
      elements.startMonth.value,

    startYear:
      elements.startYear.value,

    endMonth:
      elements.currentlyStudying.checked
        ? ""
        : elements.endMonth.value,

    endYear:
      elements.currentlyStudying.checked
        ? ""
        : elements.endYear.value,

    currentlyStudying:
      elements.currentlyStudying.checked,

    educationSummary:
      elements.educationSummary.value.trim(),

    achievements:
      collectDynamicEntries(
        elements.educationAchievementList
      ),

    coursework:
      collectDynamicEntries(
        elements.courseworkList
      ),

    schoolLogoUrl:
      state.pendingSchoolLogoValue ||
      elements.schoolLogoUrl.value.trim(),

    educationStatus:
      elements.educationStatus.value,

    educationDisplayOrder:
      Number(elements.educationDisplayOrder.value || 0),

    featuredEducation:
      elements.featuredEducation.checked,

    educationVisible:
      elements.educationVisible.checked,
  };
}

function formatEducationPeriod(education) {
  if (education.currentlyStudying) {
    return `${education.startYear} – Present`;
  }

  if (!education.endYear) {
    return education.startYear;
  }

  if (education.startYear === education.endYear) {
    return education.startYear;
  }

  return `${education.startYear} – ${education.endYear}`;
}

function getFilteredEducationRecords() {
  const normalizedSearch =
    state.searchTerm.trim().toLowerCase();

  const filteredRecords =
    state.educationRecords.filter((education) => {
      const matchesStatus =
        state.statusFilter === "all" ||
        education.educationStatus ===
          state.statusFilter;

      const searchableText = [
        education.schoolName,
        education.degreeName,
        education.degreeShortName,
        education.majorName,
        education.educationLocation,
        education.educationSummary,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !normalizedSearch ||
        searchableText.includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });

  return [...filteredRecords].sort((first, second) => {
    if (state.sortFilter === "newest") {
      return (
        new Date(second.createdAt) -
        new Date(first.createdAt)
      );
    }

    if (state.sortFilter === "school") {
      return first.schoolName.localeCompare(
        second.schoolName
      );
    }

    if (state.sortFilter === "graduation") {
      const firstYear = Number(
        first.endYear ||
        new Date().getFullYear() + 1
      );

      const secondYear = Number(
        second.endYear ||
        new Date().getFullYear() + 1
      );

      return secondYear - firstYear;
    }

    return (
      Number(first.educationDisplayOrder) -
        Number(second.educationDisplayOrder) ||
      first.schoolName.localeCompare(second.schoolName)
    );
  });
}

function normalizeEducationIdentityPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getDisplayEducationRecords(records = state.educationRecords) {
  const seen = new Set();

  return records.filter((education) => {
    const identity = [
      education.schoolName,
      education.degreeName,
      education.majorName,
      education.startMonth,
      education.startYear,
      education.currentlyStudying ? "current" : education.endMonth,
      education.currentlyStudying ? "current" : education.endYear,
    ]
      .map(normalizeEducationIdentityPart)
      .join("|");

    if (seen.has(identity)) {
      return false;
    }

    seen.add(identity);
    return true;
  });
}

function renderEducationStatistics() {
  const visibleRecords = getDisplayEducationRecords();

  elements.totalEducationCount.textContent =
    String(visibleRecords.length);

  elements.publishedEducationCount.textContent =
    String(
      visibleRecords.filter(
        (education) =>
          education.educationStatus === "published"
      ).length
    );

  elements.draftEducationCount.textContent =
    String(
      visibleRecords.filter(
        (education) =>
          education.educationStatus === "draft"
      ).length
    );

  elements.featuredEducationCount.textContent =
    String(
      visibleRecords.filter(
        (education) =>
          education.featuredEducation
      ).length
    );
}

function educationModuleEmblem() { return `<span class="lan-card-emblem lan-card-emblem--education" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><path class="emblem-fill" d="M12 4 2.9 8.4 12 12.8 21.1 8.4 12 4Z"/><path class="emblem-stroke" d="M6.1 10.1V14c0 .9 2.7 2.5 5.9 2.5s5.9-1.6 5.9-2.5v-3.9"/><path class="emblem-stroke" d="M21.1 8.4v5.2"/></svg></span>`; }

function createEducationCard(education) {
  const article = document.createElement("article");
  article.className = "education-card";
  article.dataset.educationId = education.id;
  article.dataset.lanRecordCard = "true";
  article.dataset.lanRecordFootprint = "content-compact";
  article.dataset.lanRecordFlow = "grid";
  article.dataset.lanRecordHasMedia = "false";

  const logoContent = education.schoolLogoUrl
    ? `
      <img
        src="${escapeHtml(education.schoolLogoUrl)}"
        alt="${escapeHtml(education.schoolName)} logo"
      >
    `
    : `${educationModuleEmblem()}`;

  const featuredBadge = education.featuredEducation
    ? `
      <span class="badge education-featured-badge">
        Featured
      </span>
    `
    : "";

  article.innerHTML = `
    <div class="education-card-content" data-lan-record-content="true">
      <div class="education-card-logo">
        ${logoContent}
      </div>

      <div class="education-card-main">
      <div class="education-card-title-row">
        <h3 class="education-card-title" data-lan-record-identity="title">
          ${escapeHtml(education.degreeName)}
        </h3>

        <div class="education-card-badges">
          <span
            class="education-status ${escapeHtml(
              education.educationStatus
            )}"
          >
            ${escapeHtml(String(education.educationStatus || "draft").replace(/^./, (character) => character.toUpperCase()))}
          </span>
          ${featuredBadge}
        </div>
      </div>

      <p class="education-card-school" data-lan-record-identity="context">
        ${escapeHtml(education.schoolName)}
        ${
          education.majorName
            ? ` · ${escapeHtml(education.majorName)}`
            : ""
        }
      </p>

      ${educationLevelLabel(education) ? `<p class="education-card-level" data-lan-record-identity="context">${escapeHtml(educationLevelLabel(education))}</p>` : ""}

      ${education.educationSummary ? `<p class="education-card-summary" data-lan-record-summary="true">${escapeHtml(education.educationSummary)}</p>` : ""}

      <div class="education-card-meta" data-lan-record-overflow-group="metadata">
        <span>
          ${escapeHtml(formatEducationPeriod(education))}
        </span>

        ${
          education.educationLocation
            ? `
              <span>
                ${escapeHtml(education.educationLocation)}
              </span>
            `
            : ""
        }

        <span>
          Order ${escapeHtml(
            education.educationDisplayOrder
          )}
        </span>

        ${
          education.achievements.length > 0
            ? `
              <span>
                ${education.achievements.length}
                achievement${education.achievements.length === 1 ? "" : "s"}
              </span>
            `
            : ""
        }
      </div>
      </div>
    </div>

    <div class="education-card-actions" data-lan-record-actions="true">
      <button
        class="education-duplicate-button editor-secondary-button button-compact"
        type="button"
        data-action="duplicate"
      >
        Duplicate
      </button>

      <button
        class="education-edit-button editor-secondary-button button-compact"
        type="button"
        data-action="edit"
      >
        Edit
      </button>

      <button
        class="education-card-delete-button editor-danger-button button-compact"
        type="button"
        data-action="delete"
      >
        Delete
      </button>
    </div>
  `;

  return article;
}

function renderEducationRecords() {
  const filteredEducation =
    getDisplayEducationRecords(getFilteredEducationRecords());

  elements.educationList.innerHTML = "";

  if (filteredEducation.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "education-empty-state";

    emptyState.innerHTML = `
      <span class="education-empty-icon">
        ◇
      </span>

      <h3>
        ${
          state.educationRecords.length === 0
            ? "No education entries yet"
            : "No matching education found"
        }
      </h3>

      <p>
        ${
          state.educationRecords.length === 0
            ? "Add your first academic record to begin building your portfolio education timeline."
            : "Try changing the search text, status filter or sorting option."
        }
      </p>

      ${
        state.educationRecords.length === 0
          ? `
            <button
              class="editor-preview-button"
              id="renderedEmptyAddButton"
              type="button"
            >
              Add First Education
            </button>
          `
          : ""
      }
    `;

    elements.educationList.appendChild(emptyState);

    const renderedEmptyAddButton =
      document.querySelector("#renderedEmptyAddButton");

    renderedEmptyAddButton?.addEventListener(
      "click",
      openCreateEducationForm
    );
    elements.educationList.__lanRecordSelection?.sync();

    return;
  }

  filteredEducation.forEach((education) => {
    elements.educationList.appendChild(
      createEducationCard(education)
    );
  });

  window.LANPinActiveRecordCard?.(elements.educationList, state.selectedEducationId || "", {
    cardSelector: ".education-card",
    idAttribute: "data-education-id"
  });
  window.LANCreateRecordSelection?.(elements.educationList, {
    cardSelector: ".education-card",
    idAttribute: "data-education-id",
    actionSelector: ".education-card-actions",
    label: "education record",
    records: state.educationRecords,
    capabilities: { publishing: true, featured: true, visibility: false, deletion: true },
    onBulkPatch: async (ids, changes) => {
      await educationService.updateManyEducationRecords(ids, changes);
      await loadEducationRecords();
      showNotification(`${ids.length} education record${ids.length === 1 ? "" : "s"} updated.`);
    },
    onDelete: async (ids) => {
      for (const id of ids) await educationService.deleteEducation(id);
      if (state.selectedEducationId && ids.includes(state.selectedEducationId)) hideEducationForm();
      await loadEducationRecords();
      showNotification(`${ids.length} education record${ids.length === 1 ? "" : "s"} deleted.`);
    }
  })?.sync();
}

function renderEducationManager() {
  renderEducationStatistics();
  renderEducationRecords();
}

async function loadEducationRecords() {
  try {
    state.educationRecords =
      await educationService.getEducationRecords();

    renderEducationManager();
  } catch (error) {
    console.error(error);

    showNotification(
      "Unable to load education records.",
      "error"
    );
  }
}

async function handleEducationSubmit(event) {
  event.preventDefault();

  if (window.LANValidateForm ? !window.LANValidateForm(elements.educationForm, { title: "Complete Education" }) : !elements.educationForm.reportValidity()) {
    return;
  }

  if (!validateEducationForm()) {
    return;
  }

  const payload = collectEducationPayload();

  setSavingState(true);
  updateSaveStatus("Saving");

  try {
    if (state.selectedEducationId) {
      await educationService.updateEducation(
        state.selectedEducationId,
        payload
      );

      showNotification(
        "Education updated successfully."
      );
    } else {
      await educationService.createEducation(payload);

      showNotification(
        "Education added successfully."
      );
    }

    await loadEducationRecords();
    hideEducationForm();
  } catch (error) {
    console.error(error);

    showNotification(
      error.message || "Unable to save education.",
      "error"
    );

    updateSaveStatus("Error");
  } finally {
    setSavingState(false);
  }
}

function openDeleteEducationModal(educationId) {
  state.pendingDeleteEducationId = educationId;

  elements.deleteEducationConfirmationModal.classList.remove(
    "hidden"
  );
}

function closeDeleteEducationModal() {
  state.pendingDeleteEducationId = null;

  elements.deleteEducationConfirmationModal.classList.add(
    "hidden"
  );
}

async function confirmDeleteEducation() {
  if (!state.pendingDeleteEducationId) {
    return;
  }

  try {
    await educationService.deleteEducation(
      state.pendingDeleteEducationId
    );

    await loadEducationRecords();

    if (
      state.selectedEducationId ===
      state.pendingDeleteEducationId
    ) {
      hideEducationForm();
    }

    closeDeleteEducationModal();

    showNotification(
      "Education deleted permanently."
    );
  } catch (error) {
    console.error(error);

    showNotification(
      error.message || "Unable to delete education.",
      "error"
    );
  }
}

async function duplicateEducation(educationId) {
  try {
    await educationService.duplicateEducation(
      educationId
    );

    await loadEducationRecords();

    showNotification(
      "Draft copy created successfully."
    );
  } catch (error) {
    console.error(error);

    showNotification(
      error.message || "Unable to duplicate education.",
      "error"
    );
  }
}

function handleEducationListClick(event) {
  const actionButton =
    event.target.closest("[data-action]");

  if (!actionButton) {
    return;
  }

  const educationCard =
    actionButton.closest("[data-education-id]");

  const educationId =
    educationCard?.dataset.educationId;

  if (!educationId) {
    return;
  }

  const action = actionButton.dataset.action;

  if (action === "edit") {
    openEditEducationForm(educationId);
  }

  if (action === "duplicate") {
    duplicateEducation(educationId);
  }

  if (action === "delete") {
    openDeleteEducationModal(educationId);
  }
}

function openSchoolLogoPicker() {
  elements.schoolLogoFile.click();
}

function handleSchoolLogoFile(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  const acceptedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
  ];

  if (!acceptedTypes.includes(file.type)) {
    elements.schoolLogoFile.value = "";

    showNotification(
      "Please select a PNG, JPG, WEBP or SVG image.",
      "error"
    );

    return;
  }

  const maximumFileSize = 1.5 * 1024 * 1024;

  if (file.size > maximumFileSize) {
    elements.schoolLogoFile.value = "";

    showNotification(
      "School logo must be 1.5 MB or smaller.",
      "error"
    );

    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    state.pendingSchoolLogoValue =
      String(reader.result || "");

    state.schoolLogoSource = "upload";
    elements.schoolLogoUrl.value = "";

    setSchoolLogoPreview(
      state.pendingSchoolLogoValue,
      "upload"
    );
  };

  reader.onerror = () => {
    showNotification(
      "The school logo could not be read.",
      "error"
    );
  };

  reader.readAsDataURL(file);
}

function previewSchoolLogo() {
  const schoolLogoUrl =
    elements.schoolLogoUrl.value.trim();

  if (!schoolLogoUrl) {
    showNotification(
      "Paste a school logo URL first.",
      "error"
    );

    return;
  }

  state.pendingSchoolLogoValue = schoolLogoUrl;
  state.schoolLogoSource = "url";

  setSchoolLogoPreview(schoolLogoUrl, "url");
}

function removeSchoolLogo() {
  state.pendingSchoolLogoValue = "";
  state.schoolLogoSource = "none";

  elements.schoolLogoFile.value = "";
  elements.schoolLogoUrl.value = "";

  clearSchoolLogoPreview();
  setSchoolLogoStatus("No logo has been selected.");
}

function handleComingSoonNavigation(event) {
  const comingSoonLink =
    event.target.closest("[data-coming-soon]");

  if (!comingSoonLink) {
    return;
  }

  event.preventDefault();

  showNotification(
    `${comingSoonLink.dataset.comingSoon} CMS is coming next.`
  );
}

function handleLogout() {
  window.location.href = "../index.html";
}

function bindEducationEvents() {
  elements.addEducationButton.addEventListener(
    "click",
    openCreateEducationForm
  );

  elements.emptyStateAddEducationButton?.addEventListener(
    "click",
    openCreateEducationForm
  );

  elements.educationForm.addEventListener(
    "submit",
    handleEducationSubmit
  );

  elements.cancelEducationButton.addEventListener(
    "click",
    hideEducationForm
  );

  elements.deleteEducationButton.addEventListener(
    "click",
    () => {
      if (state.selectedEducationId) {
        openDeleteEducationModal(
          state.selectedEducationId
        );
      }
    }
  );

  elements.educationList.addEventListener(
    "click",
    handleEducationListClick
  );

  elements.educationSearch.addEventListener(
    "input",
    (event) => {
      state.searchTerm = event.target.value;
      renderEducationRecords();
    }
  );

  elements.educationStatusFilter.addEventListener(
    "change",
    (event) => {
      state.statusFilter = event.target.value;
      renderEducationRecords();
    }
  );

  elements.educationSortFilter.addEventListener(
    "change",
    (event) => {
      state.sortFilter = event.target.value;
      renderEducationRecords();
    }
  );

  elements.educationSummary.addEventListener(
    "input",
    updateSummaryCount
  );

  elements.currentlyStudying.addEventListener(
    "change",
    updateCurrentlyStudyingState
  );

  elements.educationLevel.addEventListener(
    "change",
    updateEducationLevelOtherState
  );

  elements.addEducationAchievementButton.addEventListener(
    "click",
    () => addAchievement()
  );

  elements.addCourseworkButton.addEventListener(
    "click",
    () => addCoursework()
  );

  elements.uploadSchoolLogoButton.addEventListener(
    "click",
    openSchoolLogoPicker
  );

  elements.replaceSchoolLogoButton.addEventListener(
    "click",
    openSchoolLogoPicker
  );

  elements.schoolLogoFile.addEventListener(
    "change",
    handleSchoolLogoFile
  );

  elements.schoolLogoUrl.addEventListener(
    "input",
    () => {
      if (elements.schoolLogoUrl.value.trim()) {
        state.pendingSchoolLogoValue =
          elements.schoolLogoUrl.value.trim();

        state.schoolLogoSource = "url";
      } else if (state.schoolLogoSource === "url") {
        state.pendingSchoolLogoValue = "";
      }
    }
  );

  elements.previewSchoolLogoButton.addEventListener(
    "click",
    previewSchoolLogo
  );

  elements.removeSchoolLogoButton.addEventListener(
    "click",
    removeSchoolLogo
  );

  elements.cancelDeleteEducationButton.addEventListener(
    "click",
    closeDeleteEducationModal
  );

  elements.confirmDeleteEducationButton.addEventListener(
    "click",
    confirmDeleteEducation
  );

  elements.deleteEducationConfirmationModal.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        elements.deleteEducationConfirmationModal
      ) {
        closeDeleteEducationModal();
      }
    }
  );

  document.addEventListener(
    "click",
    handleComingSoonNavigation
  );


  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (
      !elements.deleteEducationConfirmationModal.classList.contains(
        "hidden"
      )
    ) {
      closeDeleteEducationModal();
      return;
    }

    if (
      !elements.educationForm.classList.contains("hidden")
    ) {
      hideEducationForm();
    }
  });
}

async function initializeEducationManager() {
  try {
    await (window.__LAN_ADMIN_READY__ ?? Promise.reject(
      new Error("Administrator authorization gate is unavailable.")
    ));
    populateYearOptions();
    resetEducationForm();
    bindEducationEvents();
    await loadEducationRecords();
  } catch (error) {
    console.error("Unable to initialize Education manager:", error);
    showNotification(
      error?.message || "Unable to open Education manager.",
      "error"
    );
  }
}

initializeEducationManager();
