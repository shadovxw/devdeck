import { ChevronDown, GitBranch, Layers, Monitor, Moon, SunMoon, Sun } from "lucide-react";
import { Fragment, type CSSProperties } from "react";
import { Link, NavLink, Outlet } from "react-router";

import { Logo } from "../design/Logo";
import { useHealth, usePlugins } from "../lib/queries";
import { useSocketStatus } from "../lib/socket";
import type { ToolState } from "../lib/types";
import { useUi, type Theme } from "../store/ui";
import { NAV } from "./nav";

// The dock is dark in both themes, so its mark always uses the dark-background colours.
const darkMark = { "--mark-prompt": "#4ee8b5", "--mark-under": "#2aeab4" } as CSSProperties;

const dockBtn =
  "relative grid size-11 shrink-0 place-items-center rounded-ctl text-dock-ink transition-colors " +
  "hover:bg-dock-hover hover:text-white aria-[current=page]:bg-dock-active aria-[current=page]:text-dock-accent " +
  "before:absolute before:-left-[6px] before:bottom-2.5 before:top-2.5 before:w-[3px] before:rounded-r " +
  "before:bg-transparent aria-[current=page]:before:bg-dock-accent";

function Dock() {
  return (
    <nav
      aria-label="Pages"
      className="sticky top-0 flex h-screen flex-col items-center gap-1 overflow-y-auto bg-dock-bg py-3 [scrollbar-width:none]"
    >
      <NavLink to="/" aria-label="devdeck home" title="devdeck" style={darkMark} className="mb-3 grid size-11 shrink-0 place-items-center">
        <Logo className="size-[34px]" />
      </NavLink>
      {NAV.map((group, i) => (
        <Fragment key={group.name}>
          {i > 0 && <hr className="my-2 w-7 shrink-0 border-0 border-t border-dock-line" />}
          {group.items.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/"} aria-label={item.label} title={item.label} className={dockBtn}>
              <item.icon size={21} strokeWidth={1.7} />
            </NavLink>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}

const stateColor: Record<ToolState, string> = {
  ok: "var(--good)",
  degraded: "var(--warning)",
  outdated: "var(--serious)",
  missing: "var(--critical)",
};

/** One dot per tool plugin, so the top bar answers "is my machine ready?" at a glance. */
function ToolChips() {
  const { data } = usePlugins();
  const tools = (data ?? []).filter((p) => (p.needs?.length ?? 0) > 0);
  return (
    <ul className="m-0 hidden list-none items-center gap-5 p-0 md:flex">
      {tools.map((p) => (
        <li key={p.id}>
          <Link
            to="/plugins"
            title={`${p.name}: ${p.status.state}${p.status.detail ? `. ${p.status.detail}` : ""}`}
            className="inline-flex items-center gap-2 rounded-ctl px-1 py-1 text-[14px] text-ink-2 hover:text-ink"
          >
            <span className="size-2.5 rounded-full" style={{ background: stateColor[p.status.state] }} aria-hidden />
            {p.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

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
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-surface-1 px-4 md:px-6">
      <Link
        to="/workspaces"
        title="No workspace yet"
        className="inline-flex h-9 items-center gap-2.5 rounded-ctl border border-line-strong px-3 text-[14px] font-semibold text-ink hover:bg-fill"
      >
        <Layers size={17} className="text-ink-3" aria-hidden />
        <span className="hidden sm:inline">No workspace</span>
        <ChevronDown size={15} className="text-ink-3" aria-hidden />
      </Link>
      <span className="mx-1 hidden h-7 w-px bg-line md:block" aria-hidden />
      <ToolChips />
      <span className="flex-1" />
      <span className="hidden items-center gap-2 text-[14px] text-ink-3 sm:inline-flex" title="Connect a repository to see its branch">
        <GitBranch size={17} aria-hidden />
        No repo
      </span>
      <span className="mx-1 hidden h-7 w-px bg-line sm:block" aria-hidden />
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
  return (
    <div className="grid min-h-screen grid-cols-[56px_minmax(0,1fr)]">
      <Dock />
      <div className="flex min-w-0 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1240px] px-4 py-7 md:px-10 md:py-9">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
