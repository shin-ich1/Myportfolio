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
    await page.addStyleTag({content:read("admin/css/dashboard.css")+"\n"+read("admin/css/admin-layout.css")});
    await page.evaluate(()=>{ window.analyticsRequests=[]; });
    await page.addScriptTag({content:program});
    await page.waitForSelector(".portfolio-analytics-day");
    assert.equal(await page.locator(".portfolio-analytics-day").count(),7,"7-day graph must be ready");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,1,"Initial Dashboard load uses one request");
    const bounds=await page.locator("[data-command-wallet]").boundingBox();
    assert.ok(bounds && bounds.x>=-1 && bounds.x+bounds.width<=viewport.width+1,
      "Card must fit horizontal viewport: "+JSON.stringify({viewport,bounds}));
    checks+=3;

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
    await page.locator('[data-analytics-month-select]').selectOption({index:1});
    await page.waitForTimeout(240);
    assert.equal(await page.locator("[data-command-wallet]").evaluate(e=>e.classList.contains("is-flipped")),true);
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,3,"One query for selected historical month");
    checks+=3;

    const before=(await page.evaluate(()=>window.analyticsRequests)).length;
    await page.locator(".portfolio-analytics-day").last().click();
    await page.locator("[data-analytics-open-details]").click();
    assert.equal(await page.locator("[data-analytics-detail-dialog]").evaluate(e=>e.open),true);
    const expectedDays=await page.locator(".portfolio-analytics-detail-list>div").count()-1;
    assert.ok(expectedDays>=28&&expectedDays<=31,"Historical month must expose exact daily rows");
    assert.equal((await page.evaluate(()=>window.analyticsRequests)).length,before,"Details and bar clicks are request-free");
    await page.locator("[data-analytics-close-details]").click();
    assert.equal(await page.locator("[data-analytics-detail-dialog]").evaluate(e=>e.open),false);
    checks+=4;

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
