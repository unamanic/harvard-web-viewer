import { describe, expect, it } from "vitest";
import type { SceneElement, TextElement } from "../../../types";
import { DATA_TEXT_ASCENT, textSizeToUnits } from "../../assumptions";
import { type Chart, parseChart } from "../../chart";
import { DocumentType, readContainer } from "../../container";
import { DEFAULT_PALETTE, ROLE, colorForRole, rgbToCss } from "../../palette";
import { type ByteSource, type RecordSpec, block, buildDocument, concat, cstr, f32, f64, i16, leaf, u16, u8 } from "../../testing/bytes";
import { buildChartScene, notYetDrawn } from "../buildChartScene";
import { createChartSceneContext } from "../context";
import { drawsFromData, hasDrawnCopy } from "../dataLayout";
import { cellNumber, rowBandIndex } from "./table";
import { fitScale, lineBoxHeight, rowsByNumber, stackRows } from "./text";
import { bulletMarker, roman } from "./textCharts";
import { parseTableData } from "../../data/table";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const role = (r: number): string => rgbToCss(colorForRole(DEFAULT_PALETTE, r)!);
const area = (tag: number, x1: number, y1: number, x2: number, y2: number) =>
  leaf(tag, concat(i16(x1), i16(y1), i16(x2), i16(y2), u16(0)));
const pageSetup = () => leaf(816, concat(u8(1), u8(14), f32(10), f32(7.5)));
const tail = (len: number, color: number, size: number, just: number) =>
  concat(u16(len), u16(color), u16(0), u16(color), u16(0), f32(size), u16(just), u16(3), u16(3), u16(0x4268));
/** Text line 800. */
const line = (slot: number, row: number, col: number, text: string, color: number, size: number, just: number, raw6 = 1) =>
  leaf(800, concat(u16(slot), u16(row), u16(col), u8(raw6), u8(0x10), cstr(text), tail(text.length, color, size, just)));

const sub = (tag: number, data: ByteSource): Uint8Array => concat(u16(tag), u16(data.length), data);
const box = (x1: number, y1: number, x2: number, y2: number) => concat(i16(x1), i16(y1), i16(x2), i16(y2));
/** A one-line text object (0x10B0) holding `text`. */
function textObject(text: string): RecordSpec {
  const s = cstr(text);
  const runBytes = concat(s, s.length % 2 ? [0] : [], tail(text.length, 1, 4, 1));
  const header = concat(
    u16(110),
    u16(110 + runBytes.length - 22),
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 3],
    u16(text.length),
    u16(1),
    new Uint8Array(8),
    [1, 0, 1, 0],
    new Uint8Array(8),
    box(0, 1000, 5000, 0),
    new Uint8Array(8),
    box(0, 1000, 5000, 0),
    box(0, 1000, 5000, 0),
    box(0, 1000, 5000, 0),
    u16(0),
    u16(1),
    concat([1, 0x81, 0, 0], u16(0), u16(0), [text.length], new Uint8Array(19)),
  );
  return leaf(612, concat(box(0, 0, 5000, 1000), new Uint8Array(8), sub(0x10b0, concat(header, runBytes)), u16(0x1fff), u16(0)));
}

function chartOf(type: number, inner508: RecordSpec[], objects: RecordSpec[] = []): Chart {
  const bytes = buildDocument("HGB3", type, [
    block(500, [leaf(400, cstr("demo"))]),
    block(504, [block(516, objects, new Uint8Array(16)), block(508, inner508)]),
  ]);
  return parseChart(readContainer(bytes)).chart;
}

const FRAME = area(802, -16000, -12000, 16000, 12000);
const TITLE = area(804, -6000, 9000, 6000, 12000);
const PLOT = area(806, -16000, -11000, 16000, 8800);

/** 1108: entries of (shape, 2, role 16, paragraph); the rest unused. */
function bulletEntries(entries: [number, number][]): RecordSpec {
  const bytes = new Uint8Array(192);
  for (let i = 0; i < 48; i++) bytes.set(entries[i] ? [entries[i]![0], 2, 16, entries[i]![1]] : [100, 0, 0, 1], i * 4);
  return leaf(1108, bytes);
}

