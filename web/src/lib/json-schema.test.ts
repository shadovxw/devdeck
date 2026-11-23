import { describe, expect, it } from "vitest";

import { inlineRefs } from "./json-schema";

describe("inlineRefs", () => {
  it("replaces a local reference with its target and keeps the keywords beside it", () => {
    const out = inlineRefs({
      type: "object",
      properties: { name: { $ref: "#/$defs/id", description: "The name" }, list: { type: "array", items: { $ref: "#/$defs/id" } } },
      $defs: { id: { type: "string", pattern: "^[a-z]+$", description: "An id" } },
    });
    expect(out.properties).toEqual({
      name: { type: "string", pattern: "^[a-z]+$", description: "The name" },
      list: { type: "array", items: { type: "string", pattern: "^[a-z]+$", description: "An id" } },
    });
  });

  it("follows a reference to a reference", () => {
    const out = inlineRefs({ properties: { a: { $ref: "#/$defs/b" } }, $defs: { b: { $ref: "#/$defs/c" }, c: { enum: ["x"] } } });
    expect(out.properties).toEqual({ a: { enum: ["x"] } });
  });

  it("leaves a recursive reference alone instead of looping", () => {
    const out = inlineRefs({ $ref: "#/$defs/node", $defs: { node: { properties: { child: { $ref: "#/$defs/node" } } } } });
    expect(out.properties).toEqual({ child: { $ref: "#/$defs/node" } });
  });

  it("leaves references it can't resolve, and other values, as they are", () => {
    const schema = { properties: { a: { $ref: "#/$defs/missing" }, b: { $ref: "https://example.com/x.json" }, c: { enum: [1, "two", null] } } };
    expect(inlineRefs(schema)).toEqual(schema);
  });
});
