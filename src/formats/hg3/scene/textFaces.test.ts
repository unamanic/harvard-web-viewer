/**
 * Text drawn with glyphs (task 7f): source priority (original .SPD, clone,
 * CSS), anchor and advance maths, fill vs stroke.
 *
 * Order matters in this file: the outline clone of Swiss 721 Roman is
 * loaded part-way through (the face cache is per module instance).
 */
import { describe, expect, it } from "vitest";
import { outlineCloneFor, outlineCloneInfo } from "../../../fonts/outline";
import { strokeCloneFor, textToStrokePaths } from "../../../fonts/stroke";
import type { GlyphsElement, GroupElement, ParseContext, ResolvedFile, SceneElement } from "../../types";
import { OBJECT_TEXT_ASCENT, textSizeToUnits } from "../assumptions";
import { parseChart } from "../chart";
import { DocumentType, readContainer } from "../container";
import { DEFAULT_PALETTE, colorForRole, rgbToCss } from "../palette";
import { type ByteSource, type RecordSpec, block, buildDocument, concat, cstr, f32, i16, leaf, u16 } from "../testing/bytes";
import { SPEEDO_SPACE, SPEEDO_SQUARE, SPEEDO_TRIANGLE, buildFgf, buildSpeedo } from "../testing/fonts";
import { buildChartScene } from "./buildChartScene";
import { createChartSceneContext } from "./context";
import { drawObjectLayer, glyphLineElement } from "./objectLayer";

// ---------------------------------------------------------------------------
// Builders (as in objectLayer.test.ts, with a font key per run)
// ---------------------------------------------------------------------------

type Key = [source: number, number: number, style: number];
const SWISS: Key = [3, 3, 0x4268];
const HG_SANS_LIGHT: Key = [2, 16, 0x5848];

const role = (r: number): string => rgbToCss(colorForRole(DEFAULT_PALETTE, r)!);
const box = (x1: number, y1: number, x2: number, y2: number): Uint8Array => concat(i16(x1), i16(y1), i16(x2), i16(y2));
const sub = (tag: number, data: ByteSource): Uint8Array => concat(u16(tag), u16(data.length), data);

function run(text: string, key: Key, just = 1, color = 2, size = 4): Uint8Array {
  const s = cstr(text);
  const tail = concat(u16(text.length), u16(color), u16(0), u16(color), u16(0), f32(size), u16(just), u16(key[0]), u16(key[1]), u16(key[2]));
  return concat(s, s.length % 2 ? [0] : [], tail);
}

/** One-line text block, layout box 0..4000 × 0..2000. */
function textBlock(r: Uint8Array, length: number): Uint8Array {
  const headerLength = 82 + 28;
  const b = box(0, 2000, 4000, 0);
  return concat(
    u16(headerLength),
    u16(headerLength + r.length - 22),
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 3],
    u16(length),
    u16(1),
    new Uint8Array(8),
    [1, 0, 1, 0],
    new Uint8Array(8),
    b,
    new Uint8Array(8),
    b,
    b,
    b,
    u16(0),
    u16(1),
    concat([1, 0x81, 0, 0], u16(0), u16(0), [length], new Uint8Array(19)),
    r,
  );
}

function chartBytes(text: string, key: Key, just = 1, t?: number[]): Uint8Array {
  const records: RecordSpec[] = [
    ...(t ? [leaf(616, concat(...t.map(f32)))] : []),
    leaf(612, concat(box(0, 0, 10, 10), new Uint8Array(8), sub(0x10b0, textBlock(run(text, key, just), text.length)), sub(0x1fff, []))),
  ];
  return buildDocument("HGB3", DocumentType.Drawing, [
    block(500, [leaf(400, cstr("demo"))]),
    block(504, [block(516, records, new Uint8Array(16)), block(508, [])]),
  ]);
}

function draw(text: string, key: Key, ctx?: ParseContext, just = 1, t?: number[]) {
  const chart = parseChart(readContainer(chartBytes(text, key, just, t))).chart;
  const { context, warnings } = createChartSceneContext(chart, ctx);
  const elements = drawObjectLayer(context);
  return { elements, warnings, report: context.faces.report() };
}

