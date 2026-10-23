import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const owner = app.slice(app.indexOf('function bindPublicMediaFrames('), app.indexOf('\nfunction projectCardMediaMarkup('));

test('Project image cover follows intrinsic ratio without a mobile-only height override', () => {
  assert.match(css, /@container public-carousel \(max-width:1220px\)\{[\s\S]*?\.project-showcase-track \.media\[data-public-cover-ratio="ready"\]\{[^}]*aspect-ratio:var\(--public-cover-native-ratio\)/);
  assert.match(css, /\.project-showcase-track \.media\[data-public-cover-ratio="ready"\]\{[^}]*max-height:/);
  assert.doesNotMatch(css, /\.public-content-budget-card\s+\.media\s+img\s*\{\s*height:/);
});

test('One canonical loaded-image handler sets cover ratio on both Project and Module media wrappers', () => {
  assert.match(owner, /!ambient \|\| !image\.naturalWidth \|\| !image\.naturalHeight/);
  assert.match(owner, /(?:parentElement|closest)/);
  assert.match(owner, /classList\.contains\("media"\)/);
  assert.match(owner, /classList\.contains\("dynamic-module-media"\)/);
  assert.match(owner, /style\.setProperty\("--public-cover-native-ratio"/);
  assert.match(owner, /dataset\.publicCoverRatio = "ready"/);
});

test('Dynamic Module image media ratio is shared across base, compact and media-gallery layouts', () => {
  assert.match(css, /\.dynamic-module-media\{[^}]*aspect-ratio:var\(--public-cover-native-ratio,16\/9\)/);
  assert.match(css, /@container public-slot \(max-width:760px\)\{[\s\S]*?\.dynamic-module-media\{[^}]*aspect-ratio:var\(--public-cover-native-ratio,16\/9\)/);
  assert.match(css, /\.dynamic-presentation-media-gallery \.dynamic-module-media\{aspect-ratio:var\(--public-cover-native-ratio,16\/10\)/);
});

test('No video, Photo Editing or public detail media switch to ratio-adaptive covers', () => {
  const card = app.slice(app.indexOf('function projectCardMediaMarkup('), app.indexOf('\nfunction projectSingleActionMarkup('));
  assert.match(card, /publicVideoFrameMarkup\(videoSource/);
  assert.doesNotMatch(card, /publicVideoFrameMarkup\([^\n]*fillBackdrop/);
  assert.match(css, /\.public-media-frame__image\{[^}]*object-fit:contain/);
});
