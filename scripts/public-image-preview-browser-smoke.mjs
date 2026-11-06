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
  `"use strict";
  const cleanText = value => String(value ?? "").trim();
  const escapeHtml = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const icon = value => '<span aria-hidden="true">' + value + '</span>';
  const bindPublicMediaFrames = root => root?.querySelectorAll?.("[data-public-media-frame]").forEach(frame => {
    const image = frame.querySelector("[data-public-media-image]");
    if (!image) return;
    const apply = () => syncPublicIntrinsicMediaFrame(frame,image);
    if (image.complete && image.naturalWidth) apply();
    else image.addEventListener("load",apply,{once:true});
  });
  const publicMediaFrameMarkup = (asset, alt = "", opts = {}) => {
    const name = opts.sizing === "intrinsic" ? "public-media-frame--intrinsic " : "";
    const value = typeof asset === "string" ? asset : asset?.url || "";
    return '<span class="public-media-frame ' + name + '" data-public-media-frame><img class="public-media-frame__image" data-public-media-image src="' + escapeHtml(value) + '" alt="' + escapeHtml(alt) + '"></span>';
  };
  const photoGalleryMediaDescriptors = item => (item.galleryImages || []).map((asset, index) => ({asset, index, shape:"square", width:800, height:800}));
  window.lucide = {createIcons() {}};
  `,
  section("function syncPublicIntrinsicMediaFrame(", "\nfunction bindPublicMediaFrames("),
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
const portrait = svg(900, 1200, "#4b658b");

const executable = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(path => path && existsSync(path));
assert.ok(executable, "Chrome/Chromium executable required for browser verification");
const browser = await chromium.launch({executablePath:executable, headless:true, args:["--no-sandbox","--disable-dev-shm-usage"]});
let checks = 0;

async function openFixture(page, mode, galleryCount = 3) {
  const sources = [before, after, third, portrait];
  await page.evaluate(({mode, sources, galleryCount}) => {
    const {show, photoEditingDetailMediaMarkup, setupPhotoDetailGalleryViewer, setupPhotoDetailSingleComparisonPreview} = window.__previewTest;
    const role = mode === "comparison" ? {key:"comparison",label:"Before & After"}
      : mode === "gallery" ? {key:"gallery",label:"Gallery · 3 images"}
      : {key:"single",label:"Single Image"};
    const item = {title:"Media Contract Test", category:"Testing", beforeImage:sources[0], afterImage:mode === "single" ? sources[3] : sources[1],
      galleryImages:sources.slice(0,galleryCount), description:"This description remains in first-level details"};
    show('<article class="photo-detail-shell">'
      + '<header class="photo-detail-head"><div class="photo-detail-head-icon">Photo</div><div><div class="photo-detail-kicker">PHOTO EDITING · '+role.label+'</div><h2>'+item.title+'</h2><p>'+item.category+'</p></div></header>'
      + '<div class="photo-detail-media-shell">' + photoEditingDetailMediaMarkup(item, role)
      + '<nav class="photo-detail-record-nav-row" aria-label="Browse photo editing samples"><button class="carousel-arrow photo-detail-record-nav is-prev" type="button">Previous</button><button class="carousel-arrow photo-detail-record-nav is-next" type="button">Next</button></nav></div>'
      + '<div class="photo-detail-information" data-first-level-details><section class="photo-detail-facts"><div><small>CATEGORY</small><strong>Testing</strong></div><div><small>PRESENTATION</small><strong>'+role.label+'</strong></div></section>'
      + '<section class="photo-detail-about"><h3>ABOUT THIS EDIT</h3><p>This description remains in first-level details</p></section></div></article>',
      "gallery-viewer photo-detail-viewer");
    if (role.key === "gallery") setupPhotoDetailGalleryViewer(document.querySelector("#modal"), item);
    else setupPhotoDetailSingleComparisonPreview(document.querySelector("#modal"), item, role);
  }, {mode,sources,galleryCount});
}

