/* =========================================================
   LΛN PORTFOLIO CMS
   Dashboard JavaScript
   ========================================================= */

/* =========================================================
   1. FIREBASE IMPORTS
   Uses the shared Firebase service.
   ========================================================= */

  import {
    collection,
    getCountFromServer
  } from
    "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
  
  import {
    db
  } from "../services/firebase.js";

  import {
    cloudinaryConfig
  } from "../../config.js";

  import {
    buildDashboardGreeting,
    getDashboardGreetingName,
    getPortfolioPassName,
    GREETING_NAME_KEY,
    PORTFOLIO_PASS_NAME_KEY
  } from "./dashboardGreeting.js";
  
  /* =========================================================
     2. CONSTANT VALUES
     ========================================================= */
  
  const LIVE_PORTFOLIO_URL =
    "https://rolando-portfolio-3f1a3.web.app";
  
  const ACTIVITY_STORAGE_KEY =
    "lanPortfolioRecentActivity";

  const DASHBOARD_VISUAL_KEY = "lan-cms-dashboard-visual";
  const DASHBOARD_VISUAL_MODE_KEY = "lan-cms-dashboard-visual-mode";
  
  /* =========================================================
     3. HTML ELEMENTS
     ========================================================= */
  
  const addContentButton =
    document.getElementById("addContentButton");
  
  const copyPortfolioLinkButton =
    document.getElementById("copyPortfolioLinkButton");
  
  const clearActivityButton =
    document.getElementById("clearActivityButton");
  
  const activityList =
    document.getElementById("activityList");
  
  const lastAccessText =
    document.getElementById("lastAccessText");

  const welcomeTitle =
    document.getElementById("welcomeTitle");

  const dashboardHeroImage =
    document.getElementById("dashboardHeroImage");
  
  const authenticationStatus =
    document.getElementById("authenticationStatus");
  
  const firestoreStatus =
    document.getElementById("firestoreStatus");
  
  const experienceCount =
    document.getElementById("experienceCount");
  
  const projectCount =
    document.getElementById("projectCount");
  
  const photoSampleCount =
    document.getElementById("photoSampleCount");
  
  const resumeCount =
    document.getElementById("resumeCount");

  const educationLibraryCount = document.getElementById("educationLibraryCount");
  const skillsLibraryCount = document.getElementById("skillsLibraryCount");
  const certificateLibraryCount = document.getElementById("certificateLibraryCount");
  const cloudinaryPhotoCount = document.getElementById("cloudinaryPhotoCount");
  const cloudinaryPdfCount = document.getElementById("cloudinaryPdfCount");
  const cloudinaryCloudName = document.getElementById("cloudinaryCloudName");
  const cloudinaryStatus = document.getElementById("cloudinaryStatus");
  const cloudinaryTrackedTotal = document.getElementById("cloudinaryTrackedTotal");
  const cloudinaryMediaRing = document.getElementById("cloudinaryMediaRing");
  const analyticsTotalCount = document.getElementById("analyticsTotalCount");
  const dashboardContentMixRing = document.getElementById("dashboardContentMixRing");
  const dashboardMediaCount = document.getElementById("dashboardMediaCount");
  const dashboardMediaLegendCount = document.getElementById("dashboardMediaLegendCount");
  const dashboardStructuredCount = document.getElementById("dashboardStructuredCount");
  const systemHealthRing = document.getElementById("systemHealthRing");
  const systemHealthScore = document.getElementById("systemHealthScore");
  const systemHealthHeadline = document.getElementById("systemHealthHeadline");
  const workspaceFocusTitle = document.getElementById("workspaceFocusTitle");
  const workspaceFocusDetail = document.getElementById("workspaceFocusDetail");
  const workspaceFocusTime = document.getElementById("workspaceFocusTime");
  const workspaceFocusGlyph = document.getElementById("workspaceFocusGlyph");
  
  const managementCards =
    document.querySelectorAll("[data-manager]");
  
  const navigationLinks =
    document.querySelectorAll(
      ".navigation-link[data-section]"
    );
  
  const previewButtons =
    document.querySelectorAll(
      '[data-action="preview-portfolio"]'
    );
  
  const githubLinks =
    document.querySelectorAll(
      '[data-action="open-github"]'
    );
  
  /* =========================================================
     4. NOTIFICATION SYSTEM
     ========================================================= */
  
  let notificationTimer = null;
  
  function showNotification(message) {
  const tone = "info";
  window.LANNotice?.({ title: "Dashboard", message, tone });
}
  
  /* =========================================================
     5. SHARED ADMIN SHELL
     Sidebar / topbar state is owned exclusively by admin-ui.js.
     ========================================================= */

  const closeSidebar = () => {
    window.LANAdminShell?.closeNavigation?.();
  };

  function updateDashboardVisualShape() {
    if (!dashboardHeroImage) return;

    const visual = dashboardHeroImage.closest(".welcome-visual");
    const width = Number(dashboardHeroImage.naturalWidth || 0);
    const height = Number(dashboardHeroImage.naturalHeight || 0);
    if (!visual || !width || !height) return;

    const ratio = width / height;
    visual.dataset.visualShape =
      ratio < 0.9 ? "portrait" :
      ratio < 1.18 ? "square" :
      ratio > 2.15 ? "panorama" :
      "landscape";
  }

  function bindDashboardVisualShape() {
    if (!dashboardHeroImage) return;
    dashboardHeroImage.addEventListener("load", updateDashboardVisualShape);
    if (dashboardHeroImage.complete) updateDashboardVisualShape();
  }

  function applyDashboardVisualPreference() {
    if (!dashboardHeroImage) return;

    let saved = "";
    try {
      saved = localStorage.getItem(DASHBOARD_VISUAL_KEY) || "";
    } catch (_) {
      saved = "";
    }

    const source = saved || dashboardHeroImage.dataset.defaultSrc || "../assets/images/editor-workstation.png";
    const visual = document.querySelector(".welcome-visual");
    if (visual) {
      visual.dataset.visualMode = saved ? "custom" : "default";
      visual.dataset.visualShape = "loading";
      const resolvedEdgeSource = new URL(String(source), document.baseURI).href;
      const safeSource = JSON.stringify(resolvedEdgeSource);
      visual.style.setProperty("--dashboard-edge-image", `url(${safeSource})`);
    }
    dashboardHeroImage.src = source;
    if (dashboardHeroImage.complete) updateDashboardVisualShape();
  }


  function displayPortfolioPassName() {
    const node = document.getElementById("portfolioPassName");
    if (node) node.textContent = getPortfolioPassName("LΛN");
  }

  function bindCommandWallet() {
    const wallet = document.querySelector("[data-command-wallet]");
    if (!wallet) return;

    const faces = wallet.querySelectorAll(".command-wallet-face");

    const setFlipped = (flipped) => {
      wallet.classList.toggle("is-flipped", flipped);
      faces.forEach((face, index) => {
        const active = flipped ? index === 1 : index === 0;
        face.setAttribute("aria-hidden", String(!active));
      });
    };

    const toggleWallet = () => {
      setFlipped(!wallet.classList.contains("is-flipped"));
    };

    wallet.addEventListener("click", (event) => {
      if (event.target.closest("a, button, input, select, textarea")) return;
      toggleWallet();
    });

    wallet.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleWallet();
    });

    setFlipped(false);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === DASHBOARD_VISUAL_KEY || event.key === DASHBOARD_VISUAL_MODE_KEY) applyDashboardVisualPreference();
    if (event.key === GREETING_NAME_KEY) displayDashboardGreeting();
    if (event.key === PORTFOLIO_PASS_NAME_KEY) displayPortfolioPassName();
  });
  window.addEventListener("lan:admin-identity-change", displayDashboardGreeting);
  window.addEventListener("lan:portfolio-pass-name-change", displayPortfolioPassName);

  /* =========================================================
     6. DATE AND LAST ACCESS
     ========================================================= */
  
  function displayDashboardGreeting() {
    if (!welcomeTitle) {
      return;
    }

    const name = getDashboardGreetingName("Rolando");
    const greeting = buildDashboardGreeting(name, new Date());
    const nameIndex = greeting.lastIndexOf(name);

    welcomeTitle.replaceChildren();
    if (nameIndex >= 0) {
      const prefix = greeting.slice(0, nameIndex);
      const suffix = greeting.slice(nameIndex + name.length);
      welcomeTitle.append(document.createTextNode(prefix));
      const accent = document.createElement("span");
      accent.className = "hero-greeting-accent";
      accent.textContent = `${name}${suffix}`;
      welcomeTitle.append(accent);
    } else {
      welcomeTitle.textContent = greeting;
    }

    welcomeTitle.classList.toggle("is-long", greeting.length > 34);
    welcomeTitle.classList.toggle("is-very-long", greeting.length > 46);
    welcomeTitle.classList.toggle("is-question", /[?]$/.test(greeting.trim()));
  }

  function displayLastAccess() {
    if (!lastAccessText) {
      return;
    }
  
    const now = new Date();
  
    const formattedDate =
      new Intl.DateTimeFormat(
        "en-PH",
        {
          dateStyle: "medium",
          timeStyle: "short"
        }
      ).format(now);
  
    lastAccessText.textContent =
      formattedDate;
  }
  
  /* =========================================================
     7. RECENT ACTIVITY
     Temporarily stored in localStorage.
     ========================================================= */
  
  function getStoredActivities() {
    try {
      const savedActivities =
        localStorage.getItem(
          ACTIVITY_STORAGE_KEY
        );
  
      if (!savedActivities) {
        return [];
      }
  
      const parsedActivities =
        JSON.parse(savedActivities);
  
      return Array.isArray(parsedActivities)
        ? parsedActivities
        : [];
    } catch (error) {
      console.error(
        "Unable to read recent activities:",
        error
      );
  
      return [];
    }
  }
  
  function saveActivities(activities) {
    try {
      localStorage.setItem(
        ACTIVITY_STORAGE_KEY,
        JSON.stringify(activities)
      );
    } catch (error) {
      console.error(
        "Unable to save recent activities:",
        error
      );
    }
  }
  
  function addActivity(
    title,
    description
  ) {
    const activities =
      getStoredActivities();
  
    const newActivity = {
      id: Date.now(),
      title,
      description,
      date: new Date().toISOString()
    };
  
    activities.unshift(newActivity);
  
    const limitedActivities =
      activities.slice(0, 6);
  
    saveActivities(limitedActivities);
    renderActivities();
  }
  
  function renderActivities() {
    if (!activityList) {
      return;
    }
  
    const activities =
      getStoredActivities();
  
    if (activities.length === 0) {
      activityList.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">✓</span>
          <div>
            <strong>No recent updates yet</strong>
            <p>Your next portfolio update will appear here.</p>
          </div>
        </div>
      `;

      if (workspaceFocusTitle) workspaceFocusTitle.textContent = "Your workspace is ready.";
      if (workspaceFocusDetail) workspaceFocusDetail.textContent = "Choose a module and start creating. Your latest work will become the next Dashboard focus automatically.";
      if (workspaceFocusTime) workspaceFocusTime.textContent = "No recent workspace activity yet.";
      if (workspaceFocusGlyph) workspaceFocusGlyph.textContent = "↗";
      return;
    }
  
    const latestActivity = activities[0];
    if (workspaceFocusTitle) workspaceFocusTitle.textContent = latestActivity.title || "Continue where you left off";
    if (workspaceFocusDetail) workspaceFocusDetail.textContent = latestActivity.description || "Your latest CMS activity is ready to continue.";
    if (workspaceFocusTime) {
      workspaceFocusTime.textContent = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestActivity.date));
    }
    if (workspaceFocusGlyph) workspaceFocusGlyph.textContent = "✓";

    activityList.innerHTML =
      activities
        .map((activity) => {
          const activityDate =
            new Intl.DateTimeFormat(
              "en-PH",
              {
                dateStyle: "medium",
                timeStyle: "short"
              }
            ).format(
              new Date(activity.date)
            );
  
          return `
            <div class="activity-item">
              <span class="activity-icon">
                ✓
              </span>
  
              <div>
                <strong>
                  ${escapeHTML(activity.title)}
                </strong>
  
                <p>
                  ${escapeHTML(
                    activity.description
                  )}
                  ·
                  ${escapeHTML(
                    activityDate
                  )}
                </p>
              </div>
            </div>
          `;
        })
        .join("");
  }
  
  function clearActivities() {
    localStorage.removeItem(
      ACTIVITY_STORAGE_KEY
    );
  
    renderActivities();
  
    showNotification(
      "Recent dashboard activity was cleared."
    );
  }
  
  function escapeHTML(value) {
    const temporaryElement =
      document.createElement("div");
  
    temporaryElement.textContent =
      String(value ?? "");
  
    return temporaryElement.innerHTML;
  }
  
  clearActivityButton?.addEventListener(
    "click",
    clearActivities
  );
  
  /* =========================================================
     8. SECTION NAVIGATION
     ========================================================= */
  
  const sectionNames = {
    home: "Homepage Composer",
    about: "About Me",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    projects: "Projects",
    "photo-editing":
      "Photo Editing",
    certificates: "Certificates",
    resume: "Resume Manager",
    contact: "Contact",
    settings: "Settings"
  };
  
  /*
   * Every planned CMS module is registered here once.
   * When a new page is created, the dashboard detects it automatically.
   * Missing pages show a friendly message instead of opening a broken link.
   */
  const editorRoutes = {
    home: "pages/home.html",
    about: "pages/about.html",
    experience: "pages/experience.html",
    education: "pages/education.html",
    skills: "pages/skills.html",
    projects: "pages/projects.html",
    "photo-editing": "pages/photo-editing.html",
    certificates: "pages/certificates.html",
    resume: "pages/resume.html",
    contact: "pages/contact.html",
    settings: "pages/settings.html"
  };

  let navigationInProgress = false;

  async function routeExists(route) {
    try {
      const response = await fetch(route, {
        method: "HEAD",
        cache: "no-store"
      });

      return response.ok;
    } catch (error) {
      console.warn(
        `Unable to check CMS route: ${route}`,
        error
      );

      return false;
    }
  }
  
  async function openSection(sectionKey) {
    if (navigationInProgress) {
      return;
    }

    const editorRoute =
      editorRoutes[sectionKey];

    const sectionName =
      sectionNames[sectionKey] ||
      "Portfolio section";

    if (!editorRoute) {
      showNotification(
        `${sectionName} is not registered yet.`
      );

      closeSidebar();
      return;
    }

    navigationInProgress = true;

    const pageIsAvailable =
      await routeExists(editorRoute);

    navigationInProgress = false;
  
    if (pageIsAvailable) {
      window.location.href =
        editorRoute;
  
      return true;
    }
  
    showNotification(
      `${sectionName} module is still under development.`
    );
  
    closeSidebar();
    return false;
  }
  
  managementCards.forEach((card) => {
    card.addEventListener(
      "click",
      () => {
        const sectionKey =
          card.dataset.manager;
  
        openSection(sectionKey);
      }
    );
  });
  
  navigationLinks.forEach((link) => {
    link.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();

        const sectionKey =
          link.dataset.section;

        const navigationContainer =
          link.closest(".sidebar-navigation");

        navigationLinks.forEach(
          (navigationLink) => {
            navigationLink.classList.remove(
              "active"
            );
          }
        );

        link.classList.add("active");

        if (navigationContainer) {
          navigationContainer.style.pointerEvents =
            "none";
        }

        const navigationStarted =
          await openSection(sectionKey);

        if (
          navigationStarted !== true &&
          navigationContainer
        ) {
          navigationContainer.style.pointerEvents =
            "";
        }
      }
    );
  });

  addContentButton?.addEventListener(
    "click",
    () => {
      showNotification(
        "Choose a portfolio section to add new content."
      );
  
      addActivity(
        "Opened content manager",
        "Prepared to add new portfolio content"
      );
    }
  );
  
  /* =========================================================
     9. PORTFOLIO AND GITHUB LINKS
     ========================================================= */
  
  function openPortfolio() {
    window.open(
      LIVE_PORTFOLIO_URL,
      "_blank",
      "noopener,noreferrer"
    );
  }
  
  previewButtons.forEach((button) => {
    button.addEventListener(
      "click",
      openPortfolio
    );
  });
  
  githubLinks.forEach((link) => {
    link.addEventListener(
      "click",
      () => {
        window.open(
          "https://github.com/shin-ich1/Myportfolio",
          "_blank",
          "noopener,noreferrer"
        );
      }
    );
  });
  
  /* =========================================================
     10. COPY PORTFOLIO LINK
     ========================================================= */
  
  async function copyPortfolioLink() {
    try {
      await navigator.clipboard.writeText(
        LIVE_PORTFOLIO_URL
      );
  
      showNotification(
        "Portfolio link copied successfully."
      );
  
      addActivity(
        "Copied portfolio link",
        "The live website address was copied"
      );
    } catch (error) {
      console.error(
        "Unable to copy portfolio link:",
        error
      );
  
      const temporaryInput =
        document.createElement(
          "textarea"
        );
  
      temporaryInput.value =
        LIVE_PORTFOLIO_URL;
  
      temporaryInput.style.position =
        "fixed";
  
      temporaryInput.style.opacity =
        "0";
  
      document.body.appendChild(
        temporaryInput
      );
  
      temporaryInput.select();
  
      const copied =
        document.execCommand("copy");
  
      temporaryInput.remove();
  
      showNotification(
        copied
          ? "Portfolio link copied successfully."
          : "Unable to copy the portfolio link."
      );
    }
  }
  
  copyPortfolioLinkButton?.addEventListener(
    "click",
    copyPortfolioLink
  );
  
  /* =========================================================
     11. STATUS LABEL HELPERS
     ========================================================= */
  
  function healthItem(snapshot, id) {
    return Array.isArray(snapshot?.items)
      ? snapshot.items.find((item) => item?.id === id) || null
      : null;
  }

  function healthItemReady(item) {
    return Boolean(item) && item.severity === "healthy";
  }

  function renderHealthLabel(element, item, { readyText = "Connected", issueText = "Attention" } = {}) {
    if (!element) return;
    element.classList.remove("connected", "error");
    if (!item) {
      element.textContent = "Checking";
      return;
    }
    if (healthItemReady(item)) {
      element.textContent = readyText;
      element.classList.add("connected");
      return;
    }
    element.textContent = issueText;
    element.classList.add("error");
  }

  function applyDashboardSystemHealth(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;

    const authentication = healthItem(snapshot, "authentication");
    const firestore = healthItem(snapshot, "firestore");
    const cloudinary = healthItem(snapshot, "cloudinary");
    const publicPortfolio = healthItem(snapshot, "public");

    renderHealthLabel(authenticationStatus, authentication);
    renderHealthLabel(firestoreStatus, firestore);
    if (cloudinaryStatus) {
      cloudinaryStatus.textContent = cloudinary
        ? (healthItemReady(cloudinary) ? "ONLINE" : "ATTENTION")
        : "CHECK";
    }

    // Dashboard's 3/3 visual is a presentation of the shared health owner, not
    // an independent Firebase connection detector. Auth, protected Firestore
    // and the public portfolio are the three Dashboard readiness signals.
    const dashboardItems = [authentication, firestore, publicPortfolio];
    const readyCount = dashboardItems.filter(healthItemReady).length;
    const percent = Math.round((readyCount / dashboardItems.length) * 100);
    systemHealthRing?.style.setProperty("--health-percent", `${percent}%`);
    if (systemHealthScore) systemHealthScore.textContent = `${readyCount}/3`;
    if (systemHealthHeadline) {
      const issues = dashboardItems.filter((item) => item && !healthItemReady(item));
      systemHealthHeadline.textContent = issues.length
        ? "System check needs attention"
        : readyCount === 3
          ? "All systems operational"
          : "Checking services";
    }
  }

  window.addEventListener("lan:system-health", (event) => {
    applyDashboardSystemHealth(event.detail);
  });

  function renderContentAnalytics(counts = {}) {
    const numeric = Object.values(counts).filter(Number.isFinite);
    const total = numeric.reduce((sum, value) => sum + value, 0);
    const maximum = Math.max(1, ...numeric);

    if (analyticsTotalCount) analyticsTotalCount.textContent = String(total);

    document.querySelectorAll("[data-analytics-bar]").forEach((bar) => {
      const key = bar.dataset.analyticsBar;
      const value = Number.isFinite(counts[key]) ? counts[key] : 0;
      const percentage = value > 0 ? Math.max(8, Math.round((value / maximum) * 100)) : 3;
      bar.style.setProperty("--bar", `${percentage}%`);
    });

    const media = [counts.photos, counts.resumes].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    const structured = Math.max(0, total - media);
    const mediaShare = total > 0 ? Math.round((media / total) * 100) : 0;
    dashboardContentMixRing?.style.setProperty("--media-share", `${mediaShare}%`);
    if (dashboardMediaCount) dashboardMediaCount.textContent = String(media);
    if (dashboardMediaLegendCount) dashboardMediaLegendCount.textContent = String(media);
    if (dashboardStructuredCount) dashboardStructuredCount.textContent = String(structured);
  }

  /* =========================================================
     12. FIRESTORE COUNTERS
     ========================================================= */
  
  async function getCollectionCount(
    database,
    collectionName
  ) {
    try {
      const collectionReference =
        collection(
          database,
          collectionName
        );
  
      const countSnapshot =
        await getCountFromServer(
          collectionReference
        );
  
      return countSnapshot
        .data()
        .count;
    } catch (error) {
      console.warn(
        `Unable to count ${collectionName}:`,
        error
      );
  
      return null;
    }
  }
  
  async function loadDashboardCounts(
    database
  ) {
    const results = await Promise.all([
      getCollectionCount(database, "experiences"),
      getCollectionCount(database, "projects"),
      getCollectionCount(database, "photoEditingProjects"),
      getCollectionCount(database, "resumes"),
      getCollectionCount(database, "education"),
      getCollectionCount(database, "skills"),
      getCollectionCount(database, "certificates")
    ]);

    const [experiences, projects, photoSamples, resumes, education, skills, certificates] = results;
    const displayCount = (value) => Number.isFinite(value) ? String(value) : "—";

    if (experienceCount) experienceCount.textContent = displayCount(experiences);
    if (projectCount) projectCount.textContent = displayCount(projects);
    if (photoSampleCount) photoSampleCount.textContent = displayCount(photoSamples);
    if (resumeCount) resumeCount.textContent = displayCount(resumes);
    if (educationLibraryCount) educationLibraryCount.textContent = displayCount(education);
    if (skillsLibraryCount) skillsLibraryCount.textContent = displayCount(skills);
    if (certificateLibraryCount) certificateLibraryCount.textContent = displayCount(certificates);

    const contentCounts = {
      projects,
      photos: photoSamples,
      experience: experiences,
      education,
      skills,
      certificates,
      resumes
    };

    renderContentAnalytics(contentCounts);

    // Browser-safe Cloudinary information only. Never place an API secret in Admin.
    if (cloudinaryPhotoCount) cloudinaryPhotoCount.textContent = displayCount(photoSamples);
    if (cloudinaryPdfCount) cloudinaryPdfCount.textContent = displayCount(resumes);
    if (cloudinaryCloudName) cloudinaryCloudName.textContent = cloudinaryConfig.cloudName || "Not configured";

    const mediaTotal = [photoSamples, resumes]
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    const photoShare = mediaTotal > 0 && Number.isFinite(photoSamples)
      ? Math.round((photoSamples / mediaTotal) * 100)
      : 0;

    if (cloudinaryTrackedTotal) cloudinaryTrackedTotal.textContent = mediaTotal ? String(mediaTotal) : "0";
    if (cloudinaryMediaRing) cloudinaryMediaRing.style.setProperty("--media-percent", `${photoShare}%`);
  }
  
  /* =========================================================
     13. FIREBASE DASHBOARD CONNECTION
     ========================================================= */
  
  async function initializeDashboardFirebase() {
    try {
      // Dashboard is a consumer of the persistent shell session. It never
      // restores Auth, refreshes tokens, or owns a second authorization path.
      await (window.__LAN_ADMIN_READY__ ?? Promise.reject(new Error("Admin shell session bridge did not initialize.")));
      await loadDashboardCounts(db);
    } catch (error) {
      console.warn("Dashboard record counts are waiting for the canonical Admin session:", error);
    }
  }

  /* =========================================================
     14. START DASHBOARD
     ========================================================= */
  
  function initializeDashboard() {
    applyDashboardVisualPreference();
    bindDashboardVisualShape();
    bindCommandWallet();
    displayPortfolioPassName();
    displayDashboardGreeting();
    displayLastAccess();
    renderActivities();
    initializeDashboardFirebase();
  }
  
  initializeDashboard();

  // Keep the greeting current if the Dashboard stays open across a time-of-day change.
  window.setInterval(displayDashboardGreeting, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) displayDashboardGreeting();
  });

function initializeMetricMirrors() {
  document.querySelectorAll("[data-mirror]").forEach((mirror) => {
    const source = document.getElementById(mirror.dataset.mirror);
    if (!source) return;
    const sync = () => { mirror.textContent = source.textContent; };
    new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
    sync();
  });
}


initializeMetricMirrors();
