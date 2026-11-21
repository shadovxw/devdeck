import { useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "../../design/StatusDot";
import { checkedAgo, useCheckUpdate, useDownloadUpdate, useInstallUpdate, useSetAutoUpdate, useUpdate, type UpdateState } from "../../lib/update";
import { SegmentedRow } from "../appearance/SegmentedRow";

const AUTO = [
  { id: "on", label: "Automatically" },
  { id: "off", label: "Never" },
] as const;

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
        {state.error}
      </span>
    );
  }
  if (!state.checked_at) return <span className="text-ink-3">Not checked yet.</span>;
  if (state.available) {
    return (
      <span className="inline-flex items-center gap-2">
        <StatusDot tone="good" />
        {state.ready === state.latest ? `devdeck ${state.latest} is downloaded and ready to install.` : `devdeck ${state.latest} is available.`}
      </span>
    );
  }
  return <span>You have the latest version.</span>;
}

/** The confirmation before installing: devdeck closes, so say what that stops. */
function ConfirmInstall({ state, onInstall, onCancel, busy }: Readonly<{ state: UpdateState; onInstall: () => void; onCancel: () => void; busy: boolean }>) {
  const n = state.running_stacks;
  const stacks = `${n} stack${n === 1 ? "" : "s"}`;
  const installLabel = n > 0 ? `Stop ${stacks} and install` : "Install and restart";
  return (
    <div role="alertdialog" aria-label="Install the update" className="flex flex-col gap-3 bg-inset px-3.5 py-3">
      <p className="m-0 text-[13px] text-ink">
        Install devdeck {state.ready}? devdeck closes, updates and opens again.
        {n > 0 && ` This stops ${n} running ${n === 1 ? "stack" : "stacks"}.`}
      </p>
      <span className="flex flex-wrap gap-2">
        <Button onClick={onInstall} disabled={busy}>
          {installLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </span>
    </div>
  );
}

/** Settings → About: the version, whether a newer release is out, and installing it. */
export function About() {
  const { data: state, isPending, error } = useUpdate();
  const check = useCheckUpdate();
  const download = useDownloadUpdate();
  const install = useInstallUpdate();
  const setAuto = useSetAutoUpdate();
  const [confirming, setConfirming] = useState(false);

  if (isPending) return <p className="m-0 text-[13px] text-ink-3">Loading…</p>;
  if (error || !state) return <p className="m-0 text-[13px] text-ink-3">The version couldn’t be read{error ? `: ${error.message}` : "."}</p>;

  if (install.isSuccess) {
    return (
      <output className="m-0 block text-[13px] text-ink">
        Installing devdeck {state.ready}. devdeck closes now and opens again when the update is done.
      </output>
    );
  }

  const ready = state.available && state.ready === state.latest;
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

      {confirming && ready && (
        <ConfirmInstall state={state} busy={install.isPending} onInstall={() => install.mutate()} onCancel={() => setConfirming(false)} />
      )}
      {install.error && (
        <p role="alert" className="m-0 text-[13px] text-ink">
          The update didn’t start: {install.error.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {state.available && state.installable && !ready && (
          <Button onClick={() => download.mutate()} disabled={download.isPending} title="Downloads the installer and checks it against the release’s checksums.">
            <Download aria-hidden />
            {download.isPending ? "Downloading…" : "Download update"}
          </Button>
        )}
        {ready && !confirming && <Button onClick={() => setConfirming(true)}>Install and restart</Button>}
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
      {state.available && !state.installable && state.not_installable && <p className="m-0 text-[13px] text-ink-3">{state.not_installable}</p>}
      {!state.dev && (
        <div className="mt-4">
          <SegmentedRow
            title="Check for updates"
            description="Automatically asks GitHub shortly after devdeck starts and once a day, and tells you when a new version is out. It never installs without asking."
            options={AUTO}
            value={state.auto ? "on" : "off"}
            onChange={(v) => setAuto.mutate(v === "on")}
          />
        </div>
      )}
    </div>
  );
}
