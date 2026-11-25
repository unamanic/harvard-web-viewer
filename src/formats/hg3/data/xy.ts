/**
 * XY chart data (type 0x01, SPEC §5.4, task 11b): series (1406), X labels
 * (1422), values (1424), axis settings (1402), axis titles (slot 3) and
 * series names (slot 4). Other option records are kept raw.
 *
 * Findings from the 141 sample XY charts, checked against the drawn copy:
 * - 1406 byte 2 is the series type: drawn as boxes/3-D polygons for 1 (bar),
 *   polylines for 2 (line), filled polygons for 3 (area); 4, 5, 6 appear on
 *   the High, Low, Close series of the high/low charts (GALD6xx). [I]
 * - 1406 byte 3 is the Y axis: 2 on the "Volume" series of GALD611/621,
 *   which is scaled to the right-hand (Y2) axis; 1 elsewhere. [I]
 * - 1406 bytes 9 and 13 are colour roles; they differ on high/low series
 *   (byte 9 is the drawn colour there). Byte 8 counts 0..11 repeating
 *   (pattern number?) [?]; byte 14 counts 1..12 (marker [I]).
 * - 1402 has three records: 0 = X axis, 1 = Y1, 2 = Y2 [I]. f64 fields at
 *   2, 10, 18, 29, 37, 45, 53 and 66; all "not set" except: offset 10 on Y1
 *   = 6 in five high/low charts whose drawn Y1 axis starts at 6 (data
 *   minimum 6.6) → axis minimum [I]; offset 29 on X = 7 and 4 where the
 *   drawn X labels are every 7th / 4th row → label/tick increment [I].
 *   Offset 18 is guessed to be the maximum [?].
 * - Bar heights in the drawn copy are proportional to the 1424 values (122
 *   bar series with one factor per chart; 94 with one factor per row, i.e.
 *   100 % stacked bars).
 * - 1420 (2 files): u8 5, then the NUL-terminated string "@n(#3,5,5)", a
 *   calculation for a series [I].
 */
import type { Chart } from "../chart";
import type { LeafRecord } from "../container";
import { type TextLine, TextSlot } from "../text";
import { type RawRecord, checkLength, f64At, otherRecords, paddedAt, readerAt, recordsOf, singleRaw, u16At } from "./common";

export const XyTag = {
  Axis: 1402,
  Options1404: 1404,
  Series: 1406,
  Frame1408: 1408,
  Options1410: 1410,
  StyleTable: 1412,
  Options1414: 1414,
  Options1418: 1418,
  Calculation: 1420,
  XLabel: 1422,
  Value: 1424,
} as const;

/** SPEC §5.4: up to 16 series. */
export const MAX_SERIES = 16;
export const SERIES_RECORD_LENGTH = 15;
export const AXIS_RECORD_LENGTH = 102;
export const XLABEL_RECORD_LENGTH = 25;
export const VALUE_RECORD_LENGTH = 11;

/** Offsets of the f64 fields in 1402 (all others are bytes). */
export const AXIS_F64_OFFSETS = [2, 10, 18, 29, 37, 45, 53, 66] as const;

/** 1406 byte 2 [I]. */
export const SERIES_TYPES: ReadonlyMap<number, XySeriesType> = new Map([
  [1, "bar"],
  [2, "line"],
  [3, "area"],
  [4, "high"],
  [5, "low"],
  [6, "close"],
]);

export type XySeriesType = "bar" | "line" | "area" | "high" | "low" | "close" | "unknown";

export interface XySeries {
  offset: number;
  /** Byte 0: series number, 0..15; also the slot 4 row of its name. */
  index: number;
  /** Slot 4 line (row = series number), or null. */
  name: TextLine | null;
  /** Byte 2 [I]. */
  typeCode: number;
  type: XySeriesType;
  /** Byte 3: 1 = Y1, 2 = Y2 [I]. */
  axis: number;
  /** Byte 9: colour role (21..26 repeating) [C]. */
  colorRole: number;
  /** Byte 13: second colour role, usually equal to byte 9 [?]. */
  colorRole2: number;
  /** Byte 8: 0..11 repeating [?]. */
  raw8: number;
  /** Byte 14: marker (or pattern) number [I]. */
  marker: number;
  raw: Uint8Array;
}

