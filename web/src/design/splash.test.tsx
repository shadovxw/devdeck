import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Splash } from "./Splash";

afterEach(() => {
  cleanup();
});

describe("Splash", () => {
  it("shows the brand mark while loading", () => {
    const { container } = render(<Splash />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(container.querySelector("svg.mark")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it("offline: the address, what to do, Retry now, the start command and the countdown", () => {
    const retry = vi.fn();
    render(<Splash state="offline" onRetry={retry} nextIn={3_200} attempt={3} />);
    expect(screen.getByText(/Server offline · 127\.0\.0\.1:7070/)).toBeTruthy();
    expect(screen.getByText(/connects by itself/)).toBeTruthy();
    expect(screen.getByText("$ devdeck serve")).toBeTruthy();
    expect(screen.getByText("Retrying in 4s · attempt 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
