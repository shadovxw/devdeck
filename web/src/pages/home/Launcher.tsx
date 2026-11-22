import { Search, Terminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";

import { shortcutKeys } from "../../app/shortcuts";
import { workspaceLabel } from "../../app/WorkspaceSwitcher";
import { EmptyArt } from "../../design/EmptyArt";
import { EmptyOrb } from "../../design/EmptyOrb";
import { stagger } from "../../lib/motion";
import { useRuns, useWorkspaces } from "../../lib/queries";
import { useLink } from "../../lib/use-server-link";
import { useUi } from "../../store/ui";
import { launchLegend, orbitNodes, orbStatus, searchPages, type OrbitNode } from "./launch";
import { greeting, shortDate } from "./NeonHome";

/**
 * "Where to?": a page search. Typing lists the pages that match (by name, group, or what the page
 * is for); arrows move, Enter opens, Escape clears (and closes when empty). The full palette, with
 * stacks and actions from anywhere, is hub milestone H2.
 */
function WhereTo({ onClose }: Readonly<{ onClose: () => void }>) {
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = searchPages(query);
  const open = results.length > 0;
  const current = Math.min(active, results.length - 1);

  const go = (path: string) => navigate(path, { viewTransition: true });

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((current + 1) % results.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((current - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      go(results[current].path);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (query) setQuery("");
      else onClose();
    }
  }

  return (
    <div data-ui="where-to" className="relative w-full max-w-[640px]">
      <label data-ui="where-to-bar" className="flex h-[60px] items-center gap-3 px-5">
        <Search size={18} aria-hidden className="shrink-0 text-ink-3" />
        <input
          type="text"
          role="combobox"
          aria-label="Where to?"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${current}` : undefined}
          placeholder="Where to?"
          autoComplete="off"
          spellCheck={false}
          // The search opens on purpose (the chip or Ctrl K), so it takes the focus.
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => !query && onClose()}
          className="min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      <ul id={listId} role="listbox" aria-label="Pages" hidden={!open} data-ui="where-to-list" className="absolute inset-x-0 top-full z-20 m-0 mt-1 list-none p-1">
        {results.map((item, i) => {
          const Icon = item.icon;
          const keys = shortcutKeys(item.path);
          return (
            <li
              key={item.path}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              data-active={i === current || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item.path)}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[14px] text-ink-2 data-[active]:bg-fill data-[active]:text-ink"
            >
              <Icon size={16} aria-hidden className="shrink-0 text-ink-3" />
              <span className="flex-1 truncate">{item.label}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">{item.parent ?? item.group}</span>
              {keys && (
                <span aria-hidden className="inline-flex gap-0.5 font-mono text-[10px]">
                  {keys.map((k) => (
                    <kbd key={k} className="bg-fill px-1 py-px text-ink-2">
                      {k}
                    </kbd>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** How long the pick's flight to the sidebar takes, with room to spare (pieces.css, launch-pick). */
const LAUNCH_MS = 1200;

/**
 * Picking a page: its name flies into its row of the sidebar as the sidebar slides in
 * (dev-plans/2026-11-21-portfolio-look §8c). The node and, on the next page, the sidebar's
 * current row share one view-transition name for that one change.
 */
function launch(e: MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.setProperty("view-transition-name", "launch-pick");
  const root = document.documentElement;
  root.dataset.launch = "";
  globalThis.setTimeout(() => delete root.dataset.launch, LAUNCH_MS);
}

/** One page around the orb: a diamond in its group's colour, its name, and what it is for. */
function Node({ node, index }: Readonly<{ node: OrbitNode; index: number }>) {
  const { item, tone, cos, sin, side } = node;
  const keys = shortcutKeys(item.path);
  return (
    <li data-ui="orbit-node" data-side={side} data-tone={tone} style={{ "--cos": cos, "--sin": sin, ...stagger(3 + (index % 4)) } as CSSProperties} className="enter">
      <Link to={item.path} viewTransition onClick={launch} data-ui="orbit-link" aria-keyshortcuts={keys?.join(" ")} title={keys ? `${item.label} (${keys.join(" ")})` : item.label}>
        <span data-ui="orbit-name">
          <span data-ui="orbit-diamond" aria-hidden />
          {item.label}
        </span>
        {item.hint && <span data-ui="orbit-hint">{item.hint}</span>}
      </Link>
    </li>
  );
}

/**
 * Home: the orb launcher, with no sidebar (the "Home without sidebar" design,
 * dev-plans/2026-11-21-portfolio-look §8c). The greeting and what devdeck is for at the top, the
 * orb in the middle with every page around it, coloured by group, and a legend at the bottom.
 * Picking a page carries its name into the sidebar, which slides in. The same every time; what
 * runs now is on Overview. Ctrl K (or the chip) searches the pages by name.
 */
export function Launcher() {
  const name = useUi((s) => s.name.trim());
  const workspaces = useWorkspaces();
  const runs = useRuns();
  const link = useLink();
  const orb = link.view === "reconnecting" ? { state: "warn" as const, text: "Thinking · Reconnecting" } : orbStatus(runs.data);
  const nodes = orbitNodes();
  const legend = launchLegend();
  const date = new Date();
  const running = (runs.data?.length ?? 0) > 0;
  const [searching, setSearching] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);

  // Ctrl K (or Cmd K) opens the page search, here on Home.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The orb's line leads on: to Overview while stacks run; with no workspace yet, to Workspaces,
  // whose hero has the orb too, so it is carried across (P9c).
  let goTo: { to: string; title: string; text?: string } | undefined;
  if (orb.state === "warn") goTo = undefined;
  else if (running) goTo = { to: "/overview", title: "Open Overview" };
  else if (workspaces.data?.length === 0) goTo = { to: "/workspaces", title: "Configure a workspace", text: "Idle · Set up a workspace" };

  return (
    <div data-ui="launcher">
      <header data-ui="launcher-head" className="enter" style={stagger(0)}>
        <div className="flex flex-col gap-2">
          <span data-ui="launcher-mark" aria-label="devdeck">
            dd<span>.</span>
          </span>
          <span data-ui="kicker">
            {workspaces.data?.length === 0 ? "No workspace yet" : `Workspace · ${workspaceLabel(workspaces.data)}`} · {shortDate(date)}
          </span>
        </div>
        <button ref={chip} type="button" data-ui="launcher-search" onClick={() => setSearching(true)} title="Find a page by name" aria-keyshortcuts="Control+K">
          Ctrl K
        </button>
      </header>

      {searching && (
        <div data-ui="where-to-layer">
          <WhereTo
            onClose={() => {
              setSearching(false);
              chip.current?.focus();
            }}
          />
        </div>
      )}

      <div data-ui="launcher-intro" className="enter" style={stagger(1)}>
        <h1 data-ui="greeting" className="m-0">
          {greeting(date)}
          {name && `, ${name}`}
          <span aria-hidden>.</span>
        </h1>
        <p data-ui="launcher-about" className="m-0">
          devdeck is your cockpit for local development: <span>link your repos, run their stacks, watch logs and health</span>, all in one place. Pick where to go.
        </p>
      </div>

      <div data-ui="launcher-orb">
        <EmptyOrb size="launcher" state={orb.state} fallback={<EmptyArt centerIcon={Terminal} />} />
      </div>
      {goTo ? (
        <Link to={goTo.to} viewTransition data-ui="orb-state" data-state={orb.state} title={goTo.title} className="enter hover:text-ink" style={stagger(2)}>
          <span data-ui="orb-diamond" aria-hidden />
          {goTo.text ?? orb.text}
        </Link>
      ) : (
        <span data-ui="orb-state" data-state={orb.state} className="enter" style={stagger(2)}>
          <span data-ui="orb-diamond" aria-hidden />
          {orb.text}
        </span>
      )}

      <nav aria-label="Launch" data-ui="orbit">
        <ul className="m-0 list-none p-0">
          {nodes.map((node, i) => (
            <Node key={node.item.path} node={node} index={i} />
          ))}
        </ul>
      </nav>

      <ul data-ui="launch-legend" aria-label="Groups" className="enter m-0 list-none p-0" style={stagger(7)}>
        {legend.map((g) => (
          <li key={g.name} data-tone={g.tone}>
            <span data-ui="legend-dot" aria-hidden />
            {"// "}
            {g.name}
            <span data-ui="legend-blurb">{g.blurb}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
