import dagre from "@dagrejs/dagre";

import type { ProjectDatabase } from "./databases";
import type { GitRepo } from "./git";
import type { RunStatus, WorkspaceDetail } from "./types";

/** What a node's state reads as: good (ready, up, clean), busy (starting), bad (failed, down), idle (not running), none (nothing to say). */
export type Tone = "good" | "busy" | "bad" | "idle" | "none";

export type GraphNode = {
  id: string;
  kind: "repo" | "service" | "compose" | "database";
  label: string;
  /** One short line under the label: a branch and changes, a state and port, an engine. */
  sub: string;
  tone: Tone;
};

/** code: a service is built from a repo; after: start order; uses: a database a repo or service uses. */
export type GraphEdge = { id: string; from: string; to: string; kind: "code" | "after" | "uses" };

export type ProjectGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

const BUSY = new Set(["waiting", "building", "starting", "restarting", "stopping"]);

function serviceTone(state: string | undefined): Tone {
  if (!state || state === "stopped") return "idle";
  if (state === "ready") return "good";
  if (BUSY.has(state)) return "busy";
  return "bad";
}

/**
 * The project as a graph for the Overview canvas (dev-plans/2026-11-22-projects §4.3, PJ8): its repos,
 * the services and compose files of one run mode, and its databases. Edges: repo → the service built
 * from it, a service → the ones started after it, and a repo or its service → the database it uses.
 * The live state comes from the run, git and the database check.
 */
export function projectGraph(
  project: WorkspaceDetail,
  mode: string | undefined,
  run: RunStatus | undefined,
  git: GitRepo[],
  databases: ProjectDatabase[],
): ProjectGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const has = new Set<string>();
  const edge = (from: string, to: string, kind: GraphEdge["kind"]) => {
    if (!has.has(from) || !has.has(to) || from === to) return;
    const id = `${kind}:${from}->${to}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, from, to, kind });
  };
  const add = (n: GraphNode) => {
    nodes.push(n);
    has.add(n.id);
  };

  for (const r of project.workspace?.repos ?? []) {
    const g = git.find((x) => x.repo === r.id);
    const changed = g?.work?.changed ?? 0;
    const branch = g?.work?.branch;
    add({
      id: `repo:${r.id}`,
      kind: "repo",
      label: r.id,
      sub: [branch, changed > 0 ? `${changed} changed` : branch ? "clean" : r.local_only ? "local only" : ""].filter(Boolean).join(" · "),
      tone: changed > 0 ? "busy" : branch ? "good" : "none",
    });
  }

  const stack = project.stacks.find((s) => s.name === mode);
  const live = (id: string) => (run && run.state !== "stopped" ? run.services.find((s) => s.id === id) : undefined);
  const services = stack?.services ?? [];
  const compose = stack?.compose ?? [];

  compose.forEach((c, i) => {
    const id = c.id ?? `compose-${i + 1}`;
    const s = live(id);
    add({ id: `svc:${id}`, kind: "compose", label: id, sub: s ? s.state : c.file, tone: serviceTone(s?.state) });
  });
  for (const def of services) {
    const s = live(def.id);
    const port = s?.port ?? def.port;
    add({ id: `svc:${def.id}`, kind: "service", label: def.id, sub: [s?.state ?? "stopped", port ? `:${port}` : ""].filter(Boolean).join(" · "), tone: serviceTone(s?.state) });
  }
  for (const db of databases) {
    add({
      id: `db:${db.id}`,
      kind: "database",
      label: db.name || db.id,
      sub: `${db.engine} · :${db.port}`,
      tone: db.status === "up" ? "good" : db.status === "down" ? "bad" : "none",
    });
  }

  compose.forEach((c, i) => {
    const id = c.id ?? `compose-${i + 1}`;
    edge(`repo:${c.repo}`, `svc:${id}`, "code");
    for (const a of c.after ?? []) edge(`svc:${a}`, `svc:${id}`, "after");
  });
  for (const def of services) {
    if (def.repo) edge(`repo:${def.repo}`, `svc:${def.id}`, "code");
    for (const a of def.after ?? []) edge(`svc:${a}`, `svc:${def.id}`, "after");
  }
  for (const db of databases) {
    for (const user of db.used_by) {
      // A repo that runs as a service in this mode uses the database through that service.
      const viaService = services.filter((s) => s.repo === user);
      if (viaService.length > 0) for (const s of viaService) edge(`svc:${s.id}`, `db:${db.id}`, "uses");
      else edge(`repo:${user}`, `db:${db.id}`, "uses");
    }
  }
  return { nodes, edges };
}

export const NODE_W = 196;
export const NODE_H = 58;

/** Places the nodes left to right (repos, then services, then databases) with dagre. Returns each node's top-left. */
export function layoutGraph(g: ProjectGraph): Map<string, { x: number; y: number }> {
  const d = new dagre.graphlib.Graph();
  d.setGraph({ rankdir: "LR", nodesep: 22, ranksep: 70, marginx: 8, marginy: 8 });
  d.setDefaultEdgeLabel(() => ({}));
  for (const n of g.nodes) d.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of g.edges) d.setEdge(e.from, e.to);
  dagre.layout(d);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of g.nodes) {
    const p = d.node(n.id);
    out.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  return out;
}
