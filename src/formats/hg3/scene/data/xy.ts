/**
 * XY charts drawn from their data (task 17; SPEC §5.4, §5.5, §6.2).
 *
 * Fallback layout for charts without a drawn copy, fitted to the copies of
 * the 141 sample XY charts (constants and their evidence in assumptions.ts,
 * "Task 17"). In short:
 *
 * - Options: 1408 byte 0 bar style (cluster, overlap, stacked, 100 %,
 *   step, paired), byte 1 bar shape (bar, pyramid, octagon, cylinder),
 *   f32 at 2 bar width %, f32 at 6 overlap %, byte 10 area style (overlap,
 *   stacked, 100 %), byte 12 = 2 3-D, byte 13 = 4 horizontal, f32 at 15
 *   3-D bar depth % of a depth lane, f32 at 19 3-D depth % of the frame
 *   height; 1410 byte 0 = 2 a data table, byte 2 = 1 value labels. A
 *   column legend lists Stack and 100 % bars bottom-up (SPEC §5.5).
 * - 3.05 options (SPEC §5.4, checked against the drawn copies of the test
 *   charts in samples/option-tests/xy; rules marked at their constants):
 *   1402 scale type, factor, min/max, grid style, tick marks, increments,
 *   show labels and number format (xyFormat.ts); 1404/1405 axis frame;
 *   1406 show, Y axis, cumulative, data labels, data table; 1408 2D style
 *   2 shadows and outline role; 1410 table grid and table only; 1418 show
 *   and frame style. X labels come from 1426 in files saved by 3.05.
 * - The frame sits in the plot area with margins of 9 % of the plot size
 *   at the right and top and 9 % plus the widest Y1 label at the left;
 *   4.5 % plus the label height at the bottom; Y2 labels and Y axis titles
 *   take more room. In 3-D the frame's back wall is shifted up and right
 *   by the depth; values are measured on the front face.
 * - Value axes: from the data (stacked sums, 100 % for percent charts) or
 *   the 1402 minimum; step = range / 5 rounded to 1, 2 or 5 × 10^k,
 *   top = the next step above max + 3 % of the range.
 * - Bars fill the 1408 bar width of their category slot, split among the bar
 *   series (cluster), stacked, or overlapped; lines and areas run through
 *   the category centres when there are bars, else edge to edge.
 * - The legend fills its 810 area: swatch, gap, name per series.
 */
