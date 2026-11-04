import { GitBranch, RotateCw } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { navByPath } from "../../app/nav";
import { pill, pillPrimary } from "../../design/pills";
import { EmptyState } from "../../design/EmptyState";
import { IssueList } from "../../design/IssueList";
import { PageHeader } from "../../design/PageHeader";
import { StatusMark } from "../../design/StatusMark";
import { Tabs } from "../../design/Tabs";
import { ApiError } from "../../lib/api";
import { useFeature, useRefreshFeature, useReviews, type FeatureDetail } from "../../lib/features";
import { activityOf, claudePrompt } from "./state";
import { Overview } from "./Overview";
import { ChecksTab, ReviewAllButton } from "./Reviews";
import { ActivityTab, FilesTab, TerminalTab } from "./Tabs";

type Tab = "overview" | "checks" | "activity" | "files" | "terminal";

/** Copies the prompt that hands the next PR to Claude Code. */
function ClaudeButton({ d }: Readonly<{ d: FeatureDetail }>) {
  const [copied, setCopied] = useState(false);
  const prompt = claudePrompt(d);
  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // the clipboard is blocked: nothing else to do from here
    }
  }
  return (
    <button type="button" onClick={copy} disabled={!prompt} className={pillPrimary} title={prompt ? `Copies a prompt that hands PR ${d.pick} to Claude Code` : "No PR is waiting to be started"}>
      {copied ? "Copied" : "Next for Claude"}
    </button>
  );
}

/** One feature: its PRs by repo and layer, what is next, and the plan's files. */
export function FeaturePage() {
  const { workspace = "", name = "" } = useParams();
  const item = navByPath("/features");
  const { data: d, isPending, error } = useFeature(workspace, name);
  const refresh = useRefreshFeature(workspace, name);
  const [tab, setTab] = useState<Tab>("overview");
  const [filePath, setFilePath] = useState<string>();
  const reviews = useReviews(workspace, name, (path) => {
    setFilePath(path);
    setTab("files");
  });

  const header = (title: string, extra?: Partial<Parameters<typeof PageHeader>[0]>) => (
    <PageHeader title={title} group={item.group} parent={item.label} parentTo="/features" {...extra} />
  );

  if (isPending) {
    return (
      <>
        {header(name)}
        <output aria-label="Loading feature…" className="skeleton mt-4 block h-40 w-full" />
      </>
    );
  }
  if (error || !d) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <>
        {header(name)}
        {status === 404 ? (
          <EmptyState icon={GitBranch} empty={{ headline: "No such feature", text: "It may have been renamed, or its plan branch is gone from the plans repository.", cta: { label: "Back to Features", to: "/features" } }} />
        ) : (
          <p className="mt-4 text-ink-3">{error instanceof ApiError ? error.message : "The feature couldn’t be loaded."}</p>
        )}
      </>
    );
  }

  const title = d.title || d.name;
  return (
    <>
      {header(title, {
        description: `${d.feature ?? d.name} → ${d.base ?? "dev"} · ${d.repos.length} ${d.repos.length === 1 ? "repo" : "repos"} · ${d.pr_list.length} ${d.pr_list.length === 1 ? "PR" : "PRs"} · plan ${d.branch}${d.read_only ? " (read-only: no worktree)" : ""}`,
        actions: (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} className={pill} title="Asks GitHub again now; otherwise its answer is kept for a minute">
              <RotateCw size={14} aria-hidden className={refresh.isPending ? "animate-spin" : ""} />
              Refresh
            </button>
            <ReviewAllButton d={d} c={reviews} />
            <ClaudeButton d={d} />
          </div>
        ),
      })}

      <div className="mt-4 flex flex-col gap-4">
        {reviews.message && (
          <output className="m-0 block bg-inset px-4 py-3 text-[13.5px] text-ink-2">{reviews.message}</output>
        )}
        {d.issues.length > 0 && (
          <section aria-label="Problems in feature.yaml" className="bg-inset p-4">
            <IssueList issues={d.issues} />
          </section>
        )}
        {d.problems.length > 0 && (
          <ul aria-label="Not everything could be read" className="m-0 flex list-none flex-col gap-1.5 bg-inset p-4">
            {d.problems.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[13.5px] text-ink-2">
                <span className="mt-[3px]">
                  <StatusMark level="warn" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        )}

        <Tabs
          label="Feature sections"
          value={tab}
          onChange={setTab}
          items={[
            { value: "overview", label: "Overview" },
            { value: "checks", label: "Reviews and checks" },
            { value: "activity", label: "Activity", count: activityOf(d).length },
            { value: "files", label: "Files", count: d.files.length },
            { value: "terminal", label: "Terminal" },
          ]}
        />
        <div role="tabpanel" aria-label={tab}>
          {tab === "overview" && (d.pr_list.length > 0 ? <Overview d={d} c={reviews} /> : <p className="m-0 text-[14px] text-ink-3">feature.yaml has errors, so its PRs can’t be shown. Fix the problems above.</p>)}
          {tab === "checks" && <ChecksTab d={d} c={reviews} />}
          {tab === "activity" && <ActivityTab d={d} />}
          {tab === "files" && <FilesTab d={d} path={filePath} onPath={setFilePath} />}
          {tab === "terminal" && <TerminalTab d={d} />}
        </div>
      </div>
    </>
  );
}
