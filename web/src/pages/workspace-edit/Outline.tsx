import { Link } from "react-router";

import { Mark } from "../../design/IssueList";
import type { Issue } from "../../lib/types";
import { repoAtLine, sectionAtLine, type Outline as OutlineData } from "../../lib/yaml-doc";

const row = "flex w-full items-center gap-2 px-2 py-1 text-start text-[13px] transition-colors hover:bg-fill";

/** The shape of the file at a glance: its sections, its repos (a mark on the ones with a problem), its stack files. */
export function Outline({
  outline,
  issues,
  stacks,
  cursorLine,
  onGo,
}: Readonly<{ outline: OutlineData; issues: Issue[]; stacks: string[]; cursorLine: number; onGo: (line: number) => void }>) {
  const activeRepo = repoAtLine(outline, cursorLine);
  const activeSection = sectionAtLine(outline, cursorLine);
  const worst = (from: number, to: number): Issue["severity"] | undefined => {
    const inside = issues.filter((i) => i.line !== undefined && i.line >= from && i.line <= to);
    if (inside.some((i) => i.severity === "error")) return "error";
    return inside.length > 0 ? "warning" : undefined;
  };

  return (
    <nav aria-label="Outline" className="flex flex-col gap-4 text-ink-2">
      <section>
        <h3 className="m-0 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Sections</h3>
        <ul className="m-0 flex list-none flex-col p-0">
          {outline.sections.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => onGo(s.line)} className={`${row} font-mono ${activeSection?.key === s.key && !activeRepo ? "bg-fill text-ink" : ""}`}>
                {s.key}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="m-0 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Repos · {outline.repos.length}</h3>
        <ul className="m-0 flex list-none flex-col p-0">
          {outline.repos.map((r) => {
            const level = worst(r.from, r.to);
            return (
              <li key={r.index}>
                <button type="button" onClick={() => onGo(r.from)} className={`${row} ${activeRepo?.index === r.index ? "bg-fill text-ink" : ""}`}>
                  <span className="min-w-0 flex-1 truncate font-mono">{r.id || "(no id)"}</span>
                  {level && (
                    <span title={level === "error" ? "Has an error" : "Has a warning"}>
                      <Mark severity={level} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {outline.repos.length === 0 && <li className="px-2 py-1 text-[13px] text-ink-3">No repos yet</li>}
        </ul>
      </section>

      {stacks.length > 0 && (
        <section>
          <h3 className="m-0 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Files</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {stacks.map((name) => (
              <li key={name}>
                <Link to="/stacks" title={`Edit the ${name} stack on the Stacks page`} className={`${row} font-mono text-ink-3 hover:text-ink`}>
                  stacks/{name}.yaml
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}
