import { Plus, Upload } from "lucide-react";

import { quietButton } from "../../design/buttons";
import { tokensOf } from "../../theme/builtins";
import { builtInTheme, schemeOf } from "../../theme/store";
import type { ThemeData } from "../../theme/types";
import { ThemeThumb } from "./ThemeThumb";

type Props = {
  custom: ThemeData[];
  /** The theme showing now, and the ones used for light and for dark. */
  activeId: string;
  lightId: string;
  darkId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** A theme file the person picked. */
  onImport: (file: File) => void;
  /** Why the last file was refused, if it was. */
  importError?: string;
};

/** What a card says about its theme: in use now, the one for light or for dark, or just which scheme it is. */
function tagOf(t: ThemeData, active: boolean, lightId: string, darkId: string): string {
  if (active) return "in use";
  if (t.id === lightId) return "for light";
  if (t.id === darkId) return "for dark";
  return schemeOf(t);
}

/** The themes to pick from, each in miniature: the two that ship, then the ones the person made. */
export function ThemeGallery({ custom, activeId, lightId, darkId, onSelect, onNew, onImport, importError }: Readonly<Props>) {
  const all: ThemeData[] = [builtInTheme("paper"), builtInTheme("paper-dark"), ...custom];
  return (
    <section aria-label="Themes" className="flex min-w-0 flex-col gap-4">
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 p-0">
        {all.map((t) => {
          const active = t.id === activeId;
          const builtIn = !custom.some((c) => c.id === t.id);
          return (
            <li key={t.id}>
              <button type="button" aria-label={t.name} aria-pressed={active} onClick={() => onSelect(t.id)} className="flex w-full flex-col gap-2 text-start">
                <span className={`block ${active ? "shadow-[0_0_0_2px_var(--selected)]" : "shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_15%,transparent)] hover:shadow-[0_0_0_1px_var(--ink-3)]"}`}>
                  <ThemeThumb tokens={tokensOf(t)} />
                </span>
                <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink">
                  <span className="truncate">{t.name}</span>
                  {builtIn && <span className="shrink-0 bg-fill px-1.5 font-mono text-[10.5px] font-normal text-ink-3">built in</span>}
                  <span className="ms-auto shrink-0 font-mono text-[10.5px] font-normal text-ink-3">{tagOf(t, active, lightId, darkId)}</span>
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" aria-label="New theme" onClick={onNew} className="flex w-full flex-col gap-2 text-start">
            <span className="grid aspect-[16/10] place-items-center bg-fill text-[13px] text-ink-2 hover:bg-fill-hover hover:text-ink">
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} aria-hidden />
                New theme
              </span>
            </span>
            <span className="text-[13px] text-ink-3">Start from the one in use</span>
          </button>
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${quietButton} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus`}>
          <Upload size={14} aria-hidden />
          Import
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import a theme file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so the same file can be picked again
              if (file) onImport(file);
            }}
          />
        </label>
        {importError && (
          <p role="alert" className="m-0 text-[13px] text-critical">
            {importError}
          </p>
        )}
      </div>
    </section>
  );
}
