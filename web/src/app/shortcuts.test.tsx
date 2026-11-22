import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NAV_ITEMS } from "./nav";
import { GO_KEYS, GO_WINDOW_MS, isTyping, pathForKey, shortcutKeys, useGoShortcuts } from "./shortcuts";

afterEach(cleanup);

describe("the key map", () => {
  it("gives each page one key, never two pages the same key", () => {
    const keys = Object.values(GO_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const path of Object.keys(GO_KEYS)) expect(NAV_ITEMS.some((i) => i.path === path), path).toBe(true);
  });

  it("only opens built pages", () => {
    for (const path of Object.keys(GO_KEYS)) expect(NAV_ITEMS.find((i) => i.path === path)?.built, path).toBe(true);
  });

  it("finds the page for a key, in either case", () => {
    expect(pathForKey("s")).toBe("/stacks");
    expect(pathForKey("S")).toBe("/stacks");
    expect(pathForKey(",")).toBe("/settings");
    expect(pathForKey("?")).toBe("/docs");
    expect(pathForKey("z")).toBeUndefined();
  });

  it("shows a page's keys, or none", () => {
    expect(shortcutKeys("/stacks")).toEqual(["G", "S"]);
    expect(shortcutKeys("/databases")).toBeUndefined();
  });
});

describe("isTyping", () => {
  it.each([
    ["a text box", () => document.createElement("input"), true],
    ["a search box", () => Object.assign(document.createElement("input"), { type: "search" }), true],
    ["a checkbox", () => Object.assign(document.createElement("input"), { type: "checkbox" }), false],
    ["a text area", () => document.createElement("textarea"), true],
    ["a button", () => document.createElement("button"), false],
    ["inside a code editor", () => {
      const editor = document.createElement("div");
      editor.className = "cm-editor";
      const line = document.createElement("div");
      editor.append(line);
      return line;
    }, true],
  ])("%s: %s", (_, make, want) => {
    expect(isTyping(make())).toBe(want);
  });
});

function Harness({ go, toggle, now }: { go: (p: string) => void; toggle: () => void; now: () => number }) {
  useGoShortcuts({ go, toggleSidebar: toggle, now });
  return <input aria-label="field" />;
}

describe("useGoShortcuts", () => {
  const setup = () => {
    let t = 1000;
    const go = vi.fn();
    const toggle = vi.fn();
    const r = render(<Harness go={go} toggle={toggle} now={() => t} />);
    const press = (key: string, init: KeyboardEventInit = {}, target: Element | Window = window) => fireEvent.keyDown(target, { key, ...init });
    return { go, toggle, press, later: (ms: number) => (t += ms), field: r.getByLabelText("field") };
  };

  it("opens a page with G then its key", () => {
    const { go, press } = setup();
    press("g");
    press("s");
    expect(go).toHaveBeenCalledWith("/stacks");
  });

  it("forgets G after a moment, and ignores a key no page has", () => {
    const { go, press, later } = setup();
    press("g");
    later(GO_WINDOW_MS + 1);
    press("s");
    press("g");
    press("z");
    press("s"); // G was used up by z
    expect(go).not.toHaveBeenCalled();
  });

  it("stays out of the way while typing, and with Ctrl, Alt or Meta", () => {
    const { go, toggle, press, field } = setup();
    press("g", {}, field);
    press("s", {}, field);
    press("[", {}, field);
    press("g", { ctrlKey: true });
    press("s");
    press("[", { metaKey: true });
    expect(go).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("folds or unfolds the sidebar with [", () => {
    const { toggle, press } = setup();
    press("[");
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
