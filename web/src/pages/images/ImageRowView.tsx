import { ChevronDown, ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { pill, pillDanger, pillInput, pillPrimary, pillSmall } from "../../design/pills";
import type { BuildJob, ImageRow, ImageTags } from "../../lib/docker";
import { buildCommand, formatBytes, tagPattern } from "../../lib/images";
import { ago } from "../../lib/time";
import { Mark, Output, short } from "./parts";

/** Why an image can't be built right now, in words; undefined when it can. */
export function blockerOf(row: ImageRow): string | undefined {
  if (row.folder_missing) return "The repository isn’t on this machine.";
  return row.problem ?? row.secrets.find((s) => s.problem)?.problem;
}

export const listGrid = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 lg:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_9rem_auto]";
const cell = "col-span-full min-w-0 lg:col-span-1";
const label = "text-[12px] text-ink-3";

function SourceCell({ row }: Readonly<{ row: ImageRow }>) {
  if (row.folder_missing) return <span className="text-[13px] text-ink-3">Not on this PC</span>;
  const ahead = row.ahead ?? 0;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="truncate font-mono text-[12.5px] text-ink-2" title={row.branch}>
        {row.branch ?? "—"}
        {row.commit && <span className="text-ink-3"> @ {short(row.commit)}</span>}
      </span>
      <span className="flex flex-wrap gap-1.5 text-[12px]">
        {row.ahead === undefined ? (
          <span className="rounded-tag bg-inset px-2 py-0.5 text-ink-3">{row.last ? "since last build unknown" : "not built here yet"}</span>
        ) : ahead > 0 ? (
          <span className="rounded-tag bg-fill px-2 py-0.5 font-medium text-ink">
            {ahead} {ahead === 1 ? "commit" : "commits"} since last build
          </span>
        ) : (
          <span className="rounded-tag bg-inset px-2 py-0.5 text-ink-3">same as last build</span>
        )}
        {row.dirty && <span className="rounded-tag bg-fill px-2 py-0.5 font-medium text-ink">uncommitted changes</span>}
      </span>
    </div>
  );
}

function LatestCell({ hub, loading, now }: Readonly<{ hub: ImageTags | undefined; loading: boolean; now: number }>) {
  if (loading) return <output aria-label="Reading the tags…" className="skeleton block h-9 w-28" />;
  if (!hub || hub.error) return <span className="text-[12.5px] text-ink-3" title={hub?.error}>{hub ? "Couldn’t read Docker Hub" : "—"}</span>;
  const latest = hub.tags[0];
  if (!latest) return <span className="text-[13px] text-ink-3">No tag yet</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <b className="truncate font-mono text-[13px] font-semibold text-ink" title={latest.name}>
        {latest.name}
      </b>
      {latest.pushed_at && <small className="text-[12px] text-ink-3">{ago(latest.pushed_at, now)}</small>}
    </div>
  );
}

function ActionCell({ job, canBuild, clash, onAsk }: Readonly<{ job: BuildJob | undefined; canBuild: boolean; clash: boolean; onAsk: () => void }>) {
  if (job?.state === "running") {
    return (
      <div className="flex flex-col gap-1.5">
        <button type="button" disabled className={`${pill} justify-center`}>
          {job.step === 2 ? "Pushing…" : "Building…"}
        </button>
        <span className="h-1 w-full bg-fill" aria-hidden>
          <i className="block h-full bg-primary" style={{ width: `${job.step * 50}%` }} />
        </span>
      </div>
    );
  }
  if (job?.state === "queued") {
    return (
      <button type="button" disabled className={`${pill} justify-center`}>
        Queued
      </button>
    );
  }
  return (
    <button type="button" disabled={!canBuild} onClick={onAsk} className={`${clash ? pillDanger : pillPrimary} justify-center`}>
      {clash ? "Push over it" : "Build & push"}
    </button>
  );
}

