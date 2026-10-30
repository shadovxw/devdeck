import { Container } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { pill, pillDanger, pillInput, pillPrimary } from "../design/pills";
import { useBuilds, useClearBuilds, useImageBuild, useImages, type BuildRecord, type ImageRow } from "../lib/docker";
import { useHosts } from "../lib/hosts";
import { stagger } from "../lib/motion";
import { ago, took } from "../lib/time";
import { useNow } from "../lib/use-now";

const th = "px-3 py-2 text-start text-[13px] font-medium text-ink-3";
const td = "px-3 py-2 align-top";
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** A state as a word with a shape, never colour alone. */
function Mark({ ok, children, title }: Readonly<{ ok: boolean; children: ReactNode; title?: string }>) {
  const tone = ok ? "var(--good)" : "var(--critical)";
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2" title={title}>
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {ok ? <circle cx="6" cy="6" r="4.5" fill={tone} /> : <path d="M6 1.2 11 10.2H1Z" fill={tone} />}
      </svg>
      {children}
    </span>
  );
}

const short = (sha?: string) => (sha ? sha.slice(0, 7) : "");

function Output({ lines }: Readonly<{ lines: string[] }>) {
  if (lines.length === 0) return null;
  return (
    <pre aria-label="Build output" role="log" className="m-0 max-h-[18rem] overflow-auto rounded-ctl bg-bg p-3 font-mono text-[12px] leading-5 text-ink-2">
      {lines.join("\n")}
    </pre>
  );
}

