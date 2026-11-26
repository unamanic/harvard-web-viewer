/**
 * "Choose what to open": shown when an opened ZIP archive holds more than
 * one show, or no show and several charts (files/openFiles.ts). The user
 * picks one; the rest stay in the set, so the file switcher can open them
 * later.
 */
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import type { FileEntry } from "../files/FileSet";
import { fileGroupKind } from "../ui/fileGroups";

export interface DocumentPickerProps {
  choices: readonly FileEntry[];
  onPick: (entry: FileEntry) => void;
  onCancel: () => void;
}

const FOCUSABLE = "button:not([disabled])";

/** Folder of a set path ("SALES.ZIP/Q1/SALES.SH3" → "SALES.ZIP/Q1"). */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/** "3 shows" / "2 charts" / "1 show and 2 charts". */
export function pickerSummary(choices: readonly FileEntry[]): string {
  const shows = choices.filter((c) => fileGroupKind(c.name, c.bytes) === "show").length;
  const charts = choices.length - shows;
  const part = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  if (charts === 0) return part(shows, "show", "shows");
  if (shows === 0) return part(charts, "chart", "charts");
  return `${part(shows, "show", "shows")} and ${part(charts, "chart", "charts")}`;
}

export function DocumentPicker({ choices, onPick, onCancel }: DocumentPickerProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => before?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

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
                  {fileGroupKind(c.name, c.bytes) === "show" ? "Show" : "Chart"}
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
