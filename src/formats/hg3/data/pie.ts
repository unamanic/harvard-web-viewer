/**
 * Pie chart data (type 0x15, SPEC §5.4, task 11a): records 1304 to 1316 and
 * the pie titles in text slot 5.
 *
 * Byte layouts follow SPEC §5.4, confirmed by the Harvard Graphics 3.05 test
 * pairs in samples/option-tests/pie (one setting changed from PBASE.CH3 per
 * file; the file that shows each field is named in its comment). Yes/No bytes
 * are 1 = Yes, 2 = No; other values read as "not set" (null) and fall back to
 * the default. Strings are NUL-terminated; bytes after the NUL can hold
 * leftovers of older text (PPCTT, PVTRAIL) and are ignored. [C]
 *
 * Also from the 10 sample pie charts (GALD211-291, PIETUT):
 * - Every drawn arc's sweep equals value / pie total × 360° (all 76 arcs,
 *   matched by colour). [C]
 * - Slot 5 pie titles carry the pie number in the COLUMN, not the row as
 *   SPEC §5.4 says: GALD291 has "r0 c0" and "r0 c1" for its two pies. [I]
 */
import type { Chart } from "../chart";
import { decodeHg3Text } from "../charset";
import type { LeafRecord } from "../container";
import { type TextLine, TextSlot } from "../text";
import { type RawRecord, checkLength, f32At, f64At, otherRecords, paddedAt, recordsOf, singleRaw, u16At } from "./common";

export const PieTag = {
  /** Pie style (Options > Style). */
  Style: 1304,
  /** Legend options (Options > Legend). */
  Legend: 1306,
  StyleTable: 1308,
  /** Pie options (Options > Pie options), one per pie. */
  PieOptions: 1310,
  /** Slice percent options, one per pie. */
  Percents: 1312,
  /** Slice value options, one per pie. */
  Values: 1314,
  Slice: 1316,
} as const;

/** SPEC §5.4: up to 6 pies. */
export const MAX_PIES = 6;
export const SLICE_RECORD_LENGTH = 32;
/** Bytes before the label in 1316. */
const SLICE_LABEL_OFFSET = 9;
const SLICE_LABEL_LENGTH = 23;
export const STYLE_LENGTH = 7;
export const LEGEND_LENGTH = 6;
export const PIE_OPTIONS_LENGTH = 18;
export const PERCENTS_LENGTH = 31;
export const VALUES_LENGTH = 43;
/** Leading / trailing text fields of 1312 and 1314. */
const AFFIX_LENGTH = 13;

/** Yes/No bytes (SPEC §5.4). */
export const YES = 1;
export const NO = 2;

/** 1316 byte 2 values: cut out (PCUT2) [C]. */
export const SliceExplode = { Exploded: 1, Normal: 2 } as const;

/** 1304 byte 4: slice fill style (PFILLP, PFILLB) [C]. */
export const PieFill = { Color: 1, Pattern: 2, Both: 3 } as const;

/** 1310 byte 2: show as (PCOLUMN) [C]. */
export const PieShowAs = { Pie: 1, Column: 2 } as const;

/** 1310 byte 4: slice pointer (PPTRN, PPTRL; 3 by menu order) [C]. */
export const SlicePointer = { None: 1, Short: 2, Medium: 3, Long: 4 } as const;

/** 1312 byte 2 / 1314 byte 2: where percents / values go (PVALADJ, PVALIN, PPCTPI; 1312's 2 by analogy) [C]. */
export const LabelPlace = { Below: 1, Adjacent: 2, Inside: 3 } as const;

export interface PieSlice {
  /** File offset of the 1316 record. */
  offset: number;
  pie: number;
  slice: number;
  /** Byte 2: 1 cut out, 2 normal. */
  explodeCode: number;
  /** Byte 2 = 1: the slice is cut out (PCUT2) [C]. */
  exploded: boolean;
  /** Byte 3: colour role (21 = Series1, …). */
  colorRole: number;
  /** Byte 4: pattern number (the Pattern column, 0 to 11 by default) [C]. */
  pattern: number;
  /** f32 at 5. */
  value: number;
  /** Padded string[23] at 9, HG3 character set. */
  label: string;
  /** value / pie total (0 when the total is not positive). */
  fraction: number;
  raw: Uint8Array;
}

