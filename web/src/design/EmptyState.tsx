import { ArrowRight, BookOpen, Plus, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import type { Empty } from "../app/nav";
import { EmptyArt } from "./EmptyArt";

type Props = {
  /** The icon on the illustration's centre tile. */
  icon: LucideIcon;
  empty: Empty;
  /** Shown in the disabled button's tooltip when the page isn't built yet. */
  phase?: string;
};

const primary =
  "inline-flex h-11 items-center gap-2.5 rounded-ctl bg-accent px-5 text-[15px] font-medium text-on-accent " +
  "transition hover:brightness-110";

/** What a page shows when it has nothing to show yet: art, a headline, one next step. */
export function EmptyState({ icon, empty, phase }: Props) {
  const { cta, secondary } = empty;
  const CtaIcon = cta?.icon ?? Plus;

  return (
    <section className="flex flex-col items-center px-2 pb-10 pt-8 text-center">
      <EmptyArt centerIcon={icon} />
      <h2 className="m-0 mt-3 text-[26px] font-bold leading-tight tracking-tight text-ink">{empty.headline}</h2>
      <p className="m-0 mt-2.5 max-w-[56ch] text-[15px] leading-6 text-ink-3">{empty.text}</p>

      {(cta || secondary) && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          {cta &&
            (cta.to ? (
              <Link to={cta.to} className={primary}>
                <CtaIcon size={18} aria-hidden />
                {cta.label}
                <ArrowRight size={17} aria-hidden />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title={phase ? `Available in ${phase}` : "Not available yet"}
                className={`${primary} cursor-not-allowed opacity-45 hover:brightness-100`}
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
              className="inline-flex h-11 items-center gap-2.5 rounded-ctl px-3 text-[15px] text-ink-2 hover:bg-accent-soft hover:text-ink"
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
