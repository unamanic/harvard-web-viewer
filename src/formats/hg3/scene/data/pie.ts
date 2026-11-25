/**
 * Pie charts drawn from their data (task 16; SPEC §5.4, §5.6, §6.2).
 *
 * The layout reproduces the drawn copies the 10 sample pie charts store
 * (GALD211-291, PIETUT); the fitted values are in assumptions.ts ("Tasks
 * 16, 18"). In short:
 *
 * - Pies sit side by side in equal columns of the plot area, centred in
 *   their column and in the plot height left over by the pie titles (slot 5,
 *   one per pie, keyed by column), which sit centred under each pie at the
 *   bottom of the plot area.
 * - Flat pies: radius PIE_RADIUS × min(column width, height); 3-D pies: an
 *   ellipse rx = min(PIE_3D_RADIUS_OF_HEIGHT × height, PIE_3D_RADIUS_OF_WIDTH
 *   × column width), ry = PIE_3D_TILT × rx, depth PIE_3D_DEPTH × rx. A pie
 *   with an exploded slice shrinks (PIE_EXPLODED_SCALE), and the slice moves
 *   out by PIE_EXPLODE_DISTANCE × radius along its middle. Proportional pies
 *   scale with √total (largest pie full size).
 * - Slices start at PIE_START_DEGREES and go counter-clockwise, sweep =
 *   value / total × 360°, filled in their colour role and outlined in the
 *   1304 byte 5 role (Outlines). 3-D pies first draw the visible radial
 *   walls and front bands (shaded as the copies' 0x112A brightness), back to
 *   front, then the tops.
 * - Each slice gets a label ("name" over "NN%") at the end of a leader line
 *   from the rim to 1.1 × the radius along the slice's middle, placed by
 *   the direction (side, above/below or corner; PIE_LABEL_*).
 * - A pie whose 1310 byte 2 is 2 is drawn as a stacked column to the right
 *   of the previous pie, which turns so that its exploded slice faces it,
 *   with two connecting lines (GALD231, GALD261).
 */
import type { Point, SceneElement } from "../../../types";
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
  PIE_COLUMN_LABEL_SEPARATOR,
  PIE_COLUMN_WIDTH,
  PIE_EXPLODED_SCALE,
  PIE_EXPLODED_SCALE_3D,
  PIE_EXPLODE_DISTANCE,
  PIE_LABEL_ABOVE_DEGREES,
  PIE_LABEL_BELOW_DEGREES,
  PIE_LABEL_LEADER,
  PIE_LABEL_NAMES_OFF,
  PIE_LABEL_SIDE_DEGREES,
  PIE_LABEL_SIDE_GAP_EM,
  PIE_LABEL_STYLE_INDEX,
  PIE_LINE_STYLE,
  PIE_RADIUS,
  PIE_START_DEGREES,
  lineWidthFor,
  textSizeToUnits,
} from "../../assumptions";
import { type Pie, type PieData, type PieSlice, parsePieData } from "../../data/pie";
import type { FontKey } from "../../fontKey";
import { ROLE } from "../../palette";
import { Justification } from "../../text";
import type { ChartSceneContext } from "../context";
import { pieSlicePoints, shadeCss } from "../objectLayer";
import { areaToRect, toScene } from "../page";
import { type Box, type StyledText, boxOf, drawStack, lineBoxHeight, pageBox, stackRows, textWidth } from "./text";
import { styled } from "./textCharts";

/** Font key used when no style entry gives one (the resolver's default face). */
const NO_FONT: FontKey = { source: 0, number: 0, style: 0 };

const RAD = Math.PI / 180;
const cos = (deg: number) => Math.cos(deg * RAD);
const sin = (deg: number) => Math.sin(deg * RAD);

/** 1310 byte 2 value for a pie drawn as a stacked column [I]. */
export const PIE_STYLE_COLUMN = 2;

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

/** Slices that are drawn: finite and positive values (SPEC §7.1: negative values are skipped). */
export function drawnSlices(pie: Pie): PieSlice[] {
  return pie.slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
}

