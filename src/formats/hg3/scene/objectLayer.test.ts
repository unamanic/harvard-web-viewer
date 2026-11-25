import { describe, expect, it } from "vitest";
import {
  DEFAULT_STROKE_WIDTH,
  type GroupElement,
  type ParseContext,
  type ResolvedFile,
  type SceneElement,
  type TextElement,
} from "../../types";
import {
  BOX_3D_SIDE_SHADE,
  BOX_3D_TOP_SHADE,
  DATA_ROW_OVERLAP,
  DATA_TEXT_BOX_FACTOR,
  DATA_TEXT_BOX_STEP,
  OBJECT_TEXT_ASCENT,
  SHADOW_BOX_ROLE,
  lineWidthFor,
  textSizeToUnits,
} from "../assumptions";
import { parseChart } from "../chart";
import { DocumentType, readContainer } from "../container";
import { DEFAULT_PALETTE, colorForRole, rgbToCss } from "../palette";
import { type ByteSource, type RecordSpec, block, buildDocument, concat, cstr, f32, i16, leaf, u16 } from "../testing/bytes";
import { buildChartScene } from "./buildChartScene";
import { createChartSceneContext } from "./context";
import {
  BEZIER_SEGMENTS,
  HIT_AREA_FILL,
  PIE_SLICE_STEP_DEGREES,
  composeTransforms,
  drawObjectLayer,
  flippedMatrix,
  pieSlicePoints,
  shadeCss,
  storedLineLayout,
  textBlockLines,
} from "./objectLayer";
import { type TextBlockShape, decodeShape } from "../objects";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const role = (r: number): string => rgbToCss(colorForRole(DEFAULT_PALETTE, r)!);
const box = (x1: number, y1: number, x2: number, y2: number): Uint8Array => concat(i16(x1), i16(y1), i16(x2), i16(y2));
const sub = (tag: number, data: ByteSource): Uint8Array => concat(u16(tag), u16(data.length), data);
const END = sub(0x1fff, []);
const transform = (t: number[]): RecordSpec => leaf(616, concat(...t.map(f32)));
const pts = (...p: number[]): Uint8Array => concat(...p.map(i16));

const line = (color: number, style = 1) => sub(0x1100, [color, style, 0, 0]);
const lineRgb = (r: number, g: number, b: number) => sub(0x1100, [0xff, r, g, b]);
const fill = (color: number) => sub(0x110b, [color, 0, 0, 0]);
const fillRgb = (r: number, g: number, b: number) => sub(0x110b, [0xff, r, g, b]);
const boxShape = (style: number, corner: number, x1: number, y1: number, x2: number, y2: number) =>
  sub(0x1071, concat(u16(style), u16(corner), box(x1, y1, x2, y2)));
const ellipse = (cx: number, cy: number, rx: number, ry: number) => sub(0x1021, pts(cx, cy, rx, ry));
/** 0x1031 with arc style 0 (never seen in the samples): an open arc. */
const arc = (cx: number, cy: number, rx: number, ry: number, s: number, e: number, style = 0) =>
  sub(0x1031, concat(pts(cx, cy, rx, ry), u16(style), i16(s), i16(e)));
/** 0x1031 with style 1, as in every sample: a pie slice. */
const pieSlice = (cx: number, cy: number, rx: number, ry: number, s: number, e: number) => arc(cx, cy, rx, ry, s, e, 1);
const shade = (percent: number) => sub(0x112a, u16(percent));
const band = (cx: number, cy: number, rx: number, ry: number, s: number, e: number, depth: number) =>
  sub(0x1041, concat(pts(cx, cy, rx, ry), i16(s), i16(e), u16(depth)));
/** Point list with parts (0x1050 layout). */
const counted = (tag: number, parts: number[][]) => {
  const all = parts.flat();
  return sub(tag, concat(u16(all.length / 2), u16(parts.length), ...parts.map((p) => u16(p.length / 2)), pts(...all)));
};

/** 22-byte text tail (SPEC §5.3). */
function tail(len: number, color: number, size: number, just: number, raw4 = 0): Uint8Array {
  return concat(u16(len), u16(color), u16(raw4), u16(color & 0xff), u16(0), f32(size), u16(just), u16(3), u16(3), u16(0x4268));
}
function run(text: string, color = 1, size = 4, just = 1, raw4 = 0): Uint8Array {
  const s = cstr(text);
  return concat(s, s.length % 2 ? [0] : [], tail(text.length, color, size, just, raw4));
}
/** Stored layout of a line entry: box top and bottom below the extent's top, and em (all 0: none). */
type EntryLayout = [top: number, bottom: number, em: number];
/** 28-byte line entry: start at 4, length at 8, stored layout at 14, 18 and 26. */
function lineEntry(start: number, length: number, [top, bottom, em]: EntryLayout = [0, 0, 0]): Uint8Array {
  return concat([1, 0x81, 0, 0], u16(start), u16(0), [length], new Uint8Array(5), i16(top), u16(0), i16(bottom), new Uint8Array(6), u16(em));
}
/** Text block with the frame at 38 and the text extent at 62. */
function textBlock(
  runs: Uint8Array[],
  lines: [number, number, EntryLayout?][],
  frame: number[],
  extent: number[],
): Uint8Array {
  const headerLength = 82 + 28 * lines.length;
  const body = concat(...runs);
  return concat(
    u16(headerLength),
    u16(headerLength + body.length - 22),
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 3],
    u16(lines.reduce((n, [, l]) => n + l, 0)),
    u16(runs.length),
    new Uint8Array(8),
    [1, 0, 1, 0],
    new Uint8Array(8),
    box(frame[0]!, frame[1]!, frame[2]!, frame[3]!), // 38
    new Uint8Array(8),
    box(frame[0]!, frame[1]!, frame[2]!, frame[3]!), // 54
    box(extent[0]!, extent[1]!, extent[2]!, extent[3]!), // 62
    box(extent[0]!, extent[1]!, extent[2]!, extent[3]!), // 70
    u16(0),
    u16(lines.length),
    ...lines.map(([start, length, layout]) => lineEntry(start, length, layout)),
    body,
  );
}

