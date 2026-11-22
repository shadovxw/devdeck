import type { ReactNode } from "react";

import { Splash } from "../design/Splash";
import { useHealth } from "../lib/queries";
import { useLink } from "../lib/use-server-link";

// Shows the branded loading page until the server answers, then the app. Offline at start, it
// tries again with back-off and counts down to the next try. Once the app is on screen, a later
// outage keeps it there: the reconnecting strip says so (app/LinkStrip.tsx).
export function Boot({ children }: { children: ReactNode }) {
  const health = useHealth();
  const link = useLink();

  if (health.data) return children;
  if (health.isError) return <Splash state="offline" onRetry={() => void health.refetch()} nextIn={link.nextIn} attempt={link.failures} />;
  return <Splash />;
}
