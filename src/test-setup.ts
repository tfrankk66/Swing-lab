/**
 * Shims happy-dom does not provide, for the render smoke tests.
 *
 * Mantine reaches for `matchMedia` (colour scheme, `visibleFrom`) and
 * `ResizeObserver` (ScrollArea) on mount, and happy-dom implements neither. Both
 * are stubbed rather than emulated: these tests ask "does it mount and put
 * the right words on screen", not "does it lay out correctly", which happy-dom
 * could not answer anyway.
 *
 * Runs for every test file, including the node-environment ones, so it has to
 * check for a document before touching one.
 */
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}
