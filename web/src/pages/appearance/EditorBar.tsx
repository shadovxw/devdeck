import { Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  name: string;
  /** A built-in theme: shown, not edited. */
  builtIn: boolean;
  /** There are unsaved changes. */
  dirty: boolean;
  onRename: (name: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
};

/** What can be done with the theme being looked at: copy a built-in one, or save, rename, copy, export and delete one of your own. */
export function EditorBar({ name, builtIn, dirty, onRename, onSave, onDiscard, onDuplicate, onExport, onDelete }: Readonly<Props>) {
  const [deleting, setDeleting] = useState(false);

  if (builtIn) {
    return (
      <div className="flex flex-wrap items-center gap-3 bg-fill px-3.5 py-2.5">
        <Lock size={14} aria-hidden className="text-ink-3" />
        <p className="m-0 text-[13px] text-ink-2">A built-in theme can’t be changed.</p>
        <Button className="ms-auto" onClick={onDuplicate}>
          Duplicate &amp; edit
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 bg-fill px-3.5 py-2.5">
      <label className="sr-only" htmlFor="theme-name">
        Theme name
      </label>
      <input
        id="theme-name"
        value={name}
        maxLength={40}
        onChange={(e) => onRename(e.target.value)}
        className="h-[34px] w-60 bg-bg px-3 text-[14px] font-semibold text-ink outline-none"
      />
      {deleting ? (
        <span className="ms-auto flex items-center gap-2 text-[13px] text-ink">
          Delete “{name}”?
          <Button
            variant="destructive"
            onClick={() => {
              setDeleting(false);
              onDelete();
            }}
          >
            Delete
          </Button>
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <span className="ms-auto flex flex-wrap gap-2">
          {dirty && (
            <>
              <Button onClick={onSave}>Save</Button>
              <Button variant="secondary" onClick={onDiscard}>
                Discard
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="ghost" onClick={onExport}>
            Export
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </span>
      )}
    </div>
  );
}
