import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Actions are shadcn badges (pills) drawn on the sidebar's own background, so they look
// like part of the same surface as the rest of the app's chrome. Apply the class to a
// <button> or a link; the badge does the rounding, sizing and focus ring.
const action =
  "h-8 cursor-pointer gap-2 border-line px-3.5 text-[13px] font-medium transition hover:bg-fill active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-sidebar";

/** An ordinary action: Check, Add a rule, Copy, Discard. */
export const pill = cn(badgeVariants({ variant: "outline" }), action, "bg-sidebar text-ink");

/** An action that removes or deletes something: no fill, a red outline, the ordinary text colour. */
export const pillDanger = cn(badgeVariants({ variant: "outline" }), action, "border-critical bg-transparent text-ink disabled:hover:bg-transparent");

/** The main action of a block: Save changes, Set up helper. */
export const pillPrimary = cn(badgeVariants({ variant: "default" }), action, "border-transparent bg-accent text-on-accent hover:bg-accent hover:brightness-110");

/** A dropdown in a table: the sidebar's background and a thin outline, with square-ish corners (a dropdown is not an action). */
export const pillSelect =
  "h-8 w-full min-w-0 cursor-pointer rounded-ctl border border-line bg-sidebar px-3 text-[13px] text-ink outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent";

/** The "add something" actions at the head of a block: square corners, not a pill. */
export const squareAdd = cn(pillPrimary, "rounded-none");

/** A text field in a table or beside an action: the same background and outline as the dropdowns. */
export const pillInput =
  "h-8 min-w-0 rounded-ctl border border-line bg-sidebar px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent";

/** A smaller pill for the buttons inside a table row. */
export const pillSmall = cn(pill, "h-7 px-3 text-[12px]");
