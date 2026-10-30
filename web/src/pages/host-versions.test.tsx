import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { HostView, VersionEntry, VersionEvent, VersionRequest, VersionResult } from "../lib/hosts";
import { useUi } from "../store/ui";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.split("?")[0].endsWith(suffix));

const host: HostView = {
  workspace: "demo",
  workspace_name: "demo",
  id: "dev-box",
  name: "Dev box",
  type: "aws-ssm",
  instance: "i-0123456789abcdef0",
  region: "ap-south-1",
  profile: "dev",
  agent_port: 7071,
  token_set: true,
  tunnel: { open: true, port: 50123, users: 1 },
};

const entry = (service: string, over: Partial<VersionEntry> = {}): VersionEntry => ({
  service,
  variable: `${service.toUpperCase()}_IMAGE`,
  repository: `acme/${service}`,
  file_tag: "1.0.4",
  running_tag: "1.0.4",
  running_image: `acme/${service}:1.0.4`,
  state: "running",
  health: "healthy",
  differs: false,
  editable: true,
  ...over,
});

const baseEntries = (): VersionEntry[] => [
  entry("api", { running_tag: "1.0.3", differs: true }),
  entry("web", { file_tag: "2.0.0", running_tag: "2.0.0", health: "" }),
  entry("nats", { variable: undefined, repository: "nats", file_tag: "2.10", running_tag: "2.10", editable: false, note: "the image is written in the compose file (nats:2.10), not in versions.env" }),
];

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
  writable?: boolean;
  entries?: VersionEntry[];
  history?: VersionEvent[];
  versionsError?: string;
  /** What PUT .../versions answers. */
  put?: (req: VersionRequest) => Response;
};

