import type { LoadOptions } from "../files/loadFile";

/**
 * The viewer's "Palette" setting (docs/RENDERER_TASKS.md task 6c): draw
 * charts with their own palette, or with one of Harvard Graphics 3's
 * greyscale palettes in its place, role for role. Unlike the display mode
 * (a render-time recolouring), this changes palette resolution at parse
 * time, so changing it re-parses the open file.
 */
export type PaletteSetting = "saved" | "monochrb" | "monochrw";

export const DEFAULT_PALETTE_SETTING: PaletteSetting = "saved";

export const PALETTE_SETTINGS: readonly { setting: PaletteSetting; label: string; file?: string }[] = [
  { setting: "saved", label: "As saved" },
  { setting: "monochrb", label: "Greyscale, black background (MONOCHRB.PL3)", file: "MONOCHRB.PL3" },
  { setting: "monochrw", label: "Greyscale, white background (MONOCHRW.PL3)", file: "MONOCHRW.PL3" },
];

export function isPaletteSetting(v: unknown): v is PaletteSetting {
  return PALETTE_SETTINGS.some((p) => p.setting === v);
}

/** The parse options for a setting. */
export function paletteLoadOptions(setting: PaletteSetting): LoadOptions {
  const file = PALETTE_SETTINGS.find((p) => p.setting === setting)?.file;
  return file ? { paletteOverride: file } : {};
}
