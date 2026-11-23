import { CompletionContext } from "@codemirror/autocomplete";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { stateExtensions } from "codemirror-json-schema";
import { yamlCompletion } from "codemirror-json-schema/yaml";
import { describe, expect, it, vi } from "vitest";

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

// The library resolves the schema on first use, which can take a moment on a busy machine, so a test asks until it answers.
const offers = (text: string, label: string) => vi.waitFor(async () => expect(await suggest(text)).toContain(label), { timeout: 5000 });

describe("schema suggestions", () => {
  it("offers the top-level keys while one is typed", async () => {
    await offers(head + "re|\n", "repos");
  });
  it("offers the repo keys, local_only among them", async () => {
    await offers(head + "repos:\n  - id: a\n    path: a\n    loc|\n", "local_only");
  });
  it("offers the repo types for type:", async () => {
    await offers(head + "repos:\n  - id: a\n    path: a\n    type: d|\n", "docker");
  });
});
