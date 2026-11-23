import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { useRestartService, useRuns, useWorkspaces } from "../lib/queries";
import { isProblem } from "../lib/runs";
import { useSocketStatus } from "../lib/socket";
import { useNow } from "../lib/use-now";
import { NeonEmptyOverview } from "./home/NeonEmptyOverview";
import { NeonHome } from "./home/NeonHome";

/** Overview: the stacks dashboard, what runs now and what needs a look (dev-plans/2026-11-21-portfolio-look §8a). */
export function OverviewPage() {
  const item = navByPath("/overview");
  const runs = useRuns();
  const workspaces = useWorkspaces();
  const restart = useRestartService();
  const list = runs.data ?? [];
  const now = useNow(list.length > 0);
  const socket = useSocketStatus();

  if (runs.isPending) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <div role="status" aria-label="Loading…" className="mt-4 flex flex-col gap-3">
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      </>
    );
  }

  if (list.length === 0) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <NeonEmptyOverview hasWorkspace={(workspaces.data?.length ?? 0) > 0} />
      </>
    );
  }

  const failed = list.flatMap((run) => run.services.filter(isProblem).map((service) => ({ run, service })));
  return (
    <NeonHome
      runs={list}
      now={now}
      live={socket === "open"}
      restarting={restart.isPending ? restart.variables?.service : undefined}
      onRestart={(run, service) => restart.mutate({ workspace: run.workspace, stack: run.stack, service })}
      onRestartFailed={() => {
        for (const { run, service } of failed) restart.mutate({ workspace: run.workspace, stack: run.stack, service: service.id });
      }}
      restartBusy={restart.isPending}
    />
  );
}
