// ZSoft PCX / PCC decoder (SPEC §6.3). PCC is the same format, used for
// clipped images. Written from the publicly documented ZSoft header layout:
//
//   0   u8   manufacturer (0x0A)
//   1   u8   version: 0 = PC Paintbrush 2.5 (fixed EGA palette)
//                     2 = 2.8 with palette
//                     3 = 2.8 without palette (use default EGA palette)
//                     4 = PC Paintbrush for Windows
//                     5 = 3.0 and later (may carry a 256-colour VGA palette)
//   2   u8   encoding (1 = RLE; 0 = uncompressed, rare but accepted)
//   3   u8   bits per pixel per plane
//   4   u16  xmin, ymin, xmax, ymax (inclusive)
//   12  u16  hdpi, vdpi
//   16  48   16-colour palette, RGB triples, 8 bits per component
//   64  u8   reserved
//   65  u8   colour planes
//   66  u16  bytes per line, per plane (even)
//   68  u16  palette info (1 = colour/mono, 2 = grayscale)
//   70  u16  screen size (ignored)
//   74  54   filler
//
// Image data follows at offset 128: each scanline stores its planes one
// after another, each `bytesPerLine` long. 8-bit images may end with 0x0C
// followed by a 768-byte VGA palette.

export interface PcxImage {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel, top row first. */
  rgba: Uint8ClampedArray;
  warnings: string[];
}

export class NotPcxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotPcxError';
  }
}

const HEADER_SIZE = 128;
/** Refuse absurd dimensions: a header claiming more is not a real PCX. */
const MAX_PIXELS = 1 << 26;

/** Standard EGA/VGA default 16-colour palette. */
const EGA_PALETTE: readonly (readonly [number, number, number])[] = [
  [0x00, 0x00, 0x00], [0x00, 0x00, 0xaa], [0x00, 0xaa, 0x00], [0x00, 0xaa, 0xaa],
  [0xaa, 0x00, 0x00], [0xaa, 0x00, 0xaa], [0xaa, 0x55, 0x00], [0xaa, 0xaa, 0xaa],
  [0x55, 0x55, 0x55], [0x55, 0x55, 0xff], [0x55, 0xff, 0x55], [0x55, 0xff, 0xff],
  [0xff, 0x55, 0x55], [0xff, 0x55, 0xff], [0xff, 0xff, 0x55], [0xff, 0xff, 0xff],
];

/** CGA palette 1, high intensity: black, cyan, magenta, white. */
const CGA_DEFAULT: readonly (readonly [number, number, number])[] = [
  [0x00, 0x00, 0x00], [0x55, 0xff, 0xff], [0xff, 0x55, 0xff], [0xff, 0xff, 0xff],
];

