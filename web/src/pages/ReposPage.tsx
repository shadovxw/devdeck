import { FolderGit2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { pill, pillPrimary, pillSmall } from "../design/pills";
import { stagger } from "../lib/motion";
import { useFixIdentity, useGitRepos, useRepoOp, type GitRepo, type RepoOpName, type RepoState } from "../lib/git";

// A state is never colour alone: each has its own shape and a word.
const look: Record<RepoState, { label: string; hint: string; shape: "dot" | "triangle" | "square" | "ring"; color: string }> = {
  ok: { label: "Right account", hint: "A rule picks the account and the commit name and email match.", shape: "dot", color: "var(--good)" },
  "wrong-identity": { label: "Wrong identity", hint: "A rule picks the account, but this repository commits with another name or email.", shape: "triangle", color: "var(--warning)" },
  "no-rule": { label: "No rule", hint: "No rule matches this repository, so git asks as before. Add a rule on the GitHub connection page.", shape: "square", color: "var(--critical)" },
  "no-remote": { label: "No remote", hint: "This repository has no origin.", shape: "ring", color: "var(--ink-3)" },
  missing: { label: "Not found", hint: "The folder isn’t there, or isn’t a git repository.", shape: "ring", color: "var(--ink-3)" },
  "other-host": { label: "Not GitHub", hint: "Only github.com is handled.", shape: "ring", color: "var(--ink-3)" },
};

function StateMark({ state }: { state: RepoState }) {
  const { label, hint, shape, color } = look[state];
  return (
    <span className="inline-flex items-center gap-2 text-ink-2" title={hint}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {shape === "dot" && <circle cx="6" cy="6" r="4.5" fill={color} />}
        {shape === "ring" && <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.6" />}
        {shape === "triangle" && <path d="M6 1.2 11 10.2H1Z" fill={color} />}
        {shape === "square" && <rect x="1.8" y="1.8" width="8.4" height="8.4" fill={color} />}
      </svg>
      {label}
    </span>
  );
}

const th = "px-4 py-2 text-start text-[13px] font-medium text-ink-3";

/** The branch, how it compares with its upstream, and how many files have changes. */
function Where({ r }: { r: GitRepo }) {
  const w = r.work;
  if (!w) return <span className="text-ink-3">—</span>;
  const level = w.upstream !== "" && w.ahead === 0 && w.behind === 0;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[12px] text-ink" title={w.upstream ? `Tracks ${w.upstream}` : undefined}>
        {w.detached ? "detached HEAD" : w.branch}
      </span>
      <span className="text-[12px] text-ink-3">
        {w.upstream === "" ? (
          "no upstream"
        ) : level ? (
          "up to date"
        ) : (
          <span title={`${w.ahead} ahead of ${w.upstream}, ${w.behind} behind`}>
            <span aria-hidden>
              ↑{w.ahead} ↓{w.behind}
            </span>
            <span className="sr-only">
              {w.ahead} ahead, {w.behind} behind
            </span>
          </span>
        )}
        {w.changed > 0 && <span> · {w.changed} changed</span>}
      </span>
    </div>
  );
}

const verbs: Record<RepoOpName, { label: string; doing: string }> = {
  fetch: { label: "Fetch", doing: "Fetching…" },
  pull: { label: "Pull", doing: "Pulling…" },
  push: { label: "Push", doing: "Pushing…" },
  clone: { label: "Clone", doing: "Cloning…" },
};

/** The command that will run, for checking before it does, or for copying and running yourself. */
function Confirm({ title, command, onRun, onCancel, busy }: { title: string; command: string; onRun: () => void; onCancel: () => void; busy?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="alertdialog" aria-label={title} className="mt-2 flex flex-col gap-2 rounded-ctl bg-fill p-3 text-start text-[13px] text-ink-2">
      <code className="break-all rounded-ctl bg-inset px-2.5 py-1.5 font-mono text-[12px] text-ink">{command}</code>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onRun} disabled={busy} className={pillPrimary}>
          Run
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(command);
            setCopied(true);
          }}
          className={pill}
        >
          {copied ? "Copied" : "Copy command"}
        </button>
        <button type="button" onClick={onCancel} className={pill}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ r }: { r: GitRepo }) {
  const fix = useFixIdentity();
  const op = useRepoOp();
  const [confirm, setConfirm] = useState<RepoOpName | null>(null);
  const [output, setOutput] = useState("");

  const run = (name: RepoOpName) => {
    setConfirm(null);
    setOutput("");
    op.mutate({ workspace: r.workspace, repo: r.repo, op: name }, { onSuccess: (res) => setOutput(res.output) });
  };
  const behind = r.work?.behind ?? 0;
  // fetch runs at once; the others change files or the remote, so they show the command and ask first
  const button = (name: "fetch" | "pull" | "push", enabled: boolean, hint: string) => (
    <button
      key={name}
      type="button"
      disabled={!enabled || op.isPending}
      onClick={() => (name === "fetch" ? run(name) : setConfirm(name))}
      title={r.commands?.[name] ?? hint}
      aria-label={`${verbs[name].label} ${r.repo}`}
      className={pillSmall}
    >
      {verbs[name].label}
    </button>
  );

  return (
    <tr className="border-t border-line align-top">
      <td className="px-4 py-2.5">
        <div className="font-medium text-ink" title={r.remote || undefined}>
          {r.repo}
        </div>
        <div className="text-[12px] text-ink-3">{r.workspace_name}</div>
      </td>
      <td className="px-4 py-2.5">
        <Where r={r} />
      </td>
      <td className="px-4 py-2.5">
        {r.connection ? <span className="rounded-ctl bg-fill px-2 py-0.5 font-mono text-[12px] text-ink">{r.connection}</span> : <span className="text-ink-3">—</span>}
      </td>
      <td className="px-4 py-2.5">
        <StateMark state={r.state} />
        {r.state === "wrong-identity" && (
          <div className="mt-1 font-mono text-[12px] text-ink-3">
            {r.actual.email || "no email"} instead of {r.expected.email || r.expected.name}
          </div>
        )}
        {fix.error && (
          <div role="alert" className="mt-1 text-[12px] text-critical">
            {fix.error.message}
          </div>
        )}
        {op.isPending && (
          <div role="status" className="mt-1 text-[12px] text-ink-3">
            {verbs[(op.variables?.op ?? "fetch") as RepoOpName].doing}
          </div>
        )}
        {op.error && (
          <div role="alert" className="mt-1 max-w-[26rem] whitespace-pre-wrap break-words text-[12px] text-critical">
            {op.error.message}
          </div>
        )}
        {output !== "" && !op.isPending && !op.error && (
          <pre className="m-0 mt-1 max-h-24 max-w-[26rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-3">{output}</pre>
        )}
      </td>
      <td className="px-3 py-1.5 text-end">
        <div className="flex flex-wrap justify-end gap-1.5">
          {r.work && (
            <>
              {button("fetch", !!r.commands?.fetch, "Fetch needs a remote")}
              {button("pull", !!r.commands?.pull && behind > 0, behind > 0 ? "Nothing to pull from here" : "Already up to date")}
              {button("push", !!r.commands?.push, "No commits are waiting to be pushed")}
            </>
          )}
          {r.clone && (
            <button type="button" disabled={op.isPending} onClick={() => setConfirm("clone")} title={r.clone.command} aria-label={`Clone ${r.repo}`} className={pillSmall}>
              Clone
            </button>
          )}
          {r.state === "wrong-identity" && (
            <button
              type="button"
              disabled={fix.isPending}
              onClick={() => fix.mutate({ workspace: r.workspace, repo: r.repo })}
              title="Write this account’s name and email into this repository’s own git config"
              aria-label={`Set the identity of ${r.repo}`}
              className={pillSmall}
            >
              Set identity
            </button>
          )}
          {r.state === "no-rule" && (
            <Link to="/connections/github" className={pillSmall}>
              Add a rule
            </Link>
          )}
        </div>
        {confirm && confirm !== "fetch" && (
          <Confirm
            title={`Confirm ${verbs[confirm].label.toLowerCase()} ${r.repo}`}
            command={confirm === "clone" ? (r.clone?.command ?? "") : (r.commands?.[confirm] ?? "")}
            onRun={() => run(confirm)}
            onCancel={() => setConfirm(null)}
            busy={op.isPending}
          />
        )}
      </td>
    </tr>
  );
}

