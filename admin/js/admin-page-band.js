/* Canonical runtime composer for the Admin local page band.
   Kept dependency-free so production and browser geometry verification execute
   the same DOM composition code. Styling remains owned by shared-ui/admin-layout. */
export function mountAdminPageBand({
  body = document.body,
  root,
  topbar,
  resolvePageKey = () => "",
  renderPageIcon = () => "LΛN",
  escapeHtml = (value = "") => String(value ?? ""),
  celestialStarfieldMarkup = () => "",
  shootingStarMarkup = () => "",
  astronautMarkup = () => "",
  applyTimeCelestial = () => {},
  startPlanetSequence = () => {},
  startAstronautDrift = () => {}
} = {}) {
  if (!(root instanceof HTMLElement) || !(topbar instanceof HTMLElement)) return null;
  const existing = root.querySelector(":scope > .lan-page-band");
  if (existing) return existing;

  const identity = topbar.querySelector(".lan-page-identity") || [...topbar.children].find((child) => {
    return !child.matches(".editor-topbar-actions,.composer-header-actions,.about-header-actions,.dashboard-header-actions,.lan-command-search,.menu-button,.sidebar-toggle,#menuButton");
  });
  const title = identity?.querySelector("h1")?.textContent?.trim()
    || topbar.querySelector("h1")?.textContent?.trim()
    || document.title.split("|")[0].trim()
    || "Workspace";
  const eyebrow = identity?.querySelector(".editor-eyebrow,.composer-kicker,.about-kicker")?.textContent?.trim()
    || topbar.querySelector(".editor-eyebrow,.composer-kicker,.about-kicker")?.textContent?.trim()
    || "Admin workspace";
  const key = resolvePageKey(title);

  if (identity) {
    identity.hidden = false;
    identity.classList.add("lan-page-identity--band-owned");
  }

  body?.classList.add("lan-local-page-header");
  const band = document.createElement("section");
  band.className = "lan-page-band";
  band.setAttribute("aria-label", `${title} page header`);
  band.innerHTML = `${celestialStarfieldMarkup()}${shootingStarMarkup()}<span class="lan-planet-orbit-stage" aria-hidden="true"><svg class="lan-planet-orbit-guide" viewBox="0 0 1000 180" preserveAspectRatio="none"><path d="M 24 140 C 240 112, 566 26, 980 86"></path><path class="is-secondary" d="M 6 168 C 286 132, 650 62, 1010 112"></path></svg><i class="lan-orbiting-planet" data-planet="earth"></i></span><span class="lan-time-celestial" data-celestial="moon" role="img" aria-label="Night moon"></span><span class="lan-page-band-asteroids" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><div class="lan-page-band-copy"><span class="lan-page-band-icon" aria-hidden="true">${renderPageIcon(key)}</span><div><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(title)}</strong></div></div>${astronautMarkup()}<span class="lan-page-band-orbit" aria-hidden="true">LΛN workspace</span>`;

  const topTabs = root.querySelector(":scope > .home-tabs, :scope > .about-tabs");
  if (topTabs) {
    band.classList.add("lan-page-band--tabs");
    const orbit = band.querySelector(".lan-page-band-orbit");
    band.insertBefore(topTabs, orbit || null);
  }

  root.prepend(band);
  applyTimeCelestial(band);
  startPlanetSequence(band);
  startAstronautDrift(band);
  return band;
}
