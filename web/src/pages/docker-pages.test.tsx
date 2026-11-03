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
  platforms: [],
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
  /** The remote hosts; the Deploy link after a build only shows when there is one. */
  hosts?: object[];
  /** The tags Docker Hub has, newest first; "fail" makes the request fail. */
  tags?: Array<{ name: string; pushed_at?: string; size?: number }> | "fail";
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
      if (path === "/hosts") return json(opts.hosts ?? []);
      if (path === "/workspaces" && method === "GET") return json([{ id: "demo", name: "demo", source: "local", root: "~/code", repos: 1, stacks: 0, flows: 0, errors: 0, warnings: 0 }]);
      if (path === "/workspaces/demo" && method === "GET") return json({ id: "demo", name: "demo", source: "local", repos: 1, errors: 0, warnings: 0, workspace: { name: "demo", repos: [] }, stacks: [], flows: [], issues: [] });

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
      if (path === "/images/tags") {
        if (opts.tags === "fail") return json({ message: "the tags couldn't be read from Docker Hub" }, 500);
        return json(
          (opts.images ?? [image()]).map((im) => ({ workspace: im.workspace, repo: im.repo, image: im.image, repository: im.repository, tags: opts.tags ?? [] })),
        );
      }
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
  const hours = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
  const rowOf = async (repository = "acme/demo-api") => within(await screen.findByRole("region", { name: `Image ${repository}` }));
  const tagBox = (row: ReturnType<typeof within>) => row.getByPlaceholderText("tag, for example 1.0.4") as HTMLInputElement;

  it("shows each image with where its source stands, and the latest tag on Docker Hub", async () => {
    mockServer({
      images: [image({ dirty: true, ahead: 3, last: build(1) })],
      tags: [
        { name: "1.0.95", pushed_at: hours(2), size: 412_000_000 },
        { name: "1.0.94", pushed_at: hours(72) },
      ],
    });
    renderAt("/images");
    const row = await rowOf();
    expect(row.getByText("demo-api".replace("demo-", "")).textContent).toBe("api");
    expect(row.getByText(/main/)).toBeTruthy();
    expect(row.getByText(/@ abcdef1/)).toBeTruthy();
    expect(row.getByText("3 commits since last build")).toBeTruthy();
    expect(row.getByText("uncommitted changes")).toBeTruthy();
    expect(await row.findByText("1.0.95")).toBeTruthy(); // the latest tag, and how long ago
    expect(row.getByText("2 h ago")).toBeTruthy();
    expect(sent("GET", "/images/tags")[0].url).toContain("limit=10");
  });

  it("opens the details: the tags, the build settings, the secrets, the last build and the command", async () => {
    mockServer({
      images: [
        image({
          secrets: [
            { id: "gh_token", from: "github" },
            { id: "npm_token", from: "keyring", name: "npm-token", problem: "no value is saved under the name npm-token" },
          ],
          last: build(1),
        }),
      ],
      tags: [
        { name: "1.0.95", pushed_at: hours(2), size: 412_000_000 },
        { name: "1.0.94", pushed_at: hours(72) },
      ],
    });
    renderAt("/images");
    const row = await rowOf();
    fireEvent.click(row.getByRole("button", { name: "Details of acme/demo-api" }));

    const list = within(await row.findByRole("list", { name: "Tags of acme/demo-api" }));
    expect(list.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1.0.95412 MB2 h ago", "1.0.943 d ago"]);
    expect(row.getByText("gh_token from GitHub account")).toBeTruthy();
    expect(row.getByText("npm_token from keychain (npm-token)")).toBeTruthy();
    expect(row.getByText(/1\.0\.3 · 5 min ago · Pushed/)).toBeTruthy();
    expect(row.getByText("work")).toBeTruthy();
    const command = row.getByLabelText("Command").textContent ?? "";
    expect(command).toContain("cd C:/code/api");
    expect(command).toContain("docker buildx build -t acme/demo-api:<tag> --secret id=gh_token,env=GH_TOKEN --secret id=npm_token,env=NPM_TOKEN --push .");
    expect(row.getByRole("link", { name: /Open on Docker Hub/ }).getAttribute("href")).toBe("https://hub.docker.com/r/acme/demo-api/tags");

    // a click on a tag puts it in the box, and a secret that can't be found stops the build and says where to fix it
    fireEvent.click(list.getByRole("button", { name: /^1\.0\.94/ }));
    expect(tagBox(row).disabled).toBe(true);
    expect(row.getByText(/no value is saved under the name npm-token/)).toBeTruthy();
    expect(row.getByRole("link", { name: "Docker Hub page" }).getAttribute("href")).toBe("/connections/docker");
    expect((row.getByRole("button", { name: "Push over it" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(row.getByRole("button", { name: "Details of acme/demo-api" }));
    expect(row.queryByRole("list", { name: "Tags of acme/demo-api" })).toBeNull();
  });

  it("puts a clicked tag in the box and warns when the tag typed exists on Docker Hub", async () => {
    mockServer({ tags: [{ name: "1.0.95", pushed_at: hours(2) }, { name: "1.0.94", pushed_at: hours(72) }] });
    renderAt("/images");
    const row = await rowOf();
    fireEvent.click(row.getByRole("button", { name: "Details of acme/demo-api" }));
    fireEvent.click(await row.findByRole("button", { name: /^1\.0\.94/ }));
    expect(tagBox(row).value).toBe("1.0.94");
    expect(row.getByText(/1\.0\.94 already exists on Docker Hub: pushing would replace it/)).toBeTruthy();
    // the button says what it would do
    expect((row.getByRole("button", { name: "Push over it" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(tagBox(row), { target: { value: "1.0.96" } });
    expect(row.queryByText(/already exists/)).toBeNull();
    expect(row.getByRole("button", { name: "Build & push" })).toBeTruthy();
  });

  it("says when Docker Hub has no tag yet or can't be read", async () => {
    mockServer({ tags: [] });
    renderAt("/images");
    expect(await (await rowOf()).findByText("No tag yet")).toBeTruthy();
    cleanup();

    mockServer({ tags: "fail" });
    renderAt("/images");
    expect(await (await rowOf()).findByText("Couldn’t read Docker Hub")).toBeTruthy();
  });

  it("counts the images in the summary, and filters them by text and by chip", async () => {
    const ok = build(1);
    mockServer({
      images: [
        image({ image: "api", repository: "acme/api", ahead: 2, last: ok }),
        image({ repo: "web", image: "web", repository: "acme/web", ahead: 0, last: ok, branch: "feature-x" }),
        image({ repo: "docs", image: "docs", repository: "acme/docs", dirty: true }),
      ],
    });
    renderAt("/images");
    const summary = within(await screen.findByRole("region", { name: "Summary" }));
    const num = (label: string) => summary.getByText(label).nextElementSibling?.textContent;
    expect([num("Images"), num("Up to date"), num("Changed since last build")]).toEqual(["3", "1", "1"]);

    // most commits since the last build first
    expect(screen.getAllByRole("region", { name: /^Image / }).map((r) => r.getAttribute("aria-label"))).toEqual(["Image acme/api", "Image acme/docs", "Image acme/web"]);

    fireEvent.click(screen.getByRole("button", { name: /Uncommitted changes/ }));
    expect(screen.getAllByRole("region", { name: /^Image / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Never built here/ }));
    expect(screen.getByRole("region", { name: "Image acme/docs" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByLabelText("Filter images"), { target: { value: "feature" } });
    expect(screen.getAllByRole("region", { name: /^Image / }).map((r) => r.getAttribute("aria-label"))).toEqual(["Image acme/web"]);
    fireEvent.change(screen.getByLabelText("Filter images"), { target: { value: "zzz" } });
    expect(screen.getByText("No image matches.")).toBeTruthy();
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
    const row = await rowOf();
    const button = row.getByRole("button", { name: "Build & push" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    for (const bad of ["1.0:x", "a b", "-x", "x".repeat(129)]) {
      fireEvent.change(tagBox(row), { target: { value: bad } });
      expect(button.disabled, bad).toBe(true);
    }
    fireEvent.change(tagBox(row), { target: { value: "1.0.4" } });
    expect(button.disabled).toBe(false);
  });

  async function startBuild(tag = "1.0.4") {
    const row = await rowOf();
    fireEvent.change(tagBox(row), { target: { value: tag } });
    fireEvent.click(row.getByRole("button", { name: "Build & push" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm the build" })).getByRole("button", { name: /^(Build and push|Push over it)$/ }));
    return row;
  }

  it("asks first, shows the command, then builds and shows the output, the dock and the result", async () => {
    mockServer({ images: [image({ dirty: true })] });
    renderAt("/images");
    const row = await rowOf();
    fireEvent.change(tagBox(row), { target: { value: "1.0.4" } });
    fireEvent.click(row.getByRole("button", { name: "Build & push" }));

    const confirm = within(screen.getByRole("group", { name: "Confirm the build" }));
    expect(confirm.getByText(/acme\/demo-api:1\.0\.4/, { selector: "span" })).toBeTruthy();
    expect(confirm.getByText(/main at abcdef1/)).toBeTruthy();
    expect(confirm.getByText(/uncommitted changes, and the image is built from them/)).toBeTruthy();
    expect(confirm.getByLabelText("Command").textContent).toContain("-t acme/demo-api:1.0.4");
    expect(sent("POST", "/build")).toHaveLength(0);

    fireEvent.click(confirm.getByRole("button", { name: "Build and push" }));
    const log = await screen.findByRole("log", { name: "Build output" });
    await waitFor(() => expect(log.textContent).toContain("#2 pushing"));
    expect(await screen.findByText("Pushed acme/demo-api:1.0.4")).toBeTruthy();
    expect(sent("POST", "/build")[0].url).toBe("/api/v1/images/demo/api/api/build");
    expect(sent("POST", "/build")[0].body).toEqual({ tag: "1.0.4", overwrite: false });

    // the dock lists it
    const dock = within(screen.getByRole("region", { name: "Builds" }));
    expect(dock.getByText(":1.0.4")).toBeTruthy();
    expect(dock.getByText(/0 running · 0 queued · 1 done/)).toBeTruthy();
  });

  it("copies the whole build output with one button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockServer();
    renderAt("/images");
    await startBuild();
    const log = await screen.findByRole("log", { name: "Build output" });
    await waitFor(() => expect(log.textContent).toContain("#2 pushing"));
    expect(screen.getByText(/Build output · \d+ lines?/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(log.textContent); // every line, as shown
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("offers to deploy the pushed tag to a host, when there is one", async () => {
    mockServer({ hosts: [{ workspace: "demo", id: "dev-box", name: "Dev box", token_set: true, tunnel: { open: false, users: 0 } }] });
    renderAt("/images");
    await startBuild();
    const link = await screen.findByRole("link", { name: "Deploy 1.0.4 to a host" });
    expect(link.getAttribute("href")).toBe("/hosts?deploy=acme%2Fdemo-api%3A1.0.4");
  });

  it("offers no deploy link without a host", async () => {
    mockServer({ hosts: [] });
    renderAt("/images");
    await startBuild();
    expect(await screen.findByText("Pushed acme/demo-api:1.0.4")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Deploy 1\.0\.4/ })).toBeNull();
  });

  it("can be cancelled before anything is sent", async () => {
    mockServer();
    renderAt("/images");
    const row = await rowOf();
    fireEvent.change(tagBox(row), { target: { value: "1.0.4" } });
    fireEvent.click(row.getByRole("button", { name: "Build & push" }));
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
    await startBuild("1.0.3");

    const exists = within(await screen.findByRole("group", { name: "The tag already exists" }));
    expect(screen.getAllByText(/already exists on Docker Hub/).length).toBeGreaterThan(0);
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
    await startBuild("2.0");
    expect(await screen.findByText(/no GitHub account rule matches/)).toBeTruthy();
    await startBuild("2.1");
    expect(await screen.findByText(/Failed: Docker Hub refused the push/)).toBeTruthy();
    expect(screen.getByRole("log").textContent).toContain("denied: requested access");
  });

  it("builds the ticked images one after another, each with its own tag, after one confirmation", async () => {
    mockServer({
      images: [image(), image({ repo: "web", image: "web", repository: "acme/demo-web", path: "C:/code/web" })],
      tags: [{ name: "1.0.0", pushed_at: hours(5) }],
    });
    renderAt("/images");
    const api = await rowOf("acme/demo-api");
    const web = await rowOf("acme/demo-web");
    fireEvent.change(tagBox(api), { target: { value: "1.0.1" } });
    fireEvent.change(tagBox(web), { target: { value: "2.0.0" } });
    fireEvent.click(api.getByRole("checkbox", { name: "Select acme/demo-api" }));
    fireEvent.click(web.getByRole("checkbox", { name: "Select acme/demo-web" }));

    const bar = within(screen.getByRole("region", { name: "Selected images" }));
    expect(bar.getByText("2 selected")).toBeTruthy();
    fireEvent.click(bar.getByRole("button", { name: "Build & push selected" }));
    const confirm = within(screen.getByRole("group", { name: "Confirm the builds" }));
    expect(confirm.getByText("acme/demo-api:1.0.1")).toBeTruthy();
    expect(confirm.getByText("acme/demo-web:2.0.0")).toBeTruthy();
    expect(sent("POST", "/build")).toHaveLength(0);

    fireEvent.click(confirm.getByRole("button", { name: "Build and push" }));
    await waitFor(() => expect(sent("POST", "/build")).toHaveLength(2), { timeout: 8000 });
    expect(sent("POST", "/build").map((c) => c.url)).toEqual(["/api/v1/images/demo/api/api/build", "/api/v1/images/demo/web/web/build"]);
    expect(await screen.findByText(/0 running · 0 queued · 2 done/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Selected images" })).toBeNull(); // the ticks are cleared
  });

  it("leaves a ticked image out of the batch when it has no tag or the tag exists, and says why", async () => {
    mockServer({
      images: [image(), image({ repo: "web", image: "web", repository: "acme/demo-web" })],
      tags: [{ name: "1.0.0", pushed_at: hours(5) }],
    });
    renderAt("/images");
    const api = await rowOf("acme/demo-api");
    const web = await rowOf("acme/demo-web");
    fireEvent.change(tagBox(api), { target: { value: "1.0.0" } }); // exists on Docker Hub
    fireEvent.click(api.getByRole("checkbox", { name: "Select acme/demo-api" }));
    fireEvent.click(web.getByRole("checkbox", { name: "Select acme/demo-web" })); // no tag typed
    const bar = within(screen.getByRole("region", { name: "Selected images" }));
    expect(bar.getByText(/api:1\.0\.0 already exists on Docker Hub/)).toBeTruthy();
    expect(bar.getByText(/web has no valid tag/)).toBeTruthy();
    expect((bar.getByRole("button", { name: "Build & push selected" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(bar.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("region", { name: "Selected images" })).toBeNull();
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
