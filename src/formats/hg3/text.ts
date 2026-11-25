/**
 * Chart text (SPEC §5.3): the 22-byte text tail shared by text lines (800),
 * organization boxes (914) and text objects (0x10B0), the text line record
 * 800, and the 16-byte-entry text style tables (906, 1002, 1102, 1202, 1308,
 * 1412).
 */
import { ByteReader, TruncatedError } from "./ByteReader";
import type { LeafRecord } from "./container";
import { type FontKey, readFontKey } from "./fontKey";

/** Text slots: which part of a chart a text line belongs to (SPEC §5.3). */
export const TextSlot = {
  /** Title (row 0) and subtitles (rows 1, 2); all data charts. */
  Title: 1,
  /** Footnote; pie and organization charts. */
  Footnote: 2,
  /** XY axis titles (row 0 X, 1 Y1, 2 Y2 [I: from colour roles in samples]). */
  AxisTitles: 3,
  /** XY series names, row = series number; used in the legend. */
  SeriesNames: 4,
  /** Pie titles, row = pie number. */
  PieTitles: 5,
  /** Table cell text (row, column). */
  TableCells: 6,
  /** Title chart lines, top to bottom. */
  TitleChart: 7,
  /** Bullet chart lines, in order. */
  BulletList: 8,
} as const;

export type TextSlotName = keyof typeof TextSlot;

/** Justification values in the low bits of the justification word (SPEC §5.3). */
export const Justification = {
  /** Not stored: take it from the style table. */
  None: 0,
  Left: 1,
  Centre: 2,
  /** [I] */
  Right: 3,
} as const;

/** Mask for the justification value; the rest of the word is flag bits. */
export const JUSTIFICATION_VALUE_MASK = 0x00ff;
/** Flag bit seen in the justification word (table cells in samples) [?]. */
export const JUSTIFICATION_FLAG_2000 = 0x2000;

/** Bytes in a text tail (SPEC §5.3). */
export const TEXT_TAIL_LENGTH = 22;

/** The 22 bytes that follow a text string's NUL (SPEC §5.3). */
export interface TextTail {
  /** Length of the text as stored, not counting the NUL. */
  declaredLength: number;
  /** Text colour role (SPEC §6.2). */
  color: number;
  /** Tail offset +4, u16, 0 in samples [?]. */
  raw4: number;
  /** Second colour role, usually equal to `color` [?]. */
  color2: number;
  /** Tail offset +8, u16, 0 in samples [?]. */
  raw8: number;
  /** Text size, f32 (unit: SPEC §6.4). */
  size: number;
  /** Justification value (low byte of the word): see `Justification`. */
  justification: number;
  /** The remaining bits of the justification word (e.g. 0x2000). */
  justificationFlags: number;
  fontKey: FontKey;
}

/**
 * Read the 22-byte text tail: u16 length, u16 colour, u16, u16 colour 2, u16,
 * f32 size, u16 justification, 6-byte font key. Throws TruncatedError if
 * fewer than 22 bytes remain.
 */
export function readTextTail(reader: ByteReader): TextTail {
  if (reader.remaining < TEXT_TAIL_LENGTH) {
    throw new TruncatedError(reader.pos, TEXT_TAIL_LENGTH, reader.remaining);
  }
  const declaredLength = reader.u16();
  const color = reader.u16();
  const raw4 = reader.u16();
  const color2 = reader.u16();
  const raw8 = reader.u16();
  const size = reader.f32();
  const word = reader.u16();
  const fontKey = readFontKey(reader);
  return {
    declaredLength,
    color,
    raw4,
    color2,
    raw8,
    size,
    justification: word & JUSTIFICATION_VALUE_MASK,
    justificationFlags: word & ~JUSTIFICATION_VALUE_MASK & 0xffff,
    fontKey,
  };
}

