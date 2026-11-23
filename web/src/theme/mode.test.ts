import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILT_INS } from "./builtins";
import { resolveId, schemeOf, useTheme } from "./store";
import type { ThemeData } from "./types";

const dusk: ThemeData = { schema: 1, id: "dusk", name: "Dusk", base: "paper-dark", colors: { primary: "#ffb454" } };
const day: ThemeData = { schema: 1, id: "day", name: "Day", base: "paper", colors: { primary: "#aa2200" } };
const rootStyle = (name: string) => document.documentElement.style.getPropertyValue(name);

const reset = () => {
  localStorage.clear();
  useTheme.setState({ custom: [], mode: "light", lightId: "paper", darkId: "paper-dark", osDark: false, activeId: "paper", draft: null });
  document.documentElement.removeAttribute("style");
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
  reset();
});
afterEach(() => {
  reset();
  vi.unstubAllGlobals();
});

describe("which theme shows", () => {
  it("is the one for light, the one for dark, or the one for what the operating system is using", () => {
    const s = { lightId: "day", darkId: "dusk" };
    expect(resolveId({ ...s, mode: "light", osDark: true })).toBe("day");
    expect(resolveId({ ...s, mode: "dark", osDark: false })).toBe("dusk");
    expect(resolveId({ ...s, mode: "system", osDark: false })).toBe("day");
    expect(resolveId({ ...s, mode: "system", osDark: true })).toBe("dusk");
  });

  it("knows a theme's scheme from its background", () => {
    expect(schemeOf({ base: "paper", colors: {} })).toBe("light");
    expect(schemeOf({ base: "paper-dark", colors: {} })).toBe("dark");
    expect(schemeOf({ base: "paper", colors: { background: "#111111", text: "#eeeeee" } })).toBe("dark"); // a light theme made dark
  });
});

describe("choosing", () => {
  it("makes a theme the one for its scheme and shows that scheme", () => {
    useTheme.setState({ custom: [dusk, day] });
    useTheme.getState().select("dusk");
    expect(useTheme.getState()).toMatchObject({ mode: "dark", darkId: "dusk", lightId: "paper", activeId: "dusk" });
    useTheme.getState().select("day");
    expect(useTheme.getState()).toMatchObject({ mode: "light", lightId: "day", darkId: "dusk", activeId: "day" }); // dark's theme is kept
    expect(rootStyle("--primary")).toBe("#aa2200");
  });

  it("keeps System when the chosen theme is for the scheme the OS is using, and leaves it when it is not", () => {
    useTheme.setState({ custom: [dusk, day], mode: "system", osDark: true, activeId: "paper-dark" });
    useTheme.getState().select("dusk");
    expect(useTheme.getState()).toMatchObject({ mode: "system", darkId: "dusk", activeId: "dusk" });
    useTheme.getState().select("day"); // a light theme while the OS is dark: show it
    expect(useTheme.getState()).toMatchObject({ mode: "light", lightId: "day", activeId: "day" });
  });

  it("switches mode, and follows the operating system in System", () => {
    useTheme.setState({ custom: [dusk, day], lightId: "day", darkId: "dusk" });
    useTheme.getState().setMode("system");
    expect(useTheme.getState().activeId).toBe("day"); // the OS is light
    useTheme.getState().setOsDark(true);
    expect(useTheme.getState().activeId).toBe("dusk");
    expect(rootStyle("color-scheme")).toBe("dark");
    useTheme.getState().setOsDark(false);
    expect(useTheme.getState().activeId).toBe("day");
    useTheme.getState().setMode("dark");
    expect(useTheme.getState().activeId).toBe("dusk");
  });

  it("makes a new theme the one for the scheme it was copied from", () => {
    useTheme.getState().create("Mine", { ...dusk });
    expect(useTheme.getState()).toMatchObject({ mode: "dark", darkId: "mine", lightId: "paper", activeId: "mine" });
    useTheme.getState().create("Plain", undefined);
    expect(useTheme.getState()).toMatchObject({ mode: "light", lightId: "plain", darkId: "mine" });
  });

  it("gives a slot back to the built-in theme when its theme is deleted", () => {
    useTheme.setState({ custom: [dusk, day], mode: "dark", lightId: "day", darkId: "dusk", activeId: "dusk" });
    useTheme.getState().remove("dusk");
    expect(useTheme.getState()).toMatchObject({ lightId: "day", darkId: "paper-dark", activeId: "paper-dark" });
    useTheme.getState().remove("day");
    expect(useTheme.getState().lightId).toBe("paper");
  });

  it("drops an unsaved change when another theme shows, but not when the same one does", () => {
    useTheme.setState({ custom: [dusk, day], mode: "dark", darkId: "dusk", activeId: "dusk" });
    useTheme.getState().edit("text", "#fafafa");
    useTheme.getState().setOsDark(true); // not System: nothing changes
    expect(useTheme.getState().draft).not.toBeNull();
    useTheme.getState().setMode("light");
    expect(useTheme.getState().draft).toBeNull();
  });
});

