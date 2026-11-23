import { configure } from "@testing-library/react";

// A busy machine (or CI running tests in parallel) can take longer than a second to render a page.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no matchMedia or ResizeObserver; the sidebar and Radix need them.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
