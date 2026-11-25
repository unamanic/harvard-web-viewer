/**
 * Title chart (type 0x1F) and bullet chart (type 0x20) data (SPEC §5.4,
 * task 11d).
 *
 * Title charts: slot 7 lines in three sections starting at rows 0, 4 and 12
 * (TITLE_CHART_SECTION_ROWS in chart.ts) [I].
 *
 * Bullet charts: slot 8 lines; 1108 and 1106. Findings from the 8 sample
 * bullet charts (corrects SPEC §5.4, which reads 1108 as 8 bytes per line):
 * - 1108 is one 192-byte record: 48 entries of 4 bytes, one per ROW (entry
 *   n belongs to row n, whether or not the row has text): u8 bullet shape,
 *   u8 [?] (2 on text rows, 0 on some empty rows), u8 colour role (16 =
 *   Bullet), u8 paragraph number (counts from 1; continuation rows repeat
 *   it). Entries past the last row have shape 100. [I]
 * - Shapes, from the drawn markers (one-character text blocks): 1 = "•"
 *   (GALD111), 4 = "►" (GALD131), 7 = arabic numbers "1." (GALD121),
 *   8 = roman numbers "I." (GALD161), 9 = no marker (GALD141, HELP1/2). [I]
 *   Continuation rows have shape 0 (no marker).
 * - 1106 (22 bytes): bytes 0..3 are a default entry in the 1108 layout
 *   (byte 0 = the chart's bullet shape), f64 at 5 is "not set" in every
 *   sample, f64 at 13 is 0, 1 or 3 [?], byte 21 is 1 [?].
 */
import { type Chart, TITLE_CHART_SECTION_ROWS } from "../chart";
import { type TextLine, TextSlot } from "../text";
import { type RawRecord, f64At, otherRecords, recordsOf, singleRaw } from "./common";

export const BulletTag = { StyleTable: 1102, Options: 1106, Entries: 1108 } as const;
export const TitleTag = { StyleTable: 1002 } as const;

export const BULLET_ENTRY_LENGTH = 4;
export const BULLET_OPTIONS_LENGTH = 22;

/** 1108 shape byte → marker kind [I]. */
export const BULLET_SHAPES: ReadonlyMap<number, BulletShapeName> = new Map([
  [0, "continuation"],
  [1, "bullet"],
  [4, "triangle"],
  [7, "number"],
  [8, "roman"],
  [9, "none"],
  [100, "unused"],
]);

export type BulletShapeName = "continuation" | "bullet" | "triangle" | "number" | "roman" | "none" | "unused" | "unknown";

export interface BulletEntry {
  /** Row this entry belongs to (its position in 1108). */
  row: number;
  shape: number;
  shapeName: BulletShapeName;
  /** Byte 1 [?]: 2 on text rows. */
  raw1: number;
  colorRole: number;
  /** Paragraph number, from 1 [I]. */
  paragraph: number;
}

export interface BulletLine {
  line: TextLine;
  /** The 1108 entry for the line's row, or null when there is none. */
  entry: BulletEntry | null;
}

export interface BulletOptions {
  /** Bytes 0..3 in the 1108 entry layout (row = -1). */
  defaults: BulletEntry;
  /** f64 at 5 [?] (not set in samples). */
  value5: number | null;
  /** f64 at 13 [?]. */
  value13: number | null;
  raw: Uint8Array;
}

export interface BulletData {
  kind: "bullet";
  /** Slot 8 lines sorted by row, each with its 1108 entry. */
  lines: BulletLine[];
  /** Every 1108 entry, by row (including unused ones). */
  entries: BulletEntry[];
  options: BulletOptions | null;
  otherRecords: RawRecord[];
}

export interface TitleSection {
  /** 0 top, 1 middle, 2 bottom; also the 1002 style entry index. */
  index: number;
  startRow: number;
  lines: TextLine[];
}

export interface TitleData {
  kind: "title";
  /** The three sections, always present (possibly empty). */
  sections: TitleSection[];
  /** Every slot 7 line sorted by row. */
  lines: TextLine[];
  otherRecords: RawRecord[];
}

function entryAt(data: Uint8Array, at: number, row: number): BulletEntry {
  const shape = data[at]!;
  return {
    row,
    shape,
    shapeName: BULLET_SHAPES.get(shape) ?? "unknown",
    raw1: data[at + 1]!,
    colorRole: data[at + 2]!,
    paragraph: data[at + 3]!,
  };
}

export function parseBulletData(chart: Chart, warnings: string[]): BulletData {
  const entries: BulletEntry[] = [];
  for (const rec of recordsOf(chart, BulletTag.Entries)) {
    if (rec.data.length % BULLET_ENTRY_LENGTH !== 0) {
      warnings.push(`bullet entries (1108) at offset ${rec.offset} length ${rec.data.length} is not a multiple of 4; partial entry ignored`);
    }
    for (let at = 0; at + BULLET_ENTRY_LENGTH <= rec.data.length; at += BULLET_ENTRY_LENGTH) {
      entries.push(entryAt(rec.data, at, entries.length));
    }
  }

  const raw1106 = singleRaw(chart, BulletTag.Options, warnings);
  let options: BulletOptions | null = null;
  if (raw1106) {
    if (raw1106.length < 21) warnings.push(`bullet options (1106) too short (${raw1106.length} bytes); kept raw`);
    else {
      if (raw1106.length !== BULLET_OPTIONS_LENGTH) warnings.push(`bullet options (1106) has ${raw1106.length} bytes, expected 22`);
      options = { defaults: entryAt(raw1106, 0, -1), value5: f64At(raw1106, 5), value13: f64At(raw1106, 13), raw: raw1106 };
    }
  }

  const lines = chart.textLines
    .filter((l) => l.slot === TextSlot.BulletList)
    .sort((a, b) => a.row - b.row)
    .map((line) => {
      const entry = entries[line.row] ?? null;
      if (entries.length && !entry) warnings.push(`bullet line at row ${line.row} has no 1108 entry`);
      return { line, entry };
    });

  return { kind: "bullet", lines, entries, options, otherRecords: otherRecords(chart, new Set(Object.values(BulletTag))) };
}

export function parseTitleData(chart: Chart, _warnings: string[]): TitleData {
  const lines = chart.textLines.filter((l) => l.slot === TextSlot.TitleChart).sort((a, b) => a.row - b.row);
  const sections: TitleSection[] = TITLE_CHART_SECTION_ROWS.map((startRow, index) => {
    const end = TITLE_CHART_SECTION_ROWS[index + 1] ?? Infinity;
    return { index, startRow, lines: lines.filter((l) => l.row >= startRow && l.row < end) };
  });
  return { kind: "title", sections, lines, otherRecords: otherRecords(chart, new Set(Object.values(TitleTag))) };
}
