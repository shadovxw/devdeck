import { FileText, Layers, Pencil, Play, Plus, RotateCw, Square, Stethoscope, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { BootSequence } from "../design/BootSequence";
import { quietButton } from "../design/buttons";
import { CheckRow } from "../design/CheckRow";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { ServiceStateMark } from "../design/ServiceStateMark";
import { ApiError } from "../lib/api";
import { stagger } from "../lib/motion";
import { useDeleteStack, useRestartService, useRuns, useStartStack, useStopStack, useWorkspace, useWorkspaces } from "../lib/queries";
import { formatUptime, isComposeId, serviceLabel } from "../lib/runs";
import type { DoctorReport, RunState, RunStatus, ServiceState, StackDef, WorkspaceDetail } from "../lib/types";
import { useNow } from "../lib/use-now";
import { StackEditor, stackTemplate } from "./StackEditor";
import { StackLogs } from "./StackLogs";

const select =
  "h-9 max-w-[16rem] rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent";

const small =
  "inline-flex h-9 items-center gap-2 rounded-ctl px-3 text-[14px] font-medium transition active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45";
const startButton = `${small} bg-accent text-on-accent hover:brightness-110`;
const stopButton = `${small} bg-fill text-ink hover:bg-fill-hover`;

/** How a whole stack is shown: the same shapes as a service. */
const runLook: Record<RunState | "none", { state: ServiceState; text: string }> = {
  none: { state: "stopped", text: "Stopped" },
  starting: { state: "starting", text: "Starting" },
  running: { state: "ready", text: "Running" },
  degraded: { state: "blocked", text: "Needs attention" },
  stopping: { state: "stopping", text: "Stopping" },
  stopped: { state: "stopped", text: "Stopped" },
};

/** A refused start carries the Doctor report: pick it out of the error. */
function refusalReport(error: unknown): DoctorReport | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const report = (error.data as { report?: DoctorReport } | undefined)?.report;
  return Array.isArray(report?.checks) ? report : undefined;
}

