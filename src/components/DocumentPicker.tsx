/**
 * "Choose what to open": shown when an opened ZIP archive holds more than
 * one show, or no show and several charts (files/openFiles.ts). The user
 * picks one; the rest stay in the set, so the file switcher can open them
 * later.
 */
import { useId, useRef } from "react";
import type { FileEntry } from "../files/FileSet";
import { fileKind } from "../files/fileKind";
import { useDialogKeys } from "../ui/hooks";

export interface DocumentPickerProps {
  choices: readonly FileEntry[];
  onPick: (entry: FileEntry) => void;
  onCancel: () => void;
}

/** Folder of a set path ("SALES.ZIP/Q1/SALES.SH3" → "SALES.ZIP/Q1"). */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/** "3 shows" / "2 charts" / "1 show and 2 charts". */
export function pickerSummary(choices: readonly FileEntry[]): string {
  const shows = choices.filter((c) => fileKind(c.name, c.bytes) === "show").length;
  const charts = choices.length - shows;
  const part = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  if (charts === 0) return part(shows, "show", "shows");
  if (shows === 0) return part(charts, "chart", "charts");
  return `${part(shows, "show", "shows")} and ${part(charts, "chart", "charts")}`;
}

export function DocumentPicker({ choices, onPick, onCancel }: DocumentPickerProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = useDialogKeys(ref, onCancel);

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} className="dialog picker-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="dialog-header">
          <h2 id={titleId}>Choose what to open</h2>
        </header>
        <p className="muted dialog-note">
          The archive holds {pickerSummary(choices)}. The others stay open in the file switcher.
        </p>
        <ul className="picker-list">
          {choices.map((c) => (
            <li key={c.path}>
              <button type="button" className="picker-item" onClick={() => onPick(c)}>
                <span className="picker-name">{c.name}</span>
                <span className="picker-meta">
                  {fileKind(c.name, c.bytes) === "show" ? "Show" : "Chart"}
                  {folderOf(c.path) && ` · ${folderOf(c.path)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