function object612(subs: Uint8Array[], bbox = [0, 0, 10, 10]): RecordSpec {
  return leaf(612, concat(box(bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!), new Uint8Array(8), ...subs, END));
}
function obj(subs: Uint8Array[], t?: number[], bbox?: number[]): RecordSpec[] {
  return [...(t ? [transform(t)] : []), object612(subs, bbox)];
}

function chartWith(objects: RecordSpec[], type: number = DocumentType.Drawing) {
  const bytes = buildDocument("HGB3", type, [
    block(500, [leaf(400, cstr("demo"))]),
    block(504, [block(516, objects, new Uint8Array(16)), block(508, [])]),
  ]);
  return parseChart(readContainer(bytes)).chart;
}

function draw(objects: RecordSpec[], ctx?: ParseContext): { elements: SceneElement[]; warnings: string[] } {
  const { context, warnings } = createChartSceneContext(chartWith(objects), ctx);
  return { elements: drawObjectLayer(context), warnings };
}

function fakeContext(files: Record<string, Uint8Array>): ParseContext & { asked: string[] } {
  const asked: string[] = [];
  return {
    path: "A.CH3",
    asked,
    resolve(name: string, purpose?: string): ResolvedFile | null {
      asked.push(`${name}:${purpose}`);
      const base = name.replace(/^.*[\\/:]/, "").toUpperCase();
      const key = Object.keys(files).find((k) => k.toUpperCase() === base);
      return key ? { path: key, name: key, bytes: files[key]! } : null;
    },
  };
}

/** 2 × 1 pixel, 1 bit per pixel PCX (white, black). */
function tinyPcx(): Uint8Array {
  const h = new Uint8Array(128);
  h.set([0x0a, 5, 1, 1]);
  h[8] = 1; // xmax
  h[65] = 1;
  h[66] = 2; // bytes per line
  h[68] = 1;
  return concat(h, [0x80, 0x00]);
}

const ROT90 = [0, -1, 1, 0, 100, 200]; // a = d = 0, b < 0, c > 0: page (x, y) = (y + 100, −x + 200)

const group = (el: SceneElement | undefined): GroupElement => {
  if (el?.kind !== "group") throw new Error(`expected a group, got ${el?.kind}`);
  return el;
};
const text = (el: SceneElement | undefined): TextElement => {
  if (el?.kind !== "text") throw new Error(`expected text, got ${el?.kind}`);
  return el;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transform helpers", () => {
  it("composes outer after inner", () => {
    const t = composeTransforms([2, 0, 0, 2, 10, 20], [0, -1, 1, 0, 1, 2]);
    // inner (1, 0) → (1, 1); outer → (12, 22)
    expect(t[0] * 1 + t[2] * 0 + t[4]).toBe(12);
    expect(t[1] * 1 + t[3] * 0 + t[5]).toBe(22);
  });

  it("conjugates by the y flip", () => {
    expect(flippedMatrix([1, 2, 3, 4, 5, 6])).toEqual([1, -2, -3, 4, 5, -6]);
  });
});

