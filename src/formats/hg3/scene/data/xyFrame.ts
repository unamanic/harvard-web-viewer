/**
 * The XY frame: its fill and edges, grid lines, tick marks and goal ranges.
 */
import type { Point, SceneElement } from "../../../../model/scene";
import type { XyAxis } from "../../data/xy";
import {
  at,
  boxAt,
  FRAME_HALF,
  GRID_DOTTED,
  GRID_SOLID,
  type Layout,
  line,
  polygon,
  rect,
  shift,
  TICK_BOTH,
  TICK_IN,
  TICK_OUT,
  type Ticks,
  valueAt,
  XY_DOT_LENGTH,
  XY_DOT_PITCH,
  XY_MAJOR_TICK,
  XY_MINOR_PER_MAJOR,
  XY_MINOR_TICK,
} from "./xyLayout";
import { type AxisScale, logGrid, tickValues } from "./xyScale";

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

export function drawFrame(l: Layout): SceneElement[] {
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
