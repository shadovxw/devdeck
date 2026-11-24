import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

/** A database of a project (GET /workspaces/:id/databases). Never a password. */
export type ProjectDatabase = {
  id: string;
  engine: "postgres" | "mysql" | "redis" | "mongo";
  /** compose: a service in a compose file; env: only a .env points at it. */
  from: "compose" | "env";
  where: string;
  host: string;
  port: number;
  name?: string;
  used_by: string[];
  /** up or down on this machine; unknown on another host (not checked). */
  status: "up" | "down" | "unknown";
};

export type DatabaseReport = { databases: ProjectDatabase[]; warnings: Array<{ repo?: string; message: string }> };

/** How an engine is written on a card. */
export const ENGINE: Record<ProjectDatabase["engine"], string> = { postgres: "Postgres", mysql: "MySQL", redis: "Redis", mongo: "MongoDB" };

/** Who uses it, in words: "api, worker", "shared by 3 repos", "nothing points at it". */
export function usedByText(usedBy: string[]): string {
  if (usedBy.length === 0) return "nothing points at it";
  if (usedBy.length > 3) return `shared by ${usedBy.length} repos`;
  return usedBy.join(", ");
}

export function useProjectDatabases(workspace: string) {
  return useQuery({
    queryKey: ["databases", workspace],
    queryFn: ({ signal }) => api.get<DatabaseReport>(`/workspaces/${encodeURIComponent(workspace)}/databases`, signal),
    refetchInterval: 15_000, // up and down follow the stacks
  });
}
