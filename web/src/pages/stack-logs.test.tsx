import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import { SocketProvider } from "../lib/socket";
import type { CaptureInfo, CaptureRule, LogEntry, WorkspaceSummary } from "../lib/types";
import { TopicSocket, type WebSocketLike } from "../lib/ws";
import { useUi } from "../store/ui";

const summary = (id: string, source: "local" | "example"): WorkspaceSummary => ({
  id,
  name: id,
  source,
  root: "~/code",
  repos: 1,
  stacks: 1,
  flows: 0,
  errors: 0,
  warnings: 0,
});

const entry = (seq: number, service: string, text: string, stream = "stdout"): LogEntry => ({
  seq,
  time: "2026-10-21T12:00:00.123Z",
  workspace: "demo",
  stack: "full",
  service,
  stream,
  text,
});

const batch = (from: number, entries: LogEntry[]) => ({ workspace: "demo", stack: "full", from_seq: from, to_seq: from + entries.length - 1, entries });

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const get = (part: string) => calls.filter((c) => c.method === "GET" && c.url.includes("/logs") && c.url.includes(part));

type Server = {
  sample?: boolean;
  stored?: LogEntry[];
  /** What a fetch "after" the given number returns. */
  later?: LogEntry[];
  captures?: CaptureInfo[];
  putError?: string;
};

function mockServer(opts: Server = {}) {
  let captures = opts.captures ?? [
    { service: "api", store: "all", source: "default" },
    { service: "compose-kc/keycloak", store: "matching", match: "WARN", source: "file" },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "");
      const id = opts.sample ? "sample" : "demo";

      if (path === "/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (path === "/workspaces") return Promise.resolve(Response.json([summary(id, opts.sample ? "example" : "local")]));
      if (path === `/workspaces/${id}`) {
        return Promise.resolve(
          Response.json({
            ...summary(id, opts.sample ? "example" : "local"),
            workspace: { name: id, root: "~/code", repos: [{ id: "api", path: "api" }] },
            stacks: [{ name: "full", services: [{ id: "api", kind: "go" }] }],
            flows: [],
            issues: [],
          }),
        );
      }
      if (path === "/runs") return Promise.resolve(Response.json([]));
      if (path.includes("/logs/capture")) {
        const service = decodeURIComponent(new URL(path, "http://x").searchParams.get("service") ?? "");
        if (method === "GET") return Promise.resolve(Response.json(captures));
        if (method === "PUT") {
          if (opts.putError) return Promise.resolve(Response.json({ message: opts.putError }, { status: 422 }));
          const rule = body as CaptureRule;
          captures = captures.map((c) => (c.service === service ? { ...c, ...rule, match: rule.match, source: "override" as const } : c));
          return Promise.resolve(Response.json(captures.find((c) => c.service === service)));
        }
        if (method === "DELETE") {
          captures = captures.map((c) => (c.service === service ? { service, store: "all", source: "default" as const } : c));
          return Promise.resolve(Response.json(captures.find((c) => c.service === service)));
        }
      }
      if (path.includes("/logs")) {
        const q = new URL(path, "http://x").searchParams;
        if (q.get("after")) return Promise.resolve(Response.json({ entries: opts.later ?? [] }));
        const all = opts.stored ?? [entry(10, "api", "listening on :8080"), entry(11, "web", "ready in 300 ms"), entry(12, "api", "GET /health 200", "stderr")];
        const only = q.get("service");
        return Promise.resolve(Response.json({ entries: only ? all.filter((e) => e.service === only) : all }));
      }
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
    this.onmessage?.({ data: JSON.stringify({ topic, data, sub: topic }) });
  }
}

