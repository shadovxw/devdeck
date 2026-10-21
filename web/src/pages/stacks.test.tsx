import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import { SocketProvider } from "../lib/socket";
import type { DoctorReport, RunStatus, StackDef, WorkspaceSummary } from "../lib/types";
import { TopicSocket, type WebSocketLike } from "../lib/ws";
import { useUi } from "../store/ui";

const summary = (id: string, source: "local" | "example", errors = 0): WorkspaceSummary => ({
  id,
  name: id,
  source,
  root: "~/code",
  repos: 2,
  stacks: 1,
  flows: 0,
  errors,
  warnings: 0,
});

const full: StackDef = {
  name: "full",
  description: "The database, the API and the web app.",
  compose: [{ repo: "infra", file: "docker-compose.yml" }],
  services: [
    { id: "api", kind: "go", port: 8080 },
    { id: "web", kind: "node", port: 5173, after: ["api"] },
  ],
};

const run = (state: RunStatus["state"], services: RunStatus["services"]): RunStatus => ({
  workspace: "demo",
  stack: "full",
  state,
  started_at: new Date(Date.now() - 134_000).toISOString(),
  services,
});

const svc = (id: string, state: RunStatus["services"][number]["state"], extra: Partial<RunStatus["services"][number]> = {}) => ({
  id,
  kind: id === "compose" ? "compose" : "go",
  state,
  restarts: 0,
  ...extra,
});

const readyAt = new Date(Date.now() - 65_000).toISOString();
const runningRun = () =>
  run("running", [
    svc("compose", "ready", { ready_at: readyAt }),
    svc("api", "ready", { port: 8080, ready_at: readyAt }),
    svc("web", "ready", { port: 5173, ready_at: readyAt }),
  ]);

const refusal: { message: string; report: DoctorReport } = {
  message: "this machine isn't ready for the stack: 1 problem found",
  report: {
    workspace: "demo",
    stack: "full",
    passed: 3,
    warnings: 0,
    failures: 1,
    checked_at: "2026-10-17T12:00:00Z",
    checks: [
      { id: "tool:go", group: "tools", title: "Go 1.22 or newer", status: "fail", detail: "go not found on PATH", fix: ["winget install --id GoLang.Go -e"] },
      { id: "tool:git", group: "tools", title: "Git 2.30 or newer", status: "ok" },
    ],
  },
};

type Call = { method: string; url: string };
const calls: Call[] = [];

type Server = {
  workspaces?: WorkspaceSummary[];
  runs?: RunStatus[];
  startAnswer?: () => Response;
  /** What GET /runs answers after a stop. */
  runsAfterStop?: RunStatus[];
};

function mockServer(opts: Server = {}) {
  let runs = opts.runs ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const path = url.replace("/api/v1", "");
      if (path === "/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (path === "/workspaces") return Promise.resolve(Response.json(opts.workspaces ?? [summary("demo", "local")]));
      if (path === "/workspaces/demo" || path === "/workspaces/sample") {
        const sample = path.endsWith("sample");
        return Promise.resolve(
          Response.json({
            ...summary(sample ? "sample" : "demo", sample ? "example" : "local"),
            workspace: { name: "demo", root: "~/code" },
            stacks: [full],
            flows: [],
            issues: [],
          }),
        );
      }
      if (path === "/runs") return Promise.resolve(Response.json(runs));
      if (path === "/workspaces/demo/stacks/full/start") {
        if (opts.startAnswer) return Promise.resolve(opts.startAnswer());
        runs = [run("starting", [svc("compose", "starting"), svc("api", "waiting", { port: 8080 }), svc("web", "waiting", { port: 5173 })])];
        return Promise.resolve(Response.json(runs[0], { status: 202 }));
      }
      if (path === "/workspaces/demo/stacks/full/stop") {
        runs = opts.runsAfterStop ?? [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path.startsWith("/workspaces/demo/stacks/full/services/")) return Promise.resolve(new Response(null, { status: 202 }));
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }),
  );
}

