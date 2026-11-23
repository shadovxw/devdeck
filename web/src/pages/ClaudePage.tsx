import { useState } from "react";

import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { pill, pillDanger } from "../design/pills";
import { ago, callResult, useClaude, useClaudeCalls, useClearClaudeCalls, useSetClaudeAccess, type ClaudeArea, type ClaudeCall } from "../lib/claude";
import { stagger } from "../lib/motion";
import { useNow } from "../lib/use-now";

const th = "px-4 py-2 text-start text-[13px] font-medium text-ink-3";
const td = "px-4 py-2 align-top";

const installCommand = "devdeck mcp install";

/** One switch. The state is a word as well as a position, never colour alone. */
function AreaRow({ area, busy, onChange }: Readonly<{ area: ClaudeArea; busy: boolean; onChange: (on: boolean) => void }>) {
  return (
    <li className="flex items-center gap-3 py-2">
      <button
        type="button"
        role="switch"
        aria-checked={area.on}
        aria-label={area.label}
        disabled={busy}
        onClick={() => onChange(!area.on)}
        className="inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-fill px-0.5 transition disabled:opacity-45 aria-checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className={`size-5 rounded-full bg-surface-1 transition ${area.on ? "translate-x-4" : ""}`} aria-hidden />
      </button>
      <span className="flex-1 text-[14px] text-ink" title={area.description}>
        {area.label}
      </span>
      <span className="w-10 text-end text-[13px] text-ink-2">{area.on ? "On" : "Off"}</span>
    </li>
  );
}

function Connect() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2" title="Run it in a terminal. It runs “claude mcp add” for you; Claude Code has to be installed.">
      <span className="text-[13px] text-ink-2">Connect Claude Code</span>
      <code className="rounded-ctl bg-inset px-3 py-2 font-mono text-[12px] text-ink">{installCommand}</code>
      <button
        type="button"
        className={pill}
        onClick={() => {
          void navigator.clipboard?.writeText(installCommand);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function asked(call: ClaudeCall): string {
  return call.query ? `${call.path}?${call.query}` : call.path;
}

function Calls({ calls }: Readonly<{ calls: ClaudeCall[] }>) {
  if (calls.length === 0) return <p className="m-0 text-[13px] text-ink-3">Claude hasn’t asked for anything yet.</p>;
  return (
    <div className="max-h-[26rem] overflow-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className={th}>When</th>
            <th className={th}>Tool</th>
            <th className={th}>Asked for</th>
            <th className={th}>Result</th>
            <th className={th}>Size</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <td className={`${td} whitespace-nowrap text-[13px] text-ink-2`}>{new Date(c.at).toLocaleTimeString()}</td>
              <td className={`${td} font-mono text-[12px] text-ink`}>{c.tool || "—"}</td>
              <td className={`${td} max-w-[26rem] truncate font-mono text-[12px] text-ink-2`} title={`${c.method} ${asked(c)}`}>
                {asked(c)}
              </td>
              <td className={`${td} whitespace-nowrap text-[13px] ${c.status >= 400 ? "text-ink" : "text-ink-2"}`} title={`HTTP ${c.status}`}>
                {callResult(c.status)}
              </td>
              <td className={`${td} whitespace-nowrap text-[13px] text-ink-3`}>{c.bytes > 0 ? `${c.bytes.toLocaleString()} B` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClaudePage() {
  const item = navByPath("/claude");
  const state = useClaude();
  const calls = useClaudeCalls();
  const set = useSetClaudeAccess();
  const clear = useClearClaudeCalls();
  const now = useNow(true, 5_000);
  const [sure, setSure] = useState(false);

  return (
    <>
      <PageHeader title={item.label} group={item.group} description="What Claude Code may read from devdeck. It can only read: it can’t start, stop or change anything." />

      <section aria-label="What Claude may read" className="enter mt-4 flex flex-col gap-2 rounded-ctl bg-inset p-5" style={stagger(1)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold text-ink">What Claude may read</h2>
          <span className="text-[13px] text-ink-2">
            {state.data?.last_call ? `Claude last asked ${ago(state.data.last_call, now)}` : "Claude hasn’t asked yet"}
          </span>
        </div>
        {state.isError && (
          <p role="alert" className="m-0 text-[13px] text-ink">
            The settings couldn’t be read: {state.error.message}
          </p>
        )}
        <ul className="m-0 flex list-none flex-col p-0">
          {state.data?.areas.map((a) => (
            <AreaRow key={a.id} area={a} busy={set.isPending} onChange={(on) => set.mutate({ [a.id]: on })} />
          ))}
        </ul>
        {set.isError && (
          <p role="alert" className="m-0 text-[13px] text-ink">
            That change wasn’t saved: {set.error.message}
          </p>
        )}
        <Connect />
      </section>

      <section aria-label="What Claude asked for" className="enter mt-4 flex flex-col gap-3 rounded-ctl bg-inset p-5" style={stagger(2)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold text-ink">What Claude asked for</h2>
          {(state.data?.calls ?? 0) > 0 &&
            (sure ? (
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                Clear the whole list?
                <button
                  type="button"
                  className={pillDanger}
                  onClick={() => {
                    clear.mutate();
                    setSure(false);
                  }}
                >
                  Clear
                </button>
                <button type="button" className={pill} onClick={() => setSure(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className={pill} onClick={() => setSure(true)}>
                Clear list
              </button>
            ))}
        </div>
        {calls.isError ? (
          <p role="alert" className="m-0 text-[13px] text-ink">
            The list couldn’t be read: {calls.error.message}
          </p>
        ) : (
          <Calls calls={calls.data ?? []} />
        )}
        <p className="m-0 text-[12px] text-ink-3">The list keeps the last 1,000 requests: what was asked for, never the answers.</p>
      </section>
    </>
  );
}
