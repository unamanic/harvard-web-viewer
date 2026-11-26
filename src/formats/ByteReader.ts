/**
 * Little-endian binary reader for Harvard Graphics 3 files (SPEC §1
 * Conventions, §3).
 */
import { decodeHg3Text } from "./charset";

/** Bytes → string; text uses decodeHg3Text, file names decodeFileName (charset.ts). */
export type StringDecoder = (bytes: Uint8Array) => string;

/** Thrown when a read would run past the end of the reader's bytes. */
export class TruncatedError extends Error {
  /** Position (relative to the reader) where the read was attempted. */
  readonly offset: number;
  /** Number of bytes the read needed. */
  readonly requested: number;
  /** Bytes that were actually left. */
  readonly available: number;

  constructor(offset: number, requested: number, available: number) {
    super(`Truncated: needed ${requested} byte(s) at offset ${offset}, ${available} available`);
    this.name = "TruncatedError";
    this.offset = offset;
    this.requested = requested;
    this.available = available;
  }
}

/** High 32 bits of the f64 "not set" pattern 0xFFF0000000000000 (SPEC §3). */
export const NOT_SET_HI = 0xfff00000;
/** Low 32 bits of the f64 "not set" pattern. */
export const NOT_SET_LO = 0x00000000;

/** True for the f64 "not set; choose automatically" value, -Infinity (SPEC §3). */
export function isNotSet(value: number): boolean {
  return value === Number.NEGATIVE_INFINITY;
}

export class ByteReader {
  private readonly bytesView: Uint8Array;
  private readonly view: DataView;
  private position = 0;

  constructor(bytes: Uint8Array) {
    this.bytesView = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Current position, relative to the start of this reader. */
  get pos(): number {
    return this.position;
  }

  /** Total bytes in this reader. */
  get length(): number {
    return this.bytesView.length;
  }

  /** Bytes left from the current position. */
  get remaining(): number {
    return this.bytesView.length - this.position;
  }

  /** Throw TruncatedError unless n bytes are available; returns the start position. */
  private take(n: number): number {
    if (n < 0 || !Number.isInteger(n) || n > this.remaining) {
      throw new TruncatedError(this.position, n, this.remaining);
    }
    const start = this.position;
    this.position += n;
    return start;
  }

  u8(): number {
    return this.view.getUint8(this.take(1));
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }

  i16(): number {
    return this.view.getInt16(this.take(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }

  f32(): number {
    return this.view.getFloat32(this.take(4), true);
  }

  f64(): number {
    return this.view.getFloat64(this.take(8), true);
  }

  /** Read an f64, returning null for the "not set" bit pattern 0xFFF0000000000000 (SPEC §3). */
  f64OrNotSet(): number | null {
    const at = this.take(8);
    const lo = this.view.getUint32(at, true);
    const hi = this.view.getUint32(at + 4, true);
    if (hi === NOT_SET_HI && lo === NOT_SET_LO) return null;
    return this.view.getFloat64(at, true);
  }

  /**
   * NUL-terminated string; consumes the NUL. Throws TruncatedError if no NUL.
   * Decoded in the HG3 character set unless another decoder is given.
   */
  cstring(decode: StringDecoder = decodeHg3Text): string {
    const start = this.position;
    const end = this.bytesView.indexOf(0, start);
    if (end < 0) throw new TruncatedError(start, this.remaining + 1, this.remaining);
    this.position = end + 1;
    return decode(this.bytesView.subarray(start, end));
  }

  /**
   * "padded string[n]" (SPEC §1): consumes exactly n bytes; text runs to the
   * first NUL, with trailing spaces trimmed. Decoded in the HG3 character
   * set unless another decoder is given.
   */
  paddedString(n: number, decode: StringDecoder = decodeHg3Text): string {
    const raw = this.bytes(n);
    const nul = raw.indexOf(0);
    let end = nul < 0 ? raw.length : nul;
    while (end > 0 && raw[end - 1] === 0x20) end--;
    return decode(raw.subarray(0, end));
  }

  /** Next n bytes as a subarray view (no copy). */
  bytes(n: number): Uint8Array {
    const start = this.take(n);
    return this.bytesView.subarray(start, start + n);
  }

  skip(n: number): void {
    this.take(n);
  }

  /** Move to an absolute position (0..length). */
  seek(pos: number): void {
    if (pos < 0 || !Number.isInteger(pos) || pos > this.length) {
      throw new TruncatedError(pos, 0, Math.max(0, this.length - pos));
    }
    this.position = pos;
  }

  /** New reader over the next n bytes; this reader advances past them. */
  sub(n: number): ByteReader {
    return new ByteReader(this.bytes(n));
  }
}
