import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./api";
import type { Validation, WorkspaceSummary } from "./types";

/** workspace.yaml as the editor reads it: the text, which version it is (a hash), and where it lives. */
export type WorkspaceFile = { yaml: string; hash: string; path: string };

/** What a save answers: the workspace, and the hash of the file as it was written. */
export type SavedWorkspace = WorkspaceSummary & { hash: string };

/** The answer to a save over a file that changed on disk: the file as it is now. */
export type SaveConflict = { message: string; yaml: string; hash: string };

const fileUrl = (id: string) => `/workspaces/${encodeURIComponent(id)}/file`;

/** How often the editor asks whether the file changed behind its back. */
export const FILE_POLL_MS = 4000;

/** Reads workspace.yaml once. The editor keeps its own copy after that, so a refetch must not replace it. */
export function useWorkspaceFile(id: string) {
  return useQuery({
    queryKey: ["workspaces", "file", id],
    queryFn: ({ signal }) => api.get<WorkspaceFile>(fileUrl(id), signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * Asks, on a timer, which version of the file is on disk. The editor compares it with the one it started
 * from and offers Compare / Reload when they differ. Stops while the tab is hidden.
 */
export function useDiskFile(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["workspaces", "disk", id],
    queryFn: ({ signal }) => api.get<WorkspaceFile>(fileUrl(id), signal),
    enabled,
    refetchInterval: FILE_POLL_MS,
    refetchIntervalInBackground: false,
    gcTime: 0,
    retry: false,
  });
}

/** The conflict a refused save carries, or undefined when the error is something else. */
export function conflictOf(err: unknown): SaveConflict | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const d = err.data as Partial<SaveConflict> | undefined;
  return typeof d?.yaml === "string" && typeof d.hash === "string" ? { message: d.message ?? err.message, yaml: d.yaml, hash: d.hash } : undefined;
}

/** Saves workspace.yaml over the version the editor started from (`baseHash`); a changed file is refused with a 409. */
export function useSaveWorkspaceFile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ yaml, baseHash }: { yaml: string; baseHash: string }) =>
      api.put<SavedWorkspace>(`/workspaces/${encodeURIComponent(id)}`, { yaml, base_hash: baseHash }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["workspaces"], predicate: (q) => q.queryKey[1] !== "file" && q.queryKey[1] !== "disk" }),
        qc.invalidateQueries({ queryKey: ["git", "repos"] }),
      ]),
  });
}

/** Runs `git init` in a repo's folder (the fix for "isn't a git repository"). The caller confirms first. */
export function useGitInit(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repo: string) => api.post<void>(`/workspaces/${encodeURIComponent(workspace)}/repos/${encodeURIComponent(repo)}/git-init`),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: ["workspaces", workspace] }), qc.invalidateQueries({ queryKey: ["git", "repos"] })]),
  });
}

/** The JSON Schema of workspace.yaml, the one the server checks with. It gives the editor its suggestions. */
export function useWorkspaceSchema() {
  return useQuery({
    queryKey: ["schema", "workspace"],
    queryFn: ({ signal }) => api.get<Record<string, unknown>>("/schema/workspace", signal),
    staleTime: Infinity,
  });
}

/**
 * Checks the text in the editor the way a save would, plus the folders on this machine (a missing folder,
 * a folder that isn't a git repository). The answer for the previous text stays on screen while the next loads.
 */
export function useCheckWorkspaceText(id: string, yaml: string) {
  return useQuery({
    queryKey: ["workspaces", id, "check", yaml],
    queryFn: ({ signal }) => api.post<Validation>("/workspaces/validate", { kind: "workspace", workspace_id: id, yaml }, signal),
    placeholderData: keepPreviousData,
    retry: false,
    gcTime: 30_000,
  });
}
