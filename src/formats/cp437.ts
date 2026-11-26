/**
 * Code page 437, the IBM PC character set: what Harvard Graphics 1.x/2.x
 * text and DOS-era ZIP file names are stored in. (Harvard Graphics 3 uses
 * a set of its own for the upper half; see charset.ts.)
 */

/** Characters for bytes 0x80 to 0xFF. */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** The character for one byte; bytes below 0x80 are ASCII (control codes included). */
export function cp437Char(byte: number): string {
  return byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
}

/** Every byte as its character. */
export function decodeCp437(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += cp437Char(b);
  return s;
}
