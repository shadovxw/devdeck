import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { navByPath } from "../app/nav";
import { quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import {
  useChangeSetup,
  useCheckConnection,
  useGit,
  useGitSetup,
  useMatch,
  useSaveGitConfig,
  type GitCheck,
  type GitConfig,
  type GitOverview,
  type GitSetup,
} from "../lib/git";
import { useDebounced } from "../lib/use-debounced";

const field =
  "h-10 rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent";
const button = `${quietButton} !h-10 !px-3 !text-[14px] disabled:cursor-not-allowed disabled:opacity-45`;
const primary =
  "inline-flex h-10 items-center gap-2 rounded-ctl bg-accent px-4 text-[14px] font-medium text-on-accent transition hover:brightness-110 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-ctl bg-inset p-4">
      <div>
        <h2 className="m-0 text-[16px] font-medium text-ink">{title}</h2>
        {hint && <p className="m-0 mt-1 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A connection id from an account name: lowercase letters, digits and dashes, starting with a letter. */
export function idFromLogin(login: string): string {
  const slug = login
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "account";
  return (/^[a-z]/.test(slug) ? slug : `a-${slug}`).slice(0, 40).replace(/-+$/, "");
}

function configOf(o: GitOverview): GitConfig {
  return { connections: o.connections.map(({ id, gh_user, name, email }) => ({ id, gh_user, ...(name ? { name } : {}), ...(email ? { email } : {}) })), rules: o.rules };
}

function CheckResult({ result }: { result: GitCheck | Error }) {
  if (result instanceof Error) {
    return (
      <p role="alert" className="m-0 text-[13px] text-critical">
        {result.message}
      </p>
    );
  }
  return (
    <p className="m-0 text-[13px] text-ink-2">
      Signed in as <span className="font-mono text-ink">{result.login}</span>. Token may: <span className="font-mono">{(result.scopes ?? []).join(", ") || "nothing listed"}</span>.{" "}
      {result.orgs && result.orgs.length > 0 ? (
        <>
          Organisations: <span className="font-mono">{result.orgs.join(", ")}</span>.
        </>
      ) : (
        (result.orgs_note ?? "No organisations.")
      )}
    </p>
  );
}

function AddressTester() {
  const [text, setText] = useState("");
  const settled = useDebounced(text.trim(), 300);
  const match = useMatch(settled);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="try-address">
        Try an address
      </label>
      <input
        id="try-address"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Try an address: https://github.com/owner/repo.git"
        spellCheck={false}
        autoComplete="off"
        className={`${field} w-96 max-w-full font-mono text-[13px]`}
      />
      <span role="status" className="text-[13px] text-ink-2">
        {settled === "" || match.isPending
          ? ""
          : match.isError
            ? "That isn’t a repository address."
            : match.data?.matched
              ? `Uses the connection ${match.data.connection} (as saved).`
              : "No rule matches: git asks as it did before."}
      </span>
    </div>
  );
}

function SetupSection({ state }: { state: GitSetup }) {
  const apply = useChangeSetup("apply");
  const undo = useChangeSetup("undo");
  const [confirming, setConfirming] = useState<"apply" | "undo" | null>(null);
  const busy = apply.isPending || undo.isPending;
  const error = apply.error ?? undo.error;

  return (
    <Section
      title="Git credential helper"
      hint="Makes git (and VS Code, and devdeck) ask devdeck which account to use for github.com, instead of asking you. Repositories no rule matches go on as before."
    >
      {!state.git_found ? (
        <p className="m-0 text-[14px] text-ink-2">Git isn’t installed, so there is nothing to set up.</p>
      ) : (
        <>
          <p className="m-0 text-[14px] text-ink">{state.applied ? "devdeck is git’s first helper for github.com." : "devdeck isn’t set up as a git helper yet."}</p>
          <details>
            <summary className="cursor-pointer text-[13px] text-ink-2">{state.applied ? "What was changed" : "What this would change"} in your global git settings</summary>
            <pre className="m-0 mt-2 overflow-x-auto rounded-ctl bg-fill p-3 font-mono text-[12px] leading-5 text-ink-2">{state.commands.join("\n")}</pre>
            {state.general_helpers.length > 0 && <p className="m-0 mt-2 text-[12px] text-ink-3">Your other helper ({state.general_helpers.join(", ")}) stays in the list after devdeck.</p>}
          </details>
          {confirming ? (
            <div role="alertdialog" aria-label="Confirm the change" className="flex flex-wrap items-center gap-3">
              <p className="m-0 text-[14px] text-ink">
                {confirming === "apply" ? "Change your global git settings as shown? What is there now is saved, and Undo puts it back." : "Put your global git settings back as they were?"}
              </p>
              <span className="ms-auto flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (confirming === "apply" ? apply : undo).mutate(undefined, { onSuccess: () => setConfirming(null) })}
                  className={primary}
                >
                  {confirming === "apply" ? "Change the settings" : "Put them back"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={button}>
                  Cancel
                </button>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {!state.applied && (
                <button type="button" onClick={() => setConfirming("apply")} className={primary}>
                  Set up the helper…
                </button>
              )}
              {state.can_undo && (
                <button type="button" onClick={() => setConfirming("undo")} className={button}>
                  Undo…
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="m-0 text-[13px] text-critical">
              {error.message}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/** The editor: a draft of the connections and rules, saved together. */
function Editor({ overview }: { overview: GitOverview }) {
  const server = configOf(overview);
  const serverKey = JSON.stringify(server);
  const [draft, setDraft] = useState<GitConfig>(server);
  const [seen, setSeen] = useState(serverKey);
  // The server's copy changed (saved, or edited elsewhere): start from it.
  if (serverKey !== seen) {
    setSeen(serverKey);
    setDraft(server);
  }
  const dirty = JSON.stringify(draft) !== serverKey;
  const save = useSaveGitConfig();
  const check = useCheckConnection();
  const [results, setResults] = useState<Record<string, GitCheck | Error>>({});

  const signedIn = new Set(overview.accounts.map((a) => a.login.toLowerCase()));
  const savedIds = new Set(overview.connections.map((c) => c.id));
  const setConn = (i: number, patch: Partial<GitConfig["connections"][number]>) =>
    setDraft((d) => ({ ...d, connections: d.connections.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setRule = (i: number, patch: Partial<GitConfig["rules"][number]>) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  function addConnection() {
    const free = overview.accounts.find((a) => !draft.connections.some((c) => c.gh_user.toLowerCase() === a.login.toLowerCase()));
    const login = free?.login ?? "";
    setDraft((d) => ({ ...d, connections: [...d.connections, { id: login ? idFromLogin(login) : "", gh_user: login }] }));
  }

  function runCheck(id: string) {
    check.mutate(id, {
      onSuccess: (r) => setResults((cur) => ({ ...cur, [id]: r })),
      onError: (e) => setResults((cur) => ({ ...cur, [id]: e })),
    });
  }

  return (
    <>
      <Section title="Connections" hint="Each connection is one GitHub account that gh is signed in to, with the name and email its commits should carry.">
        {draft.connections.length === 0 && <p className="m-0 text-[14px] text-ink-3">No connection yet. Add one for each account you use.</p>}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {draft.connections.map((c, i) => (
            <li key={i} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label={`Id of connection ${i + 1}`} value={c.id} onChange={(e) => setConn(i, { id: e.target.value })} placeholder="id, e.g. office" className={`${field} w-36 font-mono text-[13px]`} />
                <select aria-label={`GitHub account of ${c.id || `connection ${i + 1}`}`} value={c.gh_user} onChange={(e) => setConn(i, { gh_user: e.target.value })} className={field}>
                  {c.gh_user === "" && <option value="">Pick an account…</option>}
                  {overview.accounts.map((a) => (
                    <option key={a.login} value={a.login}>
                      {a.login}
                    </option>
                  ))}
                  {c.gh_user !== "" && !overview.accounts.some((a) => a.login === c.gh_user) && <option value={c.gh_user}>{c.gh_user} (not signed in)</option>}
                </select>
                <input aria-label={`Commit name of ${c.id || `connection ${i + 1}`}`} value={c.name ?? ""} onChange={(e) => setConn(i, { name: e.target.value })} placeholder="Commit name" className={`${field} w-48`} />
                <input aria-label={`Commit email of ${c.id || `connection ${i + 1}`}`} value={c.email ?? ""} onChange={(e) => setConn(i, { email: e.target.value })} placeholder="Commit email" className={`${field} w-60`} />
                <button
                  type="button"
                  disabled={dirty || !savedIds.has(c.id) || check.isPending}
                  title={dirty ? "Save first, then check" : "Ask GitHub who this account is and what its token may do"}
                  onClick={() => runCheck(c.id)}
                  className={button}
                  aria-label={`Check ${c.id}`}
                >
                  Check
                </button>
                <button
                  type="button"
                  aria-label={`Remove connection ${c.id || i + 1}`}
                  onClick={() => setDraft((d) => ({ ...d, connections: d.connections.filter((_, j) => j !== i) }))}
                  className="inline-grid size-9 place-items-center rounded-ctl text-ink-3 hover:bg-accent-soft hover:text-ink"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
              {c.gh_user !== "" && !signedIn.has(c.gh_user.toLowerCase()) && (
                <p className="m-0 text-[13px] text-warning">
                  gh isn’t signed in to {c.gh_user}. Run <span className="font-mono">gh auth login</span> for it.
                </p>
              )}
              {results[c.id] && <CheckResult result={results[c.id]} />}
            </li>
          ))}
        </ul>
        <div>
          <button type="button" onClick={addConnection} className={button}>
            <Plus size={15} aria-hidden />
            Add a connection
          </button>
        </div>
      </Section>

      <Section title="Rules" hint="Which connection a repository uses, by its address. The most specific rule wins: github.com/owner/repo, then github.com/owner/*, then github.com/*.">
        {draft.rules.length === 0 && <p className="m-0 text-[14px] text-ink-3">No rule yet. A repository no rule matches is flagged on the Repositories page.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {draft.rules.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label={`Pattern of rule ${i + 1}`} value={r.match} onChange={(e) => setRule(i, { match: e.target.value })} placeholder="github.com/owner/*" spellCheck={false} className={`${field} w-80 max-w-full font-mono text-[13px]`} />
              <span aria-hidden className="text-ink-3">
                uses
              </span>
              <select aria-label={`Connection of rule ${i + 1}`} value={r.connection} onChange={(e) => setRule(i, { connection: e.target.value })} className={field}>
                {r.connection === "" && <option value="">Pick a connection…</option>}
                {draft.connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
                {r.connection !== "" && !draft.connections.some((c) => c.id === r.connection) && <option value={r.connection}>{r.connection} (missing)</option>}
              </select>
              <button type="button" aria-label={`Remove rule ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))} className="inline-grid size-9 place-items-center rounded-ctl text-ink-3 hover:bg-accent-soft hover:text-ink">
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div>
          <button type="button" onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, { match: "", connection: d.connections[0]?.id ?? "" }] }))} className={button}>
            <Plus size={15} aria-hidden />
            Add a rule
          </button>
        </div>
        <AddressTester />
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} className={primary}>
          Save changes
        </button>
        <button type="button" disabled={!dirty} onClick={() => setDraft(server)} className={button}>
          Discard
        </button>
        {dirty && <span className="text-[13px] text-ink-3">Unsaved changes</span>}
        {save.isSuccess && !dirty && (
          <span role="status" className="text-[13px] text-ink-2">
            Saved.
          </span>
        )}
        {save.error && (
          <span role="alert" className="text-[13px] text-critical">
            {save.error.message}
          </span>
        )}
      </div>
    </>
  );
}

/** The GitHub accounts devdeck uses: who gh is signed in as, which connection and rules pick the account for a repository, and the git credential helper. */
export function ConnectionsPage() {
  const item = navByPath("/connections");
  const git = useGit();
  const setup = useGitSetup();

  const header = <PageHeader title={item.label} group={item.group} description="GitHub accounts devdeck uses for your repositories. Sign-in is done by the GitHub CLI; devdeck stores no token." />;

  if (git.isPending) {
    return (
      <>
        {header}
        <div role="status" aria-label="Loading…" className="mt-4 flex flex-col gap-3">
          <div className="skeleton h-28 w-full" />
          <div className="skeleton h-28 w-full" />
        </div>
      </>
    );
  }
  if (git.isError) {
    return (
      <>
        {header}
        <p className="mt-4 text-ink-3">Could not load the git accounts.</p>
      </>
    );
  }
  const o = git.data;

  if (!o.gh_installed) {
    return (
      <>
        {header}
        <EmptyState
          icon={KeyRound}
          empty={{
            headline: "Install the GitHub CLI first",
            text: "devdeck uses it to sign in to your GitHub accounts. Install it (winget install GitHub.cli), then run gh auth login once for each account and come back.",
          }}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="enter mt-4 flex flex-col gap-4" style={stagger(1)}>
        <Section title="Signed in with gh" hint="Add another account with gh auth login. The active one is only gh’s own default: devdeck picks the account by rule.">
          {o.accounts_error && (
            <p role="alert" className="m-0 text-[13px] text-critical">
              {o.accounts_error}
            </p>
          )}
          {o.accounts.length === 0 && !o.accounts_error && (
            <p className="m-0 text-[14px] text-ink-2">
              gh isn’t signed in to any account. Run <span className="font-mono">gh auth login</span> in a terminal.
            </p>
          )}
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {o.accounts.map((a) => (
              <li key={a.login} className="inline-flex items-center gap-2 rounded-ctl bg-fill px-3 py-1.5 text-[13px] text-ink-2">
                <span className="font-mono text-ink">{a.login}</span>
                {a.active && <span className="text-ink-3">active in gh</span>}
                <span className="text-ink-3">{a.scopes.join(", ")}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Editor overview={o} />

        {setup.data && <SetupSection state={setup.data} />}
        {setup.isError && <p className="text-ink-3">Could not read the git settings.</p>}
      </div>
    </>
  );
}
