import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { Issue, RunStatus, WorkspaceDetail, WorkspaceSummary } from "../lib/types";
import { useCurrentProject } from "../lib/current-project";
import { useUi } from "../store/ui";

const demo: WorkspaceSummary = {
  id: "demo",
  name: "demo",
  source: "local",
  root: "~/code",
  repos: 3,
  repo_types: { go: 1, node: 1, other: 1 },
  stacks: 1,
  flows: 0,
  errors: 1,
  warnings: 1,
};

const issues: Issue[] = [
  { file: "stacks/full.yaml", path: "/services/1/repo", line: 9, severity: "error", message: 'There is no repo with id "ghost".' },
  {
    file: "workspace.yaml",
    line: 3,
    severity: "warning",
    message: "This folder isn't a git repository (no .git inside).",
    code: "repo-not-git",
    fixes: [
      { id: "mark-local-only", label: "Mark local_only: true", kind: "edit" },
      { id: "git-init", label: "Run git init", kind: "action" },
    ],
  },
];

const detail: WorkspaceDetail = {
  ...demo,
  workspace: {
    name: "demo",
    root: "~/code",
    repos: [
      { id: "api", path: "api", type: "go", remote: "github.com/acme/api" },
      { id: "web", path: "web", type: "node", remote: "github.com/acme/web" },
      { id: "infra", path: "infra", local_only: true },
    ],
  },
  stacks: [{ name: "full", services: [{ id: "api", kind: "process" }] }],
  flows: [{ name: "nightly" }],
  issues,
  root_path: "/home/me/code",
};

const draft = "version: 1\nname: code\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n";

const demoScripts = [
  { id: "sync-dev", title: "Switch every repo to dev", for_each: "repo", steps: [{ git: "fetch" }, { git: "checkout", branch: "dev" }, { git: "pull" }], source: "built-in", writes: true },
  { id: "status-all", title: "What changed?", for_each: "repo", steps: [{ git: "status" }], source: "built-in", writes: false },
  { id: "npm:web:test", title: "npm run test", repo: "web", steps: [{ run: "npm run test" }], source: "package.json", writes: true },
];

/** A run of sync-dev over api and web: still going, or done (web skipped, it has changes). */
const syncRun = (at: "running" | "done") => ({
  id: "r1",
  workspace: "demo",
  script: "sync-dev",
  title: "Switch every repo to dev",
  state: at === "running" ? "running" : "ok",
  started_at: "",
  repos: [
    { repo: "api", state: at === "running" ? "running" : "ok", steps: [{ label: "fetch", state: "ok" }, { label: "checkout dev", state: at === "running" ? "running" : "ok", output: "Switched to branch 'dev'" }, { label: "pull", state: at === "running" ? "waiting" : "ok" }] },
    { repo: "web", state: at === "running" ? "waiting" : "skipped", reason: at === "running" ? undefined : "it has uncommitted changes, so it was left as it is", steps: [{ label: "fetch", state: at === "running" ? "waiting" : "ok" }, { label: "checkout dev", state: at === "running" ? "waiting" : "skipped" }, { label: "pull", state: at === "running" ? "waiting" : "skipped" }] },
  ],
});

type Posted = { url: string; body: unknown };
const posted: Posted[] = [];
const calls: string[] = [];
/** Whether a DELETE for the demo workspace was sent. */
const deleted = () => calls.includes("DELETE /api/v1/workspaces/demo");

const sample: WorkspaceSummary = { ...demo, repo_types: undefined, id: "acme-shop", name: "acme-shop", source: "example", root: "~/code/acme-shop", repos: 3, stacks: 2, flows: 1, errors: 0, warnings: 0 };

const git = (repo: string, state: string, work?: object) => ({
  workspace: "demo",
  workspace_name: "demo",
  repo,
  path: `C:/code/${repo}`,
  remote: "",
  expected: { name: "", email: "" },
  actual: { name: "", email: "" },
  state,
  work,
});
const gitRows = [
  git("api", "ok", { branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, changed: 2 }),
  git("web", "no-rule", { branch: "dev", detached: false, upstream: "origin/dev", ahead: 0, behind: 0, changed: 0 }),
  git("infra", "no-remote"),
];

