import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyTokens, clearTokens } from "./apply";
import { BUILT_INS, roleColor, tokensOf } from "./builtins";
import { contrastChecks } from "./checks";
import { blend, contrast, readableOn, tokensWith } from "./derive";
import { isHexColor, normalizeHex, parseTheme, slugOf } from "./validate";

// Read from disk: Vitest empties CSS imports (css: false), even ?raw ones.
const css = readFileSync("src/design/tokens.css", "utf8"); // tests run from the web folder

/** The `--name: value;` lines of the first :root block of tokens.css. */
function rootTokens(): Record<string, string> {
  const block = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out[m[1]] = m[2].replace(/\s+/g, " ").trim();
  return out;
}

describe("Paper", () => {
  it("has exactly the values design/tokens.css has", () => {
    const fromCss = rootTokens();
    for (const [name, value] of Object.entries(BUILT_INS.paper.tokens)) {
      if (name === "color-scheme") continue;
      expect(fromCss[name], name).toBe(value.replace(/\s+/g, " "));
    }
  });

  it("passes every contrast check", () => {
    const failing = contrastChecks(BUILT_INS.paper.tokens).filter((c) => !c.ok);
    expect(failing.map((c) => `${c.id} ${c.ratio.toFixed(1)}`)).toEqual([]);
  });

  it("changes nothing when no colour is changed", () => {
    expect(tokensOf({ base: "paper", colors: {} })).toEqual(BUILT_INS.paper.tokens);
  });
});

describe("Paper Dark", () => {
  const dark = BUILT_INS["paper-dark"].tokens;

  it("is a dark page with light text, light logo marks and a heavier shadow", () => {
    expect(dark["color-scheme"]).toBe("dark");
    expect(dark["--bg"]).toBe("#0d0d0d");
    expect(contrast(dark["--ink"], dark["--bg"])).toBeGreaterThan(15);
    expect(dark["--mark-prompt"]).toBe("#4ee8b5");
    expect(dark["--shadow-float"]).toContain("0.5");
  });

  it("passes every contrast check", () => {
    const failing = contrastChecks(dark).filter((c) => !c.ok);
    expect(failing.map((c) => `${c.id} ${c.ratio.toFixed(1)}`)).toEqual([]);
  });

  it("reads the on-primary text and hover from the lighter primary", () => {
    expect(dark["--on-primary"]).toBe("#0a0a0a");
    expect(contrast(dark["--primary-hover"], dark["--bg"])).toBeGreaterThan(contrast(dark["--primary"], dark["--bg"]));
  });
});

