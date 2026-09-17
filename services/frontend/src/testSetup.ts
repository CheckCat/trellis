// jsdom (the test environment configured in vite.config.ts) has no real
// layout engine and does not implement `Range.getClientRects()` /
// `Range.getBoundingClientRect()` at all — verified:
// `document.createRange().getClientRects` is `undefined` under the
// project's jsdom version, not a stub that just returns nothing.
// `@uiw/react-codemirror` (task 015's SQL editor) measures text geometry
// through these on every content change, scheduled via
// `requestAnimationFrame` — the resulting `TypeError` is thrown outside any
// test's own call stack (inside a jsdom-scheduled rAF callback), which
// still fails the whole `vitest run` with an "Uncaught Exception" and a
// non-zero exit code even though the test that triggered it already
// passed. The polyfill below returns an empty/zero-sized rect, which is
// fine for headless tests that never assert on pixel geometry.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = function (): DOMRectList {
    return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
  };
}

if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}
