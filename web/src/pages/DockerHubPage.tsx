import { useState, type FormEvent, type ReactNode } from "react";

import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { pill, pillDanger, pillInput, pillPrimary } from "../design/pills";
import {
  useCheckDockerAccount,
  useDeleteBuildSecret,
  useDeleteDockerAccount,
  useDocker,
  useForgetDockerToken,
  useSaveDockerAccount,
  useSetBuildSecret,
  useSetDockerToken,
  type DockerAccount,
  type DockerCheck,
} from "../lib/docker";
import { stagger } from "../lib/motion";

const th = "px-3 py-2 text-start text-[13px] font-medium text-ink-3";
const td = "px-3 py-2 align-top";

function Section({ title, hint, children }: Readonly<{ title: string; hint?: string; children: ReactNode }>) {
  return (
    <section aria-label={title} className="enter mt-4 flex flex-col gap-3 rounded-ctl bg-inset p-5" style={{ ...stagger(1) }}>
      <div>
        <h2 className="m-0 text-[16px] font-medium text-ink">{title}</h2>
        {hint && <p className="m-0 mt-1 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A state as a word with a shape, never colour alone. */
function Mark({ ok, children }: Readonly<{ ok: boolean; children: ReactNode }>) {
  const tone = ok ? "var(--good)" : "var(--warning)";
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {ok ? <circle cx="6" cy="6" r="4.5" fill={tone} /> : <path d="M6 1.2 11 10.2H1Z" fill={tone} />}
      </svg>
      {children}
    </span>
  );
}

const list = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** One account row: its token, a test, and removal behind a second click. */
function AccountRow({ a }: Readonly<{ a: DockerAccount }>) {
  const [token, setToken] = useState("");
  const [entering, setEntering] = useState(false);
  const [sure, setSure] = useState(false);
  const setTok = useSetDockerToken();
  const forget = useForgetDockerToken();
  const check = useCheckDockerAccount();
  const del = useDeleteDockerAccount();
  const [result, setResult] = useState<DockerCheck | null>(null);

  const error = setTok.error ?? forget.error ?? check.error ?? del.error;

  function saveToken(e: FormEvent) {
    e.preventDefault();
    setTok.mutate(
      { id: a.id, token },
      {
        onSuccess: () => {
          setToken(""); // never kept in the page once it is saved
          setEntering(false);
        },
      },
    );
  }

  return (
    <tr className="border-t border-line">
      <td className={`${td} font-mono text-[13px] text-ink`}>{a.id}</td>
      <td className={`${td} text-[14px] text-ink`}>{a.username}</td>
      <td className={`${td} text-[13px] text-ink-2`}>{a.namespaces.length > 0 ? a.namespaces.join(", ") : "—"}</td>
      <td className={td}>
        <div className="flex flex-col gap-2">
          <Mark ok={a.token_set}>{a.token_set ? "Token saved" : "No token yet"}</Mark>
          {entering ? (
            <form onSubmit={saveToken} className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                aria-label={`Access token for ${a.id}`}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Docker Hub access token"
                className={`${pillInput} w-64 font-mono`}
              />
              <button type="submit" disabled={!token || setTok.isPending} className={pillPrimary}>
                Save token
              </button>
              <button
                type="button"
                className={pill}
                onClick={() => {
                  setEntering(false);
                  setToken("");
                  setTok.reset();
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={pill} onClick={() => setEntering(true)}>
                {a.token_set ? "Replace token" : "Add token"}
              </button>
              {a.token_set && (
                <>
                  <button
                    type="button"
                    className={pill}
                    disabled={check.isPending}
                    onClick={() => {
                      setResult(null);
                      check.mutate(a.id, { onSuccess: setResult });
                    }}
                  >
                    {check.isPending ? "Testing…" : "Test"}
                  </button>
                  <button type="button" className={pill} disabled={forget.isPending} onClick={() => forget.mutate(a.id)}>
                    Forget token
                  </button>
                </>
              )}
            </div>
          )}
          {result && (
            <p role="status" className="m-0 text-[13px] text-ink-2">
              Signed in as {result.username}. Can push to: {result.namespaces.join(", ")}.
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 text-[13px] text-ink">
              {error.message}
            </p>
          )}
        </div>
      </td>
      <td className={`${td} text-end`}>
        {sure ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
            Remove {a.id} and its token?
            <button type="button" className={pillDanger} disabled={del.isPending} onClick={() => del.mutate(a.id)}>
              Remove
            </button>
            <button type="button" className={pill} onClick={() => setSure(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className={pillDanger} onClick={() => setSure(true)} aria-label={`Remove ${a.id}`}>
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

function AddAccount() {
  const [id, setId] = useState("");
  const [username, setUsername] = useState("");
  const [namespaces, setNamespaces] = useState("");
  const save = useSaveDockerAccount();
  return (
    <form
      aria-label="Add an account"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { id, username, namespaces: list(namespaces) },
          {
            onSuccess: () => {
              setId("");
              setUsername("");
              setNamespaces("");
            },
          },
        );
      }}
    >
      <label className="flex flex-col gap-1 text-[13px] text-ink-3" title="A short name for this account, for example work or personal.">
        Name
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="work" spellCheck={false} autoComplete="off" className={`${pillInput} w-32 font-mono`} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-3">
        Docker Hub username
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" spellCheck={false} autoComplete="off" className={`${pillInput} w-48`} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-3" title="The organisations this account can push to, besides its own username. Images are pushed with the account that owns the first part of their repository name.">
        Organisations (optional)
        <input value={namespaces} onChange={(e) => setNamespaces(e.target.value)} placeholder="acme, acme-labs" spellCheck={false} autoComplete="off" className={`${pillInput} w-56`} />
      </label>
      <button type="submit" disabled={!id || !username || save.isPending} className={pillPrimary}>
        Add account
      </button>
      {save.error && (
        <p role="alert" className="m-0 basis-full text-[13px] text-ink">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function BuildSecrets() {
  const q = useDocker();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const set = useSetBuildSecret();
  const del = useDeleteBuildSecret();
  const secrets = q.data?.build_secrets ?? [];

  return (
    <>
      {secrets.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">No build secrets yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {secrets.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center gap-3 border-t border-line py-2 first:border-t-0">
              <span className="font-mono text-[13px] text-ink">{s.name}</span>
              <Mark ok={s.value_set}>{s.value_set ? "Value saved" : "No value"}</Mark>
              <span className="flex-1" />
              {removing === s.name ? (
                <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
                  Remove {s.name}?
                  <button
                    type="button"
                    className={pillDanger}
                    onClick={() => {
                      del.mutate(s.name);
                      setRemoving(null);
                    }}
                  >
                    Remove
                  </button>
                  <button type="button" className={pill} onClick={() => setRemoving(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className={pillDanger} aria-label={`Remove ${s.name}`} onClick={() => setRemoving(s.name)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        aria-label="Save a build secret"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          set.mutate(
            { name, value },
            {
              onSuccess: () => {
                setName("");
                setValue(""); // never kept in the page once it is saved
              },
            },
          );
        }}
      >
        <label className="flex flex-col gap-1 text-[13px] text-ink-3" title="The name a workspace file uses: secrets: [{id: ..., from: keyring, name: this name}].">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="npm-token" spellCheck={false} autoComplete="off" className={`${pillInput} w-44 font-mono`} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink-3">
          Value
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="the secret"
            className={`${pillInput} w-64 font-mono`}
          />
        </label>
        <button type="submit" disabled={!name || !value || set.isPending} className={pillPrimary}>
          Save secret
        </button>
        {(set.error ?? del.error) && (
          <p role="alert" className="m-0 basis-full text-[13px] text-ink">
            {(set.error ?? del.error)?.message}
          </p>
        )}
      </form>
    </>
  );
}

/** Docker Hub accounts and the secrets a build asks for. Tokens and values go to the OS keychain and are never shown again. */
export function DockerHubPage() {
  const item = navByPath("/connections/docker");
  const q = useDocker();
  const accounts = q.data?.accounts ?? [];

  return (
    <>
      <PageHeader
        title={item.label}
        group={item.group}
        parent={item.parent}
        parentTo="/connections"
        description="The Docker Hub accounts devdeck pushes images with. Each repository is pushed with the account that owns its namespace."
      />

      {q.data && !q.data.docker_installed && (
        <p role="status" className="enter mt-4 rounded-ctl bg-fill p-3 text-[13px] text-ink-2" style={stagger(1)}>
          Docker isn’t installed, or isn’t on the PATH. Install Docker Desktop to build images.
        </p>
      )}
      {q.isError && (
        <p role="alert" className="mt-4 text-[14px] text-ink">
          The Docker accounts couldn’t be read: {q.error.message}
        </p>
      )}

      <Section title="Accounts" hint="A token is made on hub.docker.com under Account settings, Personal access tokens, with Read & Write permission. It is kept in your OS keychain and never shown again.">
        {accounts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Username</th>
                  <th className={th}>Organisations</th>
                  <th className={th}>Token</th>
                  <th className={th}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <AccountRow key={a.id} a={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && accounts.length === 0 && <p className="m-0 text-[13px] text-ink-3">No account yet. Add one to push images.</p>}
        <AddAccount />
      </Section>

      <Section
        title="Build secrets"
        hint="Values an image's Dockerfile asks for while it builds (RUN --mount=type=secret), such as a package token. A workspace file names a secret; the value stays here, in your keychain. A GitHub token needs no entry: devdeck uses the GitHub account that owns the repository."
      >
        <BuildSecrets />
      </Section>
    </>
  );
}
