import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";

/** The SSM tunnel to a host, as the server sees it. */
export type TunnelState = { open: boolean; port?: number; users: number; error?: string };

/** A remote host from a workspace. It never carries the token, only whether one is saved. */
export type HostView = {
  workspace: string;
  workspace_name: string;
  id: string;
  name: string;
  type: string;
  instance?: string;
  region?: string;
  profile?: string;
  agent_port: number;
  token_set: boolean;
  tunnel: TunnelState;
};

export type AgentStack = { id: string; name: string; allow_write: boolean; after: string[] };
export type AgentInfo = { version: string; api: number; stacks: AgentStack[] };

/** One container of `docker compose ps`, as the agent passes it on. */
export type RemoteContainer = {
  Name: string;
  Service: string;
  Image: string;
  State: string;
  Health: string;
  Status: string;
  ExitCode: number;
  Publishers: { URL: string; TargetPort: number; PublishedPort: number; Protocol: string }[] | null;
};

/** A service's configuration with no values in it: environment variables are names only. */
export type ComposeService = {
  name: string;
  container_name?: string;
  image?: string;
  build: boolean;
  ports: string[];
  depends_on: { service: string; condition: string }[];
  healthcheck?: { test: string; interval?: string; timeout?: string; retries?: number; disabled?: boolean };
  volumes: string[];
  restart?: string;
  env: string[];
};
export type ComposeView = { name: string; services: ComposeService[] };

export type HostLogLine = { service?: string; ts?: string; line?: string; error?: string };

const base = (ws: string, host: string) => `/hosts/${encodeURIComponent(ws)}/${encodeURIComponent(host)}`;
const keys = {
  hosts: ["hosts"] as const,
  info: (ws: string, host: string) => ["hosts", ws, host, "info"] as const,
  services: (ws: string, host: string, stack: string) => ["hosts", ws, host, "stacks", stack, "services"] as const,
  compose: (ws: string, host: string, stack: string) => ["hosts", ws, host, "stacks", stack, "compose"] as const,
};

export function useHosts() {
  return useQuery({ queryKey: keys.hosts, queryFn: ({ signal }) => api.get<HostView[]>("/hosts", signal), refetchInterval: 10_000 });
}

/** Opens the tunnel (when needed) and asks the agent which stacks it has. */
export function useHostInfo(ws: string, host: string, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.info(ws, host),
    queryFn: async ({ signal }) => {
      try {
        return await api.get<AgentInfo>(`${base(ws, host)}/info`, signal);
      } finally {
        void qc.invalidateQueries({ queryKey: keys.hosts, exact: true }); // the tunnel's state changed
      }
    },
    enabled,
    retry: false,
  });
}

export function useHostServices(ws: string, host: string, stack: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.services(ws, host, stack),
    queryFn: ({ signal }) => api.get<RemoteContainer[]>(`${base(ws, host)}/stacks/${encodeURIComponent(stack)}/services`, signal),
    enabled,
    refetchInterval: 5_000,
    retry: false,
  });
}

export function useHostCompose(ws: string, host: string, stack: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.compose(ws, host, stack),
    queryFn: ({ signal }) => api.get<ComposeView>(`${base(ws, host)}/stacks/${encodeURIComponent(stack)}/compose`, signal),
    enabled,
    retry: false,
  });
}

/** Saves the agent's token in the OS keychain (through the server). It is never read back. */
export function useSaveHostToken(ws: string, host: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.put<void>(`${base(ws, host)}/token`, { token }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.hosts });
      qc.removeQueries({ queryKey: ["hosts", ws, host] });
    },
  });
}

export function useForgetHostToken(ws: string, host: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`${base(ws, host)}/token`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.hosts });
      qc.removeQueries({ queryKey: ["hosts", ws, host] });
    },
  });
}

export function useDisconnectHost(ws: string, host: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>(`${base(ws, host)}/disconnect`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["hosts", ws, host] });
      void qc.invalidateQueries({ queryKey: keys.hosts });
    },
  });
}

/** A write to ask of a host's agent: a service's start/stop/restart, or a stack's up/down/pull/script. */
export type HostAction = {
  name: "start" | "stop" | "restart" | "up" | "down" | "pull" | "script";
  /** The service, for start, stop and restart; empty for a whole stack. */
  service?: string;
  /** "down" with the action "down" removes the containers; otherwise they are only stopped. */
  remove?: boolean;
};

/** What a write has printed so far, and how it ended (null while it runs). */
export type ActionState = {
  action: HostAction | null;
  running: boolean;
  lines: string[];
  result: { ok: boolean; error?: string } | null;
};

const idle: ActionState = { action: null, running: false, lines: [], result: null };

/** The most output lines of a write the page keeps. */
export const maxActionLines = 500;

