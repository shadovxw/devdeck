import { useState } from "react";

import { pillSmall } from "../../design/pills";
import type { FeatureDetail } from "../../lib/features";
import { useFeatureFile, useFeatureText } from "../../lib/features";
import { ago } from "../../lib/time";
import { useNow } from "../../lib/use-now";
import { activityOf } from "./state";

/** What happened across the feature, newest first: commits on each PR's branch and PRs that merged. */
export function ActivityTab({ d }: Readonly<{ d: FeatureDetail }>) {
  const now = useNow(true, 30_000);
  const items = activityOf(d);
  if (items.length === 0) return <p className="m-0 text-[14px] text-ink-3">Nothing has happened yet: no PR has a branch.</p>;
  return (
    <>
      <ul aria-label="Activity" className="m-0 flex max-w-[860px] list-none flex-col p-0">
        {items.slice(0, 200).map((a, i) => (
          <li key={`${a.pr}-${a.ref}-${i}`} className="grid grid-cols-[72px_64px_minmax(0,1fr)_auto] items-baseline gap-x-3 px-2.5 py-2 text-[13px] odd:bg-inset max-sm:grid-cols-[72px_minmax(0,1fr)]">
            <span className="tabular-nums text-ink-3" title={a.at}>
              {ago(a.at, now)}
            </span>
            <span className={`text-[12px] ${a.source === "GitHub" ? "text-ink-2" : "text-ink-3"}`}>{a.source}</span>
            <span className="min-w-0 text-ink max-sm:col-span-2">
              <b className="mr-1.5 font-mono text-[11.5px] font-medium text-ink-3">{a.pr}</b>
              {a.text}
            </span>
            <span className="font-mono text-[11.5px] text-ink-3 max-sm:hidden">{a.ref}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-3 text-[12px] text-ink-3">Commits and merges only for now. Review runs and what Claude changed (changes.md) come with the review tools.</p>
    </>
  );
}

/** The plan's files: pick one on the left, read it on the right. Edited by Claude and in your editor, not here. */
export function FilesTab({ d }: Readonly<{ d: FeatureDetail }>) {
  const first = d.files.includes("plan.md") ? "plan.md" : d.files.includes("feature.yaml") ? "feature.yaml" : d.files[0];
  const [path, setPath] = useState<string | undefined>(first);
  const file = useFeatureFile(d.workspace, d.name, path);
  return (
    <div className="grid items-start gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
      <ul aria-label="Files of the plan" className="m-0 flex list-none flex-col bg-inset p-2 font-mono text-[12.5px]">
        <li className="break-all px-1.5 pb-1.5 pt-1 text-ink-3">{d.branch}/</li>
        {d.files.map((f) => (
          <li key={f}>
            <button type="button" aria-pressed={f === path} onClick={() => setPath(f)} className={`w-full cursor-pointer break-all px-1.5 py-1 text-left hover:bg-fill-hover ${f === path ? "bg-fill text-ink" : "text-ink-2"}`}>
              {f}
            </button>
          </li>
        ))}
        {d.files.length === 0 && <li className="px-1.5 py-1 text-ink-3">No files.</li>}
      </ul>
      <div className="flex min-w-0 flex-col gap-2">
        {path && (
          <div className="flex items-baseline justify-between gap-2 text-[12.5px] text-ink-3">
            <code className="text-ink">{path}</code>
            <span>{d.read_only ? "Read from git (no worktree)" : "Read from the worktree"}</span>
          </div>
        )}
        {file.isPending && path ? (
          <output aria-label="Loading file…" className="skeleton block h-40 w-full" />
        ) : file.isError ? (
          <p className="m-0 text-[14px] text-ink-3">This file couldn’t be read.</p>
        ) : (
          <pre className="m-0 max-h-[70vh] overflow-auto whitespace-pre bg-inset p-4 font-mono text-[12.5px] leading-relaxed text-ink">{file.data?.text}</pre>
        )}
      </div>
    </div>
  );
}

/** The same text `devdeck feature status` prints in a terminal. */
export function TerminalTab({ d }: Readonly<{ d: FeatureDetail }>) {
  const text = useFeatureText(d.workspace, d.name, true);
  const [copied, setCopied] = useState(false);
  const command = `devdeck feature status -w ${d.workspace} ${d.name}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // the command is on screen to select
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <code className="bg-inset px-3 py-1.5 font-mono text-[12.5px] text-ink">{command}</code>
        <button type="button" onClick={copy} className={pillSmall}>
          {copied ? "Copied" : "Copy command"}
        </button>
      </div>
      {text.isPending ? (
        <output aria-label="Loading the terminal view…" className="skeleton block h-40 w-full" />
      ) : text.isError ? (
        <p className="m-0 text-[14px] text-ink-3">The terminal view couldn’t be loaded.</p>
      ) : (
        <pre aria-label="Terminal view" className="m-0 overflow-x-auto whitespace-pre bg-inset p-4 font-mono text-[12.5px] leading-relaxed text-ink">
          {text.data}
        </pre>
      )}
    </div>
  );
}
