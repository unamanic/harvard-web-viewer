import { describe, expect, it } from "vitest";
import { BUILT_IN_FONTS } from "../../formats/hg3/fgf";
import { fontKeyString } from "../../formats/hg3/fontKey";
import { HG3_OUTLINE_CHARSET, codeForChar } from "./charset";
import { OUTLINE_CLONES, outlineCloneFor, outlineCloneInfo, textToOutlinePath } from "./index";
import { OUTLINE_FACE_METRICS } from "./metrics";

const SPEEDO = BUILT_IN_FONTS.filter((f) => f.key.source === 3);
const swissRoman = { source: 3, number: 3, style: 0x4268 };
const monoKey = { source: 3, number: 596, style: 0x4268 };

describe("outline clone metrics", () => {
  it("covers all 15 Speedo keys of the font index", () => {
    expect(SPEEDO).toHaveLength(15);
    for (const f of SPEEDO) {
      const m = OUTLINE_FACE_METRICS[fontKeyString(f.key)];
      expect(m, fontKeyString(f.key)).toBeDefined();
      expect(m!.advances).toHaveLength(256);
      expect(m!.capHeight).toBeGreaterThan(600);
      expect(m!.xHeight).toBeLessThan(m!.capHeight);
      expect(m!.descent).toBeLessThan(0);
    }
    expect(Object.keys(OUTLINE_FACE_METRICS)).toHaveLength(15);
  });

  it("looks up advances without loading a face", () => {
    const info = outlineCloneInfo(swissRoman)!;
    expect(info.family).toBe("HWV Sans");
    expect(info.style).toBe("Regular");
    expect(info.originalFile).toBe("BX000003.SPD");
    expect(info.advance(0x41)).toBe(637); // 'A'
    expect(info.advance(0x20)).toBe(274);
    expect(info.advance(0)).toBeNull();
    expect(info.capHeight).toBe(719);
    // Monospace 821: every printable code has the same advance.
    const mono = outlineCloneInfo(monoKey)!;
    for (let c = 0x21; c < 0x7f; c++) expect(mono.advance(c)).toBe(602);
  });

  it("maps every key to a clone with our own family names", () => {
    expect(OUTLINE_CLONES).toHaveLength(15);
    for (const f of SPEEDO) {
      const info = outlineCloneInfo(f.key)!;
      expect(info.originalFile).toBe(f.fileName);
      expect(info.family).toMatch(/^HWV (Sans|Serif|Slab|Mono)$/);
    }
    expect(outlineCloneInfo({ source: 3, number: 4, style: 0x4269 })!.style).toBe("Italic");
    expect(outlineCloneInfo({ source: 3, number: 485, style: 0x4278 })!.family).toBe("HWV Slab");
  });

  it("returns null for unknown keys", async () => {
    expect(outlineCloneInfo({ source: 3, number: 999, style: 0x4268 })).toBeNull();
    expect(outlineCloneInfo({ source: 2, number: 12, style: 0x5848 })).toBeNull();
    await expect(outlineCloneFor({ source: 3, number: 3, style: 0 })).resolves.toBeNull();
  });
});

describe("HG3 character set", () => {
  it("follows ASCII in the lower half and HG3's own table above", () => {
    expect(HG3_OUTLINE_CHARSET[0x41]).toBe("A");
    expect(HG3_OUTLINE_CHARSET[0x8e]).toBe("Ä");
    expect(HG3_OUTLINE_CHARSET[0xb5]).toBe("Á");
    expect(HG3_OUTLINE_CHARSET[0xe0]).toBe("Ó");
    expect(codeForChar("é")).toBe(0x82);
    expect(codeForChar("Ó")).toBe(0xe0);
    expect(codeForChar("α")).toBeUndefined(); // CP437 0xE0, not in the HG3 set
    expect(HG3_OUTLINE_CHARSET[0x0a]).toBe("◙"); // a glyph, not a line end
    expect(HG3_OUTLINE_CHARSET[0xff]).toBe("");
    expect(codeForChar("€")).toBeUndefined();
  });
});

describe("outline clone faces", () => {
  it("loads a face lazily and caches it", async () => {
    const a = await outlineCloneFor(swissRoman);
    const b = await outlineCloneFor(swissRoman);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a!.family).toBe("HWV Sans");
    expect(a!.unitsPerEm).toBe(1000);
    const g = a!.glyph(0x48)!;
    expect(g.advance).toBe(723);
    expect(g.path).toMatch(/^M/);
    expect(a!.glyph(0x20)).toEqual({ advance: 274, path: "" });
    expect(a!.glyph(0)).toBeNull();
  });

  it("has glyphs with the original advances in every face", async () => {
    for (const entry of OUTLINE_CLONES) {
      const font = (await outlineCloneFor(entry.key))!;
      const info = outlineCloneInfo(entry.key)!;
      for (let c = 1; c < 256; c++) {
        const g = font.glyph(c);
        expect(g?.advance, `${entry.id} ${c}`).toBe(info.advance(c));
      }
      // Letters actually have outlines.
      for (const c of [0x41, 0x61, 0x30, 0x8e]) expect(font.glyph(c)!.path.length).toBeGreaterThan(10);
    }
  });

  it("lays out a string as one y-down path", async () => {
    const font = (await outlineCloneFor(swissRoman))!;
    const { d, advance } = textToOutlinePath(font, "HH", 100);
    expect(advance).toBeCloseTo(144.6, 5); // 2 × 723 / 1000 × 100
    const perGlyph = font.glyph(0x48)!.path.match(/M/g)!.length;
    expect(d.match(/M/g)!.length).toBe(2 * perGlyph);
    // The second H starts 72.3 units to the right of the first.
    const starts = [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(starts[starts.length / 2]![0]! - starts[0]![0]!).toBeCloseTo(72.3, 1);
    // y down: cap height is above the baseline, so y values go negative.
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    expect(Math.min(...ys)).toBeLessThan(0);

    const codes = textToOutlinePath(font, [0x48, 0x48], 100);
    expect(codes).toEqual({ d, advance });
    const sample = textToOutlinePath(font, "Harvard Graphics 3", 1000);
    const expected = [..."Harvard Graphics 3"].reduce((s, ch) => s + font.glyph(codeForChar(ch)!)!.advance, 0);
    expect(sample.advance).toBeCloseTo(expected, 6);
    expect(sample.d).not.toMatch(/NaN/);
  });
});