async function verifyFirstLevelComparisonDensity(page) {
  const result = await page.evaluate(() => {
    const pair = document.querySelector(".public-comparison-pair").getBoundingClientRect();
    const panels = [...document.querySelectorAll(".public-comparison-panel")].map(panel => {
      const rect = panel.getBoundingClientRect();
      const img = panel.querySelector("[data-public-media-image]");
      const frame = panel.querySelector("[data-public-media-frame]");
      const image = img?.getBoundingClientRect();
      const caption = panel.querySelector(".public-comparison-label")?.getBoundingClientRect();
      return {rect:rect.toJSON(),image:image?.toJSON(),caption:caption?.toJSON(),
        fit:img ? getComputedStyle(img).objectFit : "",frame:frame?.getBoundingClientRect().toJSON()};
    });
    return {pair:pair.toJSON(),panels,viewport:[innerWidth,innerHeight]};
  });
  assert.equal(result.panels.length,2,"Comparison first view keeps two complete image panels");
  const [width,height]=result.viewport;
  for(const panel of result.panels) {
    assert.ok(panel.rect.height <= Math.min(panel.rect.width * 1.28, height * .58, 600) + 3,
      "Before/After panels should size from width, not leave a giant empty vertical slot: "+JSON.stringify(result));
    assert.equal(panel.fit,"contain","Comparison must never crop the original image");
    assert.ok(panel.caption && panel.caption.top >= panel.rect.top - 1 && panel.caption.bottom <= panel.rect.bottom + 1,
      "Before and After labels should stay within their own panels");
    assert.ok(panel.image && panel.image.left >= panel.rect.left - 1 && panel.image.right <= panel.rect.right + 1 &&
      panel.image.top >= panel.rect.top - 1 && panel.image.bottom <= panel.rect.bottom + 1,
      "Both original images must remain inside their compact panels");
  }
  assert.ok(result.panels[0].rect.right <= result.panels[1].rect.left + 1,
    "First view must preserve side-by-side comparison");
  if (width <= 430) assert.ok(result.panels[0].rect.height < 260,
    "Pixel 9 Pro comparison should no longer have 400px-tall panels");
  checks++;
}

async function verifyRecordNavigationBounds(page) {
  const bounds = await page.evaluate(() => {
    const media = document.querySelector(".photo-detail-media-shell").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".photo-detail-record-nav")].map(el => el.getBoundingClientRect().toJSON());
    const information = document.querySelector(".photo-detail-information").getBoundingClientRect();
    const stage = document.querySelector(".photo-detail-media-shell > .photo-detail-media").getBoundingClientRect();
    return {media:media.toJSON(),stage:stage.toJSON(),buttons,information:information.toJSON()};
  });
  assert.equal(bounds.buttons.length,2,"Record navigation retains two working controls");
  for(const button of bounds.buttons){
    assert.ok(button.top >= bounds.media.top-1 && button.bottom <= bounds.media.bottom+1,
      "Record arrows must stay inside the image area, not in a bottom row: "+JSON.stringify(bounds));
    assert.ok(Math.abs((button.top+button.bottom)/2-(bounds.stage.top+bounds.stage.bottom)/2)<=2,
      "Arrows must be vertically centered beside media: "+JSON.stringify(bounds));
    assert.ok(button.bottom <= bounds.information.top+1,
      "Record arrows must not overlap the description: "+JSON.stringify(bounds));
  }
  assert.ok(bounds.buttons[0].right <= bounds.media.left + bounds.media.width * .2,
    "Previous belongs to the left side of media");
  assert.ok(bounds.buttons[1].left >= bounds.media.right - bounds.media.width * .2,
    "Next belongs to the right side of media");
  checks++;
}

