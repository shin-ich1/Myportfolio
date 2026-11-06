/* Strictly removes only the canonical Public image preview owners from byte-for-byte baseline comparisons.
   Message security, puzzle, footer, Admin, startup, and all unrelated source remain protected. */
export function withoutAuthorizedPreviewAppOwners(source) {
  let text = source;
  const removeBetween = (start, end, label, optional = false) => {
    const a = text.indexOf(start);
    if (a < 0 && optional) return;
    if (a < 0) throw new Error("Missing " + label + " start");
    const b = text.indexOf(end, a + start.length);
    if (b < 0 || text.indexOf(start, a + 1) >= 0) throw new Error("Invalid " + label + " owner boundary");
    text = text.slice(0, a) + "[canonical preview owner: " + label + "]" + text.slice(b);
  };
  removeBetween("function dynamicAssetMarkup(", "\nfunction dynamicValueMarkup(", "dynamic image triggers");
  const sharedStart = text.indexOf("\n\nfunction bindPublicImagePreviewTriggers(");
  if (sharedStart >= 0) {
    const sharedEnd = text.indexOf("\n\nlet modalOpener = null;", sharedStart);
    if (sharedEnd < 0) throw new Error("Unclosed shared image preview owner");
    text = text.slice(0, sharedStart) + text.slice(sharedEnd);
  }
  removeBetween("let modalOpener = null;", "\nfunction runAfterSectionRender(", "modal orchestration");
  removeBetween("function photoEditingDetailMediaMarkup(", "\nfunction photoEditingDetailNavigation(", "photo detail media");
  removeBetween("function openPhotoEditingSource(", "\nfunction projectDetailGalleryMarkup(", "photo image preview binding");
  return text;
}

export function withoutAuthorizedPreviewCssOwners(source) {
  let css = source;
  const photo = css.indexOf("/* Canonical picture-only preview") >= 0
    ? css.indexOf("/* Canonical picture-only preview")
    : css.indexOf(".photo-gallery-lightbox {");
  const end = css.indexOf(".photo-detail-information {", photo);
  if (photo < 0 || end <= photo) throw new Error("Missing photo overlay stylesheet owner");
  css = css.slice(0, photo) + "[canonical image-only overlay]\n" + css.slice(end);
  const replaceRule = (pattern, label) => {
    const matches = [...css.matchAll(pattern)];
    if (matches.length !== 1) throw new Error("Expected one " + label + " owner; found " + matches.length);
    css = css.replace(pattern, "[canonical preview CSS: " + label + "]");
  };
  replaceRule(/^\.public-photo-gallery\s*\{[^}]*\}/gm, "photo gallery overview");
  replaceRule(/^\.photo-detail-viewer\s*\{[^}]*\}/gm, "photo viewer scroll owner");
  replaceRule(/^\.photo-detail-media--single\s*\{[^}]*\}/gm, "photo intrinsic single stage container");
  replaceRule(/^\.photo-detail-single-stage\s*\{[^}]*\}/gm, "photo intrinsic stage geometry");
  replaceRule(/^\.photo-detail-shell\s*\{[^}]*\}/gm, "photo details shell sizing");
  replaceRule(/^\.gallery-viewer\s*\{[^}]*\}/gm, "shared gallery viewer flow");
  replaceRule(/^html\[data-lan-public-mode="mobile"\]\s+\.photo-detail-shell\s*\{[^}]*\}/gm, "mobile photo detail spacing");
  replaceRule(/\.dynamic-detail-gallery\{display:grid;[^}]*\}/g, "dynamic gallery overview");
  return css;
}
