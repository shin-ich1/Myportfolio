/* =========================================================
   LΛN PORTFOLIO CMS
   Shared Firestore Helpers
   ========================================================= */

/* =========================================================
   1. TEXT CLEANING
   ========================================================= */

   export function cleanText(value, fallback = "") {
    if (typeof value !== "string") {
      return fallback;
    }
  
    return value.trim();
  }
  
  /* =========================================================
     2. NUMBER CLEANING
     ========================================================= */
  
  export function cleanNumber(
    value,
    fallback = 0,
    minimum = null,
    maximum = null
  ) {
    const parsedValue = Number(value);
  
    if (!Number.isFinite(parsedValue)) {
      return fallback;
    }
  
    let result = parsedValue;
  
    if (minimum !== null) {
      result = Math.max(result, minimum);
    }
  
    if (maximum !== null) {
      result = Math.min(result, maximum);
    }
  
    return result;
  }
  
  /* =========================================================
     3. BOOLEAN CLEANING
     ========================================================= */
  
  export function cleanBoolean(
    value,
    fallback = false
  ) {
    if (typeof value === "boolean") {
      return value;
    }
  
    return fallback;
  }
  
  /* =========================================================
     4. ARRAY CLEANING
     ========================================================= */
  
  export function cleanStringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
  
    return value
      .map((item) => cleanText(item))
      .filter(Boolean);
  }
  
  /* =========================================================
     5. COMMA-SEPARATED STRING TO ARRAY
     ========================================================= */
  
  export function commaSeparatedToArray(value) {
    if (Array.isArray(value)) {
      return cleanStringArray(value);
    }
  
    if (typeof value !== "string") {
      return [];
    }
  
    return value
      .split(",")
      .map((item) => cleanText(item))
      .filter(Boolean);
  }
  
  /* =========================================================
     6. SLUG GENERATION
     ========================================================= */
  
  export function generateSlug(value) {
    const cleanedValue = cleanText(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  
    return cleanedValue
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }
  
  /* =========================================================
     7. UNIQUE SLUG GENERATION
     ========================================================= */
  
  export function generateUniqueSlug(
    title,
    company = ""
  ) {
    const baseSlug = generateSlug(
      `${title} ${company}`
    );
  
    if (baseSlug) {
      return baseSlug;
    }
  
    return `entry-${Date.now()}`;
  }
  
  /* =========================================================
     8. REMOVE UNDEFINED VALUES
     Firestore does not accept undefined fields.
     ========================================================= */
  
  export function removeUndefinedFields(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          removeUndefinedFields(item)
        )
        .filter(
          (item) => item !== undefined
        );
    }
  
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date)
    ) {
      return Object.entries(value).reduce(
        (result, [key, item]) => {
          const cleanedItem =
            removeUndefinedFields(item);
  
          if (cleanedItem !== undefined) {
            result[key] = cleanedItem;
          }
  
          return result;
        },
        {}
      );
    }
  
    return value;
  }
  
  /* =========================================================
     9. REMOVE EMPTY VALUES
     Keeps booleans, numbers and valid arrays.
     ========================================================= */
  
  export function removeEmptyFields(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          removeEmptyFields(item)
        )
        .filter((item) => {
          if (item === null) {
            return false;
          }
  
          if (item === undefined) {
            return false;
          }
  
          if (
            typeof item === "string" &&
            item.trim() === ""
          ) {
            return false;
          }
  
          return true;
        });
    }
  
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date)
    ) {
      return Object.entries(value).reduce(
        (result, [key, item]) => {
          const cleanedItem =
            removeEmptyFields(item);
  
          const isEmptyString =
            typeof cleanedItem === "string" &&
            cleanedItem.trim() === "";
  
          const isEmptyArray =
            Array.isArray(cleanedItem) &&
            cleanedItem.length === 0;
  
          const isEmptyObject =
            cleanedItem &&
            typeof cleanedItem === "object" &&
            !Array.isArray(cleanedItem) &&
            Object.keys(cleanedItem).length === 0;
  
          if (
            cleanedItem !== undefined &&
            cleanedItem !== null &&
            !isEmptyString &&
            !isEmptyArray &&
            !isEmptyObject
          ) {
            result[key] = cleanedItem;
          }
  
          return result;
        },
        {}
      );
    }
  
    return value;
  }
  
  /* =========================================================
     10. REQUIRED FIELD VALIDATION
     ========================================================= */
  
  export function validateRequiredFields(
    data,
    requiredFields
  ) {
    const missingFields =
      requiredFields.filter((fieldName) => {
        const value = data[fieldName];
  
        if (
          value === null ||
          value === undefined
        ) {
          return true;
        }
  
        if (
          typeof value === "string" &&
          value.trim() === ""
        ) {
          return true;
        }
  
        if (
          Array.isArray(value) &&
          value.length === 0
        ) {
          return true;
        }
  
        return false;
      });
  
    if (missingFields.length > 0) {
      throw new Error(
        `Missing required fields: ${missingFields.join(", ")}`
      );
    }
  
    return true;
  }
  
  /* =========================================================
     11. DATE STRING VALIDATION
     Accepts YYYY-MM format used by month inputs.
     ========================================================= */
  
  export function isValidMonthValue(value) {
    if (value === "") {
      return true;
    }
  
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(
      value
    );
  }
  
  /* =========================================================
     12. NORMALIZE MONTH VALUE
     ========================================================= */
  
  export function cleanMonthValue(value) {
    const cleanedValue = cleanText(value);
  
    if (!cleanedValue) {
      return "";
    }
  
    if (!isValidMonthValue(cleanedValue)) {
      return "";
    }
  
    return cleanedValue;
  }
  
  /* =========================================================
     13. COMPARE DISPLAY ORDER
     Lower order appears first.
     ========================================================= */
  
  export function compareDisplayOrder(
    firstItem,
    secondItem
  ) {
    const firstOrder =
      cleanNumber(
        firstItem?.displayOrder,
        0
      );
  
    const secondOrder =
      cleanNumber(
        secondItem?.displayOrder,
        0
      );
  
    if (firstOrder !== secondOrder) {
      return firstOrder - secondOrder;
    }
  
    const firstTitle =
      cleanText(
        firstItem?.jobTitle ||
        firstItem?.title ||
        firstItem?.name
      ).toLowerCase();
  
    const secondTitle =
      cleanText(
        secondItem?.jobTitle ||
        secondItem?.title ||
        secondItem?.name
      ).toLowerCase();
  
    return firstTitle.localeCompare(
      secondTitle
    );
  }
  
  /* =========================================================
     14. FIRESTORE TIMESTAMP TO DATE
     ========================================================= */
  
  export function firestoreTimestampToDate(
    value
  ) {
    if (!value) {
      return null;
    }
  
    if (
      typeof value.toDate === "function"
    ) {
      return value.toDate();
    }
  
    if (value instanceof Date) {
      return value;
    }
  
    const parsedDate = new Date(value);
  
    if (
      Number.isNaN(parsedDate.getTime())
    ) {
      return null;
    }
  
    return parsedDate;
  }
  
  /* =========================================================
     15. FORMAT DATE FOR DISPLAY
     ========================================================= */
  
  export function formatReadableDate(
    value,
    locale = "en-US"
  ) {
    const date =
      firestoreTimestampToDate(value);
  
    if (!date) {
      return "";
    }
  
    return new Intl.DateTimeFormat(
      locale,
      {
        year: "numeric",
        month: "short",
        day: "numeric"
      }
    ).format(date);
  }
  
  /* =========================================================
     16. CREATE SAFE DOCUMENT DATA
     ========================================================= */
  
  export function createSafeDocumentData(
    value,
    removeEmpty = false
  ) {
    const cleanedValue =
      removeUndefinedFields(value);
  
    if (removeEmpty) {
      return removeEmptyFields(
        cleanedValue
      );
    }
  
    return cleanedValue;
  }