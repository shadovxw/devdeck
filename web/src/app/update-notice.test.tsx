import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpdateState } from "../lib/update";
import { useUi } from "../store/ui";
import { routes } from "./routes";

function mockServer(state: UpdateState) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = url.replace("/api/v1", "").split("?")[0];
      const json = (v: unknown, status = 200) => Promise.resolve(Response.json(v, { status }));
      if (path === "/health") return json({ status: "ok", version: state.current });
      if (path === "/workspaces" || path === "/runs") return json([]);
      if (path === "/ui/state") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/appearance") return json({ themes: [], mode: "", light: "", dark: "", active: "" });
      if (path === "/update") return json(state);
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderApp() {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const available: UpdateState = {
  current: "0.1.0",
  dev: false,
  latest: "0.2.0",
  available: true,
  installable: true,
  running_stacks: 0,
  auto: true,
  checked_at: new Date().toISOString(),
};

afterEach(() => {
  // sonner keeps its toasts in one store for the whole run.
  toast.dismiss();
  cleanup();
  localStorage.clear();
  useUi.setState({ sidebarOpen: false, closedGroups: [] });
  vi.unstubAllGlobals();
});

describe("the update toast and badge", () => {
  it("says once that a new version is out, and View opens Settings → About", async () => {
    mockServer(available);
    const router = renderApp();
    expect(await screen.findByText("devdeck 0.2.0 is available")).toBeTruthy();
    expect(localStorage.getItem("devdeck.update.toasted")).toBe("0.2.0");
    expect(screen.getByLabelText("Update available")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
    expect(router.state.location.hash).toBe("#about");
  });

  it("doesn't show the toast again for a version it already showed, but keeps the badge", async () => {
    localStorage.setItem("devdeck.update.toasted", "0.2.0");
    mockServer(available);
    renderApp();
    expect(await screen.findByLabelText("Update available")).toBeTruthy();
    expect(screen.queryByText("devdeck 0.2.0 is available")).toBeNull();
  });

  it("shows nothing when devdeck is up to date", async () => {
    mockServer({ ...available, latest: "0.1.0", available: false });
    renderApp();
    await screen.findAllByText("Home");
    expect(screen.queryByLabelText("Update available")).toBeNull();
    expect(screen.queryByText(/is available/)).toBeNull();
  });
});