async function verifyImmersivePreview(page) {
  const result = await page.evaluate(() => {
    const overlay = document.querySelector(".public-image-preview");
    const panel = document.querySelector(".public-image-preview-panel");
    const close = document.querySelector(".public-image-preview-close");
    const media = document.querySelector(".public-image-preview-stage .public-media-frame");
    return {
      background:getComputedStyle(panel).backgroundColor,
      border:getComputedStyle(panel).borderTopWidth,
      radius:getComputedStyle(panel).borderTopLeftRadius,
      mediaBackground:media ? getComputedStyle(media).backgroundColor : null,
      overlay:getComputedStyle(overlay).backgroundColor,
      close:close?.getBoundingClientRect().toJSON(),
      viewport:[innerWidth,innerHeight],
      headings:overlay.querySelectorAll(".public-image-preview-header").length
    };
  });
  assert.equal(result.headings,0,"Image-only view must not repeat the first-level title/details");
  assert.equal(result.background,"rgba(0, 0, 0, 0)","Blue panel background must be absent");
  assert.equal(result.border,"0px","Full preview must not display a bordered modal card");
  assert.equal(result.mediaBackground,"rgba(0, 0, 0, 0)","Image canvas must not paint blue bars behind the media");
  assert.ok(result.close && result.close.right <= result.viewport[0]+1 && result.close.top >= -1,
    "Close button should float inside the viewport");
  checks++;
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
  assert.ok(result.stage.width >= result.panel.width * .65, "Preview stage must occupy the center grid column, even with hidden navigation: " + JSON.stringify({viewport:[result.w,result.h],stage:result.stage,panel:result.panel}));
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
  for (const size of [{width:1650,height:927},{width:1440,height:900},{width:800,height:700},{width:427,height:952},{width:390,height:844},{width:844,height:390}]) {
    const page = await browser.newPage({viewport:size,deviceScaleFactor:1});
    await page.setContent('<!doctype html><html><head></head><body><main id="modal"></main></body></html>');
    await page.evaluate(width => {
      const mode = width <= 600 ? "mobile" : width <= 1100 ? "compact" : "wide";
      document.documentElement.setAttribute("data-lan-public-mode",mode);
    },size.width);
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:browserRuntime});
    await openFixture(page,"gallery",2);
    await verifyRecordNavigationBounds(page);
    const thumbnails = page.locator("[data-photo-gallery-open]");
    assert.equal(await thumbnails.count(),2,"Two-image Gallery first view retains both thumbnails");
    const tiles = await Promise.all([thumbnails.nth(0).boundingBox(),thumbnails.nth(1).boundingBox()]);
    assert.ok(tiles.every(Boolean) && Math.abs(tiles[0].width-tiles[1].width)<=1,"Gallery with two images must balance the thumbnail widths");
    await thumbnails.nth(0).click();
    await verifyImmersivePreview(page);
    await verifyBounds(page,1);
    assert.equal(await page.locator("[data-public-preview-prev]:visible").count(),0,"First image has no Previous");
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),1);
    await page.locator("[data-public-preview-next]").click();
    await verifyBounds(page,1);
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),0,"Last image has no Next");
    assert.equal(await page.locator("[data-public-preview-prev]:visible").count(),1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-public-image-preview]").count(),0);
    assert.equal(await page.locator("[data-first-level-details]").count(),1,"Close returns to details, not homepage");
    checks++;
    await openFixture(page,"comparison");
    await verifyFirstLevelComparisonDensity(page);
    await verifyRecordNavigationBounds(page);
    await page.locator("[data-photo-preview-open]").click();
    await verifyImmersivePreview(page);
    await verifyBounds(page,2);
    assert.equal(await page.locator(".public-image-preview-comparison").count(),1);
    assert.equal(await page.locator("[data-public-preview-prev]:visible").count(),0);
    assert.equal(await page.locator("[data-public-preview-next]:visible").count(),0);
    await page.locator("[data-public-preview-close]").click();
    assert.equal(await page.locator("[data-first-level-details]").count(),1);
    checks++;
    await openFixture(page,"single");
    await verifyRecordNavigationBounds(page);
    await page.waitForFunction(() => {
      const img=document.querySelector(".photo-detail-single-stage [data-public-media-image]");
      const frame=document.querySelector(".photo-detail-single-stage > .public-media-frame");
      return img?.complete && img?.naturalWidth > 0
        && Boolean(frame?.style.getPropertyValue("--public-media-intrinsic-aspect"));
    });
    const detailBounds=await page.evaluate(() => {
      const container=document.querySelector(".photo-detail-media--single").getBoundingClientRect();
      const media=document.querySelector(".photo-detail-single-stage > .public-media-frame");
      const img=media.querySelector("[data-public-media-image]");
      const frame=media.getBoundingClientRect();
      return {container:container.toJSON(),frame:frame.toJSON(),viewport:[innerWidth,innerHeight],
        ratio:media.style.getPropertyValue("--public-media-intrinsic-ratio"),
        aspect:media.style.getPropertyValue("--public-media-intrinsic-aspect"),
        imageDims:[img.naturalWidth,img.naturalHeight]};
    });
    assert.ok(detailBounds.frame.top >= detailBounds.container.top-1 && detailBounds.frame.left >= detailBounds.container.left-1
      && detailBounds.frame.bottom <= detailBounds.container.bottom+1 && detailBounds.frame.right <= detailBounds.container.right+1,
      "Single image overflows its first-level dark stage: "+JSON.stringify(detailBounds));
    checks++;
    await page.locator("[data-photo-preview-open]").click();
    await verifyImmersivePreview(page);
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
    await verifyImmersivePreview(page);
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
