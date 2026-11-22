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
  useUi.setState({ look: "paper", effects: null, name: "", sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  useServerLink.getState().reset();
});

/** The server went away 5s ago, after the app was up. */
const serverGone = () => act(() => useServerLink.setState({ everUp: true, failures: 2, downSince: Date.now() - 5_000, lastFailAt: Date.now() }));

describe("Neon Home, the launcher", () => {
  it("greets you by name, says the workspace, and shows the orb's state", async () => {
    mockServer();
    useUi.setState({ look: "neon", name: "Sam" });
    renderAt("/");
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/^Good (morning|afternoon|evening), Sam\.$/);
    expect(await screen.findByText(/Workspace · Acme shop ·/)).toBeTruthy();
    expect(await screen.findByText("Idle · Ready")).toBeTruthy();
  });

  it("greets without a name when none is set", async () => {
    mockServer();
    useUi.setState({ look: "neon" });
    renderAt("/");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/^Good (morning|afternoon|evening)\.$/);
  });

  it("looks the same with stacks running; the orb's line leads to Overview", async () => {
    mockServer({ runs: [running] });
    useUi.setState({ look: "neon" });
    renderAt("/");
    const line = await screen.findByRole("link", { name: "Idle · 1 stack running" });
    expect(line.getAttribute("href")).toBe("/overview");
    expect(screen.queryByText("web")).toBeNull(); // no stack cards: those are on Overview
    expect(screen.getByRole("navigation", { name: "Launch" })).toBeTruthy();
  });

  it("opens every sidebar page from the grid, a tile per group", async () => {
    mockServer();
    useUi.setState({ look: "neon" });
    renderAt("/");
    const grid = within(await screen.findByRole("navigation", { name: "Launch" }));
    expect(grid.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["// Overview", "// Work", "// Run", "// System"]);
    const run = within(grid.getByRole("region", { name: "Run" }));
    expect(run.getByRole("link", { name: "Stacks" }).getAttribute("href")).toBe("/stacks");
    expect(grid.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/overview");
  });

  it("finds a page by name and opens it with Enter; arrows move, Escape clears", async () => {
    mockServer();
    useUi.setState({ look: "neon" });
    const router = renderAt("/");
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

  it("stays the dashboard in Flat", async () => {
    mockServer({ runs: [running] });
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Where to?" })).toBeNull();
  });
});

describe("when the server goes away while in use", () => {
  it("the orb turns to its warning state and thinks; the strip says actions wait", async () => {
    mockServer();
    useUi.setState({ look: "neon" });
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

describe("the hero empty state, now on Workspaces", () => {
  it("shows on Neon's Workspaces with none yet, and its button opens the add form", async () => {
    mockServer({ workspaces: [] });
    useUi.setState({ look: "neon" });
    renderAt("/workspaces");
    const hero = within(await screen.findByRole("region", { name: "Get started" }));
    expect(hero.getByRole("heading", { level: 2 }).textContent).toBe("Your workspace is ready to connect.");
    expect(hero.getByText("Idle")).toBeTruthy();
    expect(hero.getByRole("link", { name: /Setup guide/ })).toBeTruthy();
    fireEvent.click(hero.getByRole("button", { name: /Add workspace/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("is the usual empty state in Flat", async () => {
    mockServer({ workspaces: [] });
    renderAt("/workspaces");
    expect(await screen.findByRole("heading", { name: "No workspace yet" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
  });

  it("Neon's empty Overview is the quiet kind, pointing to Workspaces when there is none", async () => {
    mockServer({ workspaces: [] });
    useUi.setState({ look: "neon" });
    renderAt("/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect((await screen.findByRole("link", { name: /Open workspaces/ })).getAttribute("href")).toBe("/workspaces");
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
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
