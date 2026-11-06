import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const core = process.env.LAN_PLAYWRIGHT_CORE || "/tmp/lan-preview-browser/node_modules/playwright-core";
const { chromium } = require(core);
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function section(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Missing Public owner: " + start);
  return app.slice(a, b);
}

const browserRuntime = [
  `const cleanText = value => String(value ?? "").trim();
  const escapeHtml = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const icon = value => '<span aria-hidden="true">' + value + '</span>';
  const bindPublicMediaFrames = () => {};
  const publicMediaFrameMarkup = (asset, alt = "") => '<span class="public-media-frame" data-public-media-frame><img class="public-media-frame__image" data-public-media-image src="' + escapeHtml(typeof asset === "string" ? asset : asset?.url || "") + '" alt="' + escapeHtml(alt) + '"></span>';
  const photoGalleryMediaDescriptors = item => (item.galleryImages || []).map((asset, index) => ({asset, index, shape:"square", width:800, height:800}));
  window.lucide = {createIcons() {}};
  `,
  section("function bindPublicImagePreviewTriggers(", "\nfunction publicImagePreviewNavigation("),
  section("function publicImagePreviewNavigation(", "\nfunction openPublicImagePreview("),
  section("function openPublicImagePreview(", "\nfunction closePublicImagePreview("),
  section("function closePublicImagePreview(", "\nlet modalOpener = null;"),
  section("let modalOpener = null;", "\nfunction runAfterSectionRender("),
  section("function photoEditingDetailMediaMarkup(", "\nfunction photoEditingDetailNavigation("),
  section("function setupPhotoDetailGalleryViewer(", "\nfunction projectDetailGalleryMarkup("),
  `window.__previewTest = {show, closeModal, photoEditingDetailMediaMarkup, setupPhotoDetailGalleryViewer, setupPhotoDetailSingleComparisonPreview};`
].join("\n\n");

