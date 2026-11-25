/**
 * The Harvard Graphics 3 character set (SPEC §1 Conventions, §6.4).
 *
 * Text is 8-bit: codes 0x20–0x7E are ASCII; the upper half is Harvard's own
 * set, close to code page 850 (0xB5 Á, 0xC6 ã, 0xD0 ð, 0xE0 Ó …) with codes
 * of its own (0xB9 Œ, 0xCA “, 0xEE ‘, 0xF0 ‰, 0xF2 ≥, 0xFD − …). It is NOT
 * code page 437. The table was identified from the glyph each code selects
 * in the original Speedo fonts through HG3.FGF (task 7d-2; docs/formats.md
 * "Verified findings").
 *
 * Control codes: the fonts draw the usual CP437 pictographs for 0x01–0x1F
 * and 0x7F, and 0x07 as a large black circle (●). For decoded text,
 * 0x0A and 0x0D are line ends ("\n", "\r"; text-block runs end lines with
 * 0x0A) and 0x00 stays U+0000. 0xFF is a Bitstream pictograph (a grimacing
 * face) with no Unicode equivalent and decodes as U+FFFD.
 *
 * Every code decodes to exactly one UTF-16 unit, so character offsets in
 * decoded text equal byte offsets (text-block line ranges rely on this).
 *
 * File names are not text in this set: decode them with decodeFileName.
 */

const LOW =
  "\u0000☺☻♥♦♣♠●◘○\n♂♀\r♫☼" + // 0x00–0x0F
  "►◄↕‼¶§▬↨↑↓→←∟↔▲▼"; //         0x10–0x1F

const HIGH =
  "ÇüéâäàåçêëèïîìÄÅ" + // 0x80
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" + // 0x90
  "áíóúñÑªº¿®¬½¼¡«»" + // 0xA0
  "░▒▓│┤ÁÂÀ©Œ║╗╝¢¥┐" + // 0xB0
  "└┴┬├─┼ãÃ╚╔“”œ═₧¤" + // 0xC0
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" + // 0xD0
  "ÓßÔÒõÕµþÞÚÛÙýÝ‘’" + // 0xE0
  "‰±≥≤¶§÷≈°►•√*−■�"; // 0xF0

function buildTable(): readonly string[] {
  const table: string[] = [...LOW];
  for (let b = 0x20; b < 0x7f; b++) table.push(String.fromCharCode(b));
  table.push("⌂");
  table.push(...HIGH);
  if (table.length !== 256 || table.some((c) => c.length !== 1)) throw new Error("bad HG3 character table");
  return table;
}

/** Unicode character for each of the 256 byte codes (one UTF-16 unit each). */
export const HG3_CHARSET: readonly string[] = buildTable();

/** Decode Harvard Graphics text bytes, one character per byte. */
export function decodeHg3Text(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HG3_CHARSET[bytes[i]!];
  return out;
}

let reverse: Map<string, number> | null = null;

/**
 * Byte code of a Unicode character in the HG3 set, or undefined. Where a
 * character has two codes the printable one wins (ASCII "*" over 0xFC,
 * 0xF9 ► over the control pictograph 0x10, 0xF4 ¶ over 0x14, 0xF5 § over
 * 0x15).
 */
export function hg3CodeOf(ch: string): number | undefined {
  if (!reverse) {
    const map = new Map<string, number>();
    const add = (code: number) => {
      if (!map.has(HG3_CHARSET[code]!)) map.set(HG3_CHARSET[code]!, code);
    };
    for (let code = 0x20; code < 0x100; code++) add(code);
    for (let code = 0x00; code < 0x20; code++) add(code);
    reverse = map;
  }
  return reverse.get(ch);
}

/**
 * Decode a file name (404 references, font file names): bytes as ISO 8859-1,
 * which is plain ASCII for every name seen. Names are matched against the
 * user's files, so they are kept as stored, not mapped through HG3_CHARSET.
 */
export function decodeFileName(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}
