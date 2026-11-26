/**
 * Shared pieces of the XY layout (xy.ts): the 3.05 rules, series helpers,
 * text labels, drawing helpers, the frame layout and tick sizes.
 */
import type { FontKey } from "../../../../fonts/fontKey";
import type { Point, SceneElement } from "../../../../model/scene";
import { BOX_3D_SIDE_SHADE, BOX_3D_TOP_SHADE, XY_TEXT_WIDTH_STEP } from "../../assumptions";
import type { XyAxis, XyData, XySeries } from "../../data/xy";
import { Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { shadeCss } from "../objectLayer";
import { toScene } from "../page";
import { baselineBelow, type Box, drawnAdvance, lineBoxHeight, type StyledText, textElement } from "./text";
import type { XyOptions } from "./xyOptions";
import type { AxisScale } from "./xyScale";

const NO_FONT: FontKey = { source: 0, number: 0, style: 0 };

// ---------------------------------------------------------------------------
// Rules from the 3.05 test charts (samples/option-tests/xy), each checked
// against the chart's own drawn copy. Page units; W, H = plot area size,
// FW = frame width.
// ---------------------------------------------------------------------------

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
export const GRID_DOTTED = 1;
export const GRID_SOLID = 2;
export const TICK_IN = 1;
export const TICK_OUT = 2;
export const TICK_BOTH = 3;
/** 1404 byte 0 = 2: only the left and bottom frame edges (XFRST) [I]. */
export const FRAME_HALF = 2;
/** 1418 byte 3 = 1: legend without a box, items flush left (XDTNO, XLEGOC) [I]. */
export const LEGEND_NO_FRAME = 1;

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export function rowsOf(data: XyData): number[] {
  return Array.from({ length: data.rowCount }, (_, i) => i);
}

export const isBar = (s: XySeries) => s.type === "bar";
export const isArea = (s: XySeries) => s.type === "area";
export const isHighLow = (s: XySeries) => s.type === "high" || s.type === "low" || s.type === "close";

/** Data min and max of the series on one axis, with stacking. */
export function dataRange(data: XyData, opts: XyOptions, series: XySeries[]): { min: number; max: number; percent: boolean } {
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
export function tableStyle(ctx: ChartSceneContext, index: number, role: number): Omit<StyledText, "text"> {
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

export interface Label {
  text: string;
  style: Omit<StyledText, "text">;
  width: number;
  height: number;
}

export function label(ctx: ChartSceneContext, text: string, style: Omit<StyledText, "text">): Label {
  const t = text.trim();
  return { text: t, style, width: xyTextWidth(ctx, t, style.fontKey, style.size), height: lineBoxHeight(ctx, style.size) };
}

/** Draw a label centred in a box of its width whose top-left corner is (left, top) (text runs justified centre in the copies). */
export function drawCentred(ctx: ChartSceneContext, l: Label, left: number, top: number): SceneElement[] {
  const el = textElement(ctx, { ...l.style, text: l.text }, "middle", left + l.width / 2, baselineBelow(ctx, top, l.style.size));
  return el ? [el] : [];
}

/** Draw a label whose box has its top-left corner at (left, top). */
export function drawLabel(ctx: ChartSceneContext, l: Label, left: number, top: number): SceneElement[] {
  const el = textElement(ctx, { ...l.style, text: l.text }, "start", left, baselineBelow(ctx, top, l.style.size));
  return el ? [el] : [];
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

export function line(points: Point[], stroke: string | null, width: number, smooth = false): SceneElement[] {
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

export function polygon(points: Point[], fill: string | null, stroke: string | null, width: number): SceneElement[] {
  if (!fill && !stroke) return [];
  return [{ kind: "path", points: points.map((p) => toScene(p.x, p.y)), closed: true, fill, stroke, strokeWidth: width }];
}

export function rect(b: Box, fill: string | null, stroke: string | null, width: number): SceneElement[] {
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

export const shade = (fill: string | null, k: number) => (fill && k < 1 ? shadeCss(fill, k) : fill);

/** A 3-D box as the copies store it (0x1070 style 6, depth c): top and right faces, then the front (as objectLayer draws it). */
export function box3d(b: Box, c: number, fill: string | null, stroke: string | null, width: number): SceneElement[] {
  const { left, right, top, bottom } = b;
  return [
    ...polygon([{ x: left, y: top }, { x: right, y: top }, { x: right + c, y: top + c }, { x: left + c, y: top + c }], shade(fill, BOX_3D_TOP_SHADE), stroke, width),
    ...polygon([{ x: right, y: bottom }, { x: right + c, y: bottom + c }, { x: right + c, y: top + c }, { x: right, y: top }], shade(fill, BOX_3D_SIDE_SHADE), stroke, width),
    ...rect(b, fill, stroke, width),
  ];
}

export const shift = (p: Point, z: number): Point => ({ x: p.x + z, y: p.y + z });

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Layout {
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
export function rowAt(l: Layout, r: number): number {
  if (l.xScale) return valueAt(l.xScale, l.xNumbers.get(r) ?? l.xScale.min);
  if (l.slots) return (r + 0.5) / Math.max(1, l.rows);
  return l.rows > 1 ? r / (l.rows - 1) : 0.5;
}

export function valueAt(s: AxisScale, v: number): number {
  if (s.log) return v > 0 ? (Math.log10(v) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min)) : 0;
  return (v - s.min) / (s.max - s.min);
}

/** Page point on the front face at category fraction t and value fraction f. */
export function at(l: Layout, t: number, f: number): Point {
  const F = l.frame;
  if (l.opts.horizontal) return { x: F.left + f * (F.right - F.left), y: F.top - t * (F.top - F.bottom) };
  return { x: F.left + t * (F.right - F.left), y: F.bottom + f * (F.top - F.bottom) };
}

export function boxAt(l: Layout, t0: number, t1: number, f0: number, f1: number, z = 0): Box {
  const a = shift(at(l, t0, f0), z);
  const b = shift(at(l, t1, f1), z);
  return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), bottom: Math.min(a.y, b.y), top: Math.max(a.y, b.y) };
}

export const axisOf = (data: XyData, index: number): XyAxis | undefined => data.axes.find((a) => a.index === index);

/** Tick marks along one value axis edge. */
export interface Ticks {
  major: number;
  minor: number;
  /** Extra room the labels need outside the edge (outward ticks). */
  out: number;
}

export function ticksOf(a: XyAxis | undefined, FW: number): Ticks {
  const outward = (st: number | undefined, len: number) => (st === TICK_OUT || st === TICK_BOTH ? len : 0);
  return {
    major: a?.majorTicks ?? 4,
    minor: a?.minorTicks ?? 4,
    out: Math.max(outward(a?.majorTicks, XY_MAJOR_TICK * FW), outward(a?.minorTicks, XY_MINOR_TICK * FW)),
  };
}

export const HL_BAND = 2;
export const HL_IBAR = 3;

export const AXIS_LOG = 2;
export const NUMERIC_X = 13;
export const LINE_TREND = 2;
export const LINE_CURVE = 3;
