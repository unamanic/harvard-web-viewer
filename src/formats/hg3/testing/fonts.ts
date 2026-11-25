/**
 * Test-only builders for font files: a minimal Speedo encoder (synthetic
 * fonts, after src/formats/speedo/speedo.test.ts) and HG3.FGF entries.
 */
import { NO_GLYPH } from "../fgf";
import { ascii, concat, padded, u16 } from "./bytes";

type Word = (v: number) => number[];

/** Build an unencrypted Speedo font from character bodies (each made with a word encoder). */
export function buildSpeedo(glyphs: ((w: Word) => number[])[]): Uint8Array {
  const w: Word = (v) => [v & 0xff, (v >> 8) & 0xff];
  const bodies = glyphs.map((g) => g(w));
  const n = bodies.length;
  const header = new Uint8Array(420);
  const dv = new DataView(header.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (header[o + i] = c.charCodeAt(0)));
  str(0, "D1.0\r\n");
  const dirOffset = 420 + 24;
  const charData = dirOffset + 1 + (n + 1) * 2;
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
  const long3 = (v: number) => [(v >> 8) & 0xff, (v >> 16) & 0xff, v & 0xff];
  const priv = [0, 0, 0, 0, 0, 0, ...long3(dirOffset), ...long3(0), ...long3(0), ...long3(0), ...long3(charData), ...long3(size)];
  const dir = [0];
  let off = charData;
  for (let i = 0; i <= n; i++) {
    dir.push(...w(off));
    if (i < n) off += bodies[i]!.length;
  }
  return new Uint8Array([...header, ...priv, ...dir, ...bodies.flat()]);
}

const END = 0x30;

/** Blank glyph, advance 250. */
export const SPEEDO_SPACE = (w: Word) => [...w(32), ...w(250), 0x00, 0x3a, 0, 0, 0xff, END];

/** Square 100..500 × 0..400, advance 600: path "M100 0L500 0L500 400L100 400Z". */
export const SPEEDO_SQUARE = (w: Word) => [
  ...w(65), ...w(600),
  0x1c, 2, 2, ...w(100), ...w(500), ...w(0), ...w(400),
  0x10, 0, 0x21, 0, 0x10, 0,
  0x00, 1, 0, 2, 0xc3, 1, 1,
  0x50, 1, 0,
  0x0c, 2,
  0x03, 1,
  0x09, ...w(100), 0,
  END,
];

/** Triangle with one cubic, advance 650: path "M0 0L600 0C500 300 100 300 0 0Z". */
export const SPEEDO_TRIANGLE = (w: Word) => [
  ...w(66), ...w(650),
  0x00,
  0x15, ...w(0), ...w(0), ...w(600), 0xd7, ...w(500), ...w(0),
  0x55, ...w(0), ...w(0),
  0x0d, ...w(600),
  0x86, 0x55, 0x9c, ...w(300), ...w(100), ...w(300), ...w(0), ...w(0),
  END,
];

export interface FgfEntrySpec {
  source: number;
  number: number;
  style: number;
  name: string;
  fileName: string;
  /** code → Speedo directory index; codes not given have no glyph. */
  map?: Record<number, number>;
}

/** HG3.FGF with the given entries (SPEC §2). */
export function buildFgf(entries: FgfEntrySpec[]): Uint8Array {
  return concat(
    ascii("IDXF"),
    u16(entries.length),
    ...entries.map((e) => {
      const map: Uint8Array[] = [];
      for (let c = 0; c < 256; c++) map.push(u16(e.map?.[c] ?? NO_GLYPH));
      return concat(u16(e.source), u16(e.number), u16(e.style), [0, 0, 0, 0], padded(e.name, 48), padded(e.fileName, 18), ...map);
    }),
  );
}
