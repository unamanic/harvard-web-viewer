/**
 * Pure geometry helpers that turn scene elements into SVG path data.
 * No React here, so everything is unit-testable on its own.
 *
 * All coordinates are scene units (y grows downwards). Angles are degrees
 * counter-clockwise from +x as seen on the page, so the point at angle t on
 * an ellipse is (cx + rx cos t, cy - ry sin t). See src/formats/types.ts.
 */

import type { Point } from "../formats/types";

export interface EllipseGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Format a number compactly for path data (no exponent, <= 3 decimals). */
function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Point on the ellipse at `angle` degrees (page-CCW convention). */
export function pointAtAngle(e: EllipseGeom, angle: number): Point {
  const t = (angle * Math.PI) / 180;
  // Snap cos/sin near 0 so 90/180/270 give exact coordinates.
  const c = snap(Math.cos(t));
  const s = snap(Math.sin(t));
  return { x: e.cx + e.rx * c, y: e.cy - e.ry * s };
}

function snap(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : v;
}

/** Start and end points of an arc. */
export function arcEndpoints(
  e: EllipseGeom,
  startAngle: number,
  endAngle: number,
): { start: Point; end: Point } {
  return { start: pointAtAngle(e, startAngle), end: pointAtAngle(e, endAngle) };
}

/**
 * Counter-clockwise sweep in degrees from start to end, in [0, 360].
 * Equal angles give 0; a non-zero multiple of 360 gives a full turn.
 */
export function arcSweep(startAngle: number, endAngle: number): number {
  const d = endAngle - startAngle;
  if (d === 0) return 0;
  const m = ((d % 360) + 360) % 360;
  return m === 0 ? 360 : m;
}

/**
 * SVG arc segments (without the initial M) going from `startAngle` through
 * `sweep` degrees; positive sweep is page-CCW. Split into pieces of at most
 * 90 degrees so large-arc ambiguity and full circles never arise.
 */
function arcSegments(e: EllipseGeom, startAngle: number, sweep: number): string {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  // Page-CCW looks counter-clockwise on screen, which in SVG's y-down space
  // is sweep-flag 0.
  const sweepFlag = sweep >= 0 ? 0 : 1;
  let d = "";
  for (let i = 1; i <= pieces; i++) {
    const p = pointAtAngle(e, startAngle + (sweep * i) / pieces);
    d += ` A ${n(e.rx)} ${n(e.ry)} 0 0 ${sweepFlag} ${n(p.x)} ${n(p.y)}`;
  }
  return d;
}

/** Open elliptical arc path. Returns "" when the sweep is zero. */
export function arcPath(e: EllipseGeom, startAngle: number, endAngle: number): string {
  const sweep = arcSweep(startAngle, endAngle);
  if (sweep === 0 || e.rx <= 0 || e.ry <= 0) return "";
  const s = pointAtAngle(e, startAngle);
  return `M ${n(s.x)} ${n(s.y)}` + arcSegments(e, startAngle, sweep);
}

/**
 * Closed band path: arc from start to end, straight down (+y) by `depth`,
 * the same arc back from end to start, and close (back up).
 */
export function bandPath(
  e: EllipseGeom,
  startAngle: number,
  endAngle: number,
  depth: number,
): string {
  const sweep = arcSweep(startAngle, endAngle);
  if (sweep === 0 || e.rx <= 0 || e.ry <= 0) return "";
  const lower: EllipseGeom = { ...e, cy: e.cy + depth };
  const s = pointAtAngle(e, startAngle);
  const endLow = pointAtAngle(lower, endAngle);
  return (
    `M ${n(s.x)} ${n(s.y)}` +
    arcSegments(e, startAngle, sweep) +
    ` L ${n(endLow.x)} ${n(endLow.y)}` +
    arcSegments(lower, endAngle, -sweep) +
    " Z"
  );
}

/** Straight-segment polyline or polygon path. */
export function polylinePath(points: Point[], closed: boolean): string {
  if (points.length === 0) return "";
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p.x)} ${n(p.y)}`).join(" ");
  return closed ? d + " Z" : d;
}

/**
 * Smooth curve through every point: uniform Catmull-Rom spline converted to
 * cubic Béziers. Open curves duplicate the end points; closed curves wrap.
 * Fewer than three points fall back to straight segments.
 */
export function smoothPath(points: Point[], closed: boolean): string {
  const count = points.length;
  if (count < 3) return polylinePath(points, closed);
  const at = (i: number): Point =>
    closed ? points[((i % count) + count) % count] : points[Math.min(count - 1, Math.max(0, i))];
  const segments = closed ? count : count - 1;
  let d = `M ${n(points[0].x)} ${n(points[0].y)}`;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return closed ? d + " Z" : d;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Make width and height non-negative, moving x/y as needed. */
export function normalizeBox(b: Box): Box {
  return {
    x: b.width < 0 ? b.x + b.width : b.x,
    y: b.height < 0 ? b.y + b.height : b.y,
    width: Math.abs(b.width),
    height: Math.abs(b.height),
  };
}

/** Corner radius limited to half the shorter side (and to >= 0). */
export function clampCornerRadius(b: Box, radius: number): number {
  const nb = normalizeBox(b);
  return Math.max(0, Math.min(radius, nb.width / 2, nb.height / 2));
}

/** Closed path of a box with circular corners of `radius` (clamped). */
export function roundedRectPath(b: Box, radius: number): string {
  const { x, y, width: w, height: h } = normalizeBox(b);
  const r = clampCornerRadius(b, radius);
  if (r === 0) return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`;
  const a = (ex: number, ey: number) => ` A ${n(r)} ${n(r)} 0 0 1 ${n(ex)} ${n(ey)}`;
  return (
    `M ${n(x + r)} ${n(y)}` +
    ` H ${n(x + w - r)}` + a(x + w, y + r) +
    ` V ${n(y + h - r)}` + a(x + w - r, y + h) +
    ` H ${n(x + r)}` + a(x, y + h - r) +
    ` V ${n(y + r)}` + a(x + r, y) +
    " Z"
  );
}
