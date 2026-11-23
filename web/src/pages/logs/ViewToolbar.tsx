import { Bookmark, Eraser, List, Pause, Play, ZoomOut } from "lucide-react";

import { Menu, type MenuItem } from "../../design/Menu";
import { primary, small } from "./styles";

type Props = {
  /** False when the view is a past stretch, not the live end. */
  live: boolean;
  paused: boolean;
  onPause: (paused: boolean) => void;
  onBackToLive: () => void;
  onZoomOut: () => void;
  /** A sample workspace can't be changed. */
  sample: boolean;
  saving: boolean;
  onToggleSave: () => void;
  onClear: () => void;
  status: string;
  menu: MenuItem[];
};

/** Pause or go back to live, keep the filters, clear the stored lines, and say how many lines there are. */
export function ViewToolbar({ live, paused, onPause, onBackToLive, onZoomOut, sample, saving, onToggleSave, onClear, status, menu }: Readonly<Props>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {live ? (
        <button type="button" onClick={() => onPause(!paused)} aria-pressed={paused} className={primary}>
          {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
          {paused ? "Resume" : "Pause"}
        </button>
      ) : (
        <>
          <button type="button" onClick={onBackToLive} className={primary}>
            <Play size={15} aria-hidden />
            Back to live
          </button>
          <button type="button" onClick={onZoomOut} className={small}>
            <ZoomOut size={15} aria-hidden />
            Zoom out
          </button>
        </>
      )}
      <button type="button" onClick={onToggleSave} aria-expanded={saving} disabled={sample} title={sample ? "Sample workspaces can’t be changed" : "Keep these filters with the workspace"} className={small}>
        <Bookmark size={15} aria-hidden />
        Save filter
      </button>
      <button type="button" onClick={onClear} disabled={sample} title={sample ? "Sample workspaces have no stored logs" : "Delete the stored lines"} className={small}>
        <Eraser size={15} aria-hidden />
        Clear
      </button>
      <span className="ms-auto inline-flex items-center gap-2 text-[14px] tabular-nums text-ink-2">
        <List size={15} aria-hidden />
        <span role="status">{status}</span>
      </span>
      <Menu label="More actions" items={menu} />
    </div>
  );
}
