import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_MODE, DISPLAY_MODES } from "../render/displayMode";
import {
  loadDisplayMode,
  loadMuted,
  loadPaletteSetting,
  loadTransitionMode,
  saveDisplayMode,
  saveMuted,
  savePaletteSetting,
  saveTransitionMode,
} from "./settings";

afterEach(() => vi.unstubAllGlobals());

/** A localStorage stand-in backed by a map. */
function memoryStorage(entries: [string, string][] = []): Map<string, string> {
  const store = new Map(entries);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  return store;
}

function blockedStorage(): void {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
}

describe("display mode", () => {
  it("maps the stored legacy value \"cga\" to \"mono\"", () => {
    memoryStorage([["hwv.displayMode", "cga"]]);
    expect(loadDisplayMode()).toBe("mono");
  });

  it("returns a stored mode, or the default for unknown values", () => {
    const store = memoryStorage();
    expect(loadDisplayMode()).toBe("vga");
    store.set("hwv.displayMode", "ega");
    expect(loadDisplayMode()).toBe("ega");
    store.set("hwv.displayMode", "hercules");
    expect(loadDisplayMode()).toBe("vga");
  });

  it("keeps a stored \"vga\" (now the dithered ScreenShow driver) as it is", () => {
    memoryStorage([["hwv.displayMode", "vga"]]);
    expect(loadDisplayMode()).toBe("vga");
    expect(DEFAULT_DISPLAY_MODE).toBe("vga");
    expect(DISPLAY_MODES.find((m) => m.mode === "vga")?.label).toBe("VGA ScreenShow (16 colours, dithered)");
  });

  it("stores the mode id under hwv.displayMode", () => {
    const store = memoryStorage();
    saveDisplayMode("ega");
    expect(store.get("hwv.displayMode")).toBe("ega");
  });
});

describe("palette setting", () => {
  it("is remembered under hwv.palette and falls back to the default", () => {
    const store = memoryStorage();
    expect(loadPaletteSetting()).toBe("saved");
    savePaletteSetting("monochrb");
    expect(store.get("hwv.palette")).toBe("monochrb");
    expect(loadPaletteSetting()).toBe("monochrb");
    store.set("hwv.palette", "bogus");
    expect(loadPaletteSetting()).toBe("saved");
  });
});

describe("transition mode", () => {
  it("remembers the mode and falls back to the default", () => {
    const store = memoryStorage();
    expect(loadTransitionMode()).toBe("file");
    saveTransitionMode("demo");
    expect(loadTransitionMode()).toBe("demo");
    saveTransitionMode("off");
    expect(loadTransitionMode()).toBe("off");
    store.set("hwv.transitions", "bogus");
    expect(loadTransitionMode()).toBe("file");
  });

  it("migrates the old \"guessed\" setting to \"From the file\"", () => {
    const store = memoryStorage([["hwv.transitions", "guessed"]]);
    expect(loadTransitionMode()).toBe("file");
    expect(store.get("hwv.transitions")).toBe("file");
  });
});

describe("mute", () => {
  it("is remembered under hwv.soundMuted, off by default", () => {
    const store = memoryStorage();
    expect(loadMuted()).toBe(false);
    saveMuted(true);
    expect(store.get("hwv.soundMuted")).toBe("1");
    expect(loadMuted()).toBe(true);
  });
});

describe("blocked storage", () => {
  it("gives every default and does not throw on save", () => {
    blockedStorage();
    expect(() => {
      saveDisplayMode("ega");
      savePaletteSetting("monochrw");
      saveTransitionMode("demo");
      saveMuted(true);
    }).not.toThrow();
    expect(loadDisplayMode()).toBe("vga");
    expect(loadPaletteSetting()).toBe("saved");
    expect(loadTransitionMode()).toBe("file");
    expect(loadMuted()).toBe(false);
  });
});
