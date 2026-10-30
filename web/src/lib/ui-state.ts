import { useEffect } from "react";
import { useLocation } from "react-router";

import { NAV_ITEMS } from "../app/nav";
import { api } from "./api";

/** Where the person is in devdeck's window. The server keeps the latest one, in memory only. */
export type UiSnapshot = { route: string; label?: string; params?: Record<string, string>; notice?: string };

// The server refuses more than this (internal/api/uistate.go), so the page cuts first.
const MAX_PARAMS = 20;
const MAX_KEY = 50;
const MAX_VALUE = 300;
const MAX_NOTICE = 500;

/** How long the page must be still before it reports, so a burst of changes is one report. */
const QUIET_MS = 400;

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** The text of the error or alert the page shows, if any. */
export function visibleNotice(root: ParentNode = document): string {
  const el = root.querySelector('main [role="alert"]');
  return cut(el?.textContent?.replace(/\s+/g, " ").trim() ?? "", MAX_NOTICE);
}

/** What the page is, from its address: the page, its filters and selection, and the message it shows. */
export function buildSnapshot(pathname: string, search: string, notice: string): UiSnapshot {
  const params: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of new URLSearchParams(search)) {
    if (n++ >= MAX_PARAMS) break;
    params[cut(k, MAX_KEY)] = cut(v, MAX_VALUE);
  }
  const snap: UiSnapshot = { route: cut(pathname, 200) };
  const label = NAV_ITEMS.find((i) => i.path === pathname)?.label;
  if (label) snap.label = label;
  if (n > 0) snap.params = params;
  if (notice) snap.notice = notice;
  return snap;
}

/**
 * Tells the server which page is open, its filters and any message it shows, a moment after
 * they change, so Claude Code can answer "what am I looking at?". Nothing is sent that the
 * page doesn't already show. A failure is ignored: this is a convenience.
 */
export function useReportUiState() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const send = () => {
      const snap = buildSnapshot(pathname, search, visibleNotice());
      const body = JSON.stringify(snap);
      if (body === last) return;
      last = body;
      api.put<void>("/ui/state", snap).catch(() => {
        last = ""; // try again at the next change
      });
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(send, QUIET_MS);
    };
    later();

    // A message appearing or going away is a change too.
    const main = document.getElementById("main");
    const observer = main ? new MutationObserver(later) : undefined;
    if (main) observer?.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [pathname, search]);
}
