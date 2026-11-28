import { Boxes, Plus } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { navByPath } from "../app/nav";
import { primaryButton } from "../design/buttons";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import { useRuns, useWorkspaces } from "../lib/queries";
import { PAUSED_TITLE } from "../lib/server-link";
import { useWritesPaused } from "../lib/use-server-link";
import { NewProject } from "./workspaces/NewProject";
import { WorkspaceCards } from "./workspaces/WorkspaceCards";
import { EmptyState } from "../design/EmptyState";

export function WorkspacesPage() {
  const item = navByPath("/workspaces");
  const [params] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const { data, isPending, isError } = useWorkspaces();
  const runs = useRuns();
  const paused = useWritesPaused();

  // A project opens on its own page. Older links named it in the address (?open=); they go there too.
  const navigate = useNavigate();
  const chosen = params.get("open");
  function open(id: string) {
    navigate(`/workspaces/${encodeURIComponent(id)}`, { viewTransition: true });
  }
  if (chosen) return <Navigate to={`/workspaces/${encodeURIComponent(chosen)}`} replace />;

  const showEmpty = data && data.length === 0;

  return (
    <>
      <PageHeader
        title={item.label}
        group={item.group}
        actions={
          !showEmpty && (
            <button type="button" onClick={() => setAdding(true)} disabled={paused} title={paused ? PAUSED_TITLE : undefined} className={primaryButton}>
              <Plus size={16} aria-hidden />
              New project
            </button>
          )
        }
      />

      {showEmpty && item.empty && <EmptyState icon={Boxes} empty={{ ...item.empty, secondary: navByPath("/").empty?.secondary }} variant="workspaces" onCta={() => setAdding(true)} />}

      {isPending && (
        <output aria-label="Loading workspaces…" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40 w-full" />
          ))}
        </output>
      )}
      {isError && <p className="mt-4 text-ink-3">Could not load workspaces.</p>}

      {data && data.length > 0 && (
        <div className="enter mt-4" style={stagger(2)}>
          <WorkspaceCards items={data} runs={runs.data} onSelect={open} />
        </div>
      )}

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-0 bg-surface-1 sm:max-w-2xl">
          <SheetHeader className="pe-12 pt-5">
            <SheetTitle className="text-[18px] text-ink">New project</SheetTitle>
            <SheetDescription className="text-[14px] leading-5 text-ink-3">
              Pick one repo, or the folder that holds several. devdeck lists what it finds; tick what belongs, name it, and create.
            </SheetDescription>
          </SheetHeader>
          <NewProject
            onCreated={(id) => {
              setAdding(false);
              open(id);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
