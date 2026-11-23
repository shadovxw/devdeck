import { ChevronRight } from "lucide-react";
import { LazyMotion, m, MotionConfig } from "motion/react";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

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
import { cn } from "@/lib/utils";
import { Logo } from "../design/Logo";
import { StatusDot } from "../design/StatusDot";
import { useInputMode } from "../lib/input-mode";
import { springSnappy } from "../lib/motion";
import { useUi } from "../store/ui";
import { FOOTER_GROUP, HOME_GROUP, NAV, sidebarPathOf, type NavItem } from "./nav";
import { useNavStatus, type NavStatus } from "./nav-status";
import { shortcutKeys, useGoShortcuts } from "./shortcuts";
import { useUpdateAvailable } from "./UpdateNotice";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

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

/** The live status of the rows that have one (app/nav-status.ts), worked out once for the sidebar. */
const StatusContext = createContext<Record<string, NavStatus | undefined>>({});

/**
 * A row's live status: a dot and maybe a count at the row's end; folded to icons, the dot sits on
 * the icon's corner. The words go to screen readers as the row's description, so its name stays
 * the page's name.
 */
function RowStatus({ status, id }: Readonly<{ status: NavStatus; id: string }>) {
  return (
    <span data-ui="nav-status" aria-hidden className="ms-auto flex items-center gap-1.5 group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-0.5 group-data-[collapsible=icon]:top-0.5">
      {status.count !== undefined && <span className="font-mono text-[11px] tabular-nums text-ink-2 group-data-[collapsible=icon]:hidden">{status.count}</span>}
      <StatusDot tone={status.tone} size={6} />
      <span id={id} hidden>
        {status.text}
      </span>
    </span>
  );
}