describe("deriving from a few colours", () => {
  it("works out the softer text, hover fills and the sidebar from what was picked", () => {
    const t = tokensWith(BUILT_INS.paper.tokens, { background: "#101820", text: "#f5f7fa", controls: "#1b2733", primary: "#ffb454" });
    expect(t["color-scheme"]).toBe("dark");
    expect(t["--sidebar"]).toBe("#101820");
    expect(t["--on-primary"]).toBe("#0a0a0a"); // dark text on a light orange
    expect(contrast(t["--ink-2"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--ink-3"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(t["--fill-hover"]).not.toBe(t["--fill"]);
    expect(t["--link"]).toBe("#ffb454");
    expect(t["--sidebar-accent"]).toBe("#1b2733");
  });

  it("keeps what a changed colour does not touch, and follows the background with the panels the person did not colour", () => {
    const t = tokensWith(BUILT_INS.paper.tokens, { success: "#00aa00" });
    expect(t["--good"]).toBe("#00aa00");
    expect({ ...t, "--good": BUILT_INS.paper.tokens["--good"] }).toEqual(BUILT_INS.paper.tokens);

    const night = tokensWith(BUILT_INS.paper.tokens, { background: "#000000", text: "#ffffff" });
    expect(night["--surface-float"]).not.toBe("#ffffff"); // lifted off the black page
    const own = tokensWith(BUILT_INS.paper.tokens, { background: "#000000", cards: "#222222" });
    expect(own["--surface-float"]).toBe("#222222");
  });

  it("works out the orange between the warning and error colours", () => {
    const t = tokensWith(BUILT_INS.paper.tokens, { warning: "#ffcc00", error: "#cc0000" });
    expect(t["--serious"]).toBe(blend("#ffcc00", "#cc0000", 0.5));
  });

  it("applies what was set in Advanced last, over what a role works out", () => {
    const t = tokensWith(BUILT_INS.paper.tokens, { text: "#111111", "--ink-2": "#445566", "--sidebar": "#eeeeee" });
    expect(t["--ink"]).toBe("#111111");
    expect(t["--ink-2"]).toBe("#445566");
    expect(t["--sidebar"]).toBe("#eeeeee");
    expect(t["--ink-3"]).not.toBe(BUILT_INS.paper.tokens["--ink-3"]); // the rest still follows the text colour
  });

  it("reads black or white on a colour, whichever shows better", () => {
    expect(readableOn("#0b3d91")).toBe("#ffffff");
    expect(readableOn("#ffe08a")).toBe("#0a0a0a");
  });

  it("reports the colour a role shows: the one picked, or the base's", () => {
    expect(roleColor({ base: "paper", colors: { primary: "#112233" } }, "primary")).toBe("#112233");
    expect(roleColor({ base: "paper-dark", colors: {} }, "background")).toBe("#0d0d0d");
  });

  it("flags a pair that is too faint", () => {
    const t = tokensWith(BUILT_INS.paper.tokens, { background: "#ffffff", primary: "#ffee99" });
    const primary = contrastChecks(t).find((c) => c.id === "primary-text");
    expect(primary?.ok).toBe(true); // the text colour is chosen to stay readable
    const link = contrastChecks(t).find((c) => c.id === "link");
    expect(link?.ok).toBe(false); // but a pale link on white is not
  });
});

describe("hex colours and theme files", () => {
  it("accepts only #rgb and #rrggbb", () => {
    for (const ok of ["#fff", "#0B3D91", "#0b3d91"]) expect(isHexColor(ok), ok).toBe(true);
    for (const bad of ["fff", "#ffff", "#12345", "red", "rgb(0,0,0)", "url(x)", "#fff; color: red", "", 5, null]) expect(isHexColor(bad), String(bad)).toBe(false);
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });

  it("keeps the Advanced tokens a file sets and drops other variable names", () => {
    const text = JSON.stringify({ schema: 1, name: "A", base: "paper", colors: { "--link": "#123456", "--dur-move": "#000000", "--not-a-token": "#000000" } });
    expect(parseTheme(text).theme?.colors).toEqual({ "--link": "#123456" });
    expect(parseTheme(JSON.stringify({ schema: 1, name: "A", base: "paper", colors: { "--link": "url(x)" } })).error).toMatch(/must be a hex colour/);
  });

  it("reads a theme file, drops what it does not know, and fills in an id", () => {
    const text = JSON.stringify({ schema: 1, name: "  Sunset ", base: "paper-dark", colors: { primary: "#FFB454", nonsense: "#000000" }, extra: true });
    expect(parseTheme(text)).toEqual({ theme: { schema: 1, id: "sunset", name: "Sunset", base: "paper-dark", colors: { primary: "#ffb454" } } });
  });

  it.each([
    ["{broken", /valid JSON/],
    ["5", /isn’t a theme file/],
    [JSON.stringify({ schema: 2, name: "x", base: "paper" }), /different version/],
    [JSON.stringify({ schema: 1, name: "", base: "paper" }), /needs a name/],
    [JSON.stringify({ schema: 1, name: "x".repeat(41), base: "paper" }), /needs a name/],
    [JSON.stringify({ schema: 1, name: "x", base: "midnight" }), /base must be/],
    [JSON.stringify({ schema: 1, name: "x", base: "paper", colors: { primary: "red; background: url(//x)" } }), /must be a hex colour/],
  ])("refuses %s", (text, reason) => {
    const parsed = parseTheme(text);
    expect(parsed.theme).toBeUndefined();
    expect(parsed.error).toMatch(reason);
  });

  it("makes an id from a name", () => {
    expect(slugOf("My Theme!! 2")).toBe("my-theme-2");
    expect(slugOf("!!!")).toBe("theme");
  });
});

describe("applying tokens", () => {
  it("sets and clears variables on an element", () => {
    const el = document.createElement("div");
    applyTokens({ "--bg": "#000000", "--ink": "#ffffff" }, el);
    expect(el.style.getPropertyValue("--bg")).toBe("#000000");
    clearTokens({ "--bg": "", "--ink": "" }, el);
    expect(el.style.getPropertyValue("--bg")).toBe("");
  });
});