export function pieTotal(pie: Pie): number {
  return drawnSlices(pie).reduce((sum, s) => sum + s.value, 0);
}

export function isColumnPie(pie: Pie): boolean {
  return pie.options?.styleCode === PIE_STYLE_COLUMN;
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
  if (!(total > 0) || !slices[index]) return PIE_START_DEGREES;
  const before = slices.slice(0, index).reduce((sum, s) => sum + s.value, 0);
  const mid = ((before + slices[index]!.value / 2) / total) * 360;
  return (((360 - mid) % 360) + 360) % 360;
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
    let rx = threeD
      ? Math.min(PIE_3D_RADIUS_OF_HEIGHT * height, PIE_3D_RADIUS_OF_WIDTH * slotWidth)
      : PIE_RADIUS * Math.min(height, slotWidth);
    if (data.proportional && maxTotal > 0) rx *= Math.sqrt(pieTotal(pie) / maxTotal);
    if (drawnSlices(pie).some((s) => s.exploded)) rx *= threeD ? PIE_EXPLODED_SCALE_3D : PIE_EXPLODED_SCALE;
    rx = Math.trunc(rx);
    const geometry: PieGeometry = {
      cx: Math.floor(left + slotWidth / 2),
      cy: Math.floor(cy),
      rx,
      ry: threeD ? Math.trunc(PIE_3D_TILT * rx) : rx,
      depth: threeD ? Math.trunc(PIE_3D_DEPTH * rx) : 0,
      rotation: PIE_START_DEGREES,
    };
    return { pie, left, right: left + slotWidth, geometry };
  });
  // A pie followed by a column turns its connecting slice towards it.
  slots.forEach((slot, i) => {
    const next = slots[i + 1];
    if (next && isColumnPie(next.pie) && !isColumnPie(slot.pie)) {
      slot.geometry.rotation = rotationFacing(slot.pie, connectSliceIndex(slot.pie));
    }
  });
  return { slots, plot, bottom, titleHeight };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

