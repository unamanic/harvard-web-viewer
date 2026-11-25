import { useState } from "react";
import { type RecordRow, visibleRows } from "../ui/recordTree";

export interface RecordTreeProps {
  rows: readonly RecordRow[];
  /** Key of the selected row. */
  selected: string | null;
  onSelect: (row: RecordRow) => void;
}

function rowText(row: RecordRow): string {
  if (row.kind === "signature") return row.name;
  const tag = row.kind === "block" ? `${row.tag}…${row.closeTag}` : String(row.tag);
  return row.name ? `${tag} ${row.name}` : tag;
}

function rowDetail(row: RecordRow): string {
  const size = row.kind === "block" ? `${row.childCount} record(s), ${row.end - row.start} bytes` : `length ${row.length}`;
  return `@${row.offset.toString(16)} · ${size}`;
}

/**
 * The HG3 record tree: tag, offset and length of every record, blocks
 * indented and collapsible. Choosing a row highlights its bytes.
 */
export function RecordTree({ rows, selected, onSelect }: RecordTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <section className="record-tree" aria-label="Record tree">
      <h4>
        Records <span className="muted">({rows.length - 1})</span>
      </h4>
      <ul className="record-list">
        {visibleRows(rows, collapsed).map((row) => {
          const open = !collapsed.has(row.key);
          return (
            <li key={row.key} className={`record-row record-${row.kind}`} style={{ paddingInlineStart: `${row.depth * 1}rem` }}>
              {row.kind === "block" ? (
                <button
                  type="button"
                  className="record-toggle"
                  onClick={() => toggle(row.key)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${row.name} at offset ${row.offset}`}
                >
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span className="record-toggle" aria-hidden="true" />
              )}
              <button
                type="button"
                className="record-select"
                aria-pressed={selected === row.key}
                onClick={() => onSelect(row)}
              >
                <span className="record-tag">{rowText(row)}</span>{" "}
                <span className="record-detail">{rowDetail(row)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
