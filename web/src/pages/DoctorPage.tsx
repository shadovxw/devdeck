import { Copy, RotateCw, Stethoscope } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { StatusMark } from "../design/StatusMark";
import { ApiError } from "../lib/api";
import { stagger } from "../lib/motion";
import { useDoctor, useWorkspace, useWorkspaces } from "../lib/queries";
import type { DoctorCheck, DoctorReport } from "../lib/types";

const GROUPS: Array<{ id: DoctorCheck["group"]; label: string }> = [
  { id: "tools", label: "Tools" },
  { id: "repos", label: "Repos" },
  { id: "stacks", label: "Stacks" },
  { id: "git", label: "Git" },
];

const select =
  "h-9 max-w-[16rem] rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent";

/** A command or a link is shown as code; a sentence is shown as text. */
const looksLikeCommand = /^(git|winget|npm|npx|go|docker|brew|scoop|apt|python|pip|copy|cp|cd)\s/;

function FixLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (/^https?:\/\//.test(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-accent hover:underline">
        {text}
      </a>
    );
  }
  if (!looksLikeCommand.test(text)) return <span className="text-[13px] text-ink-2">{text}</span>;

  const copy = () => {
    // Clipboard access can be refused; the text stays selectable either way.
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <span className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-ctl bg-inset px-2 py-1 font-mono text-xs text-ink-2">{text}</code>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : "Copy"}
        aria-label={`Copy: ${text}`}
        className="grid size-7 shrink-0 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90"
      >
        <Copy size={14} aria-hidden />
      </button>
    </span>
  );
}

function CheckRow({ check }: { check: DoctorCheck }) {
  return (
    <li className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 flex">
          <StatusMark level={check.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] text-ink">{check.title}</p>
          {check.detail && <p className="m-0 mt-0.5 break-words text-[13px] text-ink-3">{check.detail}</p>}
        </div>
        {check.stack && <span className="mt-0.5 shrink-0 font-mono text-xs text-ink-3">{check.stack}</span>}
      </div>
      {check.fix && check.fix.length > 0 && (
        <div className="ms-6 flex flex-col gap-1.5">
          {check.fix.map((line) => (
            <FixLine key={line} text={line} />
          ))}
        </div>
      )}
    </li>
  );
}

function Summary({ report }: { report: DoctorReport }) {
  const part = (level: "ok" | "warn" | "fail", n: number, title: string) =>
    n > 0 && (
      <span className="inline-flex items-center gap-1.5 tabular-nums" title={title}>
        <StatusMark level={level} />
        {n}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-4 text-[13px] text-ink-2">
      {part("fail", report.failures, `${report.failures} failed`)}
      {part("warn", report.warnings, `${report.warnings} warning${report.warnings === 1 ? "" : "s"}`)}
      {part("ok", report.passed, `${report.passed} passed`)}
    </span>
  );
}

function Results({ report }: { report: DoctorReport }) {
  return (
    <div>
      {GROUPS.map((g) => {
        const checks = report.checks.filter((c) => c.group === g.id);
        if (checks.length === 0) return null;
        return (
          <section key={g.id} aria-label={g.label} className="pb-2">
            <h2 className="m-0 px-4 pb-2 pt-4 text-[13px] font-medium text-ink-3">{g.label}</h2>
            <ul className="m-0 list-none p-0">
              {checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function DoctorPage() {
  const item = navByPath("/doctor");
  const [params, setParams] = useSearchParams();
  const workspaces = useWorkspaces();

  // Default to the first workspace that has no errors, so Doctor has something to check.
  const list = workspaces.data ?? [];
  const fallback = (list.find((w) => w.errors === 0) ?? list[0])?.id;
  const workspace = params.get("workspace") ?? fallback;
  const stack = params.get("stack") ?? undefined;

  const detail = useWorkspace(workspace);
  const doctor = useDoctor(workspace, stack);

  const choose = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  if (workspaces.isSuccess && list.length === 0) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <EmptyState
          icon={Stethoscope}
          empty={{
            headline: "Add a workspace first",
            text: "Doctor checks your machine for the stacks of a workspace. Add one, then come back.",
            cta: { label: "Add workspace", to: "/workspaces" },
          }}
        />
      </>
    );
  }

  const error = doctor.error instanceof ApiError ? doctor.error.message : doctor.isError ? "The check couldn’t be run." : undefined;

  return (
    <>
      <PageHeader title={item.label} group={item.group} />

      <section className="enter mt-4 rounded-sheet bg-surface-1" style={stagger(1)}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <label className="sr-only" htmlFor="doctor-workspace">
            Workspace
          </label>
          <select
            id="doctor-workspace"
            className={select}
            value={workspace ?? ""}
            onChange={(e) => choose({ workspace: e.target.value, stack: undefined })}
            disabled={list.length === 0}
          >
            {list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="doctor-stack">
            Stack
          </label>
          <select
            id="doctor-stack"
            className={select}
            value={stack ?? ""}
            onChange={(e) => choose({ stack: e.target.value || undefined })}
            disabled={!detail.data}
            title="Check one stack, or the whole workspace"
          >
            <option value="">Whole workspace</option>
            {detail.data?.stacks.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <span className="flex-1" />
          {doctor.data && <Summary report={doctor.data} />}
          <button
            type="button"
            onClick={() => void doctor.refetch()}
            disabled={!workspace || doctor.isFetching}
            title="Check again"
            className="inline-flex h-9 items-center gap-2 rounded-ctl px-3 text-[14px] text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-[.97] disabled:opacity-50"
          >
            <RotateCw size={15} className={doctor.isFetching ? "animate-spin" : undefined} aria-hidden />
            Check again
          </button>
        </div>

        {(workspaces.isPending || doctor.isFetching) && !doctor.data && (
          <div role="status" aria-label="Checking…" className="flex flex-col gap-4 px-4 pb-6 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-6">
                <div className="skeleton h-4 w-4" />
                <div className="skeleton h-4 w-52" />
              </div>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="m-0 px-4 pb-6 pt-2 text-[14px] text-critical">
            {error}
          </p>
        )}
        {doctor.data && !error && <Results report={doctor.data} />}
      </section>
    </>
  );
}
