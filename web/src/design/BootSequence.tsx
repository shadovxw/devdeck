import { startOrder } from "../lib/runs";
import type { ServiceStatus, StackDef } from "../lib/types";
import { ServiceStateMark } from "./ServiceStateMark";

type Props = {
  stack: StackDef;
  /** The live status of each service by id; empty when the stack isn't running. */
  services: Record<string, ServiceStatus | undefined>;
};

const label = (id: string) => (id === "compose" ? "Dependencies" : id);

/**
 * The order a stack starts in, as columns left to right. Every dot and every
 * line between columns follows the real status from the supervisor: a line fills
 * once everything before it is ready. Nothing here is a timer.
 */
export function BootSequence({ stack, services }: Props) {
  const columns = startOrder(stack);
  if (columns.length === 0) return null;
  const ready = (ids: string[]) => ids.every((id) => services[id]?.state === "ready");

  return (
    <ol aria-label="Start order" className="m-0 flex list-none flex-wrap items-stretch gap-y-3 p-0">
      {columns.map((ids, i) => (
        <li key={ids.join("+")} className="flex items-stretch">
          {i > 0 && <span className="boot-link my-auto w-8 sm:w-12" data-on={ready(columns[i - 1])} aria-hidden />}
          <ul className="m-0 flex list-none flex-col justify-center gap-2 p-0">
            {ids.map((id) => {
              const status = services[id];
              const state = status?.state ?? "stopped";
              return (
                <li
                  key={id}
                  data-state={state}
                  className={`flex items-center gap-2.5 rounded-ctl px-3 py-2 text-[13px] transition-colors duration-300 ${
                    state === "ready" ? "bg-accent-soft" : "bg-inset"
                  }`}
                >
                  <ServiceStateMark state={state} label={false} />
                  <span className="font-medium text-ink">{label(id)}</span>
                  {status?.port ? <span className="font-mono text-xs text-ink-3">:{status.port}</span> : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
