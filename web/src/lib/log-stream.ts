import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api";
import { compilePattern, entryMatches, logQueryString, type LogQuery } from "./log-query";
import { useSocketStatus, useTopicHandler } from "./socket";
import type { LogBatch, LogEntry, LogsPage } from "./types";

/** Rows kept in the browser while following; older ones are dropped as new ones arrive. */
export const streamMaxRows = 5000;
const pageSize = 500;

const logsUrl = (workspace: string, stack: string) => `/workspaces/${encodeURIComponent(workspace)}/stacks/${encodeURIComponent(stack)}/logs`;

/** The part of a query that decides which lines are shown (paging is not part of it). */
export function viewKey(workspace: string, stack: string, q: LogQuery): string {
  return `${workspace}/${stack}?${logQueryString({ ...q, before: undefined, after: undefined, limit: undefined })}`;
}

/**
 * A stack's stored lines under a query, kept current by the live batches while
 * `live` is true. It starts from the newest stored lines that match; `loadOlder`
 * reads the page before the first one on hand. A batch that skips ahead (a lost
 * batch), the socket coming back, or resuming after a pause each ask the server for
 * what is missing instead of guessing. Lines that arrive live are tested against the
 * same filters in the browser. Changing the query starts over.
 */
export function useLogStream(workspace: string, stack: string, query: LogQuery, live: boolean) {
  const key = viewKey(workspace, stack, query);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [failed, setFailed] = useState<{ key: string; message: string }>({ key: "", message: "" });
  const [hasOlder, setHasOlder] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const loadedRef = useRef("");
  const last = useRef(0);
  const lastBatch = useRef(0);
  const generation = useRef(0);
  const socket = useSocketStatus();
  const re = useMemo(() => compilePattern(query.regex), [query.regex]);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const append = useCallback((more: LogEntry[]) => {
    if (more.length === 0) return;
    setEntries((cur) => {
      const merged = cur.length === 0 ? more : [...cur, ...more.filter((e) => e.seq > (cur[cur.length - 1]?.seq ?? 0))];
      return merged.length > streamMaxRows ? merged.slice(merged.length - streamMaxRows) : merged;
    });
    last.current = Math.max(last.current, more[more.length - 1].seq);
  }, []);

  /** Fetches the newest matching lines, or only those after the last one seen. */
  const load = useCallback(
    async (fresh: boolean) => {
      const mine = ++generation.current;
      const q: LogQuery = { ...queryRef.current, limit: pageSize };
      if (!fresh && last.current > 0) q.after = last.current;
      try {
        const page = await api.get<LogsPage>(`${logsUrl(workspace, stack)}?${logQueryString(q)}`);
        if (mine !== generation.current) return;
        if (fresh) {
          last.current = 0;
          lastBatch.current = 0;
          setEntries([]);
          setHasOlder(!!page.next_before);
        }
        append(page.entries);
        loadedRef.current = key;
        setLoadedKey(key);
      } catch (err) {
        if (mine === generation.current && loadedRef.current !== key) setFailed({ key, message: err instanceof Error ? err.message : "" });
      }
    },
    [workspace, stack, key, append],
  );

  // A different stack or query starts over. The timer lets quick changes settle first.
  useEffect(() => {
    const t = setTimeout(() => void load(true), 0);
    return () => clearTimeout(t);
  }, [load]);

  // The socket coming back may have lost batches.
  useEffect(() => {
    if (socket === "open" && live && last.current > 0 && !pausedRef.current) void load(false);
  }, [socket, live, load]);

  useTopicHandler<LogBatch>(`logs.${workspace}.${stack}`, (batch) => {
    if (!live || pausedRef.current) return;
    // Numbers count a whole stack, so a batch that starts after the end of the last
    // one means one was dropped on the way here.
    const skipped = lastBatch.current > 0 && batch.from_seq > lastBatch.current + 1;
    lastBatch.current = batch.to_seq;
    if (skipped) {
      void load(false);
      return;
    }
    append(batch.entries.filter((e) => entryMatches(e, queryRef.current, re)));
  });

  const pause = useCallback(
    (value: boolean) => {
      pausedRef.current = value;
      setPaused(value);
      if (!value && live) void load(false); // catch up with what arrived meanwhile
    },
    [live, load],
  );

  /** Reads the page of matching lines before the first one on hand. */
  const loadOlder = useCallback(async () => {
    const first = entries[0]?.seq;
    if (!first) return;
    const q: LogQuery = { ...queryRef.current, before: first, limit: pageSize };
    try {
      const page = await api.get<LogsPage>(`${logsUrl(workspace, stack)}?${logQueryString(q)}`);
      setEntries((cur) => [...page.entries.filter((e) => e.seq < (cur[0]?.seq ?? Infinity)), ...cur]);
      setHasOlder(!!page.next_before);
    } catch {
      setHasOlder(false);
    }
  }, [workspace, stack, entries]);

  const state = loadedKey === key ? "ready" : failed.key === key ? "error" : "loading";
  return {
    entries: loadedKey === key ? entries : [],
    state,
    error: failed.key === key ? failed.message : "",
    hasOlder: loadedKey === key && hasOlder,
    loadOlder,
    paused,
    pause,
    reload: () => void load(true),
  } as const;
}