function fakeContext(files: Record<string, Uint8Array>): ParseContext {
  return {
    path: "A.CH3",
    resolve(name: string): ResolvedFile | null {
      const base = name.replace(/^.*[\\/:]/, "").toUpperCase();
      const key = Object.keys(files).find((k) => k.toUpperCase() === base);
      return key ? { path: key, name: key, bytes: files[key]! } : null;
    },
  };
}

const glyphs = (el: SceneElement | undefined): GlyphsElement => {
  if (el?.kind !== "glyphs") throw new Error(`expected glyphs, got ${el?.kind}`);
  return el;
};

const SPD = buildSpeedo([SPEEDO_SPACE, SPEEDO_SQUARE, SPEEDO_TRIANGLE]);
const FGF = buildFgf([
  { source: 3, number: 3, style: 0x4268, name: "Swiss 721|Roman", fileName: "BX000003.SPD", map: { 0x20: 0, 0x41: 1, 0x42: 2 } },
]);
const SIZE = textSizeToUnits(4);
const BASELINE_Y = -(2000 - OBJECT_TEXT_ASCENT * SIZE);

// ---------------------------------------------------------------------------

describe("glyphLineElement", () => {
  const source = {
    paint: "fill" as const,
    glyph: (code: number) => ({ advance: code === 0x41 ? 500 : 250, contours: [{ x: 10, y: -20, rest: "l5 0z" }] }),
  };
  it.each([
    ["start", 1000],
    ["middle", 1000 - 375],
    ["end", 1000 - 750],
  ] as const)("anchors %s from the summed advances", (anchor, e) => {
    const el = glyphLineElement(source, "A ", [0x41, 0x20], "#123456", anchor, 1000, 300, 1000);
    expect(el.advance).toBe(750);
    expect(el.d).toBe("M10 -20l5 0zM510 -20l5 0z");
    expect(el.transform).toEqual([1, 0, 0, 1, e, 300]);
    expect(el).toMatchObject({ fill: "#123456", stroke: null, text: "A ", em: 1000 });
  });

  it("scales by size / 1000, the shift included", () => {
    const el = glyphLineElement(source, "A", [0x41], "#000", "end", 100, 0, 2000);
    expect(el.transform).toEqual([2, 0, 0, 2, 100 - 1000, 0]);
  });

  it("strokes stroke-font glyphs with the source's pen width", () => {
    const el = glyphLineElement({ ...source, paint: "stroke", strokeWidth: 40 }, "A", [0x41], "#abcdef", "start", 0, 0, 1000);
    expect(el).toMatchObject({ fill: null, stroke: "#abcdef", strokeWidth: 40 });
  });
});

