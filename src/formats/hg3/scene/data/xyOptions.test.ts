// Layout rules from the 3.05 XY test charts (samples/option-tests/xy): synthetic charts, one option each.
import { describe, expect, it } from "vitest";
import type { PathElement, RectElement, SceneElement, TextElement } from "../../../../model/scene";
import { XY_FRAME_BOTTOM_MARGIN, XY_FRAME_MARGIN, XY_LABEL_GAP, textSizeToUnits } from "../../assumptions";
import type { Chart } from "../../chart";
import { DocumentType } from "../../container";
import { chartWith, textLine } from "../../data/testing";
import { parseXyData } from "../../data/xy";
import { DEFAULT_PALETTE, ROLE, colorForRole, rgbToCss } from "../../palette";
import { type RecordSpec, concat, f32, f64, f64NotSet, i16, leaf, padded, u16, u8 } from "../../testing/bytes";
import { createChartSceneContext } from "../context";
import { drawnAdvance } from "./text";
import { drawXYChart, withCumulative } from "./xy";
import {
  XY_DOT_LENGTH,
  XY_DOT_PITCH,
  XY_MAJOR_TICK,
  XY_MINOR_TICK,
  XY_SHADOW_OFFSET,
  XY_TABLE_ONLY_BOTTOM,
  XY_TABLE_PAD_EM,
  XY_TICK_OUT_SHIFT,
  xyTextWidth,
} from "./xyLayout";
import { xyOptions } from "./xyOptions";
import { formatXyNumber } from "./xyFormat";

const role = (r: number): string => rgbToCss(colorForRole(DEFAULT_PALETTE, r)!);
const area = (tag: number, x1: number, y1: number, x2: number, y2: number) => leaf(tag, concat(i16(x1), i16(y1), i16(x2), i16(y2), u16(0)));
/** Plot area 32000 × 20000 from (−16000, −11000). */
const PLOT = area(806, -16000, -11000, 16000, 9000);
const W = 32000;
const H = 20000;
const NO_FONT = { source: 0, number: 0, style: 0 };

/** 1406: series n, bar by default; `o` overrides bytes by offset. */
function series(n: number, o: Record<number, number> = {}): RecordSpec {
  const c = 21 + (n % 6);
  const d = [n, 1, 1, 1, 2, 1, 1, 1, n % 12, c, 1, 1, 0, c, n + 1];
  for (const [k, v] of Object.entries(o)) d[Number(k)] = v;
  return leaf(1406, d);
}
const value = (s: number, row: number, v: number): RecordSpec => leaf(1424, concat(u8(s), u16(row), f64(v)));
const xLabel = (row: number, text: string): RecordSpec => leaf(1426, concat(u16(row), padded(text, 31)));

interface AxisSpec {
  scaleType?: number;
  factor?: number;
  min?: number;
  max?: number;
  grid?: number;
  major?: number;
  minor?: number;
  inc?: number;
  minorInc?: number;
  show?: number;
  pct?: number;
  cur?: number;
  sci?: number;
  dec?: number;
  thou?: number;
  goalMin?: number;
  goalMax?: number;
}
/** A 1402 record as Harvard Graphics 3.05 writes it (XBASE defaults), with `a` changed. */
function axis(n: number, a: AxisSpec = {}): RecordSpec {
  const d = new Uint8Array(102);
  const f = (v: number | undefined) => (v === undefined ? f64NotSet() : f64(v));
  d[0] = n;
  d[1] = a.scaleType ?? 1;
  d.set(f(a.factor), 2);
  d.set(f(a.min), 10);
  d.set(f(a.max), 18);
  d.set([a.grid ?? (n === 0 ? 3 : 1), a.major ?? 4, a.minor ?? 4], 26);
  d.set(f(a.inc), 29);
  d.set(f(a.minorInc), 37);
  d.set(f(a.goalMin), 45);
  d.set(f(a.goalMax), 53);
  d.set([n === 1 ? 27 : 28, a.show ?? 1, a.pct ?? 2, a.cur ?? 2, a.sci ?? 2], 61);
  d.set(f(a.dec), 66);
  d[74] = a.thou ?? 1;
  return leaf(1402, d);
}
/** 1408 as XBASE stores it, with bytes changed by offset. */
function style(o: Record<number, number> = {}): RecordSpec {
  const d = concat([1, 1], f32(85), f32(50), [2, 1, 1, 1, 1], f32(40), f32(20), [18, 32]);
  for (const [k, v] of Object.entries(o)) d[Number(k)] = v;
  return leaf(1408, d);
}

