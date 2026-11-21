import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunStatus, ServiceStatus } from "../../lib/types";
import { greeting, NeonHome } from "./NeonHome";

afterEach(cleanup);

const NOW = Date.parse("2026-11-22T19:30:00");

const svc = (id: string, state: ServiceStatus["state"], port?: number, last_error?: string): ServiceStatus => ({
  id,
  kind: "command",
  state,
  port,
  restarts: 0,
  last_error,
});

const run = (stack: string, services: ServiceStatus[], state: RunStatus["state"] = "running", workspace = "acme"): RunStatus => ({
  workspace,
  stack,
  state,
  started_at: new Date(NOW - 65_000).toISOString(),
  services,
});

function renderHome(runs: RunStatus[], over: Partial<Parameters<typeof NeonHome>[0]> = {}) {
  const props = {
    runs,
    now: NOW,
    live: true,
    onRestart: vi.fn(),
    onRestartFailed: vi.fn(),
    restartBusy: false,
    ...over,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <NeonHome {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

describe("greeting", () => {
  it.each([
    [3, "Good evening"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [17, "Good afternoon"],
    [18, "Good evening"],
    [23, "Good evening"],
  ])("at %i:00 says %s", (hour, want) => {
    expect(greeting(new Date(2026, 10, 22, hour))).toBe(want);
  });
});

describe("Neon Home", () => {
  const healthy = [
    run("demo-api", [svc("api", "ready", 8080), svc("web", "ready", 8081)]),
    run("docs", [svc("site", "ready", 8090)]),
  ];

  it("greets, names the workspace and the date, and sums up", () => {
    renderHome(healthy);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good evening.");
    expect(screen.getByText(/Workspace · acme · SUN 22 NOV/)).toBeTruthy();
    expect(screen.getByText("2 stacks up, all ready.")).toBeTruthy();
  });

  it("shows the status strip from what devdeck knows", () => {
    renderHome(healthy, { live: false });
    const strip = document.querySelector('dl[aria-label="Status"]')!;
    const pairs = [...strip.querySelectorAll("div")].map((d) => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent, d.querySelector("dd")!.getAttribute("data-tone")]);
    expect(pairs).toEqual([
      ["Live", "Reconnecting", "warn"],
      ["Stacks", "02", "plain"],
      ["Services", "3/3 ready", "ok"],
      ["Problems", "00", "ok"],
    ]);
  });

  it("draws one card per stack with its facts and its services as a rail", () => {
    renderHome(healthy);
    const card = screen.getByRole("article", { name: "demo-api in acme" });
    expect(within(card).getByText("[1] // acme")).toBeTruthy();
    expect(within(card).getByText("Running")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "demo-api" }).getAttribute("href")).toBe("/stacks?workspace=acme");
    expect(within(card).getByText(":8080 :8081")).toBeTruthy();
    expect(within(card).getByText("1m 5s")).toBeTruthy();
    expect(within(card).getByRole("list").getAttribute("aria-label")).toBe("All 2 stages done");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Services that need a look" })).toBeNull();
  });

  it("puts a failed service in Needs a look, marks its stack, and restarts it", () => {
    const runs = [run("jobs", [svc("queue", "ready", 9000), svc("worker", "failed", undefined, "exit 1")], "degraded"), ...healthy];
    const props = renderHome(runs);
    expect(screen.getByText("3 stacks up, 1 needs a look.")).toBeTruthy();
    const card = screen.getByRole("article", { name: "jobs in acme" });
    expect(within(card).getByText("Degraded")).toBeTruthy();
    expect(within(card).getByRole("list").getAttribute("aria-label")).toBe("1 of 2 stages done, stuck at: worker");

    const panel = screen.getByRole("region", { name: "Services that need a look" });
    fireEvent.click(within(panel).getByRole("button", { name: "Restart worker in jobs" }));
    expect(props.onRestart).toHaveBeenCalledWith(runs[0], "worker");

    fireEvent.click(screen.getByRole("button", { name: "Restart failed" }));
    expect(props.onRestartFailed).toHaveBeenCalled();
  });

  it("counts several workspaces instead of naming one, and shows more than three ports as +n", () => {
    renderHome([run("big", [svc("a", "ready", 1), svc("b", "ready", 2), svc("c", "ready", 3), svc("d", "ready", 4)]), run("other", [svc("x", "ready")], "running", "beta")]);
    expect(screen.getByText(/Workspace · 2 workspaces ·/)).toBeTruthy();
    expect(screen.getByText(":1 :2 :3 +1")).toBeTruthy();
  });
});
