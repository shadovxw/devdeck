import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSummary } from "../lib/types";
import { useUi } from "../store/ui";
import { routes } from "./routes";
import { workspaceLabel } from "./WorkspaceSwitcher";

const ws = (id: string, name = id) => ({ id, name, errors: 0 }) as WorkspaceSummary;

describe("workspaceLabel", () => {
  it.each([
    ["not loaded yet", undefined, "Projects"],
    ["none", [], "No project"],
    ["one: its name", [ws("acme", "Acme shop")], "Acme shop"],
    ["several: how many", [ws("a"), ws("b"), ws("c")], "3 projects"],
  ])("%s", (_, list, want) => {
    expect(workspaceLabel(list)).toBe(want);
  });
});

describe("the workspace switcher", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    useUi.setState({ sidebarOpen: false, closedGroups: [] });
    vi.unstubAllGlobals();
  });

  it("sits in the sidebar header, says which workspace there is, and opens Workspaces", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const path = url.replace("/api/v1", "");
        if (path === "/workspaces") return Promise.resolve(Response.json([ws("acme", "Acme shop")]));
        if (path === "/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
        if (path === "/runs") return Promise.resolve(Response.json([]));
        return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
      }),
    );
    useUi.setState({ sidebarOpen: true });
    const router = createMemoryRouter(routes, { initialEntries: ["/settings"] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole("link", { name: "Project: Acme shop" });
    expect(link.getAttribute("href")).toBe("/workspaces");
    expect(link.closest('[data-slot="sidebar-header"]')).toBeTruthy();
    // Not in the top bar any more.
    expect(within(document.querySelector('[data-ui="topbar"]') as HTMLElement).queryByRole("link", { name: /Project/ })).toBeNull();
  });
});
