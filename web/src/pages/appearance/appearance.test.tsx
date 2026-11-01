import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../../store/ui";
import { useTheme } from "../../theme/store";
import { SettingsPage } from "../SettingsPage";

const rootStyle = (name: string) => document.documentElement.style.getPropertyValue(name);
const frame = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;
const rowOf = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: "/settings", element: <SettingsPage /> },
      { path: "/elsewhere", element: <p>elsewhere</p> },
    ],
    { initialEntries: ["/settings"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const reset = () => {
  localStorage.clear();
  useTheme.setState({ custom: [], mode: "light", lightId: "paper", darkId: "paper-dark", osDark: false, activeId: "paper", draft: null });
  document.documentElement.removeAttribute("style");
};

beforeEach(reset);
afterEach(() => {
  cleanup();
  reset();
});

describe("Appearance", () => {
  it("lists the built-in themes, with Paper in use and its colours shown but not editable", () => {
    renderSettings();
    const themes = within(screen.getByRole("region", { name: "Themes" }));
    expect(themes.getByRole("button", { name: "Paper" }).getAttribute("aria-pressed")).toBe("true");
    expect(themes.getByRole("button", { name: "Paper Dark" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("A built-in theme can’t be changed.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Primary button: change colour" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Primary button: hex colour") as HTMLInputElement).value).toBe("#0b3d91");
  });

  it("switches to Paper Dark and back, setting the colours and the browser frame", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Paper Dark" }));
    await waitFor(() => expect(rootStyle("--bg")).toBe("#0d0d0d"));
    expect(rootStyle("color-scheme")).toBe("dark");
    expect(frame()).toBe("#0d0d0d");
    expect(JSON.parse(localStorage.getItem("devdeck.theme.tokens.dark") ?? "{}")["--bg"]).toBe("#0d0d0d"); // for the boot script
    expect(localStorage.getItem("devdeck.theme.mode")).toBe("dark"); // choosing a dark theme shows dark

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    await waitFor(() => expect(rootStyle("--bg")).toBe(""));
    expect(frame()).toBe("#ffffff");
    expect(localStorage.getItem("devdeck.theme.tokens.light")).toBeNull(); // plain Paper is what the stylesheet shows
    expect(localStorage.getItem("devdeck.theme.mode")).toBe("light");
  });

  it("makes a copy to edit, shows changes at once, and keeps them only on Save", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    const name = await screen.findByLabelText("Theme name");
    expect((name as HTMLInputElement).value).toBe("Paper copy");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull(); // nothing changed yet

    fireEvent.change(screen.getByLabelText("Primary button: hex colour"), { target: { value: "#aa2200" } });
    await waitFor(() => expect(rootStyle("--primary")).toBe("#aa2200"));
    expect(rootStyle("--link")).toBe("#aa2200"); // what follows from it
    // an unsaved try is not kept for the next start: the saved copy of the theme is
    expect(JSON.parse(localStorage.getItem("devdeck.theme.tokens.light") ?? "{}")["--primary"]).toBe("#0b3d91");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(rootStyle("--primary")).toBe("#0b3d91"));
    expect((screen.getByLabelText("Primary button: hex colour") as HTMLInputElement).value).toBe("#0b3d91");

    fireEvent.change(screen.getByLabelText("Primary button: hex colour"), { target: { value: "#aa2200" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(localStorage.getItem("devdeck.themes")).toContain("#aa2200"));
    expect(JSON.parse(localStorage.getItem("devdeck.theme.tokens.light") ?? "{}")["--primary"]).toBe("#aa2200");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("resets one colour to the base's", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    fireEvent.change(await screen.findByLabelText("Text: hex colour"), { target: { value: "#222222" } });
    await waitFor(() => expect(rootStyle("--ink")).toBe("#222222"));
    fireEvent.click(screen.getByRole("button", { name: "Text: back to the base colour" }));
    await waitFor(() => expect(rootStyle("--ink")).toBe("#0a0a0a"));
  });

  it("says when a colour is too faint to read", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    const hex = await screen.findByLabelText("Primary button: hex colour");
    expect(within(rowOf("Primary button")).queryByText("LOW")).toBeNull();
    fireEvent.change(hex, { target: { value: "#ffee99" } }); // a pale link on a white page
    await waitFor(() => expect(within(rowOf("Primary button")).getByText("LOW")).toBeTruthy());
  });

  it("opens a colour picker from the swatch", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    const swatch = await screen.findByRole("button", { name: "Background: change colour" });
    expect(document.querySelector(".react-colorful")).toBeNull();
    fireEvent.click(swatch);
    expect(document.querySelector(".react-colorful")).not.toBeNull();
  });

  it("asks before deleting a theme, and goes back to Paper when the one in use is deleted", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    const themes = within(screen.getByRole("region", { name: "Themes" }));
    expect(await themes.findByRole("button", { name: "My theme" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(themes.getByRole("button", { name: "My theme" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); // the one that asks
    await waitFor(() => expect(themes.queryByRole("button", { name: "My theme" })).toBeNull());
    expect(useTheme.getState().activeId).toBe("paper");
  });

  it("asks before leaving with changes that were not saved", async () => {
    const router = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    fireEvent.change(await screen.findByLabelText("Text: hex colour"), { target: { value: "#222222" } });
    await screen.findByRole("button", { name: "Save" });

    void router.navigate("/elsewhere");
    const prompt = await screen.findByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Stay" }));
    expect(router.state.location.pathname).toBe("/settings");

    void router.navigate("/elsewhere");
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Unsaved changes" })).getByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));
    expect(useTheme.getState().draft).toBeNull();
  });
});

describe("the settings layout and the gallery", () => {
  it("lists the sections, with Appearance current and the ones that do not exist yet disabled", () => {
    renderSettings();
    const nav = within(screen.getByRole("navigation", { name: "Settings sections" }));
    expect(nav.getByRole("link", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByText("General").getAttribute("aria-disabled")).toBe("true");
    expect(nav.getAllByRole("listitem")).toHaveLength(8);
  });

  it("shows each theme in miniature, says which is in use, and marks the built-in ones", () => {
    renderSettings();
    const themes = within(screen.getByRole("region", { name: "Themes" }));
    const paper = themes.getByRole("button", { name: "Paper" });
    expect(within(paper).getByText("in use")).toBeTruthy();
    expect(within(paper).getByText("built in")).toBeTruthy();
    expect(within(themes.getByRole("button", { name: "Paper Dark" })).queryByText("in use")).toBeNull();
    // the miniature is drawn in the theme's own colours
    expect(paper.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("grades each colour and groups them by what they are for", () => {
    renderSettings();
    for (const group of ["Surfaces", "Text", "Accent", "Status"]) expect(screen.getByRole("heading", { name: group })).toBeTruthy();
    const row = (label: string) => screen.getByLabelText(`${label}: hex colour`).closest("li") as HTMLElement;
    expect(within(row("Menus and panels")).getByText("AAA")).toBeTruthy(); // near-black text on a white panel
    expect(within(row("Text")).getByText("AA")).toBeTruthy(); // its tightest pair is the soft text, at 5.7:1
    expect(within(row("Text")).getByText("5.7:1")).toBeTruthy();
    expect(within(row("Background")).getByText("AA")).toBeTruthy(); // its tightest pair is a status dot at 3.5:1
    expect(within(row("Text")).getByText("Titles and content. Softer text is worked out from it.")).toBeTruthy(); // what it is for
  });

  it("previews the theme in its colours, and says whether everything is readable", async () => {
    renderSettings();
    const preview = within(screen.getByRole("complementary", { name: "Preview" }));
    expect(preview.getByText("All text and status colours pass WCAG AA.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    fireEvent.change(await screen.findByLabelText("Text: hex colour"), { target: { value: "#f4f4f4" } }); // near-white on a white page
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Text on the page.* hard to read/));
    expect(screen.getByTestId("preview").style.getPropertyValue("--ink")).toBe("#f4f4f4");
  });
});

describe("Reduce motion", () => {
  it("turns on and off, marks the page and is remembered", () => {
    renderSettings();
    const row = within(screen.getByRole("group", { name: "Reduce motion" }));
    expect(row.getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(row.getByRole("button", { name: "On" }));
    expect(row.getByRole("button", { name: "On" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(localStorage.getItem("devdeck.reduce-motion")).toBe("1");

    fireEvent.click(row.getByRole("button", { name: "Off" }));
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(useUi.getState().reduceMotion).toBe(false);
  });
});

describe("Mode", () => {
  it("switches between Light, Dark and System, showing the theme for each", async () => {
    renderSettings();
    const mode = within(screen.getByRole("group", { name: "Mode" }));
    expect(mode.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(mode.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(rootStyle("--bg")).toBe("#0d0d0d"));
    expect(mode.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(frame()).toBe("#0d0d0d");

    fireEvent.click(mode.getByRole("button", { name: "System" })); // the OS is light in the tests
    await waitFor(() => expect(rootStyle("--bg")).toBe(""));
    expect(localStorage.getItem("devdeck.theme.mode")).toBe("system");

    act(() => useTheme.getState().setOsDark(true)); // the OS changes
    await waitFor(() => expect(rootStyle("--bg")).toBe("#0d0d0d"));
    expect(mode.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tells which theme is in use and which is kept for the other scheme", async () => {
    renderSettings();
    const themes = within(screen.getByRole("region", { name: "Themes" }));
    expect(within(themes.getByRole("button", { name: "Paper" })).getByText("in use")).toBeTruthy();
    expect(within(themes.getByRole("button", { name: "Paper Dark" })).getByText("for dark")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("group", { name: "Mode" })).getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(within(themes.getByRole("button", { name: "Paper Dark" })).getByText("in use")).toBeTruthy());
    expect(within(themes.getByRole("button", { name: "Paper" })).getByText("for light")).toBeTruthy();
  });

  it("edits the theme for the scheme that is showing, and picking a theme for the other scheme shows it", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    fireEvent.change(await screen.findByLabelText("Primary button: hex colour"), { target: { value: "#aa2200" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    fireEvent.click(within(screen.getByRole("region", { name: "Themes" })).getByRole("button", { name: "Paper Dark" }));
    await waitFor(() => expect(useTheme.getState()).toMatchObject({ mode: "dark", darkId: "paper-dark", lightId: "paper-copy" }));
    expect(screen.getByText("A built-in theme can’t be changed.")).toBeTruthy(); // the dark one showing is built in
  });
});

describe("Advanced, copies and files", () => {
  const file = (text: string, name = "sunset.devdeck-theme.json") => new File([text], name, { type: "application/json" });
  const sunset = JSON.stringify({ schema: 1, id: "sunset", name: "Sunset", base: "paper-dark", colors: { primary: "#ffb454", "--ink-2": "#ccddee", nonsense: "#000000" } });

  it("lists every worked-out colour under Advanced, and keeps one set by hand through later changes", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    expect(await screen.findByText("Soft text")).toBeTruthy();
    expect((screen.getByLabelText("Soft text: hex colour") as HTMLInputElement).value).toBe("#3d3d3d"); // what Paper works out

    fireEvent.change(screen.getByLabelText("Soft text: hex colour"), { target: { value: "#556677" } });
    await waitFor(() => expect(rootStyle("--ink-2")).toBe("#556677"));
    fireEvent.change(screen.getByLabelText("Text: hex colour"), { target: { value: "#111111" } }); // would work out a new soft text
    await waitFor(() => expect(rootStyle("--ink")).toBe("#111111"));
    expect(rootStyle("--ink-2")).toBe("#556677");

    fireEvent.click(screen.getByRole("button", { name: "Soft text: back to the base colour" }));
    await waitFor(() => expect(rootStyle("--ink-2")).not.toBe("#556677"));
  });

  it("does not offer Advanced colours for editing on a built-in theme", () => {
    renderSettings();
    expect((screen.getByRole("button", { name: "Soft text: change colour" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("duplicates a theme with its colours", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    fireEvent.change(await screen.findByLabelText("Primary button: hex colour"), { target: { value: "#aa2200" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect((screen.getByLabelText("Theme name") as HTMLInputElement).value).toBe("Paper copy copy"));
    expect((screen.getByLabelText("Primary button: hex colour") as HTMLInputElement).value).toBe("#aa2200");
    expect(useTheme.getState().custom).toHaveLength(2);
  });

  it("exports the theme as a file with only the fields that are safe to share", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate & edit" }));
    fireEvent.change(await screen.findByLabelText("Primary button: hex colour"), { target: { value: "#aa2200" } });

    let blob: Blob | undefined;
    let name = "";
    vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => ((blob = b), "blob:x"), revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    click.mockRestore();
    vi.unstubAllGlobals();

    expect(name).toBe("paper-copy.devdeck-theme.json");
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob!);
    });
    expect(JSON.parse(text)).toEqual({ schema: 1, id: "paper-copy", name: "Paper copy", base: "paper", colors: { primary: "#aa2200" } });
  });

  it("imports a theme file under an id of its own, keeping the colours it knows", async () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Import a theme file"), { target: { files: [file(sunset)] } });
    await waitFor(() => expect(useTheme.getState().custom).toHaveLength(1));
    const t = useTheme.getState().custom[0];
    expect(t).toMatchObject({ name: "Sunset", base: "paper-dark", colors: { primary: "#ffb454", "--ink-2": "#ccddee" } });
    expect(t.colors).not.toHaveProperty("nonsense");
    expect(useTheme.getState().activeId).toBe(t.id);

    // the same file again does not overwrite it
    fireEvent.change(screen.getByLabelText("Import a theme file"), { target: { files: [file(sunset)] } });
    await waitFor(() => expect(useTheme.getState().custom).toHaveLength(2));
    expect(new Set(useTheme.getState().custom.map((x) => x.id)).size).toBe(2);
  });

  it("refuses a file that is not a theme, and says why", async () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Import a theme file"), { target: { files: [file(JSON.stringify({ schema: 1, name: "X", base: "paper", colors: { primary: "red; background: url(//x)" } }))] } });
    expect((await screen.findByRole("alert")).textContent).toContain("must be a hex colour");
    expect(useTheme.getState().custom).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Import a theme file"), { target: { files: [file("{broken")] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("valid JSON"));

    fireEvent.change(screen.getByLabelText("Import a theme file"), { target: { files: [file("x".repeat(30_000))] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("too big"));
    expect(useTheme.getState().custom).toHaveLength(0);
  });
});

describe("the saved themes", () => {
  it("come back checked: a bad one is dropped, and an unknown active theme falls back to Paper", async () => {
    localStorage.setItem(
      "devdeck.themes",
      JSON.stringify([
        { schema: 1, id: "ok", name: "Ok", base: "paper", colors: { primary: "#112233" } },
        { schema: 1, id: "bad", name: "Bad", base: "paper", colors: { primary: "red; x" } },
      ]),
    );
    localStorage.setItem("devdeck.theme.light", "gone");
    localStorage.setItem("devdeck.theme.dark", "gone-too");
    vi.resetModules(); // the store reads storage when its module loads
    const { useTheme: fresh } = await import("../../theme/store");
    expect(fresh.getState().custom.map((t) => t.id)).toEqual(["ok"]);
    expect(fresh.getState()).toMatchObject({ activeId: "paper", lightId: "paper", darkId: "paper-dark" });
  });
});
