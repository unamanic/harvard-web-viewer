/**
 * Character drawn for each byte code by the Harvard Graphics 3 Speedo fonts
 * (task 7d-2).
 *
 * This is the Harvard Graphics character set of src/formats/hg3/charset.ts
 * (close to code page 850, not CP437; SPEC §1, §6.4), seen as glyphs rather
 * than text: code 0 and 0xFF draw nothing (0xFF is a Bitstream pictograph
 * with no Unicode equivalent; the clones keep its advance), and 0x0A and
 * 0x0D draw their CP437 pictographs (◙, ♪) instead of being line ends.
 *
 * Identified by looking at the glyph each code selects in the original
 * fonts (only which character it is; no shapes or measurements of the glyph
 * are used here). Same for all 15 Speedo faces of the original index.
 */
import { HG3_CHARSET, hg3CodeOf } from "../../formats/hg3/charset";

/** Codes whose glyph differs from the decoded text character. */
const GLYPH_OVERRIDES: Readonly<Record<number, string>> = {
  0x00: "",
  0x0a: "◙",
  0x0d: "♪",
  0xff: "",
};

/** Unicode character for each of the 256 codes ("" = none). */
export const HG3_OUTLINE_CHARSET: readonly string[] = HG3_CHARSET.map((ch, code) =>
  code in GLYPH_OVERRIDES ? GLYPH_OVERRIDES[code]! : ch,
);

/** Byte code for a Unicode character in the HG3 set, or undefined. */
export function codeForChar(ch: string): number | undefined {
  return hg3CodeOf(ch);
}
