/* =========================================================
   LΛN PORTFOLIO CMS
   Reusable Cloudinary Media Upload Service

   Architecture:
   - Browser uploads use an unsigned upload preset.
   - No API key or API secret is exposed.
   - Firestore stores only the returned media metadata.
   - Uploaded assets are temporary until a successful CMS save commits them.
   - Permanent deletion uses the authenticated telemetry worker backend.
   ========================================================= */

   import { cloudinaryConfig, mediaSettingsConfig } from "../../config.js";
   import { resolvePortfolioUploadResource, validatePortfolioFileDescriptor } from "../../file-type-registry.js";
   import { registerTemporaryMediaAsset } from "./mediaAssetLifecycleService.js";

   /* =========================================================
      CONFIGURATION
      ========================================================= */
   
   const {
     cloudName,
     uploadPreset,
     baseFolder = "lan-portfolio",
     maxUploadSizeMB,
     allowedImageTypes = [
       "image/jpeg",
       "image/png",
       "image/webp"
     ],
     allowedVideoTypes = ["video/mp4"],
     maxVideoUploadSizeMB = 100
   } = cloudinaryConfig;
   
   const BYTES_PER_MEGABYTE = 1024 * 1024;
   
   const maxImageSizeBytes =
     Number(maxUploadSizeMB) * BYTES_PER_MEGABYTE;
   
   const CLOUDINARY_UPLOAD_URL =
     `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

   const CLOUDINARY_VIDEO_UPLOAD_URL =
     `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`;

   const CLOUDINARY_RAW_UPLOAD_URL =
     `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;
   
   /* =========================================================
      CONFIGURATION VALIDATION
      ========================================================= */
   
   function validateConfiguration() {
     if (!cloudName || typeof cloudName !== "string") {
       throw new Error("Cloudinary cloud name is missing from config.js.");
     }
   
     if (!uploadPreset || typeof uploadPreset !== "string") {
       throw new Error(
         "Cloudinary unsigned upload preset is missing from config.js."
       );
     }
   
     if (
       !Number.isFinite(Number(maxUploadSizeMB)) ||
       Number(maxUploadSizeMB) <= 0
     ) {
       throw new Error(
         "Cloudinary maxUploadSizeMB must be a positive number in config.js."
       );
     }
   }
   
   /* =========================================================
      FILE HELPERS
      ========================================================= */
   
   function formatFileSize(bytes = 0) {
     if (!Number.isFinite(bytes) || bytes <= 0) {
       return "0 MB";
     }
   
     return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
   }
   
   function normalizeFolder(folder = "") {
     const cleanBaseFolder = String(baseFolder)
       .trim()
       .replace(/^\/+|\/+$/g, "");
   
     const cleanSubfolder = String(folder)
       .trim()
       .replace(/^\/+|\/+$/g, "")
       .replace(/\/{2,}/g, "/");
   
     return cleanSubfolder
       ? `${cleanBaseFolder}/${cleanSubfolder}`
       : cleanBaseFolder;
   }
   
   function normalizeProgress(value) {
     const progress = Number(value);
   
     if (!Number.isFinite(progress)) {
       return 0;
     }
   
     return Math.max(0, Math.min(100, Math.round(progress)));
   }
   
   /* =========================================================
      IMAGE VALIDATION
      ========================================================= */
   
   /**
    * Validates an image before it is uploaded.
    *
    * @param {File} file
    * @returns {true}
    * @throws {Error}
    */
   export function validateImage(file) {
     validateConfiguration();
   
     if (!(file instanceof File)) {
       throw new Error("Please choose an image file.");
     }
   
     if (!allowedImageTypes.includes(file.type)) {
       throw new Error("Only JPG, PNG, and WebP images are allowed.");
     }
   
     if (!file.size) {
       throw new Error("The selected image is empty or invalid.");
     }
   
     if (file.size > maxImageSizeBytes) {
       throw new Error(
         `The image must be ${Number(maxUploadSizeMB).toFixed(2)} MB or smaller. ` +
         `Selected file: ${formatFileSize(file.size)}.`
       );
     }
   
     return true;
   }
   
   /* =========================================================
      CLOUDINARY RESPONSE
      ========================================================= */
   
   function createMediaMetadata(result = {}, originalFile = null) {
     if (!result.secure_url || !result.public_id) {
       throw new Error(
         "Cloudinary returned an incomplete upload response."
       );
     }
   
     return {
       url: result.secure_url,
       secureUrl: result.secure_url,
       publicId: result.public_id,
       assetId: result.asset_id || "",
       resourceType: result.resource_type || "image",
       type: result.type || "upload",
       format: result.format || "",
       width: Number(result.width) || 0,
       height: Number(result.height) || 0,
       bytes: Number(result.bytes) || 0,
       version: Number(result.version) || 0,
       folder: result.asset_folder || "",
       displayName: result.display_name || "",
       originalFilename:
         result.original_filename ||
         originalFile?.name ||
         "",
       name: originalFile?.name || result.original_filename || result.display_name || "",
       mimeType: originalFile?.type || "",
       uploadedAt: result.created_at || new Date().toISOString()
     };
   }
   
   function getCloudinaryError(xhr) {
     let message = "Cloudinary upload failed.";
   
     try {
       const response = JSON.parse(xhr.responseText);
   
       if (response?.error?.message) {
         message = response.error.message;
       }
     } catch {
       if (xhr.statusText) {
         message = `${message} ${xhr.statusText}`;
       }
     }
   
     if (xhr.status === 0) {
       message =
         "The upload could not connect to Cloudinary. Check your internet connection.";
     }
   
     if (xhr.status === 400 && !message.toLowerCase().includes("preset")) {
       message = `Cloudinary rejected the upload: ${message}`;
     }
   
     return new Error(message);
   }

   /* =========================================================
      IMAGE UPLOAD
      ========================================================= */
   
   /**
    * Uploads one image to Cloudinary.
    *
    * @param {File} file
    * @param {string} folder
    * @param {(progress: number) => void} onProgress
    * @returns {Promise<object>}
    */
   
   export function uploadImage(
     file,
     folder = "",
     onProgress = () => {},
     options = {}
   ) {
     validateImage(file);
   
     const targetFolder = normalizeFolder(folder);
     const formData = new FormData();
   
     formData.append("file", file);
     formData.append("upload_preset", uploadPreset);
   
     if (targetFolder) {
       formData.append("asset_folder", targetFolder);
     }
   
     return new Promise((resolve, reject) => {
       const xhr = new XMLHttpRequest();    xhr.upload.addEventListener("progress", event => {
        if (!event.lengthComputable) {
          return;
        }
  
        const progress = normalizeProgress(
          (event.loaded / event.total) * 100
        );
  
        onProgress(progress);
      });
  
      xhr.addEventListener("load", () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(getCloudinaryError(xhr));
          return;
        }
  
        try {
          const response = JSON.parse(xhr.responseText);
          const media = createMediaMetadata(response, file);
          if (options.registerTemporary !== false) registerTemporaryMediaAsset(media);
  
          onProgress(100);
          resolve(media);
        } catch (error) {
          reject(error instanceof Error
              ? error
              : new Error("Cloudinary returned an invalid response."));
        }
      });
  
      xhr.addEventListener("error", () => {
        reject(new Error(
            "A network error interrupted the Cloudinary upload."
          ));
      });
  
      xhr.addEventListener("abort", () => {
        reject(new Error("The Cloudinary upload was cancelled."));
      });
  
      xhr.addEventListener("timeout", () => {
        reject(new Error(
            "The Cloudinary upload timed out. Please try again."
          ));
      });
  
      xhr.open("POST", CLOUDINARY_UPLOAD_URL, true);
  
      /*
        Two-minute timeout for slower internet connections.
      */
      xhr.timeout = 120000;
  
      xhr.send(formData);
    });
  }
  
  export function validateVideo(file) {
    validateConfiguration();
    if (!(file instanceof File)) throw new Error("Please choose an MP4 video file.");
    if (!allowedVideoTypes.includes(file.type)) throw new Error("Only MP4 video files are allowed.");
    if (!file.size) throw new Error("The selected video is empty or invalid.");
    const maximum = Number(maxVideoUploadSizeMB) * BYTES_PER_MEGABYTE;
    if (file.size > maximum) throw new Error(`The video must be ${Number(maxVideoUploadSizeMB).toFixed(0)} MB or smaller. Selected file: ${formatFileSize(file.size)}.`);
    return true;
  }

  export function uploadVideo(file, folder = "", onProgress = () => {}, options = {}) {
    validateVideo(file);
    const targetFolder = normalizeFolder(folder);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", uploadPreset);
    if (targetFolder) formData.append("asset_folder", targetFolder);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", event => { if (event.lengthComputable) onProgress(normalizeProgress((event.loaded / event.total) * 100)); });
      xhr.addEventListener("load", () => {
        if (xhr.status < 200 || xhr.status >= 300) return reject(getCloudinaryError(xhr));
        try { const response = JSON.parse(xhr.responseText); const media = createMediaMetadata(response, file); if (options.registerTemporary !== false) registerTemporaryMediaAsset(media); onProgress(100); resolve(media); }
        catch (error) { reject(error instanceof Error ? error : new Error("Cloudinary returned an invalid response.")); }
      });
      xhr.addEventListener("error", () => reject(new Error("A network error interrupted the Cloudinary upload.")));
      xhr.addEventListener("abort", () => reject(new Error("The Cloudinary upload was cancelled.")));
      xhr.addEventListener("timeout", () => reject(new Error("The Cloudinary upload timed out. Please try again.")));
      xhr.open("POST", CLOUDINARY_VIDEO_UPLOAD_URL, true);
      xhr.timeout = 300000;
      xhr.send(formData);
    });
  }

  /* =========================================================
     MULTIPLE IMAGE UPLOADS
     ========================================================= */
  
  /**
   * Uploads multiple images one at a time.
   *
   * Sequential uploading is intentional because it reduces
   * bandwidth spikes and works better on slower connections.
   *
   * @param {File[]} files
   * @param {string} folder
   * @param {(details: object) => void} onProgress
   * @returns {Promise<object[]>}
   */
  export async function uploadImages(
    files,
    folder = "",
    onProgress = () => {}
  ) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("Please choose at least one image.");
    }
  
    const uploadedMedia = [];
  
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
  
      const media = await uploadImage(
        file,
        folder,
        fileProgress => {
          const overallProgress =
            ((index + fileProgress / 100) / files.length) * 100;
  
          onProgress({
            currentFile: index + 1,
            totalFiles: files.length,
            fileName: file.name,
            fileProgress: normalizeProgress(fileProgress),
            overallProgress: normalizeProgress(overallProgress)
          });
        }
      );
  
      uploadedMedia.push(media);
    }
  
    return uploadedMedia;
  }
  
  /* =========================================================
     DELIVERY URL HELPERS
     ========================================================= */
  
  /**
   * Adds safe automatic optimization to a Cloudinary URL.
   *
   * This does not upload or modify the original image.
   * It changes only the delivered version.
   *
   * @param {string} url
   * @returns {string}
   */
  export function getOptimizedImageUrl(url = "") {
    const value = String(url).trim();
  
    if (!value.includes("/upload/")) {
      return value;
    }
  
    return value.replace(
      "/upload/",
      "/upload/f_auto,q_auto/"
    );
  }
  
  /**
   * Creates an optimized thumbnail URL.
   *
   * @param {string} url
   * @param {number} width
   * @param {number} height
   * @returns {string}
   */
  export function getThumbnailUrl(
    url = "",
    width = 800,
    height = 500
  ) {
    const value = String(url).trim();
  
    if (!value.includes("/upload/")) {
      return value;
    }
  
    const safeWidth = Math.max(100, Math.round(Number(width) || 800));
    const safeHeight = Math.max(100, Math.round(Number(height) || 500));
  
    const transformation =
      `f_auto,q_auto,c_fit,w_${safeWidth},h_${safeHeight}`;
  
    return value.replace(
      "/upload/",
      `/upload/${transformation}/`
    );
  }
  


  /* =========================================================
     GLOBAL MEDIA SETTINGS PROVIDER
     ========================================================= */

  let runtimeMediaSettings = mediaSettingsConfig;
  let mediaSettingsLoader = null;
  const mediaSettingsSubscribers = new Set();

  function cloneSettings(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function mergeSettings(base, overrides) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      return base;
    }

    const output = { ...base };
    Object.entries(overrides).forEach(([key, value]) => {
      output[key] = value && typeof value === "object" && !Array.isArray(value)
        ? mergeSettings(base?.[key] || {}, value)
        : value;
    });
    return output;
  }

  export function getMediaSettings(moduleName = "global") {
    const settings = cloneSettings(runtimeMediaSettings);
    return moduleName === "global"
      ? settings
      : {
          ...settings,
          module: cloneSettings(settings.modules?.[moduleName] || {})
        };
  }

  export function configureMediaSettingsSource(loader) {
    mediaSettingsLoader = typeof loader === "function" ? loader : null;
  }

  export async function refreshMediaSettings() {
    if (!mediaSettingsLoader) {
      return getMediaSettings();
    }

    const remoteSettings = await mediaSettingsLoader();
    runtimeMediaSettings = mergeSettings(mediaSettingsConfig, remoteSettings);
    const snapshot = getMediaSettings();
    mediaSettingsSubscribers.forEach((subscriber) => subscriber(snapshot));
    return snapshot;
  }

  export function subscribeMediaSettings(subscriber) {
    if (typeof subscriber !== "function") return () => {};
    mediaSettingsSubscribers.add(subscriber);
    return () => mediaSettingsSubscribers.delete(subscriber);
  }

  function mediaRule(kind = "asset", moduleName = "global") {
    const settings = getMediaSettings(moduleName);
    const normalizedKind = String(kind || "asset").trim().toLowerCase();
    return {
      kind: normalizedKind,
      limitMB: Number(settings.limitsMB?.[normalizedKind] || settings.limitsMB?.asset || 100),
      allowedTypes: Array.isArray(settings.allowedTypes?.[normalizedKind])
        ? settings.allowedTypes[normalizedKind]
        : [],
      settings
    };
  }

  export function validateMediaFile(file, kind = "asset", moduleName = "global") {
    if (!(file instanceof File)) throw new Error("Please choose a valid file.");
    const descriptorValidation = validatePortfolioFileDescriptor(file);
    if (!descriptorValidation.valid) throw new Error(descriptorValidation.reason || "The selected file is invalid.");
    const rule = mediaRule(kind, moduleName);
    if (rule.allowedTypes.length && !rule.allowedTypes.includes(file.type)) {
      throw new Error(`The selected ${rule.kind} file type is not supported.`);
    }
    if (file.size > rule.limitMB * BYTES_PER_MEGABYTE) {
      throw new Error(`The ${rule.kind} file must be ${rule.limitMB} MB or smaller. Selected file: ${formatFileSize(file.size)}.`);
    }
    return true;
  }

  function uploadEndpoint(resourceType) {
    if (resourceType === "video") return CLOUDINARY_VIDEO_UPLOAD_URL;
    if (resourceType === "raw") return CLOUDINARY_RAW_UPLOAD_URL;
    return CLOUDINARY_UPLOAD_URL;
  }

  export function uploadMedia(file, {
    kind = "asset",
    module = "global",
    folder = "",
    resourceType = "auto",
    onProgress = () => {},
    registerTemporary = true
  } = {}) {
    validateConfiguration();
    validateMediaFile(file, kind, module);
    const normalizedResourceType = resolvePortfolioUploadResource(file, resourceType);
    const targetFolder = normalizeFolder(folder);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", uploadPreset);
    if (targetFolder) formData.append("asset_folder", targetFolder);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(normalizeProgress((event.loaded / event.total) * 100));
      });
      xhr.addEventListener("load", () => {
        if (xhr.status < 200 || xhr.status >= 300) return reject(getCloudinaryError(xhr));
        try {
          const response = JSON.parse(xhr.responseText);
          const media = createMediaMetadata(response, file);
          if (registerTemporary !== false) registerTemporaryMediaAsset(media);
          onProgress(100);
          resolve(media);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Cloudinary returned an invalid response."));
        }
      });
      xhr.addEventListener("error", () => reject(new Error("A network error interrupted the Cloudinary upload.")));
      xhr.addEventListener("abort", () => reject(new Error("The Cloudinary upload was cancelled.")));
      xhr.addEventListener("timeout", () => reject(new Error("The Cloudinary upload timed out. Please try again.")));
      xhr.open("POST", uploadEndpoint(normalizedResourceType), true);
      xhr.timeout = normalizedResourceType === "video" ? 300000 : 180000;
      xhr.send(formData);
    });
  }


  export function uploadImageRaw(file, folder = "", onProgress = () => {}) {
    return uploadImage(file, folder, onProgress, { registerTemporary: false });
  }

  export function uploadVideoRaw(file, folder = "", onProgress = () => {}) {
    return uploadVideo(file, folder, onProgress, { registerTemporary: false });
  }

  export function uploadMediaRaw(file, options = {}) {
    return uploadMedia(file, { ...options, registerTemporary: false });
  }

  export function detectExternalVideoProvider(value = "") {
    const url = String(value || "").trim();
    if (!url) return { provider: "", url: "", embedUrl: "", posterUrl: "" };
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (host.includes("youtube.com") || host.includes("youtu.be")) {
        const id = host.includes("youtu.be")
          ? parsed.pathname.split("/").filter(Boolean)[0]
          : parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1);
        return { provider: "youtube", url, embedUrl: id ? `https://www.youtube-nocookie.com/embed/${id}` : "", posterUrl: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "" };
      }
      if (host.includes("vimeo.com")) {
        const id = parsed.pathname.split("/").filter(Boolean).at(-1);
        return { provider: "vimeo", url, embedUrl: id ? `https://player.vimeo.com/video/${id}` : "", posterUrl: "" };
      }
      if (host.includes("drive.google.com")) return { provider: "google-drive", url, embedUrl: url.replace(/\/view(?:\?.*)?$/, "/preview"), posterUrl: "" };
      if (host.includes("dropbox.com")) return { provider: "dropbox", url, embedUrl: url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[?&]dl=0/, ""), posterUrl: "" };
      if (host.includes("onedrive.live.com") || host.includes("1drv.ms")) return { provider: "onedrive", url, embedUrl: url, posterUrl: "" };
      if (/\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search)) return { provider: "direct-mp4", url, embedUrl: url, posterUrl: "" };
      if (host.includes("cloudinary.com") || host.includes("res.cloudinary.com")) return { provider: "cloudinary", url, embedUrl: url, posterUrl: getVideoPosterUrl(url) };
      return { provider: "external", url, embedUrl: url, posterUrl: "" };
    } catch {
      return { provider: "invalid", url, embedUrl: "", posterUrl: "" };
    }
  }

  export function getVideoPosterUrl(url = "") {
    const value = String(url || "").trim();
    if (!value.includes("/upload/") || !/\.(mp4|mov|webm)(?:$|\?)/i.test(value)) return "";
    const transformation = getMediaSettings().transformations?.videoPoster || "f_auto,q_auto,so_auto,c_fill,g_auto,w_1280,h_720";
    return value.replace("/upload/", `/upload/${transformation}/`).replace(/\.(mp4|mov|webm)(?=$|\?)/i, ".jpg");
  }

  /* =========================================================
     STORAGE LIFECYCLE SECURITY
     ========================================================= */
  
  /*
    Uploads are registered as temporary by mediaAssetLifecycleService.
    That service talks only to the authenticated server-side worker for
    deletion. The Cloudinary API Secret never enters browser JavaScript.
  */
  
  /* END OF FILE */