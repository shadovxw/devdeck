import { pill, pillDanger, pillPrimary, pillSmall } from "../design/pills";
import type { ActionState, HostAction, RemoteContainer } from "../lib/hosts";

const verbs: Record<HostAction["name"], string> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  up: "Up",
  down: "Stop all",
  pull: "Pull",
  script: "Run up script",
};

/** The name of a write, as its button and its result are labelled. */
export function actionLabel(a: HostAction): string {
  if (a.name === "down" && a.remove) return "Remove containers";
  return a.service ? `${verbs[a.name]} ${a.service}` : verbs[a.name];
}

function question(a: HostAction, stack: string): string {
  switch (a.name) {
    case "start":
      return `Start ${a.service}?`;
    case "stop":
      return `Stop ${a.service}? Services that depend on it may fail until it is started again.`;
    case "restart":
      return `Restart ${a.service}?`;
    case "up":
      return `Start every service of ${stack}, creating or recreating containers where needed?`;
    case "pull":
      return `Pull the images of every service of ${stack}? Running containers are not restarted.`;
    case "down":
      return a.remove ? `Remove the containers of ${stack}? Volumes and their data are kept.` : `Stop every container of ${stack}? Nothing is removed.`;
    case "script":
      return `Run the up script of ${stack} on the host?`;
  }
}

const dangerous = (a: HostAction) => a.name === "stop" || a.name === "down";

/** The actions of a whole stack. Shown only when the stack allows writes. */
export function StackActions({ busy, onPick }: Readonly<{ busy: boolean; onPick: (a: HostAction) => void }>) {
  const btn = (a: HostAction, danger = false) => (
    <button key={actionLabel(a)} type="button" className={danger ? pillDanger : pill} disabled={busy} onClick={() => onPick(a)}>
      {actionLabel(a)}
    </button>
  );
  return (
    <div role="group" aria-label="Stack actions" className="flex flex-wrap items-center gap-2">
      {btn({ name: "up" })}
      {btn({ name: "pull" })}
      {btn({ name: "script" })}
      {btn({ name: "down" }, true)}
      {btn({ name: "down", remove: true }, true)}
    </div>
  );
}

/** Start or stop, and restart, for one service. */
export function RowActions({ c, busy, onPick }: Readonly<{ c: RemoteContainer; busy: boolean; onPick: (a: HostAction) => void }>) {
  const running = c.State === "running" || c.State === "restarting";
  const one = (name: "start" | "stop" | "restart") => (
    <button key={name} type="button" className={pillSmall} disabled={busy} onClick={() => onPick({ name, service: c.Service })} aria-label={`${verbs[name]} ${c.Service}`}>
      {verbs[name]}
    </button>
  );
  return (
    <span className="inline-flex gap-1.5">
      {running ? one("stop") : one("start")}
      {one("restart")}
    </span>
  );
}

/** Asks before a write runs. Nothing happens on the host until Confirm. */
export function ConfirmAction({ action, stack, onConfirm, onCancel }: Readonly<{ action: HostAction; stack: string; onConfirm: () => void; onCancel: () => void }>) {
  const title = actionLabel(action);
  return (
    <div role="alertdialog" aria-label={`Confirm ${title}`} className="flex flex-wrap items-center gap-3 rounded-ctl bg-sidebar px-4 py-3">
      <p className="m-0 text-[14px] text-ink">{question(action, stack)}</p>
      <span className="ms-auto flex gap-2">
        <button type="button" className={dangerous(action) ? pillDanger : pillPrimary} onClick={onConfirm}>
          {title}
        </button>
        <button type="button" className={pill} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/** What the last write printed, and how it ended. */
export function ActionOutput({ state, onDismiss }: Readonly<{ state: ActionState; onDismiss: () => void }>) {
  if (!state.action) return null;
  const title = actionLabel(state.action);
  let status = `${title}…`;
  if (state.result) status = state.result.ok ? `${title}: done` : `${title} failed`;
  return (
    <section aria-label="Last action" className="flex flex-col gap-2 rounded-ctl bg-sidebar p-3">
      <div className="flex items-center justify-between gap-3">
        <output className="text-[13px] font-medium text-ink">{status}</output>
        {!state.running && (
          <button type="button" className={pillSmall} onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      {state.result && !state.result.ok && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {state.result.error}
        </p>
      )}
      {state.lines.length > 0 && (
        <pre aria-label="Output" className="m-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-ctl bg-inset p-3 font-mono text-[12px] leading-5 text-ink-2">
          {state.lines.join("\n")}
        </pre>
      )}
    </section>
  );
}
