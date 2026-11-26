/**
 * Font index HG3.FGF (SPEC §2 "Font index (HG3.FGF)").
 *
 * Layout: ASCII "IDXF", u16 entry count, then `count` entries of 588 bytes
 * starting at offset 6. Each entry:
 *
 *   +0   u16  font source (3 = Speedo outline, 2 = HG stroke)
 *   +2   u16  font number
 *   +4   u16  style word
 *   +6   4    classification [?] (kept raw)
 *   +10  padded string[48]  "Family|Style"
 *   +58  padded string[18]  font file name
 *   +76  256 × u16          character map; 0xFFFF = no glyph [I]
 *
 * Also holds the built-in table used when HG3.FGF is missing (task 7).
 */
import { ByteReader } from "../ByteReader";
import { decodeFileName } from "../charset";
import { type FontKey, FontSource, readFontKey } from "../../fonts/fontKey";

/** "IDXF" (SPEC §2). */
export const FGF_SIGNATURE = "IDXF";
/** Bytes before the first entry: signature + u16 count. */
export const FGF_HEADER_LENGTH = 6;
/** Bytes per entry (0x24C). */
export const FGF_ENTRY_LENGTH = 588;
/** Character map value meaning "no glyph for this code" [I]. */
export const NO_GLYPH = 0xffff;

export interface FgfEntry {
  key: FontKey;
  /** Entry bytes 6..9, meaning unknown (SPEC §2 [?]). */
  classification: Uint8Array;
  /** Full display name as stored, e.g. "Dutch 801|Bold". */
  name: string;
  /** Part before "|", e.g. "Dutch 801". */
  family: string;
  /** Part after "|", e.g. "Bold" ("" if there is no "|"). */
  style: string;
  /** Font file name, e.g. "BX000013.SPD". */
  fileName: string;
  /** Code (0..255, CP437) → the font's own character id; NO_GLYPH = none. */
  charMap: Uint16Array;
}

/** Thrown when the bytes don't start with "IDXF". */
export class NotFgfError extends Error {
  constructor() {
    super("not a Harvard Graphics font index (no IDXF signature)");
    this.name = "NotFgfError";
  }
}

/** Split "Family|Style" into its two trimmed parts. */
export function splitFontName(name: string): { family: string; style: string } {
  const bar = name.indexOf("|");
  if (bar < 0) return { family: name.trim(), style: "" };
  return { family: name.slice(0, bar).trim(), style: name.slice(bar + 1).trim() };
}

/**
 * Parse HG3.FGF. Throws NotFgfError if the signature is wrong; a count that
 * disagrees with the file length, a truncated last entry or trailing bytes
 * are warnings (SPEC §7.1). Entries are read as far as the bytes allow.
 */
export function parseFgf(bytes: Uint8Array): { entries: FgfEntry[]; warnings: string[] } {
  if (bytes.length < 4 || decodeFileName(bytes.subarray(0, 4)) !== FGF_SIGNATURE) throw new NotFgfError();
  const warnings: string[] = [];
  if (bytes.length < FGF_HEADER_LENGTH) {
    warnings.push("font index truncated before the entry count");
    return { entries: [], warnings };
  }
  const r = new ByteReader(bytes);
  r.seek(4);
  const count = r.u16();
  const room = Math.floor(r.remaining / FGF_ENTRY_LENGTH);
  const leftover = r.remaining % FGF_ENTRY_LENGTH;

  if (count > room) {
    warnings.push(
      `font index says ${count} entries but has room for ${room}` +
        (leftover ? ` (plus ${leftover} byte(s) of a truncated entry)` : ""),
    );
  } else if (r.remaining !== count * FGF_ENTRY_LENGTH) {
    warnings.push(
      `font index has ${r.remaining - count * FGF_ENTRY_LENGTH} byte(s) after its ${count} entries`,
    );
  }

  const entries: FgfEntry[] = [];
  const n = Math.min(count, room);
  for (let i = 0; i < n; i++) entries.push(readEntry(r.sub(FGF_ENTRY_LENGTH)));
  return { entries, warnings };
}

function readEntry(r: ByteReader): FgfEntry {
  const key = readFontKey(r);
  const classification = r.bytes(4).slice();
  const name = r.paddedString(48);
  const fileName = r.paddedString(18, decodeFileName).trim();
  const charMap = new Uint16Array(256);
  for (let c = 0; c < 256; c++) charMap[c] = r.u16();
  return { key, classification, name, ...splitFontName(name), fileName, charMap };
}

