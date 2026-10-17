import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "../design/Logo";
import { useUi } from "../store/ui";
import { NAV, type NavGroup, type NavItem } from "./nav";

// Row look: 32px tall, 13px text, 17px icons. Collapsed, a row is a 32px square.
const row = "h-8 gap-2 py-0 text-[13px] group-data-[collapsible=icon]:size-8! [&>svg]:size-[17px]";

function Page({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const closeDrawer = () => setOpenMobile(false);
  const kids = item.children;
  const insideKids = kids?.some((k) => pathname === k.path) ?? false;
  // Sub-pages open by themselves when you are on one; the chevron overrides that.
  const [chosen, setChosen] = useState<boolean>();
  const open = chosen ?? insideKids;

  return (
    <>
      <Collapsible open={open} onOpenChange={setChosen} asChild>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={pathname === item.path} tooltip={item.label} className={row}>
            <NavLink to={item.path} end onClick={closeDrawer}>
              <item.icon strokeWidth={1.7} />
              <span>{item.label}</span>
            </NavLink>
          </SidebarMenuButton>
          {kids && (
            <>
              <CollapsibleTrigger asChild>
                <SidebarMenuAction
                  aria-label={`${open ? "Hide" : "Show"} ${item.label} pages`}
                  className="top-1.5 data-[state=open]:rotate-90 [&>svg]:size-3.5"
                >
                  <ChevronRight />
                </SidebarMenuAction>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub className="gap-0 py-0">
                  {kids.map((k) => (
                    <SidebarMenuSubItem key={k.path}>
                      <SidebarMenuSubButton asChild isActive={pathname === k.path} className="h-7 text-[13px]">
                        <NavLink to={k.path} end onClick={closeDrawer}>
                          <span>{k.label}</span>
                        </NavLink>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </>
          )}
        </SidebarMenuItem>
      </Collapsible>

      {/* Collapsed to icons there is no room for a sub-list, so sub-pages become plain icons. */}
      {kids?.map((k) => (
        <SidebarMenuItem key={k.path} className="hidden group-data-[collapsible=icon]:block">
          <SidebarMenuButton asChild isActive={pathname === k.path} tooltip={k.label} className={row}>
            <NavLink to={k.path} end onClick={closeDrawer}>
              <k.icon strokeWidth={1.7} />
              <span>{k.label}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </>
  );
}

function Group({ group }: { group: NavGroup }) {
  const { state, isMobile } = useSidebar();
  const closed = useUi((s) => s.closedGroups.includes(group.name));
  const setGroupOpen = useUi((s) => s.setGroupOpen);
  // Collapsed to icons there are no headings, so every page stays reachable.
  const iconOnly = state === "collapsed" && !isMobile;
  const open = iconOnly || !closed;

  return (
    <Collapsible open={open} onOpenChange={(o) => setGroupOpen(group.name, o)} className="group/collapsible">
      <SidebarGroup className="px-2 py-0.5 group-data-[collapsible=icon]:py-0">
        <SidebarGroupLabel
          asChild
          className="h-6 cursor-pointer text-[12px] text-sidebar-foreground/60 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
        >
          <CollapsibleTrigger>
            {group.name}
            <ChevronRight className="ms-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <hr className="mx-auto my-1 hidden w-6 border-0 border-t border-sidebar-border group-data-[collapsible=icon]:block" />
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => (
                <Page key={item.path} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 flex-row items-center gap-3 px-3 group-data-[collapsible=icon]:justify-center">
        <NavLink to="/" aria-label="devdeck home" title="devdeck" onClick={() => setOpenMobile(false)} className="grid size-7 shrink-0 place-items-center">
          <Logo className="size-6" />
        </NavLink>
        <span className="text-[15px] font-bold tracking-tight text-brand-dev group-data-[collapsible=icon]:hidden">
          dev
          <span className="bg-gradient-to-r from-brand-deck-from to-brand-deck-to bg-clip-text text-transparent">deck</span>
        </span>
      </SidebarHeader>
      <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:overflow-x-hidden [scrollbar-width:none]">
        <nav aria-label="Pages" className="flex flex-col py-1 group-data-[collapsible=icon]:py-0.5">
          {NAV.map((group) => (
            <Group key={group.name} group={group} />
          ))}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