function mockServer(opts: Server = {}) {
  const writable = opts.writable ?? true;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/workspaces" || path === "/runs") return json([]);
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/hosts") return json([host]);
      const b = "/hosts/demo/dev-box";
      if (path === `${b}/info`) return json({ version: "1.0.0", api: 1, stacks: [{ id: "apps", name: "Apps", allow_write: writable, after: [] }] });
      if (path === `${b}/stacks/apps/services`) return json([]);
      if (path === `${b}/stacks/apps/versions` && method === "GET") {
        if (opts.versionsError) return json({ message: opts.versionsError }, 400);
        return json({ file: "versions.env", services: opts.entries ?? baseEntries() });
      }
      if (path === `${b}/stacks/apps/versions/history`) return json(opts.history ?? []);
      if (path === `${b}/stacks/apps/versions` && method === "PUT") {
        return Promise.resolve((opts.put ?? (() => ndjson([{ line: "saving versions.env" }, { done: true, ok: true }])))(body));
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

/** Opens the Versions tab of the stack on the (already connected) host. */
async function openVersions(path = "/hosts") {
  renderAt(path);
  const tab = await screen.findByRole("tab", { name: "Versions" });
  if (tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab);
}

const tagField = (service: string) => screen.findByLabelText(`New tag for ${service}`) as Promise<HTMLInputElement>;

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("the Versions tab", () => {
  it("shows what the file says, what runs, and what differs", async () => {
    mockServer();
    await openVersions();
    const api = within((await screen.findByText("api", { selector: "td" })).closest("tr") as HTMLElement);
    expect(api.getByText("1.0.4")).toBeTruthy(); // in the file
    expect(api.getByText("1.0.3")).toBeTruthy(); // running
    expect(api.getByText("differs")).toBeTruthy();
    expect(api.getByText("Healthy")).toBeTruthy();
    const web = within(screen.getByText("web", { selector: "td" }).closest("tr") as HTMLElement);
    expect(web.getByText("Running")).toBeTruthy();
    expect(web.queryByText("differs")).toBeNull();
    const nats = within(screen.getAllByText("nats", { selector: "td" })[0].closest("tr") as HTMLElement);
    expect(nats.getByText("can’t be changed here").getAttribute("title")).toContain("written in the compose file");
    expect(nats.queryByLabelText("New tag for nats")).toBeNull();
  });

  it("asks before it changes anything, then deploys and shows how each service came up", async () => {
    const results: VersionResult[] = [{ service: "api", tag: "1.0.5", ok: true, state: "running", health: "healthy" }];
    mockServer({ put: () => ndjson([{ line: "saving versions.env" }, { line: "pulling api" }, { line: "recreating api" }, { done: true, ok: true, versions: results }]) });
    await openVersions();
    fireEvent.change(await tagField("api"), { target: { value: "1.0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

    const dialog = within(screen.getByRole("alertdialog", { name: "Confirm Deploy" }));
    expect(dialog.getByText("api: 1.0.4 → 1.0.5")).toBeTruthy();
    expect(dialog.getByText(/pulls these images and recreates only these containers/)).toBeTruthy();
    expect(sent("PUT", "/versions")).toHaveLength(0);

    fireEvent.click(dialog.getByRole("button", { name: "Deploy" }));
    expect(await screen.findByText("Deploy: done")).toBeTruthy();
    expect(sent("PUT", "/versions")[0].body).toEqual({ changes: [{ service: "api", tag: "1.0.5" }], apply: true });
    const out = within(screen.getByRole("region", { name: "Last change" }));
    expect(out.getByText("Running and healthy")).toBeTruthy();
    expect(out.getByLabelText("Output").textContent).toContain("recreating api");
    // the field is cleared and the table is read again
    expect((screen.getByLabelText("New tag for api") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(sent("GET", "/versions").length).toBeGreaterThan(1));
  });

  it("can save only, without deploying", async () => {
    mockServer();
    await openVersions();
    fireEvent.change(await tagField("web"), { target: { value: "2.1.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));
    expect(within(screen.getByRole("alertdialog")).getByText(/Only the file on the host changes. Nothing is pulled or restarted./)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save only" }));
    expect(await screen.findByText("Save: done")).toBeTruthy();
    expect(sent("PUT", "/versions")[0].body).toEqual({ changes: [{ service: "web", tag: "2.1.0" }], apply: false });
  });

  it("sends several changes as one request", async () => {
    mockServer();
    await openVersions();
    fireEvent.change(await tagField("api"), { target: { value: "1.0.5" } });
    fireEvent.change(await tagField("web"), { target: { value: "2.1.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy 2 changes" }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText("api: 1.0.4 → 1.0.5")).toBeTruthy();
    expect(dialog.getByText("web: 2.0.0 → 2.1.0")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Deploy" }));
    await screen.findByText("Deploy: done");
    expect(sent("PUT", "/versions")).toHaveLength(1);
    expect((sent("PUT", "/versions")[0].body as VersionRequest).changes).toHaveLength(2);
  });

  it("can be cancelled before anything is sent", async () => {
    mockServer();
    await openVersions();
    fireEvent.change(await tagField("api"), { target: { value: "1.0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent("PUT", "/versions")).toHaveLength(0);
    expect((screen.getByLabelText("New tag for api") as HTMLInputElement).value).toBe("1.0.5"); // what was typed is kept
  });

  it("only takes a tag docker accepts", async () => {
    mockServer();
    await openVersions();
    const field = await tagField("api");
    const deploy = screen.getByRole("button", { name: "Deploy" }) as HTMLButtonElement;
    expect(deploy.disabled).toBe(true); // nothing typed
    for (const bad of ["1:x", "a b", "-x"]) {
      fireEvent.change(field, { target: { value: bad } });
      expect(deploy.disabled, bad).toBe(true);
      expect(screen.getByText(/letters, digits, dots, dashes and underscores/)).toBeTruthy();
    }
    fireEvent.change(field, { target: { value: "1.0.5" } });
    expect(deploy.disabled).toBe(false);
  });

  it("redeploys the tag in the file", async () => {
    mockServer();
    await openVersions();
    fireEvent.click(await screen.findByRole("button", { name: "Redeploy api" }));
    expect(within(screen.getByRole("alertdialog")).getByText("api: 1.0.4 → 1.0.4")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Redeploy api" }));
    await screen.findByText("Deploy: done");
    expect(sent("PUT", "/versions")[0].body).toEqual({ changes: [{ service: "api", tag: "1.0.4" }], apply: true });
  });

  it("shows a service that didn't come up, with its log lines", async () => {
    const results: VersionResult[] = [{ service: "api", tag: "1.0.5", ok: false, state: "running", health: "unhealthy", detail: "the health check fails", logs: ["starting", "fatal: cannot connect to postgres"] }];
    mockServer({ put: () => ndjson([{ line: "recreating api" }, { done: true, ok: false, error: "1 of 1 services didn’t come up well; the new tags are kept, and Roll back sets the old ones", versions: results }]) });
    await openVersions();
    fireEvent.change(await tagField("api"), { target: { value: "1.0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Deploy" }));
    expect(await screen.findByText("Deploy failed")).toBeTruthy();
    const out = within(screen.getByRole("region", { name: "Last change" }));
    expect(out.getByRole("alert").textContent).toContain("Roll back sets the old ones");
    expect(out.getByText("Didn’t come up well")).toBeTruthy();
    expect(out.getByText("the health check fails")).toBeTruthy();
    expect(out.getByLabelText("Last log lines of api").textContent).toContain("fatal: cannot connect to postgres");
  });

  it("shows the agent's refusal", async () => {
    mockServer({ put: () => Response.json({ message: "busy: restart api is still running" }, { status: 409 }) });
    await openVersions();
    fireEvent.change(await tagField("api"), { target: { value: "1.0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Deploy" }));
    expect((await screen.findByRole("alert")).textContent).toContain("busy: restart api is still running");
  });

  it("is read-only when the agent keeps the stack read-only", async () => {
    mockServer({ writable: false });
    await openVersions();
    const field = await tagField("api");
    expect(field.disabled).toBe(true);
    expect(field.title).toContain("allow_write is off");
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redeploy api" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Roll back/ })).toBeNull();
  });

  it("says how to enable versions when the stack has no versions file", async () => {
    mockServer({ versionsError: "this stack has no versions_file in the agent’s configuration" });
    await openVersions();
    expect(await screen.findByText(/no versions file in the agent’s configuration/)).toBeTruthy();
    expect(screen.getByText(/Set versions_file \(and list it in env_files\)/)).toBeTruthy();
  });

  it("lists the changes and rolls one back after asking", async () => {
    const at = new Date(Date.now() - 10 * 60_000).toISOString();
    mockServer({
      history: [
        { at, stack: "apps", service: "api", variable: "API_IMAGE", old: "1.0.3", new: "1.0.4", by: "alice", applied: true, ok: false, detail: "the health check fails" },
        { at, stack: "apps", service: "web", variable: "WEB_IMAGE", old: "1.9.0", new: "2.0.0", by: "shared", applied: false, ok: false },
        { at, stack: "apps", service: "worker", variable: "WORKER_IMAGE", old: "3", new: "3", by: "", applied: true, ok: true },
      ],
    });
    await openVersions();
    await screen.findByText("alice");
    const rows = screen.getAllByRole("row").filter((r) => r.textContent?.includes("→"));
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Failed")).toBeTruthy();
    expect(within(rows[1]).getByText("Saved only")).toBeTruthy();
    expect(within(rows[2]).getByText("Deployed")).toBeTruthy();
    expect(within(rows[2]).queryByRole("button", { name: /Roll back/ })).toBeNull(); // nothing to undo

    fireEvent.click(screen.getByRole("button", { name: "Roll back api to 1.0.3" }));
    expect(within(screen.getByRole("alertdialog")).getByText("api: 1.0.4 → 1.0.3")).toBeTruthy();
    expect(sent("PUT", "/versions")).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Roll back api" }));
    await screen.findByText("Deploy: done");
    expect(sent("PUT", "/versions")[0].body).toEqual({ changes: [{ service: "api", tag: "1.0.3" }], apply: true });
  });

  it("says when no tag has been changed yet", async () => {
    mockServer({ history: [] });
    await openVersions();
    expect(await screen.findByText("No tag has been changed from devdeck on this host yet.")).toBeTruthy();
  });
});

describe("deploying a tag from a build", () => {
  it("opens Versions and fills in the services that use the repository", async () => {
    mockServer({ entries: [entry("api"), entry("web"), entry("gateway", { repository: "acme/api" })] });
    await openVersions("/hosts?deploy=acme%2Fapi%3A1.0.9");
    expect(await screen.findByText(/Deploying/)).toBeTruthy();
    expect(screen.getByText("acme/api:1.0.9", { selector: "span" })).toBeTruthy();
    expect(await screen.findByText(/From your build: acme\/api:1\.0\.9\. api, gateway use acme\/api/)).toBeTruthy();
    expect(((await tagField("api")).value)).toBe("1.0.9");
    expect(((await tagField("gateway")).value)).toBe("1.0.9");
    expect(((await tagField("web")).value)).toBe(""); // another repository: left alone
    fireEvent.click(screen.getByRole("button", { name: "Deploy 2 changes" }));
    expect(within(screen.getByRole("alertdialog")).getByText("api: 1.0.4 → 1.0.9")).toBeTruthy();
    expect(sent("PUT", "/versions")).toHaveLength(0); // still asks first
  });

  it("says when no service uses the repository", async () => {
    mockServer();
    await openVersions("/hosts?deploy=acme%2Fother%3A2.0");
    expect(await screen.findByText(/No service of this stack uses acme\/other/)).toBeTruthy();
    expect(((await tagField("api")).value)).toBe("");
  });

  it("ignores a deploy address that isn't a repository and a tag", async () => {
    mockServer();
    renderAt("/hosts?deploy=not-a-tag");
    await screen.findByRole("tab", { name: "Services" });
    expect(screen.queryByText(/Deploying/)).toBeNull();
    expect(screen.getByRole("tab", { name: "Services" }).getAttribute("aria-selected")).toBe("true");
  });
});