/** Record 1402. */
export interface XyAxis {
  offset: number;
  /** Byte 0: 0 = X, 1 = Y1, 2 = Y2 [I]. */
  index: number;
  /** The f64 at each offset of AXIS_F64_OFFSETS (null = not set). */
  values: Map<number, number | null>;
  /** f64 at 10 [I]. Null = choose automatically. */
  minimum: number | null;
  /** f64 at 18 [?]. */
  maximum: number | null;
  /** f64 at 29: label/tick increment [I]. */
  increment: number | null;
  raw: Uint8Array;
}

export interface XLabel {
  row: number;
  label: string;
}

export interface XyCalculation {
  offset: number;
  /** Byte 0 (5 in both samples): series number? [?] */
  raw0: number;
  /** The formula text, e.g. "@n(#3,5,5)". */
  text: string;
  raw: Uint8Array;
}

export interface XyData {
  kind: "xy";
  /** One per 1406, by series number. */
  series: XySeries[];
  /** X labels by row, sorted. */
  xLabels: XLabel[];
  /** Sparse values: series number → row → value. A missing entry means no value. */
  values: Map<number, Map<number, number>>;
  /** 1424 records holding the "not set" f64: empty cells, not in `values`. */
  blankValues: { series: number; row: number }[];
  /** 1 + the highest row that has a label or value (0 when none). */
  rowCount: number;
  /** 1402 records by axis number. */
  axes: XyAxis[];
  /** Slot 3 lines (row 0 X, 1 Y1, 2 Y2 [I]). */
  axisTitles: TextLine[];
  calculations: XyCalculation[];
  /** Chart-wide option records, raw [?]. */
  raw1404: Uint8Array | null;
  raw1408: Uint8Array | null;
  raw1410: Uint8Array | null;
  raw1414: Uint8Array | null;
  raw1418: Uint8Array | null;
  otherRecords: RawRecord[];
}

const KNOWN: ReadonlySet<number> = new Set(Object.values(XyTag));

/** The value at (series, row), or undefined when there is none. */
export function xyValue(data: Pick<XyData, "values">, series: number, row: number): number | undefined {
  return data.values.get(series)?.get(row);
}

function readSeries(rec: LeafRecord, names: Map<number, TextLine>, warnings: string[]): XySeries | null {
  if (!checkLength(rec, SERIES_RECORD_LENGTH, SERIES_RECORD_LENGTH, "XY series", warnings)) return null;
  const d = rec.data;
  const typeCode = d[2]!;
  return {
    offset: rec.offset,
    index: d[0]!,
    name: names.get(d[0]!) ?? null,
    typeCode,
    type: SERIES_TYPES.get(typeCode) ?? "unknown",
    axis: d[3]!,
    colorRole: d[9]!,
    colorRole2: d[13]!,
    raw8: d[8]!,
    marker: d[14]!,
    raw: d,
  };
}

function readAxis(rec: LeafRecord, warnings: string[]): XyAxis | null {
  if (!checkLength(rec, AXIS_RECORD_LENGTH, 1, "XY axis", warnings)) return null;
  const d = rec.data;
  const values = new Map<number, number | null>();
  for (const at of AXIS_F64_OFFSETS) if (at + 8 <= d.length) values.set(at, f64At(d, at));
  return {
    offset: rec.offset,
    index: d[0]!,
    values,
    minimum: values.get(10) ?? null,
    maximum: values.get(18) ?? null,
    increment: values.get(29) ?? null,
    raw: d,
  };
}

function readCalculation(rec: LeafRecord, warnings: string[]): XyCalculation | null {
  if (rec.data.length < 2) {
    warnings.push(`XY calculation (1420) at offset ${rec.offset} too short; kept raw`);
    return null;
  }
  const r = readerAt(rec.data, 1);
  let text: string;
  if (rec.data.indexOf(0, 1) < 0) {
    warnings.push(`XY calculation (1420) at offset ${rec.offset} has no string terminator`);
    text = r.paddedString(r.remaining);
  } else {
    text = r.cstring();
  }
  return { offset: rec.offset, raw0: rec.data[0]!, text, raw: rec.data };
}

