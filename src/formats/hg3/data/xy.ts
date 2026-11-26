/**
 * XY chart data (type 0x01, SPEC §5.4, task 11b): series (1406), X labels
 * (1426 in files saved by 3.05, 1422 in older ones), values (1424), axis
 * settings (1402), axis frame (1404, 1405), chart style (1408), data table
 * and labels (1410), legend (1418), axis titles (slot 3) and series names
 * (slot 4). 1414 is kept raw.
 *
 * The typed option fields follow SPEC §5.4, confirmed by the 3.05 test
 * pairs in samples/option-tests/xy (Yes/No = 1/2; the NaN f64 = blank). [C]
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
 * - 1402 has three records: 0 = X axis, 1 = Y1, 2 = Y2 [C]. In the samples
 *   offset 10 on Y1 = 6 in five high/low charts whose drawn Y1 axis starts
 *   at 6 (data minimum 6.6); offset 29 on X = 7 and 4 where the drawn X
 *   labels are every 7th / 4th row → label step [I].
 * - Bar heights in the drawn copy are proportional to the 1424 values (122
 *   bar series with one factor per chart; 94 with one factor per row, i.e.
 *   100 % stacked bars).
 * - 1420 (2 files): u8 5, then the NUL-terminated string "@n(#3,5,5)", a
 *   calculation for a series [I].
 */
import type { Chart } from "../chart";
import type { LeafRecord } from "../container";
import { type TextLine, TextSlot } from "../text";
import { decodeHg3Text } from "../../charset";
import { type RawRecord, checkLength, f32At, f64At, otherRecords, paddedAt, readerAt, recordsOf, singleRaw, u16At } from "./common";

export const XyTag = {
  Axis: 1402,
  Options1404: 1404,
  FrameFill: 1405,
  Series: 1406,
  Style: 1408,
  Options1410: 1410,
  StyleTable: 1412,
  Options1414: 1414,
  Options1418: 1418,
  Calculation: 1420,
  XLabel: 1422,
  Value: 1424,
  XLabel305: 1426,
} as const;

/** SPEC §5.4: up to 16 series. */
export const MAX_SERIES = 16;
export const SERIES_RECORD_LENGTH = 15;
export const AXIS_RECORD_LENGTH = 102;
export const XLABEL_RECORD_LENGTH = 25;
/** 1426: u16 row, string[31] (charts saved by 3.05) [C]. */
export const XLABEL305_RECORD_LENGTH = 33;
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

/** Yes/No bytes (SPEC §5.4): 1 = Yes, 2 = No [C]. */
export const YES = 1;
export const NO = 2;

export interface XySeries {
  offset: number;
  /** Byte 0: series number, 0..15; also the slot 4 row of its name. */
  index: number;
  /** Slot 4 line (row = series number), or null. */
  name: TextLine | null;
  /** Byte 1: show series (XS6SH) [C]. */
  show: boolean;
  /** Byte 2: 1 bar, 2 line (XS6AS) [C]; 3 area [C, samples]; 4.. high, low, close [I]. */
  typeCode: number;
  type: XySeriesType;
  /** Byte 3: 1 = Y1, 2 = Y2 (XS6Y2) [C]. */
  axis: number;
  /** Byte 4: cumulative (XS6CU) [C]. */
  cumulative: boolean;
  /** Byte 5: data labels, shown only when 1410 byte 2 is Yes (XS6DL) [C byte, I rule]. */
  dataLabels: boolean;
  /** Byte 6: listed in the data table (XS6DT) [C]. */
  dataTable: boolean;
  /** Byte 7: fill style, 1 = Color, 2 = the next choice (XS6FS) [C]. */
  fillStyle: number;
  /** Byte 8: fill pattern, the menu number − 1 (XS6FP) [C]. */
  fillPattern: number;
  /** Byte 9: fill colour role (21..26 repeating) (XS6FC) [C]. */
  colorRole: number;
  /** Byte 10: line fit, 1 = Normal (XS6LF) [C]; 2 trend, 3 curve [I]. */
  lineFit: number;
  /** Byte 11: line style, 1 = solid (XS6LS) [C]. */
  lineStyle: number;
  /** Byte 12: line width as shown, default 0 (XS6LW) [C]. */
  lineWidth: number;
  /** Byte 13: line colour role (XS6LC) [C]. */
  colorRole2: number;
  /** Byte 14: marker style 1..13 (XS6MK) [C]. */
  marker: number;
  /** Byte 8 (old name). */
  raw8: number;
  raw: Uint8Array;
}