function renderLogs(workspace?: string) {
  const fake = new FakeSocket();
  const socket = new TopicSocket({ url: "wss://test/ws", create: () => fake });
  const router = createMemoryRouter(routes, { initialEntries: [workspace ? `/stacks?workspace=${workspace}` : "/stacks"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <SocketProvider socket={socket}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SocketProvider>,
  );
  return fake;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  calls.length = 0;
});

async function openLogs() {
  fireEvent.click(await screen.findByRole("button", { name: "Logs of full" }));
  return screen.findByRole("log", { name: "Logs of full" });
}

const rows = (log: HTMLElement) => Array.from(log.querySelectorAll("[title]")).map((r) => r.getAttribute("title"));

describe("the logs of a stack", () => {
  it("shows the stored lines when opened, with their service", async () => {
    mockServer();
    renderLogs();
    const log = await openLogs();

    await waitFor(() => expect(rows(log)).toEqual(["listening on :8080", "ready in 300 ms", "GET /health 200"]));
    expect(within(log).getByText("web")).toBeTruthy();
    expect(within(log).getByText("err")).toBeTruthy(); // stderr is marked in words, not only by position
    expect(screen.getByRole("status").textContent).toContain("3 lines");
    expect(get("limit=500")).toHaveLength(1);
  });

  it("adds lines as they arrive, and only the chosen service's when one is chosen", async () => {
    mockServer();
    const fake = renderLogs();
    const log = await openLogs();
    await waitFor(() => expect(rows(log)).toHaveLength(3));

    act(() => fake.push("logs.demo.full", batch(13, [entry(13, "api", "new api line"), entry(14, "web", "new web line")])));
    await waitFor(() => expect(rows(log)).toContain("new web line"));
    expect(rows(log)).toContain("new api line");

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "web" } });
    await waitFor(() => expect(get("service=web")).toHaveLength(1));
    await waitFor(() => expect(rows(log)).toEqual(["ready in 300 ms"]));
    act(() => fake.push("logs.demo.full", batch(15, [entry(15, "api", "api again"), entry(16, "web", "web again")])));
    await waitFor(() => expect(rows(log)).toEqual(["ready in 300 ms", "web again"]));
  });

  it("asks for what it missed when a batch is skipped", async () => {
    mockServer({ later: [entry(14, "api", "the lost one")] });
    const fake = renderLogs();
    const log = await openLogs();
    await waitFor(() => expect(rows(log)).toHaveLength(3));

    act(() => fake.push("logs.demo.full", batch(13, [entry(13, "api", "first batch")])));
    await waitFor(() => expect(rows(log)).toContain("first batch"));
    act(() => fake.push("logs.demo.full", batch(20, [entry(20, "api", "after a gap")]))); // 14 to 19 never arrived

    await waitFor(() => expect(get("after=13")).toHaveLength(1));
    await waitFor(() => expect(rows(log)).toContain("the lost one"));
  });

  it("pauses without losing anything, and catches up when resumed", async () => {
    mockServer({ later: [entry(14, "api", "arrived while paused")] });
    const fake = renderLogs();
    const log = await openLogs();
    await waitFor(() => expect(rows(log)).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => fake.push("logs.demo.full", batch(14, [entry(14, "api", "arrived while paused")])));
    expect(rows(log)).not.toContain("arrived while paused");
    expect(screen.getByRole("status").textContent).toContain("paused");

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(rows(log)).toContain("arrived while paused"));
    expect(get("after=12")).toHaveLength(1);
  });

  it("clears the view only, deleting nothing", async () => {
    mockServer();
    renderLogs();
    const log = await openLogs();
    await waitFor(() => expect(rows(log)).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: /Clear view/ }));
    await waitFor(() => expect(rows(log)).toHaveLength(0));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("says when the logs can't be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const path = url.replace("/api/v1", "");
      if (path === "/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (path === "/workspaces") return Promise.resolve(Response.json([summary("demo", "local")]));
      if (path === "/workspaces/demo") return Promise.resolve(Response.json({ ...summary("demo", "local"), workspace: { name: "demo", root: "~" }, stacks: [{ name: "full" }], flows: [], issues: [] }));
      if (path === "/runs") return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ message: "boom" }, { status: 500 }));
    }));
    renderLogs();
    await openLogs();
    expect(await screen.findByText("Could not load the logs.")).toBeTruthy();
  });
});

describe("what is stored for each service", () => {
  const open = async () => {
    await openLogs();
    fireEvent.click(await screen.findByText("What is stored"));
  };

  it("lists each service's rule and where it comes from", async () => {
    mockServer();
    renderLogs();
    await open();
    expect(await screen.findByText("Storing everything")).toBeTruthy();
    expect(screen.getByText("Storing lines that match WARN")).toBeTruthy();
    expect(screen.getByText("from the stack file")).toBeTruthy();
  });

  it("stops and restarts storing a service without editing a file", async () => {
    mockServer();
    renderLogs();
    await open();
    const row = (await screen.findByText("api", { selector: "span.font-mono" })).closest("li") as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: /Stop storing/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("service=api") && (c.body as CaptureRule).store === "off")).toBe(true));
    expect(await within(row).findByText("Not storing (paused)")).toBeTruthy();
    expect(within(row).getByText("set here")).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: /Start storing/ }));
    await waitFor(() => expect(within(row).getByText("Storing everything")).toBeTruthy());

    // the choice made here can be dropped, going back to the stack file
    fireEvent.click(within(row).getByRole("button", { name: /Reset/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("service=api"))).toBe(true));
  });

  it("stores only lines matching a pattern, and sends a container's id whole", async () => {
    mockServer();
    renderLogs();
    await open();
    const row = (await screen.findByText("compose-kc/keycloak", { selector: "span.font-mono" })).closest("li") as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: /Only matching/ }));
    fireEvent.change(within(row).getByLabelText("Pattern for compose-kc/keycloak"), { target: { value: "(?i)error" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("service=compose-kc%2Fkeycloak") && JSON.stringify(c.body) === JSON.stringify({ store: "matching", match: "(?i)error" }))).toBe(true),
    );
    expect(await within(row).findByText("Storing lines that match (?i)error")).toBeTruthy();
  });

  it("shows the server's reason when a pattern is refused", async () => {
    mockServer({ putError: "match isn't a valid pattern: missing closing )" });
    renderLogs();
    await open();
    const row = (await screen.findByText("api", { selector: "span.font-mono" })).closest("li") as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: /Only matching/ }));
    fireEvent.change(within(row).getByLabelText("Pattern for api"), { target: { value: "(" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    expect((await within(row).findByRole("alert")).textContent).toContain("isn't a valid pattern");
  });

  it("is not offered for a sample workspace", async () => {
    mockServer({ sample: true });
    renderLogs("sample");
    await openLogs();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("lines"));
    expect(screen.queryByText("What is stored")).toBeNull();
  });
});
