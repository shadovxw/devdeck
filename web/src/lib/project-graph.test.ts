import { describe, expect, it } from "vitest";

import type { ProjectDatabase } from "./databases";
import type { GitRepo } from "./git";
import { layoutGraph, NODE_W, projectGraph } from "./project-graph";
import type { RunStatus, WorkspaceDetail } from "./types";

const project = {
  id: "acme",
  name: "acme",
  source: "local",
  repos: 3,
  errors: 0,
  warnings: 0,
  workspace: {
    name: "acme",
    root: "../code",
    repos: [
      { id: "demo-api", path: "demo-api" },
      { id: "demo-web", path: "demo-web" },
      { id: "infra", path: "infra", local_only: true },
    ],
  },
  stacks: [
    {
      name: "full",
      compose: [{ id: "db", repo: "infra", file: "docker-compose.yml" }],
      services: [
        { id: "api", repo: "demo-api", kind: "command", port: 18080, after: ["db"] },
        { id: "web", repo: "demo-web", kind: "command", after: ["api", "ghost"] },
      ],
    },
    { name: "empty" },
  ],
  flows: [],
  issues: [],
} as WorkspaceDetail;

const git = [{ repo: "demo-api", work: { branch: "dev", changed: 2 } }, { repo: "demo-web", work: { branch: "main", changed: 0 } }] as unknown as GitRepo[];

const dbs: ProjectDatabase[] = [
  { id: "db", engine: "postgres", from: "compose", where: "infra/docker-compose.yml · db", host: "127.0.0.1", port: 5432, name: "shop", used_by: ["demo-api", "infra"], status: "up" },
];

const run: RunStatus = {
  workspace: "acme",
  stack: "full",
  state: "running",
  started_at: "2026-11-28T10:00:00Z",
  services: [
    { id: "db", kind: "compose", state: "ready", restarts: 0 },
    { id: "api", kind: "command", state: "ready", port: 18080, restarts: 0 },
    { id: "web", kind: "command", state: "failed", restarts: 1 },
  ],
};

describe("projectGraph", () => {
  it.each([
    {
      name: "a running mode",
      mode: "full",
      run,
      nodes: ["repo:demo-api busy", "repo:demo-web good", "repo:infra none", "svc:db good", "svc:api good", "svc:web bad", "db:db good"],
      edges: ["code:repo:infra->svc:db", "code:repo:demo-api->svc:api", "after:svc:db->svc:api", "code:repo:demo-web->svc:web", "after:svc:api->svc:web", "uses:svc:api->db:db", "uses:repo:infra->db:db"],
    },
    {
      name: "a mode with nothing in it",
      mode: "empty",
      run: undefined,
      nodes: ["repo:demo-api busy", "repo:demo-web good", "repo:infra none", "db:db good"],
      edges: ["uses:repo:demo-api->db:db", "uses:repo:infra->db:db"],
    },
  ])("$name", ({ mode, run, nodes, edges }) => {
    const g = projectGraph(project, mode, run, git, dbs);
    const got = g.nodes.map((n) => `${n.id} ${n.tone}`);
    expect(got).toEqual(nodes);
    // web's "ghost" is not a node, so it gets no edge
    expect(g.edges.map((e) => e.id)).toEqual(edges);
  });

  it("says what a node is in one line", () => {
    const g = projectGraph(project, "full", run, git, dbs);
    const sub = (id: string) => g.nodes.find((n) => n.id === id)?.sub;
    expect(sub("repo:demo-api")).toBe("dev · 2 changed");
    expect(sub("repo:demo-web")).toBe("main · clean");
    expect(sub("repo:infra")).toBe("local only");
    expect(sub("svc:api")).toBe("ready · :18080");
    expect(sub("db:db")).toBe("postgres · :5432");
  });

  it("shows the services as stopped when the run is stopped", () => {
    const g = projectGraph(project, "full", { ...run, state: "stopped" }, git, dbs);
    expect(g.nodes.find((n) => n.id === "svc:api")).toMatchObject({ sub: "stopped · :18080", tone: "idle" });
  });
});

describe("layoutGraph", () => {
  it("puts repos left of services and services left of databases", () => {
    const g = projectGraph(project, "full", run, git, dbs);
    const at = layoutGraph(g);
    const x = (id: string) => at.get(id)?.x ?? Number.NaN;
    expect(x("repo:demo-api")).toBeLessThan(x("svc:api"));
    expect(x("svc:api")).toBeLessThan(x("svc:web"));
    expect(x("svc:api")).toBeLessThan(x("db:db"));
    expect(at.size).toBe(g.nodes.length);
    expect(x("svc:api") - x("repo:demo-api")).toBeGreaterThanOrEqual(NODE_W);
  });
});
