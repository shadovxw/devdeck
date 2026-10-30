import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { BuildRecord, DockerAccount, DockerOverview, ImageRow } from "../lib/docker";
import { ago, took } from "../lib/time";
import { useUi } from "../store/ui";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.split("?")[0].endsWith(suffix));

const account = (id: string, over: Partial<DockerAccount> = {}): DockerAccount => ({ id, username: `${id}-user`, registry: "docker.io", namespaces: [], token_set: true, ...over });

const image = (over: Partial<ImageRow> = {}): ImageRow => ({
  workspace: "demo",
  workspace_name: "demo",
  repo: "api",
  image: "api",
  repository: "acme/demo-api",
  dockerfile: "Dockerfile",
  context: ".",
  platforms: ["linux/amd64"],
  path: "C:/code/api",
  secrets: [],
  account: "work",
  branch: "main",
  commit: "abcdef1234567890",
  dirty: false,
  folder_missing: false,
  ...over,
});

const build = (id: number, over: Partial<BuildRecord> = {}): BuildRecord => ({
  id,
  at: new Date(Date.now() - 5 * 60_000).toISOString(),
  workspace: "demo",
  repo: "api",
  image: "api",
  repository: "acme/demo-api",
  tag: "1.0.3",
  revision: "abcdef1234567890",
  dirty: false,
  account: "work",
  ok: true,
  seconds: 95,
  ...over,
});

