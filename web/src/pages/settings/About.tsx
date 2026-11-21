import { ExternalLink, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "../../design/StatusDot";
import { checkedAgo, useCheckUpdate, useUpdate, type UpdateState } from "../../lib/update";

const row = "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2";
const label = "m-0 text-[14px] font-medium leading-5 text-ink";
const value = "m-0 font-mono text-[13px] text-ink-2";

/** One line saying where this build stands. */
function Status({ state }: Readonly<{ state: UpdateState }>) {
  if (state.dev) return <span className="text-ink-3">Development build: it doesn’t check for updates.</span>;
  if (state.error) {
    return (
      <span role="alert" className="inline-flex items-center gap-2">
        <StatusDot tone="warning" />
        Couldn’t check: {state.error}
      </span>
    );
  }
  if (!state.checked_at) return <span className="text-ink-3">Not checked yet.</span>;
  if (state.available) {
    return (
      <span className="inline-flex items-center gap-2">
        <StatusDot tone="good" />
        devdeck {state.latest} is available.
      </span>
    );
  }
  return <span>You have the latest version.</span>;
}

/** Settings → About: the version, and whether a newer release is out. Installing an update comes later (plan U3). */
export function About() {
  const { data: state, isPending, error } = useUpdate();
  const check = useCheckUpdate();

  if (isPending) return <p className="m-0 text-[13px] text-ink-3">Loading…</p>;
  if (error || !state) return <p className="m-0 text-[13px] text-ink-3">The version couldn’t be read{error ? `: ${error.message}` : "."}</p>;

  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 flex flex-col">
        <div className={row}>
          <dt className={label}>Version</dt>
          <dd className={value}>{state.current || "unknown"}</dd>
        </div>
        {state.latest && (
          <div className={row}>
            <dt className={label}>Latest release</dt>
            <dd className={value}>{state.latest}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink">
        <Status state={state} />
        {state.checked_at && !state.dev && <span className="text-ink-3">Checked {checkedAgo(state.checked_at)}.</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {!state.dev && (
          <Button variant="secondary" onClick={() => check.mutate()} disabled={check.isPending} title="Asks GitHub for the newest release. Nothing about you is sent.">
            <RefreshCw className={check.isPending ? "animate-spin" : undefined} aria-hidden />
            {check.isPending ? "Checking…" : "Check now"}
          </Button>
        )}
        {state.url && (
          <Button variant="ghost" asChild>
            <a href={state.url} target="_blank" rel="noreferrer noopener">
              Release notes
              <ExternalLink aria-hidden />
            </a>
          </Button>
        )}
      </div>
      {state.available && (
        <p className="m-0 text-[13px] text-ink-3">To update now, download the installer from the release page and run it. Your settings and data stay.</p>
      )}
    </div>
  );
}
