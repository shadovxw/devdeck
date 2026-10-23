import { useCallback, useEffect, useState } from "react";

/** What devdeck's own window (Wails) puts on the page. It isn't there in a browser. */
type WailsRuntime = {
  WindowMinimise: () => void;
  WindowToggleMaximise: () => void;
  WindowIsMaximised: () => Promise<boolean>;
  Quit: () => void;
};

function runtime(): WailsRuntime | null {
  const r = (window as unknown as { runtime?: Partial<WailsRuntime> }).runtime;
  return r && typeof r.WindowMinimise === "function" && typeof r.WindowToggleMaximise === "function" && typeof r.Quit === "function" ? (r as WailsRuntime) : null;
}

/** True when the page is shown in devdeck's own window, which has no title bar of its own. */
export function inDesktopWindow(): boolean {
  return runtime() !== null;
}

/** The window's buttons, or null in a browser. */
export function useDesktopWindow() {
  const rt = runtime();
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    const r = runtime();
    if (!r?.WindowIsMaximised) return;
    const read = () => void r.WindowIsMaximised().then(setMaximised, () => undefined);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const minimise = useCallback(() => runtime()?.WindowMinimise(), []);
  const toggleMaximise = useCallback(() => runtime()?.WindowToggleMaximise(), []);
  const close = useCallback(() => runtime()?.Quit(), []);
  return rt ? { maximised, minimise, toggleMaximise, close } : null;
}
