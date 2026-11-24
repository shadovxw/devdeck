import type { Repo, ScanResult } from "./types";

/** A project's name: lower case letters, digits and dashes, starting with a letter (the file's id rule). */
export const NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** A name made safe from a folder's: "My Shop" → "my-shop". */
export function nameFrom(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .replace(/-$/, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return s || "project";
}

/** The folder as the scan wrote it in its draft (~/code), else the absolute path. */
export function rootOf(scan: Pick<ScanResult, "root" | "yaml">): string {
  return /^root:\s*(.+)$/m.exec(scan.yaml)?.[1].trim() ?? scan.root;
}

/** A YAML value: plain when that is safe, else double-quoted (JSON's quoting is valid YAML). */
export function yamlValue(v: string): string {
  return /^[A-Za-z0-9_~./@][A-Za-z0-9_ ~./@+-]*$/.test(v) && !v.endsWith(" ") ? v : JSON.stringify(v);
}

/**
 * The project's file from what was found and ticked (dev-plans/2026-11-22-projects §4.2): its
 * name, the folder, and the chosen repos with their type and remote. The same shape the scan
 * drafts, so it reads the same in the editor afterwards.
 */
export function projectYaml(o: { name: string; root: string; repos: Repo[] }): string {
  const lines = [`# Made by devdeck from ${o.root}. Edit freely.`, "version: 1", `name: ${yamlValue(o.name)}`, `root: ${yamlValue(o.root)}`];
  if (o.repos.length > 0) {
    lines.push("repos:");
    for (const r of o.repos) {
      lines.push(`  - id: ${yamlValue(r.id)}`, `    path: ${yamlValue(r.path)}`);
      if (r.type) lines.push(`    type: ${yamlValue(r.type)}`);
      if (r.remote) lines.push(`    remote: ${yamlValue(r.remote)}`);
    }
  }
  return lines.join("\n") + "\n";
}