/** Record 1304: pie style, one per chart [C, SPEC §5.4]. */
export interface PieStyleOptions {
  /** Byte 0: Share Pie 1 labels (PSHARE); default No. */
  sharePie1Labels: boolean;
  /** Byte 1: 3D effect (P3DSE2); default No. */
  threeD: boolean;
  /** Byte 2: Link pies 1 and 2 (PLINK); default No. */
  linkPies: boolean;
  /** Byte 3: Proportional pies (PPROP); default No. */
  proportional: boolean;
  /** Byte 4: PieFill (1 Color, 2 Pattern, 3 Both). */
  fill: number;
  /** Byte 5: slice outline colour role (default 32 = Outlines; POUTL). */
  outlineRole: number;
  /** Byte 6: link line colour role (default 18 = Lines; PLINKC). */
  linkLineRole: number;
  raw: Uint8Array;
}

/** Record 1306: legend options, one per chart (SPEC §5.4). */
export interface PieLegendOptions {
  /** Byte 0: show legend (PLEG); default No [C]. */
  show: boolean;
  /** Byte 1: 1 Inside, 2 Outside (default) [I for pies]. */
  placement: number;
  /** Byte 2: one of 12 places clockwise; 5 right middle (default), 6 right bottom, 7 bottom right, 8 bottom middle [C for 5 to 8]. */
  location: number;
  /** Byte 3: frame style, 2 = Plain (default) [I]. */
  frameStyle: number;
  /** Byte 4: frame outline colour role, default 14 = Frame [I]. */
  frameOutlineRole: number;
  /** Byte 5: frame fill colour role, default 20 = Legend [I]. */
  frameFillRole: number;
  raw: Uint8Array;
}

/** Record 1310 (one per pie): pie options [C, SPEC §5.4]. */
export interface PieOptions {
  offset: number;
  pie: number;
  /** Byte 1: show pie (PNOPIE). */
  show: boolean;
  /** Byte 2: PieShowAs (1 Pie, 2 Column; PCOLUMN). */
  showAs: number;
  /** Byte 3: sort slices, largest first (PUNSSRT). */
  sort: boolean;
  /** Byte 4: SlicePointer (PPTRN, PPTRL). */
  pointer: number;
  /** f32 at 5: 3D slice depth (default 30; PDEPTH6). */
  depth: number;
  /** f32 at 9: starting angle in degrees (default 0; PANG45). */
  startAngle: number;
  /** f32 at 13: pie size in percent of area (default 100; PSIZE50). */
  size: number;
  /** Byte 17: show slice labels (default Yes; PNOLAB). */
  showLabels: boolean;
  raw: Uint8Array;
}

/** Record 1312 (one per pie): slice percents [C, SPEC §5.4]. */
export interface PiePercentOptions {
  pie: number;
  /** Byte 1: show percents (default No; PPCT). */
  show: boolean;
  /** Byte 2: LabelPlace (PPCTPI; Adjacent by analogy with 1314). */
  place: number;
  /** u16 at 3: decimal places (default 0; PPCTD1). */
  decimals: number;
  /** string[13] at 5 (PPCTL). */
  leading: string;
  /** string[13] at 18 (PPCTT). */
  trailing: string;
  raw: Uint8Array;
}

