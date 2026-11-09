import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LAN_PLAYWRIGHT_CORE || "/tmp/lan-preview-browser/node_modules/playwright-core");
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("admin/dashboard.html");
const js = read("admin/js/dashboard.js");
const card = html.match(/<section aria-labelledby="portfolioPassTitle"[\s\S]*?<\/section>/)?.[0];
const dialog = html.match(/<dialog class="portfolio-analytics-detail-dialog"[\s\S]*?<\/dialog>/)?.[0];
assert.ok(card && dialog, "Use the real Dashboard card and daily details markup");
assert.ok(html.indexOf('<dialog class="portfolio-analytics-detail-dialog"') > html.indexOf("</main>"),
  "The native dialog must not be a child of the Dashboard scroll area, which stretches direct children");

function extract(start, end) {
  const from = js.indexOf(start);
  const to = js.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Cannot extract canonical Dashboard owner: " + start);
  return js.slice(from, to);
}
const program = [
  `const getVisitorAnalyticsSummary = async ({period="7d",month=""}={}) => {
    window.analyticsRequests.push({period,month});
    await new Promise(resolve=>setTimeout(resolve,10));
    const now=new Date();
    const tomorrow=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1);
    let start=tomorrow-(period==="7d"?7:30)*86400000;
    let end=tomorrow;
    if(period==="month"){
      start=Date.parse(month+"-01T00:00:00Z");
      end=Math.min(tomorrow,Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1));
    }
    const days=[];
    for(let t=start;t<end;t+=86400000)
      days.push({date:new Date(t).toISOString().slice(0,10),views:(days.length%9)+1,visits:(days.length%4)+1});
    return {configured:true,period,month,days};
  };`,
  extract("  function bindCommandWallet() {", "  window.addEventListener(\"storage\""),
  extract("  let visitorAnalyticsRequestInFlight = false;", "  /* =========================================================\n     14. FIREBASE DASHBOARD CONNECTION"),
  "bindCommandWallet();bindVisitorAnalyticsRetry();void loadVisitorAnalytics();"
].join("\n\n");

const chrome = [process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].find(path=>path&&existsSync(path));
assert.ok(chrome,"Chrome/Chromium required for Dashboard browser smoke");
const browser = await chromium.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
let checks=0;

