import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../../app/routes";
import type { FeatureDetail, FeatureList, FeaturePr, FeatureSummary } from "../../lib/features";
import { useUi } from "../../store/ui";

const summary = (over: Partial<FeatureSummary> = {}): FeatureSummary => ({
  workspace: "demo", name: "blob", branch: "plan/blob", title: "Move data", kind: "feature", feature: "acme", base: "dev", repos: ["demo-api", "demo-worker"],
  prs: 4, steps: 9, steps_done: 3, read_only: true, errors: 0, warnings: 0, ...over,
});

const pr = (over: Partial<FeaturePr>): FeaturePr => ({
  id: "a1", repo: "demo-api", slug: "x", title: "First", branch: "acme-a1-x", base: "acme", layers: [], steps: [], steps_done: 0, state: "planned", ...over,
});

const prs: FeaturePr[] = [
  pr({
    id: "a1", title: "Transfer bucket", state: "merged", layers: ["config"], steps_done: 1,
    steps: [{ title: "Config", layers: ["config"], status: "done", commit: "9c1e4a2" }],
    github: { number: 212, title: "Transfer bucket", head: "acme-a1-x", base: "acme", state: "merged", draft: false, url: "https://github.com/acme/demo-api/pull/212", additions: 356, deletions: 4, changed_files: 5, merged_at: "2026-11-01T10:00:00Z" },
    size: { files: 5, added: 356, deleted: 4 },
  }),
  pr({
    id: "a2", title: "blob.get", state: "changes", layers: ["handler", "config"], steps_done: 1, below: "a1",
    steps: [{ title: "Handler", layers: ["handler"], status: "done", commit: "5f0c8e7" }, { title: "Wiring", layers: ["config"], status: "doing" }],
    next: { text: "Fix the requested changes, then ask for review again", who: "claude" },
    github: { number: 214, title: "blob.get", head: "acme-a2-x", base: "acme", state: "open", draft: false, decision: "changes_requested", url: "https://github.com/acme/demo-api/pull/214", additions: 400, deletions: 150, changed_files: 12, checks: [{ name: "CI passed", state: "pass" }, { name: "CodeQL passed", state: "pending" }, { name: "Security passed", state: "fail" }] },
    local: { exists: true, pushed: true, commits: [{ hash: "abc1234", date: "2026-11-03T09:00:00Z", subject: "wire the handler" }] },
    size: { files: 12, added: 400, deleted: 150 }, over: ["lines", "files"],
  }),
  pr({ id: "a3", title: "Wire it", state: "planned", layers: ["handler"], below: "a2", steps: [{ title: "Do it", layers: ["handler"] }] }),
  pr({ id: "w1", repo: "demo-worker", title: "Archive columns", state: "waiting", after: ["a3"], layers: ["db"], steps: [{ title: "012.sql", layers: ["db"] }] }),
];

const detail = (over: Partial<FeatureDetail> = {}): FeatureDetail => ({
  ...summary(), budget: { files: 10, lines: 500 }, pr_list: prs,
  next_up: [{ pr: "a2", text: "Fix the requested changes, then ask for review again", who: "claude" }],
  pick: "a3", counts: { merged: 1, changes: 1, planned: 1, waiting: 1 },
  repo_layers: [
    { id: "demo-api", layers: [{ id: "config", name: "Config" }, { id: "handler", name: "Handlers" }] },
    { id: "demo-worker", layers: [{ id: "db", name: "DB / migrations" }] },
  ],
  problems: [], files: ["feature.yaml", "plan.md", "reviews/a1-claude.md"], issues: [], ...over,
});

type Call = { method: string; url: string };
const calls: Call[] = [];

type Server = { list?: FeatureList; detail?: FeatureDetail | "missing"; status?: string };

function mockServer(opts: Server = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const path = url.replace("/api/v1", "");
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces") return json([]);
      if (path === "/runs") return json([]);
      if (path === "/features") return json(opts.list ?? { features: [summary()], problems: [], no_plans_repo: [] });
      if (path.startsWith("/features/demo/blob/status")) return Promise.resolve(new Response(opts.status ?? "Move data   acme -> dev\n", { status: 200 }));
      if (path.startsWith("/features/demo/blob/files/")) {
        const file = decodeURIComponent(path.replace("/features/demo/blob/files/", ""));
        return json({ path: file, text: `contents of ${file}\n` });
      }
      if (path.startsWith("/features/demo/blob")) {
        if (opts.detail === "missing") return json({ message: "no such feature" }, 404);
        return json(opts.detail ?? detail());
      }
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
  calls.length = 0;
});

