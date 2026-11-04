import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../../app/routes";
import { describeStart, type FeatureDetail, type FeatureList, type FeaturePr, type FeatureSummary, type ReviewRun, type ReviewStarted, type ToolInfo } from "../../lib/features";
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
    local: { exists: true, pushed: true, head: "aaaa1111", commits: [{ hash: "abc1234", date: "2026-11-03T09:00:00Z", subject: "wire the handler" }] },
    size: { files: 12, added: 400, deleted: 150 }, over: ["lines", "files"],
    reviews: {
      tests: { status: "fail", summary: "2 problems, the first at internal/x.go:12", ran: "2026-11-04T09:00:00Z", commit: "aaaa1111", stale: false, file: "reviews/a2-tests.md" },
      lint: { status: "pass", summary: "No problems found", ran: "2026-11-04T08:00:00Z", commit: "old00000", stale: true, file: "reviews/a2-lint.md" },
    },
  }),
  pr({ id: "a3", title: "Wire it", state: "planned", layers: ["handler"], below: "a2", steps: [{ title: "Do it", layers: ["handler"] }] }),
  pr({ id: "w1", repo: "demo-worker", title: "Archive columns", state: "waiting", after: ["a3"], layers: ["db"], steps: [{ title: "012.sql", layers: ["db"] }] }),
];

const tool = (id: string, name: string, usable = true): ToolInfo => ({
  id, name, about: `${name} on the branch`, usable,
  programs: [{ name: id, found: usable, hint: usable ? undefined : `Install ${name}: https://example.com/${id}` }],
});
const tools: ToolInfo[] = [tool("tests", "Tests"), tool("lint", "Lint"), tool("semgrep", "Semgrep", false), tool("gitleaks", "Gitleaks"), tool("trivy", "Trivy"), tool("deps", "Dependencies")];

const detail = (over: Partial<FeatureDetail> = {}): FeatureDetail => ({
  ...summary(), budget: { files: 10, lines: 500 }, pr_list: prs,
  next_up: [{ pr: "a2", text: "Fix the requested changes, then ask for review again", who: "claude" }],
  pick: "a3", counts: { merged: 1, changes: 1, planned: 1, waiting: 1 },
  repo_layers: [
    { id: "demo-api", layers: [{ id: "config", name: "Config" }, { id: "handler", name: "Handlers" }] },
    { id: "demo-worker", layers: [{ id: "db", name: "DB / migrations" }] },
  ],
  problems: [], files: ["feature.yaml", "plan.md", "reviews/a1-claude.md", "reviews/a2-tests.md"], tools, issues: [], ...over,
});

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];

type Server = {
  list?: FeatureList;
  detail?: FeatureDetail | "missing";
  status?: string;
  runs?: ReviewRun[];
  /** What starting reviews answers with: a body, or a refusal. */
  start?: ReviewStarted | { error: string; status: number };
};

const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({
  id: "run-1", workspace: "demo", feature: "blob", pr: "a2", repo: "demo-api", tool: "tests", state: "running", queued: "2026-11-04T10:00:00Z", ...over,
});

