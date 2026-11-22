import { Square } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ServiceStateMark } from "../../design/ServiceStateMark";
import { useStopStack } from "../../lib/queries";
import { serviceLabel } from "../../lib/runs";
import { PAUSED_TITLE } from "../../lib/server-link";
import type { RunStatus, ServiceStatus } from "../../lib/types";
import { useWritesPaused } from "../../lib/use-server-link";

// Pieces of the Overview dashboard (NeonHome).

/** A service that needs attention, pinned above the others with its one action. */
export function ProblemRow({ run, service, busy, onRestart }: Readonly<{ run: RunStatus; service: ServiceStatus; busy: boolean; onRestart: () => void }>) {
  const name = serviceLabel(service.id);
  const paused = useWritesPaused();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-inset px-3.5 py-3">
      <span className="w-28 shrink-0 text-[13px]">
        <ServiceStateMark state={service.state} />
      </span>
      <span className="font-mono text-[13px] font-medium text-ink">{name}</span>
      {service.last_error && <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2" title={service.last_error}>{service.last_error}</span>}
      <span className="flex-1" />
      <Button size="sm" disabled={busy || paused} title={paused ? PAUSED_TITLE : undefined} onClick={onRestart} aria-label={`Restart ${name} in ${run.stack}`}>
        Restart
      </Button>
    </li>
  );
}

/** Stops every running stack. The first click asks; a second one within 3 seconds does it. */
export function StopAll({ runs }: Readonly<{ runs: RunStatus[] }>) {
  const stop = useStopStack();
  const [sure, setSure] = useState(false);
  const paused = useWritesPaused();
  useEffect(() => {
    if (!sure) return;
    const timer = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(timer);
  }, [sure]);
  return (
    <Button
      variant="secondary"
      disabled={paused}
      title={paused ? PAUSED_TITLE : undefined}
      onClick={() => {
        if (!sure) return setSure(true);
        setSure(false);
        for (const r of runs) stop.mutate({ workspace: r.workspace, stack: r.stack });
      }}
    >
      <Square aria-hidden />
      {sure ? "Confirm stop all?" : "Stop all"}
    </Button>
  );
}
