import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DoctorReport, RunStatus } from "../lib/types";
import { useUi } from "../store/ui";
import { routes } from "./routes";

const doctorAsked: string[] = [];

function mockServer(runs: RunStatus[], report: DoctorReport | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = url.replace("/api/v1", "");
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/runs") return json(runs);
      if (path === "/workspaces") return json([{ id: "acme", name: "acme", errors: 0, repos: 1, stacks: 1, flows: 0 }]);
      if (path.startsWith("/doctor")) {
        doctorAsked.push(path);
        return report ? json(report) : json({ message: "not found" }, 404);
      }
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
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
  doctorAsked.length = 0;
});

const running: RunStatus = {
  workspace: "acme",
  stack: "demo-api",
  state: "degraded",
  started_at: "2026-11-22T10:00:00Z",
  services: [
    { id: "api", kind: "command", state: "ready", restarts: 0 },
    { id: "worker", kind: "command", state: "failed", restarts: 2 },
  ],
};

describe("the sidebar's live status", () => {
  it("counts running stacks on Stacks and puts Doctor's failures on Health, in words for screen readers", async () => {
    useUi.setState({ sidebarOpen: true });
    mockServer([running], { workspace: "acme", checks: [], passed: 4, warnings: 0, failures: 2, checked_at: "2026-11-22T10:00:00Z" });
    renderAt("/settings");
    const dock = within(await screen.findByRole("navigation", { name: "Pages" }));
    await waitFor(() => expect(dock.getByRole("link", { name: "Stacks" }).getAttribute("aria-describedby")).toBeTruthy());
    const stacks = dock.getByRole("link", { name: "Stacks" });
    expect(document.getElementById(stacks.getAttribute("aria-describedby")!)!.textContent).toBe("1 running, 1 with a problem");
    expect(within(stacks).getByText("1")).toBeTruthy();

    await waitFor(() => expect(dock.getByRole("link", { name: "Health" }).getAttribute("aria-describedby")).toBeTruthy());
    const health = dock.getByRole("link", { name: "Health" });
    expect(document.getElementById(health.getAttribute("aria-describedby")!)!.textContent).toBe("Doctor found 2 problems");
    expect(doctorAsked).toEqual(["/doctor?workspace=acme"]); // the default workspace, once
  });

  it("shows nothing when no stack runs and Doctor found nothing", async () => {
    useUi.setState({ sidebarOpen: true });
    mockServer([], { workspace: "acme", checks: [], passed: 6, warnings: 0, failures: 0, checked_at: "2026-11-22T10:00:00Z" });
    renderAt("/settings");
    const dock = within(await screen.findByRole("navigation", { name: "Pages" }));
    await waitFor(() => expect(doctorAsked).toHaveLength(1));
    expect(dock.getByRole("link", { name: "Stacks" }).getAttribute("aria-describedby")).toBeNull();
    expect(dock.getByRole("link", { name: "Health" }).getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector('[data-ui="nav-status"]')).toBeNull();
  });
});
