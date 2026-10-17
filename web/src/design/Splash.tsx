import { RotateCw } from "lucide-react";

import { Logo } from "./Logo";

type Props = {
  /** "loading" while connecting; "offline" when the server can't be reached. */
  state?: "loading" | "offline";
  onRetry?: () => void;
};

// The branded loading page. Shown while the app connects to the devdeck server.
export function Splash({ state = "loading", onRetry }: Props) {
  return (
    <div className="splash" data-state={state} role="status" aria-live="polite">
      <Logo className="mark" />
      <div className="bar" />
      {state === "offline" && (
        <div className="note" title="devdeck can't reach its server on 127.0.0.1:7070. Start it with: mise run dev">
          <span className="inline-block size-2 bg-critical" aria-hidden />
          <span>offline</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              aria-label="Retry"
              title="Retry"
              className="grid size-7 place-items-center rounded-ctl border-0 bg-transparent text-ink-3 hover:bg-accent-soft hover:text-ink"
            >
              <RotateCw size={15} />
            </button>
          )}
        </div>
      )}
      {state === "loading" && <span className="sr-only">Loading devdeck</span>}
    </div>
  );
}
