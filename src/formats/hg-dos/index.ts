import {
  type Confidence,
  type FormatParser,
  UnsupportedFormatError,
} from "../types";

/**
 * Harvard Graphics for DOS.
 *
 * STATUS: detection by file extension only. The binary layout has not been
 * reverse-engineered yet; see docs/formats.md. Once real sample files are
 * available, implement `parse` here (split into helpers in this folder,
 * e.g. header.ts, records.ts) and add fixture-based tests.
 */

/** Extensions believed to belong to Harvard Graphics for DOS (unverified). */
const EXTENSIONS = [".ch3", ".sy3", ".pl3"];

export const hgDosParser: FormatParser = {
  id: "hg-dos",
  name: "Harvard Graphics for DOS",

  detect(_bytes: Uint8Array, filename: string): Confidence {
    const lower = filename.toLowerCase();
    // Extension alone is weak evidence; replace with a magic-number check
    // once the header format is known.
    return EXTENSIONS.some((ext) => lower.endsWith(ext)) ? 0.5 : 0;
  },

  parse(): never {
    throw new UnsupportedFormatError(
      "Harvard Graphics for DOS decoding is not implemented yet. " +
        "Use the hex inspector to explore the file.",
    );
  },
};
