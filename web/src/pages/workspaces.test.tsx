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
  repos: 2,
  stacks: 1,
  flows: 0,
  errors: 1,
  warnings: 1,
};

const issues: Issue[] = [
  { file: "stacks/full.yaml", path: "/services/1/repo", line: 9, severity: "error", message: 'There is no repo with id "ghost".' },
  { file: "workspace.yaml", line: 3, severity: "warning", message: "The folder doesn’t exist on this machine." },
];

const detail: WorkspaceDetail = {
  ...demo,
  workspace: { name: "demo", root: "~/code", repos: [{ id: "api", path: "api", type: "go", remote: "github.com/acme/api" }] },
  stacks: [{ name: "full" }],
  flows: [],
  issues,
};

const draft = "version: 1\nname: code\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n";

type Posted = { url: string; body: unknown };
const posted: Posted[] = [];
const calls: string[] = [];
/** Whether a DELETE for the demo workspace was sent. */
const deleted = () => calls.includes("DELETE /api/v1/workspaces/demo");

const sample: WorkspaceSummary = { ...demo, id: "acme-shop", name: "acme-shop", source: "example", root: "~/code/acme-shop", repos: 3, stacks: 2, flows: 1, errors: 0, warnings: 0 };

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

  it("shows each workspace as a card with its counts and problems", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces");

    const card = within(await screen.findByRole("listitem", { name: "Workspace demo" }));
    expect(card.getByText("Yours")).toBeTruthy();
    expect(card.getByText("~/code")).toBeTruthy();
    expect(card.getByText("Repos").nextElementSibling?.textContent).toBe("2");
    expect(card.getByText("Stacks").nextElementSibling?.textContent).toBe("1");
    expect(card.getByText("Flows").nextElementSibling?.textContent).toBe("0");
    expect(card.getByTitle("1 error")).toBeTruthy();
    expect(card.getByTitle("1 warning")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    const other = within(screen.getByRole("listitem", { name: "Workspace acme-shop" }));
    expect(other.getByText("Example")).toBeTruthy();
    expect(other.getByText("Problems").nextElementSibling?.textContent).toBe("None");
  });

  it("puts Add workspace on the title's line, at the right, and opens the drawer from it", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    const add = await screen.findByRole("button", { name: /Add workspace/ });
    await screen.findByRole("listitem", { name: "Workspace demo" });
    // same row as the page title (inside the header), pushed to the right, and no "1 workspace" count
    const row = add.parentElement as HTMLElement;
    expect(row.className).toContain("justify-between");
    expect(within(row).getByRole("heading", { level: 1, name: "Workspaces" })).toBeTruthy();
    expect(row.closest("header")).toBeTruthy();
    expect(screen.queryByText(/\d+ workspaces?$/)).toBeNull();

    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "Add a workspace" })).toBeTruthy();

    // the drawer closes again with Escape, and leaves the list as it was
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("listitem", { name: "Workspace demo" })).toBeTruthy();
  });

  it("deletes a workspace only after it is confirmed", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    const card = within(await screen.findByRole("listitem", { name: "Workspace demo" }));

    fireEvent.click(card.getByRole("button", { name: "Delete demo" }));
    const confirm = within(await screen.findByRole("group", { name: "Confirm deleting demo" }));
    expect(confirm.getByText(/repositories aren’t touched/)).toBeTruthy();
    expect(posted.some((p) => p.url.endsWith("/workspaces/demo"))).toBe(false); // nothing yet

    // Cancel leaves it alone
    fireEvent.click(confirm.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm deleting demo" })).toBeNull();
    expect(deleted()).toBe(false);

    fireEvent.click(card.getByRole("button", { name: "Delete demo" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Confirm deleting demo" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted()).toBe(true));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Workspace demo" })).toBeNull());
    // with none left, the page offers to add one
    expect(await screen.findByRole("heading", { name: "No workspace yet" })).toBeTruthy();
  });

  it("says why a workspace could not be deleted and keeps it", async () => {
    mockServer({ list: [demo], deleteError: { status: 409, message: "stop its running stacks before deleting this workspace" } });
    renderAt("/workspaces");
    const card = within(await screen.findByRole("listitem", { name: "Workspace demo" }));

    fireEvent.click(card.getByRole("button", { name: "Delete demo" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Confirm deleting demo" })).getByRole("button", { name: "Delete" }));

    expect((await screen.findByRole("alert")).textContent).toBe("stop its running stacks before deleting this workspace");
    expect(screen.getByRole("listitem", { name: "Workspace demo" })).toBeTruthy();
  });

  it("offers no delete on the sample workspace", async () => {
    mockServer({ list: [sample] });
    renderAt("/workspaces");
    const card = within(await screen.findByRole("listitem", { name: "Workspace acme-shop" }));
    expect(card.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("opens a card to show its details, each problem with its file and line, and closes it again", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    const toggle = await screen.findByRole("button", { name: "demo" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // nothing is fetched for the details until the card is opened
    expect(calls).not.toContain("GET /api/v1/workspaces/demo");
    expect(screen.queryByRole("region", { name: "demo" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const panel = within(await screen.findByRole("region", { name: "demo" }));
    expect(await panel.findByText("stacks/full.yaml")).toBeTruthy();
    expect(panel.getByText("line 9")).toBeTruthy();
    expect(panel.getByText(/no repo with id "ghost"/)).toBeTruthy();
    expect(panel.getByText("github.com/acme/api")).toBeTruthy();
    expect(calls).toContain("GET /api/v1/workspaces/demo");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByRole("region", { name: "demo" })).toBeNull());
  });

  it("opens one card at a time", async () => {
    mockServer({ list: [demo, sample] });
    renderAt("/workspaces");
    const first = await screen.findByRole("button", { name: "demo" });
    const second = await screen.findByRole("button", { name: "acme-shop" });

    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.click(second);
    await waitFor(() => expect(second.getAttribute("aria-expanded")).toBe("true"));
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the card named in the address, so a link can point at it", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces?open=demo");
    expect(await screen.findByRole("region", { name: "demo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "demo" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking the delete button does not also open the card", async () => {
    mockServer({ list: [demo] });
    renderAt("/workspaces");
    const card = within(await screen.findByRole("listitem", { name: "Workspace demo" }));
    fireEvent.click(card.getByRole("button", { name: "Delete demo" }));
    expect(card.getByRole("button", { name: "demo" }).getAttribute("aria-expanded")).toBe("false");
    expect(await card.findByRole("group", { name: "Confirm deleting demo" })).toBeTruthy();
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
    expect(await screen.findByRole("button", { name: "code" })).toBeTruthy();
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
