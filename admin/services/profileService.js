  /* =========================================================
    LΛN PORTFOLIO CMS
    Profile / About Firestore Service
    ========================================================= */

  /*
    Firestore functions used in this service:

    doc()
      Creates a reference to one Firestore document.

    getDoc()
      Reads one document from Firestore.

    setDoc()
      Creates or updates one document.

    serverTimestamp()
      Stores the update time using Firebase's server clock.
  */

  import {
      doc,
      getDoc,
      setDoc,
      serverTimestamp
    } from
      "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
    
    import {
      db
    } from "./firebase.js";
    
    /* =========================================================
      1. FIRESTORE LOCATION
      ========================================================= */
    
    /*
      We will store the About information here:
    
      Collection:
        portfolio
    
      Document:
        profile
    
      Firestore path:
        portfolio/profile
    */
    
    const PROFILE_COLLECTION =
      "portfolio";
    
    const PROFILE_DOCUMENT =
      "profile";
    
    const profileReference =
      doc(
        db,
        PROFILE_COLLECTION,
        PROFILE_DOCUMENT
      );
    
    /* =========================================================
      2. DEFAULT PROFILE DATA
      Used when Firestore does not have a profile document yet.
      ========================================================= */
    
    export const defaultProfileData = {
      fullName:
        "Rolando A. Lagmay Jr.",
    
      displayName:
        "Rolando",
    
      professionalTitle:
        "Database Management, Data Entry and Multimedia Support",
    
      location:
        "Occidental Mindoro, Philippines",
    
      availability:
        "available",
    
      shortIntroduction:
        "I am an Information Technology graduate with professional experience in database management, data encoding, digital records organization and multimedia support.",
    
      aboutDescription:
        "I have experience maintaining digital information systems, organizing documents and files, managing spreadsheets, encoding records and supporting office operations. I also provide photo editing, product image preparation and other multimedia services. I value accuracy, organization, reliability and continuous learning.",
    
      featuredRoles: [
        "Data Entry Specialist",
        "Database Management",
        "Photo Editor"
      ],
    
      sectionVisible:
        true,

      status:
        "published",

      visible:
        true,
    
      showAvailability:
        true
    };
    
    /* =========================================================
      3. DATA CLEANING
      Ensures only the expected fields are sent to Firestore.
      ========================================================= */
    
    function normalizeText(
      value,
      fallback = ""
    ) {
      if (typeof value !== "string") {
        return fallback;
      }
    
      return value.trim();
    }
    
    function normalizeBoolean(
      value,
      fallback = false
    ) {
      return typeof value === "boolean"
        ? value
        : fallback;
    }
    
    function normalizeRoles(value) {
      if (!Array.isArray(value)) {
        return [];
      }
    
      return value
        .filter((role) => {
          return typeof role === "string";
        })
        .map((role) => {
          return role.trim();
        })
        .filter(Boolean);
    }
    
    function normalizeProfileData(data = {}) {
      return {
        fullName:
          normalizeText(
            data.fullName || data.name || data.profileName,
            defaultProfileData.fullName
          ),
    
        displayName:
          normalizeText(
            data.displayName,
            defaultProfileData.displayName
          ),
    
        professionalTitle:
          normalizeText(
            data.professionalTitle,
            defaultProfileData.professionalTitle
          ),
    
        location:
          normalizeText(
            data.location || data.profileLocation,
            defaultProfileData.location
          ),
    
        availability:
          normalizeText(
            data.availability || data.availabilityStatus,
            defaultProfileData.availability
          ),
    
        shortIntroduction:
          normalizeText(
            data.shortIntroduction,
            defaultProfileData.shortIntroduction
          ),
    
        aboutDescription:
          normalizeText(
            data.aboutDescription || data.biography || data.bio || data.about,
            defaultProfileData.aboutDescription
          ),
    
        featuredRoles:
          normalizeRoles(
            data.featuredRoles
          ),
    
        sectionVisible:
          typeof data.sectionVisible === "boolean"
            ? data.sectionVisible
            : typeof data.aboutVisible === "boolean"
              ? data.aboutVisible
              : normalizeBoolean(data.visible, true),

        status:
          normalizeText(data.status).toLowerCase() === "draft"
            ? "draft"
            : "published",

        // The profile document remains publicly readable because Contact and
        // other public surfaces reuse profile-owned fields such as location and
        // availability. About section visibility is controlled independently by
        // sectionVisible.
        visible:
          typeof data.visible === "boolean"
            ? data.visible
            : true,
    
        showAvailability:
          normalizeBoolean(
            data.showAvailability,
            true
          )
      };
    }
    
    /* =========================================================
      4. LOAD PROFILE
      Reads the About information from Firestore.
      ========================================================= */
    
    export async function loadProfile() {
      try {
        const profileSnapshot =
          await getDoc(profileReference);
    
        /*
          If the Firestore document does not exist yet,
          return the default information.
        */
    
        if (!profileSnapshot.exists()) {
          return {
            ...defaultProfileData,
            exists: false
          };
        }
    
        const firestoreData =
          profileSnapshot.data();
    
        return {
          ...defaultProfileData,
          ...normalizeProfileData(
            firestoreData
          ),
    
          exists: true,
    
          updatedAt:
            firestoreData.updatedAt || null
        };
      } catch (error) {
        console.error(
          "Unable to load profile from Firestore:",
          error
        );
    
        throw new Error(
          "The profile information could not be loaded."
        );
      }
    }
    
    /* =========================================================
      5. SAVE PROFILE
      Creates or updates portfolio/profile in Firestore.
      ========================================================= */
    
    export async function saveProfile(
      profileData
    ) {
      try {
        const existingSnapshot = await getDoc(profileReference);
        const existingData = existingSnapshot.exists()
          ? existingSnapshot.data()
          : {};

        const cleanProfileData = normalizeProfileData({
          ...existingData,
          ...profileData,
          // sectionVisible hides only the About presentation. Keep the shared
          // profile source public so Contact can continue reading its owner data.
          visible: true
        });
    
        const dataToSave = {
          ...cleanProfileData,
          updatedAt:
            serverTimestamp()
        };
    
        await setDoc(
          profileReference,
          dataToSave,
          {
            merge: true
          }
        );
    
        return {
          success: true,
          data: cleanProfileData
        };
      } catch (error) {
        console.error(
          "Unable to save profile to Firestore:",
          error
        );
    
        throw new Error(
          "The profile information could not be saved."
        );
      }
    }
    
    /* =========================================================
      6. DOCUMENT EXISTENCE CHECK
      Useful later for first-time CMS setup.
      ========================================================= */
    
    export async function profileExists() {
      try {
        const profileSnapshot =
          await getDoc(profileReference);
    
        return profileSnapshot.exists();
      } catch (error) {
        console.error(
          "Unable to check the profile document:",
          error
        );
    
        return false;
      }
    }