import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { GitCheck, GitConfig, GitOverview, GitRepo, GitSetup } from "../lib/git";
import { useUi } from "../store/ui";
import { idFromLogin } from "./ConnectionsPage";

const accounts = [
  { login: "me-personal", active: true, scopes: ["repo", "read:org"], token_source: "keyring" },
  { login: "office-dev", active: false, scopes: ["repo"], token_source: "keyring" },
];

const overview = (over: Partial<GitOverview> = {}): GitOverview => ({
  gh_installed: true,
  gh_path: "C:/gh.exe",
  accounts,
  connections: [
    { id: "personal", gh_user: "me-personal", name: "Me Personal", email: "me@example.com", signed_in: true },
    { id: "office", gh_user: "office-dev", name: "Me Office", email: "me@office.example", signed_in: true },
  ],
  rules: [{ match: "github.com/acme/*", connection: "office" }],
  ...over,
});

const setupState = (over: Partial<GitSetup> = {}): GitSetup => ({
  git_found: true,
  applied: false,
  helper: '!"C:/devdeck/devdeck.exe" git-credential',
  commands: ["git config --global credential.https://github.com.useHttpPath true", 'git config --global --add credential.https://github.com.helper ""'],
  current_helpers: [],
  general_helpers: ["manager"],
  use_http_path: "",
  can_undo: false,
  ...over,
});

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.endsWith(suffix));

type Server = {
  overview?: GitOverview;
  setup?: GitSetup;
  repos?: GitRepo[];
  check?: GitCheck | { error: string };
  saveError?: string;
  match?: { matched: boolean; connection?: string } | "invalid";
};

function mockServer(opts: Server = {}) {
  let current = opts.overview ?? overview();
  let setup = opts.setup ?? setupState();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "");
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));

      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces") return json([]);
      if (path === "/runs") return json([]);
      if (path === "/git" && method === "GET") return json(current);
      if (path === "/git/config" && method === "PUT") {
        if (opts.saveError) return json({ message: opts.saveError }, 422);
        const cfg = body as GitConfig;
        current = { ...current, connections: cfg.connections.map((c) => ({ ...c, signed_in: true })), rules: cfg.rules };
        return json(current);
      }
      if (path.startsWith("/git/connections/") && path.endsWith("/check")) {
        if (opts.check && "error" in opts.check) return json({ message: opts.check.error }, 502);
        return json(opts.check ?? { login: "office-dev", scopes: ["repo"], orgs: ["acme"] });
      }
      if (path.startsWith("/git/match")) {
        if (opts.match === "invalid") return json({ message: "that isn't a repository address" }, 400);
        return json(opts.match ?? { matched: true, connection: "office" });
      }
      if (path === "/git/setup") return json(setup);
      if (path === "/git/setup/apply") {
        setup = setupState({ applied: true, can_undo: true });
        return json(setup);
      }
      if (path === "/git/setup/undo") {
        setup = setupState();
        return json(setup);
      }
      if (path === "/git/repos" && method === "GET") return json(opts.repos ?? []);
      if (path === "/git/repos/identity") return json({}, 200);
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

