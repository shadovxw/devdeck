import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { Plugin } from "../lib/types";
import { useUi } from "../store/ui";

const plugins: Plugin[] = [
  { id: "git", name: "Git", category: "vcs", status: { state: "ok", version: "2.55.0", checked_at: "" } },
  {
    id: "docker",
    name: "Docker",
    category: "container",
    status: { state: "degraded", version: "29.6.1", detail: "the Docker engine is not running", checked_at: "" },
  },
];

const calls: Array<{ method: string; url: string }> = [];

function mockServer(listed: Plugin[] = plugins) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (url === "/api/v1/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (url === "/api/v1/plugins") return Promise.resolve(Response.json(listed));
      if (url === "/api/v1/plugins/docker/check" && method === "POST") {
        return Promise.resolve(
          Response.json({ ...listed[1], status: { state: "ok", version: "29.6.1", checked_at: "" } }),
        );
      }
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }),
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("pages", () => {
  it("shows only the breadcrumb and title at the top of a page, with no phase label or scope chip", async () => {
    mockServer();
    renderAt("/stacks");
    expect(await screen.findByRole("heading", { level: 1, name: "Stacks" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Run/Stacks");
    expect(screen.queryByText(/Phase \d/)).toBeNull();
    expect(screen.queryByText("Local workspace")).toBeNull();
  });

  it("shows the page's own empty state", async () => {
    mockServer();
    renderAt("/databases");
    expect(await screen.findByRole("heading", { name: "No database connected yet" })).toBeTruthy();
    // its button leads somewhere real
    expect(screen.getByRole("link", { name: /Add connection/ }).getAttribute("href")).toBe("/connections");
  });

  it("disables the button on pages that are not built yet, with the phase in its tooltip", async () => {
    mockServer();
    renderAt("/flows");
    const btn = (await screen.findByRole("button", { name: /Create flow/ })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Available in Phase 7");
  });

  it("keeps the top bar to the sidebar toggle; the workspace switcher is in the sidebar", async () => {
    mockServer();
    renderAt("/stacks");
    await screen.findByRole("heading", { level: 1, name: "Stacks" });
    const bar = within(document.querySelector('[data-ui="topbar"]') as HTMLElement);
    expect(bar.queryByText("Git")).toBeNull();
    expect(bar.queryByText("Docker")).toBeNull();
    expect(bar.queryByText("No repo")).toBeNull();
    expect(bar.queryByText(/workspace/i)).toBeNull();
    expect(bar.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy();
  });

  it("shows Group / Parent / Page in the breadcrumb of a family page, and its family as tabs", async () => {
    mockServer();
    renderAt("/logs");
    await screen.findByRole("heading", { level: 1, name: "Logs" });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Run/Stacks/Logs");
    const tabs = within(screen.getByRole("navigation", { name: "Stacks pages" }));
    expect(tabs.getByRole("link", { name: "Logs" }).getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("link", { name: "Stacks" }).getAttribute("aria-current")).toBeNull();
    expect(tabs.getByRole("link", { name: "Images and tags" })).toBeTruthy();
    // Resources isn't built yet: a dimmed tab that says when it comes.
    expect(tabs.getByText("Resources").getAttribute("title")).toBe("Comes in Phase 5");
  });

  it("lists only built pages in the sidebar, the rest under Coming soon", async () => {
    mockServer();
    useUi.setState({ sidebarOpen: true });
    renderAt("/stacks");
    await screen.findByRole("heading", { level: 1, name: "Stacks" });
    const dock = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(dock.queryByRole("link", { name: "Logs" })).toBeNull(); // a tab of Stacks now
    expect(dock.getByRole("link", { name: "Stacks" }).getAttribute("aria-keyshortcuts")).toBe("G S");
    expect(dock.queryByRole("link", { name: "Databases" })).toBeNull(); // not built: folded away
    const soon = dock.getByRole("button", { name: "Coming soon" });
    expect(soon.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(soon);
    expect(dock.getByRole("link", { name: "Databases" })).toBeTruthy();
    const footer = within(screen.getByRole("navigation", { name: "System" }));
    expect(footer.getByRole("link", { name: "Connections" })).toBeTruthy();
    expect(footer.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  it("starts collapsed and remembers when you expand the sidebar", async () => {
    mockServer();
    renderAt("/stacks");
    await screen.findByRole("heading", { level: 1, name: "Stacks" });
    expect(localStorage.getItem("devdeck.sidebar")).toBeNull();
    expect(document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state")).toBe("collapsed");

    fireEvent.click(screen.getAllByRole("button", { name: "Toggle Sidebar" })[0]);

    expect(document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state")).toBe("expanded");
    expect(localStorage.getItem("devdeck.sidebar")).toBe("expanded");
  });

  it("keeps groups open with plain labels; only Coming soon folds", async () => {
    mockServer();
    useUi.setState({ sidebarOpen: true });
    renderAt("/stacks");
    await screen.findByRole("heading", { level: 1, name: "Stacks" });
    const dock = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(dock.queryByRole("button", { name: "Run" })).toBeNull();
    expect(dock.getByText("Run")).toBeTruthy();
    expect(dock.getByRole("link", { name: "Health" })).toBeTruthy(); // under Run until Flows ships
    expect(dock.queryByText("Automate")).toBeNull(); // nothing built there yet
    expect(dock.getByRole("button", { name: "Coming soon" })).toBeTruthy();
  });

  it("reaches every page of a group from the folded rail's flyout", async () => {
    mockServer();
    renderAt("/stacks");
    await screen.findByRole("heading", { level: 1, name: "Stacks" });
    fireEvent.click(screen.getByRole("button", { name: "Run pages" }));
    const flyout = within(await screen.findByRole("navigation", { name: "Run pages" }));
    expect(flyout.getByRole("link", { name: "Logs" }).getAttribute("href")).toBe("/logs");
    expect(flyout.getByRole("link", { name: "Health" }).getAttribute("href")).toBe("/doctor");
    expect(flyout.getByRole("link", { name: "Images and tags" })).toBeTruthy();
    expect(flyout.getByText("Resources").getAttribute("title")).toBe("Comes in Phase 5"); // not built: no link
  });

  it("has an Overview page under devdeck with its own empty state", async () => {
    mockServer();
    renderAt("/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("devdeck/Overview");
  });

  it("shows Not found for unknown paths", async () => {
    mockServer();
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Not found" })).toBeTruthy();
  });

  it("marks the current page's sidebar item, its family's first page for a tab", async () => {
    mockServer();
    renderAt("/logs");
    await screen.findByRole("heading", { name: "Logs" });
    const dock = screen.getByRole("navigation", { name: "Pages" });
    expect(within(dock).getByRole("link", { name: "Stacks" }).getAttribute("aria-current")).toBe("page");
    expect(within(dock).getByRole("link", { name: "Workspaces" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows a loading skeleton while the plugin list is on its way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/v1/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
        return new Promise(() => {}); // plugins never answer
      }),
    );
    renderAt("/plugins");
    expect(await screen.findByRole("status", { name: "Loading plugins…" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists plugins with status, version and detail", async () => {
    mockServer();
    renderAt("/plugins");
    const table = within(await screen.findByRole("table"));
    const row = table.getByText("Docker").closest("tr")!;
    expect(within(row).getByText("Degraded")).toBeTruthy();
    expect(within(row).getByText("29.6.1")).toBeTruthy();
    expect(within(row).getAllByText("the Docker engine is not running").length).toBeGreaterThan(0);
    const git = table.getByText("Git").closest("tr")!;
    expect(within(git).getByText("Ready")).toBeTruthy();
  });

  it("re-checks one plugin and updates its row", async () => {
    mockServer();
    renderAt("/plugins");
    const table = within(await screen.findByRole("table"));
    const row = table.getByText("Docker").closest("tr")!;

    fireEvent.click(within(row).getByRole("button", { name: "Check Docker again" }));

    await waitFor(() => expect(within(table.getByText("Docker").closest("tr")!).getByText("Ready")).toBeTruthy());
    expect(calls).toContainEqual({ method: "POST", url: "/api/v1/plugins/docker/check" });
  });
});
