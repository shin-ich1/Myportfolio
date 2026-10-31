import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const stylesheet = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("function publicMessagePuzzleMarkup() {");
const tick = String.fromCharCode(96);
const first = app.indexOf(tick, start);
const last = app.indexOf(tick + ";", first + 1);
assert.ok(start >= 0 && first > start && last > first, "Use exact canonical puzzle HTML");
const markup = app.slice(first + 1, last);
const widgetless = markup
  .replace(/\$\{icon\("[^"]+"\)\}/g, "<svg aria-hidden='true'></svg>")
  .replace(" data-public-puzzle-layer hidden", " data-public-puzzle-layer");
const chromePath = process.env.LAN_TEST_CHROME || [
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
].find(path => {
  try { execFileSync("test", ["-x", path]); return true; } catch { return false; }
});
assert.ok(chromePath, "Chromium binary required for real CSS grid regression");

function geometry({ modalWidth, modalHeight, widgetWidth, widgetHeight }) {
  const widget = '<div data-turnstile-fixture style="width:' + widgetWidth
    + 'px;height:' + widgetHeight + 'px;background:#aaa">Verify you are human</div>';
  const content = widgetless.replace('<div class="public-message-turnstile-slot" data-public-turnstile-slot></div>',
    '<div class="public-message-turnstile-slot" data-public-turnstile-slot>' + widget + '</div>');
  assert.notEqual(content, widgetless, "Canonical Turnstile placeholder must exist");
  const script = [
    'function measure() {',
    ' const sels={card:".public-message-puzzle-card",scene:".public-message-puzzle-scene",slider:".public-message-puzzle-slider",widget:"[data-turnstile-fixture]",foot:".public-message-puzzle-foot"};',
    ' const result={};',
    ' for(const [name,selector] of Object.entries(sels)){const node=document.querySelector(selector),r=node.getBoundingClientRect();result[name]={top:r.top,bottom:r.bottom,width:r.width,height:r.height};}',
    ' result.card.scrollHeight=document.querySelector(sels.card).scrollHeight;',
    ' result.card.clientHeight=document.querySelector(sels.card).clientHeight;',
    ' document.querySelector("#geometry-result").textContent=JSON.stringify(result);',
    '}',
    'document.addEventListener("DOMContentLoaded",measure);'
  ].join("\n");
  const html = '<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>' + stylesheet + '</style>'
    + '<div class="modal-box public-message-modal" style="width:' + modalWidth + 'px">'
    + '<div class="public-message-dialog"><div class="public-private-message-app" style="height:' + modalHeight + 'px">'
    + content + '</div></div></div><pre id="geometry-result"></pre><script>' + script + '</script>';
  const dir = mkdtempSync(join(tmpdir(), "lan-puzzle-geometry-"));
  try {
    const input = join(dir, "test.html");
    writeFileSync(input, html);
    const output = execFileSync(chromePath, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--virtual-time-budget=300",
      "--window-size=1280,900", "--dump-dom", "file://" + input
    ], { encoding: "utf8", timeout: 15000, maxBuffer: 3 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const encoded = output.match(/<pre id="geometry-result">([^<]+)<\/pre>/)?.[1];
    assert.ok(encoded, "Chromium must output measured real CSS layout geometry");
    return JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = [
  { name: "desktop constrained message modal", modalWidth:528, modalHeight:360, widgetWidth:300, widgetHeight:65 },
  { name: "375px mobile message modal", modalWidth:343, modalHeight:350, widgetWidth:300, widgetHeight:65 },
  { name: "320px compact widget", modalWidth:288, modalHeight:340, widgetWidth:150, widgetHeight:140 },
  { name: "short landscape viewport", modalWidth:432, modalHeight:290, widgetWidth:300, widgetHeight:65 }
];

for (const scenario of cases) {
  test("Turnstile interaction must not overlay picture or slider: " + scenario.name, () => {
    const result = geometry(scenario);
    assert.ok(result.scene.bottom <= result.slider.top + 1,
      "Puzzle scene must be above slider, not behind it: " + JSON.stringify(result));
    assert.ok(result.slider.bottom <= result.widget.top + 1,
      "Slider must be above expanded Turnstile: " + JSON.stringify(result));
    assert.ok(result.widget.bottom <= result.foot.top + 1,
      "Expanded Turnstile must not cover status/footer: " + JSON.stringify(result));
    assert.ok(Math.abs(result.scene.height - result.scene.width * 9 / 16) < 3,
      "Puzzle image aspect ratio must be preserved while Turnstile expands: " + JSON.stringify(result));
    assert.ok(result.card.scrollHeight >= result.card.clientHeight,
      "Any extra rows must scroll inside card, not cover picture");
  });
}
