/**
 * Pie charts drawn from their data (task 16; SPEC §5.4, §5.5, §5.6, §6.2).
 *
 * Two sets of evidence, which disagree on some sizes (see pieSizing below):
 * the drawn copies of the 10 sample pie charts (GALD211-291, PIETUT; fitted
 * values in assumptions.ts, "Tasks 16, 18") and of the Harvard Graphics 3.05
 * test charts in samples/option-tests/pie (one option changed from PBASE per
 * file; values in this file). In short:
 *
 * - Pies whose 1310 Show pie is No are not drawn at all (PNOPIE drops the
 *   whole drawn group). The others sit side by side in equal columns of the
 *   plot area, centred in their column and in the plot height left over by
 *   the pie titles (slot 5, one per pie, keyed by column), which sit centred
 *   under each pie at the bottom of the plot area.
 * - Radius: a fraction of min(column width, height) (pieSizing), × √(pie
 *   size / 100) (1310 size is a percentage of area, PSIZE50), × √(total /
 *   largest total) for proportional pies, × a shrink factor when a slice is
 *   cut out; the cut slice moves out by PIE_EXPLODE_DISTANCE × the radius
 *   along its middle (PCUT2). 3-D pies: an ellipse ry = PIE_3D_TILT × rx,
 *   edge depth PIE_3D_DEPTH × rx (P3DSE2).
 * - Slices start at the 1310 starting angle (PANG45) and go
 *   counter-clockwise, sweep = value / total × 360°; sorted pies (1310 byte
 *   3) draw the largest first, each slice keeping its colour (PUNSSRT). They
 *   are filled in their colour role and outlined in the 1304 byte 5 role
 *   (POUTL). 3-D pies first draw the visible radial walls and front bands
 *   (shaded as the copies' 0x112A brightness), back to front, then the tops.
 * - Labels (pieLabels.ts for the text): a leader from the rim to
 *   PIE_LABEL_LEADER × the radius along the slice's middle (1310 slice
 *   pointer None: no line; Long: a horizontal tail, PPTRL), the block placed
 *   by the direction (labelBoxPosition); items placed Inside are centred at
 *   PIE_INSIDE_RADIUS of the radius (PVALIN, PPCTPI).
 * - Show as Column (1310 byte 2 = 2): stacked boxes, bottom to top in data
 *   order. Alone (PCOLUMN) it is centred in its column with leaders to its
 *   labels; as pie 2 of linked pies (1304 byte 2) it stands right of pie 1,
 *   which turns so that its cut slice faces it, with two connecting lines in
 *   the 1304 byte 6 role (GALD231, GALD261).
 * - The legend (1306) is drawn by pieLegend.ts.
 */
