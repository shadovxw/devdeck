import { Laptop } from "lucide-react";

import { stagger } from "../lib/motion";

type Props = {
  title: string;
  /** Group the page belongs to, shown before the title in the breadcrumb. */
  group: string;
  /** For a sub-page: the parent page, shown between the group and the title. */
  parent?: string;
  /** The plan phase that builds the page; shown while the page is a placeholder. */
  phase?: string;
};

/** Breadcrumb, big title and scope chip at the top of every page. */
export function PageHeader({ title, group, parent, phase }: Props) {
  return (
    <header className="enter border-b border-line pb-5" style={stagger(0)}>
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3">
        {[group, parent].filter(Boolean).map((crumb) => (
          <span key={crumb}>
            {crumb}
            <span className="mx-2" aria-hidden>
              /
            </span>
          </span>
        ))}
        <span className="font-medium text-ink">{title}</span>
      </nav>
      <h1 className="m-0 mt-3 text-[32px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[14px] text-ink-3">
        {phase && (
          <>
            <span title="The plan phase that builds this page">{phase}</span>
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
          </>
        )}
        <span
          className="inline-flex items-center gap-2 rounded-tag bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent"
          title="Everything here runs on this machine"
        >
          <Laptop size={15} aria-hidden />
          Local workspace
        </span>
      </div>
    </header>
  );
}
