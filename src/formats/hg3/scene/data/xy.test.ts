import { describe, expect, it } from "vitest";
import type { BandElement, PathElement, RectElement, SceneElement, TextElement } from "../../../types";
import {
  BOX_3D_SIDE_SHADE,
  BOX_3D_TOP_SHADE,
  XY_FRAME_BOTTOM_MARGIN,
  XY_FRAME_MARGIN,
  XY_LABEL_GAP,
  XY_LEGEND_SWATCH,
} from "../../assumptions";
import type { Chart } from "../../chart";
import { DocumentType } from "../../container";
import { chartWith, textLine } from "../../data/testing";
import { AXIS_F64_OFFSETS, parseXyData } from "../../data/xy";
import { DEFAULT_PALETTE, ROLE, colorForRole, rgbToCss } from "../../palette";
import { type RecordSpec, concat, f32, f64, f64NotSet, i16, leaf, padded, u16, u8 } from "../../testing/bytes";
import { buildChartScene, notYetDrawn } from "../buildChartScene";
import { createChartSceneContext } from "../context";
import { shadeCss } from "../objectLayer";
import { lineBoxHeight } from "./text";
import {
  autoScale,
  drawXYChart,
  logScale,
  niceStep,
  seriesGroups,
  splinePoints,
  tickLabel,
  tickValues,
  xyOptions,
  xyTextWidth,
} from "./xy";

const role = (r: number): string => rgbToCss(colorForRole(DEFAULT_PALETTE, r)!);
const area = (tag: number, x1: number, y1: number, x2: number, y2: number) => leaf(tag, concat(i16(x1), i16(y1), i16(x2), i16(y2), u16(0)));
/** Plot area 32000 × 20000 from (−16000, −11000). */
const PLOT = area(806, -16000, -11000, 16000, 9000);
const W = 32000;
const H = 20000;

function series(n: number, type: number, axis = 1, colour = 21 + (n % 6), style = 1): RecordSpec {
  return leaf(1406, [n, 1, type, axis, 2, 1, 1, 1, n % 12, colour, style, 1, 0, colour, n + 1]);
}
const value = (s: number, row: number, v: number): RecordSpec => leaf(1424, concat(u8(s), u16(row), f64(v)));
const xLabel = (row: number, text: string): RecordSpec => leaf(1422, concat(u16(row), padded(text, 23)));
function axis(n: number, set: Record<number, number> = {}, kind = 1): RecordSpec {
  const data = new Uint8Array(102);
  data[0] = n;
  data[1] = kind;
  for (const at of AXIS_F64_OFFSETS) data.set(at in set ? f64(set[at]!) : f64NotSet(), at);
  return leaf(1402, data);
}
/** 1408: bar mode, bar shape, bar width %, overlap %, area mode, high/low style, 3-D (2), horizontal (4), bar depth %, depth %. */
function options(o: { bar?: number; shape?: number; width?: number; area?: number; hl?: number; threeD?: boolean; horizontal?: boolean; depth?: number } = {}): RecordSpec {
  return leaf(
    1408,
    concat(
      [o.bar ?? 1, o.shape ?? 1],
      f32(o.width ?? 85),
      f32(50),
      [o.area ?? 2, o.hl ?? 1, o.threeD ? 2 : 1, o.horizontal ? 4 : 1, 1],
      f32(40),
      f32(o.depth ?? 15),
      [0x12, 0x20],
    ),
  );
}

function draw(chart: Chart) {
  const { context } = createChartSceneContext(chart, undefined);
  return { elements: drawXYChart(context), context };
}
const paths = (els: SceneElement[]) => els.filter((e): e is PathElement => e.kind === "path");
const texts = (els: SceneElement[]) => els.filter((e): e is TextElement => e.kind === "text");
const rects = (els: SceneElement[]) => els.filter((e): e is RectElement => e.kind === "rect");

/** Two rows of two bar series, values up to 103. */
function clusterChart(extra: RecordSpec[] = []): Chart {
  return chartWith(DocumentType.XY, [
    PLOT,
    textLine(4, 0, 0, "North", 8),
    textLine(4, 1, 0, "South", 8),
    series(0, 1),
    series(1, 1),
    xLabel(0, "Q1"),
    xLabel(1, "Q2"),
    value(0, 0, 10),
    value(1, 0, 28),
    value(0, 1, 15),
    value(1, 1, 103),
    ...extra,
  ]);
}