import type { Point, SceneElement } from "../../../../model/scene";
import {
  PIE_3D_BACK_WALL_SHADE,
  PIE_3D_BAND_SHADE,
  PIE_3D_DEPTH,
  PIE_3D_RADIUS_OF_HEIGHT,
  PIE_3D_RADIUS_OF_WIDTH,
  PIE_3D_TILT,
  PIE_3D_WALL_SHADE,
  PIE_COLUMN_3D_BOTTOM,
  PIE_COLUMN_3D_DEPTH,
  PIE_COLUMN_3D_HEIGHT,
  PIE_COLUMN_3D_LABEL_GAP_EM,
  PIE_COLUMN_3D_SHADES,
  PIE_COLUMN_3D_WIDTH,
  PIE_COLUMN_HEIGHT,
  PIE_COLUMN_LABEL_GAP_EM,
  PIE_COLUMN_WIDTH,
  PIE_EXPLODED_SCALE_3D,
  PIE_EXPLODE_DISTANCE,
  PIE_LABEL_LEADER,
  PIE_LABEL_SIDE_DEGREES,
  PIE_LABEL_SIDE_GAP_EM,
  PIE_LABEL_STYLE_INDEX,
  PIE_LINE_STYLE,
  PIE_START_DEGREES,
  lineWidthFor,
  textSizeToUnits,
} from "../../assumptions";
import { type Pie, type PieData, PieShowAs, type PieSlice, SlicePointer, parsePieData } from "../../data/pie";
import type { FontKey } from "../../../../fonts/fontKey";
import { ROLE } from "../../palette";
import { Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { pieSlicePoints } from "../objectLayer";
import { shadeCss } from "../../../../model/color";
import { areaToRect, toScene } from "../page";
import { DEFAULT_PERCENTS, DEFAULT_VALUES, type LabelOptions, outsideLineCount, percentOf, sliceLabelTexts } from "./pieLabels";
import { drawPieLegend } from "./pieLegend";
import { type Box, type StyledText, boxOf, drawStack, lineBoxHeight, pageBox, stackRows, textWidth } from "./text";
import { type FillLook, FillStyle, fillLook } from "./fillStyle";
import { styled } from "./textCharts";

/** Font key used when no style entry gives one (the resolver's default face). */
const NO_FONT: FontKey = { source: 0, number: 0, style: 0 };

const RAD = Math.PI / 180;
const cos = (deg: number) => Math.cos(deg * RAD);
const sin = (deg: number) => Math.sin(deg * RAD);

/** 1310 byte 2 value for a pie drawn as a stacked column (SPEC §5.4, PCOLUMN) [C]. */
export const PIE_STYLE_COLUMN = PieShowAs.Column;

// ---------------------------------------------------------------------------
// Constants from the HG 3.05 test charts (samples/option-tests/pie)
// ---------------------------------------------------------------------------

/**
 * Flat pie radius as Harvard Graphics 3.05 lays a pie out, on every page
 * size (SPEC §5.5, "Pie size"), as a fraction of min(h, column) by the
 * number of lines of the label block outside the pie [I]: 2 lines 0.34
 * (PBASE 7191 of 21153, PLEGL2 6353 of 18688, PPCT, PPCTPI; PMBASE on
 * 10 × 7.5 in), 1 line 0.40 (PNOLAB, PVALNO, PVALADJ, PVALIN: 8460 of 21153;
 * PMVADJ). No label at all is not tested; it uses the 1-line value [?].
 */
export const PIE_305_RADIUS_2_LINES = 0.34;
export const PIE_305_RADIUS_1_LINE = 0.4;
/**
 * 3-D: rx = 0.44 h with 2-line labels (P3DSE2: 9306 of 21153; PM3D on
 * 10 × 7.5 in) [I]; other line counts scale it like the flat radius, and
 * the width limit is the samples' 0.28 × column scaled by 0.44 / 0.42 [?].
 */
export const PIE_305_3D_RADIUS = 0.44;
/** A cut slice shrinks a flat pie to 0.7 (PCUT2: 5034 = 0.7 × 7191; PMCUT) [C]. */
export const PIE_305_EXPLODED_SCALE = 0.7;

/** Items placed Inside are centred at 2/3 of the radius along the slice middle (PVALIN 5639 of 8460, PPCTPI 4794 of 7191) [C]. */
export const PIE_INSIDE_RADIUS = 2 / 3;
/** Slice pointer Long: a horizontal tail 0.3 × the radius long after the leader, away from the pie (PPTRL 2156 of 7191) [C]. */
export const PIE_LONG_POINTER = 0.3;

/**
 * Standalone column (PCOLUMN): 0.25 × its column wide, centred in it; 0.75 h
 * tall centred on the pie centre. Each segment's label sits right of it at
 * its middle height, after a leader 0.1 × the column's width long and the
 * side gap [C, one test].
 */
export const PIE_SOLO_COLUMN_WIDTH = 0.25;
export const PIE_SOLO_COLUMN_LEADER = 0.1;

/**
 * Label box placement by the slice middle's direction a (degrees CCW, from
 * PBASE, PANG45, PUNS, PVALIN, P3DSE2 and the samples' labels that were not
 * moved off a neighbour) [I]:
 * - 333° ≤ a ≤ 18°: beside the leader end, to the right, centred vertically
 *   (333°, 339.3°, 342°, 351.4°, 0°, 18° are; 25.7°, 27°, 325.7° are not);
 * - 18° < a < 72°: box's bottom-left corner at the leader end (25.7° to 51.4°);
 * - 72° ≤ a < 108°: centred above it (72°, 76.8°, 85.7° are; 51.4°, 108° are not);
 * - 108° ≤ a < 162°: bottom-right corner at it (108°, 117°, 145.7°);
 * - 162° ≤ a < 198°: beside it, to the left, centred vertically (180° is;
 *   145.7°, 198° are not);
 * - 198° ≤ a ≤ 260°: top-right corner at it (198° to 257.2°);
 * - 260° < a < 280°: centred below it (GALD291's 276.4° is; 257.2° and
 *   282.9° are not; the samples' fit of SPEC task 16);
 * - 280° ≤ a < 333°: top-left corner at it (282.9° to 325.7°).
 * The bounds at 72°, 162°, 260° and 280° are only known to lie in the gaps
 * between these angles; above and below are not symmetric (72° is centred,
 * 108° is not).
 * Then moved into the plot area (GALD231, GALD271 hit its left edge).
 */
export const PIE_LABEL_SECTORS = { rightFrom: 333, rightTo: 18, upRight: 72, up: 108, upLeft: 162, left: 198, downLeft: 260, down: 280 } as const;

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

/** A pie placed on the page (page coordinates). */
export interface PieGeometry {
  cx: number;
  cy: number;
  /** Horizontal radius (the radius of a flat pie). */
  rx: number;
  /** Vertical radius (rx for a flat pie). */
  ry: number;
  /** Height of the 3-D edge; 0 for a flat pie. */
  depth: number;
  /** Angle of the first slice's start, degrees CCW. */
  rotation: number;
}

/** A slice with its angles (degrees CCW, end > start; may exceed 360 after rotation) and exploded centre. */
export interface PlacedSlice {
  slice: PieSlice;
  start: number;
  end: number;
  cx: number;
  cy: number;
}

/** Slices that are drawn: finite and positive values (SPEC §7.1: negative values are skipped), largest first when the pie is sorted. */
export function drawnSlices(pie: Pie): PieSlice[] {
  const slices = pie.slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  // Array.prototype.sort is stable: equal values keep data order.
  return pie.options?.sort ? [...slices].sort((a, b) => b.value - a.value) : slices;
}

export function pieTotal(pie: Pie): number {
  return drawnSlices(pie).reduce((sum, s) => sum + s.value, 0);
}

export function isColumnPie(pie: Pie): boolean {
  return pie.options?.showAs === PIE_STYLE_COLUMN;
}

/** 1310 Show pie (default Yes). */
export function isShownPie(pie: Pie): boolean {
  return pie.options?.show !== false;
}

/** 1310 starting angle, degrees CCW from 3 o'clock (default PIE_START_DEGREES). */
export function startAngle(pie: Pie): number {
  const a = pie.options?.startAngle;
  return a !== undefined && Number.isFinite(a) ? a : PIE_START_DEGREES;
}

/** Slice angles from values: value / total × 360°, from `rotation` counter-clockwise; exploded slices moved out. */
export function placeSlices(pie: Pie, g: PieGeometry): PlacedSlice[] {
  const slices = drawnSlices(pie);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!(total > 0)) return [];
  let at = g.rotation;
  return slices.map((slice) => {
    const sweep = (slice.value / total) * 360;
    const start = at;
    at += sweep;
    const mid = start + sweep / 2;
    const out = slice.exploded ? PIE_EXPLODE_DISTANCE : 0;
    return { slice, start, end: at, cx: g.cx + out * g.rx * cos(mid), cy: g.cy + out * g.ry * sin(mid) };
  });
}

