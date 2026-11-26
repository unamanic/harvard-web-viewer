import { describe, expect, it } from "vitest";
import type { BandElement, PathElement, RectElement, SceneElement, TextElement } from "../../../types";
import { PIE_3D_DEPTH, PIE_3D_RADIUS_OF_HEIGHT, PIE_3D_RADIUS_OF_WIDTH, PIE_3D_TILT, PIE_EXPLODE_DISTANCE, PIE_LABEL_LEADER } from "../../assumptions";
import type { Chart } from "../../chart";
import { DocumentType } from "../../container";
import { chartWith, textLine, textTail } from "../../data/testing";
import { DEFAULT_PALETTE, ROLE, colorForRole, rgbToCss } from "../../palette";
import { type RecordSpec, concat, f32, f64, i16, leaf, padded, u16, u8 } from "../../testing/bytes";
import { buildChartScene, notYetDrawn } from "../buildChartScene";
import { createChartSceneContext } from "../context";
import { drawOrgChart, lastLevelIsList, orgStyle, storedBoxSize } from "./org";
import { PIE_305_3D_RADIUS, PIE_305_EXPLODED_SCALE, PIE_305_RADIUS_1_LINE, PIE_305_RADIUS_2_LINES, drawPieChart, labelBoxPosition, percentText, wallShade } from "./pie";

const role = (r: number): string => rgbToCss(colorForRole(DEFAULT_PALETTE, r)!);
const area = (tag: number, x1: number, y1: number, x2: number, y2: number) =>
  leaf(tag, concat(i16(x1), i16(y1), i16(x2), i16(y2), u16(0)));
/** Plot area 32000 × 20000 centred on y = −1000. */
const PLOT = area(806, -16000, -11000, 16000, 9000);

function draw(chart: Chart, fn: typeof drawPieChart) {
  const { context, warnings } = createChartSceneContext(chart, undefined);
  return { elements: fn(context), warnings };
}
const paths = (els: SceneElement[]) => els.filter((e): e is PathElement => e.kind === "path");
const texts = (els: SceneElement[]) => els.filter((e): e is TextElement => e.kind === "text");
const rects = (els: SceneElement[]) => els.filter((e): e is RectElement => e.kind === "rect");
const deg = (p: { x: number; y: number }, c: { x: number; y: number }) => (Math.atan2(-(p.y - c.y), p.x - c.x) * 180) / Math.PI;

// ---------------------------------------------------------------------------
// Pie
// ---------------------------------------------------------------------------

function slice(pie: number, n: number, value: number, label: string, explode = 2): RecordSpec {
  return leaf(1316, concat([pie, n, explode, 21 + n, n], f32(value), padded(label, 23)));
}
function pieOptions(pie: number, style = 1, names = 1): RecordSpec {
  return leaf(1310, concat([pie, 1, style, 2, 2], f32(30), new Uint8Array(4), f32(100), u8(names)));
}
const flat1304 = leaf(1304, [2, 2, 2, 2, 1, 0x20, 0x12]);
const linked1304 = leaf(1304, [2, 2, 1, 2, 1, 0x20, 0x12]);
/** 1312: show percents (Yes/No), place, decimals, leading, trailing. */
function percents(pie: number, show = 1, place = 1, decimals = 0, leading = "", trailing = ""): RecordSpec {
  return leaf(1312, concat([pie, show, place], u16(decimals), padded(leading, 13), padded(trailing, 13)));
}
/** 1314: show values, place, currency, decimals (null = blank), thousands, scale, leading, trailing. */
function values(pie: number, o: { show?: number; place?: number; currency?: number; decimals?: number | null; thousands?: number; scale?: number; leading?: string; trailing?: string } = {}): RecordSpec {
  const dec = o.decimals === undefined || o.decimals === null ? Uint8Array.from([0, 0, 0xf0, 0xff]) : f32(o.decimals);
  return leaf(1314, concat([pie, o.show ?? 1, o.place ?? 1, o.currency ?? 2], dec, [o.thousands ?? 2], f64(o.scale ?? 1), padded(o.leading ?? "", 13), padded(o.trailing ?? "", 13)));
}
/** 1310 with every byte given. */
function pieOptionsFull(pie: number, o: { show?: number; showAs?: number; sort?: number; pointer?: number; depth?: number; angle?: number; size?: number; labels?: number } = {}): RecordSpec {
  return leaf(1310, concat([pie, o.show ?? 1, o.showAs ?? 1, o.sort ?? 2, o.pointer ?? 2], f32(o.depth ?? 30), f32(o.angle ?? 0), f32(o.size ?? 100), u8(o.labels ?? 1)));
}
const threeD1304 = leaf(1304, [2, 1, 2, 2, 1, 0x20, 0x12]);
const proportional1304 = leaf(1304, [2, 2, 2, 1, 1, 0x20, 0x12]);

