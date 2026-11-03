import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { Issue, WorkspaceDetail, WorkspaceSummary } from "../lib/types";
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
};

const draft = "version: 1\nname: code\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n";

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
  opts: { list?: WorkspaceSummary[]; scanError?: string; pick?: "ok" | "cancel" | "error" | "wait"; deleteError?: { status: number; message: string } } = {},
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
        return Promise.resolve(Response.json({ root: "/home/me/code", name: "code", repos: [{ id: "api", path: "api" }], yaml: draft }));
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
  posted.length = 0;
  calls.length = 0;
  closeDialog = undefined;
});

describe("workspaces page", () => {
  it("shows the empty state when there are none, and its button opens the add form", async () => {
    mockServer();
    renderAt("/workspaces");
    expect(await screen.findByRole("heading", { name: "No workspace yet" })).toBeTruthy();

    const add = screen.getByRole("button", { name: /Add workspace/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    const drawer = within(await screen.findByRole("dialog", { name: "Add a workspace" }));
    expect(drawer.getByLabelText(/Folder that contains/)).toBeTruthy();
  });

  it("shows each workspace as a card with its counts, its problems and its mix of types", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces");

    const card = within(await screen.findByRole("button", { name: "Workspace demo" }));
    expect(card.getByText("Yours")).toBeTruthy();
    expect(card.getByText("~/code")).toBeTruthy();
    expect(card.getByText("repos").previousElementSibling?.textContent).toBe("3");
    expect(card.getByText("stacks").previousElementSibling?.textContent).toBe("1");
    expect(card.getByText("flows").previousElementSibling?.textContent).toBe("0");
    expect(card.getByText("problems").previousElementSibling?.textContent).toMatch(/2$/);
    expect(card.getByRole("img", { name: "Repos by type: go 1, node 1, other 1" })).toBeTruthy();

    const other = within(screen.getByRole("button", { name: "Workspace acme-shop" }));
    expect(other.getByText("Example")).toBeTruthy();
    expect(other.getByText("problems").previousElementSibling?.textContent).toBe("0");
    expect(other.queryByRole("img")).toBeNull(); // no types to show
  });

  it("puts Add workspace on the title's line, and opens the drawer from it or from the tile", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    const add = await screen.findByRole("button", { name: /^Add workspace/ });
    await screen.findByRole("button", { name: "Workspace demo" });
    expect(add.closest("header")).toBeTruthy();
    expect(within(add.closest("header") as HTMLElement).getByRole("heading", { level: 1, name: "Workspaces" })).toBeTruthy();

    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "Add a workspace" })).toBeTruthy();

    // the drawer closes again with Escape, and leaves the list as it was
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Workspace demo" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add a workspace/ }));
    expect(await screen.findByRole("dialog", { name: "Add a workspace" })).toBeTruthy();
  });

  it("shows the first workspace's repos with their git state, and filters them", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
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

  it("shows the details of the card that is chosen, and keeps the choice in the address", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces");
    const first = await screen.findByRole("button", { name: "Workspace demo" });
    const second = screen.getByRole("button", { name: "Workspace acme-shop" });
    expect(first.getAttribute("aria-pressed")).toBe("true"); // the first shows when none is chosen
    expect(await screen.findByRole("region", { name: "Details of demo" })).toBeTruthy();

    fireEvent.click(second);
    await waitFor(() => expect(second.getAttribute("aria-pressed")).toBe("true"));
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByRole("region", { name: "Details of acme-shop" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Details of demo" })).toBeNull();
  });

  it("opens the workspace named in the address, so a link can point at it", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces?open=acme-shop");
    expect(await screen.findByRole("region", { name: "Details of acme-shop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Workspace acme-shop" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("lists the problems by file with their lines, and links the ones in workspace.yaml to the editor", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
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

  it("lists the stacks with a way to open them, and the flows", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    const details = within(await screen.findByRole("region", { name: "Details of demo" }));
    fireEvent.click(await details.findByRole("tab", { name: /Stacks/ }));
    expect(details.getByText("full")).toBeTruthy();
    expect(details.getByRole("link", { name: "Open stack" }).getAttribute("href")).toBe("/stacks?workspace=demo");
    expect(details.getByText("nightly")).toBeTruthy();
  });

  it("has an Edit file button for the user's own workspaces only", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces");
    const details = within(await screen.findByRole("region", { name: "Details of demo" }));
    expect(details.getByRole("link", { name: /Edit file/ }).getAttribute("href")).toBe("/workspaces/demo/edit");

    fireEvent.click(screen.getByRole("button", { name: "Workspace acme-shop" }));
    const other = within(await screen.findByRole("region", { name: "Details of acme-shop" }));
    expect(other.queryByRole("link", { name: /Edit file/ })).toBeNull();
  });

  async function openSettings(id = "demo") {
    const details = within(await screen.findByRole("region", { name: `Details of ${id}` }));
    fireEvent.click(await details.findByRole("tab", { name: "Settings" }));
    return details;
  }

  it("deletes a workspace only after it is confirmed", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "Workspace demo" })).toBeNull());
    // with none left, the page offers to add one
    expect(await screen.findByRole("heading", { name: "No workspace yet" })).toBeTruthy();
  });

  it("says why a workspace could not be deleted and keeps it", async () => {
    mockServer({ list: [demo], deleteError: { status: 409, message: "stop its running stacks before deleting this workspace" } });
    renderAt("/workspaces");
    const settings = await openSettings();

    fireEvent.click(settings.getByRole("button", { name: /Delete demo/ }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Confirm deleting demo" })).getByRole("button", { name: "Delete" }));

    expect((await screen.findByRole("alert")).textContent).toBe("stop its running stacks before deleting this workspace");
    expect(screen.getByRole("button", { name: "Workspace demo" })).toBeTruthy();
  });

  it("offers no delete on the sample workspace", async () => {
    mockServer({ list: [sample] });
    renderAt("/workspaces");
    const settings = await openSettings("acme-shop");
    expect(await settings.findByText("Example (read only)")).toBeTruthy();
    expect(settings.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("scans a folder, shows the draft, and saves exactly what is in the box", async () => {
    mockServer();
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /Add workspace/ }));

    fireEvent.change(await screen.findByLabelText(/Folder that contains/), { target: { value: "~/code" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan folder/ }));

    const box = (await screen.findByLabelText("workspace.yaml")) as HTMLTextAreaElement;
    expect(box.value).toBe(draft);
    expect(posted).toContainEqual({ url: "/api/v1/workspaces/scan", body: { root: "~/code" } });

    fireEvent.change(box, { target: { value: draft + "# edited\n" } });
    const create = screen.getByRole("button", { name: /Create workspace/ }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);

    await waitFor(() => expect(posted).toContainEqual({ url: "/api/v1/workspaces", body: { yaml: draft + "# edited\n" } }));
    // the form closes and the new workspace is in the list
    expect(await screen.findByRole("button", { name: "Workspace code" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // the drawer closes once it is saved
  });

  it("says why a folder couldn't be scanned", async () => {
    mockServer({ scanError: "that folder doesn't exist" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /Add workspace/ }));
    fireEvent.change(await screen.findByLabelText(/Folder that contains/), { target: { value: "~/nope" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan folder/ }));

    expect((await screen.findByRole("alert")).textContent).toBe("that folder doesn't exist");
    expect(screen.queryByLabelText("workspace.yaml")).toBeNull();
  });
  it("fills in the folder from the system's dialog and scans it at once", async () => {
    mockServer();
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /Add workspace/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));

    const box = (await screen.findByLabelText("workspace.yaml")) as HTMLTextAreaElement;
    expect(box.value).toBe(draft);
    expect((screen.getByLabelText(/Folder that contains/) as HTMLInputElement).value).toBe(chosen);
    expect(posted).toContainEqual({ url: "/api/v1/system/pick-folder", body: undefined });
    expect(posted).toContainEqual({ url: "/api/v1/workspaces/scan", body: { root: chosen } });
  });

  it("does nothing when the dialog is closed without choosing", async () => {
    mockServer({ pick: "cancel" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /Add workspace/ }));
    const browse = await screen.findByRole("button", { name: /Browse/ });
    fireEvent.click(browse);

    await waitFor(() => expect(posted.some((p) => p.url === "/api/v1/system/pick-folder")).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: /Browse/ }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText(/Folder that contains/) as HTMLInputElement).value).toBe("");
    expect(posted.some((p) => p.url === "/api/v1/workspaces/scan")).toBe(false);
    expect(screen.queryByLabelText("workspace.yaml")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the dialog could not open, and the path can still be typed", async () => {
    mockServer({ pick: "error" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /Add workspace/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("type the folder");
    const input = screen.getByLabelText(/Folder that contains/) as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("shows that it is waiting while the dialog is open", async () => {
    mockServer({ pick: "wait" });
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: /Add workspace/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));

    const waiting = (await screen.findByRole("button", { name: /Waiting for you/ })) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Scan folder/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/folder window has opened/);

    await waitFor(() => expect(closeDialog).toBeDefined());
    closeDialog?.();
    expect(await screen.findByLabelText("workspace.yaml")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
