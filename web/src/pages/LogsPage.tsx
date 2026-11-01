import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, ChevronDown, ChevronRight, Eraser, List, Pause, Play, ScrollText, Trash2, X, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { primaryButton, quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { levelOrder } from "../design/LevelMark";
import { Menu, type MenuItem } from "../design/Menu";
import { PageHeader } from "../design/PageHeader";
import { StatusDot } from "../design/StatusDot";
import { stagger } from "../lib/motion";
import { useClearLogs, useDeleteFilter, useLogGroups, useLogHistogram, useLogTrends, useSavedFilters, useSaveFilter } from "../lib/log-api";
import { messageOf, queryOfFilter, type LogQuery, type SavedLogFilter } from "../lib/log-query";
import { serviceStats, servicesWithErrors } from "../lib/log-services";
import { isMutedText, muteOfText, useMutes } from "../lib/log-mutes";
import { useLogStream } from "../lib/log-stream";
import { useCaptures } from "../lib/logs";
import { useRuns, useWorkspace, useWorkspaces } from "../lib/queries";
import { useTopicHandler } from "../lib/socket";
import type { LogBatch, LogEntry, LogLevel } from "../lib/types";
import { useNow } from "../lib/use-now";
import { ErrorGroups } from "./logs/ErrorGroups";
import { SinceSelect } from "./logs/FilterBar";
import { Histogram } from "./logs/Histogram";
import { LogDetail } from "./logs/LogDetail";
import { LogList } from "./logs/LogList";
import { QueryBar } from "./logs/QueryBar";
import { MutedNoise } from "./logs/MutedNoise";
import { ServiceFacet } from "./logs/ServiceFacet";

const select = "h-[34px] max-w-[16rem] bg-fill px-3 text-[13px] text-ink outline-none hover:bg-fill-hover";
const small = `${quietButton} disabled:cursor-not-allowed disabled:opacity-45`;
const primary = primaryButton;

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

/** The list with the item added when it is not there, or taken out when it is. */
function toggled<T>(list: T[] | undefined, item: T): T[] {
  const cur = list ?? [];
  return cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
}

type ViewProps = {
  workspace: string;
  stack: string;
  sample: boolean;
  query: LogQuery;
  onQuery: (q: LogQuery) => void;
  /** The workspace and stack pickers, which go in the page header. */
  selectors: ReactNode;
  title: string;
  group: string;
};

/** The page for one stack: filters, the level histogram, the errors, the stream and the selected line. */
function LogsView({ workspace, stack, sample, query, onQuery, selectors, title, group }: ViewProps) {
  const live = !query.until;
  // The muted patterns are the reader's own and are kept in this browser; they go with every request.
  const { mutes, add: addMute, toggle: toggleMute, remove: removeMute } = useMutes(workspace, stack);
  const mutePatterns = useMemo(() => mutes.filter((m) => m.on).map((m) => m.pattern), [mutes]);
  const shown = useMemo<LogQuery>(() => ({ ...query, mutes: mutePatterns }), [query, mutePatterns]);
  const stream = useLogStream(workspace, stack, shown, live);
  const following = live && !stream.paused;
  const captures = useCaptures(workspace, stack, true);
  const groups = useLogGroups(workspace, stack, true, following);
  const histogram = useLogHistogram(workspace, stack, shown, true, following);
  const trends = useLogTrends(workspace, stack, shown, true, following);
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
  const [showErrors, setShowErrors] = useState(true);

  const names = useMemo(() => {
    const set = new Set<string>(captures.data?.map((c) => c.service) ?? []);
    for (const e of stream.entries) set.add(e.service);
    for (const s of query.services ?? []) set.add(s);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [captures.data, stream.entries, query.services]);

  const mine = (saved.data ?? []).filter((f) => !f.stack || f.stack === stack);
  const target = (query.services ?? []).length === 1 ? query.services?.[0] : undefined;
  // A kind of error whose message matches an applied mute is hidden here too (the server lists every kind).
  const errorGroups = (groups.data ?? []).filter((g) => !isMutedText(mutePatterns, g.message));
  const groupSeries = useMemo(() => new Map((trends.data?.groups ?? []).map((sr) => [sr.key, sr])), [trends.data]);

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

  // Alt+1 to Alt+3 apply the first three saved views. (Not Ctrl+digit: a browser keeps that for its tabs.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const n = /^Digit([1-3])$/.exec(e.code)?.[1];
      if (!n || !e.altKey || e.ctrlKey || e.metaKey || typing) return;
      const view = mine[Number(n) - 1];
      if (!view) return;
      e.preventDefault();
      onQuery(queryOfFilter(view));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mine, onQuery]);

  const choose = useCallback((fingerprint: string | undefined) => onQuery({ ...query, group: fingerprint }), [onQuery, query]);

  const rowActions = (e: LogEntry): MenuItem[] => [
    { label: "Show only this service", onSelect: () => onQuery({ ...query, services: [e.service] }) },
    { label: "Show every line like this", onSelect: () => choose(e.fingerprint), disabled: !e.fingerprint },
    { label: "Mute lines like this", onSelect: () => addMute(muteOfText(messageOf(e))) },
    { label: "Copy the line", onSelect: () => void navigator.clipboard?.writeText(e.text) },
    { label: "Show it in full", onSelect: () => setSelected(e.seq) },
  ];

  const pageActions: MenuItem[] = [
    { label: showErrors ? "Hide the errors" : "Show the errors", onSelect: () => setShowErrors((v) => !v), disabled: errorGroups.length === 0 },
    { label: "Copy a link to this view", onSelect: () => void navigator.clipboard?.writeText(window.location.href) },
  ];

  const status =
    stream.state === "loading"
      ? "Loading…"
      : stream.state === "error"
        ? stream.error || "Could not load the logs."
        : `${stream.entries.length.toLocaleString()} line${stream.entries.length === 1 ? "" : "s"}${histogram.data?.muted ? ` · ${histogram.data.muted.toLocaleString()} muted` : ""}${stream.paused ? " · paused" : ""}${live ? "" : " · a past stretch"}`;

  // What is on screen now: following, paused, or a past stretch. The rate counts the lines loaded in the last minute.
  const following_ = live && !stream.paused;
  const perMinute = stream.entries.filter((e) => now - Date.parse(e.time) < 60_000).length;

  return (
    <>
      <PageHeader
        title={title}
        group={group}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectors}
            <SinceSelect value={query} onChange={onQuery} />
          </div>
        }
        summary={
          <span className="inline-flex items-center gap-2">
            <StatusDot tone={following_ ? "good" : "neutral"} className={following_ ? "pulse-mark" : ""} />
            {!live ? "Past stretch" : stream.paused ? "Paused" : "Live"}
            {following_ && perMinute > 0 ? ` · ${perMinute.toLocaleString()} lines/min` : ""}
          </span>
        }
      />
      <div className="mt-8 flex flex-col gap-6">
        <QueryBar value={query} onChange={onQuery} />

        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <button type="button" onClick={() => stream.pause(!stream.paused)} aria-pressed={stream.paused} className={primary}>
              {stream.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
              {stream.paused ? "Resume" : "Pause"}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => onQuery({ ...query, until: undefined, since: undefined })} className={primary}>
                <Play size={15} aria-hidden />
                Back to live
              </button>
              <button type="button" onClick={() => onQuery(zoomedOut(query))} className={small}>
                <ZoomOut size={15} aria-hidden />
                Zoom out
              </button>
            </>
          )}
          <button type="button" onClick={() => setSaving((v) => !v)} aria-expanded={saving} disabled={sample} title={sample ? "Sample workspaces can’t be changed" : "Keep these filters with the workspace"} className={small}>
            <Bookmark size={15} aria-hidden />
            Save filter
          </button>
          <button type="button" onClick={() => setClearing(true)} disabled={sample} title={sample ? "Sample workspaces have no stored logs" : "Delete the stored lines"} className={small}>
            <Eraser size={15} aria-hidden />
            Clear
          </button>
          <span className="ms-auto inline-flex items-center gap-2 text-[14px] tabular-nums text-ink-2">
            <List size={15} aria-hidden />
            <span role="status">{status}</span>
          </span>
          <Menu label="More actions" items={pageActions} />
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
              className="h-[34px] w-64 max-w-full bg-fill px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill-hover"
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
          <div role="alertdialog" aria-labelledby="clear-title" className="flex flex-wrap items-center gap-3 bg-inset px-3.5 py-3">
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
                className="inline-flex h-[34px] items-center gap-2 bg-critical px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-critical/90 disabled:opacity-45"
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
            {mine.map((f, n) => (
              <li key={f.id} className="inline-flex items-center bg-fill text-[13px] text-ink-2">
                {deleting === f.id ? (
                  <span className="flex items-center gap-2 ps-3 pe-1">
                    Delete “{f.name}”?
                    <button
                      type="button"
                      onClick={() => del.mutate(f.id, { onSuccess: () => setDeleting(undefined) })}
                      className="h-8 px-2 text-critical hover:bg-fill-hover"
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => setDeleting(undefined)} className="h-8 px-2 hover:bg-fill-hover">
                      Keep
                    </button>
                  </span>
                ) : (
                  <>
                    <button type="button" onClick={() => onQuery(queryOfFilter(f))} aria-keyshortcuts={n < 3 ? `Alt+${n + 1}` : undefined} className="inline-flex h-8 items-center gap-2 ps-3 pe-2 hover:bg-fill-hover">
                      {f.name}
                      {n < 3 && (
                        <kbd aria-hidden className="bg-bg px-1 font-mono text-[10.5px] text-ink-3">
                          Alt {n + 1}
                        </kbd>
                      )}
                    </button>
                    {!sample && (
                      <button type="button" aria-label={`Delete the saved filter ${f.name}`} onClick={() => setDeleting(f.id)} className="inline-flex h-8 w-8 items-center justify-center hover:bg-fill-hover">
                        <X size={13} aria-hidden />
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <Histogram
          data={histogram.data}
          onBrush={(from, to) => onQuery({ ...query, since: from, until: to })}
          levels={query.levels}
          onToggleLevel={(l) => onQuery({ ...query, levels: toggled(query.levels, l) })}
          onClearLevels={() => onQuery({ ...query, levels: undefined })}
        />

        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-4">
            <ServiceFacet
              stats={serviceStats(stream.entries, names, query.services ?? [], trends.data?.services)}
              picked={query.services ?? []}
              onToggle={(s) => onQuery({ ...query, services: toggled(query.services, s) })}
              onClear={() => onQuery({ ...query, services: undefined })}
              onOnlyErrors={() => onQuery({ ...query, services: servicesWithErrors(stream.entries) })}
            />
            <MutedNoise mutes={mutes} onAdd={addMute} onToggle={toggleMute} onRemove={removeMute} muted={histogram.data?.muted} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            {errorGroups.length > 0 && (
              <section aria-label="Errors" className="flex min-w-0 flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={showErrors}
                  onClick={() => setShowErrors((v) => !v)}
                  className="inline-flex items-center gap-2 self-start px-1 text-[14px] font-semibold text-ink"
                >
                  {showErrors ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                  Errors ({errorGroups.length})
                </button>
                {showErrors && <ErrorGroups groups={errorGroups} selected={query.group} onSelect={choose} now={now} series={groupSeries} rangeSeconds={trends.data ? Math.max(1, (Date.parse(trends.data.to) - Date.parse(trends.data.from)) / 1000) : undefined} />}
              </section>
            )}

            <LogList
              entries={stream.entries}
              label={`Logs of ${stack}`}
              selected={selected}
              onSelect={setSelected}
              follow={following}
              hasOlder={stream.hasOlder}
              onLoadOlder={() => void stream.loadOlder()}
              empty={stream.state === "ready" ? "No stored lines match these filters." : "Loading…"}
              rowActions={rowActions}
              renderDetail={(e) => (
                <LogDetail
                  workspace={workspace}
                  stack={stack}
                  entry={e}
                  onClose={() => setSelected(undefined)}
                  onGroup={choose}
                  onFilter={(raw) => onQuery({ ...query, fields: [...(query.fields ?? []).filter((f) => f !== raw), raw] })}
                  onMute={() => addMute(muteOfText(messageOf(e)))}
                />
              )}
            />
          </div>
        </div>
      </div>
    </>
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

  const header = <PageHeader title={item.label} group={item.group} />;

  if (workspaces.isSuccess && list.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={ScrollText}
          empty={{ headline: "Add a workspace first", text: "Logs belong to a stack, and a stack to a workspace. Add one, start a stack, and its logs appear here.", cta: { label: "Add workspace", to: "/workspaces" } }}
        />
      </>
    );
  }

  const selectors = (
    <>
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
    </>
  );

  const ready = id && stack && detail.data && stacks.some((s) => s.name === stack);

  return (
    <>
      {!ready && header}
      {!ready && (
        <div className="enter mt-4 flex flex-wrap items-center gap-3" style={stagger(1)}>
          {selectors}
        </div>
      )}
      {detail.isError && <p className="mt-4 text-ink-3">Could not load this workspace.</p>}
      {detail.data && stacks.length === 0 && (
        <EmptyState
          icon={ScrollText}
          empty={{ headline: "No stack in this workspace", text: "Logs come from a stack’s services and containers. Add a stack, start it, and its logs appear here.", cta: { label: "Go to Stacks", to: `/stacks?workspace=${encodeURIComponent(id ?? "")}` } }}
        />
      )}
      {ready && <LogsView key={`${id}/${stack}`} workspace={id} stack={stack} sample={detail.data.source === "example"} query={query} onQuery={setQuery} selectors={selectors} title={item.label} group={item.group} />}
    </>
  );
}
