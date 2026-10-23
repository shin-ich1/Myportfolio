import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

// Visual regression: media slot height is a property of the card width, never
// the source image's native width/height. Covers can be square, wide or tall.
test('All Project covers share the same fluid card media slot regardless of image dimensions', () => {
  assert.match(css, /\.media\s*\{[^}]*height:\s*clamp\(10rem,\s*55cqi,\s*11\.875rem\)/);
  assert.doesNotMatch(css, /\.project-showcase-track \.media\[data-public-cover-ratio="ready"\]/,
    'Project card slot must never use individual source image ratios');
  assert.doesNotMatch(app, /\.style\.setProperty\("--public-cover-native-ratio"/,
    'Renderer must not resize card containers based on uploaded image size');
});

test('Images occupy their entire media slot with uncropped foreground and shared decorative background', () => {
  assert.match(css, /\.public-media-frame__image\{[^}]*height:100%[^}]*object-fit:contain/);
  assert.match(css, /\.public-media-frame__ambient\{[^}]*object-fit:cover/);
  assert.doesNotMatch(css, /\.public-content-budget-card\s+\.media\s+img\s*\{\s*height:/,
    'Competing compact image height cap shrinks the cover inside its slot');
  assert.match(app, /function projectCardMediaMarkup\([\s\S]*?fillBackdrop: true/);
});

test('Custom Module single-image cards share layout-owned media space; videos and galleries preserve their owners', () => {
  assert.match(css, /\.dynamic-module-media\{[^}]*aspect-ratio:16\/9/);
  assert.match(app, /function dynamicModuleCardMediaMarkup\([\s\S]*?fillBackdrop: true/);
  assert.match(app, /function projectCardMediaMarkup\([\s\S]*?publicVideoFrameMarkup\(videoSource/);
  assert.match(css, /\.public-media-frame__video\{[^}]*object-fit:contain/);
});
