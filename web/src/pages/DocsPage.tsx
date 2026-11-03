import { BookOpen } from "lucide-react";
import { lazy, Suspense } from "react";
import { Link, useParams } from "react-router";

import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { useDoc, useDocs } from "../lib/docs";

// The Markdown renderer is the biggest part of this page, and only this page needs it.
const Markdown = lazy(() => import("./docs/Markdown"));

/** The guides built into devdeck: setup, Claude Code, Docker builds, remote hosts. Code blocks have a Copy button. */
export function DocsPage() {
  const { id } = useParams();
  const list = useDocs();
  const guides = list.data ?? [];
  const current = id ?? guides[0]?.id;
  const doc = useDoc(current);

  return (
    <>
      <PageHeader title="Docs" group="Platform" description="The guides that come with devdeck. Copy a block and paste it where it says." />

      {list.isPending && <output aria-label="Loading the guides…" className="skeleton mt-6 block h-48 w-full" />}
      {list.isError && (
        <p role="alert" className="mt-6 text-[14px] text-ink">
          The guides couldn’t be read: {list.error.message}
        </p>
      )}
      {list.isSuccess && guides.length === 0 && <EmptyState icon={BookOpen} empty={{ headline: "No guides", text: "This build of devdeck has no guides inside it." }} />}

      {guides.length > 0 && (
        <div className="mt-6 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="Guides" className="flex flex-col gap-px self-start lg:sticky lg:top-20">
            {guides.map((g) => (
              <Link
                key={g.id}
                to={`/docs/${g.id}`}
                aria-current={g.id === current ? "page" : undefined}
                className={`px-3 py-1.5 text-[13.5px] transition-colors ${g.id === current ? "bg-fill font-medium text-ink" : "text-ink-2 hover:bg-fill hover:text-ink"}`}
              >
                {g.title}
              </Link>
            ))}
          </nav>

          <article aria-label={guides.find((g) => g.id === current)?.title} className="min-w-0 pb-16">
            {doc.isPending && <output aria-label="Loading the guide…" className="skeleton block h-64 w-full" />}
            {doc.isError && (
              <p role="alert" className="text-[14px] text-ink">
                {doc.error.message}
              </p>
            )}
            {doc.data !== undefined && (
              <Suspense fallback={<output aria-label="Loading the guide…" className="skeleton block h-64 w-full" />}>
                <Markdown text={doc.data} ids={guides.map((g) => g.id)} />
              </Suspense>
            )}
          </article>
        </div>
      )}
    </>
  );
}
