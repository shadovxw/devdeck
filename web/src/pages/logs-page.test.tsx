import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { SavedLogFilter } from "../lib/log-query";
import { SocketProvider } from "../lib/socket";
import type { CaptureInfo, LogEntry, LogGroup, LogHistogram, WorkspaceSummary } from "../lib/types";
import { TopicSocket, type WebSocketLike } from "../lib/ws";
import { useUi } from "../store/ui";
import { filterId, paramsOfQuery, queryOfParams, zoomedOut } from "./LogsPage";

const summary = (id: string, source: "local" | "example"): WorkspaceSummary => ({ id, name: id, source, root: "~/code", repos: 1, stacks: 1, flows: 0, errors: 0, warnings: 0 });

const entry = (seq: number, service: string, text: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  seq,
  time: "2026-10-21T12:00:00.123Z",
  workspace: "demo",
  stack: "full",
  service,
  stream: "stdout",
  text,
  ...extra,
});

const t0 = Date.parse("2026-10-21T12:00:00Z");
const histogram: LogHistogram = {
  from: new Date(t0).toISOString(),
  to: new Date(t0 + 4 * 60_000).toISOString(),
  bucket_seconds: 60,
  total: 7,
  buckets: [
    { t: new Date(t0).toISOString(), counts: { info: 3 } },
    { t: new Date(t0 + 60_000).toISOString(), counts: { info: 1, error: 2 } },
    { t: new Date(t0 + 120_000).toISOString(), counts: { warn: 1 } },
    { t: new Date(t0 + 180_000).toISOString(), counts: {} },
  ],
};

const group: LogGroup = {
  fingerprint: "8a129441c02fb0d1",
  service: "api",
  level: "error",
  message: "db timeout",
  caller: "store/db.go:42",
  count: 3,
  first_seen: "2026-10-21T11:50:00Z",
  last_seen: "2026-10-21T11:59:00Z",
  sample_seq: 11,
};

const stored = [
  entry(10, "api", "listening on :8080", { level: "info" }),
  entry(11, "api", "db timeout after 30s", { level: "error", message: "db timeout", caller: "store/db.go:42", fields: { user: { id: 42 }, attempt: 3 }, fingerprint: group.fingerprint }),
  entry(12, "web", "slow render 812ms", { level: "warn" }),
];

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const gets = (part: string) => calls.filter((c) => c.method === "GET" && c.url.includes(part));
const lastGet = (part: string) => gets(part).at(-1)?.url ?? "";

type Server = {
  sample?: boolean;
  entries?: LogEntry[];
  groups?: LogGroup[];
  where?: { file: string; line: number } | null;
  filters?: SavedLogFilter[];
  logsError?: string;
  putError?: string;
};

