import { Calendar, ChevronDown, Plus, Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { LevelShape, levelLook, levelOrder } from "../../design/LevelMark";
import { compilePattern, parseFieldFilter, type LogQuery } from "../../lib/log-query";
import { useDebounced } from "../../lib/use-debounced";
import type { LogLevel } from "../../lib/types";

const box = "h-10 rounded-ctl bg-inset text-[14px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent";
const chip = "inline-flex h-8 items-center gap-1.5 rounded-ctl bg-fill ps-3 pe-1 text-[13px] text-ink-2";

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
  /** Every service that has lines or a capture rule. */
  serviceNames: string[];
};

function toggle<T>(list: T[] | undefined, item: T): T[] {
  const cur = list ?? [];
  return cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
}

/** The pattern box: it waits for a pause in typing and for a pattern that compiles. */
function PatternInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // The filter changed from outside (a saved filter was applied): follow it.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const settled = useDebounced(draft, 300);
  const invalid = draft !== "" && !compilePattern(draft);

  useEffect(() => {
    // Only what was typed here is sent on: after the filter changed from outside, `settled` is stale until it catches up.
    if (settled === draft && draft !== value && (draft === "" || compilePattern(draft))) onChange(draft);
  }, [settled, draft, value, onChange]);

  return (
    <span className="relative flex min-w-44 flex-1 flex-col gap-1">
      <label className="sr-only" htmlFor="log-pattern">
        Pattern
      </label>
      <span className="relative">
        <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          id="log-pattern"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pattern, e.g. (?i)timeout|refused"
          aria-invalid={invalid}
          aria-describedby={invalid ? "log-pattern-problem" : undefined}
          spellCheck={false}
          autoComplete="off"
          className={`${box} w-full ps-9 pe-3 font-mono text-[13px]`}
        />
      </span>
      {invalid && (
        <span id="log-pattern-problem" role="alert" className="absolute top-11 text-[12px] text-critical">
          This isn’t a valid pattern.
        </span>
      )}
    </span>
  );
}

function FieldInput({ onAdd }: { onAdd: (raw: string) => void }) {
  const [text, setText] = useState("");
  const ok = parseFieldFilter(text) !== undefined;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    onAdd(text.trim());
    setText("");
  }
  return (
    <form onSubmit={submit} className="relative flex min-w-44 flex-1 items-center">
      <label className="sr-only" htmlFor="log-field">
        Field filter
      </label>
      <input
        id="log-field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="field=value or field!=value"
        spellCheck={false}
        autoComplete="off"
        className={`${box} w-full ps-3 pe-10 font-mono text-[13px]`}
      />
      <button
        type="submit"
        disabled={!ok}
        aria-label="Add the field filter"
        className="absolute end-1 inline-flex size-8 items-center justify-center rounded-ctl text-ink-2 hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Plus size={16} aria-hidden />
      </button>
    </form>
  );
}


/** Which services to look at: a button that opens a list of check boxes. */
export function ServicePicker({ value, onChange, serviceNames }: Props) {
  const services = value.services ?? [];
  return (
    <details className="relative">
      <summary className={`${box} flex cursor-pointer list-none items-center gap-2 px-3`}>
        {services.length === 0 ? "All services" : `${services.length} service${services.length === 1 ? "" : "s"}`}
        <ChevronDown size={15} aria-hidden className="text-ink-3" />
      </summary>
      <fieldset className="absolute start-0 top-11 z-10 m-0 flex max-h-72 min-w-56 flex-col gap-1 overflow-auto rounded-ctl bg-fill p-3 ring-1 ring-line-strong">
        <legend className="sr-only">Services</legend>
        {serviceNames.length === 0 && <span className="text-[13px] text-ink-3">No services yet.</span>}
        {serviceNames.map((name) => (
          <label key={name} className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={services.includes(name)} onChange={() => onChange({ ...value, services: toggle(services, name) })} />
            <span className="font-mono">{name}</span>
          </label>
        ))}
      </fieldset>
    </details>

  );
}

/**
 * The controls of the Logs page that go on one row with the workspace and stack:
 * the levels as one segmented control (with "All"), a pattern, a field filter and a
 * time range.
 */
export function FilterControls({ value, onChange }: Omit<Props, "serviceNames">) {
  const levels = value.levels ?? [];
  const known = sinceChoices.some((c) => c.value === (value.since ?? ""));

  return (
    <>
      <div role="group" aria-label="Levels" className="inline-flex h-10 overflow-hidden rounded-ctl bg-line p-px">
        <button
          type="button"
          aria-pressed={levels.length === 0}
          onClick={() => onChange({ ...value, levels: undefined })}
          className={`px-3.5 text-[14px] transition first:rounded-s-[5px] ${levels.length === 0 ? "bg-accent-soft font-medium text-accent" : "bg-inset text-ink-2 hover:bg-fill"}`}
        >
          All
        </button>
        {levelOrder.map((l: LogLevel) => {
          const on = levels.includes(l);
          const { label } = levelLook[l];
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...value, levels: toggle(value.levels, l) })}
              className={`ms-px inline-flex items-center gap-2 px-3 text-[14px] transition last:rounded-e-[5px] ${on ? "bg-accent-soft text-ink" : "bg-inset text-ink-2 hover:bg-fill"}`}
            >
              <LevelShape level={l} />
              {label[0].toUpperCase() + label.slice(1)}
            </button>
          );
        })}
      </div>

      <PatternInput value={value.regex ?? ""} onChange={(regex) => onChange({ ...value, regex: regex || undefined })} />
      <FieldInput onAdd={(raw) => onChange({ ...value, fields: [...(value.fields ?? []).filter((f) => f !== raw), raw] })} />

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
    </>
  );
}

/** The filters that aren't visible in a control: field filters, one error group, an end time. */
export function ActiveFilters({ value, onChange }: Pick<Props, "value" | "onChange">) {
  if (!((value.fields?.length ?? 0) > 0 || value.group || value.until)) return null;
  const x = "inline-flex size-6 items-center justify-center rounded-ctl hover:bg-accent-soft";
  return (
    <ul aria-label="Active filters" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {(value.fields ?? []).map((f) => (
        <li key={f} className={`${chip} font-mono`}>
          {f}
          <button type="button" aria-label={`Remove the filter ${f}`} onClick={() => onChange({ ...value, fields: (value.fields ?? []).filter((y) => y !== f) })} className={x}>
            <X size={13} aria-hidden />
          </button>
        </li>
      ))}
      {value.group && (
        <li className={chip}>
          One kind of error
          <button type="button" aria-label="Remove the error filter" onClick={() => onChange({ ...value, group: undefined })} className={x}>
            <X size={13} aria-hidden />
          </button>
        </li>
      )}
      {value.until && (
        <li className={chip}>
          Until {new Date(value.until).toLocaleTimeString()}
          <button type="button" aria-label="Show up to now again" onClick={() => onChange({ ...value, until: undefined })} className={x}>
            <X size={13} aria-hidden />
          </button>
        </li>
      )}
    </ul>
  );
}