function bulletChart(objects: RecordSpec[] = [], shape = 1): Chart {
  return chartOf(
    DocumentType.Bullet,
    [
      FRAME,
      TITLE,
      PLOT,
      pageSetup(),
      line(1, 0, 0, "Bullets", 1, 9, 2, 3),
      line(8, 0, 0, "First", 4, 7, 1, 3),
      line(8, 2, 0, "Second", 4, 7, 1, 0),
      bulletEntries([
        [shape, 1],
        [0, 1],
        [shape, 2],
      ]),
    ],
    objects,
  );
}

const texts = (els: SceneElement[]): TextElement[] =>
  els.flatMap((e) => (e.kind === "text" ? [e] : e.kind === "group" ? texts(e.children) : []));

// ---------------------------------------------------------------------------
// Draw from data: the switch
// ---------------------------------------------------------------------------

describe("hasDrawnCopy", () => {
  it("is false without objects", () => {
    expect(hasDrawnCopy(bulletChart())).toBe(false);
  });
  it("is true when an object text equals a text line (ignoring surrounding spaces)", () => {
    expect(hasDrawnCopy(bulletChart([textObject("  First ")]))).toBe(true);
  });
  it("is false when the layer holds only other text (annotations)", () => {
    expect(hasDrawnCopy(bulletChart([textObject("A note")]))).toBe(false);
  });
  it("is true for a non-empty layer when the chart has no text lines", () => {
    expect(hasDrawnCopy(chartOf(DocumentType.Pie, [], [textObject("x")]))).toBe(true);
    expect(hasDrawnCopy(chartOf(DocumentType.Pie, []))).toBe(false);
  });
});

