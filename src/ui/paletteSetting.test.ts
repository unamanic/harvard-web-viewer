import { describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE_SETTING,
  PALETTE_SETTINGS,
  isPaletteSetting,
  paletteLoadOptions,
} from "./paletteSetting";

describe("palette setting", () => {
  it("offers as saved and the two greyscale palettes", () => {
    expect(PALETTE_SETTINGS.map((p) => p.label)).toEqual([
      "As saved",
      "Greyscale, black background (MONOCHRB.PL3)",
      "Greyscale, white background (MONOCHRW.PL3)",
    ]);
    expect(DEFAULT_PALETTE_SETTING).toBe("saved");
    expect(isPaletteSetting("monochrw")).toBe(true);
    expect(isPaletteSetting("bogus")).toBe(false);
  });

  it("maps to parse options", () => {
    expect(paletteLoadOptions("saved")).toEqual({});
    expect(paletteLoadOptions("monochrb")).toEqual({ paletteOverride: "MONOCHRB.PL3" });
    expect(paletteLoadOptions("monochrw")).toEqual({ paletteOverride: "MONOCHRW.PL3" });
  });
});
