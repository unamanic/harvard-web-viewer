import { describe, expect, it } from "vitest";
import { cachedGlyphSource, contoursFromPath, contoursFromPolylines, layoutGlyphLine, measureGlyphLine } from "./glyphRun";
import { outlineGlyphSource, strokeGlyphSource } from "./sources";
import { strokeCloneFor, textToStrokePaths } from "./stroke";
import type { OutlineFont } from "./outline";

describe("contoursFromPath", () => {
  it("flips absolute paths to y down and makes them relative after M", () => {
    expect(contoursFromPath("M100 0L500 0L500 400L100 400Z", 1000)).toEqual([
      { x: 100, y: 0, rest: "l400 0l0 -400l-400 0z" },
    ]);
    expect(contoursFromPath("M0 0L600 0C500 300 100 300 0 0Z", 1000)).toEqual([
      { x: 0, y: 0, rest: "l600 0c-100 -300 -500 -300 -600 0z" },
    ]);
  });

  it("reads relative l/h/v/q, several contours and implicit line-tos", () => {
    const c = contoursFromPath("M10 20h5v-5q1 2 3 4zM0 0 10 0 10 10z", 1000);
    expect(c).toEqual([
      { x: 10, y: -20, rest: "l5 0l0 5q1 -2 3 -4z" },
      { x: 0, y: 0, rest: "l10 0l0 -10z" },
    ]);
  });

  it("scales to 1000 units per em and does not drift when rounding", () => {
    const c = contoursFromPath("M0 0l0.3 0l0.3 0l0.3 0", 3000);
    // 0.1, 0.2, 0.3 em units: steps between rounded points.
    expect(c[0]!.rest).toBe("l0.1 0l0.1 0l0.1 0");
  });
});

describe("contoursFromPolylines", () => {
  it("draws single points as zero-length strokes", () => {
    expect(contoursFromPolylines([[{ x: 1, y: 2 }], [{ x: 0, y: 0 }, { x: 4, y: -4 }]], 4)).toEqual([
      { x: 250, y: 500, rest: "h0" },
      { x: 0, y: 0, rest: "l1000 -1000" },
    ]);
  });
});

describe("layoutGlyphLine", () => {
  const source = cachedGlyphSource("fill", (code) =>
    code === 1 ? null : { advance: code * 100, contours: code === 2 ? [] : [{ x: 0, y: 0, rest: "l1 0z" }] },
  );
  it("moves each glyph's contours by the pen; missing glyphs draw and advance nothing", () => {
    expect(layoutGlyphLine(source, [3, 1, 2, 3])).toEqual({ d: "M0 0l1 0zM500 0l1 0z", advance: 800 });
    expect(measureGlyphLine(source, [3, 1, 2, 3])).toBe(800);
  });

  it("caches glyphs per code", () => {
    let calls = 0;
    const s = cachedGlyphSource("fill", () => (calls++, null));
    s.glyph(5);
    s.glyph(5);
    expect(calls).toBe(1);
  });
});

describe("sources", () => {
  it("lays out a stroke clone like textToStrokePaths", () => {
    const font = strokeCloneFor({ source: 2, number: 12, style: 0x5848 })!;
    const src = strokeGlyphSource(font);
    const codes = [..."Abc d"].map((c) => c.charCodeAt(0));
    const ref = textToStrokePaths(font, "Abc d", 1000);
    expect(src.paint).toBe("stroke");
    expect(src.strokeWidth).toBeCloseTo(ref.strokeWidth);
    expect(layoutGlyphLine(src, codes).advance).toBeCloseTo(ref.advance, 6);
    expect(strokeGlyphSource(font)).toBe(src);
  });

  it("converts outline clone glyphs (y up) to y down", () => {
    const font: OutlineFont = {
      family: "T", style: "R", unitsPerEm: 1000, ascent: 700, descent: -200, capHeight: 700, xHeight: 500,
      glyph: (code) => (code === 65 ? { advance: 600, path: "M0 0l100 200z" } : null),
    };
    const src = outlineGlyphSource(font);
    expect(layoutGlyphLine(src, [65, 66, 65])).toEqual({ d: "M0 0l100 -200zM600 0l100 -200z", advance: 1200 });
  });
});
