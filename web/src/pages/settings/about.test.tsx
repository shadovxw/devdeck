import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "../../app/routes";
import { checkedAgo, type UpdateState } from "../../lib/update";
import { useUi } from "../../store/ui";

const checks: string[] = [];
const posts: { path: string; body?: unknown }[] = [];

/** A server whose GET /update answers `before`, POST /update/check `after`, and POST /update/download `downloaded`. */
function mockServer(before: UpdateState, after: UpdateState = before, downloaded?: UpdateState) {
  let state = before;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: before.current });
      if (path === "/workspaces" || path === "/runs") return json([]);
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/appearance") return json({ themes: [], mode: "", light: "", dark: "", active: "" });
      if (path === "/update" && method === "GET") return json(state);
      if (path === "/update/check" && method === "POST") {
        checks.push(path);
        state = after;
        return json(state);
      }
      if (path === "/update/download" && method === "POST") {
        posts.push({ path });
        state = downloaded ?? state;
        return json(state);
      }
      if (path === "/update/auto" && method === "PUT") {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        posts.push({ path, body });
        state = { ...state, auto: body.auto };
        return json(state);
      }
      if (path === "/update/install" && method === "POST") {
        posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return json({ status: "installing" }, 202);
      }
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderAbout() {
  window.location.hash = "#about";
  const router = createMemoryRouter(routes, { initialEntries: ["/settings#about"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const base: UpdateState = { current: "0.1.0", dev: false, available: false, installable: true, running_stacks: 0, auto: true };
const now = () => new Date().toISOString();

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = "";
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
  checks.length = 0;
  posts.length = 0;
});

describe("Settings → About", () => {
  it("shows the version and checks when asked, then offers the newer release", async () => {
    mockServer(base, { ...base, latest: "0.2.0", available: true, url: "https://github.com/acme/demo-app/releases/tag/v0.2.0", checked_at: now() });
    renderAbout();
    expect(await screen.findByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("Not checked yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("devdeck 0.2.0 is available.")).toBeTruthy();
    expect(checks).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Release notes/ }).getAttribute("href")).toBe("https://github.com/acme/demo-app/releases/tag/v0.2.0");
    expect(screen.getByText("Checked just now.")).toBeTruthy();
  });

  it("says when it is up to date", async () => {
    mockServer({ ...base, latest: "0.1.0", checked_at: now(), url: "https://github.com/acme/demo-app/releases/tag/v0.1.0" });
    renderAbout();
    expect(await screen.findByText("You have the latest version.")).toBeTruthy();
  });

  it("says why a check failed", async () => {
    mockServer(base, { ...base, checked_at: now(), error: "GitHub couldn't be reached; check the network and try again" });
    renderAbout();
    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("GitHub couldn't be reached"));
  });

  it("doesn't offer a check on a development build", async () => {
    mockServer({ current: "0.0.0-dev", dev: true, available: false, installable: false, running_stacks: 0, auto: false });
    renderAbout();
    expect(await screen.findByText(/Development build/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });
});

describe("Settings → About: installing", () => {
  const available: UpdateState = {
    ...base,
    latest: "0.2.0",
    available: true,
    url: "https://github.com/acme/demo-app/releases/tag/v0.2.0",
    checked_at: new Date().toISOString(),
  };

  it("downloads, asks first (saying what it stops), then installs", async () => {
    mockServer({ ...available, running_stacks: 2 }, undefined, { ...available, ready: "0.2.0", running_stacks: 2 });
    renderAbout();
    fireEvent.click(await screen.findByRole("button", { name: "Download update" }));
    expect(await screen.findByText("devdeck 0.2.0 is downloaded and ready to install.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    const dialog = screen.getByRole("alertdialog", { name: "Install the update" });
    expect(dialog.textContent).toContain("This stops 2 running stacks.");
    expect(posts.filter((p) => p.path === "/update/install")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Stop 2 stacks and install" }));
    expect((await screen.findByRole("status")).textContent).toContain("Installing devdeck 0.2.0");
    expect(posts.find((p) => p.path === "/update/install")?.body).toEqual({ confirm: true });
  });

  it("can cancel the confirmation", async () => {
    mockServer({ ...available, ready: "0.2.0" });
    renderAbout();
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("says why a copy can't update itself, and offers no download", async () => {
    mockServer({ ...available, installable: false, not_installable: "This copy wasn't installed with the devdeck installer." });
    renderAbout();
    expect(await screen.findByText("This copy wasn't installed with the devdeck installer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download update" })).toBeNull();
  });
});

describe("Settings → About: checking by itself", () => {
  it("turns the daily check off and on", async () => {
    mockServer(base);
    renderAbout();
    const never = await screen.findByRole("button", { name: "Never" });
    expect(screen.getByRole("button", { name: "Automatically" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(never);
    await waitFor(() => expect(screen.getByRole("button", { name: "Never" }).getAttribute("aria-pressed")).toBe("true"));
    expect(posts.find((p) => p.path === "/update/auto")?.body).toEqual({ auto: false });
  });
});

describe("checkedAgo", () => {
  const t = Date.parse("2026-11-21T12:00:00Z");
  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1 min ago"],
    [3599, "59 min ago"],
    [3600, "1 h ago"],
    [86_400, "1 day ago"],
    [3 * 86_400, "3 days ago"],
  ])("%i seconds is %s", (s, want) => {
    expect(checkedAgo(new Date(t - s * 1000).toISOString(), t)).toBe(want);
  });
});
