import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowControls } from "./WindowControls";

type Rt = { WindowMinimise: () => void; WindowToggleMaximise: () => void; WindowIsMaximised: () => Promise<boolean>; Quit: () => void };

function stubRuntime(over: Partial<Rt> = {}) {
  const rt: Rt = { WindowMinimise: vi.fn(), WindowToggleMaximise: vi.fn(), WindowIsMaximised: vi.fn(() => Promise.resolve(false)), Quit: vi.fn(), ...over };
  (window as unknown as { runtime?: Rt }).runtime = rt;
  return rt;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { runtime?: Rt }).runtime;
});

describe("the window buttons", () => {
  it("are not there in a browser, which has its own", () => {
    render(<WindowControls />);
    expect(screen.queryByRole("group", { name: "Window" })).toBeNull();
  });

  it("are not there when only part of the runtime is", () => {
    (window as unknown as { runtime: object }).runtime = { WindowMinimise: () => undefined };
    render(<WindowControls />);
    expect(screen.queryByRole("group", { name: "Window" })).toBeNull();
  });

  it("minimise, maximise and close devdeck's own window", async () => {
    const rt = stubRuntime();
    render(<WindowControls />);
    fireEvent.click(screen.getByRole("button", { name: "Minimise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Maximise" }));
    fireEvent.click(screen.getByRole("button", { name: "Close devdeck" }));
    expect(rt.WindowMinimise).toHaveBeenCalledTimes(1);
    expect(rt.WindowToggleMaximise).toHaveBeenCalledTimes(1);
    expect(rt.Quit).toHaveBeenCalledTimes(1);
  });

  it("offer Restore while the window is maximised, and follow it when it is resized", async () => {
    let maximised = true;
    stubRuntime({ WindowIsMaximised: vi.fn(() => Promise.resolve(maximised)) });
    render(<WindowControls />);
    expect(await screen.findByRole("button", { name: "Restore" })).toBeTruthy();
    maximised = false;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Maximise" })).toBeTruthy());
  });

  it("keep working when the window can't say whether it is maximised", async () => {
    stubRuntime({ WindowIsMaximised: vi.fn(() => Promise.reject(new Error("no"))) });
    render(<WindowControls />);
    expect(await screen.findByRole("button", { name: "Maximise" })).toBeTruthy();
  });
});