import type { Point, SceneElement } from "../../../../model/scene";
import {
  BOX_3D_SIDE_SHADE,
  BOX_3D_TOP_SHADE,
  XY_3D_CYLINDER_RY,
  XY_3D_CYLINDER_TOP_SHADE,
  XY_3D_OCTAGON_TOP_SHADE,
  XY_3D_OCTAGON_Z,
  XY_3D_PYRAMID_SHADES,
  XY_3D_TOP_SHADE,
  XY_FRAME_BOTTOM_MARGIN,
  XY_FRAME_MARGIN,
  XY_LABEL_GAP,
  XY_LEGEND_GAP,
  XY_LEGEND_MARGIN,
  XY_LEGEND_PITCH,
  XY_LEGEND_SWATCH,
  XY_LEGEND_SWATCH_DROP,
  XY_LINE_STYLE,
  XY_CURVE_STEPS,
  XY_CURVE_TENSION,
  XY_TEXT_WIDTH_STEP,
  XY_HTITLE_GAP_EM,
  XY_TITLE_GAP,
  XY_Y_MARGIN,
  lineWidthFor,
  textSizeToUnits,
} from "../../assumptions";
import { NO, type XyAxis, type XyData, type XySeries, parseXyData } from "../../data/xy";
import type { FontKey } from "../../../../fonts/fontKey";
import { ROLE } from "../../palette";
import { Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { shadeCss } from "../objectLayer";
import { toScene } from "../page";
import { fillLook } from "./fillStyle";
import { type Box, type StyledText, baselineBelow, boxOf, drawnAdvance, layoutEm, lineBoxHeight, pageBox, textElement } from "./text";
import { styled } from "./textCharts";
import { type XyNumberFormat, formatXyNumber } from "./xyFormat";

const NO_FONT: FontKey = { source: 0, number: 0, style: 0 };

// ---------------------------------------------------------------------------
// Rules from the 3.05 test charts (samples/option-tests/xy), each checked
// against the chart's own drawn copy. Page units; W, H = plot area size,
// FW = frame width.
// ---------------------------------------------------------------------------

/** 1408 byte 13 = 2: drop shadows (XS2DST) [I: "the next choice"; the copy draws them]. */
const STYLE_2D_SHADOW = 2;
/** The shadow is the bar moved right by this share of its width, its top down by this share of its height, role Shadow (XS2DST) [I]. */
export const XY_SHADOW_OFFSET = 0.15;
/** Major / minor tick length, share of FW (XMAJIN, XMAJOUT, XMAJBOT: 416 of 20827; XMINBOT: 208) [C]. */
export const XY_MAJOR_TICK = 0.02;
export const XY_MINOR_TICK = 0.01;
/** Minor ticks per major step when the minor increment is blank (XMINBOT: every 1 on a step of 5) [I]. */
export const XY_MINOR_PER_MAJOR = 5;
/** Outward major ticks move the frame edge in by this share of W (XMAJOUT, XMAJBOT: 299 of 26615) [I, one value]. */
export const XY_TICK_OUT_SHIFT = 299 / 26615;
/** Dotted grid lines are dashes this long at this pitch, from the line's start; pitch = share of the page's short side (332.8 on 10 × 7.5 in pages in the samples, 342.9 on Letter in the test charts) [I]. */
export const XY_DOT_PITCH = 332.8 / 24576;
export const XY_DOT_LENGTH = 0.309;
/** Data table without swatches: name column padding each side, ems of the name size (266 = 0.3 × 886; XREV7, XDTONLY) [I]. */
export const XY_TABLE_PAD_EM = 0.3;
/**
 * Data table with swatches: padding before and after the widest name (its drawn advance), ems of the
 * name size; fitted to XMLEGNO (532 and 316 at em 860). XLEGNO (Letter) comes out 66 units right
 * for the names and 125 for the frame, so the rule is not exact [I].
 */
export const XY_TABLE_SWATCH_PAD_EM = 0.62;
export const XY_TABLE_SWATCH_PAD_AFTER_EM = 0.37;
/** Data table without swatches: gap between the X labels and the table, share of H (XREV7: 475 of 21153) [C]. */
export const XY_TABLE_GAP = 0.0225;
/** Table only: the table fills the plot area down to this share of H above its bottom (XDTONLY: 1058 of 21153) [C]. */
export const XY_TABLE_ONLY_BOTTOM = 0.05;
/** 1402 byte 26 grid lines, bytes 27/28 tick marks [C]. */
const GRID_DOTTED = 1;
const GRID_SOLID = 2;
const TICK_IN = 1;
const TICK_OUT = 2;
const TICK_BOTH = 3;
/** 1404 byte 0 = 2: only the left and bottom frame edges (XFRST) [I]. */
const FRAME_HALF = 2;
/** 1418 byte 3 = 1: legend without a box, items flush left (XDTNO, XLEGOC) [I]. */
const LEGEND_NO_FRAME = 1;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type BarMode = "cluster" | "overlap" | "stacked" | "percent" | "step" | "paired";
export type AreaMode = "overlap" | "stacked" | "percent";
export type BarShape = "bar" | "pyramid" | "octagon" | "cylinder";

const BAR_MODES: Record<number, BarMode> = { 1: "cluster", 2: "overlap", 3: "stacked", 4: "percent", 5: "step", 6: "paired" };
const AREA_MODES: Record<number, AreaMode> = { 1: "overlap", 2: "stacked", 3: "percent" };
const BAR_SHAPES: Record<number, BarShape> = { 1: "bar", 2: "pyramid", 3: "octagon", 4: "cylinder" };

export interface XyOptions {
  barMode: BarMode;
  barShape: BarShape;
  /** Bar (cluster) width, percent of the category slot. */
  barWidth: number;
  /** Overlap of overlapped bars, percent of a bar's width. */
  overlap: number;
  areaMode: AreaMode;
  threeD: boolean;
  horizontal: boolean;
  /** 3-D: depth of a bar, percent of its depth lane. */
  barDepth: number;
  /** 3-D: depth of the frame, percent of its height. */
  depth: number;
  /** A data table under the chart (1410 byte 0 = 2) [C]. */
  dataTable: boolean;
  /** The data table alone, without the chart (1410 byte 0 = 3) [C, XDTONLY]. */
  tableOnly: boolean;
  /** Table grid lines (1410 byte 1): 1 vertical, 2 horizontal [C, XDTGRID]. */
  tableGrid: number;
  /** Values printed at the bars and points (1410 byte 2 = 1) [C]. */
  valueLabels: boolean;
  /** High/low style (1408 byte 11): 1 box, 2 band, 3 I bar [I]. */
  highLowStyle: number;
  /** 2D style 2 (1408 byte 13): bars cast a drop shadow (XS2DST) [I]. */
  shadow: boolean;
  /** Bar and swatch outline colour role (1408 byte 24, 32 = Outlines) [C, XSOUT]. */
  outlineRole: number;
  /** Axis frame (1404, 1405): style 1 full, 2 left and bottom edges only [I, XFRST]; roles [C]. */
  frameStyle: number;
  frameRole: number;
  frameFillRole: number;
  frameFill: boolean;
  /** Legend (1418): shown, frame style (1 none [I, XDTNO], 2 plain), frame roles [C]. */
  legendShow: boolean;
  legendFrameStyle: number;
  legendOutlineRole: number;
  legendFillRole: number;
}

function f32(d: Uint8Array, at: number): number | null {
  if (d.length < at + 4) return null;
  const v = new DataView(d.buffer, d.byteOffset + at, 4).getFloat32(0, true);
  return Number.isFinite(v) ? v : null;
}

type OptionRecords = Pick<XyData, "raw1408" | "raw1410" | "raw1418"> & Partial<Pick<XyData, "raw1404" | "raw1405">>;

export function xyOptions(data: OptionRecords): XyOptions {
  const o = data.raw1408 ?? new Uint8Array(0);
  const t = data.raw1410 ?? new Uint8Array(0);
  const g = data.raw1418 ?? new Uint8Array(0);
  const fr = data.raw1404 ?? new Uint8Array(0);
  return {
    barMode: BAR_MODES[o[0] ?? 1] ?? "cluster",
    barShape: BAR_SHAPES[o[1] ?? 1] ?? "bar",
    barWidth: f32(o, 2) ?? 85,
    overlap: f32(o, 6) ?? 50,
    areaMode: AREA_MODES[o[10] ?? 1] ?? "overlap",
    threeD: o[12] === 2,
    horizontal: o[13] === 4,
    barDepth: f32(o, 15) ?? 40,
    depth: f32(o, 19) ?? 15,
    dataTable: t[0] === 2,
    tableOnly: t[0] === 3,
    tableGrid: t[1] ?? 1,
    valueLabels: t[2] === 1,
    highLowStyle: o[11] ?? 1,
    shadow: o[13] === STYLE_2D_SHADOW,
    outlineRole: o[24] || ROLE.Outlines,
    frameStyle: fr[0] ?? 1,
    frameRole: fr[1] || ROLE.Frame,
    frameFillRole: fr[2] || ROLE.FrameBkg,
    frameFill: data.raw1405?.[0] !== NO,
    legendShow: g[0] !== NO,
    legendFrameStyle: g[3] ?? 2,
    legendOutlineRole: g[4] || ROLE.Frame,
    legendFillRole: g[5] || ROLE.Legend,
  };
}

// ---------------------------------------------------------------------------
// Value axes
// ---------------------------------------------------------------------------

export interface AxisScale {
  min: number;
  max: number;
  step: number;
  percent: boolean;
  /** Logarithmic (1402 byte 1 = 2): min and max are powers of ten, ticks at each decade [I]. */
  log?: boolean;
}

/** A log axis over whole decades covering the data (GALD481: 3 to 44 gives 1 to 100) [I]. */
export function logScale(dataMin: number, dataMax: number): AxisScale {
  const lo = dataMin > 0 && Number.isFinite(dataMin) ? 10 ** Math.floor(Math.log10(dataMin)) : 1;
  let hi = dataMax > 0 && Number.isFinite(dataMax) ? 10 ** Math.ceil(Math.log10(dataMax)) : lo * 10;
  if (hi <= lo) hi = lo * 10;
  return { min: lo, max: hi, step: 10, percent: false, log: true };
}

/** Grid positions of a log axis: 1 to 9 times each decade. */
function logGrid(s: AxisScale): number[] {
  const out: number[] = [];
  for (let d = s.min; d < s.max * 0.999; d *= 10) for (let k = 1; k < 10; k++) out.push(d * k);
  out.push(s.max);
  return out;
}

/** Tick step: range / 5 rounded to the nearest (geometrically) of 1, 2 or 5 × 10^k [I]. */
export function niceStep(range: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const raw = range / 5;
  const k = Math.floor(Math.log10(raw));
  const base = 10 ** k;
  const f = raw / base;
  const m = f < Math.SQRT2 ? 1 : f < Math.sqrt(10) ? 2 : f < Math.sqrt(50) ? 5 : 10;
  return m * base;
}

/**
 * Axis range from the data [I]: from the set minimum (1402 offset 10), else
 * 0 (or the next step below a negative minimum), to the first step above
 * max + (XY_Y_MARGIN − 1) × range; a set maximum (1402 offset 18 [?]) is
 * used as it is.
 */
export function autoScale(dataMin: number, dataMax: number, setMin: number | null, setMax: number | null): AxisScale {
  const finiteMin = Number.isFinite(dataMin) ? dataMin : 0;
  let lo = setMin ?? Math.min(0, finiteMin);
  const hi = Number.isFinite(dataMax) ? Math.max(dataMax, lo) : lo + 1;
  if (setMax !== null && setMax > lo) return { min: lo, max: setMax, step: niceStep(setMax - lo), percent: false };
  const step = niceStep(hi - lo);
  if (setMin === null && lo < 0) lo = Math.floor((hi - (hi - lo) * XY_Y_MARGIN) / step + 1e-9) * step;
  let top = Math.ceil((lo + (hi - lo) * XY_Y_MARGIN) / step - 1e-9) * step;
  if (top <= lo) top = lo + step;
  return { min: lo, max: top, step, percent: false };
}

export function tickValues(s: AxisScale): number[] {
  const out: number[] = [];
  if (s.log) {
    for (let d = s.min; d <= s.max * 1.001; d *= 10) out.push(d);
    return out;
  }
  const n = Math.floor((s.max - s.min) / s.step + 1e-6);
  for (let i = 0; i <= n; i++) out.push(s.min + i * s.step);
  return out;
}

function decimalsOf(step: number): number {
  for (let d = 0; d < 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 6;
}

/** A tick label: plain, "N%" on a 100 % axis, else in the axis' number format (xyFormat.ts). */
export function tickLabel(v: number, s: AxisScale, fmt: XyNumberFormat | null = null): string {
  const t = s.log ? Number(v.toPrecision(6)) : Number(v.toFixed(decimalsOf(s.step)));
  if (s.percent) return `${t}%`;
  return fmt ? formatXyNumber(t, fmt) : String(t);
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

function rowsOf(data: XyData): number[] {
  return Array.from({ length: data.rowCount }, (_, i) => i);
}

const isBar = (s: XySeries) => s.type === "bar";
const isArea = (s: XySeries) => s.type === "area";
const isHighLow = (s: XySeries) => s.type === "high" || s.type === "low" || s.type === "close";

/** Data min and max of the series on one axis, with stacking. */
function dataRange(data: XyData, opts: XyOptions, series: XySeries[]): { min: number; max: number; percent: boolean } {
  let min = Infinity;
  let max = -Infinity;
  const stackBars = opts.barMode === "stacked" || opts.barMode === "percent";
  const stackAreas = opts.areaMode === "stacked" || opts.areaMode === "percent";
  const percentBars = opts.barMode === "percent" && series.some(isBar);
  const percentAreas = opts.areaMode === "percent" && series.some(isArea);
  const percent = (percentBars || percentAreas) && series.every((s) => (isBar(s) && percentBars) || (isArea(s) && percentAreas));
  if (percent) return { min: 0, max: 100, percent: true };
  for (const r of rowsOf(data)) {
    let bp = 0;
    let bn = 0;
    let ap = 0;
    let an = 0;
    for (const s of series) {
      const v = data.values.get(s.index)?.get(r);
      if (v === undefined) continue;
      if (isBar(s) && stackBars) {
        if (v >= 0) bp += v;
        else bn += v;
      } else if (isArea(s) && stackAreas) {
        if (v >= 0) ap += v;
        else an += v;
      } else {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (bp || ap) max = Math.max(max, bp, ap);
    if (bn || an) min = Math.min(min, bn, an);
  }
  return { min, max, percent: false };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Style of a 1412 entry (X labels 10, Y1 11, Y2 12, value labels 14) [I]. */
function tableStyle(ctx: ChartSceneContext, index: number, role: number): Omit<StyledText, "text"> {
  const e = ctx.chart.styleTables.get(1412)?.[index];
  const ok = e && e.size > 0 ? e : null;
  return { size: ok?.size ?? 3.5, color: ok?.colorRole || role, justification: Justification.Left, fontKey: ok?.fontKey ?? NO_FONT };
}

/**
 * Width of a label's box as the copies store it: each character's advance
 * rounded up to XY_TEXT_WIDTH_STEP page units (every sample label box is a
 * multiple of 50; checked on 15 strings) [I].
 */
export function xyTextWidth(ctx: ChartSceneContext, text: string, fontKey: FontKey, size: number): number {
  let w = 0;
  for (const ch of Array.from(text)) w += Math.ceil(drawnAdvance(ctx, ch, fontKey, size) / XY_TEXT_WIDTH_STEP - 1e-6) * XY_TEXT_WIDTH_STEP;
  return w;
}

interface Label {
  text: string;
  style: Omit<StyledText, "text">;
  width: number;
  height: number;
}

function label(ctx: ChartSceneContext, text: string, style: Omit<StyledText, "text">): Label {
  const t = text.trim();
  return { text: t, style, width: xyTextWidth(ctx, t, style.fontKey, style.size), height: lineBoxHeight(ctx, style.size) };
}

/** Draw a label centred in a box of its width whose top-left corner is (left, top) (text runs justified centre in the copies). */
function drawCentred(ctx: ChartSceneContext, l: Label, left: number, top: number): SceneElement[] {
  const el = textElement(ctx, { ...l.style, text: l.text }, "middle", left + l.width / 2, baselineBelow(ctx, top, l.style.size));
  return el ? [el] : [];
}

/** Draw a label whose box has its top-left corner at (left, top). */
function drawLabel(ctx: ChartSceneContext, l: Label, left: number, top: number): SceneElement[] {
  const el = textElement(ctx, { ...l.style, text: l.text }, "start", left, baselineBelow(ctx, top, l.style.size));
  return el ? [el] : [];
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function line(points: Point[], stroke: string | null, width: number, smooth = false): SceneElement[] {
  if (!stroke || points.length === 0) return [];
  return [
    {
      kind: "path",
      points: points.map((p) => toScene(p.x, p.y)),
      closed: false,
      fill: null,
      stroke,
      strokeWidth: width,
      ...(smooth ? { smooth: true } : {}),
    },
  ];
}

function polygon(points: Point[], fill: string | null, stroke: string | null, width: number): SceneElement[] {
  if (!fill && !stroke) return [];
  return [{ kind: "path", points: points.map((p) => toScene(p.x, p.y)), closed: true, fill, stroke, strokeWidth: width }];
}

function rect(b: Box, fill: string | null, stroke: string | null, width: number): SceneElement[] {
  if (!fill && !stroke) return [];
  return [
    {
      kind: "rect",
      x: Math.min(b.left, b.right),
      y: -Math.max(b.top, b.bottom),
      width: Math.abs(b.right - b.left),
      height: Math.abs(b.top - b.bottom),
      fill,
      stroke,
      strokeWidth: width,
    },
  ];
}

const shade = (fill: string | null, k: number) => (fill && k < 1 ? shadeCss(fill, k) : fill);

/** A 3-D box as the copies store it (0x1070 style 6, depth c): top and right faces, then the front (as objectLayer draws it). */
function box3d(b: Box, c: number, fill: string | null, stroke: string | null, width: number): SceneElement[] {
  const { left, right, top, bottom } = b;
  return [
    ...polygon([{ x: left, y: top }, { x: right, y: top }, { x: right + c, y: top + c }, { x: left + c, y: top + c }], shade(fill, BOX_3D_TOP_SHADE), stroke, width),
    ...polygon([{ x: right, y: bottom }, { x: right + c, y: bottom + c }, { x: right + c, y: top + c }, { x: right, y: top }], shade(fill, BOX_3D_SIDE_SHADE), stroke, width),
    ...rect(b, fill, stroke, width),
  ];
}

const shift = (p: Point, z: number): Point => ({ x: p.x + z, y: p.y + z });

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface Layout {
  ctx: ChartSceneContext;
  data: XyData;
  opts: XyOptions;
  plot: Box;
  /** The whole frame (in 3-D including the depth). */
  outer: Box;
  /** The front face, where values are measured. */
  frame: Box;
  /** 3-D depth (0 in 2-D). */
  depth: number;
  rows: number;
  /** Rows sit in category slots (when there are bars), else on the edges. */
  slots: boolean;
  y1: AxisScale;
  y2: AxisScale | null;
  thin: number;
  /** Numeric X axis: its scale and each row's X value. */
  xScale: AxisScale | null;
  xNumbers: Map<number, number>;
  /** 3-D depth lanes (seriesGroups), 1 in 2-D. */
  lanes: number;
  /** Set once the first 3-D bar is drawn (pyramids show a left face only there). */
  drewFirstBar?: boolean;
  /** Axis records of the left and right value axes, and their tick marks. */
  y1Axis: XyAxis | undefined;
  y2Axis: XyAxis | undefined;
  leftTicks: Ticks;
  rightTicks: Ticks;
}

/** Fraction 0..1 along the category axis of row r's centre. */
function rowAt(l: Layout, r: number): number {
  if (l.xScale) return valueAt(l.xScale, l.xNumbers.get(r) ?? l.xScale.min);
  if (l.slots) return (r + 0.5) / Math.max(1, l.rows);
  return l.rows > 1 ? r / (l.rows - 1) : 0.5;
}

function valueAt(s: AxisScale, v: number): number {
  if (s.log) return v > 0 ? (Math.log10(v) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min)) : 0;
  return (v - s.min) / (s.max - s.min);
}

/** Page point on the front face at category fraction t and value fraction f. */
function at(l: Layout, t: number, f: number): Point {
  const F = l.frame;
  if (l.opts.horizontal) return { x: F.left + f * (F.right - F.left), y: F.top - t * (F.top - F.bottom) };
  return { x: F.left + t * (F.right - F.left), y: F.bottom + f * (F.top - F.bottom) };
}

function boxAt(l: Layout, t0: number, t1: number, f0: number, f1: number, z = 0): Box {
  const a = shift(at(l, t0, f0), z);
  const b = shift(at(l, t1, f1), z);
  return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), bottom: Math.min(a.y, b.y), top: Math.max(a.y, b.y) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Series values with cumulative series (1406 byte 4) replaced by their running sums over the rows (XS6CU) [C]. */
export function withCumulative(data: XyData): XyData {
  if (!data.series.some((s) => s.cumulative)) return data;
  const values = new Map(data.values);
  for (const s of data.series) {
    const m = data.values.get(s.index);
    if (!s.cumulative || !m) continue;
    let acc = 0;
    const out = new Map<number, number>();
    for (const [r, v] of [...m].sort((a, b) => a[0] - b[0])) out.set(r, (acc += v));
    values.set(s.index, out);
  }
  return { ...data, values };
}

const axisOf = (data: XyData, index: number): XyAxis | undefined => data.axes.find((a) => a.index === index);

/** Tick marks along one value axis edge. */
interface Ticks {
  major: number;
  minor: number;
  /** Extra room the labels need outside the edge (outward ticks). */
  out: number;
}

function ticksOf(a: XyAxis | undefined, FW: number): Ticks {
  const outward = (st: number | undefined, len: number) => (st === TICK_OUT || st === TICK_BOTH ? len : 0);
  return {
    major: a?.majorTicks ?? 4,
    minor: a?.minorTicks ?? 4,
    out: Math.max(outward(a?.majorTicks, XY_MAJOR_TICK * FW), outward(a?.minorTicks, XY_MINOR_TICK * FW)),
  };
}

export function drawXYChart(ctx: ChartSceneContext): SceneElement[] {
  const data = withCumulative(parseXyData(ctx.chart, []));
  const opts = xyOptions(data);
  const withData = data.series.filter((s) => (data.values.get(s.index)?.size ?? 0) > 0);
  // Hidden series (1406 byte 1 = 2) are left out everywhere but keep their legend row (XS6SH) [C].
  const series = withData.filter((s) => s.show);
  if (series.length === 0 || data.rowCount === 0) return [];
  const plot = ctx.chart.areas.plot ? boxOf(ctx.chart.areas.plot) : pageBox(ctx);
  const W = plot.right - plot.left;
  const H = plot.top - plot.bottom;
  const xAxis = axisOf(data, 0);
  const y1Axis = axisOf(data, 1);
  const y2Axis = axisOf(data, 2);
  const tableSeriesAll = series.filter((s) => s.dataTable);
  // The data table lists the series bottom-up when the legend would (see listedBottomUp) [I].
  const tableSeries = listedBottomUp(opts) ? [...tableSeriesAll].reverse() : tableSeriesAll;
  // Without a legend the data table carries the series swatches (XLEGNO vs XREV7; every sample table) [C].
  const legendShown = opts.legendShow && !!ctx.chart.areas.legend;
  const swatches = !opts.legendShow;

  if (opts.tableOnly) {
    // Table only: no chart; the table fills the plot area (XDTONLY) [C].
    const t = tableLayout(ctx, tableSeries, plot, H, swatches, true);
    return drawTableOnly(ctx, opts, data, t, tableSeries, plot);
  }

  // Value axes.
  const onY2 = series.filter((s) => s.axis === 2);
  const onY1 = series.filter((s) => s.axis !== 2);
  const scaleFor = (list: XySeries[], index: number): AxisScale | null => {
    if (!list.length) return null;
    const r = dataRange(data, opts, list);
    if (r.percent) return { min: 0, max: 100, step: 25, percent: true };
    const a = axisOf(data, index);
    if (a?.scaleType === AXIS_LOG) return logScale(r.min, r.max);
    const sc = autoScale(r.min, r.max, a?.minimum ?? null, a?.maximum ?? null);
    // A set major increment changes the tick step, not the range (XMAJI10: 0..35 labelled 0, 10, 20, 30) [C].
    const inc = a?.increment ?? null;
    if (inc !== null && inc > 0 && (sc.max - sc.min) / inc <= 1000) sc.step = inc;
    return sc;
  };
  // A numeric X axis (1414 byte 0 = 13): rows sit at their X label's value on a scale like a value axis [I].
  const xNumbers = new Map<number, number>();
  if (data.raw1414?.[0] === NUMERIC_X) {
    for (const x of data.xLabels) {
      const n = Number(x.label.trim());
      if (x.label.trim() && Number.isFinite(n)) xNumbers.set(x.row, n);
    }
  }
  // With bars it is rounded like a value axis (GALD371: 1..28 gives 0..30); otherwise it runs from the first
  // to the last value with ticks every step from the first (GALD461: 1, 6 .. 26; GALD481: 0, 2 .. 10 of 0..11) [I].
  const xMin = Math.min(...xNumbers.values());
  const xMax = Math.max(...xNumbers.values());
  const xScale = !xNumbers.size
    ? null
    : series.some(isBar)
      ? autoScale(xMin, xMax, null, null)
      : { min: xMin, max: xMax > xMin ? xMax : xMin + 1, step: niceStep(xMax - xMin), percent: false };
  const y1OnY2 = !onY1.length;
  const y1 = (scaleFor(onY1, 1) ?? scaleFor(onY2, 2))!;
  const y2 = onY1.length ? scaleFor(onY2, 2) : null;
  // The axis record that formats and styles the left axis (Y2's when only Y2 has series).
  const leftAxis = y1OnY2 ? y2Axis : y1Axis;

  // Labels; "Show axis labels" No (1402 byte 62) leaves them out (XLBLNO) [C].
  const y1Labels = leftAxis?.showLabels === false ? [] : tickValues(y1).map((v) => label(ctx, tickLabel(v, y1, leftAxis ?? null), tableStyle(ctx, 11, ROLE.Y1Label)));
  const y2Labels = y2 && y2Axis?.showLabels !== false ? tickValues(y2).map((v) => label(ctx, tickLabel(v, y2, y2Axis ?? null), tableStyle(ctx, 12, ROLE.Y2Label))) : [];
  const xByRow = new Map(data.xLabels.map((x) => [x.row, x.label]));
  const xStyle = tableStyle(ctx, 10, ROLE.XLabel);
  const showX = xAxis?.showLabels !== false;
  const xLabels = xScale || !showX ? [] : rowsOf(data).map((r) => label(ctx, xByRow.get(r) ?? "", xStyle));
  const xTicks = xScale && showX ? tickValues(xScale).map((v) => label(ctx, tickLabel(v, xScale), xStyle)) : [];
  // Percent labels of a 100 % axis take the width of their number only (GALD351) [I]; formatted labels
  // take their full width (XPCT) [C].
  const widthOf = (l: Label, sc: AxisScale | null) =>
    sc?.percent && l.text.endsWith("%") ? xyTextWidth(ctx, l.text.slice(0, -1), l.style.fontKey, l.style.size) : l.width;
  const maxW = (ls: Label[], sc: AxisScale | null = null) => Math.max(0, ...ls.map((l) => widthOf(l, sc)));
  const maxH = (ls: Label[]) => Math.max(0, ...ls.map((l) => l.height));

  // Axis titles (slot 3: row 0 X, 1 Y1, 2 Y2).
  const titleOf = (row: number): Label | null => {
    const t = data.axisTitles.find((x) => x.row === row && x.text.trim());
    return t ? label(ctx, t.text, styled(ctx, t)) : null;
  };
  const yTitles = [titleOf(1), titleOf(2)].filter((t): t is Label => t !== null);
  const yTitleH = maxH(yTitles);

  // Frame: the category labels go at the left in horizontal charts, the value labels at the bottom.
  const leftW = opts.horizontal ? maxW(xScale ? xTicks : xLabels) : maxW(y1Labels, y1);
  const bottomH = opts.horizontal ? maxH(y1Labels) : xLabels.length || xTicks.length ? lineBoxHeight(ctx, xStyle.size) : 0;
  // A data table (1410 byte 0 = 2) takes the bottom of the plot area: one row per series under the frame,
  // the series names in a column at its left.
  const table = opts.dataTable ? tableLayout(ctx, tableSeries, plot, H, swatches, false) : null;
  // Tick marks (2-D vertical charts): outward major ticks move the frame edge in (XMAJOUT) [I].
  const flat2d = !opts.threeD && !opts.horizontal;
  const shiftFor = (a: XyAxis | undefined) => (flat2d && (a?.majorTicks === TICK_OUT || a?.majorTicks === TICK_BOTH) ? XY_TICK_OUT_SHIFT * W : 0);
  // Horizontal charts: Y2 labels above the frame, the Y1 title under the Y1 labels and the Y2 title above
  // the Y2 labels, both centred (GALD871) [I].
  const t1 = titleOf(1);
  const t2 = titleOf(2);
  // 3.05 leaves the same gap above every table, swatches or not (XREV7, XMLEGNO, XLEGNO) [C].
  const tableBottomGap = table ? XY_TABLE_GAP : XY_FRAME_BOTTOM_MARGIN;
  const outer: Box = opts.horizontal
    ? {
        left: plot.left + XY_FRAME_MARGIN * W + leftW,
        right: plot.right - XY_FRAME_MARGIN * W,
        top: plot.top - XY_FRAME_MARGIN * H - maxH(y2Labels) - (t2?.height ?? 0),
        bottom: (table ? table.top : plot.bottom) + tableBottomGap * H + bottomH + (t1?.height ?? 0),
      }
    : {
        left: (table ? table.frameLeft : plot.left + XY_FRAME_MARGIN * W + leftW) + shiftFor(leftAxis),
        right: plot.right - XY_FRAME_MARGIN * W - maxW(y2Labels) - (y2 ? shiftFor(y2Axis) : 0),
        top: plot.top - XY_FRAME_MARGIN * H - yTitleH,
        bottom: (table ? table.top : plot.bottom) + tableBottomGap * H + bottomH,
      };
  // Horizontal "3-D" charts have no depth walls: their copies draw flat frames with drop-shadow bars
  // (0x1070 style 5), whose geometry is not decoded; they are drawn flat [?].
  const depth = opts.threeD && !opts.horizontal ? (opts.depth / 100) * (outer.top - outer.bottom) : 0;
  const frame: Box = { ...outer, right: outer.right - depth, top: outer.top - depth };
  const thin = lineWidthFor(XY_LINE_STYLE);
  const barCount = series.filter(isBar).length;
  const lanes = depth > 0 ? Math.max(1, seriesGroups(series, { ...opts, threeD: true }).length) : 1;
  const FW = frame.right - frame.left;
  const FH = frame.top - frame.bottom;
  const leftTicks = flat2d ? ticksOf(leftAxis, FW) : ticksOf(undefined, FW);
  const rightTicks = flat2d && y2 ? ticksOf(y2Axis, FW) : ticksOf(undefined, FW);
  const l: Layout = {
    ctx,
    data,
    opts,
    plot,
    outer,
    frame,
    depth,
    rows: data.rowCount,
    slots: barCount > 0 || series.some(isHighLow),
    y1,
    y2,
    thin,
    lanes,
    xScale,
    xNumbers,
    y1Axis: leftAxis,
    y2Axis,
    leftTicks,
    rightTicks,
  };

  const out: SceneElement[] = [];
  out.push(...drawFrame(l));
  out.push(...drawSeries(l, series));

  // Value labels, centred on their ticks: Y1 at the left (horizontal: below), Y2 at the right on the back plane.
  y1Labels.forEach((lab, i) => {
    const v = tickValues(y1)[i]!;
    const p = at(l, 0, valueAt(y1, v));
    if (opts.horizontal) out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, frame.bottom - XY_LABEL_GAP * FW));
    else out.push(...drawLabel(ctx, lab, frame.left - XY_LABEL_GAP * FW - leftTicks.out - lab.width, p.y + lab.height / 2));
  });
  if (y2) {
    y2Labels.forEach((lab, i) => {
      const v = tickValues(y2)[i]!;
      const p = shift(at(l, 1, valueAt(y2, v)), depth);
      if (opts.horizontal) out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, outer.top + XY_LABEL_GAP * FW + lab.height));
      else out.push(...drawLabel(ctx, lab, outer.right + XY_LABEL_GAP * FW + rightTicks.out, p.y + lab.height / 2));
    });
  }
  if (xScale) {
    xTicks.forEach((lab, i) => {
      const v = tickValues(xScale)[i]!;
      const p = at(l, valueAt(xScale, v), 0);
      if (opts.horizontal) out.push(...drawLabel(ctx, lab, frame.left - XY_LABEL_GAP * FH - lab.width, p.y + lab.height / 2));
      else out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, frame.bottom - XY_LABEL_GAP * FH));
    });
  }
  // Category labels, every nth (1402 X offset 29).
  const every = Math.max(1, Math.round(xAxis?.increment ?? 1));
  xLabels.forEach((lab, r) => {
    if (!lab.text || r % every !== 0) return;
    const p = at(l, rowAt(l, r), 0);
    if (opts.horizontal) out.push(...drawLabel(ctx, lab, frame.left - XY_LABEL_GAP * FH - lab.width, p.y + lab.height / 2));
    else out.push(...drawLabel(ctx, lab, p.x - lab.width / 2, frame.bottom - XY_LABEL_GAP * FH));
  });
  if (opts.horizontal) {
    const cx = (frame.left + frame.right) / 2;
    const em = (t: Label) => XY_HTITLE_GAP_EM * textSizeToUnits(t.style.size, ctx.page.shortSide);
    if (t1) out.push(...drawLabel(ctx, t1, cx - t1.width / 2, frame.bottom - XY_LABEL_GAP * FW - maxH(y1Labels) - em(t1)));
    if (t2) out.push(...drawLabel(ctx, t2, cx - t2.width / 2, outer.top + XY_LABEL_GAP * FW + maxH(y2Labels) + em(t2) + t2.height));
  } else {
    // Y axis titles above the frame (Y1 at its left edge, Y2 at its right edge).
    const titleTop = outer.top + XY_TITLE_GAP * H + yTitleH;
    if (t1) out.push(...drawLabel(ctx, t1, outer.left, titleTop));
    if (t2) out.push(...drawLabel(ctx, t2, outer.right - t2.width, titleTop));
  }

  if (table) out.push(...drawTable(l, table, tableSeries));
  if (legendShown) out.push(...drawLegend(ctx, opts, withData));
  return out;
}