describe("drawObjectLayer: shapes", () => {
  it("draws a filled, outlined box as a rect with the y flip", () => {
    const { elements } = draw(obj([line(32, 2), fill(21), boxShape(1, 500, -100, 50, 300, 250)]));
    expect(elements).toEqual([
      { kind: "rect", x: -100, y: -250, width: 400, height: 200, fill: role(21), stroke: role(32), strokeWidth: lineWidthFor(2) },
    ]);
    expect(lineWidthFor(2)).toBe(2 * DEFAULT_STROKE_WIDTH);
  });

  it("rounds style 3 boxes, scaled with the transform", () => {
    const { elements } = draw(obj([line(32), boxShape(3, 100, 0, 0, 100, 100)], [2, 0, 0, 2, 0, 0]));
    expect(elements[0]).toMatchObject({ kind: "rect", x: 0, y: -200, width: 200, height: 200, corners: { kind: "rounded", radius: 200 } });
  });

  it("draws a style 5 box square over a drop shadow of the corner size, right and down, in role Shadow", () => {
    const { elements } = draw(obj([line(14), fill(21), boxShape(5, 50, 0, 0, 400, 200)], [2, 0, 0, 2, 0, 0]));
    expect(elements).toEqual([
      { kind: "rect", x: 100, y: -300, width: 800, height: 400, fill: role(SHADOW_BOX_ROLE), stroke: null, strokeWidth: 0 },
      { kind: "rect", x: 0, y: -400, width: 800, height: 400, fill: role(21), stroke: role(14), strokeWidth: lineWidthFor(1) },
    ]);
  });

  it("draws a style 6 box as a 3-D box with shaded top and right faces the corner size deep", () => {
    const { elements } = draw(obj([line(32), fill(21), boxShape(6, 100, 0, 0, 400, 200)]));
    expect(elements).toHaveLength(3);
    const [topFace, side, front] = elements;
    expect(topFace).toMatchObject({
      kind: "path",
      closed: true,
      points: [{ x: 0, y: -200 }, { x: 400, y: -200 }, { x: 500, y: -300 }, { x: 100, y: -300 }],
      fill: shadeCss(role(21), BOX_3D_TOP_SHADE),
      stroke: role(32),
    });
    expect(side).toMatchObject({
      points: [{ x: 400, y: -0 }, { x: 500, y: -100 }, { x: 500, y: -300 }, { x: 400, y: -200 }],
      fill: shadeCss(role(21), BOX_3D_SIDE_SHADE),
    });
    expect(front).toMatchObject({ kind: "rect", x: 0, y: -200, width: 400, height: 200, fill: role(21) });
    expect(front).not.toHaveProperty("corners");
  });

  it("only outlines boxes whose sub-tag ends in 0 or 2", () => {
    const outlineBox = sub(0x1072, concat(u16(1), u16(0), box(0, 0, 10, 10)));
    const { elements } = draw(obj([line(14), sub(0x110b, [0xc4, 0, 0x33, 1]), outlineBox]));
    expect(elements[0]).toMatchObject({ kind: "rect", fill: null, stroke: role(14) });
  });

  it("fills closed shapes with 0x1100 when no 0x110B is set", () => {
    const { elements } = draw(obj([line(14), ellipse(10, 20, 30, 40)]));
    expect(elements).toEqual([
      { kind: "ellipse", cx: 10, cy: -20, rx: 30, ry: 40, fill: role(14), stroke: role(14), strokeWidth: DEFAULT_STROKE_WIDTH },
    ]);
  });

  it("fills a style 1 arc as a pie slice closed through the centre", () => {
    // 0° to 90° of a circle of radius 100 around (0, 50): (0, 50), (100, 50) … (0, 150).
    const { elements } = draw(obj([line(32), fill(21), pieSlice(0, 50, 100, 100, 0, 900)]));
    expect(elements).toHaveLength(1);
    const el = elements[0]!;
    if (el.kind !== "path") throw new Error(`expected a path, got ${el.kind}`);
    expect(el).toMatchObject({ closed: true, fill: role(21), stroke: role(32) });
    expect(el.points).toHaveLength(2 + 90 / PIE_SLICE_STEP_DEGREES);
    expect(el.points[0]).toEqual({ x: 0, y: -50 });
    expect(el.points[1]).toEqual({ x: 100, y: -50 });
    expect(el.points.at(-1)!.x).toBeCloseTo(0, 6);
    expect(el.points.at(-1)!.y).toBeCloseTo(-150, 6);
  });

  it("maps pie slices through any transform", () => {
    // ROT90: object (100, 0) → page (100, 100); centre (0, 0) → page (100, 200).
    const { elements } = draw(obj([line(32), fill(21), pieSlice(0, 0, 100, 100, 0, 900)], ROT90));
    const el = elements[0]!;
    if (el.kind !== "path") throw new Error("expected a path");
    expect(el.points[0]).toEqual({ x: 100, y: -200 });
    expect(el.points[1]!.x).toBeCloseTo(100, 6);
    expect(el.points[1]!.y).toBeCloseTo(-100, 6);
  });

  it("sweeps pie slices counter-clockwise across 0° and handles full and empty turns", () => {
    const at = (s: number, e: number) => ({ cx: 0, cy: 0, rx: 10, ry: 10, start: { tenths: s, degrees: s / 10 }, end: { tenths: e, degrees: e / 10 } });
    const wrap = pieSlicePoints(at(3300, 300)); // 330° → 30°: through 0°
    expect(wrap.slice(1).every((p) => p.x > 8)).toBe(true);
    expect(pieSlicePoints(at(900, 900))).toEqual([]);
    const full = pieSlicePoints(at(0, 3600));
    expect(full).toHaveLength(360 / PIE_SLICE_STEP_DEGREES);
    expect(full.every((p) => Math.abs(Math.hypot(p.x, p.y) - 10) < 1e-9)).toBe(true);
  });

  it("darkens fills by a 0x112A percentage, not outlines", () => {
    const { elements } = draw(obj([lineRgb(200, 100, 50), fillRgb(200, 100, 50), shade(50), boxShape(1, 0, 0, 0, 10, 10), shade(100), boxShape(1, 0, 0, 0, 10, 10)]));
    expect(elements.map((e) => e.kind === "rect" && [e.fill, e.stroke])).toEqual([
      ["#643219", "#c86432"],
      ["#c86432", "#c86432"],
    ]);
    expect(shadeCss("#ffffff", 0.15)).toBe("#262626");
    expect(shadeCss("red", 0.5)).toBe("red");
  });

  it("strokes open arcs only and keeps page-CCW angles", () => {
    const { elements } = draw(obj([line(18), fill(21), arc(0, 100, 50, 30, 0, 900)]));
    expect(elements).toEqual([
      { kind: "arc", cx: 0, cy: -100, rx: 50, ry: 30, startAngle: 0, endAngle: 90, fill: null, stroke: role(18), strokeWidth: DEFAULT_STROKE_WIDTH },
    ]);
  });

  it("fills bands and scales their depth", () => {
    const { elements } = draw(obj([line(32), fill(22), band(10, 10, 50, 30, 1800, 3600, 20)], [2, 0, 0, 3, 0, 0]));
    expect(elements[0]).toMatchObject({ kind: "band", cx: 20, cy: -30, rx: 100, ry: 90, startAngle: 180, endAngle: 360, depth: 60, fill: role(22) });
  });

  it("draws every part of a polyline as its own open path", () => {
    const { elements } = draw(obj([line(18), fill(21), counted(0x1050, [[0, 0, 10, 10], [20, 0, 30, 10, 40, 0]])]));
    expect(elements).toEqual([
      { kind: "path", points: [{ x: 0, y: -0 }, { x: 10, y: -10 }], closed: false, fill: null, stroke: role(18), strokeWidth: DEFAULT_STROKE_WIDTH },
      { kind: "path", points: [{ x: 20, y: -0 }, { x: 30, y: -10 }, { x: 40, y: -0 }], closed: false, fill: null, stroke: role(18), strokeWidth: DEFAULT_STROKE_WIDTH },
    ]);
  });

  it("closes polygons and smooths curves", () => {
    const { elements } = draw(
      obj([line(18), fill(21), counted(0x1061, [[0, 0, 10, 0, 5, 5]]), counted(0x1091, [[0, 0, 10, 0, 5, 5]]), counted(0x1080, [[0, 0, 10, 0, 5, 5]])]),
    );
    expect(elements.map((e) => e.kind === "path" && [e.closed, e.smooth ?? false, e.fill])).toEqual([
      [true, false, role(21)],
      [true, true, role(21)],
      [false, true, null],
    ]);
  });

  it("flattens 3k + 1 point curves as cubic Béziers", () => {
    // A quarter circle of radius 1000 from (1000, 0) to (0, 1000).
    const { elements } = draw(obj([line(18), counted(0x1080, [[1000, 0, 1000, 552, 552, 1000, 0, 1000]])]));
    const el = elements[0]!;
    if (el.kind !== "path") throw new Error("expected a path");
    expect(el.smooth).toBeUndefined();
    expect(el.points).toHaveLength(1 + BEZIER_SEGMENTS);
    expect(el.points[0]).toEqual({ x: 1000, y: -0 });
    expect(el.points.at(-1)).toEqual({ x: 0, y: -1000 });
    const mid = el.points[BEZIER_SEGMENTS / 2]!;
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1000, -1);
  });

  it("shows text in the HG3 character set", () => {
    // The default bullets of GALD111 (0xFA) and GALD131 (0xF9).
    // cstr writes char codes as bytes: "\u00fa" is the byte 0xFA.
    const data = textBlock([run("\u00fa", 16, 7, 3)], [[0, 1]], [0, 1000, 1000, 0], [0, 1000, 1000, 0]);
    expect(text(draw(obj([sub(0x10b0, data)])).elements[0]).text).toBe("\u2022");
    const arrow = textBlock([run("\u00f9 A\u00b5", 16, 7, 3)], [[0, 4]], [0, 1000, 1000, 0], [0, 1000, 1000, 0]);
    expect(text(draw(obj([sub(0x10b0, arrow)])).elements[0]).text).toBe("\u25ba A\u00c1");
  });

  it("keeps the byte codes of each text line", () => {
    const data = textBlock([run("\u00faA\nB\u00fd", 1, 4, 1)], [[0, 3], [3, 2]], [0, 2000, 4000, 0], [0, 2000, 4000, 0]);
    const parsed = decodeShape(0x10b0, data, "test", []) as TextBlockShape;
    expect([...parsed.runs[0]!.codes]).toEqual([0xfa, 0x41, 0x0a, 0x42, 0xfd]);
    expect(textBlockLines(parsed).map((l) => [l.text, [...l.codes]])).toEqual([
      ["\u2022A", [0xfa, 0x41]],
      ["B\u2212", [0x42, 0xfd]],
    ]);
    const unlaid = { ...parsed, lines: [] };
    expect(textBlockLines(unlaid).map((l) => [l.text, [...l.codes]])).toEqual([
      ["\u2022A", [0xfa, 0x41]],
      ["B\u2212", [0x42, 0xfd]],
    ]);
  });

  it("ends text lines at line breaks", () => {
    const data = textBlock([run("Apples\n29%", 1, 4, 1)], [[0, 7], [7, 3]], [0, 2000, 4000, 0], [0, 2000, 4000, 0]);
    expect(draw(obj([sub(0x10b0, data)])).elements.map((e) => text(e).text)).toEqual(["Apples", "29%"]);
  });

  it("draws a display list with each shape in its own state", () => {
    const { elements } = draw(obj([line(32), fill(21), boxShape(1, 0, 0, 0, 10, 10), fill(22), boxShape(1, 0, 20, 0, 30, 10), fill(0), boxShape(1, 0, 40, 0, 50, 10)]));
    expect(elements.map((e) => e.kind === "rect" && [e.x, e.fill, e.stroke])).toEqual([
      [0, role(21), role(32)],
      [20, role(22), role(32)],
      [40, null, role(32)],
    ]);
  });

  it("uses direct RGB colours", () => {
    const { elements } = draw(obj([lineRgb(1, 2, 3), fillRgb(0xff, 0x80, 0), boxShape(1, 0, 0, 0, 10, 10)]));
    expect(elements[0]).toMatchObject({ fill: "#ff8000", stroke: "#010203", strokeWidth: DEFAULT_STROKE_WIDTH });
  });

  it("fills with the first colour of a 0x1110 gradient", () => {
    const { elements } = draw(obj([line(32), sub(0x1110, [0xff, 10, 20, 30, 0xff, 1, 1, 1, 0, 0]), boxShape(1, 0, 0, 0, 10, 10)]));
    expect(elements[0]).toMatchObject({ fill: "#0a141e" });
  });

  it("draws nothing for a shape with neither line nor fill", () => {
    expect(draw(obj([boxShape(1, 0, 0, 0, 10, 10)])).elements).toEqual([]);
  });
});