/** Record 1314 (one per pie): slice values [C, SPEC §5.4]. */
export interface PieValueOptions {
  pie: number;
  /** Byte 1: show values (default Yes; PVALNO). */
  show: boolean;
  /** Byte 2: LabelPlace (PVALADJ, PVALIN). */
  place: number;
  /** Byte 3: currency (default No; PVCURR). */
  currency: boolean;
  /** f32 at 4: decimal places; null when blank (NaN), which means automatic (PVDEC2). */
  decimals: number | null;
  /** Byte 8: thousands separator (default No; PVTHOU). */
  thousands: boolean;
  /** f64 at 9: scale factor, values are divided by it (default 1; PVSCALE). Null when not set. */
  scale: number | null;
  /** string[13] at 17 (PVLEAD). */
  leading: string;
  /** string[13] at 30 (PVTRAIL). */
  trailing: string;
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
  /** 1310 for this pie. */
  options: PieOptions | null;
  /** 1312 for this pie. */
  percents: PiePercentOptions | null;
  /** 1314 for this pie. */
  values: PieValueOptions | null;
  /** 1312 for this pie, raw. */
  raw1312: Uint8Array | null;
  /** 1314 for this pie, raw. */
  raw1314: Uint8Array | null;
}

export interface PieData {
  kind: "pie";
  /** Pies that have at least one slice or a title, by pie number. */
  pies: Pie[];
  /** Record 1304, decoded; null without it. */
  style: PieStyleOptions | null;
  /** Record 1306, decoded; null without it. */
  legend: PieLegendOptions | null;
  /** Record 1304, raw (7 bytes). */
  raw1304: Uint8Array | null;
  /** 1304 byte 1: 3-D pies; null without 1304. */
  threeD: boolean | null;
  /** 1304 byte 3: proportional pie sizes; null without 1304. */
  proportional: boolean | null;
  /** Record 1306, raw. */
  raw1306: Uint8Array | null;
  /** Data records of other tags. */
  otherRecords: RawRecord[];
}

const KNOWN: ReadonlySet<number> = new Set(Object.values(PieTag));

/** A Yes/No byte: 1 → true, 2 → false, anything else (or missing) → `fallback`. */
export function yesNo(d: Uint8Array, i: number, fallback: boolean): boolean {
  const v = d[i];
  return v === YES ? true : v === NO ? false : fallback;
}

/** Byte `i`, or `fallback` when missing or 0. */
function byteOr(d: Uint8Array, i: number, fallback: number): number {
  const v = d[i];
  return v === undefined || v === 0 ? fallback : v;
}

/** f32 at `i`; `fallback` when the record is too short or the value is NaN or infinite (blank). */
function f32Or(d: Uint8Array, i: number, fallback: number): number {
  if (d.length < i + 4) return fallback;
  const v = f32At(d, i);
  return Number.isFinite(v) ? v : fallback;
}

/** NUL-terminated string in the `n` bytes at `offset`, HG3 character set; bytes after the NUL are ignored, spaces kept. */
export function fieldString(d: Uint8Array, offset: number, n: number): string {
  if (offset >= d.length) return "";
  const raw = d.subarray(offset, Math.min(d.length, offset + n));
  const nul = raw.indexOf(0);
  return decodeHg3Text(nul < 0 ? raw : raw.subarray(0, nul));
}

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
    pattern: d[4]!,
    value: f32At(d, 5),
    label: paddedAt(d, SLICE_LABEL_OFFSET, labelLength),
    fraction: 0,
    raw: d,
  };
}

export function readStyle(d: Uint8Array): PieStyleOptions {
  return {
    sharePie1Labels: yesNo(d, 0, false),
    threeD: yesNo(d, 1, false),
    linkPies: yesNo(d, 2, false),
    proportional: yesNo(d, 3, false),
    fill: byteOr(d, 4, PieFill.Color),
    outlineRole: byteOr(d, 5, 32),
    linkLineRole: byteOr(d, 6, 18),
    raw: d,
  };
}

export function readLegend(d: Uint8Array): PieLegendOptions {
  return {
    show: yesNo(d, 0, false),
    placement: byteOr(d, 1, 2),
    location: byteOr(d, 2, 5),
    frameStyle: byteOr(d, 3, 2),
    frameOutlineRole: byteOr(d, 4, 14),
    frameFillRole: byteOr(d, 5, 20),
    raw: d,
  };
}