function mockServer(opts: Server = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const path = url.replace("/api/v1", "");
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces") return json([]);
      if (path === "/runs") return json([]);
      if (path === "/features") return json(opts.list ?? { features: [summary()], problems: [], no_plans_repo: [] });
      if (path === "/features/demo/blob/reviews" && method === "GET") return json({ runs: opts.runs ?? [] });
      if (path === "/features/demo/blob/reviews" && method === "POST") {
        const s = opts.start ?? { started: [run()], skipped: [] };
        return "error" in s ? json({ message: s.error }, s.status) : json(s, 202);
      }
      if (path.startsWith("/features/demo/blob/reviews/") && path.endsWith("/cancel")) return Promise.resolve(new Response(null, { status: 204 }));
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

const started = () => calls.find((c) => c.method === "POST" && c.url.endsWith("/features/demo/blob/reviews"));

async function reviewPanel() {
  const panel = within(await screen.findByRole("complementary", { name: "PR a2" }));
  return within(panel.getByRole("region", { name: "Code review on this branch" }));
}

// The review tests need a plan that is checked out, so results can be saved.
const writable = { detail: detail({ read_only: false }) };

describe("code review on a branch", () => {
  it("shows each tool with what it said last, and what each can do", async () => {
    mockServer(writable);
    renderAt("/features/demo/blob");
    const tools = within((await reviewPanel()).getByRole("list", { name: "Review tools" }));

    expect(tools.getByText(/2 problems, the first at internal\/x\.go:12/)).toBeTruthy();
    expect(tools.getByRole("button", { name: "Re-run Tests" })).toBeTruthy();
    expect(tools.getByRole("button", { name: "reviews/a2-tests.md" })).toBeTruthy();
    // it ran on an older commit
    expect(tools.getByText(/older commit/)).toBeTruthy();
    // never run
    expect(tools.getByRole("button", { name: "Run Gitleaks" })).toBeTruthy();
    // not installed: no button, and how to get it
    expect(tools.getByText(/Not installed\. Install Semgrep: https:\/\/example\.com\/semgrep/)).toBeTruthy();
    expect(tools.queryByRole("button", { name: /Semgrep/ })).toBeNull();
  });

  it("runs one tool on this branch", async () => {
    mockServer(writable);
    renderAt("/features/demo/blob");
    const section = await reviewPanel();
    fireEvent.click(section.getByRole("button", { name: "Run Gitleaks" }));
    await waitFor(() => expect(started()).toBeTruthy());
    expect(started()?.body).toEqual({ pr: "a2", tool: "gitleaks" });
    expect(await screen.findByText("Started 1 run.")).toBeTruthy();
  });

  it("runs every tool on this branch, or on every branch", async () => {
    mockServer(writable);
    renderAt("/features/demo/blob");
    fireEvent.click((await reviewPanel()).getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(started()?.body).toEqual({ pr: "a2" }));

    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Review all changed branches" }));
    await waitFor(() => expect(started()).toBeTruthy());
    expect(started()?.body).toEqual({});
  });

  it("says what was skipped, and why a refusal happened", async () => {
    mockServer({ ...writable, start: { started: [run()], skipped: [{ pr: "a2", tool: "semgrep", reason: "already running, or waiting its turn" }] } });
    renderAt("/features/demo/blob");
    fireEvent.click((await reviewPanel()).getByRole("button", { name: "Run all" }));
    expect(await screen.findByText("Started 1 run. Skipped 1: a2 semgrep: already running, or waiting its turn.")).toBeTruthy();

    cleanup();
    calls.length = 0;
    mockServer({ ...writable, start: { error: "PR a2 has no branch yet, so there is nothing to review", status: 409 } });
    renderAt("/features/demo/blob");
    fireEvent.click((await reviewPanel()).getByRole("button", { name: "Run all" }));
    expect(await screen.findByText("PR a2 has no branch yet, so there is nothing to review")).toBeTruthy();
  });

  it("can't run anything for a plan that isn't checked out", async () => {
    mockServer({ detail: detail({ read_only: true }) });
    renderAt("/features/demo/blob");
    const section = await reviewPanel();
    expect(section.getByText(/This plan isn’t checked out/)).toBeTruthy();
    expect((section.getByRole("button", { name: "Run all" }) as HTMLButtonElement).disabled).toBe(true);
    expect((section.getByRole("button", { name: "Run Gitleaks" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Review all changed branches" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("follows a run that is waiting or running, and can cancel it", async () => {
    mockServer({ ...writable, runs: [run({ id: "run-1", tool: "tests", state: "running" }), run({ id: "run-2", tool: "lint", state: "queued" })] });
    renderAt("/features/demo/blob");
    const section = await reviewPanel();
    expect(await section.findByText("Running on the branch…")).toBeTruthy();
    expect(section.getByText("Waiting for its turn…")).toBeTruthy();
    // a tool that is running can't be started again; it can be cancelled
    expect(section.queryByRole("button", { name: "Re-run Tests" })).toBeNull();
    const cancel = section.getAllByRole("button", { name: "Cancel" });
    expect(cancel).toHaveLength(2);
    fireEvent.click(cancel[0]);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/reviews/run-1/cancel"))).toBe(true));
  });

  it("opens a result file in the Files tab", async () => {
    mockServer(writable);
    renderAt("/features/demo/blob");
    fireEvent.click((await reviewPanel()).getByRole("button", { name: "reviews/a2-tests.md" }));
    expect(await screen.findByText(/contents of reviews\/a2-tests\.md/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Files/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("has no review section for a PR that is merged", async () => {
    mockServer(writable);
    renderAt("/features/demo/blob");
    await reviewPanel();
    fireEvent.click(screen.getByRole("button", { name: /Transfer bucket/ }));
    const merged = within(screen.getByRole("complementary", { name: "PR a1" }));
    expect(merged.queryByRole("region", { name: "Code review on this branch" })).toBeNull();
  });

  it("lists every PR against every tool on the Reviews and checks tab", async () => {
    mockServer(writable);
    renderAt("/features/demo/blob");
    fireEvent.click(await screen.findByRole("tab", { name: "Reviews and checks" }));
    const table = within(await screen.findByRole("table", { name: "Reviews of every PR" }));
    const row = within(table.getByText("a2").closest("tr") as HTMLElement);
    expect(row.getByRole("button", { name: /Failed/ })).toBeTruthy();
    expect(row.getByRole("button", { name: /Passed/ })).toBeTruthy();
    expect(row.getByText("1 of 3")).toBeTruthy();

    const tools = within(screen.getByRole("region", { name: "Review tools" }));
    expect(tools.getByText("Not installed")).toBeTruthy();
    expect(tools.getByText(/Missing: semgrep\. Install Semgrep/)).toBeTruthy();

    fireEvent.click(row.getByRole("button", { name: /Failed/ }));
    expect(await screen.findByText(/contents of reviews\/a2-tests\.md/)).toBeTruthy();
  });

  it("describes what was started", () => {
    expect(describeStart({ started: [run(), run()], skipped: [] })).toBe("Started 2 runs.");
    expect(describeStart({ started: [], skipped: [{ pr: "a1", reason: "the branch isn't in the repository" }] })).toBe("Started 0 runs. Skipped 1: a1: the branch isn't in the repository.");
  });
});