function actionURL(ws: string, host: string, stack: string, a: HostAction): string {
  const s = `/api/v1${base(ws, host)}/stacks/${encodeURIComponent(stack)}`;
  const path = a.service ? `${s}/services/${encodeURIComponent(a.service)}/${a.name}` : `${s}/${a.name}`;
  return a.name === "down" && a.remove ? `${path}?mode=down` : path;
}

/**
 * Runs writes on one stack of a host, one at a time, and keeps what the last one printed.
 * The server streams the agent's output as newline-delimited JSON; the last line says how
 * it ended. The agent finishes a write even if this page goes away, so leaving only stops
 * the reading.
 */
export function useHostAction(ws: string, host: string, stack: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<ActionState>(idle);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(
    async (a: HostAction) => {
      ctrl.current?.abort();
      const mine = new AbortController();
      ctrl.current = mine;
      setState({ action: a, running: true, lines: [], result: null });
      const finish = (result: { ok: boolean; error?: string }) => {
        if (mine.signal.aborted) return;
        setState((s) => ({ ...s, running: false, result }));
        void qc.invalidateQueries({ queryKey: keys.services(ws, host, stack) });
      };
      try {
        const res = await fetch(actionURL(ws, host, stack, a), { method: "POST", signal: mine.signal, headers: { Accept: "application/x-ndjson" } });
        if (!res.ok || !res.body) {
          finish({ ok: false, error: await refusal(res) });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let ended = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const { lines, rest } = splitLines(buf + decoder.decode(value, { stream: true }));
          buf = rest;
          for (const l of lines as (ShownLogLine & ActionEnd)[]) {
            if (l.done) {
              ended = true;
              finish({ ok: l.ok === true, error: l.error });
            } else if (l.line !== undefined) {
              setState((s) => ({ ...s, lines: [...s.lines, l.line ?? ""].slice(-maxActionLines) }));
            }
          }
        }
        if (!ended) finish({ ok: false, error: "the connection ended before the action did; it may still be running on the host" });
      } catch (e) {
        if (!mine.signal.aborted) finish({ ok: false, error: e instanceof Error ? e.message : "the action stopped" });
      }
    },
    [qc, ws, host, stack],
  );

  const clear = useCallback(() => setState(idle), []);
  return { state, run, clear };
}

type ActionEnd = { done?: boolean; ok?: boolean };

/** The most lines the logs panel keeps. */
export const maxHostLogLines = 2000;

/**
 * Follows a remote stack's logs (one service, or all of them when service is "") while
 * enabled. The server keeps the stream going across tunnel drops; this keeps the last
 * maxHostLogLines lines.
 */
export function useHostLogs(ws: string, host: string, stack: string, service: string, enabled: boolean) {
  const url = logsURL(ws, host, stack, service);
  // The state belongs to one address: when the address changes, the old lines no longer count.
  const [state, setState] = useState<LogState & { url: string }>({ url: "", lines: [], error: null, live: false });

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const update = (f: (s: LogState) => Partial<LogState>) =>
      setState((prev) => {
        const cur = prev.url === url ? prev : { url, lines: [], error: null, live: false };
        return { ...cur, ...f(cur) };
      });
    void follow(url, ctrl.signal, update);
    return () => ctrl.abort();
  }, [url, enabled]);

  const mine = state.url === url;
  return { lines: mine ? state.lines : [], error: mine ? state.error : null, live: mine && state.live };
}

/** A line of the logs panel, with an id that stays the same while the list moves. */
export type ShownLogLine = HostLogLine & { id: number };
type LogState = { lines: ShownLogLine[]; error: string | null; live: boolean };

function logsURL(ws: string, host: string, stack: string, service: string): string {
  const q = new URLSearchParams({ tail: "200" });
  if (service) q.set("service", service);
  return `/api/v1${base(ws, host)}/stacks/${encodeURIComponent(stack)}/logs?${q.toString()}`;
}

/** The server's reason for a refused request, or its status. */
async function refusal(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // not JSON
  }
  return res.statusText || `HTTP ${res.status}`;
}

let nextLineID = 1;

/** Splits newline-delimited JSON into lines, keeping an unfinished last line for later. */
export function splitLines(buf: string): { lines: ShownLogLine[]; rest: string } {
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  const lines: ShownLogLine[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    try {
      lines.push({ ...(JSON.parse(text) as HostLogLine), id: nextLineID++ });
    } catch {
      // a line that isn't JSON is skipped
    }
  }
  return { lines, rest };
}

/** Reads the stream into the state until it ends or the signal stops it. */
async function follow(url: string, signal: AbortSignal, update: (f: (s: LogState) => Partial<LogState>) => void) {
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/x-ndjson" } });
    if (!res.ok || !res.body) {
      const message = await refusal(res);
      update(() => ({ error: message }));
      return;
    }
    update(() => ({ live: true }));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const { lines, rest } = splitLines(buf + decoder.decode(value, { stream: true }));
      buf = rest;
      if (lines.length > 0) update((cur) => ({ lines: [...cur.lines, ...lines].slice(-maxHostLogLines) }));
    }
    update(() => ({ live: false }));
  } catch (e) {
    if (!signal.aborted) update(() => ({ error: e instanceof Error ? e.message : "the logs stopped", live: false }));
  }
}