// ---------------------------------------------------------------------------
// Built-in table (HG3.FGF missing)
// ---------------------------------------------------------------------------

/** A built-in font index entry: what is known without HG3.FGF. */
export interface BuiltInFont {
  key: FontKey;
  family: string;
  style: string;
  fileName: string;
}

/**
 * Used when HG3.FGF is not in the file set: the 22 entries of the original
 * HG3.FGF (key, family, style and file name only), copied by decision of the
 * project owner, as with the default palette. Order and values match the
 * original index. No character map: callers treat codes as CP437 (§6.4).
 */
export const BUILT_IN_FONTS: readonly BuiltInFont[] = [
  { key: { source: FontSource.Speedo, number: 3, style: 0x4268 }, family: "Swiss 721", style: "Roman", fileName: "BX000003.SPD" },
  { key: { source: FontSource.Speedo, number: 4, style: 0x4269 }, family: "Swiss 721", style: "Italic", fileName: "BX000004.SPD" },
  { key: { source: FontSource.Speedo, number: 5, style: 0x42a8 }, family: "Swiss 721", style: "Bold", fileName: "BX000005.SPD" },
  { key: { source: FontSource.Speedo, number: 6, style: 0x42a9 }, family: "Swiss 721", style: "Bold Italic", fileName: "BX000006.SPD" },
  { key: { source: FontSource.Speedo, number: 100, style: 0x4228 }, family: "Swiss 721", style: "Thin", fileName: "BX000100.SPD" },
  { key: { source: FontSource.Speedo, number: 101, style: 0x4229 }, family: "Swiss 721", style: "Thin Italic", fileName: "BX000101.SPD" },
  { key: { source: FontSource.Speedo, number: 11, style: 0x4268 }, family: "Dutch 801", style: "Roman", fileName: "BX000011.SPD" },
  { key: { source: FontSource.Speedo, number: 12, style: 0x4269 }, family: "Dutch 801", style: "Italic", fileName: "BX000012.SPD" },
  { key: { source: FontSource.Speedo, number: 13, style: 0x42a8 }, family: "Dutch 801", style: "Bold", fileName: "BX000013.SPD" },
  { key: { source: FontSource.Speedo, number: 14, style: 0x42a9 }, family: "Dutch 801", style: "Bold Italic", fileName: "BX000014.SPD" },
  { key: { source: FontSource.Speedo, number: 485, style: 0x4278 }, family: "Geo Slab 712", style: "Medium", fileName: "BX000485.SPD" },
  { key: { source: FontSource.Speedo, number: 486, style: 0x4279 }, family: "Geo Slab 712", style: "Medium Italic", fileName: "BX000486.SPD" },
  { key: { source: FontSource.Speedo, number: 483, style: 0x4248 }, family: "Geo Slab 712", style: "Light", fileName: "BX000483.SPD" },
  { key: { source: FontSource.Speedo, number: 484, style: 0x4249 }, family: "Geo Slab 712", style: "Light Italic", fileName: "BX000484.SPD" },
  { key: { source: FontSource.Speedo, number: 596, style: 0x4268 }, family: "Monospace 821", style: "Roman", fileName: "BX000596.SPD" },
  { key: { source: FontSource.Stroke, number: 12, style: 0x5848 }, family: "HG Roman", style: "Light", fileName: "HG3LITE.FN3" },
  { key: { source: FontSource.Stroke, number: 13, style: 0x5858 }, family: "HG Roman", style: "Bold", fileName: "HG3BOLD.FN3" },
  { key: { source: FontSource.Stroke, number: 16, style: 0x5848 }, family: "HG Sans serif", style: "Light", fileName: "HG4LITE.FN3" },
  { key: { source: FontSource.Stroke, number: 17, style: 0x5858 }, family: "HG Sans serif", style: "Bold", fileName: "HG4BOLD.FN3" },
  { key: { source: FontSource.Stroke, number: 20, style: 0x5849 }, family: "HG Script", style: "Light", fileName: "HG5LITE.FN3" },
  { key: { source: FontSource.Stroke, number: 21, style: 0x5859 }, family: "HG Script", style: "Bold", fileName: "HG5BOLD.FN3" },
  { key: { source: FontSource.Stroke, number: 25, style: 0x5878 }, family: "HG Gothic", style: "Bold", fileName: "HG6BOLD.FN3" },
];