/** Text line, tag 800 (SPEC §5.3). */
export interface TextLine extends TextTail {
  /** File offset of the record header. */
  offset: number;
  slot: number;
  /** Line or row number within the slot, from 0. */
  row: number;
  /** Column (tables), else 0. */
  column: number;
  /**
   * Offset 6, u8 [?]. Not 0 to 7 as SPEC §5.3 says: values up to 33 in
   * samples. Looks like a row count: slot 1 row 0 is always 3, the first
   * bullet line holds the bullet chart's total rows, title chart section
   * starts hold their section's rows (4, 8, 4), table cells hold the rows
   * until the next stored row; XY series names are always 1.
   */
  raw6: number;
  /** Offset 7, u8 [?]: 0x10 in samples, except 0x11 for table cells and 0x12 for XY series names. */
  raw7: number;
  /** The text, decoded from CP437. */
  text: string;
  /** Bytes after the tail, if any (none in samples). */
  extra: Uint8Array;
}

export const TAG_TEXT_LINE = 800;

/** Fixed bytes before the string. */
const TEXT_LINE_HEAD = 8;

/**
 * Read one 800 record. Returns null (with a warning) when the record is too
 * short or the string has no NUL; never throws.
 */
export function readTextLine(record: LeafRecord, warnings: string[]): TextLine | null {
  const at = `text line (800) at offset ${record.offset}`;
  const data = record.data;
  if (data.length < TEXT_LINE_HEAD + 1 + TEXT_TAIL_LENGTH) {
    warnings.push(`${at} too short (${data.length} bytes); skipped`);
    return null;
  }
  const r = new ByteReader(data);
  const slot = r.u16();
  const row = r.u16();
  const column = r.u16();
  const raw6 = r.u8();
  const raw7 = r.u8();
  const nul = data.indexOf(0, TEXT_LINE_HEAD);
  if (nul < 0) {
    warnings.push(`${at} has no string terminator; skipped`);
    return null;
  }
  const textBytes = nul - TEXT_LINE_HEAD;
  const text = r.cstring();
  if (r.remaining < TEXT_TAIL_LENGTH) {
    warnings.push(`${at} text tail truncated (${r.remaining} of ${TEXT_TAIL_LENGTH} bytes); skipped`);
    return null;
  }
  const tail = readTextTail(r);
  const extra = r.bytes(r.remaining);
  if (extra.length) warnings.push(`${at} has ${extra.length} byte(s) after the text tail`);
  if (tail.declaredLength !== textBytes) {
    warnings.push(`${at} declares text length ${tail.declaredLength} but the text has ${textBytes}`);
  }
  return { offset: record.offset, slot, row, column, raw6, raw7, text, ...tail, extra };
}

/** One entry of a text style table (SPEC §5.3). */
export interface StyleEntry {
  /** Text size, f64; 0 means the entry is not used. */
  size: number;
  colorRole: number;
  /** Justification byte (see `Justification`). */
  justification: number;
  fontKey: FontKey;
}

/** Bytes per style table entry. */
export const STYLE_ENTRY_LENGTH = 16;

/** Style table tags and the chart they belong to (SPEC §5.3, §5.4). 712 (show) is not a chart record. */
export const STYLE_TABLE_TAGS = [906, 1002, 1102, 1202, 1308, 1412] as const;

/**
 * Read a style table record: whole 16-byte entries (f64 size, u8 colour
 * role, u8 justification, font key). A trailing partial entry is ignored
 * with a warning.
 */
export function readStyleTable(record: LeafRecord, warnings: string[]): StyleEntry[] {
  const data = record.data;
  const count = Math.floor(data.length / STYLE_ENTRY_LENGTH);
  if (data.length % STYLE_ENTRY_LENGTH !== 0) {
    warnings.push(
      `style table (${record.tag}) at offset ${record.offset} length ${data.length} is not a multiple of ${STYLE_ENTRY_LENGTH}; partial entry ignored`,
    );
  }
  const r = new ByteReader(data);
  const out: StyleEntry[] = [];
  for (let i = 0; i < count; i++) {
    const size = r.f64();
    const colorRole = r.u8();
    const justification = r.u8();
    const fontKey = readFontKey(r);
    out.push({ size, colorRole, justification, fontKey });
  }
  return out;
}