function Detail({ row, hub, onPick, now }: Readonly<{ row: ImageRow; hub: ImageTags | undefined; onPick: (tag: string) => void; now: number }>) {
  const tags = hub?.tags ?? [];
  return (
    <div className="grid gap-6 bg-inset p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">Tags on Docker Hub</h4>
          <a href={`https://hub.docker.com/r/${row.repository}/tags`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 underline underline-offset-2">
            Open on Docker Hub <ExternalLink size={12} aria-hidden />
          </a>
        </div>
        {hub?.error && <p className="m-0 text-[13px] text-ink-3">The tags couldn’t be read from Docker Hub: {hub.error}</p>}
        {!hub?.error && tags.length === 0 && <p className="m-0 text-[13px] text-ink-3">No tag on Docker Hub yet for {row.repository}.</p>}
        {tags.length > 0 && (
          <>
            <p className="m-0 text-[12px] text-ink-3">Newest first. Click one to put it in the tag box.</p>
            <ul aria-label={`Tags of ${row.repository}`} className="m-0 flex list-none flex-col p-0">
              {tags.map((t) => (
                <li key={t.name}>
                  <button type="button" onClick={() => onPick(t.name)} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-3 px-2 py-1 text-start text-[13px] hover:bg-fill">
                    <span className="truncate font-mono text-ink">{t.name}</span>
                    <span className="font-mono text-[12px] text-ink-3">{row.last?.ok && row.last.tag === t.name ? short(row.last.revision) : ""}</span>
                    <span className="text-[12px] text-ink-3">{formatBytes(t.size)}</span>
                    <span className="text-[12px] text-ink-3">{t.pushed_at ? ago(t.pushed_at, now) : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">Build settings</h4>
        <dl className="m-0 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className={label}>Dockerfile</dt>
          <dd className="m-0 break-all font-mono text-[12.5px] text-ink-2">{row.dockerfile}</dd>
          <dt className={label}>Context</dt>
          <dd className="m-0 break-all font-mono text-[12.5px] text-ink-2">{row.context}</dd>
          {row.platforms.length > 0 && (
            <>
              <dt className={label}>Platform</dt>
              <dd className="m-0 font-mono text-[12.5px] text-ink-2">{row.platforms.join(", ")}</dd>
            </>
          )}
          <dt className={label}>Pushed with</dt>
          <dd className="m-0 text-ink-2">{row.account ?? "no account"}</dd>
          <dt className={label}>Secrets</dt>
          <dd className="m-0 flex flex-col gap-1 text-ink-2">
            {row.secrets.length === 0 && <span className="text-ink-3">none</span>}
            {row.secrets.map((s) => (
              <Mark key={s.id} ok={!s.problem} title={s.problem}>
                {s.id} from {s.from === "github" ? "GitHub account" : `keychain (${s.name ?? s.id})`}
              </Mark>
            ))}
          </dd>
          <dt className={label}>Last built here</dt>
          <dd className="m-0 text-ink-2">{row.last ? `${row.last.tag} · ${ago(row.last.at, now)} · ${row.last.ok ? "Pushed" : "Failed"}` : "never"}</dd>
        </dl>
        <div>
          <p className={`m-0 mb-1 ${label}`}>The same build by hand</p>
          <pre aria-label="Command" className="m-0 overflow-auto bg-bg p-2.5 font-mono text-[12px] leading-5 text-ink-2">
            {buildCommand(row, "<tag>")}
          </pre>
        </div>
        {row.dirty && <p className="m-0 bg-fill p-2.5 text-[13px] text-ink">Uncommitted changes would go into the image, so the tag won’t match commit {short(row.commit)}.</p>}
      </div>
    </div>
  );
}

function Confirm({ row, tag, clash, onConfirm, onCancel }: Readonly<{ row: ImageRow; tag: string; clash: boolean; onConfirm: () => void; onCancel: () => void }>) {
  return (
    <div role="group" aria-label="Confirm the build" className="flex flex-col gap-2 bg-fill p-3">
      <p className="m-0 text-[13px] leading-5 text-ink-2">
        Build {row.repository} from {row.branch ?? "the current folder"}
        {row.commit ? ` at ${short(row.commit)}` : ""} and push it as <span className="font-mono text-ink">{`${row.repository}:${tag}`}</span> to Docker Hub with the account {row.account}?
        {row.dirty ? " The folder has uncommitted changes, and the image is built from them." : ""}
        {clash ? " Docker Hub already has this tag: pushing replaces it." : ""}
      </p>
      <pre aria-label="Command" className="m-0 overflow-auto bg-bg p-2.5 font-mono text-[12px] leading-5 text-ink-2">
        {buildCommand(row, tag)}
      </pre>
      <div className="flex items-center gap-2">
        <button type="button" className={clash ? pillDanger : pillPrimary} onClick={onConfirm}>
          {clash ? "Push over it" : "Build and push"}
        </button>
        <button type="button" className={pill} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function JobPanel({ job, row, hasHosts, onDismiss }: Readonly<{ job: BuildJob; row: ImageRow; hasHosts: boolean; onDismiss: () => void }>) {
  const finished = job.state === "ok" || job.state === "failed";
  return (
    <div className="flex flex-col gap-2">
      <Output lines={job.lines} />
      {job.state === "exists" && (
        <p role="status" className="m-0 text-[13px] text-ink">
          {job.message}
        </p>
      )}
      {finished && (
        <p role="status" className="m-0 flex flex-wrap items-center gap-3 text-[13px] text-ink">
          <Mark ok={job.state === "ok"}>{job.state === "ok" ? `Pushed ${row.repository}:${job.tag}` : `Failed: ${job.error ?? "the build didn’t finish"}`}</Mark>
          <button type="button" className={pillSmall} onClick={onDismiss}>
            Dismiss
          </button>
        </p>
      )}
      {job.state === "ok" && hasHosts && (
        <p className="m-0 text-[13px] text-ink-2">
          <Link to={"/hosts?" + new URLSearchParams({ deploy: [row.repository, job.tag].join(":") }).toString()} className="underline">
            Deploy {job.tag} to a host
          </Link>{" "}
          to change the tag on a remote stack and recreate its container.
        </p>
      )}
    </div>
  );
}

export type RowProps = {
  row: ImageRow;
  hub: ImageTags | undefined;
  hubLoading: boolean;
  tag: string;
  onTag: (tag: string) => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  job: BuildJob | undefined;
  open: boolean;
  onToggle: () => void;
  asking: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: (overwrite: boolean) => void;
  onDismiss: () => void;
  hasHosts: boolean;
  now: number;
};

/** One image: its source on this PC, the latest tag on Docker Hub, the tag to build, and the button. */
export function ImageRowView(p: Readonly<RowProps>) {
  const { row, hub, tag, job } = p;
  const blocker = blockerOf(row);
  const validTag = tagPattern.test(tag);
  const clash = validTag && (hub?.tags.some((t) => t.name === tag) ?? false);
  const active = job?.state === "running" || job?.state === "queued";
  const canBuild = !blocker && validTag && !active;
  const id = `tag-${row.workspace}-${row.repo}-${row.image}`;

  return (
    <section aria-label={`Image ${row.repository}`} className={`flex flex-col ${p.open || p.selected ? "bg-fill" : "bg-surface-1"}`}>
      <div className={`${listGrid} p-4`}>
        <input type="checkbox" checked={p.selected} onChange={(e) => p.onSelect(e.target.checked)} aria-label={`Select ${row.repository}`} className="mt-1 size-4 accent-[var(--primary)]" />
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[14px] font-semibold text-ink">{row.image}</h3>
          <p className="m-0 truncate font-mono text-[12px] text-ink-3" title={row.repository}>
            {row.repository}
          </p>
        </div>
        <button type="button" aria-expanded={p.open} aria-label={`Details of ${row.repository}`} onClick={p.onToggle} className="grid size-8 place-items-center text-ink-3 hover:bg-fill-hover hover:text-ink lg:order-last">
          <ChevronDown size={16} aria-hidden className={p.open ? "rotate-180" : ""} />
        </button>

        <div className={cell}>
          <SourceCell row={row} />
        </div>
        <div className={cell}>
          <p className={`m-0 mb-1 lg:hidden ${label}`}>Latest on Docker Hub</p>
          <LatestCell hub={hub} loading={p.hubLoading} now={p.now} />
        </div>
        <div className={cell}>
          <label className="sr-only" htmlFor={id}>
            Tag for {row.repository}
          </label>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] text-ink-3">:</span>
            <input
              id={id}
              value={tag}
              onChange={(e) => p.onTag(e.target.value)}
              placeholder="tag, for example 1.0.4"
              spellCheck={false}
              autoComplete="off"
              disabled={Boolean(blocker) || active}
              className={`${pillInput} w-full min-w-0 font-mono`}
            />
          </div>
          {tag !== "" && !validTag && <p className="m-0 mt-1 text-[12px] text-ink-3">Letters, digits, dots, dashes and underscores.</p>}
          {clash && <p className="m-0 mt-1 text-[12px] text-ink">{tag} already exists on Docker Hub: pushing would replace it.</p>}
        </div>
        <div className={`${cell} lg:w-36`}>
          <ActionCell job={job} canBuild={canBuild} clash={clash} onAsk={p.onAsk} />
        </div>
      </div>

      {blocker && (
        <p role="status" className="m-0 px-4 pb-3 text-[13px] text-ink">
          {blocker}{" "}
          {(row.problem || row.secrets.some((s) => s.problem)) && !row.folder_missing && (
            <Link to="/connections/docker" className="underline">
              Docker Hub page
            </Link>
          )}
        </p>
      )}

      {(p.asking || job) && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {p.asking && <Confirm row={row} tag={tag} clash={clash} onConfirm={() => p.onConfirm(clash)} onCancel={p.onCancel} />}
          {job && (
            <>
              <JobPanel job={job} row={row} hasHosts={p.hasHosts} onDismiss={p.onDismiss} />
              {job.state === "exists" && (
                <div role="group" aria-label="The tag already exists" className="flex items-center gap-2">
                  <button type="button" className={pillDanger} onClick={() => p.onConfirm(true)}>
                    Push over it
                  </button>
                  <button type="button" className={pill} onClick={p.onDismiss}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {p.open && <Detail row={row} hub={hub} onPick={p.onTag} now={p.now} />}
    </section>
  );
}
