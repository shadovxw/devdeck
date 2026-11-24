import { ChevronRight, Layers } from "lucide-react";
import { Link } from "react-router";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useCurrentProject } from "../lib/current-project";
import { useWorkspaces } from "../lib/queries";
import type { WorkspaceSummary } from "../lib/types";

/** What the switcher says: the workspace's name, how many there are, or that there is none yet. */
export function workspaceLabel(list: WorkspaceSummary[] | undefined): string {
  if (!list) return "Projects";
  if (list.length === 0) return "No project";
  if (list.length === 1) return list[0].name;
  return `${list.length} projects`;
}

/**
 * The project switcher, in the sidebar's header (where you pick what you work in, as in VS Code
 * or Linear). It names the current project (the one opened last, which Stacks, Logs and Health
 * follow) and opens it; with none yet, it says how many there are and opens Projects.
 */
export function WorkspaceSwitcher() {
  const { setOpenMobile } = useSidebar();
  const workspaces = useWorkspaces();
  // The current project (lib/current-project.ts), if it still exists: its name, and a link to it.
  const currentId = useCurrentProject((s) => s.id);
  const current = workspaces.data?.find((w) => w.id === currentId);
  const label = current?.name ?? workspaceLabel(workspaces.data);
  const to = current ? `/workspaces/${encodeURIComponent(current.id)}` : "/workspaces";
  return (
    <SidebarMenu data-ui="switcher">
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip={label} data-ui="quiet" className="h-9 gap-2.5 bg-fill px-3 text-[13px] font-medium text-ink hover:bg-fill-hover group-data-[collapsible=icon]:bg-transparent">
          <Link to={to} viewTransition onClick={() => setOpenMobile(false)} aria-label={`Project: ${label}`}>
            <Layers size={17} className="text-ink-3" aria-hidden />
            <span className="flex-1 truncate text-start">{label}</span>
            <ChevronRight size={15} className="text-ink-3" aria-hidden />
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
