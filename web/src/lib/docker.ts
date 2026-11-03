import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { imageKey } from "./images";

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
  /** Commits on top of the one the last good build here was made from; absent when unknown. */
  ahead?: number;
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

/** A tag Docker Hub has for an image's repository, with when it was last pushed and how big it is. */
export type HubTag = { name: string; pushed_at?: string; size?: number };

/** The tags Docker Hub has for one image's repository, or why they couldn't be read. */
export type ImageTags = { workspace: string; repo: string; image: string; repository: string; tags: HubTag[]; error?: string };

/** The last tags of every image's repository, most recently pushed first, in one request. Kept a minute. */
export function useAllImageTags() {
  return useQuery({
    queryKey: ["images", "tags"],
    queryFn: ({ signal }) => api.get<ImageTags[]>("/images/tags?limit=10", signal),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
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

/** The output kept: every line of an ordinary build, and the last ones of a very long one, so the page can not grow without end. */
const maxLines = 20_000;

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

export type JobState = "queued" | "running" | "ok" | "failed" | "exists";

/** One build asked for on the page: waiting, running, or finished. */
export type BuildJob = {
  key: string;
  row: Pick<ImageRow, "workspace" | "repo" | "image" | "repository">;
  tag: string;
  overwrite: boolean;
  state: JobState;
  lines: string[];
  /** 1 while docker builds, 2 once it pushes. */
  step: 1 | 2;
  error?: string;
  /** Set when Docker Hub already has the tag: what to ask before pushing over it. */
  message?: string;
  startedAt?: number;
  finishedAt?: number;
};

const pushing = /\b(pushing|exporting to image|exporting layers)\b/i;

const waiting = (j: BuildJob) => j.state === "running" || j.state === "queued";

/**
 * The builds asked for on the page, run one after another. Each shows docker's output as it arrives. The answer is
 * a stream of {"line"} objects and a last {"done":true,"ok":...}. A refusal before anything starts (no account, a tag
 * that exists) comes as an error status. A build runs to its end on the server even if the page goes away, so a
 * closed page never leaves a push half done.
 */
export function useBuildJobs() {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<BuildJob[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const patch = useCallback((key: string, fn: (j: BuildJob) => BuildJob) => setJobs((js) => js.map((j) => (j.key === key ? fn(j) : j))), []);

  /** Adds builds to the end of the queue. A finished build of the same image is replaced; one still waiting or running is kept. */
  const enqueue = useCallback((items: Array<{ row: BuildJob["row"]; tag: string; overwrite?: boolean }>) => {
    setJobs((js) => {
      const added: BuildJob[] = [];
      for (const { row, tag, overwrite } of items) {
        const key = imageKey(row);
        if (js.some((j) => j.key === key && waiting(j))) continue;
        added.push({
          key,
          row: { workspace: row.workspace, repo: row.repo, image: row.image, repository: row.repository },
          tag,
          overwrite: overwrite === true,
          state: "queued",
          lines: [],
          step: 1,
        });
      }
      const replaced = new Set(added.map((j) => j.key));
      return [...js.filter((j) => !replaced.has(j.key)), ...added];
    });
  }, []);

  const dismiss = useCallback((key: string) => setJobs((js) => js.filter((j) => j.key !== key || waiting(j))), []);

  const run = useCallback(
    async (job: BuildJob) => {
      ctrl.current?.abort();
      const mine = new AbortController();
      ctrl.current = mine;
      patch(job.key, (j) => ({ ...j, state: "running", startedAt: Date.now() }));
      const finish = (state: "ok" | "failed", error?: string) => {
        if (mine.signal.aborted) return;
        patch(job.key, (j) => ({ ...j, state, error, finishedAt: Date.now() }));
        void qc.invalidateQueries({ queryKey: keys.images });
      };
      try {
        const url = `/api/v1/images/${encodeURIComponent(job.row.workspace)}/${encodeURIComponent(job.row.repo)}/${encodeURIComponent(job.row.image)}/build`;
        const res = await fetch(url, {
          method: "POST",
          signal: mine.signal,
          headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
          body: JSON.stringify({ tag: job.tag, overwrite: job.overwrite }),
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
          if (exists) patch(job.key, (j) => ({ ...j, state: "exists", message, finishedAt: Date.now() }));
          else finish("failed", message);
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
              finish(l.ok === true ? "ok" : "failed", l.error);
            } else if (l.line !== undefined) {
              const line = l.line;
              patch(job.key, (j) => ({ ...j, lines: [...j.lines, line].slice(-maxLines), step: j.step === 2 || pushing.test(line) ? 2 : 1 }));
            }
          }
        }
        if (!ended) finish("failed", "the connection ended before the build did; it may still be running");
      } catch (e) {
        if (!mine.signal.aborted) finish("failed", e instanceof Error ? e.message : "the build stopped");
      }
    },
    [qc, patch],
  );

  // One build at a time: when none runs, the next waiting one starts.
  const busy = jobs.some((j) => j.state === "running");
  useEffect(() => {
    if (busy) return;
    const next = jobs.find((j) => j.state === "queued");
    if (!next) return;
    // a tick later, so the state it sets isn't set in the middle of this effect
    const t = setTimeout(() => void run(next), 0);
    return () => clearTimeout(t);
  }, [jobs, busy, run]);

  return { jobs, enqueue, dismiss };
}
