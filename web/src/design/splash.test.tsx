import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Splash } from "./Splash";

afterEach(cleanup);

describe("Splash", () => {
  it("shows the brand mark while loading", () => {
    const { container } = render(<Splash />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(container.querySelector("svg.mark")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it("offers a retry when the server is unreachable", () => {
    const retry = vi.fn();
    render(<Splash state="offline" onRetry={retry} />);
    expect(screen.getByText("offline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
