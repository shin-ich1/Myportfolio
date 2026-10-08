/* =========================================================
   LΛN PORTFOLIO CMS
   Experience Firestore Service
   File: admin/services/experienceService.js
   ========================================================= */

   import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    limit,
    serverTimestamp,
    updateDoc,
    writeBatch
  } from
    "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
  
  import { db } from "./firebase.js";
  import { cleanSkillData } from "./skillService.js";
  import { announcePortfolioContentChanged } from "./portfolioSyncService.js";
  
  import {
    cleanBoolean,
    cleanMonthValue,
    cleanNumber,
    cleanStringArray,
    cleanText,
    commaSeparatedToArray,
    compareDisplayOrder,
    createSafeDocumentData,
    generateUniqueSlug,
    validateRequiredFields
  } from "./firestoreHelpers.js";
  
  /* =========================================================
     1. COLLECTION CONFIGURATION
     ========================================================= */
  
  const EXPERIENCE_COLLECTION = "experiences";
  const BULK_EXPERIENCE_WRITE_LIMIT = 200;
  const BULK_EXPERIENCE_MUTABLE_FIELDS = new Set(["status", "visible", "featured"]);
  
  const experienceCollectionReference =
    collection(
      db,
      EXPERIENCE_COLLECTION
    );

  const projectCollectionReference =
    collection(
      db,
      "projects"
    );


  async function loadExperienceLinkedProjectMap() {
    const references = new Map();
    const queries = [
      query(projectCollectionReference, where("linkedModuleKey", "==", "experience")),
      query(projectCollectionReference, where("linkedModule", "==", "experience")),
      query(projectCollectionReference, where("linkedModule", "==", "Experience"))
    ];
    const snapshots = await Promise.all(queries.map((item) => getDocs(item)));
    snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
      const project = item.data() || {};
      const sourceId = String(project.linkedDocumentId || "").trim();
      if (sourceId && !references.has(sourceId)) {
        references.set(sourceId, {
          linkedProjectId: item.id,
          linkedProjectTitle: String(project.title || project.linkedTitleSnapshot || "").trim()
        });
      }
    }));
    return references;
  }

  async function attachExperienceLinkedStatus(experiences = []) {
    try {
      const references = await loadExperienceLinkedProjectMap();
      return experiences.map((experience) => ({
        ...experience,
        ...(references.get(experience.id) || {})
      }));
    } catch (error) {
      console.warn("Unable to load Experience linked status:", error);
      return experiences;
    }
  }

  async function assertExperienceIsNotLinked(experienceId) {
    const linkedProjectsQuery = query(
      projectCollectionReference,
      where("linkedDocumentId", "==", experienceId),
      limit(10)
    );

    const linkedProjects = await getDocs(linkedProjectsQuery);
    const hasLinkedProject = linkedProjects.docs.some((item) => {
      const project = item.data() || {};
      const moduleKey = cleanText(
        project.linkedModuleKey || project.linkedModule
      ).toLowerCase();
      return moduleKey === "experience";
    });

    if (hasLinkedProject) {
      throw new Error(
        "This experience is linked to a Project. Remove or unlink that Project first."
      );
    }
  }
  
  /* =========================================================
     2. DEFAULT EXPERIENCE DATA
     ========================================================= */
  
  export function createDefaultExperience() {
    return {
      jobTitle: "",
      company: "",
      publicCompanyDisplay: "full",
      employmentType: "",
      employmentTypeOther: "",
      category: "",
      categoryOther: "",
      workSetup: "",
      workSetupOther: "",
      location: "",
  
      startDate: "",
      endDate: "",
      isCurrent: false,
  
      summary: "",
      responsibilities: [],
      achievements: [],
      skillIds: [],
      toolIds: [],
      skills: [],
      tools: [],
  
      status: "draft",
      visible: true,
      featured: false,
      displayOrder: 0
    };
  }
  
  /* =========================================================
     3. NORMALIZE ARRAY INPUT
     ========================================================= */
  
  function normalizeArrayInput(value) {
    if (Array.isArray(value)) {
      return cleanStringArray(value);
    }
  
    return commaSeparatedToArray(value);
  }
  
  /* =========================================================
     4. NORMALIZE EXPERIENCE ENUMS
     ========================================================= */

  function normalizeToken(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[_–—]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeEmploymentType(value) {
    const aliases = new Map([
      ["full-time", "full-time"],
      ["full time", "full-time"],
      ["fulltime", "full-time"],
      ["part-time", "part-time"],
      ["part time", "part-time"],
      ["parttime", "part-time"],
      ["contract", "contract"],
      ["contractual", "contract"],
      ["contract of service", "contract"],
      ["cos", "contract"],
      ["freelance", "freelance"],
      ["freelancer", "freelance"],
      ["internship", "internship"],
      ["intern", "internship"],
      ["ojt", "internship"],
      ["internship / ojt", "internship"],
      ["internship/ojt", "internship"],
      ["on-the-job training", "internship"],
      ["temporary", "temporary"],
      ["volunteer", "volunteer"],
      ["self-employed", "self-employed"],
      ["self employed", "self-employed"],
      ["project", "project"],
      ["project-based", "project"],
      ["project based", "project"],
      ["other", "other"]
    ]);

    return aliases.get(normalizeToken(value)) || "";
  }

  function normalizeCategory(value) {
    const aliases = new Map([
      ["data-administration", "data-administration"],
      ["data administration", "data-administration"],
      ["data and administration", "data-administration"],
      ["data & administration", "data-administration"],
      ["technology", "technology"],
      ["technology and it", "technology"],
      ["technology & it", "technology"],
      ["it", "technology"],
      ["information technology", "technology"],
      ["multimedia", "multimedia"],
      ["multimedia and creative", "multimedia"],
      ["multimedia & creative", "multimedia"],
      ["creative", "multimedia"],
      ["ecommerce", "ecommerce"],
      ["e-commerce", "ecommerce"],
      ["e-commerce and retail", "ecommerce"],
      ["sales", "sales"],
      ["sales and business development", "sales"],
      ["customer-service", "customer-service"],
      ["customer service", "customer-service"],
      ["operations", "operations"],
      ["operations and logistics", "operations"],
      ["government", "government"],
      ["government service", "government"],
      ["education", "education"],
      ["education and training", "education"],
      ["other", "other"],
      ["other industry", "other"]
    ]);

    return aliases.get(normalizeToken(value)) || "";
  }

  function normalizeWorkSetup(value) {
    const aliases = new Map([
      ["onsite", "onsite"],
      ["on-site", "onsite"],
      ["on site", "onsite"],
      ["office", "onsite"],
      ["in-office", "onsite"],
      ["remote", "remote"],
      ["work from home", "remote"],
      ["wfh", "remote"],
      ["hybrid", "hybrid"],
      ["other", "other"]
    ]);

    return aliases.get(normalizeToken(value)) || "";
  }

  function normalizePublicCompanyDisplay(value) {
    const token = normalizeToken(value);
    const aliases = new Map([
      ["full", "full"],
      ["show", "full"],
      ["show full name", "full"],
      ["masked", "masked"],
      ["mask", "masked"],
      ["private", "private"],
      ["private company", "private"],
      ["hidden", "hidden"],
      ["hide", "hidden"]
    ]);
    return aliases.get(token) || "full";
  }

  function normalizeMonthYearValue(value, monthValue = "", yearValue = "") {
    const directValue = cleanMonthValue(value);
    if (directValue) {
      return directValue;
    }

    const monthNames = new Map([
      ["jan", "01"], ["january", "01"],
      ["feb", "02"], ["february", "02"],
      ["mar", "03"], ["march", "03"],
      ["apr", "04"], ["april", "04"],
      ["may", "05"],
      ["jun", "06"], ["june", "06"],
      ["jul", "07"], ["july", "07"],
      ["aug", "08"], ["august", "08"],
      ["sep", "09"], ["sept", "09"], ["september", "09"],
      ["oct", "10"], ["october", "10"],
      ["nov", "11"], ["november", "11"],
      ["dec", "12"], ["december", "12"]
    ]);

    const rawValue = cleanText(value);
    const textMatch = rawValue.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (textMatch) {
      const month = monthNames.get(textMatch[1].toLowerCase());
      if (month) {
        return `${textMatch[2]}-${month}`;
      }
    }

    const year = cleanText(String(yearValue || ""));
    const rawMonth = normalizeToken(String(monthValue || ""));
    const month = /^\d{1,2}$/.test(rawMonth)
      ? String(Math.min(12, Math.max(1, Number(rawMonth)))).padStart(2, "0")
      : monthNames.get(rawMonth) || "";

    return /^\d{4}$/.test(year) && month
      ? `${year}-${month}`
      : "";
  }

  /* =========================================================
     7. CLEAN EXPERIENCE DATA
     ========================================================= */
  
  export function cleanExperienceData(
    rawData = {}
  ) {
    const jobTitle = cleanText(
      rawData.jobTitle || rawData.role || rawData.position || rawData.title
    );
  
    const company = cleanText(
      rawData.company || rawData.companyName || rawData.organization || rawData.employer
    );
  
    const isCurrent = cleanBoolean(
      rawData.isCurrent ?? rawData.currentlyWorking ?? rawData.current,
      false
    );
  
    const rawEmploymentType = cleanText(
      rawData.employmentType || rawData.employment || rawData.employment_type || rawData.type
    );
    const normalizedEmploymentType = normalizeEmploymentType(rawEmploymentType);
    const rawCategory = cleanText(
      rawData.category || rawData.experienceCategory || rawData.industry || rawData.industryCategory
    );
    const normalizedCategory = normalizeCategory(rawCategory);
    const rawWorkSetup = cleanText(
      rawData.workSetup || rawData.workArrangement || rawData.workMode || rawData.setup
    );
    const normalizedWorkSetup = normalizeWorkSetup(rawWorkSetup);

    const cleanedExperience = {
      jobTitle,
      company,
      publicCompanyDisplay: normalizePublicCompanyDisplay(
        rawData.publicCompanyDisplay || rawData.companyDisplayMode || rawData.companyPrivacy
      ),

      employmentType: normalizedEmploymentType || (rawEmploymentType ? "other" : ""),
      employmentTypeOther: cleanText(
        rawData.employmentTypeOther || rawData.customEmploymentType ||
        (!normalizedEmploymentType && rawEmploymentType ? rawEmploymentType : "") ||
        (normalizedEmploymentType === "other" && normalizeToken(rawEmploymentType) !== "other" ? rawEmploymentType : "")
      ),

      category: normalizedCategory || (rawCategory ? "other" : ""),
      categoryOther: cleanText(
        rawData.categoryOther || rawData.experienceCategoryOther || rawData.customCategory ||
        (!normalizedCategory && rawCategory ? rawCategory : "") ||
        (normalizedCategory === "other" && !["other", "other industry"].includes(normalizeToken(rawCategory)) ? rawCategory : "")
      ),

      workSetup: normalizedWorkSetup || (rawWorkSetup ? "other" : ""),
      workSetupOther: cleanText(
        rawData.workSetupOther || rawData.customWorkSetup ||
        (!normalizedWorkSetup && rawWorkSetup ? rawWorkSetup : "") ||
        (normalizedWorkSetup === "other" && normalizeToken(rawWorkSetup) !== "other" ? rawWorkSetup : "")
      ),
  
      location: cleanText(
        rawData.location || rawData.workLocation || rawData.officeLocation
      ),
  
      startDate: normalizeMonthYearValue(
        rawData.startDate ||
        rawData.start ||
        rawData.startPeriod,
        rawData.startMonth,
        rawData.startYear
      ),
  
      endDate: isCurrent
        ? ""
        : normalizeMonthYearValue(
            rawData.endDate ||
            rawData.end ||
            rawData.endPeriod,
            rawData.endMonth,
            rawData.endYear
          ),
  
      isCurrent,
  
      summary: cleanText(
        rawData.summary || rawData.experienceSummary || rawData.description || rawData.details
      ),
  
      responsibilities:
        normalizeArrayInput(
          rawData.responsibilities || rawData.duties || rawData.tasks
        ),
  
      achievements:
        normalizeArrayInput(
          rawData.achievements || rawData.highlights || rawData.accomplishments
        ),
  
      skillIds: normalizeArrayInput(rawData.skillIds || rawData.skillsUsedIds),
      toolIds: normalizeArrayInput(rawData.toolIds || rawData.toolsUsedIds),

      skills:
        normalizeArrayInput(
          rawData.skills || rawData.skillsUsed || rawData.skillsDemonstrated
        ),

      tools:
        normalizeArrayInput(
          rawData.tools || rawData.toolsUsed || rawData.technologies
        ),
  
      status:
        cleanText(rawData.status || rawData.experienceStatus).toLowerCase() ===
        "published"
          ? "published"
          : "draft",
  
      visible: cleanBoolean(
        rawData.visible ?? rawData.experienceVisible,
        true
      ),
  
      featured: cleanBoolean(
        rawData.featured ?? rawData.featuredExperience,
        false
      ),
  
      displayOrder: cleanNumber(
        rawData.displayOrder ?? rawData.experienceDisplayOrder ?? rawData.order,
        0,
        0
      )
    };
  
    return createSafeDocumentData(
      cleanedExperience
    );
  }
  
  function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /* =========================================================
     8. VALIDATE EXPERIENCE DATA
     ========================================================= */
  
  export function validateExperienceData(
    data
  ) {
    validateRequiredFields(
      data,
      [
        "jobTitle",
        "company",
        "employmentType",
        "category",
        "workSetup",
        "startDate",
        "summary"
      ]
    );
  
    if (data.employmentType === "other" && !cleanText(data.employmentTypeOther)) {
      throw new Error("Specify the custom employment type.");
    }
    if (data.category === "other" && !cleanText(data.categoryOther)) {
      throw new Error("Specify the custom Experience category.");
    }
    if (data.workSetup === "other" && !cleanText(data.workSetupOther)) {
      throw new Error("Specify the custom work setup.");
    }
    if (!["full", "masked", "private", "hidden"].includes(data.publicCompanyDisplay)) {
      throw new Error("Select a valid public company display mode.");
    }

    if (
      data.status !== "draft" &&
      data.status !== "published"
    ) {
      throw new Error(
        "Experience status must be draft or published."
      );
    }
  
    const latestAllowedMonth = currentMonthValue();

    if (data.startDate > latestAllowedMonth) {
      throw new Error(
        "The Experience start date cannot be in the future."
      );
    }

    if (
      !data.isCurrent &&
      data.endDate > latestAllowedMonth
    ) {
      throw new Error(
        "The Experience end date cannot be in the future."
      );
    }

    if (
      !data.isCurrent &&
      data.endDate &&
      data.startDate &&
      data.endDate < data.startDate
    ) {
      throw new Error(
        "The end date cannot be earlier than the start date."
      );
    }
  
    if (
      data.isCurrent &&
      data.endDate
    ) {
      throw new Error(
        "A current experience cannot have an end date."
      );
    }
  
    return true;
  }
  
  /* =========================================================
     9. FORMAT FIRESTORE DOCUMENT
     ========================================================= */
  
  function formatExperienceDocument(
    documentSnapshot
  ) {
    const data =
      documentSnapshot.data() || {};

    /*
      Normalize legacy Experience field shapes for the editor without
      writing during reads. Canonical values are persisted only when the
      user explicitly saves the record.
    */
    const normalized =
      cleanExperienceData({
        ...data,
        jobTitle:
          data.jobTitle ||
          data.role ||
          data.position ||
          data.title ||
          "",
        company:
          data.company ||
          data.organization ||
          data.employer ||
          "",
        summary:
          data.summary ||
          data.experienceSummary ||
          data.description ||
          data.details ||
          "",
        isCurrent:
          data.isCurrent ??
          data.currentlyWorking ??
          false
      });

    return {
      id: documentSnapshot.id,
      ...data,
      ...normalized
    };
  }

  /* =========================================================
     10. LOAD ALL EXPERIENCES
     ========================================================= */
  
  export async function loadExperiences() {
    try {
      // Read the complete collection and sort client-side. Firestore orderBy()
      // excludes legacy documents that do not contain displayOrder, which can
      // make valid production Experience records silently disappear.
      const querySnapshot = await getDocs(
        experienceCollectionReference
      );

      const experiences = querySnapshot.docs
        .map(formatExperienceDocument)
        .sort(compareDisplayOrder);

      return attachExperienceLinkedStatus(experiences);
    } catch (error) {
      console.error(
        "Unable to load experiences:",
        error
      );

      throw new Error(
        "Unable to load experience entries."
      );
    }
  }

  /* =========================================================
     11. GET ONE EXPERIENCE
     ========================================================= */
  
  export async function getExperience(
    experienceId
  ) {
    const cleanedId = cleanText(
      experienceId
    );
  
    if (!cleanedId) {
      throw new Error(
        "An experience ID is required."
      );
    }
  
    try {
      const documentReference = doc(
        db,
        EXPERIENCE_COLLECTION,
        cleanedId
      );
  
      const documentSnapshot =
        await getDoc(
          documentReference
        );
  
      if (!documentSnapshot.exists()) {
        return null;
      }
  
      return formatExperienceDocument(
        documentSnapshot
      );
    } catch (error) {
      console.error(
        "Unable to get experience:",
        error
      );
  
      throw new Error(
        "Unable to retrieve the experience entry."
      );
    }
  }
  
  /* =========================================================
     12. CREATE EXPERIENCE
     ========================================================= */
  

  async function validateExperienceCapabilityReferences(experience = {}) {
    const references = [
      ...normalizeArrayInput(experience.skillIds).map((id) => ({ id, type: "skill", label: "Skill" })),
      ...normalizeArrayInput(experience.toolIds).map((id) => ({ id, type: "tool", label: "Tool" }))
    ];
    if (!references.length) return;
    const checked = await Promise.all(references.map(async (entry) => ({
      ...entry,
      snapshot: await getDoc(doc(db, "skills", entry.id))
    })));
    for (const entry of checked) {
      if (!entry.snapshot.exists()) throw new Error(`${entry.label} reference is no longer available. Re-select it from Skills & Tools Used.`);
      const stored = entry.snapshot.data() || {};
      let recordType = cleanText(stored.recordType).toLowerCase();
      if (!recordType) {
        try { recordType = cleanSkillData(stored).recordType; } catch {}
      }
      if (recordType !== entry.type) throw new Error(`${entry.label} reference points to the wrong library record type.`);
    }
  }
  function cleanBulkExperienceChanges(rawChanges = {}) {
    const source = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges) ? rawChanges : {};
    const changes = {};

    if (BULK_EXPERIENCE_MUTABLE_FIELDS.has("status") && Object.prototype.hasOwnProperty.call(source, "status")) {
      const status = cleanText(source.status).toLowerCase();
      if (!new Set(["draft", "published"]).has(status)) {
        throw new Error("Experience status must be Draft or Published.");
      }
      changes.status = status;
    }

    if (BULK_EXPERIENCE_MUTABLE_FIELDS.has("visible") && Object.prototype.hasOwnProperty.call(source, "visible")) {
      changes.visible = cleanBoolean(source.visible, true);
    }

    if (BULK_EXPERIENCE_MUTABLE_FIELDS.has("featured") && Object.prototype.hasOwnProperty.call(source, "featured")) {
      changes.featured = cleanBoolean(source.featured, false);
    }

    return changes;
  }

  export async function updateManyExperiences(experienceIds = [], rawChanges = {}) {
    const ids = [...new Set((experienceIds || []).map((id) => cleanText(id)).filter(Boolean))];
    if (!ids.length) throw new Error("Select at least one experience record.");

    const changes = cleanBulkExperienceChanges(rawChanges);
    if (!Object.keys(changes).length) throw new Error("No valid bulk Experience changes were provided.");

    let updatedCount = 0;
    for (let start = 0; start < ids.length; start += BULK_EXPERIENCE_WRITE_LIMIT) {
      const currentIds = ids.slice(start, start + BULK_EXPERIENCE_WRITE_LIMIT);
      const snapshots = await Promise.all(currentIds.map((id) => getDoc(doc(db, EXPERIENCE_COLLECTION, id))));
      if (snapshots.some((snapshot) => !snapshot.exists())) {
        throw new Error("A selected experience record is no longer available. Refresh and try again.");
      }

      const batch = writeBatch(db);
      snapshots.forEach((snapshot) => {
        batch.update(snapshot.ref, { ...changes, updatedAt: serverTimestamp() });
        updatedCount += 1;
      });
      await batch.commit();
    }

    announcePortfolioContentChanged("experience");
    return updatedCount;
  }

  export async function createExperience(
    rawData
  ) {
    const cleanedData =
      cleanExperienceData(rawData);
  
    validateExperienceData(
      cleanedData
    );
    await validateExperienceCapabilityReferences(cleanedData);
  
    const slug = generateUniqueSlug(
      cleanedData.jobTitle,
      cleanedData.company
    );
  
    const documentData =
      createSafeDocumentData({
        ...cleanedData,
        slug,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
  
    try {
      const documentReference =
        await addDoc(
          experienceCollectionReference,
          documentData
        );
  
      announcePortfolioContentChanged("experience");
      return {
        id: documentReference.id,
        ...cleanedData,
        slug
      };
    } catch (error) {
      console.error(
        "Unable to create experience:",
        error
      );
  
      throw new Error(
        "Unable to save the experience entry."
      );
    }
  }
  
  /* =========================================================
     13. UPDATE EXPERIENCE
     ========================================================= */
  
  export async function updateExperience(
    experienceId,
    rawData
  ) {
    const cleanedId = cleanText(
      experienceId
    );
  
    if (!cleanedId) {
      throw new Error(
        "An experience ID is required."
      );
    }
  
    const cleanedData =
      cleanExperienceData(rawData);
  
    validateExperienceData(
      cleanedData
    );
    await validateExperienceCapabilityReferences(cleanedData);
  
    const slug = generateUniqueSlug(
      cleanedData.jobTitle,
      cleanedData.company
    );
  
    const documentData =
      createSafeDocumentData({
        ...cleanedData,
        slug,
        updatedAt: serverTimestamp()
      });
  
    try {
      const documentReference = doc(
        db,
        EXPERIENCE_COLLECTION,
        cleanedId
      );
  
      const existingDocument =
        await getDoc(
          documentReference
        );
  
      if (!existingDocument.exists()) {
        throw new Error(
          "The experience entry no longer exists."
        );
      }
  
      await updateDoc(
        documentReference,
        documentData
      );
      announcePortfolioContentChanged("experience");
  
      return {
        id: cleanedId,
        ...cleanedData,
        slug
      };
    } catch (error) {
      console.error(
        "Unable to update experience:",
        error
      );
  
      if (
        error.message ===
        "The experience entry no longer exists."
      ) {
        throw error;
      }
  
      throw new Error(
        "Unable to update the experience entry."
      );
    }
  }
  
  /* =========================================================
     14. DELETE EXPERIENCE
     ========================================================= */
  
  export async function deleteExperience(
    experienceId
  ) {
    const cleanedId = cleanText(
      experienceId
    );
  
    if (!cleanedId) {
      throw new Error(
        "An experience ID is required."
      );
    }
  
    try {
      const documentReference = doc(
        db,
        EXPERIENCE_COLLECTION,
        cleanedId
      );
  
      const existingDocument =
        await getDoc(
          documentReference
        );
  
      if (!existingDocument.exists()) {
        throw new Error(
          "The experience entry no longer exists."
        );
      }

      await assertExperienceIsNotLinked(cleanedId);
  
      await deleteDoc(
        documentReference
      );
      announcePortfolioContentChanged("experience");
  
      return true;
    } catch (error) {
      console.error(
        "Unable to delete experience:",
        error
      );
  
      if (
        error.message ===
          "The experience entry no longer exists." ||
        error.message?.includes("linked to a Project")
      ) {
        throw error;
      }
  
      throw new Error(
        "Unable to delete the experience entry."
      );
    }
  }
  
  /* =========================================================
     15. LOAD PUBLISHED EXPERIENCES
     ========================================================= */
  
  export async function loadPublishedExperiences() {
    const experiences =
      await loadExperiences();
  
    return experiences
      .filter((experience) => {
        return (
          experience.status ===
            "published" &&
          experience.visible !== false
        );
      })
      .sort(
        (
          firstExperience,
          secondExperience
        ) => {
          const firstFeatured =
            firstExperience.featured ===
            true;
  
          const secondFeatured =
            secondExperience.featured ===
            true;
  
          if (
            firstFeatured !==
            secondFeatured
          ) {
            return firstFeatured
              ? -1
              : 1;
          }
  
          return compareDisplayOrder(
            firstExperience,
            secondExperience
          );
        }
      );
  }