// ----- versions: the image tags of a remote stack -----

/** One service of a stack and where its image tag comes from. */
export type VersionEntry = {
  service: string;
  /** The env variable the compose file takes the image from; empty when the image is written in the compose file. */
  variable?: string;
  repository?: string;
  /** The tag in the host's versions file, and the tag of the container that runs. */
  file_tag?: string;
  running_tag?: string;
  running_image?: string;
  state?: string;
  health?: string;
  /** The file says one tag and another runs: a change saved but not applied, or one made by hand. */
  differs: boolean;
  editable: boolean;
  note?: string;
};

export type VersionsView = { file: string; services: VersionEntry[] };

/** One tag change from the host's change log. */
export type VersionEvent = {
  at: string;
  stack: string;
  service: string;
  variable: string;
  old: string;
  new: string;
  by: string;
  applied: boolean;
  ok: boolean;
  detail?: string;
};

/** How one changed service ended up after a change was applied. */
export type VersionResult = { service: string; tag: string; state?: string; health?: string; ok: boolean; detail?: string; logs?: string[] };

export type VersionRequest = { changes: { service: string; tag: string }[]; apply: boolean };

const versionKeys = {
  versions: (ws: string, host: string, stack: string) => ["hosts", ws, host, "stacks", stack, "versions"] as const,
  history: (ws: string, host: string, stack: string) => ["hosts", ws, host, "stacks", stack, "versions", "history"] as const,
};

export function useHostVersions(ws: string, host: string, stack: string, enabled: boolean) {
  return useQuery({
    queryKey: versionKeys.versions(ws, host, stack),
    queryFn: ({ signal }) => api.get<VersionsView>(`${base(ws, host)}/stacks/${encodeURIComponent(stack)}/versions`, signal),
    enabled,
    retry: false,
  });
}

export function useHostVersionHistory(ws: string, host: string, stack: string, enabled: boolean) {
  return useQuery({
    queryKey: versionKeys.history(ws, host, stack),
    queryFn: ({ signal }) => api.get<VersionEvent[]>(`${base(ws, host)}/stacks/${encodeURIComponent(stack)}/versions/history?limit=30`, signal),
    enabled,
    retry: false,
  });
}

/** What a tag change has printed so far, and how it ended (result null while it runs). */
export type VersionsRunState = {
  request: VersionRequest | null;
  running: boolean;
  lines: string[];
  result: { ok: boolean; error?: string } | null;
  results: VersionResult[];
};

const versionsIdle: VersionsRunState = { request: null, running: false, lines: [], result: null, results: [] };

type VersionsEnd = ActionEnd & { line?: string; error?: string; versions?: VersionResult[] };

/**
 * Changes tags on one stack of a host and, when asked, applies them. The server streams the agent's
 * output as newline-delimited JSON; the last line says how it ended and how each service came up.
 * The agent finishes a change even if this page goes away, so leaving only stops the reading.
 */
export function useVersionsChange(ws: string, host: string, stack: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<VersionsRunState>(versionsIdle);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(
    async (req: VersionRequest) => {
      ctrl.current?.abort();
      const mine = new AbortController();
      ctrl.current = mine;
      setState({ request: req, running: true, lines: [], result: null, results: [] });
      const finish = (result: { ok: boolean; error?: string }, results: VersionResult[] = []) => {
        if (mine.signal.aborted) return;
        setState((s) => ({ ...s, running: false, result, results }));
        void qc.invalidateQueries({ queryKey: versionKeys.versions(ws, host, stack) });
        void qc.invalidateQueries({ queryKey: keys.services(ws, host, stack) });
      };
      try {
        const res = await fetch(`/api/v1${base(ws, host)}/stacks/${encodeURIComponent(stack)}/versions`, {
          method: "PUT",
          signal: mine.signal,
          headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
        if (!res.ok || !res.body) {
          finish({ ok: false, error: await refusal(res) });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let ended = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const { lines, rest } = splitLines(buf + decoder.decode(value, { stream: true }));
          buf = rest;
          for (const l of lines as unknown as VersionsEnd[]) {
            if (l.done) {
              ended = true;
              finish({ ok: l.ok === true, error: l.error }, l.versions ?? []);
            } else if (l.line !== undefined) {
              setState((s) => ({ ...s, lines: [...s.lines, l.line ?? ""].slice(-maxActionLines) }));
            }
          }
        }
        if (!ended) finish({ ok: false, error: "the connection ended before the change did; it may still be running on the host" });
      } catch (e) {
        if (!mine.signal.aborted) finish({ ok: false, error: e instanceof Error ? e.message : "the change stopped" });
      }
    },
    [qc, ws, host, stack],
  );

  const clear = useCallback(() => setState(versionsIdle), []);
  return { state, run, clear };
}