const chosen = "/home/me/code";
/** Lets a test finish a folder dialog that is still open. */
let closeDialog: (() => void) | undefined;

function mockServer(
  opts: { list?: WorkspaceSummary[]; runs?: RunStatus[]; scanError?: string; scanEmpty?: boolean; pick?: "ok" | "cancel" | "error" | "wait"; deleteError?: { status: number; message: string } } = {},
) {
  let list = opts.list ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method === "POST") posted.push({ url, body });
      if (url === "/api/v1/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (url === "/api/v1/workspaces" && method === "GET") return Promise.resolve(Response.json(list));
      if (url === "/api/v1/workspaces/demo" && method === "DELETE") {
        if (opts.deleteError) return Promise.resolve(Response.json({ message: opts.deleteError.message }, { status: opts.deleteError.status }));
        list = list.filter((w) => w.id !== "demo");
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/v1/workspaces/demo") return Promise.resolve(Response.json(detail));
      if (url === "/api/v1/runs") return Promise.resolve(Response.json(opts.runs ?? []));
      if (url === "/api/v1/workspaces/demo/scripts") return Promise.resolve(Response.json(demoScripts));
      if (url === "/api/v1/workspaces/demo/scripts/sync-dev/run" && method === "POST") return Promise.resolve(Response.json(syncRun("running"), { status: 202 }));
      if (url === "/api/v1/script-runs/r1") return Promise.resolve(Response.json(syncRun("done")));
      if (url === "/api/v1/workspaces/demo/stacks/full/start" && method === "POST") return Promise.resolve(Response.json({ workspace: "demo", stack: "full", state: "starting", started_at: "", services: [] }));
      if (url === "/api/v1/workspaces/acme-shop") return Promise.resolve(Response.json({ ...sample, workspace: { name: "acme-shop", root: "~/code/acme-shop", repos: [] }, stacks: [], flows: [], issues: [] }));
      if (url === "/api/v1/workspaces/demo/file") return Promise.resolve(Response.json({ yaml: draft, hash: "h1", path: "/code/demo/workspace.yaml" }));
      if (url === "/api/v1/git/repos") return Promise.resolve(Response.json(gitRows));
      if (url === "/api/v1/system/pick-folder") {
        if (opts.pick === "cancel") return Promise.resolve(new Response(null, { status: 204 }));
        if (opts.pick === "error") return Promise.resolve(Response.json({ message: "the folder dialog couldn't be opened: type the folder’s path instead" }, { status: 500 }));
        if (opts.pick === "wait") return new Promise((resolve) => (closeDialog = () => resolve(Response.json({ path: chosen }))));
        return Promise.resolve(Response.json({ path: chosen }));
      }
      if (url === "/api/v1/workspaces/scan") {
        if (opts.scanError) return Promise.resolve(Response.json({ message: opts.scanError }, { status: 422 }));
        if (opts.scanEmpty) return Promise.resolve(Response.json({ root: "/home/me/notes", name: "notes", repos: null, yaml: "" }));
        return Promise.resolve(Response.json({ root: "/home/me/code", name: "code", repos: [{ id: "api", path: "api" }, { id: "web", path: "web", type: "node", remote: "github.com/acme/web" }], yaml: draft }));
      }
      if (url === "/api/v1/workspaces/validate") {
        return Promise.resolve(Response.json({ valid: true, issues: [] }));
      }
      if (url === "/api/v1/workspaces" && method === "POST") {
        list = [{ ...demo, id: "code", name: "code", errors: 0, warnings: 0 }];
        return Promise.resolve(Response.json(list[0], { status: 201 }));
      }
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
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
  return router;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  useCurrentProject.setState({ id: null });
  vi.unstubAllGlobals();
  posted.length = 0;
  calls.length = 0;
  closeDialog = undefined;
});

