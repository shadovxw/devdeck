import { ChevronRight } from "lucide-react";
import { LazyMotion, m, MotionConfig } from "motion/react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "../design/Logo";
import { useInputMode } from "../lib/input-mode";
import { springSnappy } from "../lib/motion";
import { useUi } from "../store/ui";
import { FOOTER_GROUP, HOME_GROUP, NAV, sidebarPathOf, type NavItem } from "./nav";
import { useUpdateAvailable } from "./UpdateNotice";

/** A dot on the Settings row when a newer devdeck is out (Settings → About installs it). */
function UpdateDot() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <span
      aria-label="Update available"
      title="A newer devdeck is out: Settings → About"
      className="ms-auto size-1.5 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-1 group-data-[collapsible=icon]:top-1"
    />
  );
}

const loadMotionFeatures = () => import("../lib/motion-features").then((mod) => mod.default);

// Row look: 32px tall, 13px text, 17px icons. Collapsed, a row is a 32px square.
// The active highlight is the sliding pill below, so the button's own active background is off.
const row =
  "relative isolate h-8 gap-2 py-0 text-[13px] data-[active=true]:bg-transparent group-data-[collapsible=icon]:size-8! [&>svg]:size-[17px]";

/**
 * The highlight behind the current page. It is one shared element (layoutId), so
 * when the page changes it slides from the old row to the new one instead of
 * jumping. Under reduced motion MotionConfig turns the slide into a cut.
 */
function ActivePill() {
  const keyboard = useInputMode() === "keyboard";
  return (
    <m.span
      layoutId="nav-active"
      layout="position"
      // Changing page is a tens-of-times-a-day action: quick and bounce-free, and
      // an instant cut when it came from the keyboard.
      transition={keyboard ? { duration: 0 } : springSnappy}
      aria-hidden
      data-ui="nav-pill"
      className="absolute inset-0 -z-10 bg-sidebar-accent"
    />
  );
}

/** Rows in the footer that are icons only, side by side: Notifications, Docs, Settings. */
const ICON_ROW = new Set(["/notifications", "/docs", "/settings"]);

/** One sidebar row. It stays highlighted while any page of its family is open (its tabs). */
function Page({ item }: Readonly<{ item: NavItem }>) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const active = sidebarPathOf(pathname) === item.path;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label} className={row}>
        <Link to={item.path} viewTransition onClick={() => setOpenMobile(false)} aria-current={active ? "page" : undefined}>
          {active && <ActivePill />}
          <item.icon strokeWidth={1.7} />
          <span>{item.label}</span>
          {item.path === "/settings" && <UpdateDot />}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** A footer page shown as an icon alone (its name in the tooltip and for screen readers). */
function IconPage({ item }: Readonly<{ item: NavItem }>) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const active = sidebarPathOf(pathname) === item.path;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className="relative isolate size-8 justify-center p-0 data-[active=true]:bg-transparent [&>svg]:size-[17px]"
      >
        <Link to={item.path} viewTransition onClick={() => setOpenMobile(false)} aria-label={item.label} aria-current={active ? "page" : undefined}>
          {active && <ActivePill />}
          <item.icon strokeWidth={1.7} />
          {item.path === "/settings" && <UpdateDot />}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

type GroupProps = {
  name: string;
  items: NavItem[];
  /** Home's group has no heading. */
  heading?: boolean;
  /** Coming soon: folded until opened, not remembered, and left off the folded rail. */
  soon?: boolean;
};

function Group({ name, items, heading = true, soon = false }: Readonly<GroupProps>) {
  const { state, isMobile } = useSidebar();
  const closed = useUi((s) => s.closedGroups.includes(name));
  const setGroupOpen = useUi((s) => s.setGroupOpen);
  const [soonOpen, setSoonOpen] = useState(false);
  // Folded to icons there are no headings, so every page there stays reachable.
  const iconOnly = state === "collapsed" && !isMobile;
  if (iconOnly && soon) return null;
  const open = iconOnly || !heading || (soon ? soonOpen : !closed);
  const onOpenChange = (o: boolean) => (soon ? setSoonOpen(o) : setGroupOpen(name, o));

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarGroup className="px-2 py-0.5 group-data-[collapsible=icon]:py-0">
        {heading && (
          <SidebarGroupLabel
            asChild
            data-ui="nav-group"
            className="h-6 cursor-pointer font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 hover:text-ink group-data-[collapsible=icon]:hidden"
          >
            <CollapsibleTrigger>
              {name}
              <ChevronRight className="ms-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
        )}
        {heading && <hr className="mx-auto my-1 hidden w-6 border-0 border-t border-sidebar-border group-data-[collapsible=icon]:block" />}
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => (
                <Page key={item.path} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

// The sidebar's parts, from nav.ts: built pages only; the System group as the footer pinned to
// the bottom; everything not built yet under Coming soon.
const MAIN = NAV.filter((g) => g.name !== FOOTER_GROUP)
  .map((g) => ({ name: g.name, items: g.items.filter((i) => i.built) }))
  .filter((g) => g.items.length > 0);
const FOOTER = NAV.find((g) => g.name === FOOTER_GROUP)?.items.filter((i) => i.built) ?? [];
const SOON = NAV.flatMap((g) => g.items.filter((i) => !i.built));

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const reduceMotion = useUi((s) => s.reduceMotion);
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
        <Sidebar collapsible="icon">
          <SidebarHeader className="h-14 flex-row items-center gap-3 px-3 group-data-[collapsible=icon]:justify-center">
            <NavLink
              to="/"
              viewTransition
              aria-label="devdeck home"
              title="devdeck"
              data-ui="logo"
              onClick={() => setOpenMobile(false)}
              className="grid size-7 shrink-0 place-items-center"
            >
              <Logo className="size-6" />
            </NavLink>
            <span data-ui="wordmark" className="look-flat text-[15px] font-bold tracking-tight text-brand-dev group-data-[collapsible=icon]:hidden">
              dev
              <span className="bg-gradient-to-r from-brand-deck-from to-brand-deck-to bg-clip-text text-transparent">deck</span>
            </span>
            {/* Neon's wordmark: "dd." with the dot in the accent. Hidden in Flat (looks.css). */}
            <span data-ui="wordmark-neon" className="look-neon group-data-[collapsible=icon]:hidden">
              dd<span>.</span>
            </span>
          </SidebarHeader>
          <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:overflow-x-hidden [scrollbar-width:none]">
            <nav aria-label="Pages" className="flex flex-col py-1 group-data-[collapsible=icon]:py-0.5">
              {MAIN.map((g) => (
                <Group key={g.name} name={g.name} items={g.items} heading={g.name !== HOME_GROUP} />
              ))}
              {SOON.length > 0 && <Group name="Coming soon" items={SOON} soon />}
            </nav>
          </SidebarContent>
          <SidebarFooter className="gap-1 px-2 pb-3">
            <nav aria-label="System" className="flex flex-col gap-1">
              <SidebarMenu className="gap-0.5">
                {FOOTER.filter((i) => !ICON_ROW.has(i.path)).map((item) => (
                  <Page key={item.path} item={item} />
                ))}
              </SidebarMenu>
              <SidebarMenu data-ui="icon-row" className="flex-row gap-1 group-data-[collapsible=icon]:flex-col">
                {FOOTER.filter((i) => ICON_ROW.has(i.path)).map((item) => (
                  <IconPage key={item.path} item={item} />
                ))}
              </SidebarMenu>
            </nav>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
      </MotionConfig>
    </LazyMotion>
  );
}
