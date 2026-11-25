import { describe, expect, it } from "vitest";
import {
  arcEndpoints,
  arcPath,
  arcSweep,
  bandPath,
  clampCornerRadius,
  gradientSpan,
  gradientStripPoints,
  normalizeBox,
  shapeBounds,
  polylinePath,
  roundedRectPath,
  smoothPath,
} from "./geometry";

const e = { cx: 100, cy: 200, rx: 50, ry: 20 };

/** Pull all numeric coordinates out of path data. */
function numbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe("arcEndpoints", () => {
  it("0 degrees is 3 o'clock", () => {
    expect(arcEndpoints(e, 0, 0).start).toEqual({ x: 150, y: 200 });
  });
  it("90 degrees is 12 o'clock (up on the page = smaller scene y)", () => {
    expect(arcEndpoints(e, 0, 90).end).toEqual({ x: 100, y: 180 });
  });
  it("180 degrees is 9 o'clock", () => {
    expect(arcEndpoints(e, 180, 0).start).toEqual({ x: 50, y: 200 });
  });
  it("270 degrees is 6 o'clock", () => {
    expect(arcEndpoints(e, 270, 0).start).toEqual({ x: 100, y: 220 });
  });
});

describe("arcSweep", () => {
  it("wraps negative differences", () => {
    expect(arcSweep(270, 90)).toBe(180);
    expect(arcSweep(350, 10)).toBe(20);
  });
  it("treats equal angles as empty and 360 apart as full", () => {
    expect(arcSweep(45, 45)).toBe(0);
    expect(arcSweep(0, 360)).toBe(360);
  });
});

describe("arcPath", () => {
  it("starts at the start angle and ends at the end angle, CCW on screen", () => {
    const d = arcPath(e, 0, 90);
    expect(d.startsWith("M 150 200")).toBe(true);
    expect(d.endsWith("100 180")).toBe(true);
    expect(d).toContain(" 0 0 0 "); // sweep-flag 0 = counter-clockwise in y-down SVG
  });
  it("draws a full ellipse in several pieces", () => {
    const d = arcPath(e, 0, 360);
    expect(d.match(/A/g)?.length).toBe(4);
    expect(d.endsWith("150 200")).toBe(true);
  });
  it("is empty for a zero sweep", () => {
    expect(arcPath(e, 30, 30)).toBe("");
  });
});

describe("bandPath", () => {
  it("closes and visits both arcs, the lower one offset down by depth", () => {
    const d = bandPath(e, 180, 360, 40);
    expect(d.startsWith("M 50 200")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    // Lower edge reached by a straight line at the end angle, depth below.
    expect(d).toContain("L 150 240");
    // Arc back ends at the start angle on the lower ellipse, sweeping clockwise.
    expect(d).toMatch(/A 50 20 0 0 1 50 240 Z$/);
  });
});

describe("polylinePath", () => {
  it("draws open and closed shapes", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(polylinePath(pts, false)).toBe("M 0 0 L 10 0 L 10 10");
    expect(polylinePath(pts, true)).toBe("M 0 0 L 10 0 L 10 10 Z");
  });
});

describe("smoothPath", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { x: 200, y: -30 },
    { x: 300, y: 10 },
  ];
  it("passes through every point (segment end points)", () => {
    const d = smoothPath(pts, false);
    expect(d.startsWith("M 0 0")).toBe(true);
    const segs = d.split(" C ").slice(1).map(numbers);
    expect(segs).toHaveLength(3);
    segs.forEach((s, i) => {
      expect(s.slice(4)).toEqual([pts[i + 1].x, pts[i + 1].y]);
    });
  });
  it("closed curve wraps back to the first point", () => {
    const d = smoothPath(pts, true);
    const segs = d.split(" C ").slice(1);
    expect(segs).toHaveLength(4);
    expect(d).toMatch(/ 0 0 Z$/);
  });
  it("is tangent-continuous: control points are collinear with the joint", () => {
    const segs = smoothPath(pts, false).split(" C ").slice(1).map(numbers);
    // Incoming c2 of segment 0, joint pts[1], outgoing c1 of segment 1.
    const [c2x, c2y] = segs[0].slice(2, 4);
    const [c1x, c1y] = segs[1].slice(0, 2);
    const cross = (pts[1].x - c2x) * (c1y - pts[1].y) - (pts[1].y - c2y) * (c1x - pts[1].x);
    expect(Math.abs(cross)).toBeLessThan(1e-6 * 1e4);
  });
  it("falls back to straight lines below three points", () => {
    expect(smoothPath(pts.slice(0, 2), false)).toBe("M 0 0 L 100 50");
  });
});

describe("rect helpers", () => {
  it("normalises negative sizes", () => {
    expect(normalizeBox({ x: 10, y: 10, width: -4, height: -6 })).toEqual({
      x: 6, y: 4, width: 4, height: 6,
    });
  });
  it("clamps the corner radius to half the shorter side", () => {
    expect(clampCornerRadius({ x: 0, y: 0, width: 100, height: 40 }, 500)).toBe(20);
  });
  it("draws a closed rounded rectangle with four corner arcs", () => {
    const d = roundedRectPath({ x: 0, y: 0, width: 100, height: 40 }, 10);
    expect(d.startsWith("M 10 0")).toBe(true);
    expect(d.match(/A/g)?.length).toBe(4);
    expect(d.endsWith("Z")).toBe(true);
  });
  it("square corners when radius is zero", () => {
    expect(roundedRectPath({ x: 0, y: 0, width: 5, height: 5 }, 0)).toBe("M 0 0 H 5 V 5 H 0 Z");
  });
});

describe("gradient geometry", () => {
  it("bounds shape elements in their own units", () => {
    expect(shapeBounds({ kind: "rect", x: 10, y: 20, width: -4, height: 5, fill: null, stroke: null })).toEqual({ x: 6, y: 20, width: 4, height: 5 });
    expect(shapeBounds({ kind: "ellipse", cx: 0, cy: 0, rx: 3, ry: 2, fill: null, stroke: null })).toEqual({ x: -3, y: -2, width: 6, height: 4 });
    expect(shapeBounds({ kind: "path", points: [{ x: 1, y: 5 }, { x: 4, y: -1 }], closed: true, fill: null, stroke: null })).toEqual({ x: 1, y: -1, width: 3, height: 6 });
    expect(shapeBounds({ kind: "image", href: "", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it("spans a box along the page angle (90 = up, i.e. scene −y)", () => {
    const up = gradientSpan({ x: 0, y: 0, width: 10, height: 20 }, 90);
    expect(up.dir).toEqual({ x: 0, y: -1 });
    expect([up.start, up.end]).toEqual([-20, 0]);
    const right = gradientSpan({ x: 0, y: 0, width: 10, height: 20 }, 0);
    expect([right.start, right.end, right.perpMin, right.perpMax]).toEqual([0, 10, 0, 20]);
    // A diagonal spans the box corner to corner.
    const diag = gradientSpan({ x: 0, y: 0, width: 10, height: 10 }, 45);
    expect(diag.end - diag.start).toBeCloseTo(10 * Math.SQRT2);
  });

  it("gives strips of the span as 4-point polygons", () => {
    const span = gradientSpan({ x: 0, y: 0, width: 10, height: 20 }, 0);
    expect(gradientStripPoints(span, 0.5, 1)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 5, y: 20 },
    ]);
  });
});