describe("what is kept for the next start", () => {
  it("keeps the mode, the two choices, and the tokens of each scheme for the boot script", () => {
    useTheme.getState().create("Mine", { ...dusk });
    expect(localStorage.getItem("devdeck.theme.mode")).toBe("dark");
    expect(localStorage.getItem("devdeck.theme.dark")).toBe("mine");
    expect(localStorage.getItem("devdeck.theme.light")).toBeNull(); // unchanged: the default
    expect(JSON.parse(localStorage.getItem("devdeck.theme.tokens.dark") ?? "{}")["--primary"]).toBe("#ffb454");
    expect(localStorage.getItem("devdeck.theme.tokens.light")).toBeNull(); // plain Paper is what the stylesheet shows
  });

  it("does not keep changes that are only being tried", () => {
    useTheme.setState({ custom: [dusk], mode: "dark", darkId: "dusk", activeId: "dusk" });
    useTheme.getState().edit("primary", "#112233");
    expect(rootStyle("--primary")).toBe("#112233");
    expect(JSON.parse(localStorage.getItem("devdeck.theme.tokens.dark") ?? "{}")["--primary"]).not.toBe("#112233");
  });
});

describe("a store that starts from what was kept", () => {
  const start = async () => {
    vi.resetModules(); // the store reads storage when its module loads
    return (await import("./store")).useTheme.getState();
  };

  it("reads the mode and the two choices, and ignores a theme that is gone", async () => {
    localStorage.setItem("devdeck.themes", JSON.stringify([dusk]));
    localStorage.setItem("devdeck.theme.mode", "system");
    localStorage.setItem("devdeck.theme.light", "ghost");
    localStorage.setItem("devdeck.theme.dark", "dusk");
    expect(await start()).toMatchObject({ mode: "system", lightId: "paper", darkId: "dusk", activeId: "paper" });
  });

  it("turns the one theme kept before modes into the one for its scheme, and drops the old key", async () => {
    localStorage.setItem("devdeck.themes", JSON.stringify([dusk]));
    localStorage.setItem("devdeck.theme.active", "dusk");
    expect(await start()).toMatchObject({ mode: "dark", darkId: "dusk", lightId: "paper", activeId: "dusk" });
    expect(localStorage.getItem("devdeck.theme.active")).toBeNull();
    expect(JSON.parse(localStorage.getItem("devdeck.theme.tokens.dark") ?? "{}")["--bg"]).toBe(BUILT_INS["paper-dark"].tokens["--bg"]);
  });

  it("starts in light mode with Paper when nothing was kept", async () => {
    expect(await start()).toMatchObject({ mode: "light", lightId: "paper", darkId: "paper-dark", activeId: "paper" });
  });
});
