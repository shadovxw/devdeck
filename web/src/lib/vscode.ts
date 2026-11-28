import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

/** The project's .code-workspace as devdeck would write it (GET /workspaces/:id/vscode). */
export type VSCodeFile = {
  path: string;
  content: string;
  /** new: no file yet; same: the file on disk is this one; changed: it differs and would be replaced. */
  state: "new" | "same" | "changed";
};

/** What the file holds, counted from its text: folders and tasks. */
export function fileCounts(content: string): { folders: number; tasks: number } {
  try {
    const f = JSON.parse(content) as { folders?: unknown[]; tasks?: { tasks?: unknown[] } };
    return { folders: f.folders?.length ?? 0, tasks: f.tasks?.tasks?.length ?? 0 };
  } catch {
    return { folders: 0, tasks: 0 };
  }
}

const key = (workspace: string) => ["vscode", workspace];
const path = (workspace: string) => `/workspaces/${encodeURIComponent(workspace)}/vscode`;

export function useVSCodeFile(workspace: string) {
  return useQuery({ queryKey: key(workspace), queryFn: ({ signal }) => api.get<VSCodeFile>(path(workspace), signal) });
}

/** Writes the file; the server only does it with confirm. */
export function useWriteVSCodeFile(workspace: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<VSCodeFile>(path(workspace), { confirm: true }),
    onSuccess: (f) => qc.setQueryData(key(workspace), f),
  });
}
