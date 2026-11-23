import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Issue } from "../../lib/types";
import { changedGutter, issueRange, setBaseText, showIssues, toDiagnostics } from "./cmExtensions";
import DiffView from "./DiffView";
import YamlEditor, { type EditorHandle } from "./YamlEditor";

// jsdom has no layout. CodeMirror measures text with these, so they get empty answers.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  document.elementFromPoint = () => null;
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren(); // the editors mounted by hand
});

const TEXT = "version: 1\nname: demo\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n";
const warn = (over: Partial<Issue> = {}): Issue => ({ file: "workspace.yaml", severity: "warning", message: "Careful.", line: 6, ...over });

describe("problems as diagnostics", () => {
  const doc = Text.of(TEXT.split("\n"));

  it("puts an issue on its line, from the first character to the end", () => {
    expect(issueRange(doc, warn({ line: 6 }))).toEqual({ from: doc.line(6).from + 4, to: doc.line(6).to });
    expect(issueRange(doc, warn({ line: 1 }))).toEqual({ from: 0, to: doc.line(1).to });
    expect(issueRange(doc, warn({ line: 999 }))?.to).toBe(doc.line(doc.lines).to); // past the end: the last line
  });

  it("leaves out an issue with no line", () => {
    expect(issueRange(doc, warn({ line: undefined }))).toBeUndefined();
    expect(issueRange(doc, warn({ line: 0 }))).toBeUndefined();
    expect(toDiagnostics(doc, [warn({ line: undefined })], () => {})).toEqual([]);
  });

  it("carries the message, the severity and a button for each fix that calls back with the issue", () => {
    const onFix = vi.fn();
    const issue = warn({ severity: "error", fixes: [{ id: "mark-local-only", label: "Mark local_only: true", kind: "edit" }] });
    const [d] = toDiagnostics(doc, [issue], onFix);
    expect(d).toMatchObject({ severity: "error", message: "Careful.", source: "devdeck" });
    expect(d.actions?.map((a) => a.name)).toEqual(["Mark local_only: true"]);
    d.actions?.[0].apply({} as EditorView, 0, 0);
    expect(onFix).toHaveBeenCalledWith(issue, issue.fixes?.[0]);
  });
});

describe("the changed-lines gutter and diagnostics in a real editor", () => {
  function mount() {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc: TEXT, extensions: [changedGutter] }) });
    return view;
  }

  it("marks lines that differ from the base text, and follows the edits", async () => {
    const view = mount();
    const marks = () => view.dom.querySelectorAll(".cm-changed-mark").length;
    setBaseText(view, TEXT);
    const none = marks(); // the gutter keeps one hidden element to size itself

    view.dispatch({ changes: { from: 0, to: 0, insert: "# note\n" } });
    await waitFor(() => expect(marks()).toBeGreaterThan(none));

    setBaseText(view, view.state.doc.toString()); // saved: nothing differs any more
    await waitFor(() => expect(marks()).toBe(none));
    view.destroy();
  });

  it("sets the diagnostics it is given", () => {
    const view = mount();
    expect(() => showIssues(view, [warn()], () => {})).not.toThrow(); // no lint extension: the effect is ignored, not fatal
    view.destroy();
  });
});

describe("the YAML editor", () => {
  const props = { baseText: TEXT, issues: [] as Issue[], onCursor: () => {}, onFix: () => {}, onSave: () => {} };

  it("shows the text, reports edits, the cursor and the save shortcut, and marks problems", async () => {
    const onChange = vi.fn();
    const onCursor = vi.fn();
    const onSave = vi.fn();
    const handle = createRef<EditorHandle>();
    render(<YamlEditor {...props} ref={handle} value={TEXT} onChange={onChange} onCursor={onCursor} onSave={onSave} issues={[warn()]} initialLine={5} schema={{ type: "object" }} />);

    const label = await screen.findByLabelText("workspace.yaml");
    expect(label.textContent).toContain("name: demo");
    await waitFor(() => expect(document.querySelector(".cm-lintRange-warning")).not.toBeNull());

    // the initial line puts the cursor there
    await waitFor(() => expect(onCursor).toHaveBeenCalledWith({ line: 5, col: 1 }));
    handle.current?.goToLine(2);
    await waitFor(() => expect(onCursor).toHaveBeenLastCalledWith({ line: 2, col: 1 }));
    handle.current?.goToLine(999); // past the end: the last line
    handle.current?.focus();

    // Ctrl+S asks to save and is not left to the browser
    const content = document.querySelector(".cm-content") as HTMLElement;
    const key = new KeyboardEvent("keydown", { key: "s", code: "KeyS", keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true });
    content.dispatchEvent(key);
    expect(onSave).toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(true);
  });

  it("is read-only when asked", async () => {
    render(<YamlEditor {...props} value={TEXT} onChange={() => {}} readOnly />);
    await screen.findByLabelText("workspace.yaml");
    await waitFor(() => expect(document.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false"));
  });
});

describe("the diff", () => {
  it("shows both versions with their labels", async () => {
    const { container } = render(<DiffView original={"a: 1\nb: 2\n"} modified={"a: 1\nb: 3\n"} originalLabel="Saved" modifiedLabel="Your edits" />);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Your edits")).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".cm-editor")).toHaveLength(2));
    expect(container.textContent).toContain("b: 3");
  });
});