try {
  for(const viewport of [{width:1650,height:927},{width:820,height:760},{width:390,height:844},{width:844,height:390}]) {
    const page=await browser.newPage({viewport,hasTouch:viewport.width<=844});
    page.on("pageerror",error=>{ throw error; });
    await page.setContent('<!doctype html><html><body class="dashboard-page"><main class="dashboard-welcome" style="position:relative;min-height:680px;width:100%;">'+card+'</main>'+dialog+'</body></html>');
    await page.addStyleTag({content:read("admin/css/theme.css")+"\n"+read("admin/css/dashboard.css")+"\n"+read("admin/css/admin-layout.css")});
    await page.evaluate(()=>{ window.analyticsRequests=[]; document.documentElement.dataset.theme="dark"; });
    await page.addScriptTag({content:program});
    await page.waitForSelector(".portfolio-analytics-day");
    assert.equal(await page.locator(".portfolio-analytics-day").count(),7,"7-day graph must be ready");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,1,"Initial Dashboard load uses one request");
    const originalPalette=await page.locator(".portfolio-analytics-day-bar").evaluateAll(nodes=>
      nodes.map(node=>getComputedStyle(node).backgroundImage));
    assert.equal(new Set(originalPalette).size,7,"The seven-day bars must use seven distinct brand-compatible series colors");
    await page.evaluate(()=>{document.documentElement.dataset.theme="light";});
    const lightPalette=await page.locator(".portfolio-analytics-day-bar").evaluateAll(nodes=>
      nodes.map(node=>getComputedStyle(node).backgroundImage));
    assert.equal(new Set(lightPalette).size,7,"Light mode must preserve distinct bar colors");
    assert.notDeepEqual(lightPalette,originalPalette,"Chart colors must respond to theme changes");
    const dialogTheme=await page.locator("[data-analytics-detail-dialog]").evaluate(node=>({
      background:getComputedStyle(node).backgroundColor,
      backdropBlur:getComputedStyle(node,"::backdrop").backdropFilter
    }));
    assert.equal(dialogTheme.backdropBlur,"none","Details backdrop must avoid duplicate native menu/3D blur compositing");
    await page.evaluate(()=>{document.documentElement.dataset.theme="dark";});
    const dialogDark=await page.locator("[data-analytics-detail-dialog]").evaluate(node=>getComputedStyle(node).backgroundColor);
    assert.notEqual(dialogTheme.background,dialogDark,"Details dialog must match light and dark modes");
    checks+=5;
    const bounds=await page.locator("[data-command-wallet]").boundingBox();
    assert.ok(bounds && bounds.x>=-1 && bounds.x+bounds.width<=viewport.width+1,
      "Card must fit horizontal viewport: "+JSON.stringify({viewport,bounds}));
    checks+=3;

    // Regression: 7 Days / 30 Days / Month share equal columns; History deliberately
    // gets the canonical 1.6fr column for month/year text. All four must fit.
    for(const theme of ["dark","light"]) {
      await page.evaluate(value=>{ document.documentElement.dataset.theme=value; },theme);
      const controls=await page.locator(".portfolio-analytics-period-controls").evaluate(node=>{
        const buttons=[...node.children];
        const cells=buttons.map(el=>el.getBoundingClientRect());
        const parent=node.getBoundingClientRect();
        return {widths:cells.map(r=>r.width),lefts:cells.map(r=>r.left),right:parent.right,
          selectScheme:getComputedStyle(node.querySelector("select")).colorScheme};
      });
      assert.equal(controls.widths.length,4,"The analytics period controls must retain four columns");
      const periodWidths=controls.widths.slice(0,3);
      assert.ok(Math.max(...periodWidths)-Math.min(...periodWidths)<=2,
        "7 Days/30 Days/Month must have equal widths: "+JSON.stringify({viewport,theme,controls}));
      assert.ok(controls.widths[0]>0 && Math.abs(controls.widths[3]/controls.widths[0]-1.6)<=0.05,
        "History must retain its intended 1.6fr column: "+JSON.stringify({viewport,theme,controls}));
      assert.ok(Math.max(...controls.lefts.map((left,i)=>left+controls.widths[i]))<=controls.right+1,
        "Controls must fit in the original card: "+JSON.stringify({viewport,theme,controls}));
      assert.equal(controls.selectScheme,theme,"Native history menu must follow the active theme");
      checks+=5;
    }
    await page.evaluate(()=>{ document.documentElement.dataset.theme="dark"; });

    await page.locator(".portfolio-pass-front .portfolio-pass-owner").click();
    await page.waitForTimeout(580);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),true);
    checks++;
    await page.locator('[data-analytics-period="30d"]').click();
    await page.waitForTimeout(240);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),true,
      "Selecting the report period must not flip the card");
    assert.equal(await page.locator(".portfolio-analytics-day").count(),5,"Thirty days are accessible as five buckets");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,2);
    checks+=3;

    await page.locator('[data-analytics-period="7d"]').click();
    await page.waitForTimeout(240);
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,2,"Returning to cached 7D must not call Cloudflare");
    await page.locator('[data-analytics-period="month"]').click();
    await page.waitForTimeout(240);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),true,
      "This Month control must not flip the card");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,3,"This Month loads only once");
    assert.equal(await page.locator('[data-analytics-period="month"]').getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator('[data-analytics-month-select]').getAttribute("data-selected"),"false",
      "History must not also be selected for the current month");
    await page.locator('[data-analytics-month-select]').selectOption({index:1});
    await page.waitForTimeout(240);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),true);
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,4,"One query for selected historical month");
    assert.equal(await page.locator('[data-analytics-period="month"]').getAttribute("aria-pressed"),"false",
      "History selection must replace, not duplicate, Month activation");
    assert.equal(await page.locator('[data-analytics-month-select]').getAttribute("data-selected"),"true");
    checks+=9;

    const before=(await page.evaluate(()=>window.analyticsRequests)).length;
    await page.locator(".portfolio-analytics-day").last().click();
    await page.locator("[data-analytics-open-details]").click();
    assert.equal(await page.locator("[data-analytics-detail-dialog]").evaluate(e=>e.open),true);
    const modalBounds=await page.locator("[data-analytics-detail-dialog]").boundingBox();
    assert.ok(modalBounds && modalBounds.width<=442 && modalBounds.x>=0 && modalBounds.x+modalBounds.width<=viewport.width+1,
      "Details modal must stay within original 440px maximum: "+JSON.stringify({viewport,modalBounds}));
    const expectedDays=await page.locator(".portfolio-analytics-detail-list>div").count()-1;
    assert.ok(expectedDays>=28&&expectedDays<=31,"Historical month must expose exact daily rows");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,before,"Details and bar clicks are request-free");
    await page.locator("[data-analytics-close-details]").click();
    assert.equal(await page.locator("[data-analytics-detail-dialog]").evaluate(e=>e.open),false);
    checks+=5;

    await page.locator(".portfolio-pass-back .portfolio-pass-topline").click();
    await page.waitForTimeout(580);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),false,
      "Clicking noninteractive card area must keep existing flip behavior");
    await page.locator("[data-analytics-retry]").click();
    await page.waitForTimeout(60);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),false,
      "Front Retry must never flip the card");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,before+1,
      "Front Retry must request a fresh seven-day summary only");
    checks+=3;
    await page.close();
  }
  console.log("Dashboard analytics browser checks passed: "+checks);
} finally {
  await browser.close();
}