describe("drawObjectLayer: rotated transforms", () => {
  it("keeps a box rotated by 90° as a rect", () => {
    // Object box (0, 0)–(40, 10) → page x = y + 100 ∈ [100, 110], page y = −x + 200 ∈ [160, 200].
    const { elements } = draw(obj([line(32), boxShape(1, 0, 0, 0, 40, 10)], ROT90));
    expect(elements[0]).toMatchObject({ kind: "rect", x: 100, y: -200, width: 10, height: 40 });
  });

  it("turns a box rotated by 45° into a closed 4-point path", () => {
    const c = Math.SQRT1_2;
    const { elements } = draw(obj([line(32), boxShape(1, 0, 0, 0, 10, 10)], [c, c, -c, c, 0, 0]));
    const el = elements[0]!;
    expect(el.kind).toBe("path");
    if (el.kind !== "path") return;
    expect(el.closed).toBe(true);
    // (10, 0) → page (7.07, 7.07) → scene (7.07, −7.07)
    expect(el.points[1]!.x).toBeCloseTo(7.071, 2);
    expect(el.points[1]!.y).toBeCloseTo(-7.071, 2);
  });

  it("swaps ellipse radii under a 90° rotation", () => {
    const { elements } = draw(obj([line(32), ellipse(10, 0, 30, 5)], ROT90));
    expect(elements[0]).toMatchObject({ kind: "ellipse", cx: 100, cy: -190, rx: 5, ry: 30 });
  });

  it("wraps a rotated arc in a group with F·M·F", () => {
    const { elements } = draw(obj([line(18, 2), arc(10, 20, 30, 40, 0, 900)], ROT90));
    const g = group(elements[0]);
    expect(g.transform).toEqual([0, 1, -1, 0, 100, -200]);
    expect(g.children[0]).toMatchObject({ kind: "arc", cx: 10, cy: -20, startAngle: 0, endAngle: 90, strokeWidth: lineWidthFor(2) });
    // The arc's start point in child space, (cx + rx, cy) = (40, −20), lands where the
    // page mapping puts the object point (40, 20): page (120, 160) → scene (120, −160).
    const [a, b, c, d, e, f] = g.transform!;
    expect([a * 40 + c * -20 + e, b * 40 + d * -20 + f]).toEqual([120, -160]);
  });

  it("rotates text with its object without mirroring it", () => {
    const data = textBlock([run("Up", 1, 4, 1)], [[0, 2]], [0, 1000, 2000, 0], [0, 1000, 2000, 0]);
    const { elements } = draw(obj([line(32), sub(0x10b0, data)], ROT90));
    const g = group(elements[0]);
    expect(g.transform).toEqual([0, 1, -1, 0, 100, -200]);
    const t = text(g.children[0]);
    const size = textSizeToUnits(4);
    expect(t).toMatchObject({ x: 0, y: -(1000 - OBJECT_TEXT_ASCENT * size), size, anchor: "start" });
    // det = 1, no mirroring: the child space keeps its handedness.
    const [a, b, c, d] = g.transform!;
    expect(a * d - b * c).toBe(1);
  });
});

