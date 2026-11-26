/**
 * Font key → stroke clone table (task 7d-1). The seven HG stroke fonts of the
 * HG3.FGF font index (docs/formats.md, "Verified findings") map to the
 * viewer's own Hershey-based faces, under our own family names.
 *
 * Hershey set per face (see README.md for the reasoning):
 *   HG Roman      Light → Roman Complex,  Bold → Roman Triplex
 *   HG Sans serif Light → Roman Simplex,  Bold → Roman Duplex
 *   HG Script     Light → Script Simplex, Bold → Script Complex
 *   HG Gothic     Bold  → Gothic English
 */
import type { FontKey } from "../fontKey";
import { FontSource } from "../fontKey";
import type { HersheySetId } from "./hersheyData";
import { createStrokeFont, type StrokeFont, type StrokeWeight } from "./strokeFont";

export const STROKE_FAMILY = {
  roman: "HWV Stroke Roman",
  sans: "HWV Stroke Sans",
  script: "HWV Stroke Script",
  gothic: "HWV Stroke Gothic",
} as const;

export interface StrokeCloneEntry {
  /** Font number of the 2:n:style key. */
  number: number;
  /** Style word as listed in HG3.FGF (informational; matching uses the number). */
  style: number;
  /** Name of the original in the font index, for display. */
  original: string;
  family: string;
  weight: StrokeWeight;
  hersheySet: HersheySetId;
  /** Recommended stroke width, em units. */
  strokeWidthEm: number;
}

/**
 * Light and Bold differ in Hershey set (single vs multi-stroke) and in the
 * recommended pen width. Multi-stroke sets already carry their weight in the
 * strokes, so their pen is only a little wider.
 */
export const STROKE_CLONE_TABLE: readonly StrokeCloneEntry[] = [
  { number: 12, style: 0x5848, original: "HG Roman Light", family: STROKE_FAMILY.roman, weight: "light", hersheySet: "romanComplex", strokeWidthEm: 0.04 },
  { number: 13, style: 0x5858, original: "HG Roman Bold", family: STROKE_FAMILY.roman, weight: "bold", hersheySet: "romanTriplex", strokeWidthEm: 0.055 },
  { number: 16, style: 0x5848, original: "HG Sans serif Light", family: STROKE_FAMILY.sans, weight: "light", hersheySet: "romanSimplex", strokeWidthEm: 0.04 },
  { number: 17, style: 0x5858, original: "HG Sans serif Bold", family: STROKE_FAMILY.sans, weight: "bold", hersheySet: "romanDuplex", strokeWidthEm: 0.06 },
  { number: 20, style: 0x5849, original: "HG Script Light", family: STROKE_FAMILY.script, weight: "light", hersheySet: "scriptSimplex", strokeWidthEm: 0.04 },
  { number: 21, style: 0x5859, original: "HG Script Bold", family: STROKE_FAMILY.script, weight: "bold", hersheySet: "scriptComplex", strokeWidthEm: 0.06 },
  { number: 25, style: 0x5878, original: "HG Gothic Bold", family: STROKE_FAMILY.gothic, weight: "bold", hersheySet: "gothicEnglish", strokeWidthEm: 0.05 },
];

const fonts = new Map<number, StrokeFont>();

/**
 * Stroke clone for a font key, or null when the key is not one of the seven
 * HG stroke fonts. Matches source 2 and the font number; the style word is
 * not compared (the number alone identifies the face in HG3.FGF).
 */
export function strokeCloneFor(key: FontKey): StrokeFont | null {
  if (key.source !== FontSource.Stroke) return null;
  const entry = STROKE_CLONE_TABLE.find((e) => e.number === key.number);
  if (!entry) return null;
  let font = fonts.get(entry.number);
  if (!font) {
    font = createStrokeFont(entry.family, entry.weight, entry.hersheySet, entry.strokeWidthEm);
    fonts.set(entry.number, font);
  }
  return font;
}