/** One image: what it is, where its repository stands, and the tag field that builds and pushes it. */
function ImageCard({ row }: Readonly<{ row: ImageRow }>) {
  const now = useNow(true, 30_000);
  const [tag, setTag] = useState("");
  const [asking, setAsking] = useState(false);
  const { state, run, reset } = useImageBuild(row);
  const hosts = useHosts();

  const secretProblem = row.secrets.find((s) => s.problem)?.problem;
  const blocker = row.folder_missing ? "The repository isn’t on this machine." : (row.problem ?? secretProblem);
  const validTag = tagPattern.test(tag);
  const target = `${row.repository}:${tag}`;

  function confirm(overwrite: boolean) {
    setAsking(false);
    void run(tag, overwrite);
  }

  return (
    <section aria-label={`Image ${row.repository}`} className="flex flex-col gap-3 rounded-ctl bg-inset p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 truncate font-mono text-[15px] font-medium text-ink">{row.repository}</h3>
          <p className="m-0 mt-0.5 text-[13px] text-ink-3">
            {row.workspace_name} · {row.repo}
            {row.image !== row.repo ? ` · ${row.image}` : ""} · {row.platforms.join(", ")}
          </p>
        </div>
        {row.account ? <Mark ok>Pushed with {row.account}</Mark> : <Mark ok={false}>No account</Mark>}
      </div>

      <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        {!row.folder_missing && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-ink-3">Repository</dt>
            <dd className="m-0 text-ink-2">
              {row.branch ?? "—"}
              {row.commit ? ` at ${short(row.commit)}` : ""}
              {row.dirty && <span className="ms-2 text-ink">· uncommitted changes</span>}
            </dd>
          </div>
        )}
        {row.secrets.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-ink-3">Build secrets</dt>
            <dd className="m-0 flex flex-wrap gap-3 text-ink-2">
              {row.secrets.map((s) => (
                <Mark key={s.id} ok={!s.problem} title={s.problem}>
                  {s.id} from {s.from === "github" ? "GitHub account" : `keychain (${s.name ?? s.id})`}
                </Mark>
              ))}
            </dd>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <dt className="text-[12px] text-ink-3">Last build</dt>
          <dd className="m-0 text-ink-2">
            {row.last ? (
              <>
                {row.last.tag} · {ago(row.last.at, now)} · {row.last.ok ? "Pushed" : "Failed"}
              </>
            ) : (
              "None yet"
            )}
          </dd>
        </div>
      </dl>

      {blocker && (
        <p role="status" className="m-0 text-[13px] text-ink">
          {blocker}{" "}
          {(row.problem || secretProblem) && !row.folder_missing && (
            <Link to="/connections/docker" className="underline">
              Docker Hub page
            </Link>
          )}
        </p>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (validTag) setAsking(true);
        }}
      >
        <label className="sr-only" htmlFor={`tag-${row.workspace}-${row.repo}-${row.image}`}>
          Tag for {row.repository}
        </label>
        <span className="font-mono text-[13px] text-ink-3">{row.repository}:</span>
        <input
          id={`tag-${row.workspace}-${row.repo}-${row.image}`}
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setAsking(false);
            if (state.exists) reset();
          }}
          placeholder="tag, for example 1.0.4"
          spellCheck={false}
          autoComplete="off"
          disabled={Boolean(blocker) || state.running}
          className={`${pillInput} w-56 font-mono`}
        />
        <button type="submit" disabled={Boolean(blocker) || state.running || !validTag} className={pillPrimary}>
          {state.running ? "Building…" : "Build and push"}
        </button>
        {tag !== "" && !validTag && <span className="text-[12px] text-ink-3">Letters, digits, dots, dashes and underscores.</span>}
      </form>

      {asking && (
        <div role="group" aria-label="Confirm the build" className="flex flex-col gap-2 rounded-ctl bg-fill p-3">
          <p className="m-0 text-[13px] leading-5 text-ink-2">
            Build {row.repository} from {row.branch ?? "the current folder"}
            {row.commit ? ` at ${short(row.commit)}` : ""} and push it as <span className="font-mono text-ink">{target}</span> to Docker Hub with the account{" "}
            {row.account}?{row.dirty ? " The folder has uncommitted changes, and the image is built from them." : ""}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className={pillPrimary} onClick={() => confirm(false)}>
              Build and push
            </button>
            <button type="button" className={pill} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.exists && (
        <div role="group" aria-label="The tag already exists" className="flex flex-col gap-2 rounded-ctl bg-fill p-3">
          <p className="m-0 text-[13px] leading-5 text-ink">{state.exists}</p>
          <div className="flex items-center gap-2">
            <button type="button" className={pillDanger} onClick={() => confirm(true)}>
              Push over it
            </button>
            <button type="button" className={pill} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <Output lines={state.lines} />
      {state.result && (
        <p role="status" className="m-0 text-[13px] text-ink">
          <Mark ok={state.result.ok}>
            {state.result.ok ? `Pushed ${state.tag ? `${row.repository}:${state.tag}` : ""}` : `Failed: ${state.result.error ?? "the build didn’t finish"}`}
          </Mark>
        </p>
      )}
      {state.result?.ok && state.tag && (hosts.data?.length ?? 0) > 0 && (
        <p className="m-0 text-[13px] text-ink-2">
          <Link to={`/hosts?deploy=${encodeURIComponent(`${row.repository}:${state.tag}`)}`} className="underline">
            Deploy {state.tag} to a host
          </Link>{" "}
          to change the tag on a remote stack and recreate its container.
        </p>
      )}
    </section>
  );
}

function History({ builds }: Readonly<{ builds: BuildRecord[] }>) {
  const now = useNow(true, 30_000);
  const clear = useClearBuilds();
  const [sure, setSure] = useState(false);
  return (
    <section aria-label="Build history" className="enter mt-6 flex flex-col gap-3 rounded-ctl bg-inset p-5" style={stagger(3)}>
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

/** Build and push Docker images: type a tag, and devdeck builds the image on this PC and pushes it with the right account. */
export function ImagesPage() {
  const item = navByPath("/images");
  const images = useImages();
  const builds = useBuilds();
  const rows = images.data ?? [];

  return (
    <>
      <PageHeader
        title={item.label}
        group={item.group}
        description="Type a tag after the colon and devdeck builds the image on this PC and pushes it to Docker Hub."
        actions={
          <Link to="/connections/docker" className={pill}>
            Docker Hub accounts
          </Link>
        }
      />

      {images.isPending && (
        <div role="status" aria-label="Loading images…" className="mt-4 grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-36 w-full" />
          ))}
        </div>
      )}
      {images.isError && (
        <p role="alert" className="mt-4 text-[14px] text-ink">
          The images couldn’t be read: {images.error.message}
        </p>
      )}
      {images.data && rows.length === 0 && (
        <EmptyState
          icon={Container}
          empty={{
            headline: "No images yet",
            text: "Add images: to a repository in your workspace file, with the Docker Hub repository each one is pushed to.",
            cta: { label: "Open workspaces", to: "/workspaces" },
          }}
        />
      )}

      <div className="enter mt-4 flex flex-col gap-3" style={stagger(1)}>
        {rows.map((r) => (
          <ImageCard key={`${r.workspace}/${r.repo}/${r.image}`} row={r} />
        ))}
      </div>

      <History builds={builds.data ?? []} />
    </>
  );
}
