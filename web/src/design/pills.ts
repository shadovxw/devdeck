import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Actions are badges drawn square on --fill (dev-plans/02-frontend-design-system.md
// section 6.1), with one blue primary per view. Apply the class to a <button> or a
// link; the global :focus-visible outline in index.css is the focus ring.
const action =
  "h-[34px] cursor-pointer gap-2 px-3.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-45";

/** An ordinary action: Check, Add a rule, Copy, Discard. */
export const pill = cn(badgeVariants({ variant: "secondary" }), action, "hover:bg-fill-hover active:bg-fill-press");

/** An action that removes or deletes something: the ordinary fill with the failure colour for the word. */
export const pillDanger = cn(badgeVariants({ variant: "secondary" }), action, "text-critical hover:bg-fill-hover active:bg-fill-press");

/** The main action of a block: Save changes, Set up helper. */
export const pillPrimary = cn(badgeVariants({ variant: "default" }), action, "hover:bg-primary-hover active:bg-primary-hover");

/** A dropdown in a table: on --fill, no border. */
export const pillSelect =
  "h-[34px] w-full min-w-0 cursor-pointer bg-fill px-3 text-[13px] text-ink outline-none hover:bg-fill-hover";

/** The "add something" actions at the head of a block. */
export const squareAdd = pillPrimary;

/** A text field in a table or beside an action: the same look as the dropdowns. */
export const pillInput =
  "h-[34px] min-w-0 bg-fill px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill-hover";

/** A smaller button for the rows of a table. */
export const pillSmall = cn(pill, "h-7 px-3 text-[12px]");