const svg = (width, height, color) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`
);
const before = svg(900, 500, "#9b4051");
const after = svg(600, 1100, "#2b8498");
const third = svg(1200, 450, "#8a6d35");

const executable = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(path => path && existsSync(path));
assert.ok(executable, "Chrome/Chromium executable required for browser verification");
const browser = await chromium.launch({executablePath:executable, headless:true, args:["--no-sandbox","--disable-dev-shm-usage"]});
let checks = 0;

async function openFixture(page, mode) {
  const sources = [before, after, third];
  await page.evaluate(({mode, sources}) => {
    const {show, photoEditingDetailMediaMarkup, setupPhotoDetailGalleryViewer, setupPhotoDetailSingleComparisonPreview} = window.__previewTest;
    const role = mode === "comparison" ? {key:"comparison",label:"Before & After"}
      : mode === "gallery" ? {key:"gallery",label:"Gallery · 3 images"}
      : {key:"single",label:"Single Image"};
    const item = {title:"Media Contract Test", category:"Testing", beforeImage:sources[0], afterImage:sources[1],
      galleryImages:sources, description:"This description remains in first-level details"};
    show('<article class="photo-detail-shell">' + photoEditingDetailMediaMarkup(item, role)
      + '<section class="photo-detail-information" data-first-level-details>Details and description</section></article>',
      "gallery-viewer photo-detail-viewer");
    if (role.key === "gallery") setupPhotoDetailGalleryViewer(document.querySelector("#modal"), item);
    else setupPhotoDetailSingleComparisonPreview(document.querySelector("#modal"), item, role);
  }, {mode,sources});
}

async function verifyBounds(page, expectedImages) {
  await page.waitForFunction(() => [...document.querySelectorAll(".public-image-preview-stage img")]
    .every(image => image.complete && image.naturalWidth > 0));
  const result = await page.evaluate(() => {
    const panel = document.querySelector(".public-image-preview-panel").getBoundingClientRect();
    const stage = document.querySelector(".public-image-preview-stage").getBoundingClientRect();
    const images = [...document.querySelectorAll(".public-image-preview-stage img")].map(img => ({
      rect: img.getBoundingClientRect().toJSON(),
      fit: getComputedStyle(img).objectFit,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight
    }));
    return {panel:panel.toJSON(),stage:stage.toJSON(),images,w:innerWidth,h:innerHeight};
  });
  const closeEnough = (a, b) => a <= b + 1;
  assert.equal(result.images.length, expectedImages);
  assert.ok(result.panel.x >= -1 && result.panel.y >= -1 && closeEnough(result.panel.right,result.w)
    && closeEnough(result.panel.bottom,result.h),"Panel must remain within visual viewport");
  for(const image of result.images){
    const r=image.rect;
    assert.equal(image.fit,"contain","Never crop an original image");
    assert.ok(image.naturalWidth>0 && image.naturalHeight>0);
    assert.ok(r.x >= result.stage.x - 1 && r.y >= result.stage.y - 1
      && closeEnough(r.right,result.stage.right) && closeEnough(r.bottom,result.stage.bottom),
      "Image must fit completely inside the second-level preview stage: " + JSON.stringify({viewport:[result.w,result.h],stage:result.stage,image:r}));
  }
  checks++;
}

try {
  for (const size of [{width:1440,height:900},{width:800,height:700},{width:390,height:844},{width:844,height:390}]) {
    const page = await browser.newPage({viewport:size,deviceScaleFactor:1});
    await page.setContent('<!doctype html><html><head></head><body><main id="modal"></main></body></html>');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:browserRuntime});
    await openFixture(page,"gallery");
    const thumbnails = page.locator("[data-photo-gallery-open]");
    assert.equal(await thumbnails.count(),3,"Gallery first view retains all thumbnails");
    await thumbnails.nth(0).click();
    await verifyBounds(page,1);
    assert.equal(await page.locator("[data-public-preview-prev]:visible").count(),0,"First image has no Previous");
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),1);
    await page.locator("[data-public-preview-next]").click();
    await page.locator("[data-public-preview-next]").click();
    await verifyBounds(page,1);
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),0,"Last image has no Next");
    assert.equal(await page.locator("[data-public-preview-prev]:visible").count(),1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-public-image-preview]").count(),0);
    assert.equal(await page.locator("[data-first-level-details]").count(),1,"Close returns to details, not homepage");
    checks++;
    await openFixture(page,"comparison");
    await page.locator("[data-photo-preview-open]").click();
    await verifyBounds(page,2);
    assert.equal(await page.locator(".public-image-preview-comparison").count(),1);
    assert.equal(await page.locator("[data-public-preview-prev]:visible").count(),0);
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),0);
    await page.locator("[data-public-preview-close]").click();
    assert.equal(await page.locator("[data-first-level-details]").count(),1);
    checks++;
    await openFixture(page,"single");
    await page.locator("[data-photo-preview-open]").click();
    await verifyBounds(page,1);
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),0);
    await page.locator("[data-public-preview-close]").click();
    assert.equal(await page.locator("[data-first-level-details]").count(),1);
    checks++;
    await page.evaluate(({before, after}) => {
      const {show} = window.__previewTest;
      const image = src => '<span class="public-media-frame" data-public-media-frame><img class="public-media-frame__image" data-public-media-image src="' + src + '"></span>';
      show('<div class="dynamic-detail-shell"><h2>Future Module</h2><div class="dynamic-detail-gallery">'
        + '<figure class="dynamic-asset-preview dynamic-asset-image"><button data-public-image-preview-trigger>' + image(before) + '</button></figure>'
        + '<figure class="dynamic-asset-preview dynamic-asset-image"><button data-public-image-preview-trigger>' + image(after) + '</button></figure>'
        + '</div></div>',"dynamic-module-viewer");
    },{before,after});
    await page.locator("[data-public-image-preview-trigger]").first().click();
    await verifyBounds(page,1);
    await page.locator("[data-public-preview-next]").click();
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),0);
    checks++;
    await page.close();
  }
  console.log("Browser image preview contract: "+checks+" viewport and interaction checks PASS");
} finally {
  await browser.close();
}