interface PcxHeader {
  version: number;
  encoding: number;
  bitsPerPixel: number;
  planes: number;
  bytesPerLine: number;
  width: number;
  height: number;
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function readHeader(bytes: Uint8Array): PcxHeader {
  if (bytes.length < HEADER_SIZE) throw new NotPcxError('file shorter than the 128-byte PCX header');
  if (bytes[0] !== 0x0a) throw new NotPcxError(`bad manufacturer byte 0x${bytes[0].toString(16)}`);
  const version = bytes[1];
  const encoding = bytes[2];
  const bitsPerPixel = bytes[3];
  if (encoding > 1) throw new NotPcxError(`unknown encoding ${encoding}`);
  if (![1, 2, 4, 8].includes(bitsPerPixel)) throw new NotPcxError(`bad bits per pixel ${bitsPerPixel}`);
  const xmin = u16(bytes, 4), ymin = u16(bytes, 6), xmax = u16(bytes, 8), ymax = u16(bytes, 10);
  if (xmax < xmin || ymax < ymin) throw new NotPcxError('image window is inverted');
  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  if (width * height > MAX_PIXELS) throw new NotPcxError(`implausible size ${width}x${height}`);
  const planes = bytes[65];
  if (planes < 1 || planes > 4) throw new NotPcxError(`bad plane count ${planes}`);
  return { version, encoding, bitsPerPixel, planes, bytesPerLine: u16(bytes, 66), width, height };
}

/** Header palette as 16 RGB triples (8-bit components). */
function headerPalette(bytes: Uint8Array, version: number): (readonly [number, number, number])[] {
  // Versions 0 (PC Paintbrush 2.5) and 3 (2.8 without palette) carry no
  // usable palette: use the standard EGA colours.
  if (version === 0 || version === 3) return EGA_PALETTE.slice();
  const pal: [number, number, number][] = [];
  let allZero = true;
  for (let i = 0; i < 16; i++) {
    const o = 16 + i * 3;
    pal.push([bytes[o], bytes[o + 1], bytes[o + 2]]);
    if (bytes[o] | bytes[o + 1] | bytes[o + 2]) allZero = false;
  }
  // Some writers leave the palette zeroed; an all-black palette is never
  // intended, so fall back to EGA.
  return allZero ? EGA_PALETTE.slice() : pal;
}

/**
 * Decode the image data into a flat buffer of `size` bytes. Runs may cross
 * scanline (and plane) boundaries in some writers, so decoding is done over
 * the whole stream rather than per line. Missing data stays 0.
 */
function decodeStream(
  bytes: Uint8Array,
  start: number,
  end: number,
  size: number,
  rle: boolean,
): { data: Uint8Array; truncated: boolean } {
  const data = new Uint8Array(size);
  let src = start;
  let dst = 0;
  if (!rle) {
    const n = Math.min(size, end - src);
    data.set(bytes.subarray(src, src + n));
    return { data, truncated: n < size };
  }
  while (dst < size) {
    if (src >= end) return { data, truncated: true };
    const b = bytes[src++];
    if ((b & 0xc0) === 0xc0) {
      if (src >= end) return { data, truncated: true };
      const value = bytes[src++];
      const count = Math.min(b & 0x3f, size - dst);
      data.fill(value, dst, dst + count);
      dst += count;
    } else {
      data[dst++] = b;
    }
  }
  return { data, truncated: false };
}

export function decodePcx(bytes: Uint8Array): PcxImage {
  const h = readHeader(bytes);
  const warnings: string[] = [];
  if (![0, 2, 3, 4, 5].includes(h.version)) warnings.push(`unknown PCX version ${h.version}`);
  const { width, height, bitsPerPixel: bpp, planes } = h;
  const rgba = new Uint8ClampedArray(width * height * 4);

  const supported =
    (bpp === 1 && planes >= 1 && planes <= 4) ||
    (planes === 1 && (bpp === 2 || bpp === 4 || bpp === 8)) ||
    (bpp === 8 && (planes === 3 || planes === 4));
  if (!supported) {
    warnings.push(`unsupported PCX layout: ${bpp} bpp x ${planes} planes; image left blank`);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    return { width, height, rgba, warnings };
  }

  let bytesPerLine = h.bytesPerLine;
  const needed = Math.ceil((width * bpp) / 8);
  if (bytesPerLine < needed) {
    warnings.push(`bytes per line ${bytesPerLine} is less than the ${needed} needed; using ${needed}`);
    bytesPerLine = needed;
  }

  // Trailing VGA palette: 0x0C marker 769 bytes from the end.
  let dataEnd = bytes.length;
  let vga: Uint8Array | null = null;
  if (bpp === 8 && planes === 1) {
    const m = bytes.length - 769;
    if (m >= HEADER_SIZE && bytes[m] === 0x0c) {
      vga = bytes.subarray(m + 1);
      dataEnd = m;
    } else {
      warnings.push('256-colour palette missing; drawing as grayscale');
    }
  }

  const lineSize = bytesPerLine * planes;
  const { data, truncated } = decodeStream(bytes, HEADER_SIZE, dataEnd, lineSize * height, h.encoding === 1);
  if (truncated) warnings.push('image data truncated; remaining pixels filled with colour 0');

  const pal16 = headerPalette(bytes, h.version);
  let palette: (readonly [number, number, number])[];
  if (bpp === 1 && planes === 1) {
    // Monochrome: black and white. Some writers store the two colours in
    // header palette entries 0 and 1, but most leave them meaningless, so
    // they are ignored.
    palette = [[0, 0, 0], [255, 255, 255]];
  } else if (bpp === 2 && planes === 1) {
    // CGA 4-colour. Strictly, the original format stores the CGA background
    // colour in the top nibble of palette byte 0 and palette/intensity
    // flags in byte 3, but later writers store four RGB triples. We read
    // entries 0-3 as RGB triples; if they are all zero (or the version has
    // no palette) we use CGA palette 1, high intensity.
    const raw = bytes.subarray(16, 28);
    const zero = raw.every((v) => v === 0);
    palette = zero || h.version === 0 || h.version === 3 ? CGA_DEFAULT.slice() : pal16.slice(0, 4);
  } else if (bpp === 8 && planes === 1) {
    palette = [];
    for (let i = 0; i < 256; i++) {
      palette.push(vga ? [vga[i * 3], vga[i * 3 + 1], vga[i * 3 + 2]] : [i, i, i]);
    }
  } else {
    palette = pal16;
  }

  const black = [0, 0, 0] as const;
  for (let y = 0; y < height; y++) {
    const line = y * lineSize;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 8 && planes >= 3) {
        rgba[o] = data[line + x];
        rgba[o + 1] = data[line + bytesPerLine + x];
        rgba[o + 2] = data[line + 2 * bytesPerLine + x];
        rgba[o + 3] = planes === 4 ? data[line + 3 * bytesPerLine + x] : 255;
        continue;
      }
      let index: number;
      if (bpp === 1) {
        index = 0;
        const byte = x >> 3;
        const shift = 7 - (x & 7);
        for (let p = 0; p < planes; p++) {
          index |= ((data[line + p * bytesPerLine + byte] >> shift) & 1) << p;
        }
      } else {
        const bit = x * bpp;
        const shift = 8 - bpp - (bit & 7);
        index = (data[line + (bit >> 3)] >> shift) & ((1 << bpp) - 1);
      }
      const c = palette[index] ?? black;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba, warnings };
}
