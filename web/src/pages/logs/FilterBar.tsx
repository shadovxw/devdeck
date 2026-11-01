import { Calendar, ChevronDown } from "lucide-react";

import type { LogQuery } from "../../lib/log-query";

const box = "h-[34px] bg-fill text-[13px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill-hover";

export const sinceChoices: { value: string; label: string }[] = [
  { value: "", label: "Any time" },
  { value: "5m", label: "Last 5 minutes" },
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

type Props = {
  value: LogQuery;
  onChange: (next: LogQuery) => void;
};

/** The time range: a relative stretch, or "A chosen stretch" after dragging across the histogram. */
export function SinceSelect({ value, onChange }: Readonly<Props>) {
  const known = sinceChoices.some((c) => c.value === (value.since ?? ""));
  return (
    <span className="relative inline-flex">
      <Calendar size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-2" />
      <label className="sr-only" htmlFor="log-since">
        Time range
      </label>
      <select
        id="log-since"
        className={`${box} appearance-none ps-9 pe-9`}
        value={value.since ?? ""}
        onChange={(e) => onChange({ ...value, since: e.target.value || undefined, until: undefined })}
      >
        {sinceChoices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
        {!known && <option value={value.since}>A chosen stretch</option>}
      </select>
      <ChevronDown size={15} aria-hidden className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-3" />
    </span>
  );
}
