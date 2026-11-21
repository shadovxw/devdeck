import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

/** GET /api/v1/update: the running version and the newest release, as far as devdeck knows (internal/update). */
export type UpdateState = {
  current: string;
  /** A build without a release version: it never checks. */
  dev: boolean;
  latest?: string;
  available: boolean;
  /** The release's page on GitHub: its notes and downloads. */
  url?: string;
  published_at?: string;
  checked_at?: string;
  /** Why the last check failed. */
  error?: string;
};

const key = ["update"] as const;

export function useUpdate() {
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api.get<UpdateState>("/update", signal) });
}

/** Asks GitHub now. A failed check still answers, with `error` set. */
export function useCheckUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UpdateState>("/update/check"),
    onSuccess: (state) => client.setQueryData(key, state),
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function checkedAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
