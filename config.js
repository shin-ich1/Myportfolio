/* =========================================================
   LΛN PORTFOLIO
   Shared Application Configuration

   Services
   - Firebase Authentication
   - Cloud Firestore
   - Cloudinary Uploads

   This file provides DEFAULT values.

   In the future, the CMS can load remote settings from
   Firestore (settings/cloudinary) without requiring any
   changes to the rest of the application.
========================================================= */

/* =========================================================
   FIREBASE
========================================================= */

export const firebaseConfig = {
  apiKey: "AIzaSyA25wR_Yi271kAW7KIFzi5WQIX8iLJfW0I",
  authDomain: "rolando-portfolio-3f1a3.firebaseapp.com",
  projectId: "rolando-portfolio-3f1a3",
  storageBucket: "rolando-portfolio-3f1a3.firebasestorage.app",
  messagingSenderId: "107070190278",
  appId: "1:107070190278:web:dec9a7e024357492f19dc7"
};

/*
  Firebase Storage is intentionally NOT used.

  All portfolio media uploads are handled by Cloudinary.
*/


/* =========================================================
   GLOBAL MEDIA SETTINGS
   =========================================================

   This object is the default source for the reusable media
   settings provider exposed by cloudinaryService.js. A future
   Admin Settings loader can replace these values at runtime
   without changing feature modules.
*/
export const mediaSettingsConfig = Object.freeze({
  version: 1,
  provider: "cloudinary",
  folders: Object.freeze({
    root: "lan-portfolio",
    projectCovers: "projects/covers",
    projectLogos: "projects/logos",
    projectScreenshots: "projects/screenshots",
    projectVideos: "projects/videos",
    projectDocuments: "projects/documents",
    projectSources: "projects/source-files",
    projectAssets: "projects/assets"
  }),
  limitsMB: Object.freeze({
    image: 10,
    logo: 5,
    video: 100,
    pdf: 25,
    source: 100,
    asset: 100
  }),
  allowedTypes: Object.freeze({
    image: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
    logo: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
    video: Object.freeze(["video/mp4"]),
    pdf: Object.freeze(["application/pdf"]),
    source: Object.freeze([
      "application/zip",
      "application/x-zip-compressed",
      "application/octet-stream"
    ]),
    asset: Object.freeze([])
  }),
  transformations: Object.freeze({
    imageDelivery: "f_auto,q_auto",
    projectCard: "f_auto,q_auto,c_fill,g_auto,w_900,h_560",
    projectPreview: "f_auto,q_auto,c_limit,w_1800,h_1200",
    videoPoster: "f_auto,q_auto,so_auto,c_fill,g_auto,w_1280,h_720"
  }),
  modules: Object.freeze({
    projects: Object.freeze({
      coverRequired: true,
      maxGalleryItems: 12,
      supportedMediaTypes: Object.freeze([
        "cover-only",
        "cover-mp4",
        "cover-external-video",
        "cover-pdf",
        "cover-source-files",
        "custom-assets"
      ])
    })
  }),
  remoteSettings: Object.freeze({
    enabled: false,
    collection: "settings",
    document: "media"
  })
});

