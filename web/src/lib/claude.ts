import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

/** One switch of the Claude access page: a part of devdeck that Claude Code may read, or not. */
export type ClaudeArea = { id: string; label: string; description: string; on: boolean; default: boolean };

export type ClaudeState = {
  areas: ClaudeArea[];
  /** When the connector last asked for anything; absent if it never has. */
  last_call?: string;
  /** How many requests the audit list holds. */
  calls: number;
};

/** One request Claude Code's connector made: what it asked for, never the answer. */
export type ClaudeCall = {
  id: number;
  at: string;
  tool?: string;
  method: string;
  path: string;
  query?: string;
  status: number;
  bytes: number;
};

const keys = {
  state: ["claude"] as const,
  calls: ["claude", "calls"] as const,
};

export function useClaude() {
  return useQuery({ queryKey: keys.state, queryFn: ({ signal }) => api.get<ClaudeState>("/claude", signal), refetchInterval: 5_000 });
}

export function useClaudeCalls() {
  return useQuery({ queryKey: keys.calls, queryFn: ({ signal }) => api.get<ClaudeCall[]>("/claude/calls?limit=100", signal), refetchInterval: 5_000 });
}

/** Switches areas on or off, for example {hosts: true}. The others stay as they are. */
export function useSetClaudeAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: Record<string, boolean>) => api.put<ClaudeState>("/claude/access", on),
    onSuccess: (state) => qc.setQueryData(keys.state, state),
  });
}

export function useClearClaudeCalls() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>("/claude/calls"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.state }),
  });
}

/** What a request's status means, in a word the table can show next to the number. */
export function callResult(status: number): string {
  if (status >= 200 && status < 300) return "Answered";
  if (status === 403) return "Refused";
  if (status === 409) return "Not ready";
  return "Error";
}

export { ago } from "./time";