describe("dataLayout modes", () => {
  it("auto draws from data only without a copy; never and always as named", () => {
    const copy = bulletChart([textObject("First")]);
    const bare = bulletChart();
    expect(drawsFromData(copy, "auto")).toBe(false);
    expect(drawsFromData(bare, "auto")).toBe(true);
    expect(drawsFromData(bare, "never")).toBe(false);
    expect(drawsFromData(copy, "always")).toBe(true);
    expect(drawsFromData(chartOf(DocumentType.Drawing, []), "always")).toBe(false);
  });

  it("auto leaves a chart with a copy as the object layer draws it", () => {
    const chart = bulletChart([textObject("First")]);
    const auto = buildChartScene(chart, undefined).scene;
    const never = buildChartScene(chart, undefined, { dataLayout: "never" }).scene;
    expect(auto).toEqual(never);
    expect(texts(auto.elements).map((t) => t.text)).toEqual(["First"]);
  });

  it("always draws from data and skips the object layer", () => {
    const chart = bulletChart([textObject("A note")]);
    const els = buildChartScene(chart, undefined, { dataLayout: "always" }).scene.elements;
    expect(texts(els).map((t) => t.text)).toEqual(["Bullets", "•", "First", "•", "Second"]);
  });

  it("takes the mode from the parse context when the options give none", () => {
    const chart = bulletChart([textObject("First")]);
    const ctx = { path: "A.CH3", resolve: () => null, layoutFromData: "always" as const };
    expect(texts(buildChartScene(chart, ctx).scene.elements).map((t) => t.text)).toContain("Second");
  });

  it("notYetDrawn reports nothing for charts with a copy or drawn parts", () => {
    expect(notYetDrawn(bulletChart())).toEqual([]);
    const pie = chartOf(DocumentType.Pie, [line(1, 0, 0, "T", 1, 9, 2)]);
    expect(notYetDrawn(pie)).toEqual(["pie data"]);
    expect(notYetDrawn(pie, "never")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task 14: text layout
// ---------------------------------------------------------------------------

describe("text layout", () => {
  const ctx = createChartSceneContext(bulletChart(), undefined).context;

  it("box heights are floor(1.285 em / 100) × 100", () => {
    expect([4, 7, 9, 12].map((s) => lineBoxHeight(ctx, s))).toEqual([1200, 2200, 2800, 3700]);
  });

  it("stacks rows overlapping by 0.15 of the next row; blank rows take one em", () => {
    const row = { text: "x", size: 7, color: 4, justification: 1, fontKey: { a: 3, b: 3, c: 0x4268 } as never };
    const { tops, bottom } = stackRows(ctx, [row, null, row], 8749, 7);
    // GALD111: rows 0 and 2 at 8749 and 5418.
    expect(tops[0]).toBe(8749);
    expect(tops[2]).toBeCloseTo(5418, -1);
    expect(bottom).toBeCloseTo(5418 - 2200, -1);
  });

  it("rowsByNumber keeps gaps between used rows and drops blank ends", () => {
    const rows = rowsByNumber([{ row: 1 }, { row: 3 }, { row: 5, blank: true }] as { row: number; blank?: boolean }[], (l) => !!l.blank);
    expect(rows.map((r) => r?.row ?? null)).toEqual([1, null, 3]);
  });

  it("fitScale finds the largest factor that fits", () => {
    expect(fitScale(() => true)).toBe(1);
    expect(fitScale((k) => k <= 0.5)).toBeCloseTo(0.5, 4);
  });

  it("draws the title at the top of the title area, centred, and a separator line in role Lines", () => {
    const els = buildChartScene(bulletChart(), undefined, { dataLayout: "always" }).scene.elements;
    const title = texts(els).find((t) => t.text === "Bullets")!;
    expect(title.anchor).toBe("middle");
    expect(title.x).toBe(0);
    expect(title.y).toBeCloseTo(-(12000 - DATA_TEXT_ASCENT * textSizeToUnits(9)), 6);
    expect(title.fill).toBe(role(1));
    const sep = els.find((e) => e.kind === "path");
    expect(sep).toMatchObject({ points: [{ x: -16000, y: -9000 }, { x: 16000, y: -9000 }], stroke: role(ROLE.Lines) });
  });
});

// ---------------------------------------------------------------------------
// Task 15: title and bullet charts
// ---------------------------------------------------------------------------

describe("title chart", () => {
  it("puts the top section at the frame top, the bottom one on the frame bottom, the middle between", () => {
    const chart = chartOf(DocumentType.Title, [
      FRAME,
      pageSetup(),
      line(7, 0, 0, "Top", 1, 12, 2, 4),
      line(7, 4, 0, "Middle", 2, 9, 2, 8),
      line(7, 12, 0, "Bottom", 6, 4, 2, 4),
    ]);
    const t = texts(buildChartScene(chart, undefined).scene.elements);
    const baseline = (name: string) => -t.find((e) => e.text === name)!.y;
    const asc = (s: number) => DATA_TEXT_ASCENT * textSizeToUnits(s);
    expect(baseline("Top")).toBeCloseTo(12000 - asc(12), 6);
    expect(baseline("Bottom")).toBeCloseTo(-12000 + 1200 - asc(4), 6);
    // Middle box (2800) centred between 12000 − 3700 and −12000 + 1200.
    expect(baseline("Middle")).toBeCloseTo((8300 - 10800) / 2 + 1400 - asc(9), 6);
    expect(t.every((e) => e.anchor === "middle" && e.x === 0)).toBe(true);
  });
});

describe("bullet chart", () => {
  it("markers: shapes 1, 4, 7, 8, 9", () => {
    const m = (shape: number, shapeName: string, paragraph = 3) =>
      bulletMarker({ line: {} as never, entry: { row: 0, shape, shapeName: shapeName as never, raw1: 2, colorRole: 16, paragraph } });
    expect([m(1, "bullet"), m(4, "triangle"), m(7, "number"), m(8, "roman"), m(9, "none"), m(0, "continuation")]).toEqual([
      "•",
      "►",
      "3.",
      "III.",
      "",
      "",
    ]);
    expect(roman(1994)).toBe("MCMXCIV");
  });

  it("right-aligns each marker before its line, in role 16, lines left-aligned in one block", () => {
    const t = texts(buildChartScene(bulletChart([], 7), undefined).scene.elements);
    const [m1, l1, m2, l2] = t.slice(1);
    expect([m1!.text, l1!.text, m2!.text, l2!.text]).toEqual(["1.", "First", "2.", "Second"]);
    expect(m1!.anchor).toBe("end");
    expect(m1!.fill).toBe(role(16));
    expect(l1!.anchor).toBe("start");
    expect(l1!.x).toBe(l2!.x);
    expect(m1!.x).toBeLessThan(l1!.x);
    // Row 0 box top at the plot top; row 2 after a blank row.
    expect(-l1!.y).toBeCloseTo(8800 - DATA_TEXT_ASCENT * textSizeToUnits(7), 6);
    expect(-l1!.y - -l2!.y).toBeCloseTo(3331, -1);
  });

  it("shrinks a list that would run past the plot area", () => {
    const rows = Array.from({ length: 30 }, (_, i) => line(8, i, 0, `Row ${i}`, 4, 7, 1, i ? 0 : 30));
    const chart = chartOf(DocumentType.Bullet, [FRAME, TITLE, PLOT, pageSetup(), ...rows]);
    const t = texts(buildChartScene(chart, undefined).scene.elements);
    expect(t).toHaveLength(30);
    expect(t[0]!.size).toBeLessThan(textSizeToUnits(7));
    expect(-t[29]!.y).toBeGreaterThan(-11000);
  });
});

// ---------------------------------------------------------------------------
// Task 19: table chart
// ---------------------------------------------------------------------------

/** The "not set" f64 (SPEC §3). */
const NOT_SET = new Uint8Array([0, 0, 0, 0, 0, 0, 0xf0, 0xff]);
const num = (v: number | undefined) => (v === undefined ? NOT_SET : f64(v));
/** 1208 with columns (left %, right %, justification). */
function columns(cols: [number, number, number][]): RecordSpec {
  const parts = Array.from({ length: 24 }, (_, i) => {
    const c = cols[i];
    return concat(num(c?.[0]), num(c?.[1]), [c ? c[2] : 0, 3], new Uint8Array(21));
  });
  return leaf(1208, concat(...parts));
}
function bands(rows: [number, number][]): RecordSpec {
  return leaf(1214, concat(...Array.from({ length: 24 }, (_, i) => concat(num(rows[i]?.[0]), num(rows[i]?.[1])))));
}
function ranges(on: boolean, list: [number, number, number][]): RecordSpec {
  const entries = Array.from({ length: 10 }, (_, i) => {
    const r = list[i];
    return concat(new Uint8Array(23), num(r?.[0]), num(r?.[1]), [r ? r[2] : 0]);
  });
  return leaf(1212, concat([on ? 1 : 2, 0, 0], ...entries));
}

describe("table chart", () => {
  const table = () =>
    chartOf(DocumentType.Table, [
      FRAME,
      TITLE,
      PLOT,
      pageSetup(),
      line(6, 0, 0, "Name", 2, 4, 1, 2),
      line(6, 0, 1, "Value", 2, 4, 1, 2),
      line(6, 2, 0, "A", 4, 4, 1, 1),
      line(6, 2, 1, "8", 4, 4, 1, 1),
      line(6, 4, 0, "B", 4, 4, 1, 1),
      line(6, 4, 1, "34", 4, 4, 1, 1),
      columns([
        [25, 50, 1],
        [50, 75, 1],
      ]),
      bands([
        [20, 30],
        [30, 40],
        [40, 45],
        [45, 55],
      ]),
      ranges(true, [
        [0, 9, 33],
        [30, 39, 36],
      ]),
    ]);

  it("cellNumber and rowBandIndex", () => {
    expect([cellNumber(" 45 "), cellNumber("1,200"), cellNumber("12%"), cellNumber("20-24"), cellNumber("Tot.")]).toEqual([45, 1200, 12, null, null]);
    expect([...rowBandIndex(parseTableData(table(), []))]).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
  });

  it("places cells in the 1208 columns and 1214 bands, numbers right-aligned, ranges as backgrounds", () => {
    const els = buildChartScene(table(), undefined).scene.elements;
    const t = texts(els);
    const cell = (s: string) => t.find((e) => e.text === s)!;
    const m = 0.1 * textSizeToUnits(4);
    expect(cell("A").x).toBeCloseTo(-8192 + m, 6); // 25 % of 32768 − 16384
    expect(cell("A").anchor).toBe("start");
    expect(cell("8").anchor).toBe("end");
    expect(cell("8").x).toBeCloseTo(8192 - m, 6);
    // Band 1 (30 % to 40 %) centred: y from 12288 − 0.3 × 24576.
    const top = (12288 - 0.3 * 24576 + 12288 - 0.4 * 24576) / 2 + 1200 / 2;
    expect(-cell("A").y).toBeCloseTo(top - DATA_TEXT_ASCENT * textSizeToUnits(4), 6);
    const rects = els.filter((e) => e.kind === "rect" && e.fill !== null);
    expect(rects.map((r) => r.kind === "rect" && r.fill)).toEqual([role(33), role(36)]);
    expect(rects[0]).toMatchObject({ x: 0, width: 8192, stroke: role(ROLE.Outlines) });
    // Header rule under band 0, role Lines.
    const rule = els.find((e) => e.kind === "path" && e.points[0]!.y === -(12288 - 0.3 * 24576));
    expect(rule).toMatchObject({ stroke: role(ROLE.Lines) });
  });
});
