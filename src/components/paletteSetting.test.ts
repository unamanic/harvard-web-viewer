import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PALETTE_SETTING,
  PALETTE_SETTINGS,
  isPaletteSetting,
  loadPaletteSetting,
  paletteLoadOptions,
  savePaletteSetting,
} from "./paletteSetting";

describe("palette setting", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("is remembered under hwv.palette and falls back to the default", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(loadPaletteSetting()).toBe("saved");
    savePaletteSetting("monochrb");
    expect(store.get("hwv.palette")).toBe("monochrb");
    expect(loadPaletteSetting()).toBe("monochrb");
    store.set("hwv.palette", "bogus");
    expect(loadPaletteSetting()).toBe("saved");
  });

  it("survives blocked storage", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(() => savePaletteSetting("monochrw")).not.toThrow();
    expect(loadPaletteSetting()).toBe("saved");
  });
});
