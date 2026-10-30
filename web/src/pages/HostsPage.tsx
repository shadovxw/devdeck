import { Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { navByPath } from "../app/nav";
import { LevelMark } from "../design/LevelMark";
import { PageHeader } from "../design/PageHeader";
import { pill, pillDanger, pillInput, pillPrimary, pillSelect, pillSmall } from "../design/pills";
import {
  useDisconnectHost,
  useForgetHostToken,
  useHostCompose,
  useHostInfo,
  useHostLogs,
  useHosts,
  useHostAction,
  useHostServices,
  useSaveHostToken,
  type AgentStack,
  type ComposeService,
  type HostAction,
  type HostView,
  type RemoteContainer,
} from "../lib/hosts";
import { readLine } from "../lib/log-line";
import { stagger } from "../lib/motion";
import { ActionOutput, ConfirmAction, RowActions, StackActions } from "./HostActions";

// A state is never colour alone: each has its own shape and a word.
type Shape = "dot" | "ring" | "triangle" | "square";

function Mark({ shape, color, label, hint }: Readonly<{ shape: Shape; color: string; label: string; hint?: string }>) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-2" title={hint}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {shape === "dot" && <circle cx="6" cy="6" r="4.5" fill={color} />}
        {shape === "ring" && <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.6" />}
        {shape === "triangle" && <path d="M6 1.2 11 10.2H1Z" fill={color} />}
        {shape === "square" && <rect x="1.8" y="1.8" width="8.4" height="8.4" fill={color} />}
      </svg>
      {label}
    </span>
  );
}

function containerMark(c: RemoteContainer) {
  if (c.State === "running" && c.Health === "unhealthy") return <Mark shape="triangle" color="var(--warning)" label="Unhealthy" hint={c.Status} />;
  if (c.State === "running" && c.Health === "starting") return <Mark shape="ring" color="var(--accent)" label="Starting" hint={c.Status} />;
  if (c.State === "running") return <Mark shape="dot" color="var(--good)" label={c.Health === "healthy" ? "Healthy" : "Running"} hint={c.Status} />;
  if (c.State === "restarting") return <Mark shape="triangle" color="var(--warning)" label="Restarting" hint={c.Status} />;
  if (c.State === "exited" && c.ExitCode !== 0) return <Mark shape="square" color="var(--critical)" label={`Exited (${c.ExitCode})`} hint={c.Status} />;
  return <Mark shape="ring" color="var(--ink-3)" label={c.State === "exited" ? "Stopped" : c.State} hint={c.Status} />;
}

function ports(c: RemoteContainer): string {
  const seen = new Set<number>();
  for (const p of c.Publishers ?? []) if (p.PublishedPort > 0) seen.add(p.PublishedPort);
  return [...seen].sort((a, b) => a - b).join(", ");
}

const th = "px-4 py-2 text-start text-[13px] font-medium text-ink-3";
const td = "px-4 py-2 align-top";

type Writes = Readonly<{ busy: boolean; onPick: (a: HostAction) => void }>;