describe("the Connections page", () => {
  it("shows who gh is signed in as, the connections and the rules", async () => {
    mockServer();
    renderAt("/connections");
    const signed = within(await screen.findByRole("region", { name: "Signed in with gh" }));
    expect(signed.getByText("me-personal")).toBeTruthy();
    expect(signed.getByText("active in gh")).toBeTruthy();
    expect(signed.getByText("office-dev")).toBeTruthy();

    expect((screen.getByLabelText("Id of connection 2") as HTMLInputElement).value).toBe("office");
    expect((screen.getByLabelText("GitHub account of office") as HTMLSelectElement).value).toBe("office-dev");
    expect((screen.getByLabelText("Commit email of office") as HTMLInputElement).value).toBe("me@office.example");
    expect((screen.getByLabelText("Pattern of rule 1") as HTMLInputElement).value).toBe("github.com/acme/*");
    expect((screen.getByLabelText("Connection of rule 1") as HTMLSelectElement).value).toBe("office");
  });

  it("asks to install gh when it isn't there", async () => {
    mockServer({ overview: overview({ gh_installed: false, accounts: [] }) });
    renderAt("/connections");
    expect(await screen.findByText("Install the GitHub CLI first")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Connections" })).toBeNull();
  });

  it("says when gh is signed in nowhere, or can't be asked", async () => {
    mockServer({ overview: overview({ accounts: [], connections: [], rules: [], accounts_error: "gh auth: boom" }) });
    renderAt("/connections");
    expect((await screen.findByRole("alert")).textContent).toContain("gh auth: boom");
    cleanup();
    mockServer({ overview: overview({ accounts: [], connections: [], rules: [] }) });
    renderAt("/connections");
    expect(await screen.findByText(/isn’t signed in to any account/)).toBeTruthy();
    expect(screen.getByText("No connection yet. Add one for each account you use.")).toBeTruthy();
    expect(screen.getByText(/No rule yet/)).toBeTruthy();
  });

  it("edits, saves and sends the connections and rules together", async () => {
    mockServer();
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 1");
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Commit name of personal"), { target: { value: "Someone Else" } });
    expect(save.disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    fireEvent.change(screen.getByLabelText("Pattern of rule 2"), { target: { value: "github.com/me-personal/*" } });
    fireEvent.change(screen.getByLabelText("Connection of rule 2"), { target: { value: "personal" } });
    fireEvent.click(save);

    await waitFor(() => expect(sent("PUT", "/git/config")).toHaveLength(1));
    const body = sent("PUT", "/git/config")[0].body as GitConfig;
    expect(body.connections[0]).toMatchObject({ id: "personal", name: "Someone Else", email: "me@example.com" });
    expect(body.rules).toEqual([
      { match: "github.com/acme/*", connection: "office" },
      { match: "github.com/me-personal/*", connection: "personal" },
    ]);
    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Commit name of personal") as HTMLInputElement).value).toBe("Someone Else");
  });

  it("discards changes, and shows why the server refused a save", async () => {
    mockServer({ saveError: "rule 1: there is no connection \"nobody\"" });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Commit name of personal"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByLabelText("Commit name of personal") as HTMLInputElement).value).toBe("Me Personal");

    fireEvent.change(screen.getByLabelText("Commit name of personal"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByText(/there is no connection/)).getAttribute("role")).toBe("alert");
  });

  it("adds a connection for an account that has none yet, and removes a connection or a rule", async () => {
    mockServer({ overview: overview({ connections: [{ id: "personal", gh_user: "me-personal", signed_in: true }], rules: [{ match: "github.com/*", connection: "personal" }] }) });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.click(screen.getByRole("button", { name: "Add a connection" }));
    // it offers the account that has no connection
    expect((screen.getByLabelText("Id of connection 2") as HTMLInputElement).value).toBe("office-dev");
    expect((screen.getByLabelText("GitHub account of office-dev") as HTMLSelectElement).value).toBe("office-dev");
    fireEvent.click(screen.getByRole("button", { name: "Remove connection office-dev" }));
    expect(screen.queryByLabelText("Id of connection 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }));
    expect(screen.queryByLabelText("Pattern of rule 1")).toBeNull();
    expect(screen.getByText(/No rule yet/)).toBeTruthy();
  });

  it("warns about a connection whose account gh isn't signed in to", async () => {
    mockServer({ overview: overview({ connections: [{ id: "ghost", gh_user: "not-signed-in", signed_in: false }], rules: [] }) });
    renderAt("/connections");
    expect(await screen.findByText(/gh isn’t signed in to not-signed-in/)).toBeTruthy();
    expect(within(screen.getByLabelText("GitHub account of ghost")).getByText("not-signed-in (not signed in)")).toBeTruthy();
  });

  it("checks a saved connection, and says so when GitHub refuses", async () => {
    mockServer({ check: { login: "office-dev", scopes: ["repo", "read:org"], orgs: ["acme", "other"] } });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 2");
    fireEvent.click(screen.getByRole("button", { name: "Check office" }));
    await waitFor(() => expect(sent("POST", "/git/connections/office/check")).toHaveLength(1));
    const text = (await screen.findByText(/Signed in as/)).parentElement?.textContent ?? "";
    expect(text).toContain("office-dev");
    expect(text).toContain("repo, read:org");
    expect(text).toContain("acme, other");

    // unsaved changes block checking: the server only knows saved connections
    fireEvent.change(screen.getByLabelText("Commit name of office"), { target: { value: "x" } });
    expect((screen.getByRole("button", { name: "Check office" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a refused check", async () => {
    mockServer({ check: { error: "GitHub didn't accept the token of office-dev" } });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 2");
    fireEvent.click(screen.getByRole("button", { name: "Check office" }));
    expect((await screen.findByRole("alert")).textContent).toContain("didn't accept the token");
  });

  it("says which connection an address would use", async () => {
    mockServer({ match: { matched: true, connection: "office" } });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Try an address"), { target: { value: "https://github.com/acme/api.git" } });
    await waitFor(() => expect(screen.getByText("Uses the connection office (as saved).")).toBeTruthy());
    expect(calls.some((c) => c.url.includes("/git/match?remote=https%3A%2F%2Fgithub.com%2Facme%2Fapi.git"))).toBe(true);
  });

  it("says when no rule matches an address, or it isn't an address", async () => {
    mockServer({ match: { matched: false } });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Try an address"), { target: { value: "https://github.com/x/y" } });
    await waitFor(() => expect(screen.getByText(/No rule matches: git asks as it did before/)).toBeTruthy());
    cleanup();
    mockServer({ match: "invalid" });
    renderAt("/connections");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Try an address"), { target: { value: "nonsense" } });
    await waitFor(() => expect(screen.getByText("That isn’t a repository address.")).toBeTruthy());
  });

  it("previews the git change and applies it only after a confirmation, then undoes it", async () => {
    mockServer();
    renderAt("/connections");
    const section = within(await screen.findByRole("region", { name: "Git credential helper" }));
    expect(await section.findByText("devdeck isn’t set up as a git helper yet.")).toBeTruthy();
    expect(section.getByText(/useHttpPath true/)).toBeTruthy();
    expect(section.getByText(/Your other helper \(manager\) stays/)).toBeTruthy();
    expect(section.queryByRole("button", { name: "Undo…" })).toBeNull();

    fireEvent.click(section.getByRole("button", { name: "Set up the helper…" }));
    expect(sent("POST", "/git/setup/apply")).toHaveLength(0); // nothing yet: it asks first
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent("POST", "/git/setup/apply")).toHaveLength(0);

    fireEvent.click(section.getByRole("button", { name: "Set up the helper…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Change the settings" }));
    await waitFor(() => expect(sent("POST", "/git/setup/apply")).toHaveLength(1));
    expect(sent("POST", "/git/setup/apply")[0].body).toEqual({ confirm: true });
    expect(await section.findByText("devdeck is git’s first helper for github.com.")).toBeTruthy();
    expect(section.queryByRole("button", { name: "Set up the helper…" })).toBeNull();

    fireEvent.click(section.getByRole("button", { name: "Undo…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Put them back" }));
    await waitFor(() => expect(sent("POST", "/git/setup/undo")).toHaveLength(1));
    expect(await section.findByText("devdeck isn’t set up as a git helper yet.")).toBeTruthy();
  });

  it("says so when git isn't installed", async () => {
    mockServer({ setup: setupState({ git_found: false, commands: [] }) });
    renderAt("/connections");
    expect(await screen.findByText(/Git isn’t installed/)).toBeTruthy();
  });
});

describe("making a connection id from an account name", () => {
  it("gives lowercase letters, digits and dashes, starting with a letter", () => {
    expect(idFromLogin("Office-Dev")).toBe("office-dev");
    expect(idFromLogin("123abc")).toBe("a-123abc");
    expect(idFromLogin("a_b.c")).toBe("a-b-c");
    expect(idFromLogin("---")).toBe("account");
    expect(idFromLogin("x".repeat(60))).toHaveLength(40);
  });
});

const repo = (over: Partial<GitRepo>): GitRepo => ({
  workspace: "infrabot",
  workspace_name: "infrabot",
  repo: "api",
  path: "C:/code/api",
  remote: "https://github.com/acme/api.git",
  connection: "office",
  expected: { name: "Me Office", email: "me@office.example" },
  actual: { name: "Me Office", email: "me@office.example" },
  state: "ok",
  ...over,
});

describe("the Repositories page", () => {
  it("shows each repository's account and flags the ones that need attention", async () => {
    mockServer({
      repos: [
        repo({}),
        repo({ repo: "frontend", state: "wrong-identity", actual: { name: "", email: "me@personal.example" } }),
        repo({ repo: "tools", state: "no-rule", connection: undefined, remote: "https://github.com/stranger/tools.git" }),
        repo({ repo: "old", state: "missing", remote: "", connection: undefined }),
      ],
    });
    renderAt("/repos");
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Right account")).toBeTruthy();
    expect(table.getByText("Wrong identity")).toBeTruthy();
    expect(table.getByText("No rule")).toBeTruthy();
    expect(table.getByText("Not found")).toBeTruthy();
    expect(table.getByText("me@personal.example instead of me@office.example")).toBeTruthy();
    expect(screen.getByText("4 repositories, 2 need attention.")).toBeTruthy();
    expect(table.getByRole("link", { name: "Add a rule" }).getAttribute("href")).toBe("/connections");
    expect(table.getAllByText("office")).toHaveLength(2); // the account chips of api and frontend
  });

  it("writes the identity of one repository", async () => {
    mockServer({ repos: [repo({ repo: "frontend", state: "wrong-identity", actual: { name: "", email: "x@y.z" } })] });
    renderAt("/repos");
    fireEvent.click(await screen.findByRole("button", { name: "Set the identity of frontend" }));
    await waitFor(() => expect(sent("POST", "/git/repos/identity")).toHaveLength(1));
    expect(sent("POST", "/git/repos/identity")[0].body).toEqual({ workspace: "infrabot", repo: "frontend" });
  });

  it("says when all repositories are fine, and when there are none", async () => {
    mockServer({ repos: [repo({})] });
    renderAt("/repos");
    expect(await screen.findByText("1 repository, all fine.")).toBeTruthy();
    cleanup();
    mockServer({ repos: [] });
    renderAt("/repos");
    expect(await screen.findByText("No repository yet")).toBeTruthy();
  });
});