describe("drawObjectLayer: text", () => {
  it("stacks lines from the top of the text extent with their justification, size, colour and font", () => {
    const data = textBlock(
      [run("Line oneLine two", 2, 5, 2)],
      [[0, 8], [8, 8]],
      [-5000, 4000, 5000, 0],
      [-3000, 3000, 3000, 1000],
    );
    const { elements } = draw(obj([sub(0x10b0, data)], [0.5, 0, 0, 0.5, 100, 0]));
    const size = textSizeToUnits(5);
    // No stored layout: boxes of floor(1.285 em / 100) × 100 (1500), the second overlapping the first by 0.15 of its height.
    const h = Math.floor((DATA_TEXT_BOX_FACTOR * size) / DATA_TEXT_BOX_STEP) * DATA_TEXT_BOX_STEP;
    expect(h).toBe(1500);
    const first = 3000 - OBJECT_TEXT_ASCENT * size;
    const second = 3000 - (h - DATA_ROW_OVERLAP * h) - OBJECT_TEXT_ASCENT * size;
    expect(elements).toHaveLength(2);
    const [a, b] = elements.map(text);
    expect(a).toMatchObject({ text: "Line one", x: 100, y: -first * 0.5, size: size * 0.5, anchor: "middle", fill: role(2), italic: false });
    expect(b).toMatchObject({ text: "Line two", x: 100, y: -second * 0.5, anchor: "middle" });
    expect(a!.fontFamily).toMatch(/sans-serif|serif|monospace/);
  });

  it("draws lines at the tops and em their line entries store", () => {
    const data = textBlock(
      [run("Line oneLine two", 2, 3, 1)],
      [
        [0, 8, [0, -800, 675]],
        [8, 8, [-680, -1480, 675]],
      ],
      [-5000, 4000, 5000, 0],
      [-3000, 3000, 3000, 1520],
    );
    const [a, b] = draw(obj([sub(0x10b0, data)])).elements.map(text);
    expect(a).toMatchObject({ text: "Line one", y: -(3000 - OBJECT_TEXT_ASCENT * 675), size: 675 });
    expect(b).toMatchObject({ text: "Line two", y: -(3000 - 680 - OBJECT_TEXT_ASCENT * 675), size: 675 });
  });

  it("reads a line entry's stored layout, or none when its em is 0", () => {
    const entry = (layout?: EntryLayout) => ({ raw: lineEntry(0, 1, layout) });
    expect(storedLineLayout(entry([-1955, -4255, 1772]))).toEqual({ top: -1955, bottom: -4255, em: 1772 });
    expect(storedLineLayout(entry())).toBeNull();
    expect(storedLineLayout({ raw: new Uint8Array(20) })).toBeNull();
  });

  it("anchors right-justified text at the right edge", () => {
    const data = textBlock([run("85", 4, 4, 3)], [[0, 2]], [0, 1000, 2000, 0], [500, 900, 1500, 100]);
    const t = text(draw(obj([sub(0x10b0, data)])).elements[0]);
    expect(t).toMatchObject({ x: 1500, anchor: "end" });
  });

  it("reads a direct text colour from the colour and the u16 after it", () => {
    // Colour bytes FF AA, then BB CC.
    const data = textBlock([run("rgb", 0xaaff, 4, 1, 0xccbb)], [[0, 3]], [0, 1000, 2000, 0], [0, 1000, 2000, 0]);
    expect(text(draw(obj([sub(0x10b0, data)])).elements[0]).fill).toBe("#aabbcc");
  });

  it("uses the low byte as the role when the high byte is stale", () => {
    const data = textBlock([run("x", 0xff04, 4, 1)], [[0, 1]], [0, 1000, 2000, 0], [0, 1000, 2000, 0]);
    expect(text(draw(obj([sub(0x10b0, data)])).elements[0]).fill).toBe(role(4));
  });
});

