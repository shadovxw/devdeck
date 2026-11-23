import { StatusMark } from "./StatusMark";
import type { Issue } from "../lib/types";

/** Same shapes as the status pills: an error is a square, a warning a triangle. */
export function Mark({ severity }: { severity: Issue["severity"] }) {
  return <StatusMark level={severity === "error" ? "fail" : "warn"} />;
}

/** Problems found in config files, grouped by file, each with its line. */
export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return <p className="m-0 text-[14px] text-ink-3">No problems found.</p>;
  }
  const byFile = new Map<string, Issue[]>();
  for (const i of issues) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);
  return (
    <div className="flex flex-col gap-4">
      {[...byFile].map(([file, list]) => (
        <div key={file}>
          <p className="m-0 mb-1.5 font-mono text-[13px] text-ink-2">{file}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {list.map((i, n) => (
              <li key={n} className="flex items-start gap-2.5 text-[14px] leading-5">
                <span className="mt-[3px]">
                  <Mark severity={i.severity} />
                </span>
                <span className="w-14 shrink-0 font-mono text-[13px] tabular-nums text-ink-3">{i.line ? `line ${i.line}` : ""}</span>
                <span className="min-w-0 text-ink-2">
                  <span className="sr-only">{i.severity === "error" ? "Error: " : "Warning: "}</span>
                  {i.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
