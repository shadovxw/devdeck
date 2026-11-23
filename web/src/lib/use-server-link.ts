import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { keys } from "./queries";
import { CONNECTED_MS, linkView, nextCheckAt, useServerLink, writesPaused, type LinkView } from "./server-link";
import { useSocketStatus } from "./socket";
import { useNow } from "./use-now";

/**
 * The server link as the page shows it, re-read twice a second while something changes with
 * time (an outage, "Connected"), and not at all otherwise. useServerWatch ends "Connected".
 */
export function useLink(): { view: LinkView; paused: boolean; downFor: number; nextIn: number; failures: number } {
  const s = useServerLink();
  const ticking = s.downSince !== null || s.backAt !== null;
  const now = useNow(ticking, 500);
  const next = nextCheckAt(s);
  return {
    view: linkView(s, now),
    paused: writesPaused(s, now),
    downFor: s.downSince === null ? 0 : Math.max(0, now - s.downSince),
    nextIn: next === null ? 0 : Math.max(0, next - now),
    failures: s.failures,
  };
}

/** True while writes wait for the server: disable the button and say why in its tooltip. */
export const useWritesPaused = () => useLink().paused;

/**
 * Runs once in the app shell. A dropped live socket asks the health check at once, rather than
 * waiting up to 30s; when the server is back after an outage, every query refreshes.
 */
export function useServerWatch(): void {
  const client = useQueryClient();
  const socket = useSocketStatus();
  const was = useRef(socket);
  useEffect(() => {
    if (was.current === "open" && socket !== "open") void client.refetchQueries({ queryKey: keys.health });
    was.current = socket;
  }, [socket, client]);

  const backAt = useServerLink((s) => s.backAt);
  useEffect(() => {
    if (backAt === null) return;
    void client.invalidateQueries();
    // "Connected" shows for CONNECTED_MS, then the note is done with.
    const timer = setTimeout(() => useServerLink.getState().settled(), CONNECTED_MS);
    return () => clearTimeout(timer);
  }, [backAt, client]);
}
