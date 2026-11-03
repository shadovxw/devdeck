import { useState } from "react";

import { pill, pillDanger } from "../../design/pills";
import { useClearBuilds, type BuildRecord } from "../../lib/docker";
import { ago, took } from "../../lib/time";
import { useNow } from "../../lib/use-now";
import { Mark, short } from "./parts";

const th = "px-3 py-2 text-start text-[13px] font-medium text-ink-3";
const td = "px-3 py-2 align-top";

/** The builds that finished, newest first, with a way to clear the list. */
export function History({ builds }: Readonly<{ builds: BuildRecord[] }>) {
  const now = useNow(true, 30_000);
  const clear = useClearBuilds();
  const [sure, setSure] = useState(false);
  return (
    <section id="build-history" aria-label="Build history" className="mt-6 flex flex-col gap-3 rounded-ctl bg-inset p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[16px] font-medium text-ink">Build history</h2>
        {builds.length > 0 &&
          (sure ? (
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              Clear the whole list?
              <button
                type="button"
                className={pillDanger}
                onClick={() => {
                  clear.mutate();
                  setSure(false);
                }}
              >
                Clear
              </button>
              <button type="button" className={pill} onClick={() => setSure(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className={pill} onClick={() => setSure(true)}>
              Clear list
            </button>
          ))}
      </div>
      {builds.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">Nothing has been built yet.</p>
      ) : (
        <div className="max-h-[22rem] overflow-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Image</th>
                <th className={th}>Commit</th>
                <th className={th}>Account</th>
                <th className={th}>Result</th>
                <th className={th}>Took</th>
              </tr>
            </thead>
            <tbody>
              {builds.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className={`${td} whitespace-nowrap text-[13px] text-ink-2`}>{ago(b.at, now)}</td>
                  <td className={`${td} font-mono text-[12px] text-ink`}>
                    {b.repository}:{b.tag}
                  </td>
                  <td className={`${td} font-mono text-[12px] text-ink-2`}>
                    {short(b.revision) || "—"}
                    {b.dirty ? " +changes" : ""}
                  </td>
                  <td className={`${td} text-[13px] text-ink-2`}>{b.account}</td>
                  <td className={td} title={b.error}>
                    <Mark ok={b.ok}>{b.ok ? "Pushed" : "Failed"}</Mark>
                  </td>
                  <td className={`${td} whitespace-nowrap text-[13px] text-ink-3`}>{took(b.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
