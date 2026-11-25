import { describe, expect, it } from 'vitest';
import { NotPcxError, decodePcx, type PcxImage } from './pcx';
import { canvasAvailable, encodeBmp, encodeBmpDataUrl, pcxToDataUrl } from './toDataUrl';

interface BuildOpts {
  width: number;
  height: number;
  bpp: number;
  planes: number;
  /** Raw (unencoded) image bytes: height * planes * bytesPerLine. */
  raw: number[];
  bytesPerLine?: number;
  version?: number;
  palette16?: number[][];
  vga?: number[][];
  /** Pre-encoded stream instead of encoding `raw` per line. */
  stream?: number[];
}

/** RLE-encode one buffer (runs never exceed 63 or cross the buffer). */
function rle(raw: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < raw.length) {
    let n = 1;
    while (i + n < raw.length && raw[i + n] === raw[i] && n < 63) n++;
    if (n > 1 || (raw[i] & 0xc0) === 0xc0) out.push(0xc0 | n, raw[i]);
    else out.push(raw[i]);
    i += n;
  }
  return out;
}

function buildPcx(o: BuildOpts): Uint8Array {
  const bpl = o.bytesPerLine ?? Math.ceil((o.width * o.bpp) / 8 / 2) * 2;
  const h = new Uint8Array(128);
  h[0] = 0x0a;
  h[1] = o.version ?? 5;
  h[2] = 1;
  h[3] = o.bpp;
  const put16 = (off: number, v: number) => { h[off] = v & 0xff; h[off + 1] = v >> 8; };
  put16(4, 0); put16(6, 0); put16(8, o.width - 1); put16(10, o.height - 1);
  put16(12, 72); put16(14, 72);
  (o.palette16 ?? []).forEach((c, i) => h.set(c, 16 + i * 3));
  h[65] = o.planes;
  put16(66, bpl);
  put16(68, 1);
  let stream = o.stream;
  if (!stream) {
    stream = [];
    const line = bpl * o.planes;
    for (let y = 0; y < o.height; y++) stream.push(...rle(o.raw.slice(y * line, (y + 1) * line)));
  }
  const tail = o.vga ? [0x0c, ...o.vga.flat(), ...new Array(768 - o.vga.length * 3).fill(0)] : [];
  return Uint8Array.from([...h, ...stream, ...tail]);
}

function px(img: PcxImage, x: number, y: number): number[] {
  const o = (y * img.width + x) * 4;
  return Array.from(img.rgba.subarray(o, o + 4));
}

