import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import { ago, callResult, type ClaudeArea, type ClaudeCall, type ClaudeState } from "../lib/claude";
import { useUi } from "../store/ui";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.split("?")[0].endsWith(suffix));

const area = (id: string, label: string, on: boolean, over: Partial<ClaudeArea> = {}): ClaudeArea => ({
  id,
  label,
  description: `${label}: what Claude may read`,
  on,
  default: on,
  ...over,
});

const areas = (): ClaudeArea[] => [
  area("workspaces", "Workspaces and stacks", true),
  area("logs", "Logs", true),
  area("git", "Git accounts", true),
  area("hosts", "Remote hosts", false),
  area("ui", "What’s on your screen", true),
];

const call = (id: number, over: Partial<ClaudeCall> = {}): ClaudeCall => ({
  id,
  at: "2026-10-30T09:15:02Z",
  tool: "query_logs",
  method: "GET",
  path: "/api/v1/workspaces/demo/stacks/full/logs",
  query: "level=error&limit=5",
  status: 200,
  bytes: 2048,
  ...over,
});

type Server = { state?: Partial<ClaudeState>; calls?: ClaudeCall[]; stateError?: boolean; saveError?: string };

function mockServer(opts: Server = {}) {
  let state: ClaudeState = { areas: areas(), calls: (opts.calls ?? []).length, ...opts.state };
  let list = opts.calls ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces" || path === "/runs") return json([]);
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/claude" && method === "GET") return opts.stateError ? json({ message: "the settings file is broken" }, 500) : json(state);
      if (path === "/claude/access" && method === "PUT") {
        if (opts.saveError) return json({ message: opts.saveError }, 500);
        state = { ...state, areas: state.areas.map((a) => (a.id in body ? { ...a, on: body[a.id] } : a)) };
        return json(state);
      }
      if (path === "/claude/calls" && method === "GET") return json(list);
      if (path === "/claude/calls" && method === "DELETE") {
        list = [];
        state = { ...state, calls: 0, last_call: undefined };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ["/claude"] });
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

describe("the Claude access page", () => {
  it("shows each area as a switch with a word, and says Claude hasn't asked yet", async () => {
    mockServer();
    renderPage();
    const sw = await screen.findByRole("switch", { name: "Remote hosts" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Logs" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByText("On")).toHaveLength(4);
    expect(screen.getAllByText("Off")).toHaveLength(1);
    expect(screen.getByText("Claude hasn’t asked yet")).toBeTruthy();
    expect(screen.getByText("Claude hasn’t asked for anything yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear list" })).toBeNull();
  });

  it("switches one area and leaves the others as they are", async () => {
    mockServer();
    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Remote hosts" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Remote hosts" }).getAttribute("aria-checked")).toBe("true"));
    expect(sent("PUT", "/claude/access")).toHaveLength(1);
    expect(sent("PUT", "/claude/access")[0].body).toEqual({ hosts: true });
    expect(screen.getByRole("switch", { name: "Logs" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("switch", { name: "Logs" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Logs" }).getAttribute("aria-checked")).toBe("false"));
    expect(sent("PUT", "/claude/access")[1].body).toEqual({ logs: false });
  });

  it("says so when a change wasn't saved, and keeps the switch where it was", async () => {
    mockServer({ saveError: "the settings couldn’t be saved" });
    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Remote hosts" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That change wasn’t saved: the settings couldn’t be saved");
    expect(screen.getByRole("switch", { name: "Remote hosts" }).getAttribute("aria-checked")).toBe("false");
  });

  it("says when the settings can't be read", async () => {
    mockServer({ stateError: true });
    renderPage();
    expect((await screen.findByText(/The settings couldn’t be read: the settings file is broken/)).textContent).toBeTruthy();
  });

  it("lists what Claude asked for, with a word for the result", async () => {
    mockServer({
      state: { last_call: new Date(Date.now() - 12_000).toISOString(), calls: 3 },
      calls: [
        call(3, { tool: "", method: "POST", path: "/api/v1/workspaces", query: "", status: 403, bytes: 60 }),
        call(2, { tool: "host_info", path: "/api/v1/hosts/demo/dev/info", query: "", status: 409, bytes: 90 }),
        call(1),
      ],
    });
    renderPage();
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("query_logs")).toBeTruthy();
    expect(table.getByText("/api/v1/workspaces/demo/stacks/full/logs?level=error&limit=5")).toBeTruthy();
    expect(table.getByText("Answered")).toBeTruthy();
    expect(table.getByText("Refused")).toBeTruthy();
    expect(table.getByText("Not ready")).toBeTruthy();
    expect(table.getByText("2,048 B")).toBeTruthy();
    expect(screen.getByText(/Claude last asked 1\d s ago/)).toBeTruthy();
  });

  it("clears the list only after a second click", async () => {
    mockServer({ state: { calls: 1 }, calls: [call(1)] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Clear list" }));
    expect(sent("DELETE", "/claude/calls")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Clear the whole list?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(sent("DELETE", "/claude/calls")).toHaveLength(1));
    expect(await screen.findByText("Claude hasn’t asked for anything yet.")).toBeTruthy();
  });

  it("offers the command that connects Claude Code, and copies it", async () => {
    mockServer();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderPage();
    expect((await screen.findByText("devdeck mcp install")).tagName).toBe("CODE");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("devdeck mcp install");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("reports the page it is on to the server", async () => {
    mockServer();
    renderPage();
    await screen.findByRole("switch", { name: "Logs" });
    await waitFor(() => expect(sent("PUT", "/ui/state").length).toBeGreaterThan(0));
    expect(sent("PUT", "/ui/state")[0].body).toEqual({ route: "/claude", label: "Claude access" });
  });
});

describe("claude helpers", () => {
  it("names a result in a word", () => {
    expect(callResult(200)).toBe("Answered");
    expect(callResult(204)).toBe("Answered");
    expect(callResult(403)).toBe("Refused");
    expect(callResult(409)).toBe("Not ready");
    expect(callResult(500)).toBe("Error");
    expect(callResult(404)).toBe("Error");
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-10-30T10:00:00Z");
    const at = (s: number) => new Date(now - s * 1000).toISOString();
    expect(ago(at(0), now)).toBe("0 s ago");
    expect(ago(at(12), now)).toBe("12 s ago");
    expect(ago(at(59), now)).toBe("59 s ago");
    expect(ago(at(60), now)).toBe("1 min ago");
    expect(ago(at(3599), now)).toBe("59 min ago");
    expect(ago(at(7200), now)).toBe("2 h ago");
    expect(ago(at(3 * 86400), now)).toBe("3 d ago");
    expect(ago(at(-30), now)).toBe("0 s ago"); // a clock a little ahead is not "in the future"
  });
});