// ---------------------------------------------------------------------------
// Frame and grid
// ---------------------------------------------------------------------------

/**
 * A grid line by 1402 byte 26: dotted = dashes of XY_DOT_LENGTH × pitch
 * every pitch from the start (the copies store each dash as a line), solid,
 * or none [C for the styles; I for the dash geometry].
 */
function gridLine(l: Layout, a: Point, b: Point, style: number, stroke: string | null): SceneElement[] {
  if (style === GRID_SOLID) return line([a, b], stroke, l.thin);
  if (style !== GRID_DOTTED || !stroke) return [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const pitch = XY_DOT_PITCH * l.ctx.page.shortSide;
  if (!(len > 0) || !(pitch > 0)) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const out: SceneElement[] = [];
  for (let s = 0; s < len - 1e-6; s += pitch) {
    const e = Math.min(len, s + XY_DOT_LENGTH * pitch);
    out.push(...line([{ x: a.x + ux * s, y: a.y + uy * s }, { x: a.x + ux * e, y: a.y + uy * e }], stroke, l.thin));
  }
  return out;
}

/** Tick marks on a vertical value axis at x (inward = +1 to the right), 2-D only. */
function drawTicks(l: Layout, sc: AxisScale, a: XyAxis | undefined, x: number, inward: number, t: Ticks, stroke: string | null): SceneElement[] {
  const out: SceneElement[] = [];
  const FW = l.frame.right - l.frame.left;
  const mark = (f: number, style: number, len: number) => {
    if (style !== TICK_IN && style !== TICK_OUT && style !== TICK_BOTH) return;
    const y = at(l, 0, f).y;
    const x0 = style === TICK_IN ? x : x - inward * len;
    const x1 = style === TICK_OUT ? x : x + inward * len;
    out.push(...line([{ x: x0, y }, { x: x1, y }], stroke, l.thin));
  };
  if (!sc.log && (t.minor === TICK_IN || t.minor === TICK_OUT || t.minor === TICK_BOTH)) {
    // Minor ticks every minor increment (blank: a fifth of the major step), majors included (XMINBOT) [I].
    const m = a?.minorIncrement ?? null;
    const step = m !== null && m > 0 ? m : sc.step / XY_MINOR_PER_MAJOR;
    const n = Math.floor((sc.max - sc.min) / step + 1e-6);
    if (n <= 1000) for (let i = 0; i <= n; i++) mark(valueAt(sc, sc.min + i * step), t.minor, XY_MINOR_TICK * FW);
  }
  for (const v of tickValues(sc)) mark(valueAt(sc, v), t.major, XY_MAJOR_TICK * FW);
  return out;
}

/**
 * Goal ranges (1402 f64 at 45 and 53, colour role byte 61): with both the
 * minimum and the maximum set, a box across the frame between the two
 * values on its axis, filled and outlined in the goal colour role, drawn
 * after the frame fill and before the grid lines and bars; with one bound
 * only, nothing (SPEC §5.5, "Goal range": XGOALB, XGOALMN, XGOALMX) [C].
 * Values outside the axis are clipped to the frame [I]. In 3-D the box is
 * drawn on the back wall (z = depth) [?, not tested].
 */
function drawGoalRanges(l: Layout, z: number): SceneElement[] {
  const out: SceneElement[] = [];
  const goal = (a: XyAxis | undefined, sc: AxisScale | null) => {
    if (!a || !sc) return;
    const lo = a.goalMin;
    const hi = a.goalMax;
    if (lo === null || hi === null || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
    const clip = (f: number) => Math.min(1, Math.max(0, f));
    const f0 = clip(valueAt(sc, Math.min(lo, hi)));
    const f1 = clip(valueAt(sc, Math.max(lo, hi)));
    if (!(f1 > f0)) return;
    const colour = l.ctx.color(a.goalColorRole);
    out.push(...rect(boxAt(l, 0, 1, f0, f1, z), colour, colour, l.thin));
  };
  goal(l.y1Axis, l.y1);
  if (l.y2) goal(l.y2Axis, l.y2);
  return out;
}

function drawFrame(l: Layout): SceneElement[] {
  const { ctx, outer, frame, depth: d, thin, y1, y2, opts } = l;
  const out: SceneElement[] = [];
  // Frame lines, grid and ticks in the 1404 outline role, the background in its fill role (XFROC, XFRFC),
  // none when 1405 is No (XFRSHF) [C].
  const stroke = ctx.color(opts.frameRole);
  const bkg = opts.frameFill ? ctx.color(opts.frameFillRole) : null;
  const ticks = (sc: AxisScale) => (sc.log ? logGrid(sc) : tickValues(sc)).map((v) => valueAt(sc, v));
  const gridStyle = (a: XyAxis | undefined) => a?.gridStyle ?? GRID_DOTTED;
  const grids: [number, number][] = [
    ...ticks(y1).map((f): [number, number] => [f, gridStyle(l.y1Axis)]),
    ...(y2 ? ticks(y2).map((f): [number, number] => [f, gridStyle(l.y2Axis)]) : []),
  ];
  if (d === 0) {
    const { left: L, right: R, top: T, bottom: B } = frame;
    const half = opts.frameStyle === FRAME_HALF;
    out.push(...rect(frame, bkg, null, thin));
    out.push(...drawGoalRanges(l, 0));
    // The category axis at the value 0 (or the axis minimum).
    const z = valueAt(y1, Math.min(Math.max(0, y1.min), y1.max));
    // Grid lines; a dotted line is not drawn under a frame edge (the copies leave out the top one unless
    // the edge is missing, XFRST) [C].
    for (const [f, st] of grids) {
      const edge = (f < 1e-9 || Math.abs(f - z) < 1e-9 || (!half && f > 1 - 1e-9)) && st === GRID_DOTTED;
      if (!edge) out.push(...gridLine(l, at(l, 0, f), at(l, 1, f), st, stroke));
    }
    if (!half) out.push(...line([{ x: L, y: T }, { x: R, y: T }], stroke, thin));
    out.push(...line([{ x: L, y: T }, { x: L, y: B }], stroke, thin));
    out.push(...line([{ x: R, y: B }, { x: L, y: B }], stroke, thin));
    if (!half) out.push(...line([{ x: R, y: T }, { x: R, y: B }], stroke, thin));
    out.push(...line([at(l, 0, z), at(l, 1, z)], stroke, thin));
    if (!opts.horizontal) {
      out.push(...drawTicks(l, y1, l.y1Axis, L, 1, l.leftTicks, stroke));
      if (y2) out.push(...drawTicks(l, y2, l.y2Axis, R, -1, l.rightTicks, stroke));
    }
    return out;
  }
  // 3-D: floor, left wall and back wall, their edges, then the grid on the back and left walls.
  const wall = bkg ?? null;
  const fL = { x: frame.left, y: frame.bottom };
  const fR = { x: frame.right, y: frame.bottom };
  const fT = { x: frame.left, y: frame.top };
  const bL = shift(fL, d);
  const bR = { x: outer.right, y: frame.bottom + d };
  const bT = { x: outer.left + d, y: outer.top };
  const bTR = { x: outer.right, y: outer.top };
  out.push(...polygon([bL, bR, fR, fL], wall, wall, thin));
  out.push(...polygon([bL, fL, fT, bT], wall, wall, thin));
  out.push(...rect({ left: bL.x, bottom: bL.y, right: bTR.x, top: bTR.y }, wall, wall, thin));
  out.push(...drawGoalRanges(l, d));
  out.push(...line([bT, bTR], stroke, thin));
  out.push(...line([fT, fL, bL, bT, fT], stroke, thin));
  out.push(...line([bTR, bR], stroke, thin));
  out.push(...line([fL, fR, bR, bL, fL], stroke, thin));
  for (const [f, st] of grids) {
    const a = at(l, 0, f);
    const b = shift(a, d);
    const c = shift(at(l, 1, f), d);
    out.push(...gridLine(l, b, c, st, stroke));
    out.push(...gridLine(l, a, b, st, stroke));
  }
  // The left floor edge; with one depth lane per series (3-D overlapped bars) the bars draw it lane by lane.
  if (l.lanes === 1) out.push(...line([bL, fL], stroke, thin));
  return out;
}

// ---------------------------------------------------------------------------
// Series drawing
// ---------------------------------------------------------------------------

/** Series drawn together: in 3-D each group has a depth lane of its own. */
interface Group {
  kind: "area" | "bars" | "line" | "hlc";
  series: XySeries[];
}

/**
 * Groups in drawing order, back to front [I]: in 2-D areas (last series
 * first), then bars, then lines and points; in 3-D lanes from the front:
 * lines and points (one each), bars (one lane, or one per series when
 * overlapped), areas (one each), drawn from the back lane forward
 * (GALD362, GALD322, GALD541).
 */
export function seriesGroups(series: XySeries[], opts: XyOptions): Group[] {
  const lines = series.filter((s) => !isBar(s) && !isArea(s) && !isHighLow(s)).map((s): Group => ({ kind: "line", series: [s] }));
  const hl = series.filter(isHighLow);
  const hlc: Group[] = hl.length ? [{ kind: "hlc", series: hl }] : [];
  // Bars on Y1 come first in a cluster, then those on Y2 (XS6Y2) [C].
  const bars = [...series.filter(isBar)].sort((a, b) => Number(a.axis === 2) - Number(b.axis === 2));
  const areas = series.filter(isArea);
  if (!opts.threeD) {
    return [
      ...[...areas].reverse().map((s): Group => ({ kind: "area", series: [s] })),
      ...(bars.length ? [{ kind: "bars" as const, series: bars }] : []),
      ...hlc,
      ...lines,
    ];
  }
  const barGroups: Group[] =
    opts.barMode === "overlap" && bars.length > 1 ? bars.map((s) => ({ kind: "bars", series: [s] })) : bars.length ? [{ kind: "bars", series: bars }] : [];
  const areaGroups: Group[] =
    opts.areaMode === "overlap" ? areas.map((s) => ({ kind: "area", series: [s] })) : areas.length ? [{ kind: "area", series: areas }] : [];
  const front = [...lines, ...hlc, ...barGroups, ...areaGroups];
  return front.reverse();
}

/** Area tops per series (stacked sums, or row shares for 100 % areas). */
function areaTops(l: Layout, areas: XySeries[]): Map<XySeries, number[]> {
  const { data, opts } = l;
  const rows = rowsOf(data);
  const val = (s: XySeries, r: number) => data.values.get(s.index)?.get(r);
  const stacked = opts.areaMode !== "overlap";
  const acc = rows.map(() => 0);
  const totals = rows.map((r) => areas.reduce((sum, s) => sum + Math.max(0, val(s, r) ?? 0), 0));
  const out = new Map<XySeries, number[]>();
  for (const s of areas) {
    const hi = rows.map((r, i) => {
      let v = val(s, r) ?? 0;
      if (opts.areaMode === "percent") v = totals[i]! > 0 ? (v / totals[i]!) * 100 : 0;
      return stacked ? acc[i]! + v : v;
    });
    if (stacked) hi.forEach((v, i) => (acc[i] = v));
    out.set(s, hi);
  }
  return out;
}

function drawSeries(l: Layout, series: XySeries[]): SceneElement[] {
  const { ctx, data, thin, depth } = l;
  const out: SceneElement[] = [];
  const scaleOf = (s: XySeries) => (s.axis === 2 && l.y2 ? l.y2 : l.y1);
  const val = (s: XySeries, r: number) => data.values.get(s.index)?.get(r);
  const rows = rowsOf(data);
  const outline = ctx.color(l.opts.outlineRole);
  const frameStroke = ctx.color(l.opts.frameRole);
  const groups = seriesGroups(series, { ...l.opts, threeD: depth > 0 });
  const tops = areaTops(l, series.filter(isArea));
  const lanes = l.lanes;
  const lane = depth / lanes;
  const base = valueAt(l.y1, Math.min(Math.max(l.y1.min, 0), l.y1.max));
  const mark = (t: number, z: number) => (depth > 0 ? line([shift(at(l, t, base), z + lane), shift(at(l, t, base), z)], frameStroke, thin) : []);

  if (depth > 0 && lanes > 1) {
    // Lane boundaries on the floor and left wall.
    for (let k = 1; k < lanes; k++) {
      const z = k * lane;
      out.push(...line([shift(at(l, 1, base), z), shift(at(l, 0, base), z), shift(at(l, 0, 1), z)], frameStroke, thin));
    }
  }
  groups.forEach((g, gi) => {
    const k = depth > 0 ? groups.length - 1 - gi : 0;
    const z = k * lane;
    if (depth > 0 && lanes > 1) out.push(...mark(0, z));
    if (g.kind === "bars") {
      out.push(...drawBars(l, g.series, outline, z, lane));
      return;
    }
    if (g.kind === "hlc") {
      out.push(...drawHighLow(l, g.series, outline));
      return;
    }
    // In 3-D a lane's areas and lines are XY bar depth (1408 f32 at 15) of the lane deep, centred in it.
    const p = l.opts.barDepth / 100;
    const z0 = z + ((1 - p) * lane) / 2;
    const dz = p * lane;
    if (g.kind === "area") {
      // Highest first; behind the first one only the right end faces of the others show (GALD551) [I].
      [...g.series].reverse().forEach((s, i) => {
        const sc = scaleOf(s);
        const look = fillLook(s.fillStyle, s.fillPattern, ctx.color(s.colorRole), outline);
        const fill = look.fill;
        const hi = tops.get(s)!;
        const pts = [at(l, rowAt(l, 0), base), ...rows.map((r, j) => at(l, rowAt(l, r), valueAt(sc, hi[j]!))), at(l, rowAt(l, rows.length - 1), base)];
        if (depth > 0) {
          for (let j = i === 0 ? 1 : pts.length - 1; j < pts.length; j++) {
            const a = shift(pts[j - 1]!, z0);
            const b = shift(pts[j]!, z0);
            out.push(...polygon([a, b, shift(b, dz), shift(a, dz), a], shade(fill, XY_3D_TOP_SHADE), look.outline, thin));
          }
        }
        out.push(...polygon(pts.map((q) => shift(q, z0)), fill, look.outline, thin));
      });
      out.push(...mark(1, z), ...mark(1, z));
      return;
    }
    const s = g.series[0]!;
    const sc = scaleOf(s);
    // Lines and points take their colour from 1406 byte 13 (GALD411: byte 9 = 21, drawn in 26) [I].
    const fill = ctx.color(s.colorRole2 || s.colorRole);
    const pts: Point[] = [];
    for (const r of rows) {
      const v = val(s, r);
      if (v !== undefined) pts.push(at(l, rowAt(l, r), valueAt(sc, v)));
    }
    if (isHighLow(s)) return;
    if (depth > 0 && s.type === "line") {
      out.push(...ribbon(l, (s.raw[10] ?? 1) === LINE_CURVE ? splinePoints(pts) : pts, fill, z0, z0 + dz));
      out.push(...mark(1, z), ...mark(1, z));
      return;
    }
    // 1406 byte 10: 1 straight, 2 with a trend line, 3 curve (a spline polyline) [I].
    const style = s.raw[10] ?? 1;
    if (s.type === "line") {
      if (style === LINE_CURVE) out.push(...line(splinePoints(pts), fill, thin));
      else if (style === LINE_TREND) out.push(...line(trendLine(l, s, sc), fill, thin));
      else out.push(...line(pts, fill, thin));
    }
    out.push(...line(pts, fill, thin, true));
  });
  return out;
}

/**
 * High/low/close series (1406 byte 2 = 4, 5, 6) [I], by 1408 byte 11: 1 a
 * box from low to high, 2 a band through all highs and back through the
 * lows, 3 an I bar (serifs at high and low). Width w = bar width % of half
 * the category slot; filled in the high series' colour, outlined in role
 * 32; the close is a tick w/2 long right of the mark, in the close series'
 * byte 13 colour (GALD611, GALD631, GALD661).
 */
function drawHighLow(l: Layout, series: XySeries[], outline: string | null): SceneElement[] {
  const { ctx, data, opts, thin } = l;
  const out: SceneElement[] = [];
  const high = series.find((s) => s.type === "high");
  const low = series.find((s) => s.type === "low");
  const close = series.find((s) => s.type === "close");
  if (!high || !low) return out;
  const sc = high.axis === 2 && l.y2 ? l.y2 : l.y1;
  const style = opts.highLowStyle;
  const fill = ctx.color(high.colorRole);
  const closeStroke = close ? ctx.color(close.colorRole2 || close.colorRole) : null;
  const slot = 1 / Math.max(1, l.rows);
  const w = ((opts.barWidth / 100) * slot) / 2;
  const v = (s: XySeries | undefined, r: number) => (s ? data.values.get(s.index)?.get(r) : undefined);
  const rows = rowsOf(data).filter((r) => v(high, r) !== undefined && v(low, r) !== undefined);
  if (style === HL_BAND) {
    const pts = [...rows.map((r) => at(l, rowAt(l, r), valueAt(sc, v(high, r)!))), ...[...rows].reverse().map((r) => at(l, rowAt(l, r), valueAt(sc, v(low, r)!)))];
    out.push(...polygon(pts, fill, outline, thin));
    return out;
  }
  for (const r of rows) {
    const t = rowAt(l, r);
    const fh = valueAt(sc, v(high, r)!);
    const fl = valueAt(sc, v(low, r)!);
    let right = t;
    if (style === HL_IBAR) {
      out.push(...line([at(l, t - w / 2, fh), at(l, t + w / 2, fh)], fill, thin));
      out.push(...line([at(l, t, fh), at(l, t, fl)], fill, thin));
      out.push(...line([at(l, t - w / 2, fl), at(l, t + w / 2, fl)], fill, thin));
    } else {
      out.push(...rect(boxAt(l, t - w / 2, t + w / 2, fl, fh), fill, outline, thin));
      right = t + w / 2;
    }
    const c = v(close, r);
    if (c !== undefined) out.push(...line([at(l, right, valueAt(sc, c)), at(l, right + w / 2, valueAt(sc, c))], closeStroke, thin));
  }
  return out;
}

const HL_BAND = 2;
const HL_IBAR = 3;

const AXIS_LOG = 2;
const NUMERIC_X = 13;
const LINE_TREND = 2;
const LINE_CURVE = 3;

/**
 * A cardinal spline through the points, XY_CURVE_STEPS samples per
 * segment: the copies of curve series (1406 byte 10 = 3) store such a
 * polyline (59 points for 8 data points in GALD421) [I].
 */
export function splinePoints(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]!];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 1; k <= XY_CURVE_STEPS; k++) {
      const t = k / XY_CURVE_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      // Cubic Hermite with tangents XY_CURVE_TENSION × (next − previous) / 2.
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const m = XY_CURVE_TENSION / 2;
      const f = (a: number, b: number, c: number, d: number) => h00 * b + h10 * m * (c - a) + h01 * c + h11 * m * (d - b);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

/** Least-squares line over the series' rows, from the first to the last row (GALD431) [I]. */
function trendLine(l: Layout, s: XySeries, sc: AxisScale): Point[] {
  const pts = [...(l.data.values.get(s.index) ?? new Map<number, number>())].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return [];
  const n = pts.length;
  const mx = pts.reduce((a, [r]) => a + r, 0) / n;
  const my = pts.reduce((a, [, v]) => a + v, 0) / n;
  const sxx = pts.reduce((a, [r]) => a + (r - mx) ** 2, 0);
  const sxy = pts.reduce((a, [r, v]) => a + (r - mx) * (v - my), 0);
  const k = sxx > 0 ? sxy / sxx : 0;
  const r0 = pts[0]![0];
  const r1 = pts[n - 1]![0];
  return [at(l, rowAt(l, r0), valueAt(sc, my + k * (r0 - mx))), at(l, rowAt(l, r1), valueAt(sc, my + k * (r1 - mx)))];
}

/** A 3-D line: one face per segment between depths z0 and z1, then both edges. */
function ribbon(l: Layout, pts: Point[], fill: string | null, z0: number, z1: number): SceneElement[] {
  const { ctx, thin } = l;
  const out: SceneElement[] = [];
  const frameStroke = ctx.color(l.opts.frameRole);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    // A segment rising more steeply than the 45° depth direction shows its underside: 0x112A 63 % (GALD362) [I].
    const under = l.opts.horizontal ? b.x - a.x > a.y - b.y : b.y - a.y > b.x - a.x;
    out.push(...polygon([shift(a, z0), shift(b, z0), shift(b, z1), shift(a, z1)], under ? shade(fill, XY_3D_TOP_SHADE) : fill, frameStroke, thin));
  }
  out.push(...line(pts.map((p) => shift(p, z0)), fill, thin));
  out.push(...line(pts.map((p) => shift(p, z1)), fill, thin));
  return out;
}

