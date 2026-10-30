import { useEffect, useRef, useState, type ReactNode } from "react";

import { pill, pillInput, pillPrimary, pillSmall } from "../design/pills";
import {
  useHostVersionHistory,
  useHostVersions,
  useVersionsChange,
  type AgentStack,
  type HostView,
  type VersionEntry,
  type VersionEvent,
  type VersionRequest,
  type VersionResult,
  type VersionsRunState,
} from "../lib/hosts";
import { ago } from "../lib/time";
import { useNow } from "../lib/use-now";

const th = "px-3 py-2 text-start text-[13px] font-medium text-ink-3";
const td = "px-3 py-2 align-top";
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** What a build left to deploy: its Docker Hub repository and the tag that was pushed. */
export type Deploy = { repository: string; tag: string };

/** A state as a word with a shape, never colour alone. */
function Mark({ shape, color, children, title }: Readonly<{ shape: "dot" | "ring" | "triangle" | "square"; color: string; children: ReactNode; title?: string }>) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2" title={title}>
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {shape === "dot" && <circle cx="6" cy="6" r="4.5" fill={color} />}
        {shape === "ring" && <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.6" />}
        {shape === "triangle" && <path d="M6 1.2 11 10.2H1Z" fill={color} />}
        {shape === "square" && <rect x="1.8" y="1.8" width="8.4" height="8.4" fill={color} />}
      </svg>
      {children}
    </span>
  );
}

function stateMark(e: VersionEntry) {
  if (!e.state) return <span className="text-[13px] text-ink-3">no container</span>;
  if (e.state === "running" && e.health === "unhealthy") return <Mark shape="triangle" color="var(--warning)">Unhealthy</Mark>;
  if (e.state === "running" && e.health === "starting") return <Mark shape="ring" color="var(--accent)">Starting</Mark>;
  if (e.state === "running") return <Mark shape="dot" color="var(--good)">{e.health === "healthy" ? "Healthy" : "Running"}</Mark>;
  if (e.state === "exited") return <Mark shape="square" color="var(--critical)">Stopped</Mark>;
  return <Mark shape="ring" color="var(--ink-3)">{e.state}</Mark>;
}

/** What is about to be asked of the host, in words, before anything is sent. */
type Pending = { title: string; request: VersionRequest; lines: string[] };

