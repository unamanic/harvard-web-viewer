import { useEffect, useMemo, useRef } from "react";
import { type ByteRange, formatOffset, hexRows, hexWindow, rowTouches } from "../ui/hexRows";

export interface HexInspectorProps {
  bytes: Uint8Array;
  /** Bytes shown at a time. */
  limit?: number;
  /** Bytes to highlight (e.g. the record chosen in the record tree); the view moves to them. */
  highlight?: ByteRange | null;
}

/** A hex dump of the file (the first `limit` bytes, or around the highlight), to aid format discovery. */
export function HexInspector({ bytes, limit = 4096, highlight = null }: HexInspectorProps) {
  const view = hexWindow(bytes.length, limit, highlight);
  const { start, end } = view;
  const rows = useMemo(() => hexRows(bytes, { start, end }), [bytes, start, end]);
  const firstHit = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = firstHit.current;
    const box = el?.closest(".hex");
    if (!el || !box) return;
    // Scroll the dump only, not the page.
    const top = el.offsetTop - (box as HTMLElement).offsetTop;
    const b = box as HTMLElement;
    if (top < b.scrollTop || top > b.scrollTop + b.clientHeight - el.offsetHeight) b.scrollTop = top - b.clientHeight / 3;
  }, [highlight?.start, highlight?.end]);

  let marked = false;
  const caption =
    view.start === 0 && view.end === bytes.length
      ? `${bytes.length} bytes`
      : `${bytes.length} bytes, showing ${formatOffset(view.start)}–${formatOffset(Math.max(view.end - 1, 0))}`;

  return (
    <section className="hex-inspector" aria-label="Hex inspector">
      <h4>Bytes <span className="muted">({caption})</span></h4>
      <pre className="hex" tabIndex={0} aria-label="Hex dump">
        {rows.map((row) => {
          const touched = rowTouches(row, highlight);
          const offset = formatOffset(row.offset);
          if (!touched || !highlight) {
            return `${offset}  ${row.hex.join(" ").padEnd(47, " ")}  |${row.ascii.join("")}|\n`;
          }
          const ref = marked ? undefined : firstHit;
          marked = true;
          const inRange = (i: number) => row.offset + i >= highlight.start && row.offset + i < highlight.end;
          return (
            <span key={row.offset} ref={ref} className="hex-row-hit">
              {offset}
              {"  "}
              {row.hex.map((h, i) => (
                <span key={i}>
                  {i > 0 ? inRange(i) && inRange(i - 1) ? <mark> </mark> : " " : ""}
                  {inRange(i) ? <mark>{h}</mark> : h}
                </span>
              ))}
              {" ".repeat(Math.max(0, 47 - (row.hex.length * 3 - 1)))}
              {"  |"}
              {row.ascii.map((c, i) => (inRange(i) ? <mark key={i}>{c}</mark> : c))}
              {"|\n"}
            </span>
          );
        })}
      </pre>
    </section>
  );
}