const tagOf = (r: RecordSpec) => (r.kind === "leaf" ? r.tag : -1);
/** Two rows of two bar series (10, 28 and 15, 103), X labels in 1426, all options at their 3.05 defaults; `extra` replaces the option records it repeats. */
function base(extra: RecordSpec[] = [], y1: AxisSpec = {}): Chart {
  const replaced = new Set(extra.map(tagOf).filter((t) => [1404, 1405, 1408, 1410, 1418].includes(t)));
  const defaults = [style(), leaf(1410, [1, 1, 2]), leaf(1404, [1, 14, 15]), leaf(1405, [1])].filter((r) => !replaced.has(tagOf(r)));
  return chartWith(DocumentType.XY, [
    PLOT,
    textLine(4, 0, 0, "North", 8),
    textLine(4, 1, 0, "South", 8),
    axis(0),
    axis(1, y1),
    axis(2),
    ...defaults,
    xLabel(0, "Q1"),
    xLabel(1, "Q2"),
    value(0, 0, 10),
    value(1, 0, 28),
    value(0, 1, 15),
    value(1, 1, 103),
    ...extra,
  ]);
}
const withSeries = (extra: RecordSpec[] = [], y1: AxisSpec = {}, s0: Record<number, number> = {}, s1: Record<number, number> = {}) =>
  base([series(0, s0), series(1, s1), ...extra], y1);

function draw(chart: Chart) {
  const { context } = createChartSceneContext(chart, undefined);
  return { elements: drawXYChart(context), context };
}
const paths = (els: SceneElement[]) => els.filter((e): e is PathElement => e.kind === "path");
const texts = (els: SceneElement[]) => els.filter((e): e is TextElement => e.kind === "text");
const rects = (els: SceneElement[]) => els.filter((e): e is RectElement => e.kind === "rect");
const frameRect = (els: SceneElement[]) => rects(els).find((r) => r.fill === role(ROLE.FrameBkg) && r.stroke === null);
const bars = (els: SceneElement[]) => rects(els).filter((r) => r.stroke === role(ROLE.Outlines));
const len = (p: PathElement) => Math.hypot(p.points[1]!.x - p.points[0]!.x, p.points[1]!.y - p.points[0]!.y);