function Services({ host, stack, onLogs, writes }: Readonly<{ host: HostView; stack: string; onLogs: (service: string) => void; writes?: Writes }>) {
  const q = useHostServices(host.workspace, host.id, stack, true);
  if (q.isPending) return <output aria-label="Loading services" className="skeleton block h-24 w-full" />;
  if (q.isError) return <p role="alert" className="m-0 text-[13px] text-critical">{q.error.message}</p>;
  if (q.data.length === 0) return <p className="m-0 text-[13px] text-ink-3">No container of this stack exists on the host. It hasn’t been brought up.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className={th}>Service</th>
            <th className={th}>State</th>
            <th className={th}>Image</th>
            <th className={th}>Ports</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((c) => (
            <tr key={c.Name} className="border-t border-line">
              <td className={td}>
                <div className="font-medium text-ink">{c.Service}</div>
                <div className="font-mono text-[12px] text-ink-3">{c.Name}</div>
              </td>
              <td className={td}>{containerMark(c)}</td>
              <td className={`${td} max-w-[22rem] truncate font-mono text-[12px] text-ink-2`} title={c.Image}>
                {c.Image}
              </td>
              <td className={`${td} font-mono text-[12px] text-ink-2`}>{ports(c) || "—"}</td>
              <td className="px-3 py-1.5 text-end">
                <span className="inline-flex gap-1.5">
                  {writes && <RowActions c={c} busy={writes.busy} onPick={writes.onPick} />}
                  <button type="button" className={pillSmall} onClick={() => onLogs(c.Service)} aria-label={`Logs of ${c.Service}`}>
                    Logs
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Compose({ host, stack }: Readonly<{ host: HostView; stack: string }>) {
  const q = useHostCompose(host.workspace, host.id, stack, true);
  if (q.isPending) return <output aria-label="Loading the compose file" className="skeleton block h-24 w-full" />;
  if (q.isError) return <p role="alert" className="m-0 text-[13px] text-critical">{q.error.message}</p>;
  return (
    <div className="overflow-x-auto">
      <p className="m-0 mb-2 text-[12px] text-ink-3">Environment variables are shown by name only; their values never leave the host.</p>
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className={th}>Service</th>
            <th className={th}>Image</th>
            <th className={th}>Waits for</th>
            <th className={th}>Health check</th>
            <th className={th}>Ports</th>
            <th className={th}>Env</th>
          </tr>
        </thead>
        <tbody>
          {q.data.services.map((s) => (
            <tr key={s.name} className="border-t border-line">
              <td className={`${td} font-medium text-ink`}>{s.name}</td>
              <td className={`${td} font-mono text-[12px] text-ink-2`}>
                {s.image ?? "—"}
                {s.build && <span className="ms-2 text-ink-3">(built)</span>}
              </td>
              <td className={`${td} text-[13px] text-ink-2`}>
                {waitsFor(s)}
              </td>
              <td className={`${td} max-w-[16rem] truncate font-mono text-[12px] text-ink-3`} title={s.healthcheck?.test}>
                {healthText(s)}
              </td>
              <td className={`${td} font-mono text-[12px] text-ink-2`}>{s.ports.join(", ") || "—"}</td>
              <td className={`${td} text-[13px] text-ink-2`} title={s.env.join("\n")}>
                {s.env.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function waitsFor(s: ComposeService): string {
  if (s.depends_on.length === 0) return "—";
  const why: Record<string, string> = { service_healthy: " (healthy)", service_completed_successfully: " (done)" };
  return s.depends_on.map((d) => d.service + (why[d.condition] ?? "")).join(", ");
}

function healthText(s: ComposeService): string {
  if (!s.healthcheck) return "—";
  return s.healthcheck.disabled ? "off" : s.healthcheck.test;
}

function logStatus(error: string | null, live: boolean, count: number): string {
  if (error) return "";
  return live ? `Live · ${count} lines` : "Connecting…";
}

function clock(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false });
}

function Logs({ host, stack, services, service, setService }: Readonly<{ host: HostView; stack: string; services: string[]; service: string; setService: (s: string) => void }>) {
  const { lines, error, live } = useHostLogs(host.workspace, host.id, stack, service, true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`logs-${host.id}-${stack}`} className="text-[13px] text-ink-2">
          Service
        </label>
        <select id={`logs-${host.id}-${stack}`} className={cn(pillSelect, "w-auto min-w-[12rem]")} value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <output className="text-[12px] text-ink-3">{logStatus(error, live, lines.length)}</output>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {error}
        </p>
      )}
      <div ref={box} aria-label="Log lines" className="max-h-[28rem] min-h-[8rem] overflow-auto rounded-ctl bg-inset p-3 font-mono text-[12px] leading-5">
        {lines.length === 0 && !error && <span className="text-ink-3">Waiting for lines…</span>}
        {lines.map((l) => {
          if (l.error) {
            return (
              <div key={l.id} className="py-0.5 text-critical">
                {l.service ? `${l.service}: ` : ""}
                {l.error}
              </div>
            );
          }
          const r = readLine(l.line ?? "");
          return (
            <div key={l.id} className="flex items-baseline gap-3 border-b border-line/40 py-1 last:border-0">
              <span className="w-[4.5rem] shrink-0 text-ink-3 tabular-nums">{clock(l.ts)}</span>
              {!service && (
                <span className="w-[11rem] shrink-0 truncate text-accent" title={l.service}>
                  {l.service}
                </span>
              )}
              {r.level ? <LevelMark level={r.level} /> : <span className="w-[4.5rem] shrink-0" />}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                <span className="text-ink">{r.message}</span>
                {r.fields.length > 0 && (
                  <span className="text-ink-3">
                    {r.message ? "  " : ""}
                    {r.fields.map(([k, v]) => (
                      <span key={k} className="me-3 inline-block">
                        {k}=<span className="text-ink-2">{v === "" ? '""' : v}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type View = "services" | "compose" | "logs";

function StackPanel({ host, stack }: Readonly<{ host: HostView; stack: AgentStack }>) {
  const [view, setView] = useState<View>("services");
  const [service, setService] = useState("");
  const [confirm, setConfirm] = useState<HostAction | null>(null);
  const services = useHostServices(host.workspace, host.id, stack.id, true);
  const action = useHostAction(host.workspace, host.id, stack.id);
  const names = [...new Set((services.data ?? []).map((c) => c.Service))].sort((a, b) => a.localeCompare(b));
  const writes = stack.allow_write ? { busy: action.state.running || confirm !== null, onPick: setConfirm } : undefined;
  const tab = (v: View, label: string) => (
    <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={view === v ? pillPrimary : pill}>
      {label}
    </button>
  );
  return (
    <section aria-label={`Stack ${stack.name}`} className="flex flex-col gap-3 rounded-ctl bg-inset p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="m-0 text-[15px] font-medium text-ink">{stack.name}</h3>
          <span className="text-[12px] text-ink-3" title={stack.allow_write ? "The agent on the host allows start, stop and restart for this stack. Each asks first." : "The agent on the host only lets devdeck look at this stack (allow_write is off)."}>
            {stack.allow_write ? "writes allowed on the host" : "read-only"}
          </span>
        </div>
        <div role="tablist" aria-label={`Views of ${stack.name}`} className="flex gap-2">
          {tab("services", "Services")}
          {tab("compose", "Compose")}
          {tab("logs", "Logs")}
        </div>
      </div>
      {writes && view === "services" && <StackActions busy={writes.busy} onPick={writes.onPick} />}
      {confirm && (
        <ConfirmAction
          action={confirm}
          stack={stack.name}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            void action.run(confirm);
            setConfirm(null);
          }}
        />
      )}
      <ActionOutput state={action.state} onDismiss={action.clear} />
      {view === "services" && (
        <Services
          host={host}
          stack={stack.id}
          writes={writes}
          onLogs={(s) => {
            setService(s);
            setView("logs");
          }}
        />
      )}
      {view === "compose" && <Compose host={host} stack={stack.id} />}
      {view === "logs" && <Logs host={host} stack={stack.id} services={names} service={service} setService={setService} />}
    </section>
  );
}

function TokenForm({ host }: Readonly<{ host: HostView }>) {
  const save = useSaveHostToken(host.workspace, host.id);
  const forget = useForgetHostToken(host.workspace, host.id);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const id = `token-${host.workspace}-${host.id}`;

  if (host.token_set && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
        <span>Agent token saved in your OS keychain.</span>
        <button type="button" className={pill} onClick={() => setEditing(true)}>
          Replace token
        </button>
        <button type="button" className={pillDanger} disabled={forget.isPending} onClick={() => forget.mutate()}>
          Forget token
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(value, {
          onSuccess: () => {
            setValue("");
            setEditing(false);
          },
        });
      }}
    >
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        Agent token
      </label>
      <p className="m-0 text-[12px] text-ink-3">
        Run <code className="font-mono">devdeck agent token</code> on the host (it is in its token file) and paste it here. It is kept in your OS keychain and never shown again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} className={`${pillInput} w-[28rem] max-w-full`} />
        <button type="submit" className={pillPrimary} disabled={value.trim() === "" || save.isPending}>
          Save token
        </button>
        {host.token_set && (
          <button type="button" className={pill} onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
      {save.error && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function HostCard({ host }: Readonly<{ host: HostView }>) {
  const [connect, setConnect] = useState(host.tunnel.open);
  const enabled = host.token_set && (connect || host.tunnel.open);
  const info = useHostInfo(host.workspace, host.id, enabled);
  const disconnect = useDisconnectHost(host.workspace, host.id);

  let status = <Mark shape="ring" color="var(--ink-3)" label="Not connected" />;
  if (info.isFetching && !info.data) status = <Mark shape="ring" color="var(--accent)" label="Connecting…" />;
  else if (info.isError) status = <Mark shape="square" color="var(--critical)" label="Can’t connect" />;
  else if (info.data && host.tunnel.open) status = <Mark shape="dot" color="var(--good)" label="Connected" />;
  else if (info.data) status = <Mark shape="dot" color="var(--good)" label="Connected" hint="The tunnel closes by itself after a few idle minutes." />;

  const meta = [host.instance, host.region, host.profile ? `profile ${host.profile}` : "default profile"].filter(Boolean).join(" · ");
  return (
    <section aria-label={host.name} className="flex flex-col gap-4 rounded-ctl bg-sidebar p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[16px] font-medium text-ink">{host.name}</h2>
          <span className="font-mono text-[12px] text-ink-3">{meta}</span>
          <span className="text-[12px] text-ink-3">{host.workspace_name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {status}
          {host.token_set && !info.data && (
            <button
              type="button"
              className={pillPrimary}
              disabled={info.isFetching}
              onClick={() => {
                if (connect) void info.refetch();
                else setConnect(true);
              }}
            >
              {info.isError ? "Try again" : "Connect"}
            </button>
          )}
          {info.data && (
            <button
              type="button"
              className={pill}
              disabled={disconnect.isPending}
              onClick={() => {
                setConnect(false);
                disconnect.mutate();
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {info.isError && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {info.error.message}
        </p>
      )}
      <TokenForm host={host} />

      {info.data && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[12px] text-ink-3">
            Agent {info.data.version} · {info.data.stacks.length} {info.data.stacks.length === 1 ? "stack" : "stacks"}
          </p>
          {info.data.stacks.map((s) => (
            <StackPanel key={s.id} host={host} stack={s} />
          ))}
        </div>
      )}
    </section>
  );
}

const example = `hosts:
  - id: dev-box
    name: Dev box
    type: aws-ssm
    aws:
      instance: i-0123456789abcdef0
      region: ap-south-1
      profile: dev`;

/** Machines that run devdeck's agent, reached through an SSM tunnel: their stacks, services and live logs. */
export function HostsPage() {
  const item = navByPath("/hosts");
  const hosts = useHosts();
  const header = <PageHeader title={item.label} group={item.group} description="Compose stacks on other machines, reached through an SSM tunnel that opens when you need it." />;

  if (hosts.isPending) {
    return (
      <>
        {header}
        <output aria-label="Loading…" className="skeleton mt-4 block h-40 w-full" />
      </>
    );
  }
  if (hosts.isError) {
    return (
      <>
        {header}
        <p role="alert" className="mt-4 text-ink-3">
          Could not read the hosts: {hosts.error.message}
        </p>
      </>
    );
  }
  if (hosts.data.length === 0) {
    return (
      <>
        {header}
        <section className="enter mt-4 flex flex-col gap-3 rounded-ctl bg-inset p-5" style={stagger(1)}>
          <div className="flex items-center gap-3">
            <Server size={20} aria-hidden className="text-ink-3" />
            <h2 className="m-0 text-[16px] font-medium text-ink">No remote host yet</h2>
          </div>
          <p className="m-0 text-[13px] text-ink-2">
            Add the machine to your workspace’s <code className="font-mono">workspace.yaml</code>, run <code className="font-mono">devdeck agent</code> on it, then come back here.
          </p>
          <pre className="m-0 overflow-x-auto rounded-ctl bg-sidebar p-3 font-mono text-[12px] text-ink">{example}</pre>
        </section>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="enter mt-4 flex flex-col gap-4" style={stagger(1)}>
        {hosts.data.map((h) => (
          <HostCard key={`${h.workspace}/${h.id}`} host={h} />
        ))}
      </div>
    </>
  );
}
