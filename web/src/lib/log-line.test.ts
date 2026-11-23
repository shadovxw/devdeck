import { describe, expect, it } from "vitest";

import { readLine } from "./log-line";

describe("readLine", () => {
  it("reads a zerolog line into level, message and fields, leaving out the time", () => {
    const r = readLine('{"level":"info","request_id":"c9d7","method":"POST","status":204,"latency_ms":15,"time":"2026-10-23T08:15:35Z","message":"request"}');
    expect(r.level).toBe("info");
    expect(r.message).toBe("request");
    expect(r.fields).toEqual([
      ["request_id", "c9d7"],
      ["method", "POST"],
      ["status", "204"],
      ["latency_ms", "15"],
    ]);
  });

  it("knows the other common keys and level words", () => {
    expect(readLine('{"lvl":"WARNING","msg":"slow","ts":1}')).toEqual({ level: "warn", message: "slow", fields: [] });
    expect(readLine('{"severity":"ERROR","event":"boom","err":{"code":1}}')).toEqual({ level: "error", message: "boom", fields: [["err", '{"code":1}']] });
    expect(readLine('{"level":"verbose","message":"x"}').level).toBeUndefined();
  });

  it("reads zerolog's coloured console format", () => {
    const line = "\u001b[90m2026-10-23T08:41:37Z\u001b[0m \u001b[32mINF\u001b[0m \u001b[1mhttp_request\u001b[0m \u001b[36mlatency_ms=\u001b[0m0 \u001b[36mmethod=\u001b[0mGET \u001b[36mpath=\u001b[0m/health";
    expect(readLine(line)).toEqual({ level: "info", message: "http_request", fields: [["latency_ms", "0"], ["method", "GET"], ["path", "/health"]] });
    expect(readLine("08:41:37 WRN disk almost full used=91%")).toEqual({ level: "warn", message: "disk almost full", fields: [["used", "91%"]] });
    // a word after the time that isn't a level leaves the line as it is
    expect(readLine("2026-10-23T08:41:37Z hello world").level).toBeUndefined();
  });

  it("keeps a plain line as it is, finding a level it starts with", () => {
    expect(readLine("WARN disk almost full")).toEqual({ level: "warn", message: "WARN disk almost full", fields: [] });
    expect(readLine("[error] failed")).toMatchObject({ level: "error" });
    expect(readLine("listening on :8080")).toEqual({ level: undefined, message: "listening on :8080", fields: [] });
    expect(readLine("{not json}").message).toBe("{not json}");
  });
});

describe("splitLines", () => {
  it("splits newline-delimited JSON, keeps an unfinished line, skips what isn't JSON, and numbers the lines", async () => {
    const { splitLines } = await import("./hosts");
    const a = splitLines('{"line":"one"}\nnot json\n\n{"line":"two"}\n{"line":"thr');
    expect(a.lines.map((l) => l.line)).toEqual(["one", "two"]);
    expect(a.rest).toBe('{"line":"thr');
    expect(a.lines[1].id).toBeGreaterThan(a.lines[0].id);
    expect(splitLines(a.rest + 'ee"}\n').lines.map((l) => l.line)).toEqual(["three"]);
  });
});
