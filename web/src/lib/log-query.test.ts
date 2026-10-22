import { describe, expect, it } from "vitest";

import { logQueryString, queryOfFilter } from "./log-query";

describe("logQueryString", () => {
  it("is empty when nothing is set", () => {
    expect(logQueryString({})).toBe("");
    expect(logQueryString({ services: [], levels: [], regex: "", limit: 0 })).toBe("");
  });

  it("repeats service, level and field, and encodes what needs it", () => {
    const qs = logQueryString({
      services: ["api", "vault/openbao"],
      levels: ["error", "fatal"],
      fields: ["user.id=42", "route!=/home"],
      regex: "db (timeout|refused)",
      since: "15m",
      until: "2026-10-21T10:00:00Z",
      group: "8a129441c02fb0d1",
      before: 120,
      after: 100,
      limit: 200,
    });
    const p = new URLSearchParams(qs);
    expect(p.getAll("service")).toEqual(["api", "vault/openbao"]);
    expect(p.getAll("level")).toEqual(["error", "fatal"]);
    expect(p.getAll("field")).toEqual(["user.id=42", "route!=/home"]);
    expect(p.get("regex")).toBe("db (timeout|refused)");
    expect(p.get("since")).toBe("15m");
    expect(p.get("until")).toBe("2026-10-21T10:00:00Z");
    expect(p.get("group")).toBe("8a129441c02fb0d1");
    expect([p.get("before"), p.get("after"), p.get("limit")]).toEqual(["120", "100", "200"]);
    expect(qs).not.toContain(" "); // spaces and brackets are escaped
  });

  it("turns a saved filter into a query without its id, name or stack", () => {
    const q = queryOfFilter({ id: "a", name: "A", stack: "full", services: ["api"], levels: ["error"], regex: "x", fields: ["a=b"], since: "1h" });
    expect(q).toEqual({ services: ["api"], levels: ["error"], regex: "x", fields: ["a=b"], since: "1h" });
    expect(logQueryString(q)).toContain("service=api");
  });
});
