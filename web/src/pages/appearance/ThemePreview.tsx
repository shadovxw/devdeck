import type { CSSProperties } from "react";

import { StatusDot } from "../../design/StatusDot";
import type { Check } from "../../theme/checks";
import type { TokenMap } from "../../theme/types";

/** The tokens as inline CSS variables, so the sample below is drawn in them whatever the page around it is using. */
function varsOf(tokens: TokenMap): CSSProperties {
  return Object.fromEntries(Object.entries(tokens).filter(([name]) => name.startsWith("--"))) as CSSProperties;
}

/** A small stack page in the theme's colours, and whether its text and status colours are readable. */
export function ThemePreview({ tokens, checks }: Readonly<{ tokens: TokenMap; checks: Check[] }>) {
  const failing = checks.filter((c) => !c.ok);
  return (
    <aside aria-label="Preview" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
      <h3 className="m-0 font-mono text-[11px] font-normal uppercase leading-[14px] tracking-[0.06em] text-ink-3">Preview</h3>
      <div style={{ ...varsOf(tokens), colorScheme: tokens["color-scheme"] as CSSProperties["colorScheme"] }} className="bg-bg text-[12px] text-ink shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_15%,transparent)]" data-testid="preview">
        <div className="flex items-center gap-2 bg-fill px-3 py-2.5">
          <b className="text-[13px]">all-service</b>
          <span className="text-ink-3">Starting</span>
          <span className="ms-auto flex gap-1.5">
            <span className="bg-bg px-2.5 py-1 font-medium">Logs</span>
            <span className="bg-primary px-2.5 py-1 font-medium text-primary-foreground">Stop</span>
          </span>
        </div>
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center gap-2 bg-fill px-2 py-1.5">
            <StatusDot tone="good" size={7} />
            <b>vault</b>
            <span className="ms-auto font-mono text-ink-3">8200</span>
          </div>
          <div className="flex items-center gap-2 bg-fill px-2 py-1.5 shadow-[inset_2px_0_0_var(--selected)]">
            <StatusDot tone="critical" size={7} />
            <b>auth</b>
            <span className="text-critical">exited 1</span>
            <span className="ms-auto font-mono text-ink-3">8083</span>
          </div>
          <div className="flex items-center gap-2 bg-fill px-2 py-1.5">
            <StatusDot tone="neutral" size={7} />
            <b>catalog</b>
            <span className="text-ink-3">needs auth</span>
          </div>
          <div className="bg-fill p-2 font-mono text-[11px] leading-[1.7]">
            <span className="text-ink-3">23:17:05</span> <b className="text-critical">ERR</b> column “not_before” missing
            <br />
            <span className="text-ink-3">23:17:12</span> <b className="text-warning">WRN</b> no SMTP configured
            <br />
            <span className="text-ink-3">23:17:16</span> <span className="text-ink-2">accepted connection</span>
          </div>
          <div className="bg-fill px-2 py-1.5 text-ink-3">Filter logs…</div>
          <div className="flex flex-wrap gap-1.5">
            {(["good", "warning", "critical", "neutral"] as const).map((tone) => (
              <span key={tone} className="inline-flex items-center gap-1.5 bg-fill px-2 py-0.5 text-[11px]">
                <StatusDot tone={tone} size={6} />
                {{ good: "Ready", warning: "Warning", critical: "Error", neutral: "Neutral" }[tone]}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="m-0 flex gap-2 bg-fill px-2.5 py-2 text-[12px] text-ink-2" role={failing.length > 0 ? "alert" : undefined}>
        <StatusDot tone={failing.length > 0 ? "critical" : "good"} size={7} className="mt-1" />
        <span>
          {failing.length > 0
            ? `${failing.map((c) => c.label).join(", ")} ${failing.length > 1 ? "are" : "is"} hard to read. Aim for ${failing.some((c) => c.min === 4.5) ? "4.5" : "3"}:1 or more.`
            : "All text and status colours pass WCAG AA."}
        </span>
      </p>
    </aside>
  );
}
