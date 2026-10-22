import type { ReactNode } from "react";
import { Link } from "react-router";

import { stagger } from "../lib/motion";

type Props = {
  title: string;
  /** Group the page belongs to, shown before the title in the breadcrumb. */
  group: string;
  /** For a sub-page: the parent page, shown between the group and the title. */
  parent?: string;
  /** Where the parent crumb goes, so the way back is one click. */
  parentTo?: string;
  /** Buttons for the page, on the same line as the title, at the right. */
  actions?: ReactNode;
  /** One line under the title saying what the page is for. */
  description?: string;
};

/** Breadcrumb and the page title: all a page needs at the top. */
export function PageHeader({ title, group, parent, parentTo, actions, description }: Props) {
  return (
    <header className="enter" style={stagger(0)}>
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3">
        {[group, parent].filter(Boolean).map((crumb) => (
          <span key={crumb}>
            {crumb === parent && parentTo ? (
              <Link to={parentTo} className="hover:text-ink hover:underline">
                {crumb}
              </Link>
            ) : (
              crumb
            )}
            <span className="mx-2" aria-hidden>
              /
            </span>
          </span>
        ))}
        <span className="font-medium text-ink">{title}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="m-0 text-[32px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {actions}
      </div>
      {description && <p className="m-0 mt-1 text-[14px] text-ink-3">{description}</p>}
    </header>
  );
}