interface PieStyle {
  outline: string | null;
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

/** 1304 byte `i` as a colour role, or `fallback` (byte 5: slice outlines; byte 6: column connector lines) [I]. */
function role1304(data: PieData, i: number, fallback: number): number {
  const v = data.raw1304 && data.raw1304.length > i ? data.raw1304[i]! : 0;
  return v > 0 ? v : fallback;
}

/** Percent text of a slice: rounded to a whole number. */
export function percentText(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Whether a pie's labels show the slice names (1310 byte 17 = 2: percentages only, GALD291's small pie) [I]. */
function showsNames(pie: Pie): boolean {
  const raw = pie.options?.raw;
  return !(raw && raw.length > 17 && raw[17] === PIE_LABEL_NAMES_OFF);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function path(points: Point[], fill: string | null, stroke: string | null, strokeWidth: number, closed = true): SceneElement {
  return { kind: "path", points: points.map((p) => toScene(p.x, p.y)), closed, fill, stroke, strokeWidth };
}

function sliceFill(ctx: ChartSceneContext, s: PieSlice, shade = 1): string | null {
  const fill = ctx.color(s.colorRole);
  return fill && shade < 1 ? shadeCss(fill, shade) : fill;
}

/** Top (or flat) face of a slice as a closed path. */
function sliceTop(ctx: ChartSceneContext, p: PlacedSlice, g: PieGeometry, style: PieStyle): SceneElement | null {
  const tenths = (deg: number) => ({ tenths: Math.round(deg * 10), degrees: deg });
  const points = pieSlicePoints({ cx: p.cx, cy: p.cy, rx: g.rx, ry: g.ry, start: tenths(p.start), end: tenths(p.end) });
  if (points.length === 0) return null;
  return path(points, sliceFill(ctx, p.slice), style.outline, style.strokeWidth);
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
  const d = Math.abs((((deg - 270) % 360) + 540) % 360 - 180);
  return d;
}

/** 3-D walls and bands of one pie, back to front. */
function sides3D(ctx: ChartSceneContext, placed: PlacedSlice[], g: PieGeometry, style: PieStyle): SceneElement[] {
  const order = [...placed].sort((a, b) => fromFront((b.start + b.end) / 2) - fromFront((a.start + a.end) / 2));
  const out: SceneElement[] = [];
  for (const p of order) {
    const wall = (a: number) => {
      const rim = { x: p.cx + g.rx * cos(a), y: p.cy + g.ry * sin(a) };
      const points = [{ x: p.cx, y: p.cy }, rim, { x: rim.x, y: rim.y - g.depth }, { x: p.cx, y: p.cy - g.depth }];
      out.push(path(points, sliceFill(ctx, p.slice, wallShade(a)), style.outline, style.strokeWidth));
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
        fill: sliceFill(ctx, p.slice, PIE_3D_BAND_SHADE),
        stroke: style.outline,
        strokeWidth: style.strokeWidth,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** A block of centred lines whose box has its top-left corner at (left, top). */
function labelBlock(ctx: ChartSceneContext, texts: string[], style: Omit<StyledText, "text">) {
  const rows: StyledText[] = texts.map((text) => ({ ...style, text }));
  const width = Math.max(0, ...rows.map((r) => textWidth(ctx, r.text, r.fontKey, r.size)));
  const height = stackRows(ctx, rows, 0, style.size).height;
  return { rows, width, height };
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/** Where a slice label's box goes for a leader ending at `end` in direction `mid` (page units). */
export function labelBoxPosition(
  mid: number,
  end: Point,
  width: number,
  height: number,
  gap: number,
): { left: number; top: number; mode: "side" | "vertical" | "corner" } {
  const s = sin(mid);
  const c = cos(mid);
  if (Math.abs(s) < sin(PIE_LABEL_SIDE_DEGREES)) {
    return { left: c > 0 ? end.x + gap : end.x - gap - width, top: end.y + height / 2, mode: "side" };
  }
  const top = s > 0 ? end.y + height : end.y;
  const vertical = s > 0 ? PIE_LABEL_ABOVE_DEGREES : PIE_LABEL_BELOW_DEGREES;
  if (Math.abs(c) < sin(vertical)) return { left: end.x - width / 2, top, mode: "vertical" };
  return { left: c > 0 ? end.x : end.x - width, top, mode: "corner" };
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
  const names = showsNames(pie);
  const gap = PIE_LABEL_SIDE_GAP_EM * textSizeToUnits(style.label.size, ctx.page.shortSide);
  const leaderStroke = ctx.color(style.label.color);
  for (const p of placed) {
    const mid = (p.start + p.end) / 2;
    const texts = [...(names && p.slice.label.trim() ? [p.slice.label.trim()] : []), percentText(p.slice.value / total)];
    const block = labelBlock(ctx, texts, style.label);
    const side = Math.abs(sin(mid)) < sin(PIE_LABEL_SIDE_DEGREES);
    // 3-D: leaders of front labels start at the bottom of the edge.
    const drop = g.depth > 0 && !side && sin(mid) < 0 ? g.depth : 0;
    const at = (k: number): Point => ({ x: p.cx + k * g.rx * cos(mid), y: p.cy + k * g.ry * sin(mid) - drop });
    const start = at(1);
    const end = at(PIE_LABEL_LEADER);
    const pos = labelBoxPosition(mid, end, block.width, block.height, gap);
    const left = clamp(pos.left, plot.left, plot.right - block.width);
    const top = clamp(pos.top, plot.bottom + block.height, plot.top);
    if (leaderStroke) out.push(path([start, end], null, leaderStroke, style.strokeWidth, false));
    const box: Box = { left, right: left + block.width, top, bottom: top - block.height };
    out.push(...drawStack(ctx, block.rows, box, top, style.label.size).elements);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stacked column (1310 byte 2 = 2)
// ---------------------------------------------------------------------------

function drawColumn(
  ctx: ChartSceneContext,
  data: PieData,
  slot: PieSlot,
  layout: PieLayout,
  left: PieSlot | undefined,
  style: PieStyle,
): SceneElement[] {
  const { pie } = slot;
  const slices = drawnSlices(pie);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!(total > 0)) return [];
  const threeD = data.threeD === true;
  const height = layout.plot.top - layout.bottom;
  const cy = (layout.plot.top + layout.bottom) / 2;
  const slotWidth = slot.right - slot.left;
  const x0 = slot.left + slotWidth / 2 - PIE_COLUMN_WIDTH * slotWidth;
  const width = (threeD ? PIE_COLUMN_3D_WIDTH : 1) * PIE_COLUMN_WIDTH * slotWidth;
  const x1 = x0 + width;
  const columnHeight = (threeD ? PIE_COLUMN_3D_HEIGHT : PIE_COLUMN_HEIGHT) * height;
  const y0 = threeD ? cy - PIE_COLUMN_3D_BOTTOM * height : cy - columnHeight / 2;
  const dd = threeD ? PIE_COLUMN_3D_DEPTH * width : 0;
  const out: SceneElement[] = [];
  const labels: SceneElement[] = [];
  const names = showsNames(pie);
  const gap = (threeD ? PIE_COLUMN_3D_LABEL_GAP_EM : PIE_COLUMN_LABEL_GAP_EM) * textSizeToUnits(style.label.size, ctx.page.shortSide);
  let y = y0;
  for (const s of slices) {
    const top = y + (s.value / total) * columnHeight;
    out.push({ kind: "rect", ...areaToRect({ x1: x0, y1: y, x2: x1, y2: top }), fill: sliceFill(ctx, s), stroke: style.outline, strokeWidth: style.strokeWidth });
    if (threeD) {
      const [, topShade, sideShade] = PIE_COLUMN_3D_SHADES;
      const lid = [{ x: x0, y: top }, { x: x1, y: top }, { x: x1 + dd, y: top + dd }, { x: x0 + dd, y: top + dd }];
      const wall = [{ x: x1, y: top }, { x: x1, y }, { x: x1 + dd, y: y + dd }, { x: x1 + dd, y: top + dd }];
      out.push(path(lid, sliceFill(ctx, s, topShade), style.outline, style.strokeWidth));
      out.push(path(wall, sliceFill(ctx, s, sideShade), style.outline, style.strokeWidth));
    }
    const text = names && s.label.trim() ? `${s.label.trim()}${PIE_COLUMN_LABEL_SEPARATOR}${percentText(s.value / total)}` : percentText(s.value / total);
    const block = labelBlock(ctx, [text], style.label);
    const labelTop = (y + top) / 2 + dd + block.height / 2;
    const lx = x1 + dd + gap;
    labels.push(...drawStack(ctx, block.rows, { left: lx, right: lx + block.width, top: labelTop, bottom: labelTop - block.height }, labelTop, style.label.size).elements);
    y = top;
  }
  // Lines from the facing slice of the pie on the left to the column's corners.
  const lineStroke = ctx.color(role1304(data, 6, ROLE.Lines));
  if (left && lineStroke) {
    const placed = placeSlices(left.pie, left.geometry);
    const p = placed[connectSliceIndex(left.pie)];
    if (p) {
      const g = left.geometry;
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
  const pies = data.pies.filter((p) => drawnSlices(p).length > 0 || (p.title && p.title.text.trim()));
  if (pies.length === 0) return [];
  for (const p of data.pies) {
    const skipped = p.slices.length - drawnSlices(p).length;
    if (skipped > 0) ctx.warn(`pie ${p.index}: ${skipped} slice(s) with a negative, zero or invalid value not drawn (SPEC §7.1)`);
  }
  const layout = layoutPies(ctx, data, pies);
  const outline = ctx.color(role1304(data, 5, ROLE.Outlines));
  const out: SceneElement[] = [];
  layout.slots.forEach((slot, i) => {
    const { pie, geometry: g } = slot;
    const style: PieStyle = { outline, strokeWidth: lineWidthFor(PIE_LINE_STYLE), label: labelStyle(ctx, pie) };
    const prev = layout.slots[i - 1];
    if (isColumnPie(pie) && prev && !isColumnPie(prev.pie)) {
      out.push(...drawColumn(ctx, data, slot, layout, prev, style));
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
  });
  return out;
}
