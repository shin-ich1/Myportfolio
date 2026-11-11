import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeRepoText, readReviewedPublicSource, reviewedHeroReservedCssCandidate} from "./public-reviewed-baseline.mjs";

const read = path => normalizeRepoText(readFileSync(new URL("../" + path, import.meta.url), "utf8"));
const css = read("styles.css");
const html = read("index.html");
const app = read("app.js");
const reviewedCss = readReviewedPublicSource("styles.css");

function rule(selector, text=css) {
  const needle = selector + "{";
  const owners = [];
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) {
    if (index === 0 || /[}\n]/.test(text[index - 1])) owners.push(index);
  }
  assert.equal(owners.length, 1, "One canonical CSS rule for " + selector);
  const after = text.slice(owners[0] + needle.length);
  const end = after.indexOf("}");
  assert.ok(end >= 0, "Rule closes: " + selector);
  return after.slice(0, end);
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

test("Puzzle range native touch thumb has a 44px hit target aligned with the visible drag handle",()=>{
  const input = rule(".public-message-puzzle-slider input");
  assert.match(input,/(?:^|;)appearance:none(?:;|$)/,
    "Browser-default invisible 16px native thumb does not match the visual ~34px handle");
  assert.match(input,/(?:^|;)touch-action:none(?:;|$)/,
    "Horizontal puzzle gestures must not scroll the message card");
  const webkit = rule(".public-message-puzzle-slider input::-webkit-slider-thumb");
  const firefox = rule(".public-message-puzzle-slider input::-moz-range-thumb");
  for (const [name, nativeThumb] of [["WebKit",webkit],["Firefox",firefox]]) {
    assert.match(nativeThumb,/width:2\.75rem;?/,
      name + " touch hit target must be at least 44px");
    assert.match(nativeThumb,/height:2\.75rem;?/,
      name + " touch hit target must be at least 44px");
    assert.match(nativeThumb,/background:transparent/,
      name + " native thumb must stay invisible behind existing visual handle");
  }
  assert.match(rule(".public-message-puzzle-thumb"),/width:clamp\(2rem,9cqi,2\.25rem\)/,
    "Existing visible blue handle design is unchanged");
  assert.doesNotMatch(app.slice(app.indexOf("function publicMessagePuzzleMarkup()"),app.indexOf("async function openPublicMessagePuzzleVerification(")),
    /addEventListener\("(?:touchstart|touchmove|touchend|pointerdown|pointermove)"/,
    "Keep one native range gesture owner and avoid competing listeners");
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

test("Public Message slider, footer, and all other CSS remain identical to reviewed main",()=>{
  // Keep the full stylesheet byte-identical to reviewed main except the
  // exact, proven Hero sizing change. Message, footer, and all other rules
  // remain protected; do not exempt an entire section or stylesheet.
  assert.equal(css, reviewedHeroReservedCssCandidate(reviewedCss),
    "An unrelated Public CSS owner changed after the reviewed main baseline");
});

test("Public CSS baseline checks tolerate Windows CRLF but still detect edits",()=>{
  const winCheckout=css.replace(/\n/g,"\r\n");
  assert.equal(normalizeRepoText(winCheckout),reviewedHeroReservedCssCandidate(reviewedCss),
    "Checkout line endings must not create false Public CSS regression failures");
  assert.notEqual(normalizeRepoText(winCheckout+"\r\n.unapproved-override{display:none}"),reviewedHeroReservedCssCandidate(reviewedCss),
    "A real unexpected CSS override must still fail the baseline check");
});
