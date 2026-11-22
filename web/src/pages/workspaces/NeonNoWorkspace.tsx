import { BookOpen, Plus, Terminal } from "lucide-react";

import type { Empty } from "../../app/nav";
import { primaryButton, quietButton } from "../../design/buttons";
import { EmptyArt } from "../../design/EmptyArt";
import { EmptyOrb } from "../../design/EmptyOrb";
import { stagger } from "../../lib/motion";

type Props = Readonly<{
  empty: Empty;
  /** The setup guide, linked beside the main button. */
  guide?: { label: string; href: string };
  onAdd: () => void;
}>;

/**
 * Workspaces with none yet: the one hero empty state, with the orb
 * (dev-plans/2026-11-21-portfolio-look §8a). It used to be Home's; Home is the launcher now, and
 * this is where a workspace is configured.
 */
export function NeonNoWorkspace({ empty, guide, onAdd }: Props) {
  return (
    <section data-ui="hero-empty" aria-label="Get started" className="flex flex-col items-center pb-12 pt-2 text-center">
      <div className="enter flex flex-col items-center gap-3" style={stagger(1)}>
        <EmptyOrb size="hero" state="idle" fallback={<EmptyArt centerIcon={Terminal} />} />
        <span data-ui="orb-state">Idle</span>
      </div>
      <div data-ui="kicker" className="enter mt-6" style={stagger(2)}>
        00 $ Boot · no workspace yet
      </div>
      <h2 data-ui="hero-title" className="enter m-0 mt-2" style={stagger(2)}>
        Your workspace is ready <span data-ui="gradient-word">to connect</span>.
      </h2>
      <p data-ui="hero-text" className="enter m-0 mt-4 max-w-[56ch]" style={stagger(3)}>
        {empty.text}
      </p>
      <div className="enter mt-8 flex flex-wrap items-center justify-center gap-4" style={stagger(4)}>
        <button type="button" onClick={onAdd} className={primaryButton}>
          <Plus size={17} aria-hidden />
          {empty.cta?.label ?? "Add workspace"}
        </button>
        {guide && (
          <a href={guide.href} target="_blank" rel="noreferrer" className={quietButton}>
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
