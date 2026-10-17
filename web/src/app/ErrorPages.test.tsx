import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeError } from "../design/ErrorView";
import { AppErrorBoundary, FatalError, PageError } from "./ErrorPages";
import { Shell } from "./Shell";

function Boom({ message = "kaboom" }: { message?: string }): never {
  throw new Error(message);
}

function renderRoutes(routes: RouteObject[], path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // React and the router log every caught crash; these tests crash on purpose.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ status: "ok", version: "test" }))),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("describeError", () => {
  it("handles errors, strings, server responses and unknown values", () => {
    expect(describeError(new Error("nope")).message).toBe("nope");
    expect(describeError(new Error("nope")).stack).toContain("nope");
    expect(describeError("plain text")).toEqual({ message: "plain text" });
    expect(describeError(undefined)).toEqual({ message: "Unknown error" });
    expect(describeError({ weird: true })).toEqual({ message: "Unknown error" });
  });
});

describe("error pages", () => {
  it("shows a page crash inside the shell, so the sidebar still works", async () => {
    renderRoutes(
      [
        {
          element: <Shell />,
          errorElement: <FatalError />,
          children: [{ errorElement: <PageError />, children: [{ path: "/boom", element: <Boom message="page exploded" /> }] }],
        },
      ],
      "/boom",
    );

    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    // the sidebar and its links are still on screen
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(within(nav).getByRole("link", { name: "Stacks" })).toBeTruthy();
    // the way out and the way to retry
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Home" }).getAttribute("href")).toBe("/");
    // the technical details are there, folded away
    expect(screen.getByText("Show technical details")).toBeTruthy();
    expect(screen.getByText(/page exploded/)).toBeTruthy();
  });

  it("shows a full-window page when the shell itself crashes", async () => {
    renderRoutes([{ path: "/", element: <Boom message="shell exploded" />, errorElement: <FatalError /> }], "/");

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
    expect(screen.getByText(/shell exploded/)).toBeTruthy();
  });

  it("shows the status of a failed server response", async () => {
    renderRoutes(
      [
        {
          path: "/",
          loader: () => {
            throw new Response("backend down", { status: 500, statusText: "Server Error" });
          },
          element: <p>never</p>,
          errorElement: <FatalError />,
        },
      ],
      "/",
    );

    expect(await screen.findByText("Error 500")).toBeTruthy();
    expect(screen.getByText(/500 Server Error backend down/)).toBeTruthy();
  });

  it("catches a crash outside the router", () => {
    render(
      <AppErrorBoundary>
        <Boom message="providers exploded" />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText(/providers exploded/)).toBeTruthy();
  });

  it("renders its children when nothing fails", () => {
    render(
      <AppErrorBoundary>
        <p>all good</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("copies the details to the clipboard and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(
      <AppErrorBoundary>
        <Boom message="copy me" />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(writeText).toHaveBeenCalledOnce();
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("copy me");
  });
});
