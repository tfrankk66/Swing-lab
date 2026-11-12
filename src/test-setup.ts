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

  // Node 22+ ships its own global `localStorage`, which is undefined (or
  // throws) unless Node is started with --localstorage-file, and it shadows
  // happy-dom's. The coach panel's key storage is tested against a real
  // Storage, so give it one whenever the one in scope does not work.
  let storageWorks = false;
  try {
    window.localStorage.setItem("__probe", "1");
    window.localStorage.removeItem("__probe");
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
  if (!storageWorks) {
    const data = new Map<string, string>();
    const memory: Storage = {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => void data.delete(key),
      setItem: (key, value) => void data.set(key, String(value)),
    };
    Object.defineProperty(window, "localStorage", {
      value: memory,
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: memory,
      configurable: true,
    });
  }
}
