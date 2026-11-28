import { useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router";

import { cn } from "@/lib/utils";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useDesktopWindow } from "../lib/desktop";
import { useReportUiState } from "../lib/ui-state";
import { useUi } from "../store/ui";
import { AppSidebar } from "./AppSidebar";
import { LinkStrip } from "./LinkStrip";
import { UpdateNotice } from "./UpdateNotice";
import { WindowControls } from "./WindowControls";

function TopBar({ bare }: Readonly<{ bare: boolean }>) {
  const win = useDesktopWindow();
  const desktop = win !== null;
  const toggleMaximise = () => win?.toggleMaximise();
  // On the bare Home there is no sidebar to toggle; devdeck's own window keeps its buttons.
  if (bare && !desktop) return null;
  return (
    <header
      data-ui="topbar"
      className={cn("sticky top-0 z-10 flex h-14 items-center gap-3 bg-surface-1 px-3 md:px-5", desktop && "drag-region")}
      // In devdeck's own window a double click on the bar maximises it, as on any title bar.
      onDoubleClick={desktop ? (e) => e.target === e.currentTarget && toggleMaximise() : undefined}
    >
      {!bare && <SidebarTrigger className="size-9 text-ink-2" title="Expand or collapse the sidebar (Ctrl+B)" />}
      {/* The workspace switcher is in the sidebar's header (app/WorkspaceSwitcher.tsx). */}
      <span className="flex-1" />
      <WindowControls />
    </header>
  );
}

/** First tab stop: lets keyboard users jump past the sidebar to the page. Shown only while focused. */
function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-primary focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-primary-foreground"
    >
      Skip to content
    </a>
  );
}

/**
 * Marks the first moments after the app appears, so blocks marked .enter rise
 * in once (design/motion.css). Set before paint, so nothing flashes first.
 * Later page changes use the page cross-fade instead.
 */
function useFirstLoad() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.first = "";
    const timer = setTimeout(() => delete root.dataset.first, 600);
    return () => {
      clearTimeout(timer);
      delete root.dataset.first;
    };
  }, []);
}

/**
 * Home is the orb launcher, with no sidebar (dev-plans/2026-11-21-portfolio-look §8c):
 * data-home-bare on <html> parks the sidebar off-screen and frees the page's full width, and
 * leaving Home slides the sidebar in (design/pieces.css).
 */
function useBareHome(): boolean {
  const { pathname } = useLocation();
  const bare = pathname === "/";
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (bare) root.dataset.homeBare = "";
    else delete root.dataset.homeBare;
    return () => {
      delete root.dataset.homeBare;
    };
  }, [bare]);
  return bare;
}

/** Pages that use the whole width and height of the page area: the Projects ring. */
const FULL_BLEED = new Set(["/workspaces"]);

export function Shell() {
  const { pathname } = useLocation();
  const fullBleed = FULL_BLEED.has(pathname);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  const bare = useBareHome();
  useFirstLoad();
  useReportUiState();
  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SkipLink />
      <AppSidebar />
      {/* The top bar is a banner, so it sits beside <main>, not inside it. */}
      <div className="relative flex min-h-svh min-w-0 flex-1 flex-col bg-bg">
        <TopBar bare={bare} />
        <LinkStrip />
        {/* Home has its own view-transition name, so leaving it is a scene change, not a page fade (motion.css). */}
        <main
          id="main"
          tabIndex={-1}
          data-full-bleed={fullBleed || undefined}
          style={bare ? { viewTransitionName: "home" } : undefined}
          className={`page-area mx-auto w-full px-3 py-3 outline-none md:px-5 md:py-4 ${fullBleed ? "flex min-h-0 max-w-none flex-1 flex-col" : "max-w-[1440px]"}`}
        >
          <Outlet />
        </main>
      </div>
      <UpdateNotice />
    </SidebarProvider>
  );
}