/** A page's keys as small chips ("G" "S"), for tooltips and flyouts. */
function Keys({ path }: Readonly<{ path: string }>) {
  const keys = shortcutKeys(path);
  if (!keys) return null;
  return (
    <span data-ui="keys" aria-hidden className="ms-3 inline-flex gap-0.5 font-mono text-[10px]">
      {keys.map((k) => (
        <kbd key={k} className="bg-fill px-1 py-px text-ink-2">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** A row's tooltip: its name, what it says now, and its keys. */
const tipFor = (item: NavItem, status?: NavStatus) => ({
  children: (
    <span className="inline-flex items-center">
      {status ? `${item.label}: ${status.text}` : item.label}
      <Keys path={item.path} />
    </span>
  ),
});

/** One sidebar row. It stays highlighted while any page of its family is open (its tabs). */
function Page({ item }: Readonly<{ item: NavItem }>) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const status = useContext(StatusContext)[item.path];
  const statusId = useId();
  const active = sidebarPathOf(pathname) === item.path;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={tipFor(item, status)} className={row}>
        <Link
          to={item.path}
          viewTransition
          onClick={() => setOpenMobile(false)}
          aria-current={active ? "page" : undefined}
          aria-describedby={status ? statusId : undefined}
          aria-keyshortcuts={shortcutKeys(item.path)?.join(" ")}
        >
          {active && <ActivePill />}
          <item.icon strokeWidth={1.7} />
          <span>{item.label}</span>
          {status && <RowStatus status={status} id={statusId} />}
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
        tooltip={tipFor(item)}
        className="relative isolate size-8 justify-center p-0 data-[active=true]:bg-transparent [&>svg]:size-[17px]"
      >
        <Link to={item.path} viewTransition onClick={() => setOpenMobile(false)} aria-label={item.label} aria-keyshortcuts={shortcutKeys(item.path)?.join(" ")} aria-current={active ? "page" : undefined}>
          {active && <ActivePill />}
          <item.icon strokeWidth={1.7} />
          {item.path === "/settings" && <UpdateDot />}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * On the folded rail: a group's initial, which opens a flyout with the group's pages and their
 * tabs, so every page is reachable without expanding the sidebar. It opens on hover, on focus and
 * on click, and closes when the pointer leaves or a page is chosen.
 */
function RailFlyout({ name, items, initial }: Readonly<{ name: string; items: NavItem[]; initial: string }>) {
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    clearTimeout(closing.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(closing.current);
    closing.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  const link = (item: NavItem, sub = false) =>
    item.built ? (
      <Link key={item.path} to={item.path} viewTransition onClick={() => setOpen(false)} aria-keyshortcuts={shortcutKeys(item.path)?.join(" ")} className={cn("flex items-center justify-between px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-fill hover:text-ink", sub && "ps-6 text-[12px]")}>
        {sub ? (item.tab ?? item.label) : item.label}
        <Keys path={item.path} />
      </Link>
    ) : (
      <span key={item.path} aria-disabled="true" title={`Comes in ${item.phase}`} className={cn("block cursor-default px-2.5 py-1.5 text-[13px] text-ink-3 opacity-60", sub && "ps-6 text-[12px]")}>
        {sub ? (item.tab ?? item.label) : item.label}
      </span>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-ui="rail-initial"
          aria-label={`${name} pages`}
          onPointerEnter={show}
          onPointerLeave={hide}
          className="mx-auto hidden h-5 w-8 items-center justify-center whitespace-nowrap font-mono text-[10px] uppercase text-ink-3 hover:text-ink group-data-[collapsible=icon]:flex"
        >
          {initial}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={10}
          data-ui="rail-flyout"
          onPointerEnter={show}
          onPointerLeave={hide}
          className="z-50 min-w-48 bg-surface-float py-1.5 shadow-[var(--shadow-float)]"
        >
          <div className="px-2.5 pb-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">{name}</div>
          <nav aria-label={`${name} pages`}>
            {items.map((item) => (
              <div key={item.path}>
                {link(item)}
                {item.children?.map((c) => link(c, true))}
              </div>
            ))}
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type GroupProps = {
  name: string;
  items: NavItem[];
  /** Home's group has no heading. */
  heading?: boolean;
  /** Coming soon: the one group that folds (shut until opened, not remembered). On the folded rail it is only its flyout. */
  soon?: boolean;
};

/**
 * A sidebar group: a plain label (`// RUN`) over its rows, always open; groups hold one to three
 * rows, so folding them saves nothing. Folded to icons, the label becomes an initial with a
 * flyout, and groups sit 16px apart against 4px between rows, so the structure shows.
 */
function Group({ name, items, heading = true, soon = false }: Readonly<GroupProps>) {
  const { state, isMobile } = useSidebar();
  const [soonOpen, setSoonOpen] = useState(false);
  const iconOnly = state === "collapsed" && !isMobile;
  const initial = soon ? "…" : name.charAt(0);

  if (soon && iconOnly) {
    return (
      <SidebarGroup className="px-2 pt-4">
        <RailFlyout name={name} items={items} initial={initial} />
      </SidebarGroup>
    );
  }

  const rows = (
    <SidebarGroupContent>
      <SidebarMenu className="gap-1">
        {items.map((item) => (
          <Page key={item.path} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  );
  const gap = heading ? "group-data-[collapsible=icon]:pt-4" : "";

  if (soon) {
    return (
      <Collapsible open={soonOpen} onOpenChange={setSoonOpen} className="group/collapsible">
        <SidebarGroup className="px-2 py-0.5">
          <SidebarGroupLabel asChild data-ui="nav-group" className="h-6 cursor-pointer font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 hover:text-ink">
            <CollapsibleTrigger>
              {name}
              <ChevronRight className="ms-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>{rows}</CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    );
  }

  return (
    <SidebarGroup className={cn("px-2 py-0.5 group-data-[collapsible=icon]:py-0", gap)}>
      {heading && (
        <SidebarGroupLabel data-ui="nav-group" className="h-6 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 group-data-[collapsible=icon]:hidden">
          {name}
        </SidebarGroupLabel>
      )}
      {heading && <RailFlyout name={name} items={items} initial={initial} />}
      {rows}
    </SidebarGroup>
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
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  useGoShortcuts({ go: (path) => navigate(path, { viewTransition: true }), toggleSidebar });
  const reduceMotion = useUi((s) => s.reduceMotion);
  const status = useNavStatus();
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <StatusContext.Provider value={status}>
        <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
          <Sidebar collapsible="icon">
            <SidebarHeader className="gap-2 px-2 pb-2 pt-0">
              <div className="flex h-14 items-center gap-3 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
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
                {/* The wordmark: "dd." with the dot in the accent. */}
                <span data-ui="wordmark-neon" className="group-data-[collapsible=icon]:hidden">
                  dd<span>.</span>
                </span>
              </div>
              <WorkspaceSwitcher />
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
      </StatusContext.Provider>
    </LazyMotion>
  );
}