describe("drawObjectLayer: groups and buttons", () => {
  it("draws groups as group elements in file order, with button names", () => {
    const { elements } = draw([
      ...obj([line(32), boxShape(1, 0, 0, 0, 1, 1)]),
      leaf(618, cstr("NEXT")),
      block(608, [...obj([line(18), boxShape(1, 0, 2, 2, 3, 3)]), ...obj([line(18), boxShape(1, 0, 4, 4, 5, 5)])], new Uint8Array(16)),
      leaf(618, cstr("ONE")),
      ...obj([line(32), boxShape(1, 0, 6, 6, 7, 7)]),
    ]);
    expect(elements.map((e) => e.kind)).toEqual(["rect", "group", "group"]);
    const g = group(elements[1]);
    expect(g.buttonName).toBe("NEXT");
    expect(g.children.map((e) => e.kind === "rect" && e.x)).toEqual([2, 4]);
    expect(group(elements[2])).toMatchObject({ buttonName: "ONE", children: [{ kind: "rect", x: 6 }] });
  });

  it("applies a group's 616 to its members", () => {
    const { elements } = draw([transform([2, 0, 0, 2, 10, 0]), block(608, obj([line(32), boxShape(1, 0, 0, 0, 5, 5)]), new Uint8Array(16))]);
    expect(group(elements[0]).children[0]).toMatchObject({ kind: "rect", x: 10, y: -10, width: 10, height: 10 });
  });

});

