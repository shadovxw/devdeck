/** A link that opens a folder or a file in VS Code. */
export const vscodeFolder = (path: string) => `vscode://file/${encodeURI(path.replaceAll("\\", "/")).replace(/^\/+/, "")}`;

/** A repo's folder in VS Code: the project's root joined with the repo's path ("." or "" is the root). */
export function vscodeRepo(root: string, path: string): string {
  const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const rel = path.replaceAll("\\", "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  return vscodeFolder(rel === "" || rel === "." ? base : `${base}/${rel}`);
}
