import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

/** An account the GitHub CLI is signed in to. There is never a token in any of these types. */
export type GhAccount = { login: string; active: boolean; scopes: string[]; token_source: string };

export type GitConnection = { id: string; gh_user: string; name?: string; email?: string };

/** A rule: repositories matching `match` (github.com/owner/repo, github.com/owner/* or github.com/*) use `connection`. */
export type GitRule = { match: string; connection: string };

export type GitConfig = { connections: GitConnection[]; rules: GitRule[] };

export type GitOverview = {
  gh_installed: boolean;
  gh_path?: string;
  accounts: GhAccount[];
  connections: (GitConnection & { signed_in: boolean })[];
  rules: GitRule[];
  accounts_error?: string;
};

/** What a connection's token can do on GitHub. */
export type GitCheck = { login: string; scopes: string[] | null; orgs: string[] | null; orgs_note?: string };

export type GitSetup = {
  git_found: boolean;
  applied: boolean;
  helper: string;
  commands: string[];
  current_helpers: string[];
  general_helpers: string[];
  use_http_path: string;
  can_undo: boolean;
};

export type RepoState = "ok" | "wrong-identity" | "no-rule" | "no-remote" | "missing" | "other-host";

export type GitRepo = {
  workspace: string;
  workspace_name: string;
  repo: string;
  path: string;
  remote: string;
  connection?: string;
  expected: { name: string; email: string };
  actual: { name: string; email: string };
  state: RepoState;
};

const keys = { git: ["git"] as const, setup: ["git", "setup"] as const, repos: ["git", "repos"] as const };

export function useGit() {
  return useQuery({ queryKey: keys.git, queryFn: ({ signal }) => api.get<GitOverview>("/git", signal) });
}

/** Saves the connections and the rules together; the server checks them and answers with the new overview. */
export function useSaveGitConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: GitConfig) => api.put<GitOverview>("/git/config", cfg),
    onSuccess: (overview) => {
      qc.setQueryData(keys.git, overview);
      void qc.invalidateQueries({ queryKey: keys.repos });
    },
  });
}

/** Asks GitHub, as the connection's account, who it is and what its token may do. */
export function useCheckConnection() {
  return useMutation({ mutationFn: (id: string) => api.post<GitCheck>(`/git/connections/${encodeURIComponent(id)}/check`) });
}

/** Which connection a repository address would use ("" while there is nothing to ask about). */
export function useMatch(remote: string) {
  return useQuery({
    queryKey: ["git", "match", remote],
    queryFn: ({ signal }) => api.get<{ matched: boolean; connection?: string }>(`/git/match?remote=${encodeURIComponent(remote)}`, signal),
    enabled: remote.trim() !== "",
    retry: false,
  });
}

export function useGitSetup() {
  return useQuery({ queryKey: keys.setup, queryFn: ({ signal }) => api.get<GitSetup>("/git/setup", signal) });
}

/** Registers (or takes out) devdeck as git's credential helper. Always sent with the confirmation. */
export function useChangeSetup(action: "apply" | "undo") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<GitSetup>(`/git/setup/${action}`, { confirm: true }),
    onSuccess: (state) => qc.setQueryData(keys.setup, state),
  });
}

export function useGitRepos() {
  return useQuery({ queryKey: keys.repos, queryFn: ({ signal }) => api.get<GitRepo[]>("/git/repos", signal) });
}

/** Writes the connection's name and email into one repository's own git config. */
export function useFixIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: { workspace: string; repo: string }) => api.post<GitRepo>("/git/repos/identity", r),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.repos }),
  });
}
