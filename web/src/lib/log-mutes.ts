import { useCallback, useState } from "react";

import { compilePattern } from "./log-query";
import { patternOfText } from "./log-tokens";

/** A pattern of noise the reader has chosen not to see. `on` is whether it is applied now. */
export type Mute = { pattern: string; on: boolean };

const maxMutes = 20;
const key = (workspace: string, stack: string) => `devdeck.log-mutes.${workspace}.${stack}`;

/** What is kept in this browser for a stack: a viewing preference, so it never leaves the machine except as a filter on a request. */
export function readMutes(workspace: string, stack: string): Mute[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(workspace, stack)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is Mute => typeof m?.pattern === "string" && m.pattern !== "" && m.pattern.length <= 500)
      .map((m) => ({ pattern: m.pattern, on: m.on !== false }))
      .slice(0, maxMutes);
  } catch {
    return [];
  }
}

function writeMutes(workspace: string, stack: string, mutes: Mute[]) {
  try {
    localStorage.setItem(key(workspace, stack), JSON.stringify(mutes));
  } catch {
    // private window or blocked storage: the mutes last until the page is closed
  }
}

export type MuteInput = { pattern: string } | { error: string };

/** Typed text as a pattern: `/regex/` is used as it is, anything else is searched for literally, ignoring case. */
export function parseMuteInput(input: string): MuteInput {
  const text = input.trim();
  if (!text) return { error: "Type some text, or a /pattern/." };
  if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) {
    const pattern = text.slice(1, -1);
    return compilePattern(pattern) ? { pattern } : { error: "This isn’t a valid pattern." };
  }
  return { pattern: patternOfText(text) };
}

/** A line of text as a mute that matches lines containing it: the start of it, so a long line still gives a short pattern. */
export const muteOfText = (text: string) => patternOfText(text.trim().slice(0, 80));

/** Whether any applied mute matches the text. */
export function isMutedText(mutes: string[], text: string): boolean {
  return mutes.some((p) => compilePattern(p)?.test(text) ?? false);
}

/** The muted patterns of one stack, kept in this browser. */
export function useMutes(workspace: string, stack: string) {
  const [mutes, setMutes] = useState(() => readMutes(workspace, stack));

  const change = useCallback(
    (update: (cur: Mute[]) => Mute[]) => {
      setMutes((cur) => {
        const next = update(cur);
        writeMutes(workspace, stack, next);
        return next;
      });
    },
    [workspace, stack],
  );

  /** Adds a pattern (turned on); false when it was already there or there are too many. */
  const add = useCallback(
    (pattern: string) => {
      let added = false;
      change((cur) => {
        if (cur.length >= maxMutes || cur.some((m) => m.pattern === pattern)) return cur.map((m) => (m.pattern === pattern ? { ...m, on: true } : m));
        added = true;
        return [...cur, { pattern, on: true }];
      });
      return added;
    },
    [change],
  );
  const toggle = useCallback((pattern: string) => change((cur) => cur.map((m) => (m.pattern === pattern ? { ...m, on: !m.on } : m))), [change]);
  const remove = useCallback((pattern: string) => change((cur) => cur.filter((m) => m.pattern !== pattern)), [change]);

  return { mutes, add, toggle, remove };
}
