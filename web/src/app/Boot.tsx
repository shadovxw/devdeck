import type { ReactNode } from "react";

import { Splash } from "../design/Splash";
import { useHealth } from "../lib/queries";

// Shows the branded loading page until the server answers. Once it has
// answered, a later outage keeps the app on screen (the status strip turns red)
// instead of throwing the user back to the splash.
export function Boot({ children }: { children: ReactNode }) {
  const health = useHealth();

  if (health.data) return children;
  if (health.isError) return <Splash state="offline" onRetry={() => void health.refetch()} />;
  return <Splash />;
}
