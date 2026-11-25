/** Hex dump rows with an optional highlighted byte range (pure, no React). */

export const BYTES_PER_LINE = 16;

export interface HexRow {
  offset: number;
  /** Two hex digits per byte. */
  hex: string[];
  /** One printable character per byte ("." for others). */
  ascii: string[];
}

export interface ByteRange {
  start: number;
  /** Exclusive. */
  end: number;
}

/** The window of `limit` bytes to show: from 0, or around `focus` when it lies past the first window. */
export function hexWindow(length: number, limit: number, focus?: ByteRange | null): ByteRange {
  let start = 0;
  if (focus && focus.start >= limit) {
    // Two lines of context above the focused range.
    start = Math.max(0, Math.floor(focus.start / BYTES_PER_LINE) * BYTES_PER_LINE - 2 * BYTES_PER_LINE);
  }
  return { start, end: Math.min(length, start + limit) };
}

/** Rows for bytes [range.start, range.end), offsets absolute. */
export function hexRows(bytes: Uint8Array, range: ByteRange): HexRow[] {
  const rows: HexRow[] = [];
  for (let offset = range.start; offset < range.end; offset += BYTES_PER_LINE) {
    const chunk = bytes.subarray(offset, Math.min(offset + BYTES_PER_LINE, range.end));
    rows.push({
      offset,
      hex: Array.from(chunk, (b) => b.toString(16).padStart(2, "0")),
      ascii: Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")),
    });
  }
  return rows;
}

/** Does the row overlap the range? */
export function rowTouches(row: HexRow, range: ByteRange | null | undefined): boolean {
  return !!range && row.offset < range.end && row.offset + row.hex.length > range.start;
}

export function formatOffset(offset: number): string {
  return offset.toString(16).padStart(8, "0");
}
