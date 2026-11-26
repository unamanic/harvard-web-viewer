import { describe, expect, it } from "vitest";
import { STROKE_CLONE_TABLE, STROKE_FAMILY, strokeCloneFor } from "./clones";
import { HERSHEY_SETS } from "./hersheyData";
import { hg3CodeOf } from "../../formats/charset";
import { COMPOSED_CODES, decodeHersheyGlyph, textToStrokePaths, type StrokeFont } from "./strokeFont";

const KEYS: [number, number, string, string][] = [
  [12, 0x5848, STROKE_FAMILY.roman, "light"],
  [13, 0x5858, STROKE_FAMILY.roman, "bold"],
  [16, 0x5848, STROKE_FAMILY.sans, "light"],
  [17, 0x5858, STROKE_FAMILY.sans, "bold"],
  [20, 0x5849, STROKE_FAMILY.script, "light"],
  [21, 0x5859, STROKE_FAMILY.script, "bold"],
  [25, 0x5878, STROKE_FAMILY.gothic, "bold"],
];

const fonts: [string, StrokeFont][] = KEYS.map(([number, style]) => [
  `2:${number}`,
  strokeCloneFor({ source: 2, number, style })!,
]);

function ink(font: StrokeFont, code: number) {
  const g = font.glyph(code)!;
  const pts = g.strokes.flat();
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
    strokes: g.strokes.length,
  };
}

describe("Hershey data", () => {
  it("has 96 glyphs per set, each with side bearings", () => {
    for (const glyphs of Object.values(HERSHEY_SETS)) {
      expect(glyphs).toHaveLength(96);
      for (const g of glyphs) expect(g.length % 2).toBe(0);
    }
  });

  it("decodes the format's example H", () => {
    const g = decodeHersheyGlyph("MWOMOV RUMUV ROQUQ");
    expect(g.advance).toBe(10);
    expect(g.strokes).toEqual([
      [
        { x: 2, y: -14 },
        { x: 2, y: -5 },
      ],
      [
        { x: 8, y: -14 },
        { x: 8, y: -5 },
      ],
      [
        { x: 2, y: -10 },
        { x: 8, y: -10 },
      ],
    ]);
  });
});

describe("key to clone mapping", () => {
  it.each(KEYS)("2:%i:%i maps to %s %s", (number, style, family, weight) => {
    const f = strokeCloneFor({ source: 2, number, style })!;
    expect(f).not.toBeNull();
    expect(f.family).toBe(family);
    expect(f.weight).toBe(weight);
    expect(f.strokeWidthEm).toBeGreaterThan(0);
    expect(f.strokeWidthEm).toBeLessThan(0.1);
  });

  it("uses our own family names, never the HG ones", () => {
    for (const e of STROKE_CLONE_TABLE) expect(e.family).toMatch(/^HWV Stroke /);
    expect(STROKE_CLONE_TABLE).toHaveLength(7);
  });

  it("bold is drawn with a wider pen than light in the same family", () => {
    const w = (n: number) => strokeCloneFor({ source: 2, number: n, style: 0 })!.strokeWidthEm;
    expect(w(13)).toBeGreaterThan(w(12));
    expect(w(17)).toBeGreaterThan(w(16));
    expect(w(21)).toBeGreaterThan(w(20));
  });

  it("returns the same instance for the same key", () => {
    expect(strokeCloneFor({ source: 2, number: 16, style: 0x5848 })).toBe(
      strokeCloneFor({ source: 2, number: 16, style: 0x5848 }),
    );
  });

  it("returns null for unknown keys", () => {
    expect(strokeCloneFor({ source: 2, number: 14, style: 0x5848 })).toBeNull();
    expect(strokeCloneFor({ source: 3, number: 12, style: 0x5848 })).toBeNull();
    expect(strokeCloneFor({ source: 0, number: 0, style: 0 })).toBeNull();
  });
});

