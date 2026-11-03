import { CompletionContext } from "@codemirror/autocomplete";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { stateExtensions } from "codemirror-json-schema";
import { yamlCompletion } from "codemirror-json-schema/yaml";
import { describe, expect, it } from "vitest";

import { inlineRefs } from "../../lib/json-schema";
import schema from "../../../../internal/workspace/schemas/workspace.schema.json";

// The suggestions come from the server's own schema, so this checks the library and that schema work together.
// The library suggests once a character has been typed; an empty spot gets nothing.
async function suggest(textWithBar: string): Promise<string[]> {
  const pos = textWithBar.indexOf("|");
  const doc = textWithBar.slice(0, pos) + textWithBar.slice(pos + 1);
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [yaml(), yamlLanguage.data.of({ autocomplete: yamlCompletion() }), stateExtensions(inlineRefs(schema) as never)],
  });
  const source = state.languageDataAt<(c: CompletionContext) => unknown>("autocomplete", pos)[0];
  const result = (await source(new CompletionContext(state, pos, true))) as { options: { label: string }[] } | null;
  return result?.options.map((o) => o.label) ?? [];
}

const head = "version: 1\nname: demo\nroot: ~/code\n";

describe("schema suggestions", () => {
  it("offers the top-level keys while one is typed", async () => {
    expect(await suggest(head + "re|\n")).toContain("repos");
  });
  it("offers the repo keys, local_only among them", async () => {
    expect(await suggest(head + "repos:\n  - id: a\n    path: a\n    loc|\n")).toContain("local_only");
  });
  it("offers the repo types for type:", async () => {
    const got = await suggest(head + "repos:\n  - id: a\n    path: a\n    type: d|\n");
    expect(got).toContain("docker");
  });
});
