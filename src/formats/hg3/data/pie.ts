/**
 * Pie chart data (type 0x15, SPEC §5.4, task 11a): records 1304 to 1316 and
 * the pie titles in text slot 5.
 *
 * Findings from the 10 sample pie charts, checked against the drawn copy in
 * each object layer (0x1031 arcs):
 * - 1316 is one slice: u8 pie, u8 slice, u8 explode code, u8 colour role,
 *   u8 [?] (equal to the slice number in every sample), f32 value at 5,
 *   padded string[23] label at 9. Every drawn arc's sweep equals
 *   value / pie total × 360° (all 76 arcs, matched by colour). [C for the layout]
 * - 1316 byte 2 is 1 for an exploded slice and 2 otherwise: the drawn arc of
 *   every slice with 1 (4 samples) is moved out from the pie centre. [I]
 * - Slot 5 pie titles carry the pie number in the COLUMN, not the row as
 *   SPEC §5.4 says: GALD291 has "r0 c0" and "r0 c1" for its two pies. [I]
 * - 1310 (one per pie, always 6) byte 2 is 2 for the second pie of GALD231
 *   and GALD261, drawn as a stacked column; 1 elsewhere. [I] It also holds
 *   f32 30.0 at 5 and f32 100.0 at 13 in every sample [?].
 * - 1304 byte 1 is 1 in the four 3-D pie samples (drawn with 0x1040 bands)
 *   and 2 in the six flat ones [I]; byte 3 is 1 only in GALD291, whose pies
 *   are drawn with radii proportional to √total ("proportional pies") [I].
 * - 1312 and 1314 differ only in apparently uninitialised bytes; kept raw.
 */
import type { Chart } from "../chart";
import type { LeafRecord } from "../container";
import { type TextLine, TextSlot } from "../text";
import { type RawRecord, checkLength, f32At, otherRecords, paddedAt, recordsOf, singleRaw } from "./common";

export const PieTag = {
  Options: 1304,
  Colors: 1306,
  StyleTable: 1308,
  PieOptions: 1310,
  PieOptions1312: 1312,
  PieOptions1314: 1314,
  Slice: 1316,
} as const;

/** SPEC §5.4: up to 6 pies. */
export const MAX_PIES = 6;
export const SLICE_RECORD_LENGTH = 32;
/** Bytes before the label in 1316. */
const SLICE_LABEL_OFFSET = 9;
const SLICE_LABEL_LENGTH = 23;
export const PIE_OPTIONS_LENGTH = 18;

/** 1316 byte 2 values [I]. */
export const SliceExplode = { Exploded: 1, Normal: 2 } as const;

export interface PieSlice {
  /** File offset of the 1316 record. */
  offset: number;
  pie: number;
  slice: number;
  /** Byte 2: 1 exploded, 2 normal [I]. */
  explodeCode: number;
  exploded: boolean;
  /** Byte 3: colour role (21 = Series1, …). */
  colorRole: number;
  /** Byte 4 [?]: equal to the slice number in every sample. */
  raw4: number;
  /** f32 at 5. */
  value: number;
  /** Padded string[23] at 9, HG3 character set. */
  label: string;
  /** value / pie total (0 when the total is not positive). */
  fraction: number;
  raw: Uint8Array;
}

/** Record 1310 (one per pie). */
export interface PieOptions {
  offset: number;
  pie: number;
  /** Byte 2: 1 pie, 2 column (stacked bar) [I]. */
  styleCode: number;
  /** f32 at 5 (30.0 in every sample) [?]. */
  value5: number;
  /** f32 at 13 (100.0 in every sample; a size percentage?) [?]. */
  value13: number;
  raw: Uint8Array;
}

export interface Pie {
  /** Pie number (0 to 5). */
  index: number;
  /** Slot 5 line for this pie (column = pie number [I]), or null. */
  title: TextLine | null;
  slices: PieSlice[];
  /** Sum of the slice values. */
  total: number;
  /** 1310 for this pie, decoded tentatively. */
  options: PieOptions | null;
  /** 1312 for this pie, raw [?]. */
  raw1312: Uint8Array | null;
  /** 1314 for this pie, raw [?] (holds f64 1.0 at 9). */
  raw1314: Uint8Array | null;
}

export interface PieData {
  kind: "pie";
  /** Pies that have at least one slice or a title, by pie number. */
  pies: Pie[];
  /** Record 1304, raw (7 bytes) [?]. */
  raw1304: Uint8Array | null;
  /** 1304 byte 1 == 1: 3-D pies [I]; null without 1304. */
  threeD: boolean | null;
  /** 1304 byte 3 == 1: proportional pie sizes [I]; null without 1304. */
  proportional: boolean | null;
  /** Record 1306, raw: colour roles for chart parts [?]. */
  raw1306: Uint8Array | null;
  /** Data records of other tags. */
  otherRecords: RawRecord[];
}

