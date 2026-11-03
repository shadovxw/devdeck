import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { StatusMark } from "../../design/StatusMark";
import type { GitRepo } from "../../lib/git";
import type { Repo } from "../../lib/types";
import { filterRows, gitLabel, noFilter, repoRows, sharedPrefix, type RepoFilter, type RepoRow } from "./repo-rows";

const th = "px-3 py-2 text-start text-[12px] font-medium text-ink-3";
const td = "px-3 py-2 align-middle";

function Chip({ on, onClick, children, count }: Readonly<{ on: boolean; onClick: () => void; children: React.ReactNode; count: number }>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[12.5px] transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-fill text-ink hover:bg-fill-hover"}`}
    >
      {children}
      <span className={`font-mono text-[11px] ${on ? "opacity-80" : "text-ink-3"}`}>{count}</span>
    </button>
  );
}

function Row({ row, prefix }: Readonly<{ row: RepoRow; prefix: string }>) {
  const { repo, type, git } = row;
  const label = gitLabel(git);
  const dim = prefix !== "" && repo.id.startsWith(prefix);
  return (
    <tr className="hover:bg-fill/50">
      <td className={`${td} whitespace-nowrap font-mono text-[13px]`}>
        {dim && <span className="text-ink-3">{prefix}</span>}
        <b className="font-semibold text-ink">{dim ? repo.id.slice(prefix.length) : repo.id}</b>
      </td>
      <td className={td}>
        <span className="rounded-tag bg-inset px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{type}</span>
      </td>
      <td className={`${td} whitespace-nowrap font-mono text-[12.5px] text-ink-2`}>{git?.work?.branch ?? <span className="text-ink-3">–</span>}</td>
      <td className={`${td} whitespace-nowrap text-[13px]`}>
        {label.tone === "none" ? (
          <span className="inline-flex items-center gap-1.5 text-ink-3">
            <StatusMark level="warn" />
            no .git
          </span>
        ) : (
          <span className={label.tone === "dirty" ? "font-medium text-ink" : "text-ink-3"}>{label.text}</span>
        )}
      </td>
      <td className={`${td} max-w-64 truncate font-mono text-[12.5px] text-ink-3`} title={repo.remote}>
        {repo.remote ?? "–"}
      </td>
    </tr>
  );
}

/** The repos of a workspace: filter by name, type, uncommitted changes or behind; the local-only ones come last. */
export function RepoTable({ workspace, repos, git }: Readonly<{ workspace: string; repos: Repo[]; git: GitRepo[] }>) {
  const [filter, setFilter] = useState<RepoFilter>(noFilter);
  const rows = useMemo(() => repoRows(repos, git), [repos, git]);
  const shown = filterRows(rows, filter);
  const prefix = useMemo(() => sharedPrefix(repos.map((r) => r.id)), [repos]);

  const types = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) n.set(r.type, (n.get(r.type) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const changed = rows.filter((r) => (r.git?.work?.changed ?? 0) > 0).length;
  const behind = rows.filter((r) => (r.git?.work?.behind ?? 0) > 0).length;
  const attention = git.filter((g) => g.state !== "ok" && g.state !== "no-remote" && g.state !== "missing").length;

  const tracked = shown.filter((r) => !r.repo.local_only);
  const local = shown.filter((r) => r.repo.local_only);
  const flip = (t: string) => setFilter((f) => ({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] }));

  if (repos.length === 0) return <p className="m-0 py-4 text-[14px] text-ink-3">This workspace has no repositories yet. Add some in its file.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={filter.text}
            onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
            placeholder="Filter repositories"
            aria-label="Filter repositories"
            className="h-7 w-56 bg-inset ps-8 pe-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        {types.map(([t, n]) => (
          <Chip key={t} on={filter.types.includes(t)} onClick={() => flip(t)} count={n}>
            {t}
          </Chip>
        ))}
        <span aria-hidden className="text-ink-3">
          |
        </span>
        <Chip on={filter.changed} onClick={() => setFilter((f) => ({ ...f, changed: !f.changed }))} count={changed}>
          Uncommitted changes
        </Chip>
        <Chip on={filter.behind} onClick={() => setFilter((f) => ({ ...f, behind: !f.behind }))} count={behind}>
          Behind
        </Chip>
      </div>

      {attention > 0 && (
        <p role="status" className="m-0 flex items-center gap-2 bg-fill px-3 py-2 text-[13px] text-ink-2">
          <StatusMark level="warn" />
          <span className="flex-1">{attention === 1 ? "1 repository needs" : `${attention} repositories need`} a look at its remote or GitHub profile.</span>
          <Link to="/repos" className="font-medium text-ink underline underline-offset-2">
            Open Repositories
          </Link>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="m-0 py-4 text-[14px] text-ink-3">No repository matches.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]" aria-label={`Repositories of ${workspace}`}>
            <thead>
              <tr>
                <th className={th}>Repository</th>
                <th className={th}>Type</th>
                <th className={th}>Branch</th>
                <th className={th}>Git</th>
                <th className={th}>Remote</th>
              </tr>
            </thead>
            <tbody>
              {tracked.map((r) => (
                <Row key={r.repo.id} row={r} prefix={prefix} />
              ))}
              {local.length > 0 && (
                <tr>
                  <td colSpan={5} className="px-3 pb-1 pt-4 text-[12px] font-medium text-ink-3">
                    Local only <span className="font-normal">· no remote, not git repositories</span>
                  </td>
                </tr>
              )}
              {local.map((r) => (
                <Row key={r.repo.id} row={r} prefix={prefix} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
