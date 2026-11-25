/**
 * Synthetic Harvard Graphics 3 file builder for tests (SPEC §3).
 *
 * Example:
 *
 *   const file = buildDocument("HGB3", DocumentType.Title, [
 *     block(500, [leaf(400, cstr("My chart"))]),
 *     block(504, [block(516, [], new Uint8Array(16))]),
 *   ]);
 *
 * `buildDocument` adds the version record (tag 0) and the end record (tag 1);
 * `buildFile` writes exactly the records you give it, for malformed files.
 */
import { BLOCK_CLOSE_FOR_OPEN } from "../container";

/** Anything that can become bytes: a byte array, or a list of byte values. */
export type ByteSource = Uint8Array | readonly number[];

/** A record to write: a leaf, a block (open + children + close), or raw bytes. */
export type RecordSpec =
  | { kind: "leaf"; tag: number; data: Uint8Array; length?: number }
  | { kind: "block"; openTag: number; closeTag: number; data: Uint8Array; children: RecordSpec[] }
  | { kind: "raw"; bytes: Uint8Array };

function toBytes(src: ByteSource | undefined): Uint8Array {
  if (src === undefined) return new Uint8Array(0);
  return src instanceof Uint8Array ? src : Uint8Array.from(src);
}

/** Concatenate byte sources. */
export function concat(...parts: ByteSource[]): Uint8Array {
  const arrays = parts.map(toBytes);
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

function dv(n: number, write: (v: DataView) => void): Uint8Array {
  const buf = new Uint8Array(n);
  write(new DataView(buf.buffer));
  return buf;
}

export const u8 = (v: number): Uint8Array => Uint8Array.of(v & 0xff);
export const u16 = (v: number): Uint8Array => dv(2, (d) => d.setUint16(0, v, true));
export const i16 = (v: number): Uint8Array => dv(2, (d) => d.setInt16(0, v, true));
export const u32 = (v: number): Uint8Array => dv(4, (d) => d.setUint32(0, v, true));
export const f32 = (v: number): Uint8Array => dv(4, (d) => d.setFloat32(0, v, true));
export const f64 = (v: number): Uint8Array => dv(8, (d) => d.setFloat64(0, v, true));
/** The f64 "not set" pattern 0xFFF0000000000000 (SPEC §3). */
export const f64NotSet = (): Uint8Array => f64(Number.NEGATIVE_INFINITY);
/** ASCII/Latin-1 bytes, no terminator (chars above 0xFF are masked). */
export const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
/** NUL-terminated string. */
export const cstr = (s: string): Uint8Array => concat(ascii(s), [0]);
/** Exactly n bytes: the string, NUL-padded (truncated if longer). */
export const padded = (s: string, n: number): Uint8Array => {
  const out = new Uint8Array(n);
  out.set(ascii(s).subarray(0, n));
  return out;
};

/** A plain record. `length` overrides the length field (for corrupt-file tests). */
export function leaf(tag: number, data?: ByteSource, length?: number): RecordSpec {
  return { kind: "leaf", tag, data: toBytes(data), length };
}

/**
 * A block: open record (with `data`: empty, except 16 bytes for 516 and 608),
 * children, then the matching close record from the block table.
 */
export function block(openTag: number, children: RecordSpec[] = [], data?: ByteSource): RecordSpec {
  const closeTag = BLOCK_CLOSE_FOR_OPEN.get(openTag);
  if (closeTag === undefined) throw new Error(`${openTag} is not a block open tag`);
  return { kind: "block", openTag, closeTag, data: toBytes(data), children };
}

/** Bytes written verbatim (e.g. a truncated record header). */
export function raw(bytes: ByteSource): RecordSpec {
  return { kind: "raw", bytes: toBytes(bytes) };
}

/** Encode records (no signature). */
export function encodeRecords(records: readonly RecordSpec[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const walk = (r: RecordSpec): void => {
    switch (r.kind) {
      case "leaf":
        parts.push(u16(r.tag), u16(r.length ?? r.data.length), r.data);
        break;
      case "block":
        parts.push(u16(r.openTag), u16(r.data.length), r.data);
        r.children.forEach(walk);
        parts.push(u16(r.closeTag), u16(0));
        break;
      case "raw":
        parts.push(r.bytes);
        break;
    }
  };
  records.forEach(walk);
  return concat(...parts);
}

/** Signature followed by exactly the given records. */
export function buildFile(signature: string, records: readonly RecordSpec[]): Uint8Array {
  return concat(ascii(signature), encodeRecords(records));
}

/** Version record (tag 0): bytes 0, 3, 0, documentType (SPEC §3). */
export function versionRecord(documentType: number): RecordSpec {
  return leaf(0, [0, 3, 0, documentType]);
}

/** End record (tag 1, length 0). */
export const END: RecordSpec = leaf(1);

/** A well-formed document: signature, version record, records, end record. */
export function buildDocument(signature: string, documentType: number, records: readonly RecordSpec[]): Uint8Array {
  return buildFile(signature, [versionRecord(documentType), ...records, END]);
}
