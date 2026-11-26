/**
 * Drawing XY series: bars (2-D and 3-D shapes), lines, curves, trend lines,
 * areas and high/low series.
 */
import type { Point, SceneElement } from "../../../../model/scene";
import {
  XY_3D_CYLINDER_RY,
  XY_3D_CYLINDER_TOP_SHADE,
  XY_3D_OCTAGON_TOP_SHADE,
  XY_3D_OCTAGON_Z,
  XY_3D_PYRAMID_SHADES,
  XY_3D_TOP_SHADE,
  XY_CURVE_STEPS,
  XY_CURVE_TENSION,
  XY_LABEL_GAP,
} from "../../assumptions";
import type { XySeries } from "../../data/xy";
import { ROLE } from "../../palette";
import { toScene } from "../page";
import { fillLook } from "./fillStyle";
import type { Box } from "./text";
import {
  at,
  box3d,
  boxAt,
  drawLabel,
  HL_BAND,
  HL_IBAR,
  isArea,
  isBar,
  isHighLow,
  label,
  type Layout,
  line,
  LINE_CURVE,
  LINE_TREND,
  polygon,
  rect,
  rowAt,
  rowsOf,
  shade,
  shift,
  tableStyle,
  valueAt,
  XY_SHADOW_OFFSET,
} from "./xyLayout";
import type { BarShape, XyOptions } from "./xyOptions";
import type { AxisScale } from "./xyScale";
import { tableValue } from "./xyTable";

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

export function drawSeries(l: Layout, series: XySeries[]): SceneElement[] {
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
