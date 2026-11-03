import { Plus, Trash2 } from "lucide-react";

import { addRepo, formValues, removeRepo, setRepoField, setTopLevel } from "../../lib/yaml-doc";

// The same file as the YAML view, as fields. Every change goes through the yaml Document, so comments,
// blank lines and the order of keys stay as they were written.

const REPO_TYPES = ["go", "node", "python", "docker", "other"];

const input =
  "h-[34px] w-full min-w-0 bg-inset px-2.5 text-[13px] text-ink placeholder:text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

function Field({ name, hint, children }: Readonly<{ name: string; hint?: string; children: React.ReactNode }>) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-ink-3" title={hint}>
      {name}
      {children}
    </label>
  );
}

export function FormView({ text, onChange, readOnly }: Readonly<{ text: string; onChange: (text: string) => void; readOnly?: boolean }>) {
  const form = formValues(text);
  if (!form.ok) {
    return (
      <p role="status" className="m-0 p-6 text-[14px] text-ink-3">
        The text can’t be read as a workspace yet. Fix it in the YAML view, then come back.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 overflow-auto p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="Name" hint="The name is the folder the workspace lives in, so it can't change.">
          <input value={form.name} disabled aria-label="Name" className={`${input} font-mono`} />
        </Field>
        <Field name="Root" hint="The folder that holds the repos. Repo paths are relative to it.">
          <input
            value={form.root}
            disabled={readOnly}
            aria-label="Root"
            onChange={(e) => onChange(setTopLevel(text, "root", e.target.value))}
            className={`${input} font-mono`}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field name="Description">
            <input value={form.description} disabled={readOnly} aria-label="Description" onChange={(e) => onChange(setTopLevel(text, "description", e.target.value))} className={input} />
          </Field>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[13px] font-medium text-ink-2">Repos · {form.repos.length}</h3>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange(addRepo(text))}
            className="inline-flex h-7 items-center gap-1.5 bg-fill px-2.5 text-[12px] text-ink transition-colors enabled:hover:bg-fill-hover disabled:opacity-50"
          >
            <Plus size={14} aria-hidden /> Add repo
          </button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {form.repos.map((r) => (
            <li key={r.index} className="grid grid-cols-[1fr_1.4fr_7rem_auto] items-center gap-2 max-md:grid-cols-2" aria-label={`Repo ${r.id || r.index + 1}`}>
              <input value={r.id} disabled={readOnly} placeholder="id" aria-label={`Repo ${r.index + 1} id`} onChange={(e) => onChange(setRepoField(text, r.index, "id", e.target.value))} className={`${input} font-mono`} />
              <input value={r.path} disabled={readOnly} placeholder="path" aria-label={`Repo ${r.index + 1} path`} onChange={(e) => onChange(setRepoField(text, r.index, "path", e.target.value))} className={`${input} font-mono`} />
              <select value={r.type ?? ""} disabled={readOnly} aria-label={`Repo ${r.index + 1} type`} onChange={(e) => onChange(setRepoField(text, r.index, "type", e.target.value))} className={input}>
                <option value="">type</option>
                {REPO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-3" title="Not meant to be a git repository: stops the warning about a missing .git">
                  <input type="checkbox" checked={r.localOnly} disabled={readOnly} aria-label={`Repo ${r.index + 1} local only`} onChange={(e) => onChange(setRepoField(text, r.index, "local_only", e.target.checked))} />
                  local only
                </label>
                <button
                  type="button"
                  disabled={readOnly}
                  aria-label={`Remove repo ${r.id || r.index + 1}`}
                  title="Remove this repo from the file"
                  onClick={() => onChange(removeRepo(text, r.index))}
                  className="grid size-7 place-items-center text-ink-3 transition-colors enabled:hover:bg-fill enabled:hover:text-ink disabled:opacity-50"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <input
                value={r.remote ?? ""}
                disabled={readOnly}
                placeholder="remote (github.com/acme/demo-api)"
                aria-label={`Repo ${r.index + 1} remote`}
                onChange={(e) => onChange(setRepoField(text, r.index, "remote", e.target.value))}
                className={`${input} font-mono col-span-full`}
              />
            </li>
          ))}
        </ul>
      </section>
      <p className="m-0 text-[12px] text-ink-3">Anything this form doesn’t show (connections, hosts, rules) is left exactly as it is. Use the YAML view for those.</p>
    </div>
  );
}
