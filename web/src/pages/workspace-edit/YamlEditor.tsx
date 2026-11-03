import { yamlLanguage, yaml } from "@codemirror/lang-yaml";
import { linter } from "@codemirror/lint";
import { Compartment, Prec } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, type ViewUpdate } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { stateExtensions, updateSchema } from "codemirror-json-schema";
import { yamlCompletion, yamlSchemaHover } from "codemirror-json-schema/yaml";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

import { inlineRefs } from "../../lib/json-schema";
import type { Issue, IssueFix } from "../../lib/types";
import { paperTheme } from "./cmTheme";
import { changedGutter, setBaseText, showIssues } from "./cmExtensions";

export type EditorHandle = {
  goToLine: (line: number) => void;
  focus: () => void;
};

export type Cursor = { line: number; col: number };

type Props = {
  value: string;
  onChange: (text: string) => void;
  /** The text as last saved: lines that differ from it get a blue mark. */
  baseText: string;
  /** Problems with a line; they are underlined, and their fixes show on hover. */
  issues: Issue[];
  /** workspace.yaml's JSON Schema: suggestions while typing and notes on hover. */
  schema?: Record<string, unknown>;
  onCursor: (cursor: Cursor) => void;
  onFix: (issue: Issue, fix: IssueFix) => void;
  onSave: () => void;
  readOnly?: boolean;
  /** A line to scroll to and put the cursor on when the editor opens (a link from the Problems tab). */
  initialLine?: number;
  ref?: Ref<EditorHandle>;
};

type SchemaArg = NonNullable<Parameters<typeof updateSchema>[1]>;

/**
 * The YAML editor: highlighting, folding, line numbers, suggestions from the schema, the server's problems
 * underlined with their fixes, and a blue mark beside what changed since the last save. Loaded lazily,
 * because CodeMirror is the biggest thing in the app.
 */
export default function YamlEditor({ value, onChange, baseText, issues, schema, onCursor, onFix, onSave, readOnly, initialLine, ref }: Readonly<Props>) {
  const cm = useRef<ReactCodeMirrorRef>(null);
  // The view exists only after the first render; what depends on it waits for it, whatever order things arrive in.
  const [view, setView] = useState<EditorView | null>(null);
  // The extensions are made once; what changes (the save handler, the fixes) is read through refs.
  const latest = useRef({ onFix, onCursor });
  useEffect(() => {
    latest.current = { onFix, onCursor };
  });
  // The save shortcut calls whichever onSave the page passed last, so it lives in a compartment.
  const saveKeys = useMemo(() => new Compartment(), []);
  const saveKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSave();
              return true;
            },
          },
        ]),
      ),
    [onSave],
  );

  const extensions = useMemo(
    () => [
      yaml(),
      yamlLanguage.data.of({ autocomplete: yamlCompletion() }),
      hoverTooltip(yamlSchemaHover()),
      stateExtensions(),
      linter(null),
      changedGutter,
      paperTheme,
      EditorView.lineWrapping,
      saveKeys.of([]),
    ],
    [saveKeys],
  );

  const fix = useCallback((issue: Issue, f: IssueFix) => latest.current.onFix(issue, f), []);

  // The problems, redrawn when they change.
  useEffect(() => {
    if (view) showIssues(view, issues, fix);
  }, [view, issues, fix]);

  useEffect(() => {
    view?.dispatch({ effects: saveKeys.reconfigure(saveKeymap) });
  }, [view, saveKeys, saveKeymap]);

  useEffect(() => {
    if (view) setBaseText(view, baseText);
  }, [view, baseText]);

  // The suggestion library needs the schema without its $refs to offer a property's values.
  const flat = useMemo(() => (schema ? inlineRefs(schema) : undefined), [schema]);
  useEffect(() => {
    if (view && flat) updateSchema(view, flat as SchemaArg);
  }, [view, flat]);

  const goTo = useCallback((v: EditorView, line: number) => {
    const at = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
    v.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
    v.focus();
  }, []);

  const arrived = useRef(false);
  useEffect(() => {
    if (view && initialLine && !arrived.current) {
      arrived.current = true;
      goTo(view, initialLine);
    }
  }, [view, initialLine, goTo]);

  useImperativeHandle(
    ref,
    () => ({
      goToLine(line) {
        const v = cm.current?.view;
        if (v) goTo(v, line);
      },
      focus: () => cm.current?.view?.focus(),
    }),
    [goTo],
  );

  return (
    <CodeMirror
      ref={cm}
      value={value}
      height="100%"
      theme="none"
      editable={!readOnly}
      extensions={extensions}
      basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true, autocompletion: true, searchKeymap: true }}
      onChange={onChange}
      onCreateEditor={setView}
      onUpdate={(u: ViewUpdate) => {
        if (!u.selectionSet && !u.docChanged) return;
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        latest.current.onCursor({ line: line.number, col: head - line.from + 1 });
      }}
      aria-label="workspace.yaml"
      style={{ height: "100%", minHeight: 0 }}
    />
  );
}
