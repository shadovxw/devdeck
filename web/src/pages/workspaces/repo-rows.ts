import type { GitRepo } from "../../lib/git";
import type { Repo } from "../../lib/types";

/** A repo of the workspace file joined with what git says about its folder on this machine. */
export type RepoRow = { repo: Repo; type: string; git?: GitRepo };

export function repoRows(repos: Repo[], git: GitRepo[]): RepoRow[] {
  const byId = new Map(git.map((g) => [g.repo, g]));
  return repos.map((repo) => ({ repo, type: repo.type ?? "other", git: byId.get(repo.id) }));
}

/**
 * The prefix most repo ids share ("acme-" in acme-api, acme-web), so the table can dim it and show what tells
 * them apart. Needs at least three ids and more than half of them behind it; otherwise there is none.
 */
export function sharedPrefix(ids: string[]): string {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const dash = id.indexOf("-");
    if (dash > 0) counts.set(id.slice(0, dash + 1), (counts.get(id.slice(0, dash + 1)) ?? 0) + 1);
  }
  const [prefix, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return ids.length >= 3 && n > ids.length / 2 ? prefix : "";
}

export type GitLabel = { text: string; tone: "clean" | "dirty" | "plain" | "none" };

/** What to say about a repo's working copy: clean, N changed, or how far it is from its upstream. */
export function gitLabel(g: GitRepo | undefined): GitLabel {
  const w = g?.work;
  if (!w) return { text: "no .git", tone: "none" };
  if (w.changed > 0) return { text: `${w.changed} changed`, tone: "dirty" };
  const away = [w.ahead > 0 ? `↑${w.ahead}` : "", w.behind > 0 ? `↓${w.behind}` : ""].filter(Boolean).join(" ");
  return away ? { text: away, tone: "plain" } : { text: "clean", tone: "clean" };
}

export type RepoFilter = { text: string; types: string[]; changed: boolean; behind: boolean };

export const noFilter: RepoFilter = { text: "", types: [], changed: false, behind: false };

/** The rows that pass the filter: text in the id or folder, one of the chosen types, and the toggles. */
export function filterRows(rows: RepoRow[], f: RepoFilter): RepoRow[] {
  const q = f.text.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.repo.id.toLowerCase().includes(q) && !r.repo.path.toLowerCase().includes(q)) return false;
    if (f.types.length > 0 && !f.types.includes(r.type)) return false;
    if (f.changed && (r.git?.work?.changed ?? 0) <= 0) return false;
    if (f.behind && (r.git?.work?.behind ?? 0) <= 0) return false;
    return true;
  });
}
