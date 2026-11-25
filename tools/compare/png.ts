// Minimal PNG decode/encode (node zlib only). Decodes 8-bit RGB/RGBA/grey and
// 1/2/4/8-bit indexed images into RGB; keeps the index plane for indexed PNGs.
import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

export interface Img {
  width: number;
  height: number;
  /** RGB, 3 bytes per pixel. */
  rgb: Uint8Array;
  /** Palette indexes (indexed PNGs only). */
  index?: Uint8Array;
  palette?: [number, number, number][];
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): Img {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, ctype = 0;
  const idat: Uint8Array[] = [];
  let palette: [number, number, number][] | undefined;
  while (pos < buf.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = d.getUint32(0); height = d.getUint32(4); depth = data[8]; ctype = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "PLTE") {
      palette = [];
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = ctype === 2 ? 3 : ctype === 6 ? 4 : ctype === 4 ? 2 : 1;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      row[x] = v & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  let index: Uint8Array | undefined;
  if (ctype === 3) {
    index = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const bit = x * depth;
        const byte = out[y * stride + (bit >> 3)];
        const v = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        index[y * width + x] = v;
        const p = palette![v] ?? [0, 0, 0];
        rgb.set(p, (y * width + x) * 3);
      }
  } else if (ctype === 0 || ctype === 4) {
    for (let i = 0; i < width * height; i++) { const v = out[i * channels]; rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v; }
  } else {
    if (depth !== 8) throw new Error("16-bit PNG not supported");
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = out[i * channels + c];
  }
  return { width, height, rgb, index, palette };
}

export function readPng(path: string): Img {
  return decodePng(new Uint8Array(readFileSync(path)));
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes an RGB image as an 8-bit truecolour PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

export function writePng(path: string, width: number, height: number, rgb: Uint8Array) {
  writeFileSync(path, encodePng(width, height, rgb));
}