/** Record 1402. */
export interface XyAxis {
  offset: number;
  /** Byte 0: 0 = X, 1 = Y1, 2 = Y2 [C]. */
  index: number;
  /** The f64 at each offset of AXIS_F64_OFFSETS (null = not set). */
  values: Map<number, number | null>;
  /** Byte 1: 1 = Linear, 2 = Log (XLOG) [C]. */
  scaleType: number;
  /** f64 at 2: scale factor, null = blank (XSCALE) [C]. */
  scaleFactor: number | null;
  /** f64 at 10: minimum, null = automatic (XMIN5) [C]. */
  minimum: number | null;
  /** f64 at 18: maximum, null = automatic (XMAX50) [C]. */
  maximum: number | null;
  /** Byte 26: grid lines 1 Dotted, 2 Solid, 3 None (XGRIDS, XGRIDN) [C]. */
  gridStyle: number;
  /** Byte 27: major ticks 1 In, 2 Out, 3 Both, 4 None (XMAJIN, XMAJOUT, XMAJBOT) [C]. */
  majorTicks: number;
  /** Byte 28: minor ticks, same values (XMINBOT) [C]. */
  minorTicks: number;
  /** f64 at 29: major tick increment (XMAJI10) [C]; on X the label step [I]. */
  increment: number | null;
  /** f64 at 37: minor tick increment (XMINI2) [C]. */
  minorIncrement: number | null;
  /** f64 at 45 / 53: goal range (XGOALMN, XGOALMX) [C]. */
  goalMin: number | null;
  goalMax: number | null;
  /** Byte 61: goal range colour role (XGOALC) [C]. */
  goalColorRole: number;
  /** Byte 62: show axis labels (XLBLNO) [C]. */
  showLabels: boolean;
  /** Bytes 63, 64, 65: percent, currency, scientific (XPCT, XCUR, XSCI) [C]. */
  percent: boolean;
  currency: boolean;
  scientific: boolean;
  /** f64 at 66: decimal places, null = automatic (XDEC2) [C]. */
  decimals: number | null;
  /** Byte 74: thousands separator (XTHOUN) [C]. */
  thousands: boolean;
  /** string[13] at 75 / 88: leading and trailing text (XLEAD, XTRAIL) [C]. */
  leading: string;
  trailing: string;
  raw: Uint8Array;
}

/** 1404 and 1405, axis frame (XFRST, XFROC, XFRFC, XFRSHF) [C]. */
export interface XyFrameOptions {
  /** 1 = Full (the default), 2 = the next choice. */
  style: number;
  outlineRole: number;
  fillRole: number;
  showFill: boolean;
}

/** 1408, chart style [C for the bytes, see SPEC §5.4]. */
export interface XyStyleOptions {
  /** Byte 0: 1 Cluster, 2 Overlap [C]; 3 stacked, 4 100 %, 5 step, 6 paired [I]. */
  barStyle: number;
  /** Byte 1: 1 Rectangle, 2 Pyramid [C]; 3 octagon, 4 cylinder [I]. */
  barShape: number;
  /** f32 at 2: bar width, percent of the category slot (85). */
  barWidth: number;
  /** f32 at 6: bar overlap percent (50). */
  barOverlap: number;
  /** Byte 10: area style, 2 Stack, 3 100 % [C]; 1 overlap [I]. */
  areaStyle: number;
  /** Byte 11: high/low style, 1 = Bar. */
  highLowStyle: number;
  /** Byte 12: 1 = 2D, 2 = 3D. */
  chartStyle: number;
  /** Byte 13: 2D style, 1 = Normal [C]; 4 horizontal [I]. */
  style2D: number;
  /** Byte 14: 3D style, 1 = Normal. */
  style3D: number;
  /** f32 at 15: 3D object depth (40). */
  objectDepth: number;
  /** f32 at 19: 3D floor depth (20). */
  floorDepth: number;
  /** Byte 23: link line colour role (18 = Lines). */
  linkRole: number;
  /** Byte 24: outline colour role (32 = Outlines). */
  outlineRole: number;
}

