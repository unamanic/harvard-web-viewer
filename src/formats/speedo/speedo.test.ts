import { describe, expect, it } from "vitest";
import { NotSpeedoError, fontMetricsTable, parseSpeedo } from "./speedo";

// ---- minimal Speedo encoder (synthetic fonts only) -------------------------

interface Keys {
  key4: number;
  key6: number;
  key32: number;
}

interface FontSpec {
  keys?: Keys;
  /** 3-byte directory entries instead of 2-byte words. */
  wide?: boolean;
  /** Character bodies; each is built with a word encoder for the key. */
  glyphs: ((w: (v: number) => number[]) => number[])[];
}

function buildFont(spec: FontSpec): Uint8Array {
  const keys = spec.keys ?? { key4: 0, key6: 0, key32: 0 };
  const w = (v: number) => {
    const x = (v & 0xffff) ^ keys.key32;
    return [x & 0xff, x >> 8];
  };
  const bodies = spec.glyphs.map((g) => g(w));
  const n = bodies.length;
  const header = new Uint8Array(420);
  const dv = new DataView(header.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (header[o + i] = c.charCodeAt(0)));
  str(0, "D1.0\r\n");
  const dirOffset = 420 + 24;
  const entry = spec.wide ? 3 : 2;
  const charData = dirOffset + 1 + (n + 1) * entry;
  const size = charData + bodies.reduce((a, b) => a + b.length, 0);
  dv.setUint32(8, size);
  dv.setUint32(12, charData);
  dv.setUint16(18, 420);
  dv.setUint16(20, 7);
  str(24, "Test Sans");
  str(266, "TestSans-Roman");
  str(298, "Test Sans");
  str(314, "Roman");
  dv.setUint16(254, n);
  dv.setUint16(330, 1000);
  [250, 1000, 500, 200, 550].forEach((v, i) => dv.setUint16(332 + 2 * i, v));
  [-50, -200, 1100, 900].forEach((v, i) => dv.setInt16(342 + 2 * i, v));
  dv.setInt16(350, -100);
  dv.setUint16(352, 50);
  dv.setInt16(328, -12 * 256);

  const long3 = (v: number) => [((v >> 8) & 0xff) ^ keys.key4, (v >> 16) & 0xff, (v & 0xff) ^ keys.key6];
  const priv = [0, 0, 0, 0, 0, 0, ...long3(dirOffset), ...long3(0), ...long3(0), ...long3(0), ...long3(charData), ...long3(size)];
  const dir = [spec.wide ? 1 : 0];
  let off = charData;
  for (let i = 0; i <= n; i++) {
    dir.push(...(spec.wide ? long3(off) : w(off)));
    if (i < n) off += bodies[i].length;
  }
  return new Uint8Array([...header, ...priv, ...dir, ...bodies.flat()]);
}

const END = 0x30;

/** id 0: blank space, width 250, bbox at the origin. */
const space = (w: (v: number) => number[]) => [...w(32), ...w(250), 0x00, 0x3a, 0, 0, 0xff, END];

/** id 1: square 100..500 × 0..400 using edge indices; width 600. */
const square = (w: (v: number) => number[]) => [
  ...w(65), ...w(600),
  0x1c, 2, 2, ...w(100), ...w(500), ...w(0), ...w(400), // plaid: X [0,100,500], Y [0,400]
  0x10, 0, 0x21, 0, 0x10, 0, // 3 control zones (short from/to + constraint)
  0x00, 1, 0, 2, 0xc3, 1, 1, // bbox
  0x50, 1, 0, // MOVE (edge x1, edge y0) = (100, 0)
  0x0c, 2, // LINE x = edge 2 → (500, 0)
  0x03, 1, // LINE y = edge 1 → (500, 400)
  0x09, ...w(100), 0, // LINE x word, y += 0 → (100, 400)
  END,
];

/** id 2: triangle with one cubic; width 650; no plaid. */
const triangle = (w: (v: number) => number[]) => [
  ...w(66), ...w(650),
  0x00,
  0x15, ...w(0), ...w(0), ...w(600), 0xd7, ...w(500), ...w(0), // bbox 0..600 × 0..500
  0x55, ...w(0), ...w(0), // MOVE (0, 0)
  0x0d, ...w(600), // LINE (600, 0)
  0x86, 0x55, 0x9c, ...w(300), ...w(100), ...w(300), ...w(0), ...w(0), // CURVE (500,300) (100,300) (0,0)
  END,
];

/** id 3: compound = square moved (-50, +10) + triangle at half scale. */
const compound = (w: (v: number) => number[]) => [
  ...w(67), ...w(500),
  0x01,
  0x15, ...w(0), ...w(0), ...w(450), 0xd7, ...w(410), ...w(0),
  0x89, ...w(-50), 10, 1, // part: dx word, dy byte, glyph 1
  0xb0, ...w(2048), ...w(2048), 2, // part: scale ½ × ½, glyph 2
  0x00,
];

