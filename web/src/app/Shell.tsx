import { ChevronDown, Layers } from "lucide-react";
import { useLayoutEffect } from "react";
import { Link, Outlet } from "react-router";

import { cn } from "@/lib/utils";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useDesktopWindow } from "../lib/desktop";
import { useReportUiState } from "../lib/ui-state";
import { useUi } from "../store/ui";
import { AppSidebar } from "./AppSidebar";
import { WindowControls } from "./WindowControls";

function TopBar() {
  const win = useDesktopWindow();
  const desktop = win !== null;
  const toggleMaximise = () => win?.toggleMaximise();
  return (
    <header
      className={cn("sticky top-0 z-10 flex h-14 items-center gap-3 bg-surface-1 px-3 md:px-5", desktop && "drag-region")}
      // In devdeck's own window a double click on the bar maximises it, as on any title bar.
      onDoubleClick={desktop ? (e) => e.target === e.currentTarget && toggleMaximise() : undefined}
    >
      <SidebarTrigger className="size-9 text-ink-2" title="Expand or collapse the sidebar (Ctrl+B)" />
      <Link
        to="/workspaces"
        viewTransition
        title="No workspace yet"
        className="inline-flex h-9 items-center gap-2.5 px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill sm:w-60"
      >
        <Layers size={17} className="text-ink-3" aria-hidden />
        <span className="hidden flex-1 text-start sm:inline">No workspace</span>
        <ChevronDown size={15} className="text-ink-3" aria-hidden />
      </Link>
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

export function Shell() {
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  useFirstLoad();
  useReportUiState();
  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SkipLink />
      <AppSidebar />
      {/* The top bar is a banner, so it sits beside <main>, not inside it. */}
      <div className="relative flex min-h-svh min-w-0 flex-1 flex-col bg-bg">
        <TopBar />
        <main id="main" tabIndex={-1} className="page-area mx-auto w-full max-w-[1440px] px-3 py-3 outline-none md:px-5 md:py-4">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  );
}