/* =========================================================
   PORTFOLIO MODULE REGISTRY
   =========================================================

   Core linked modules are declared here. Custom modules are
   discovered from portfolioSections at runtime, so Projects
   does not require a new hard-coded registry entry for them.
*/
export const portfolioModuleRegistry = Object.freeze([
  Object.freeze({
    key: "photo-editing",
    label: "Photo Editing",
    collection: "photoEditingProjects",
    titleFields: Object.freeze(["title"]),
    summaryFields: Object.freeze(["shortDescription", "description"]),
    categoryFields: Object.freeze(["category"]),
    entryMetaFields: Object.freeze(["projectDisplayType", "displayType"]),
    coverFields: Object.freeze(["coverImage", "coverImageUrl", "thumbnail", "primaryImage", "afterImage", "afterImageUrl", "singleImage", "singleImageUrl", "galleryImages"]),
    tagFields: Object.freeze(["tags", "software", "techniques", "skills"]),
    statusFields: Object.freeze(["status"]),
    publishedValues: Object.freeze(["draft", "published", "featured"]),
    visibleFields: Object.freeze(["visible"]),
    deletedFields: Object.freeze(["deletedAt", "isDeleted", "deleted"]),
    archivedFields: Object.freeze(["archivedAt", "isArchived", "archived"]),
    publicDestination: "#photo-editing",
    adminDestination: "photo-editing.html",
    linkScope: "module",
    defaultButtonLabel: "View Portfolio",
    icon: "▧",
    active: true
  }),
  Object.freeze({
    key: "experience",
    label: "Experience",
    collection: "experiences",
    titleFields: Object.freeze(["role", "position", "jobTitle", "title"]),
    summaryFields: Object.freeze(["summary", "shortDescription", "description", "company"]),
    categoryFields: Object.freeze(["category", "employmentType", "workSetup", "workArrangement"]),
    entryMetaFields: Object.freeze(["company", "startDate", "endDate", "workSetup", "workArrangement"]),
    coverFields: Object.freeze(["coverImage", "coverImageUrl", "image", "imageUrl", "thumbnail", "primaryImage", "companyLogo"]),
    tagFields: Object.freeze(["skills", "tools", "technologies", "tags"]),
    statusFields: Object.freeze(["status"]),
    publishedValues: Object.freeze(["draft", "published", "featured"]),
    visibleFields: Object.freeze(["visible"]),
    deletedFields: Object.freeze(["deletedAt", "isDeleted", "deleted"]),
    archivedFields: Object.freeze(["archivedAt", "isArchived", "archived"]),
    publicDestination: "#experience",
    adminDestination: "experience.html",
    linkScope: "entry",
    defaultButtonLabel: "View Experience",
    icon: "▣",
    active: true
  })
]);


/* =========================================================
   SECURE TELEMETRY BRIDGE
   =========================================================
   Cloudinary account usage requires a server-side secret.
   Local development uses the Cloudflare Worker dev server.
   After free Workers deployment, place its /telemetry URL in
   productionUrl. No API secret belongs in this file.
========================================================= */
export const telemetryBridgeConfig = Object.freeze({
  localUrl: "http://127.0.0.1:8787/telemetry",
  productionUrl: ""
});

/* =========================================================
   DEFAULT CLOUDINARY CONFIGURATION
========================================================= */

export const cloudinaryConfig = {

  /*
   * Cloudinary Account
   */
  cloudName: "fmbcpufk",

  /*
   * Unsigned Upload Preset
   */
  uploadPreset: "lan_portfolio_unsigned",

  /*
   * Base folder for every CMS module.
   *
   * Example:
   *
   * lan-portfolio/
   *      photo-editing/
   *      projects/
   *      profile/
   *      certificates/
   *      resume/
   */
  baseFolder: mediaSettingsConfig.folders.root,

  /*
   * ======================================================
   * DEFAULT Upload Limit
   * ======================================================
   *
   * Every upload validation in the CMS reads THIS value.
   *
   * When upgrading Cloudinary, simply change:
   *
   * 10
   * ↓
   * 20
   * ↓
   * 40
   *
   * Future Version:
   *
   * This value can automatically be replaced by
   * Firestore Settings without changing any other code.
   */

  maxUploadSizeMB: mediaSettingsConfig.limitsMB.image,

  /*
   * Allowed MIME Types
   */

  allowedImageTypes: [...mediaSettingsConfig.allowedTypes.image],

  allowedVideoTypes: [...mediaSettingsConfig.allowedTypes.video],
  maxVideoUploadSizeMB: mediaSettingsConfig.limitsMB.video,

  /*
   * ======================================================
   * FUTURE FIRESTORE SETTINGS
   * ======================================================
   *
   * These are NOT used yet.
   *
   * They are placeholders so the entire CMS can later
   * load settings dynamically from Firestore.
   *
   * Nothing else in your code needs to change when
   * that upgrade happens.
   */

  remoteSettings: {

    enabled: false,

    collection: "settings",

    document: "cloudinary"

  }

};

/* =========================================================
   LEGACY COMPATIBILITY
========================================================= */

if (typeof window !== "undefined") {

  window.FIREBASE_CONFIG = firebaseConfig;

  window.CLOUDINARY_CONFIG = cloudinaryConfig;

}

/* =========================================================
   EXPORTS
========================================================= */

export default firebaseConfig;