describe("value axes", () => {
  it("picks the step as range / 5 rounded to 1, 2 or 5 × 10^k and tops the axis just above the data (sample charts)", () => {
    expect(niceStep(103)).toBe(20);
    expect(niceStep(157)).toBe(20);
    expect(niceStep(75)).toBe(20);
    expect(niceStep(36)).toBe(10);
    expect(niceStep(309)).toBe(50);
    expect(niceStep(17)).toBe(5);
    const top = (max: number, min: number | null = null, lo = 0) => {
      const s = autoScale(lo, max, min, null);
      return [s.min, s.max, s.step];
    };
    expect(top(103)).toEqual([0, 120, 20]);
    expect(top(157)).toEqual([0, 180, 20]);
    expect(top(75)).toEqual([0, 80, 20]);
    expect(top(40)).toEqual([0, 50, 10]);
    expect(top(47.74)).toEqual([0, 50, 10]);
    expect(top(309)).toEqual([0, 350, 50]);
    expect(top(528)).toEqual([0, 600, 100]);
    expect(top(14.375, 6, 6.625)).toEqual([6, 16, 2]);
    expect(top(8.375, 6, 6.625)).toEqual([6, 8.5, 0.5]);
  });

  it("formats tick labels by the step and percent axes with a % sign", () => {
    const s = autoScale(6.6, 8.375, 6, null);
    expect(tickValues(s).map((v) => tickLabel(v, s))).toEqual(["6", "6.5", "7", "7.5", "8", "8.5"]);
    const p = { min: 0, max: 100, step: 25, percent: true };
    expect(tickValues(p).map((v) => tickLabel(v, p))).toEqual(["0%", "25%", "50%", "75%", "100%"]);
  });

  it("covers whole decades on a log axis (GALD481)", () => {
    const s = logScale(3, 44);
    expect([s.min, s.max]).toEqual([1, 100]);
    expect(tickValues(s).map((v) => tickLabel(v, s))).toEqual(["1", "10", "100"]);
  });
});

describe("xyOptions", () => {
  it("decodes the 1408, 1410 and 1418 option bytes", () => {
    const chart = chartWith(DocumentType.XY, [
      options({ bar: 3, shape: 4, width: 30, area: 3, hl: 3, threeD: true, horizontal: true, depth: 35 }),
      leaf(1410, [2, 1, 1]),
      leaf(1418, [1, 2, 5, 2, 14, 20]),
    ]);
    const o = xyOptions(parseXyData(chart, []));
    expect(o).toMatchObject({
      barMode: "stacked",
      barShape: "cylinder",
      barWidth: 30,
      overlap: 50,
      areaMode: "percent",
      highLowStyle: 3,
      threeD: true,
      horizontal: true,
      barDepth: 40,
      depth: 35,
      dataTable: true,
      valueLabels: true,
      legendBottomUp: true,
    });
  });
});

