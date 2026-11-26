import type { Confidence, FormatParser } from "./parser";
import { hg2Parser } from "./hg2";
import { hg3Parser } from "./hg3";

/** Every known parser. Add new formats here. */
export const parsers: readonly FormatParser[] = [hg3Parser, hg2Parser];

export interface Detection {
  parser: FormatParser;
  confidence: Confidence;
}

/**
 * Pick the parser most likely to understand a file, or `null` if none
 * claims it (confidence 0).
 */
export function detectFormat(
  bytes: Uint8Array,
  filename: string,
  candidates: readonly FormatParser[] = parsers,
): Detection | null {
  let best: Detection | null = null;
  for (const parser of candidates) {
    const confidence = parser.detect(bytes, filename);
    if (confidence > 0 && (!best || confidence > best.confidence)) {
      best = { parser, confidence };
    }
  }
  return best;
}
