import { Plus } from "lucide-react";

import { Mark } from "../../design/IssueList";
import type { WorkspaceSummary } from "../../lib/types";

// Ink at falling strengths, so the mix reads in every theme (Paper is monochrome) without a palette of its own.
const SHADES = ["var(--ink)", "color-mix(in srgb, var(--ink) 62%, var(--bg))", "color-mix(in srgb, var(--ink) 36%, var(--bg))", "color-mix(in srgb, var(--ink) 16%, var(--bg))"];

/** The repos by type, biggest first: the first three types get their own shade, the rest share the lightest. */
export function typeMix(counts: Record<string, number> | undefined): Array<{ type: string; count: number; shade: string }> {
  return Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count], i) => ({ type, count, shade: SHADES[Math.min(i, SHADES.length - 1)] }));
}

function Stat({ value, label, children }: Readonly<{ value: number; label: string; children?: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <b className="inline-flex items-center gap-1.5 text-[20px] font-bold leading-none tabular-nums text-ink">
        {children}
        {value}
      </b>
      <span className="text-[12px] text-ink-3">{label}</span>
    </div>
  );
}

function Card({ w, selected, onSelect }: Readonly<{ w: WorkspaceSummary; selected: boolean; onSelect: () => void }>) {
  const problems = w.errors + w.warnings;
  const mix = typeMix(w.repo_types);
  const total = mix.reduce((n, m) => n + m.count, 0);
  return (
    <li className="contents">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Workspace ${w.name}`}
        onClick={onSelect}
        className={`flex min-w-0 flex-col gap-4 rounded-sheet p-4 text-start transition-colors ${selected ? "bg-fill" : "bg-surface-1 hover:bg-fill/60"}`}
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold text-ink">{w.name}</span>
            {w.root && <span className="block truncate font-mono text-[12px] text-ink-3">{w.root}</span>}
          </span>
          <span className="shrink-0 rounded-tag bg-inset px-2 py-0.5 text-[12px] text-ink-3">{w.source === "local" ? "Yours" : "Example"}</span>
        </span>

        {w.description && <span className="line-clamp-2 text-[13px] leading-5 text-ink-3">{w.description}</span>}

        <span className="mt-auto flex items-end gap-6">
          <Stat value={w.repos} label="repos" />
          <Stat value={w.stacks} label="stacks" />
          <Stat value={w.flows} label="flows" />
          <span className="ms-auto">
            <Stat value={problems} label={problems === 1 ? "problem" : "problems"}>
              {problems > 0 && <Mark severity={w.errors > 0 ? "error" : "warning"} />}
            </Stat>
          </span>
        </span>

        {total > 0 && (
          <span className="flex flex-col gap-1.5">
            <span className="flex h-1.5 w-full gap-px overflow-hidden rounded-tag" role="img" aria-label={`Repos by type: ${mix.map((m) => `${m.type} ${m.count}`).join(", ")}`}>
              {mix.map((m) => (
                <i key={m.type} style={{ flex: m.count, background: m.shade }} />
              ))}
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-3" aria-hidden>
              {mix.map((m) => (
                <span key={m.type} className="inline-flex items-center gap-1.5">
                  <i className="size-2 rounded-tag" style={{ background: m.shade }} />
                  {m.type} {m.count}
                </span>
              ))}
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

/** The workspaces as cards, with a tile at the end to add another. The selected one has its details below. */
export function WorkspaceCards({
  items,
  selected,
  onSelect,
  onAdd,
}: Readonly<{ items: WorkspaceSummary[]; selected: string | undefined; onSelect: (id: string) => void; onAdd: () => void }>) {
  return (
    <ul aria-label="Workspaces" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3 p-0">
      {items.map((w) => (
        <Card key={w.id} w={w} selected={w.id === selected} onSelect={() => onSelect(w.id)} />
      ))}
      <li className="contents">
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-36 flex-col items-center justify-center gap-1.5 rounded-sheet bg-surface-1 p-4 text-center text-ink-3 transition-colors hover:bg-fill/60 hover:text-ink"
        >
          <Plus size={18} aria-hidden />
          <b className="text-[14px] font-semibold text-ink">Add a workspace</b>
          <span className="max-w-60 text-[12.5px] leading-5">Pick a folder. devdeck finds the git repos inside and writes a workspace.yaml.</span>
        </button>
      </li>
    </ul>
  );
}
