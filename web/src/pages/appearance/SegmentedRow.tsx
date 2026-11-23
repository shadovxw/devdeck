import type { LucideIcon } from "lucide-react";

type Option<T extends string> = { id: T; label: string; icon?: LucideIcon };

type Props<T extends string> = {
  title: string;
  description: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A setting with a name, a line saying what it does, and a short list of choices at the right, one of which is on. */
export function SegmentedRow<T extends string>({ title, description, options, value, onChange }: Readonly<Props<T>>) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-2">
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-[14px] font-medium leading-5 text-ink">{title}</h3>
        <p className="m-0 mt-0.5 text-[13px] text-ink-3">{description}</p>
      </div>
      <fieldset className="m-0 inline-flex border-0 bg-fill p-0.5">
        <legend className="sr-only">{title}</legend>
        {options.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={`inline-flex h-7 items-center gap-1.5 px-3 text-[13px] ${value === id ? "bg-ink font-semibold text-bg" : "text-ink-3 hover:text-ink"}`}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