/** Bars of one group; in 3-D they stand in the depth lane starting at z, `lane` deep. */
function drawBars(l: Layout, bars: XySeries[], outline: string | null, z: number, lane: number): SceneElement[] {
  const { ctx, data, opts, thin, depth } = l;
  const out: SceneElement[] = [];
  const rows = rowsOf(data);
  const slot = 1 / Math.max(1, l.rows);
  const n = bars.length;
  const val = (s: XySeries, r: number) => data.values.get(s.index)?.get(r);
  const scaleOf = (s: XySeries) => (s.axis === 2 && l.y2 ? l.y2 : l.y1);
  const width = opts.barMode === "step" ? 1 : opts.barWidth / 100;
  const barZ = (lane * opts.barDepth) / 100;
  const zBar = z + (lane - barZ) / 2;
  const frameStroke = ctx.color(opts.frameRole);
  const base = valueAt(l.y1, Math.min(Math.max(l.y1.min, 0), l.y1.max));
  // In 3-D overlapped bars stand one behind the other (each in its own lane), so they do not overlap sideways.
  const overlapping = opts.barMode === "overlap" && !(depth > 0);

  const shape = (s: XySeries, t0: number, t1: number, f0: number, f1: number): SceneElement[] => {
    // Fill style Pattern or Both (1406 bytes 7, 8): fillStyle.ts [C for pattern 0].
    const look = fillLook(s.fillStyle, s.fillPattern, ctx.color(s.colorRole), outline);
    const fill = look.fill;
    const edge = look.outline;
    // On a numeric X axis a bar is a line at its X value (GALD371) [I].
    if (l.xScale) return line([at(l, (t0 + t1) / 2, f0), at(l, (t0 + t1) / 2, f1)], fill ?? edge, thin);
    const b = boxAt(l, t0, t1, f0, f1, depth > 0 ? zBar : 0);
    if (depth === 0) {
      // 2D style 2: a shadow box behind the bar, moved right by XY_SHADOW_OFFSET of its width and its far
      // end in by that share of its length, filled and outlined in role Shadow (XS2DST) [I].
      const shadow: SceneElement[] = [];
      if (opts.shadow) {
        const dt = XY_SHADOW_OFFSET * (t1 - t0);
        const sb = boxAt(l, t0 + dt, t1 + dt, f0, f1 - XY_SHADOW_OFFSET * (f1 - f0));
        const sc = ctx.color(ROLE.Shadow);
        shadow.push(...rect(sb, sc, sc, thin));
      }
      if (opts.barShape === "pyramid") return [...shadow, ...polygon([at(l, t0, f0), at(l, t1, f0), at(l, (t0 + t1) / 2, f1)], fill, edge, thin)];
      return [...shadow, ...rect(b, fill, edge, thin)];
    }
    const first = !l.drewFirstBar;
    l.drewFirstBar = true;
    return bar3d(b, barZ, opts.barShape, opts.horizontal, fill, edge, thin, first);
  };
  // Values at the bar ends (1410 byte 2 = 1): centred XY_LABEL_GAP × FH above a bar, or 2 × that right of a
  // horizontal bar (GALD319, GALD813) [I].
  const valueStyle = tableStyle(ctx, 14, ROLE.XLabel);
  const FH = l.frame.top - l.frame.bottom;
  // Only for series whose own data labels option (1406 byte 5) is Yes [I].
  const valueLabel = (s: XySeries, v: number, t0: number, t1: number, f1: number): SceneElement[] => {
    if (!opts.valueLabels || !s.dataLabels || depth > 0) return [];
    const lab = label(ctx, tableValue(v), valueStyle);
    const p = at(l, (t0 + t1) / 2, f1);
    if (opts.horizontal) return drawLabel(ctx, lab, p.x + 2 * XY_LABEL_GAP * FH, p.y + lab.height / 2);
    return drawLabel(ctx, lab, p.x - lab.width / 2, p.y + XY_LABEL_GAP * FH + lab.height);
  };
  // Floor marks at the category boundaries (3-D); the copies draw the last one twice.
  const mark = (r: number) => (depth > 0 ? line([shift(at(l, (r + 1) * slot, base), z + lane), shift(at(l, (r + 1) * slot, base), z)], frameStroke, thin) : []);

  for (const r of rows) {
    const c0 = l.xScale ? rowAt(l, r) : r * slot + ((1 - width) * slot) / 2;
    const cw = l.xScale ? 0 : width * slot;
    if (opts.barMode === "stacked" || opts.barMode === "percent") {
      const total = bars.reduce((sum, s) => sum + Math.max(0, val(s, r) ?? 0), 0);
      let acc = 0;
      for (const s of bars) {
        let v = val(s, r);
        if (v === undefined) continue;
        if (opts.barMode === "percent") v = total > 0 ? (v / total) * 100 : 0;
        const sc = scaleOf(s);
        out.push(...shape(s, c0, c0 + cw, valueAt(sc, acc), valueAt(sc, acc + v)));
        acc += v;
      }
    } else if (opts.barMode === "overlap" || n === 1) {
      const ov = overlapping ? opts.overlap / 100 : 1;
      const bw = cw / (1 + (n - 1) * (1 - ov));
      for (let i = n - 1; i >= 0; i--) {
        const s = bars[i]!;
        const v = val(s, r);
        if (v === undefined) continue;
        const sc = scaleOf(s);
        const t0 = c0 + i * bw * (1 - ov);
        out.push(...shape(s, t0, t0 + bw, valueAt(sc, Math.max(sc.min, 0)), valueAt(sc, v)));
        out.push(...valueLabel(s, v, t0, t0 + bw, valueAt(sc, v)));
      }
    } else {
      const bw = cw / n;
      bars.forEach((s, i) => {
        const v = val(s, r);
        if (v === undefined) return;
        const sc = scaleOf(s);
        out.push(...shape(s, c0 + i * bw, c0 + (i + 1) * bw, valueAt(sc, Math.max(sc.min, 0)), valueAt(sc, v)));
        out.push(...valueLabel(s, v, c0 + i * bw, c0 + (i + 1) * bw, valueAt(sc, v)));
      });
    }
    out.push(...mark(r));
  }
  out.push(...mark(rows.length - 1));
  return out;
}

