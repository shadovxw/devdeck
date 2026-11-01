import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useBlocker } from "react-router";

import { Button } from "@/components/ui/button";
import { BUILT_INS, roleColor, tokensOf } from "../../theme/builtins";
import { colorOf, contrastChecks, ROLE_CHECKS } from "../../theme/checks";
import { downloadTheme, readThemeFile } from "../../theme/file";
import { useUi } from "../../store/ui";
import { activeTheme, isDirty, useTheme, type Mode } from "../../theme/store";
import { ADVANCED, ROLES, type RoleId } from "../../theme/types";
import { EditorBar } from "./EditorBar";
import { RoleRow } from "./RoleRow";
import { ThemeGallery } from "./ThemeGallery";
import { SegmentedRow } from "./SegmentedRow";
import { ThemePreview } from "./ThemePreview";

/** The roles in the order a person looks for them. */
const GROUPS: { name: string; roles: RoleId[] }[] = [
  { name: "Surfaces", roles: ["background", "cards", "controls"] },
  { name: "Text", roles: ["text", "selected"] },
  { name: "Accent", roles: ["primary"] },
  { name: "Status", roles: ["success", "warning", "error", "neutral"] },
];

const MODES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const satisfies readonly { id: Mode; label: string; icon: unknown }[];

const MOTION = [
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
] as const;

const heading = "m-0 text-[16px] font-semibold leading-6 text-ink";
const label = "m-0 mb-1 font-mono text-[11px] font-normal uppercase leading-[14px] tracking-[0.06em] text-ink-3";

/** The bar shown when someone tries to leave with changes that were not saved. */
function LeavePrompt({ onSave, onDiscard, onStay }: Readonly<{ onSave: () => void; onDiscard: () => void; onStay: () => void }>) {
  return (
    <div role="alertdialog" aria-label="Unsaved changes" className="flex flex-wrap items-center gap-3 bg-inset px-3.5 py-3">
      <p className="m-0 text-[13px] text-ink">You changed this theme and haven’t saved it.</p>
      <span className="ms-auto flex gap-2">
        <Button onClick={onSave}>Save and leave</Button>
        <Button variant="secondary" onClick={onDiscard}>
          Discard and leave
        </Button>
        <Button variant="ghost" onClick={onStay}>
          Stay
        </Button>
      </span>
    </div>
  );
}

/** The themes as a gallery, and the colours of the one in use. Changes show on the whole app as they are made; Save keeps them. */
export function Appearance() {
  const state = useTheme();
  const { custom, activeId, mode, lightId, darkId, select, setMode, create, edit, rename, save, discard, remove, importTheme } = state;
  const reduceMotion = useUi((s) => s.reduceMotion);
  const setReduceMotion = useUi((s) => s.setReduceMotion);
  const [importError, setImportError] = useState<string>();
  const theme = activeTheme(state);
  const dirty = isDirty(state);
  const editable = custom.some((t) => t.id === activeId);
  const tokens = tokensOf(theme);
  const checks = contrastChecks(tokens);
  const blocker = useBlocker(dirty);

  async function onImport(file: File) {
    const read = await readThemeFile(file);
    setImportError(read.error);
    if (read.theme) importTheme(read.theme);
  }

  const duplicate = () => create(`${theme.name} copy`, theme);
  const roleRow = (id: RoleId) => {
    const role = ROLES.find((r) => r.id === id)!;
    return (
      <RoleRow
        key={id}
        label={role.label}
        hint={role.hint}
        color={roleColor(theme, id)}
        changed={theme.colors[id] !== undefined && theme.colors[id] !== BUILT_INS[theme.base].roles[id]}
        readOnly={!editable}
        checks={checks.filter((c) => ROLE_CHECKS[id].includes(c.id))}
        onChange={(color) => edit(id, color)}
        onReset={() => edit(id, undefined)}
      />
    );
  };

  return (
    <div className="flex flex-col gap-10">
      {blocker.state === "blocked" && <LeavePrompt onSave={() => { save(); blocker.proceed(); }} onDiscard={() => { discard(); blocker.proceed(); }} onStay={() => blocker.reset()} />}

      <div className="flex flex-col gap-4">
        <SegmentedRow title="Mode" description="System follows your OS and switches between your light and dark theme." options={MODES} value={mode} onChange={setMode} />
        <SegmentedRow
          title="Reduce motion"
          description="Stops spinners and live pulses from animating, and turns movement into a cut."
          options={MOTION}
          value={reduceMotion ? "on" : "off"}
          onChange={(v) => setReduceMotion(v === "on")}
        />
        <div>
          <h3 className={heading}>Themes</h3>
          <p className="m-0 mt-0.5 text-[13px] text-ink-3">Pick one for light and one for dark, or make your own from one.</p>
        </div>
        <ThemeGallery custom={custom} activeId={activeId} lightId={lightId} darkId={darkId} onSelect={select} onNew={() => create("My theme", theme)} onImport={(file) => void onImport(file)} importError={importError} />
      </div>

      <section aria-label="Colours" className="flex flex-col gap-4">
        <div>
          <h3 className={heading}>{theme.name}</h3>
          <p className="m-0 mt-0.5 text-[13px] text-ink-3">Every colour, with how readable it is on the background.</p>
        </div>
        <EditorBar
          name={theme.name}
          builtIn={!editable}
          dirty={dirty}
          onRename={rename}
          onSave={save}
          onDiscard={discard}
          onDuplicate={duplicate}
          onExport={() => downloadTheme(theme)}
          onDelete={() => remove(theme.id)}
        />
        <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-5">
            {GROUPS.map((g) => (
              <div key={g.name}>
                <h4 className={label}>{g.name}</h4>
                <ul className="m-0 flex list-none flex-col p-0">{g.roles.map(roleRow)}</ul>
              </div>
            ))}
            <details>
              <summary className="cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink">Advanced</summary>
              <p className="m-0 mt-2 text-[12px] text-ink-3">Every colour that is worked out from the ones above. Set one here and it stays as you set it.</p>
              <ul className="m-0 mt-2 flex list-none flex-col p-0">
                {ADVANCED.map((a) => (
                  <RoleRow
                    key={a.token}
                    label={a.label}
                    hint={a.token}
                    color={theme.colors[a.token] ?? colorOf(tokens, a.token)}
                    changed={theme.colors[a.token] !== undefined}
                    readOnly={!editable}
                    checks={[]}
                    onChange={(color) => edit(a.token, color)}
                    onReset={() => edit(a.token, undefined)}
                  />
                ))}
              </ul>
            </details>
          </div>
          <ThemePreview tokens={tokens} checks={checks} />
        </div>
      </section>
    </div>
  );
}
