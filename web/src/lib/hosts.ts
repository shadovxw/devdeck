import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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

/** The most lines the logs panel keeps. */
export const maxHostLogLines = 2000;

/**
 * Follows a remote stack's logs (one service, or all of them when service is "") while
 * enabled. The server keeps the stream going across tunnel drops; this keeps the last
 * maxHostLogLines lines.
 */
export function useHostLogs(ws: string, host: string, stack: string, service: string, enabled: boolean) {
  const url = `/api/v1${base(ws, host)}/stacks/${encodeURIComponent(stack)}/logs?tail=200${service ? `&service=${encodeURIComponent(service)}` : ""}`;
  // The state belongs to one address: when the address changes, the old lines no longer count.
  const [state, setState] = useState<{ url: string; lines: HostLogLine[]; error: string | null; live: boolean }>({ url: "", lines: [], error: null, live: false });

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const update = (f: (s: { lines: HostLogLine[]; error: string | null; live: boolean }) => Partial<{ lines: HostLogLine[]; error: string | null; live: boolean }>) =>
      setState((prev) => {
        const cur = prev.url === url ? prev : { url, lines: [], error: null, live: false };
        return { ...cur, ...f(cur) };
      });
    void (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/x-ndjson" } });
        if (!res.ok || !res.body) {
          let message = res.statusText || `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            // not JSON
          }
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
          buf += decoder.decode(value, { stream: true });
          const batch: HostLogLine[] = [];
          let i = buf.indexOf("\n");
          while (i >= 0) {
            const text = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (text) {
              try {
                batch.push(JSON.parse(text) as HostLogLine);
              } catch {
                // a line that isn't JSON is skipped
              }
            }
            i = buf.indexOf("\n");
          }
          if (batch.length > 0) update((cur) => ({ lines: [...cur.lines, ...batch].slice(-maxHostLogLines) }));
        }
        update(() => ({ live: false }));
      } catch (e) {
        if (!ctrl.signal.aborted) update(() => ({ error: e instanceof Error ? e.message : "the logs stopped", live: false }));
      }
    })();
    return () => ctrl.abort();
  }, [url, enabled]);

  const mine = state.url === url;
  return { lines: mine ? state.lines : [], error: mine ? state.error : null, live: mine && state.live };
}