/**
 * One 3-D bar on box `b` (its front face, already moved into its depth
 * lane), `c` deep: a 3-D box (0x1070 style 6), a pyramid (three faces), an
 * octagonal prism or a cylinder, as the copies draw them (shades from
 * 0x112A) [I].
 */
function bar3d(
  b: Box,
  c: number,
  barShape: BarShape,
  horizontal: boolean,
  fill: string | null,
  stroke: string | null,
  width: number,
  first: boolean,
): SceneElement[] {
  if (barShape === "bar" || horizontal) return box3d(b, c, fill, stroke, width);
  const h = c / 2;
  const cx = (b.left + b.right) / 2 + h;
  const rx = (b.right - b.left) / 2;
  const top = b.top + h;
  const base = b.bottom + h;
  if (barShape === "pyramid") {
    const apex = { x: cx, y: top };
    const [front, right, left] = XY_3D_PYRAMID_SHADES;
    return [
      ...polygon([{ x: b.left, y: b.bottom }, { x: b.right, y: b.bottom }, apex], shade(fill, front), stroke, width),
      ...polygon([{ x: b.right + c, y: b.bottom + c }, { x: b.right, y: b.bottom }, apex], shade(fill, right), stroke, width),
      // The left face only on the chart's first bar (as in GALD315 and GALD934) [I].
      ...(first ? polygon([{ x: b.left, y: b.bottom }, { x: b.left + c, y: b.bottom + c }, apex], shade(fill, left), stroke, width) : []),
    ];
  }
  if (barShape === "cylinder") {
    const ry = XY_3D_CYLINDER_RY * c;
    const cyl = toScene(cx, top);
    return [
      { kind: "band", cx: cyl.x, cy: cyl.y, rx, ry, startAngle: 180, endAngle: 360, depth: top - base, fill, stroke, strokeWidth: width },
      { kind: "ellipse", cx: cyl.x, cy: cyl.y, rx, ry, fill: shade(fill, XY_3D_CYLINDER_TOP_SHADE), stroke, strokeWidth: width },
    ];
  }
  // Octagon: a regular octagon in the x/z plane, z drawn obliquely (x + z, y + z).
  const t = Math.tan(Math.PI / 8);
  const zr = XY_3D_OCTAGON_Z * c;
  const ring: [number, number][] = [
    [rx, t * zr],
    [rx, -t * zr],
    [t * rx, -zr],
    [-t * rx, -zr],
    [-rx, -t * zr],
    [-rx, t * zr],
    [-t * rx, zr],
    [t * rx, zr],
  ];
  const at = (y: number, [x, z]: [number, number]): Point => ({ x: cx + x + z, y: y + z });
  const out: SceneElement[] = [];
  out.push(...polygon(ring.map((p) => at(top, p)), shade(fill, XY_3D_OCTAGON_TOP_SHADE), stroke, width));
  const front = ring.slice(0, 5);
  out.push(...polygon([...front.map((p) => at(top, p)), ...[...front].reverse().map((p) => at(base, p))], fill, stroke, width));
  for (const p of front.slice(1, 4)) out.push(...line([at(top, p), at(base, p)], stroke, width));
  return out;
}

