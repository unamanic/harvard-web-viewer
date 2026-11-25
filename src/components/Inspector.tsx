import { useEffect, useMemo, useRef, useState } from "react";
import type { ByteRange } from "../ui/hexRows";
import { recordTreeOf } from "../ui/recordTree";
import { HexInspector } from "./HexInspector";
import { RecordTree } from "./RecordTree";

/**
 * The raw bytes: the HG3 record tree next to the hex dump; choosing a
 * record highlights its bytes.
 */
export function Inspector({ bytes }: { bytes: Uint8Array }) {
  const tree = useMemo(() => recordTreeOf(bytes), [bytes]);
  const [selected, setSelected] = useState<{ key: string; range: ByteRange } | null>(null);
  // A new file clears the selection.
  const [shownBytes, setShownBytes] = useState(bytes);
  if (shownBytes !== bytes) {
    setShownBytes(bytes);
    setSelected(null);
  }

  return (
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
  );
}

/**
 * "Show raw bytes": a drawer over the right of the page holding the
 * inspector, with a close button; Esc closes it too.
 */
export function RawBytesDrawer({ bytes, fileName, onClose }: { bytes: Uint8Array; fileName: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="drawer-header">
          <h2 id="drawer-title">Raw bytes of {fileName}</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted drawer-note">
          The file as stored: its records (for Harvard Graphics files) beside the bytes. Choose a record to highlight it.
        </p>
        <Inspector bytes={bytes} />
      </div>
    </div>
  );
}
