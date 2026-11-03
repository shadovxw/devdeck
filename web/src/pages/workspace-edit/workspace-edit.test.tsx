import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../../app/routes";
import { useUi } from "../../store/ui";

// CodeMirror needs a real browser's layout, so the page is tested with a plain textarea standing in for the
// editor (and a <pre> for the diff). What the editor itself does is tested in cm-schema and yaml-doc.
vi.mock("./YamlEditor", () => ({
  default: (props: { value: string; onChange: (v: string) => void; onCursor: (c: { line: number; col: number }) => void; readOnly?: boolean; initialLine?: number }) => (
    <textarea
      aria-label="workspace.yaml"
      value={props.value}
      readOnly={props.readOnly}
      data-initial-line={props.initialLine}
      onChange={(e) => props.onChange(e.target.value)}
      onClick={() => props.onCursor({ line: 6, col: 1 })}
    />
  ),
}));
vi.mock("./DiffView", () => ({
  default: (props: { original: string; modified: string }) => (
    <pre aria-label="diff">
      {props.original}
      {"\n=====\n"}
      {props.modified}
    </pre>
  ),
}));

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.split("?")[0].endsWith(suffix));

const START = "version: 1\nname: demo\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n    type: go\n  - id: infra\n    path: infra\n";
const hashOf = (text: string) => `h${text.length}:${text.slice(-16)}`;

type Server = { source?: "local" | "example"; saveError?: string };
let disk = START;

function mockServer(opts: Server = {}) {
  disk = START;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      const empty = (status = 204) => Promise.resolve(new Response(null, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/runs") return json([]);
      if (path === "/ui/state") return empty();
      if (path === "/hosts") return json([]);
      if (path === "/workspaces" && method === "GET") return json([]);
      if (path === "/workspaces/demo" && method === "GET")
        return json({
          id: "demo",
          name: "demo",
          source: opts.source ?? "local",
          repos: 2,
          errors: 0,
          warnings: 0,
          workspace: { name: "demo", root: "~/code" },
          stacks: [{ name: "backend", compose: [{ repo: "api", file: "docker-compose.yml" }] }],
          flows: [],
          issues: [],
        });
      if (path === "/workspaces/demo/file") return json({ yaml: disk, hash: hashOf(disk), path: "C:\\code\\demo\\workspace.yaml" });
      if (path === "/schema/workspace") return json({ type: "object" });
      if (path === "/git/repos")
        return json([
          {
            workspace: "demo",
            repo: "api",
            path: "C:/code/api",
            remote: "github.com/acme/demo-api",
            connection: "work",
            expected: { name: "", email: "" },
            actual: { name: "", email: "" },
            state: "ok",
            work: { branch: "main", detached: false, upstream: "", ahead: 0, behind: 0, changed: 0 },
          },
        ]);
      if (path === "/workspaces/validate") {
        const text = String(body.yaml);
        if (text.includes("INVALID")) return json({ valid: false, issues: [{ file: "workspace.yaml", line: 1, severity: "error", message: "root is required" }] });
        const at = text.split("\n").findIndex((l) => l.includes("path: infra"));
        const warned = at >= 0 && !text.includes("local_only");
        return json({
          valid: true,
          issues: warned
            ? [
                {
                  file: "workspace.yaml",
                  path: "/repos/1/path",
                  line: at + 1,
                  severity: "warning",
                  message: "This folder isn't a git repository (no .git inside).",
                  code: "repo-not-git",
                  fixes: [
                    { id: "mark-local-only", label: "Mark local_only: true", kind: "edit" },
                    { id: "git-init", label: "Run git init", kind: "action" },
                  ],
                },
              ]
            : [],
        });
      }
      if (path === "/workspaces/demo" && method === "PUT") {
        if (opts.saveError) return json({ message: opts.saveError }, 422);
        if (body.base_hash !== hashOf(disk)) return json({ message: "workspace.yaml changed on disk after you opened it", yaml: disk, hash: hashOf(disk) }, 409);
        disk = String(body.yaml);
        return json({ id: "demo", name: "demo", hash: hashOf(disk) });
      }
      if (path === "/workspaces/demo/repos/infra/git-init" && method === "POST") return empty();
      return json({ message: `unexpected ${method} ${path}` }, 404);
    }),
  );
}

