import { Sparkline } from "../../design/Sparkline";
import { StatusDot } from "../../design/StatusDot";
import type { ServiceStat } from "../../lib/log-services";

type Props = {
  stats: ServiceStat[];
  /** The services that are picked; none means every service. */
  picked: string[];
  onToggle: (service: string) => void;
  onClear: () => void;
  /** Picks the services that have errors among the loaded lines. */
  onOnlyErrors: () => void;
};

/** 1,284 as "1.3k", so the count fits its column. */
function compact(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
}

const label = "font-mono text-[11px] uppercase leading-[14px] tracking-[0.06em] text-ink-3";
const link = "text-[12px] normal-case tracking-normal text-ink-3 hover:text-ink hover:underline";

/**
 * The services of a stack as a column: a check box, a dot for the worst level seen, the name and how
 * many lines are loaded. With none checked every service is shown; checking some shows only those.
 */
export function ServiceFacet({ stats, picked, onToggle, onClear, onOnlyErrors }: Readonly<Props>) {
  const anyError = stats.some((s) => s.tone === "critical");
  return (
    <section aria-label="Services" className="flex min-w-0 flex-col gap-2">
      <h2 className={`${label} m-0 flex items-baseline gap-3 font-normal`}>
        <span>Services</span>
        <span className="ms-auto flex gap-3">
          {anyError && (
            <button type="button" onClick={onOnlyErrors} className={link}>
              only errors
            </button>
          )}
          {picked.length > 0 && (
            <button type="button" onClick={onClear} className={link}>
              all
            </button>
          )}
        </span>
      </h2>
      {stats.length === 0 && <p className="m-0 text-[13px] text-ink-3">No services yet.</p>}
      <ul className="m-0 flex list-none flex-col p-0">
        {stats.map((s) => {
          const on = picked.includes(s.name);
          const dim = picked.length > 0 && !on;
          return (
            <li key={s.name}>
              <label className={`grid cursor-pointer grid-cols-[14px_1fr_48px_2.25rem] items-center gap-2 px-1.5 py-1 text-[13px] hover:bg-fill ${dim ? "text-ink-3" : "text-ink"}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(s.name)} className="size-3 cursor-pointer" />
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot tone={s.tone} size={6} />
                  <span className="truncate font-mono text-[12px]">{s.name}</span>
                </span>
                {s.counts ? <Sparkline counts={s.counts} tone={s.tone === "critical" ? "critical" : "ink-3"} /> : <span />}
                <span className="text-end font-mono text-[11px] tabular-nums text-ink-3">{compact(s.count)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