// ---------------------------------------------------------------------------
// Data table
// ---------------------------------------------------------------------------

/**
 * A column legend lists the series bottom-up when the bar style is Stack or
 * 100 % and top-down otherwise, whatever the placement (SPEC §5.5, "Legend
 * order": XSTK, XSTKIN, XPCT1, XOVL, XOVLIN, XSTEP) [C]; a row legend always
 * runs left to right (XSTKL8). The data table follows the column legend [I].
 */
function listedBottomUp(opts: Pick<XyOptions, "barMode">): boolean {
  return opts.barMode === "stacked" || opts.barMode === "percent";
}

interface TableLayout {
  left: number;
  top: number;
  bottom: number;
  rowH: number;
  /** Row pitch: the table is (highest series number + 1) rows high, shared by the drawn series (GALD937, GALD945) [I]. */
  pitch: number;
  names: Label[];
  /** Left edge of the frame and of the first value column. */
  frameLeft: number;
  /** Left edge of the names. */
  nameLeft: number;
  /** Series swatches beside the names (when there is no legend). */
  swatches: boolean;
}

/**
 * Data table geometry, as 3.05 lays it out. With swatches (no legend;
 * XMLEGNO, XLEGNO) [C]: rows one label box high from XY_FRAME_BOTTOM_MARGIN × H
 * above the plot bottom; the box starts at the plot's left edge, the names
 * XY_TABLE_SWATCH_PAD_EM ems in, then XY_TABLE_SWATCH_PAD_AFTER_EM ems, the swatch and the
 * swatch gap up to the frame [I for the padding]. Without swatches
 * (XREV7, XDTGRID) [C]: the box starts at the plot's left edge, the names
 * XY_TABLE_PAD_EM ems in, the frame the same padding after the widest name
 * (its drawn advance). Table only (XDTONLY) [C]: the table fills the plot
 * area down to XY_TABLE_ONLY_BOTTOM × H, its rows sharing the height.
 */
