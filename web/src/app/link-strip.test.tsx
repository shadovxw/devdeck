import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useServerLink } from "../lib/server-link";
import { LinkStrip } from "./LinkStrip";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useServerLink.getState().reset();
});

function renderStrip() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <LinkStrip />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("the reconnecting strip", () => {
  it("shows nothing while the server answers, or during a blip", () => {
    useServerLink.getState().answered(90_000);
    renderStrip();
    expect(screen.queryByRole("status")).toBeNull();
    act(() => useServerLink.getState().failed(100_000));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("appears after 2s, counts up, says actions wait; then Connected for 2s, a refresh, and gone", () => {
    useServerLink.getState().answered(90_000);
    const { invalidate } = renderStrip();
    act(() => useServerLink.getState().failed(100_000));
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status").textContent).toContain("Reconnecting · 2s");
    expect(screen.getByText("Actions paused")).toBeTruthy();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status").textContent).toContain("Reconnecting · 12s");

    act(() => useServerLink.getState().answered(Date.now()));
    expect(screen.getByRole("status").textContent).toContain("Connected");
    expect(invalidate).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
