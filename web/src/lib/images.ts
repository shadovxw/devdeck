import type { ImageRow } from "./docker";

/** What identifies one image on the page: workspace, repository and image id. */
export const imageKey = (r: Pick<ImageRow, "workspace" | "repo" | "image">) => `${r.workspace}/${r.repo}/${r.image}`;

/** The tag rule the server and Docker Hub share. */
export const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** "412 MB", "88 KB": compressed sizes as Docker Hub reports them. */
export function formatBytes(n: number | undefined): string {
  if (!n || n < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** The equivalent `docker buildx build` for an image and a tag, to read or paste into a terminal. */
export function buildCommand(row: Pick<ImageRow, "path" | "dockerfile" | "context" | "platforms" | "repository" | "secrets">, tag: string): string {
  const quote = (s: string) => (/[\s"']/.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);
  const parts = ["docker buildx build", `--platform ${row.platforms.join(",")}`];
  if (row.dockerfile !== "Dockerfile") parts.push(`-f ${quote(row.dockerfile)}`);
  parts.push(`-t ${row.repository}:${tag || "<tag>"}`);
  for (const s of row.secrets) parts.push(`--secret id=${s.id},env=${s.id.toUpperCase()}`);
  parts.push("--push", quote(row.context));
  return `cd ${quote(row.path)}\n${parts.join(" ")}`;
}

export type ImageFilter = { text: string; chip: "all" | "ahead" | "dirty" | "never" };

export const noImageFilter: ImageFilter = { text: "", chip: "all" };

/** The rows that pass the filter: the text in the names or the branch, and the chosen chip. */
export function filterImages(rows: ImageRow[], f: ImageFilter): ImageRow[] {
  const q = f.text.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && ![r.image, r.repo, r.repository, r.branch ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
    switch (f.chip) {
      case "ahead":
        return (r.ahead ?? 0) > 0;
      case "dirty":
        return r.dirty;
      case "never":
        return !r.last;
      default:
        return true;
    }
  });
}

/** Most commits since the last build first, then by name, so what is worth tagging comes up. */
export function sortImages(rows: ImageRow[]): ImageRow[] {
  return [...rows].sort((a, b) => (b.ahead ?? 0) - (a.ahead ?? 0) || a.image.localeCompare(b.image));
}

/** The four numbers at the top of the page. */
export type ImageSummary = { total: number; upToDate: number; ahead: number; workspaces: number };

/** Up to date: the last build succeeded from the commit checked out now, with nothing uncommitted. */
export function summarize(rows: ImageRow[]): ImageSummary {
  return {
    total: rows.length,
    upToDate: rows.filter((r) => r.last?.ok === true && r.ahead === 0 && !r.dirty).length,
    ahead: rows.filter((r) => (r.ahead ?? 0) > 0).length,
    workspaces: new Set(rows.map((r) => r.workspace_name)).size,
  };
}
