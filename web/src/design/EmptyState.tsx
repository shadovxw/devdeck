import { ArrowRight, BookOpen, Plus, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import type { Empty } from "../app/nav";
import { stagger } from "../lib/motion";
import { primaryButton, quietButton } from "./buttons";
import { EmptyArt } from "./EmptyArt";

type Props = {
  /** The icon on the illustration's centre tile. */
  icon: LucideIcon;
  empty: Empty;
  /** Shown in the disabled button's tooltip when the page isn't built yet. */
  phase?: string;
  /** Makes a button without a link work: the page handles the click. */
  onCta?: () => void;
};

const primary = primaryButton;

/** What a page shows when it has nothing to show yet: art, a headline, one next step. */
export function EmptyState({ icon, empty, phase, onCta }: Props) {
  const { cta, secondary } = empty;
  const CtaIcon = cta?.icon ?? Plus;

  return (
    <section className="flex flex-col items-center px-2 pb-10 pt-4 text-center">
      <div className="enter flex w-full justify-center" style={stagger(1)}>
        <EmptyArt centerIcon={icon} />
      </div>
      <h2 className="enter m-0 mt-3 text-[26px] font-bold leading-tight tracking-tight text-ink" style={stagger(2)}>
        {empty.headline}
      </h2>
      <p className="enter m-0 mt-2.5 max-w-[56ch] text-[15px] leading-6 text-ink-3" style={stagger(3)}>
        {empty.text}
      </p>

      {(cta || secondary) && (
        <div className="enter mt-7 flex flex-wrap items-center justify-center gap-4" style={stagger(4)}>
          {cta &&
            (cta.to ? (
              <Link to={cta.to} viewTransition className={primary}>
                <CtaIcon size={18} aria-hidden />
                {cta.label}
                <ArrowRight size={17} aria-hidden />
              </Link>
            ) : (
              <button
                type="button"
                disabled={!onCta}
                onClick={onCta}
                title={onCta ? undefined : phase ? `Available in ${phase}` : "Not available yet"}
                className={onCta ? primary : `${primary} cursor-not-allowed opacity-45 hover:brightness-100`}
              >
                <CtaIcon size={18} aria-hidden />
                {cta.label}
                <ArrowRight size={17} aria-hidden />
              </button>
            ))}
          {secondary && (
            <a
              href={secondary.href}
              target="_blank"
              rel="noreferrer noopener"
              className={quietButton}
            >
              <BookOpen size={18} aria-hidden />
              {secondary.label}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
