import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { Plugin } from "../lib/types";

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
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("pages", () => {
  it("shows a placeholder with its phase for pages that are not built yet", async () => {
    mockServer();
    renderAt("/stacks");
    expect(await screen.findByRole("heading", { name: "Stacks" })).toBeTruthy();
    expect(screen.getByText("Phase 2")).toBeTruthy();
  });

  it("shows the page's own empty state", async () => {
    mockServer();
    renderAt("/repos");
    expect(await screen.findByRole("heading", { name: "No repository connected yet" })).toBeTruthy();
    // its button leads somewhere real
    expect(screen.getByRole("link", { name: /Connect repository/ }).getAttribute("href")).toBe("/connections");
  });

  it("disables the button on pages that are not built yet, with the phase in its tooltip", async () => {
    mockServer();
    renderAt("/stacks");
    const btn = (await screen.findByRole("button", { name: /Create stack/ })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Available in Phase 2");
  });

  it("shows tool status chips in the top bar", async () => {
    mockServer([
      { id: "git", name: "Git", category: "vcs", needs: [{ binary: "git" }], status: { state: "ok", checked_at: "" } },
    ]);
    renderAt("/stacks");
    const chip = await screen.findByRole("link", { name: "Git" });
    expect(chip.getAttribute("href")).toBe("/plugins");
  });

  it("shows Not found for unknown paths", async () => {
    mockServer();
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Not found" })).toBeTruthy();
  });

  it("marks the current page in the dock", async () => {
    mockServer();
    renderAt("/logs");
    await screen.findByRole("heading", { name: "Logs" });
    const dock = screen.getByRole("navigation", { name: "Pages" });
    expect(within(dock).getByRole("link", { name: "Logs" }).getAttribute("aria-current")).toBe("page");
    expect(within(dock).getByRole("link", { name: "Stacks" }).getAttribute("aria-current")).toBeNull();
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
