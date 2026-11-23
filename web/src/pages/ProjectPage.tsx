import { useNavigate, useParams } from "react-router";

import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import { useWorkspaces } from "../lib/queries";
import { WorkspaceDetail } from "./workspaces/WorkspaceDetail";

/**
 * One project on its own page (dev-plans/2026-11-22-projects §4.3), opened from its card on
 * Projects. For now it holds the project's details as they were under the cards (repos, run
 * modes, problems, settings, Edit file); PJ2 gives it the design's header and sections.
 */
export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const list = navByPath("/workspaces");
  const name = useWorkspaces().data?.find((w) => w.id === id)?.name ?? id;
  return (
    <>
      <PageHeader title={name} group={list.group} parent={list.label} parentTo={list.path} />
      <div className="enter mt-6" style={stagger(1)}>
        <WorkspaceDetail id={id} onDeleted={() => navigate("/workspaces", { replace: true, viewTransition: true })} />
      </div>
    </>
  );
}
