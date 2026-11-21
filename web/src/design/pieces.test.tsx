import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Panel } from "./Panel";
import { SectionHeader } from "./SectionHeader";
import { StageRail } from "./StageRail";
import { StatusStrip } from "./StatusStrip";
import { Tag } from "./Tag";

afterEach(cleanup);

const STAGES = ["Boot", "Build", "Install", "Migrate", "Ready"];

describe("SectionHeader", () => {
  it("writes the line like a command and puts the gradient on the heading's last word", () => {
    const { container } = render(<SectionHeader index="01" verb="UP" name="STACKS" count={{ label: "TOTAL_STACKS", value: "04" }} title="Running stacks" />);
    const root = container.querySelector('[data-ui="section-header"]')!;
    expect(root.classList.contains("look-neon")).toBe(true); // Flat doesn't draw it
    expect(root.querySelector('[data-ui="section-index"]')!.textContent).toBe("01");
    expect(root.querySelector('[data-ui="section-verb"]')!.textContent).toBe("$ UP");
    expect(root.querySelector('[data-ui="section-count"]')!.textContent).toBe("TOTAL_STACKS: 04");
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Running stacks");
    expect(heading.querySelector('[data-ui="gradient-word"]')!.textContent).toBe("stacks");
  });

  it("puts a one-word heading wholly in the gradient, and draws no heading without a title", () => {
    const { container, rerender } = render(<SectionHeader index="02" verb="TOP" name="RESOURCES" title="Usage" />);
    expect(container.querySelector('[data-ui="gradient-word"]')!.textContent).toBe("Usage");
    rerender(<SectionHeader index="02" verb="TOP" name="RESOURCES" />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector('[data-ui="section-count"]')).toBeNull();
  });
});

describe("Panel", () => {
  it("is a named section with its heading and action, and a Neon-only kicker", () => {
    render(
      <Panel title="Recent runs" kicker="02 $" action={<a href="/runs">View all</a>}>
        <p>content</p>
      </Panel>,
    );
    const section = screen.getByRole("region", { name: "Recent runs" });
    const heading = within(section).getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("02 $ Recent runs");
    expect(heading.querySelector(".look-neon")!.textContent).toBe("02 $ ");
    expect(within(section).getByRole("link", { name: "View all" })).toBeTruthy();
    expect(within(section).getByText("content")).toBeTruthy();
  });

  it("takes another accessible name when given one", () => {
    render(
      <Panel title="Now" label="Right now">
        <p>x</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Right now" })).toBeTruthy();
  });
});

describe("StatusStrip", () => {
  it("lists each key and value, with the value's meaning as a tone", () => {
    const { container } = render(
      <StatusStrip
        label="System"
        items={[
          { key: "Docker", value: "Running", tone: "ok" },
          { key: "Claude", value: "Connected", tone: "live" },
          { key: "Branch", value: "main" },
        ]}
      />,
    );
    const strip = container.querySelector('dl[data-ui="status-strip"]')!;
    expect(strip.getAttribute("aria-label")).toBe("System");
    expect([...strip.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Docker", "Claude", "Branch"]);
    expect([...strip.querySelectorAll("dd")].map((d) => [d.textContent, d.getAttribute("data-tone")])).toEqual([
      ["Running", "ok"],
      ["Connected", "live"],
      ["main", "plain"],
    ]);
  });
});

describe("StageRail", () => {
  it.each([
    [0, false, "0 of 5 stages done, next: Boot", ["todo", "todo", "todo", "todo", "todo"]],
    [3, false, "3 of 5 stages done, next: Migrate", ["done", "done", "done", "todo", "todo"]],
    [3, true, "3 of 5 stages done, stuck at: Migrate", ["done", "done", "done", "warn", "todo"]],
    [5, false, "All 5 stages done", ["done", "done", "done", "done", "done"]],
    [9, false, "All 5 stages done", ["done", "done", "done", "done", "done"]],
    [-1, false, "0 of 5 stages done, next: Boot", ["todo", "todo", "todo", "todo", "todo"]],
  ])("done %i (warn %s) reads as %s", (done, warn, summary, states) => {
    const { container } = render(<StageRail stages={STAGES} done={done} warn={warn} />);
    expect(screen.getByRole("list").getAttribute("aria-label")).toBe(summary);
    expect([...container.querySelectorAll("li")].map((li) => li.getAttribute("data-state"))).toEqual(states);
  });

  it("joins the marks with one line fewer than the stages, filled up to the last done mark", () => {
    const { container } = render(<StageRail stages={STAGES} done={3} />);
    const lines = [...container.querySelectorAll('[data-ui="stage-line"]')];
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.hasAttribute("data-done"))).toEqual([true, true, false, false]);
  });

  it("shows the labels unless compact", () => {
    const { rerender } = render(<StageRail stages={STAGES} done={1} />);
    expect(screen.getAllByText(/Migrate/)).toHaveLength(2); // the label and the screen-reader text ("Migrate: not yet")
    rerender(<StageRail stages={STAGES} done={1} compact />);
    expect(screen.getAllByText(/Migrate/)).toHaveLength(1);
  });
});

describe("Tag", () => {
  it("says its word and carries its tone, with a Flat-only dot", () => {
    const { container } = render(<Tag tone="warning">WARN</Tag>);
    const tag = container.querySelector('[data-ui="tag"]')!;
    expect(tag.textContent).toBe("WARN");
    expect(tag.getAttribute("data-tone")).toBe("warning");
    expect(tag.querySelector(".look-flat")).toBeTruthy();
  });
});
