import { Search, Terminal } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";

import { shortcutKeys } from "../../app/shortcuts";
import { workspaceLabel } from "../../app/WorkspaceSwitcher";
import { EmptyArt } from "../../design/EmptyArt";
import { EmptyOrb } from "../../design/EmptyOrb";
import { stagger } from "../../lib/motion";
import { useRuns, useWorkspaces } from "../../lib/queries";
import { useLink } from "../../lib/use-server-link";
import { useUi } from "../../store/ui";
import { launchTiles, orbStatus, searchPages } from "./launch";
import { greeting, shortDate } from "./NeonHome";

/**
 * "Where to?": a page search. Typing lists the pages that match (by name, group, or what the page
 * is for); arrows move, Enter opens, Escape clears. The full Ctrl K palette is hub milestone H2.
 */
function WhereTo() {
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
      setQuery("");
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
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      <ul
        id={listId}
        role="listbox"
        aria-label="Pages"
        hidden={!open}
        data-ui="where-to-list"
        className="absolute inset-x-0 top-full z-20 m-0 mt-1 list-none p-1"
      >
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

/**
 * Home in the Neon style, as a launcher (dev-plans/2026-11-21-portfolio-look §8a): the same every
 * time, a place to go somewhere from. Greeting, the orb (the one part that moves, with its state
 * under it), "Where to?" and one tile per nav group. What runs now is on Overview.
 */
export function Launcher() {
  const name = useUi((s) => s.name.trim());
  const workspaces = useWorkspaces();
  const runs = useRuns();
  const link = useLink();
  const orb = link.view === "reconnecting" ? { state: "warn" as const, text: "Thinking · Reconnecting" } : orbStatus(runs.data);
  const tiles = launchTiles();
  const date = new Date();
  const running = (runs.data?.length ?? 0) > 0;
  // The orb's line leads on: to Overview while stacks run; with no workspace yet, to Workspaces,
  // whose hero has the orb too, so it is carried across (P9c).
  let goTo: { to: string; title: string; text?: string } | undefined;
  if (orb.state === "warn") goTo = undefined;
  else if (running) goTo = { to: "/overview", title: "Open Overview" };
  else if (workspaces.data?.length === 0) goTo = { to: "/workspaces", title: "Configure a workspace", text: "Idle · Set up a workspace" };

  return (
    <div data-ui="launcher" className="flex flex-col items-center gap-0 pb-12">
      <header className="enter flex flex-col gap-2.5 self-stretch" style={stagger(0)}>
        <div data-ui="kicker">
          {workspaces.data?.length === 0 ? "No workspace yet" : `Workspace · ${workspaceLabel(workspaces.data)}`} · {shortDate(date)}
        </div>
        <h1 data-ui="greeting" className="m-0">
          {greeting(date)}
          {name && `, ${name}`}
          <span aria-hidden>.</span>
        </h1>
      </header>

      <EmptyOrb size="launcher" state={orb.state} fallback={<div className="py-8"><EmptyArt centerIcon={Terminal} /></div>} />
      {goTo ? (
        <Link to={goTo.to} viewTransition data-ui="orb-state" data-state={orb.state} title={goTo.title} className="enter hover:text-ink" style={stagger(1)}>
          <span data-ui="orb-diamond" aria-hidden />
          {goTo.text ?? orb.text}
        </Link>
      ) : (
        <span data-ui="orb-state" data-state={orb.state} className="enter" style={stagger(1)}>
          <span data-ui="orb-diamond" aria-hidden />
          {orb.text}
        </span>
      )}

      <div className="enter mt-6 flex w-full justify-center" style={stagger(2)}>
        <WhereTo />
      </div>

      <nav aria-label="Launch" data-ui="launch-grid" className="enter mt-5 grid w-full max-w-[860px] gap-3.5" style={stagger(3)}>
        {tiles.map((tile) => (
          <section key={tile.label} aria-label={tile.label} data-ui="launch-tile" className="flex flex-col gap-2.5 p-[18px]">
            <h2 data-ui="launch-label" className="m-0">
              {"// "}
              {tile.label}
            </h2>
            <ul className="m-0 flex list-none flex-wrap gap-x-1.5 gap-y-1 p-0">
              {tile.pages.map((page, i) => (
                <li key={page.path} className="flex items-center gap-1.5">
                  <Link to={page.path} viewTransition data-ui="launch-link">
                    {page.label}
                  </Link>
                  {/* The dot follows the link, so a wrapped line never starts with one. */}
                  {i < tile.pages.length - 1 && (
                    <span aria-hidden className="text-ink-3">
                      ·
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}
