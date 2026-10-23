import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import type { HostView } from "../lib/hosts";
import { useUi } from "../store/ui";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const sent = (method: string, suffix: string) => calls.filter((c) => c.method === method && c.url.split("?")[0].endsWith(suffix));

const host = (over: Partial<HostView> = {}): HostView => ({
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
  tunnel: { open: false, users: 0 },
  ...over,
});

const services = [
  { Name: "acme-api", Service: "api", Image: "acme/api:1.2", State: "running", Health: "healthy", Status: "Up 3 minutes (healthy)", ExitCode: 0, Publishers: [{ URL: "0.0.0.0", TargetPort: 8081, PublishedPort: 8081, Protocol: "tcp" }] },
  { Name: "acme-gateway", Service: "gateway", Image: "acme/gateway:2.0", State: "running", Health: "unhealthy", Status: "Up (unhealthy)", ExitCode: 0, Publishers: null },
  { Name: "acme-worker", Service: "worker", Image: "acme/worker:1", State: "exited", Health: "", Status: "Exited (2)", ExitCode: 2, Publishers: [] },
];

type Server = { hosts?: HostView[]; info?: { error: string } };

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

function mockServer(opts: Server = {}) {
  let hosts = opts.hosts ?? [host()];
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
      if (path === "/hosts") return json(hosts);
      const b = "/hosts/demo/dev-box";
      if (path === `${b}/token` && method === "PUT") {
        if (String((body as { token: string }).token).length < 32) return json({ message: "that doesn't look like an agent token" }, 422);
        hosts = hosts.map((h) => ({ ...h, token_set: true }));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path === `${b}/token` && method === "DELETE") {
        hosts = hosts.map((h) => ({ ...h, token_set: false }));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path === `${b}/disconnect`) return Promise.resolve(new Response(null, { status: 204 }));
      if (path === `${b}/info`) {
        if (opts.info) return json({ message: opts.info.error }, 502);
        hosts = hosts.map((h) => ({ ...h, tunnel: { open: true, port: 50123, users: 1 } }));
        return json({ version: "1.0.0", api: 1, stacks: [{ id: "infrabot", name: "InfraBOT dev", allow_write: false, after: [] }] });
      }
      if (path === `${b}/stacks/infrabot/services`) return json(services);
      if (path === `${b}/stacks/infrabot/compose`)
        return json({
          name: "acme",
          services: [
            { name: "api", image: "${API_IMAGE}", build: false, ports: ["8081:8081"], depends_on: [{ service: "postgres", condition: "service_healthy" }], healthcheck: { test: "wget -qO- http://localhost:8081/health" }, volumes: [], env: ["DB_PASSWORD", "LOG_LEVEL"] },
            { name: "migrate", image: "acme/postgres:dev", build: true, ports: [], depends_on: [{ service: "postgres", condition: "service_completed_successfully" }, { service: "nats", condition: "service_started" }], healthcheck: { test: "", disabled: true }, volumes: [], env: [] },
            { name: "nats", build: false, ports: [], depends_on: [], volumes: [], env: [] },
          ],
        });
      if (path === `${b}/stacks/infrabot/logs`) {
        const service = new URL(url, "http://x").searchParams.get("service");
        if (service === "gateway") return json({ message: "the agent refused the saved token: save the token again" }, 502);
        if (service === "worker") return ndjson([{ service: "worker", error: "docker compose logs ended with code 1: no container" }]);
        return ndjson([
          { service: "api", ts: "2026-10-22T03:30:00Z", line: "api started" },
          { service: "gateway", ts: "2026-10-22T03:30:01Z", line: "gateway listening on :8081" },
        ]);
      }
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderHosts() {
  const router = createMemoryRouter(routes, { initialEntries: ["/hosts"] });
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

describe("the Remote hosts page", () => {
  it("explains how to add a host when there is none", async () => {
    mockServer({ hosts: [] });
    renderHosts();
    expect(await screen.findByText("No remote host yet")).toBeTruthy();
    expect(screen.getByText(/type: aws-ssm/)).toBeTruthy();
  });

  it("shows a host, and connects only when asked", async () => {
    mockServer();
    renderHosts();
    const card = within(await screen.findByRole("region", { name: "Dev box" }));
    expect(card.getByText("i-0123456789abcdef0 · ap-south-1 · profile dev")).toBeTruthy();
    expect(card.getByText("Not connected")).toBeTruthy();
    expect(card.getByText("Agent token saved in your OS keychain.")).toBeTruthy();
    expect(sent("GET", "/info")).toHaveLength(0); // no tunnel until asked

    fireEvent.click(card.getByRole("button", { name: "Connect" }));
    expect(await card.findByText("Agent 1.0.0 · 1 stack")).toBeTruthy();
    const stack = within(card.getByRole("region", { name: "Stack InfraBOT dev" }));
    expect(stack.getByText("read-only")).toBeTruthy();
    expect(await stack.findByText("acme/api:1.2")).toBeTruthy();
    expect(stack.getByText("Healthy")).toBeTruthy();
    expect(stack.getByText("Unhealthy")).toBeTruthy();
    expect(stack.getByText("Exited (2)")).toBeTruthy();
    expect(stack.getByText("8081")).toBeTruthy();
  });

  it("opens straight away when the tunnel is already open", async () => {
    mockServer({ hosts: [host({ tunnel: { open: true, port: 50123, users: 0 } })] });
    renderHosts();
    expect(await screen.findByText("Agent 1.0.0 · 1 stack")).toBeTruthy();
  });

  it("shows the compose view with variable names only", async () => {
    mockServer({ hosts: [host({ tunnel: { open: true, users: 0 } })] });
    renderHosts();
    const stack = within(await screen.findByRole("region", { name: "Stack InfraBOT dev" }));
    fireEvent.click(stack.getByRole("tab", { name: "Compose" }));
    expect(await stack.findByText("${API_IMAGE}")).toBeTruthy();
    expect(stack.getByText("postgres (healthy)")).toBeTruthy();
    expect(stack.getByText(/values never leave the host/)).toBeTruthy();
    expect(stack.getByText("2").getAttribute("title")).toBe("DB_PASSWORD\nLOG_LEVEL");
  });

  it("follows the logs of all services, or of the one picked", async () => {
    mockServer({ hosts: [host({ tunnel: { open: true, users: 0 } })] });
    renderHosts();
    const stack = within(await screen.findByRole("region", { name: "Stack InfraBOT dev" }));
    fireEvent.click(stack.getByRole("tab", { name: "Logs" }));
    expect(await stack.findByText("api started")).toBeTruthy();
    expect(stack.getByText("gateway listening on :8081")).toBeTruthy();
    expect(sent("GET", "/stacks/infrabot/logs")[0].url).toContain("tail=200");

    // the Logs button of a row opens the logs of that service
    fireEvent.click(stack.getByRole("tab", { name: "Services" }));
    fireEvent.click(await stack.findByRole("button", { name: "Logs of worker" }));
    expect(await stack.findByText(/no container/)).toBeTruthy();
    expect((stack.getByLabelText("Service") as HTMLSelectElement).value).toBe("worker");
    expect(sent("GET", "/stacks/infrabot/logs").at(-1)?.url).toContain("service=worker");
  });

  it("says what to do when it can't connect", async () => {
    mockServer({ info: { error: "your AWS sign-in has expired: run `aws sso login --profile dev`" } });
    renderHosts();
    const card = within(await screen.findByRole("region", { name: "Dev box" }));
    fireEvent.click(card.getByRole("button", { name: "Connect" }));
    expect((await card.findByRole("alert")).textContent).toContain("aws sso login --profile dev");
    expect(card.getByText("Can’t connect")).toBeTruthy();
    expect(card.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("saves a token, refuses one that isn't, and can forget it", async () => {
    mockServer({ hosts: [host({ token_set: false })] });
    renderHosts();
    const card = within(await screen.findByRole("region", { name: "Dev box" }));
    expect(card.queryByRole("button", { name: "Connect" })).toBeNull(); // nothing to connect with yet
    const field = card.getByLabelText("Agent token") as HTMLInputElement;
    expect(field.type).toBe("password");

    fireEvent.change(field, { target: { value: "short" } });
    fireEvent.click(card.getByRole("button", { name: "Save token" }));
    expect((await card.findByRole("alert")).textContent).toContain("doesn't look like an agent token");

    const token = "test".repeat(12);
    fireEvent.change(field, { target: { value: token } });
    fireEvent.click(card.getByRole("button", { name: "Save token" }));
    await waitFor(() => expect(sent("PUT", "/token").at(-1)?.body).toEqual({ token }));
    expect(await card.findByText("Agent token saved in your OS keychain.")).toBeTruthy();

    fireEvent.click(card.getByRole("button", { name: "Forget token" }));
    await waitFor(() => expect(sent("DELETE", "/token")).toHaveLength(1));
    expect(await card.findByLabelText("Agent token")).toBeTruthy();
  });

  it("disconnects", async () => {
    mockServer({ hosts: [host({ tunnel: { open: true, users: 0 } })] });
    renderHosts();
    const card = within(await screen.findByRole("region", { name: "Dev box" }));
    fireEvent.click(await card.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(sent("POST", "/disconnect")).toHaveLength(1));
  });
});

describe("the Remote hosts page, the less common paths", () => {
  it("shows the compose details of every kind of service", async () => {
    mockServer({ hosts: [host({ tunnel: { open: true, users: 0 } })] });
    renderHosts();
    const stack = within(await screen.findByRole("region", { name: "Stack InfraBOT dev" }));
    fireEvent.click(stack.getByRole("tab", { name: "Compose" }));
    expect(await stack.findByText("postgres (done), nats")).toBeTruthy();
    expect(stack.getByText("(built)")).toBeTruthy();
    expect(stack.getByText("off")).toBeTruthy();
  });

  it("says why the logs of a service were refused", async () => {
    mockServer({ hosts: [host({ tunnel: { open: true, users: 0 } })] });
    renderHosts();
    const stack = within(await screen.findByRole("region", { name: "Stack InfraBOT dev" }));
    fireEvent.click(await stack.findByRole("button", { name: "Logs of gateway" }));
    expect((await stack.findByRole("alert")).textContent).toContain("save the token again");
  });

  it("replaces a saved token, or keeps it on Cancel", async () => {
    mockServer();
    renderHosts();
    const card = within(await screen.findByRole("region", { name: "Dev box" }));
    fireEvent.click(card.getByRole("button", { name: "Replace token" }));
    expect(card.getByLabelText("Agent token")).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Cancel" }));
    expect(card.getByText("Agent token saved in your OS keychain.")).toBeTruthy();
  });

  it("says when the hosts can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (url.endsWith("/health")) return json({ status: "ok", version: "test" });
      if (url.endsWith("/hosts")) return json({ message: "boom" }, 500);
      return json([]);
    }));
    renderHosts();
    expect((await screen.findByRole("alert")).textContent).toContain("boom");
  });
});
