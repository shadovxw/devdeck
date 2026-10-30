import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "./api";
import { mergeRun } from "./runs";
import { useSocketStatus, useTopicHandler } from "./socket";
import type { DoctorReport, Health, Plugin, RunStatus, ScanResult, StackSaved, Validation, WorkspaceDetail, WorkspaceSummary } from "./types";

export const keys = {
  health: ["health"] as const,
  plugins: ["plugins"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
  runs: ["runs"] as const,
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

/**
 * Opens the system's folder dialog on this computer and resolves with the chosen
 * folder, or undefined when the dialog was closed without choosing one.
 */
export function usePickFolder() {
  return useMutation({ mutationFn: () => api.post<{ path: string } | undefined>("/system/pick-folder") });
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

/** The text of workspace.yaml, for the editor. */
export function useWorkspaceYaml(id: string | undefined) {
  return useQuery({
    queryKey: ["workspaces", "yaml", id ?? ""],
    queryFn: ({ signal }) => api.get<{ yaml: string }>(`/workspaces/${encodeURIComponent(id ?? "")}/file`, signal),
    enabled: Boolean(id),
    // the editor holds its own copy while the person types: don't replace it from under them
    staleTime: Infinity,
    gcTime: 0,
  });
}

/** Saves new text over one of the user's own workspace.yaml files. It is checked first; the name can't change. */
export function useUpdateWorkspace(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) => api.put<WorkspaceSummary>(`/workspaces/${encodeURIComponent(id)}`, { yaml }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(id) });
      void qc.invalidateQueries({ queryKey: ["images"] });
      return qc.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}

/** Deletes one of the user's own workspaces. Its files move to a trash folder; the repositories are untouched. */
export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/workspaces/${encodeURIComponent(id)}`),
    onSuccess: (_none, id) => {
      qc.removeQueries({ queryKey: keys.workspace(id) });
      return qc.invalidateQueries({ queryKey: keys.workspaces });
    },
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

/**
 * The stacks devdeck has started, kept current by the live "stacks.*" updates.
 * When the socket reconnects the list is fetched again, in case updates were missed.
 */
export function useRuns() {
  const qc = useQueryClient();
  const socket = useSocketStatus();
  const query = useQuery({
    queryKey: keys.runs,
    queryFn: ({ signal }) => api.get<RunStatus[]>("/runs", signal),
  });
  useTopicHandler<RunStatus>("stacks.*", (run) => {
    qc.setQueryData<RunStatus[]>(keys.runs, (list) => mergeRun(list, run));
  });
  useEffect(() => {
    if (socket === "open") void qc.invalidateQueries({ queryKey: keys.runs });
  }, [socket, qc]);
  return query;
}

type StackRef = { workspace: string; stack: string };

const stackUrl = ({ workspace, stack }: StackRef) => `/workspaces/${encodeURIComponent(workspace)}/stacks/${encodeURIComponent(stack)}`;

/** Checks the machine, then starts the stack in the background. A refusal carries the Doctor report. */
export function useStartStack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: StackRef) => api.post<RunStatus>(`${stackUrl(ref)}/start`),
    onSuccess: (run) => qc.setQueryData<RunStatus[]>(keys.runs, (list) => mergeRun(list, run)),
  });
}

export function useStopStack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: StackRef) => api.post<void>(`${stackUrl(ref)}/stop`),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.runs }),
  });
}

/** Stops one service (or compose file) of a running stack and leaves it stopped. */
export function useStopService() {
  return useMutation({
    mutationFn: (ref: StackRef & { service: string }) => api.post<void>(`${stackUrl(ref)}/services/${encodeURIComponent(ref.service)}/stop`),
  });
}

/** Starts a service (or compose file) that was stopped, failed, or never got to start. */
export function useStartService() {
  return useMutation({
    mutationFn: (ref: StackRef & { service: string }) => api.post<void>(`${stackUrl(ref)}/services/${encodeURIComponent(ref.service)}/start`),
  });
}

export function useRestartService() {
  return useMutation({
    mutationFn: (ref: StackRef & { service: string }) => api.post<void>(`${stackUrl(ref)}/services/${encodeURIComponent(ref.service)}/restart`),
  });
}

// ---- a stack's file: add, read, change, delete --------------------------------

/** Checks a stack's YAML as it is typed, against the workspace's repos. An empty draft is not checked. */
export function useValidateStack(workspace: string, yaml: string) {
  return useQuery({
    queryKey: ["workspaces", "validate-stack", workspace, yaml],
    queryFn: ({ signal }) => api.post<Validation>("/workspaces/validate", { kind: "stack", yaml, workspace_id: workspace }, signal),
    enabled: yaml.trim() !== "",
    placeholderData: (previous) => previous,
  });
}

/** The text of a stack's file, for the editor. Read fresh each time the editor opens. */
export function useStackFile(workspace: string, stack: string | undefined) {
  return useQuery({
    queryKey: ["stack-file", workspace, stack ?? ""],
    queryFn: ({ signal }) => api.get<{ yaml: string }>(`${stackUrl({ workspace, stack: stack ?? "" })}/file`, signal),
    enabled: Boolean(stack),
    gcTime: 0,
  });
}

/** After a stack file changes, the workspace's stack list and counts are stale. */
function refreshWorkspace(qc: ReturnType<typeof useQueryClient>, workspace: string) {
  return Promise.all([qc.invalidateQueries({ queryKey: keys.workspace(workspace) }), qc.invalidateQueries({ queryKey: keys.workspaces })]);
}

/** Saves a new stack. The name inside the YAML decides the file name. */
export function useCreateStack(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) => api.post<StackSaved>(`/workspaces/${encodeURIComponent(workspace)}/stacks`, { yaml }),
    onSuccess: () => refreshWorkspace(qc, workspace),
  });
}

/** Replaces a stack's file. The name inside must stay the same. */
export function useUpdateStack(workspace: string, stack: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) => api.put<StackSaved>(stackUrl({ workspace, stack }), { yaml }),
    onSuccess: () => refreshWorkspace(qc, workspace),
  });
}

/** Moves a stack's file to the workspace's trash folder. */
export function useDeleteStack(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stack: string) => api.delete<void>(stackUrl({ workspace, stack })),
    onSuccess: () => refreshWorkspace(qc, workspace),
  });
}
