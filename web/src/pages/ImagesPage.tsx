import { Container, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { pill } from "../design/pills";
import { useAllImageTags, useBuildJobs, useBuilds, useImages, type ImageRow, type ImageTags } from "../lib/docker";
import { useHosts } from "../lib/hosts";
import { filterImages, imageKey, noImageFilter, sortImages, summarize, tagPattern, type ImageFilter } from "../lib/images";
import { useNow } from "../lib/use-now";
import { BatchBar, BuildDock } from "./images/BuildDock";
import { History } from "./images/History";
import { blockerOf, ImageRowView, listGrid } from "./images/ImageRowView";

const chips: Array<{ chip: ImageFilter["chip"]; label: string }> = [
  { chip: "all", label: "All" },
  { chip: "ahead", label: "Changed since last build" },
  { chip: "dirty", label: "Uncommitted changes" },
  { chip: "never", label: "Never built here" },
];

function SummaryCard({ label, value, note }: Readonly<{ label: string; value: number; note: string }>) {
  return (
    <div className="flex flex-col gap-1 bg-inset p-4">
      <span className="text-[12px] text-ink-3">{label}</span>
      <b className="text-[22px] font-bold leading-none tabular-nums text-ink">{value}</b>
      <span className="text-[12px] text-ink-3">{note}</span>
    </div>
  );
}

/** Build and push Docker images: see where each stands, type a tag, and devdeck builds it on this PC and pushes it with the right account. */
export function ImagesPage() {
  const item = navByPath("/images");
  const images = useImages();
  const builds = useBuilds();
  const hubTags = useAllImageTags();
  const hosts = useHosts();
  const { jobs, enqueue, dismiss } = useBuildJobs();
  const now = useNow(true, 30_000);

  const [filter, setFilter] = useState<ImageFilter>(noImageFilter);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAsking, setBatchAsking] = useState(false);

  const all = useMemo(() => images.data ?? [], [images.data]);
  const rows = useMemo(() => sortImages(filterImages(all, filter)), [all, filter]);
  const summary = summarize(all);
  const running = jobs.filter((j) => j.state === "running" || j.state === "queued").length;
  const hasHosts = (hosts.data?.length ?? 0) > 0;

  const tagOf = (r: ImageRow) => typed[imageKey(r)] ?? "";
  const hubOf = (r: ImageRow): ImageTags | undefined => {
    if (hubTags.isError) return { workspace: r.workspace, repo: r.repo, image: r.image, repository: r.repository, tags: [], error: hubTags.error.message };
    return hubTags.data?.find((h) => imageKey(h) === imageKey(r));
  };
  const active = (r: ImageRow) => jobs.some((j) => j.key === imageKey(r) && (j.state === "running" || j.state === "queued"));

  // The ticked images that can be built now, and why the others are left out.
  const ticked = all.filter((r) => selected.has(imageKey(r)));
  const ready: Array<{ row: ImageRow; tag: string; target: string }> = [];
  const skipped: string[] = [];
  for (const r of ticked) {
    const tag = tagOf(r);
    if (blockerOf(r)) skipped.push(`${r.image} can’t be built yet`);
    else if (!tagPattern.test(tag)) skipped.push(`${r.image} has no valid tag`);
    else if (active(r)) skipped.push(`${r.image} is already queued`);
    else if (hubOf(r)?.tags.some((t) => t.name === tag)) skipped.push(`${r.image}:${tag} already exists on Docker Hub`);
    else ready.push({ row: r, tag, target: `${r.repository}:${tag}` });
  }

  const build = (r: ImageRow, overwrite: boolean) => {
    setAsking(null);
    enqueue([{ row: r, tag: tagOf(r), overwrite }]);
  };

  return (
    <>
      <PageHeader
        title={item.label}
        group={item.group}
        description="Builds on this PC from the commit checked out, then pushes to Docker Hub. Type a tag and confirm."
        actions={
          <Link to="/connections/docker" className={pill}>
            Docker Hub accounts
          </Link>
        }
      />

      {images.isPending && (
        <output aria-label="Loading images…" className="mt-4 grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-36 w-full" />
          ))}
        </output>
      )}
      {images.isError && (
        <p role="alert" className="mt-4 text-[14px] text-ink">
          The images couldn’t be read: {images.error.message}
        </p>
      )}
      {images.data && all.length === 0 && (
        <EmptyState
          icon={Container}
          empty={{
            headline: "No images yet",
            text: "Add images: to a repository in your workspace file, with the Docker Hub repository each one is pushed to.",
            cta: { label: "Open workspaces", to: "/workspaces" },
          }}
        />
      )}

      {all.length > 0 && (
        <>
          <section aria-label="Summary" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="Images" value={summary.total} note={`in ${summary.workspaces} ${summary.workspaces === 1 ? "workspace" : "workspaces"}`} />
            <SummaryCard label="Up to date" value={summary.upToDate} note="last build is the current commit" />
            <SummaryCard label="Changed since last build" value={summary.ahead} note="commits on top of what was built" />
            <SummaryCard label="Building now" value={running} note={running === 0 ? "nothing queued" : "running or waiting"} />
          </section>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={14} aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={filter.text}
                onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
                placeholder="Filter images"
                aria-label="Filter images"
                className="h-7 w-56 bg-inset ps-8 pe-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            {chips.map((c) => (
              <button
                key={c.chip}
                type="button"
                aria-pressed={filter.chip === c.chip}
                onClick={() => setFilter((f) => ({ ...f, chip: c.chip }))}
                className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[12.5px] transition-colors ${filter.chip === c.chip ? "bg-primary text-primary-foreground" : "bg-fill text-ink hover:bg-fill-hover"}`}
              >
                {c.label}
                <span className="font-mono text-[11px] opacity-75">{filterImages(all, { ...noImageFilter, chip: c.chip }).length}</span>
              </button>
            ))}
            <span className="flex-1" />
            <span className="text-[12px] text-ink-3">Most commits since the last build first</span>
          </div>

          <div className="mt-3 flex flex-col gap-px">
            <div className={`${listGrid} px-4 pb-1 text-[12px] text-ink-3 max-lg:hidden`}>
              <input
                type="checkbox"
                aria-label="Select every image shown"
                checked={rows.length > 0 && rows.every((r) => selected.has(imageKey(r)))}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(imageKey)) : new Set())}
                className="size-4 accent-[var(--primary)]"
              />
              <span>Image</span>
              <span>Source on this PC</span>
              <span>Latest on Docker Hub</span>
              <span>Tag to push</span>
              <span />
              <span className="w-8" />
            </div>
            {rows.map((r) => {
              const key = imageKey(r);
              return (
                <ImageRowView
                  key={key}
                  row={r}
                  hub={hubOf(r)}
                  hubLoading={hubTags.isPending}
                  tag={tagOf(r)}
                  onTag={(t) => {
                    setTyped((m) => ({ ...m, [key]: t }));
                    setAsking(null);
                  }}
                  selected={selected.has(key)}
                  onSelect={(on) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (on) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                  job={jobs.find((j) => j.key === key)}
                  open={open === key}
                  onToggle={() => setOpen((o) => (o === key ? null : key))}
                  asking={asking === key}
                  onAsk={() => setAsking(key)}
                  onCancel={() => setAsking(null)}
                  onConfirm={(overwrite) => build(r, overwrite)}
                  onDismiss={() => dismiss(key)}
                  hasHosts={hasHosts}
                  now={now}
                />
              );
            })}
            {rows.length === 0 && <p className="m-0 bg-surface-1 p-4 text-[14px] text-ink-3">No image matches.</p>}
          </div>
        </>
      )}

      {(selected.size > 0 || jobs.length > 0) && (
        <div className="sticky bottom-0 z-10 mt-4 flex flex-col gap-px">
          <BatchBar
            count={selected.size}
            ready={ready}
            skipped={skipped}
            asking={batchAsking}
            onAsk={() => setBatchAsking(true)}
            onCancel={() => setBatchAsking(false)}
            onClear={() => {
              setSelected(new Set());
              setBatchAsking(false);
            }}
            onConfirm={() => {
              enqueue(ready.map((x) => ({ row: x.row, tag: x.tag })));
              setSelected(new Set());
              setBatchAsking(false);
            }}
          />
          <BuildDock jobs={jobs} now={now} />
        </div>
      )}

      <History builds={builds.data ?? []} />
    </>
  );
}