const KEYS = { key4: 0x12, key6: 0x34, key32: 0x5678 };

describe("parseSpeedo", () => {
  const font = parseSpeedo(buildFont({ keys: KEYS, glyphs: [space, square, triangle, compound] }));

  it("reads the header", () => {
    expect(font.formatId).toBe("D1.0");
    expect(font.name).toBe("Test Sans");
    expect(font.shortName).toBe("TestSans-Roman");
    expect(font.form).toBe("Roman");
    expect(font.orusPerEm).toBe(1000);
    expect(font.glyphCount).toBe(4);
    expect(font.metrics.wordSpace).toBe(250);
    expect(font.metrics.italicAngle).toBe(-12);
    expect(font.metrics.fontBBox).toEqual({ xMin: -50, yMin: -200, xMax: 1100, yMax: 900 });
    expect(font.metrics.underlinePosition).toBe(-100);
    expect(font.warnings).toEqual([]);
  });

  it("decodes a blank glyph", () => {
    const g = font.glyph(0)!;
    expect(g).toMatchObject({ charCode: 32, advanceWidth: 250, path: "", contours: 0 });
  });

  it("decodes edge-indexed lines (y up, as stored)", () => {
    const g = font.glyph(1)!;
    expect(g.advanceWidth).toBe(600);
    expect(g.bbox).toEqual({ xMin: 100, yMin: 0, xMax: 500, yMax: 400 });
    expect(g.path).toBe("M100 0L500 0L500 400L100 400Z");
    expect(g.contours).toBe(1);
  });

  it("decodes curves and byte deltas", () => {
    const g = font.glyph(2)!;
    expect(g.advanceWidth).toBe(650);
    expect(g.bbox).toEqual({ xMin: 0, yMin: 0, xMax: 600, yMax: 500 });
    expect(g.path).toBe("M0 0L600 0C500 300 100 300 0 0Z");
  });

  it("decodes compound characters with offsets and scales", () => {
    const g = font.glyph(3)!;
    expect(g.compound).toBe(true);
    expect(g.contours).toBe(2);
    expect(g.path).toBe("M50 10L450 10L450 410L50 410ZM0 0L300 0C250 150 50 150 0 0Z");
  });

  it("caches glyphs and returns null for empty or unknown ids", () => {
    expect(font.glyph(1)).toBe(font.glyph(1));
    expect(font.glyph(99)).toBeNull();
    expect(font.glyph(-1)).toBeNull();
  });

  it("reads 3-byte directories", () => {
    const f = parseSpeedo(buildFont({ wide: true, glyphs: [space, square, triangle] }));
    expect(f.glyph(2)!.path).toBe("M0 0L600 0C500 300 100 300 0 0Z");
    expect(f.warnings).toEqual([]);
  });

  it("returns null with a warning for a damaged glyph", () => {
    const bad = (w: (v: number) => number[]) => {
      const b = square(w);
      b[b.indexOf(0x50) + 1] = 9; // edge index out of range
      return b;
    };
    const f = parseSpeedo(buildFont({ glyphs: [space, bad, triangle] }));
    expect(f.glyph(1)).toBeNull();
    expect(f.warnings.join()).toMatch(/glyph 1: X edge index 9/);
    expect(f.glyph(2)).not.toBeNull();
  });

  it("throws NotSpeedoError on a bad header", () => {
    expect(() => parseSpeedo(new Uint8Array(10))).toThrow(NotSpeedoError);
    const bytes = buildFont({ glyphs: [space] });
    expect(() => parseSpeedo(bytes.slice(0, 300))).toThrow(NotSpeedoError);
    bytes[0] = 0x58;
    expect(() => parseSpeedo(bytes)).toThrow(NotSpeedoError);
  });
});

describe("fontMetricsTable", () => {
  it("maps CP437 codes through the character map", () => {
    const font = parseSpeedo(buildFont({ keys: KEYS, glyphs: [space, square, triangle, compound] }));
    const map = new Uint16Array(256).fill(0xffff);
    map[0x20] = 0;
    map[0x48] = 1; // 'H' → square
    map[0x78] = 2; // 'x' → triangle
    map[0x70] = 3; // 'p' → compound
    const t = fontMetricsTable(font, map);
    expect(t.orusPerEm).toBe(1000);
    expect(t.advances).toHaveLength(256);
    expect(t.advances[0x20]).toBe(250);
    expect(t.advances[0x48]).toBe(600);
    expect(t.advances[0x41]).toBeNull();
    expect(t.capHeight).toBe(400);
    expect(t.xHeight).toBe(500);
    expect(t.descender).toBe(0);
    expect(t.ascender).toBeUndefined();
    expect(t.header.emSpace).toBe(1000);
  });
});