describe("drawPieChart", () => {
  it("draws slices from values, counter-clockwise from 0°, outlined in role Outlines", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptions(0), slice(0, 0, 50, "A"), slice(0, 1, 30, "B"), slice(0, 2, 20, "C")]);
    const { elements } = draw(chart, drawPieChart);
    const slices = paths(elements).filter((p) => p.closed);
    expect(slices).toHaveLength(3);
    const r = Math.trunc(PIE_305_RADIUS_2_LINES * 20000);
    for (const [i, s] of slices.entries()) {
      expect(s.fill).toBe(role(21 + i));
      expect(s.stroke).toBe(role(ROLE.Outlines));
      expect(s.points[0]).toEqual({ x: 0, y: 1000 }); // centre (0, −1000) in page units
      expect(Math.hypot(s.points[1]!.x, s.points[1]!.y - 1000)).toBeCloseTo(r, 3);
    }
    expect(deg(slices[0]!.points[1]!, slices[0]!.points[0]!)).toBeCloseTo(0, 6);
    expect(deg(slices[1]!.points[1]!, slices[1]!.points[0]!)).toBeCloseTo(180, 6);
    expect(deg(slices[2]!.points[1]!, slices[2]!.points[0]!)).toBeCloseTo(-72, 6); // 288°
    // Without 1312 / 1314 the 3.05 defaults apply: name over value, no percent.
    expect(texts(elements).map((t) => t.text)).toEqual(["A", "50", "B", "30", "C", "20"]);
    // Leaders run from the rim to 1.1 × the radius along the slice middle (90° for A).
    const leaders = paths(elements).filter((p) => !p.closed);
    expect(leaders).toHaveLength(3);
    expect(leaders[0]!.points[0]!.x).toBeCloseTo(0, 6);
    expect(leaders[0]!.points[0]!.y).toBeCloseTo(1000 - r, 6);
    expect(leaders[0]!.points[1]!.y).toBeCloseTo(1000 - PIE_LABEL_LEADER * r, 6);
    expect(leaders[0]!.stroke).toBe(role(ROLE.XLabel));
  });

  it("shrinks a pie with an exploded slice and moves the slice out along its middle", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, slice(0, 0, 50, "A"), slice(0, 1, 50, "B", 1)]);
    const slices = paths(draw(chart, drawPieChart).elements).filter((p) => p.closed);
    const r = Math.trunc(PIE_305_RADIUS_2_LINES * 20000 * PIE_305_EXPLODED_SCALE);
    expect(slices[0]!.points[0]).toEqual({ x: 0, y: 1000 });
    // B spans 180° to 360°: middle 270°, straight down on the page.
    expect(slices[1]!.points[0]!.x).toBeCloseTo(0, 6);
    expect(slices[1]!.points[0]!.y).toBeCloseTo(1000 + PIE_EXPLODE_DISTANCE * r, 6);
  });

  it("draws 3-D pies as tilted tops over shaded walls and front bands", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, threeD1304, slice(0, 0, 25, "A"), slice(0, 1, 75, "B")]);
    const { elements } = draw(chart, drawPieChart);
    const bands = elements.filter((e): e is BandElement => e.kind === "band");
    // 3.05: the width radius is 0.44 × the plot height (PM3D), capped by the column width as before.
    const rx = Math.trunc(Math.min(PIE_305_3D_RADIUS * 20000, PIE_3D_RADIUS_OF_WIDTH * (PIE_305_3D_RADIUS / PIE_3D_RADIUS_OF_HEIGHT) * 32000));
    expect(bands).toHaveLength(1); // only B reaches the front (180° to 360°)
    expect(bands[0]).toMatchObject({ rx, ry: Math.trunc(PIE_3D_TILT * rx), depth: Math.trunc(PIE_3D_DEPTH * rx), startAngle: 180, endAngle: 360 });
    const walls = paths(elements).filter((p) => p.closed && p.points.length === 4);
    // A's start wall (0°, right half) and A's end wall at 90° (cos 0: neither side) → one wall.
    expect(walls).toHaveLength(1);
    // Sides come before the tops.
    const firstTop = elements.findIndex((e) => e.kind === "path" && e.closed && e.points.length > 4);
    expect(elements.indexOf(bands[0]!)).toBeLessThan(firstTop);
  });

  it("sizes the pie by its label lines as 3.05 does on every page: 0.34, 0.40 with one line (PMBASE, PMVADJ)", () => {
    const radius = (o: RecordSpec[]) => {
      const s = paths(draw(chartWith(DocumentType.Pie, [PLOT, flat1304, ...o, slice(0, 0, 50, "A"), slice(0, 1, 50, "B")]), drawPieChart).elements).filter((p) => p.closed)[0]!;
      return Math.hypot(s.points[1]!.x - s.points[0]!.x, s.points[1]!.y - s.points[0]!.y);
    };
    expect(radius([pieOptionsFull(0)])).toBeCloseTo(Math.trunc(PIE_305_RADIUS_2_LINES * 20000), 3);
    // Labels off: only the value line remains.
    expect(radius([pieOptionsFull(0, { labels: 2 })])).toBeCloseTo(Math.trunc(PIE_305_RADIUS_1_LINE * 20000), 3);
  });

  it("fills slices by fill style: pattern 0 solid, other patterns left open (PFILLP, PFILLB, PPATC, PBCOL)", () => {
    // Slice n carries pattern n (1316 byte 4): A solid, B patterned.
    const look = (fillStyle: number) =>
      paths(draw(chartWith(DocumentType.Pie, [PLOT, leaf(1304, [2, 2, 2, 2, fillStyle, 0x20, 0x12]), slice(0, 0, 50, "A"), slice(0, 1, 50, "B")]), drawPieChart).elements)
        .filter((p) => p.closed)
        .map((p) => [p.fill, p.stroke]);
    const white = "#ffffff";
    expect(look(1)).toEqual([[role(21), role(ROLE.Outlines)], [role(22), role(ROLE.Outlines)]]);
    // Pattern: white pattern colour and outline, the slice colour ignored.
    expect(look(2)).toEqual([[white, white], [null, white]]);
    // Both: the slice colour as the pattern colour, the usual outline.
    expect(look(3)).toEqual([[role(21), role(ROLE.Outlines)], [null, role(ROLE.Outlines)]]);
  });

  it("shades walls like the copies' 0x112A brightness", () => {
    expect(wallShade(0)).toBeCloseTo(0.9);
    expect(wallShade(342.9)).toBeCloseTo(0.86);
    expect(wallShade(257.2)).toBeCloseTo(0.19);
    expect(wallShade(102.9)).toBeCloseTo(0.15);
    expect(wallShade(34.3)).toBeCloseTo(0.55);
    expect(wallShade(377.2)).toBeCloseTo(0.85); // unnormalised angle: no back-wall factor
  });

  it("sizes proportional pies by √total and puts slot 5 titles under them", () => {
    const chart = chartWith(DocumentType.Pie, [
      PLOT,
      proportional1304,
      textLine(5, 0, 0, "Small"),
      textLine(5, 0, 1, "Big"),
      slice(0, 0, 25, "a"),
      slice(1, 0, 100, "b"),
    ]);
    const { elements } = draw(chart, drawPieChart);
    const tops = paths(elements).filter((p) => p.closed);
    const radius = (p: PathElement) => Math.max(...p.points.map((q) => Math.hypot(q.x - p.points[0]!.x, q.y - p.points[0]!.y)));
    // A full circle has no centre point; measure across instead.
    const across = (p: PathElement) => Math.max(...p.points.map((q) => q.x)) - Math.min(...p.points.map((q) => q.x));
    expect(across(tops[0]!) / across(tops[1]!)).toBeCloseTo(0.5, 2);
    expect(radius(tops[1]!)).toBeGreaterThan(0);
    const small = texts(elements).find((t) => t.text === "Small")!;
    const big = texts(elements).find((t) => t.text === "Big")!;
    expect(small.anchor).toBe("middle"); // centred lines stay centred in their box under the pie
    expect(small.x).toBeCloseTo(-8000, 0);
    expect(big.x).toBeCloseTo(8000, 0);
    expect(small.y).toBeGreaterThan(9000); // bottom of the plot area (scene y down)
  });

  it("skips negative slices with a warning", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, slice(0, 0, -5, "neg"), slice(0, 1, 10, "pos")]);
    const { elements, warnings } = draw(chart, drawPieChart);
    expect(paths(elements).filter((p) => p.closed)).toHaveLength(1);
    expect(warnings.some((w) => /not drawn/.test(w))).toBe(true);
  });

  it("draws pie 2 shown as a column next to linked pie 1, which faces it with its cut slice", () => {
    const chart = chartWith(DocumentType.Pie, [
      PLOT,
      linked1304,
      pieOptions(0),
      pieOptions(1, 2),
      percents(1, 1, 2),
      values(1, { show: 2 }),
      slice(0, 0, 75, "x"),
      slice(0, 1, 25, "y", 1),
      slice(1, 0, 40, "North"),
      slice(1, 1, 60, "South"),
    ]);
    const { elements } = draw(chart, drawPieChart);
    const column = rects(elements);
    expect(column).toHaveLength(2);
    expect(column[0]!.fill).toBe(role(21));
    // From a quarter column left of the column centre (8000) to the centre; 0.75 of the plot height, bottom first.
    expect(column[0]!.x).toBeCloseTo(4000, 6);
    expect(column[0]!.width).toBeCloseTo(4000, 6);
    expect(column[0]!.height + column[1]!.height).toBeCloseTo(15000, 6);
    expect(column[0]!.y).toBeGreaterThan(column[1]!.y);
    expect(texts(elements).map((t) => t.text)).toContain("North  40%");
    // The exploded slice (y: 270° to 360°) is turned to face the column: centred on 0°.
    const pieTops = paths(elements).filter((p) => p.closed);
    expect(deg(pieTops[0]!.points[1]!, pieTops[0]!.points[0]!)).toBeCloseTo(45, 6);
    const connectors = paths(elements).filter((p) => !p.closed && p.stroke === role(ROLE.Lines));
    expect(connectors).toHaveLength(2);
    expect(connectors[0]!.points[1]!.x).toBeCloseTo(4000, 6);
  });

  it("drops slice names when 1310 byte 17 is No (PNOLAB; GALD291 with percents only)", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptions(0, 1, 2), slice(0, 0, 1, "A"), slice(0, 1, 2, "B")]);
    expect(texts(draw(chart, drawPieChart).elements).map((t) => t.text)).toEqual(["1", "2"]);
    const pct = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptions(0, 1, 2), percents(0), values(0, { show: 2 }), slice(0, 0, 1, "A"), slice(0, 1, 2, "B")]);
    expect(texts(draw(pct, drawPieChart).elements).map((t) => t.text)).toEqual(["33%", "67%"]);
    expect(percentText(60 / 210)).toBe("29%");
  });

  it("writes values and percents as 1312 / 1314 say (PPCT, PVALADJ, PVCURR, PVSCALE, PPCTL, PPCTT)", () => {
    const labelsOf = (...recs: RecordSpec[]) =>
      texts(draw(chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptions(0), ...recs, slice(0, 0, 40, "Alpha"), slice(0, 1, 60, "Beta")]), drawPieChart).elements).map((t) => t.text);
    expect(labelsOf(percents(0), values(0))).toEqual(["Alpha", "40  40%", "Beta", "60  60%"]);
    expect(labelsOf(percents(0, 2), values(0, { place: 2 }))).toEqual(["Alpha  40", "Beta  60"]);
    expect(labelsOf(values(0, { currency: 1, decimals: 2 }))).toEqual(["Alpha", "$40.00", "Beta", "$60.00"]);
    expect(labelsOf(values(0, { scale: 10, leading: "AB", trailing: "XY" }))).toEqual(["Alpha", "AB4XY", "Beta", "AB6XY"]);
    expect(labelsOf(percents(0, 1, 1, 1, "AB", "XY"), values(0, { show: 2 }))).toEqual(["Alpha", "AB40.0XY%", "Beta", "AB60.0XY%"]);
  });

  it("centres items placed Inside at 2/3 of the radius (PVALIN, PPCTPI)", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptions(0), values(0, { place: 3 }), slice(0, 0, 50, "A"), slice(0, 1, 50, "B")]);
    const { elements } = draw(chart, drawPieChart);
    const r = Math.trunc(PIE_305_RADIUS_2_LINES * 20000);
    const inside = texts(elements).find((t) => t.text === "50")!;
    // A spans 0° to 180°: its middle is straight up from the centre (0, −1000).
    expect(inside.anchor).toBe("middle");
    expect(inside.x).toBeCloseTo(0, 6);
    expect(texts(elements).map((t) => t.text)).toEqual(["50", "A", "50", "B"]);
    expect(-inside.y).toBeGreaterThan(-1000 + (2 / 3) * r - 1000);
    expect(-inside.y).toBeLessThan(-1000 + (2 / 3) * r + 1000);
  });

  it("starts at the 1310 angle, sorts largest first keeping colours, and sizes by area (PANG45, PUNSSRT, PSIZE50)", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptionsFull(0, { angle: 45, sort: 1, size: 50 }), slice(0, 0, 10, "a"), slice(0, 1, 40, "b"), slice(0, 2, 50, "c")]);
    const slices = paths(draw(chart, drawPieChart).elements).filter((p) => p.closed);
    expect(slices.map((s) => s.fill)).toEqual([role(23), role(22), role(21)]);
    expect(deg(slices[0]!.points[1]!, slices[0]!.points[0]!)).toBeCloseTo(45, 6);
    expect(deg(slices[1]!.points[1]!, slices[1]!.points[0]!)).toBeCloseTo(-135, 6); // 45 + 180 = 225°
    const r = Math.trunc(PIE_305_RADIUS_2_LINES * 20000 * Math.SQRT1_2);
    expect(Math.hypot(slices[0]!.points[1]!.x, slices[0]!.points[1]!.y - 1000)).toBeCloseTo(r, 3);
  });

  it("skips pies whose Show pie is No, and draws the slice pointer as 1310 byte 4 says (PNOPIE, PPTRN, PPTRL)", () => {
    const hidden = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptionsFull(0, { show: 2 }), slice(0, 0, 1, "a")]);
    expect(draw(hidden, drawPieChart).elements).toEqual([]);
    const none = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptionsFull(0, { pointer: 1 }), slice(0, 0, 1, "a"), slice(0, 1, 1, "b")]);
    expect(paths(draw(none, drawPieChart).elements).filter((p) => !p.closed)).toEqual([]);
    const long = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptionsFull(0, { pointer: 4 }), slice(0, 0, 1, "a"), slice(0, 1, 1, "b")]);
    const leaders = paths(draw(long, drawPieChart).elements).filter((p) => !p.closed);
    const r = Math.trunc(PIE_305_RADIUS_2_LINES * 20000);
    expect(leaders[0]!.points).toHaveLength(3);
    // a's middle is 90°: the tail runs right, 0.3 × the radius, at the leader end's height.
    expect(leaders[0]!.points[2]!.x - leaders[0]!.points[1]!.x).toBeCloseTo(0.3 * r, 6);
    expect(leaders[0]!.points[2]!.y).toBeCloseTo(leaders[0]!.points[1]!.y, 6);
  });

  it("draws a lone column centred in its slot with leaders to its labels (PCOLUMN)", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, pieOptionsFull(0, { showAs: 2 }), slice(0, 0, 25, "A"), slice(0, 1, 75, "B")]);
    const { elements } = draw(chart, drawPieChart);
    const boxes = rects(elements);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.x).toBeCloseTo(-4000, 6); // 0.25 × 32000 wide, centred on x = 0
    expect(boxes[0]!.width).toBeCloseTo(8000, 6);
    expect(boxes[0]!.height + boxes[1]!.height).toBeCloseTo(15000, 6); // 0.75 × the plot height
    const leaders = paths(elements).filter((p) => !p.closed);
    expect(leaders).toHaveLength(2);
    expect(leaders[0]!.points[0]!.x).toBeCloseTo(4000, 6);
    expect(leaders[0]!.points[1]!.x).toBeCloseTo(4800, 6); // 0.1 × the column width
    expect(texts(elements).map((t) => t.text)).toEqual(["A", "25", "B", "75"]);
  });

  it("uses the 3.05 test-chart sizes on a Letter page (PBASE, PNOLAB, PCUT2)", () => {
    const letter = leaf(816, concat([1, 1], f32(11), f32(8.5)));
    const radius = (...recs: RecordSpec[]) => {
      const tops = paths(draw(chartWith(DocumentType.Pie, [PLOT, letter, flat1304, ...recs]), drawPieChart).elements).filter((p) => p.closed);
      return Math.max(...tops.map((t) => Math.max(...t.points.map((q) => Math.hypot(q.x - t.points[0]!.x, q.y - t.points[0]!.y)))));
    };
    expect(radius(pieOptions(0), slice(0, 0, 1, "a"), slice(0, 1, 1, "b"))).toBeCloseTo(Math.trunc(0.34 * 20000), 3);
    expect(radius(pieOptions(0, 1, 2), slice(0, 0, 1, "a"), slice(0, 1, 1, "b"))).toBeCloseTo(Math.trunc(0.4 * 20000), 3);
    expect(radius(pieOptions(0), slice(0, 0, 1, "a"), slice(0, 1, 1, "b", 1))).toBeCloseTo(Math.trunc(0.34 * 0.7 * 20000), 3);
  });

  it("places label boxes beside, above / below or at a corner of the leader end", () => {
    const end = { x: 100, y: 50 };
    expect(labelBoxPosition(5, end, 1000, 400, 25)).toEqual({ left: 125, top: 250, mode: "side" });
    expect(labelBoxPosition(180, end, 1000, 400, 25)).toMatchObject({ left: -925, mode: "side" });
    expect(labelBoxPosition(88, end, 1000, 400, 25)).toEqual({ left: -400, top: 450, mode: "vertical" });
    expect(labelBoxPosition(272, end, 1000, 400, 25)).toEqual({ left: -400, top: 50, mode: "vertical" });
    expect(labelBoxPosition(283, end, 1000, 400, 25)).toEqual({ left: 100, top: 50, mode: "corner" });
    expect(labelBoxPosition(135, end, 1000, 400, 25)).toEqual({ left: -900, top: 450, mode: "corner" });
    // From the 3.05 test charts: 333° and 18° beside, 72° centred above, 108° and 198° at a corner.
    expect(labelBoxPosition(333, end, 1000, 400, 25)).toMatchObject({ left: 125, top: 250, mode: "side" });
    expect(labelBoxPosition(18, end, 1000, 400, 25)).toMatchObject({ mode: "side" });
    expect(labelBoxPosition(27, end, 1000, 400, 25)).toEqual({ left: 100, top: 450, mode: "corner" });
    expect(labelBoxPosition(72, end, 1000, 400, 25)).toEqual({ left: -400, top: 450, mode: "vertical" });
    expect(labelBoxPosition(108, end, 1000, 400, 25)).toEqual({ left: -900, top: 450, mode: "corner" });
    expect(labelBoxPosition(198, end, 1000, 400, 25)).toEqual({ left: -900, top: 50, mode: "corner" });
    expect(labelBoxPosition(288 + 360, end, 1000, 400, 25)).toEqual({ left: 100, top: 50, mode: "corner" });
  });

  it("draws the 1306 legend in the legend area: frame, swatches and names (PLEG, PLEGL2)", () => {
    const legend = (location: number, x1: number, y1: number, x2: number, y2: number) =>
      draw(chartWith(DocumentType.Pie, [PLOT, area(810, x1, y1, x2, y2), flat1304, leaf(1306, [1, 2, location, 2, 14, 20]), slice(0, 0, 1, "Alpha"), slice(0, 1, 1, "Beta")]), drawPieChart).elements;
    const column = legend(5, 10000, -5000, 16000, 2000);
    const boxes = rects(column);
    expect(boxes[0]).toMatchObject({ x: 10000, y: -2000, width: 6000, height: 7000, fill: role(ROLE.Legend), stroke: role(ROLE.Frame) });
    expect(boxes.slice(1).map((b) => b.fill)).toEqual([role(21), role(22)]);
    expect(boxes[1]!.x).toBe(boxes[2]!.x); // one above the other
    expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y);
    const names = texts(column).filter((t) => t.text === "Alpha" || t.text === "Beta");
    expect(names.slice(-2).map((t) => t.anchor)).toEqual(["start", "start"]);
    const row = rects(legend(7, -400, -12000, 16000, -10000)).slice(1);
    expect(row[0]!.y).toBe(row[1]!.y); // side by side
    expect(row[1]!.x).toBeGreaterThan(row[0]!.x);
    // Off: nothing extra.
    const off = draw(chartWith(DocumentType.Pie, [PLOT, area(810, 0, 0, 100, 100), flat1304, leaf(1306, [2, 2, 5, 2, 14, 20]), slice(0, 0, 1, "A")]), drawPieChart).elements;
    expect(rects(off)).toHaveLength(0);
  });

  it("is drawn by buildChartScene when laid out from data", () => {
    const chart = chartWith(DocumentType.Pie, [PLOT, flat1304, slice(0, 0, 1, "A")]);
    expect(notYetDrawn(chart, "always")).toEqual([]);
    const els = buildChartScene(chart, undefined, { dataLayout: "always" }).scene.elements;
    expect(texts(els).map((t) => t.text)).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

function field(text: string, color = 4, size = 7): Uint8Array {
  return concat(u8(18), padded(text, 23), textTail(text.length, color, size), u8(0));
}
const link = (v?: number): Uint8Array => concat(u16(v === undefined ? 0 : 1), u16(v ?? 0));
interface BoxSpec {
  name: string;
  title?: string;
  x: number;
  y: number;
  level: number;
  index: number;
  parent?: number;
  first?: number;
  next?: number;
  kids?: number;
}
function orgBox(b: BoxSpec): RecordSpec {
  return leaf(
    914,
    concat(
      u8(3),
      field(b.name),
      field(b.title ?? "", 2),
      field("", 2),
      i16(b.x),
      i16(b.y),
      i16(0),
      i16(0),
      new Uint8Array(8),
      u16(b.level),
      u16(b.kids ?? 0),
      u16(0),
      u16(256),
      u16(1),
      u16(b.index),
      link(b.parent),
      link(b.first),
      link(b.next),
      link(),
      new Uint8Array(4),
    ),
  );
}
/** 912: box width and height as percentages of 24576. */
const size912 = (w: number, h: number) => leaf(912, concat(u8(1), f64(w), f64(h)));
const style910 = (style: number) => leaf(910, [style, 0x0f, 0x0e, 0x12, 2, 2, 1, 2, 2, 2, 2, 2]);
const list904 = (code: number) => leaf(904, concat(u16(1), u16(code), u16(1), u16(0), u16(1), u16(3)));

function orgChart(style: number, lastLevel: number): Chart {
  return chartWith(DocumentType.Organization, [
    PLOT,
    list904(lastLevel),
    style910(style),
    size912(25, 10),
    orgBox({ name: "Boss", title: "President", x: 0, y: 5000, level: 1, index: 0, first: 1, kids: 2 }),
    orgBox({ name: "Left", title: "VP", x: -6000, y: -1000, level: 2, index: 1, parent: 0, next: 2, first: 3, kids: 1 }),
    orgBox({ name: "Right", title: "VP", x: 6000, y: -1000, level: 2, index: 2, parent: 0 }),
    orgBox({ name: "Worker", x: -6000, y: -7000, level: 3, index: 3, parent: 1 }),
  ]);
}

describe("drawOrgChart", () => {
  it("reads the 910 style, 912 size and 904 last-level setting", () => {
    const chart = orgChart(6, 1);
    const { context } = createChartSceneContext(chart, undefined);
    void context;
    const data = { raw910: Uint8Array.from([6, 15, 14, 18]), raw912: concat(u8(1), f64(25), f64(10)), raw904: concat(u16(1), u16(3)) };
    expect(orgStyle(data)).toEqual({ boxStyle: 6, fillRole: 15, outlineRole: 14, lineRole: 18 });
    expect(storedBoxSize(data, 24576)).toEqual({ width: 6144, height: 2458 });
    expect(lastLevelIsList(data)).toBe(false);
    expect(lastLevelIsList({ raw904: concat(u16(1), u16(1)) })).toBe(true);
  });

  it("draws square boxes at the stored centres with connectors in role Lines", () => {
    const { elements } = draw(orgChart(2, 3), drawOrgChart);
    const boxes = rects(elements);
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toMatchObject({ x: -3072, y: -5000 - 1229, width: 6144, height: 2458, fill: role(15), stroke: role(14) });
    // "Worker" has only a name: half as tall.
    expect(boxes[3]!.height).toBe(1229);
    const lines = paths(elements);
    expect(lines.every((l) => l.stroke === role(ROLE.Lines))).toBe(true);
    // First child: from its top up to halfway, across to the parent and up to its bottom.
    expect(lines[0]!.points).toEqual([
      { x: -6000, y: 1000 - 1229 },
      { x: -6000, y: -Math.trunc((5000 - 1229 + (-1000 + 1229)) / 2) },
      { x: 0, y: -Math.trunc((5000 - 1229 + (-1000 + 1229)) / 2) },
      { x: 0, y: -(5000 - 1229) },
    ]);
    expect(lines[1]!.points).toHaveLength(3);
    // Three fields per box with their tails' colours; one text scale fits all boxes.
    const t = texts(elements);
    expect(t.map((e) => e.text)).toEqual(["Boss", "President", "Left", "VP", "Right", "VP", "Worker"]);
    expect(t[1]!.fill).toBe(role(2));
    expect(new Set(t.map((e) => e.size)).size).toBe(1);
    // The test tails are centred: lines centre in the box.
    expect(t[0]).toMatchObject({ x: 0, anchor: "middle" });
  });

  it("draws a drop shadow for 910 style 6 and moves the box up-left", () => {
    const { elements } = draw(orgChart(6, 3), drawOrgChart);
    const d = Math.trunc(0.1 * 2458);
    const [shadow, box] = rects(elements);
    expect(shadow!.fill).toBe(role(ROLE.Shadow));
    expect(box).toMatchObject({ x: -3072, y: -5000 - 1229, width: 6144 - d, height: 2458 - d });
    expect(shadow).toMatchObject({ x: -3072 + d, y: -5000 - 1229 + d });
  });

  it("rounds the corners for 910 style 4", () => {
    const box = rects(draw(orgChart(4, 3), drawOrgChart).elements)[0]!;
    expect(box.corners).toEqual({ kind: "rounded", radius: Math.trunc(0.1 * 2458) });
  });

  it("lists the last level under its parent when 904 says so", () => {
    const { elements } = draw(orgChart(2, 1), drawOrgChart);
    expect(rects(elements)).toHaveLength(3);
    const lines = paths(elements);
    const tick = lines.find((l) => l.points.length === 2 && l.points[0]!.y === l.points[1]!.y && l.points[0]!.y === 7000)!;
    expect(tick.points[0]!.x).toBe(-6000 - 3072);
    expect(tick.points[1]!.x).toBeCloseTo(-6000 - 3072 + 6144 / 16, 6);
    expect(texts(elements).map((e) => e.text)).toContain("Worker");
  });

  it("is drawn by buildChartScene when laid out from data", () => {
    const chart = orgChart(2, 3);
    expect(notYetDrawn(chart, "always")).toEqual([]);
    const els = buildChartScene(chart, undefined, { dataLayout: "always" }).scene.elements;
    expect(texts(els).map((t) => t.text)).toContain("Worker");
  });
});
