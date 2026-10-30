import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { GitRepo } from "../lib/git";
import { useUi } from "../store/ui";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const ops = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/git/repos/op"));

type Server = {
  repos: GitRepo[];
  /** Answers a git operation: an error makes it fail; otherwise it succeeds with the output. */
  op?: (body: { repo: string; op: string }) => { error?: string; output?: string };
};

function mockServer(opts: Server) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "");
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces" || path === "/runs") return json([]);
      if (path === "/git/repos" && method === "GET") return json(opts.repos);
      if (path === "/git/repos/op" && method === "POST") {
        const b = body as { repo: string; op: string };
        const answer = opts.op?.(b) ?? { output: "" };
        if (answer.error) return json({ message: answer.error }, 502);
        return json({ output: answer.output ?? "", repo: opts.repos.find((r) => r.repo === b.repo) });
      }
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderRepos() {
  const router = createMemoryRouter(routes, { initialEntries: ["/repos"] });
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

const work = (over: Partial<NonNullable<GitRepo["work"]>> = {}) => ({ branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, changed: 0, ...over });
const cmds = (name: string) => ({
  fetch: `git -C "C:/code/${name}" fetch --prune origin`,
  pull: `git -C "C:/code/${name}" pull --ff-only`,
  push: `git -C "C:/code/${name}" push`,
});
const repo = (over: Partial<GitRepo>): GitRepo => ({
  workspace: "acme",
  workspace_name: "acme",
  repo: "api",
  path: "C:/code/api",
  remote: "https://github.com/acme/api.git",
  connection: "office",
  expected: { name: "Me Office", email: "me@office.example" },
  actual: { name: "Me Office", email: "me@office.example" },
  state: "ok",
  ...over,
});
const cloneOf = (n: string) => ({ remote: `https://github.com/acme/${n}.git`, command: `git clone -- "https://github.com/acme/${n}.git" "C:/code/${n}"` });

describe("the Repositories page, where each repository stands", () => {
  it("shows the branch, ahead and behind, and the changed files, and which actions can run", async () => {
    mockServer({
      repos: [
        repo({ repo: "level", work: work(), commands: { fetch: cmds("level").fetch, pull: cmds("level").pull } }),
        repo({ repo: "busy", work: work({ branch: "feat/x", ahead: 2, behind: 3, changed: 4 }), commands: cmds("busy") }),
        repo({ repo: "fresh", work: work({ branch: "topic", upstream: "" }), commands: { fetch: cmds("fresh").fetch, push: cmds("fresh").push } }),
        repo({ repo: "loose", work: work({ branch: "", detached: true, upstream: "" }), commands: { fetch: cmds("loose").fetch } }),
      ],
    });
    renderRepos();
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("up to date")).toBeTruthy();
    expect(table.getByText("feat/x")).toBeTruthy();
    expect(table.getByText("2 ahead, 3 behind")).toBeTruthy();
    expect(table.getByText(/4 changed/)).toBeTruthy();
    expect(table.getAllByText("no upstream")).toHaveLength(2);
    expect(table.getByText("detached HEAD")).toBeTruthy();

    const enabled = (name: string) => !(table.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(enabled("Pull level")).toBe(false); // nothing to pull
    expect(enabled("Push level")).toBe(false); // nothing to push
    expect(enabled("Pull busy") && enabled("Push busy") && enabled("Fetch busy")).toBe(true);
    expect(enabled("Push fresh")).toBe(true); // a new branch can be pushed
    expect(enabled("Pull fresh")).toBe(false);
    expect(enabled("Push loose")).toBe(false);
    // the exact command is the button's tooltip
    expect(table.getByRole("button", { name: "Pull busy" }).getAttribute("title")).toBe(cmds("busy").pull);
  });
});

describe("the Repositories page, one repository", () => {
  it("fetches at once, with no confirmation", async () => {
    mockServer({ repos: [repo({ work: work(), commands: cmds("api") })], op: () => ({ output: "From origin" }) });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Fetch api" }));
    await waitFor(() => expect(ops()).toHaveLength(1));
    expect(ops()[0].body).toEqual({ workspace: "acme", repo: "api", op: "fetch", confirm: false });
    expect(await screen.findByText("From origin")).toBeTruthy();
  });

  it("shows the command and asks before it pulls, and lets you copy it instead", async () => {
    mockServer({ repos: [repo({ work: work({ behind: 2 }), commands: cmds("api") })], op: () => ({ output: "Fast-forward" }) });
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Pull api" }));
    const dialog = within(screen.getByRole("alertdialog", { name: "Confirm pull api" }));
    expect(dialog.getByText(cmds("api").pull)).toBeTruthy();
    expect(ops()).toHaveLength(0); // nothing yet

    fireEvent.click(dialog.getByRole("button", { name: "Copy command" }));
    expect(write).toHaveBeenCalledWith(cmds("api").pull);
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(ops()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Pull api" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Run" }));
    await waitFor(() => expect(ops()).toHaveLength(1));
    expect(ops()[0].body).toEqual({ workspace: "acme", repo: "api", op: "pull", confirm: true });
    expect(await screen.findByText("Fast-forward")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says why a push failed", async () => {
    mockServer({ repos: [repo({ work: work({ ahead: 1 }), commands: cmds("api") })], op: () => ({ error: "git push failed: rejected, the remote has newer commits" }) });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Push api" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Confirm push api" })).getByRole("button", { name: "Run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("rejected, the remote has newer commits");
  });

  it("offers to clone a repository whose folder is missing", async () => {
    const clone = cloneOf("old");
    mockServer({ repos: [repo({ repo: "old", state: "missing", clone })], op: () => ({ output: "Cloning into" }) });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Clone old" }));
    expect(within(screen.getByRole("alertdialog", { name: "Confirm clone old" })).getByText(clone.command)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Run" }));
    await waitFor(() => expect(ops()).toHaveLength(1));
    expect(ops()[0].body).toMatchObject({ repo: "old", op: "clone", confirm: true });
  });
});

