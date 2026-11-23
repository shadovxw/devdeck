import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/routes";
import { useUi } from "../store/ui";

const guides = [
  { id: "claude-quickstart", title: "devdeck with Claude Code: quick start" },
  { id: "docker-builds", title: "Building and pushing Docker images with devdeck" },
];

const quickstart = [
  "# devdeck with Claude Code: quick start",
  "",
  "Read [the Docker guide](docker-builds.md#build-secrets), the [web](https://example.com/x) and the [plan](../dev-plans/x/plan.md).",
  "",
  "## Give this to Claude Code",
  "",
  "```text",
  "Connect my Claude Code to devdeck.",
  "1. Run `devdeck mcp install`.",
  "```",
  "",
  "| Ask | Tool |",
  "|---|---|",
  "| What is running? | `devdeck_status` |",
  "",
  '<script data-x="raw">window.hacked = true</script>',
].join("\n");

const calls: string[] = [];

function mockServer(opts: { list?: unknown; fail?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(url);
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: "test" });
      if (path === "/runs" || path === "/workspaces") return json([]);
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/docs") return opts.fail ? json({ message: "boom" }, 500) : json(opts.list ?? guides);
      if (path === "/docs/claude-quickstart") return Promise.resolve(new Response(quickstart, { headers: { "Content-Type": "text/markdown" } }));
      if (path === "/docs/docker-builds") return Promise.resolve(new Response("# Docker builds\n\nBuild and push.", { headers: { "Content-Type": "text/markdown" } }));
      return json({ message: "no such guide" }, 404);
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
  delete (window as unknown as { hacked?: boolean }).hacked;
});

describe("the Docs page", () => {
  it("lists the guides and shows the first one, with its table and links", async () => {
    mockServer();
    renderAt("/docs");
    const nav = within(await screen.findByRole("navigation", { name: "Guides" }));
    expect(nav.getAllByRole("link").map((l) => l.textContent)).toEqual(guides.map((g) => g.title));
    expect(nav.getByRole("link", { name: guides[0].title }).getAttribute("aria-current")).toBe("page");

    const article = within(await screen.findByRole("article"));
    expect(await article.findByRole("heading", { name: "devdeck with Claude Code: quick start" })).toBeTruthy();
    expect(article.getByRole("table")).toBeTruthy();
    expect(article.getByText("devdeck_status")).toBeTruthy();

    // a link to another guide opens it in the app; a web address in a new tab; a path in the repository is only text
    expect(article.getByRole("link", { name: "the Docker guide" }).getAttribute("href")).toBe("/docs/docker-builds#build-secrets");
    const web = article.getByRole("link", { name: "web" });
    expect(web.getAttribute("href")).toBe("https://example.com/x");
    expect(web.getAttribute("target")).toBe("_blank");
    expect(article.queryByRole("link", { name: "plan" })).toBeNull();
    expect(article.getByText("plan")).toBeTruthy();
  });

  it("copies a code block, and never renders raw HTML from a guide", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockServer();
    renderAt("/docs/claude-quickstart");
    const article = within(await screen.findByRole("article"));
    fireEvent.click(await article.findByRole("button", { name: "Copy this block" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe("Connect my Claude Code to devdeck.\n1. Run `devdeck mcp install`.");
    expect(await article.findByRole("button", { name: "Copied" })).toBeTruthy();

    expect(document.querySelector("script[data-x]")).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it("opens another guide from the list", async () => {
    mockServer();
    renderAt("/docs");
    fireEvent.click(await screen.findByRole("link", { name: guides[1].title }));
    expect(await screen.findByRole("heading", { name: "Docker builds" })).toBeTruthy();
    expect(calls.some((c) => c.endsWith("/docs/docker-builds"))).toBe(true);
  });

  it("says when the guides can't be read, and when a guide doesn't exist", async () => {
    mockServer({ fail: true });
    renderAt("/docs");
    expect((await screen.findByRole("alert")).textContent).toContain("The guides couldn’t be read");
    cleanup();

    mockServer();
    renderAt("/docs/nope");
    expect((await screen.findByRole("alert")).textContent).toContain("This guide doesn’t exist.");
  });

  it("is in the sidebar", async () => {
    mockServer();
    renderAt("/docs");
    expect((await screen.findAllByRole("link", { name: "Docs" })).length).toBeGreaterThan(0);
  });
});