function readPieOptions(rec: LeafRecord, warnings: string[]): PieOptions | null {
  if (!checkLength(rec, PIE_OPTIONS_LENGTH, 1, "pie options", warnings)) return null;
  const d = rec.data;
  return {
    offset: rec.offset,
    pie: d[0]!,
    show: yesNo(d, 1, true),
    showAs: byteOr(d, 2, PieShowAs.Pie),
    sort: yesNo(d, 3, false),
    pointer: byteOr(d, 4, SlicePointer.Short),
    depth: f32Or(d, 5, 30),
    startAngle: f32Or(d, 9, 0),
    size: f32Or(d, 13, 100),
    showLabels: yesNo(d, 17, true),
    raw: d,
  };
}

export function readPercents(d: Uint8Array): PiePercentOptions {
  return {
    pie: d[0] ?? 0,
    show: yesNo(d, 1, false),
    place: byteOr(d, 2, LabelPlace.Below),
    decimals: d.length >= 5 ? u16At(d, 3) : 0,
    leading: fieldString(d, 5, AFFIX_LENGTH),
    trailing: fieldString(d, 18, AFFIX_LENGTH),
    raw: d,
  };
}

export function readValues(d: Uint8Array): PieValueOptions {
  const dec = d.length >= 8 ? f32At(d, 4) : Number.NaN;
  const scale = d.length >= 17 ? f64At(d, 9) : null;
  return {
    pie: d[0] ?? 0,
    show: yesNo(d, 1, true),
    place: byteOr(d, 2, LabelPlace.Below),
    currency: yesNo(d, 3, false),
    decimals: Number.isFinite(dec) ? dec : null,
    thousands: yesNo(d, 8, false),
    scale: scale !== null && Number.isFinite(scale) ? scale : null,
    leading: fieldString(d, 17, AFFIX_LENGTH),
    trailing: fieldString(d, 30, AFFIX_LENGTH),
    raw: d,
  };
}

/** Per-pie records keyed by their first byte (the pie number). */
function byPie(recs: LeafRecord[], tag: number, length: number, warnings: string[]): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const r of recs) {
    if (r.data.length < 1) {
      warnings.push(`record ${tag} at offset ${r.offset} is empty; skipped`);
      continue;
    }
    if (r.data.length !== length) warnings.push(`record ${tag} at offset ${r.offset} has ${r.data.length} bytes, expected ${length}`);
    const pie = r.data[0]!;
    if (out.has(pie)) warnings.push(`record ${tag} for pie ${pie} repeated; using the first`);
    else out.set(pie, r.data);
  }
  return out;
}

function checkedSingle(chart: Chart, tag: number, length: number, warnings: string[]): Uint8Array | null {
  const d = singleRaw(chart, tag, warnings);
  if (d && d.length !== length) warnings.push(`record ${tag} has ${d.length} bytes, expected ${length}`);
  return d;
}

export function parsePieData(chart: Chart, warnings: string[]): PieData {
  const raw1304 = checkedSingle(chart, PieTag.Style, STYLE_LENGTH, warnings);
  const raw1306 = checkedSingle(chart, PieTag.Legend, LEGEND_LENGTH, warnings);

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
  const r1312 = byPie(recordsOf(chart, PieTag.Percents), PieTag.Percents, PERCENTS_LENGTH, warnings);
  const r1314 = byPie(recordsOf(chart, PieTag.Values), PieTag.Values, VALUES_LENGTH, warnings);

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
      const p = r1312.get(index) ?? null;
      const v = r1314.get(index) ?? null;
      return {
        index,
        title: titles.get(index) ?? null,
        slices: own,
        total,
        options: options.get(index) ?? null,
        percents: p ? readPercents(p) : null,
        values: v ? readValues(v) : null,
        raw1312: p,
        raw1314: v,
      };
    });

  const style = raw1304 ? readStyle(raw1304) : null;
  return {
    kind: "pie",
    pies,
    style,
    legend: raw1306 ? readLegend(raw1306) : null,
    raw1304,
    threeD: style ? style.threeD : null,
    proportional: style ? style.proportional : null,
    raw1306,
    otherRecords: otherRecords(chart, KNOWN),
  };
}
