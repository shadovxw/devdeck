import { GitBranch } from "lucide-react";
import { Link } from "react-router";

import { navByPath } from "../../app/nav";
import { EmptyState } from "../../design/EmptyState";
import { PageHeader } from "../../design/PageHeader";
import { StatusMark } from "../../design/StatusMark";
import type { FeatureSummary } from "../../lib/features";
import { useFeatures } from "../../lib/features";
import { stagger } from "../../lib/motion";

const KIND_WORD: Record<FeatureSummary["kind"], string> = { feature: "Feature", fix: "Fix", task: "Task", spike: "Spike" };

function Row({ f, index }: Readonly<{ f: FeatureSummary; index: number }>) {
  const pct = f.steps === 0 ? 0 : Math.round((f.steps_done / f.steps) * 100);
  return (
    <li className="enter" style={stagger(index + 1)}>
      <Link to={`/features/${encodeURIComponent(f.workspace)}/${encodeURIComponent(f.name)}`} className="grid gap-x-6 gap-y-2 bg-inset p-4 hover:bg-fill-hover md:grid-cols-[minmax(0,1fr)_220px]">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[16px] font-semibold text-ink">{f.title || f.name}</span>
            <span className="text-[12px] text-ink-3">{KIND_WORD[f.kind]}</span>
            {f.errors > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <StatusMark level="fail" />
                {f.errors} {f.errors === 1 ? "problem" : "problems"} in feature.yaml
              </span>
            )}
          </span>
          <span className="break-all font-mono text-[12.5px] text-ink-3">
            {f.workspace} / {f.branch}
            {f.read_only && " · read-only"}
          </span>
          <span className="text-[13px] text-ink-2">
            {f.repos.length > 0 ? f.repos.join(", ") : "no repos"}
          </span>
        </span>
        <span className="flex flex-col justify-center gap-1.5">
          <span className="flex items-baseline justify-between text-[13px] tabular-nums text-ink-2">
            <span>
              {f.prs} {f.prs === 1 ? "PR" : "PRs"}
            </span>
            <span>
              {f.steps_done} of {f.steps} steps
            </span>
          </span>
          <span className="block h-1.5 bg-fill-press" aria-hidden>
            <span className="block h-full bg-ink-3" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Every feature of the user's workspaces: a plan branch of the plans repository, with its steps counted. */
export function FeaturesPage() {
  const item = navByPath("/features");
  const { data, isPending, isError } = useFeatures();

  if (isPending) return (
    <>
      <PageHeader title={item.label} group={item.group} />
      <output aria-label="Loading features…" className="skeleton mt-4 block h-40 w-full" />
    </>
  );
  if (isError || !data) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <p className="mt-4 text-ink-3">The features couldn’t be loaded.</p>
      </>
    );
  }

  const { features, problems, no_plans_repo: none } = data;
  return (
    <>
      <PageHeader title={item.label} group={item.group} description="Each feature is split into small stacked PRs. Claude keeps the plan; this page follows every PR." />

      {problems.length > 0 && (
        <ul className="enter m-0 mt-4 flex list-none flex-col gap-1.5 bg-inset p-4" style={stagger(1)} aria-label="Problems">
          {problems.map((p) => (
            <li key={p.workspace} className="flex items-start gap-2.5 text-[14px] text-ink-2">
              <span className="mt-[3px]">
                <StatusMark level="warn" />
              </span>
              <span>
                <b className="font-medium text-ink">{p.workspace}</b>: {p.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {features.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          empty={
            none.length > 0 && problems.length === 0
              ? {
                  headline: "Add a plans repository",
                  text: "Features live in a private git repository, one branch per plan. Add plans_repo to a workspace’s workspace.yaml to point devdeck at it. The Features guide in Docs says how.",
                  cta: { label: "Open workspaces", to: "/workspaces" },
                }
              : {
                  headline: "No features yet",
                  text: "A feature is a branch plan/<name> of your plans repository with a feature.yaml at its root. Ask Claude to write one from your plan.",
                  cta: { label: "Read the guide", to: "/docs/features" },
                }
          }
        />
      ) : (
        <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0" aria-label="Features">
          {features.map((f, i) => (
            <Row key={`${f.workspace}/${f.name}`} f={f} index={i} />
          ))}
        </ul>
      )}

      {features.length > 0 && none.length > 0 && (
        <p className="mt-4 text-[13px] text-ink-3">No plans repository is set for: {none.join(", ")}.</p>
      )}
    </>
  );
}
