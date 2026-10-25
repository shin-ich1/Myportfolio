import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('function bindPublicMediaFrames(');
const end = app.indexOf('\nfunction projectCardMediaMarkup(', start);
assert.ok(start >= 0 && end > start, 'Shared image/frame binder must exist');
const binder = app.slice(start, end);
const geometryStart = app.indexOf('function syncPublicIntrinsicMediaFrame(');
assert.ok(geometryStart >= 0 && geometryStart < start, 'Canonical intrinsic-media geometry must precede the shared binder');
const geometry = app.slice(geometryStart, start);

function bindImage({ imageWidth = 1600, imageHeight = 900, frameWidth = 320, frameHeight = 180 } = {}) {
  class FrameElement {}
  let resizeCallback;
  class ResizeObserverMock {
    constructor(callback) { resizeCallback = callback; }
    observe(frame) { assert.ok(frame instanceof FrameElement); }
  }
  const ambientAttrs = new Map();
  const ambient = {
    setAttribute(name, value) { ambientAttrs.set(name, value); },
    getAttribute(name) { return ambientAttrs.get(name) ?? null; },
    hasAttribute(name) { return ambientAttrs.has(name); },
    removeAttribute(name) { ambientAttrs.delete(name); },
  };
  const image = {
    naturalWidth: imageWidth, naturalHeight: imageHeight,
    currentSrc: 'https://cdn.example.org/cover.jpg', src: 'https://cdn.example.org/cover.jpg',
    complete: true, dataset: {},
    addEventListener() {}, getAttribute(name) { return name === 'src' ? this.src : null; },
    setAttribute(name, value) { if (name === 'src') this.src = value; },
  };
  const classes = new Set(['media-loading']);
  const frame = new FrameElement();
  Object.assign(frame, {
    dataset: {}, clientWidth: frameWidth, clientHeight: frameHeight,
    classList: {
      contains(value) { return classes.has(value); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      add(...names) { names.forEach(name => classes.add(name)); },
    },
    querySelector(selector) {
      return selector === '[data-public-media-image]' ? image
        : selector === '[data-public-media-ambient]' ? ambient : null;
    },
  });
  const bind = new Function('HTMLElement', 'ResizeObserver', 'window', 'document', 'prioritizePublicMediaInView',
    `${geometry}\n${binder}\nreturn bindPublicMediaFrames;`)(FrameElement, ResizeObserverMock,
    { clearTimeout() {} }, { documentElement: {} }, () => {});
  bind({ querySelectorAll() { return [frame]; } });
  return { ambient, frame, onResize() { assert.equal(typeof resizeCallback, 'function'); resizeCallback([]); } };
}

test('Matching landscape cover skips unnecessary duplicated blurred asset', () => {
  const { ambient } = bindImage();
  assert.equal(ambient.hasAttribute('src'), false);
});

test('Letterboxed future cover receives the same ambient image and updates on responsive resize', () => {
  const card = bindImage({ imageWidth: 1000, imageHeight: 1000 });
  assert.equal(card.ambient.getAttribute('src'), 'https://cdn.example.org/cover.jpg');
  card.frame.clientHeight = 320;
  card.onResize();
  assert.equal(card.ambient.hasAttribute('src'), false, 'Ambient is removed when the card now fits its image');
  card.frame.clientHeight = 180;
  card.onResize();
  assert.equal(card.ambient.getAttribute('src'), 'https://cdn.example.org/cover.jpg', 'Ambient returns when bars reappear');
});
