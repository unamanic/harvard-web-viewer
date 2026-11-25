/**
 * Table chart data (type 0x21, SPEC §5.4, task 11e): slot 6 cells, plus
 * 1206 to 1214. Findings from the 2 sample tables (GALD171, GALD181),
 * checked against their drawn copies:
 *
 * - 1208 (936 bytes) is 24 column entries of 39 bytes: f64 left, f64 right
 *   (not set for unused columns), u8 justification (1 left, 2 centre: equal
 *   to the cells' justification in both samples) [I], u8 [?] (3 / 5), then
 *   19 bytes holding two "not set" f64 [?]. Left/right are percentages of
 *   the page width: x = p / 100 × 32768 − 16384 gives the drawn cell text
 *   edges to within 2 units (e.g. 23.55 % → −8667, drawn −8666). [I]
 * - 1214 (384 bytes) is 24 row entries of two f64, top and bottom, in
 *   percent of the page height from the top: y = 12288 − p / 100 × 24576
 *   gives the drawn text box tops (26.82 % → 5697, drawn 5697). One entry
 *   per drawn row band: a header spanning two stored rows (raw6 = 2) is one
 *   entry, and an empty row between data rows gets its own (shorter) entry.
 *   The cell text is centred vertically in its band. On the 11 × 8.5 in
 *   GALD181 the height is 32768 × 8.5 / 11 = 25321 instead of 24576: the
 *   percentages refer to a page 32768 wide with the page setup's aspect
 *   ratio (all 39 drawn cell texts centred in their band to within 2 units).
 *   [I]
 * - 1212 (403 bytes) is a 3-byte head then 10 entries of 40 bytes: 23 bytes
 *   [?], f64 low, f64 high, u8 colour role (33..42). It is a value-range
 *   colour table: in GALD181 (head byte 0 = 1) every numeric cell's drawn
 *   background has the role of the range holding its value (8 → 0..9 → 33,
 *   34 → 30..39 → 36); in GALD171 (head byte 0 = 2) the ranges are not set
 *   and cells have no background. [I]
 * - 1206 and 1210 kept raw.
 */
import type { Chart } from "../chart";
import { type TextLine, TextSlot } from "../text";
import { type RawRecord, f64At, otherRecords, singleRaw } from "./common";

export const TableTag = {
  StyleTable: 1202,
  Options1206: 1206,
  Columns: 1208,
  Options1210: 1210,
  ColorRanges: 1212,
  Rows: 1214,
} as const;

export const COLUMN_ENTRY_LENGTH = 39;
export const ROW_ENTRY_LENGTH = 16;
const RANGES_HEAD = 3;
export const RANGE_ENTRY_LENGTH = 40;

/** [I] Page extent that table percentages refer to (see header comment). */
export const TABLE_PERCENT_WIDTH = 32768;
/** [I] Height for a 10 × 7.5 in landscape page; see `tablePercentHeight`. */
export const TABLE_PERCENT_HEIGHT = 24576;

/** [I] Height that 1214 percentages refer to: 32768 scaled by the page setup's aspect ratio (816). */
export function tablePercentHeight(widthIn: number, heightIn: number): number {
  return widthIn > 0 && heightIn > 0 ? (TABLE_PERCENT_WIDTH * heightIn) / widthIn : TABLE_PERCENT_HEIGHT;
}

/** Page x for a 1208 percentage [I]. */
export function tablePercentToX(p: number): number {
  return (p / 100) * TABLE_PERCENT_WIDTH - TABLE_PERCENT_WIDTH / 2;
}

/** Page y for a 1214 percentage (measured from the top) [I]. */
export function tablePercentToY(p: number, height: number = TABLE_PERCENT_HEIGHT): number {
  return height / 2 - (p / 100) * height;
}

export interface TableColumn {
  index: number;
  /** Percent of the page width; null = not set. */
  left: number | null;
  right: number | null;
  /** Byte 16 [I]. */
  justification: number;
  /** Byte 17 [?]. */
  raw17: number;
  raw: Uint8Array;
}

export interface TableRowBand {
  index: number;
  /** Percent of the page height from the top; null = not set. */
  top: number | null;
  bottom: number | null;
}

export interface TableColorRange {
  index: number;
  low: number | null;
  high: number | null;
  colorRole: number;
  raw: Uint8Array;
}

export interface TableColorRanges {
  /** Head byte 0 == 1 [I]. */
  enabled: boolean;
  head: Uint8Array;
  ranges: TableColorRange[];
}