describe("formatXyNumber (1402 label format)", () => {
  const plain = { scaleFactor: null, percent: false, currency: false, scientific: false, decimals: null, thousands: true, leading: "", trailing: "" };
  it("writes the labels of the test charts' drawn copies", () => {
    expect(formatXyNumber(35, null)).toBe("35");
    expect(formatXyNumber(5, { ...plain, percent: true })).toBe("500%"); // XPCT
    expect(formatXyNumber(35, { ...plain, percent: true })).toBe("3,500%");
    expect(formatXyNumber(35, { ...plain, currency: true })).toBe("$35"); // XCUR
    expect(formatXyNumber(35, { ...plain, scientific: true })).toBe("3.500E+01"); // XSCI
    expect(formatXyNumber(0, { ...plain, scientific: true })).toBe("0.000E+00");
    expect(formatXyNumber(35, { ...plain, decimals: 2 })).toBe("35.00"); // XDEC2
    expect(formatXyNumber(1000, { ...plain, thousands: false })).toBe("1000"); // XTHOUN
    expect(formatXyNumber(1234567.5, plain)).toBe("1,234,567.5");
    expect(formatXyNumber(35, { ...plain, leading: "AB" })).toBe("AB35"); // XLEAD
    expect(formatXyNumber(35, { ...plain, trailing: "CD" })).toBe("35CD"); // XTRAIL
    expect([0, 5, 10, 35].map((v) => formatXyNumber(v, { ...plain, scaleFactor: 2 }))).toEqual(["0", "2.5", "5", "17.5"]); // XSCALE
  });

  it("puts a minus sign first and never on zero", () => {
    expect(formatXyNumber(-5, { ...plain, currency: true })).toBe("-$5");
    expect(formatXyNumber(-0.001, { ...plain, decimals: 1 })).toBe("0.0");
    expect(formatXyNumber(0.01, { ...plain, scientific: true })).toBe("1.000E-02");
  });
});