function tableLayout(ctx: ChartSceneContext, series: XySeries[], plot: Box, H: number, swatches: boolean, only: boolean): TableLayout {
  const names = series.map((s) => label(ctx, s.name?.text ?? "", s.name ? styled(ctx, s.name) : tableStyle(ctx, 13, ROLE.XLabel)));
  const rowH = Math.max(...names.map((n) => n.height), lineBoxHeight(ctx, tableStyle(ctx, 14, ROLE.XLabel).size));
  const rows = series.length ? Math.max(...series.map((s) => s.index)) + 1 : 1;
  const bottom = plot.bottom + (only ? XY_TABLE_ONLY_BOTTOM : XY_FRAME_BOTTOM_MARGIN) * H;
  if (swatches && !only) {
    // 3.05 (SPEC §5.5, "Data table with swatches"): the box from the plot's left edge, the names
    // XY_TABLE_SWATCH_PAD_EM ems in, then the swatch column (XMLEGNO, XLEGNO) [C for the box, I for the pad].
    const nameW = Math.max(0, ...names.map((n) => drawnAdvance(ctx, n.text, n.style.fontKey, n.style.size)));
    const em = Math.max(0, ...names.map((n) => layoutEm(ctx, n.style.size)));
    const pad = XY_TABLE_SWATCH_PAD_EM * em;
    const frameLeft = plot.left + pad + nameW + XY_TABLE_SWATCH_PAD_AFTER_EM * em + (XY_LEGEND_SWATCH + XY_LEGEND_GAP) * rowH;
    const height = rows * rowH;
    return { left: plot.left, top: bottom + height, bottom, rowH, pitch: height / Math.max(1, series.length), names, frameLeft, nameLeft: plot.left + pad, swatches };
  }
  const nameW = Math.max(0, ...names.map((n) => drawnAdvance(ctx, n.text, n.style.fontKey, n.style.size)));
  const em = Math.max(0, ...names.map((n) => textSizeToUnits(n.style.size, ctx.page.shortSide)));
  const pad = XY_TABLE_PAD_EM * em;
  const top = only ? plot.top : bottom + rows * rowH;
  const pitch = (top - bottom) / Math.max(1, series.length);
  return { left: plot.left, top, bottom, rowH, pitch, names, frameLeft: plot.left + 2 * pad + nameW, nameLeft: plot.left + pad, swatches: false };
}

