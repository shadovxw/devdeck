import { stagger } from "../lib/motion";

type Props = {
  title: string;
  /** Group the page belongs to, shown before the title in the breadcrumb. */
  group: string;
  /** For a sub-page: the parent page, shown between the group and the title. */
  parent?: string;
};

/** Breadcrumb and the page title: all a page needs at the top. */
export function PageHeader({ title, group, parent }: Props) {
  return (
    <header className="enter" style={stagger(0)}>
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
      <h1 className="m-0 mt-2 text-[32px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
    </header>
  );
}
