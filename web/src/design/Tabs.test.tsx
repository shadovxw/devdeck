import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs } from "./Tabs";

afterEach(cleanup);

function Demo() {
  const [value, setValue] = useState("all");
  return (
    <Tabs
      label="Levels"
      value={value}
      onChange={setValue}
      items={[
        { value: "all", label: "All" },
        { value: "errors", label: "Errors", count: 7 },
        { value: "warnings", label: "Warnings", count: 3 },
      ]}
    />
  );
}

describe("Tabs", () => {
  it("marks the selected tab and puts only it in the tab order", () => {
    render(<Demo />);
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Errors/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: /Errors/ }).tabIndex).toBe(-1);
    expect(screen.getByRole("tablist", { name: "Levels" })).toBeTruthy();
  });

  it("shows the count inside the label and selects on click", () => {
    render(<Demo />);
    // jsdom does not lay out the flex items, so it joins the label and count without a space; a browser puts one between them.
    const errors = () => screen.getByRole("tab", { name: /^Errors\s?7$/ });
    fireEvent.click(errors());
    expect(errors().getAttribute("aria-selected")).toBe("true");
  });

  it("moves with the arrow keys, wrapping at the ends, and with Home and End", () => {
    render(<Demo />);
    const tabs = () => screen.getAllByRole("tab");
    fireEvent.keyDown(tabs()[0], { key: "ArrowLeft" });
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs()[2], { key: "ArrowRight" });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs()[0], { key: "End" });
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs()[2], { key: "Home" });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });
});
