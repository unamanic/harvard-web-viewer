/**
 * Font keys of the original Speedo faces → our outline clones (task 7d-2).
 *
 * The clone families are this project's own ("HWV Sans", "HWV Serif",
 * "HWV Slab", "HWV Mono"); see README.md in this folder for where each
 * clone's outlines come from.
 */
import { type FontKey, fontKeyString } from "../fontKey";

export interface OutlineCloneEntry {
  /** Font key of the original face, as in HG3.FGF. */
  key: FontKey;
  /** Stable id of the clone face; also the generated module's file name. */
  id: string;
  /** Clone family name (ours). */
  family: string;
  /** Clone style name. */
  style: string;
  /** Font file of the original face (the clone stands in for it). */
  originalFile: string;
}

const k = (number: number, style: number): FontKey => ({ source: 3, number, style });

export const OUTLINE_CLONES: readonly OutlineCloneEntry[] = [
  { key: k(3, 0x4268), id: "hwv-sans-regular", family: "HWV Sans", style: "Regular", originalFile: "BX000003.SPD" },
  { key: k(4, 0x4269), id: "hwv-sans-italic", family: "HWV Sans", style: "Italic", originalFile: "BX000004.SPD" },
  { key: k(5, 0x42a8), id: "hwv-sans-bold", family: "HWV Sans", style: "Bold", originalFile: "BX000005.SPD" },
  { key: k(6, 0x42a9), id: "hwv-sans-bold-italic", family: "HWV Sans", style: "Bold Italic", originalFile: "BX000006.SPD" },
  { key: k(100, 0x4228), id: "hwv-sans-thin", family: "HWV Sans", style: "Thin", originalFile: "BX000100.SPD" },
  { key: k(101, 0x4229), id: "hwv-sans-thin-italic", family: "HWV Sans", style: "Thin Italic", originalFile: "BX000101.SPD" },
  { key: k(11, 0x4268), id: "hwv-serif-regular", family: "HWV Serif", style: "Regular", originalFile: "BX000011.SPD" },
  { key: k(12, 0x4269), id: "hwv-serif-italic", family: "HWV Serif", style: "Italic", originalFile: "BX000012.SPD" },
  { key: k(13, 0x42a8), id: "hwv-serif-bold", family: "HWV Serif", style: "Bold", originalFile: "BX000013.SPD" },
  { key: k(14, 0x42a9), id: "hwv-serif-bold-italic", family: "HWV Serif", style: "Bold Italic", originalFile: "BX000014.SPD" },
  { key: k(485, 0x4278), id: "hwv-slab-medium", family: "HWV Slab", style: "Medium", originalFile: "BX000485.SPD" },
  { key: k(486, 0x4279), id: "hwv-slab-medium-italic", family: "HWV Slab", style: "Medium Italic", originalFile: "BX000486.SPD" },
  { key: k(483, 0x4248), id: "hwv-slab-light", family: "HWV Slab", style: "Light", originalFile: "BX000483.SPD" },
  { key: k(484, 0x4249), id: "hwv-slab-light-italic", family: "HWV Slab", style: "Light Italic", originalFile: "BX000484.SPD" },
  { key: k(596, 0x4268), id: "hwv-mono-regular", family: "HWV Mono", style: "Regular", originalFile: "BX000596.SPD" },
];

const byKey = new Map(OUTLINE_CLONES.map((e) => [fontKeyString(e.key), e]));

/** The clone entry for a font key, or undefined. */
export function outlineCloneEntry(key: FontKey): OutlineCloneEntry | undefined {
  return byKey.get(fontKeyString(key));
}
