import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./api";
import { logQueryString, type LogQuery, type SavedLogFilter } from "./log-query";
import type { LogGroup, LogHistogram } from "./types";

const stackUrl = (workspace: string, stack: string) => `/workspaces/${encodeURIComponent(workspace)}/stacks/${encodeURIComponent(stack)}/logs`;
const filtersUrl = (workspace: string) => `/workspaces/${encodeURIComponent(workspace)}/log-filters`;

/** How often the error groups and the histogram are asked for again while the view is live. */
const refreshMs = 5000;

/** The kinds of error seen in a stack, the latest first. */
export function useLogGroups(workspace: string, stack: string, enabled: boolean, live: boolean) {
  return useQuery({
    queryKey: ["log-groups", workspace, stack],
    queryFn: ({ signal }) => api.get<LogGroup[]>(`${stackUrl(workspace, stack)}/groups`, signal),
    enabled,
    refetchInterval: live ? refreshMs : false,
  });
}

/** Counts of entries by level and time under a query (paging does not apply). */
export function useLogHistogram(workspace: string, stack: string, query: LogQuery, enabled: boolean, live: boolean) {
  const qs = logQueryString({ ...query, before: undefined, after: undefined, limit: undefined });
  return useQuery({
    queryKey: ["log-histogram", workspace, stack, qs],
    queryFn: ({ signal }) => api.get<LogHistogram>(`${stackUrl(workspace, stack)}/histogram?${qs}`, signal),
    enabled,
    refetchInterval: live ? refreshMs : false,
    placeholderData: (previous) => previous,
  });
}

/** The filters saved with a workspace. */
export function useSavedFilters(workspace: string) {
  return useQuery({
    queryKey: ["log-filters", workspace],
    queryFn: ({ signal }) => api.get<SavedLogFilter[]>(filtersUrl(workspace), signal),
    enabled: workspace !== "",
  });
}

export function useSaveFilter(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: SavedLogFilter) => api.put<SavedLogFilter>(`${filtersUrl(workspace)}/${encodeURIComponent(f.id)}`, f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["log-filters", workspace] }),
  });
}

export function useDeleteFilter(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`${filtersUrl(workspace)}/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["log-filters", workspace] }),
  });
}

/** Deletes what is stored of a stack, or of one service. */
export function useClearLogs(workspace: string, stack: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (service?: string) => api.delete<{ removed_files: number }>(`${stackUrl(workspace, stack)}${service ? `?service=${encodeURIComponent(service)}` : ""}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["log-groups", workspace, stack] });
      void qc.invalidateQueries({ queryKey: ["log-histogram", workspace, stack] });
    },
  });
}

export type Where = { file: string; line: number };

/**
 * Where in the service's repo a line came from, when its caller names a file that
 * exists there. Undefined while looking and when there is no such file.
 */
export function useWhere(workspace: string, stack: string, service: string, caller: string | undefined) {
  return useQuery({
    queryKey: ["log-where", workspace, stack, service, caller],
    queryFn: async ({ signal }) => {
      const q = new URLSearchParams({ service, caller: caller ?? "" });
      try {
        return await api.get<Where>(`${stackUrl(workspace, stack)}/where?${q}`, signal);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null; // no such file: not an error
        throw err;
      }
    },
    enabled: !!caller,
    retry: false,
    staleTime: 60_000,
  });
}