const EGA16 = [
  [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
];

describe('decodePcx', () => {
  it('decodes 1 bpp monochrome with odd width and padding', () => {
    // width 10 -> 2 bytes needed, bytes per line 4 (padding ignored)
    const raw = [0b10100000, 0b01000000, 0xff, 0xff, 0x00, 0b11000000, 0xff, 0xff];
    const img = decodePcx(buildPcx({ width: 10, height: 2, bpp: 1, planes: 1, raw, bytesPerLine: 4 }));
    expect(img.warnings).toEqual([]);
    expect([img.width, img.height]).toEqual([10, 2]);
    expect(px(img, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(img, 1, 0)).toEqual([0, 0, 0, 255]);
    expect(px(img, 2, 0)).toEqual([255, 255, 255, 255]);
    expect(px(img, 9, 0)).toEqual([255, 255, 255, 255]);
    expect(px(img, 8, 0)).toEqual([0, 0, 0, 255]);
    expect(px(img, 7, 1)).toEqual([0, 0, 0, 255]);
    expect(px(img, 8, 1)).toEqual([255, 255, 255, 255]);
    expect(px(img, 9, 1)).toEqual([255, 255, 255, 255]);
  });

  it('decodes 1 bpp x 4 planes EGA with the header palette', () => {
    const pal = EGA16.map(([r, g, b]) => [b, g, r]); // distinct custom palette
    // 3 pixels wide; pixel 0 = index 5 (planes 0,2), pixel 1 = 15, pixel 2 = 8
    const plane = (p: number) => {
      const bits = [5, 15, 8].map((idx) => (idx >> p) & 1);
      return [(bits[0] << 7) | (bits[1] << 6) | (bits[2] << 5), 0];
    };
    const raw = [...plane(0), ...plane(1), ...plane(2), ...plane(3)];
    const img = decodePcx(buildPcx({ width: 3, height: 1, bpp: 1, planes: 4, raw, palette16: pal }));
    expect(px(img, 0, 0)).toEqual([...pal[5], 255]);
    expect(px(img, 1, 0)).toEqual([...pal[15], 255]);
    expect(px(img, 2, 0)).toEqual([...pal[8], 255]);
  });

  it('uses the default EGA palette for version 3', () => {
    const raw = [0x80, 0, 0x80, 0, 0, 0, 0, 0]; // index 3
    const img = decodePcx(buildPcx({ width: 1, height: 1, bpp: 1, planes: 4, raw, version: 3, palette16: [[1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]] }));
    expect(px(img, 0, 0)).toEqual([0, 170, 170, 255]);
  });

  it('decodes 2 bpp CGA from header entries 0-3, defaulting when zero', () => {
    const raw = [0b00011011, 0];
    const pal = [[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]];
    const img = decodePcx(buildPcx({ width: 4, height: 1, bpp: 2, planes: 1, raw, palette16: pal }));
    expect([0, 1, 2, 3].map((x) => px(img, x, 0)[0])).toEqual([1, 2, 3, 4]);
    const def = decodePcx(buildPcx({ width: 4, height: 1, bpp: 2, planes: 1, raw }));
    expect(px(def, 1, 0)).toEqual([0x55, 0xff, 0xff, 255]);
    expect(px(def, 3, 0)).toEqual([255, 255, 255, 255]);
  });

  it('decodes 4 bpp x 1 plane', () => {
    const raw = [0x1f, 0xa0];
    const img = decodePcx(buildPcx({ width: 3, height: 1, bpp: 4, planes: 1, raw, palette16: EGA16 }));
    expect(px(img, 0, 0)).toEqual([0, 0, 170, 255]);
    expect(px(img, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(px(img, 2, 0)).toEqual([85, 255, 85, 255]);
  });

  it('decodes 8 bpp with a trailing VGA palette', () => {
    const vga = Array.from({ length: 200 }, (_, i) => [i, 255 - i, 7]);
    const raw = [0, 199, 42, 0]; // width 3, padded to 4
    const img = decodePcx(buildPcx({ width: 3, height: 1, bpp: 8, planes: 1, raw, vga }));
    expect(img.warnings).toEqual([]);
    expect(px(img, 0, 0)).toEqual([0, 255, 7, 255]);
    expect(px(img, 1, 0)).toEqual([199, 56, 7, 255]);
    expect(px(img, 2, 0)).toEqual([42, 213, 7, 255]);
  });

  it('falls back to grayscale when the 256-colour palette is missing', () => {
    const img = decodePcx(buildPcx({ width: 2, height: 1, bpp: 8, planes: 1, raw: [10, 200] }));
    expect(img.warnings.some((w) => /palette missing/.test(w))).toBe(true);
    expect(px(img, 0, 0)).toEqual([10, 10, 10, 255]);
    expect(px(img, 1, 0)).toEqual([200, 200, 200, 255]);
  });

  it('decodes 8 bpp x 3 planes RGB', () => {
    // width 1, bpl 2: R plane, G plane, B plane per line
    const raw = [10, 0, 20, 0, 30, 0, 40, 0, 50, 0, 60, 0];
    const img = decodePcx(buildPcx({ width: 1, height: 2, bpp: 8, planes: 3, raw }));
    expect(px(img, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(img, 0, 1)).toEqual([40, 50, 60, 255]);
  });

  it('handles an RLE run crossing a scanline boundary', () => {
    // 4 bpp, width 4 -> bpl 2, height 2: one run of 4 bytes 0x12 spans both lines
    const img = decodePcx(buildPcx({ width: 4, height: 2, bpp: 4, planes: 1, raw: [], stream: [0xc4, 0x12], palette16: EGA16 }));
    expect(img.warnings).toEqual([]);
    expect(px(img, 0, 1)).toEqual([0, 0, 170, 255]);
    expect(px(img, 3, 1)).toEqual([0, 170, 0, 255]);
  });

  it('fills truncated data with colour 0 and warns', () => {
    const pal = [[9, 9, 9], [255, 0, 0]];
    const img = decodePcx(buildPcx({ width: 4, height: 2, bpp: 4, planes: 1, raw: [], stream: [0xc2, 0x11, 0xc1], palette16: pal }));
    expect(img.warnings.some((w) => /truncated/.test(w))).toBe(true);
    expect(px(img, 3, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 0, 1)).toEqual([9, 9, 9, 255]);
  });

  it('throws NotPcxError for a non-PCX header', () => {
    expect(() => decodePcx(new Uint8Array(200).fill(0x42))).toThrow(NotPcxError);
    expect(() => decodePcx(new Uint8Array(10))).toThrow(NotPcxError);
    const bad = buildPcx({ width: 1, height: 1, bpp: 3, planes: 1, raw: [0, 0] });
    expect(() => decodePcx(bad)).toThrow(NotPcxError);
  });
});

describe('data URLs', () => {
  const img = { width: 2, height: 2, rgba: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 128]) };

  it('encodes a bottom-up 32-bit BMP', () => {
    const b = encodeBmp(img);
    expect(b.length).toBe(54 + 16);
    expect([b[0], b[1]]).toEqual([0x42, 0x4d]);
    // first stored row is the bottom row: (7,8,9) as BGRA
    expect(Array.from(b.subarray(54, 62))).toEqual([9, 8, 7, 255, 12, 11, 10, 128]);
    expect(encodeBmpDataUrl(img).startsWith('data:image/bmp;base64,Qk')).toBe(true);
  });

  it('falls back to BMP without a DOM canvas', () => {
    if (canvasAvailable()) return;
    expect(pcxToDataUrl(img)).toBe(encodeBmpDataUrl(img));
  });
});
