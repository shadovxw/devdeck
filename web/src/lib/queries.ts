import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import type { DoctorReport, Health, Plugin, ScanResult, Validation, WorkspaceDetail, WorkspaceSummary } from "./types";

export const keys = {
  health: ["health"] as const,
  plugins: ["plugins"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
};

/** Polls the server. Fast while it is unreachable so the splash recovers by itself. */
export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => api.get<Health>("/health", signal),
    retry: false,
    refetchInterval: (query) => (query.state.status === "error" ? 3_000 : 30_000),
  });
}

export function usePlugins() {
  return useQuery({
    queryKey: keys.plugins,
    queryFn: ({ signal }) => api.get<Plugin[]>("/plugins", signal),
  });
}

/** Re-runs one plugin's check and patches it into the cached list. */
export function useCheckPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Plugin>(`/plugins/${encodeURIComponent(id)}/check`),
    onSuccess: (updated) => {
      qc.setQueryData<Plugin[]>(keys.plugins, (list) => list?.map((p) => (p.id === updated.id ? updated : p)));
    },
  });
}

export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: ({ signal }) => api.get<WorkspaceSummary[]>("/workspaces", signal),
  });
}

export function useWorkspace(id: string | undefined) {
  return useQuery({
    queryKey: keys.workspace(id ?? ""),
    queryFn: ({ signal }) => api.get<WorkspaceDetail>(`/workspaces/${encodeURIComponent(id ?? "")}`, signal),
    enabled: Boolean(id),
  });
}

/** Looks at a folder of repositories and drafts a workspace. Saves nothing. */
export function useScanFolder() {
  return useMutation({ mutationFn: (root: string) => api.post<ScanResult>("/workspaces/scan", { root }) });
}

/** Checks workspace YAML as it is typed. An empty draft is not checked. */
export function useValidateWorkspace(yaml: string) {
  return useQuery({
    queryKey: ["workspaces", "validate", yaml],
    queryFn: ({ signal }) => api.post<Validation>("/workspaces/validate", { kind: "workspace", yaml }, signal),
    enabled: yaml.trim() !== "",
    placeholderData: (previous) => previous,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) => api.post<WorkspaceSummary>("/workspaces", { yaml }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

/** Checks the machine for a workspace, or for one of its stacks. Slow, so only on demand. */
export function useDoctor(workspace: string | undefined, stack: string | undefined) {
  const query = new URLSearchParams({ workspace: workspace ?? "" });
  if (stack) query.set("stack", stack);
  return useQuery({
    queryKey: ["doctor", workspace ?? "", stack ?? ""],
    queryFn: ({ signal }) => api.get<DoctorReport>(`/doctor?${query}`, signal),
    enabled: Boolean(workspace),
    refetchOnWindowFocus: false,
    retry: false,
  });
}
