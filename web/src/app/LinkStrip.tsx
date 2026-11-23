import { CONNECTED_MS } from "../lib/server-link";
import { useLink, useServerWatch } from "../lib/use-server-link";

/**
 * The strip at the top of the page when devdeck loses its server while in use
 * (dev-plans/2026-11-21-portfolio-look §8b, P9a). It shows after 2s without the server (blips
 * show nothing), says how long, and that actions wait; reading still works and the page keeps
 * its last data. When the server is back it says "Connected" for 2s, then goes.
 */
export function LinkStrip() {
  useServerWatch();
  const { view, downFor } = useLink();
  if (view === "up") return null;
  const back = view === "connected";
  return (
    <div
      role="status"
      aria-live="polite"
      data-ui="link-strip"
      data-tone={back ? "good" : "warning"}
      className="flex items-center justify-between gap-3 px-3 py-2 text-[13px] md:px-5"
    >
      <span className="flex items-center gap-2.5 whitespace-nowrap">
        <span data-ui="link-dot" aria-hidden className="size-2 rounded-full" />
        {back ? "Connected" : `Reconnecting · ${Math.floor(downFor / 1000)}s`}
      </span>
      {!back && (
        <span className="truncate text-ink-3" title="Buttons that change things wait until the server is back. Reading still works.">
          Actions paused
        </span>
      )}
      {back && <span className="sr-only">The server is back; the page has refreshed. This note goes in {CONNECTED_MS / 1000}s.</span>}
    </div>
  );
}
