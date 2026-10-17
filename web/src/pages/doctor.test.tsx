import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { DoctorReport, WorkspaceSummary } from "../lib/types";
import { useUi } from "../store/ui";

const demo: WorkspaceSummary = {
  id: "demo",
  name: "demo",
  source: "local",
  root: "~/code",
  repos: 2,
  stacks: 2,
  flows: 0,
  errors: 0,
  warnings: 0,
};

const report: DoctorReport = {
  workspace: "demo",
  passed: 2,
  warnings: 1,
  failures: 2,
  checked_at: "2026-10-17T12:00:00Z",
  checks: [
    { id: "tool:git", group: "tools", title: "Git 2.30 or newer", status: "ok", detail: "version 2.46" },
    {
      id: "tool:go",
      group: "tools",
      title: "Go 1.22 or newer",
      status: "fail",
      detail: "go not found on PATH",
      fix: ["winget install --id GoLang.Go -e", "https://go.dev/dl/"],
    },
    { id: "docker:engine", group: "tools", title: "Docker is running", status: "fail", fix: ["Start Docker Desktop, then check again."] },
    { id: "repo:api", group: "repos", title: "Repo api", status: "ok", detail: "/code/api" },
    {
      id: "stack:full:api:env",
      group: "stacks",
      stack: "full",
      title: "api: .env",
      status: "warn",
      detail: ".env is missing.",
    },
  ],
};

const urls: string[] = [];

function mockServer(opts: { list?: WorkspaceSummary[]; doctorError?: { status: number; message: string } } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      if (url === "/api/v1/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (url === "/api/v1/workspaces") return Promise.resolve(Response.json(opts.list ?? [demo]));
      if (url === "/api/v1/workspaces/demo") {
        return Promise.resolve(
          Response.json({ ...demo, workspace: { name: "demo", root: "~/code" }, stacks: [{ name: "full" }, { name: "api-only" }], flows: [], issues: [] }),
        );
      }
      if (url.startsWith("/api/v1/doctor")) {
        if (opts.doctorError) return Promise.resolve(Response.json({ message: opts.doctorError.message }, { status: opts.doctorError.status }));
        const stack = new URL(url, "http://x").searchParams.get("stack");
        return Promise.resolve(Response.json(stack ? { ...report, stack, checks: report.checks.slice(0, 2) } : report));
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
  urls.length = 0;
});

describe("doctor page", () => {
  it("asks for a workspace first when there is none", async () => {
    mockServer({ list: [] });
    renderAt("/doctor");
    expect(await screen.findByRole("heading", { name: "Add a workspace first" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Add workspace/ }).getAttribute("href")).toBe("/workspaces");
    expect(urls.some((u) => u.startsWith("/api/v1/doctor"))).toBe(false);
  });

  it("checks the first workspace and groups what it found", async () => {
    mockServer();
    renderAt("/doctor");

    const tools = within(await screen.findByRole("region", { name: "Tools" }));
    expect(tools.getByText("Go 1.22 or newer")).toBeTruthy();
    expect(tools.getByText("go not found on PATH")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Repos" })).getByText("Repo api")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Stacks" })).getByText("api: .env")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Git" })).toBeNull(); // no checks in that group

    // each count is announced with its own title
    expect(screen.getByTitle("2 failed")).toBeTruthy();
    expect(screen.getByTitle("1 warning")).toBeTruthy();
    expect(screen.getByTitle("2 passed")).toBeTruthy();
    expect(urls).toContain("/api/v1/doctor?workspace=demo");
  });

  it("shows how to fix a problem: a command to copy, a link and plain advice", async () => {
    mockServer();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderAt("/doctor");

    const copy = await screen.findByRole("button", { name: "Copy: winget install --id GoLang.Go -e" });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("winget install --id GoLang.Go -e");

    expect(screen.getByRole("link", { name: "https://go.dev/dl/" }).getAttribute("href")).toBe("https://go.dev/dl/");
    expect(screen.getByText("Start Docker Desktop, then check again.")).toBeTruthy();
    // advice is text, so there is nothing to copy
    expect(screen.queryByRole("button", { name: /Copy: Start Docker/ })).toBeNull();
  });

  it("checks one stack when it is chosen", async () => {
    mockServer();
    renderAt("/doctor");
    await screen.findByRole("region", { name: "Tools" });

    fireEvent.change(screen.getByLabelText("Stack"), { target: { value: "api-only" } });
    await waitFor(() => expect(urls).toContain("/api/v1/doctor?workspace=demo&stack=api-only"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Repos" })).toBeNull());
  });

  it("runs the check again on request", async () => {
    mockServer();
    renderAt("/doctor");
    await screen.findByRole("region", { name: "Tools" });
    const before = urls.filter((u) => u.startsWith("/api/v1/doctor")).length;

    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(urls.filter((u) => u.startsWith("/api/v1/doctor")).length).toBe(before + 1));
  });

  it("says why it could not check", async () => {
    mockServer({ doctorError: { status: 422, message: "this workspace has errors: fix them first" } });
    renderAt("/doctor");
    expect((await screen.findByRole("alert")).textContent).toBe("this workspace has errors: fix them first");
    expect(screen.queryByRole("region", { name: "Tools" })).toBeNull();
  });
});