function ndjson(lines: object[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const enc = new TextEncoder();
      for (const l of lines) ctrl.enqueue(enc.encode(JSON.stringify(l) + "\n"));
      ctrl.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}

type Server = {
  docker?: Partial<DockerOverview>;
  images?: ImageRow[];
  builds?: BuildRecord[];
  checkError?: string;
  // what POST .../build answers: a stream, or a refusal
  buildAnswer?: (body: { tag: string; overwrite: boolean }) => Response;
  yaml?: string;
  invalid?: boolean;
  saveError?: string;
};

function mockServer(opts: Server = {}) {
  let docker: DockerOverview = { accounts: [account("work", { namespaces: ["acme"] })], build_secrets: [{ name: "npm-token", value_set: true }], docker_installed: true, ...opts.docker };
  let builds = opts.builds ?? [];
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
      if (path === "/workspaces" && method === "GET") return json([{ id: "demo", name: "demo", source: "local", root: "~/code", repos: 1, stacks: 0, flows: 0, errors: 0, warnings: 0 }]);
      if (path === "/workspaces/demo" && method === "GET") return json({ id: "demo", name: "demo", source: "local", repos: 1, errors: 0, warnings: 0, workspace: { name: "demo", repos: [] }, stacks: [], flows: [], issues: [] });
      if (path === "/workspaces/demo/file") return json({ yaml: opts.yaml ?? "version: 1\nname: demo\nroot: ~/code\nrepos: []\n" });
      if (path === "/workspaces/validate") return opts.invalid ? json({ valid: false, issues: [{ file: "workspace.yaml", line: 3, severity: "error", message: "root is required" }] }) : json({ valid: true, issues: [] });
      if (path === "/workspaces/demo" && method === "PUT") return opts.saveError ? json({ message: opts.saveError }, 409) : json({ id: "demo", name: "demo" });

      if (path === "/docker") return json(docker);
      if (path.startsWith("/docker/accounts/")) {
        const rest = path.slice("/docker/accounts/".length).split("/");
        const id = rest[0];
        if (rest[1] === "token" && method === "PUT") {
          docker = { ...docker, accounts: docker.accounts.map((a) => (a.id === id ? { ...a, token_set: true } : a)) };
          return empty();
        }
        if (rest[1] === "token" && method === "DELETE") {
          docker = { ...docker, accounts: docker.accounts.map((a) => (a.id === id ? { ...a, token_set: false } : a)) };
          return empty();
        }
        if (rest[1] === "check") return opts.checkError ? json({ message: opts.checkError }, 502) : json({ username: "work-user", namespaces: ["work-user", "acme"] });
        if (method === "PUT") {
          docker = { ...docker, accounts: [...docker.accounts, account(id, { username: body.username, namespaces: body.namespaces, token_set: false })] };
          return json(docker);
        }
        if (method === "DELETE") {
          docker = { ...docker, accounts: docker.accounts.filter((a) => a.id !== id) };
          return empty();
        }
      }
      if (path.startsWith("/docker/secrets/")) {
        const name = decodeURIComponent(path.slice("/docker/secrets/".length));
        if (method === "PUT") {
          docker = { ...docker, build_secrets: [...docker.build_secrets.filter((s) => s.name !== name), { name, value_set: true }] };
          return empty();
        }
        docker = { ...docker, build_secrets: docker.build_secrets.filter((s) => s.name !== name) };
        return empty();
      }

      if (path === "/images" && method === "GET") return json(opts.images ?? [image()]);
      if (path === "/images/builds" && method === "GET") return json(builds);
      if (path === "/images/builds" && method === "DELETE") {
        builds = [];
        return empty();
      }
      if (path.endsWith("/build") && method === "POST") {
        return Promise.resolve((opts.buildAnswer ?? (() => ndjson([{ line: "#1 building" }, { line: "#2 pushing" }, { done: true, ok: true }])))(body));
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

describe("the Docker Hub page", () => {
  it("lists the accounts with their token state, and the build secrets by name", async () => {
    mockServer({ docker: { accounts: [account("work", { namespaces: ["acme", "acme-labs"] }), account("me", { token_set: false })] } });
    renderAt("/connections/docker");
    const row = within((await screen.findByText("work-user")).closest("tr") as HTMLElement);
    expect(row.getByText("acme, acme-labs")).toBeTruthy();
    expect(row.getByText("Token saved")).toBeTruthy();
    const other = within(screen.getByText("me-user").closest("tr") as HTMLElement);
    expect(other.getByText("No token yet")).toBeTruthy();
    expect(other.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.getByText("npm-token")).toBeTruthy();
    expect(screen.getByText("Value saved")).toBeTruthy();
  });

  it("says when Docker isn't installed and when there is no account", async () => {
    mockServer({ docker: { accounts: [], build_secrets: [], docker_installed: false } });
    renderAt("/connections/docker");
    expect(await screen.findByText(/Docker isn’t installed/)).toBeTruthy();
    expect(screen.getByText("No account yet. Add one to push images.")).toBeTruthy();
    expect(screen.getByText("No build secrets yet.")).toBeTruthy();
  });

  it("adds an account, with the organisations as a list", async () => {
    mockServer({ docker: { accounts: [], build_secrets: [] } });
    renderAt("/connections/docker");
    const form = within(await screen.findByRole("form", { name: "Add an account" }));
    expect((form.getByRole("button", { name: "Add account" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(form.getByPlaceholderText("work"), { target: { value: "work" } });
    fireEvent.change(form.getByPlaceholderText("username"), { target: { value: "ana-work" } });
    fireEvent.change(form.getByPlaceholderText("acme, acme-labs"), { target: { value: "acme, acme-labs  other" } });
    fireEvent.click(form.getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(sent("PUT", "/docker/accounts/work")).toHaveLength(1));
    expect(sent("PUT", "/docker/accounts/work")[0].body).toEqual({ username: "ana-work", namespaces: ["acme", "acme-labs", "other"] });
    expect(await screen.findByText("No token yet")).toBeTruthy();
    expect((form.getByPlaceholderText("work") as HTMLInputElement).value).toBe("");
  });

  it("saves a token from a password field and never keeps it", async () => {
    mockServer({ docker: { accounts: [account("work", { token_set: false })] } });
    renderAt("/connections/docker");
    fireEvent.click(await screen.findByRole("button", { name: "Add token" }));
    const input = screen.getByLabelText("Access token for work") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "dckr_pat_fake_value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    await waitFor(() => expect(sent("PUT", "/docker/accounts/work/token")).toHaveLength(1));
    expect(sent("PUT", "/docker/accounts/work/token")[0].body).toEqual({ token: "dckr_pat_fake_value" });
    expect(await screen.findByText("Token saved")).toBeTruthy();
    expect(screen.queryByLabelText("Access token for work")).toBeNull();
    expect(document.body.innerHTML).not.toContain("dckr_pat_fake_value");
  });

  it("tests an account, and forgets its token", async () => {
    mockServer();
    renderAt("/connections/docker");
    fireEvent.click(await screen.findByRole("button", { name: "Test" }));
    expect(await screen.findByText("Signed in as work-user. Can push to: work-user, acme.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget token" }));
    expect(await screen.findByText("No token yet")).toBeTruthy();
    expect(sent("DELETE", "/token")).toHaveLength(1);
  });

  it("shows why a test failed", async () => {
    mockServer({ checkError: "Docker Hub refused the username or token" });
    renderAt("/connections/docker");
    fireEvent.click(await screen.findByRole("button", { name: "Test" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Docker Hub refused the username or token");
  });

  it("removes an account only after a second click", async () => {
    mockServer();
    renderAt("/connections/docker");
    fireEvent.click(await screen.findByRole("button", { name: "Remove work" }));
    expect(sent("DELETE", "/docker/accounts/work")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove work" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sent("DELETE", "/docker/accounts/work")).toHaveLength(1));
    expect(await screen.findByText("No account yet. Add one to push images.")).toBeTruthy();
  });

  it("saves a build secret from a password field, then removes it after a second click", async () => {
    mockServer({ docker: { build_secrets: [] } });
    renderAt("/connections/docker");
    const form = within(await screen.findByRole("form", { name: "Save a build secret" }));
    const value = form.getByPlaceholderText("the secret") as HTMLInputElement;
    expect(value.type).toBe("password");
    fireEvent.change(form.getByPlaceholderText("npm-token"), { target: { value: "gh-pkg" } });
    fireEvent.change(value, { target: { value: "ghp_fake_secret_1" } });
    fireEvent.click(form.getByRole("button", { name: "Save secret" }));
    await waitFor(() => expect(sent("PUT", "/docker/secrets/gh-pkg")).toHaveLength(1));
    expect(sent("PUT", "/docker/secrets/gh-pkg")[0].body).toEqual({ value: "ghp_fake_secret_1" });
    expect(await screen.findByText("Value saved")).toBeTruthy();
    expect(value.value).toBe("");
    expect(document.body.innerHTML).not.toContain("ghp_fake_secret_1");

    fireEvent.click(screen.getByRole("button", { name: "Remove gh-pkg" }));
    expect(sent("DELETE", "/docker/secrets/gh-pkg")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sent("DELETE", "/docker/secrets/gh-pkg")).toHaveLength(1));
  });

  it("is reachable from the Connections page, with its state", async () => {
    mockServer();
    renderAt("/connections");
    const link = await within(await screen.findByRole("main")).findByRole("link", { name: /Docker Hub/ });
    expect(link.getAttribute("href")).toBe("/connections/docker");
    expect(await within(link).findByText("1 account")).toBeTruthy();
  });
});

describe("the Images page", () => {
  it("shows each image with its account, repository state, secrets and last build", async () => {
    mockServer({
      images: [
        image({
          dirty: true,
          secrets: [
            { id: "gh_token", from: "github" },
            { id: "npm_token", from: "keyring", name: "npm-token", problem: "no value is saved under the name npm-token" },
          ],
          last: build(1),
        }),
      ],
    });
    renderAt("/images");
    const card = within(await screen.findByRole("region", { name: "Image acme/demo-api" }));
    expect(card.getByText("Pushed with work")).toBeTruthy();
    expect(card.getByText(/main at abcdef1/)).toBeTruthy();
    expect(card.getByText(/uncommitted changes/)).toBeTruthy();
    expect(card.getByText("gh_token from GitHub account")).toBeTruthy();
    expect(card.getByText("npm_token from keychain (npm-token)")).toBeTruthy();
    expect(card.getByText(/1\.0\.3 · 5 min ago · Pushed/)).toBeTruthy();
    // a secret that can't be found stops the build, and says where to fix it
    expect(card.getByText(/no value is saved under the name npm-token/)).toBeTruthy();
    expect((card.getByRole("button", { name: "Build and push" }) as HTMLButtonElement).disabled).toBe(true);
    expect(card.getByRole("link", { name: "Docker Hub page" }).getAttribute("href")).toBe("/connections/docker");
  });

  it("blocks an image with no account, or whose folder isn't here", async () => {
    mockServer({
      images: [
        image({ account: undefined, problem: 'no Docker account on this machine owns the namespace "other"' }),
        image({ image: "ghost", repository: "acme/ghost", folder_missing: true, branch: undefined, commit: undefined }),
      ],
    });
    renderAt("/images");
    expect(await screen.findByText(/owns the namespace "other"/)).toBeTruthy();
    expect(screen.getByText("No account")).toBeTruthy();
    expect(screen.getByText("The repository isn’t on this machine.")).toBeTruthy();
    for (const input of screen.getAllByPlaceholderText("tag, for example 1.0.4")) expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it("explains the empty state", async () => {
    mockServer({ images: [] });
    renderAt("/images");
    expect(await screen.findByText("No images yet")).toBeTruthy();
  });

  it("only takes a tag docker accepts", async () => {
    mockServer();
    renderAt("/images");
    const input = await screen.findByPlaceholderText("tag, for example 1.0.4");
    const button = screen.getByRole("button", { name: "Build and push" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    for (const bad of ["1.0:x", "a b", "-x", "x".repeat(129)]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(button.disabled, bad).toBe(true);
    }
    fireEvent.change(input, { target: { value: "1.0.4" } });
    expect(button.disabled).toBe(false);
  });

  it("asks first, then builds and shows the output and the result", async () => {
    mockServer({ images: [image({ dirty: true })] });
    renderAt("/images");
    fireEvent.change(await screen.findByPlaceholderText("tag, for example 1.0.4"), { target: { value: "1.0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Build and push" }));

    const confirm = within(screen.getByRole("group", { name: "Confirm the build" }));
    expect(confirm.getByText(/acme\/demo-api:1\.0\.4/)).toBeTruthy();
    expect(confirm.getByText(/main at abcdef1/)).toBeTruthy();
    expect(confirm.getByText(/uncommitted changes, and the image is built from them/)).toBeTruthy();
    expect(sent("POST", "/build")).toHaveLength(0);

    fireEvent.click(confirm.getByRole("button", { name: "Build and push" }));
    const log = await screen.findByRole("log", { name: "Build output" });
    await waitFor(() => expect(log.textContent).toContain("#2 pushing"));
    expect(await screen.findByText("Pushed acme/demo-api:1.0.4")).toBeTruthy();
    expect(sent("POST", "/build")[0].url).toBe("/api/v1/images/demo/api/api/build");
    expect(sent("POST", "/build")[0].body).toEqual({ tag: "1.0.4", overwrite: false });
  });

  it("can be cancelled before anything is sent", async () => {
    mockServer();
    renderAt("/images");
    fireEvent.change(await screen.findByPlaceholderText("tag, for example 1.0.4"), { target: { value: "1.0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Build and push" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm the build" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm the build" })).toBeNull();
    expect(sent("POST", "/build")).toHaveLength(0);
  });

  it("asks again before pushing over a tag that exists", async () => {
    mockServer({
      buildAnswer: (b) =>
        b.overwrite
          ? ndjson([{ line: "pushing over it" }, { done: true, ok: true }])
          : Response.json({ message: "acme/demo-api:1.0.3 already exists on Docker Hub: building pushes over it.", exists: true }, { status: 409 }),
    });
    renderAt("/images");
    fireEvent.change(await screen.findByPlaceholderText("tag, for example 1.0.4"), { target: { value: "1.0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Build and push" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm the build" })).getByRole("button", { name: "Build and push" }));

    const exists = within(await screen.findByRole("group", { name: "The tag already exists" }));
    expect(exists.getByText(/already exists on Docker Hub/)).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
    fireEvent.click(exists.getByRole("button", { name: "Push over it" }));
    expect(await screen.findByText("Pushed acme/demo-api:1.0.3")).toBeTruthy();
    expect(sent("POST", "/build").map((c) => (c.body as { overwrite: boolean }).overwrite)).toEqual([false, true]);
  });

  it("shows a refusal and a failed build in words", async () => {
    let n = 0;
    mockServer({
      buildAnswer: () =>
        n++ === 0
          ? Response.json({ message: "the build secret “gh_token”: no GitHub account rule matches this repository" }, { status: 409 })
          : ndjson([{ line: "denied: requested access to the resource is denied" }, { done: true, ok: false, error: "Docker Hub refused the push: the account can’t write to this repository." }]),
    });
    renderAt("/images");
    const run = async (tag: string) => {
      fireEvent.change(await screen.findByPlaceholderText("tag, for example 1.0.4"), { target: { value: tag } });
      fireEvent.click(screen.getByRole("button", { name: "Build and push" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Confirm the build" })).getByRole("button", { name: "Build and push" }));
    };
    await run("2.0");
    expect(await screen.findByText(/no GitHub account rule matches/)).toBeTruthy();
    await run("2.1");
    expect(await screen.findByText(/Failed: Docker Hub refused the push/)).toBeTruthy();
    expect(screen.getByRole("log").textContent).toContain("denied: requested access");
  });

  it("lists the build history, and clears it after a second click", async () => {
    mockServer({ builds: [build(2, { tag: "1.0.4", ok: false, error: "denied", revision: undefined, dirty: true }), build(1)] });
    renderAt("/images");
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("acme/demo-api:1.0.4")).toBeTruthy();
    expect(table.getByText("acme/demo-api:1.0.3")).toBeTruthy();
    expect(table.getByText("Failed")).toBeTruthy();
    expect(table.getByText("Pushed")).toBeTruthy();
    expect(table.getByText("abcdef1")).toBeTruthy();
    expect(table.getAllByText("1 min 35 s")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
    expect(sent("DELETE", "/images/builds")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(sent("DELETE", "/images/builds")).toHaveLength(1));
    expect(await screen.findByText("Nothing has been built yet.")).toBeTruthy();
  });
});

describe("editing a workspace", () => {
  async function openEditor() {
    renderAt("/workspaces");
    fireEvent.click(await screen.findByRole("button", { name: "Edit demo" }));
    return (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  }

  it("opens the file as text and saves a change", async () => {
    mockServer();
    const box = await openEditor();
    expect(box.value).toContain("name: demo");
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet

    fireEvent.change(box, { target: { value: box.value + "# more\n" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(sent("PUT", "/workspaces/demo")).toHaveLength(1));
    expect((sent("PUT", "/workspaces/demo")[0].body as { yaml: string }).yaml).toContain("# more");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull()); // the drawer closes once it is saved
  });

  it("doesn't save a file with errors, and lists them", async () => {
    mockServer({ invalid: true });
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "version: 1\n" } });
    expect(await screen.findByText(/root is required/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true));
    expect(sent("PUT", "/workspaces/demo")).toHaveLength(0);
  });

  it("shows why a save was refused", async () => {
    mockServer({ saveError: "a workspace can’t be renamed here" });
    const box = await openEditor();
    fireEvent.change(box, { target: { value: box.value + "# x\n" } });
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toContain("a workspace can’t be renamed here");
  });
});

describe("time helpers", () => {
  it("says how long ago and how long it took", () => {
    const now = Date.parse("2026-10-30T10:00:00Z");
    expect(ago(new Date(now - 90_000).toISOString(), now)).toBe("1 min ago");
    expect(took(5)).toBe("5 s");
    expect(took(59.6)).toBe("1 min 0 s");
    expect(took(95)).toBe("1 min 35 s");
    expect(took(3725)).toBe("62 min 5 s");
  });
});
