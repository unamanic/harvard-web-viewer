/**
 * EBML writing (the binary format under Matroska/WebM): element IDs as
 * stored (their length marker included), sizes as variable-length
 * integers, and element trees serialised to bytes.
 */

/** An element: id (as written, e.g. 0x1A45DFA3) and its payload or children. */
export interface EbmlElement {
  id: number;
  data: EbmlData;
}

export type EbmlData =
  | Uint8Array
  | EbmlElement[]
  | { uint: number; width?: number }
  | { float: number }
  | { string: string };

/** Bytes of an element ID (1–4 bytes; the ID's own leading bits give its length). */
export function encodeId(id: number): Uint8Array {
  if (id < 0 || !Number.isInteger(id) || id > 0xffffffff) throw new RangeError(`Bad EBML id ${id}`);
  const bytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  if (bytes.length === 0) throw new RangeError("Bad EBML id 0");
  // The length marker must match the byte count.
  const lead = bytes[0];
  const len = lead >= 0x80 ? 1 : lead >= 0x40 ? 2 : lead >= 0x20 ? 3 : lead >= 0x10 ? 4 : 0;
  if (len !== bytes.length) throw new RangeError(`EBML id 0x${id.toString(16)} has a bad length marker`);
  return Uint8Array.from(bytes);
}

/** Largest size a vint of `width` bytes can hold (all-ones is reserved for "unknown"). */
export function vintMax(width: number): number {
  return 2 ** (7 * width) - 2;
}

/**
 * A size as an EBML variable-length integer: `width` bytes when given
 * (1..8), else the shortest that holds it.
 */
export function encodeSize(size: number, width?: number): Uint8Array {
  if (size < 0 || !Number.isSafeInteger(size)) throw new RangeError(`Bad EBML size ${size}`);
  let w = width ?? 1;
  if (width === undefined) while (size > vintMax(w)) w++;
  if (w < 1 || w > 8 || size > vintMax(w)) throw new RangeError(`EBML size ${size} does not fit ${w} bytes`);
  const out = new Uint8Array(w);
  let v = size;
  for (let i = w - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (w - 1);
  return out;
}

/** An unsigned integer, big-endian, in `width` bytes (default: as few as hold it, at least one). */
export function encodeUint(value: number, width?: number): Uint8Array {
  if (value < 0 || !Number.isSafeInteger(value)) throw new RangeError(`Bad EBML uint ${value}`);
  let w = width ?? 1;
  if (width === undefined) while (w < 8 && value >= 2 ** (8 * w)) w++;
  const out = new Uint8Array(w);
  let v = value;
  for (let i = w - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  if (v !== 0) throw new RangeError(`EBML uint ${value} does not fit ${w} bytes`);
  return out;
}

export function encodeFloat64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

function payload(data: EbmlData): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return concatBytes(data.map(serialize));
  if ("uint" in data) return encodeUint(data.uint, data.width);
  if ("float" in data) return encodeFloat64(data.float);
  return new TextEncoder().encode(data.string);
}

/** Bytes of an element: id, size, payload. */
export function serialize(el: EbmlElement): Uint8Array {
  const body = payload(el.data);
  return concatBytes([encodeId(el.id), encodeSize(body.length), body]);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading (tests and self-checks)
// ---------------------------------------------------------------------------

/** A parsed element: where it starts, its id, and where its payload is. */
export interface ParsedElement {
  id: number;
  offset: number;
  headerSize: number;
  size: number;
  /** Payload (a view into the file). */
  data: Uint8Array;
}

function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number } {
  const first = bytes[pos];
  if (first === undefined || first === 0) throw new Error(`Bad EBML vint at ${pos}`);
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[pos + i];
  return { value, length };
}

/** The elements one after another in `bytes` (one level). */
export function readElements(bytes: Uint8Array, base = 0): ParsedElement[] {
  const out: ParsedElement[] = [];
  for (let pos = 0; pos < bytes.length; ) {
    const id = readVint(bytes, pos, true);
    const size = readVint(bytes, pos + id.length, false);
    const headerSize = id.length + size.length;
    const start = pos + headerSize;
    if (start + size.value > bytes.length) throw new Error(`EBML element 0x${id.value.toString(16)} runs past its parent`);
    out.push({ id: id.value, offset: base + pos, headerSize, size: size.value, data: bytes.subarray(start, start + size.value) });
    pos = start + size.value;
  }
  return out;
}

export function readUint(data: Uint8Array): number {
  let v = 0;
  for (const b of data) v = v * 256 + b;
  return v;
}

export function readFloat(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return data.length === 4 ? view.getFloat32(0) : view.getFloat64(0);
}