describe("drawObjectLayer: embedded charts", () => {
  const embed = (name: string, t = [0.5, 0, 0, 0.5, 100, 200]): RecordSpec[] => [
    transform(t),
    leaf(404, concat(u16(4), u16(0), cstr(name))),
    block(608, [], new Uint8Array(16)),
  ];
  const chartBytes = (objects: RecordSpec[], type: number = DocumentType.Drawing) =>
    buildDocument("HGB3", type, [block(500, [leaf(400, cstr("demo"))]), block(504, [block(516, objects, new Uint8Array(16)), block(508, [])])]);

  it("draws the named chart's objects inside the group, mapped by its 616", () => {
    const ctx = fakeContext({ "OTHER.CH3": chartBytes(obj([line(32), boxShape(1, 0, 0, 0, 1000, 1000)])) });
    const { elements, warnings } = draw(embed("other.ch3"), ctx);
    expect(warnings).toEqual([]);
    expect(ctx.asked).toContain("other.ch3:embedded chart");
    const g = group(elements[0]);
    const inner = group(g.children[0]);
    expect(inner.transform).toEqual(flippedMatrix([0.5, 0, 0, 0.5, 100, 200]));
    expect(inner.children).toEqual([expect.objectContaining({ kind: "rect", x: 0, y: -1000, width: 1000, height: 1000 })]);
    // Embedded (0, 1000) → page (100, 700) → scene (100, −700).
    const [a, b, c, d, e, f] = inner.transform!;
    expect([a * 0 + c * -1000 + e, b * 0 + d * -1000 + f]).toEqual([100, -700]);
  });

  it("draws an embedded chart's frame but not its background through buildChartScene", () => {
    const frameChart = buildDocument("HGB3", DocumentType.Title, [
      block(500, [leaf(400, cstr("demo"))]),
      block(504, [leaf(802, concat(box(-1000, -1000, 1000, 1000), u16(0))), block(516, [], new Uint8Array(16)), block(508, [])]),
    ]);
    const ctx = fakeContext({ "FRAME.CH3": frameChart });
    const { scene } = buildChartScene(chartWith(embed("FRAME.CH3")), ctx);
    const inner = group(group(scene.elements[0]).children[0]);
    expect(inner.children.map((e) => e.kind)).toEqual(["rect"]);
    expect(inner.children[0]).toMatchObject({ fill: null, stroke: role(14) });
  });

  it("warns about a missing embedded chart", () => {
    const ctx = fakeContext({});
    const { elements, warnings } = draw(embed("GONE.CH3"), ctx);
    expect(group(elements[0]).children).toEqual([]);
    expect(ctx.asked).toContain("GONE.CH3:embedded chart");
    expect(warnings.some((w) => w.includes("GONE.CH3") && w.includes("not found"))).toBe(true);
  });

  it("stops a chart that embeds itself, directly or through another chart", () => {
    const files: Record<string, Uint8Array> = {};
    files["A.CH3"] = chartBytes([...obj([line(32), boxShape(1, 0, 0, 0, 10, 10)]), ...embed("B.CH3")]);
    files["B.CH3"] = chartBytes(embed("A.CH3"));
    const ctx = fakeContext(files); // its path is A.CH3
    const { scene, warnings } = buildChartScene(parseChart(readContainer(files["A.CH3"])).chart, ctx);
    expect(warnings.some((w) => w.includes("embeds itself") && w.includes("A.CH3 → B.CH3 → A.CH3"))).toBe(true);
    // A draws its box and B; B's group holds nothing (A is not drawn again).
    expect(scene.elements[0]).toMatchObject({ kind: "rect" });
    const b = group(group(scene.elements[1]).children[0]);
    expect(b.children).toHaveLength(1);
    expect(group(b.children[0]).children).toEqual([]);
  });

  it("warns when the embedded file is not a chart", () => {
    const ctx = fakeContext({ "JUNK.CH3": new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
    const { warnings } = draw(embed("JUNK.CH3"), ctx);
    expect(warnings.some((w) => w.includes("JUNK.CH3") && w.includes("could not be read"))).toBe(true);
  });
});

describe("drawObjectLayer: bitmaps", () => {
  const bitmapObject = (name: string) => [
    transform([1, 0, 0, 1, 0, 0]),
    leaf(404, concat(u16(5), u16(0), cstr(name))),
    object612([sub(0x110c, [0xff, 0x55, 0x55, 0x55]), sub(0x1140, new Uint8Array(8)), line(32), boxShape(1, 0, -100, -50, 100, 50)], [-100, -50, 100, 50]),
  ];

  it("stretches the PCX over the object's bounding box", () => {
    const ctx = fakeContext({ "LOGO.PCX": tinyPcx() });
    const { elements, warnings } = draw([...bitmapObject("C:\\HG3\\LOGO.PCX"), ...bitmapObject("logo.pcx")], ctx);
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ kind: "image", x: -100, y: -50, width: 200, height: 100 });
    if (elements[0]?.kind !== "image") return;
    expect(elements[0].href).toMatch(/^data:image\//);
    // Decoded once per name.
    expect(ctx.asked.filter((a) => a.endsWith(":bitmap"))).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("skips a missing bitmap with a warning", () => {
    const ctx = fakeContext({});
    const { elements, warnings } = draw(bitmapObject("GONE.PCX"), ctx);
    expect(elements).toEqual([]);
    expect(ctx.asked).toContain("GONE.PCX:bitmap");
    expect(warnings.some((w) => w.includes("GONE.PCX"))).toBe(true);
  });
});

describe("buildChartScene with an object layer", () => {
  it("draws the objects after the data chart and no longer reports them as not drawn", () => {
    const chart = chartWith(obj([line(32), boxShape(1, 0, 0, 0, 10, 10)]));
    const { scene } = buildChartScene(chart, undefined);
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]).toMatchObject({ kind: "rect" });
  });
});

describe("buildChartScene: button chart overlay (task 20)", () => {
  const buttonRef = (name: string): RecordSpec => leaf(404, concat(u16(1), u16(0), cstr(name)));
  /** A drawing whose 508 names `buttonChart` (404 kind 1), plus `inner508`. */
  const chartBytes = (objects: RecordSpec[], buttonChart?: string, inner508: RecordSpec[] = []) =>
    buildDocument("HGB3", DocumentType.Drawing, [
      block(500, [leaf(400, cstr("demo"))]),
      block(504, [block(516, objects, new Uint8Array(16)), block(508, [...(buttonChart ? [buttonRef(buttonChart)] : []), ...inner508])]),
    ]);
  const chartOfBytes = (bytes: Uint8Array) => parseChart(readContainer(bytes)).chart;
  /** A box object named `name` (618) with its 612 box. */
  const namedOutline = (name: string, x1: number, y1: number, x2: number, y2: number): RecordSpec[] => [
    leaf(618, cstr(name)),
    ...obj([line(32), boxShape(0, 0, x1, y1, x2, y2)], undefined, [x1, y1, x2, y2]),
  ];
  const hitAreas = (elements: SceneElement[]) =>
    elements.filter((e): e is GroupElement => e.kind === "group" && e.children.length === 1 && e.children[0]?.kind === "rect" && e.children[0].fill === HIT_AREA_FILL);

  it("draws the button chart's objects after the slide's object layer, keeping button names", () => {
    const ctx = fakeContext({
      "BUTNS.CH3": chartBytes([...obj([line(32), boxShape(1, 0, 0, 0, 10, 10)]), ...namedOutline("next", 100, 200, 300, 400)]),
    });
    const host = chartOfBytes(chartBytes(obj([line(18), boxShape(1, 0, -50, -50, -40, -40)]), "butns.ch3"));
    const { scene, warnings } = buildChartScene(host, ctx);
    expect(warnings).toEqual([]);
    expect(ctx.asked).toContain("butns.ch3:button chart");
    // Host box, button chart box, button chart's named group, then the click area.
    expect(scene.elements.map((e) => e.kind)).toEqual(["rect", "rect", "group", "group"]);
    expect(scene.elements[0]).toMatchObject({ kind: "rect", x: -50 });
    expect(scene.elements[1]).toMatchObject({ kind: "rect", x: 0, y: -10 });
    const button = group(scene.elements[2]);
    expect(button.buttonName).toBe("next");
    expect(button.transform).toBeUndefined();
    expect(button.children[0]).toMatchObject({ kind: "rect", x: 100, y: -400, width: 200, height: 200 });
  });

  it("does not draw the button chart's background or frame, and uses the host's palette", () => {
    const framed = chartBytes(obj([line(32), boxShape(1, 0, 0, 0, 10, 10)]), undefined, [
      leaf(802, concat(box(-1000, -1000, 1000, 1000), u16(0))),
    ]);
    const { scene } = buildChartScene(chartOfBytes(chartBytes([], "B.CH3")), fakeContext({ "B.CH3": framed }));
    expect(scene.elements).toEqual([expect.objectContaining({ kind: "rect", x: 0, stroke: role(32) })]);
  });

  it("warns about a missing button chart and still draws the slide", () => {
    const ctx = fakeContext({});
    const host = chartOfBytes(chartBytes(obj([line(32), boxShape(1, 0, 0, 0, 10, 10)]), "GONE.CH3"));
    const { scene, warnings } = buildChartScene(host, ctx);
    expect(scene.elements).toHaveLength(1);
    expect(ctx.asked).toContain("GONE.CH3:button chart");
    expect(warnings).toContain("button chart GONE.CH3 not found; not drawn");
  });

  it("does not draw a button chart that is the chart itself", () => {
    const files: Record<string, Uint8Array> = {};
    files["A.CH3"] = chartBytes(namedOutline("home", 0, 0, 10, 10), "a.ch3");
    const { scene, warnings } = buildChartScene(chartOfBytes(files["A.CH3"]), fakeContext(files)); // path A.CH3
    expect(warnings.some((w) => w.includes("refers to itself") && w.includes("A.CH3 → A.CH3"))).toBe(true);
    // The named box once, plus its click area.
    expect(scene.elements.filter((e) => e.kind === "group" && e.buttonName === "home")).toHaveLength(2);
  });

  it("ignores the button chart's own button chart and guards embedded charts inside it", () => {
    const files: Record<string, Uint8Array> = {};
    files["A.CH3"] = chartBytes([], "B.CH3");
    files["B.CH3"] = chartBytes(
      [transform([1, 0, 0, 1, 0, 0]), leaf(404, concat(u16(4), u16(0), cstr("A.CH3"))), block(608, [], new Uint8Array(16))],
      "C.CH3",
    );
    files["C.CH3"] = chartBytes(namedOutline("never", 0, 0, 10, 10));
    const ctx = fakeContext(files);
    const { scene, warnings } = buildChartScene(chartOfBytes(files["A.CH3"]), ctx);
    expect(ctx.asked).not.toContain("C.CH3:button chart");
    expect(warnings.some((w) => w.includes("embeds itself") && w.includes("A.CH3 → B.CH3 → A.CH3"))).toBe(true);
    expect(JSON.stringify(scene.elements)).not.toContain("never");
  });

  it("ends the scene with a transparent click area over each button's box", () => {
    const ctx = fakeContext({ "B.CH3": chartBytes(namedOutline("help", 100, 200, 300, 400)) });
    const host = chartOfBytes(
      chartBytes(
        [
          ...namedOutline("own", -300, -200, -100, -100),
          // A label drawn after (and over) the button box.
          ...obj([line(32), boxShape(1, 0, -250, -180, -150, -120)], undefined, [-250, -180, -150, -120]),
        ],
        "B.CH3",
      ),
    );
    const { scene } = buildChartScene(host, ctx);
    const areas = hitAreas(scene.elements);
    expect(areas.map((a) => a.buttonName)).toEqual(["own", "help"]);
    expect(scene.elements.slice(-2)).toEqual(areas);
    expect(areas[0]!.children[0]).toEqual({ kind: "rect", x: -300, y: 100, width: 200, height: 100, fill: HIT_AREA_FILL, stroke: null });
    expect(areas[1]!.children[0]).toMatchObject({ x: 100, y: -400, width: 200, height: 200 });
  });

  it("covers a named group's members through its 616, before the areas of named members", () => {
    const { scene } = buildChartScene(
      chartWith([
        leaf(618, cstr("outer")),
        transform([2, 0, 0, 2, 10, 0]),
        block(608, [...obj([line(32), boxShape(1, 0, 0, 0, 5, 5)], undefined, [0, 0, 5, 5]), ...namedOutline("inner", 10, 10, 20, 20)], new Uint8Array(16)),
      ]),
      undefined,
    );
    const areas = hitAreas(scene.elements);
    expect(areas.map((a) => a.buttonName)).toEqual(["outer", "inner"]);
    // Members' union (0,0)-(20,20) scaled by 2 and moved by 10: (10,0)-(50,40).
    expect(areas[0]!.children[0]).toMatchObject({ x: 10, y: -40, width: 40, height: 40 });
    expect(areas[1]!.children[0]).toMatchObject({ x: 30, y: -40, width: 20, height: 20 });
  });

  it("adds no click areas for buttons inside embedded charts", () => {
    const ctx = fakeContext({ "E.CH3": chartBytes(namedOutline("deep", 0, 0, 10, 10)) });
    const host = chartWith([transform([1, 0, 0, 1, 0, 0]), leaf(404, concat(u16(4), u16(0), cstr("E.CH3"))), block(608, [], new Uint8Array(16))]);
    const { scene } = buildChartScene(host, ctx);
    expect(JSON.stringify(scene.elements)).toContain('"buttonName":"deep"');
    expect(hitAreas(scene.elements)).toEqual([]);
  });
});

describe("drawObjectLayer: text size base (task 12b)", () => {
  it("sizes text as a percentage of the page's short side from 816", () => {
    const data = textBlock([run("Letter", 1, 4, 1)], [[0, 6]], [0, 1000, 2000, 0], [0, 1000, 2000, 0]);
    const objects = obj([sub(0x10b0, data)]);
    const sizeOn = (widthIn: number, heightIn: number) => {
      const chart = {
        ...chartWith(objects),
        pageSetup: { orientation: "landscape" as const, orientationCode: 1, paperSize: 1, widthIn, heightIn },
      };
      const { context } = createChartSceneContext(chart, undefined);
      return text(drawObjectLayer(context)[0]).size;
    };
    expect(sizeOn(10, 7.5)).toBeCloseTo(textSizeToUnits(4, 24576), 6);
    expect(sizeOn(11, 8.5)).toBeCloseTo(textSizeToUnits(4, (32768 * 8.5) / 11), 6);
    expect(sizeOn(11, 8.5)).toBeCloseTo(4 * 253.21, 0);
  });
});
