/**
 * Little-endian field readers for the 1.x/2.x readers (SPEC-HG1-HG2 §1
 * conventions). Every reader is bounds-safe: a field past the end of the
 * data reads as 0 (or an empty string), so a short record never throws.
 */

/** f32 values at or above this mean "missing" or "auto" (1e30, bytes ca f2 49 71). */
const MISSING_THRESHOLD = 1e29;

export class Bytes {
  private readonly view: DataView;
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  get length(): number {
    return this.data.length;
  }
  u8(offset: number): number {
    return offset >= 0 && offset < this.data.length ? this.data[offset] : 0;
  }
  u16(offset: number): number {
    return offset >= 0 && offset + 2 <= this.data.length ? this.view.getUint16(offset, true) : 0;
  }
  f32(offset: number): number {
    return offset >= 0 && offset + 4 <= this.data.length ? this.view.getFloat32(offset, true) : 0;
  }
  /** f32, with 1e30 (and anything that is not a finite number) as null. */
  value(offset: number): number | null {
    if (offset < 0 || offset + 4 > this.data.length) return null;
    const v = this.view.getFloat32(offset, true);
    return Number.isFinite(v) && Math.abs(v) < MISSING_THRESHOLD ? v : null;
  }
  /**
   * Length-prefixed string in a field of `fieldSize` bytes (length byte
   * included). Bytes after the length are leftover memory and are ignored.
   */
  pstring(offset: number, fieldSize = 256): string {
    const len = Math.min(this.u8(offset), Math.max(0, fieldSize - 1));
    return cp437(this.data.subarray(offset + 1, Math.min(offset + 1 + len, this.data.length)));
  }
  slice(offset: number, length: number): Uint8Array {
    return this.data.subarray(Math.max(0, offset), Math.min(this.data.length, offset + length));
  }
}

/** Code page 437 upper half (0x80..0xFF). */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

export function cp437(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    if (b >= 0x80) s += CP437_HIGH[b - 0x80];
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else if (b === 0) break;
    else s += " ";
  }
  return s;
}

/** True when the four bytes at the start spell `sig`. */
export function hasSignature(bytes: Uint8Array, sig: string): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig.charCodeAt(i)) return false;
  return true;
}