describe("workspaces page", () => {
  it("shows the empty state when there are none, and its button opens the add form", async () => {
    mockServer();
    renderAt("/workspaces");
    const hero = within(await screen.findByRole("region", { name: "No projects yet" }));

    const add = hero.getByRole("button", { name: /New project/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    const drawer = within(await screen.findByRole("dialog", { name: "New project" }));
    expect(drawer.getByLabelText(/One repo, or the folder/)).toBeTruthy();
  });

  it("shows each project as a card: its number and folder, its state, its shape and its mix of types", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces");

    const card = within(await screen.findByRole("button", { name: "Project demo" }));
    expect(card.getByText(/PRJ_01 \/\/ ~\/code/)).toBeTruthy();
    expect(card.getByText("2 problems")).toBeTruthy();
    expect(card.getByText("3 repos · 1 run mode")).toBeTruthy();
    expect(card.getByRole("img", { name: "Repos by type: go 1, node 1, other 1" })).toBeTruthy();

    const other = within(screen.getByRole("button", { name: "Project acme-shop" }));
    expect(other.getByText("Example")).toBeTruthy();
    expect(other.getByText("Stopped")).toBeTruthy();
    expect(other.queryByRole("img")).toBeNull(); // no types to show
  });

  it("puts New project on the title's line, and opens the drawer from it or from the tile", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    await screen.findByRole("button", { name: "Project demo" });
    const title = screen.getByRole("heading", { level: 1, name: "Projects" });
    const add = within(title.closest("header") as HTMLElement).getByRole("button", { name: /^New project/ });

    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "New project" })).toBeTruthy();

    // the drawer closes again with Escape, and leaves the list as it was
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Project demo" })).toBeTruthy();

    fireEvent.click(within(screen.getByRole("list", { name: "Projects" })).getByRole("button", { name: /New project/ }));
    expect(await screen.findByRole("dialog", { name: "New project" })).toBeTruthy();
  });

  it("shows the first workspace's repos with their git state, and filters them", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces/demo");
    const details = within(await screen.findByRole("region", { name: "Details of demo" }));
    const table = within(await details.findByRole("table", { name: "Repositories of demo" }));

    // the file's repos are joined with what git says about each folder
    const api = within(table.getByText("api").closest("tr") as HTMLElement);
    expect(api.getByText("main")).toBeTruthy();
    expect(api.getByText("2 changed")).toBeTruthy();
    expect(api.getByText("github.com/acme/api")).toBeTruthy();
    const web = within(table.getByText("web").closest("tr") as HTMLElement);
    expect(web.getByText("clean")).toBeTruthy();

    // a folder that isn't a git repository, marked local-only, goes in its own group at the end
    expect(table.getByText(/Local only/)).toBeTruthy();
    const infra = within(table.getByText("infra").closest("tr") as HTMLElement);
    expect(infra.getByText("no .git")).toBeTruthy();

    // one repo is behind a remote whose profile isn't set up: a pointer to the Repositories page
    expect(details.getByRole("link", { name: "Open Repositories" })).toBeTruthy();

    // filter by type, by text, and by uncommitted changes
    fireEvent.click(details.getByRole("button", { name: /^go/ }));
    expect(table.queryByText("web")).toBeNull();
    expect(table.getByText("api")).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: /^go/ }));
    fireEvent.click(details.getByRole("button", { name: /Uncommitted changes/ }));
    expect(table.queryByText("web")).toBeNull();
    fireEvent.click(details.getByRole("button", { name: /Uncommitted changes/ }));
    fireEvent.change(details.getByLabelText("Filter repositories"), { target: { value: "inf" } });
    expect(table.queryByText("api")).toBeNull();
    expect(table.getByText("infra")).toBeTruthy();
    fireEvent.change(details.getByLabelText("Filter repositories"), { target: { value: "zzz" } });
    expect(details.getByText("No repository matches.")).toBeTruthy();
  });

  it("lists only the cards and New project; a card opens its project on its own page", async () => {
    mockServer({ list: [demo, sample] });
    const router = renderAt("/workspaces");
    const second = await screen.findByRole("button", { name: "Project acme-shop" });
    expect(screen.queryByRole("region", { name: /Details of/ })).toBeNull(); // no details under the cards

    fireEvent.click(second);
    expect(await screen.findByRole("region", { name: "Details of acme-shop" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/workspaces/acme-shop");
    expect(screen.getByRole("heading", { level: 1, name: "acme-shop" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Work/Projects/acme-shop");
  });

  it("sends an older link that named the project in the address to its page", async () => {
    mockServer({ list: [demo, sample] });
    const router = renderAt("/workspaces?open=acme-shop");
    expect(await screen.findByRole("region", { name: "Details of acme-shop" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/workspaces/acme-shop");
  });

  it("lists the problems by file with their lines, and links the ones in workspace.yaml to the editor", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces/demo");
    const details = within(await screen.findByRole("region", { name: "Details of demo" }));
    fireEvent.click(await details.findByRole("tab", { name: /Problems/ }));

    const panel = within(details.getByRole("tabpanel"));
    expect(panel.getByText("stacks/full.yaml")).toBeTruthy();
    expect(panel.getByText("line 9")).toBeTruthy();
    expect(panel.getByText(/no repo with id "ghost"/)).toBeTruthy();
    expect(panel.getByText(/Can be fixed: Mark local_only: true or Run git init/)).toBeTruthy();

    // only workspace.yaml opens in the editor, at the line of the problem
    const links = panel.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/workspaces/demo/edit?line=3");
    expect(links[0].textContent).toBe("Fix in the editor");
  });

  it("runs: each run mode with its services, and its logs in the tab; the tab is in the address", async () => {
    mockServer({ list: [demo] });
    const router = renderAt("/workspaces/demo");
    const details = within(await screen.findByRole("region", { name: "Details of demo" }));
    fireEvent.click(await details.findByRole("tab", { name: /Run/ }));
    expect(router.state.location.search).toBe("?tab=run");
    expect(await details.findByRole("button", { name: /Start/ })).toBeTruthy(); // the stack's own start, in its card

    // Logs: the stream of a run mode right here, and the full page a click away.
    fireEvent.click(details.getByRole("tab", { name: /Logs/ }));
    expect((details.getByLabelText("Run mode") as HTMLSelectElement).value).toBe("full");
    expect(details.getByRole("link", { name: /Full page/ }).getAttribute("href")).toBe("/logs?workspace=demo&stack=full");
    expect(details.queryByRole("heading", { level: 1 })).toBeNull(); // no second page title
  });

  it("the header: the name, its state, the run mode, Start, VS Code and Edit file", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces/demo");
    const head = within((await screen.findByRole("heading", { level: 1, name: /demo/ })).closest("header") as HTMLElement);
    expect(head.getByText("2 problems")).toBeTruthy();
    expect((head.getByRole("combobox", { name: "Run mode" }) as HTMLSelectElement).value).toBe("full");
    expect(head.getByRole("link", { name: /Open in VS Code/ }).getAttribute("href")).toBe("vscode://file/home/me/code");
    expect(head.getByRole("link", { name: /Edit file/ }).getAttribute("href")).toBe("/workspaces/demo/edit");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Work/Projects/demo");

    fireEvent.click(head.getByRole("button", { name: /^Start/ }));
    await waitFor(() => expect(posted).toContainEqual({ url: "/api/v1/workspaces/demo/stacks/full/start", body: undefined }));
  });

  it("opening a project makes it the current one: Stacks and the sidebar's switcher follow it", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces/demo");
    await screen.findByRole("region", { name: "Details of demo" });
    await waitFor(() => expect(useCurrentProject.getState().id).toBe("demo"));
    cleanup();

    // Left to itself, Stacks would show the example (the first with no errors); it shows the current one.
    useUi.setState({ sidebarOpen: true });
    renderAt("/stacks");
    await waitFor(() => expect((screen.getByLabelText("Workspace") as HTMLSelectElement).value).toBe("demo"));
    expect(screen.getByRole("link", { name: "Project: demo" }).getAttribute("href")).toBe("/workspaces/demo");
  });

  it("scripts: starters and found ones; a write asks first, then each repo's result and a summary", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces/demo?tab=scripts");
    const own = within(await screen.findByRole("list", { name: "Scripts" }));
    expect(own.getByText("fetch → checkout dev → pull")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Found scripts" })).getByRole("button", { name: "Run npm run test" })).toBeTruthy();

    fireEvent.click(own.getByRole("button", { name: "Run Switch every repo to dev" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Switch every repo to dev" }));
    expect(sheet.getByText("$ devdeck run sync-dev")).toBeTruthy();
    expect(sheet.getByText(/A repo with uncommitted changes is skipped, never reset/)).toBeTruthy();
    expect(posted.some((p) => p.url.includes("/scripts/"))).toBe(false); // nothing runs before Run it

    fireEvent.click(sheet.getByRole("button", { name: "Run it" }));
    await waitFor(() => expect(posted).toContainEqual({ url: "/api/v1/workspaces/demo/scripts/sync-dev/run", body: { confirm: true } }));
    expect(await sheet.findByText("2 repos · 1 ok · 1 skipped")).toBeTruthy();
    expect(sheet.getByText(/uncommitted changes, so it was left as it is/)).toBeTruthy();
  });

  it("the header says when the project runs, and offers Stop", async () => {
    mockServer({ list: [demo], runs: [{ workspace: "demo", stack: "full", state: "running", started_at: "", services: [{ id: "api", kind: "process", state: "ready", restarts: 0 }] }] });
    renderAt("/workspaces/demo");
    const head = within((await screen.findByRole("heading", { level: 1, name: /demo/ })).closest("header") as HTMLElement);
    expect(await head.findByText("Running 1/1")).toBeTruthy();
    expect(head.getByRole("button", { name: /Stop/ })).toBeTruthy();
  });

  it("has an Edit file button for the user's own projects only", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces/demo");
    expect((await screen.findByRole("link", { name: /Edit file/ })).getAttribute("href")).toBe("/workspaces/demo/edit");
    cleanup();

    renderAt("/workspaces/acme-shop");
    await screen.findByRole("region", { name: "Details of acme-shop" });
    expect(screen.queryByRole("link", { name: /Edit file/ })).toBeNull();
    expect((screen.queryByRole("button", { name: /^Start/ }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true); // an example: no start
  });

  async function openSettings(id = "demo") {
    const details = within(await screen.findByRole("region", { name: `Details of ${id}` }));
    fireEvent.click(await details.findByRole("tab", { name: "Settings" }));
    return details;
  }

  it("deletes a workspace only after it is confirmed", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces/demo");
    const settings = await openSettings();
    expect(await settings.findByText("/code/demo/workspace.yaml")).toBeTruthy();

    fireEvent.click(settings.getByRole("button", { name: /Delete demo/ }));
    const confirm = within(await screen.findByRole("group", { name: "Confirm deleting demo" }));
    expect(deleted()).toBe(false); // nothing yet

    // Cancel leaves it alone
    fireEvent.click(confirm.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm deleting demo" })).toBeNull();
    expect(deleted()).toBe(false);

    fireEvent.click(settings.getByRole("button", { name: /Delete demo/ }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Confirm deleting demo" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted()).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Project demo" })).toBeNull());
    // with none left, the page offers to add one
    expect(await screen.findByRole("region", { name: "No projects yet" })).toBeTruthy();
  });

  it("says why a workspace could not be deleted and keeps it", async () => {
    mockServer({ list: [demo], deleteError: { status: 409, message: "stop its running stacks before deleting this workspace" } });
    renderAt("/workspaces/demo");
    const settings = await openSettings();

    fireEvent.click(settings.getByRole("button", { name: /Delete demo/ }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Confirm deleting demo" })).getByRole("button", { name: "Delete" }));

    expect((await screen.findByRole("alert")).textContent).toBe("stop its running stacks before deleting this workspace");
    expect(screen.getByRole("region", { name: "Details of demo" })).toBeTruthy(); // still here, on its page
  });

  it("offers no delete on the sample workspace", async () => {
    mockServer({ list: [sample] });
    renderAt("/workspaces/acme-shop");
    const settings = await openSettings("acme-shop");
    expect(await settings.findByText("Example (read only)")).toBeTruthy();
    expect(settings.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("scans a folder, lists what it found to tick, and creates the project from what is ticked", async () => {
    mockServer();
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));

    fireEvent.change(await screen.findByLabelText(/One repo, or the folder/), { target: { value: "~/code" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan folder/ }));

    const found = within(await screen.findByRole("list", { name: "Repos found" }));
    expect(posted).toContainEqual({ url: "/api/v1/workspaces/scan", body: { root: "~/code" } });
    expect(screen.getByText(/Scanned · 2 repos/)).toBeTruthy();
    expect(found.getByText("github.com/acme/web")).toBeTruthy();
    expect(screen.queryByLabelText("workspace.yaml")).toBeNull(); // the file is not the first thing shown

    // untick web; the name comes from the folder
    fireEvent.click(found.getByRole("checkbox", { name: "Include web" }));
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("code");
    fireEvent.click(screen.getByRole("button", { name: /Show the file/ }));
    const file = "# Made by devdeck from ~/code. Edit freely.\nversion: 1\nname: code\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n";
    expect(screen.getByLabelText("workspace.yaml").textContent).toBe(file);

    const create = screen.getByRole("button", { name: /Create project/ }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);

    await waitFor(() => expect(posted).toContainEqual({ url: "/api/v1/workspaces", body: { yaml: file } }));
    // the form closes and the new workspace is in the list
    expect(await screen.findByRole("button", { name: "Project code" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // the drawer closes once it is saved
  });

  it("won't create a project with a name the file can't take", async () => {
    mockServer();
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    fireEvent.change(await screen.findByLabelText(/One repo, or the folder/), { target: { value: "~/code" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan folder/ }));
    await screen.findByRole("list", { name: "Repos found" });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "My Shop" } });
    expect(screen.getByText(/Lower case letters, digits and dashes/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Create project/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a folder with no git repositories can still become a project", async () => {
    mockServer({ scanEmpty: true });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    fireEvent.change(await screen.findByLabelText(/One repo, or the folder/), { target: { value: "~/notes" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan folder/ }));
    expect(await screen.findByText(/No git repositories in this folder/)).toBeTruthy();
    expect(screen.getByText(/Scanned · 0 repos/)).toBeTruthy();
  });

  it("says why a folder couldn't be scanned", async () => {
    mockServer({ scanError: "that folder doesn't exist" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    fireEvent.change(await screen.findByLabelText(/One repo, or the folder/), { target: { value: "~/nope" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan folder/ }));

    expect((await screen.findByRole("alert")).textContent).toBe("that folder doesn't exist");
    expect(screen.queryByRole("list", { name: "Repos found" })).toBeNull();
  });
  it("fills in the folder from the system's dialog and scans it at once", async () => {
    mockServer();
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));

    const box = await screen.findByRole("list", { name: "Repos found" });
    expect(within(box).getByText("api")).toBeTruthy();
    expect((screen.getByLabelText(/One repo, or the folder/) as HTMLInputElement).value).toBe(chosen);
    expect(posted).toContainEqual({ url: "/api/v1/system/pick-folder", body: undefined });
    expect(posted).toContainEqual({ url: "/api/v1/workspaces/scan", body: { root: chosen } });
  });

  it("does nothing when the dialog is closed without choosing", async () => {
    mockServer({ pick: "cancel" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    const browse = await screen.findByRole("button", { name: /Browse/ });
    fireEvent.click(browse);

    await waitFor(() => expect(posted.some((p) => p.url === "/api/v1/system/pick-folder")).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: /Browse/ }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText(/One repo, or the folder/) as HTMLInputElement).value).toBe("");
    expect(posted.some((p) => p.url === "/api/v1/workspaces/scan")).toBe(false);
    expect(screen.queryByRole("list", { name: "Repos found" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the dialog could not open, and the path can still be typed", async () => {
    mockServer({ pick: "error" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("type the folder");
    const input = screen.getByLabelText(/One repo, or the folder/) as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("shows that it is waiting while the dialog is open", async () => {
    mockServer({ pick: "wait" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /New project/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));

    const waiting = (await screen.findByRole("button", { name: /Waiting for you/ })) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Scan folder/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/folder window has opened/);

    await waitFor(() => expect(closeDialog).toBeDefined());
    closeDialog?.();
    expect(await screen.findByRole("list", { name: "Repos found" })).toBeTruthy();
    expect(screen.queryByText(/folder window has opened/)).toBeNull();
  });
});