class FakeSocket implements WebSocketLike {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send() {}
  close() {}
  push(topic: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ topic, data, sub: "stacks.*" }) });
  }
}

function renderAt(path: string, socket?: TopicSocket) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(socket ? <SocketProvider socket={socket}>{tree}</SocketProvider> : tree);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  calls.length = 0;
});

const posted = (suffix: string) => calls.some((c) => c.method === "POST" && c.url.endsWith(suffix));

describe("stacks page", () => {
  it("asks for a workspace first when there is none", async () => {
    mockServer({ workspaces: [] });
    renderAt("/stacks");
    expect(await screen.findByRole("heading", { name: "Add a workspace first" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Add workspace/ }).getAttribute("href")).toBe("/workspaces");
  });

  it("shows each stack with its start order, before anything runs", async () => {
    mockServer();
    renderAt("/stacks");

    const card = within(await screen.findByRole("region", { name: "Stack full" }));
    expect(card.getByText("The database, the API and the web app.")).toBeTruthy();
    const order = within(card.getByRole("list", { name: "Start order" }));
    const names = order.getAllByRole("listitem").map((li) => li.textContent);
    expect(names.some((t) => t?.includes("Dependencies"))).toBe(true);
    expect(order.getByText("api")).toBeTruthy();
    expect(order.getByText("web")).toBeTruthy();
    expect(card.getByRole("heading", { name: /full/ }).textContent).toContain("Stopped");
    expect((card.getByRole("button", { name: /Start/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(card.queryByRole("table")).toBeNull();
  });

  it("starts a stack and shows its services at once", async () => {
    mockServer();
    renderAt("/stacks");
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));

    const card = within(await screen.findByRole("region", { name: "Stack full" }));
    const table = within(await card.findByRole("table"));
    expect(table.getByText("Dependencies")).toBeTruthy();
    expect(table.getAllByText("Starting").length).toBeGreaterThan(0);
    expect(table.getAllByText("Waiting")).toHaveLength(2);
    expect(card.getByRole("button", { name: /Stop/ })).toBeTruthy();
    expect(posted("/workspaces/demo/stacks/full/start")).toBe(true);
  });

  it("explains why the machine isn't ready, with what to run", async () => {
    mockServer({ startAnswer: () => Response.json(refusal, { status: 422 }) });
    renderAt("/stacks");
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));

    const alert = within(await screen.findByRole("alert"));
    expect(alert.getByText(refusal.message)).toBeTruthy();
    expect(alert.getByText("Go 1.22 or newer")).toBeTruthy();
    expect(alert.getByText("winget install --id GoLang.Go -e")).toBeTruthy();
    expect(alert.queryByText("Git 2.30 or newer")).toBeNull(); // only what failed
    expect(alert.getByRole("link", { name: /Open Doctor/ }).getAttribute("href")).toBe("/doctor?workspace=demo&stack=full");
    // still startable once it is fixed
    expect((screen.getByRole("button", { name: /Start/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a plain message for any other refusal", async () => {
    mockServer({ startAnswer: () => Response.json({ message: "that stack is already running" }, { status: 409 }) });
    renderAt("/stacks");
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("that stack is already running");
  });

  it("does not offer to start a sample workspace", async () => {
    mockServer({ workspaces: [summary("sample", "example")] });
    renderAt("/stacks");
    const start = (await screen.findByRole("button", { name: /Start/ })) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.title).toMatch(/Sample workspaces can.t be started/);
  });

  it("shows what is wrong with a service, and restarts it on request", async () => {
    mockServer({
      runs: [
        run("degraded", [
          svc("compose", "ready", { ready_at: readyAt }),
          svc("api", "failed", { port: 8080, restarts: 2, last_error: "It crashed 3 times in a row, so devdeck gave up: boom" }),
          svc("web", "blocked", { port: 5173, last_error: "api failed, so this wasn't started" }),
        ]),
      ],
    });
    renderAt("/stacks");

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Failed")).toBeTruthy();
    expect(table.getByText("Blocked")).toBeTruthy();
    expect(table.getByText(/gave up: boom/)).toBeTruthy();
    expect(table.getByText(/api failed, so this wasn't started/)).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(table.queryByRole("button", { name: /Restart Dependencies/ })).toBeNull();

    fireEvent.click(table.getByRole("button", { name: "Restart api" }));
    await waitFor(() => expect(posted("/workspaces/demo/stacks/full/services/api/restart")).toBe(true));
  });

  it("stops a running stack", async () => {
    mockServer({ runs: [runningRun()] });
    renderAt("/stacks");

    expect(await screen.findByText(/^Up 2m/)).toBeTruthy();
    const table = within(await screen.findByRole("table"));
    expect(table.getAllByText(/^1m \d+s$/).length).toBeGreaterThan(0); // up for, from ready_at
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));

    await waitFor(() => expect(posted("/workspaces/demo/stacks/full/stop")).toBe(true));
    expect(await screen.findByRole("button", { name: /Start/ })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("follows live updates from the server", async () => {
    mockServer();
    const fake = new FakeSocket();
    const socket = new TopicSocket({ url: "wss://test/ws", create: () => fake });
    renderAt("/stacks", socket);
    await screen.findByRole("button", { name: /Start/ });

    // the supervisor says the stack is starting, then that it is running
    act(() => fake.push("stacks.demo.full", run("starting", [svc("compose", "ready", { ready_at: readyAt }), svc("api", "starting", { port: 8080 }), svc("web", "waiting", { port: 5173 })])));
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Starting")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();

    act(() => fake.push("stacks.demo.full", runningRun()));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Starting")).toBeNull());
    expect(screen.getByText("Running")).toBeTruthy();
    const nodes = within(screen.getByRole("list", { name: "Start order" })).getAllByRole("listitem");
    expect(nodes.filter((n) => n.getAttribute("data-state") === "ready").length).toBe(3);

    // and that it has stopped: the card goes back to a Start button
    act(() => fake.push("stacks.demo.full", { ...runningRun(), state: "stopped" }));
    expect(await screen.findByRole("button", { name: /Start/ })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("home page", () => {
  it("points to the stacks when something can be started", async () => {
    mockServer();
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Nothing is running" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open stacks/ }).getAttribute("href")).toBe("/stacks");
  });

  it("asks for a workspace when there is none", async () => {
    mockServer({ workspaces: [] });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Your workspace is ready to connect" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Configure workspace/ }).getAttribute("href")).toBe("/workspaces");
  });

  it("shows what is running, with counts, links and problems", async () => {
    mockServer({
      runs: [
        run("degraded", [
          svc("compose", "ready", { ready_at: readyAt }),
          svc("api", "ready", { port: 8080, ready_at: readyAt }),
          svc("web", "failed", { port: 5173, last_error: "It exited with code 1: boom" }),
        ]),
      ],
    });
    renderAt("/");

    const strip = within(await screen.findByText("Stacks running").then((el) => el.closest("dl") as HTMLElement));
    expect(strip.getByText("Stacks running").nextElementSibling?.textContent).toBe("1");
    expect(strip.getByText("Services ready").nextElementSibling?.textContent).toBe("2of 3");
    expect(strip.getByText("Problems").nextElementSibling?.textContent).toContain("1");
    // no live connection in this test, and the page says so instead of claiming updates are on
    expect(strip.getByText("Live updates").nextElementSibling?.textContent).toBe("Reconnecting…");

    const services = within(screen.getByRole("region", { name: "Services in full" }));
    expect(services.getByRole("link", { name: ":8080" }).getAttribute("href")).toBe("http://127.0.0.1:8080");
    expect(services.queryByRole("link", { name: ":5173" })).toBeNull(); // not ready: nothing to open yet
    expect(services.getByText(/exited with code 1: boom/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "full" }).getAttribute("href")).toBe("/stacks?workspace=demo");
    expect(screen.getByRole("link", { name: /Check this machine/ }).getAttribute("href")).toBe("/doctor");
  });
});
