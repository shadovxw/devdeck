import { RotateCw } from "lucide-react";

import { useUi } from "../store/ui";
import { Logo } from "./Logo";

/** Where the server listens, and the command that starts it. */
export const SERVER_ADDRESS = "127.0.0.1:7070";
export const START_COMMAND = "devdeck serve";

type Props = {
  /** "loading" while connecting; "offline" when the server can't be reached. */
  state?: "loading" | "offline";
  onRetry?: () => void;
  /** Milliseconds until the next try, for the countdown. */
  nextIn?: number;
  /** Tries so far. */
  attempt?: number;
};

const countdown = (nextIn: number, attempt: number) => `Retrying in ${Math.max(1, Math.ceil(nextIn / 1000))}s · attempt ${attempt}`;

/**
 * Offline at start, in the Neon style (dev-plans/2026-11-21-portfolio-look §8b, P9a): the dimmed
 * lockup, the red line, the address it tried, what to do, Retry now, the start command, and when
 * it tries again. The moment the server answers, the app comes up by itself.
 */
function NeonOffline({ onRetry, nextIn = 0, attempt = 1 }: Readonly<Omit<Props, "state">>) {
  return (
    <div className="splash splash-neon" data-state="offline" role="status" aria-live="polite">
      <div data-ui="splash-lockup" aria-hidden>
        <Logo className="mark" />
        <span data-ui="wordmark-neon">
          dev<span>deck</span>
        </span>
      </div>
      <div data-ui="splash-line" aria-hidden />
      <div data-ui="splash-say">
        <p data-ui="splash-offline" className="m-0">
          <span aria-hidden data-ui="splash-dot" />
          Server offline · {SERVER_ADDRESS}
        </p>
        <p className="m-0">devdeck can’t reach its server. Start it, and this page connects by itself.</p>
      </div>
      <div data-ui="splash-actions">
        {onRetry && (
          <button type="button" onClick={onRetry} data-ui="splash-retry">
            Retry now
          </button>
        )}
        <code data-ui="splash-command" title="Run this in a terminal to start devdeck’s server">
          $ {START_COMMAND}
        </code>
      </div>
      <p data-ui="splash-next" className="m-0">
        {countdown(nextIn, attempt)}
      </p>
    </div>
  );
}

// The branded loading page. Shown while the app connects to the devdeck server.
export function Splash({ state = "loading", onRetry, nextIn, attempt }: Props) {
  const look = useUi((s) => s.look);
  if (state === "offline" && look === "neon") return <NeonOffline onRetry={onRetry} nextIn={nextIn} attempt={attempt} />;
  const title = `devdeck can’t reach its server on ${SERVER_ADDRESS}. Start it with: ${START_COMMAND}`;
  return (
    <div className="splash" data-state={state} role="status" aria-live="polite">
      <Logo className="mark" />
      <div className="bar" />
      {state === "offline" && (
        <div className="note" title={attempt ? `${title}. ${countdown(nextIn ?? 0, attempt)}.` : title}>
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
      {state === "loading" && <span className="sr-only">Loading devdeck…</span>}
    </div>
  );
}
