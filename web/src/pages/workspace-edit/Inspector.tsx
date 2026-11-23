import { Mark } from "../../design/IssueList";
import { StatusMark } from "../../design/StatusMark";
import type { GitRepo } from "../../lib/git";
import type { Issue, IssueFix } from "../../lib/types";
import { repoAtLine, type Outline } from "../../lib/yaml-doc";

const label = "m-0 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3";

function Fact({ name, children }: Readonly<{ name: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <dt className="shrink-0 text-ink-3">{name}</dt>
      <dd className="m-0 min-w-0 truncate text-end font-mono text-ink">{children}</dd>
    </div>
  );
}

/** What git says about a repo's folder, as rows: its branch, remote and profile, or why there is nothing. */
function GitFacts({ localOnly, row }: Readonly<{ localOnly: boolean; row: GitRepo | undefined }>) {
  if (localOnly) return <Fact name="Git">local only</Fact>;
  if (!row) return <Fact name="Git">not checked yet (save first)</Fact>;
  if (!row.work) return <Fact name="Git">not a git repository</Fact>;
  return (
    <>
      <Fact name="Branch">{row.work.branch || "–"}</Fact>
      <Fact name="Remote">{row.remote || "none"}</Fact>
      <Fact name="Profile">{row.connection ?? "no rule matches"}</Fact>
    </>
  );
}

/** The repo under the cursor, checked against this machine: its folder, branch, remote, profile and the stacks using it. */
function AtCursor({ outline, line, git, stacks }: Readonly<{ outline: Outline; line: number; git: GitRepo[]; stacks: Array<{ name: string; repos: string[] }> }>) {
  const repo = repoAtLine(outline, line);
  if (!repo) return <p className="m-0 text-[13px] text-ink-3">Put the cursor in a repo to see it checked here.</p>;

  const row = git.find((g) => g.repo === repo.id);
  const users = stacks.filter((s) => s.repos.includes(repo.id)).map((s) => s.name);

  return (
    <dl className="m-0">
      <Fact name="Repo">{repo.id || "–"}</Fact>
      <Fact name="Folder">{row?.path ?? repo.path ?? "–"}</Fact>
      <GitFacts localOnly={repo.localOnly} row={row} />
      <Fact name="Used by">{users.length > 0 ? users.join(", ") : "no stack"}</Fact>
    </dl>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What is being checked overall, as three lines: the schema, the folders, git. */
function Checks({ issues, valid }: Readonly<{ issues: Issue[]; valid: boolean }>) {
  const count = (code: string) => issues.filter((i) => i.code === code).length;
  const missing = count("repo-folder-missing");
  const notGit = count("repo-not-git");
  const line = (ok: boolean, good: string, bad: string) => ({ ok, text: ok ? good : bad });
  const rows = [
    line(valid, "Matches the schema", "Doesn't match the schema yet"),
    line(missing === 0, "Every folder is there", `${plural(missing, "folder")} missing`),
    line(notGit === 0, "Every folder is a git repository", `${plural(notGit, "folder")} without git`),
  ];
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((r) => (
        <li key={r.text} className="flex items-center gap-2 text-[13px] text-ink-2">
          <StatusMark level={r.ok ? "ok" : "warn"} />
          {r.text}
        </li>
      ))}
    </ul>
  );
}

/** The right-hand column: the repo at the cursor, the problems (click one to jump to it) and the overall checks. */
export function Inspector({
  outline,
  line,
  git,
  stacks,
  issues,
  valid,
  onGo,
  onFix,
}: Readonly<{
  outline: Outline;
  line: number;
  git: GitRepo[];
  stacks: Array<{ name: string; repos: string[] }>;
  issues: Issue[];
  valid: boolean;
  onGo: (line: number) => void;
  onFix: (issue: Issue, fix: IssueFix) => void;
}>) {
  return (
    <aside aria-label="Inspector" className="flex flex-col gap-5">
      <section>
        <h3 className={label}>At cursor</h3>
        <AtCursor outline={outline} line={line} git={git} stacks={stacks} />
      </section>

      <section aria-live="polite">
        <h3 className={label}>Problems · {issues.length}</h3>
        {issues.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">None.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {issues.map((i, n) => (
              <li key={`${i.line}-${i.path}-${n}`} className="flex items-start gap-2 text-[13px] leading-5">
                <span className="mt-[3px]">
                  <Mark severity={i.severity} />
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={!i.line}
                    onClick={() => i.line && onGo(i.line)}
                    className="block w-full text-start text-ink-2 enabled:hover:text-ink enabled:hover:underline"
                  >
                    <span className="sr-only">{i.severity === "error" ? "Error: " : "Warning: "}</span>
                    {i.line ? <span className="me-1.5 font-mono tabular-nums text-ink-3">{i.line}</span> : null}
                    {i.message}
                  </button>
                  {(i.fixes ?? []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {i.fixes?.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => onFix(i, f)}
                          className="h-6 bg-fill px-2 text-[12px] text-ink transition-colors hover:bg-fill-hover active:bg-fill-press"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={label}>Checks</h3>
        <Checks issues={issues} valid={valid} />
      </section>
    </aside>
  );
}
