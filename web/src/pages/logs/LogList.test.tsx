import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "../../lib/types";
import { LogList } from "./LogList";

afterEach(cleanup);

const line = (seq: number, text: string, level: LogEntry["level"] = "info"): LogEntry => ({ seq, time: "2026-10-31T10:00:00Z", workspace: "demo", stack: "full", service: "api", stream: "stdout", text, level });

function setup(entries: LogEntry[], onSelect = vi.fn()) {
  render(<LogList entries={entries} label="Logs" selected={undefined} onSelect={onSelect} follow={false} hasOlder={false} onLoadOlder={() => {}} empty="No lines." rowActions={() => []} />);
  return { onSelect, box: screen.getByRole("listbox", { name: "Logs" }) };
}

describe("LogList: collapse repeats", () => {
  const entries = [line(1, "tick"), line(2, "tick"), line(3, "tick"), line(4, "done")];

  it("shows a run of the same line once, with how many times it came", () => {
    const { box } = setup(entries);
    const rows = within(box).getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("×3");
    expect(rows[1].textContent).not.toContain("×");
  });

  it("selects the first line of a run, and shows every line again when switched off", () => {
    const { box, onSelect } = setup(entries);
    fireEvent.click(within(box).getAllByRole("option")[0]);
    expect(onSelect).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("checkbox", { name: "Collapse repeats" }));
    expect(within(box).getAllByRole("option")).toHaveLength(4);
    expect(box.textContent).not.toContain("×3");
  });

  it("copies every loaded line, not only the rows", () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    setup(entries);
    fireEvent.click(screen.getByRole("button", { name: "Copy the loaded lines" }));
    expect(writeText).toHaveBeenCalledWith("tick\ntick\ntick\ndone");
    vi.unstubAllGlobals();
  });
});