describe("the Features list", () => {
  it("lists each feature with its repos and how many steps are done", async () => {
    mockServer();
    renderAt("/features");
    const list = within(await screen.findByRole("list", { name: "Features" }));
    expect(list.getByText("Move data")).toBeTruthy();
    expect(list.getByText("demo-api, demo-worker")).toBeTruthy();
    expect(list.getByText("3 of 9 steps")).toBeTruthy();
    expect(list.getByText("4 PRs")).toBeTruthy();
    expect(list.getByRole("link").getAttribute("href")).toBe("/features/demo/blob");
  });

  it("says how many problems a feature.yaml has", async () => {
    mockServer({ list: { features: [summary({ errors: 2 })], problems: [], no_plans_repo: [] } });
    renderAt("/features");
    expect(await screen.findByText(/2 problems in feature.yaml/)).toBeTruthy();
  });

  it("asks for a plans repository when no workspace has one", async () => {
    mockServer({ list: { features: [], problems: [], no_plans_repo: ["demo"] } });
    renderAt("/features");
    expect(await screen.findByRole("heading", { name: "Add a plans repository" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open workspaces/ }).getAttribute("href")).toBe("/workspaces");
  });

  it("says there are no features yet when the repository is there but empty", async () => {
    mockServer({ list: { features: [], problems: [], no_plans_repo: [] } });
    renderAt("/features");
    expect(await screen.findByRole("heading", { name: "No features yet" })).toBeTruthy();
  });

  it("shows a plans repository it couldn't read, by workspace", async () => {
    mockServer({ list: { features: [], problems: [{ workspace: "demo", message: "the plans repository isn't there" }], no_plans_repo: [] } });
    renderAt("/features");
    const problems = within(await screen.findByRole("list", { name: "Problems" }));
    expect(problems.getByText(/the plans repository isn't there/)).toBeTruthy();
  });
});

describe("one feature", () => {
  it("shows the progress, what is next, and every repo's PRs against its layers", async () => {
    mockServer();
    renderAt("/features/demo/blob");
    expect(await screen.findByRole("heading", { level: 1, name: "Move data" })).toBeTruthy();
    expect(screen.getByText(/acme → dev · 2 repos · 4 PRs · plan plan\/blob \(read-only: no worktree\)/)).toBeTruthy();

    const progress = within(screen.getByRole("region", { name: "Progress" }));
    expect(progress.getByText("1 of 4 merged")).toBeTruthy();
    expect(progress.getByText("changes requested")).toBeTruthy();
    expect(progress.getByText(/lines so far/).textContent).toBe("910 lines so far");

    const next = within(screen.getByRole("region", { name: "Next up" }));
    expect(next.getByText("Fix the requested changes, then ask for review again")).toBeTruthy();

    const api = within(screen.getByRole("region", { name: "Repository demo-api" }));
    expect(api.getByText("3 PRs · 1 merged")).toBeTruthy();
    expect(api.getByText("a2 changes Handlers")).toBeTruthy();
    expect(api.getByText("a2 changes Config")).toBeTruthy();
    expect(api.getByText("a1 doesn’t change Handlers")).toBeTruthy();
    expect(api.getByText("over")).toBeTruthy();
    const worker = within(screen.getByRole("region", { name: "Repository demo-worker" }));
    expect(worker.getByText("after a3")).toBeTruthy();
  });

  it("opens the PR you click, with its steps, commits, checks and a link to GitHub", async () => {
    mockServer();
    renderAt("/features/demo/blob");
    // the first PR waiting on someone is open to begin with
    const panel = within(await screen.findByRole("complementary", { name: "PR a2" }));
    expect(panel.getByText("blob.get")).toBeTruthy();
    expect(panel.getByText(/Next · Claude/)).toBeTruthy();
    expect(panel.getByText("Wiring")).toBeTruthy();
    expect(panel.getByText("in progress")).toBeTruthy();
    expect(panel.getByText("5f0c8e7")).toBeTruthy();
    expect(panel.getByText("wire the handler")).toBeTruthy();
    expect(panel.getByText("550 / 500")).toBeTruthy();
    expect(panel.getByText(/Over budget: 550 lines \(budget 500\), 12 files \(budget 10\)/)).toBeTruthy();
    const link = panel.getByRole("link", { name: /Open on GitHub/ });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/demo-api/pull/214");
    expect(link.getAttribute("rel")).toContain("noopener");
    const checks = within(panel.getByRole("list", { name: "Checks" }));
    expect(checks.getByText("CI passed").parentElement?.textContent).toContain("passed");
    expect(checks.getByText("CodeQL passed").parentElement?.textContent).toContain("running");
    expect(checks.getByText("Security passed").parentElement?.textContent).toContain("failed");

    fireEvent.click(screen.getByRole("button", { name: /Archive columns/ }));
    const waiting = within(screen.getByRole("complementary", { name: "PR w1" }));
    expect(waiting.getByText(/Waits for a3 to be merged/)).toBeTruthy();
    expect(waiting.queryByRole("link", { name: /Open on GitHub/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Wire it/ }));
    expect(within(screen.getByRole("complementary", { name: "PR a3" })).getByText(/No branch yet/)).toBeTruthy();
  });

  it("hands the next PR to Claude with a prompt on the clipboard", async () => {
    mockServer();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderAt("/features/demo/blob");
    fireEvent.click(await screen.findByRole("button", { name: "Next for Claude" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toContain('PR a3 ("Wire it", repo demo-api)');
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("can't hand over a PR when none is waiting to be started", async () => {
    mockServer({ detail: detail({ pick: undefined }) });
    renderAt("/features/demo/blob");
    const button = (await screen.findByRole("button", { name: "Next for Claude" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("asks GitHub again when you press Refresh", async () => {
    mockServer();
    renderAt("/features/demo/blob");
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/features/demo/blob?refresh=1"))).toBe(true));
  });

  it("lists what happened, newest first", async () => {
    mockServer();
    renderAt("/features/demo/blob");
    fireEvent.click(await screen.findByRole("tab", { name: /Activity/ }));
    const items = within(await screen.findByRole("list", { name: "Activity" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("wire the handler");
    expect(items[0].textContent).toContain("git");
    expect(items[1].textContent).toContain("Pull request merged: Transfer bucket");
    expect(items[1].textContent).toContain("GitHub");
  });

  it("reads a file of the plan", async () => {
    mockServer();
    renderAt("/features/demo/blob");
    fireEvent.click(await screen.findByRole("tab", { name: /Files/ }));
    // plan.md opens first
    expect(await screen.findByText(/contents of plan\.md/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "reviews/a1-claude.md" }));
    expect(await screen.findByText(/contents of reviews\/a1-claude\.md/)).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith("/files/reviews/a1-claude.md"))).toBe(true);
    expect(screen.getByText("Read from git (no worktree)")).toBeTruthy();
  });

  it("shows what devdeck feature status prints", async () => {
    mockServer({ status: "Move data   acme -> dev\nREPO  PR\n" });
    renderAt("/features/demo/blob");
    fireEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
    expect(await screen.findByText("devdeck feature status -w demo blob")).toBeTruthy();
    expect((await screen.findByLabelText("Terminal view")).textContent).toContain("REPO  PR");
  });

  it("shows problems in feature.yaml and what couldn't be read, and keeps the rest", async () => {
    mockServer({
      detail: detail({
        issues: [{ file: "feature.yaml", line: 7, severity: "error", message: "The repo nope isn't in this feature's repos." }],
        problems: ["demo-worker: the folder isn't on this machine, so only the GitHub state is shown"],
      }),
    });
    renderAt("/features/demo/blob");
    expect(await screen.findByText(/isn't in this feature's repos/)).toBeTruthy();
    expect(screen.getByText(/demo-worker: the folder isn't on this machine/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Progress" })).toBeTruthy();
  });

  it("says so when feature.yaml is too broken to show any PRs", async () => {
    mockServer({ detail: detail({ pr_list: [], next_up: [], counts: {}, issues: [{ file: "feature.yaml", line: 1, severity: "error", message: "The file is empty." }] }) });
    renderAt("/features/demo/blob");
    expect(await screen.findByText(/feature.yaml has errors, so its PRs can’t be shown/)).toBeTruthy();
  });

  it("says when there is no such feature", async () => {
    mockServer({ detail: "missing" });
    renderAt("/features/demo/blob");
    expect(await screen.findByRole("heading", { name: "No such feature" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Features/ }).getAttribute("href")).toBe("/features");
  });
});