function mockServer(opts: Server = {}) {
  let filters = opts.filters ?? [];
  const id = opts.sample ? "sample" : "demo";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "");
      const u = new URL(path, "http://x");
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));

      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces") return json([summary(id, opts.sample ? "example" : "local")]);
      if (path === `/workspaces/${id}`) {
        return json({
          ...summary(id, opts.sample ? "example" : "local"),
          workspace: { name: id, root: "~/code", repos: [{ id: "api", path: "api" }] },
          stacks: [{ name: "full", services: [{ id: "api", kind: "go" }] }],
          flows: [],
          issues: [],
        });
      }
      if (path === "/runs") return json([]);
      if (u.pathname.endsWith("/log-filters") && method === "GET") return json(filters);
      if (u.pathname.includes("/log-filters/")) {
        const fid = decodeURIComponent(u.pathname.split("/").pop() ?? "");
        if (method === "PUT") {
          if (opts.putError) return json({ message: opts.putError }, 422);
          filters = [...filters.filter((f) => f.id !== fid), body as SavedLogFilter];
          return json(body, 201);
        }
        if (method === "DELETE") {
          filters = filters.filter((f) => f.id !== fid);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
      }
      if (u.pathname.endsWith("/logs/capture")) {
        const c: CaptureInfo[] = [{ service: "api", store: "all", source: "default" }, { service: "web", store: "all", source: "default" }];
        return json(c);
      }
      if (u.pathname.endsWith("/logs/groups")) return json(opts.groups ?? [group]);
      if (u.pathname.endsWith("/logs/histogram")) return json(histogram);
      if (u.pathname.endsWith("/logs/where")) return opts.where ? json(opts.where) : json({ message: "no such file" }, 404);
      if (u.pathname.endsWith("/logs") && method === "DELETE") return json({ removed_files: 2 });
      if (u.pathname.endsWith("/logs")) {
        if (opts.logsError) return json({ message: opts.logsError }, 400);
        if (u.searchParams.get("after")) return json({ entries: [] });
        let all = opts.entries ?? stored;
        const levels = u.searchParams.getAll("level");
        if (levels.length) all = all.filter((e) => levels.includes(e.level ?? "info"));
        const g = u.searchParams.get("group");
        if (g) all = all.filter((e) => e.fingerprint === g);
        const services = u.searchParams.getAll("service");
        if (services.length) all = all.filter((e) => services.includes(e.service));
        return json({ entries: all });
      }
      return json({ message: "not found" }, 404);
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

const batch = (from: number, entries: LogEntry[]) => ({ workspace: "demo", stack: "full", from_seq: from, to_seq: from + entries.length - 1, entries });

function renderLogs(search = "") {
  const fake = new FakeSocket();
  const socket = new TopicSocket({ url: "wss://test/ws", create: () => fake });
  const router = createMemoryRouter(routes, { initialEntries: [`/logs${search}`] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <SocketProvider socket={socket}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SocketProvider>,
  );
  return { fake, router };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  calls.length = 0;
});

const list = () => screen.findByRole("listbox", { name: "Logs of full" });
const options = (box: HTMLElement) => within(box).queryAllByRole("option");
const messages = (box: HTMLElement) => options(box).map((o) => o.textContent ?? "");

describe("the Logs page", () => {
  it("shows the stored lines with their level, the histogram and the errors", async () => {
    mockServer();
    renderLogs();
    const box = await list();

    await waitFor(() => expect(options(box)).toHaveLength(3));
    expect(messages(box)[1]).toContain("db timeout"); // the message, not the whole JSON
    expect(within(options(box)[1]).getByText("error")).toBeTruthy(); // the level has a word, not only a shape
    expect(within(options(box)[2]).getByText("warning")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("3 lines");

    expect(await screen.findByRole("img", { name: /Lines over time, 7 in all/ })).toBeTruthy();
    const errors = within(await screen.findByRole("list", { name: "Errors" }));
    expect(errors.getByText("db timeout")).toBeTruthy();
    expect(errors.getByText("×3")).toBeTruthy();
    expect(gets("/logs?")[0].url).toContain("limit=500");
  });

  it("asks the server for the levels that are switched on", async () => {
    mockServer();
    renderLogs();
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(3));

    const levels = within(screen.getByRole("group", { name: "Levels" }));
    fireEvent.click(levels.getByRole("button", { name: /error/ }));
    await waitFor(() => expect(lastGet("/logs?")).toContain("level=error"));
    await waitFor(() => expect(options(box)).toHaveLength(1));
    expect(levels.getByRole("button", { name: /error/ }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(lastGet("/histogram")).toContain("level=error"));

    fireEvent.click(levels.getByRole("button", { name: /warning/ }));
    await waitFor(() => expect(lastGet("/logs?")).toMatch(/level=error&level=warn/));
    fireEvent.click(levels.getByRole("button", { name: /error/ }));
    fireEvent.click(levels.getByRole("button", { name: /warning/ }));
    await waitFor(() => expect(options(box)).toHaveLength(3));
  });

  it("sends a pattern once typing pauses, and does not send one that isn't valid", async () => {
    mockServer();
    renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));

    const pattern = screen.getByLabelText("Pattern");
    fireEvent.change(pattern, { target: { value: "(?i)timeout|refused" } });
    await waitFor(() => expect(lastGet("/logs?")).toContain("regex=%28%3Fi%29timeout%7Crefused"));

    const before = gets("/logs?").length;
    fireEvent.change(pattern, { target: { value: "(" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("valid pattern");
    await new Promise((r) => setTimeout(r, 450));
    expect(gets("/logs?").length).toBe(before);

    fireEvent.change(pattern, { target: { value: "" } });
    await waitFor(() => expect(lastGet("/logs?")).not.toContain("regex="));
  });

  it("adds and removes field filters", async () => {
    mockServer();
    renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));

    const field = screen.getByLabelText("Field filter");
    const add = screen.getByRole("button", { name: "Add the field filter" }) as HTMLButtonElement;
    fireEvent.change(field, { target: { value: "nonsense" } });
    expect(add.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "user.id=42" } });
    fireEvent.click(add);

    await waitFor(() => expect(lastGet("/logs?")).toContain("field=user.id%3D42"));
    const active = within(screen.getByRole("list", { name: "Active filters" }));
    fireEvent.click(active.getByRole("button", { name: "Remove the filter user.id=42" }));
    await waitFor(() => expect(lastGet("/logs?")).not.toContain("field="));
  });

  it("keeps lines that arrive live only when they match the filters", async () => {
    mockServer();
    const { fake } = renderLogs("?level=error");
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(1));

    act(() =>
      fake.push("logs.demo.full", batch(13, [entry(13, "api", "a fine line", { level: "info" }), entry(14, "api", "another failure", { level: "error" }), entry(15, "web", "x", { level: "debug" })])),
    );
    await waitFor(() => expect(messages(box).join("|")).toContain("another failure"));
    expect(messages(box).join("|")).not.toContain("a fine line");
    expect(options(box)).toHaveLength(2);
  });

  it("refreshes the errors list when a line with a fingerprint arrives, without waiting for the next poll", async () => {
    mockServer();
    const { fake } = renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));
    await waitFor(() => expect(gets("/logs/groups")).toHaveLength(1));

    act(() => fake.push("logs.demo.full", batch(13, [entry(13, "api", "boom", { level: "error", fingerprint: "abc" })])));
    await waitFor(() => expect(gets("/logs/groups")).toHaveLength(2));
    // a second burst inside the second does not ask again
    act(() => fake.push("logs.demo.full", batch(14, [entry(14, "api", "boom again", { level: "error", fingerprint: "abc" })])));
    act(() => fake.push("logs.demo.full", batch(15, [entry(15, "api", "fine", { level: "info" })])));
    await new Promise((r) => setTimeout(r, 100));
    expect(gets("/logs/groups")).toHaveLength(2);
  });

  it("pauses the view and catches up when resumed", async () => {
    mockServer();
    const { fake } = renderLogs();
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => fake.push("logs.demo.full", batch(13, [entry(13, "api", "while paused")])));
    expect(messages(box).join("|")).not.toContain("while paused");
    expect(screen.getByRole("status").textContent).toContain("paused");

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(gets("after=12")).toHaveLength(1));
  });

  it("shows the selected line in full, with its fields, and links to the file in VS Code", async () => {
    mockServer({ where: { file: "/work/api/store/db.go", line: 42 } });
    renderLogs();
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(3));

    fireEvent.click(options(box)[1]);
    const detail = within(await screen.findByRole("region", { name: "Selected line" }));
    expect(detail.getByText("db timeout after 30s")).toBeTruthy();
    expect(detail.getByText("attempt")).toBeTruthy();
    expect(detail.getByText('{"id":42}')).toBeTruthy();
    const link = await detail.findByRole("link", { name: /Open store\/db.go:42 in VS Code/ });
    expect(link.getAttribute("href")).toBe("vscode://file/work/api/store/db.go:42");
    expect((detail.getByRole("button", { name: /Ask Claude/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(detail.getByRole("button", { name: "Close the selected line" }));
    expect(screen.queryByRole("region", { name: "Selected line" })).toBeNull();
  });

  it("shows the caller as plain text when the file isn't in the repo", async () => {
    mockServer({ where: null });
    renderLogs();
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(3));
    fireEvent.click(options(box)[1]);
    const detail = within(await screen.findByRole("region", { name: "Selected line" }));
    await waitFor(() => expect(gets("/logs/where")).toHaveLength(1));
    expect(detail.getByText("store/db.go:42")).toBeTruthy();
    expect(detail.queryByRole("link")).toBeNull();
  });

  it("moves the selection with the arrow keys", async () => {
    mockServer();
    renderLogs();
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(3));
    box.focus();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(options(box)[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" }); // stays on the last line
    expect(options(box)[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Home" });
    expect(options(box)[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(options(box).every((o) => o.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("shows only one kind of error when it is picked in the errors list or from a line", async () => {
    mockServer();
    renderLogs();
    const box = await list();
    await waitFor(() => expect(options(box)).toHaveLength(3));

    const errors = within(await screen.findByRole("list", { name: "Errors" }));
    fireEvent.click(errors.getByRole("button", { name: /db timeout/ }));
    await waitFor(() => expect(lastGet("/logs?")).toContain(`group=${group.fingerprint}`));
    await waitFor(() => expect(options(box)).toHaveLength(1));
    expect(within(screen.getByRole("list", { name: "Active filters" })).getByText("One kind of error")).toBeTruthy();

    fireEvent.click(errors.getByRole("button", { name: /db timeout/ })); // again: let go
    await waitFor(() => expect(options(box)).toHaveLength(3));

    fireEvent.click(options(box)[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Show every line like this" }));
    await waitFor(() => expect(lastGet("/logs?")).toContain(`group=${group.fingerprint}`));
  });

  it("narrows the view to a stretch dragged out on the histogram", async () => {
    mockServer();
    const { router } = renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));

    const chart = await screen.findByRole("img", { name: /Lines over time/ });
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 72, width: 400, height: 72, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(chart, { clientX: 110, pointerId: 1 }); // the second of four bars
    fireEvent.pointerMove(chart, { clientX: 210, pointerId: 1 });
    fireEvent.pointerUp(chart, { clientX: 210, pointerId: 1 });

    await waitFor(() => expect(router.state.location.search).toContain("until="));
    const p = new URLSearchParams(router.state.location.search);
    expect(p.get("since")).toBe(new Date(t0 + 60_000).toISOString());
    expect(p.get("until")).toBe(new Date(t0 + 180_000).toISOString());
    // a past stretch is not followed live
    expect(await screen.findByRole("button", { name: "Back to live" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    await waitFor(() => expect(lastGet("/logs?")).toContain("until="));

    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("until="));
  });

  it("does nothing when the histogram is only clicked, and zooms out of a stretch step by step", async () => {
    mockServer();
    const { router } = renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));

    const chart = await screen.findByRole("img", { name: /Lines over time/ });
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 72, width: 400, height: 72, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(chart, { clientX: 110, pointerId: 1 });
    fireEvent.pointerUp(chart, { clientX: 111, pointerId: 1 }); // a click
    expect(router.state.location.search).not.toContain("until");
    expect(screen.queryByRole("button", { name: "Zoom out" })).toBeNull();

    fireEvent.pointerDown(chart, { clientX: 110, pointerId: 1 });
    fireEvent.pointerUp(chart, { clientX: 210, pointerId: 1 });
    await screen.findByRole("button", { name: "Back to live" });
    const before = new URLSearchParams(router.state.location.search);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("since")).not.toBe(before.get("since")));
    const after = new URLSearchParams(router.state.location.search);
    const span = (p: URLSearchParams) => Date.parse(p.get("until") ?? "") - Date.parse(p.get("since") ?? "");
    expect(span(after)).toBe(span(before) * 3);
  });

  it("saves the filters under a name, lists them, applies one and deletes one", async () => {
    mockServer({ filters: [{ id: "slow", name: "Slow pages", levels: ["warn"], regex: "slow" }] });
    const { router } = renderLogs("?level=error&q=timeout&field=user.id%3D42&since=15m");
    await waitFor(async () => expect(options(await list())).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Save filter" }));
    fireEvent.change(screen.getByLabelText("Name of the filter"), { target: { value: "API errors!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/log-filters/api-errors"))).toBe(true));
    const put = calls.find((c) => c.method === "PUT")?.body as SavedLogFilter;
    expect(put).toMatchObject({ id: "api-errors", name: "API errors!", stack: "full", levels: ["error"], regex: "timeout", fields: ["user.id=42"], since: "15m" });
    const saved = within(await screen.findByRole("list", { name: "Saved filters" }));
    expect(await saved.findByRole("button", { name: "API errors!" })).toBeTruthy();

    // apply the other one
    fireEvent.click(saved.getByRole("button", { name: "Slow pages" }));
    await waitFor(() => expect(router.state.location.search).toContain("level=warn"));
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("slow");

    // delete asks first
    fireEvent.click(saved.getByRole("button", { name: "Delete the saved filter Slow pages" }));
    fireEvent.click(saved.getByRole("button", { name: "Keep" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(saved.getByRole("button", { name: "Delete the saved filter Slow pages" }));
    fireEvent.click(saved.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/log-filters/slow"))).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Saved filters" })).queryByRole("button", { name: "Slow pages" })).toBeNull());
  });

  it("shows why a filter wasn't saved", async () => {
    mockServer({ putError: "name is needed" });
    renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Save filter" }));
    fireEvent.change(screen.getByLabelText("Name of the filter"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("name is needed");
  });

  it("deletes the stored logs only after a confirmation, of the one service when one is chosen", async () => {
    mockServer();
    renderLogs("?service=api");
    await waitFor(async () => expect(options(await list())).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Clear…" }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText("api")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Clear…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/logs?service=api"))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("clears the whole stack when no single service is chosen", async () => {
    mockServer();
    renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Clear…" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("every service of this stack");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/logs"))).toBe(true));
  });

  it("can't save filters or clear in a sample workspace", async () => {
    mockServer({ sample: true });
    renderLogs();
    await waitFor(async () => expect(options(await list())).toHaveLength(3));
    expect((screen.getByRole("button", { name: "Save filter" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Clear…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says what is wrong when the server refuses the filters", async () => {
    mockServer({ logsError: "the pattern isn't valid: missing )" });
    renderLogs("?q=ab");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("the pattern isn't valid"));
  });

  it("tells a stack with no lines that nothing matches", async () => {
    mockServer({ entries: [] });
    renderLogs();
    const box = await list();
    await waitFor(() => expect(box.textContent).toContain("No stored lines match these filters."));
    expect(await screen.findByText("No errors so far.", {}, { timeout: 100 }).catch(() => null)).toBeNull(); // the sample group still shows
  });
});

describe("zooming out", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const at = Date.parse("2026-10-21T12:00:00Z");

  it("widens a stretch to three times as long around the same middle", () => {
    const q = zoomedOut({ since: iso(at), until: iso(at + 600_000), regex: "x" }, at + 3_600_000);
    expect(q).toEqual({ regex: "x", since: iso(at - 600_000), until: iso(at + 1_200_000) });
  });

  it("lets go of the end once it reaches the present, and widens a very short stretch to at least three minutes", () => {
    expect(zoomedOut({ since: iso(at), until: iso(at + 600_000) }, at + 700_000).until).toBeUndefined();
    const tiny = zoomedOut({ since: iso(at), until: iso(at + 1000) }, at + 3_600_000);
    expect(Date.parse(tiny.until ?? "") - Date.parse(tiny.since ?? "")).toBe(180_000);
  });

  it("goes back to any time when there is no stretch", () => {
    expect(zoomedOut({ since: "15m", regex: "x" })).toEqual({ regex: "x", since: undefined, until: undefined });
  });
});

describe("the page's address", () => {
  it("round-trips the filters", () => {
    const p = new URLSearchParams("service=api&service=vault%2Fopenbao&level=error&level=loud&field=a%3D1&q=x%7Cy&since=15m&until=2026-10-21T10%3A00%3A00Z&group=abc&junk=1");
    const q = queryOfParams(p);
    expect(q).toEqual({ services: ["api", "vault/openbao"], levels: ["error"], regex: "x|y", fields: ["a=1"], since: "15m", until: "2026-10-21T10:00:00Z", group: "abc" });
    const back = paramsOfQuery({ workspace: "demo", stack: "full" }, q);
    expect(back.get("workspace")).toBe("demo");
    expect(back.get("stack")).toBe("full");
    expect(queryOfParams(back)).toEqual(q);
    expect(paramsOfQuery({}, {}).toString()).toBe("");
  });

  it("makes a saved filter's id from its name", () => {
    expect(filterId("API errors!")).toBe("api-errors");
    expect(filterId("  Slow   pages  ")).toBe("slow-pages");
    expect(filterId("500s")).toBe("f-500s");
    expect(filterId("!!!")).toBe("filter");
    expect(filterId("x".repeat(60))).toHaveLength(40);
    expect(filterId("a".repeat(39) + " b")).toBe("a".repeat(39));
  });
});
