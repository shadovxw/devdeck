import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// The editor takes its colours from the Paper tokens, so every theme (light, dark, a custom one) reaches it
// without a second palette. Flat: no borders or shadows, tight radii.

const mono = "var(--font-mono)";

const base = EditorView.theme({
  "&": { color: "var(--ink)", backgroundColor: "var(--bg)", fontSize: "12.5px", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: mono, lineHeight: "20px", overflow: "auto" },
  ".cm-content": { caretColor: "var(--ink)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
  ".cm-line": { padding: "0 12px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fill) 70%, transparent)" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--ink-3)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "32px", fontSize: "11.5px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer", color: "var(--ink-3)" },
  ".cm-changed-gutter": { width: "3px", marginRight: "2px" },
  ".cm-changed-mark": { backgroundColor: "var(--accent)", width: "3px", height: "100%" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--fill)", border: "none", color: "var(--ink-3)", padding: "0 6px", borderRadius: "3px" },
  ".cm-matchingBracket": { backgroundColor: "var(--fill-hover)", outline: "none" },

  // Problems: an amber wavy line under the text, the message and its fixes in a flat tooltip.
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warning)",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1px",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--critical)",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1px",
  },
  ".cm-lintRange-active": { backgroundColor: "color-mix(in srgb, var(--warning) 14%, transparent)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface-float)",
    color: "var(--ink)",
    border: "none",
    borderRadius: "4px",
    boxShadow: "none",
    outline: "1px solid var(--line-strong)",
    fontFamily: "var(--font-sans)",
    fontSize: "12.5px",
  },
  ".cm-tooltip-lint, .cm-tooltip-hover": { padding: "2px 0" },
  ".cm-diagnostic": { padding: "6px 10px", borderLeft: "none", marginLeft: "0" },
  ".cm-diagnostic-warning": { borderLeft: "none" },
  ".cm-diagnostic-error": { borderLeft: "none" },
  ".cm-diagnosticAction": {
    backgroundColor: "var(--fill)",
    color: "var(--ink)",
    borderRadius: "3px",
    padding: "2px 8px",
    margin: "6px 6px 0 0",
    font: "inherit",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".cm-diagnosticAction:hover": { backgroundColor: "var(--fill-hover)" },
  ".cm-tooltip-autocomplete": { fontFamily: mono },
  ".cm-tooltip-autocomplete > ul > li": { padding: "2px 10px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--selected)", color: "var(--ink)" },
  ".cm-completionDetail": { color: "var(--ink-3)", marginLeft: "1em", fontStyle: "normal" },
  ".cm-completionInfo": { padding: "6px 10px", maxWidth: "320px", fontFamily: "var(--font-sans)" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700", color: "var(--ink)" },
  ".cm-panels": { backgroundColor: "var(--surface-1)", color: "var(--ink)" },
});

// Paper is monochrome, so the syntax is told apart by weight and tone, not by hue: keys are bold, values plain,
// numbers and booleans take the accent (which a custom theme can colour), punctuation and comments step back.
const highlight = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName], color: "var(--ink)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "var(--ink-2)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--accent)" },
  { tag: [t.lineComment, t.comment], color: "var(--ink-3)", fontStyle: "italic" },
  { tag: [t.separator, t.punctuation, t.squareBracket, t.brace], color: "var(--ink-3)" },
  { tag: [t.meta, t.keyword, t.labelName, t.typeName], color: "var(--ink-3)", fontWeight: "600" },
  { tag: t.content, color: "var(--ink-2)" },
]);

/** The Paper look for the editor and for the diff in the review dialog. */
export const paperTheme = [base, syntaxHighlighting(highlight)];

/** Extra rules for the side-by-side diff: flat bands, tokens for added and removed text. */
export const paperMergeTheme = EditorView.theme({
  ".cm-changedLine, .cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--good) 10%, transparent)" },
  ".cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--critical) 10%, transparent)", paddingLeft: "6px" },
  ".cm-insertedLine, .cm-changedText": { backgroundColor: "color-mix(in srgb, var(--good) 22%, transparent)" },
  ".cm-deletedLine, .cm-deletedText": { backgroundColor: "color-mix(in srgb, var(--critical) 22%, transparent)" },
  ".cm-collapsedLines": { backgroundColor: "var(--fill)", color: "var(--ink-3)", cursor: "pointer" },
  ".cm-merge-gap": { backgroundColor: "var(--fill)" },
});
