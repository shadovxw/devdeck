import { Copy, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDesktopWindow } from "../lib/desktop";

const button = "grid size-9 place-items-center rounded-ctl text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-95";

/** Minimise, maximise and close, for devdeck's own window. Nothing in a browser, which has its own. */
export function WindowControls() {
  const win = useDesktopWindow();
  if (!win) return null;
  return (
    <div role="group" aria-label="Window" className="flex items-center gap-0.5">
      <button type="button" onClick={win.minimise} title="Minimise" aria-label="Minimise" className={button}>
        <Minus size={18} strokeWidth={1.7} />
      </button>
      <button type="button" onClick={win.toggleMaximise} title={win.maximised ? "Restore" : "Maximise"} aria-label={win.maximised ? "Restore" : "Maximise"} className={button}>
        {win.maximised ? <Copy size={15} strokeWidth={1.7} /> : <Square size={15} strokeWidth={1.7} />}
      </button>
      <button type="button" onClick={win.close} title="Close devdeck" aria-label="Close devdeck" className={cn(button, "hover:bg-critical hover:text-white")}>
        <X size={19} strokeWidth={1.7} />
      </button>
    </div>
  );
}