/** A value as the data table prints it. */
export function tableValue(v: number): string {
  return String(Number(v.toFixed(4)));
}

/**
 * The table's box, values, grid and names, the value columns running from
 * t.frameLeft to `right`. Grid lines (1410 byte 1): 1 vertical column lines,
 * 2 horizontal row lines; both with the line after the names (XDTGRID) [C].
 * Lines in the frame outline role (XFROC) [C].
 */
function tableBody(ctx: ChartSceneContext, opts: XyOptions, data: XyData, t: TableLayout, series: XySeries[], right: number, rows: number): SceneElement[] {
  const out: SceneElement[] = [];
  const thin = lineWidthFor(XY_LINE_STYLE);
  const stroke = ctx.color(opts.frameRole);
  // 3.05 leaves the table box unfilled, swatches or not (XREV7, XMLEGNO) [C].
  out.push(...rect({ left: t.left, right, top: t.top, bottom: t.bottom }, null, stroke, thin));
  const style = tableStyle(ctx, 14, ROLE.XLabel);
  const colW = (right - t.frameLeft) / Math.max(1, rows);
  const rowTop = (i: number) => t.top - i * t.pitch - (t.pitch - t.rowH) / 2;
  for (let r = 0; r < rows; r++) {
    const x0 = t.frameLeft + r * colW;
    series.forEach((s, i) => {
      const v = data.values.get(s.index)?.get(r);
      if (v === undefined) return;
      const lab = label(ctx, tableValue(v), style);
      out.push(...drawCentred(ctx, lab, x0 + colW / 2 - lab.width / 2, rowTop(i)));
    });
  }
  // Grid 3 and 4 (Both, None in menu order [I]) are not shown by any copy; drawn as 1 [?].
  if (opts.tableGrid === 2) {
    for (let i = 1; i <= series.length; i++) {
      const y = t.top - i * t.pitch;
      out.push(...line([{ x: t.left, y }, { x: right, y }], stroke, thin));
    }
  } else {
    for (let r = 0; r <= rows; r++) {
      const x = t.frameLeft + r * colW;
      out.push(...line([{ x, y: t.bottom }, { x, y: t.top }], stroke, thin));
    }
  }
  const outline = ctx.color(opts.outlineRole);
  series.forEach((s, i) => {
    const top = rowTop(i);
    const n = t.names[i]!;
    out.push(...drawLabel(ctx, n, t.nameLeft, top));
    if (!t.swatches) return;
    const sw = XY_LEGEND_SWATCH * t.rowH;
    const sl = t.frameLeft - XY_LEGEND_GAP * t.rowH - sw;
    const st = top - (t.rowH - sw) / 2;
    out.push(...swatchFor(ctx, opts, s, { left: sl, right: sl + sw, top: st, bottom: st - sw }, outline, thin));
  });
  out.push(...line([{ x: t.swatches ? t.left : t.frameLeft, y: t.bottom }, { x: t.swatches ? t.left : t.frameLeft, y: t.top }], stroke, thin));
  return out;
}

function drawTable(l: Layout, t: TableLayout, series: XySeries[]): SceneElement[] {
  return tableBody(l.ctx, l.opts, l.data, t, series, l.outer.right, l.rows);
}

function drawTableOnly(ctx: ChartSceneContext, opts: XyOptions, data: XyData, t: TableLayout, series: XySeries[], plot: Box): SceneElement[] {
  return tableBody(ctx, opts, data, t, series, plot.right, data.rowCount);
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/** A series' swatch in box `sb`: a box (bars, areas; a triangle for pyramids), else a line and its point. */
function swatchFor(ctx: ChartSceneContext, opts: XyOptions, s: XySeries, sb: Box, outline: string | null, thin: number): SceneElement[] {
  const fill = ctx.color(s.type === "bar" || s.type === "area" ? s.colorRole : s.colorRole2 || s.colorRole);
  const cx = (sb.left + sb.right) / 2;
  const cy = (sb.top + sb.bottom) / 2;
  if (s.type === "close") return line([{ x: cx, y: cy }, { x: sb.right, y: cy }], fill, thin);
  if ((s.type === "high" || s.type === "low") && opts.highLowStyle === HL_IBAR) {
    const f = ctx.color(s.colorRole);
    const q = (sb.right - sb.left) / 4;
    return [
      ...line([{ x: cx - q, y: sb.bottom }, { x: cx + q, y: sb.bottom }], f, thin),
      ...line([{ x: cx, y: sb.bottom }, { x: cx, y: sb.top }], f, thin),
      ...line([{ x: cx - q, y: sb.top }, { x: cx + q, y: sb.top }], f, thin),
    ];
  }
  if (s.type === "bar" || s.type === "area" || isHighLow(s) || (opts.threeD && s.type === "line")) {
    // Bar and area swatches take the series' fill style like its shapes (fillStyle.ts) [I].
    const look = s.type === "bar" || s.type === "area" ? fillLook(s.fillStyle, s.fillPattern, fill, outline) : { fill, outline };
    if (s.type === "bar" && opts.barShape === "pyramid") {
      return polygon([{ x: sb.left, y: sb.bottom }, { x: sb.right, y: sb.bottom }, { x: (sb.left + sb.right) / 2, y: sb.top }], look.fill, look.outline, thin);
    }
    return rect(sb, look.fill, look.outline, thin);
  }
  const parts: SceneElement[] = [];
  if (s.type === "line") parts.push(...line([{ x: sb.left, y: cy }, { x: sb.right, y: cy }], fill, thin), ...line([{ x: cx, y: cy }], fill, thin));
  parts.push(...line([{ x: cx, y: cy }], fill, thin, true));
  return parts;
}

/**
 * The legend in its 810 area (which the original sizes and places by
 * 1418 bytes 1 and 2, so a viewer needs no rule for those). Frame style 2
 * (Plain): a box in the 1418 fill and outline roles, items XY_LEGEND_MARGIN
 * in; style 1: no box, items flush left (XDTNO, XLEGOC) [I]. Items are
 * listed down the box, centred; across it when the box is too low for the
 * list. Every series with data has a row; hidden series leave theirs empty
 * (XS6SH) [C].
 */
function drawLegend(ctx: ChartSceneContext, opts: XyOptions, series: XySeries[]): SceneElement[] {
  const area = ctx.chart.areas.legend;
  if (!area) return [];
  const box = boxOf(area);
  const thin = lineWidthFor(XY_LINE_STYLE);
  const framed = opts.legendFrameStyle !== LEGEND_NO_FRAME;
  const out: SceneElement[] = framed ? [...rect(box, ctx.color(opts.legendFillRole), ctx.color(opts.legendOutlineRole), thin)] : [];
  const labels = series
    .filter((s) => s.name && s.name.text.trim())
    .map((s) => ({ s, l: label(ctx, s.name!.text, styled(ctx, s.name!)) }));
  if (!labels.length) return out;
  const h = Math.max(...labels.map((x) => x.l.height));
  const sw = XY_LEGEND_SWATCH * h;
  const gap = XY_LEGEND_GAP * h;
  const pitch = XY_LEGEND_PITCH * h;
  const height = labels.length * h + (labels.length - 1) * (pitch - h);
  // Across when the box is lower than the list (XDTNO, XS3D: a box exactly as high as two rows lists them down) [I].
  const across = labels.length > 1 && box.top - box.bottom < height - 1;
  const outline = ctx.color(opts.outlineRole);
  const swatch = (s: XySeries, left: number, top: number): SceneElement[] => {
    const sTop = top - XY_LEGEND_SWATCH_DROP * h;
    return swatchFor(ctx, opts, s, { left, right: left + sw, top: sTop, bottom: sTop - sw }, outline, thin);
  };
  if (across) {
    const shown = labels.filter((x) => x.s.show);
    const widths = shown.map((x) => sw + gap + x.l.width);
    const total = widths.reduce((a, b) => a + b, 0) + 2 * gap * (shown.length - 1);
    let x = (box.left + box.right) / 2 - total / 2;
    const top = (box.top + box.bottom) / 2 + h / 2;
    shown.forEach(({ s, l }, i) => {
      out.push(...swatch(s, x, top));
      out.push(...drawLabel(ctx, l, x + sw + gap, top));
      x += widths[i]! + 2 * gap;
    });
    return out;
  }
  const left = box.left + (framed ? XY_LEGEND_MARGIN * h : 0);
  let top = (box.top + box.bottom) / 2 + height / 2;
  const ordered = listedBottomUp(opts) ? [...labels].reverse() : labels;
  for (const { s, l } of ordered) {
    if (s.show) {
      out.push(...swatch(s, left, top));
      out.push(...drawLabel(ctx, l, left + sw + gap, top));
    }
    top -= pitch;
  }
  return out;
}