type Bulk = "fetch" | "pull" | "clone";

// Which repositories each bulk action touches. Pull all only takes the ones that are behind and clean,
// so it never meets a conflict with files you are working on.
const picks: Record<Bulk, (r: GitRepo) => boolean> = {
  fetch: (r) => !!r.commands?.fetch,
  pull: (r) => !!r.commands?.pull && (r.work?.behind ?? 0) > 0 && r.work?.changed === 0,
  clone: (r) => !!r.clone,
};

const bulkText: Record<Bulk, { button: string; confirm: string; command: string; done: string; doing: string }> = {
  fetch: { button: "Fetch all", confirm: "", command: "git fetch --prune origin", done: "Fetched", doing: "Fetching" },
  pull: { button: "Pull all", confirm: "Pulls only repositories that are behind and have no changes, one at a time, and never merges.", command: "git pull --ff-only", done: "Pulled", doing: "Pulling" },
  clone: { button: "Clone missing", confirm: "Clones the repositories whose folder is missing, one at a time, with the account their rule picks.", command: "git clone", done: "Cloned", doing: "Cloning" },
};

type Progress = { kind: Bulk; done: number; total: number; failed: { repo: string; message: string }[]; running: boolean };

/** Fetch all, Pull all and Clone missing: the single operations in a loop, so each repository reports for itself. */
function BulkBar({ repos }: { repos: GitRepo[] }) {
  const op = useRepoOp();
  const [confirm, setConfirm] = useState<Bulk | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const running = progress?.running ?? false;

  const run = async (kind: Bulk) => {
    setConfirm(null);
    const rows = repos.filter(picks[kind]);
    const failed: Progress["failed"] = [];
    setProgress({ kind, done: 0, total: rows.length, failed, running: true });
    for (const [i, r] of rows.entries()) {
      try {
        await op.mutateAsync({ workspace: r.workspace, repo: r.repo, op: kind });
      } catch (e) {
        failed.push({ repo: r.repo, message: e instanceof Error ? e.message : "it failed" });
      }
      setProgress({ kind, done: i + 1, total: rows.length, failed: [...failed], running: i + 1 < rows.length });
    }
  };

  const button = (kind: Bulk) => {
    const n = repos.filter(picks[kind]).length;
    return (
      <button
        key={kind}
        type="button"
        disabled={n === 0 || running}
        onClick={() => (kind === "fetch" ? void run(kind) : setConfirm(kind))}
        title={n === 0 ? "Nothing to do" : bulkText[kind].command}
        className={pill}
      >
        {bulkText[kind].button}
        {kind !== "fetch" && n > 0 ? ` (${n})` : ""}
      </button>
    );
  };

  const t = progress ? bulkText[progress.kind] : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {button("fetch")}
        {button("pull")}
        {button("clone")}
      </div>
      {confirm && (
        <div role="alertdialog" aria-label={`Confirm ${bulkText[confirm].button.toLowerCase()}`} className="mt-3 flex flex-col gap-2 rounded-ctl bg-inset px-4 py-3 text-[13px] text-ink-2">
          <p className="m-0">{bulkText[confirm].confirm}</p>
          <p className="m-0 font-mono text-[12px] text-ink">{repos.filter(picks[confirm]).map((r) => r.repo).join(", ")}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void run(confirm)} className={pillPrimary}>
              {bulkText[confirm].button}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className={pill}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {progress && t && (
        <div className="mt-3 text-[13px]">
          <p role="status" className="m-0 text-ink-2">
            {progress.running ? `${t.doing} ${progress.done + 1} of ${progress.total}…` : `${t.done} ${progress.total - progress.failed.length} of ${progress.total}.`}
          </p>
          {progress.failed.length > 0 && (
            <ul role="alert" className="m-0 mt-1 list-none p-0 text-critical">
              {progress.failed.map((f) => (
                <li key={f.repo} className="whitespace-pre-wrap break-words">
                  <span className="font-medium">{f.repo}</span>: {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** The repositories of your workspaces: where each stands, which account it uses, and the git actions for it. */
export function ReposPage() {
  const item = navByPath("/repos");
  const repos = useGitRepos();
  const header = <PageHeader title={item.label} group={item.group} description="Where each repository stands, which GitHub account it uses, and the git actions for it." />;

  if (repos.isPending) {
    return (
      <>
        {header}
        <div role="status" aria-label="Loading…" className="mt-4 flex flex-col gap-3">
          <div className="skeleton h-40 w-full" />
        </div>
      </>
    );
  }
  if (repos.isError) {
    return (
      <>
        {header}
        <p className="mt-4 text-ink-3">Could not read the repositories.</p>
      </>
    );
  }
  if (repos.data.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderGit2}
          empty={{ headline: "No repository yet", text: "The repositories listed in your workspaces appear here, each with its GitHub account.", cta: { label: "Go to Workspaces", to: "/workspaces" } }}
        />
      </>
    );
  }

  const flagged = repos.data.filter((r) => r.state === "no-rule" || r.state === "wrong-identity").length;
  return (
    <>
      {header}
      <p role="status" className="enter m-0 mt-4 text-[14px] text-ink-2" style={stagger(1)}>
        {repos.data.length} {repos.data.length === 1 ? "repository" : "repositories"}{flagged > 0 ? `, ${flagged} need${flagged === 1 ? "s" : ""} attention` : ", all fine"}.
      </p>
      <div className="enter mt-3" style={stagger(1)}>
        <BulkBar repos={repos.data} />
      </div>
      <div className="enter mt-3 overflow-x-auto rounded-ctl bg-inset" style={stagger(2)}>
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={th}>Repository</th>
              <th className={th}>Branch</th>
              <th className={th}>Account</th>
              <th className={th}>Status</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {repos.data.map((r) => (
              <Row key={`${r.workspace}/${r.repo}`} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