/** The slice another pie's column connects to: the first exploded slice, else the first slice. */
function connectSliceIndex(pie: Pie): number {
  const i = drawnSlices(pie).findIndex((s) => s.exploded);
  return Math.max(0, i);
}

/** Rotation that centres slice `index` on 0° (the column side). */
function rotationFacing(pie: Pie, index: number): number {
  const slices = drawnSlices(pie);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!(total > 0) || !slices[index]) return startAngle(pie);
  const before = slices.slice(0, index).reduce((sum, s) => sum + s.value, 0);
  const mid = ((before + slices[index]!.value / 2) / total) * 360;
  return (((360 - mid) % 360) + 360) % 360;
}

/** Label options of a pie: 1310 byte 17, 1312 and 1314, with the 3.05 defaults for missing records. */
export function labelOptions(pie: Pie): LabelOptions {
  return { showLabels: pie.options?.showLabels !== false, values: pie.values ?? DEFAULT_VALUES, percents: pie.percents ?? DEFAULT_PERCENTS };
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

export interface PieSizing {
  /** Flat radius as a fraction of min(h, column). */
  flat: number;
  /** 3-D rx as a fraction of h and of the column width. */
  threeDOfHeight: number;
  threeDOfWidth: number;
  /** Radius factor of a pie with a cut slice. */
  exploded: number;
  exploded3D: number;
}

/**
 * Size fractions for a pie: the 3.05 shares on every page size (SPEC §5.5,
 * "Pie size" and "Older samples"). The 10 × 7.5 in gallery samples store
 * smaller pies (0.32, 0.42, 0.85: assumptions.ts PIE_RADIUS and the rest)
 * because an older build laid them out; 3.05 gives them these shares too
 * when it lays them out again, and they draw from their stored copy anyway.
 */
export function pieSizing(labelLines: number): PieSizing {
  const flat = labelLines >= 2 ? PIE_305_RADIUS_2_LINES : PIE_305_RADIUS_1_LINE;
  return {
    flat,
    threeDOfHeight: PIE_305_3D_RADIUS * (flat / PIE_305_RADIUS_2_LINES),
    threeDOfWidth: PIE_3D_RADIUS_OF_WIDTH * (PIE_305_3D_RADIUS / PIE_3D_RADIUS_OF_HEIGHT),
    exploded: PIE_305_EXPLODED_SCALE,
    exploded3D: PIE_EXPLODED_SCALE_3D,
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface PieSlot {
  pie: Pie;
  /** Column of the plot area the pie sits in. */
  left: number;
  right: number;
  geometry: PieGeometry;
  /** For a column: the pie it is linked to (pie 1 of linked pies), drawn left of it. */
  linkedTo?: PieSlot;
}

interface PieLayout {
  slots: PieSlot[];
  /** Plot area. */
  plot: Box;
  /** Bottom of the area the pies use (above the titles). */
  bottom: number;
  /** Height of the title row (0 without titles). */
  titleHeight: number;
}

/** Whether 1304 links pies 1 and 2 (a chart without 1304 links them, as before it was decoded). */
function linksPies(data: PieData): boolean {
  return data.style ? data.style.linkPies : true;
}

function layoutPies(ctx: ChartSceneContext, data: PieData, pies: Pie[]): PieLayout {
  const plot = ctx.chart.areas.plot ? boxOf(ctx.chart.areas.plot) : pageBox(ctx);
  const titleHeight = Math.max(0, ...pies.map((p) => (p.title && p.title.text.trim() ? lineBoxHeight(ctx, styled(ctx, p.title).size) : 0)));
  const bottom = plot.bottom + titleHeight;
  const height = plot.top - bottom;
  const cy = (plot.top + bottom) / 2;
  const n = Math.max(1, pies.length);
  const slotWidth = (plot.right - plot.left) / n;
  const threeD = data.threeD === true;
  const maxTotal = Math.max(0, ...pies.map(pieTotal));

  const slots = pies.map((pie, i): PieSlot => {
    const left = plot.left + i * slotWidth;
    const sizing = pieSizing(outsideLineCount(labelOptions(pie)));
    let rx = threeD ? Math.min(sizing.threeDOfHeight * height, sizing.threeDOfWidth * slotWidth) : sizing.flat * Math.min(height, slotWidth);
    const size = pie.options?.size;
    if (size !== undefined && Number.isFinite(size) && size > 0) rx *= Math.sqrt(size / 100);
    if (data.proportional && maxTotal > 0) rx *= Math.sqrt(pieTotal(pie) / maxTotal);
    if (drawnSlices(pie).some((s) => s.exploded)) rx *= threeD ? sizing.exploded3D : sizing.exploded;
    rx = Math.trunc(rx);
    const geometry: PieGeometry = {
      cx: Math.floor(left + slotWidth / 2),
      cy: Math.floor(cy),
      rx,
      ry: threeD ? Math.trunc(PIE_3D_TILT * rx) : rx,
      depth: threeD ? Math.trunc(PIE_3D_DEPTH * rx) : 0,
      rotation: startAngle(pie),
    };
    return { pie, left, right: left + slotWidth, geometry };
  });
  // Linked pies: pie 2 shown as a column stands next to pie 1, which turns its connecting slice towards it.
  if (linksPies(data)) {
    slots.forEach((slot, i) => {
      const next = slots[i + 1];
      if (next && isColumnPie(next.pie) && !isColumnPie(slot.pie)) {
        slot.geometry.rotation = rotationFacing(slot.pie, connectSliceIndex(slot.pie));
        next.linkedTo = slot;
      }
    });
  }
  return { slots, plot, bottom, titleHeight };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

interface PieStyle {
  outline: string | null;
  /** 1304 byte 4 (fillStyle.ts). */
  fillStyle: number;
  strokeWidth: number;
  label: Omit<StyledText, "text">;
}

/** Slice label style: 1308 entry PIE_LABEL_STYLE_INDEX + pie number (size 4, role XLabel when missing) [I]. */
function labelStyle(ctx: ChartSceneContext, pie: Pie): Omit<StyledText, "text"> {
  const table = ctx.chart.styleTables.get(1308);
  const entry = table?.[PIE_LABEL_STYLE_INDEX + pie.index] ?? table?.[PIE_LABEL_STYLE_INDEX];
  const usable = entry && entry.size > 0 ? entry : null;
  return {
    size: usable?.size ?? 4,
    color: usable?.colorRole || ROLE.XLabel,
    justification: Justification.Centre,
    fontKey: usable?.fontKey ?? NO_FONT,
  };
}

/** Percent text of a slice: rounded to a whole number. */
export function percentText(fraction: number): string {
  return percentOf(fraction, DEFAULT_PERCENTS);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function path(points: Point[], fill: string | null, stroke: string | null, strokeWidth: number, closed = true): SceneElement {
  return { kind: "path", points: points.map((p) => toScene(p.x, p.y)), closed, fill, stroke, strokeWidth };
}

const lookArgs = (l: FillLook): [string | null, string | null] => [l.fill, l.outline];
const bandLook = (l: FillLook): { fill: string | null; stroke: string | null } => ({ fill: l.fill, stroke: l.outline });

/** Fill and outline of a slice face by the 1304 fill style and the slice's pattern (fillStyle.ts), shaded for 3-D faces. */
function sliceLook(ctx: ChartSceneContext, s: PieSlice, style: PieStyle, shade = 1): FillLook {
  const look = fillLook(style.fillStyle, s.pattern, ctx.color(s.colorRole), style.outline);
  return look.fill && shade < 1 ? { ...look, fill: shadeCss(look.fill, shade) } : look;
}

/** Top (or flat) face of a slice as a closed path. */
function sliceTop(ctx: ChartSceneContext, p: PlacedSlice, g: PieGeometry, style: PieStyle): SceneElement | null {
  const tenths = (deg: number) => ({ tenths: Math.round(deg * 10), degrees: deg });
  const points = pieSlicePoints({ cx: p.cx, cy: p.cy, rx: g.rx, ry: g.ry, start: tenths(p.start), end: tenths(p.end) });
  if (points.length === 0) return null;
  return path(points, ...lookArgs(sliceLook(ctx, p.slice, style)), style.strokeWidth);
}

/**
 * Brightness of a radial wall at angle `a` (degrees, as placed): the
 * copies' 0x112A = trunc(PIE_3D_WALL_SHADE × |cos a|), × PIE_3D_BACK_WALL_SHADE
 * for walls whose angle lies strictly between 0° and 180° (unnormalised,
 * as the copies show) [I].
 */
export function wallShade(a: number): number {
  let percent = Math.trunc(PIE_3D_WALL_SHADE * Math.abs(cos(a)) + 1e-9);
  if (a > 0 && a < 180) percent = Math.trunc(percent * PIE_3D_BACK_WALL_SHADE + 1e-9);
  return percent / 100;
}

/** Parts of [start, end] that face the viewer (180° to 360°, modulo 360). */
function frontRanges(start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = Math.floor(start / 360) - 1; k <= Math.ceil(end / 360); k++) {
    const lo = Math.max(start, 180 + 360 * k);
    const hi = Math.min(end, 360 + 360 * k);
    if (hi - lo > 1e-6) out.push([lo, hi]);
  }
  return out;
}

/** Angular distance from the front (270°), 0 to 180. */
function fromFront(deg: number): number {
  return Math.abs((((deg - 270) % 360) + 540) % 360 - 180);
}

/** 3-D walls and bands of one pie, back to front. */
function sides3D(ctx: ChartSceneContext, placed: PlacedSlice[], g: PieGeometry, style: PieStyle): SceneElement[] {
  const order = [...placed].sort((a, b) => fromFront((b.start + b.end) / 2) - fromFront((a.start + a.end) / 2));
  const out: SceneElement[] = [];
  for (const p of order) {
    const wall = (a: number) => {
      const rim = { x: p.cx + g.rx * cos(a), y: p.cy + g.ry * sin(a) };
      const points = [{ x: p.cx, y: p.cy }, rim, { x: rim.x, y: rim.y - g.depth }, { x: p.cx, y: p.cy - g.depth }];
      out.push(path(points, ...lookArgs(sliceLook(ctx, p.slice, style, wallShade(a))), style.strokeWidth));
    };
    // A start wall faces the viewer on the right half, an end wall on the left half.
    if (cos(p.start) > 1e-9) wall(p.start);
    if (cos(p.end) < -1e-9) wall(p.end);
    for (const [lo, hi] of frontRanges(p.start, p.end)) {
      const c = toScene(p.cx, p.cy);
      out.push({
        kind: "band",
        cx: c.x,
        cy: c.y,
        rx: g.rx,
        ry: g.ry,
        startAngle: lo,
        endAngle: hi,
        depth: g.depth,
        ...bandLook(sliceLook(ctx, p.slice, style, PIE_3D_BAND_SHADE)),
        strokeWidth: style.strokeWidth,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** A block of centred lines. */
function labelBlock(ctx: ChartSceneContext, texts: string[], style: Omit<StyledText, "text">) {
  const rows: StyledText[] = texts.map((text) => ({ ...style, text }));
  const width = Math.max(0, ...rows.map((r) => textWidth(ctx, r.text, r.fontKey, r.size)));
  const height = stackRows(ctx, rows, 0, style.size).height;
  return { rows, width, height };
}

function drawBlock(ctx: ChartSceneContext, block: ReturnType<typeof labelBlock>, left: number, top: number, size: number): SceneElement[] {
  const box: Box = { left, right: left + block.width, top, bottom: top - block.height };
  return drawStack(ctx, block.rows, box, top, size).elements;
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Where a slice label's box goes for a leader ending at `end` in direction `mid` (page units; PIE_LABEL_SECTORS). */
export function labelBoxPosition(
  mid: number,
  end: Point,
  width: number,
  height: number,
  gap: number,
): { left: number; top: number; mode: "side" | "vertical" | "corner" } {
  const a = norm360(mid);
  const S = PIE_LABEL_SECTORS;
  const eps = 1e-6;
  if (a >= S.rightFrom - eps || a <= S.rightTo + eps) return { left: end.x + gap, top: end.y + height / 2, mode: "side" };
  if (a < S.upRight - eps) return { left: end.x, top: end.y + height, mode: "corner" };
  if (a < S.up - eps) return { left: end.x - width / 2, top: end.y + height, mode: "vertical" };
  if (a < S.upLeft - eps) return { left: end.x - width, top: end.y + height, mode: "corner" };
  if (a < S.left - eps) return { left: end.x - gap - width, top: end.y + height / 2, mode: "side" };
  if (a <= S.downLeft + eps) return { left: end.x - width, top: end.y, mode: "corner" };
  if (a < S.down - eps) return { left: end.x - width / 2, top: end.y, mode: "vertical" };
  return { left: end.x, top: end.y, mode: "corner" };
}

function sliceLabels(
  ctx: ChartSceneContext,
  pie: Pie,
  placed: PlacedSlice[],
  g: PieGeometry,
  plot: Box,
  style: PieStyle,
): SceneElement[] {
  const out: SceneElement[] = [];
  const total = placed.reduce((sum, p) => sum + p.slice.value, 0);
  const options = labelOptions(pie);
  const pointer = pie.options?.pointer ?? SlicePointer.Short;
  const gap = PIE_LABEL_SIDE_GAP_EM * textSizeToUnits(style.label.size, ctx.page.shortSide);
  const leaderStroke = pointer === SlicePointer.None ? null : ctx.color(style.label.color);
  for (const p of placed) {
    const mid = (p.start + p.end) / 2;
    const texts = sliceLabelTexts(p.slice.label, p.slice.value, p.slice.value / total, options);
    if (texts.inside) {
      const block = labelBlock(ctx, [texts.inside], style.label);
      const c = { x: p.cx + PIE_INSIDE_RADIUS * g.rx * cos(mid), y: p.cy + PIE_INSIDE_RADIUS * g.ry * sin(mid) };
      out.push(...drawBlock(ctx, block, c.x - block.width / 2, c.y + block.height / 2, style.label.size));
    }
    if (texts.outside.length === 0) continue;
    const block = labelBlock(ctx, texts.outside, style.label);
    // 3-D: leaders of front labels start at the bottom of the edge.
    const side = Math.abs(sin(mid)) < sin(PIE_LABEL_SIDE_DEGREES);
    const drop = g.depth > 0 && !side && sin(mid) < 0 ? g.depth : 0;
    const at = (k: number): Point => ({ x: p.cx + k * g.rx * cos(mid), y: p.cy + k * g.ry * sin(mid) - drop });
    const leader = [at(1), at(PIE_LABEL_LEADER)];
    let pos: { left: number; top: number };
    if (pointer === SlicePointer.Long) {
      const end = leader[1]!;
      const dir = cos(mid) >= 0 ? 1 : -1;
      const tail = { x: end.x + dir * PIE_LONG_POINTER * g.rx, y: end.y };
      leader.push(tail);
      pos = { left: dir > 0 ? tail.x + gap : tail.x - gap - block.width, top: tail.y + block.height / 2 };
    } else {
      pos = labelBoxPosition(mid, leader[1]!, block.width, block.height, gap);
    }
    const left = clamp(pos.left, plot.left, plot.right - block.width);
    const top = clamp(pos.top, plot.bottom + block.height, plot.top);
    if (leaderStroke) out.push(path(leader, null, leaderStroke, style.strokeWidth, false));
    out.push(...drawBlock(ctx, block, left, top, style.label.size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stacked column (1310 byte 2 = 2)
// ---------------------------------------------------------------------------

function drawColumn(ctx: ChartSceneContext, data: PieData, slot: PieSlot, layout: PieLayout, style: PieStyle): SceneElement[] {
  const { pie } = slot;
  const slices = drawnSlices(pie);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!(total > 0)) return [];
  const linked = slot.linkedTo;
  const threeD = data.threeD === true;
  const height = layout.plot.top - layout.bottom;
  const cy = (layout.plot.top + layout.bottom) / 2;
  const slotWidth = slot.right - slot.left;
  const centre = slot.left + slotWidth / 2;
  // Linked: from a quarter column left of the centre to the centre (GALD231); alone: centred (PCOLUMN).
  const baseWidth = linked ? PIE_COLUMN_WIDTH * slotWidth : PIE_SOLO_COLUMN_WIDTH * slotWidth;
  const x0 = linked ? centre - baseWidth : centre - baseWidth / 2;
  const width = (threeD ? PIE_COLUMN_3D_WIDTH : 1) * baseWidth;
  const x1 = x0 + width;
  const columnHeight = (threeD ? PIE_COLUMN_3D_HEIGHT : PIE_COLUMN_HEIGHT) * height;
  const y0 = threeD ? cy - PIE_COLUMN_3D_BOTTOM * height : cy - columnHeight / 2;
  const dd = threeD ? PIE_COLUMN_3D_DEPTH * width : 0;
  const out: SceneElement[] = [];
  const labels: SceneElement[] = [];
  const options = labelOptions(pie);
  const em = textSizeToUnits(style.label.size, ctx.page.shortSide);
  const linkedGap = (threeD ? PIE_COLUMN_3D_LABEL_GAP_EM : PIE_COLUMN_LABEL_GAP_EM) * em;
  const leaderStroke = pie.options?.pointer === SlicePointer.None ? null : ctx.color(style.label.color);
  let y = y0;
  for (const s of slices) {
    const top = y + (s.value / total) * columnHeight;
    out.push({ kind: "rect", ...areaToRect({ x1: x0, y1: y, x2: x1, y2: top }), ...bandLook(sliceLook(ctx, s, style)), strokeWidth: style.strokeWidth });
    if (threeD) {
      const [, topShade, sideShade] = PIE_COLUMN_3D_SHADES;
      const lid = [{ x: x0, y: top }, { x: x1, y: top }, { x: x1 + dd, y: top + dd }, { x: x0 + dd, y: top + dd }];
      const wall = [{ x: x1, y: top }, { x: x1, y }, { x: x1 + dd, y: y + dd }, { x: x1 + dd, y: top + dd }];
      out.push(path(lid, ...lookArgs(sliceLook(ctx, s, style, topShade)), style.strokeWidth));
      out.push(path(wall, ...lookArgs(sliceLook(ctx, s, style, sideShade)), style.strokeWidth));
    }
    const texts = sliceLabelTexts(s.label, s.value, s.value / total, options);
    const lines = [...texts.outside, ...(texts.inside ? [texts.inside] : [])];
    if (lines.length) {
      const block = labelBlock(ctx, lines, style.label);
      const midY = (y + top) / 2 + dd;
      let lx: number;
      if (linked) {
        lx = x1 + dd + linkedGap;
      } else {
        const leaderEnd = x1 + dd + PIE_SOLO_COLUMN_LEADER * width;
        if (leaderStroke) labels.push(path([{ x: x1 + dd, y: midY }, { x: leaderEnd, y: midY }], null, leaderStroke, style.strokeWidth, false));
        lx = leaderEnd + PIE_LABEL_SIDE_GAP_EM * em;
      }
      labels.push(...drawBlock(ctx, block, lx, midY + block.height / 2, style.label.size));
    }
    y = top;
  }
  // Lines from the facing slice of the linked pie to the column's corners.
  const lineStroke = ctx.color(data.style?.linkLineRole || ROLE.Lines);
  if (linked && lineStroke) {
    const placed = placeSlices(linked.pie, linked.geometry);
    const p = placed[connectSliceIndex(linked.pie)];
    if (p) {
      const g = linked.geometry;
      const rim = (a: number): Point => ({ x: p.cx + g.rx * cos(a), y: p.cy + g.ry * sin(a) });
      out.push(path([rim(p.end), { x: x0, y }], null, lineStroke, style.strokeWidth, false));
      out.push(path([rim(p.start), { x: x0, y: y0 }], null, lineStroke, style.strokeWidth, false));
    }
  }
  return [...out, ...labels];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function drawPieChart(ctx: ChartSceneContext): SceneElement[] {
  const data = parsePieData(ctx.chart, []);
  const pies = data.pies.filter((p) => isShownPie(p) && (drawnSlices(p).length > 0 || (p.title && p.title.text.trim())));
  for (const p of data.pies) {
    const skipped = p.slices.length - drawnSlices(p).length;
    if (skipped > 0) ctx.warn(`pie ${p.index}: ${skipped} slice(s) with a negative, zero or invalid value not drawn (SPEC §7.1)`);
  }
  const legendPie = data.pies.find((p) => p.slices.length > 0);
  const legend = drawPieLegend(ctx, data.legend, legendPie ? legendPie.slices.filter((s) => Number.isFinite(s.value) && s.value > 0) : []);
  if (pies.length === 0) return legend;
  const layout = layoutPies(ctx, data, pies);
  const outline = ctx.color(data.style?.outlineRole || ROLE.Outlines);
  const out: SceneElement[] = [];
  for (const slot of layout.slots) {
    const { pie, geometry: g } = slot;
    const style: PieStyle = { outline, fillStyle: data.style?.fill ?? FillStyle.Color, strokeWidth: lineWidthFor(PIE_LINE_STYLE), label: labelStyle(ctx, pie) };
    if (isColumnPie(pie)) {
      out.push(...drawColumn(ctx, data, slot, layout, style));
    } else {
      const placed = placeSlices(pie, g);
      if (g.depth > 0) out.push(...sides3D(ctx, placed, g, style));
      for (const p of placed) {
        const top = sliceTop(ctx, p, g, style);
        if (top) out.push(top);
      }
      out.push(...sliceLabels(ctx, pie, placed, g, layout.plot, style));
    }
    if (pie.title && pie.title.text.trim()) {
      // Its box (as wide as the text) is centred under the pie; the line keeps its justification in the box.
      const t = { ...styled(ctx, pie.title), text: pie.title.text.trim() };
      const w = textWidth(ctx, t.text, t.fontKey, t.size);
      const top = layout.bottom;
      const { elements } = drawStack(ctx, [t], { left: g.cx - w / 2, right: g.cx + w / 2, top, bottom: top - layout.titleHeight }, top);
      out.push(...elements);
    }
  }
  return [...out, ...legend];
}
