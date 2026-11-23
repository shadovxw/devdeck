import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { isMutedText, muteOfText, parseMuteInput, readMutes, useMutes } from "./log-mutes";

afterEach(() => localStorage.clear());

describe("parseMuteInput", () => {
  it("takes /pattern/ as it is, other text literally, and refuses what does not work", () => {
    expect(parseMuteInput("/GET /health(z)?/")).toEqual({ pattern: "GET /health(z)?" });
    expect(parseMuteInput("GET /healthz")).toEqual({ pattern: "(?i)GET /healthz" });
    expect(parseMuteInput("/(/")).toEqual({ error: "This isn’t a valid pattern." });
    expect(parseMuteInput("  ")).toHaveProperty("error");
  });
});

describe("muteOfText and isMutedText", () => {
  it("keeps the start of a long line and matches lines that contain it", () => {
    const pattern = muteOfText(`connection refused ${"x".repeat(200)}`);
    expect(pattern.length).toBeLessThan(110);
    expect(isMutedText([pattern], `2026 ERROR connection refused ${"x".repeat(200)}`)).toBe(true);
    expect(isMutedText([pattern], "fine")).toBe(false);
    expect(isMutedText(["("], "anything")).toBe(false); // a pattern that does not compile mutes nothing
  });
});

describe("useMutes", () => {
  it("adds, turns off, removes and remembers per stack", () => {
    const { result } = renderHook(() => useMutes("demo", "full"));
    act(() => {
      result.current.add("(?i)noise");
      result.current.add("(?i)other");
    });
    expect(result.current.mutes).toEqual([{ pattern: "(?i)noise", on: true }, { pattern: "(?i)other", on: true }]);

    act(() => result.current.toggle("(?i)noise"));
    act(() => result.current.remove("(?i)other"));
    expect(readMutes("demo", "full")).toEqual([{ pattern: "(?i)noise", on: false }]);
    expect(readMutes("demo", "other-stack")).toEqual([]);

    // adding a pattern that is there turns it on instead of repeating it
    act(() => result.current.add("(?i)noise"));
    expect(result.current.mutes).toEqual([{ pattern: "(?i)noise", on: true }]);
  });

  it("starts from what was kept, and ignores what is not a list of mutes", () => {
    localStorage.setItem("devdeck.log-mutes.demo.full", JSON.stringify([{ pattern: "a", on: false }, { nope: 1 }, { pattern: "" }]));
    expect(renderHook(() => useMutes("demo", "full")).result.current.mutes).toEqual([{ pattern: "a", on: false }]);
    localStorage.setItem("devdeck.log-mutes.demo.full", "{broken");
    expect(readMutes("demo", "full")).toEqual([]);
  });
});
