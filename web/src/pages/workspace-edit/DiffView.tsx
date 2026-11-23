import { yaml } from "@codemirror/lang-yaml";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { paperMergeTheme, paperTheme } from "./cmTheme";

/** Two versions of a file side by side, with the changes marked and long unchanged stretches folded. Read-only. */
export default function DiffView({ original, modified, originalLabel, modifiedLabel }: Readonly<{ original: string; modified: string; originalLabel: string; modifiedLabel: string }>) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const side = (doc: string) => ({
      doc,
      extensions: [yaml(), paperTheme, paperMergeTheme, EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping],
    });
    const view = new MergeView({
      a: side(original),
      b: side(modified),
      parent: host.current,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 2, minSize: 4 },
    });
    return () => view.destroy();
  }, [original, modified]);

  return (
    <div>
      <div className="mb-1.5 grid grid-cols-2 gap-2 text-[12px] text-ink-3">
        <span>{originalLabel}</span>
        <span>{modifiedLabel}</span>
      </div>
      <div ref={host} className="max-h-[56dvh] overflow-auto bg-bg" />
    </div>
  );
}
