import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";

/** A Docker Hub account on this machine. Its token is in the OS keychain: only whether it is saved shows here. */
export type DockerAccount = { id: string; username: string; registry: string; namespaces: string[]; token_set: boolean };

/** A named build secret: its name and whether a value is saved. Never the value. */
export type BuildSecret = { name: string; value_set: boolean };

export type DockerOverview = { accounts: DockerAccount[]; build_secrets: BuildSecret[]; docker_installed: boolean };

/** What signing in to Docker Hub with an account showed. */
export type DockerCheck = { username: string; namespaces: string[] };

/** One of an image's build secrets: where it comes from and what, if anything, stops it being found. */
export type ImageSecret = { id: string; from: "github" | "keyring"; name?: string; problem?: string };

/** A finished build, from the history. */
export type BuildRecord = {
  id: number;
  at: string;
  workspace: string;
  repo: string;
  image: string;
  repository: string;
  tag: string;
  revision?: string;
  dirty: boolean;
  account: string;
  ok: boolean;
  error?: string;
  seconds: number;
};

/** One image of one repository of one of the user's workspaces. */
export type ImageRow = {
  workspace: string;
  workspace_name: string;
  repo: string;
  image: string;
  repository: string;
  dockerfile: string;
  context: string;
  platforms: string[];
  path: string;
  secrets: ImageSecret[];
  /** The Docker account that would push it, or empty with a problem saying why. */
  account?: string;
  problem?: string;
  branch?: string;
  commit?: string;
  dirty: boolean;
  folder_missing: boolean;
  last?: BuildRecord;
};

const keys = {
  docker: ["docker"] as const,
  images: ["images"] as const,
  builds: ["images", "builds"] as const,
};

export function useDocker() {
  return useQuery({ queryKey: keys.docker, queryFn: ({ signal }) => api.get<DockerOverview>("/docker", signal) });
}

/** Adds an account or changes its username and namespaces. The token is separate. */
export function useSaveDockerAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; username: string; namespaces: string[] }) =>
      api.put<DockerOverview>(`/docker/accounts/${encodeURIComponent(a.id)}`, { username: a.username, namespaces: a.namespaces }),
    onSuccess: (o) => {
      qc.setQueryData(keys.docker, o);
      void qc.invalidateQueries({ queryKey: keys.images });
    },
  });
}

export function useDeleteDockerAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/docker/accounts/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.docker });
      void qc.invalidateQueries({ queryKey: keys.images });
    },
  });
}

/** Saves an account's token in the OS keychain (through the server). It is never read back. */
export function useSetDockerToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; token: string }) => api.put<void>(`/docker/accounts/${encodeURIComponent(v.id)}/token`, { token: v.token }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.docker });
      void qc.invalidateQueries({ queryKey: keys.images });
    },
  });
}

export function useForgetDockerToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/docker/accounts/${encodeURIComponent(id)}/token`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.docker });
      void qc.invalidateQueries({ queryKey: keys.images });
    },
  });
}

/** Signs in to Docker Hub with the account and says who it is and which namespaces it can use. */
export function useCheckDockerAccount() {
  return useMutation({ mutationFn: (id: string) => api.post<DockerCheck>(`/docker/accounts/${encodeURIComponent(id)}/check`) });
}

export function useSetBuildSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; value: string }) => api.put<void>(`/docker/secrets/${encodeURIComponent(v.name)}`, { value: v.value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.docker });
      void qc.invalidateQueries({ queryKey: keys.images });
    },
  });
}

export function useDeleteBuildSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.delete<void>(`/docker/secrets/${encodeURIComponent(name)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.docker });
      void qc.invalidateQueries({ queryKey: keys.images });
    },
  });
}

export function useImages() {
  return useQuery({ queryKey: keys.images, queryFn: ({ signal }) => api.get<ImageRow[]>("/images", signal), refetchInterval: 20_000 });
}

export function useBuilds() {
  return useQuery({ queryKey: keys.builds, queryFn: ({ signal }) => api.get<BuildRecord[]>("/images/builds?limit=30", signal) });
}

export function useClearBuilds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>("/images/builds"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.images }),
  });
}

/** What the page shows of one build as it runs. */
export type BuildState = {
  tag: string;
  running: boolean;
  lines: string[];
  result: { ok: boolean; error?: string } | null;
  /** Set when Docker Hub already has the tag: what to ask the person before pushing over it. */
  exists: string | null;
};

const idle: BuildState = { tag: "", running: false, lines: [], result: null, exists: null };

/** The output kept on screen: the last lines, so a long build doesn't grow the page without end. */
const maxLines = 400;

function splitLines(text: string): { lines: unknown[]; rest: string } {
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  const lines: unknown[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    try {
      lines.push(JSON.parse(p));
    } catch {
      // not JSON: skip it
    }
  }
  return { lines, rest };
}

/**
 * Builds and pushes one image, showing docker's output as it arrives. The answer is a stream of
 * {"line"} objects and a last {"done":true,"ok":...}. A refusal before anything starts (no account,
 * a tag that exists) comes as an error status. The build runs to its end on the server even if the
 * page goes away, so a closed page never leaves a push half done.
 */
export function useImageBuild(row: Pick<ImageRow, "workspace" | "repo" | "image">) {
  const qc = useQueryClient();
  const [state, setState] = useState<BuildState>(idle);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(
    async (tag: string, overwrite: boolean) => {
      ctrl.current?.abort();
      const mine = new AbortController();
      ctrl.current = mine;
      setState({ tag, running: true, lines: [], result: null, exists: null });
      const finish = (result: { ok: boolean; error?: string }) => {
        if (mine.signal.aborted) return;
        setState((s) => ({ ...s, running: false, result }));
        void qc.invalidateQueries({ queryKey: keys.images });
      };
      try {
        const url = `/api/v1/images/${encodeURIComponent(row.workspace)}/${encodeURIComponent(row.repo)}/${encodeURIComponent(row.image)}/build`;
        const res = await fetch(url, {
          method: "POST",
          signal: mine.signal,
          headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
          body: JSON.stringify({ tag, overwrite }),
        });
        if (!res.ok || !res.body) {
          let message = res.statusText || `HTTP ${res.status}`;
          let exists = false;
          try {
            const body = (await res.json()) as { message?: string; exists?: boolean };
            if (typeof body.message === "string") message = body.message;
            exists = body.exists === true;
          } catch {
            // not JSON: keep the status text
          }
          if (mine.signal.aborted) return;
          if (exists) setState({ tag, running: false, lines: [], result: null, exists: message });
          else finish({ ok: false, error: message });
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
          for (const l of lines as { line?: string; done?: boolean; ok?: boolean; error?: string }[]) {
            if (l.done) {
              ended = true;
              finish({ ok: l.ok === true, error: l.error });
            } else if (l.line !== undefined) {
              setState((s) => ({ ...s, lines: [...s.lines, l.line ?? ""].slice(-maxLines) }));
            }
          }
        }
        if (!ended) finish({ ok: false, error: "the connection ended before the build did; it may still be running" });
      } catch (e) {
        if (!mine.signal.aborted) finish({ ok: false, error: e instanceof Error ? e.message : "the build stopped" });
      }
    },
    [qc, row.workspace, row.repo, row.image],
  );

  const reset = useCallback(() => setState(idle), []);
  return { state, run, reset };
}
