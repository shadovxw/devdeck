import { useState, type ReactNode } from "react";

import { chooseIntro, markIntroSeen } from "../design/intro/choose";
import { Intro } from "../design/intro/Intro";
import { Splash } from "../design/Splash";
import { useHealth } from "../lib/queries";
import { useLink } from "../lib/use-server-link";

// Shows the branded loading page until the server answers, then the app. On a cold start in
// Neon the launch intro plays instead while the server connects, and hands off to the app
// (design/intro). Offline at start, it tries again with back-off and counts down to the next
// try. Once the app is on screen, a later outage keeps it there: the reconnecting strip says so
// (app/LinkStrip.tsx).
export function Boot({ children }: { children: ReactNode }) {
  const health = useHealth();
  const link = useLink();
  const [intro, setIntro] = useState(() => {
    const mode = chooseIntro();
    if (mode !== "none") markIntroSeen();
    return mode;
  });
  const [appUnder, setAppUnder] = useState(false);

  if (intro !== "none") {
    return (
      <>
        {appUnder && health.data && children}
        <Intro mode={intro} ready={Boolean(health.data)} offline={health.isError && !health.data} onApp={() => setAppUnder(true)} onDone={() => setIntro("none")} />
      </>
    );
  }

  if (health.data) return children;
  if (health.isError) return <Splash state="offline" onRetry={() => void health.refetch()} nextIn={link.nextIn} attempt={link.failures} />;
  return <Splash />;
}