function renderEditor(path = "/workspaces/demo/edit") {
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

const editor = async () => (await screen.findByLabelText("workspace.yaml")) as HTMLTextAreaElement;
const reviewButton = () => screen.getByRole("button", { name: /Review & save/ }) as HTMLButtonElement;

describe("the workspace.yaml editor", () => {
  it("opens the file with its outline, its problems and their fixes", async () => {
    mockServer();
    renderEditor();
    const box = await editor();
    expect(box.value).toBe(START);

    const outline = within(screen.getByRole("navigation", { name: "Outline" }));
    expect(outline.getByRole("button", { name: "repos" })).toBeTruthy();
    expect(outline.getByRole("button", { name: /^api$/ })).toBeTruthy();
    expect(outline.getByRole("button", { name: /^infra/ })).toBeTruthy();
    expect(outline.getByText("stacks/backend.yaml")).toBeTruthy();

    const problems = within(await screen.findByRole("complementary", { name: "Inspector" }));
    expect(await problems.findByText(/isn't a git repository/)).toBeTruthy();
    expect(problems.getByRole("button", { name: "Mark local_only: true" })).toBeTruthy();
    expect(problems.getByRole("button", { name: "Run git init" })).toBeTruthy();
    expect(reviewButton().disabled).toBe(true); // nothing changed yet
  });

  it("shows the repo at the cursor, checked against the machine", async () => {
    mockServer();
    renderEditor();
    fireEvent.click(await editor());
    const inspector = within(screen.getByRole("complementary", { name: "Inspector" }));
    expect(await inspector.findByText("main")).toBeTruthy(); // the branch
    expect(inspector.getByText("backend")).toBeTruthy(); // the stack that uses it
    expect(inspector.getByText("github.com/acme/demo-api")).toBeTruthy();
    expect(inspector.getByText("work")).toBeTruthy();
  });

  it("fixes a problem in the text without reformatting the rest, then reviews and saves it", async () => {
    mockServer();
    renderEditor();
    const box = await editor();
    fireEvent.click(await screen.findByRole("button", { name: "Mark local_only: true" }));

    await waitFor(() => expect(box.value).toContain("    path: infra\n    local_only: true\n"));
    expect(box.value.replace("    local_only: true\n", "")).toBe(START);
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    await waitFor(() => expect(screen.queryByText(/isn't a git repository/)).toBeNull());

    fireEvent.click(reviewButton());
    const dialog = within(await screen.findByRole("dialog"));
    expect((await dialog.findByLabelText("diff")).textContent).toContain("local_only: true");
    await waitFor(() => expect((dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent("PUT", "/workspaces/demo")).toHaveLength(1));
    expect(sent("PUT", "/workspaces/demo")[0].body).toEqual({ yaml: box.value, base_hash: hashOf(START) });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/saved/)).toBeTruthy();
    expect(reviewButton().disabled).toBe(true);
  });

  it("doesn't save a file with errors", async () => {
    mockServer();
    renderEditor();
    fireEvent.change(await editor(), { target: { value: "INVALID\n" } });
    fireEvent.click(await waitFor(() => (reviewButton().disabled ? Promise.reject(new Error("still disabled")) : reviewButton())));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(/Fix the errors first/)).toBeTruthy();
    expect((dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sent("PUT", "/workspaces/demo")).toHaveLength(0);
  });

  it("shows why a save was refused and keeps the dialog open", async () => {
    mockServer({ saveError: "a workspace can’t be renamed here" });
    renderEditor();
    fireEvent.change(await editor(), { target: { value: START + "# note\n" } });
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    fireEvent.click(reviewButton());
    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect((dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("a workspace can’t be renamed here");
  });

  it("never overwrites a file that changed: it offers Compare and Reload instead", async () => {
    mockServer();
    renderEditor();
    const box = await editor();
    fireEvent.change(box, { target: { value: START + "# mine\n" } });
    await waitFor(() => expect(reviewButton().disabled).toBe(false));

    disk = START + "# theirs\n"; // someone else saves while this is open
    fireEvent.click(reviewButton());
    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect((dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("changed on disk");
    expect(disk).toBe(START + "# theirs\n");

    fireEvent.click(within(banner).getByRole("button", { name: "Compare" }));
    const compare = within(await screen.findByRole("dialog"));
    expect((await compare.findByLabelText("diff")).textContent).toContain("# theirs");
    fireEvent.click(compare.getByRole("button", { name: "Reload from disk" }));

    await waitFor(() => expect(box.value).toBe(START + "# theirs\n"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(reviewButton().disabled).toBe(true);
  });

  it("lets the edits replace a newer file when that is chosen on purpose", async () => {
    mockServer();
    renderEditor();
    const box = await editor();
    fireEvent.change(box, { target: { value: START + "# mine\n" } });
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    disk = START + "# theirs\n";
    fireEvent.click(reviewButton());
    const review = within(await screen.findByRole("dialog"));
    await waitFor(() => expect((review.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review.getByRole("button", { name: "Save" }));
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Compare" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep mine" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(box.value).toBe(START + "# mine\n");
    fireEvent.click(reviewButton());
    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect((dialog.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(disk).toBe(START + "# mine\n"));
  });

  it("notices on its own when the file changes on disk", async () => {
    mockServer();
    renderEditor();
    await editor();
    disk = START + "# changed in VS Code\n";
    expect((await screen.findByRole("alert", {}, { timeout: 8000 })).textContent).toContain("changed on disk");
  }, 15_000);

  it("runs git init only after a confirmation", async () => {
    mockServer();
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Run git init" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/Run git init in infra\?/)).toBeTruthy();
    expect(sent("POST", "/repos/infra/git-init")).toHaveLength(0);
    fireEvent.click(dialog.getByRole("button", { name: "Run git init" }));
    await waitFor(() => expect(sent("POST", "/repos/infra/git-init")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits the same file as fields in the Form view", async () => {
    mockServer();
    renderEditor();
    await editor();
    fireEvent.click(screen.getByRole("button", { name: "Form" }));
    fireEvent.change(await screen.findByLabelText("Root"), { target: { value: "~/src" } });
    fireEvent.click(screen.getByLabelText("Repo 2 local only"));
    fireEvent.change(screen.getByLabelText("Repo 1 type"), { target: { value: "node" } });
    fireEvent.click(screen.getByRole("button", { name: "Add repo" }));

    fireEvent.click(screen.getByRole("button", { name: "YAML" }));
    const text = (await editor()).value;
    expect(text).toContain("root: ~/src");
    expect(text).toMatch(/- id: infra\n\s+path: infra\n\s+local_only: true/);
    expect(text).toMatch(/- id: api\n\s+path: api\n\s+type: node/);
    expect(text).toContain('path: ""');
    expect(reviewButton().disabled).toBe(false);
  });

  it("opens at the line it is linked to from the Problems tab", async () => {
    mockServer();
    renderEditor("/workspaces/demo/edit?line=9");
    expect((await editor()).getAttribute("data-initial-line")).toBe("9");
  });

  it("opens a sample read-only", async () => {
    mockServer({ source: "example" });
    renderEditor();
    const box = await editor();
    expect(await screen.findByText(/sample, read only/)).toBeTruthy();
    expect(box.readOnly).toBe(true);
    fireEvent.change(box, { target: { value: START + "# x\n" } });
    expect(reviewButton().disabled).toBe(true);
  });

  it("asks before leaving with edits that aren't saved", async () => {
    mockServer();
    renderEditor();
    fireEvent.change(await editor(), { target: { value: START + "# note\n" } });
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Workspaces" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Leave without saving?")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await editor()).value).toContain("# note");
  });
});
