import { Bookmark, Eraser, Pause, Play, ScrollText, Trash2, X, ZoomOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { levelOrder } from "../design/LevelMark";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import { useClearLogs, useDeleteFilter, useLogGroups, useLogHistogram, useSavedFilters, useSaveFilter } from "../lib/log-api";
import { queryOfFilter, type LogQuery, type SavedLogFilter } from "../lib/log-query";
import { useLogStream } from "../lib/log-stream";
import { useCaptures } from "../lib/logs";
import { useRuns, useWorkspace, useWorkspaces } from "../lib/queries";
import { useTopicHandler } from "../lib/socket";
import type { LogBatch, LogLevel } from "../lib/types";
import { useNow } from "../lib/use-now";
import { ErrorGroups } from "./logs/ErrorGroups";
import { FilterBar } from "./logs/FilterBar";
import { Histogram } from "./logs/Histogram";
import { LogDetail } from "./logs/LogDetail";
import { LogList } from "./logs/LogList";

const select =
  "h-9 max-w-[16rem] rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const small = `${quietButton} !h-9 !px-3 !text-[14px] disabled:cursor-not-allowed disabled:opacity-45`;

/** The filters in the address, so a view can be bookmarked and shared. */
export function queryOfParams(p: URLSearchParams): LogQuery {
  const levels = p.getAll("level").filter((l): l is LogLevel => (levelOrder as string[]).includes(l));
  return {
    services: p.getAll("service"),
    levels,
    regex: p.get("q") || undefined,
    fields: p.getAll("field"),
    since: p.get("since") || undefined,
    until: p.get("until") || undefined,
    group: p.get("group") || undefined,
  };
}

/** The address's parameters for a query, keeping the workspace and stack. */
export function paramsOfQuery(keep: { workspace?: string; stack?: string }, q: LogQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (keep.workspace) p.set("workspace", keep.workspace);
  if (keep.stack) p.set("stack", keep.stack);
  for (const s of q.services ?? []) p.append("service", s);
  for (const l of q.levels ?? []) p.append("level", l);
  for (const f of q.fields ?? []) p.append("field", f);
  if (q.regex) p.set("q", q.regex);
  if (q.since) p.set("since", q.since);
  if (q.until) p.set("until", q.until);
  if (q.group) p.set("group", q.group);
  return p;
}

/** A saved filter's id from its name: lowercase letters, digits and dashes, starting with a letter. */
export function filterId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "filter";
  const id = /^[a-z]/.test(slug) ? slug : `f-${slug}`;
  return id.slice(0, 40).replace(/-+$/, "");
}

/**
 * A stretch three times as long around the same middle. When that reaches the present the
 * end is let go, so the view is live again; with no stretch to widen it goes back to any time.
 */
export function zoomedOut(q: LogQuery, now = Date.now()): LogQuery {
  const since = Date.parse(q.since ?? "");
  const until = Date.parse(q.until ?? "");
  if (Number.isNaN(since) || Number.isNaN(until)) return { ...q, since: undefined, until: undefined };
  const half = Math.max(until - since, 60_000) * 1.5;
  const mid = (since + until) / 2;
  return { ...q, since: new Date(mid - half).toISOString(), until: mid + half >= now ? undefined : new Date(mid + half).toISOString() };
}

type ViewProps = { workspace: string; stack: string; sample: boolean; query: LogQuery; onQuery: (q: LogQuery) => void };

