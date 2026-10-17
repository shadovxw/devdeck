import { ChevronDown, Layers, Monitor, Moon, SunMoon, Sun } from "lucide-react";
import { Link, Outlet } from "react-router";

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
        title="No workspace yet"
        className="inline-flex h-9 items-center gap-2.5 rounded-ctl bg-bg px-3 text-[14px] font-semibold text-ink hover:bg-fill sm:w-60"
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
        className="grid size-9 place-items-center rounded-ctl text-ink-2 hover:bg-accent-soft hover:text-ink"
      >
        <ThemeIcon size={19} strokeWidth={1.7} />
      </button>
    </header>
  );
}

export function Shell() {
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-bg">
        <TopBar />
        <div className="mx-auto w-full max-w-[1440px] px-4 py-7 md:px-10 md:py-9">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
