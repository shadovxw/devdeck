import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { RunStatus, WorkspaceSummary } from "../../lib/types";
import { typeRows, WorkspaceCards } from "./WorkspaceCards";

const demo: WorkspaceSummary = {
  id: "demo",
  name: "demo",
  description: "A demo shop.",
  source: "local",
  repos: 4,
  repo_types: { go: 2, node: 1, docs: 1 },
  stacks: 1,
  flows: 1,
  scripts: 2,
  errors: 0,
  warnings: 0,
};

/** The text the card's button is described by: its dossier. */
function dossier(runs?: RunStatus[]) {
  render(<WorkspaceCards items={[demo]} runs={runs} onSelect={() => {}} />);
  const button = screen.getByRole("button", { name: "Project demo" });
  return document.getElementById(button.getAttribute("aria-describedby") as string) as HTMLElement;
}

afterEach(cleanup);

describe("the dossier", () => {
  it("describes the card: what it is, its repos by type and its totals", () => {
    const text = dossier().textContent?.replace(/\s+/g, " ");
    expect(text).toContain("A demo shop.");
    expect(text).toContain("go 2");
    expect(text).toContain("node 1");
    expect(text).toContain("4 repos");
    expect(text).toContain("1 run mode");
    expect(text).toContain("3 scripts"); // the file's two and one flow
  });

  it("shows a mark for each service while it runs, in place of the types", () => {
    const service = (id: string, state: "ready" | "failed") => ({ id, kind: "command", state, restarts: 0 });
    const runs: RunStatus[] = [
      { workspace: "demo", stack: "full", state: "degraded", started_at: "", services: [service("api", "ready"), service("web", "failed")] },
      { workspace: "other", stack: "full", state: "running", started_at: "", services: [service("elsewhere", "ready")] },
    ];
    const panel = within(dossier(runs));
    expect(panel.getByTitle("api: Ready")).toBeTruthy();
    expect(panel.getByTitle("web: Failed")).toBeTruthy();
    expect(panel.getByText("web Failed")).toBeTruthy(); // said, not only coloured
    expect(panel.queryByTitle(/elsewhere/)).toBeNull();
    expect(panel.queryByText("node")).toBeNull();
  });

  it("gives every card its own description", () => {
    render(<WorkspaceCards items={[demo, { ...demo, id: "other", name: "other" }]} onSelect={() => {}} />);
    const ids = [...document.querySelectorAll("[data-ui=project-card]")].map((b) => b.getAttribute("aria-describedby"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("typeRows", () => {
  it.each<{ name: string; counts?: Record<string, number>; want: string[] }>([
    { name: "all of up to four", counts: { go: 4, node: 3, docs: 2, other: 1 }, want: ["go 4", "node 3", "docs 2", "other 1"] },
    { name: "the biggest three and the rest", counts: { go: 5, node: 4, docs: 3, docker: 2, sql: 1 }, want: ["go 5", "node 4", "docs 3", "2 more 3"] },
    { name: "none", want: [] },
  ])("$name", ({ counts, want }) => {
    expect(typeRows(counts).map((r) => `${r.type} ${r.count}`)).toEqual(want);
  });
});
