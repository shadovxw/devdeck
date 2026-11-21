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
  /** Why the last check or download failed. */
  error?: string;
  /** This copy can update itself (an installed release build on Windows); otherwise `not_installable` says why. */
  installable: boolean;
  not_installable?: string;
  /** The version whose installer is downloaded and checked, ready to install. */
  ready?: string;
  /** Stacks running now: installing stops them. */
  running_stacks: number;
  /** Check by itself shortly after start and once a day. */
  auto: boolean;
};

const key = ["update"] as const;

/** The server checks by itself once a day; the page asks for its answer every half hour, so a new release shows without a reload. */
export function useUpdate() {
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api.get<UpdateState>("/update", signal), refetchInterval: 30 * 60_000 });
}

/** Turns the automatic check on or off. */
export function useSetAutoUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (auto: boolean) => api.put<UpdateState>("/update/auto", { auto }),
    onSuccess: (state) => client.setQueryData(key, state),
  });
}

/** Asks GitHub now. A failed check still answers, with `error` set. */
export function useCheckUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UpdateState>("/update/check"),
    onSuccess: (state) => client.setQueryData(key, state),
  });
}

/** Downloads the new installer and checks it against the release's SHA256SUMS. A failure answers with `error` set. */
export function useDownloadUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UpdateState>("/update/download"),
    onSuccess: (state) => client.setQueryData(key, state),
  });
}

/** Starts the installer; devdeck then closes, and the installer opens it again. */
export function useInstallUpdate() {
  return useMutation({ mutationFn: () => api.post<{ status: string }>("/update/install", { confirm: true }) });
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
