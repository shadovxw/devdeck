import { describe, expect, it } from "vitest";

import { compilePattern, entryMatches, logQueryString, messageOf, parseFieldFilter, queryOfFilter, vscodeLink, type LogQuery } from "./log-query";
import type { LogEntry } from "./types";

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

describe("what the browser can tell about a live line", () => {
  const e = (extra: Partial<LogEntry> = {}): LogEntry => ({ seq: 1, time: "2026-10-21T12:00:00Z", workspace: "demo", stack: "full", service: "api", stream: "stdout", text: "db timeout after 30s", ...extra });

  it("reads field filters", () => {
    expect(parseFieldFilter("user.id=42")).toEqual({ path: "user.id", value: "42", not: false });
    expect(parseFieldFilter("route!=/home")).toEqual({ path: "route", value: "/home", not: true });
    expect(parseFieldFilter("a=b=c")).toEqual({ path: "a", value: "b=c", not: false });
    for (const bad of ["nope", "=x", "!=x", " =x"]) expect(parseFieldFilter(bad)).toBeUndefined();
  });

  it("reads Go style flags at the start of a pattern", () => {
    expect(compilePattern("(?i)timeout")?.test("TIMEOUT")).toBe(true);
    expect(compilePattern("(?is)a.b")?.test("A\nB")).toBe(true);
    expect(compilePattern("timeout")?.test("TIMEOUT")).toBe(false);
    expect(compilePattern("(")).toBeUndefined();
    expect(compilePattern("")).toBeUndefined();
    expect(compilePattern(undefined)).toBeUndefined();
  });

  it("applies every filter the way the server does", () => {
    const line = e({ level: "error", fingerprint: "fp", fields: { user: { id: 42 }, "a.b": "x", n: null, list: [1, "a"], ok: true } });
    const yes = (q: LogQuery) => expect(entryMatches(line, q)).toBe(true);
    const no = (q: LogQuery) => expect(entryMatches(line, q)).toBe(false);
    yes({});
    yes({ services: ["web", "api"], levels: ["error"], regex: "(?i)TIMEOUT", group: "fp" });
    no({ services: ["web"] });
    no({ levels: ["warn", "fatal"] });
    no({ regex: "refused" });
    no({ group: "other" });
    yes({ fields: ["user.id=42"] }); // nested, a number compared as text
    yes({ fields: ["a.b=x"] }); // a key that has a dot
    yes({ fields: ["n=null", "ok=true", 'list=[1,"a"]'] });
    no({ fields: ["user.id=7"] });
    yes({ fields: ["user.id!=7", "missing!=x"] });
    no({ fields: ["user.id!=42"] });
    yes({ fields: ["not a filter"] }); // the server refuses those; the browser ignores them
    expect(entryMatches(e(), { levels: ["info"] })).toBe(true); // no level counts as info
    expect(entryMatches(e(), { levels: ["error"] })).toBe(false);
  });

  it("picks the message to show, and builds the VS Code link", () => {
    expect(messageOf(e({ message: "db timeout", text: "{json}" }))).toBe("db timeout");
    expect(messageOf(e({ text: "panic: boom\n\ngoroutine 1" }))).toBe("panic: boom");
    expect(messageOf(e())).toBe("db timeout after 30s");
    expect(vscodeLink("/work/api/main.go", 14)).toBe("vscode://file/work/api/main.go:14");
    expect(vscodeLink(String.raw`C:\Users\me\my repo\main.go`, 3)).toBe("vscode://file/C:/Users/me/my%20repo/main.go:3");
  });
});
