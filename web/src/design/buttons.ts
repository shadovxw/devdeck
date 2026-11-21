// btn-primary and btn-quiet are not Tailwind classes: they are hooks for the Neon style (design/looks.css).

/** The blue button used for a page's main next step: one per view. */
export const primaryButton =
  "btn-primary inline-flex h-[34px] items-center gap-2 bg-primary px-3.5 text-[13px] font-medium text-primary-foreground " +
  "transition-colors hover:bg-primary-hover active:bg-primary-hover";

/** The quieter button beside it, on --fill. */
export const quietButton =
  "btn-quiet inline-flex h-[34px] items-center gap-2 bg-fill px-3.5 text-[13px] font-medium text-ink transition-colors " +
  "hover:bg-fill-hover active:bg-fill-press";
