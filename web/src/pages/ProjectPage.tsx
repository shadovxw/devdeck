import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { QuietEmpty } from "../design/EmptyState";
import { Tabs } from "../design/Tabs";
import { useCurrentProject } from "../lib/current-project";
import { useGitRepos } from "../lib/git";
import { stagger } from "../lib/motion";
import { useRuns, useWorkspace } from "../lib/queries";
import { useNow } from "../lib/use-now";
import { ProjectDatabases } from "./project/ProjectDatabases";
import { ProjectHeader } from "./project/ProjectHeader";
import { ProjectLogs } from "./project/ProjectLogs";
import { ProjectScripts } from "./project/ProjectScripts";
import { StackCard } from "./StacksPage";
import { RepoTable } from "./workspaces/RepoTable";
import { Problems, Settings } from "./workspaces/WorkspaceDetail";

/** The project's sections (dev-plans/2026-11-22-projects §4.3). Overview and Images come in later steps. */
const TABS = ["code", "run", "databases", "logs", "scripts", "problems", "settings"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => TABS.includes(v as Tab);

/** Where a project's crumbs start: Work / Projects. */
function Crumbs({ name }: Readonly<{ name: string }>) {
  const list = navByPath("/workspaces");
  return (
    <nav aria-label="Breadcrumb" data-ui="crumbs" className="enter text-[13px] text-ink-3" style={stagger(0)}>
      {list.group}
      <span className="mx-2" aria-hidden>
        /
      </span>
      <Link to={list.path} viewTransition className="hover:text-ink hover:underline">
        {list.label}
      </Link>
      <span className="mx-2" aria-hidden>
        /
      </span>
      <span className="font-medium text-ink">{name}</span>
    </nav>
  );
}

/**
 * One project on its own page (dev-plans/2026-11-22-projects §4.3, PJ2): the design's header with
 * its state, run mode, Start/Stop and VS Code, then its sections as tabs: the code (repos and
 * their git state), how it runs (each run mode with its services in start order), its logs,
 * problems in its files, and settings. The open tab is in the address (?tab=run).
 */
export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const project = useWorkspace(id);
  const runs = useRuns();
  const git = useGitRepos();
  const mine = (runs.data ?? []).filter((r) => r.workspace === id);
  const now = useNow(mine.length > 0);
  // Opening a project makes it the current one: Stacks, Logs and Health follow it.
  const setCurrent = useCurrentProject((s) => s.set);
  useEffect(() => {
    if (project.data) setCurrent(id);
  }, [id, project.data, setCurrent]);
  const asked = params.get("tab");
  const tab: Tab = isTab(asked) ? asked : "code";

  if (project.isPending) return <output aria-label="Loading project…" className="skeleton mt-10 block h-40 w-full" />;
  if (project.isError || !project.data) {
    return (
      <>
        <Crumbs name={id} />
        <p className="mt-6 text-ink-3">Could not load this project.</p>
      </>
    );
  }

  const d = project.data;
  const own = d.source === "local";
  const repos = d.workspace?.repos ?? [];
  const items = [
    { value: "code" as const, label: "Code", count: repos.length },
    { value: "run" as const, label: "Run", count: d.stacks.length },
    { value: "databases" as const, label: "Databases" },
    { value: "logs" as const, label: "Logs" },
    { value: "scripts" as const, label: "Scripts" },
    { value: "problems" as const, label: "Problems", count: d.issues.length },
    { value: "settings" as const, label: "Settings" },
  ];

  return (
    <div data-ui="project-page" className="flex flex-col gap-6">
      <Crumbs name={d.name} />
      <ProjectHeader project={d} runs={runs.data ?? []} />

      <section aria-label={`Details of ${d.name}`} className="enter flex flex-col gap-5" style={stagger(1)}>
        <Tabs label="Project sections" value={tab} onChange={(t) => setParams(t === "code" ? {} : { tab: t }, { replace: true })} items={items} className="project-tabs" />

        <div role="tabpanel" aria-label={tab}>
          {tab === "code" && <RepoTable workspace={id} repos={repos} git={(git.data ?? []).filter((g) => g.workspace === id)} />}

          {tab === "run" &&
            (d.stacks.length === 0 ? (
              <QuietEmpty line="No run modes yet · add a stack to run this project" action={{ label: "Open stacks", to: `/stacks?workspace=${encodeURIComponent(id)}` }} />
            ) : (
              <div className="flex flex-col gap-4">
                {d.stacks.map((s, i) => (
                  <StackCard key={s.name} workspace={d} stack={s} run={mine.find((r) => r.stack === s.name)} now={now} index={i} />
                ))}
              </div>
            ))}

          {tab === "logs" &&
            (d.stacks.length === 0 ? (
              <QuietEmpty line="Nothing to stream · this project has no run modes yet" />
            ) : (
              <ProjectLogs project={d} runs={runs.data ?? []} />
            ))}

          {tab === "databases" && <ProjectDatabases workspace={id} />}
          {tab === "scripts" && <ProjectScripts workspace={id} example={d.source === "example"} />}
          {tab === "problems" && <Problems id={id} issues={d.issues} mine={own} />}
          {tab === "settings" && <Settings id={id} d={d} mine={own} onDeleted={() => navigate("/workspaces", { replace: true, viewTransition: true })} />}
        </div>
      </section>
    </div>
  );
}