describe("the Repositories page, all repositories", () => {
  it("fetches all, skips the missing one, and lists the repositories that failed", async () => {
    mockServer({
      repos: [repo({ repo: "a", work: work(), commands: cmds("a") }), repo({ repo: "b", work: work(), commands: cmds("b") }), repo({ repo: "c", state: "missing" })],
      op: (b) => (b.repo === "b" ? { error: "git fetch failed: could not resolve host" } : {}),
    });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Fetch all" }));
    await waitFor(() => expect(screen.getByText("Fetched 1 of 2.")).toBeTruthy());
    expect(ops().map((c) => (c.body as { repo: string }).repo)).toEqual(["a", "b"]);
    expect(screen.getByText(/could not resolve host/).closest("li")?.textContent).toContain("b");
  });

  it("pulls all, but only the repositories that are behind and have no changes, after one confirmation", async () => {
    mockServer({
      repos: [
        repo({ repo: "behind", work: work({ behind: 1 }), commands: cmds("behind") }),
        repo({ repo: "dirty", work: work({ behind: 1, changed: 2 }), commands: cmds("dirty") }),
        repo({ repo: "level", work: work(), commands: cmds("level") }),
      ],
    });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Pull all (1)" }));
    const dialog = within(screen.getByRole("alertdialog", { name: "Confirm pull all" }));
    expect(dialog.getByText("behind")).toBeTruthy();
    expect(ops()).toHaveLength(0);
    fireEvent.click(dialog.getByRole("button", { name: "Pull all" }));
    await waitFor(() => expect(screen.getByText("Pulled 1 of 1.")).toBeTruthy());
    expect(ops().map((c) => c.body)).toEqual([{ workspace: "acme", repo: "behind", op: "pull", confirm: true }]);
  });

  it("clones all the missing repositories, and the buttons are off when there is nothing to do", async () => {
    mockServer({ repos: [repo({ repo: "x", state: "missing", clone: cloneOf("x") }), repo({ repo: "y", state: "missing", clone: cloneOf("y") }), repo({ repo: "z", work: work(), commands: cmds("z") })] });
    renderRepos();
    fireEvent.click(await screen.findByRole("button", { name: "Clone missing (2)" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Confirm clone missing" })).getByRole("button", { name: "Clone missing" }));
    await waitFor(() => expect(screen.getByText("Cloned 2 of 2.")).toBeTruthy());

    cleanup();
    mockServer({ repos: [repo({ work: work(), commands: cmds("api") })] });
    renderRepos();
    expect((await screen.findByRole("button", { name: "Clone missing" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Pull all" }).hasAttribute("disabled")).toBe(true);
  });
});
