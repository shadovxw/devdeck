import "@xyflow/react/dist/base.css";

import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Box, Database, FolderGit2, Layers } from "lucide-react";
import { useState } from "react";

import { useProjectDatabases } from "../../lib/databases";
import { useGitRepos } from "../../lib/git";
import { layoutGraph, projectGraph, type GraphNode } from "../../lib/project-graph";
import type { RunStatus, WorkspaceDetail } from "../../lib/types";
import { defaultMode } from "./ProjectHeader";

/** Which tab a click on a node opens. */
export type OverviewTarget = "code" | "run" | "databases";

const ICON = { repo: FolderGit2, service: Box, compose: Layers, database: Database } as const;
const KIND = { repo: "repo", service: "service", compose: "compose", database: "database" } as const;

type CardNode = Node<GraphNode, "card">;

function Card({ data }: NodeProps<CardNode>) {
  const Icon = ICON[data.kind];
  return (
    <div data-ui="flow-node" data-kind={data.kind} data-tone={data.tone} className="flex h-full w-full items-center gap-3 px-3">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Icon size={16} aria-hidden data-ui="flow-icon" className="shrink-0" />
      <div className="flex min-w-0 flex-col">
        <span data-ui="flow-kind">{KIND[data.kind]}</span>
        <b className="truncate text-[13.5px] text-ink">{data.label}</b>
        {data.sub && <span className="truncate font-mono text-[11px] text-ink-3">{data.sub}</span>}
      </div>
      <span data-ui="flow-dot" aria-hidden className="ms-auto shrink-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { card: Card };

/**
 * A project's Overview (dev-plans/2026-11-22-projects §4.3, PJ8): the project as a canvas. Repos,
 * then the services and compose files of a run mode, then the databases, with "built from", start
 * order and "uses" as edges and live state on every node. A click opens the tab about that node.
 * Read-only for now; editing the file from the canvas comes with project.yaml (PJ9).
 */
export function ProjectOverview({ project, runs, onOpen }: Readonly<{ project: WorkspaceDetail; runs: RunStatus[]; onOpen: (tab: OverviewTarget) => void }>) {
  const modes = project.stacks.map((s) => s.name);
  const mine = runs.filter((r) => r.workspace === project.id);
  const [picked, setPicked] = useState<string>();
  const mode = picked && modes.includes(picked) ? picked : defaultMode(modes, mine);
  const run = mine.find((r) => r.stack === mode);
  const git = useGitRepos();
  const dbs = useProjectDatabases(project.id);

  // A few dozen nodes at most, so building and laying out on each render is cheap (and React Compiler memoizes it).
  const graph = projectGraph(project, mode, run, (git.data ?? []).filter((g) => g.workspace === project.id), dbs.data?.databases ?? []);
  const at = layoutGraph(graph);

  const nodes: CardNode[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "card",
    data: n,
    position: at.get(n.id) ?? { x: 0, y: 0 },
    draggable: false,
    connectable: false,
    ariaLabel: `${KIND[n.kind]} ${n.label}${n.sub ? `, ${n.sub}` : ""}`,
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    className: `flow-edge-${e.kind}`,
    animated: e.kind === "after" && run?.state === "starting",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  }));

  const problems = [
    ...project.issues.filter((i) => i.severity === "error").map((i) => i.message),
    ...(dbs.data?.warnings ?? []).map((w) => w.message),
    ...(run?.services ?? []).filter((s) => s.state === "failed" || s.state === "blocked").map((s) => `${s.id} ${s.state}${s.last_error ? `: ${s.last_error}` : ""}`),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {modes.length > 1 && (
          <label data-ui="project-mode" className="flex items-center gap-2">
            <span data-ui="project-mode-label">Showing</span>
            <select value={mode} onChange={(e) => setPicked(e.target.value)} aria-label="Run mode on the canvas" className="h-[30px] min-w-28 bg-fill px-2 text-[13px] text-ink outline-none">
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        <ul aria-label="Legend" data-ui="flow-legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          <li data-kind="code">built from</li>
          <li data-kind="after">starts after</li>
          <li data-kind="uses">uses</li>
        </ul>
      </div>

      <div data-ui="flow-canvas" className="h-[460px] w-full">
        {graph.nodes.length === 0 ? (
          <p className="m-0 p-6 text-[14px] text-ink-3">Nothing to draw yet: add repos or a run mode to the project&apos;s file.</p>
        ) : (
          <ReactFlow
            key={mode} // a new mode is a new drawing: fit it again
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
            minZoom={0.3}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, n) => onOpen(n.data.kind === "repo" ? "code" : n.data.kind === "database" ? "databases" : "run")}
            aria-label={`Canvas of ${project.name}`}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        )}
      </div>

      {problems.length > 0 && (
        <ul aria-label="Needs a look" data-ui="db-warnings" className="m-0 flex list-none flex-col gap-1.5 p-3">
          {problems.map((p, i) => (
            <li key={i} className="truncate text-[13px] text-ink-2" title={p}>
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
