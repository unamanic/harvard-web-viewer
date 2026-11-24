/**
 * Format bytes as classic hex-dump lines:
 *   00000000  48 47 33 ...  |HG3...|
 * Used by the inspector to help reverse-engineer unknown formats.
 */
export function hexdump(bytes: Uint8Array, bytesPerLine = 16): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += bytesPerLine) {
    const chunk = bytes.subarray(offset, offset + bytesPerLine);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(bytesPerLine * 3 - 1, " ");
    const ascii = Array.from(chunk, (b) =>
      b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".",
    ).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
  }
  return lines;
}
