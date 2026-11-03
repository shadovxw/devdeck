import { setDiagnostics, type Action, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, Text, type EditorState } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { gutter, GutterMarker, type EditorView } from "@codemirror/view";

import type { Issue, IssueFix } from "../../lib/types";

// The two things the editor draws that CodeMirror doesn't: the problems the server found (as lint
// diagnostics, with their fixes as buttons) and a blue mark beside every line changed since the last save.

/** Where an issue sits in the text: its line, from the first character to the end. Undefined when it has no line. */
export function issueRange(doc: Text, issue: Issue): { from: number; to: number } | undefined {
  if (!issue.line || issue.line < 1) return undefined;
  const line = doc.line(Math.min(issue.line, doc.lines));
  const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
  const from = line.from + (indent < line.length ? indent : 0);
  return { from, to: line.to };
}

/** The server's issues as lint diagnostics. Issues without a line aren't drawn (the problems list still has them). */
export function toDiagnostics(doc: Text, issues: Issue[], onFix: (issue: Issue, fix: IssueFix) => void): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const issue of issues) {
    const range = issueRange(doc, issue);
    if (!range) continue;
    const actions: Action[] = (issue.fixes ?? []).map((fix) => ({ name: fix.label, apply: () => onFix(issue, fix) }));
    out.push({ ...range, severity: issue.severity, message: issue.message, source: "devdeck", actions });
  }
  return out;
}

/** Replaces the diagnostics the editor shows. */
export function showIssues(view: EditorView, issues: Issue[], onFix: (issue: Issue, fix: IssueFix) => void) {
  view.dispatch(setDiagnostics(view.state, toDiagnostics(view.state.doc, issues, onFix)));
}

const setBase = StateEffect.define<Text>();

const baseField = StateField.define<Text>({
  create: () => Text.empty,
  update(base, tr) {
    for (const e of tr.effects) if (e.is(setBase)) return e.value;
    return base;
  },
});

/** The chunks of the current text that differ from the base, kept up to date as the user types. */
const chunksField = StateField.define<readonly Chunk[]>({
  create: () => [],
  update(chunks, tr) {
    const rebase = tr.effects.some((e) => e.is(setBase));
    if (!rebase && !tr.docChanged) return chunks;
    return Chunk.build(tr.state.field(baseField), tr.newDoc);
  },
});

class ChangedMark extends GutterMarker {
  override elementClass = "cm-changed-mark";
}
const mark = new ChangedMark();

function isChanged(state: EditorState, from: number, to: number): boolean {
  return state.field(chunksField).some((c) => (c.toB > c.fromB ? from < c.toB && to >= c.fromB : from <= c.fromB && c.fromB <= to));
}

/** A blue strip beside every line that differs from the base text (the text as last saved). */
export const changedGutter = [
  baseField,
  chunksField,
  gutter({
    class: "cm-changed-gutter",
    lineMarker: (view, line) => (isChanged(view.state, line.from, line.to) ? mark : null),
    lineMarkerChange: (u) => u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setBase))),
    initialSpacer: () => mark,
  }),
];

/** Sets the text the changed marks compare against. */
export function setBaseText(view: EditorView, text: string) {
  view.dispatch({ effects: setBase.of(Text.of(text.split("\n"))) });
}
