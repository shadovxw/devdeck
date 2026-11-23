import { ChevronDown, ChevronRight } from "lucide-react";

import type { LogGroup, LogSeries, LogTrends } from "../../lib/types";
import { ErrorGroups } from "./ErrorGroups";

type Props = {
  groups: LogGroup[];
  open: boolean;
  onToggle: () => void;
  selected: string | undefined;
  onSelect: (fingerprint: string | undefined) => void;
  now: number;
  series: Map<string, LogSeries>;
  /** The counts over the range, which say how long it is. */
  trends: LogTrends | undefined;
};

/** The kinds of error seen, behind a heading that folds them away. Nothing when there are none. */
export function ErrorsSection({ groups, open, onToggle, selected, onSelect, now, series, trends }: Readonly<Props>) {
  if (groups.length === 0) return null;
  const rangeSeconds = trends ? Math.max(1, (Date.parse(trends.to) - Date.parse(trends.from)) / 1000) : undefined;
  return (
    <section aria-label="Errors" className="flex min-w-0 flex-col gap-2">
      <button type="button" aria-expanded={open} onClick={onToggle} className="inline-flex items-center gap-2 self-start px-1 text-[14px] font-semibold text-ink">
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        Errors ({groups.length})
      </button>
      {open && <ErrorGroups groups={groups} selected={selected} onSelect={onSelect} now={now} series={series} rangeSeconds={rangeSeconds} />}
    </section>
  );
}