function Confirm({ pending, onConfirm, onCancel }: Readonly<{ pending: Pending; onConfirm: () => void; onCancel: () => void }>) {
  const { request } = pending;
  return (
    <div role="alertdialog" aria-label={`Confirm ${pending.title}`} className="flex flex-col gap-2 rounded-ctl bg-sidebar px-4 py-3">
      <ul className="m-0 list-none p-0 font-mono text-[13px] text-ink">
        {pending.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="m-0 text-[13px] leading-5 text-ink-2">
        {request.apply
          ? "The host pulls these images and recreates only these containers. Other services are not touched. If a pull fails, the file is put back as it was."
          : "Only the file on the host changes. Nothing is pulled or restarted."}
      </p>
      <span className="flex gap-2">
        <button type="button" className={request.apply ? pillPrimary : pill} onClick={onConfirm}>
          {pending.title}
        </button>
        <button type="button" className={pill} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}

function ResultRow({ r }: Readonly<{ r: VersionResult }>) {
  return (
    <li className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-3 text-[13px] text-ink">
        <span className="font-mono">
          {r.service}:{r.tag}
        </span>
        {r.ok ? <Mark shape="dot" color="var(--good)">Running{r.health === "healthy" ? " and healthy" : ""}</Mark> : <Mark shape="triangle" color="var(--critical)">Didn’t come up well</Mark>}
        {r.detail && <span className="text-ink-2">{r.detail}</span>}
      </span>
      {r.logs && r.logs.length > 0 && (
        <pre aria-label={`Last log lines of ${r.service}`} className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-ctl bg-inset p-3 font-mono text-[12px] leading-5 text-ink-2">
          {r.logs.join("\n")}
        </pre>
      )}
    </li>
  );
}

function Output({ state, onDismiss }: Readonly<{ state: VersionsRunState; onDismiss: () => void }>) {
  if (!state.request) return null;
  const what = state.request.apply ? "Deploy" : "Save";
  let status = `${what}…`;
  if (state.result) status = state.result.ok ? `${what}: done` : `${what} failed`;
  return (
    <section aria-label="Last change" className="flex flex-col gap-2 rounded-ctl bg-sidebar p-3">
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
      {state.results.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {state.results.map((r) => (
            <ResultRow key={r.service} r={r} />
          ))}
        </ul>
      )}
      {state.lines.length > 0 && (
        <pre aria-label="Output" className="m-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-ctl bg-inset p-3 font-mono text-[12px] leading-5 text-ink-2">
          {state.lines.join("\n")}
        </pre>
      )}
    </section>
  );
}

function History({ events, writable, busy, onRollback }: Readonly<{ events: VersionEvent[]; writable: boolean; busy: boolean; onRollback: (e: VersionEvent) => void }>) {
  const now = useNow(true, 30_000);
  if (events.length === 0) return <p className="m-0 text-[13px] text-ink-3">No tag has been changed from devdeck on this host yet.</p>;
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className={th}>When</th>
            <th className={th}>Service</th>
            <th className={th}>Change</th>
            <th className={th}>By</th>
            <th className={th}>Result</th>
            <th className={th}>
              <span className="sr-only">Roll back</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={`${e.at}-${e.service}-${i}`} className="border-t border-line">
              <td className={`${td} whitespace-nowrap text-[13px] text-ink-2`}>{ago(e.at, now)}</td>
              <td className={`${td} font-mono text-[13px] text-ink`}>{e.service}</td>
              <td className={`${td} font-mono text-[12px] text-ink-2`}>
                {e.old} → {e.new}
              </td>
              <td className={`${td} text-[13px] text-ink-2`}>{e.by || "—"}</td>
              <td className={td} title={e.detail}>
                {!e.applied ? <span className="text-[13px] text-ink-2">Saved only</span> : e.ok ? <Mark shape="dot" color="var(--good)">Deployed</Mark> : <Mark shape="triangle" color="var(--critical)">Failed</Mark>}
              </td>
              <td className={`${td} text-end`}>
                {writable && e.old !== e.new && (
                  <button type="button" className={pillSmall} disabled={busy} onClick={() => onRollback(e)} aria-label={`Roll back ${e.service} to ${e.old}`}>
                    Roll back
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The image tags of one stack on a host: what its versions file says, what runs, a field to change
 * each tag, and the history with Roll back. Nothing is sent until the confirmation. `deploy` is a tag
 * a build just pushed: the services that use its repository are filled in, to check and deploy.
 */
export function HostVersions({ host, stack, deploy }: Readonly<{ host: HostView; stack: AgentStack; deploy?: Deploy | null }>) {
  const versions = useHostVersions(host.workspace, host.id, stack.id, true);
  const history = useHostVersionHistory(host.workspace, host.id, stack.id, true);
  const change = useVersionsChange(host.workspace, host.id, stack.id);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const filled = useRef(false);
  const writable = stack.allow_write;
  const busy = change.state.running || pending !== null;

  // A tag from a build fills in the services that use its repository, once.
  useEffect(() => {
    if (!deploy || filled.current || !versions.data) return;
    filled.current = true;
    const next: Record<string, string> = {};
    for (const e of versions.data.services) if (e.editable && e.repository === deploy.repository) next[e.service] = deploy.tag;
    setInputs((cur) => ({ ...next, ...cur }));
  }, [deploy, versions.data]);

  if (versions.isPending) return <output aria-label="Loading versions…" className="skeleton block h-24 w-full" />;
  if (versions.isError) {
    const none = versions.error.message.includes("no versions_file");
    return (
      <p role="alert" className="m-0 text-[13px] text-ink-2">
        {none
          ? "This stack has no versions file in the agent’s configuration, so its tags can’t be changed from devdeck. Set versions_file (and list it in env_files) in the agent’s agent.yaml."
          : `The versions couldn’t be read: ${versions.error.message}`}
      </p>
    );
  }

  const entries = versions.data.services;
  const typed = entries.filter((e) => e.editable && (inputs[e.service] ?? "").trim() !== "");
  const bad = typed.filter((e) => !tagPattern.test(inputs[e.service].trim()));
  const matching = deploy ? entries.filter((e) => e.editable && e.repository === deploy.repository) : [];

  const ask = (title: string, changes: { service: string; tag: string }[], apply: boolean) => {
    const lines = changes.map((c) => {
      const e = entries.find((x) => x.service === c.service);
      return `${c.service}: ${e?.file_tag || "latest"} → ${c.tag}`;
    });
    setPending({ title, request: { changes, apply }, lines });
  };
  const typedChanges = () => typed.map((e) => ({ service: e.service, tag: inputs[e.service].trim() }));

  return (
    <div className="flex flex-col gap-3">
      {deploy && (
        <p role="status" className="m-0 rounded-ctl bg-fill p-3 text-[13px] text-ink-2">
          {matching.length > 0
            ? `From your build: ${deploy.repository}:${deploy.tag}. ${matching.map((m) => m.service).join(", ")} use${matching.length === 1 ? "s" : ""} ${deploy.repository}, so ${matching.length === 1 ? "its tag is" : "their tags are"} filled in below. Check, then deploy.`
            : `From your build: ${deploy.repository}:${deploy.tag}. No service of this stack uses ${deploy.repository}.`}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={th}>Service</th>
              <th className={th}>Image</th>
              <th className={th}>In the file</th>
              <th className={th}>Running</th>
              <th className={th}>State</th>
              <th className={th}>New tag</th>
              <th className={th}>
                <span className="sr-only">Redeploy</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.service} className="border-t border-line">
                <td className={`${td} font-medium text-ink`}>{e.service}</td>
                <td className={`${td} max-w-[16rem] truncate font-mono text-[12px] text-ink-2`} title={e.note ?? e.repository}>
                  {e.repository ?? "—"}
                </td>
                <td className={`${td} font-mono text-[13px] text-ink`}>{e.editable ? e.file_tag || "latest" : (e.file_tag ?? "—")}</td>
                <td className={`${td} font-mono text-[13px] text-ink-2`}>
                  {e.running_tag !== undefined ? e.running_tag || "latest" : "—"}
                  {e.differs && (
                    <span className="ms-2 inline-flex" title="The file says one tag and another one runs: a change that was saved but not deployed, or made by hand on the host.">
                      <Mark shape="triangle" color="var(--warning)">
                        differs
                      </Mark>
                    </span>
                  )}
                </td>
                <td className={td}>{stateMark(e)}</td>
                <td className={td}>
                  {e.editable ? (
                    <input
                      aria-label={`New tag for ${e.service}`}
                      value={inputs[e.service] ?? ""}
                      onChange={(ev) => setInputs((cur) => ({ ...cur, [e.service]: ev.target.value }))}
                      disabled={!writable || busy}
                      title={writable ? undefined : "The agent on this host only lets devdeck look at this stack (allow_write is off)."}
                      placeholder={writable ? "tag" : "read-only"}
                      spellCheck={false}
                      autoComplete="off"
                      className={`${pillInput} w-36 font-mono`}
                    />
                  ) : (
                    <span className="text-[12px] text-ink-3" title={e.note}>
                      can’t be changed here
                    </span>
                  )}
                </td>
                <td className={`${td} text-end`}>
                  {writable && e.editable && (
                    <button
                      type="button"
                      className={pillSmall}
                      disabled={busy}
                      aria-label={`Redeploy ${e.service}`}
                      title="Pull this tag again and recreate the container, for example after the tag was pushed again."
                      onClick={() => ask(`Redeploy ${e.service}`, [{ service: e.service, tag: e.file_tag || "latest" }], true)}
                    >
                      Redeploy
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bad.length > 0 && <p className="m-0 text-[12px] text-ink-3">A tag has letters, digits, dots, dashes and underscores (128 at most): {bad.map((b) => b.service).join(", ")}.</p>}
      {writable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={pillPrimary} disabled={busy || typed.length === 0 || bad.length > 0} onClick={() => ask("Deploy", typedChanges(), true)}>
            {typed.length > 1 ? `Deploy ${typed.length} changes` : "Deploy"}
          </button>
          <button type="button" className={pill} disabled={busy || typed.length === 0 || bad.length > 0} onClick={() => ask("Save only", typedChanges(), false)} title="Change the file on the host without pulling or restarting anything, to deploy later with its up script.">
            Save only
          </button>
        </div>
      )}

      {pending && (
        <Confirm
          pending={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const request = pending.request;
            setPending(null);
            setInputs({});
            void change.run(request);
          }}
        />
      )}
      <Output state={change.state} onDismiss={change.clear} />

      <h4 className="m-0 mt-1 text-[14px] font-medium text-ink">Changes</h4>
      <History
        events={history.data ?? []}
        writable={writable}
        busy={busy}
        onRollback={(e) => ask(`Roll back ${e.service}`, [{ service: e.service, tag: e.old }], true)}
      />
    </div>
  );
}
