import { describe, expect, it } from "vitest";

import { applyInput, patternOfText, tokensOf, withoutToken } from "./log-tokens";

describe("applyInput", () => {
  it.each([
    ["service:api", {}, { services: ["api"] }],
    ["service:api", { services: ["api"] }, { services: ["api"] }],
    ["user.id:42", {}, { fields: ["user.id=42"] }],
    ["user.id=42", {}, { fields: ["user.id=42"] }],
    ["-user.id:42", {}, { fields: ["user.id!=42"] }],
    ["status!=200", {}, { fields: ["status!=200"] }],
    ["/time(out|d out)/", {}, { regex: "time(out|d out)" }],
    ["db timeout", {}, { regex: "(?i)db timeout" }],
    ["a.b (c)", {}, { regex: "(?i)a\\.b \\(c\\)" }],
  ])("reads %s", (input, from, expected) => {
    expect(applyInput(from, input)).toMatchObject({ query: expected });
  });

  it("does nothing for an empty line, and refuses a pattern that does not compile", () => {
    expect(applyInput({ regex: "x" }, "  ")).toEqual({ query: { regex: "x" } });
    expect(applyInput({}, "/(/")).toEqual({ error: "This isn’t a valid pattern." });
  });

  it("keeps only one search text", () => {
    expect(applyInput({ regex: "(?i)old" }, "new")).toEqual({ query: { regex: "(?i)new" } });
  });
});

describe("tokensOf and withoutToken", () => {
  const q = { services: ["api"], fields: ["user.id=42", "status!=200"], regex: patternOfText("db timeout"), group: "abc", until: "2026-10-31T10:00:00Z" };

  it("lists every filter, with plain text shown as typed", () => {
    const tokens = tokensOf(q);
    expect(tokens.map((t) => `${t.key}${t.value}`.replace(/Until .*/, "Until"))).toEqual(["service:api", "user.id:42", "-status:200", "db timeout", "One kind of error", "Until"]);
    expect(tokens[2].not).toBe(true);
    expect(tokensOf({ regex: "a|b" })[0].value).toBe("/a|b/");
  });

  it("removes one token and leaves the others", () => {
    const [service, field] = tokensOf(q);
    expect(withoutToken(q, service).services).toEqual([]);
    expect(withoutToken(q, field).fields).toEqual(["status!=200"]);
    const text = tokensOf(q).find((t) => t.kind === "text")!;
    expect(withoutToken(q, text).regex).toBeUndefined();
  });
});
