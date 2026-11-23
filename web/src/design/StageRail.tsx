type Props = {
  /** The stages in order, e.g. Boot, Build, Install, Migrate, Ready. */
  stages: string[];
  /** How many are done, from the start. */
  done: number;
  /** The stage after the last done one is in trouble or waiting (drawn in the warning colour). */
  warn?: boolean;
  /** Hide the labels under the marks (dense rows). */
  compact?: boolean;
};

/**
 * Progress through a fixed list of stages: diamonds joined by a line, labels under them, filled
 * in the accent when done (design/pieces.css). The list itself says how far it got, for screen readers.
 */
export function StageRail({ stages, done, warn = false, compact = false }: Readonly<Props>) {
  const n = Math.max(0, Math.min(done, stages.length));
  const now = n < stages.length ? stages[n] : undefined;
  const summary = now ? `${n} of ${stages.length} stages done, ${warn ? "stuck at" : "next"}: ${now}` : `All ${stages.length} stages done`;
  return (
    <div data-ui="stage-rail" data-warn={warn || undefined} className="flex flex-col gap-1.5">
      <ol aria-label={summary} className="m-0 flex list-none items-center p-0">
        {stages.map((s, i) => (
          <li key={s} data-state={i < n ? "done" : i === n && warn ? "warn" : "todo"} className="flex min-w-0 flex-1 items-center last:flex-none">
            <span data-ui="stage-mark" aria-hidden />
            {i < stages.length - 1 && <span data-ui="stage-line" data-done={i < n - 1 || undefined} aria-hidden />}
            <span className="sr-only">
              {s}: {i < n ? "done" : "not yet"}
            </span>
          </li>
        ))}
      </ol>
      {!compact && (
        <div aria-hidden className="flex justify-between font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
          {stages.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
