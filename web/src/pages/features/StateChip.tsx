import { StatusDot } from "../../design/StatusDot";
import type { PrState } from "../../lib/features";
import { STATE_LABEL, STATE_TONE } from "./state";

/** A PR's state: a dot in its colour and the word, never the colour alone. Planned and waiting are empty rings. */
export function StateChip({ state }: Readonly<{ state: PrState }>) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink">
      <StatusDot tone={STATE_TONE[state]} ring={state === "planned" || state === "waiting" || state === "closed"} size={7} />
      {STATE_LABEL[state]}
    </span>
  );
}

/** Only a github.com address is linked, whatever the answer from gh says. */
export function githubUrl(url: string | undefined): string | undefined {
  return url?.startsWith("https://github.com/") ? url : undefined;
}
