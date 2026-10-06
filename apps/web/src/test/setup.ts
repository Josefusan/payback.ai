import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no layout engine, so AG Grid sees a zero-sized viewport and renders no rows.
 * These stubs give every element a fixed box; they are test-only and never shipped.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: ResizeObserverStub });
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof HTMLElement !== "undefined") {
  for (const [property, value] of [
    ["offsetHeight", 600],
    ["offsetWidth", 900],
    ["clientHeight", 600],
    ["clientWidth", 900],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => value });
  }
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect;
  };
}
