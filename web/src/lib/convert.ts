import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import type { Issue } from "./types";

/** The project.yaml devdeck would write for a project (GET /workspaces/:id/convert). */
export type Conversion = {
  yaml: string;
  /** The stacks/*.yaml files that go inline. */
  modes: string[];
  /** How many databases go in. */
  databases: number;
  issues: Issue[];
};

const path = (workspace: string) => `/workspaces/${encodeURIComponent(workspace)}/convert`;

/** The preview, asked for only once the review is open. */
export function useConversion(workspace: string, open: boolean) {
  return useQuery({
    queryKey: ["workspaces", workspace, "convert"],
    queryFn: ({ signal }) => api.get<Conversion>(path(workspace), signal),
    enabled: open,
    gcTime: 0,
  });
}

/** Writes project.yaml; the server only does it with confirm. Everything about the project is read again. */
export function useConvert(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Conversion>(path(workspace), { confirm: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

/** What the conversion does, in one line: "2 run modes go inline · 1 database". */
export function conversionSummary(c: Conversion): string {
  const modes = c.modes.length === 1 ? "1 run mode goes inline" : `${c.modes.length} run modes go inline`;
  return c.databases > 0 ? `${modes} · ${c.databases === 1 ? "1 database" : `${c.databases} databases`}` : modes;
}