const KNOWN: ReadonlySet<number> = new Set(Object.values(PieTag));

function readSlice(rec: LeafRecord, warnings: string[]): PieSlice | null {
  if (!checkLength(rec, SLICE_RECORD_LENGTH, SLICE_LABEL_OFFSET, "pie slice", warnings)) return null;
  const d = rec.data;
  const labelLength = Math.min(SLICE_LABEL_LENGTH, d.length - SLICE_LABEL_OFFSET);
  return {
    offset: rec.offset,
    pie: d[0]!,
    slice: d[1]!,
    explodeCode: d[2]!,
    exploded: d[2] === SliceExplode.Exploded,
    colorRole: d[3]!,
    raw4: d[4]!,
    value: f32At(d, 5),
    label: paddedAt(d, SLICE_LABEL_OFFSET, labelLength),
    fraction: 0,
    raw: d,
  };
}

function readPieOptions(rec: LeafRecord, warnings: string[]): PieOptions | null {
  if (!checkLength(rec, PIE_OPTIONS_LENGTH, 17, "pie options", warnings)) return null;
  const d = rec.data;
  return { offset: rec.offset, pie: d[0]!, styleCode: d[2]!, value5: f32At(d, 5), value13: f32At(d, 13), raw: d };
}

/** Per-pie records keyed by their first byte (the pie number). */
function byPie(recs: LeafRecord[], tag: number, warnings: string[]): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const r of recs) {
    if (r.data.length < 1) {
      warnings.push(`record ${tag} at offset ${r.offset} is empty; skipped`);
      continue;
    }
    const pie = r.data[0]!;
    if (out.has(pie)) warnings.push(`record ${tag} for pie ${pie} repeated; using the first`);
    else out.set(pie, r.data);
  }
  return out;
}

export function parsePieData(chart: Chart, warnings: string[]): PieData {
  const raw1304 = singleRaw(chart, PieTag.Options, warnings);
  const raw1306 = singleRaw(chart, PieTag.Colors, warnings);

  const slices: PieSlice[] = [];
  for (const rec of recordsOf(chart, PieTag.Slice)) {
    const s = readSlice(rec, warnings);
    if (!s) continue;
    if (s.pie >= MAX_PIES) warnings.push(`pie slice at offset ${s.offset} has pie number ${s.pie} (max ${MAX_PIES - 1})`);
    if (!Number.isFinite(s.value)) warnings.push(`pie slice at offset ${s.offset} has a non-finite value`);
    else if (s.value < 0) warnings.push(`pie ${s.pie} slice ${s.slice} has negative value ${s.value} (SPEC §7.1)`);
    slices.push(s);
  }

  const options = new Map<number, PieOptions>();
  for (const rec of recordsOf(chart, PieTag.PieOptions)) {
    const o = readPieOptions(rec, warnings);
    if (!o) continue;
    if (options.has(o.pie)) warnings.push(`pie options (1310) for pie ${o.pie} repeated; using the first`);
    else options.set(o.pie, o);
  }
  const r1312 = byPie(recordsOf(chart, PieTag.PieOptions1312), PieTag.PieOptions1312, warnings);
  const r1314 = byPie(recordsOf(chart, PieTag.PieOptions1314), PieTag.PieOptions1314, warnings);

  // [I] Pie number = column of the slot 5 line (see header comment).
  const titles = new Map<number, TextLine>();
  for (const line of chart.textLines) {
    if (line.slot !== TextSlot.PieTitles) continue;
    if (titles.has(line.column)) warnings.push(`pie title for pie ${line.column} repeated; using the first`);
    else titles.set(line.column, line);
  }

  const numbers = new Set<number>([...slices.map((s) => s.pie), ...titles.keys()]);
  const pies: Pie[] = [...numbers]
    .sort((a, b) => a - b)
    .map((index) => {
      const own = slices.filter((s) => s.pie === index).sort((a, b) => a.slice - b.slice);
      const total = own.reduce((sum, s) => sum + (Number.isFinite(s.value) ? s.value : 0), 0);
      for (const s of own) s.fraction = total > 0 && Number.isFinite(s.value) ? s.value / total : 0;
      return {
        index,
        title: titles.get(index) ?? null,
        slices: own,
        total,
        options: options.get(index) ?? null,
        raw1312: r1312.get(index) ?? null,
        raw1314: r1314.get(index) ?? null,
      };
    });

  const flag = (i: number): boolean | null => (raw1304 && raw1304.length > i ? raw1304[i] === 1 : null);
  return {
    kind: "pie",
    pies,
    raw1304,
    threeD: flag(1),
    proportional: flag(3),
    raw1306,
    otherRecords: otherRecords(chart, KNOWN),
  };
}
