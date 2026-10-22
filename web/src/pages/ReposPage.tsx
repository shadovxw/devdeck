import { FolderGit2 } from "lucide-react";
import { Link } from "react-router";

import { navByPath } from "../app/nav";
import { quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import { useFixIdentity, useGitRepos, type GitRepo, type RepoState } from "../lib/git";

// A state is never colour alone: each has its own shape and a word.
const look: Record<RepoState, { label: string; hint: string; shape: "dot" | "triangle" | "square" | "ring"; color: string }> = {
  ok: { label: "Right account", hint: "A rule picks the account and the commit name and email match.", shape: "dot", color: "var(--good)" },
  "wrong-identity": { label: "Wrong identity", hint: "A rule picks the account, but this repository commits with another name or email.", shape: "triangle", color: "var(--warning)" },
  "no-rule": { label: "No rule", hint: "No rule matches this repository, so git asks as before. Add a rule on the Connections page.", shape: "square", color: "var(--critical)" },
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

function Row({ r }: { r: GitRepo }) {
  const fix = useFixIdentity();
  return (
    <tr className="border-t border-line align-top">
      <td className="px-4 py-2.5">
        <div className="font-medium text-ink">{r.repo}</div>
        <div className="text-[12px] text-ink-3">{r.workspace_name}</div>
      </td>
      <td className="max-w-[22rem] truncate px-4 py-2.5 font-mono text-[12px] text-ink-2" title={r.remote}>
        {r.remote || "—"}
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
      </td>
      <td className="px-3 py-1.5 text-end">
        {r.state === "wrong-identity" && (
          <button
            type="button"
            disabled={fix.isPending}
            onClick={() => fix.mutate({ workspace: r.workspace, repo: r.repo })}
            title="Write this account’s name and email into this repository’s own git config"
            aria-label={`Set the identity of ${r.repo}`}
            className={`${quietButton} !h-9 !px-3 !text-[13px]`}
          >
            Set identity
          </button>
        )}
        {r.state === "no-rule" && (
          <Link to="/connections" className="text-[13px] text-accent hover:underline">
            Add a rule
          </Link>
        )}
      </td>
    </tr>
  );
}

/** The repositories of your workspaces: which account each belongs to, and whether commits go out with the right name and email. */
export function ReposPage() {
  const item = navByPath("/repos");
  const repos = useGitRepos();
  const header = <PageHeader title={item.label} group={item.group} description="Which GitHub account each repository uses, and whether commits carry the right name and email." />;

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
      <div className="enter mt-3 overflow-x-auto rounded-ctl bg-inset" style={stagger(2)}>
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={th}>Repository</th>
              <th className={th}>Remote</th>
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
