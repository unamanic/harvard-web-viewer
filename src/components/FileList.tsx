import type { FileEntry } from "../files/FileSet";
import { groupFiles } from "../ui/fileGroups";

export interface FileListProps {
  entries: readonly FileEntry[];
  /** Path of the file shown. */
  current: string | null;
  onSelect: (path: string) => void;
}

/** The opened files, grouped as shows, charts and other files; choose one to show it. */
export function FileList({ entries, current, onSelect }: FileListProps) {
  const groups = groupFiles(entries);
  return (
    <nav className="file-list" aria-label="Opened files">
      {groups.map((group) => (
        <section key={group.kind} className={`file-group file-group-${group.kind}`}>
          <h2 id={`files-${group.kind}`}>
            {group.label} <span className="muted">({group.files.length})</span>
          </h2>
          <ul aria-labelledby={`files-${group.kind}`}>
            {group.files.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="file-button"
                  aria-current={entry.path === current ? "page" : undefined}
                  onClick={() => onSelect(entry.path)}
                  title={entry.path}
                >
                  <span className="file-name">{entry.name}</span>
                  {entry.path !== entry.name && (
                    <span className="file-dir">{entry.path.slice(0, entry.path.length - entry.name.length - 1)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