export function parseXyData(chart: Chart, warnings: string[]): XyData {
  const names = new Map<number, TextLine>();
  for (const l of chart.textLines) {
    if (l.slot !== TextSlot.SeriesNames) continue;
    if (names.has(l.row)) warnings.push(`series name for series ${l.row} repeated; using the first`);
    else names.set(l.row, l);
  }

  const series: XySeries[] = [];
  for (const rec of recordsOf(chart, XyTag.Series)) {
    const s = readSeries(rec, names, warnings);
    if (!s) continue;
    if (s.index >= MAX_SERIES) warnings.push(`XY series at offset ${s.offset} has number ${s.index} (max ${MAX_SERIES - 1})`);
    if (series.some((o) => o.index === s.index)) warnings.push(`XY series ${s.index} repeated; using the first`);
    else series.push(s);
  }
  series.sort((a, b) => a.index - b.index);

  let rowCount = 0;
  const labels = new Map<number, string>();
  for (const rec of recordsOf(chart, XyTag.XLabel)) {
    if (!checkLength(rec, XLABEL_RECORD_LENGTH, 2, "X label", warnings)) continue;
    const row = u16At(rec.data, 0);
    const label = paddedAt(rec.data, 2, Math.min(23, rec.data.length - 2));
    if (labels.has(row)) warnings.push(`X label for row ${row} repeated; using the first`);
    else labels.set(row, label);
    rowCount = Math.max(rowCount, row + 1);
  }
  const xLabels = [...labels].sort((a, b) => a[0] - b[0]).map(([row, label]) => ({ row, label }));

  const values = new Map<number, Map<number, number>>();
  const blankValues: { series: number; row: number }[] = [];
  const unknownSeries = new Set<number>();
  for (const rec of recordsOf(chart, XyTag.Value)) {
    if (!checkLength(rec, VALUE_RECORD_LENGTH, VALUE_RECORD_LENGTH, "XY value", warnings)) continue;
    const s = rec.data[0]!;
    const row = u16At(rec.data, 1);
    const v = f64At(rec.data, 3);
    if (v === null) {
      // "Not set" (SPEC §3): an explicitly empty cell (42 records in 3 samples). No value.
      blankValues.push({ series: s, row });
      rowCount = Math.max(rowCount, row + 1);
      continue;
    }
    if (!Number.isFinite(v)) {
      warnings.push(`XY value at offset ${rec.offset} (series ${s}, row ${row}) is not a finite number; skipped`);
      continue;
    }
    let m = values.get(s);
    if (!m) values.set(s, (m = new Map()));
    if (m.has(row)) warnings.push(`XY value for series ${s} row ${row} repeated; using the first`);
    else m.set(row, v);
    rowCount = Math.max(rowCount, row + 1);
    if (!series.some((x) => x.index === s)) unknownSeries.add(s);
  }
  for (const s of unknownSeries) warnings.push(`XY values for series ${s}, which has no series record (1406)`);

  const axes: XyAxis[] = [];
  for (const rec of recordsOf(chart, XyTag.Axis)) {
    const a = readAxis(rec, warnings);
    if (!a) continue;
    if (axes.some((o) => o.index === a.index)) warnings.push(`XY axis ${a.index} repeated; using the first`);
    else axes.push(a);
  }
  axes.sort((a, b) => a.index - b.index);

  const calculations: XyCalculation[] = [];
  for (const rec of recordsOf(chart, XyTag.Calculation)) {
    const c = readCalculation(rec, warnings);
    if (c) calculations.push(c);
  }

  const axisTitles = chart.textLines.filter((l) => l.slot === TextSlot.AxisTitles).sort((a, b) => a.row - b.row);

  return {
    kind: "xy",
    series,
    xLabels,
    values,
    blankValues,
    rowCount,
    axes,
    axisTitles,
    calculations,
    raw1404: singleRaw(chart, XyTag.Options1404, warnings),
    raw1408: singleRaw(chart, XyTag.Frame1408, warnings),
    raw1410: singleRaw(chart, XyTag.Options1410, warnings),
    raw1414: singleRaw(chart, XyTag.Options1414, warnings),
    raw1418: singleRaw(chart, XyTag.Options1418, warnings),
    otherRecords: otherRecords(chart, KNOWN),
  };
}