describe("XY options from the 3.05 test charts", () => {
  it("decodes the 1404, 1405, 1408 and 1418 options", () => {
    const o = xyOptions(parseXyData(base([leaf(1404, [2, 15, 16]), leaf(1405, [2]), style({ 13: 2, 24: 33 }), leaf(1418, [2, 1, 6, 1, 15, 21])]), []));
    expect(o).toMatchObject({
      frameStyle: 2,
      frameRole: 15,
      frameFillRole: 16,
      frameFill: false,
      shadow: true,
      outlineRole: 33,
      legendShow: false,
      legendFrameStyle: 1,
      legendOutlineRole: 15,
      legendFillRole: 21,
    });
  });

  it("accumulates cumulative series over the rows (XS6CU)", () => {
    const d = withCumulative(parseXyData(withSeries([], {}, { 4: 1 }), []));
    expect([...d.values.get(0)!]).toEqual([
      [0, 10],
      [1, 25],
    ]);
    expect([...d.values.get(1)!]).toEqual([
      [0, 28],
      [1, 103],
    ]);
  });

  it("draws dotted grid lines as dashes, solid as one line, none at all (XBASE, XGRIDS, XGRIDN)", () => {
    const { elements, context } = draw(withSeries());
    const frame = frameRect(elements)!;
    const pitch = XY_DOT_PITCH * context.page.shortSide;
    const dashes = paths(elements).filter((p) => len(p) <= XY_DOT_LENGTH * pitch + 1e-6);
    // Grid lines at 20 .. 100 (the 0 and 120 lines lie on the frame edges), each cut into dashes from the left.
    const perLine = Math.ceil(frame.width / pitch);
    expect(dashes).toHaveLength(5 * perLine);
    expect(dashes[0]!.points[0]!.x).toBeCloseTo(frame.x, 6);
    expect(len(dashes[0]!)).toBeCloseTo(XY_DOT_LENGTH * pitch, 6);
    const full = (els: SceneElement[]) => paths(els).filter((p) => Math.abs(len(p) - frameRect(els)!.width) < 1e-6 && p.points[0]!.y === p.points[1]!.y);
    // Solid: top, bottom, category axis and the 7 tick lines; none: top, bottom, axis.
    expect(full(draw(withSeries([], { grid: 2 })).elements)).toHaveLength(10);
    expect(full(draw(withSeries([], { grid: 3 })).elements)).toHaveLength(3);
  });

  it("draws major and minor ticks and moves the frame for outward ones (XMAJIN, XMAJOUT, XMINBOT)", () => {
    const plain = frameRect(draw(withSeries([], { grid: 3 })).elements)!;
    const ticksOf = (els: SceneElement[], x: number) => paths(els).filter((p) => p.points[0]!.y === p.points[1]!.y && Math.min(p.points[0]!.x, p.points[1]!.x) <= x + 1e-6 && Math.max(p.points[0]!.x, p.points[1]!.x) >= x - 1e-6 && len(p) < 2000);
    const inside = draw(withSeries([], { grid: 3, major: 1 })).elements;
    const tIn = ticksOf(inside, plain.x);
    expect(tIn).toHaveLength(7);
    expect(len(tIn[0]!)).toBeCloseTo(XY_MAJOR_TICK * plain.width, 6);
    expect(Math.min(tIn[0]!.points[0]!.x, tIn[0]!.points[1]!.x)).toBeCloseTo(plain.x, 6);
    const out = draw(withSeries([], { grid: 3, major: 2 })).elements;
    const f = frameRect(out)!;
    expect(f.x).toBeCloseTo(plain.x + XY_TICK_OUT_SHIFT * W, 6);
    const tOut = ticksOf(out, f.x);
    expect(Math.max(tOut[0]!.points[0]!.x, tOut[0]!.points[1]!.x)).toBeCloseTo(f.x, 6);
    // Labels move out past the ticks.
    const zero = texts(out).find((t) => t.text === "0")!;
    expect(zero.x).toBeCloseTo(f.x - XY_LABEL_GAP * f.width - XY_MAJOR_TICK * f.width - xyTextWidth(draw(withSeries()).context, "0", NO_FONT, 3.5), 6);
    // Minor ticks every fifth of a step (20 → 4), both sides, majors included; the frame stays.
    const minor = draw(withSeries([], { grid: 3, minor: 3 })).elements;
    expect(frameRect(minor)!.x).toBeCloseTo(plain.x, 6);
    const tMinor = ticksOf(minor, plain.x);
    expect(tMinor).toHaveLength(31);
    expect(len(tMinor[0]!)).toBeCloseTo(2 * XY_MINOR_TICK * plain.width, 6);
  });

  it("labels every major increment and hides labels when asked (XMAJI10, XLBLNO)", () => {
    const labels = (y1: AxisSpec) => texts(draw(withSeries([], y1)).elements).map((t) => t.text);
    expect(labels({ inc: 50 })).toEqual(expect.arrayContaining(["0", "50", "100"]));
    expect(labels({ inc: 50 })).not.toContain("120");
    const none = draw(withSeries([], { show: 2 })).elements;
    expect(texts(none).map((t) => t.text)).not.toContain("120");
    expect(frameRect(none)!.x).toBeCloseTo(-16000 + XY_FRAME_MARGIN * W, 6);
  });

  it("formats the Y labels by 1402 (XPCT)", () => {
    expect(texts(draw(withSeries([], { pct: 1 })).elements).map((t) => t.text)).toEqual(expect.arrayContaining(["0%", "2,000%", "12,000%"]));
  });

  it("draws the axis frame by 1404 and 1405 (XFRST, XFROC, XFRFC, XFRSHF)", () => {
    const top = (els: SceneElement[], stroke: string) => {
      const f = rects(els).find((r) => r.stroke === null && r.width > 10000)!;
      return paths(els).filter((p) => p.stroke === stroke && p.points.every((q) => Math.abs(q.y - f.y) < 1e-6) && len(p) > 1000);
    };
    expect(top(draw(withSeries()).elements, role(ROLE.Frame))).toHaveLength(1);
    const half = draw(withSeries([leaf(1404, [2, 14, 15])])).elements;
    expect(top(half, role(ROLE.Frame))).toHaveLength(0);
    const roles = draw(withSeries([leaf(1404, [1, 30, 31])])).elements;
    expect(rects(roles).some((r) => r.fill === role(31) && r.stroke === null)).toBe(true);
    expect(top(roles, role(30))).toHaveLength(1);
    expect(paths(roles).some((p) => p.stroke === role(ROLE.Frame))).toBe(false);
    const noFill = draw(withSeries([leaf(1405, [2])])).elements;
    expect(frameRect(noFill)).toBeUndefined();
  });

  it("leaves out hidden series but keeps their legend row (XS6SH)", () => {
    const legend = area(810, 10000, -4000, 15000, 2000);
    const shown = draw(withSeries([legend])).elements;
    const hidden = draw(withSeries([legend], {}, { 1: 2 })).elements;
    const plotBars = (els: SceneElement[]) => bars(els).filter((r) => r.x < 10000);
    expect(plotBars(hidden)).toHaveLength(2);
    expect(plotBars(hidden)[0]!.width).toBeCloseTo(2 * plotBars(shown)[0]!.width, 6);
    const south = (els: SceneElement[]) => texts(els).find((t) => t.text === "South")!;
    expect(texts(hidden).some((t) => t.text === "North")).toBe(false);
    expect(south(hidden).y).toBeCloseTo(south(shown).y, 6);
  });

  it("puts bars on Y2 after those on Y1 in a cluster (XS6Y2)", () => {
    const { elements } = draw(withSeries([], {}, { 3: 2 }));
    const b = bars(elements);
    expect(b[0]!.fill).toBe(role(22));
    expect(b[1]!.fill).toBe(role(21));
    expect(b[1]!.x).toBeGreaterThan(b[0]!.x);
  });

  it("outlines bars in the 1408 outline role and draws drop shadows for 2D style 2 (XSOUT, XS2DST)", () => {
    const out = draw(withSeries([style({ 24: 33 })])).elements;
    expect(rects(out).filter((r) => r.stroke === role(33))).toHaveLength(4);
    const sh = draw(withSeries([style({ 13: 2 })])).elements;
    const shadows = rects(sh).filter((r) => r.fill === role(ROLE.Shadow));
    const b = bars(sh);
    expect(shadows).toHaveLength(4);
    expect(shadows[0]!.x).toBeCloseTo(b[0]!.x + XY_SHADOW_OFFSET * b[0]!.width, 6);
    expect(shadows[0]!.height).toBeCloseTo((1 - XY_SHADOW_OFFSET) * b[0]!.height, 6);
    expect(shadows[0]!.y + shadows[0]!.height).toBeCloseTo(b[0]!.y + b[0]!.height, 6);
  });

  it("prints data labels only for series whose own option is Yes (XDLBL, XS6DL)", () => {
    const labels = (s0: Record<number, number>) => texts(draw(withSeries([leaf(1410, [1, 1, 1])], {}, s0)).elements).map((t) => t.text);
    expect(labels({})).toEqual(expect.arrayContaining(["10", "28", "15", "103"]));
    expect(labels({ 5: 2 })).not.toContain("15");
  });

  it("draws the data table without swatches when the legend is on: names, then the frame (XREV7, XDTGRID)", () => {
    const { elements, context } = draw(withSeries([leaf(1410, [2, 2, 2])]));
    const box = rects(elements).find((r) => r.stroke === role(ROLE.Frame) && r.fill === null)!;
    expect(box.x).toBe(-16000);
    expect(box.y + box.height).toBeCloseTo(-(-11000 + XY_FRAME_BOTTOM_MARGIN * H), 6);
    const north = texts(elements).find((t) => t.text === "North")!;
    // Series names are size 4 here (the test text tail).
    const pad = XY_TABLE_PAD_EM * textSizeToUnits(4, context.page.shortSide);
    expect(north.x).toBeCloseTo(-16000 + pad, 6);
    const nameW = Math.max(drawnAdvance(context, "North", NO_FONT, 4), drawnAdvance(context, "South", NO_FONT, 4));
    expect(frameRect(elements)!.x).toBeCloseTo(-16000 + 2 * pad + nameW, 6);
    // Horizontal grid: one line across the table under each row.
    const rows = paths(elements).filter((p) => p.points[0]!.x === -16000 && p.points[0]!.y === p.points[1]!.y);
    expect(rows).toHaveLength(2);
    expect(rects(elements).some((r) => r.width < 1500 && r.fill === role(21))).toBe(false);
  });

  it("draws only the table, filling the plot area, for Table only (XDTONLY)", () => {
    const { elements } = draw(withSeries([leaf(1410, [3, 1, 2])]));
    expect(frameRect(elements)).toBeUndefined();
    expect(bars(elements)).toHaveLength(0);
    const box = rects(elements)[0]!;
    expect([box.x, box.width, -box.y, -box.y - box.height]).toEqual([-16000, W, 9000, -11000 + XY_TABLE_ONLY_BOTTOM * H]);
    expect(texts(elements).map((t) => t.text).sort()).toEqual(["10", "103", "15", "28", "North", "South"]);
  });

  it("draws a legend without a box and flush left for frame style 1 (XDTNO)", () => {
    const legend = area(810, 10000, -4000, 15000, 2000);
    const plain = draw(withSeries([legend, leaf(1418, [1, 1, 6, 1, 14, 20])])).elements;
    expect(rects(plain).some((r) => r.fill === role(ROLE.Legend))).toBe(false);
    expect(rects(plain).find((r) => r.fill === role(21) && r.width < 1500)!.x).toBe(10000);
    const framed = draw(withSeries([legend, leaf(1418, [1, 2, 5, 2, 15, 29])])).elements;
    expect(rects(framed).some((r) => r.fill === role(29) && r.stroke === role(15))).toBe(true);
    expect(rects(framed).find((r) => r.fill === role(21) && r.width < 1500)!.x).toBeGreaterThan(10000);
  });
  it("draws a goal range only when both bounds are set, after the frame fill and before the bars (XGOALB, XGOALMN, XGOALMX)", () => {
    const goal = (y1: AxisSpec) => draw(withSeries([], y1)).elements;
    const both = goal({ goalMin: 20, goalMax: 60 });
    const frame = frameRect(both)!;
    const band = rects(both).find((r) => r.fill === role(27) && r.stroke === role(27))!;
    expect(band).toBeDefined();
    expect(band.x).toBeCloseTo(frame.x, 6);
    expect(band.width).toBeCloseTo(frame.width, 6);
    expect(both.indexOf(band)).toBeGreaterThan(both.indexOf(frame));
    expect(both.indexOf(band)).toBeLessThan(both.indexOf(bars(both)[0]!));
    expect(rects(goal({ goalMin: 20 })).some((r) => r.fill === role(27))).toBe(false);
    expect(rects(goal({ goalMax: 60 })).some((r) => r.fill === role(27))).toBe(false);
  });

  it("fills bars by fill style: pattern 0 solid, other patterns left open (XFSP, XFSPP, XFSB, XFSBP, XFSBC)", () => {
    const look = (s0: Record<number, number>) => {
      const els = draw(withSeries([], {}, s0)).elements;
      // Series 1 keeps its colour (role 22), so the first two bar-sized rects not in role 22 are series 0's.
      return rects(els)
        .filter((r) => r !== frameRect(els) && r.fill !== role(22) && r.height > 0 && r.width > 1000 && r.width < 10000)
        .map((r) => [r.fill, r.stroke]);
    };
    const white = "#ffffff";
    // Pattern: white pattern colour and white outline, whatever the series colour (PPATC, XFSP).
    expect(look({ 7: 2, 8: 0 })).toEqual([[white, white], [white, white]]);
    expect(look({ 7: 2, 8: 5 })).toEqual([[null, white], [null, white]]);
    // Both: the series colour as the pattern colour, the usual outline (XFSB, XFSBC).
    expect(look({ 7: 3, 8: 0 })).toEqual([[role(21), role(ROLE.Outlines)], [role(21), role(ROLE.Outlines)]]);
    expect(look({ 7: 3, 8: 2 })).toEqual([[null, role(ROLE.Outlines)], [null, role(ROLE.Outlines)]]);
  });
});