/** The page for one stack: filters, the level histogram, the errors, the stream and the selected line. */
function LogsView({ workspace, stack, sample, query, onQuery }: ViewProps) {
  const live = !query.until;
  const stream = useLogStream(workspace, stack, query, live);
  const following = live && !stream.paused;
  const captures = useCaptures(workspace, stack, true);
  const groups = useLogGroups(workspace, stack, true, following);
  const histogram = useLogHistogram(workspace, stack, query, true, following);
  const saved = useSavedFilters(workspace);
  const save = useSaveFilter(workspace);
  const del = useDeleteFilter(workspace);
  const clear = useClearLogs(workspace, stack);
  const now = useNow(true);

  // A new kind of error shows in the Errors panel at once, not at the next poll. At most one
  // refresh a second, however many error lines a burst brings.
  const qc = useQueryClient();
  const refreshedAt = useRef(0);
  useTopicHandler<LogBatch>(`logs.${workspace}.${stack}`, (batch) => {
    if (!following || !batch.entries.some((e) => e.fingerprint)) return;
    if (Date.now() - refreshedAt.current < 1000) return;
    refreshedAt.current = Date.now();
    void qc.invalidateQueries({ queryKey: ["log-groups", workspace, stack] });
  });

  const [selected, setSelected] = useState<number | undefined>();
  const [clearing, setClearing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | undefined>();

  const names = useMemo(() => {
    const set = new Set<string>(captures.data?.map((c) => c.service) ?? []);
    for (const e of stream.entries) set.add(e.service);
    for (const s of query.services ?? []) set.add(s);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [captures.data, stream.entries, query.services]);

  const entry = selected === undefined ? undefined : stream.entries.find((e) => e.seq === selected);
  const mine = (saved.data ?? []).filter((f) => !f.stack || f.stack === stack);
  const target = (query.services ?? []).length === 1 ? query.services?.[0] : undefined;

  function submitSave(e: FormEvent) {
    e.preventDefault();
    const f: SavedLogFilter = {
      id: filterId(name),
      name: name.trim(),
      stack,
      services: query.services?.length ? query.services : undefined,
      levels: query.levels?.length ? query.levels : undefined,
      regex: query.regex,
      fields: query.fields?.length ? query.fields : undefined,
      // Only a relative range can be reused; a dragged-out stretch is not saved.
      since: query.since && /^\d+[smhd]$/.test(query.since) ? query.since : undefined,
    };
    save.mutate(f, {
      onSuccess: () => {
        setSaving(false);
        setName("");
      },
    });
  }

  const choose = useCallback((fingerprint: string | undefined) => onQuery({ ...query, group: fingerprint }), [onQuery, query]);

  const status =
    stream.state === "loading"
      ? "Loading…"
      : stream.state === "error"
        ? stream.error || "Could not load the logs."
        : `${stream.entries.length.toLocaleString()} line${stream.entries.length === 1 ? "" : "s"}${stream.paused ? " · paused" : ""}${live ? "" : " · a past stretch"}`;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <FilterBar value={query} onChange={onQuery} serviceNames={names} />

      <div className="flex flex-wrap items-center gap-2">
        {live ? (
          <button type="button" onClick={() => stream.pause(!stream.paused)} aria-pressed={stream.paused} className={small}>
            {stream.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
            {stream.paused ? "Resume" : "Pause"}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onQuery(zoomedOut(query))} className={small}>
              <ZoomOut size={14} aria-hidden />
              Zoom out
            </button>
            <button type="button" onClick={() => onQuery({ ...query, until: undefined, since: undefined })} className={small}>
              <Play size={14} aria-hidden />
              Back to live
            </button>
          </>
        )}
        <button type="button" onClick={() => setSaving((v) => !v)} aria-expanded={saving} disabled={sample} title={sample ? "Sample workspaces can’t be changed" : "Keep these filters with the workspace"} className={small}>
          <Bookmark size={14} aria-hidden />
          Save filter
        </button>
        <button type="button" onClick={() => setClearing(true)} disabled={sample} title={sample ? "Sample workspaces have no stored logs" : "Delete the stored lines"} className={small}>
          <Eraser size={14} aria-hidden />
          Clear…
        </button>
        <span role="status" className="ms-auto text-[13px] tabular-nums text-ink-3">
          {status}
        </span>
      </div>

      {saving && (
        <form onSubmit={submitSave} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="filter-name">
            Name of the filter
          </label>
          <input
            id="filter-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. API errors"
            maxLength={60}
            autoComplete="off"
            className="h-9 w-64 max-w-full rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button type="submit" disabled={!name.trim() || save.isPending} className={small}>
            Save
          </button>
          <button type="button" onClick={() => setSaving(false)} className={small}>
            Cancel
          </button>
          {save.error && (
            <span role="alert" className="text-[13px] text-critical">
              {save.error.message}
            </span>
          )}
        </form>
      )}

      {clearing && (
        <div role="alertdialog" aria-labelledby="clear-title" className="flex flex-wrap items-center gap-3 rounded-ctl bg-inset px-4 py-3">
          <p id="clear-title" className="m-0 text-[14px] text-ink">
            Delete the stored logs of {target ? <span className="font-mono">{target}</span> : "every service of this stack"}? This removes the files, not only this view, and can’t be undone.
          </p>
          <span className="ms-auto flex gap-2">
            <button
              type="button"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate(target, {
                  onSuccess: () => {
                    setClearing(false);
                    setSelected(undefined);
                    stream.reload();
                  },
                })
              }
              className={`${small} !bg-critical !text-white hover:!brightness-110`}
            >
              <Trash2 size={14} aria-hidden />
              Delete
            </button>
            <button type="button" onClick={() => setClearing(false)} className={small}>
              Cancel
            </button>
          </span>
          {clear.error && (
            <p role="alert" className="m-0 w-full text-[13px] text-critical">
              {clear.error.message}
            </p>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <ul aria-label="Saved filters" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {mine.map((f) => (
            <li key={f.id} className="inline-flex items-center rounded-ctl bg-fill text-[13px] text-ink-2">
              {deleting === f.id ? (
                <span className="flex items-center gap-2 ps-3 pe-1">
                  Delete “{f.name}”?
                  <button
                    type="button"
                    onClick={() => del.mutate(f.id, { onSuccess: () => setDeleting(undefined) })}
                    className="h-8 rounded-ctl px-2 text-critical hover:bg-accent-soft"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setDeleting(undefined)} className="h-8 rounded-ctl px-2 hover:bg-accent-soft">
                    Keep
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => onQuery(queryOfFilter(f))} className="h-8 rounded-ctl ps-3 pe-2 hover:bg-accent-soft">
                    {f.name}
                  </button>
                  {!sample && (
                    <button type="button" aria-label={`Delete the saved filter ${f.name}`} onClick={() => setDeleting(f.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-ctl hover:bg-accent-soft">
                      <X size={13} aria-hidden />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Histogram
          data={histogram.data}
          onBrush={(from, to) => onQuery({ ...query, since: from, until: to })}
        />
        <section aria-label="Errors" className="flex min-w-0 flex-col gap-2">
          <h2 className="m-0 text-[14px] font-medium text-ink">Errors</h2>
          <ErrorGroups groups={groups.data ?? []} selected={query.group} onSelect={choose} now={now} />
        </section>
      </div>

      <LogList
        entries={stream.entries}
        label={`Logs of ${stack}`}
        selected={selected}
        onSelect={setSelected}
        follow={following}
        hasOlder={stream.hasOlder}
        onLoadOlder={() => void stream.loadOlder()}
        empty={stream.state === "ready" ? "No stored lines match these filters." : "Loading…"}
      />

      {entry && <LogDetail workspace={workspace} stack={stack} entry={entry} onClose={() => setSelected(undefined)} onGroup={choose} />}
    </div>
  );
}

/** Every service's logs of a stack in one place: filter, follow, narrow by time, group errors. */
export function LogsPage() {
  const item = navByPath("/logs");
  const [params, setParams] = useSearchParams();
  const workspaces = useWorkspaces();
  const runs = useRuns();

  const list = workspaces.data ?? [];
  const fallback = (list.find((w) => w.errors === 0 && w.source === "local") ?? list.find((w) => w.errors === 0) ?? list[0])?.id;
  const id = params.get("workspace") ?? fallback;
  const detail = useWorkspace(id);
  const stacks = detail.data?.stacks ?? [];
  const running = (runs.data ?? []).find((r) => r.workspace === id && stacks.some((s) => s.name === r.stack))?.stack;
  const stack = params.get("stack") ?? running ?? stacks[0]?.name;
  const query = useMemo(() => queryOfParams(params), [params]);

  const setQuery = useCallback(
    (q: LogQuery) => setParams(paramsOfQuery({ workspace: id, stack }, q), { replace: true }),
    [setParams, id, stack],
  );

  if (workspaces.isSuccess && list.length === 0) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <EmptyState
          icon={ScrollText}
          empty={{ headline: "Add a workspace first", text: "Logs belong to a stack, and a stack to a workspace. Add one, start a stack, and its logs appear here.", cta: { label: "Add workspace", to: "/workspaces" } }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={item.label} group={item.group} />
      <div className="enter mt-4 flex flex-wrap items-center gap-3" style={stagger(1)}>
        <label className="sr-only" htmlFor="logs-workspace">
          Workspace
        </label>
        <select
          id="logs-workspace"
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
        <label className="sr-only" htmlFor="logs-stack">
          Stack
        </label>
        <select
          id="logs-stack"
          className={select}
          value={stack ?? ""}
          onChange={(e) => setParams(paramsOfQuery({ workspace: id, stack: e.target.value }, {}), { replace: true })}
          disabled={stacks.length === 0}
        >
          {stacks.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {detail.isError && <p className="mt-4 text-ink-3">Could not load this workspace.</p>}
      {detail.data && stacks.length === 0 && (
        <EmptyState
          icon={ScrollText}
          empty={{ headline: "No stack in this workspace", text: "Logs come from a stack’s services and containers. Add a stack, start it, and its logs appear here.", cta: { label: "Go to Stacks", to: `/stacks?workspace=${encodeURIComponent(id ?? "")}` } }}
        />
      )}
      {id && stack && detail.data && stacks.some((s) => s.name === stack) && (
        <LogsView key={`${id}/${stack}`} workspace={id} stack={stack} sample={detail.data.source === "example"} query={query} onQuery={setQuery} />
      )}
    </>
  );
}
