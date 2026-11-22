import { ArrowRight, BookOpen, Layers, Settings, Terminal } from "lucide-react";
import { Link } from "react-router";

import type { Empty } from "../../app/nav";
import { primaryButton, quietButton } from "../../design/buttons";
import { EmptyArt } from "../../design/EmptyArt";
import { EmptyOrb } from "../../design/EmptyOrb";
import { stagger } from "../../lib/motion";

/**
 * Home with nothing running, in the Neon style (dev-plans/2026-11-21-portfolio-look §6). Without a
 * workspace it is the one hero empty state with the orb; with a workspace but no stack running it
 * is the quiet kind: one line and a small action, no orb.
 */
export function NeonEmptyHome({ hasWorkspace, empty }: Readonly<{ hasWorkspace: boolean; empty: Empty }>) {
  if (hasWorkspace) {
    return (
      <div data-ui="quiet-empty" className="enter flex flex-wrap items-center gap-x-6 gap-y-3 py-16" style={stagger(1)}>
        <p data-ui="quiet-line" className="m-0">
          No stacks running · start one to see it here
        </p>
        <Link to="/stacks" viewTransition className={quietButton}>
          <Layers size={16} aria-hidden />
          Open stacks
        </Link>
      </div>
    );
  }

  return (
    <section data-ui="hero-empty" aria-label="Get started" className="flex flex-col items-center pb-12 pt-2 text-center">
      <div className="enter flex flex-col items-center gap-3" style={stagger(1)}>
        <EmptyOrb size="hero" state="idle" fallback={<EmptyArt centerIcon={Terminal} />} />
        <span data-ui="orb-state">Idle</span>
      </div>
      <div data-ui="kicker" className="enter mt-6" style={stagger(2)}>
        00 $ Boot · no stacks running
      </div>
      <h1 data-ui="hero-title" className="enter m-0 mt-2" style={stagger(2)}>
        Your workspace is ready <span data-ui="gradient-word">to connect</span>.
      </h1>
      <p data-ui="hero-text" className="enter m-0 mt-4 max-w-[56ch]" style={stagger(3)}>
        {empty.text}
      </p>
      <div className="enter mt-8 flex flex-wrap items-center justify-center gap-4" style={stagger(4)}>
        <Link to="/workspaces" viewTransition className={primaryButton}>
          <Settings size={17} aria-hidden />
          Configure workspace
          <ArrowRight size={16} aria-hidden />
        </Link>
        {empty.secondary && (
          <a href={empty.secondary.href} target="_blank" rel="noreferrer" className={quietButton}>
            <BookOpen size={16} aria-hidden />
            Setup guide
          </a>
        )}
      </div>
      <p data-ui="hero-chips" className="enter m-0 mt-6" style={stagger(5)}>
        or run <code>devdeck help</code> in a terminal
      </p>
    </section>
  );
}
