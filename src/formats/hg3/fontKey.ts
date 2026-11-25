/**
 * Font key (SPEC §2): a document names a font by the triple (source, number,
 * style word), 6 bytes, three u16. The same triple identifies an entry of the
 * font index HG3.FGF.
 */
import type { ByteReader } from "./ByteReader";

export interface FontKey {
  /** 3 = Bitstream Speedo outline font, 2 = Harvard Graphics stroke font. */
  source: number;
  /** Font number (for Speedo fonts, the nnn of BX000nnn.SPD). */
  number: number;
  /** Style word: bit 0 italic, low byte weight, high byte font family kind (SPEC §2). */
  style: number;
}

/** Bytes a font key occupies. */
export const FONT_KEY_LENGTH = 6;

/** Font key source values (SPEC §2). */
export const FontSource = {
  Stroke: 2,
  Speedo: 3,
} as const;

/** Read a 6-byte font key. Throws TruncatedError if fewer than 6 bytes remain. */
export function readFontKey(reader: ByteReader): FontKey {
  const source = reader.u16();
  const number = reader.u16();
  const style = reader.u16();
  return { source, number, style };
}

/** True when all three values are zero: the key is missing. */
export function isEmptyFontKey(key: FontKey): boolean {
  return key.source === 0 && key.number === 0 && key.style === 0;
}

/** Stable string for maps and display, e.g. "3:3:0x4268". */
export function fontKeyString(key: FontKey): string {
  return `${key.source}:${key.number}:0x${key.style.toString(16).padStart(4, "0")}`;
}

/** Field-by-field equality. */
export function fontKeysEqual(a: FontKey, b: FontKey): boolean {
  return a.source === b.source && a.number === b.number && a.style === b.style;
}
