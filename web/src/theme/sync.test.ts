import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncThemes, useTheme } from "./store";
import type { ThemeData } from "./types";

type Call = { method: string; url: string; body?: unknown };
type Answer = { themes: unknown[]; mode: string; light: string; dark: string; active: string };

let calls: Call[];
let answer: Answer | "offline";

const nothing: Answer = { themes: [], mode: "", light: "", dark: "", active: "paper" };
const sunset: ThemeData = { schema: 1, id: "sunset", name: "Sunset", base: "paper-dark", colors: { primary: "#ffb454" } };

function stubServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (answer === "offline") return Promise.reject(new TypeError("Failed to fetch"));
      const get = (init?.method ?? "GET") === "GET";
      return Promise.resolve(get ? Response.json(answer) : new Response(null, { status: 204 }));
    }),
  );
}

/** Lets the queued requests go out. */
const settle = () => new Promise((r) => setTimeout(r, 20));
const sent = () => calls.map((c) => `${c.method} ${c.url.replace("/api/v1/appearance", "")}`);

const reset = () => {
  localStorage.clear();
  useTheme.setState({ custom: [], mode: "light", lightId: "paper", darkId: "paper-dark", osDark: false, activeId: "paper", draft: null });
  document.documentElement.removeAttribute("style");
};

beforeEach(async () => {
  calls = [];
  answer = nothing;
  stubServer();
  reset();
  await settle();
  calls = []; // what resetting the store sent is not under test
});
afterEach(() => {
  reset();
  vi.unstubAllGlobals();
});

describe("saving to the server", () => {
  it("sends a new theme first and then chooses it for its scheme, one request after another", async () => {
    useTheme.getState().create("Sunset", sunset);
    await settle();
    expect(sent()).toEqual(["PUT /themes/sunset", "PUT /use"]);
    expect(calls[0].body).toMatchObject({ id: "sunset", name: "Sunset", base: "paper-dark", colors: { primary: "#ffb454" } });
    expect(calls[1].body).toEqual({ mode: "dark", light: "paper", dark: "sunset" }); // a dark theme is the one for dark, and dark shows
  });

  it("sends an edit only when it is saved, not while it is tried", async () => {
    useTheme.getState().create("Sunset", sunset);
    await settle();
    calls = [];
    useTheme.getState().edit("text", "#fafafa");
    await settle();
    expect(calls).toEqual([]);
    useTheme.getState().save();
    await settle();
    expect(sent()).toEqual(["PUT /themes/sunset"]);
    expect((calls[0].body as ThemeData).colors.text).toBe("#fafafa");
  });

  it("sends the mode and the themes when they change, and a deletion before the new choice", async () => {
    useTheme.getState().create("Sunset", sunset);
    await settle();

    calls = [];
    useTheme.getState().setMode("system");
    await settle();
    expect(sent()).toEqual(["PUT /use"]);
    expect(calls[0].body).toEqual({ mode: "system", light: "paper", dark: "sunset" });

    calls = [];
    useTheme.getState().remove("sunset");
    await settle();
    expect(sent()).toEqual(["DELETE /themes/sunset", "PUT /use"]);
    expect(calls[1].body).toEqual({ mode: "system", light: "paper", dark: "paper-dark" });
  });

  it("keeps working in this browser when the server can not be reached", async () => {
    answer = "offline";
    useTheme.getState().create("Sunset", sunset);
    await settle();
    expect(useTheme.getState().custom.map((t) => t.id)).toEqual(["sunset"]);
    expect(localStorage.getItem("devdeck.themes")).toContain("sunset");
    expect(localStorage.getItem("devdeck.theme.dark")).toBe("sunset");
  });
});

describe("syncThemes", () => {
  it("takes the server's themes, mode and choices, and does not send them straight back", async () => {
    answer = { ...nothing, themes: [sunset, { schema: 1, id: "bad", name: "Bad", base: "paper", colors: { primary: "red; x" } }], mode: "dark", light: "paper", dark: "sunset" };
    await syncThemes();
    await settle();
    expect(useTheme.getState().custom.map((t) => t.id)).toEqual(["sunset"]); // the bad one is dropped
    expect(useTheme.getState()).toMatchObject({ mode: "dark", lightId: "paper", darkId: "sunset", activeId: "sunset" });
    expect(sent()).toEqual(["GET "]);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#ffb454");
  });

  it("falls back to the built-in themes when a chosen one is not kept", async () => {
    answer = { ...nothing, themes: [sunset], mode: "dark", light: "ghost", dark: "ghost-too" };
    await syncThemes();
    expect(useTheme.getState()).toMatchObject({ mode: "dark", lightId: "paper", darkId: "paper-dark", activeId: "paper-dark" });
  });

  it("sends this browser's themes and choices up the first time, when the server has nothing", async () => {
    useTheme.setState({ custom: [sunset], mode: "dark", darkId: "sunset", activeId: "sunset" });
    await settle();
    calls = [];
    await syncThemes();
    await settle();
    expect(sent()).toEqual(["GET ", "PUT /themes/sunset", "PUT /use"]);
    expect(calls[2].body).toEqual({ mode: "dark", light: "paper", dark: "sunset" });
    expect(useTheme.getState().custom).toHaveLength(1); // and nothing here was lost
  });

  it("turns the one theme kept before modes into the theme for its scheme, and says so to the server", async () => {
    answer = { ...nothing, themes: [sunset], active: "sunset" };
    await syncThemes();
    await settle();
    expect(useTheme.getState()).toMatchObject({ mode: "dark", darkId: "sunset", lightId: "paper", activeId: "sunset" });
    expect(sent()).toEqual(["GET ", "PUT /use"]);
    expect(calls[1].body).toEqual({ mode: "dark", light: "paper", dark: "sunset" });
  });

  it("writes nothing when the server has nothing and neither has this browser", async () => {
    await syncThemes();
    await settle();
    expect(sent()).toEqual(["GET "]);
  });

  it("leaves this browser's themes alone when the server can not be reached", async () => {
    useTheme.setState({ custom: [sunset], mode: "dark", darkId: "sunset", activeId: "sunset" });
    answer = "offline";
    await syncThemes();
    expect(useTheme.getState().custom.map((t) => t.id)).toEqual(["sunset"]);
    expect(useTheme.getState().activeId).toBe("sunset");
  });

  it("keeps an unsaved change that is still on a theme the server has", async () => {
    useTheme.setState({ custom: [sunset], mode: "dark", darkId: "sunset", activeId: "sunset", draft: { ...sunset, colors: { primary: "#112233" } } });
    answer = { ...nothing, themes: [sunset], mode: "dark", light: "paper", dark: "sunset" };
    await syncThemes();
    expect(useTheme.getState().draft?.colors.primary).toBe("#112233");
  });
});