/** 1410, data table and data labels (XDTAB, XDTONLY, XDTGRID, XDLBL) [C]. */
export interface XyTableOptions {
  /** Byte 0: 1 No, 2 With chart, 3 Table only. */
  show: number;
  /** Byte 1: 1 Vertical, 2 Horizontal [C]; 3, 4 [I]. */
  grid: number;
  /** Byte 2: show data labels. */
  labels: boolean;
}

/** 1418, legend options (XLEGNO, XLEGPL, XLEGFR, XLEGOC, XLEGFC) [C]. */
export interface XyLegendOptions {
  show: boolean;
  /** Byte 1: 1 Inside, 2 Outside (the default). */
  placement: number;
  /** Byte 2: 1..12 clockwise, 5 right middle (default), 6 right bottom. */
  location: number;
  /** Byte 3: 2 Plain (the default), 1 the choice before it. */
  frameStyle: number;
  outlineRole: number;
  fillRole: number;
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
  /** Typed option records (null when the record is missing). */
  frame: XyFrameOptions | null;
  style: XyStyleOptions | null;
  table: XyTableOptions | null;
  legend: XyLegendOptions | null;
  /** Chart-wide option records, raw. */
  raw1404: Uint8Array | null;
  raw1405: Uint8Array | null;
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

const yes = (b: number | undefined) => b === YES;

/** NUL-terminated string in a field of n bytes; bytes after the NUL are leftovers and ignored [C]. */
export function fieldString(d: Uint8Array, at: number, n: number): string {
  if (at >= d.length) return "";
  const raw = d.subarray(at, Math.min(d.length, at + n));
  const nul = raw.indexOf(0);
  return decodeHg3Text(nul < 0 ? raw : raw.subarray(0, nul));
}

function f32Or(d: Uint8Array, at: number, fallback: number): number {
  if (d.length < at + 4) return fallback;
  const v = f32At(d, at);
  return Number.isFinite(v) ? v : fallback;
}

function readSeries(rec: LeafRecord, names: Map<number, TextLine>, warnings: string[]): XySeries | null {
  if (!checkLength(rec, SERIES_RECORD_LENGTH, SERIES_RECORD_LENGTH, "XY series", warnings)) return null;
  const d = rec.data;
  const typeCode = d[2]!;
  return {
    offset: rec.offset,
    index: d[0]!,
    name: names.get(d[0]!) ?? null,
    show: d[1] !== NO,
    typeCode,
    type: SERIES_TYPES.get(typeCode) ?? "unknown",
    axis: d[3]!,
    cumulative: yes(d[4]),
    dataLabels: d[5] !== NO,
    dataTable: d[6] !== NO,
    fillStyle: d[7]!,
    fillPattern: d[8]!,
    colorRole: d[9]!,
    lineFit: d[10]!,
    lineStyle: d[11]!,
    lineWidth: d[12]!,
    colorRole2: d[13]!,
    marker: d[14]!,
    raw8: d[8]!,
    raw: d,
  };
}

function readAxis(rec: LeafRecord, warnings: string[]): XyAxis | null {
  if (!checkLength(rec, AXIS_RECORD_LENGTH, 1, "XY axis", warnings)) return null;
  const d = rec.data;
  const values = new Map<number, number | null>();
  for (const at of AXIS_F64_OFFSETS) if (at + 8 <= d.length) values.set(at, f64At(d, at));
  const f = (at: number) => values.get(at) ?? null;
  return {
    offset: rec.offset,
    index: d[0]!,
    values,
    scaleType: d[1] ?? 1,
    scaleFactor: f(2),
    minimum: f(10),
    maximum: f(18),
    gridStyle: d[26] ?? (d[0] === 0 ? 3 : 1),
    majorTicks: d[27] ?? 4,
    minorTicks: d[28] ?? 4,
    increment: f(29),
    minorIncrement: f(37),
    goalMin: f(45),
    goalMax: f(53),
    goalColorRole: d[61] ?? 0,
    showLabels: d[62] !== NO,
    percent: yes(d[63]),
    currency: yes(d[64]),
    scientific: yes(d[65]),
    decimals: f(66),
    thousands: d[74] !== NO,
    leading: fieldString(d, 75, 13),
    trailing: fieldString(d, 88, 13),
    raw: d,
  };
}

function readFrame(r1404: Uint8Array | null, r1405: Uint8Array | null): XyFrameOptions | null {
  if (!r1404 && !r1405) return null;
  const d = r1404 ?? new Uint8Array(0);
  return { style: d[0] ?? 1, outlineRole: d[1] ?? 14, fillRole: d[2] ?? 15, showFill: r1405?.[0] !== NO };
}

function readStyle(d: Uint8Array | null): XyStyleOptions | null {
  if (!d) return null;
  return {
    barStyle: d[0] ?? 1,
    barShape: d[1] ?? 1,
    barWidth: f32Or(d, 2, 85),
    barOverlap: f32Or(d, 6, 50),
    areaStyle: d[10] ?? 2,
    highLowStyle: d[11] ?? 1,
    chartStyle: d[12] ?? 1,
    style2D: d[13] ?? 1,
    style3D: d[14] ?? 1,
    objectDepth: f32Or(d, 15, 40),
    floorDepth: f32Or(d, 19, 20),
    linkRole: d[23] ?? 18,
    outlineRole: d[24] ?? 32,
  };
}

function readTable(d: Uint8Array | null): XyTableOptions | null {
  if (!d) return null;
  return { show: d[0] ?? 1, grid: d[1] ?? 1, labels: yes(d[2]) };
}

function readLegend(d: Uint8Array | null): XyLegendOptions | null {
  if (!d) return null;
  return { show: d[0] !== NO, placement: d[1] ?? 2, location: d[2] ?? 5, frameStyle: d[3] ?? 2, outlineRole: d[4] ?? 14, fillRole: d[5] ?? 20 };
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
  const readLabels = (tag: number, length: number, n: number) => {
    for (const rec of recordsOf(chart, tag)) {
      if (!checkLength(rec, length, 2, "X label", warnings)) continue;
      const row = u16At(rec.data, 0);
      const label = paddedAt(rec.data, 2, Math.min(n, rec.data.length - 2));
      if (labels.has(row)) warnings.push(`X label for row ${row} repeated; using the first`);
      else labels.set(row, label);
      rowCount = Math.max(rowCount, row + 1);
    }
  };
  readLabels(XyTag.XLabel305, XLABEL305_RECORD_LENGTH, 31);
  readLabels(XyTag.XLabel, XLABEL_RECORD_LENGTH, 23);
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

  const raw1404 = singleRaw(chart, XyTag.Options1404, warnings);
  const raw1405 = singleRaw(chart, XyTag.FrameFill, warnings);
  const raw1408 = singleRaw(chart, XyTag.Style, warnings);
  const raw1410 = singleRaw(chart, XyTag.Options1410, warnings);
  const raw1418 = singleRaw(chart, XyTag.Options1418, warnings);

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
    frame: readFrame(raw1404, raw1405),
    style: readStyle(raw1408),
    table: readTable(raw1410),
    legend: readLegend(raw1418),
    raw1404,
    raw1405,
    raw1408,
    raw1410,
    raw1414: singleRaw(chart, XyTag.Options1414, warnings),
    raw1418,
    otherRecords: otherRecords(chart, KNOWN),
  };
}
