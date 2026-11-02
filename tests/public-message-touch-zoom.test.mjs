import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const css = read("styles.css");
const html = read("index.html");
const app = read("app.js");
const liveBaseline = "4d96a5314bbb060cd74a1cf7726b385e92f78b24";
const originalCss = execFileSync("git", ["show", liveBaseline + ":styles.css"], {encoding:"utf8"});

function rule(selector, text=css) {
  const needle = selector + "{";
  const matches = text.split(needle);
  assert.equal(matches.length, 2, "One canonical CSS rule for " + selector);
  const end = matches[1].indexOf("}");
  assert.ok(end >= 0, "Rule closes: " + selector);
  return matches[1].slice(0, end);
}

test("Public Message form text fields have >=16px text at all viewport widths without changing their labels",()=>{
  const controls = rule(".public-message-form input,.public-message-form textarea,.public-private-reply textarea");
  assert.match(controls,/font:inherit; font-size:16px;|font:inherit;font-size:16px;/,
    "iOS focus zoom is caused by inheriting the form label's ~12px font");
  assert.match(rule(".public-message-form label"),/font-size:\.76rem/);
  assert.match(app,/name="name" required type="text"/);
  assert.match(app,/name="message" required rows="5"/);
});

test("One shared Public Message dialog gesture policy prevents double tap zoom while retaining page scrolling and pinch zoom",()=>{
  assert.match(rule(".public-message-dialog"),/(?:^|;)touch-action:manipulation(?:;|$)/);
  assert.doesNotMatch(html,/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1/i);
  assert.doesNotMatch(css,/html\{[^}]*touch-action:none|body\{[^}]*touch-action:none/);
});

test("Canonical native range input exclusively owns horizontal puzzle drag without duplicate device-specific handlers",()=>{
  assert.match(rule(".public-message-puzzle-slider input"),/(?:^|;)touch-action:none(?:;|$)/);
  assert.match(rule(".public-message-puzzle-slider input"),/z-index:3;width:100%;height:100%/);
  assert.match(app,/slider\.oninput = \(\) => setPublicMessagePuzzleSlider\(slider, slider\.value\)/);
  assert.match(app,/slider\.onchange = async \(\) =>/);
  assert.doesNotMatch(app.slice(app.indexOf("function publicMessagePuzzleMarkup()"),app.indexOf("async function openPublicMessagePuzzleVerification(")),/addEventListener\("(?:touchstart|touchmove|touchend|pointermove)"/);
  assert.doesNotMatch(css,/@media[^\{]*\{[^\}]*\.public-message-puzzle-slider input\{[^}]*touch-action/);
});

test("Visible puzzle piece and slider thumb follow native range input directly without horizontal animation lag",()=>{
  const shared = rule(".public-message-puzzle-target,.public-message-puzzle-piece");
  assert.doesNotMatch(shared,/transition:/,"Moving piece must not inherit the target's left transition");
  const target = rule(".public-message-puzzle-target");
  assert.match(target,/transition:left \.16s var\(--ease\)/,
    "Keep target movement animation when a wrong-answer challenge is rotated");
  const piece = rule(".public-message-puzzle-piece");
  assert.match(piece,/transition:top \.16s var\(--ease\),width \.16s var\(--ease\),height \.16s var\(--ease\)/,
    "Keep non-horizontal piece animations");
  assert.doesNotMatch(piece,/transition:left/,"Piece must move in sync with finger, not chase it");
  assert.doesNotMatch(rule(".public-message-puzzle-thumb"),/transition:left/,
    "Visible thumb must track same native range value without visual delay");
  assert.match(app,/slider\.oninput = \(\) => setPublicMessagePuzzleSlider\(slider, slider\.value\)/);
});

test("Only the three existing Public Message CSS owners may differ from the verified published LIVE source",()=>{
  const changes = [
    [".public-message-dialog", "min-width:0}", "min-width:0;touch-action:manipulation}"],
    [".public-message-form input,.public-message-form textarea,.public-private-reply textarea", "font:inherit;outline:0;", "font:inherit;font-size:16px;outline:0;"],
    [".public-message-puzzle-slider input", "opacity:0;cursor:inherit}", "opacity:0;cursor:inherit;touch-action:none}"]
  ];
  let expected = originalCss;
  for (const [selector, before, after] of changes) {
    const current = rule(selector, expected);
    const original = selector + "{" + current + "}";
    assert.ok(original.includes(before), "Baseline CSS selector changed: " + selector);
    const replacement = original.replace(before, after);
    assert.notEqual(original, replacement, "No change to " + selector);
    expected = expected.replace(original,replacement);
  }
  assert.equal(css, expected, "No added CSS patch layer, no wide/compact layout change, no unrelated styling");
});
