import { colorOf } from "../../theme/checks";
import type { TokenMap } from "../../theme/types";

/** A theme in miniature: a sidebar, a heading, a panel with three status dots and a primary button, drawn in the theme's own colours. */
export function ThemeThumb({ tokens }: Readonly<{ tokens: TokenMap }>) {
  const c = (name: string) => colorOf(tokens, name);
  return (
    <div aria-hidden className="grid aspect-[16/10] grid-cols-[24%_1fr] overflow-hidden" style={{ background: c("--bg") }}>
      <div className="flex flex-col gap-[6%] px-[10%] py-[8%]" style={{ background: c("--sidebar") === c("--bg") ? c("--fill") : c("--sidebar") }}>
        <i className="block h-[5px] w-[70%]" style={{ background: c("--primary") }} />
        <i className="block h-[5px]" style={{ background: c("--ink-3"), opacity: 0.5 }} />
        <i className="block h-[5px] w-[80%]" style={{ background: c("--ink-3"), opacity: 0.5 }} />
        <i className="block h-[5px] w-[60%]" style={{ background: c("--ink-3"), opacity: 0.5 }} />
      </div>
      <div className="flex flex-col gap-[7%] p-[8%]">
        <i className="block h-[9px] w-[46%]" style={{ background: c("--ink") }} />
        <div className="flex flex-1 flex-col gap-[12%] p-[6%]" style={{ background: c("--fill") }}>
          <span className="flex gap-1">
            {["--good", "--warning", "--critical"].map((t) => (
              <span key={t} className="size-1.5 rounded-full" style={{ background: c(t) }} />
            ))}
          </span>
          <i className="block h-[5px] w-4/5" style={{ background: c("--ink-3"), opacity: 0.6 }} />
          <i className="block h-2 w-[28%]" style={{ background: c("--primary") }} />
        </div>
      </div>
    </div>
  );
}
