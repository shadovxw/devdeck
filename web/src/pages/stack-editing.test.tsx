import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { RunStatus, StackDef, WorkspaceSummary } from "../lib/types";
import { useUi } from "../store/ui";

const summary = (id: string, source: "local" | "example"): WorkspaceSummary => ({
  id,
  name: id,
  source,
  root: "~/code",
  repos: 1,
  stacks: 1,
  flows: 0,
  errors: 0,
  warnings: 0,
});

const full: StackDef = { name: "full", description: "Everything.", services: [{ id: "api", kind: "go", port: 8080 }] };
const fullYAML = "version: 1\nname: full\nservices:\n  - id: api\n    repo: api\n    kind: go\n    port: 8080\n";
const newYAML = "version: 1\nname: extra\nservices:\n  - id: web\n    repo: api\n    kind: go\n";

const refusedIssue = { file: "stacks/extra.yaml", line: 5, severity: "error", message: 'There is no repo with id "ghost".' };

type Call = { method: string; url: string; body?: { yaml?: string; kind?: string; workspace_id?: string } };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.endsWith(suffix));

type Server = {
  sample?: boolean;
  runs?: RunStatus[];
  /** What PUT/POST answer instead of success. */
  saveError?: { status: number; body: unknown };
};

function mockServer(opts: Server = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "");
      const id = opts.sample ? "sample" : "demo";

      if (path === "/health") return Promise.resolve(Response.json({ status: "ok", version: "test" }));
      if (path === "/workspaces") return Promise.resolve(Response.json([summary(id, opts.sample ? "example" : "local")]));
      if (path === `/workspaces/${id}`) {
        return Promise.resolve(
          Response.json({
            ...summary(id, opts.sample ? "example" : "local"),
            workspace: { name: id, root: "~/code", repos: [{ id: "api", path: "api" }] },
            stacks: [full],
            flows: [],
            issues: [],
          }),
        );
      }
      if (path === "/runs") return Promise.resolve(Response.json(opts.runs ?? []));
      if (path === "/workspaces/validate") {
        const bad = String(body?.yaml).includes("ghost");
        return Promise.resolve(Response.json(bad ? { valid: false, issues: [refusedIssue] } : { valid: true, issues: [] }));
      }
      if (path === `/workspaces/${id}/stacks/full/file`) return Promise.resolve(Response.json({ yaml: fullYAML }));
      if (path === `/workspaces/${id}/stacks` && method === "POST") {
        if (opts.saveError) return Promise.resolve(Response.json(opts.saveError.body, { status: opts.saveError.status }));
        return Promise.resolve(Response.json({ name: "extra", file: "stacks/extra.yaml", issues: [] }, { status: 201 }));
      }
      if (path === `/workspaces/${id}/stacks/full` && method === "PUT") {
        if (opts.saveError) return Promise.resolve(Response.json(opts.saveError.body, { status: opts.saveError.status }));
        return Promise.resolve(Response.json({ name: "full", file: "stacks/full.yaml", issues: [] }));
      }
      if (path === `/workspaces/${id}/stacks/full` && method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }),
  );
}

function renderStacks(workspace?: string) {
  const router = createMemoryRouter(routes, { initialEntries: [workspace ? `/stacks?workspace=${workspace}` : "/stacks"] });
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
  calls.length = 0;
});

const editor = () => screen.findByRole("dialog");
const textbox = (dialog: HTMLElement) => within(dialog).getByRole("textbox", { name: "Stack file" }) as HTMLTextAreaElement;
const saveButton = (dialog: HTMLElement, name: RegExp) => within(dialog).getByRole("button", { name }) as HTMLButtonElement;

/** A File whose text() works in jsdom. */
function fileOf(text: string, name = "extra.yaml") {
  const f = new File([text], name, { type: "application/x-yaml" });
  f.text = () => Promise.resolve(text);
  return f;
}

