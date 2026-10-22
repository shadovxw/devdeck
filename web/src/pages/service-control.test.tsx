import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { RunStatus, ServiceState, WorkspaceSummary } from "../lib/types";
import { useUi } from "../store/ui";

const demo: WorkspaceSummary = { id: "demo", name: "demo", source: "local", root: "~/code", repos: 1, stacks: 1, flows: 0, errors: 0, warnings: 0 };

const svc = (id: string, state: ServiceState, kind = "go"): RunStatus["services"][number] => ({ id, kind, state, restarts: 0 });

const run = (services: RunStatus["services"]): RunStatus => ({ workspace: "demo", stack: "full", state: "degraded", started_at: new Date().toISOString(), services });

type Call = { method: string; url: string };
const calls: Call[] = [];
const posted = (suffix: string) => calls.some((c) => c.method === "POST" && c.url.endsWith(suffix));

function mockServer(services: RunStatus["services"], fail?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const path = url.replace("/api/v1", "");
      if (path === "/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (path === "/workspaces") return Promise.resolve(Response.json([demo]));
      if (path === "/workspaces/demo") {
        return Promise.resolve(
          Response.json({
            ...demo,
            workspace: { name: "demo", root: "~/code" },
            stacks: [
              {
                name: "full",
                compose: [{ id: "vault", repo: "v", file: "c.yml", optional: true }],
                services: [
                  { id: "api", kind: "go", after: ["vault"] },
                  { id: "web", kind: "node", after: ["api"] },
                ],
              },
            ],
            flows: [],
            issues: [],
          }),
        );
      }
      if (path === "/runs") return Promise.resolve(Response.json([run(services)]));
      if (path.includes("/services/") && method === "POST") {
        if (fail) return Promise.resolve(Response.json({ message: fail }, { status: 404 }));
        return Promise.resolve(new Response(null, { status: path.endsWith("/stop") ? 204 : 202 }));
      }
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }),
  );
}

function renderStacks() {
  const router = createMemoryRouter(routes, { initialEntries: ["/stacks"] });
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
  calls.length = 0;
});

const table = async () => within(await screen.findByRole("table"));
const button = (t: ReturnType<typeof within>, name: string) => t.getByRole("button", { name }) as HTMLButtonElement;

describe("stopping and starting one service from its row", () => {
  it("offers Stop for what runs and Start for what doesn't", async () => {
    mockServer([svc("vault", "ready", "compose"), svc("api", "ready"), svc("web", "stopped"), svc("worker", "failed"), svc("cache", "blocked")]);
    renderStacks();
    const t = await table();

    expect(button(t, "Stop api").disabled).toBe(false);
    expect(button(t, "Start api").disabled).toBe(true);
    expect(button(t, "Stop web").disabled).toBe(true);
    expect(button(t, "Start web").disabled).toBe(false);
    // failed and blocked ones can be started (the loop button also tries again), but there is nothing to stop
    expect(button(t, "Start worker").disabled).toBe(false);
    expect(button(t, "Stop worker").disabled).toBe(true);
    expect(button(t, "Start cache").disabled).toBe(false);
  });

  it("links each service (not a compose file) to its logs", async () => {
    mockServer([svc("vault", "ready", "compose"), svc("api", "ready")]);
    renderStacks();
    const t = await table();

    expect(t.getByRole("link", { name: "Logs of api" }).getAttribute("href")).toBe("/logs?workspace=demo&stack=full&service=api");
    expect(t.queryByRole("link", { name: "Logs of vault" })).toBeNull();
  });

  it("sends stop and start for the service in the row", async () => {
    mockServer([svc("api", "ready"), svc("web", "stopped")]);
    renderStacks();
    const t = await table();

    fireEvent.click(button(t, "Stop api"));
    await waitFor(() => expect(posted("/workspaces/demo/stacks/full/services/api/stop")).toBe(true));
    fireEvent.click(button(t, "Start web"));
    await waitFor(() => expect(posted("/workspaces/demo/stacks/full/services/web/start")).toBe(true));
  });

  it("works for a compose file too, which has no restart button", async () => {
    mockServer([svc("vault", "ready", "compose"), svc("api", "ready")]);
    renderStacks();
    const t = await table();

    expect(t.queryByRole("button", { name: "Restart vault" })).toBeNull();
    expect(t.getByRole("button", { name: "Restart api" })).toBeTruthy();
    fireEvent.click(button(t, "Stop vault"));
    await waitFor(() => expect(posted("/workspaces/demo/stacks/full/services/vault/stop")).toBe(true));
  });

  it("shows the server's reason when it refuses", async () => {
    mockServer([svc("api", "ready")], "that service isn't in the stack");
    renderStacks();
    const t = await table();

    fireEvent.click(button(t, "Stop api"));
    expect((await screen.findByRole("alert")).textContent).toContain("isn't in the stack");
  });

  it("shows the ports a compose file's containers publish, in the table and in the diagram", async () => {
    mockServer([{ ...svc("vault", "ready", "compose"), ports: [3900, 3903] }, { ...svc("api", "ready"), port: 8080 }, svc("web", "ready")]);
    renderStacks();
    const t = await table();
    const row = t.getByText("vault").closest("tr") as HTMLElement;
    expect(within(row).getByText("3900, 3903")).toBeTruthy();
    const order = within(screen.getByRole("list", { name: "Start order" }));
    expect(order.getByText(":3900 :3903")).toBeTruthy();
  });

  it("draws a named compose file as a step in the start order", async () => {
    mockServer([svc("vault", "ready", "compose"), svc("api", "ready"), svc("web", "ready")]);
    renderStacks();
    const order = within(await screen.findByRole("list", { name: "Start order" }));
    const columns = order.getAllByRole("list").map((ul) => within(ul).getAllByRole("listitem").map((li) => li.textContent?.trim()));
    expect(columns.map((c) => c.length)).toEqual([1, 1, 1]);
    expect(columns[0][0]).toContain("vault");
    expect(columns[1][0]).toContain("api");
    expect(columns[2][0]).toContain("web");
  });
});