export interface TableData {
  kind: "table";
  /** Slot 6 lines sorted by row then column. */
  cells: TextLine[];
  /** grid[row][column]: the cell line or null. Rows/columns up to the highest stored. */
  grid: (TextLine | null)[][];
  rowCount: number;
  columnCount: number;
  /** 1208 entries whose left and right are set (candidate column extents). */
  columns: TableColumn[];
  /** Every 1208 entry, including unused ones. */
  allColumns: TableColumn[];
  /** 1214 entries whose top and bottom are set (candidate row positions). */
  rowBands: TableRowBand[];
  colorRanges: TableColorRanges | null;
  raw1206: Uint8Array | null;
  raw1210: Uint8Array | null;
  otherRecords: RawRecord[];
}

function lengthWarning(tag: number, data: Uint8Array, entry: number, head: number, warnings: string[]): void {
  if ((data.length - head) % entry !== 0) {
    warnings.push(`table record ${tag} length ${data.length} does not hold whole ${entry}-byte entries; partial entry ignored`);
  }
}

export function parseTableData(chart: Chart, warnings: string[]): TableData {
  const cells = chart.textLines
    .filter((l) => l.slot === TextSlot.TableCells)
    .sort((a, b) => a.row - b.row || a.column - b.column);
  const rowCount = cells.reduce((n, c) => Math.max(n, c.row + 1), 0);
  const columnCount = cells.reduce((n, c) => Math.max(n, c.column + 1), 0);
  const grid: (TextLine | null)[][] = Array.from({ length: rowCount }, () => Array<TextLine | null>(columnCount).fill(null));
  for (const c of cells) {
    const row = grid[c.row]!;
    if (row[c.column]) warnings.push(`table cell (${c.row}, ${c.column}) repeated; using the first`);
    else row[c.column] = c;
  }

  const allColumns: TableColumn[] = [];
  const raw1208 = singleRaw(chart, TableTag.Columns, warnings);
  if (raw1208) {
    lengthWarning(TableTag.Columns, raw1208, COLUMN_ENTRY_LENGTH, 0, warnings);
    for (let at = 0; at + COLUMN_ENTRY_LENGTH <= raw1208.length; at += COLUMN_ENTRY_LENGTH) {
      allColumns.push({
        index: allColumns.length,
        left: f64At(raw1208, at),
        right: f64At(raw1208, at + 8),
        justification: raw1208[at + 16]!,
        raw17: raw1208[at + 17]!,
        raw: raw1208.subarray(at, at + COLUMN_ENTRY_LENGTH),
      });
    }
  }

  const allRows: TableRowBand[] = [];
  const raw1214 = singleRaw(chart, TableTag.Rows, warnings);
  if (raw1214) {
    lengthWarning(TableTag.Rows, raw1214, ROW_ENTRY_LENGTH, 0, warnings);
    for (let at = 0; at + ROW_ENTRY_LENGTH <= raw1214.length; at += ROW_ENTRY_LENGTH) {
      allRows.push({ index: allRows.length, top: f64At(raw1214, at), bottom: f64At(raw1214, at + 8) });
    }
  }

  let colorRanges: TableColorRanges | null = null;
  const raw1212 = singleRaw(chart, TableTag.ColorRanges, warnings);
  if (raw1212) {
    if (raw1212.length < RANGES_HEAD) warnings.push(`table colour ranges (1212) too short; kept raw`);
    else {
      lengthWarning(TableTag.ColorRanges, raw1212, RANGE_ENTRY_LENGTH, RANGES_HEAD, warnings);
      const ranges: TableColorRange[] = [];
      for (let at = RANGES_HEAD; at + RANGE_ENTRY_LENGTH <= raw1212.length; at += RANGE_ENTRY_LENGTH) {
        ranges.push({
          index: ranges.length,
          low: f64At(raw1212, at + 23),
          high: f64At(raw1212, at + 31),
          colorRole: raw1212[at + 39]!,
          raw: raw1212.subarray(at, at + RANGE_ENTRY_LENGTH),
        });
      }
      colorRanges = { enabled: raw1212[0] === 1, head: raw1212.subarray(0, RANGES_HEAD), ranges };
    }
  }

  return {
    kind: "table",
    cells,
    grid,
    rowCount,
    columnCount,
    columns: allColumns.filter((c) => c.left !== null && c.right !== null),
    allColumns,
    rowBands: allRows.filter((r) => r.top !== null && r.bottom !== null),
    colorRanges,
    raw1206: singleRaw(chart, TableTag.Options1206, warnings),
    raw1210: singleRaw(chart, TableTag.Options1210, warnings),
    otherRecords: otherRecords(chart, new Set(Object.values(TableTag))),
  };
}