describe.each(fonts)("clone %s", (_name, font) => {
  it("covers ASCII 32-126 with positive advances", () => {
    for (let code = 32; code <= 126; code++) {
      const g = font.glyph(code);
      expect(g, `code ${code}`).not.toBeNull();
      expect(g!.advance, `code ${code}`).toBeGreaterThan(0);
      if (code > 32) expect(g!.strokes.length, `code ${code}`).toBeGreaterThan(0);
    }
  });

  it("has every composed code and nothing for control codes", () => {
    for (const code of COMPOSED_CODES) {
      const g = font.glyph(code);
      expect(g, `code ${code}`).not.toBeNull();
      expect(g!.advance).toBeGreaterThan(0);
    }
    expect(font.glyph(0)).toBeNull();
    expect(font.glyph(7)).toBeNull();
    expect(font.glyph(176)).toBeNull(); // shade block: not in the originals either
    expect(font.glyph(256)).toBeNull();
    expect(font.glyph(-1)).toBeNull();
  });

  it("sits on the baseline with sane metrics", () => {
    const h = ink(font, 72);
    expect(h.maxY).toBeCloseTo(0, 0);
    expect(font.capHeight).toBeGreaterThan(15);
    expect(font.capHeight).toBeLessThan(font.ascent);
    expect(font.xHeight).toBeLessThan(font.capHeight);
    expect(font.unitsPerEm).toBe(32);
  });

  it("composes é as e plus an acute above the x-height", () => {
    const e = ink(font, 101);
    const eAcute = ink(font, hg3CodeOf("é")!);
    expect(font.glyph(130)!.advance).toBe(font.glyph(101)!.advance);
    expect(eAcute.strokes).toBeGreaterThan(e.strokes);
    expect(eAcute.maxY).toBe(e.maxY);
    expect(eAcute.minY).toBeLessThan(e.minY - 2);
  });

  it("composes ü as u plus two dots", () => {
    const u = ink(font, 117);
    const uu = ink(font, hg3CodeOf("ü")!);
    expect(uu.strokes - u.strokes).toBeGreaterThanOrEqual(2);
    expect(uu.minY).toBeLessThan(u.minY);
  });

  it("puts the accent of capitals above the cap height", () => {
    expect(ink(font, 142).minY).toBeLessThan(ink(font, 65).minY);
  });
});

describe("textToStrokePaths", () => {
  const sans = strokeCloneFor({ source: 2, number: 16, style: 0x5848 })!;

  it("lays out text with summed advances, scaled to the size", () => {
    const p = textToStrokePaths(sans, "HI", 64);
    const expected = (sans.glyph(72)!.advance + sans.glyph(73)!.advance) * 2;
    expect(p.advance).toBeCloseTo(expected, 6);
    expect(p.strokeWidth).toBeCloseTo(sans.strokeWidthEm * 64, 6);
    // H = 3 strokes, I = 1 stroke
    expect(p.d.match(/M/g)).toHaveLength(4);
    expect(p.d.startsWith("M")).toBe(true);
    expect(p.d).not.toMatch(/NaN/);
  });

  it("accepts HG3 codes and Unicode text alike", () => {
    expect(textToStrokePaths(sans, [0x82, 0x81], 32)).toEqual(textToStrokePaths(sans, "éü", 32));
    expect(textToStrokePaths(sans, [0xb5, 0xe0, 0xfd], 32)).toEqual(textToStrokePaths(sans, "ÁÓ−", 32));
  });

  it("draws y down with the baseline at 0", () => {
    const p = textToStrokePaths(sans, "l", 32);
    const ys = [...p.d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys)).toBeCloseTo(0, 6);
    expect(Math.min(...ys)).toBeLessThan(-15);
  });

  it("advances by a space for characters without a glyph", () => {
    const space = sans.glyph(32)!.advance;
    const p = textToStrokePaths(sans, "░", 32);
    expect(p.d).toBe("");
    expect(p.advance).toBe(space);
  });

  it("returns empty output for empty text", () => {
    expect(textToStrokePaths(sans, "", 10)).toEqual({ d: "", advance: 0, strokeWidth: sans.strokeWidthEm * 10 });
  });
});