describe("text faces: priority", () => {
  it("draws with the original .SPD through the HG3.FGF character map", () => {
    const { elements, warnings, report } = draw("AB A", SWISS, fakeContext({ "HG3.FGF": FGF, "BX000003.SPD": SPD }), 3);
    const el = glyphs(elements[0]);
    // A (square, 600) at 0, B (triangle, 650) at 600, space 250, A at 1500: y flipped, relative after M.
    expect(el.d).toBe(
      "M100 0l400 0l0 -400l-400 0z" + "M600 0l600 0c-100 -300 -500 -300 -600 0z" + "M1600 0l400 0l0 -400l-400 0z",
    );
    expect(el.advance).toBe(2100);
    const s = SIZE / 1000;
    expect(el.transform).toEqual([s, 0, 0, s, 4000 - 2100 * s, BASELINE_Y]);
    expect(el).toMatchObject({ text: "AB A", fill: role(2), stroke: null });
    expect(report).toBe("Fonts: Swiss 721 Roman — original BX000003.SPD");
    expect(warnings).toEqual([]);
  });

  it("does not use an .SPD without HG3.FGF (no character map)", () => {
    const { context, warnings } = createChartSceneContext(
      parseChart(readContainer(chartBytes("A", SWISS))).chart,
      fakeContext({ "BX000003.SPD": SPD }),
    );
    const els = drawObjectLayer(context);
    expect(els[0]!.kind).toBe("text");
    expect(warnings.some((w) => w.includes("BX000003.SPD found but HG3.FGF"))).toBe(true);
  });

  it("warns about an unreadable .SPD and substitutes", () => {
    const junk = new Uint8Array(600);
    const { elements, warnings } = draw("A", SWISS, fakeContext({ "HG3.FGF": FGF, "BX000003.SPD": junk }));
    expect(elements[0]!.kind).toBe("text");
    expect(warnings.some((w) => w.startsWith("font file BX000003.SPD could not be read"))).toBe(true);
  });

  it("uses the stroke clone for HG stroke fonts (stroked, not filled)", () => {
    const { elements, report } = draw("Hi", HG_SANS_LIGHT, undefined, 2);
    const el = glyphs(elements[0]);
    const font = strokeCloneFor({ source: 2, number: 16, style: 0x5848 })!;
    const ref = textToStrokePaths(font, "Hi", 1000);
    expect(el.fill).toBeNull();
    expect(el.stroke).toBe(role(2));
    expect(el.strokeWidth).toBeCloseTo(ref.strokeWidth);
    expect(el.advance).toBeCloseTo(ref.advance, 5);
    expect(el.transform![4]).toBeCloseTo(2000 - (ref.advance / 2) * (SIZE / 1000), 5);
    expect(report).toBe("Fonts: HG Sans serif Light — clone HWV Stroke Sans Light");
  });

  it("falls back to the CSS look-alike while the outline clone is not loaded", () => {
    const { elements, report } = draw("Hello", SWISS);
    expect(elements[0]).toMatchObject({ kind: "text", text: "Hello", anchor: "start" });
    expect(report).toBe("Fonts: Swiss 721 Roman — look-alike Helvetica (CSS, clone not loaded)");
  });

  it("uses the outline clone once loaded, laid out with the original's advances", async () => {
    const key = { source: 3, number: 3, style: 0x4268 };
    await outlineCloneFor(key);
    const { elements, report } = draw("Hello", SWISS, undefined, 2);
    const el = glyphs(elements[0]);
    const info = outlineCloneInfo(key)!;
    const advance = [..."Hello"].reduce((n, ch) => n + info.advance(ch.charCodeAt(0))!, 0);
    expect(el.advance).toBeCloseTo(advance, 5);
    const s = SIZE / 1000;
    expect(el.transform![0]).toBeCloseTo(s);
    expect(el.transform![4]).toBeCloseTo(2000 - (advance / 2) * s, 5);
    expect(el.transform![5]).toBeCloseTo(BASELINE_Y);
    expect(el).toMatchObject({ fill: role(1 + 1), stroke: null });
    expect(el.d.startsWith("M")).toBe(true);
    expect(report).toBe("Fonts: Swiss 721 Roman — clone HWV Sans Regular");
  });

  it("still prefers the original over a loaded clone", () => {
    const el = glyphs(draw("A", SWISS, fakeContext({ "HG3.FGF": FGF, "BX000003.SPD": SPD })).elements[0]);
    expect(el.advance).toBe(600);
  });

  it("keeps rotated text inside the object frame", () => {
    const { elements } = draw("A", SWISS, fakeContext({ "HG3.FGF": FGF, "BX000003.SPD": SPD }), 1, [0, -1, 1, 0, 100, 200]);
    const g = elements[0] as GroupElement;
    expect(g.kind).toBe("group");
    const el = glyphs(g.children[0]);
    const s = SIZE / 1000;
    expect(el.transform).toEqual([s, 0, 0, s, 0, BASELINE_Y]);
  });

  it("adds the font report to the scene warnings", () => {
    const chart = parseChart(readContainer(chartBytes("A", SWISS))).chart;
    const { warnings } = buildChartScene(chart, fakeContext({ "HG3.FGF": FGF, "BX000003.SPD": SPD }));
    expect(warnings.at(-1)).toBe("Fonts: Swiss 721 Roman — original BX000003.SPD");
  });
});
