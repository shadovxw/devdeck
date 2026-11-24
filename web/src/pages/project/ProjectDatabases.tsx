import { Database, Table2, TerminalSquare } from "lucide-react";

import { quietButton } from "../../design/buttons";
import { EmptyState } from "../../design/EmptyState";
import { ENGINE, useProjectDatabases, usedByText, type ProjectDatabase } from "../../lib/databases";

/** One database, as on the design's board: name and state, then ENGINE / RUNS / PORT / USED BY, then the explorer and console (Phase 6). */
function DatabaseCard({ db }: Readonly<{ db: ProjectDatabase }>) {
  const soon = "The explorer and SQL console come in Phase 6";
  return (
    <li data-ui="db-card" className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <b data-ui="db-name" className="min-w-0 truncate">
          {db.name || db.id}
        </b>
        <span data-ui="db-status" data-state={db.status} title={db.status === "unknown" ? "On another host: not checked" : undefined}>
          {db.status}
        </span>
      </div>
      <dl data-ui="db-facts" className="m-0 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5">
        <dt>Engine</dt>
        <dd>{ENGINE[db.engine]}</dd>
        <dt>Runs</dt>
        <dd className="truncate" title={db.where}>
          {db.where}
        </dd>
        <dt>Port</dt>
        <dd>
          {db.host}:{db.port}
        </dd>
        <dt>Used by</dt>
        <dd>{usedByText(db.used_by)}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled title={soon} className={`${quietButton} disabled:cursor-not-allowed disabled:opacity-45`}>
          <Table2 size={15} aria-hidden />
          Explorer
        </button>
        <button type="button" disabled title={soon} className={`${quietButton} disabled:cursor-not-allowed disabled:opacity-45`}>
          <TerminalSquare size={15} aria-hidden />
          SQL console
        </button>
      </div>
    </li>
  );
}

/**
 * A project's Databases tab (dev-plans/2026-11-22-projects §6, PJ6): every database devdeck found
 * in the compose files its run modes use and in its repos' .env files, who uses each, whether it
 * answers, and what doesn't line up. Names, hosts and ports only, never a password.
 */
export function ProjectDatabases({ workspace }: Readonly<{ workspace: string }>) {
  const report = useProjectDatabases(workspace);
  if (report.isPending) return <output aria-label="Looking for databases…" className="skeleton block h-32 w-full" />;
  if (report.isError) return <p className="m-0 text-ink-3">Could not look for the databases.</p>;
  const { databases, warnings } = report.data;

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <ul aria-label="Needs a look" data-ui="db-warnings" className="m-0 flex list-none flex-col gap-1.5 p-3">
          {warnings.map((w, i) => (
            <li key={i} className="text-[13px] text-ink-2">
              {w.message}
            </li>
          ))}
        </ul>
      )}
      {databases.length === 0 ? (
        <EmptyState
          icon={Database}
          variant="data"
          empty={{
            headline: "No database found",
            text: "devdeck looks in the compose files your run modes use and in each repo's .env (DATABASE_URL, REDIS_URL, PGHOST…).",
            kicker: "00 $ Databases · none found",
          }}
        />
      ) : (
        <ul aria-label="Databases" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3 p-0">
          {databases.map((db) => (
            <DatabaseCard key={db.id} db={db} />
          ))}
        </ul>
      )}
    </div>
  );
}
