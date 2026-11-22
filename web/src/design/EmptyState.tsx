import { ArrowRight, BookOpen, Plus, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import type { Empty } from "../app/nav";
import { stagger } from "../lib/motion";
import { primaryButton, quietButton } from "./buttons";
import { EmptyArt } from "./EmptyArt";
import { MiniOrb } from "./EmptyOrb";
import { isGoodNews, type MiniVariant } from "./orb/mini-model";

type Props = {
  /** The icon on the plain art, shown instead of the orb with Effects off or without WebGL. */
  icon: LucideIcon;
  empty: Empty;
  /** The mini orb's variant; the page's own (empty.orb) or plain by default. */
  variant?: MiniVariant;
  /** Shown in the disabled button's tooltip when the page isn't built yet. */
  phase?: string;
  /** Makes a button without a link work: the page handles the click. */
  onCta?: () => void;
};

/**
 * Empty, kind 1: never set up (dev-plans/2026-11-21-portfolio-look §8d). The same small pattern
 * on every page: a mini orb styled for the page, one mono line, one headline, one action and one
 * command. The full orb is Home's only. What the page is for is in the tooltip and for screen
 * readers, so the screen stays short.
 */
export function EmptyState({ icon, empty, variant, phase, onCta }: Readonly<Props>) {
  const { cta, secondary } = empty;
  const orb = variant ?? empty.orb ?? "plain";
  const CtaIcon = cta?.icon ?? Plus;
  const label = (
    <>
      <CtaIcon size={17} aria-hidden />
      {cta?.label}
      <ArrowRight size={16} aria-hidden />
    </>
  );

  return (
    <section data-ui="empty" data-good={isGoodNews(orb) || undefined} aria-label={empty.headline} title={empty.text} className="flex flex-col items-center px-2 pb-10 pt-6 text-center">
      <div className="enter flex justify-center" style={stagger(1)}>
        <MiniOrb variant={orb} fallback={<EmptyArt centerIcon={icon} />} />
      </div>
      {empty.kicker && (
        <p data-ui="empty-kicker" className="enter m-0 mt-3" style={stagger(2)}>
          {empty.kicker}
        </p>
      )}
      <h2 data-ui="empty-title" className="enter m-0 mt-2" style={stagger(2)}>
        {empty.headline}
      </h2>
      <p className="sr-only">{empty.text}</p>

      {(cta || secondary || empty.command) && (
        <div className="enter mt-6 flex flex-wrap items-center justify-center gap-3" style={stagger(3)}>
          {cta &&
            (cta.to ? (
              <Link to={cta.to} viewTransition className={primaryButton}>
                {label}
              </Link>
            ) : (
              <button
                type="button"
                disabled={!onCta}
                onClick={onCta}
                title={onCta ? undefined : phase ? `Available in ${phase}` : "Not available yet"}
                className={onCta ? primaryButton : `${primaryButton} cursor-not-allowed opacity-45 hover:brightness-100`}
              >
                {label}
              </button>
            ))}
          {secondary && (
            <a href={secondary.href} target="_blank" rel="noreferrer noopener" className={quietButton}>
              <BookOpen size={16} aria-hidden />
              {secondary.label}
            </a>
          )}
          {empty.command && (
            <code data-ui="empty-command" title="The same from a terminal">
              $ {empty.command}
            </code>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Empty, kind 2: set up, but nothing happening (no logs because the stack is stopped, no runs
 * today). No orb and no headline: one quiet mono line and, at most, one small action.
 */
export function QuietEmpty({ line, action }: Readonly<{ line: string; action?: { label: string; to?: string; onClick?: () => void } }>) {
  return (
    <div data-ui="quiet-empty" role="status" className="enter flex flex-wrap items-center gap-x-6 gap-y-3 py-14" style={stagger(1)}>
      <p data-ui="quiet-line" className="m-0">
        {line}
      </p>
      {action?.to && (
        <Link to={action.to} viewTransition className={quietButton}>
          {action.label}
        </Link>
      )}
      {action?.onClick && !action.to && (
        <button type="button" onClick={action.onClick} className={quietButton}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Empty, kind 3: a search or filter found nothing. No orb (moving here would only be noise):
 * how many, for what, and a way to clear it.
 */
export function NoResults({ query, onClear }: Readonly<{ query: string; onClear: () => void }>) {
  return (
    <p data-ui="no-results" role="status" className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 py-8">
      <span>0 results for “{query}”</span>
      <button type="button" onClick={onClear} data-ui="no-results-clear">
        Clear filter
      </button>
    </p>
  );
}
