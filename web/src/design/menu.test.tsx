import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Menu } from "./Menu";

afterEach(cleanup);

function setup() {
  const copy = vi.fn();
  const gone = vi.fn();
  render(
    <>
      <Menu
        label="More actions"
        items={[
          { label: "Copy", onSelect: copy },
          { label: "Disabled", onSelect: gone, disabled: true },
          { label: "Delete", onSelect: gone },
        ]}
      />
      <p>outside</p>
    </>,
  );
  return { copy, gone };
}

describe("the menu behind a more button", () => {
  it("opens on a click, runs a choice and closes", () => {
    const { copy } = setup();
    const button = screen.getByRole("button", { name: "More actions" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(copy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not run a disabled choice", () => {
    const { gone } = setup();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disabled" }));
    expect(gone).not.toHaveBeenCalled();
  });

  it("closes with Escape, with a click outside and with a second click on the button", () => {
    setup();
    const button = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves between the choices with the arrow keys, skipping the disabled one, and wraps", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" })); // the first one has focus
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  });
});