describe("adding a stack", () => {
  it("starts from a template that names a repo of the workspace", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: /Add stack/ }));

    const dialog = await editor();
    expect(within(dialog).getByRole("heading", { name: "Add a stack" })).toBeTruthy();
    expect(textbox(dialog).value).toContain("repo: api");
    expect(textbox(dialog).value).toContain("name: my-stack");
  });

  it("fills the editor from an uploaded file, checks it, and saves it as it is", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: /Add stack/ }));
    const dialog = await editor();

    fireEvent.change(within(dialog).getByLabelText("Stack file", { selector: "input" }), { target: { files: [fileOf(newYAML)] } });
    await waitFor(() => expect(textbox(dialog).value).toBe(newYAML));

    // it is checked against this workspace's repos, once typing has stopped
    await waitFor(() => expect(sent("POST", "/workspaces/validate").some((c) => c.body?.yaml === newYAML && c.body?.kind === "stack" && c.body?.workspace_id === "demo")).toBe(true));
    await waitFor(() => expect(saveButton(dialog, /Add stack/).disabled).toBe(false));

    fireEvent.click(saveButton(dialog, /Add stack/));
    await waitFor(() => expect(sent("POST", "/workspaces/demo/stacks")).toHaveLength(1));
    expect(sent("POST", "/workspaces/demo/stacks")[0].body).toEqual({ yaml: newYAML });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("won't save a file with errors, and shows them with their line", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: /Add stack/ }));
    const dialog = await editor();

    fireEvent.change(textbox(dialog), { target: { value: newYAML.replace("repo: api", "repo: ghost") } });
    expect(await within(dialog).findByText(/no repo with id "ghost"/)).toBeTruthy();
    expect(within(dialog).getByText("line 5")).toBeTruthy();
    expect(saveButton(dialog, /Add stack/).disabled).toBe(true);
    expect(sent("POST", "/workspaces/demo/stacks")).toHaveLength(0);
  });

  it("refuses a file that is too large before sending it", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: /Add stack/ }));
    const dialog = await editor();
    const before = textbox(dialog).value;

    const big = new File([new Uint8Array(512 * 1024 + 1)], "big.yaml");
    fireEvent.change(within(dialog).getByLabelText("Stack file", { selector: "input" }), { target: { files: [big] } });

    expect((await within(dialog).findByRole("alert")).textContent).toContain("too large");
    expect(textbox(dialog).value).toBe(before);
  });

  it("shows the server's reasons when it still refuses, and stays open", async () => {
    mockServer({ saveError: { status: 422, body: { message: "the stack has errors, so it wasn't saved", issues: [refusedIssue] } } });
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: /Add stack/ }));
    const dialog = await editor();

    fireEvent.change(textbox(dialog), { target: { value: newYAML } });
    await waitFor(() => expect(saveButton(dialog, /Add stack/).disabled).toBe(false));
    fireEvent.click(saveButton(dialog, /Add stack/));

    expect(await within(dialog).findByText(/no repo with id "ghost"/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says when the name is already taken", async () => {
    mockServer({ saveError: { status: 409, body: { message: "a stack with that name already exists in this workspace" } } });
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: /Add stack/ }));
    const dialog = await editor();

    fireEvent.change(textbox(dialog), { target: { value: newYAML } });
    await waitFor(() => expect(saveButton(dialog, /Add stack/).disabled).toBe(false));
    fireEvent.click(saveButton(dialog, /Add stack/));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("already exists");
  });

  it("is not offered for a sample workspace", async () => {
    mockServer({ sample: true });
    renderStacks("sample");
    const add = (await screen.findByRole("button", { name: /Add stack/ })) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toMatch(/Sample workspaces/);
    const card = within(await screen.findByRole("region", { name: "Stack full" }));
    expect(card.queryByRole("button", { name: /Edit full/ })).toBeNull();
    expect(card.queryByRole("button", { name: /Delete full/ })).toBeNull();
  });
});

describe("editing a stack", () => {
  it("loads the file, saves only a change, and writes it back to the same stack", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: "Edit full" }));
    const dialog = await editor();

    await waitFor(() => expect(textbox(dialog).value).toBe(fullYAML));
    expect(saveButton(dialog, /Save changes/).disabled).toBe(true); // nothing changed yet

    const changed = fullYAML.replace("8080", "9090");
    fireEvent.change(textbox(dialog), { target: { value: changed } });
    await waitFor(() => expect(saveButton(dialog, /Save changes/).disabled).toBe(false));
    fireEvent.click(saveButton(dialog, /Save changes/));

    await waitFor(() => expect(sent("PUT", "/workspaces/demo/stacks/full")).toHaveLength(1));
    expect(sent("PUT", "/workspaces/demo/stacks/full")[0].body).toEqual({ yaml: changed });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("explains that a rename isn't allowed", async () => {
    mockServer({ saveError: { status: 422, body: { message: "a stack can't be renamed here: delete it and add it again with the new name" } } });
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: "Edit full" }));
    const dialog = await editor();
    await waitFor(() => expect(textbox(dialog).value).toBe(fullYAML));

    fireEvent.change(textbox(dialog), { target: { value: fullYAML.replace("name: full", "name: other") } });
    await waitFor(() => expect(saveButton(dialog, /Save changes/).disabled).toBe(false));
    fireEvent.click(saveButton(dialog, /Save changes/));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("can't be renamed");
  });

  it("can't be edited or deleted while the stack runs", async () => {
    const running: RunStatus = {
      workspace: "demo",
      stack: "full",
      state: "running",
      started_at: new Date().toISOString(),
      services: [{ id: "api", kind: "go", state: "ready", restarts: 0, port: 8080 }],
    };
    mockServer({ runs: [running] });
    renderStacks();
    const card = within(await screen.findByRole("region", { name: "Stack full" }));
    await waitFor(() => expect((card.getByRole("button", { name: "Edit full" }) as HTMLButtonElement).disabled).toBe(true));
    expect((card.getByRole("button", { name: "Delete full" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("deleting a stack", () => {
  it("asks first, and only then deletes", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: "Delete full" }));

    const confirm = within(await screen.findByRole("group", { name: "Confirm deleting full" }));
    expect(confirm.getByText(/trash folder/)).toBeTruthy();
    expect(sent("DELETE", "/workspaces/demo/stacks/full")).toHaveLength(0);

    fireEvent.click(confirm.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sent("DELETE", "/workspaces/demo/stacks/full")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Confirm deleting full" })).toBeNull());
  });

  it("changes nothing when cancelled", async () => {
    mockServer();
    renderStacks();
    fireEvent.click(await screen.findByRole("button", { name: "Delete full" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Confirm deleting full" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("group", { name: "Confirm deleting full" })).toBeNull();
    expect(sent("DELETE", "/workspaces/demo/stacks/full")).toHaveLength(0);
  });
});
