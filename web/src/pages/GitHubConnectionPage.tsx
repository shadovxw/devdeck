import { KeyRound } from "lucide-react";
import { useState, type ReactNode } from "react";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { pill, pillDanger, pillPrimary, pillSelect } from "../design/pills";
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
  "h-9 rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent";
// Inside a table the fields look like text until pointed at.
const cell =
  "h-9 w-full min-w-0 rounded-ctl bg-transparent px-2 text-[14px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill focus-visible:bg-inset focus-visible:ring-2 focus-visible:ring-accent";
// Every action is a pill (a shadcn badge) on the sidebar's background; see design/pills.ts.
const button = pill;
const primary = pillPrimary;
const th = "px-3 py-2 text-start text-[13px] font-medium text-ink-3";

/** A block of the page: a title with a status or action beside it, a line of help, then its content. */
function Section({ title, hint, aside, children }: { title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-ctl bg-inset p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="m-0 flex items-center gap-3 text-[16px] font-medium text-ink">{title}</h2>
          {hint && <p className="m-0 mt-1 text-[13px] text-ink-3">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A state as a small shape and a word, never colour alone. */
function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {ok ? <circle cx="6" cy="6" r="4.5" fill="var(--accent)" /> : <path d="M6 1.2 11 10.2H1Z" fill="var(--warning)" />}
      </svg>
      {children}
    </span>
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

/** What a rule's pattern covers, in words. */
export function reach(match: string): string {
  const parts = match.split("/");
  if (parts.length === 2 && parts[1] === "*") return "Every repository on " + parts[0];
  if (parts.length === 3 && parts[2] === "*") return `Every repository of ${parts[1]}`;
  if (parts.length === 3) return "One repository";
  return "";
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

const signInCommand = "gh auth login --hostname github.com --git-protocol https --web";

/** How to sign in to another account: gh does it in the browser, once per account. */
function AddAccount() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-ctl bg-fill p-3 text-[13px] text-ink-2">
      <p className="m-0">Run this in a terminal, sign in as the account you want to add, then reload this page.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-ctl bg-inset px-3 py-2 font-mono text-[12px] text-ink">{signInCommand}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(signInCommand);
            setCopied(true);
          }}
          className={button}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function AddressTester() {
  const [text, setText] = useState("");
  const settled = useDebounced(text.trim(), 300);
  const match = useMatch(settled);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-ctl bg-fill px-3 py-2">
      <label htmlFor="try-address" className="text-[13px] font-medium text-ink-2">
        Test a repository URL
      </label>
      <input
        id="try-address"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="https://github.com/owner/repo"
        spellCheck={false}
        autoComplete="off"
        className={`${field} w-96 max-w-full font-mono text-[13px]`}
      />
      <span role="status" className="text-[13px] text-ink-2">
        {settled === "" || match.isPending
          ? "No rule matched yet."
          : match.isError
            ? "That isn’t a repository address."
            : match.data?.matched
              ? `Uses the profile ${match.data.connection} (as saved).`
              : "No rule matches: git asks as it did before."}
      </span>
    </div>
  );
}

function SetupSection({ state }: { state: GitSetup }) {
  const apply = useChangeSetup("apply");
  const undo = useChangeSetup("undo");
  const [confirming, setConfirming] = useState<"apply" | "undo" | null>(null);
  const [learn, setLearn] = useState(false);
  const busy = apply.isPending || undo.isPending;
  const error = apply.error ?? undo.error;
  // Set up by a devdeck program that is still there (maybe another copy than this one): fine.
  // Set up by a program that is gone: git quietly falls back to the next helper.
  const working = state.applied || (state.registered !== "" && state.registered_exists);
  const broken = state.registered !== "" && !state.registered_exists && !state.applied;

  return (
    <Section
      title="Git credential helper"
      hint="Makes git (and VS Code, and devdeck) ask devdeck which account to use for github.com, instead of asking you. Repositories no rule matches go on as before."
      aside={state.git_found ? <Status ok={working}>{working ? "Set up" : broken ? "Set up, program missing" : "Not configured"}</Status> : undefined}
    >
      {!state.git_found ? (
        <p className="m-0 text-[14px] text-ink-2">Git isn’t installed, so there is nothing to set up.</p>
      ) : (
        <>
          {working && state.registered_program !== "" && <p className="m-0 text-[13px] text-ink-3">Git runs <span className="font-mono">{state.registered_program}</span>.</p>}
          {broken && (
            <p className="m-0 text-[13px] text-warning">
              The program git is set to run, <span className="font-mono">{state.registered_program}</span>, isn’t there any more, so git is asking as it did before. Set up the helper again from this devdeck.
            </p>
          )}
          {learn && (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[13px] text-ink-2">
                {state.applied ? "What was changed" : "What this would change"} in your global git settings, for github.com only:
              </p>
              <pre className="m-0 overflow-x-auto rounded-ctl bg-fill p-3 font-mono text-[12px] leading-5 text-ink-2">{state.commands.join("\n")}</pre>
              {state.general_helpers.length > 0 && <p className="m-0 text-[12px] text-ink-3">Your other helper ({state.general_helpers.join(", ")}) stays in the list after devdeck.</p>}
            </div>
          )}
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
              {!working && (
                <button type="button" onClick={() => setConfirming("apply")} className={primary}>
                  Set up helper
                </button>
              )}
              {state.can_undo && (
                <button type="button" onClick={() => setConfirming("undo")} className={button}>
                  Undo
                </button>
              )}
              <button type="button" aria-expanded={learn} onClick={() => setLearn((v) => !v)} className={button}>
                Learn what changes
              </button>
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

/** The editor: a draft of the profiles and rules, saved together. */
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
      <Section title="Connection profiles" hint="Each profile is one GitHub account that gh is signed in to, with the name and email its commits should carry.">
        {draft.connections.length === 0 ? (
          <p className="m-0 text-[14px] text-ink-3">No profile yet. Add one for each account you use.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className={th}>Profile</th>
                  <th className={th}>GitHub account</th>
                  <th className={th}>Commit name</th>
                  <th className={th}>Commit email</th>
                  <th className={th}>Status</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.connections.map((c, i) => {
                  const name = c.id || `connection ${i + 1}`;
                  const there = c.gh_user !== "" && signedIn.has(c.gh_user.toLowerCase());
                  return (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="px-1 py-1.5">
                        <input aria-label={`Id of connection ${i + 1}`} value={c.id} onChange={(e) => setConn(i, { id: e.target.value })} placeholder="e.g. office" className={`${cell} w-32 font-mono text-[13px]`} />
                      </td>
                      <td className="px-1 py-1.5">
                        <select aria-label={`GitHub account of ${name}`} value={c.gh_user} onChange={(e) => setConn(i, { gh_user: e.target.value })} className={`${pillSelect} w-44`}>
                          {c.gh_user === "" && <option value="">Pick an account…</option>}
                          {overview.accounts.map((a) => (
                            <option key={a.login} value={a.login}>
                              {a.login}
                            </option>
                          ))}
                          {c.gh_user !== "" && !overview.accounts.some((a) => a.login === c.gh_user) && <option value={c.gh_user}>{c.gh_user} (not signed in)</option>}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input aria-label={`Commit name of ${name}`} value={c.name ?? ""} onChange={(e) => setConn(i, { name: e.target.value })} placeholder="Commit name" className={`${pillSelect} w-44`} />
                      </td>
                      <td className="px-1 py-1.5">
                        <input aria-label={`Commit email of ${name}`} value={c.email ?? ""} onChange={(e) => setConn(i, { email: e.target.value })} placeholder="Commit email" className={`${cell} w-60`} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {c.gh_user === "" ? <Status ok={false}>No account</Status> : there ? <Status ok>Available</Status> : <Status ok={false}>Not signed in</Status>}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-end">
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
                          className={`${pillDanger} ms-2`}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {draft.connections.map((c, i) => {
          const there = c.gh_user !== "" && signedIn.has(c.gh_user.toLowerCase());
          return (
            <div key={i} className="flex flex-col gap-1">
              {c.gh_user !== "" && !there && (
                <p className="m-0 text-[13px] text-warning">
                  gh isn’t signed in to {c.gh_user}. Run <span className="font-mono">gh auth login</span> for it.
                </p>
              )}
              {results[c.id] && <CheckResult result={results[c.id]} />}
            </div>
          );
        })}
        <div>
          <button type="button" onClick={addConnection} className={button}>
            Add a connection
          </button>
        </div>
      </Section>

      <Section title="Repository routing rules" hint="Which profile a repository uses, by its address. The most specific rule wins: github.com/owner/repo, then github.com/owner/*, then github.com/*.">
        {draft.rules.length === 0 ? (
          <p className="m-0 text-[14px] text-ink-3">No rule yet. A repository no rule matches is flagged on the Repositories page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className={th}>Repository pattern</th>
                  <th className={th}>Covers</th>
                  <th className={th}>Uses profile</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.rules.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-1 py-1.5">
                      <input aria-label={`Pattern of rule ${i + 1}`} value={r.match} onChange={(e) => setRule(i, { match: e.target.value })} placeholder="github.com/owner/*" spellCheck={false} className={`${cell} w-80 max-w-full font-mono text-[13px]`} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[13px] text-ink-3">{reach(r.match)}</td>
                    <td className="px-1 py-1.5">
                      <select aria-label={`Connection of rule ${i + 1}`} value={r.connection} onChange={(e) => setRule(i, { connection: e.target.value })} className={`${pillSelect} w-44`}>
                        {r.connection === "" && <option value="">Pick a profile…</option>}
                        {draft.connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.id}
                          </option>
                        ))}
                        {r.connection !== "" && !draft.connections.some((c) => c.id === r.connection) && <option value={r.connection}>{r.connection} (missing)</option>}
                      </select>
                    </td>
                    <td className="px-1 py-1.5 text-end">
                      <button type="button" aria-label={`Remove rule ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))} className={pillDanger}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <button type="button" onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, { match: "", connection: d.connections[0]?.id ?? "" }] }))} className={button}>
            Add a rule
          </button>
        </div>
        <AddressTester />
      </Section>

      {(dirty || save.isSuccess || save.error) && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-ctl bg-fill px-4 py-3">
          {dirty && (
            <p className="m-0 text-[14px] text-ink">
              <span className="font-medium">Unsaved changes</span> <span className="text-ink-3">You have made changes that are not saved.</span>
            </p>
          )}
          {!dirty && save.isSuccess && (
            <p role="status" className="m-0 text-[14px] text-ink-2">
              Saved.
            </p>
          )}
          {save.error && (
            <p role="alert" className="m-0 text-[13px] text-critical">
              {save.error.message}
            </p>
          )}
          <span className="ms-auto flex gap-2">
            <button type="button" disabled={!dirty} onClick={() => setDraft(server)} className={button}>
              Discard
            </button>
            <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} className={primary}>
              Save changes
            </button>
          </span>
        </div>
      )}
    </>
  );
}

/** The GitHub accounts devdeck uses: who gh is signed in as, which profile and rules pick the account for a repository, and the git credential helper. */
export function GitHubConnectionPage() {
  const item = navByPath("/connections/github");
  const git = useGit();
  const setup = useGitSetup();
  const [adding, setAdding] = useState(false);

  const header = (
    <PageHeader title={item.label} group={item.group} parent={item.parent} parentTo="/connections" description="Manage GitHub identities and repository routing. Sign-in is done by the GitHub CLI; devdeck stores no token." />
  );

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
        <Section
          title="GitHub CLI accounts"
          hint="Accounts available from gh auth login. The active one is only gh’s own default: devdeck picks the account by rule."
          aside={
            <span className="flex items-center gap-3">
              <Status ok={o.accounts.length > 0}>{o.accounts.length > 0 ? "gh authenticated" : "gh not signed in"}</Status>
              <button type="button" aria-expanded={adding} onClick={() => setAdding((v) => !v)} className={button}>
                Add account
              </button>
            </span>
          }
        >
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
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
            {o.accounts.map((a) => (
              <li key={a.login} className="flex flex-col gap-2 rounded-ctl bg-fill px-4 py-3">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[14px] text-ink">{a.login}</span>
                  {a.active && <span className="text-[12px] text-ink-3">Current</span>}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {a.scopes.map((s) => (
                    <span key={s} className="rounded-ctl bg-inset px-2 py-0.5 text-[12px] text-ink-3">
                      {s}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {adding && <AddAccount />}
        </Section>

        <Editor overview={o} />

        {setup.data && <SetupSection state={setup.data} />}
        {setup.isError && <p className="text-ink-3">Could not read the git settings.</p>}
      </div>
    </>
  );
}
