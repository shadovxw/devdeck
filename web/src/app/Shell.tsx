import { ChevronDown, Layers, Monitor, Moon, SunMoon, Sun } from "lucide-react";
import { useLayoutEffect } from "react";
import { Link, Outlet } from "react-router";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useHealth } from "../lib/queries";
import { useSocketStatus } from "../lib/socket";
import { useUi, type Theme } from "../store/ui";
import { AppSidebar } from "./AppSidebar";

const themeNext: Record<Theme, Theme> = { system: "dark", dark: "light", light: "system" };
const themeIcon = { system: SunMoon, dark: Moon, light: Sun } as const;

function Connection() {
  const health = useHealth();
  const socket = useSocketStatus();
  const apiOk = health.data?.status === "ok" && !health.isError;
  const live = socket === "open";
  const color = !apiOk ? "var(--critical)" : live ? "var(--good)" : "var(--warning)";
  const text = !apiOk ? "Server not reachable" : live ? "Server connected, live updates on" : `Server connected, live updates ${socket}`;
  return (
    <span className="relative grid size-9 place-items-center text-ink-2" title={health.data ? `${text} · ${health.data.version}` : text}>
      <Monitor size={20} strokeWidth={1.7} aria-hidden />
      <span className="absolute bottom-1 right-0.5 size-2.5 rounded-full ring-2 ring-surface-1" style={{ background: color }} aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  );
}

function TopBar() {
  const { theme, setTheme } = useUi();
  const ThemeIcon = themeIcon[theme];
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 bg-surface-1 px-3 md:px-5">
      <SidebarTrigger className="size-9 text-ink-2" title="Expand or collapse the sidebar (Ctrl+B)" />
      <Link
        to="/workspaces"
        viewTransition
        title="No workspace yet"
        className="inline-flex h-9 items-center gap-2.5 rounded-ctl bg-bg px-3 text-[14px] font-semibold text-ink transition hover:bg-fill active:scale-[.98] sm:w-60"
      >
        <Layers size={17} className="text-ink-3" aria-hidden />
        <span className="hidden flex-1 text-start sm:inline">No workspace</span>
        <ChevronDown size={15} className="text-ink-3" aria-hidden />
      </Link>
      <span className="flex-1" />
      <Connection />
      <button
        type="button"
        onClick={() => setTheme(themeNext[theme])}
        title={`Theme: ${theme}. Click to switch.`}
        aria-label={`Theme: ${theme}`}
        className="grid size-9 place-items-center rounded-ctl text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-95"
      >
        <ThemeIcon size={19} strokeWidth={1.7} />
      </button>
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
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-accent focus:px-3 focus:py-2 focus:text-[14px] focus:font-medium focus:text-on-accent"
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
