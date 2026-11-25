/**
 * Built-in copy of the Harvard Graphics 3 default palette HG3.PL3
 * (SPEC §6.2), used when a chart's palette file and HG3.PL3 are both
 * unavailable, or a palette is empty (SPEC §7.1).
 *
 * GENERATED FILE, do not edit. Generated from samples-private/PALETTE/HG3.PL3 by
 * scripts/gen-default-palette.mjs. To regenerate, from the repository root:
 *
 *   node scripts/gen-default-palette.mjs
 */

/** One entry of the built-in palette (see palette.ts PaletteEntry). */
export interface DefaultPaletteEntry {
  index: number;
  role: number;
  name: string;
  rgb: readonly [number, number, number];
}

/** The 64 entries in index order; role = index + 1. */
export const DEFAULT_PALETTE_ENTRIES: readonly DefaultPaletteEntry[] = [
  { index: 0, role: 1, name: "Yel  L|Title", rgb: [255, 255, 128] },
  { index: 1, role: 2, name: "Blu  L|SubTitl1", rgb: [0, 128, 255] },
  { index: 2, role: 3, name: "Blu  L|SubTitl2", rgb: [0, 128, 255] },
  { index: 3, role: 4, name: "White |Text", rgb: [255, 255, 255] },
  { index: 4, role: 5, name: "Yel   |TextHigh", rgb: [255, 255, 0] },
  { index: 5, role: 6, name: "Blu   |TextDim", rgb: [0, 0, 255] },
  { index: 6, role: 7, name: "Blu  L|Footnote", rgb: [0, 128, 255] },
  { index: 7, role: 8, name: "Blu  L|XLabel", rgb: [0, 128, 255] },
  { index: 8, role: 9, name: "Blu  L|Y1Label", rgb: [0, 128, 255] },
  { index: 9, role: 10, name: "Yel  L|Y2Label", rgb: [255, 255, 128] },
  { index: 10, role: 11, name: "Cyn LL|XTitle", rgb: [128, 255, 255] },
  { index: 11, role: 12, name: "Cyn LL|Y1Title", rgb: [128, 255, 255] },
  { index: 12, role: 13, name: "Yel  L|Y2Title", rgb: [255, 255, 128] },
  { index: 13, role: 14, name: "Gry  D|Frame", rgb: [85, 85, 85] },
  { index: 14, role: 15, name: "Gry DD|FrameBkg", rgb: [22, 22, 22] },
  { index: 15, role: 16, name: "Orn  D|Bullet", rgb: [128, 64, 0] },
  { index: 16, role: 17, name: "Blu   |BulletDm", rgb: [0, 0, 255] },
  { index: 17, role: 18, name: "Blu   |Lines", rgb: [0, 0, 255] },
  { index: 18, role: 19, name: "Gry DD|Shadow", rgb: [12, 12, 12] },
  { index: 19, role: 20, name: "Black |Legend", rgb: [0, 0, 0] },
  { index: 20, role: 21, name: "Cyn  D|Series1", rgb: [0, 128, 128] },
  { index: 21, role: 22, name: "Blu  D|Series2", rgb: [0, 64, 128] },
  { index: 22, role: 23, name: "Blu  L|Series3", rgb: [0, 128, 255] },
  { index: 23, role: 24, name: "Cyn   |Series4", rgb: [0, 255, 255] },
  { index: 24, role: 25, name: "Yel  L|Series5", rgb: [255, 255, 128] },
  { index: 25, role: 26, name: "White |Series6", rgb: [255, 255, 255] },
  { index: 26, role: 27, name: "Blu DD|GoalY1", rgb: [0, 5, 38] },
  { index: 27, role: 28, name: "Cyn DD|GoalY2", rgb: [0, 15, 18] },
  { index: 28, role: 29, name: "Orn   |Draw1", rgb: [255, 128, 0] },
  { index: 29, role: 30, name: "Orn LL|Draw2", rgb: [255, 191, 128] },
  { index: 30, role: 31, name: "Yel LL|Draw3", rgb: [255, 255, 191] },
  { index: 31, role: 32, name: "Black |Outlines", rgb: [0, 0, 0] },
  { index: 32, role: 33, name: "Orn DD|Range1", rgb: [15, 8, 0] },
  { index: 33, role: 34, name: "Orn DD|Range2", rgb: [52, 26, 0] },
  { index: 34, role: 35, name: "Orn  D|Range3", rgb: [102, 51, 0] },
  { index: 35, role: 36, name: "Orn  D|Range4", rgb: [152, 76, 0] },
  { index: 36, role: 37, name: "Orn   |Range5", rgb: [202, 101, 0] },
  { index: 37, role: 38, name: "Orn   |Range6", rgb: [255, 128, 0] },
  { index: 38, role: 39, name: "Orn   |Range7", rgb: [253, 169, 46] },
  { index: 39, role: 40, name: "Orn  L|Range8", rgb: [255, 184, 84] },
  { index: 40, role: 41, name: "Orn  L|Range9", rgb: [255, 191, 128] },
  { index: 41, role: 42, name: "Orn LL|Range10", rgb: [255, 247, 188] },
  { index: 42, role: 43, name: "Red-gray", rgb: [191, 70, 70] },
  { index: 43, role: 44, name: "Yellow L", rgb: [255, 255, 128] },
  { index: 44, role: 45, name: "Brown L", rgb: [223, 166, 89] },
  { index: 45, role: 46, name: "Brown LL", rgb: [255, 191, 128] },
  { index: 46, role: 47, name: "Cyan-gray", rgb: [102, 148, 212] },
  { index: 47, role: 48, name: "Blue-gray", rgb: [77, 69, 191] },
  { index: 48, role: 49, name: "Black", rgb: [0, 0, 0] },
  { index: 49, role: 50, name: "White", rgb: [255, 255, 255] },
  { index: 50, role: 51, name: "Red", rgb: [255, 0, 0] },
  { index: 51, role: 52, name: "Orange", rgb: [255, 128, 0] },
  { index: 52, role: 53, name: "Yellow", rgb: [255, 255, 0] },
  { index: 53, role: 54, name: "Yellow-green", rgb: [128, 255, 0] },
  { index: 54, role: 55, name: "Green", rgb: [0, 255, 0] },
  { index: 55, role: 56, name: "Green-cyan", rgb: [0, 255, 128] },
  { index: 56, role: 57, name: "Cyan", rgb: [0, 255, 255] },
  { index: 57, role: 58, name: "Blue-cyan", rgb: [0, 128, 255] },
  { index: 58, role: 59, name: "Blue", rgb: [0, 0, 255] },
  { index: 59, role: 60, name: "Purple", rgb: [128, 0, 255] },
  { index: 60, role: 61, name: "Magenta", rgb: [255, 0, 255] },
  { index: 61, role: 62, name: "Magenta-red", rgb: [255, 0, 128] },
  { index: 62, role: 63, name: "Gray D", rgb: [85, 85, 85] },
  { index: 63, role: 64, name: "Gray L", rgb: [169, 169, 169] },
];
