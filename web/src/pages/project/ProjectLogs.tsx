import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import type { LogQuery } from "../../lib/log-query";
import type { RunStatus, WorkspaceDetail } from "../../lib/types";
import { LogsView } from "../LogsPage";
import { defaultMode } from "./ProjectHeader";

/**
 * A project's Logs tab (projects plan PJ3): the stream of one run mode, the one running by
 * default, with the same filters, histogram and errors as the Logs page. Filters stay in the tab
 * (not the address); "Full page" opens the Logs page on the same run mode.
 */
export function ProjectLogs({ project, runs }: Readonly<{ project: WorkspaceDetail; runs: RunStatus[] }>) {
  const modes = project.stacks.map((s) => s.name);
  const [picked, setPicked] = useState<string>();
  const stack = picked && modes.includes(picked) ? picked : defaultMode(modes, runs.filter((r) => r.workspace === project.id));
  const [query, setQuery] = useState<LogQuery>({});
  if (!stack) return null;

  const selectors = (
    <>
      <label className="sr-only" htmlFor="project-logs-mode">
        Run mode
      </label>
      <select
        id="project-logs-mode"
        value={stack}
        onChange={(e) => {
          setPicked(e.target.value);
          setQuery({});
        }}
        className="h-[34px] min-w-28 bg-fill px-2 text-[13px] text-ink outline-none"
      >
        {modes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <Link to={`/logs?workspace=${encodeURIComponent(project.id)}&stack=${encodeURIComponent(stack)}`} viewTransition title="Open these logs on the Logs page" className="inline-flex h-[34px] items-center gap-1.5 px-2 text-[13px] text-link hover:underline">
        <ExternalLink size={14} aria-hidden />
        Full page
      </Link>
    </>
  );

  return <LogsView key={`${project.id}/${stack}`} embedded workspace={project.id} stack={stack} sample={project.source === "example"} query={query} onQuery={setQuery} selectors={selectors} title="Logs" group={project.name} />;
}
