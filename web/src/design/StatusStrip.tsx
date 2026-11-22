/** What a value means, which sets its colour: ok (success), live (connected, the second accent), warn, bad, or plain ink. */
export type StripTone = "ok" | "live" | "warn" | "bad" | "plain";

export type StripItem = { key: string; value: string; tone?: StripTone; title?: string };

/**
 * A row of `KEY:: VALUE` pairs (Neon: mono, upper case, the value coloured by meaning). In Flat it
 * is the same pairs as plain small text ("Docker  running"), the value in ink and the key muted.
 * Colour never carries the meaning alone: the value says it in words.
 */
export function StatusStrip({ items, label }: Readonly<{ items: StripItem[]; label: string }>) {
  return (
    <dl data-ui="status-strip" aria-label={label} className="m-0 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-[13px]">
      {items.map((it) => (
        <div key={it.key} className="flex items-baseline gap-2" title={it.title}>
          <dt className="text-ink-3">{it.key}</dt>
          <dd data-tone={it.tone ?? "plain"} className="m-0 font-medium text-ink">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
