import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../../app/routes";
import type { RunStatus, WorkspaceSummary } from "../../lib/types";
import { PAUSED_TITLE, useServerLink } from "../../lib/server-link";
import { useUi } from "../../store/ui";

vi.mock("../../design/orb/OrbCanvas", () => ({ default: () => <canvas data-testid="orb-canvas" /> }));

const acme = { id: "acme", name: "Acme shop", errors: 0 } as WorkspaceSummary;
const running: RunStatus = {
  workspace: "acme",
  stack: "web",
  state: "running",
  started_at: new Date().toISOString(),
  services: [{ id: "api", kind: "command", state: "ready", restarts: 0 }],
};

function mockServer({ workspaces = [acme], runs = [] as RunStatus[] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown) => Promise.resolve(Response.json(v));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces") return json(workspaces);
      if (path === "/runs") return json(runs);
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      return json([]);
    }),
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ effects: null, name: "", sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  useServerLink.getState().reset();
});

/** The server went away 5s ago, after the app was up. */
const serverGone = () => act(() => useServerLink.setState({ everUp: true, failures: 2, downSince: Date.now() - 5_000, lastFailAt: Date.now() }));

describe("Neon Home, the launcher", () => {
  it("greets you by name, says the workspace, and shows the orb's state", async () => {
    mockServer();
    useUi.setState({ name: "Sam" });
    renderAt("/");
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/^Good (morning|afternoon|evening), Sam\.$/);
    expect(await screen.findByText(/Workspace · Acme shop ·/)).toBeTruthy();
    expect(await screen.findByText("Idle · Ready")).toBeTruthy();
  });

  it("greets without a name when none is set", async () => {
    mockServer();
    renderAt("/");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/^Good (morning|afternoon|evening)\.$/);
  });

  it("looks the same with stacks running; the orb's line leads to Overview", async () => {
    mockServer({ runs: [running] });
    renderAt("/");
    const line = await screen.findByRole("link", { name: "Idle · 1 stack running" });
    expect(line.getAttribute("href")).toBe("/overview");
    expect(screen.queryByText("web")).toBeNull(); // no stack cards: those are on Overview
    expect(screen.getByRole("navigation", { name: "Launch" })).toBeTruthy();
  });

  it("with no workspace yet, the orb's line leads to Workspaces and its hero", async () => {
    mockServer({ workspaces: [] });
    renderAt("/");
    const line = await screen.findByRole("link", { name: "Idle · Set up a workspace" });
    expect(line.getAttribute("href")).toBe("/workspaces");
    expect(line.getAttribute("title")).toBe("Configure a workspace");
    fireEvent.click(line);
    expect(await screen.findByRole("region", { name: "No workspaces yet" })).toBeTruthy();
  });

  it("has no sidebar: every page sits around the orb, with what it is for, and a legend", async () => {
    mockServer();
    renderAt("/");
    const orbit = within(await screen.findByRole("navigation", { name: "Launch" }));
    expect(orbit.getByRole("link", { name: /Stacks/ }).getAttribute("href")).toBe("/stacks");
    expect(orbit.getByRole("link", { name: /Overview/ }).textContent).toContain("everything at a glance");
    expect(orbit.queryByRole("link", { name: /^Home/ })).toBeNull();
    expect(document.documentElement.dataset.homeBare).toBe("");
    expect(document.querySelector('[data-ui="topbar"]')).toBeNull();
    const legend = within(screen.getByRole("list", { name: "Groups" }));
    expect(legend.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["// Workyour code", "// Runwhat's running", "// Systemsetup"]);
  });

  it("picking a page names it for the flight into the sidebar, and the sidebar comes back", async () => {
    mockServer();
    renderAt("/");
    const stacks = within(await screen.findByRole("navigation", { name: "Launch" })).getByRole("link", { name: /Stacks/ });
    fireEvent.click(stacks);
    expect(document.documentElement.dataset.launch).toBe("");
    expect(await screen.findByRole("heading", { level: 1, name: "Stacks" })).toBeTruthy();
    expect(document.documentElement.dataset.homeBare).toBeUndefined();
  });

  it("finds a page by name and opens it with Enter; arrows move, Escape clears", async () => {
    mockServer();
    const router = renderAt("/");
    // Ctrl K opens the page search on Home.
    expect(await screen.findByRole("button", { name: "Ctrl K" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Where to?" })).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Where to?" });
    expect(box.getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(box, { target: { value: "work" } });
    const list = within(screen.getByRole("listbox", { name: "Pages" }));
    const options = list.getAllByRole("option");
    expect(options[0].textContent).toContain("Workspaces");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0].id);

    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLInputElement).value).toBe("");

    fireEvent.change(box, { target: { value: "stac" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("heading", { level: 1, name: "Stacks" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/stacks");
  });
});

describe("when the server goes away while in use", () => {
  it("the orb turns to its warning state and thinks; the strip says actions wait", async () => {
    mockServer();
    renderAt("/");
    await screen.findByText("Idle · Ready");
    serverGone();
    expect(await screen.findByText("Thinking · Reconnecting")).toBeTruthy();
    expect(await screen.findByText(/Reconnecting · [56]s/)).toBeTruthy();
    expect(screen.getByText("Actions paused")).toBeTruthy();
  });

  it("buttons that change things are disabled and say why", async () => {
    mockServer({ runs: [running] });
    renderAt("/overview");
    const stopAll = await screen.findByRole("button", { name: /Stop all/ });
    expect((stopAll as HTMLButtonElement).disabled).toBe(false);
    serverGone();
    expect((stopAll as HTMLButtonElement).disabled).toBe(true);
    expect(stopAll.getAttribute("title")).toBe(PAUSED_TITLE);
  });
});

describe("empty pages: the mini-orb pattern", () => {
  it("Workspaces with none yet: one mono line, one headline, one action, one command", async () => {
    mockServer({ workspaces: [] });
    renderAt("/workspaces");
    const empty = within(await screen.findByRole("region", { name: "No workspaces yet" }));
    expect(empty.getByText("00 $ Workspaces · none yet")).toBeTruthy();
    expect(empty.getByRole("heading", { level: 2 }).textContent).toBe("No workspaces yet");
    expect(empty.getByText("$ devdeck workspace check <folder>")).toBeTruthy();
    expect(empty.getByRole("link", { name: /setup guide/i })).toBeTruthy();
    fireEvent.click(empty.getByRole("button", { name: /Create workspace/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("the empty Overview is the quiet kind, pointing to Workspaces when there is none", async () => {
    mockServer({ workspaces: [] });
    renderAt("/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect((await screen.findByRole("link", { name: /Open workspaces/ })).getAttribute("href")).toBe("/workspaces");
    expect(screen.queryByRole("region", { name: "No workspaces yet" })).toBeNull();
  });
});

describe("Settings → General", () => {
  it("keeps your name for the greeting", async () => {
    mockServer();
    renderAt("/settings#general");
    fireEvent.click(await screen.findByRole("link", { name: "General" }));
    const field = await screen.findByRole("textbox", { name: "Your name" });
    fireEvent.change(field, { target: { value: "Sam" } });
    expect(useUi.getState().name).toBe("Sam");
    expect(localStorage.getItem("devdeck.name")).toBe("Sam");
  });
});
