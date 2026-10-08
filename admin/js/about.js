/* =========================================================
   LΛN PORTFOLIO CMS
   About Editor JavaScript
   Firestore-powered version
   ========================================================= */

/* =========================================================
   1. SHARED SERVICES
   ========================================================= */

  import {
    defaultProfileData,
    loadProfile,
    saveProfile
  } from "../services/profileService.js";
  
  /* =========================================================
     3. HTML ELEMENTS
     ========================================================= */
  
  const aboutForm =
    document.getElementById("aboutForm");
  
  const saveButton =
    document.getElementById("saveButton");
  
  const saveButtonText =
    document.getElementById("saveButtonText");

  const saveButtonLoader =
    document.getElementById("saveButtonLoader");

  const aboutLoadingState =
    document.getElementById("aboutLoadingState");
  
  const saveStatus =
    document.getElementById("saveStatus");
  
  const resetButton =
    document.getElementById("resetButton");

  const undoButton =
    document.getElementById("undoButton");

  const editAboutButton =
    document.getElementById("editAboutButton");

  const toggleAboutVisibilityButton =
    document.getElementById("toggleAboutVisibilityButton");
  
  const aboutDescription =
    document.getElementById("aboutDescription");

  const aboutSaveSummary =
    document.getElementById("aboutSaveSummary");
  
  const aboutDescriptionCount =
    document.getElementById(
      "aboutDescriptionCount"
    );
  
  const comingSoonLinks =
    document.querySelectorAll(
      "[data-coming-soon]"
    );
  
  /* =========================================================
     4. STATE VALUES
     ========================================================= */
  
  let notificationTimer = null;
  let initialProfileData = null;
  let authenticationResolved = false;

  const ABOUT_UNDO_STORAGE_KEY =
    "lan.about.undo.lastSave";
  
  /* =========================================================
     5. NOTIFICATION SYSTEM
     ========================================================= */
  
  function showNotification(message) {
  const tone = "info";
  window.LANNotice?.({ title: "About", message, tone });
}
  
  /* =========================================================
     6. SAVE STATUS
     ========================================================= */
  
  function setSaveStatus(status) {
    if (!saveStatus) {
      return;
    }

    saveStatus.dataset.status = status;
    saveStatus.classList.remove("saved", "unsaved");

    if (status === "saved") {
      setSavingState(false);
      saveStatus.textContent = "Saved to Firestore";
      saveStatus.classList.add("saved");
      return;
    }

    if (status === "loading") {
      saveStatus.textContent = "Loading profile...";
      return;
    }

    if (status === "error") {
      saveStatus.textContent = "Unable to sync";
      saveStatus.classList.add("unsaved");
      return;
    }

    saveStatus.textContent = "Unsaved changes";
    saveStatus.classList.add("unsaved");
  }
  
  /* =========================================================
     7. CHARACTER COUNTERS
     ========================================================= */
  
  function updateCharacterCounts() {
    if (aboutDescription && aboutDescriptionCount) {
      aboutDescriptionCount.textContent =
        `${aboutDescription.value.length} / 1200`;
    }
  }

  function updateProfilePreview() {
    const fullName = document.getElementById("fullName")?.value.trim() || "Profile name";
    const location = document.getElementById("location")?.value.trim() || "Location not set";
    const availability = document.getElementById("availability");
    const availabilityLabel = availability?.selectedOptions[0]?.textContent || "Availability not set";
    const biographyLength = aboutDescription?.value.trim().length || 0;
    const sectionVisible = document.getElementById("sectionVisible")?.checked ?? true;

    const values = {
      profilePreviewName: fullName,
      profilePreviewLocation: location,
      profilePreviewAvailability: availabilityLabel,
      profilePreviewBiography: biographyLength
        ? `Biography ready · ${biographyLength} characters`
        : "Biography not written",
      profilePreviewVisibility: sectionVisible
        ? "Visible on public portfolio"
        : "Hidden from public portfolio"
    };

    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });

    if (aboutSaveSummary) {
      const biographyState = biographyLength
        ? `${biographyLength} characters`
        : "Biography empty";
      aboutSaveSummary.textContent =
        `${biographyState} · ${sectionVisible ? "Visible on public portfolio" : "Hidden from public portfolio"}`;
    }

    if (toggleAboutVisibilityButton) {
      toggleAboutVisibilityButton.textContent = sectionVisible
        ? "Hide About"
        : "Show About";
      toggleAboutVisibilityButton.setAttribute("aria-pressed", String(!sectionVisible));
      toggleAboutVisibilityButton.setAttribute("aria-label", sectionVisible ? "Hide About from the public portfolio" : "Show About on the public portfolio");
    }
  }
  
  /* =========================================================
     8. COLLECT FORM DATA
     Reads all values currently entered in the editor.
     ========================================================= */
  
  function collectFormData() {
    const formData =
      new FormData(aboutForm);
  
    return {
      fullName:
        String(
          formData.get("fullName") || ""
        ).trim(),
  
      location:
        String(
          formData.get("location") || ""
        ).trim(),
  
      availability:
        String(
          formData.get("availability") ||
          "available"
        ),
  
      aboutDescription:
        String(
          formData.get(
            "aboutDescription"
          ) || ""
        ).trim(),
  
      sectionVisible:
        document.getElementById(
          "sectionVisible"
        )?.checked ?? true,
  
      showAvailability:
        document.getElementById(
          "showAvailability"
        )?.checked ?? true
    };
  }

  function getAboutSnapshot(data = {}) {
    return {
      fullName: String(data.fullName || "").trim(),
      location: String(data.location || "").trim(),
      availability: String(data.availability || "available"),
      aboutDescription: String(data.aboutDescription || "").trim(),
      sectionVisible: data.sectionVisible !== false,
      showAvailability: data.showAvailability !== false
    };
  }

  function snapshotsMatch(left, right) {
    if (!left || !right) return false;
    return JSON.stringify(getAboutSnapshot(left)) ===
      JSON.stringify(getAboutSnapshot(right));
  }

  function readUndoState() {
    try {
      const rawState = localStorage.getItem(ABOUT_UNDO_STORAGE_KEY);
      if (!rawState) return null;

      const parsedState = JSON.parse(rawState);
      if (!parsedState?.previous || !parsedState?.current) {
        return null;
      }

      return parsedState;
    } catch (error) {
      console.warn("Unable to read About undo state:", error);
      return null;
    }
  }

  function clearUndoState() {
    try {
      localStorage.removeItem(ABOUT_UNDO_STORAGE_KEY);
    } catch (error) {
      console.warn("Unable to clear About undo state:", error);
    }

    setUndoAvailable(false);
  }

  function writeUndoState(previous, current) {
    const previousSnapshot = getAboutSnapshot(previous);
    const currentSnapshot = getAboutSnapshot(current);

    if (snapshotsMatch(previousSnapshot, currentSnapshot)) {
      clearUndoState();
      return;
    }

    try {
      localStorage.setItem(
        ABOUT_UNDO_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          previous: previousSnapshot,
          current: currentSnapshot,
          savedAt: Date.now()
        })
      );
      setUndoAvailable(true);
    } catch (error) {
      console.warn("Unable to store About undo state:", error);
      setUndoAvailable(false);
    }
  }

  function setUndoAvailable(isAvailable) {
    if (!undoButton) return;

    undoButton.disabled = !isAvailable;
    undoButton.title = isAvailable
      ? "Restore the About values that existed before the most recent save"
      : "There is no saved About change to undo";
  }

  function syncUndoAvailability(currentData) {
    const undoState = readUndoState();

    if (!undoState) {
      setUndoAvailable(false);
      return;
    }

    if (!snapshotsMatch(currentData, undoState.current)) {
      clearUndoState();
      return;
    }

    setUndoAvailable(true);
  }
  
  /* =========================================================
     9. POPULATE FORM
     Places loaded Firestore values into the editor.
     ========================================================= */
  
  function populateForm(data) {
    const profileData = {
      ...defaultProfileData,
      ...data
    };
  
    document.getElementById(
      "fullName"
    ).value =
      profileData.fullName || "";
  
    document.getElementById(
      "location"
    ).value =
      profileData.location || "";
  
    const availabilitySelect = document.getElementById("availability");
    if (window.LANSetSelectValue) {
      window.LANSetSelectValue(
        availabilitySelect,
        profileData.availability || "available",
        "available"
      );
    } else if (availabilitySelect) {
      availabilitySelect.value = profileData.availability || "available";
    }
  
    aboutDescription.value =
      profileData.aboutDescription || "";
  
    document.getElementById(
      "sectionVisible"
    ).checked =
      profileData.sectionVisible !== false;
  
    document.getElementById(
      "showAvailability"
    ).checked =
      profileData.showAvailability !== false;
  
    updateCharacterCounts();
    updateProfilePreview();
  }
  
  /* =========================================================
     10. SAVING BUTTON STATE
     ========================================================= */
  
  function setSavingState(isSaving) {
    if (!saveButton || !saveButtonText) {
      return;
    }
  
    saveButton.disabled = isSaving;
  
    saveButton.classList.toggle(
      "loading",
      isSaving
    );

    saveButtonLoader?.classList.toggle(
      "show",
      isSaving
    );
  
    saveButtonText.textContent =
      isSaving
        ? "Saving to Firestore..."
        : "Save About Information";
  }
  
  /* =========================================================
     11. LOADING STATE
     ========================================================= */
  
  function setFormLoading(isLoading) {
    if (!aboutForm) {
      return;
    }

    aboutForm.classList.toggle("is-loading", isLoading);
    aboutForm.setAttribute("aria-busy", String(isLoading));
    aboutLoadingState?.classList.toggle("hidden", !isLoading);
  
    const formControls =
      aboutForm.querySelectorAll(
        "input, textarea, select, button"
      );
  
    formControls.forEach((control) => {
      control.disabled = isLoading;
    });
  }
  
  /* =========================================================
     12. LOAD PROFILE FROM FIRESTORE
     ========================================================= */
  
  async function initializeProfileEditor() {
    setSaveStatus("loading");
    setFormLoading(true);
  
    try {
      const profileData =
        await loadProfile();
  
      initialProfileData = {
        ...profileData
      };
  
      populateForm(profileData);
      syncUndoAvailability(profileData);
  
      if (profileData.exists) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("unsaved");
  
        showNotification(
          "No saved profile was found. Default information was loaded."
        );
      }
    } catch (error) {
      console.error(
        "Profile editor initialization failed:",
        error
      );
  
      populateForm(defaultProfileData);
  
      initialProfileData = {
        ...defaultProfileData
      };
      setUndoAvailable(false);
  
      setSaveStatus("error");
  
      showNotification(
        error.message ||
        "The profile could not be loaded."
      );
    } finally {
      setSavingState(false);
      setFormLoading(false);
      syncUndoAvailability(
        initialProfileData ||
        defaultProfileData
      );
    }
  }
  
  editAboutButton?.addEventListener("click", () => {
    document.querySelector('[data-lan-tab="content"]')?.click();
    requestAnimationFrame(() => aboutDescription?.focus());
  });

  toggleAboutVisibilityButton?.addEventListener("click", () => {
    const visibility = document.getElementById("sectionVisible");
    if (!visibility) return;
    visibility.checked = !visibility.checked;
    setSaveStatus("unsaved");
    updateProfilePreview();
  });

  /* =========================================================
     13. DETECT UNSAVED CHANGES
     ========================================================= */
  
  aboutForm?.addEventListener(
    "input",
    () => {
      setSaveStatus("unsaved");
      updateCharacterCounts();
      updateProfilePreview();
    }
  );
  
  aboutForm?.addEventListener(
    "change",
    () => {
      setSaveStatus("unsaved");
      updateCharacterCounts();
      updateProfilePreview();
    }
  );
  
  /* =========================================================
     14. SAVE PROFILE TO FIRESTORE
     ========================================================= */
  
  aboutForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
  
      if (window.LANValidateForm ? !window.LANValidateForm(aboutForm, { title: "Complete About" }) : !aboutForm.reportValidity()) {
        return;
      }
  
      setSavingState(true);
  
      try {
        const profileData =
          collectFormData();

        const previousProfileData =
          getAboutSnapshot(
            initialProfileData ||
            defaultProfileData
          );
  
        const result =
          await saveProfile(profileData);

        writeUndoState(
          previousProfileData,
          result.data
        );
  
        initialProfileData = {
          ...result.data
        };
  
        populateForm(result.data);
        setSavingState(false);
        setSaveStatus("saved");

        showNotification(
          "About information saved to Firestore successfully."
        );
      } catch (error) {
        console.error(
          "Unable to save About information:",
          error
        );
  
        setSaveStatus("error");
  
        showNotification(
          error.message ||
          "The About information could not be saved."
        );
      } finally {
        setSavingState(false);
      }
    }
  );
  
  /* =========================================================
     15. DISCARD UNSAVED CHANGES
     Restores the most recently loaded or saved values.
     ========================================================= */
  
  resetButton?.addEventListener(
    "click",
    async () => {
      const confirmed = await window.LANConfirm({
        title: "Discard unsaved About changes?",
        message: "Only edits made since the last save will be removed. Saved Firestore content will not be changed.",
        confirmLabel: "Discard unsaved changes",
        danger: true
      });
  
      if (!confirmed) {
        return;
      }
  
      populateForm(
        initialProfileData ||
        defaultProfileData
      );
  
      setSaveStatus(
        initialProfileData
          ? "saved"
          : "unsaved"
      );
  
      showNotification(
        "Unsaved changes were discarded."
      );
    }
  );

  undoButton?.addEventListener(
    "click",
    async () => {
      const undoState = readUndoState();

      if (!undoState) {
        setUndoAvailable(false);
        showNotification("There is no saved About change to undo.");
        return;
      }

      const confirmed = await window.LANConfirm({
        title: "Undo last About save?",
        message: "This restores the About values from before your most recent save, writes them back to Firestore, and updates the public portfolio.",
        confirmLabel: "Undo last save",
        danger: false
      });

      if (!confirmed) {
        return;
      }

      setSavingState(true);
      undoButton.disabled = true;

      try {
        const currentProfile = await loadProfile();

        if (!snapshotsMatch(currentProfile, undoState.current)) {
          initialProfileData = {
            ...currentProfile
          };
          populateForm(currentProfile);
          clearUndoState();
          setSaveStatus("saved");
          showNotification(
            "Undo was cancelled because the About profile changed after that save."
          );
          return;
        }

        const result = await saveProfile(undoState.previous);

        initialProfileData = {
          ...result.data
        };

        populateForm(result.data);
        clearUndoState();
        setSaveStatus("saved");

        showNotification(
          "Last About save was undone in Firestore and the public portfolio."
        );
      } catch (error) {
        console.error("Unable to undo the last About save:", error);
        setSaveStatus("error");
        syncUndoAvailability(initialProfileData || defaultProfileData);
        showNotification(
          error.message ||
          "The last About save could not be undone."
        );
      } finally {
        setSavingState(false);
      }
    }
  );
  
  /* =========================================================
     17. UNFINISHED EDITOR LINKS
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
  
  /* =========================================================
     18. CANONICAL ADMIN SESSION
     The persistent shell owns Authentication/Authorization.
     This workspace consumes that resolved session only.
     ========================================================= */

  try {
    await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin shell session bridge did not initialize.")));
    authenticationResolved = true;
    await initializeProfileEditor();
  } catch (error) {
    authenticationResolved = true;
    console.error("Admin workspace session could not be consumed:", error);
    showNotification("Administrator session could not be verified.");
  }

  /* =========================================================
     20. SAFETY WARNING
     Warns before leaving with unsaved changes.
     ========================================================= */
  
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (
        !authenticationResolved ||
        !saveStatus?.classList.contains(
          "unsaved"
        )
      ) {
        return;
      }
  
      event.preventDefault();
      event.returnValue = "";
    }
  );
