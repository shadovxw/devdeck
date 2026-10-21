import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { useSocketStatus, useTopicHandler } from "./socket";
import type { CaptureInfo, CaptureRule, LogBatch, LogEntry, LogsPage } from "./types";

/** Rows kept in the browser; older ones are dropped as new ones arrive. */
export const maxRows = 5000;
const firstPage = 500;

const logsUrl = (workspace: string, stack: string) => `/workspaces/${encodeURIComponent(workspace)}/stacks/${encodeURIComponent(stack)}/logs`;

/**
 * A stack's collected output, kept current by the live "logs.<workspace>.<stack>"
 * batches. It starts from the latest stored lines. If a batch is missed (the
 * numbers skip), or the socket reconnects, or the view is resumed after a pause,
 * it asks for what it is missing instead of guessing. `service` limits it to one
 * service. While paused nothing is added.
 */
export function useStackLogs(workspace: string, stack: string, service: string | undefined) {
  const key = `${workspace}/${stack}/${service ?? ""}`;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  // Which view (stack and service) the lines on hand belong to, and which failed to load.
  const [loadedKey, setLoadedKey] = useState("");
  const [failedKey, setFailedKey] = useState("");
  const loadedRef = useRef("");
  const [paused, setPaused] = useState(false);
  const last = useRef(0);
  /** The last number of the last batch seen: a batch that starts later than this followed a lost one. */
  const lastBatch = useRef(0);
  const pausedRef = useRef(false);
  const generation = useRef(0);
  const socket = useSocketStatus();

  const append = useCallback((more: LogEntry[]) => {
    if (more.length === 0) return;
    setEntries((cur) => {
      const merged = cur.length === 0 ? more : [...cur, ...more.filter((e) => e.seq > (cur[cur.length - 1]?.seq ?? 0))];
      return merged.length > maxRows ? merged.slice(merged.length - maxRows) : merged;
    });
    last.current = Math.max(last.current, more[more.length - 1].seq);
  }, []);

  /** Fetches the newest lines, or only those after the last one seen. */
  const load = useCallback(
    async (fresh: boolean) => {
      const mine = ++generation.current;
      const q = new URLSearchParams({ limit: String(firstPage) });
      if (service) q.set("service", service);
      if (!fresh && last.current > 0) q.set("after", String(last.current));
      try {
        const page = await api.get<LogsPage>(`${logsUrl(workspace, stack)}?${q}`);
        if (mine !== generation.current) return;
        if (fresh) {
          last.current = 0;
          lastBatch.current = 0;
          setEntries([]);
        }
        append(page.entries);
        loadedRef.current = key;
        setLoadedKey(key);
      } catch {
        if (mine === generation.current && loadedRef.current !== key) setFailedKey(key);
      }
    },
    [workspace, stack, service, key, append],
  );

  // A different stack or service starts over. The timer lets quick changes of the
  // selection settle before anything is fetched.
  useEffect(() => {
    const t = setTimeout(() => void load(true), 0);
    return () => clearTimeout(t);
  }, [load]);

  // The socket coming back may have lost batches.
  useEffect(() => {
    if (socket === "open" && last.current > 0 && !pausedRef.current) void load(false);
  }, [socket, load]);

  useTopicHandler<LogBatch>(`logs.${workspace}.${stack}`, (batch) => {
    if (pausedRef.current) return;
    // Numbers count a whole stack, so a batch that skips ahead of the last one means
    // a batch was dropped on the way here. (With one service chosen its own entries
    // have holes by design, which is why the check is on batches, not entries.)
    const skipped = lastBatch.current > 0 && batch.from_seq > lastBatch.current + 1;
    lastBatch.current = batch.to_seq;
    if (skipped) {
      void load(false);
      return;
    }
    append(service ? batch.entries.filter((e) => e.service === service) : batch.entries);
  });

  const pause = useCallback(
    (value: boolean) => {
      pausedRef.current = value;
      setPaused(value);
      if (!value) void load(false); // catch up with what arrived meanwhile
    },
    [load],
  );

  const clear = useCallback(() => setEntries([]), []);

  const state = loadedKey === key ? "ready" : failedKey === key ? "error" : "loading";
  // Lines of another view are not shown while this one loads.
  return { entries: loadedKey === key ? entries : [], state, paused, pause, clear } as const;
}

/** What is stored for each service of a stack, from the stack file and from choices made at run time. */
export function useCaptures(workspace: string, stack: string, enabled: boolean) {
  return useQuery({
    queryKey: ["logs-capture", workspace, stack],
    queryFn: ({ signal }) => api.get<CaptureInfo[]>(`${logsUrl(workspace, stack)}/capture`, signal),
    enabled,
  });
}

/** Switches one service's rule at run time (saved by the server; it beats the stack file). */
export function useSetCapture(workspace: string, stack: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ service, rule }: { service: string; rule: CaptureRule }) =>
      api.put<CaptureInfo>(`${logsUrl(workspace, stack)}/capture?service=${encodeURIComponent(service)}`, rule),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs-capture", workspace, stack] }),
  });
}

/** Goes back to the rule written in the stack file. */
export function useResetCapture(workspace: string, stack: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (service: string) => api.delete<CaptureInfo>(`${logsUrl(workspace, stack)}/capture?service=${encodeURIComponent(service)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs-capture", workspace, stack] }),
  });
}
