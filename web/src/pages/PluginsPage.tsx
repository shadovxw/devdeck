import { RotateCw } from "lucide-react";

import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { StatusPill } from "../design/StatusPill";
import { stagger } from "../lib/motion";
import { useCheckPlugin, usePlugins } from "../lib/queries";
import type { Plugin } from "../lib/types";

function installHint(p: Plugin): string | undefined {
  if (p.status.state !== "missing") return p.status.detail || p.description;
  const cmds = (p.needs ?? []).flatMap((n) => (n.install ?? []).map((i) => `${i.method}: ${i.command}`));
  return [p.status.detail, ...cmds].filter(Boolean).join("\n");
}

function Row({ plugin }: { plugin: Plugin }) {
  const check = useCheckPlugin();
  const busy = check.isPending && check.variables === plugin.id;
  return (
    <tr className="border-t border-line hover:bg-fill/60" title={plugin.description}>
      <td className="px-4 py-3">
        <StatusPill state={plugin.status.state} title={installHint(plugin)} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className="font-medium">{plugin.name}</span>
        <span className="ms-2 font-mono text-xs text-ink-3">{plugin.id}</span>
      </td>
      <td className="hidden px-4 py-3 text-ink-3 lg:table-cell">{plugin.category}</td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-ink-2">{plugin.status.version ?? ""}</td>
      <td className="hidden max-w-[34ch] truncate px-4 py-3 text-ink-3 lg:table-cell" title={plugin.status.detail}>
        {plugin.status.detail}
      </td>
      <td className="px-3 py-1 text-end">
        <button
          type="button"
          onClick={() => check.mutate(plugin.id)}
          disabled={busy}
          title="Check again"
          aria-label={`Check ${plugin.name} again`}
          className="grid size-8 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90 disabled:opacity-50"
        >
          <RotateCw size={15} className={busy ? "animate-spin" : undefined} />
        </button>
      </td>
    </tr>
  );
}

const th = "px-4 py-2.5 text-start text-[12px] font-medium uppercase tracking-wide text-ink-3";

export function PluginsPage() {
  const item = navByPath("/plugins");
  const { data, isPending, isError, isFetching, refetch } = usePlugins();

  return (
    <>
      <PageHeader title={item.label} group={item.group} phase={item.phase} />

      <section className="enter mt-7 rounded-sheet bg-surface-1" style={stagger(1)}>
        <div className="flex items-center gap-2 px-4 py-3">
          <p className="m-0 flex-1 text-[13px] text-ink-3">{data ? `${data.length} plugins` : ""}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            title="Run every plugin's check again"
            className="inline-flex h-9 items-center gap-2 rounded-ctl px-3 text-[14px] text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-[.97] disabled:opacity-50"
          >
            <RotateCw size={15} className={isFetching ? "animate-spin" : undefined} aria-hidden />
            Check all
          </button>
        </div>

        {isPending && (
          <div role="status" aria-label="Loading plugins" className="flex flex-col gap-4 px-4 pb-6 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-8">
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-4 w-44" />
                <div className="skeleton h-4 w-14" />
              </div>
            ))}
          </div>
        )}
        {isError && <p className="m-0 px-4 py-8 text-ink-3">Could not load plugins.</p>}
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className={th}>Status</th>
                  <th className={th}>Plugin</th>
                  <th className={`${th} hidden lg:table-cell`}>Category</th>
                  <th className={th}>Version</th>
                  <th className={`${th} hidden lg:table-cell`}>Detail</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <Row key={p.id} plugin={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
