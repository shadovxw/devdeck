import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { GitCheck, GitConfig, GitOverview, GitRepo, GitSetup } from "../lib/git";
import { useUi } from "../store/ui";
import { idFromLogin, reach } from "./GitHubConnectionPage";

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
  registered: "",
  registered_program: "",
  registered_exists: false,
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

describe("the GitHub connection page", () => {
  it("shows who gh is signed in as, the connections and the rules", async () => {
    mockServer();
    renderAt("/connections/github");
    const signed = within(await screen.findByRole("region", { name: "GitHub CLI accounts" }));
    expect(signed.getByText("me-personal")).toBeTruthy();
    expect(signed.getByText("Current")).toBeTruthy();
    expect(signed.getByText("office-dev")).toBeTruthy();

    expect((screen.getByLabelText("Id of connection 2") as HTMLInputElement).value).toBe("office");
    expect((screen.getByLabelText("GitHub account of office") as HTMLSelectElement).value).toBe("office-dev");
    expect((screen.getByLabelText("Commit email of office") as HTMLInputElement).value).toBe("me@office.example");
    expect((screen.getByLabelText("Pattern of rule 1") as HTMLInputElement).value).toBe("github.com/acme/*");
    expect((screen.getByLabelText("Connection of rule 1") as HTMLSelectElement).value).toBe("office");
  });

  it("asks to install gh when it isn't there", async () => {
    mockServer({ overview: overview({ gh_installed: false, accounts: [] }) });
    renderAt("/connections/github");
    expect(await screen.findByText("Install the GitHub CLI first")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Connection profiles" })).toBeNull();
  });

  it("says when gh is signed in nowhere, or can't be asked", async () => {
    mockServer({ overview: overview({ accounts: [], connections: [], rules: [], accounts_error: "gh auth: boom" }) });
    renderAt("/connections/github");
    expect((await screen.findByRole("alert")).textContent).toContain("gh auth: boom");
    cleanup();
    mockServer({ overview: overview({ accounts: [], connections: [], rules: [] }) });
    renderAt("/connections/github");
    expect(await screen.findByText(/isn’t signed in to any account/)).toBeTruthy();
    expect(screen.getByText("No profile yet. Add one for each account you use.")).toBeTruthy();
    expect(screen.getByText(/No rule yet/)).toBeTruthy();
  });

  it("edits, saves and sends the connections and rules together", async () => {
    mockServer();
    renderAt("/connections/github");
    await screen.findByLabelText("Id of connection 1");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull(); // the bar appears with the first change
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    fireEvent.change(screen.getByLabelText("Commit name of personal"), { target: { value: "Someone Else" } });
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
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
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect((screen.getByLabelText("Commit name of personal") as HTMLInputElement).value).toBe("Someone Else");
  });

  it("discards changes, and shows why the server refused a save", async () => {
    mockServer({ saveError: "rule 1: there is no connection \"nobody\"" });
    renderAt("/connections/github");
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
    renderAt("/connections/github");
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
    renderAt("/connections/github");
    expect(await screen.findByText(/gh isn’t signed in to not-signed-in/)).toBeTruthy();
    expect(within(screen.getByLabelText("GitHub account of ghost")).getByText("not-signed-in (not signed in)")).toBeTruthy();
  });

  it("checks a saved connection, and says so when GitHub refuses", async () => {
    mockServer({ check: { login: "office-dev", scopes: ["repo", "read:org"], orgs: ["acme", "other"] } });
    renderAt("/connections/github");
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
    renderAt("/connections/github");
    await screen.findByLabelText("Id of connection 2");
    fireEvent.click(screen.getByRole("button", { name: "Check office" }));
    expect((await screen.findByRole("alert")).textContent).toContain("didn't accept the token");
  });

  it("says which connection an address would use", async () => {
    mockServer({ match: { matched: true, connection: "office" } });
    renderAt("/connections/github");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Test a repository URL"), { target: { value: "https://github.com/acme/api.git" } });
    await waitFor(() => expect(screen.getByText("Uses the profile office (as saved).")).toBeTruthy());
    expect(calls.some((c) => c.url.includes("/git/match?remote=https%3A%2F%2Fgithub.com%2Facme%2Fapi.git"))).toBe(true);
  });

  it("says when no rule matches an address, or it isn't an address", async () => {
    mockServer({ match: { matched: false } });
    renderAt("/connections/github");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Test a repository URL"), { target: { value: "https://github.com/x/y" } });
    await waitFor(() => expect(screen.getByText(/No rule matches: git asks as it did before/)).toBeTruthy());
    cleanup();
    mockServer({ match: "invalid" });
    renderAt("/connections/github");
    await screen.findByLabelText("Id of connection 1");
    fireEvent.change(screen.getByLabelText("Test a repository URL"), { target: { value: "nonsense" } });
    await waitFor(() => expect(screen.getByText("That isn’t a repository address.")).toBeTruthy());
  });

  it("previews the git change and applies it only after a confirmation, then undoes it", async () => {
    mockServer();
    renderAt("/connections/github");
    const section = within(await screen.findByRole("region", { name: "Git credential helper" }));
    expect(await section.findByText("Not configured")).toBeTruthy();
    expect(section.queryByText(/useHttpPath true/)).toBeNull(); // behind "Learn what changes"
    fireEvent.click(section.getByRole("button", { name: "Learn what changes" }));
    expect(section.getByText(/useHttpPath true/)).toBeTruthy();
    expect(section.getByText(/Your other helper \(manager\) stays/)).toBeTruthy();
    expect(section.queryByRole("button", { name: "Undo" })).toBeNull();

    fireEvent.click(section.getByRole("button", { name: "Set up helper" }));
    expect(sent("POST", "/git/setup/apply")).toHaveLength(0); // nothing yet: it asks first
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent("POST", "/git/setup/apply")).toHaveLength(0);

    fireEvent.click(section.getByRole("button", { name: "Set up helper" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Change the settings" }));
    await waitFor(() => expect(sent("POST", "/git/setup/apply")).toHaveLength(1));
    expect(sent("POST", "/git/setup/apply")[0].body).toEqual({ confirm: true });
    expect(await section.findByText("Set up")).toBeTruthy();
    expect(section.queryByRole("button", { name: "Set up helper" })).toBeNull();

    fireEvent.click(section.getByRole("button", { name: "Undo" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Put them back" }));
    await waitFor(() => expect(sent("POST", "/git/setup/undo")).toHaveLength(1));
    expect(await section.findByText("Not configured")).toBeTruthy();
  });

  it("counts a helper whose program is another copy of devdeck as set up, and says which program", async () => {
    mockServer({ setup: setupState({ registered: "!\"C:/devdeck/bin/devdeck.exe\" git-credential", registered_program: "C:/devdeck/bin/devdeck.exe", registered_exists: true, can_undo: true }) });
    renderAt("/connections/github");
    const section = within(await screen.findByRole("region", { name: "Git credential helper" }));
    expect(await section.findByText("Set up")).toBeTruthy();
    expect(section.getByText("C:/devdeck/bin/devdeck.exe")).toBeTruthy();
    expect(section.queryByRole("button", { name: "Set up helper" })).toBeNull();
    expect(section.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("warns when the helper’s program is gone, and offers to set it up again", async () => {
    mockServer({ setup: setupState({ registered: "!\"C:/gone/devdeck.exe\" git-credential", registered_program: "C:/gone/devdeck.exe", registered_exists: false }) });
    renderAt("/connections/github");
    const section = within(await screen.findByRole("region", { name: "Git credential helper" }));
    expect(await section.findByText("Set up, program missing")).toBeTruthy();
    expect(section.getByText(/isn’t there any more/)).toBeTruthy();
    expect(section.getByRole("button", { name: "Set up helper" })).toBeTruthy();
  });

  it("says so when git isn't installed", async () => {
    mockServer({ setup: setupState({ git_found: false, commands: [] }) });
    renderAt("/connections/github");
    expect(await screen.findByText(/Git isn’t installed/)).toBeTruthy();
  });
});

describe("the GitHub page, in small parts", () => {
  it("shows how to add an account, with the command to copy", async () => {
    mockServer();
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderAt("/connections/github");
    const accounts = within(await screen.findByRole("region", { name: "GitHub CLI accounts" }));
    expect(accounts.getByText("gh authenticated")).toBeTruthy();
    expect(accounts.queryByText(/gh auth login --hostname/)).toBeNull();
    fireEvent.click(accounts.getByRole("button", { name: "Add account" }));
    expect(accounts.getByText(/gh auth login --hostname github.com --git-protocol https --web/)).toBeTruthy();
    fireEvent.click(accounts.getByRole("button", { name: "Copy" }));
    expect(write).toHaveBeenCalledWith("gh auth login --hostname github.com --git-protocol https --web");
    expect(accounts.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("says in words what each rule covers, and the status of each profile", async () => {
    mockServer({ overview: overview({ rules: [{ match: "github.com/*", connection: "personal" }, { match: "github.com/acme/*", connection: "office" }, { match: "github.com/acme/api", connection: "office" }] }) });
    renderAt("/connections/github");
    await screen.findByLabelText("Pattern of rule 1");
    expect(screen.getByText("Every repository on github.com")).toBeTruthy();
    expect(screen.getByText("Every repository of acme")).toBeTruthy();
    expect(screen.getByText("One repository")).toBeTruthy();
    expect(screen.getAllByText("Available")).toHaveLength(2);
  });

  it("shows the whole page of a gh that is signed in nowhere without any profile row", async () => {
    mockServer({ overview: overview({ accounts: [], connections: [], rules: [] }) });
    renderAt("/connections/github");
    expect(await screen.findByText("gh not signed in")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("describes a rule’s reach", () => {
    expect(reach("github.com/*")).toBe("Every repository on github.com");
    expect(reach("github.com/acme/*")).toBe("Every repository of acme");
    expect(reach("github.com/acme/api")).toBe("One repository");
    expect(reach("nonsense")).toBe("");
  });
});

describe("Connections, the page above GitHub", () => {
  it("lists the kinds of connection, with GitHub and Docker Hub as the ones that are built", async () => {
    mockServer();
    renderAt("/connections");
    const github = within(await screen.findByRole("main")).getByRole("link", { name: /GitHub/ });
    expect(github.getAttribute("href")).toBe("/connections/github");
    expect(await within(github).findByText("2 connections · 2 accounts signed in with gh")).toBeTruthy();
    expect(within(await screen.findByRole("main")).getByRole("link", { name: /Docker Hub/ }).getAttribute("href")).toBe("/connections/docker");
    // the others say when they come, and are not links
    for (const [name, phase] of [["SonarQube", "Phase 8"], ["Postgres", "Phase 6"]]) {
      expect(screen.queryByRole("link", { name: new RegExp(name) })).toBeNull();
      expect(screen.getByText(name).closest("[aria-disabled]")?.textContent).toContain("Comes with " + phase);
    }
  });

  it("says when the GitHub CLI isn’t there", async () => {
    mockServer({ overview: overview({ gh_installed: false, accounts: [], connections: [], rules: [] }) });
    renderAt("/connections");
    expect(await screen.findByText("The GitHub CLI isn’t installed yet")).toBeTruthy();
  });

  it("puts GitHub in the breadcrumb, with a way back to Connections", async () => {
    mockServer();
    renderAt("/connections/github");
    const crumbs = within(await screen.findByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByText("Platform")).toBeTruthy();
    expect(crumbs.getByRole("link", { name: "Connections" }).getAttribute("href")).toBe("/connections");
    expect(crumbs.getByText("GitHub")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "GitHub" })).toBeTruthy();
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
    expect(table.getByRole("link", { name: "Add a rule" }).getAttribute("href")).toBe("/connections/github");
    expect(table.getAllByText("office")).toHaveLength(2); // the account chips of api and frontend
  });

  it("writes the identity of one repository", async () => {
    mockServer({ repos: [repo({ repo: "frontend", state: "wrong-identity", actual: { name: "", email: "x@y.z" } })] });
    renderAt("/repos");
    fireEvent.click(await screen.findByRole("button", { name: "Set the identity of frontend" }));
    await waitFor(() => expect(sent("POST", "/git/repos/identity")).toHaveLength(1));
    expect(sent("POST", "/git/repos/identity")[0].body).toEqual({ workspace: "acme", repo: "frontend" });
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
