import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import type { Health, Plugin } from "./types";

export const keys = {
  health: ["health"] as const,
  plugins: ["plugins"] as const,
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
