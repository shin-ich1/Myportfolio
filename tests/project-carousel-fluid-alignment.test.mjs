import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const start = source.indexOf('function setupProjectShowcaseCarousel()');
const end = source.indexOf('\nfunction setupEditingCarousel()', start);
assert.ok(start >= 0 && end > start, 'Project carousel must have one canonical controller');
const owner = source.slice(start, end);

test('Project carousel re-aligns existing active card on actual container width changes', () => {
  assert.match(owner, /ResizeObserver\(refresh\)/);
  assert.match(owner, /(?:last|previous)(?:Track|Measured)?Width/);
  assert.match(owner, /(?:last|previous)(?:Card)?Step/);
  assert.match(owner, /track\.scrollTo\(\{\s*left:\s*target,\s*behavior:\s*"instant"/);
  assert.match(owner, /(?:current|active|stable|selected)(?:Card)?Index/);
});

test('Carousel sizing uses actual card geometry; no screen-model-specific overrides', () => {
  assert.match(owner, /card\.getBoundingClientRect\(\)\.width/);
  assert.doesNotMatch(owner, /iPhone|android|screen\.width|\b390\b|\b440\b|\b820\b/);
  assert.match(css, /@container public-carousel \(max-width:540px\)/);
});