function StartProblem({ error, workspace, stack }: { error: Error; workspace: string; stack: string }) {
  const failed = refusalReport(error)?.checks.filter((c) => c.status === "fail") ?? [];
  return (
    <div role="alert" className="mx-4 mb-3 rounded-ctl bg-inset py-3">
      <p className="m-0 px-4 text-[14px] text-critical">{error.message}</p>
      {failed.length > 0 && (
        <ul className="m-0 mt-1 list-none p-0">
          {failed.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      )}
      <p className="m-0 mt-2 px-4 text-[13px]">
        <Link to={`/doctor?workspace=${encodeURIComponent(workspace)}&stack=${encodeURIComponent(stack)}`} className="text-accent hover:underline">
          Open Doctor for this stack
        </Link>
      </p>
    </div>
  );
}

const th = "px-4 py-2 text-start text-[13px] font-medium text-ink-3";

function ServiceRows({ run, now, onRestart, restarting }: { run: RunStatus; now: number; onRestart: (service: string) => void; restarting: string | undefined }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className={th}>State</th>
            <th className={th}>Service</th>
            <th className={th}>Port</th>
            <th className={th}>Up for</th>
            <th className={th}>Restarts</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {run.services.map((s) => (
            <ServiceRow key={s.id} service={s} now={now} onRestart={onRestart} busy={restarting === s.id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceRow({ service: s, now, onRestart, busy }: { service: RunStatus["services"][number]; now: number; onRestart: (id: string) => void; busy: boolean }) {
  const isCompose = isComposeId(s.id);
  const name = serviceLabel(s.id);
  const upFor = s.state === "ready" && s.ready_at ? formatUptime(now - Date.parse(s.ready_at)) : "";
  return (
    <>
      <tr className="border-t border-line">
        <td className="whitespace-nowrap px-4 py-2.5">
          <ServiceStateMark state={s.state} />
        </td>
        <td className="px-4 py-2.5 font-medium">{name}</td>
        <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-ink-2">{s.port ?? ""}</td>
        <td className="px-4 py-2.5 tabular-nums text-ink-2">{upFor}</td>
        <td className="px-4 py-2.5 tabular-nums text-ink-2">{s.restarts > 0 ? s.restarts : ""}</td>
        <td className="px-3 py-1 text-end">
          {!isCompose && (
            <button
              type="button"
              onClick={() => onRestart(s.id)}
              disabled={busy}
              title={s.state === "failed" || s.state === "blocked" ? "Try again" : "Restart"}
              aria-label={`Restart ${name}`}
              className="grid size-8 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90 disabled:opacity-50"
            >
              <RotateCw size={15} className={busy ? "animate-spin" : undefined} aria-hidden />
            </button>
          )}
        </td>
      </tr>
      {s.last_error && (
        <tr>
          <td />
          <td colSpan={5} className="break-words px-4 pb-3 text-[13px] text-ink-3">
            {s.last_error}
          </td>
        </tr>
      )}
    </>
  );
}

function StackCard({ workspace, stack, run, now, index }: { workspace: WorkspaceDetail; stack: StackDef; run?: RunStatus; now: number; index: number }) {
  const start = useStartStack();
  const stop = useStopStack();
  const restart = useRestartService();
  const del = useDeleteStack(workspace.id);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const sample = workspace.source === "example";
  const broken = workspace.errors > 0;
  const blockedWhy = sample
    ? "Sample workspaces can’t be started. Add your own workspace to run stacks."
    : broken
      ? "This workspace has errors. Fix them first."
      : undefined;
  const look = runLook[run?.state ?? "none"];
  const ref = { workspace: workspace.id, stack: stack.name };
  const byId = Object.fromEntries((run?.services ?? []).map((s) => [s.id, s]));
  const stopping = run?.state === "stopping" || stop.isPending;

  return (
    <section aria-label={`Stack ${stack.name}`} className="enter rounded-sheet bg-surface-1 pb-2" style={stagger(index + 1)}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] font-semibold text-ink">
            {stack.name}
            <span className="text-[13px] font-normal">
              <ServiceStateMark state={look.state} text={look.text} />
            </span>
            {run?.state === "running" && <span className="text-[13px] font-normal tabular-nums text-ink-3">Up {formatUptime(now - Date.parse(run.started_at))}</span>}
          </h2>
          {stack.description && <p className="m-0 mt-0.5 text-[13px] text-ink-3">{stack.description}</p>}
        </div>

        <Link
          to={`/doctor?workspace=${encodeURIComponent(workspace.id)}&stack=${encodeURIComponent(stack.name)}`}
          title="Check this machine for the stack"
          aria-label={`Check the machine for ${stack.name}`}
          className={`${quietButton} !h-9 !px-2.5`}
        >
          <Stethoscope size={17} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => setShowLogs((v) => !v)}
          aria-expanded={showLogs}
          title={showLogs ? "Hide the logs" : "Show the logs"}
          aria-label={`Logs of ${stack.name}`}
          className={`${quietButton} !h-9 !px-2.5`}
        >
          <FileText size={16} aria-hidden />
        </button>
        {!sample && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={Boolean(run)}
              title={run ? "Stop the stack before editing it" : "Edit this stack"}
              aria-label={`Edit ${stack.name}`}
              className={`${quietButton} !h-9 !px-2.5 disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <Pencil size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={Boolean(run)}
              title={run ? "Stop the stack before deleting it" : "Delete this stack"}
              aria-label={`Delete ${stack.name}`}
              className={`${quietButton} !h-9 !px-2.5 disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </>
        )}
        {run ? (
          <button type="button" onClick={() => stop.mutate(ref)} disabled={stopping} className={stopButton}>
            <Square size={14} fill="currentColor" aria-hidden />
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button type="button" onClick={() => start.mutate(ref)} disabled={start.isPending || Boolean(blockedWhy)} title={blockedWhy} className={startButton}>
            <Play size={14} fill="currentColor" aria-hidden />
            {start.isPending ? "Checking…" : "Start"}
          </button>
        )}
      </div>

      {confirming && (
        <div role="group" aria-label={`Confirm deleting ${stack.name}`} className="mx-4 mb-3 flex flex-col gap-2.5 rounded-ctl bg-inset p-3">
          <p className="m-0 text-[13px] leading-5 text-ink-2">
            Delete “{stack.name}”? Its file moves to a trash folder inside the workspace. Your repositories aren’t touched.
          </p>
          {del.error && (
            <p role="alert" className="m-0 text-[13px] text-critical">
              {del.error.message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => del.mutate(stack.name, { onSuccess: () => setConfirming(false) })}
              disabled={del.isPending}
              className="inline-flex h-8 items-center rounded-ctl bg-critical px-3 text-[13px] font-medium text-white transition hover:brightness-110 active:scale-[.97] disabled:opacity-50"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                del.reset();
              }}
              disabled={del.isPending}
              className={`${quietButton} !h-8 !px-3 !text-[13px]`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {editing && <StackEditor workspace={workspace.id} stack={stack.name} template="" onClose={() => setEditing(false)} />}

      {start.error && !run && <StartProblem error={start.error} workspace={workspace.id} stack={stack.name} />}
      {stop.error && (
        <p role="alert" className="m-0 px-4 pb-3 text-[14px] text-critical">
          {stop.error.message}
        </p>
      )}
      {restart.error && (
        <p role="alert" className="m-0 px-4 pb-3 text-[14px] text-critical">
          {restart.error.message}
        </p>
      )}

      <div className="px-4 pb-3 pt-1">
        <BootSequence stack={stack} services={byId} />
      </div>

      {showLogs && <StackLogs workspace={workspace.id} stack={stack.name} canControl={!sample} />}

      {run && (
        <ServiceRows
          run={run}
          now={now}
          onRestart={(service) => restart.mutate({ ...ref, service })}
          restarting={restart.isPending ? restart.variables?.service : undefined}
        />
      )}
    </section>
  );
}

export function StacksPage() {
  const item = navByPath("/stacks");
  const [params, setParams] = useSearchParams();
  const workspaces = useWorkspaces();
  const [adding, setAdding] = useState(false);

  // Default to the first workspace that has no errors and can run: the user's own ones first.
  const list = workspaces.data ?? [];
  const fallback = (list.find((w) => w.errors === 0 && w.source === "local") ?? list.find((w) => w.errors === 0) ?? list[0])?.id;
  const id = params.get("workspace") ?? fallback;

  const detail = useWorkspace(id);
  const runs = useRuns();
  const mine = (runs.data ?? []).filter((r) => r.workspace === id);
  const now = useNow(mine.length > 0);

  if (workspaces.isSuccess && list.length === 0) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <EmptyState
          icon={Layers}
          empty={{
            headline: "Add a workspace first",
            text: "A stack belongs to a workspace. Add one, then start its stacks from here.",
            cta: { label: "Add workspace", to: "/workspaces" },
          }}
        />
      </>
    );
  }

  const stacks = detail.data?.stacks ?? [];

  return (
    <>
      <PageHeader title={item.label} group={item.group} />

      <div className="enter mt-4 flex flex-wrap items-center gap-3" style={stagger(1)}>
        <label className="sr-only" htmlFor="stacks-workspace">
          Workspace
        </label>
        <select
          id="stacks-workspace"
          className={select}
          value={id ?? ""}
          onChange={(e) => setParams({ workspace: e.target.value }, { replace: true })}
          disabled={list.length === 0}
        >
          {list.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.source === "example" ? " (sample)" : ""}
            </option>
          ))}
        </select>
        <span className="text-[13px] text-ink-3">{detail.data ? `${stacks.length} stack${stacks.length === 1 ? "" : "s"}` : ""}</span>
        {detail.data && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={detail.data.source === "example"}
            title={detail.data.source === "example" ? "Sample workspaces can’t be changed. Add your own workspace to add stacks." : "Add a stack to this workspace"}
            className={`${startButton} ms-auto`}
          >
            <Plus size={16} aria-hidden />
            Add stack
          </button>
        )}
      </div>

      {detail.isPending && id && (
        <div role="status" aria-label="Loading stacks…" className="mt-4 flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-28 w-full" />
          ))}
        </div>
      )}
      {detail.isError && <p className="mt-4 text-ink-3">Could not load this workspace.</p>}

      {detail.data && stacks.length === 0 && (
        <EmptyState
          icon={Layers}
          empty={{
            headline: "This workspace has no stacks",
            text: "A stack is a group of services and containers that start together, written as a file in the workspace’s stacks folder. Add one and it will show up here.",
            cta: detail.data.source === "example" ? undefined : { label: "Add stack" },
          }}
          onCta={() => setAdding(true)}
        />
      )}

      {detail.data && stacks.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          {stacks.map((s, i) => (
            <StackCard key={s.name} workspace={detail.data} stack={s} run={mine.find((r) => r.stack === s.name)} now={now} index={i} />
          ))}
        </div>
      )}

      {adding && detail.data && (
        <StackEditor workspace={detail.data.id} template={stackTemplate(detail.data.workspace?.repos?.[0]?.id)} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
