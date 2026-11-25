import { useMemo, useState } from "react";
import type { ByteRange } from "../ui/hexRows";
import { recordTreeOf } from "../ui/recordTree";
import { HexInspector } from "./HexInspector";
import { RecordTree } from "./RecordTree";

/**
 * File structure panel (collapsed by default): the HG3 record tree next to
 * the hex dump; choosing a record highlights its bytes.
 */
export function Inspector({ bytes, open = false }: { bytes: Uint8Array; open?: boolean }) {
  const tree = useMemo(() => recordTreeOf(bytes), [bytes]);
  const [selected, setSelected] = useState<{ key: string; range: ByteRange } | null>(null);
  // A new file clears the selection.
  const [shownBytes, setShownBytes] = useState(bytes);
  if (shownBytes !== bytes) {
    setShownBytes(bytes);
    setSelected(null);
  }

  return (
    <details className="panel inspector" open={open || undefined}>
      <summary>File structure and bytes</summary>
      <div className="inspector-body">
        {tree.ok ? (
          <RecordTree
            rows={tree.rows}
            selected={selected?.key ?? null}
            onSelect={(row) => setSelected({ key: row.key, range: { start: row.start, end: row.end } })}
          />
        ) : (
          <p className="muted inspector-note">No record tree: {tree.error}</p>
        )}
        <HexInspector bytes={bytes} highlight={selected?.range ?? null} />
      </div>
    </details>
  );
}
