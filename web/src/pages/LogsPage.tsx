import { useQueryClient } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { levelOrder } from "../design/LevelMark";
import type { MenuItem } from "../design/Menu";
import { PageHeader } from "../design/PageHeader";
import { StatusDot } from "../design/StatusDot";
import { stagger } from "../lib/motion";
import { useLogGroups, useLogHistogram, useLogTrends, useSavedFilters } from "../lib/log-api";
import { messageOf, type LogQuery } from "../lib/log-query";
import { serviceStats, servicesWithErrors } from "../lib/log-services";
import { isMutedText, muteOfText, useMutes } from "../lib/log-mutes";
import { useLogStream } from "../lib/log-stream";
import { useCaptures } from "../lib/logs";
import { useRuns, useWorkspace, useWorkspaces } from "../lib/queries";
import { useTopicHandler } from "../lib/socket";
import type { CaptureInfo, LogBatch, LogEntry, LogLevel } from "../lib/types";
import { useNow } from "../lib/use-now";
import { ClearConfirm } from "./logs/ClearConfirm";
import { ErrorsSection } from "./logs/ErrorsSection";
import { SinceSelect } from "./logs/FilterBar";
import { Histogram } from "./logs/Histogram";
import { LogDetail } from "./logs/LogDetail";
import { LogList } from "./logs/LogList";
import { MutedNoise } from "./logs/MutedNoise";
import { QueryBar } from "./logs/QueryBar";
import { SaveFilterForm } from "./logs/SaveFilterForm";
import { SavedFilters } from "./logs/SavedFilters";
import { ServiceFacet } from "./logs/ServiceFacet";
import { liveLabel, linesInLastMinute, statusLine } from "./logs/status";
import { ViewToolbar } from "./logs/ViewToolbar";

const select = "h-[34px] max-w-[16rem] bg-fill px-3 text-[13px] text-ink outline-none hover:bg-fill-hover";

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

export { filterId } from "../lib/log-query";

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

/** A new kind of error shows in the Errors panel at once, not at the next poll: at most one refresh a second, however many error lines a burst brings. */
function useGroupRefresh(workspace: string, stack: string, following: boolean) {
  const qc = useQueryClient();
  const refreshedAt = useRef(0);
  useTopicHandler<LogBatch>(`logs.${workspace}.${stack}`, (batch) => {
    if (!following || !batch.entries.some((e) => e.fingerprint)) return;
    if (Date.now() - refreshedAt.current < 1000) return;
    refreshedAt.current = Date.now();
    void qc.invalidateQueries({ queryKey: ["log-groups", workspace, stack] });
  });
}

/** Every service that has lines, a capture rule or a filter on it, by name. */
function serviceNamesOf(captured: CaptureInfo[] | undefined, entries: LogEntry[], picked: string[] | undefined): string[] {
  const set = new Set<string>(captured?.map((c) => c.service) ?? []);
  for (const e of entries) set.add(e.service);
  for (const s of picked ?? []) set.add(s);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** The page for one stack: filters, the level histogram, the errors, the stream and the selected line. */
function LogsView({ workspace, stack, sample, query, onQuery, selectors, title, group }: Readonly<ViewProps>) {
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
  const now = useNow(true);
  useGroupRefresh(workspace, stack, following);

  const [selected, setSelected] = useState<number | undefined>();
  const [clearing, setClearing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(true);

  const names = useMemo(() => serviceNamesOf(captures.data, stream.entries, query.services), [captures.data, stream.entries, query.services]);
  const mine = useMemo(() => (saved.data ?? []).filter((f) => !f.stack || f.stack === stack), [saved.data, stack]);
  const target = (query.services ?? []).length === 1 ? query.services?.[0] : undefined;
  // A kind of error whose message matches an applied mute is hidden here too (the server lists every kind).
  const errorGroups = (groups.data ?? []).filter((g) => !isMutedText(mutePatterns, g.message));
  const groupSeries = useMemo(() => new Map((trends.data?.groups ?? []).map((sr) => [sr.key, sr])), [trends.data]);

  const choose = useCallback((fingerprint: string | undefined) => onQuery({ ...query, group: fingerprint }), [onQuery, query]);
  const filterBy = (raw: string) => onQuery({ ...query, fields: [...(query.fields ?? []).filter((f) => f !== raw), raw] });

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

  const status = statusLine({ state: stream.state, error: stream.error, count: stream.entries.length, muted: histogram.data?.muted, paused: stream.paused, live });
  const perMinute = linesInLastMinute(stream.entries, now);

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
            <StatusDot tone={following ? "good" : "neutral"} className={following ? "pulse-mark" : ""} />
            {liveLabel(live, stream.paused)}
            {following && perMinute > 0 ? ` · ${perMinute.toLocaleString()} lines/min` : ""}
          </span>
        }
      />
      <div className="mt-8 flex flex-col gap-6">
        <QueryBar value={query} onChange={onQuery} />
        <ViewToolbar
          live={live}
          paused={stream.paused}
          onPause={stream.pause}
          onBackToLive={() => onQuery({ ...query, until: undefined, since: undefined })}
          onZoomOut={() => onQuery(zoomedOut(query))}
          sample={sample}
          saving={saving}
          onToggleSave={() => setSaving((v) => !v)}
          onClear={() => setClearing(true)}
          status={status}
          menu={pageActions}
        />
        {saving && <SaveFilterForm workspace={workspace} stack={stack} query={query} onDone={() => setSaving(false)} />}
        {clearing && (
          <ClearConfirm
            workspace={workspace}
            stack={stack}
            target={target}
            onCancel={() => setClearing(false)}
            onCleared={() => {
              setClearing(false);
              setSelected(undefined);
              stream.reload();
            }}
          />
        )}
        <SavedFilters workspace={workspace} filters={mine} sample={sample} onApply={onQuery} />

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
            <ErrorsSection
              groups={errorGroups}
              open={showErrors}
              onToggle={() => setShowErrors((v) => !v)}
              selected={query.group}
              onSelect={choose}
              now={now}
              series={groupSeries}
              trends={trends.data}
            />
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
                <LogDetail workspace={workspace} stack={stack} entry={e} onClose={() => setSelected(undefined)} onGroup={choose} onFilter={filterBy} onMute={() => addMute(muteOfText(messageOf(e)))} />
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
