import type { FileEntry } from "../files/FileSet";
import { groupFiles } from "../ui/fileGroups";

export interface FileSwitcherProps {
  entries: readonly FileEntry[];
  /** Path of the file shown. */
  current: string | null;
  onSelect: (path: string) => void;
}

/**
 * The opened files in a compact drop-down, grouped as shows, charts and
 * other files; choose one to show it. Shown when more than one file is open.
 */
export function FileSwitcher({ entries, current, onSelect }: FileSwitcherProps) {
  const groups = groupFiles(entries);
  return (
    <div className="file-switcher">
      <label htmlFor="file-switcher" className="column-label">
        File <span className="muted">({entries.length} opened)</span>
      </label>
      <select id="file-switcher" value={current ?? ""} onChange={(e) => onSelect(e.target.value)}>
        {groups.map((group) => (
          <optgroup key={group.kind} label={`${group.label} (${group.files.length})`}>
            {group.files.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.path}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
