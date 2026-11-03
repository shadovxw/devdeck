import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type YAMLMap } from "yaml";

// Reading and editing workspace.yaml as text. Edits go through the yaml Document, which keeps comments,
// blank lines and the order of keys, so the Form view and the quick fixes never reformat the user's file.

export type RepoNode = {
  index: number;
  id: string;
  path: string;
  type?: string;
  remote?: string;
  localOnly: boolean;
  /** 1-based first and last line of the repo's block. */
  from: number;
  to: number;
};

export type Section = { key: string; line: number };

export type Outline = { sections: Section[]; repos: RepoNode[] };

type Parsed = { doc: Document.Parsed; lines: LineCounter };

function parse(text: string): Parsed {
  const lines = new LineCounter();
  return { doc: parseDocument(text, { lineCounter: lines, keepSourceTokens: false }), lines };
}

function str(map: YAMLMap, key: string): string | undefined {
  const v = map.get(key);
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

/** The top-level keys and the repos of a workspace.yaml, with their lines. Tolerates text that doesn't parse. */
export function outline(text: string): Outline {
  const { doc, lines } = parse(text);
  const out: Outline = { sections: [], repos: [] };
  const root = doc.contents;
  if (!isMap(root)) return out;
  for (const pair of root.items) {
    if (isScalar(pair.key) && pair.key.range) out.sections.push({ key: String(pair.key.value), line: lines.linePos(pair.key.range[0]).line });
  }
  const repos = root.get("repos", true);
  if (!isSeq(repos)) return out;
  repos.items.forEach((item, index) => {
    if (!isMap(item) || !item.range) return;
    const from = lines.linePos(item.range[0]).line;
    // range[1] is the end of the value; the last line is the one that holds its final character
    const to = lines.linePos(Math.max(item.range[0], item.range[1] - 1)).line;
    out.repos.push({
      index,
      id: str(item, "id") ?? "",
      path: str(item, "path") ?? "",
      type: str(item, "type"),
      remote: str(item, "remote"),
      localOnly: item.get("local_only") === true,
      from,
      to,
    });
  });
  return out;
}

/** The repo whose block holds a 1-based line, if any. */
export function repoAtLine(o: Outline, line: number): RepoNode | undefined {
  return o.repos.find((r) => line >= r.from && line <= r.to);
}

/** The section (top-level key) a 1-based line falls under. */
export function sectionAtLine(o: Outline, line: number): Section | undefined {
  let found: Section | undefined;
  for (const s of o.sections) if (s.line <= line) found = s;
  return found;
}

/** The index in `repos` an issue path like "/repos/1/path" points at. */
export function repoIndexOfPath(path: string | undefined): number | undefined {
  const m = /^\/repos\/(\d+)(?:\/|$)/.exec(path ?? "");
  return m ? Number(m[1]) : undefined;
}

function dump(doc: Document): string {
  return doc.toString({ lineWidth: 0 });
}

/** Sets a top-level scalar (name, description, root). An empty value removes the key. */
export function setTopLevel(text: string, key: string, value: string): string {
  const { doc } = parse(text);
  if (value === "") doc.delete(key);
  else doc.set(key, value);
  return dump(doc);
}

/** Sets a field of the repo at `index`. An empty value (or false) removes the key. */
export function setRepoField(text: string, index: number, key: string, value: string | boolean): string {
  const { doc } = parse(text);
  const repo = doc.getIn(["repos", index], true);
  if (!isMap(repo)) return text;
  if (value === "" || value === false) repo.delete(key);
  else repo.set(key, value);
  return dump(doc);
}

/** The quick fix for "isn't a git repository": local_only: true on that repo. */
export function markLocalOnly(text: string, index: number): string {
  return setRepoField(text, index, "local_only", true);
}

/** Appends a repo with a path and an id taken from its folder name. */
export function addRepo(text: string, path = ""): string {
  const { doc } = parse(text);
  const seq = doc.get("repos", true);
  const id = idFromPath(path);
  const item = doc.createNode({ id, path });
  if (isSeq(seq)) seq.add(item);
  else doc.set("repos", doc.createNode([{ id, path }]));
  return dump(doc);
}

export function removeRepo(text: string, index: number): string {
  const { doc } = parse(text);
  const seq = doc.get("repos", true);
  if (!isSeq(seq) || index < 0 || index >= seq.items.length) return text;
  seq.items.splice(index, 1);
  return dump(doc);
}

/** "services/api" → "api"; the id the user would type anyway. */
export function idFromPath(path: string): string {
  const last = path.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
  return last.toLowerCase().replaceAll(/[^a-z0-9-]+/g, "-").replaceAll(/^-+|-+$/g, "");
}

/** What the Form view shows. Missing or odd values come back empty rather than throwing. */
export type FormValues = { name: string; description: string; root: string; repos: RepoNode[]; ok: boolean };

export function formValues(text: string): FormValues {
  const { doc } = parse(text);
  const root = doc.contents;
  if (!isMap(root) || doc.errors.length > 0) return { name: "", description: "", root: "", repos: [], ok: false };
  return {
    name: str(root, "name") ?? "",
    description: str(root, "description") ?? "",
    root: str(root, "root") ?? "",
    repos: outline(text).repos,
    ok: true,
  };
}

/** Whether the text is a YAML document at all (a syntax error shows in the header before the server answers). */
export function yamlErrors(text: string): Array<{ line: number; message: string }> {
  const { doc, lines } = parse(text);
  return doc.errors.map((e) => ({ line: lines.linePos(e.pos[0]).line, message: e.message.split("\n")[0] }));
}