describe("drawXYChart", () => {
  it("places the frame by the plot margins and the widest Y label, and draws clustered bars to scale", () => {
    const { elements, context } = draw(clusterChart());
    const labelW = xyTextWidth(context, "120", { source: 0, number: 0, style: 0 }, 3.5);
    const xH = lineBoxHeight(context, 3.5);
    const left = -16000 + XY_FRAME_MARGIN * W + labelW;
    const right = 16000 - XY_FRAME_MARGIN * W;
    const top = 9000 - XY_FRAME_MARGIN * H;
    const bottom = -11000 + XY_FRAME_BOTTOM_MARGIN * H + xH;
    const frame = rects(elements)[0]!;
    expect(frame.fill).toBe(role(ROLE.FrameBkg));
    expect(frame.x).toBeCloseTo(left, 6);
    expect(frame.width).toBeCloseTo(right - left, 6);
    expect(frame.y).toBeCloseTo(-top, 6);
    expect(frame.height).toBeCloseTo(top - bottom, 6);
    // Ticks 0 to 120 by 20 (max 103).
    const labels = texts(elements).map((t) => t.text);
    expect(labels).toEqual(expect.arrayContaining(["0", "20", "40", "60", "80", "100", "120", "Q1", "Q2"]));
    // Bars: 85 % of each category slot, split between the two series, heights proportional to the values.
    const bars = rects(elements).filter((r) => r.stroke === role(ROLE.Outlines));
    expect(bars).toHaveLength(4);
    const slot = (right - left) / 2;
    const bw = (0.85 * slot) / 2;
    expect(bars[0]!.x).toBeCloseTo(left + 0.075 * slot, 6);
    expect(bars[0]!.width).toBeCloseTo(bw, 6);
    expect(bars[1]!.x).toBeCloseTo(left + 0.075 * slot + bw, 6);
    expect(bars[0]!.height).toBeCloseTo(((top - bottom) * 10) / 120, 6);
    expect(bars[3]!.height).toBeCloseTo(((top - bottom) * 103) / 120, 6);
    expect(bars.map((b) => b.fill)).toEqual([role(21), role(22), role(21), role(22)]);
    // Y labels sit XY_LABEL_GAP × frame width left of the frame.
    const y0 = texts(elements).find((t) => t.text === "0")!;
    expect(y0.anchor).toBe("start");
    expect(y0.x).toBeCloseTo(left - XY_LABEL_GAP * (right - left) - xyTextWidth(context, "0", { source: 0, number: 0, style: 0 }, 3.5), 6);
  });

  it("stacks bars and scales 100 % bars to row shares", () => {
    const stacked = draw(clusterChart([options({ bar: 3 })])).elements;
    const sb = rects(stacked).filter((r) => r.stroke === role(ROLE.Outlines));
    expect(sb[1]!.x).toBeCloseTo(sb[0]!.x, 6);
    expect(sb[1]!.y + sb[1]!.height).toBeCloseTo(sb[0]!.y, 6); // the second sits on the first
    const percent = draw(clusterChart([options({ bar: 4 })])).elements;
    expect(texts(percent).map((t) => t.text)).toEqual(expect.arrayContaining(["0%", "25%", "50%", "75%", "100%"]));
    const pb = rects(percent).filter((r) => r.stroke === role(ROLE.Outlines));
    expect(pb[0]!.height + pb[1]!.height).toBeCloseTo(pb[2]!.height + pb[3]!.height, 6);
  });

  it("draws lines through points edge to edge as a polyline and a smooth curve in the 1406 byte 13 colour", () => {
    const chart = chartWith(DocumentType.XY, [
      PLOT,
      leaf(1406, [0, 1, 2, 1, 2, 1, 1, 1, 0, 21, 1, 1, 15, 26, 0]),
      value(0, 0, 10),
      value(0, 1, 30),
      value(0, 2, 20),
    ]);
    const { elements } = draw(chart);
    const lines = paths(elements).filter((p) => p.stroke === role(26));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.smooth).toBe(true);
    expect(lines[0]!.points).toHaveLength(3);
    const frame = rects(elements)[0]!;
    expect(lines[0]!.points[0]!.x).toBeCloseTo(frame.x, 6);
    expect(lines[0]!.points[2]!.x).toBeCloseTo(frame.x + frame.width, 6);
  });

  it("samples a spline through the points for curve series", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const s = splinePoints(pts);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[2]);
    expect(s.length).toBeGreaterThan(pts.length);
  });

  it("draws a 3-D chart: walls offset by the depth, bars as 3-D boxes in their lane", () => {
    const { elements } = draw(clusterChart([options({ threeD: true })]));
    const back = rects(elements)[0]!;
    const floor = paths(elements)[0]!;
    // Floor corners: back-left, back-right, front-right, front-left; the back is offset up and right by 15 % of the frame height.
    const [bL, , , fL] = floor.points;
    const d = bL!.x - fL!.x;
    expect(-(bL!.y - fL!.y)).toBeCloseTo(d, 6);
    expect(back.x).toBeCloseTo(bL!.x, 6);
    const bars = rects(elements).filter((r) => r.stroke === role(ROLE.Outlines));
    expect(bars).toHaveLength(4);
    const faces = paths(elements).filter((p) => p.fill === shadeCss(role(21), BOX_3D_TOP_SHADE) || p.fill === shadeCss(role(21), BOX_3D_SIDE_SHADE));
    expect(faces).toHaveLength(4);
  });

  it("orders 3-D lanes lines in front, then bars, then areas", () => {
    const data = chartWith(DocumentType.XY, [series(0, 1), series(1, 2), series(2, 3)]);
    const { context } = createChartSceneContext(data, undefined);
    void context;
    const s = [0, 1, 2].map((i) => ({ index: i, type: (["bar", "line", "area"] as const)[i]! }));
    const groups = seriesGroups(s as never, { threeD: true, barMode: "cluster", areaMode: "overlap" } as never);
    expect(groups.map((g) => g.kind)).toEqual(["area", "bars", "line"]);
  });

  it("lays out the legend in its 810 area, bottom-up for stacked bars when 1418 byte 1 = 2", () => {
    const legend = area(810, 10000, -4000, 15000, 2000);
    const { elements } = draw(clusterChart([legend, options({ bar: 3 }), leaf(1418, [1, 2, 5, 2, 14, 20])]));
    const box = rects(elements).find((r) => r.fill === role(ROLE.Legend))!;
    expect(box.x).toBe(10000);
    const names = texts(elements).filter((t) => t.text === "North" || t.text === "South");
    expect(names.map((t) => t.text)).toEqual(["South", "North"]);
    const swatches = rects(elements).filter((r) => r.x > 10000 && r.width < 1000);
    expect(swatches.map((r) => r.fill)).toEqual([role(22), role(21)]);
    // Series names are size 4 here (the test text tail).
    expect(swatches[0]!.width).toBeCloseTo(XY_LEGEND_SWATCH * lineBoxHeight(createChartSceneContext(clusterChart(), undefined).context, 4), 6);
  });

  it("draws a data table with one row per series under the frame (1410 byte 0 = 2), with swatches when the legend is off", () => {
    const { elements } = draw(clusterChart([leaf(1410, [2, 1, 2]), leaf(1418, [2, 2, 5, 2, 14, 20])]));
    const cells = texts(elements).map((t) => t.text);
    expect(cells).toEqual(expect.arrayContaining(["10", "28", "15", "103", "North", "South"]));
    const table = rects(elements).find((r) => r.stroke === role(ROLE.Frame) && r.fill === role(ROLE.FrameBkg))!;
    expect(table.y + table.height).toBeCloseTo(-(-11000 + XY_FRAME_BOTTOM_MARGIN * H), 6);
  });

  it("draws high/low/close series as I bars with a close tick (1408 byte 11 = 3)", () => {
    const chart = chartWith(DocumentType.XY, [
      PLOT,
      options({ hl: 3 }),
      series(0, 4),
      series(1, 5),
      leaf(1406, [2, 1, 6, 1, 2, 1, 1, 1, 2, 23, 1, 1, 0, 26, 3]),
      value(0, 0, 30),
      value(1, 0, 10),
      value(2, 0, 20),
    ]);
    const { elements } = draw(chart);
    expect(paths(elements).filter((p) => p.stroke === role(21))).toHaveLength(3);
    const close = paths(elements).filter((p) => p.stroke === role(26));
    expect(close).toHaveLength(1);
    expect(close[0]!.points[0]!.y).toBeCloseTo(close[0]!.points[1]!.y, 6);
  });

  it("draws cylinders as a band and a shaded top ellipse", () => {
    const { elements } = draw(clusterChart([options({ threeD: true, shape: 4 })]));
    expect(elements.filter((e): e is BandElement => e.kind === "band")).toHaveLength(4);
    expect(elements.filter((e) => e.kind === "ellipse")).toHaveLength(4);
  });

  it("is drawn by buildChartScene for a chart without a drawn copy, and nothing is left undrawn", () => {
    const chart = clusterChart();
    expect(notYetDrawn(chart)).toEqual([]);
    const { scene } = buildChartScene(chart, undefined);
    expect(texts(scene.elements).map((t) => t.text)).toEqual(expect.arrayContaining(["Q1", "120"]));
    // A log Y1 axis (1402 byte 1 = 2) labels decades, with the thousands separator (byte 74 not No).
    const log = draw(clusterChart([axis(1, {}, 2)])).elements;
    expect(texts(log).map((t) => t.text)).toEqual(expect.arrayContaining(["10", "100", "1,000"]));
  });
});
