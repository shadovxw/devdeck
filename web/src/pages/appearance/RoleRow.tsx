import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { gradeOf, type Check } from "../../theme/checks";

type Props = {
  label: string;
  /** What the colour is used for, shown under its name. */
  hint: string;
  color: string;
  /** The colour is the person's own, not the base theme's: it can be reset. */
  changed: boolean;
  /** A built-in theme: shown, not edited. */
  readOnly: boolean;
  /** The checks this colour takes part in. */
  checks: Check[];
  onChange: (color: string) => void;
  onReset: () => void;
};

/** The least comfortable of a role's checks: its grade and ratio. */
function Mark({ checks }: Readonly<{ checks: Check[] }>) {
  if (checks.length === 0) return <span className="w-28" />;
  const worst = checks.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a), checks[0]);
  const grade = gradeOf(worst);
  const detail = checks.map((c) => `${c.label}: ${c.ratio.toFixed(1)}:1, needs ${c.min}:1`).join("\n");
  return (
    <span className="inline-flex w-28 items-center gap-2 font-mono text-[11.5px] text-ink-2" title={detail}>
      <span className={`px-1.5 font-sans text-[10.5px] font-bold text-bg ${grade === "LOW" ? "bg-critical" : "bg-good"}`}>{grade}</span>
      <span className="tabular-nums">{worst.ratio.toFixed(1)}:1</span>
    </span>
  );
}

/** One colour: a swatch that opens a picker, its name and use, how readable it is, the colour as hex, and a way back to the base colour. */
export function RoleRow({ label, hint, color, changed, readOnly, checks, onChange, onReset }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  return (
    <li className="group flex flex-col gap-2 py-1.5 hover:bg-fill">
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={`${label}: change colour`}
          aria-expanded={open}
          disabled={readOnly}
          onClick={() => setOpen((v) => !v)}
          style={{ background: color }}
          className="size-[34px] shrink-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_20%,transparent)] disabled:cursor-default"
        />
        <span className="min-w-0 flex-1" title={hint}>
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          <span className="block truncate text-[12px] text-ink-3">{hint}</span>
        </span>
        <Mark checks={checks} />
        <HexColorInput
          color={color}
          onChange={onChange}
          prefixed
          readOnly={readOnly}
          aria-label={`${label}: hex colour`}
          spellCheck={false}
          className="h-[34px] w-24 bg-fill px-2.5 font-mono text-[12px] uppercase text-ink outline-none hover:bg-fill-hover group-hover:bg-bg"
        />
        <button
          type="button"
          aria-label={`${label}: back to the base colour`}
          title="Back to the base colour"
          disabled={!changed || readOnly}
          onClick={onReset}
          className="inline-flex size-7 items-center justify-center text-ink-3 hover:bg-fill hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      </div>
      {open && !readOnly && (
        <div className="ps-[50px]">
          <HexColorPicker
            color={color}
            onChange={onChange}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            className="[&_.react-colorful\_\_pointer]:size-4 [&_.react-colorful\_\_saturation]:rounded-none [&_.react-colorful\_\_hue]:rounded-none [&_.react-colorful\_\_last-control]:rounded-none"
            style={{ width: 240, height: 160 }}
          />
        </div>
      )}
    </li>
  );
}
